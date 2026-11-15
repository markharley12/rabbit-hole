#!/usr/bin/env python3
"""Build public/content/maths/map.json from TreeQuiz's maths dataset.

Reads `tree.json`, `info.json` and `manifest.json` from TreeQuiz's
`datasets/maths/` and writes one file the app loads: the tree with each node's
MSC code, topics and zbMATH link, plus where the data came from and its licence.

Standard library only. Run from the repo root:

    env -u PYTHONPATH python3 tools/build_maths_map.py

The output is deterministic (no timestamps), so re-running against the same
TreeQuiz commit changes nothing.

Shape of the source, checked 15 Nov 2026 at TreeQuiz e45a884:

- `tree.json` is `{name, children[]}`. A coded node's `name` is its MSC code
  (`15Axx`), its readable name is `label`, and it has `rank` and `aliases`.
  The root, the 5 branches, the 14 areas and one unranked group ("Mechanics")
  have no code: their `name` is the readable name. Those groupings are
  TreeQuiz's own, not MSC's.
- `info.json` has one entry per coded node (572): `description`, `items`
  (for a section, its MSC topics; for a subject, its sections' MSC names),
  `url`, `url_title`.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
import unicodedata
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DEFAULT_SOURCE = Path.home() / "git" / "TreeQuiz" / "datasets" / "maths"
DEFAULT_OUTPUT = REPO / "public" / "content" / "maths" / "map.json"
SOURCE_FILES = ("tree.json", "info.json", "manifest.json")
SOURCE_REPO_URL = "https://github.com/markharley12/TreeQuiz"
FORMAT = 1


class BuildError(Exception):
    """The source data is not the shape this script was written for."""


def slugify(name: str) -> str:
    """`Rings, fields and algebras` -> `rings-fields-and-algebras`."""
    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_name.lower()).strip("-")
    if not slug:
        raise BuildError(f"cannot make an id from the name {name!r}")
    return slug


def build_node(source: dict, info: dict, seen: dict[str, str], path: str = "") -> dict:
    """One output node from one TreeQuiz node, recursively.

    `seen` maps every id used so far to where it was used, so a clash names
    both places.
    """
    raw_name = source.get("name")
    if not isinstance(raw_name, str) or not raw_name:
        raise BuildError(f"a node under {path or 'the root'} has no name")
    here = f"{path} > {raw_name}" if path else raw_name
    coded = "label" in source

    if coded:
        # A coded node must have an info entry: that is where its topics are.
        if raw_name not in info:
            raise BuildError(f"{here}: has an MSC code but no entry in info.json")
        node_id, name = raw_name, source["label"]
    else:
        if raw_name in info:
            raise BuildError(f"{here}: has an info.json entry but no label in tree.json")
        node_id, name = slugify(raw_name), raw_name

    if node_id in seen:
        raise BuildError(f"duplicate id {node_id!r}: {here} and {seen[node_id]}")
    seen[node_id] = here

    node: dict = {"id": node_id, "name": name}
    if coded:
        node["code"] = raw_name
    # `rank` is copied as the source has it. The root and "Mechanics" have
    # none, and none is invented for them.
    if "rank" in source:
        node["rank"] = source["rank"]
    if source.get("aliases"):
        node["aliases"] = list(source["aliases"])
    if coded:
        entry = info[raw_name]
        node["items"] = list(entry.get("items", []))
        if entry.get("description"):
            node["description"] = entry["description"]
        if entry.get("url"):
            node["url"] = entry["url"]
        if entry.get("url_title"):
            node["urlTitle"] = entry["url_title"]

    children = source.get("children") or []
    if children:
        node["children"] = [build_node(child, info, seen, here) for child in children]
    elif not coded:
        raise BuildError(f"{here}: a leaf with no MSC code, so it would have no topics")
    return node


def count(node: dict) -> dict:
    """Totals for the header, which the tests and the app's About text use."""
    totals = {"nodes": 1, "leaves": 0, "topics": 0}
    children = node.get("children")
    if not children:
        totals["leaves"] = 1
        totals["topics"] = len(node.get("items", []))
        return totals
    for child in children:
        for key, value in count(child).items():
            totals[key] += value
    return totals


def build_map(tree: dict, info: dict, manifest: dict, source: dict) -> dict:
    """The whole output document. Pure: no files, no git."""
    seen: dict[str, str] = {}
    root = build_node(tree, info, seen)
    unused = sorted(set(info) - set(seen))
    if unused:
        raise BuildError(f"info.json entries with no node in tree.json: {', '.join(unused[:10])}")
    sources = manifest.get("sources")
    if not sources or not all(s.get("licence") for s in sources):
        raise BuildError("manifest.json must list its sources, each with a licence")
    return {
        "format": FORMAT,
        "id": "maths",
        "title": manifest.get("title", "Mathematics"),
        "totals": count(root),
        # Where the tree came from, and on what terms. MSC2020 is
        # CC BY-NC-SA 4.0: the attribution and non-commercial note must stay.
        "sources": sources,
        "builtFrom": source,
        "root": root,
    }


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def describe_source(source_dir: Path) -> dict:
    """Which TreeQuiz commit the files were read at, and their hashes."""

    def git(*args: str) -> str:
        done = subprocess.run(["git", "-C", str(source_dir), *args], capture_output=True, text=True)
        if done.returncode != 0:
            raise BuildError(f"git {' '.join(args)} failed in {source_dir}: {done.stderr.strip()}")
        return done.stdout.strip()

    described: dict = {
        "repo": SOURCE_REPO_URL,
        "path": "datasets/maths",
        "commit": git("rev-parse", "HEAD"),
        "files": {name: sha256(source_dir / name) for name in SOURCE_FILES},
    }
    # Uncommitted edits to the dataset would make the commit a lie.
    if git("status", "--porcelain", "--", "."):
        described["dirty"] = True
    return described


def serialise(document: dict) -> str:
    return json.dumps(document, ensure_ascii=False, indent=1) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE, help="TreeQuiz's datasets/maths folder")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--check", action="store_true", help="write nothing; fail if the output is out of date")
    args = parser.parse_args(argv)

    try:
        loaded = {name: json.loads((args.source / name).read_text(encoding="utf-8")) for name in SOURCE_FILES}
        document = build_map(loaded["tree.json"], loaded["info.json"], loaded["manifest.json"], describe_source(args.source))
    except (BuildError, OSError, json.JSONDecodeError) as error:
        print(f"build_maths_map: {error}", file=sys.stderr)
        return 1

    text = serialise(document)
    if args.check:
        current = args.output.read_text(encoding="utf-8") if args.output.exists() else None
        if current != text:
            print(f"build_maths_map: {args.output} is out of date", file=sys.stderr)
            return 1
        return 0
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(text, encoding="utf-8")
    totals = document["totals"]
    print(f"wrote {args.output}: {totals['nodes']} nodes, {totals['leaves']} leaves, {totals['topics']} topics")
    return 0


if __name__ == "__main__":
    sys.exit(main())
