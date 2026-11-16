"""Tests for tools/validate_courses.py (needs sympy and jsonschema):

    env -u PYTHONPATH python3 -m unittest discover -s tools/tests -v
"""

import contextlib
import datetime
import io
import json
import shutil
import socket
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import sympy as sp  # noqa: E402

import validate_courses as vc  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
COURSE_ID = "least-squares-to-the-pseudo-inverse"


def copy_fixture_content(target: Path) -> None:
    """The real content, cut to the first course and the 15Axx reading: these tests count what
    they publish, so later courses and reading files must not change the fixture."""
    shutil.copytree(ROOT / "content", target)
    for course in (target / "maths" / "courses").iterdir():
        if course.name != COURSE_ID:
            shutil.rmtree(course)
    for reading in (target / "maths" / "resources").glob("*.json"):
        if reading.name != "15Axx.json":
            reading.unlink()
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
        copy_fixture_content(self.content)
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
            answer = next(b for b in d["blocks"] if b["id"] == "best-fit-residual")["answer"]
            answer.pop("accept")
            answer.pop("acceptNote")
            for f in answer["fields"]:
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
            lambda d: next(b for b in d["blocks"] if b["id"] == "solve-normal-equations")["answer"]["slips"][0].update(when={"m": "2.5"}),
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

    # ---- tunnels between courses (course.json "tunnels")

    def tunnels(self, course_dir, *tunnels):
        path = course_dir / "course.json"
        document = json.loads(path.read_text())
        document["tunnels"] = [{"to": to, "kind": kind, "why": "It uses the same idea."} for to, kind in tunnels]
        path.write_text(json.dumps(document, ensure_ascii=False))

    def test_tunnels_between_real_courses_pass(self):
        second = self.copy_course("a-second-course")
        self.tunnels(second, (COURSE_ID, "needs"))
        self.tunnels(self.course, ("a-second-course", "related"))
        self.assertEqual(self.errors(), [])

    def test_a_tunnel_must_name_a_course_that_exists(self):
        self.tunnels(self.course, ("no-such-course", "needs"))
        self.assertFails("to 'no-such-course' is not a course in this field")

    def test_a_course_cannot_tunnel_to_itself(self):
        self.tunnels(self.course, (COURSE_ID, "related"))
        self.assertFails("cannot have a tunnel to itself")

    def test_a_tunnel_to_the_same_course_twice_is_caught(self):
        second = self.copy_course("a-second-course")
        self.tunnels(second, (COURSE_ID, "needs"), (COURSE_ID, "related"))
        self.assertFails(f"a second tunnel to '{COURSE_ID}'")

    def test_needs_tunnels_may_not_form_a_loop(self):
        second = self.copy_course("a-second-course")
        third = self.copy_course("a-third-course")
        self.tunnels(self.course, ("a-second-course", "needs"))
        self.tunnels(second, ("a-third-course", "needs"))
        self.assertEqual(self.errors(), [])
        self.tunnels(third, (COURSE_ID, "needs"))
        self.assertFails("the `needs` tunnels form a loop")
        # Two courses that need each other are the shortest loop.
        self.tunnels(third)
        self.tunnels(second, (COURSE_ID, "needs"))
        self.assertFails("the `needs` tunnels form a loop")

    def test_related_tunnels_may_point_both_ways(self):
        second = self.copy_course("a-second-course")
        self.tunnels(self.course, ("a-second-course", "related"))
        self.tunnels(second, (COURSE_ID, "related"))
        self.assertEqual(self.errors(), [])

    def test_at_most_five_tunnels_a_kind_and_a_short_reason(self):
        for name in ("c-one", "c-two", "c-three", "c-four", "c-five", "c-six"):
            self.copy_course(name)
        names = ("c-one", "c-two", "c-three", "c-four", "c-five", "c-six")
        self.tunnels(self.course, *[(n, "related") for n in names])
        self.assertFails("is too long")
        self.tunnels(self.course, *[(n, "related") for n in names[:5]])
        self.assertEqual(self.errors(), [])
        self.edit("course", lambda d: d["tunnels"][0].update(why="w" * 161))
        self.assertFails("is too long")
        self.edit("course", lambda d: d["tunnels"][0].update(why="Fine.", kind="after"))
        self.assertFails("course.json")

    def test_tunnels_are_published_in_the_index(self):
        second = self.copy_course("a-second-course")
        self.tunnels(second, (COURSE_ID, "needs"))
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(vc.main(["--publish", "--content", str(self.content), "--public", str(self.public)]), 0)
        index = json.loads((self.public / "content" / "maths" / "courses" / "index.json").read_text())
        entry = next(c for c in index["courses"] if c["id"] == "a-second-course")
        self.assertEqual(entry["tunnels"][0]["to"], COURSE_ID)

    def test_the_real_pca_course_needs_least_squares(self):
        pca = json.loads((ROOT / "content/maths/courses/principal-components-from-the-svd/course.json").read_text())
        self.assertEqual([(t["to"], t["kind"]) for t in pca["tunnels"]], [(COURSE_ID, "needs")])

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

    def test_cue_is_optional_limited_and_checked_like_other_markdown(self):
        self.sheet(self.first_item(cue="The residual of a fit, in terms of $A$, $x$ and $b$"))
        self.assertEqual(self.errors(), [])
        self.sheet(self.first_item(cue="c" * 161))
        self.assertFails("is too long")
        self.sheet(self.first_item(cue="The $r"))
        self.assertFails("an unmatched $")
        self.sheet(self.first_item(cue="<b>r</b> of a fit"))
        self.assertFails("raw HTML")

    def test_every_real_cheat_sheet_item_has_a_cue(self):
        for name in ("least-squares-to-the-pseudo-inverse", "principal-components-from-the-svd"):
            path = ROOT / "content/maths/courses" / name / "cheatsheet.json"
            for section in json.loads(path.read_text())["sections"]:
                for item in section["items"]:
                    self.assertIn("cue", item, f"{path.parent.name}/{item['id']}")

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

    # ---- steps marked for spaced review (`review: true`)

    def publish_index(self):
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(vc.main(["--publish", "--content", str(self.content), "--public", str(self.public)]), 0)
        published = self.public / "content" / "maths" / "courses"
        return {c["id"]: c for c in json.loads((published / "index.json").read_text())["courses"]}, published

    def test_the_real_course_marks_one_to_three_steps_per_lesson(self):
        index, _ = self.publish_index()
        marked = index[COURSE_ID]["review"]
        per_lesson = {}
        for entry in marked:
            per_lesson[entry["lesson"]] = per_lesson.get(entry["lesson"], 0) + 1
        self.assertEqual(set(per_lesson), {e["id"] for e in index[COURSE_ID]["lessons"]})
        self.assertTrue(all(1 <= n <= 3 for n in per_lesson.values()), per_lesson)

    def test_publish_lists_marked_steps_in_the_index_only(self):
        self.copy_course("a-second-course")
        # Unmark every step of the copy: its entry then has no `review` key at all.
        copy = self.content / "maths" / "courses" / "a-second-course"
        for path in copy.glob("*.json"):
            if path.stem in ("course", "cheatsheet"):
                continue
            document = json.loads(path.read_text())
            for block in document["blocks"]:
                block.pop("review", None)
            path.write_text(json.dumps(document, ensure_ascii=False))
        self.edit("dependent-columns", lambda d: d["blocks"][1].update(review=True))
        index, published = self.publish_index()
        marked = index[COURSE_ID]["review"]
        self.assertIn({"lesson": "dependent-columns", "step": "dependent-atb"}, marked)
        self.assertEqual(marked[0], {"lesson": "normal-equations-from-your-points", "step": "guess-y-equals-x"})
        self.assertNotIn("review", index["a-second-course"])
        # Lesson order is kept, and course.json stays as written.
        order = [e["id"] for e in index[COURSE_ID]["lessons"]]
        self.assertEqual([m["lesson"] for m in marked], sorted([m["lesson"] for m in marked], key=order.index))
        self.assertNotIn("review", json.loads((published / COURSE_ID / "course.json").read_text()))

    def test_review_must_be_a_boolean_on_a_step(self):
        self.edit("dependent-columns", lambda d: d["blocks"][0].update(review="yes"))
        self.assertFails("is not of type 'boolean'")
        self.edit("dependent-columns", lambda d: d["blocks"][0].update(review=True))
        self.assertEqual(self.errors(), [])

    def test_a_text_screen_cannot_be_marked_for_review(self):
        self.edit("dependent-columns", lambda d: next(b for b in d["blocks"] if b["type"] == "text").update(review=True))
        self.assertFails("dependent-columns.json")

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


class Quizzes(unittest.TestCase):
    """Choice and order screens: the schema, the rules the schema cannot say, and the index."""

    LESSON = "dependent-columns"

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.content = self.tmp / "content"
        copy_fixture_content(self.content)
        self.public = self.tmp / "public"
        (self.public / "content" / "maths").mkdir(parents=True)
        shutil.copyfile(ROOT / "public" / "content" / "maths" / "map.json", self.public / "content" / "maths" / "map.json")
        self.course = self.content / "maths" / "courses" / COURSE_ID

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def with_blocks(self, *extra, keep_quizzes=False):
        """The lesson's steps (and text), without any quiz it has, plus `extra`."""
        path = self.course / f"{self.LESSON}.json"
        document = json.loads(path.read_text())
        document["blocks"] = [b for b in document["blocks"] if keep_quizzes or b["type"] in ("step", "text")] + list(extra)
        path.write_text(json.dumps(document, ensure_ascii=False))

    def errors(self):
        report, _ = vc.validate(self.content, self.public, ROOT / "schema")
        return report.errors

    def assertFails(self, needle):
        errors = self.errors()
        self.assertTrue(any(needle in e for e in errors), f"no error containing {needle!r} in {errors}")

    @staticmethod
    def choice(**change):
        block = {
            "type": "choice",
            "id": "which-is-symmetric",
            "prompt": "Which of these could be $A^\\mathsf{T}A$?",
            "options": [
                {"id": "a", "text": "$\\begin{bmatrix}5&2\\\\2&1\\end{bmatrix}$", "correct": True, "say": "Symmetric, with non-negative diagonal."},
                {"id": "b", "text": "$\\begin{bmatrix}3&6\\\\1&14\\end{bmatrix}$", "correct": False, "say": "6 and 1 are the same dot product."},
                {"id": "c", "text": "$\\begin{bmatrix}3&6\\\\6&-14\\end{bmatrix}$", "correct": False, "say": "A column dotted with itself is not negative."},
            ],
            "next": "Carry on",
        }
        block.update(change)
        return block

    @staticmethod
    def order(**change):
        block = {
            "type": "order",
            "id": "put-in-order",
            "prompt": "Put the lines of the argument in order.",
            "items": [{"id": f"s{i}", "text": f"Line number {i}"} for i in range(1, 6)],
            "next": "Carry on",
        }
        block.update(change)
        return block

    def test_a_good_choice_and_a_good_order_pass(self):
        self.with_blocks(self.choice(), self.order(fixed=["s1"], say={"s3": "Which line needs an earlier one?"}))
        self.assertEqual(self.errors(), [])

    def test_a_single_answer_choice_has_exactly_one_correct_option(self):
        none = self.choice()
        for option in none["options"]:
            option["correct"] = False
        self.with_blocks(none)
        self.assertFails("exactly one correct option (has 0)")
        two = self.choice()
        two["options"][1]["correct"] = True
        self.with_blocks(two)
        self.assertFails("exactly one correct option (has 2)")

    def test_a_multiple_choice_needs_at_least_one_correct_and_one_wrong(self):
        two = self.choice(multiple=True)
        two["options"][1]["correct"] = True
        self.with_blocks(two)
        self.assertEqual(self.errors(), [])
        none = self.choice(multiple=True)
        for option in none["options"]:
            option["correct"] = False
        self.with_blocks(none)
        self.assertFails("at least one correct option")
        every = self.choice(multiple=True)
        for option in every["options"]:
            option["correct"] = True
        self.with_blocks(every)
        self.assertFails("at least one option must be incorrect")

    def test_option_texts_and_ids_are_distinct(self):
        same = self.choice()
        same["options"][2]["text"] = same["options"][1]["text"]
        self.with_blocks(same)
        self.assertFails("two options have the same text")
        repeated = self.choice()
        repeated["options"][2]["id"] = "b"
        self.with_blocks(repeated)
        self.assertFails("option ids repeat")

    def test_every_option_needs_a_reason(self):
        block = self.choice()
        del block["options"][1]["say"]
        self.with_blocks(block)
        self.assertFails("'say' is a required property")

    def test_two_to_five_options_and_no_stray_keys(self):
        block = self.choice()
        block["options"] = block["options"][:1]
        self.with_blocks(block)
        self.assertFails("options")
        many = self.choice()
        many["options"] += [{"id": f"x{i}", "text": f"Extra {i}", "correct": False, "say": "No."} for i in range(3)]
        self.with_blocks(many)
        self.assertFails("is too long")
        self.with_blocks(self.choice(answer="a"))
        self.assertFails("Additional properties")

    def test_order_fixed_and_say_name_real_lines(self):
        self.with_blocks(self.order(fixed=["s9"]))
        self.assertFails("fixed names 's9'")
        self.with_blocks(self.order(say={"s9": "x"}))
        self.assertFails("say names 's9'")
        self.with_blocks(self.order(fixed=["s1"], say={"s1": "x"}))
        self.assertFails("which is fixed")

    def test_order_needs_three_movable_lines(self):
        items = [{"id": f"s{i}", "text": f"Line number {i}"} for i in range(1, 5)]
        self.with_blocks(self.order(items=items, fixed=["s1", "s4"]))
        self.assertFails("at least three lines must be movable")
        self.with_blocks(self.order(items=items, fixed=["s1"]))
        self.assertEqual(self.errors(), [])

    def test_order_has_three_to_seven_lines_with_distinct_texts(self):
        self.with_blocks(self.order(items=[{"id": "s1", "text": "One"}, {"id": "s2", "text": "Two"}]))
        self.assertFails("items")
        same = self.order()
        same["items"][1]["text"] = same["items"][0]["text"]
        self.with_blocks(same)
        self.assertFails("two lines have the same text")

    def test_a_lesson_needs_a_step(self):
        path = self.course / f"{self.LESSON}.json"
        document = json.loads(path.read_text())
        document["blocks"] = [self.choice(), self.order()]
        path.write_text(json.dumps(document, ensure_ascii=False))
        self.assertFails("needs at least one step")

    def test_half_is_allowed_and_more_is_not(self):
        path = self.course / f"{self.LESSON}.json"
        original = json.loads(path.read_text())
        step = next(b for b in original["blocks"] if b["type"] == "step")
        document = dict(original, blocks=[step, self.choice()])
        path.write_text(json.dumps(document, ensure_ascii=False))
        self.assertEqual(self.errors(), [])
        document["blocks"] = [step, self.choice(), self.order()]
        path.write_text(json.dumps(document, ensure_ascii=False))
        self.assertFails("at most half the screens may be choice or order (2 of 3)")

    def test_block_ids_stay_unique_across_types(self):
        step_id = "dependent-ata"
        self.with_blocks(self.choice(id=step_id))
        self.assertFails("block id repeats")

    def test_markdown_in_every_string_is_checked(self):
        bad_say = self.choice()
        bad_say["options"][1]["say"] = "Try <b>this</b>"
        self.with_blocks(bad_say)
        self.assertFails("options/1/say: raw HTML is not allowed")
        bad_text = self.choice()
        bad_text["options"][0]["text"] = "Costs $5"
        self.with_blocks(bad_text)
        self.assertFails("options/0/text: an unmatched $")
        self.with_blocks(self.order(hint="See [it](lesson:nowhere)"))
        self.assertFails("hint: link 'lesson:nowhere' does not resolve")
        self.with_blocks(self.order(say={"s2": "Try <i>again</i>"}))
        self.assertFails("say/s2: raw HTML is not allowed")
        bad_item = self.order()
        bad_item["items"][3]["text"] = "Costs $5"
        self.with_blocks(bad_item)
        self.assertFails("items/3/text: an unmatched $")

    def test_widgets_on_a_choice_are_checked_like_a_steps(self):
        self.with_blocks(self.choice(widget={"name": "no-such-widget"}))
        self.assertFails("no widget called 'no-such-widget'")

    def test_publish_lists_marked_choice_and_order_blocks_in_the_review_index(self):
        self.with_blocks(self.choice(review=True), self.order(review=True), self.order(id="not-marked"))
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(vc.main(["--publish", "--content", str(self.content), "--public", str(self.public)]), 0)
        index = json.loads((self.public / "content" / "maths" / "courses" / "index.json").read_text())
        marked = next(c for c in index["courses"] if c["id"] == COURSE_ID)["review"]
        ours = [m["step"] for m in marked if m["lesson"] == self.LESSON]
        # The lesson's own marked steps first, then the quizzes in lesson order; the unmarked one is absent.
        self.assertEqual(ours[-2:], ["which-is-symmetric", "put-in-order"])
        self.assertNotIn("not-marked", ours)

    def test_review_must_be_a_boolean_on_a_quiz(self):
        self.with_blocks(self.choice(review="yes"))
        self.assertFails("is not of type 'boolean'")


class Reading(unittest.TestCase):
    """content/<field>/resources/<node-id>.json: reading links attached to a map node."""

    TODAY = datetime.date(2026, 11, 15)

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp)
        self.content = self.tmp / "content"
        copy_fixture_content(self.content)
        self.public = self.tmp / "public"
        (self.public / "content" / "maths").mkdir(parents=True)
        shutil.copyfile(ROOT / "public" / "content" / "maths" / "map.json", self.public / "content" / "maths" / "map.json")
        self.dir = self.content / "maths" / "resources"
        self.file = self.dir / "15Axx.json"

    def edit(self, change, path=None):
        path = path or self.file
        document = json.loads(path.read_text())
        change(document)
        path.write_text(json.dumps(document, ensure_ascii=False))

    def errors(self):
        report = vc.Report()
        vc.validate_resources(self.content, self.public, ROOT / "schema", report, today=self.TODAY)
        return report.errors

    def assertFails(self, needle):
        errors = self.errors()
        self.assertTrue(any(needle in e for e in errors), f"no error containing {needle!r} in {errors}")

    def first(self, **fields):
        return lambda d: d["resources"][0].update(fields)

    def publish(self):
        with contextlib.redirect_stdout(io.StringIO()):
            return vc.main(["--publish", "--content", str(self.content), "--public", str(self.public)])

    def test_the_real_file_passes_and_keeps_its_fourteen(self):
        self.assertEqual(self.errors(), [])
        document = json.loads(self.file.read_text())
        self.assertEqual(document["nodeId"], "15Axx")
        self.assertEqual(len(document["resources"]), 14)
        self.assertTrue(all(r["url"].startswith("https://") for r in document["resources"]))

    def test_no_resources_folder_is_fine(self):
        shutil.rmtree(self.dir)
        self.assertEqual(self.errors(), [])

    def test_schema_errors_are_reported(self):
        self.edit(lambda d: d["resources"][0].pop("use"))
        self.assertFails("'use' is a required property")
        self.edit(self.first(kind="podcast"))
        self.assertFails("is not one of")
        self.edit(self.first(extra=1))
        self.assertFails("15Axx.json")

    def test_the_file_is_named_after_its_node(self):
        self.file.rename(self.dir / "15Bxx.json")
        self.assertFails("the file must be named after nodeId (15Axx.json)")

    def test_the_node_must_be_in_the_map(self):
        self.edit(lambda d: d.update(nodeId="99Zxx"))
        self.assertFails("nodeId '99Zxx' is not a node")

    def test_ids_must_be_unique(self):
        self.edit(lambda d: d["resources"][1].update(id=d["resources"][0]["id"]))
        self.assertFails("resource id repeats")

    def test_urls_must_be_https(self):
        for bad in ["http://example.org/x", "ftp://example.org/x", "javascript:alert(1)", "https://", "https:// spaced.example", "//example.org/x", "example.org"]:
            with self.subTest(url=bad):
                shutil.copyfile(ROOT / "content" / "maths" / "resources" / "15Axx.json", self.file)
                self.edit(self.first(url=bad))
                self.assertFails("15Axx.json")

    def test_checked_must_be_a_real_date_not_in_the_future(self):
        self.edit(self.first(checked="2026-02-30"))
        self.assertFails("is not a real date")
        self.edit(self.first(checked="15 Nov 2026"))
        self.assertFails("15Axx.json")
        self.edit(self.first(checked="2026-11-16"))
        self.assertFails("is in the future")
        self.edit(self.first(checked="2026-11-15"))
        self.assertEqual(self.errors(), [])

    def test_one_to_thirty_resources(self):
        self.edit(lambda d: d.update(resources=[]))
        self.assertFails("is too short")
        one = json.loads((ROOT / "content" / "maths" / "resources" / "15Axx.json").read_text())["resources"][0]
        self.edit(lambda d: d.update(resources=[{**one, "id": f"r-{i}"} for i in range(31)]))
        self.assertFails("is too long")
        self.edit(lambda d: d.update(resources=[{**one, "id": f"r-{i}"} for i in range(30)]))
        self.assertEqual(self.errors(), [])

    def test_text_limits_and_topics(self):
        self.edit(self.first(about="a" * 301))
        self.assertFails("is too long")
        self.edit(self.first(about="Fine.", use="u" * 301))
        self.assertFails("is too long")
        self.edit(self.first(use="Fine, fine.", topics=["a topic"] * 2))
        self.assertFails("non-unique")
        self.edit(self.first(topics=["t1", "t2", "t3", "t4", "t5", "t6", "t7"]))
        self.assertFails("is too long")
        self.edit(self.first(topics=[]))
        self.assertFails("is too short")

    def test_it_never_goes_to_the_network(self):
        def refuse(*args, **kwargs):
            raise AssertionError("the validator opened a connection")

        with mock.patch.object(socket.socket, "connect", refuse), mock.patch.object(socket, "create_connection", refuse), mock.patch.object(socket, "getaddrinfo", refuse):
            self.assertEqual(self.errors(), [])
            self.assertEqual(self.publish(), 0)

    def test_publish_copies_the_files_and_counts_them(self):
        self.assertEqual(self.publish(), 0)
        published = self.public / "content" / "maths" / "resources"
        self.assertEqual((published / "15Axx.json").read_bytes(), self.file.read_bytes())
        self.assertEqual(json.loads((published / "index.json").read_text()), {"format": 1, "nodes": {"15Axx": 14}})

    def test_publish_removes_a_resources_file_that_left_the_source(self):
        published = self.public / "content" / "maths" / "resources"
        published.mkdir(parents=True)
        (published / "old-node.json").write_text("{}")
        self.assertEqual(self.publish(), 0)
        self.assertFalse((published / "old-node.json").exists())
        self.assertTrue((published / "15Axx.json").exists())
        # With no source at all the index is empty, not left over.
        shutil.rmtree(self.dir)
        self.assertEqual(self.publish(), 0)
        self.assertEqual(json.loads((published / "index.json").read_text()), {"format": 1, "nodes": {}})
        self.assertFalse((published / "15Axx.json").exists())

    def test_nothing_is_published_when_a_reading_file_is_wrong(self):
        self.edit(self.first(url="http://example.org"))
        with contextlib.redirect_stderr(io.StringIO()):
            code = vc.main(["--publish", "--content", str(self.content), "--public", str(self.public)])
        self.assertEqual(code, 1)
        self.assertFalse((self.public / "content" / "maths" / "courses").exists())
        self.assertFalse((self.public / "content" / "maths" / "resources").exists())

    def test_publish_refuses_a_field_that_escapes_public(self):
        with self.assertRaises(ValueError):
            vc.publish_resources({}, self.public, ["../x"])


if __name__ == "__main__":
    unittest.main()
