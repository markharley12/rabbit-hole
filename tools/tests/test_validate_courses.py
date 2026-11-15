"""Tests for tools/validate_courses.py (needs sympy and jsonschema):

    env -u PYTHONPATH python3 -m unittest discover -s tools/tests -v
"""

import contextlib
import io
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import sympy as sp  # noqa: E402

import validate_courses as vc  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
COURSE = ROOT / "content" / "maths" / "courses" / "15Axx"


class Grammar(unittest.TestCase):
    """Keys mean the same as in src/lesson/expr.ts, and nothing is evaluated."""

    def test_keys(self):
        cases = {
            "-2": sp.Integer(-2),
            "5/2": sp.Rational(5, 2),
            "0.6": sp.Rational(3, 5),
            "−2": sp.Integer(-2),
            "sqrt(15)": sp.sqrt(15),
            "√15": sp.sqrt(15),
            "2sqrt(5)": 2 * sp.sqrt(5),
            "1/sqrt(5)": 1 / sp.sqrt(5),
            "-2^2": sp.Integer(-4),
            "2^-1": sp.Rational(1, 2),
            "(1+2)(3+4)": sp.Integer(21),
            "3²": sp.Integer(9),
        }
        for text, value in cases.items():
            with self.subTest(text=text):
                self.assertEqual(sp.simplify(vc.parse_key(text, []) - value), 0)

    def test_expression_keys(self):
        m = sp.Symbol("m")
        self.assertEqual(sp.expand(vc.parse_key("5m^2 - 12m + 9", ["m"]) - (5 * m**2 - 12 * m + 9)), 0)
        # As in the app: letters run together are a product, undeclared letters are refused.
        c = sp.Symbol("c")
        self.assertEqual(vc.parse_key("2cm", ["c", "m"]), 2 * c * m)
        with self.assertRaises(vc.ExprError):
            vc.parse_key("3 - 2c", ["m"])

    def test_refuses_anything_that_is_not_the_grammar(self):
        for text in ["__import__('os')", "A1.T", "lambda: 1", "x[0]", "1; 2", "open('f')", "2 3", "sqrt 5"]:
            with self.subTest(text=text), self.assertRaises(vc.ExprError):
                vc.parse_verify(text, [], {"A1": sp.eye(2)})

    def test_verify_functions(self):
        data = {"A2": vc.to_sympy([[1, 2], [1, 2], [1, 2]]), "b": vc.to_sympy([1, 2, 6])}
        self.assertEqual(list(vc.parse_verify("pinv(A2)*b", [], data)), [sp.Rational(3, 5), sp.Rational(6, 5)])
        self.assertEqual(list(vc.parse_verify("eigs(tr(A2)*A2)", [], data)), [15, 0])
        self.assertEqual(vc.parse_verify("sv(A2, 1)", [], data), sp.sqrt(15))
        self.assertEqual(list(vc.parse_verify("rsv(A2, 2)", [], data)), [2 / sp.sqrt(5), -1 / sp.sqrt(5)])
        self.assertEqual(vc.parse_verify("entry(tr(A2)*A2, 2, 2)", [], data), 12)
        self.assertEqual(vc.parse_verify("argmin(5*m^2 - 12*m + 9, m)", [], data), sp.Rational(6, 5))
        with self.assertRaises(vc.ExprError):
            vc.parse_verify("nullvec(tr(A2)*A2 - tr(A2)*A2)", [], data)


class Content(unittest.TestCase):
    """The validator against the real course, and against broken copies of it."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.content = self.tmp / "content"
        shutil.copytree(ROOT / "content", self.content)
        self.public = self.tmp / "public"
        (self.public / "content" / "maths").mkdir(parents=True)
        shutil.copyfile(ROOT / "public" / "content" / "maths" / "map.json", self.public / "content" / "maths" / "map.json")
        self.course = self.content / "maths" / "courses" / "15Axx"

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def edit(self, name, change):
        path = self.course / f"{name}.json"
        document = json.loads(path.read_text())
        change(document)
        path.write_text(json.dumps(document, ensure_ascii=False))

    def errors(self):
        report, _ = vc.validate(self.content, self.public, ROOT / "schema")
        return report.errors

    def assertFails(self, needle):
        errors = self.errors()
        self.assertTrue(any(needle in e for e in errors), f"no error containing {needle!r} in {errors}")

    def test_the_real_course_passes(self):
        self.assertEqual(self.errors(), [])

    def test_five_lessons_of_five_to_seven_steps(self):
        course = json.loads((COURSE / "course.json").read_text())
        self.assertEqual(course["nodeId"], "15Axx")
        self.assertEqual(len(course["lessons"]), 5)
        for entry in course["lessons"]:
            lesson = json.loads((COURSE / f"{entry['id']}.json").read_text())
            steps = [b for b in lesson["blocks"] if b["type"] == "step"]
            self.assertTrue(5 <= len(steps) <= 7, f"{entry['id']} has {len(steps)} steps")

    def test_his_open_task_has_the_checked_answer(self):
        # docs/seed-context.md section 3: c = 0.6, m = 1.2, ‖p‖² = 1.8 (numpy, 15 Nov 2026).
        lesson = json.loads((COURSE / "the-smallest-best-fit.json").read_text())
        keys = {b["id"]: [f["key"] for f in b["answer"]["fields"]] for b in lesson["blocks"] if b["type"] == "step"}
        self.assertEqual(keys["minimise"], ["6/5"])
        self.assertEqual(keys["find-c"], ["3/5"])
        self.assertEqual(keys["its-size"], ["9/5"])

    def test_a_wrong_key_is_caught(self):
        self.edit("the-smallest-best-fit", lambda d: d["blocks"][3]["answer"]["fields"][0].update(key="0.61"))
        self.assertFails("the key does not match verify: sympy gives 3/5")

    def test_a_key_right_only_up_to_sign_needs_accept_negated(self):
        def flip(d):
            d["blocks"][4]["answer"].pop("accept")
            d["blocks"][4]["answer"].pop("acceptNote")
            for f in d["blocks"][4]["answer"]["fields"]:
                f["key"] = f"-({f['key']})"

        self.edit("normal-equations-from-your-points", flip)
        self.assertFails("the key does not match verify")

    def test_an_unknown_widget_and_bad_params_are_caught(self):
        self.edit("dependent-columns", lambda d: d["blocks"][-1]["widget"].update(name="no-such-widget"))
        self.assertFails("no widget called 'no-such-widget'")

    def test_bad_widget_params_are_caught(self):
        self.edit("dependent-columns", lambda d: d["blocks"][-1]["widget"]["params"].update(mode="sideways"))
        self.assertFails("dependent-columns params")

    def test_the_node_must_exist_and_name_the_folder(self):
        self.edit("course", lambda d: d.update(nodeId="99Zxx"))
        self.assertFails("nodeId '99Zxx' is not a node")
        self.assertFails("the folder must be named after the node")

    def test_lessons_and_files_must_match(self):
        (self.course / "stray.json").write_text("{}")
        self.assertFails("stray.json: is not listed")
        (self.course / "dependent-columns.json").unlink()
        self.assertFails("has no file dependent-columns.json")

    def test_schema_errors_are_reported(self):
        self.edit("dependent-columns", lambda d: d["blocks"][0].pop("hints"))
        self.assertFails("'hints' is a required property")

    def test_a_hint_that_gives_the_answer_away(self):
        self.edit("the-smallest-best-fit", lambda d: d["blocks"][3]["hints"].__setitem__(0, "It comes to $0.6$."))
        self.assertFails("hint 1 gives away the key '0.6'")

    def test_a_known_slip_that_is_the_right_answer(self):
        self.edit(
            "normal-equations-from-your-points",
            lambda d: d["blocks"][3]["answer"]["slips"][0].update(when={"m": "2.5"}),
        )
        self.assertFails("slip 0 lists a right answer for m")

    def test_raw_html_and_broken_links(self):
        self.edit("dependent-columns", lambda d: d["blocks"][0].update(why="<b>bold</b> and $a < b$"))
        self.assertFails("raw HTML")
        self.edit("dependent-columns", lambda d: d["blocks"][0].update(why="See [this](lesson:nowhere)."))
        self.assertFails("link 'lesson:nowhere' does not resolve")

    def test_good_links_resolve(self):
        self.edit("dependent-columns", lambda d: d["blocks"][0].update(why="See [it](lesson:the-smallest-best-fit) on [the map](node:15Axx)."))
        self.assertEqual(self.errors(), [])

    def test_publish_only_when_valid(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = vc.main(["--publish", "--content", str(self.content), "--public", str(self.public)])
        self.assertEqual(code, 0)
        published = self.public / "content" / "maths" / "courses"
        index = json.loads((published / "index.json").read_text())
        self.assertEqual([c["nodeId"] for c in index["courses"]], ["15Axx"])
        self.assertTrue((published / "15Axx" / "the-smallest-best-fit.json").exists())

        shutil.rmtree(published)
        self.edit("the-smallest-best-fit", lambda d: d["blocks"][3]["answer"]["fields"][0].update(key="1"))
        with contextlib.redirect_stderr(io.StringIO()):
            code = vc.main(["--publish", "--content", str(self.content), "--public", str(self.public)])
        self.assertEqual(code, 1)
        self.assertFalse(published.exists())


if __name__ == "__main__":
    unittest.main()
