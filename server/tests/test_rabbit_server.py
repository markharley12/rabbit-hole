"""Tests for server/rabbit_server.py. None of them runs the real `claude`:
the server is pointed at fake_claude.py, which prints canned stream-json.

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

# The server's request and permission log lines, which would bury the test output.
rs.log = lambda message: None

FAKE = os.path.join(HERE, "fake_claude.py")
REPO = rs.REPO
COURSE = "least-squares-to-the-pseudo-inverse"
LESSON = "the-smallest-best-fit"

STEP = {
    "type": "step", "id": "expand-the-norm", "title": "One variable",
    "why": "With $c$ replaced, $c^2 + m^2$ becomes a parabola in $m$.",
    "prompt": "Put $c = 3 - 2m$ into $c^2 + m^2$ and expand.",
    "answer": {"fields": [{"name": "f", "label": "$c^2 + m^2$ =", "key": "5m^2 - 12m + 9"}], "vars": ["m"],
               "verify": "expand(solvefor(c + 2*m - 3, c)^2 + m^2)"},
    "hints": ["a", "b", "c"], "next": "Find the smallest value",
}


def context(**changes):
    ctx = {"courseId": COURSE, "courseTitle": "Least squares to the pseudo-inverse", "nodeId": "15Axx",
           "nodeName": "Basic linear algebra", "lessonId": LESSON, "lessonTitle": "The smallest best fit",
           "lessonIndex": 2, "lessonCount": 5, "screenIndex": 1, "screenCount": 7, "block": STEP,
           "record": {"attempts": 1, "hints": 1, "solved": False, "revealed": False,
                      "log": [{"at": "2026-11-15T10:00:00Z", "values": {"f": "5m^2 + 9"}, "result": "wrong",
                               "slip": "known"}]},
           "draft": {"f": "5m^2 - 6m"}, "canReveal": False}
    ctx.update(changes)
    return ctx


# --------------------------------------------------------------------------
# pure functions
# --------------------------------------------------------------------------

class RefusedCommands(unittest.TestCase):
    def test_refused_in_every_form(self):
        for command in ["sudo ls", "ls && sudo rm x", "cd /tmp; sudo -i", "git push", "git push origin main",
                        "git -C /some/dir push", "git --no-pager push", "git -c x=y push", "rm -r build",
                        "rm -fr build", "rm -rf build", "rm -R build", "rm --recursive build", "/bin/rm -rf x",
                        "bash -c \"sudo reboot\"", "echo $(sudo id)", "ls | xargs rm -r"]:
            with self.subTest(command=command):
                self.assertTrue(rs.refused_command(command))

    def test_ordinary_commands_are_not_refused_by_this_rule(self):
        for command in ["ls -la", "git status", "rm notes.txt", "npm run validate", "git log -1"]:
            with self.subTest(command=command):
                self.assertFalse(rs.refused_command(command))

    def test_refused_even_where_bash_would_be_allowed(self):
        rs.KINDS["test-bash"] = {"prompt": "docs/agents/ask.md", "tools": ["Bash"], "write": [], "model": "sonnet",
                                 "effort": "low", "timeout": 5}
        try:
            self.assertEqual(rs.decide("test-bash", "Bash", {"command": "ls"}, REPO), (True, None))
            for command in ["sudo ls", "git -C x push", "rm -fr x"]:
                allow, message = rs.decide("test-bash", "Bash", {"command": command}, REPO)
                self.assertFalse(allow)
                self.assertIn("sudo, git push and recursive rm", message)
        finally:
            del rs.KINDS["test-bash"]


class ChildEnvironment(unittest.TestCase):
    def test_a_host_sessions_variables_are_dropped(self):
        env = rs.child_env({"PATH": "/bin", "HOME": "/h", "CLAUDECODE": "1", "CLAUDE_CODE_ENTRYPOINT": "x",
                            "CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH": "1", "ANTHROPIC_BASE_URL": "http://x",
                            "CLAUDE_CODE_OAUTH_TOKEN": "t", "FAKE_CLAUDE_MODE": "slow"})
        self.assertEqual(env, {"PATH": "/bin", "HOME": "/h", "CLAUDE_CODE_OAUTH_TOKEN": "t", "FAKE_CLAUDE_MODE": "slow"})

    def test_a_clean_environment_is_left_alone(self):
        env = {"PATH": "/bin", "ANTHROPIC_BASE_URL": "http://x", "CLAUDE_CODE_USE_BEDROCK": "1"}
        self.assertEqual(rs.child_env(env), env)


class Decisions(unittest.TestCase):
    def setUp(self):
        self.repo = os.path.realpath(tempfile.mkdtemp())
        self.outside = os.path.realpath(tempfile.mkdtemp())
        for folder in ("content/maths/courses/c", "docs", "data/sessions", ".git", "node_modules/x", "Credentials"):
            os.makedirs(os.path.join(self.repo, folder))
        for name in ("content/maths/courses/c/l.json", "docs/a.md", ".env", "content/.env.local"):
            open(os.path.join(self.repo, name), "w").close()
        open(os.path.join(self.outside, "secret.txt"), "w").close()
        os.symlink(self.outside, os.path.join(self.repo, "content", "escape"))
        os.symlink(os.path.join(self.repo, "data"), os.path.join(self.repo, "docs", "into-data"))

    def tearDown(self):
        shutil.rmtree(self.repo)
        shutil.rmtree(self.outside)

    def allowed(self, tool, inp):
        return rs.decide("ask", tool, inp, self.repo)[0]

    def test_allows_reads_and_searches_inside_the_repo(self):
        self.assertTrue(self.allowed("Read", {"file_path": "content/maths/courses/c/l.json"}))
        self.assertTrue(self.allowed("Read", {"file_path": os.path.join(self.repo, "docs/a.md")}))
        self.assertTrue(self.allowed("Grep", {"pattern": "x", "path": "content"}))
        self.assertTrue(self.allowed("Glob", {"pattern": "content/**/*.json"}))
        self.assertTrue(self.allowed("Glob", {"pattern": "*.json", "path": "content/maths"}))

    def test_tools_not_in_the_table(self):
        for tool, inp in [("Write", {"file_path": "content/x.json", "content": ""}),
                          ("Edit", {"file_path": "docs/a.md"}), ("Bash", {"command": "ls"}),
                          ("WebFetch", {"url": "https://example.com"}), ("Task", {}), ("mcp__x__y", {})]:
            with self.subTest(tool=tool):
                allow, message = rs.decide("ask", tool, inp, self.repo)
                self.assertFalse(allow)
                self.assertIn("not available", message)

    def test_unknown_kind_allows_nothing(self):
        self.assertFalse(rs.decide("nope", "Read", {"file_path": "docs/a.md"}, self.repo)[0])

    def test_paths_outside_the_repo(self):
        for path in ["/etc/passwd", "../x", "content/../../x", os.path.join(self.outside, "secret.txt"),
                     "~/.ssh/id_ed25519", "", None, "a\x00b"]:
            with self.subTest(path=path):
                self.assertFalse(self.allowed("Read", {"file_path": path}))

    def test_symlink_escaping_the_repo(self):
        self.assertFalse(self.allowed("Read", {"file_path": "content/escape/secret.txt"}))
        self.assertFalse(self.allowed("Grep", {"pattern": "x", "path": "content/escape"}))
        self.assertFalse(self.allowed("Glob", {"pattern": "content/escape/*"}))

    def test_symlink_into_a_private_folder(self):
        self.assertFalse(self.allowed("Read", {"file_path": "docs/into-data/sessions/x.json"}))

    def test_private_folders_and_files(self):
        for path in ["data/sessions/x.json", "data", ".git/config", ".env", "content/.env.local",
                     "node_modules/x/index.js", "Credentials/key.txt", ".claude/settings.local.json"]:
            with self.subTest(path=path):
                self.assertFalse(self.allowed("Read", {"file_path": path}))
                self.assertFalse(self.allowed("Read", {"file_path": os.path.join(self.repo, path)}))

    def test_searches_may_not_start_at_the_root_or_climb(self):
        for tool, inp in [("Grep", {"pattern": "x"}), ("Grep", {"pattern": "x", "path": "."}),
                          ("Grep", {"pattern": "x", "path": self.repo}), ("Grep", {"pattern": "x", "path": "data"}),
                          ("Grep", {"pattern": "x", "path": "content", "glob": "../**"}),
                          ("Glob", {"pattern": "**/*.json"}), ("Glob", {"pattern": "../*"}),
                          ("Glob", {"pattern": "/etc/*"}), ("Glob", {"pattern": "data/**"}),
                          ("Glob", {"pattern": "*", "path": "/etc"}), ("Glob", {"pattern": "**", "path": ".git"})]:
            with self.subTest(tool=tool, inp=inp):
                self.assertFalse(self.allowed(tool, inp))

    def test_notes(self):
        self.assertEqual(rs.describe("Read", {"file_path": "content/maths/courses/c/l.json"}, self.repo),
                         "Reading the lesson file")
        self.assertEqual(rs.wanted("Read", {"file_path": "data/sessions/x.json"}, self.repo),
                         "Wanted to read data/sessions/x.json, not allowed")
        self.assertEqual(rs.wanted("Write", {"file_path": "content/x.json"}, self.repo),
                         "Wanted to write content/x.json, not allowed")
        self.assertEqual(rs.wanted("Read", {"file_path": "/etc/passwd"}, self.repo),
                         "Wanted to read a file outside the app, not allowed")


class Contexts(unittest.TestCase):
    def test_a_good_context_keeps_known_keys_only(self):
        ctx = rs.validate_context(dict(context(), extra="dropped", script="<x>"))
        self.assertNotIn("extra", ctx)
        self.assertEqual(ctx["block"], STEP)
        self.assertEqual(ctx["record"]["log"][0]["values"], {"f": "5m^2 + 9"})

    def test_refusals(self):
        bad = [
            ("not an object", []),
            ("missing course", {k: v for k, v in context().items() if k != "courseId"}),
            ("course id climbs", context(courseId="../etc")),
            ("lesson id has a slash", context(lessonId="a/b")),
            ("node id", context(nodeId="15A xx")),
            ("block id", context(block=dict(STEP, id="Not A Slug"))),
            ("block type", context(block=dict(STEP, type="script"))),
            ("index is text", context(lessonIndex="2")),
            ("index is a bool", context(screenIndex=True)),
            ("canReveal text", context(canReveal="yes")),
            ("title too long", context(lessonTitle="x" * 300)),
            ("log too long", context(record={"attempts": 6, "hints": 0, "solved": False,
                                             "log": [{"values": {}, "result": "wrong"}] * 6})),
            ("log result", context(record={"attempts": 1, "hints": 0, "log": [{"values": {}, "result": "maybe"}]})),
            ("draft not text", context(draft={"f": 3})),
            ("oversized", context(block=dict(STEP, prompt="x" * 50000))),
        ]
        for name, ctx in bad:
            with self.subTest(name=name):
                with self.assertRaises(rs.Invalid):
                    rs.validate_context(ctx)

    def test_the_text_block(self):
        files = rs.course_files(COURSE, LESSON, REPO)
        self.assertEqual(files["lesson"], "content/maths/courses/%s/%s.json" % (COURSE, LESSON))
        self.assertEqual(files["cheatsheet"], "content/maths/courses/%s/cheatsheet.json" % COURSE)
        text = rs.context_text(rs.validate_context(context()), files, "abc123")
        self.assertTrue(text.startswith("[app-context abc123]\nYou are helping inside the rabbit-hole app."))
        self.assertTrue(text.endswith("[end app-context abc123]"))
        self.assertIn("lesson 3 of 5: The smallest best fit", text)
        self.assertIn("screen 2 of 7: One variable", text)
        self.assertIn("5m^2 - 12m + 9", text)
        self.assertIn("hints taken: 1 of 3", text)
        self.assertIn("canReveal: false", text)
        self.assertIn("Lesson file: content/maths/courses/", text)

    def test_files_for_an_unknown_course(self):
        self.assertEqual(rs.course_files("no-such-course", "x", REPO), {})


# --------------------------------------------------------------------------
# over HTTP, with the fake claude
# --------------------------------------------------------------------------

class Live(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        os.chmod(FAKE, 0o755)
        cls.tmp = tempfile.mkdtemp()
        cls.dist = os.path.join(cls.tmp, "dist")
        os.makedirs(os.path.join(cls.dist, "assets"))
        with open(os.path.join(cls.dist, "index.html"), "w") as fh:
            fh.write("<!doctype html><title>rabbit-hole</title>")
        with open(os.path.join(cls.dist, "sw.js"), "w") as fh:
            fh.write("// worker")
        with open(os.path.join(cls.dist, "assets", "app.js"), "w") as fh:
            fh.write("console.log(1)")
        with open(os.path.join(cls.dist, "manifest.webmanifest"), "w") as fh:
            fh.write("{}")
        with open(os.path.join(cls.tmp, "secret.txt"), "w") as fh:
            fh.write("secret")
        os.symlink(os.path.join(cls.tmp, "secret.txt"), os.path.join(cls.dist, "link.txt"))
        cls.data = os.path.join(cls.tmp, "data")
        cls.log = os.path.join(cls.tmp, "fake.log")
        cls.server = rs.Server(("127.0.0.1", 0), cls.dist, FAKE, cls.data)
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        shutil.rmtree(cls.tmp)

    def setUp(self):
        os.environ["FAKE_CLAUDE_MODE"] = "normal"
        os.environ["FAKE_CLAUDE_LOG"] = self.log
        if os.path.exists(self.log):
            os.remove(self.log)

    def tearDown(self):
        os.environ.pop("FAKE_CLAUDE_MODE", None)
        os.environ.pop("FAKE_CLAUDE_LOG", None)
        rs.KINDS["ask"]["timeout"] = 180

    def request(self, method, path, body=None, headers=None, raw=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=30)
        sent = {"Host": "127.0.0.1:%d" % self.port}
        data = raw
        if body is not None:
            data = json.dumps(body).encode()
            sent["Content-Type"] = "application/json"
        sent.update(headers or {})
        conn.request(method, path, body=data, headers=sent)
        response = conn.getresponse()
        payload = response.read()
        conn.close()
        return response, payload

    def api(self, method, path, body=None, headers=None):
        response, payload = self.request(method, path, body, headers)
        return response.status, json.loads(payload) if payload else None

    def new_session(self, **changes):
        status, body = self.api("POST", "/api/session", {"kind": "ask", "context": context(**changes)})
        self.assertEqual(status, 200, body)
        return body["sessionId"]

    def turn(self, sid, text, update=None):
        body = {"sessionId": sid, "text": text}
        if update:
            body["update"] = update
        response, payload = self.request("POST", "/api/turn", body)
        return response, parse_sse(payload.decode())

    def runs(self):
        with open(self.log) as fh:
            return [json.loads(line) for line in fh]

    # --- static -------------------------------------------------------------

    def test_static_files(self):
        response, payload = self.request("GET", "/")
        self.assertEqual(response.status, 200)
        self.assertIn(b"rabbit-hole", payload)
        self.assertEqual(response.getheader("Cache-Control"), "no-cache")
        self.assertTrue(response.getheader("Content-Type").startswith("text/html"))
        response, _ = self.request("GET", "/index.html")
        self.assertEqual(response.status, 200)  # not a redirect (the tailscale serve trap)
        response, _ = self.request("GET", "/sw.js")
        self.assertEqual(response.getheader("Cache-Control"), "no-cache")
        response, _ = self.request("GET", "/assets/app.js?v=1")
        self.assertEqual(response.status, 200)
        self.assertTrue(response.getheader("Content-Type").startswith("text/javascript"))
        self.assertIsNone(response.getheader("Cache-Control"))
        response, _ = self.request("GET", "/manifest.webmanifest")
        self.assertEqual(response.getheader("Content-Type"), "application/manifest+json")

    def test_path_traversal_and_listing_are_refused(self):
        for path in ["/../secret.txt", "/assets/../../secret.txt", "/%2e%2e/secret.txt", "/assets/%2e%2e/%2e%2e/secret.txt",
                     "/link.txt", "/assets/", "/assets", "/nope.js", "/%00"]:
            with self.subTest(path=path):
                response, payload = self.request("GET", path)
                self.assertIn(response.status, (400, 404))
                self.assertNotIn(b"secret", payload)

    def test_no_dist_says_so(self):
        server = rs.Server(("127.0.0.1", 0), os.path.join(self.tmp, "missing"), FAKE, self.data)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            conn = http.client.HTTPConnection("127.0.0.1", server.server_address[1], timeout=10)
            conn.request("GET", "/")
            response = conn.getresponse()
            self.assertEqual(response.status, 503)
            self.assertIn(b"npm run build", response.read())
            conn.close()
        finally:
            server.shutdown()
            server.server_close()

    def test_unknown_host_is_refused(self):
        response, _ = self.request("GET", "/api/state", headers={"Host": "evil.example:8791"})
        self.assertEqual(response.status, 421)
        response, _ = self.request("GET", "/api/state", headers={"Host": "pc.tail1234.ts.net"})
        self.assertEqual(response.status, 200)

    # --- API ----------------------------------------------------------------

    def test_state(self):
        self.assertEqual(self.api("GET", "/api/state"), (200, {"ok": True, "version": 1, "kinds": ["ask"], "busy": False}))

    def test_session_refusals(self):
        self.assertEqual(self.api("POST", "/api/session", {"kind": "build", "context": context()})[0], 400)
        self.assertEqual(self.api("POST", "/api/session", {"kind": "ask", "context": context(courseId="../x")})[0], 400)
        self.assertEqual(self.api("POST", "/api/session", {"kind": "ask", "context": context(lessonIndex="x")})[0], 400)
        response, _ = self.request("POST", "/api/session", raw=b"{}", headers={"Content-Type": "text/plain"})
        self.assertEqual(response.status, 415)
        response, _ = self.request("POST", "/api/session", raw=b"x" * (rs.MAX_BODY + 1),
                                   headers={"Content-Type": "application/json"})
        self.assertEqual(response.status, 413)
        response, _ = self.request("POST", "/api/session", raw=b"{not json", headers={"Content-Type": "application/json"})
        self.assertEqual(response.status, 400)

    def test_cross_origin_post_is_refused(self):
        status, _ = self.api("POST", "/api/session", {"kind": "ask", "context": context()},
                             headers={"Origin": "https://evil.example"})
        self.assertEqual(status, 403)
        status, _ = self.api("POST", "/api/session", {"kind": "ask", "context": context()},
                             headers={"Origin": "http://127.0.0.1:%d" % self.port})
        self.assertEqual(status, 200)
        # Behind tailscale serve: the page is https on the tailnet name.
        status, _ = self.api("POST", "/api/session", {"kind": "ask", "context": context()},
                             headers={"Origin": "https://pc.tail1234.ts.net:8443", "Host": "pc.tail1234.ts.net:8443"})
        self.assertEqual(status, 200)

    def test_bad_session_ids(self):
        for sid in ["../../etc/passwd", "../" + "a" * 20, "a" * 10, "a/b" * 8, 5]:
            with self.subTest(sid=sid):
                self.assertEqual(self.api("POST", "/api/turn", {"sessionId": sid, "text": "hi"})[0], 400)
                self.assertEqual(self.api("POST", "/api/stop", {"sessionId": sid})[0], 400)
        self.assertEqual(self.api("GET", "/api/transcript?id=../../etc/passwd")[0], 400)
        self.assertEqual(self.api("GET", "/api/transcript?id=" + "a" * 22)[0], 404)
        self.assertEqual(self.api("POST", "/api/turn", {"sessionId": "a" * 22, "text": "hi"})[0], 404)

    def test_a_full_turn_then_a_resumed_one(self):
        sid = self.new_session()
        response, events = self.turn(sid, "I don't get why there is a middle term")
        self.assertEqual(response.status, 200)
        self.assertTrue(response.getheader("Content-Type").startswith("text/event-stream"))
        names = [name for name, _ in events]
        self.assertEqual(names[-1], "done")
        self.assertEqual(names.count("done") + names.count("error"), 1)
        notes = [data["text"] for name, data in events if name == "note"]
        self.assertEqual(notes, ["Reading the lesson file", "Wanted to write content/x.json, not allowed",
                                 "Wanted to read data/sessions/secret.json, not allowed"])
        streamed = "".join(data["text"] for name, data in events if name == "delta")
        self.assertIn("answers read=allow write=deny data=deny", streamed)
        done = events[-1][1]
        self.assertEqual(done["text"], streamed.strip())
        self.assertEqual(done["costUsd"], 0.0125)

        run = self.runs()[0]
        argv = run["argv"]
        self.assertNotIn("--resume", argv)
        self.assertEqual(argv[argv.index("--tools") + 1], "Read,Grep,Glob")
        self.assertEqual(argv[argv.index("--model") + 1], "sonnet")
        self.assertEqual(argv[argv.index("--permission-prompt-tool") + 1], "stdio")
        self.assertNotIn("--allowedTools", argv)
        self.assertFalse(any("I don't get why" in a for a in argv))
        settings = json.loads(argv[argv.index("--settings") + 1])
        self.assertEqual(settings["permissions"]["ask"], ["Read", "Grep", "Glob"])
        self.assertIn("Bash(sudo:*)", settings["permissions"]["deny"])
        first = [m for m in run["stdin"] if m.get("type") == "user"][0]["message"]["content"]
        self.assertTrue(first.startswith("[app-context "))
        self.assertIn("5m^2 - 12m + 9", first)
        self.assertIn("Lesson file: content/maths/courses/%s/%s.json" % (COURSE, LESSON), first)
        self.assertTrue(first.endswith("\n\nI don't get why there is a middle term"))
        responses = [m["response"] for m in run["stdin"] if m.get("type") == "control_response"]
        self.assertEqual([r["response"]["behavior"] for r in responses], ["allow", "deny", "deny"])

        os.remove(self.log)
        response, events = self.turn(sid, "just tell me the answer", update={"draft": {"f": "5m^2"}, "attempts": 2,
                                                                             "hints": 3, "canReveal": True})
        self.assertEqual(events[-1][0], "done")
        self.assertEqual(events[-1][1]["costUsd"], 0.0075)
        run = self.runs()[0]
        argv = run["argv"]
        self.assertIn("--resume", argv)
        stored = self.server.store.load(sid)
        self.assertEqual(argv[argv.index("--resume") + 1], stored["claudeSession"])
        second = [m for m in run["stdin"] if m.get("type") == "user"][0]["message"]["content"]
        self.assertNotIn("[app-context", second)
        self.assertTrue(second.startswith("[app-update %s] " % stored["fence"]))
        self.assertIn("canReveal: true", second)
        self.assertTrue(second.endswith("\n\njust tell me the answer"))

        status, transcript = self.api("GET", "/api/transcript?id=" + sid)
        self.assertEqual(status, 200)
        self.assertEqual(transcript["context"], {"courseId": COURSE, "lessonId": LESSON, "stepId": "expand-the-norm"})
        self.assertEqual([m["role"] for m in transcript["messages"]], ["user", "assistant", "user", "assistant"])
        self.assertEqual(transcript["messages"][0]["text"], "I don't get why there is a middle term")
        status, listing = self.api("GET", "/api/sessions")
        mine = [s for s in listing["sessions"] if s["id"] == sid][0]
        self.assertEqual(mine["turns"], 2)
        self.assertEqual(mine["title"], "One variable (The smallest best fit)")
        self.assertEqual(mine["courseId"], COURSE)
        self.assertEqual(listing["sessions"][0]["id"], sid)  # newest first

    def start_slow_turn(self, sid):
        os.environ["FAKE_CLAUDE_MODE"] = "slow"
        result = {}

        def go():
            result["response"], result["events"] = self.turn(sid, "hello")

        thread = threading.Thread(target=go)
        thread.start()
        for _ in range(100):
            if self.api("GET", "/api/state")[1]["busy"] and os.path.exists(self.log):
                break
            time.sleep(0.05)
        return thread, result

    def test_a_second_turn_gets_409_and_stop_ends_the_first(self):
        sid = self.new_session()
        thread, result = self.start_slow_turn(sid)
        other = self.new_session()
        self.assertEqual(self.api("POST", "/api/turn", {"sessionId": other, "text": "hi"})[0], 409)
        self.assertEqual(self.api("POST", "/api/stop", {"sessionId": other}), (200, {"stopped": False}))
        started = time.time()
        self.assertEqual(self.api("POST", "/api/stop", {"sessionId": sid}), (200, {"stopped": True}))
        thread.join(10)
        self.assertFalse(thread.is_alive())
        self.assertLess(time.time() - started, 8)
        events = result["events"]
        self.assertEqual(events[-1], ("done", {"text": "Thinking", "stopped": True}))
        self.assertFalse(self.api("GET", "/api/state")[1]["busy"])

    def test_timeout(self):
        rs.KINDS["ask"]["timeout"] = 1
        sid = self.new_session()
        os.environ["FAKE_CLAUDE_MODE"] = "slow"
        started = time.time()
        _, events = self.turn(sid, "hello")
        self.assertLess(time.time() - started, 10)
        self.assertEqual(events[-1][0], "error")
        self.assertIn("longer than 1 seconds", events[-1][1]["message"])
        self.assertEqual(self.api("GET", "/api/transcript?id=" + sid)[1]["messages"], [])

    def test_error_result_and_crash(self):
        for mode, words in (("error", "API Error"), ("crash", "boom")):
            with self.subTest(mode=mode):
                os.environ["FAKE_CLAUDE_MODE"] = mode
                sid = self.new_session()
                _, events = self.turn(sid, "hello")
                self.assertEqual([n for n, _ in events if n in ("done", "error")], ["error"])
                self.assertIn(words, events[-1][1]["message"])
                # A failed message is not in the transcript, so Retry does not double it.
                self.assertEqual(self.api("GET", "/api/transcript?id=" + sid)[1]["messages"], [])

    def test_turn_refusals(self):
        sid = self.new_session()
        self.assertEqual(self.api("POST", "/api/turn", {"sessionId": sid, "text": ""})[0], 400)
        self.assertEqual(self.api("POST", "/api/turn", {"sessionId": sid, "text": "x" * 5000})[0], 400)
        self.assertEqual(self.api("POST", "/api/turn", {"sessionId": sid, "text": "hi", "update": {"hints": "3"}})[0], 400)
        status, _ = self.api("POST", "/api/turn", {"sessionId": sid, "text": "hi"}, headers={"Origin": "https://evil.example"})
        self.assertEqual(status, 403)


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
