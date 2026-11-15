"""Tests for tools/pack_course.py. Everything runs in a temporary content root:

    env -u PYTHONPATH python3 -m unittest discover -s tools/tests -v
"""

import contextlib
import io
import json
import shutil
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pack_course as pc  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
COURSE_ID = "least-squares-to-the-pseudo-inverse"


class Packs(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp)
        self.content = self.tmp / "content"
        shutil.copytree(ROOT / "content", self.content)
        self.public = self.tmp / "public"
        (self.public / "content" / "maths").mkdir(parents=True)
        shutil.copyfile(ROOT / "public" / "content" / "maths" / "map.json", self.public / "content" / "maths" / "map.json")
        self.out = self.tmp / "out"
        self.course = self.content / "maths" / "courses" / COURSE_ID

    def pack(self):
        return pc.pack(COURSE_ID, "maths", content=self.content, public=self.public, schema=ROOT / "schema", out=self.out)

    def unpack(self, file, **kwargs):
        return pc.unpack(file, content=self.content, public=self.public, schema=ROOT / "schema", **kwargs)

    def rewrite(self, source, change):
        """A copy of a pack with its members changed by `change(members)`; hashes are left alone."""
        with zipfile.ZipFile(source) as archive:
            members = {name: archive.read(name) for name in archive.namelist()}
        change(members)
        target = self.tmp / "edited.rhpack"
        with zipfile.ZipFile(target, "w") as archive:
            for name, data in members.items():
                archive.writestr(name, data)
        return target

    def snapshot(self):
        return {str(p.relative_to(self.content)): p.read_bytes() for p in self.content.rglob("*") if p.is_file()}

    def test_round_trip_gives_identical_files(self):
        file = self.pack()
        self.assertEqual(file.name, f"{COURSE_ID}.rhpack")
        with zipfile.ZipFile(file) as archive:
            manifest = json.loads(archive.read("manifest.json"))
        self.assertEqual((manifest["format"], manifest["kind"], manifest["field"]), (1, "rabbit-hole-course", "maths"))
        self.assertEqual((manifest["id"], manifest["nodeId"]), (COURSE_ID, "15Axx"))
        self.assertEqual(set(manifest["files"]), {p.name for p in self.course.glob("*.json")})
        before = {p.name: p.read_bytes() for p in self.course.glob("*.json")}
        shutil.rmtree(self.course)
        self.assertEqual(self.unpack(file), self.course)
        self.assertEqual({p.name: p.read_bytes() for p in self.course.iterdir()}, before)

    def test_packing_is_repeatable(self):
        first = self.pack().read_bytes()
        self.assertEqual(self.pack().read_bytes(), first)

    def test_a_course_that_fails_validation_is_not_packed(self):
        path = self.course / "course.json"
        document = json.loads(path.read_text())
        document["nodeId"] = "99Zxx"
        path.write_text(json.dumps(document))
        with self.assertRaisesRegex(pc.PackError, "does not validate"):
            self.pack()
        self.assertFalse(self.out.exists() and any(self.out.iterdir()))

    def test_a_changed_file_fails_the_hash_check(self):
        file = self.pack()
        shutil.rmtree(self.course)
        before = self.snapshot()
        bad = self.rewrite(file, lambda m: m.update({"course/dependent-columns.json": m["course/dependent-columns.json"] + b" "}))
        with self.assertRaisesRegex(pc.PackError, "does not match its hash"):
            self.unpack(bad)
        self.assertEqual(self.snapshot(), before)

    def test_members_outside_course_are_refused(self):
        file = self.pack()
        shutil.rmtree(self.course)
        for name in ["course/../evil.json", "../evil.json", "/etc/evil.json", "course/sub/evil.json", "course/evil.py", "evil.json", "course/..json"]:
            with self.subTest(name=name):
                bad = self.rewrite(file, lambda m, n=name: m.update({n: b"{}"}))
                with self.assertRaisesRegex(pc.PackError, "refusing the member"):
                    self.unpack(bad)
        self.assertFalse(self.course.exists())
        self.assertFalse((self.tmp / "evil.json").exists())

    def test_a_pack_over_the_limits_is_refused(self):
        file = self.pack()
        many = self.rewrite(file, lambda m: m.update({f"course/f{i}.json": b"{}" for i in range(pc.MAX_FILES)}))
        with self.assertRaisesRegex(pc.PackError, "more than 200"):
            pc.read_pack(many)
        big = self.rewrite(file, lambda m: m.update({"course/big.json": b" " * (pc.MAX_TOTAL + 1)}))
        with self.assertRaisesRegex(pc.PackError, "5 MB"):
            pc.read_pack(big)

    def test_an_unlisted_or_missing_file_is_refused(self):
        file = self.pack()
        extra = self.rewrite(file, lambda m: m.update({"course/extra.json": b"{}"}))
        with self.assertRaisesRegex(pc.PackError, "differ"):
            pc.read_pack(extra)

    def test_an_invalid_course_is_refused_and_leaves_nothing_behind(self):
        file = self.pack()
        shutil.rmtree(self.course)
        before = self.snapshot()
        with zipfile.ZipFile(file) as archive:
            members = {name: archive.read(name) for name in archive.namelist()}
        lesson = json.loads(members["course/the-smallest-best-fit.json"])
        lesson["blocks"][3]["answer"]["fields"][0]["key"] = "0.61"
        members["course/the-smallest-best-fit.json"] = json.dumps(lesson).encode()
        manifest = json.loads(members["manifest.json"])
        manifest["files"]["the-smallest-best-fit.json"] = pc.sha256(members["course/the-smallest-best-fit.json"])
        members["manifest.json"] = json.dumps(manifest).encode()
        bad = self.tmp / "invalid.rhpack"
        with zipfile.ZipFile(bad, "w") as archive:
            for name, data in members.items():
                archive.writestr(name, data)
        with self.assertRaisesRegex(pc.PackError, "the key does not match verify"):
            self.unpack(bad)
        self.assertEqual(self.snapshot(), before)

    def test_an_existing_course_is_kept_unless_forced(self):
        file = self.pack()
        marker = self.course / "dependent-columns.json"
        original = marker.read_bytes()
        with self.assertRaisesRegex(pc.PackError, "already exists"):
            self.unpack(file)
        # Forcing replaces it with the pack's version.
        marker.write_text("{}")
        self.unpack(file, force=True)
        self.assertEqual(marker.read_bytes(), original)

    def test_a_failed_forced_unpack_keeps_the_old_course(self):
        file = self.pack()
        before = self.snapshot()
        bad = self.rewrite(file, lambda m: m.update({"course/dependent-columns.json": b"{}"}))
        with self.assertRaises(pc.PackError):
            self.unpack(bad, force=True)
        self.assertEqual(self.snapshot(), before)

    def test_the_command_line_reports_errors_with_a_non_zero_exit(self):
        file = self.pack()
        argv = ["unpack", str(file), "--content", str(self.content), "--public", str(self.public)]
        with contextlib.redirect_stderr(io.StringIO()) as err:
            self.assertEqual(pc.main(argv), 1)
        self.assertIn("already exists", err.getvalue())
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(pc.main(argv + ["--force"]), 0)


if __name__ == "__main__":
    unittest.main()
