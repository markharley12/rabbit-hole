#!/usr/bin/env python3
"""Pack a course into one file, or unpack one someone sent you.

    env -u PYTHONPATH python3 tools/pack_course.py pack <course-id> [--field maths] [--out DIR]
    env -u PYTHONPATH python3 tools/pack_course.py unpack <file.rhpack> [--force]

A pack (<course-id>.rhpack) is a zip holding manifest.json and the course folder's .json
files under course/. The manifest names the course and gives a SHA-256 for every file.

A pack is untrusted input. Unpacking never uses extractall: it reads the member list, refuses
anything that is not manifest.json or a plain *.json file directly under course/, caps the
size and number of files, checks every hash, and stages the course in a temporary folder where
the validator runs on it. Only a course that passes is moved into content/<field>/courses/<id>/,
and an existing course is replaced only with --force. A failed unpack leaves content/ as it was.

Stdlib only, apart from the validator it imports.
"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import re
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path

import validate_courses as vc

ROOT = Path(__file__).resolve().parent.parent

FORMAT = 1
KIND = "rabbit-hole-course"
MAX_TOTAL = 5 * 1024 * 1024  # bytes, packed and unpacked alike
MAX_FILES = 200
SLUG = re.compile(r"^[a-z0-9][a-z0-9-]*$")
# A plain file name: no separators, no "..", only .json.
FILE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*\.json$")


class PackError(Exception):
    """Something about a pack or a course is wrong; the message says what."""


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def course_files(course_dir: Path) -> dict[str, bytes]:
    """The .json files directly in a course folder, by name."""
    files = {p.name: p.read_bytes() for p in sorted(course_dir.iterdir()) if p.is_file() and p.suffix == ".json"}
    if "course.json" not in files:
        raise PackError(f"{course_dir} has no course.json")
    if len(files) > MAX_FILES or sum(len(b) for b in files.values()) > MAX_TOTAL:
        raise PackError("the course is bigger than a pack may be (200 files, 5 MB)")
    for name in files:
        if not FILE_NAME.match(name) or ".." in name:
            raise PackError(f"{name!r} is not a file name a pack may hold")
    return files


def stage_and_validate(field: str, course_id: str, files: dict[str, bytes], public: Path, schema: Path, work: Path) -> Path:
    """Write the files as <work>/content/<field>/courses/<id>/ and run the validator on just that."""
    content = work / "content"
    staged = content / field / "courses" / course_id
    staged.mkdir(parents=True)
    for name, data in files.items():
        (staged / name).write_bytes(data)
    report, _ = vc.validate(content, public, schema)
    if report.errors:
        raise PackError("the course does not validate:\n" + "\n".join(f"  {e}" for e in report.errors))
    return staged


def pack(course_id: str, field: str = "maths", *, content: Path = ROOT / "content", public: Path = ROOT / "public",
         schema: Path = ROOT / "schema", out: Path = ROOT / "dist-packs") -> Path:
    if not SLUG.match(course_id) or not SLUG.match(field):
        raise PackError("course id and field are lower-case words joined by hyphens")
    course_dir = content / field / "courses" / course_id
    if not course_dir.is_dir():
        raise PackError(f"no course {course_id!r} in {course_dir.parent}")
    files = course_files(course_dir)
    course = json.loads(files["course.json"])
    if course.get("id") != course_id:
        raise PackError(f"course.json says id {course.get('id')!r}, the folder is {course_id!r}")
    with tempfile.TemporaryDirectory() as work:
        stage_and_validate(field, course_id, files, public, schema, Path(work))
    manifest = {
        "format": FORMAT,
        "kind": KIND,
        "field": field,
        "id": course_id,
        "title": course["title"],
        "nodeId": course["nodeId"],
        "files": {name: sha256(data) for name, data in files.items()},
        "packed": datetime.date.today().isoformat(),
    }
    out.mkdir(parents=True, exist_ok=True)
    target = out / f"{course_id}.rhpack"
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
        # A fixed timestamp, so packing the same course twice gives the same bytes.
        for name, data in [("manifest.json", (json.dumps(manifest, indent=1) + "\n").encode())] + [
            (f"course/{n}", d) for n, d in files.items()
        ]:
            archive.writestr(zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0)), data, zipfile.ZIP_DEFLATED)
    return target


def read_pack(path: Path) -> tuple[dict, dict[str, bytes]]:
    """The manifest and the course files of a pack, after every check except validation."""
    if path.stat().st_size > MAX_TOTAL:
        raise PackError("the pack is bigger than 5 MB")
    try:
        archive = zipfile.ZipFile(path)
    except zipfile.BadZipFile as error:
        raise PackError(f"not a pack: {error}") from error
    with archive:
        infos = archive.infolist()
        if len(infos) > MAX_FILES + 1:
            raise PackError("the pack holds more than 200 files")
        names = [i.filename for i in infos]
        if len(set(names)) != len(names):
            raise PackError("a name appears twice in the pack")
        if sum(i.file_size for i in infos) > MAX_TOTAL:
            raise PackError("the pack unpacks to more than 5 MB")
        members: dict[str, str] = {}  # file name -> member name
        for name in names:
            if name == "manifest.json":
                continue
            prefix, _, file_name = name.partition("/")
            if prefix != "course" or not FILE_NAME.match(file_name) or ".." in file_name:
                raise PackError(f"refusing the member {name!r}: only manifest.json and plain .json files under course/ are allowed")
            members[file_name] = name
        if "manifest.json" not in names:
            raise PackError("the pack has no manifest.json")

        def read(name: str) -> bytes:
            # Read at most one byte over the declared size, so a header that lies cannot flood memory.
            info = archive.getinfo(name)
            with archive.open(info) as handle:
                data = handle.read(info.file_size + 1)
            if len(data) != info.file_size:
                raise PackError(f"{name!r} is not the size it says")
            return data

        try:
            manifest = json.loads(read("manifest.json"))
        except ValueError as error:
            raise PackError(f"manifest.json is not JSON: {error}") from error
        files = {file_name: read(member) for file_name, member in members.items()}

    if not isinstance(manifest, dict) or manifest.get("format") != FORMAT or manifest.get("kind") != KIND:
        raise PackError("manifest.json is not a rabbit-hole course manifest of format 1")
    for key in ("field", "id"):
        if not isinstance(manifest.get(key), str) or not SLUG.match(manifest[key]):
            raise PackError(f"manifest {key} must be lower-case words joined by hyphens")
    listed = manifest.get("files")
    if not isinstance(listed, dict) or set(listed) != set(files):
        raise PackError("the files in the manifest and in the pack differ")
    for name, data in files.items():
        if listed[name] != sha256(data):
            raise PackError(f"{name} does not match its hash in the manifest")
    if "course.json" not in files:
        raise PackError("the pack has no course/course.json")
    return manifest, files


def unpack(pack_file: Path, *, content: Path = ROOT / "content", public: Path = ROOT / "public",
           schema: Path = ROOT / "schema", force: bool = False) -> Path:
    manifest, files = read_pack(pack_file)
    field, course_id = manifest["field"], manifest["id"]
    try:
        course = json.loads(files["course.json"])
    except ValueError as error:
        raise PackError(f"course.json is not JSON: {error}") from error
    if not isinstance(course, dict) or course.get("id") != course_id:
        raise PackError("course.json and the manifest name different courses")
    target = content / field / "courses" / course_id
    if target.exists() and not force:
        raise PackError(f"{target} already exists; use --force to replace it")
    with tempfile.TemporaryDirectory() as work_name:
        work = Path(work_name)
        staged = stage_and_validate(field, course_id, files, public, schema, work)
        # Validated; only now does content/ change. The old course waits in `work` until the new one is in.
        target.parent.mkdir(parents=True, exist_ok=True)
        backup = work / "previous"
        if target.exists():
            shutil.move(str(target), str(backup))
        try:
            shutil.move(str(staged), str(target))
        except OSError:
            shutil.rmtree(target, ignore_errors=True)
            if backup.exists():
                shutil.move(str(backup), str(target))
            raise
    return target


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Pack a course into one .rhpack file, or unpack one.")
    commands = parser.add_subparsers(dest="command", required=True)
    pack_cmd = commands.add_parser("pack", help="write <course-id>.rhpack")
    pack_cmd.add_argument("course_id")
    pack_cmd.add_argument("--field", default="maths")
    pack_cmd.add_argument("--out", type=Path, default=ROOT / "dist-packs")
    unpack_cmd = commands.add_parser("unpack", help="add the course in a pack to content/")
    unpack_cmd.add_argument("file", type=Path)
    unpack_cmd.add_argument("--force", action="store_true", help="replace a course that is already there")
    for command in (pack_cmd, unpack_cmd):
        command.add_argument("--content", type=Path, default=ROOT / "content")
        command.add_argument("--public", type=Path, default=ROOT / "public")
    args = parser.parse_args(argv)
    try:
        if args.command == "pack":
            target = pack(args.course_id, args.field, content=args.content, public=args.public, out=args.out)
            print(f"Packed {target}")
        else:
            target = unpack(args.file, content=args.content, public=args.public, force=args.force)
            print(f"Unpacked into {target}. Run npm run courses to publish it to the app.")
    except (PackError, OSError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
