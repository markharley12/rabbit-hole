"""Tests for the new-course talk and the build-course job in server/rabbit_server.py.

None of them runs the real `claude` or touches the network: the server is
pointed at fake_claude.py, and at a temporary copy of the repo's minimal
layout (content, schema, the validator, the map, the prompts), so the real
content/ is never written. The validator that runs is the real one.

    env -u PYTHONPATH python3 -m unittest discover -s server/tests
"""

import http.client
import json
import os
import shutil
import sys
import tempfile
import threading
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import rabbit_server as rs  # noqa: E402

rs.log = lambda message: None

FAKE = os.path.join(HERE, "fake_claude.py")
FIXTURE = os.path.join(HERE, "fixtures", "tiny-course")
REPO = rs.REPO


def make_root():
    """A temporary repo: just what a talk and a build need."""
    root = os.path.realpath(tempfile.mkdtemp())
    shutil.copytree(os.path.join(REPO, "schema"), os.path.join(root, "schema"))
    os.makedirs(os.path.join(root, "tools"))
    shutil.copy(os.path.join(REPO, "tools", "validate_courses.py"), os.path.join(root, "tools"))
    os.makedirs(os.path.join(root, "public", "content", "maths"))
    shutil.copy(os.path.join(REPO, "public", "content", "maths", "map.json"), os.path.join(root, "public", "content", "maths"))
    os.makedirs(os.path.join(root, "docs", "agents"))
    for name in ("new-course.md", "build-course.md", "ask.md"):
        shutil.copy(os.path.join(REPO, "docs", "agents", name), os.path.join(root, "docs", "agents"))
    shutil.copy(os.path.join(REPO, "docs", "course-authoring.md"), os.path.join(root, "docs"))
    existing = os.path.join(root, "content", "maths", "courses", "existing-course")
    os.makedirs(existing)
    for name in os.listdir(FIXTURE):
        with open(os.path.join(FIXTURE, name), encoding="utf-8") as fh:
            text = fh.read().replace('"tiny-course"', '"existing-course"')
        with open(os.path.join(existing, name), "w", encoding="utf-8") as fh:
            fh.write(text)
    os.makedirs(os.path.join(root, "content", "maths", "resources"))
    shutil.copy(os.path.join(REPO, "content", "maths", "resources", "62Hxx.json"),
                os.path.join(root, "content", "maths", "resources"))
    dist = os.path.join(root, "dist")
    os.makedirs(os.path.join(dist, "content", "maths", "courses"))
    with open(os.path.join(dist, "index.html"), "w") as fh:
        fh.write("<!doctype html><title>rabbit-hole</title>")
    with open(os.path.join(dist, "content", "maths", "courses", "index.json"), "w") as fh:
        fh.write('{"format": 1, "courses": []}')
    os.makedirs(os.path.join(root, "data"))
    return root


GOOD_BRIEF = """title: Eigenvalues of a 2x2 matrix
courseId: eigen-two
nodeId: 15Axx

## Who it is for
Mark, who can multiply matrices.

## Lessons
1. What an eigenvector does — a direction that only stretches.
2. The characteristic polynomial — det(A - λI) = 0.
3. Eigenvectors — solve (A - λI)v = 0.

## Worked examples
[[2, 1], [1, 2]]: eigenvalues 3 and 1.

## Widgets
- svd-geometry: the circle to an ellipse.

## Missing widgets
A matrix acting on a draggable vector.

## Sources
- https://en.wikipedia.org/wiki/Eigenvalues_and_eigenvectors — the 2x2 example.
- <https://example.org/notes>: the order of topics
"""


class Briefs(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = make_root()
        cls.library = rs.Library(cls.root)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.root)

    def test_a_good_brief(self):
        brief, problems = rs.check_brief(GOOD_BRIEF, self.library)
        self.assertEqual(problems, [])
        self.assertEqual(brief["courseId"], "eigen-two")
        self.assertEqual(brief["nodeName"], "Basic linear algebra")
        self.assertEqual([l["title"] for l in brief["lessons"]],
                         ["What an eigenvector does", "The characteristic polynomial", "Eigenvectors"])
        self.assertEqual(brief["lessons"][1]["summary"], "det(A - λI) = 0.")
        self.assertEqual(brief["widgets"], [{"name": "svd-geometry", "why": "the circle to an ellipse."}])
        self.assertEqual(brief["missingWidgets"], ["A matrix acting on a draggable vector."])
        self.assertEqual([s["url"] for s in brief["sources"]],
                         ["https://en.wikipedia.org/wiki/Eigenvalues_and_eigenvectors", "https://example.org/notes"])
        self.assertEqual(brief["sources"][1]["note"], "the order of topics")

    def test_problems_are_named(self):
        cases = [
            (GOOD_BRIEF.replace("courseId: eigen-two", "courseId: existing-course"), "is taken"),
            (GOOD_BRIEF.replace("courseId: eigen-two", "courseId: Eigen Two"), "not kebab-case"),
            (GOOD_BRIEF.replace("courseId: eigen-two", "courseId: ../../etc"), "not kebab-case"),
            (GOOD_BRIEF.replace("courseId: eigen-two\n", ""), "courseId: missing"),
            (GOOD_BRIEF.replace("nodeId: 15Axx", "nodeId: 99Zzz"), "not a node of the map"),
            (GOOD_BRIEF.replace("3. Eigenvectors — solve (A - λI)v = 0.\n", ""), "2 listed"),
            (GOOD_BRIEF.replace("svd-geometry", "eigen-dragger"), "'eigen-dragger' is not in schema/widgets.json"),
            (GOOD_BRIEF.split("## Sources")[0], "No sources"),
            (GOOD_BRIEF.replace("- <https://example.org/notes>: the order of topics", "- my memory"), "has no URL"),
            (GOOD_BRIEF.replace("## Worked examples\n[[2, 1], [1, 2]]: eigenvalues 3 and 1.\n", ""), "Worked examples"),
            (GOOD_BRIEF.replace("title: Eigenvalues of a 2x2 matrix", "title: x"), "title"),
            ("x" * (rs.MAX_BRIEF + 1), "longer than"),
        ]
        for text, words in cases:
            with self.subTest(words=words):
                _, problems = rs.check_brief(text, self.library)
                self.assertTrue(any(words in p for p in problems), problems)

    def test_a_running_builds_course_id_is_taken(self):
        _, problems = rs.check_brief(GOOD_BRIEF, self.library, taken={"eigen-two"})
        self.assertTrue(any("is taken" in p for p in problems))

    def test_rubbish_does_not_raise(self):
        for text in ["", "\n\n", "## Lessons\n- a", ":::\n##\n- ", "title:\n\n#", "\x00" * 10]:
            with self.subTest(text=text):
                brief, problems = rs.check_brief(text, self.library)
                self.assertTrue(problems)


class Grants(unittest.TestCase):
    """The write rules, without a server: every refusal class."""

    def setUp(self):
        self.root = make_root()
        self.brief = os.path.join(self.root, "data", "drafts", "0123456789abcdef", "brief.md")
        os.makedirs(os.path.dirname(self.brief))
        self.folder = os.path.join(self.root, "content", "maths", "courses", "new-one")
        self.reading = os.path.join(self.root, "content", "maths", "resources", "15Axx.json")
        self.brief_grant = {"files": [self.brief], "folders": []}
        self.course_grant = {"files": [self.reading], "folders": [self.folder]}

    def tearDown(self):
        shutil.rmtree(self.root)

    def decide(self, kind, tool, inp, grant):
        return rs.decide(kind, tool, inp, self.root, grant)[0]

    def test_the_brief_session_writes_exactly_its_brief(self):
        self.assertTrue(self.decide("new-course", "Write", {"file_path": self.brief}, self.brief_grant))
        self.assertTrue(self.decide("new-course", "Write", {"file_path": os.path.relpath(self.brief, self.root)},
                                    self.brief_grant))
        self.assertTrue(self.decide("new-course", "Read", {"file_path": self.brief}, self.brief_grant))
        for path in [self.brief + ".bak", os.path.join(os.path.dirname(self.brief), "draft.json"),
                     "data/drafts/fedcba9876543210/brief.md", "data/sessions/x.json", "content/maths/courses/x/course.json",
                     "schema/x.json", "tools/x.py", "src/x.ts", "server/x.py", "docs/x.md", ".git/config", ".claude/x",
                     "../x.md", "/tmp/x.md", "~/x.md", os.path.join(os.path.dirname(self.brief), "..", "fedcba9876543210",
                                                                     "brief.md"), "", None]:
            with self.subTest(path=path):
                self.assertFalse(self.decide("new-course", "Write", {"file_path": path}, self.brief_grant))
        # Reading its draft's other files, or other drafts, stays private.
        self.assertFalse(self.decide("new-course", "Read", {"file_path": os.path.join(os.path.dirname(self.brief), "draft.json")},
                                     self.brief_grant))
        # No grant, no write: the ask kind cannot write the same file.
        self.assertFalse(self.decide("ask", "Write", {"file_path": self.brief}, self.brief_grant))

    def test_a_symlinked_brief_is_refused(self):
        target = os.path.join(self.root, "docs", "agents", "ask.md")
        os.symlink(target, self.brief)
        self.assertFalse(self.decide("new-course", "Write", {"file_path": self.brief}, self.brief_grant))
        self.assertFalse(self.decide("new-course", "Read", {"file_path": self.brief}, self.brief_grant))

    def test_the_build_writes_only_course_files_in_its_folder(self):
        for name in ("course.json", "cheatsheet.json", "lesson-one.json"):
            with self.subTest(name=name):
                self.assertTrue(self.decide("build-course", "Write", {"file_path": os.path.join(self.folder, name)},
                                            self.course_grant))
                self.assertTrue(self.decide("build-course", "Edit", {"file_path": "content/maths/courses/new-one/" + name},
                                            self.course_grant))
        self.assertTrue(self.decide("build-course", "Write", {"file_path": self.reading}, self.course_grant))
        for path in [os.path.join(self.folder, "sub", "x.json"), os.path.join(self.folder, "notes.md"),
                     os.path.join(self.folder, "Course.JSON"), os.path.join(self.folder, ".hidden.json"),
                     self.folder, os.path.join(self.folder, "..", "existing-course", "course.json"),
                     "content/maths/courses/existing-course/course.json", "content/maths/resources/62Hxx.json",
                     "content/maths/map.json", "public/content/maths/map.json", "schema/widgets.json",
                     "tools/validate_courses.py", "data/builds/x.json", self.brief, "docs/course-authoring.md",
                     "/etc/x.json", "../new-one/course.json"]:
            with self.subTest(path=path):
                self.assertFalse(self.decide("build-course", "Write", {"file_path": path}, self.course_grant))
                self.assertFalse(self.decide("build-course", "Edit", {"file_path": path}, self.course_grant))

    def test_a_symlink_inside_the_folder_is_refused(self):
        os.makedirs(self.folder)
        os.symlink(os.path.join(self.root, "content", "maths", "courses", "existing-course", "course.json"),
                   os.path.join(self.folder, "lesson-two.json"))
        self.assertFalse(self.decide("build-course", "Write", {"file_path": os.path.join(self.folder, "lesson-two.json")},
                                     self.course_grant))

    def test_a_folder_that_is_a_link_is_refused(self):
        os.symlink(os.path.join(self.root, "content", "maths", "courses", "existing-course"), self.folder)
        self.assertFalse(self.decide("build-course", "Write", {"file_path": os.path.join(self.folder, "course.json")},
                                     {"files": [], "folders": [self.folder]}))

    def test_no_bash_and_no_notebooks(self):
        for kind in ("new-course", "build-course"):
            for tool, inp in [("Bash", {"command": "npm run validate"}), ("NotebookEdit", {"notebook_path": "x.ipynb"}),
                              ("Task", {}), ("mcp__x__y", {})]:
                with self.subTest(kind=kind, tool=tool):
                    self.assertFalse(self.decide(kind, tool, inp, self.course_grant))
        self.assertFalse(self.decide("new-course", "Edit", {"file_path": self.brief}, self.brief_grant))

    def test_web_only_for_the_two_new_kinds_and_only_public(self):
        self.assertFalse(self.decide("ask", "WebFetch", {"url": "https://example.org"}, None))
        self.assertFalse(self.decide("ask", "WebSearch", {"query": "x"}, None))
        for kind in ("new-course", "build-course"):
            self.assertTrue(self.decide(kind, "WebSearch", {"query": "eigenvalues"}, None))
            self.assertTrue(self.decide(kind, "WebFetch", {"url": "https://en.wikipedia.org/wiki/Eigenvalue"}, None))
        for url in ["http://127.0.0.1:8791/api/sessions", "http://localhost:5183/", "http://[::1]/", "http://10.0.0.5/",
                    "http://192.168.1.1/", "http://169.254.169.254/latest/", "http://pc.tail1234.ts.net/",
                    "http://printer.local/", "http://intranet/", "file:///etc/passwd", "ftp://example.org/",
                    "http://2130706433/", "http://0x7f.1/", "http://100.100.100.100/", "https:///x", "", None, 5]:
            with self.subTest(url=url):
                self.assertFalse(self.decide("build-course", "WebFetch", {"url": url}, None))

    def test_the_second_lock_spares_only_the_brief(self):
        os.makedirs(os.path.join(self.root, "data", "sessions"))
        os.makedirs(os.path.join(self.root, "data", "drafts", "fedcba9876543210"))
        open(os.path.join(os.path.dirname(self.brief), "draft.json"), "w").close()
        rules = rs.private_denies(self.root, self.brief_grant)
        data = os.path.join(self.root, "data")
        self.assertNotIn("Edit(/%s/**)" % data, rules)
        self.assertIn("Edit(/%s/sessions/**)" % data, rules)
        self.assertIn("Read(/%s/drafts/fedcba9876543210/**)" % data, rules)
        self.assertIn("Edit(/%s/draft.json)" % os.path.dirname(self.brief), rules)
        self.assertFalse(any(self.brief in r for r in rules))
        self.assertIn("Read(/%s/.git/**)" % self.root, rules)
        # Without a grant under data/, the whole folder is denied, as before.
        self.assertIn("Edit(/%s/**)" % data, rs.private_denies(self.root, self.course_grant))


class Live(unittest.TestCase):
    """The talk, the brief and the build, over HTTP."""

    def setUp(self):
        os.chmod(FAKE, 0o755)
        self.root = make_root()
        self.log = os.path.join(self.root, "fake.log")
        os.environ["FAKE_CLAUDE_LOG"] = self.log
        os.environ["FAKE_CLAUDE_MODE"] = "normal"
        self.server = self.start()

    def start(self):
        server = rs.Server(("127.0.0.1", 0), os.path.join(self.root, "dist"), FAKE, os.path.join(self.root, "data"),
                           repo=self.root)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        return server

    def tearDown(self):
        job = self.server.build
        if job:
            self.api("POST", "/api/build/stop", {"buildId": job["id"]})
            for _ in range(200):
                if self.server.build is None:
                    break
                time.sleep(0.05)
        self.server.shutdown()
        self.server.server_close()
        for name in ("FAKE_CLAUDE_MODE", "FAKE_CLAUDE_LOG", "FAKE_BRIEF_COURSE"):
            os.environ.pop(name, None)
        shutil.rmtree(self.root)

    def api(self, method, path, body=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.server.server_address[1], timeout=60)
        headers = {"Host": "127.0.0.1"}
        data = None
        if body is not None:
            data = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"
        conn.request(method, path, body=data, headers=headers)
        response = conn.getresponse()
        payload = response.read()
        conn.close()
        if response.getheader("Content-Type", "").startswith("text/event-stream"):
            return response.status, parse_sse(payload.decode())
        return response.status, json.loads(payload) if payload else None

    def runs(self):
        if not os.path.exists(self.log):
            return []
        with open(self.log) as fh:
            return [json.loads(line) for line in fh]

    def answers(self, run):
        return [m["response"]["response"]["behavior"] for m in run["stdin"] if m.get("type") == "control_response"
                and m["response"].get("request_id") != "init" and "response" in m["response"]]

    def talk(self, mode, text="I want to learn eigenvalues", sid=None, node="15Axx"):
        if sid is None:
            status, body = self.api("POST", "/api/session", {"kind": "new-course", "context": {"nodeId": node}})
            self.assertEqual(status, 200, body)
            sid, did = body["sessionId"], body["draftId"]
        else:
            did = None
        os.environ["FAKE_CLAUDE_MODE"] = mode
        status, events = self.api("POST", "/api/turn", {"sessionId": sid, "text": text})
        self.assertEqual(status, 200)
        return sid, did, events

    def wait_build(self, bid, until=rs.BUILD_STATES[4:]):
        for _ in range(600):
            status, build = self.api("GET", "/api/build?id=" + bid)
            if build["state"] in until:
                return build
            time.sleep(0.1)
        self.fail("the build did not finish: %s" % build)

    def brief_for_build(self, course="tiny-course"):
        os.environ["FAKE_BRIEF_COURSE"] = course
        sid, did, _ = self.talk("brief")
        return sid, did

    def content(self, *parts):
        return os.path.join(self.root, "content", "maths", *parts)

    # --- the talk -----------------------------------------------------------

    def test_state_lists_the_new_kinds(self):
        self.assertEqual(self.api("GET", "/api/state")[1]["kinds"], ["ask", "build-course", "new-course"])

    def test_session_refusals(self):
        self.assertEqual(self.api("POST", "/api/session", {"kind": "build-course", "context": {}})[0], 400)
        self.assertEqual(self.api("POST", "/api/session", {"kind": "new-course", "context": {"nodeId": "../x"}})[0], 400)
        self.assertEqual(self.api("POST", "/api/session", {"kind": "new-course", "context": []})[0], 400)
        # An unknown node is dropped, not refused: the whole map then.
        status, body = self.api("POST", "/api/session", {"kind": "new-course", "context": {"nodeId": "99Zzz"}})
        self.assertEqual(status, 200)
        self.assertIsNone(self.api("GET", "/api/draft?id=" + body["draftId"])[1]["brief"])
        status, body = self.api("POST", "/api/session", {"kind": "new-course"})
        self.assertEqual(status, 200)

    def test_talk_then_a_brief(self):
        sid, did, events = self.talk("brief")
        self.assertEqual(events[-1][0], "done")
        self.assertIn("read=allow write=allow", events[-1][1]["text"])
        run = self.runs()[0]
        argv = run["argv"]
        self.assertEqual(argv[argv.index("--tools") + 1], "Read,Grep,Glob,WebSearch,WebFetch,Write")
        self.assertEqual(argv[argv.index("--model") + 1], "sonnet")
        disallowed = argv[argv.index("--disallowedTools") + 1:argv.index("--strict-mcp-config")]
        self.assertIn("Bash", disallowed)
        self.assertIn("Edit", disallowed)
        self.assertNotIn("WebFetch", disallowed)
        prompt = argv[argv.index("--append-system-prompt") + 1]
        self.assertIn("Ask at most ONE question per reply", prompt)
        first = [m for m in run["stdin"] if m.get("type") == "user"][0]["message"]["content"]
        self.assertTrue(first.startswith("[app-context "))
        self.assertIn("from map node 15Axx (Basic linear algebra)", first)
        self.assertIn(os.path.join(self.root, "data", "drafts", did, "brief.md"), first)
        self.assertIn("- existing-course: A tiny test course, on 15Axx (Basic linear algebra); lessons: Adding two numbers", first)
        self.assertIn("- line-fitter: Fit y = c + mx", first)
        self.assertTrue(first.endswith("\n\nI want to learn eigenvalues"))

        status, draft = self.api("GET", "/api/draft?id=" + did)
        self.assertEqual(status, 200)
        self.assertEqual(draft["state"], "ready")
        self.assertEqual(draft["sessionId"], sid)
        self.assertEqual(draft["problems"], [])
        self.assertEqual(draft["brief"]["courseId"], "tiny-course")
        self.assertEqual(draft["brief"]["nodeName"], "Basic linear algebra")
        self.assertEqual(len(draft["brief"]["lessons"]), 3)
        self.assertEqual(draft["title"], "A tiny test course")
        drafts = self.api("GET", "/api/drafts")[1]["drafts"]
        self.assertEqual([d["id"] for d in drafts], [did])
        # The transcript works for this kind too.
        messages = self.api("GET", "/api/transcript?id=" + sid)[1]["messages"]
        self.assertEqual([m["role"] for m in messages], ["user", "assistant"])

    def test_a_draft_without_a_brief_is_titled_by_its_first_message(self):
        _, did, _ = self.talk("normal", text="  something   about  graphs  ")
        draft = self.api("GET", "/api/draft?id=" + did)[1]
        self.assertEqual((draft["state"], draft["title"], draft["brief"]), ("talking", "something about graphs", None))

    def test_brief_problems_are_shown_and_sent_back_once(self):
        sid, did, _ = self.talk("brief-taken")
        draft = self.api("GET", "/api/draft?id=" + did)[1]
        self.assertEqual(draft["state"], "problems")
        self.assertTrue(any("is taken" in p for p in draft["problems"]))
        self.assertTrue(any("not a node of the map" in p for p in draft["problems"]))
        self.assertEqual(self.api("POST", "/api/build", {"draftId": did})[0], 409)
        os.remove(self.log)
        self.talk("normal", "ok, fix it", sid=sid)
        second = [m for m in self.runs()[0]["stdin"] if m.get("type") == "user"][0]["message"]["content"]
        self.assertTrue(second.startswith("[app-update "))
        self.assertIn("is taken", second)
        self.assertTrue(second.endswith("\n\nok, fix it"))
        os.remove(self.log)
        self.talk("normal", "and now?", sid=sid)
        third = [m for m in self.runs()[0]["stdin"] if m.get("type") == "user"][0]["message"]["content"]
        self.assertEqual(third, "and now?")

    def test_the_talk_cannot_write_anywhere_else(self):
        _, did, events = self.talk("brief-escape")
        words = events[-1][1]["text"].split()[1:]
        # Eight writes, a local fetch, a public fetch, a search, an Edit of the brief, Bash.
        self.assertEqual(words, ["deny"] * 8 + ["deny", "allow", "allow", "deny", "deny"])
        for path in ["data/sessions/x.json", "docs/x.md", "schema/x.json", "data/drafts/0123456789abcdef/brief.md"]:
            self.assertFalse(os.path.exists(os.path.join(self.root, path)), path)
        self.assertFalse(os.path.exists(os.path.join(os.path.dirname(self.root), "outside.md")))
        with open(self.content("courses", "existing-course", "course.json")) as fh:
            self.assertEqual(json.load(fh)["id"], "existing-course")
        notes = [d["text"] for n, d in events if n == "note"]
        self.assertIn("Wanted to write data/sessions/x.json, not allowed", notes)
        self.assertIn("Opening en.wikipedia.org", notes)

    # --- the build ----------------------------------------------------------

    def test_a_build_that_passes(self):
        _, did = self.brief_for_build()
        os.remove(self.log)
        os.environ["FAKE_CLAUDE_MODE"] = "build"
        status, body = self.api("POST", "/api/build", {"draftId": did})
        self.assertEqual(status, 200, body)
        bid = body["buildId"]
        build = self.wait_build(bid)
        self.assertEqual(build["state"], "done", build)
        self.assertEqual(build["problems"], [])
        self.assertEqual(build["round"], 0)
        self.assertTrue(build["unread"])
        log = [line["text"] for line in build["log"]]
        self.assertEqual(log[0], "Writing the course")
        self.assertIn("Writing course.json", log)
        self.assertIn("Writing lesson 1 of 3", log)
        self.assertIn("Validating", log)
        self.assertIn("Publishing", log)
        self.assertEqual(log[-1], "Your course is ready")

        self.assertTrue(os.path.isfile(self.content("courses", "tiny-course", "course.json")))
        with open(os.path.join(self.root, "public", "content", "maths", "courses", "index.json")) as fh:
            self.assertEqual(sorted(c["id"] for c in json.load(fh)["courses"]), ["existing-course", "tiny-course"])
        with open(os.path.join(self.root, "dist", "content", "maths", "courses", "index.json")) as fh:
            self.assertIn("tiny-course", [c["id"] for c in json.load(fh)["courses"]])
        self.assertTrue(os.path.isfile(os.path.join(self.root, "dist", "content", "maths", "courses", "tiny-course",
                                                    "two-numbers.json")))
        self.assertEqual([n for n in os.listdir(os.path.join(self.root, "dist", "content", "maths")) if ".new-" in n or ".old-" in n], [])

        run = self.runs()[0]
        argv = run["argv"]
        self.assertEqual(argv[argv.index("--model") + 1], "opus")
        self.assertEqual(argv[argv.index("--tools") + 1], "Read,Grep,Glob,WebSearch,WebFetch,Write,Edit")
        self.assertNotIn("--resume", argv)
        prompt = argv[argv.index("--append-system-prompt") + 1]
        self.assertIn("Building a course from a brief", prompt)
        self.assertIn("# Writing a course", prompt)
        first = [m for m in run["stdin"] if m.get("type") == "user"][0]["message"]["content"]
        self.assertTrue(first.startswith("[app-brief "))
        self.assertIn("courseId: tiny-course", first)
        self.assertIn("you may also write %s" % self.content("resources", "15Axx.json"), first)

        self.assertEqual(self.api("GET", "/api/draft?id=" + did)[1]["state"], "built")
        builds = self.api("GET", "/api/builds")[1]["builds"]
        self.assertEqual([(b["id"], b["courseId"], b["unread"]) for b in builds], [(bid, "tiny-course", True)])
        self.assertEqual(self.api("POST", "/api/build/seen", {"buildId": bid}), (200, {"ok": True}))
        self.assertFalse(self.api("GET", "/api/builds")[1]["builds"][0]["unread"])
        # The course exists now: a second build of the same brief is refused.
        self.assertEqual(self.api("POST", "/api/build", {"draftId": did})[0], 409)

    def test_a_build_fixed_on_the_repair_turn(self):
        _, did = self.brief_for_build()
        os.remove(self.log)
        os.environ["FAKE_CLAUDE_MODE"] = "build-fix"
        bid = self.api("POST", "/api/build", {"draftId": did})[1]["buildId"]
        build = self.wait_build(bid)
        self.assertEqual(build["state"], "done", build)
        self.assertEqual(build["round"], 1)
        log = [line["text"] for line in build["log"]]
        self.assertTrue(any(line.startswith("Fixing 1 problem (round 1 of 3)") for line in log), log)
        self.assertIn("Fixing lesson 1 of 3", log)
        runs = self.runs()
        self.assertEqual(len(runs), 2)
        self.assertIn("--resume", runs[1]["argv"])
        repair = [m for m in runs[1]["stdin"] if m.get("type") == "user"][0]["message"]["content"]
        self.assertTrue(repair.startswith("[app-validator "))
        self.assertIn("two-numbers.json", repair)

    def test_a_build_that_never_passes_is_set_aside(self):
        _, did = self.brief_for_build()
        os.remove(self.log)
        os.environ["FAKE_CLAUDE_MODE"] = "build-invalid"
        bid = self.api("POST", "/api/build", {"draftId": did})[1]["buildId"]
        build = self.wait_build(bid)
        self.assertEqual(build["state"], "failed")
        self.assertEqual(build["round"], rs.BUILD_REPAIRS)
        self.assertEqual(len(self.runs()), rs.BUILD_REPAIRS + 1)
        self.assertTrue(build["problems"])
        self.assertTrue(all("tiny-course" in p for p in build["problems"]), build["problems"])
        self.assertFalse(os.path.exists(self.content("courses", "tiny-course")))
        self.assertTrue(os.path.isfile(os.path.join(self.root, "data", "drafts", did, "failed-course", "course.json")))
        self.assertFalse(os.path.exists(os.path.join(self.root, "public", "content", "maths", "courses")))
        self.assertEqual(self.api("GET", "/api/draft?id=" + did)[1]["state"], "failed")
        # Nothing invalid is left in content/: the validator passes again.
        self.assertEqual(rs.run_validator(self.server)[0], 0)
        # And the same brief may be built again.
        os.environ["FAKE_CLAUDE_MODE"] = "build"
        bid = self.api("POST", "/api/build", {"draftId": did})[1]["buildId"]
        self.assertEqual(self.wait_build(bid)["state"], "done")

    def test_a_build_cannot_write_outside_its_folder(self):
        _, did = self.brief_for_build()
        os.remove(self.log)
        os.environ["FAKE_CLAUDE_MODE"] = "build-escape"
        with open(self.content("courses", "existing-course", "course.json")) as fh:
            before = fh.read()
        bid = self.api("POST", "/api/build", {"draftId": did})[1]["buildId"]
        build = self.wait_build(bid)
        self.assertEqual(build["state"], "done", build)
        answers = self.answers(self.runs()[0])
        self.assertEqual(answers[:15], ["deny"] * 15)
        self.assertEqual(answers[15:], ["allow", "allow"])
        with open(self.content("courses", "existing-course", "course.json")) as fh:
            self.assertEqual(fh.read(), before)
        for path in ["schema/x.json", "tools/x.py", "src/x.ts", "docs/x.md", "server/x.py", ".claude/x.json", ".git/x",
                     "content/maths/courses/tiny-course/sub", "content/maths/courses/tiny-course/notes.md",
                     "content/maths/courses/other-course", "content/maths/courses/existing-course/x.json", "data/builds/x.json"]:
            self.assertFalse(os.path.exists(os.path.join(self.root, path)), path)
        self.assertFalse(os.path.exists("/tmp/rabbit-escape.json"))
        with open(self.content("resources", "62Hxx.json")) as fh:
            self.assertNotEqual(fh.read().strip(), "{}")
        self.assertTrue(any(line["text"].startswith("Wanted to write") for line in build["log"]))

    def test_a_course_that_exists_is_never_built_over(self):
        _, did = self.brief_for_build(course="tiny-course")
        folder = self.content("courses", "tiny-course")
        os.makedirs(folder)
        status, body = self.api("POST", "/api/build", {"draftId": did})
        self.assertEqual(status, 409)
        self.assertTrue(any("is taken" in p for p in body["problems"]))
        # Not a folder, but the name is in use all the same (a file or a link).
        os.rmdir(folder)
        open(folder, "w").close()
        status, body = self.api("POST", "/api/build", {"draftId": did})
        self.assertEqual(status, 409)
        self.assertIn("exists already", body["error"])
        self.assertIsNone(self.server.build)
        self.assertFalse(self.server.turn_lock.locked())

    def test_build_refusals(self):
        for did in ["../../etc", "g" * 16, "0123456789ABCDEF", 5, None]:
            with self.subTest(did=did):
                self.assertEqual(self.api("POST", "/api/build", {"draftId": did})[0], 400)
        self.assertEqual(self.api("POST", "/api/build", {"draftId": "0123456789abcdef"})[0], 404)
        for path in ["/api/build?id=../x", "/api/draft?id=../x", "/api/build?id=", "/api/draft?id=%2e%2e"]:
            self.assertEqual(self.api("GET", path)[0], 400)
        self.assertEqual(self.api("GET", "/api/build?id=0123456789abcdef")[0], 404)
        self.assertEqual(self.api("POST", "/api/build/stop", {"buildId": "../x"})[0], 400)
        self.assertEqual(self.api("POST", "/api/build/stop", {"buildId": "0123456789abcdef"}), (200, {"stopped": False}))
        self.assertEqual(self.api("POST", "/api/build/seen", {"buildId": "0123456789abcdef"})[0], 404)
        # A draft with no brief yet.
        _, did, _ = self.talk("normal")
        status, body = self.api("POST", "/api/build", {"draftId": did})
        self.assertEqual(status, 409)
        self.assertIn("no brief", body["error"])
        # A build session is not a chat.
        _, did = self.brief_for_build()
        os.environ["FAKE_CLAUDE_MODE"] = "build"
        bid = self.api("POST", "/api/build", {"draftId": did})[1]["buildId"]
        self.wait_build(bid)
        build_session = self.server.builds.load(bid)["sessionId"]
        self.assertEqual(self.api("POST", "/api/turn", {"sessionId": build_session, "text": "hi"})[0], 400)

    def test_one_thing_at_a_time_and_stop(self):
        sid, did = self.brief_for_build()
        _, other = self.brief_for_build(course="other-course")
        os.environ["FAKE_CLAUDE_MODE"] = "build-slow"
        bid = self.api("POST", "/api/build", {"draftId": did})[1]["buildId"]
        self.wait_build(bid, until=("running",))
        for _ in range(100):
            if os.path.exists(self.content("courses", "tiny-course", "course.json")):
                break
            time.sleep(0.05)
        status, body = self.api("POST", "/api/build", {"draftId": other})
        self.assertEqual((status, body["error"]), (409, "A course is already being built. One at a time."))
        status, body = self.api("POST", "/api/turn", {"sessionId": sid, "text": "hi"})
        self.assertEqual(status, 409)
        self.assertIn("being built", body["error"])
        self.assertTrue(self.api("GET", "/api/state")[1]["busy"])
        self.assertEqual(self.api("POST", "/api/build/stop", {"buildId": bid}), (200, {"stopped": True}))
        build = self.wait_build(bid)
        self.assertEqual(build["state"], "stopped")
        self.assertFalse(os.path.exists(self.content("courses", "tiny-course")))
        self.assertTrue(os.path.isfile(os.path.join(self.root, "data", "drafts", did, "failed-course", "course.json")))
        self.assertIsNone(self.server.build)

    def test_a_build_waits_for_a_chat_reply(self):
        sid, did = self.brief_for_build()
        os.environ["FAKE_CLAUDE_MODE"] = "slow"
        thread = threading.Thread(target=lambda: self.api("POST", "/api/turn", {"sessionId": sid, "text": "wait"}))
        thread.start()
        for _ in range(100):
            if self.server.current["proc"] is not None:
                break
            time.sleep(0.05)
        status, body = self.api("POST", "/api/build", {"draftId": did})
        self.assertEqual(status, 409)
        self.assertIn("chat reply", body["error"])
        self.api("POST", "/api/stop", {"sessionId": sid})
        thread.join(10)

    def test_problems_elsewhere_keep_the_course_but_publish_nothing(self):
        _, did = self.brief_for_build()
        broken = self.content("courses", "broken")
        os.makedirs(broken)
        with open(os.path.join(broken, "course.json"), "w") as fh:
            fh.write("{}")
        os.environ["FAKE_CLAUDE_MODE"] = "build"
        bid = self.api("POST", "/api/build", {"draftId": did})[1]["buildId"]
        build = self.wait_build(bid)
        self.assertEqual(build["state"], "failed")
        self.assertIn("elsewhere", build["problems"][0])
        self.assertTrue(any("broken" in p for p in build["problems"][1:]))
        self.assertTrue(os.path.isfile(self.content("courses", "tiny-course", "course.json")))

    def test_a_build_cut_off_by_a_restart_is_set_aside(self):
        _, did = self.brief_for_build()
        os.makedirs(self.content("courses", "tiny-course"))
        record = {"id": "00000000000000aa", "draftId": did, "sessionId": "S" * 22, "courseId": "tiny-course",
                  "nodeId": "15Axx", "state": "repairing", "log": [], "problems": [], "started": "x", "updated": "x"}
        self.server.builds.save(record)
        again = self.start()
        try:
            stored = again.builds.load("00000000000000aa")
            self.assertEqual(stored["state"], "failed")
            self.assertIn("server stopped", stored["problems"][0])
            self.assertFalse(os.path.exists(self.content("courses", "tiny-course")))
            self.assertTrue(os.path.isdir(os.path.join(self.root, "data", "drafts", did, "failed-course")))
        finally:
            again.shutdown()
            again.server_close()


def parse_sse(text):
    events = []
    for chunk in text.split("\n\n"):
        name, data = None, None
        for line in chunk.split("\n"):
            if line.startswith("event: "):
                name = line[7:]
            elif line.startswith("data: "):
                data = json.loads(line[6:])
        if name:
            events.append((name, data))
    return events


if __name__ == "__main__":
    unittest.main()
