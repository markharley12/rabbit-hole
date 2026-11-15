"""Tests for tools/build_maths_map.py. Standard library only:

    env -u PYTHONPATH python3 -m unittest discover -s tools/tests -v
"""

import copy
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import build_maths_map as build  # noqa: E402

# A cut-down copy of the real shape: an uncoded root, branch and area, a coded
# subject with two coded sections, and a subject that is itself a leaf.
TREE = {
    "name": "Mathematics",
    "children": [
        {
            "name": "Algebra and number theory",
            "rank": "Branch",
            "children": [
                {
                    "name": "Rings, fields and algebras",
                    "rank": "Area",
                    "children": [
                        {
                            "name": "15-XX",
                            "label": "Linear and multilinear algebra; matrix theory",
                            "rank": "Subject",
                            "aliases": ["15"],
                            "children": [
                                {"name": "15Axx", "label": "Basic linear algebra", "rank": "Section", "aliases": ["15A"]},
                                {"name": "15Bxx", "label": "Special matrices", "rank": "Section", "aliases": ["15B"]},
                            ],
                        },
                        {"name": "08Axx", "label": "Algebraic structures", "rank": "Subject", "aliases": ["08", "08A"]},
                    ],
                }
            ],
        }
    ],
}
INFO = {
    "15-XX": {"description": "", "items": ["Basic linear algebra", "Special matrices"], "url": "https://zbmath.org/classification/?q=cc:15", "url_title": "MSC 15 on zbMATH Open"},
    "15Axx": {"description": "", "items": ["Vector spaces", "Eigenvalues, singular values, and eigenvectors", "Factorization of matrices"], "url": "https://zbmath.org/classification/?q=cc:15A", "url_title": "MSC 15A on zbMATH Open"},
    "15Bxx": {"description": "See also 05B20.", "items": ["Random matrices"], "url": "https://zbmath.org/classification/?q=cc:15B", "url_title": "MSC 15B on zbMATH Open"},
    "08Axx": {"description": "", "items": ["Relational systems", "Partial algebras"], "url": "https://zbmath.org/classification/?q=cc:08A", "url_title": "MSC 08A on zbMATH Open"},
}
MANIFEST = {
    "title": "Fields of mathematics",
    "sources": [{"name": "MSC2020", "url": "https://msc2020.org", "licence": "CC BY-NC-SA 4.0", "licence_url": "https://creativecommons.org/licenses/by-nc-sa/4.0/"}],
}
SOURCE = {"repo": build.SOURCE_REPO_URL, "path": "datasets/maths", "commit": "abc123", "files": {}}


def walk(node):
    yield node
    for child in node.get("children", []):
        yield from walk(child)


def built(tree=TREE, info=INFO, manifest=MANIFEST):
    return build.build_map(copy.deepcopy(tree), copy.deepcopy(info), copy.deepcopy(manifest), dict(SOURCE))


class BuildMap(unittest.TestCase):
    def test_coded_nodes_use_their_msc_code_as_id_and_their_label_as_name(self):
        nodes = {n["id"]: n for n in walk(built()["root"])}
        self.assertEqual(nodes["15Axx"]["name"], "Basic linear algebra")
        self.assertEqual(nodes["15Axx"]["code"], "15Axx")
        self.assertEqual(nodes["15Axx"]["rank"], "Section")
        self.assertEqual(nodes["08Axx"]["aliases"], ["08", "08A"])

    def test_uncoded_nodes_get_a_slug_id_and_no_code(self):
        nodes = {n["id"]: n for n in walk(built()["root"])}
        self.assertIn("mathematics", nodes)
        area = nodes["rings-fields-and-algebras"]
        self.assertEqual(area["name"], "Rings, fields and algebras")
        self.assertNotIn("code", area)
        self.assertNotIn("items", area)

    def test_a_node_with_no_rank_in_the_source_gets_none(self):
        self.assertNotIn("rank", built()["root"])

    def test_topics_link_and_description_come_from_info(self):
        nodes = {n["id"]: n for n in walk(built()["root"])}
        self.assertEqual(nodes["15Axx"]["items"], INFO["15Axx"]["items"])
        self.assertEqual(nodes["15Axx"]["url"], "https://zbmath.org/classification/?q=cc:15A")
        self.assertEqual(nodes["15Axx"]["urlTitle"], "MSC 15A on zbMATH Open")
        self.assertEqual(nodes["15Bxx"]["description"], "See also 05B20.")
        # An empty description is left out, not stored as "".
        self.assertNotIn("description", nodes["15Axx"])

    def test_totals_count_topics_under_leaves_only(self):
        # 15-XX's own items are its sections' names, not extra topics.
        self.assertEqual(built()["totals"], {"nodes": 7, "leaves": 3, "topics": 6})

    def test_source_and_licence_are_recorded(self):
        document = built()
        self.assertEqual(document["builtFrom"]["commit"], "abc123")
        self.assertEqual(document["sources"][0]["licence"], "CC BY-NC-SA 4.0")

    def test_a_source_without_a_licence_is_refused(self):
        manifest = {"sources": [{"name": "MSC2020"}]}
        with self.assertRaisesRegex(build.BuildError, "licence"):
            built(manifest=manifest)

    def test_duplicate_ids_are_refused(self):
        tree = copy.deepcopy(TREE)
        tree["children"].append({"name": "Mathematics", "rank": "Branch", "children": [{"name": "08Axx", "label": "x"}]})
        with self.assertRaisesRegex(build.BuildError, "duplicate id 'mathematics'"):
            built(tree=tree)

    def test_two_names_that_slug_the_same_are_refused(self):
        tree = copy.deepcopy(TREE)
        branch = tree["children"][0]
        branch["children"].append({"name": "Rings, Fields & Algebras", "rank": "Area", "children": [copy.deepcopy(branch["children"][0]["children"][1])]})
        with self.assertRaisesRegex(build.BuildError, "duplicate id"):
            built(tree=tree)

    def test_a_coded_node_missing_from_info_is_refused(self):
        info = {k: v for k, v in INFO.items() if k != "15Bxx"}
        with self.assertRaisesRegex(build.BuildError, "15Bxx: has an MSC code but no entry"):
            built(info=info)

    def test_an_info_entry_with_no_node_is_refused(self):
        info = dict(INFO, **{"99Zxx": {"description": "", "items": [], "url": ""}})
        with self.assertRaisesRegex(build.BuildError, "99Zxx"):
            built(info=info)

    def test_an_uncoded_leaf_is_refused(self):
        tree = copy.deepcopy(TREE)
        tree["children"].append({"name": "Empty branch", "rank": "Branch"})
        with self.assertRaisesRegex(build.BuildError, "Empty branch: a leaf with no MSC code"):
            built(tree=tree)

    def test_output_is_deterministic(self):
        self.assertEqual(build.serialise(built()), build.serialise(built()))

    def test_slugify(self):
        self.assertEqual(build.slugify("Rings, fields and algebras"), "rings-fields-and-algebras")
        self.assertEqual(build.slugify("K-theory"), "k-theory")
        with self.assertRaises(build.BuildError):
            build.slugify("—")


class CommittedMap(unittest.TestCase):
    """The map.json in the repo, as the app will load it."""

    @classmethod
    def setUpClass(cls):
        if not build.DEFAULT_OUTPUT.exists():
            raise unittest.SkipTest("map.json has not been built")
        cls.document = json.loads(build.DEFAULT_OUTPUT.read_text(encoding="utf-8"))
        cls.nodes = list(walk(cls.document["root"]))

    def test_totals_match_the_tree(self):
        self.assertEqual(self.document["totals"], build.count(self.document["root"]))
        # The real MSC2020 tree as TreeQuiz groups it.
        self.assertEqual(self.document["totals"], {"nodes": 593, "leaves": 517, "topics": 4810})

    def test_ids_are_unique(self):
        ids = [n["id"] for n in self.nodes]
        self.assertEqual(len(ids), len(set(ids)))

    def test_every_leaf_has_topics_and_a_link(self):
        for node in self.nodes:
            if "children" not in node:
                self.assertTrue(node["items"], node["id"])
                self.assertTrue(node["url"].startswith("https://zbmath.org/"), node["id"])

    def test_licence_and_source_commit_are_present(self):
        self.assertEqual(self.document["sources"][0]["licence"], "CC BY-NC-SA 4.0")
        self.assertRegex(self.document["builtFrom"]["commit"], r"^[0-9a-f]{40}$")
        self.assertNotIn("dirty", self.document["builtFrom"])

    def test_it_is_what_the_script_builds_from_treequiz_today(self):
        if not build.DEFAULT_SOURCE.exists():
            self.skipTest("TreeQuiz is not checked out here")
        self.assertEqual(build.main(["--check"]), 0)


if __name__ == "__main__":
    unittest.main()
