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
COURSE_ID = "least-squares-to-the-pseudo-inverse"
COURSE = ROOT / "content" / "maths" / "courses" / COURSE_ID


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
        self.course = self.content / "maths" / "courses" / COURSE_ID

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

    def test_the_node_must_exist(self):
        self.edit("course", lambda d: d.update(nodeId="99Zxx"))
        self.assertFails("nodeId '99Zxx' is not a node")

    def copy_course(self, new_id):
        target = self.course.parent / new_id
        shutil.copytree(self.course, target)
        document = json.loads((target / "course.json").read_text())
        document["id"] = new_id
        (target / "course.json").write_text(json.dumps(document, ensure_ascii=False))
        return target

    def test_two_courses_may_share_a_node(self):
        self.copy_course("a-second-course")
        self.assertEqual(self.errors(), [])
        _, found = vc.validate(self.content, self.public, ROOT / "schema")
        self.assertEqual([c["nodeId"] for _, c in found["maths"]], ["15Axx", "15Axx"])

    def test_the_folder_must_be_named_after_the_course_id(self):
        self.course.rename(self.course.parent / "15Axx")
        self.assertFails("the folder must be named after the course id")

    def test_course_ids_must_be_unique(self):
        target = self.copy_course("a-second-course")
        document = json.loads((target / "course.json").read_text())
        document["id"] = COURSE_ID
        (target / "course.json").write_text(json.dumps(document))
        self.assertFails(f"course id '{COURSE_ID}' is used twice")

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

    # ---- the cheat sheet (cheatsheet.json beside course.json)

    def sheet(self, change):
        path = self.course / "cheatsheet.json"
        document = json.loads(path.read_text())
        change(document)
        path.write_text(json.dumps(document, ensure_ascii=False))

    def first_item(self, **fields):
        return lambda d: d["sections"][0]["items"][0].update(fields)

    def test_the_real_cheat_sheet_is_in_range(self):
        sheet = json.loads((COURSE / "cheatsheet.json").read_text())
        items = [i for s in sheet["sections"] for i in s["items"]]
        self.assertTrue(3 <= len(sheet["sections"]) <= 5)
        self.assertTrue(10 <= len(items) <= 16, len(items))

    def test_a_course_without_a_cheat_sheet_is_fine(self):
        (self.course / "cheatsheet.json").unlink()
        self.assertEqual(self.errors(), [])

    def test_cheat_sheet_schema_errors_are_reported(self):
        self.sheet(lambda d: d["sections"][0]["items"][0].pop("formula"))
        self.assertFails("'formula' is a required property")
        self.sheet(self.first_item(formula="$x$", extra=1))
        self.assertFails("cheatsheet.json")
        self.sheet(self.first_item(name="N" * 51))
        self.assertFails("is too long")

    def test_cheat_sheet_limits(self):
        cases = [
            (lambda d: d.update(sections=[]), "is too short"),
            (lambda d: d.update(sections=d["sections"][:1] * 9), "is too long"),
            (lambda d: d["sections"][0].update(items=[]), "is too short"),
            (lambda d: d["sections"][0].update(items=d["sections"][0]["items"][:1] * 11), "is too long"),
            (self.first_item(when="w" * 201), "is too long"),
        ]
        for change, message in cases:
            with self.subTest(message=message):
                shutil.copyfile(COURSE / "cheatsheet.json", self.course / "cheatsheet.json")
                self.sheet(change)
                self.assertFails(message)

    def test_cheat_sheet_item_ids_must_be_unique(self):
        self.sheet(lambda d: d["sections"][1]["items"][0].update(id=d["sections"][0]["items"][0]["id"]))
        self.assertFails("item id repeats")

    def test_cheat_sheet_lesson_must_be_one_of_the_courses(self):
        self.sheet(self.first_item(lesson="no-such-lesson"))
        self.assertFails("lesson 'no-such-lesson' is not a lesson of this course")

    def test_cheat_sheet_markdown_is_checked_like_a_lesson(self):
        self.sheet(self.first_item(formula="<b>r</b>"))
        self.assertFails("raw HTML")
        self.sheet(self.first_item(formula="$r = b - Ax"))
        self.assertFails("an unmatched $")
        self.sheet(self.first_item(when="See [it](lesson:nowhere)."))
        self.assertFails("link 'lesson:nowhere' does not resolve")
        self.sheet(self.first_item(formula="$r$", when="See [it](lesson:dependent-columns)."))
        self.assertEqual(self.errors(), [])

    def test_a_broken_cheat_sheet_stops_publishing(self):
        self.sheet(self.first_item(lesson="no-such-lesson"))
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(vc.main(["--publish", "--content", str(self.content), "--public", str(self.public)]), 1)
        self.assertFalse((self.public / "content" / "maths" / "courses").exists())

    def test_publish_copies_the_cheat_sheet_and_flags_it_in_the_index(self):
        self.copy_course("a-second-course")
        (self.content / "maths" / "courses" / "a-second-course" / "cheatsheet.json").unlink()
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(vc.main(["--publish", "--content", str(self.content), "--public", str(self.public)]), 0)
        published = self.public / "content" / "maths" / "courses"
        self.assertEqual((published / COURSE_ID / "cheatsheet.json").read_bytes(), (self.course / "cheatsheet.json").read_bytes())
        self.assertFalse((published / "a-second-course" / "cheatsheet.json").exists())
        flags = {c["id"]: c.get("cheatsheet") for c in json.loads((published / "index.json").read_text())["courses"]}
        self.assertEqual(flags, {COURSE_ID: True, "a-second-course": None})
        # The flag belongs to the index only; course.json stays as written.
        self.assertNotIn("cheatsheet", json.loads((published / COURSE_ID / "course.json").read_text()))

    def test_publish_only_when_valid(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = vc.main(["--publish", "--content", str(self.content), "--public", str(self.public)])
        self.assertEqual(code, 0)
        published = self.public / "content" / "maths" / "courses"
        index = json.loads((published / "index.json").read_text())
        self.assertEqual([c["nodeId"] for c in index["courses"]], ["15Axx"])
        self.assertTrue((published / COURSE_ID / "the-smallest-best-fit.json").exists())

        shutil.rmtree(published)
        self.edit("the-smallest-best-fit", lambda d: d["blocks"][3]["answer"]["fields"][0].update(key="1"))
        with contextlib.redirect_stderr(io.StringIO()):
            code = vc.main(["--publish", "--content", str(self.content), "--public", str(self.public)])
        self.assertEqual(code, 1)
        self.assertFalse(published.exists())

    def test_publish_removes_courses_that_left_the_source(self):
        published = self.public / "content" / "maths" / "courses"
        (published / "15Axx").mkdir(parents=True)
        (published / "15Axx" / "old.json").write_text("{}")
        self.copy_course("a-second-course")
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(vc.main(["--publish", "--content", str(self.content), "--public", str(self.public)]), 0)
        self.assertFalse((published / "15Axx").exists())
        self.assertTrue((published / "a-second-course" / "course.json").exists())
        self.assertTrue((published / COURSE_ID / "course.json").exists())
        index = json.loads((published / "index.json").read_text())
        self.assertEqual(len(index["courses"]), 2)

    def test_publish_refuses_a_field_that_escapes_public(self):
        with self.assertRaises(ValueError):
            vc.publish({"../x": []}, self.public)


if __name__ == "__main__":
    unittest.main()
