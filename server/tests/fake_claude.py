#!/usr/bin/env python3
"""A stand-in for `claude -p` in stream-json mode, so no test spends plan usage.

The event shapes are the real CLI's (Claude Code 2.1.325, checked against the
smoke test of 15 Nov 2026 and jarvis-voice's parser): a `control_request`
initialize from the host, a `system` init with the session id, `stream_event`
wrappers around the API's streaming events, `control_request` can_use_tool
questions that wait for a `control_response` on stdin, an `assistant`
message, and a `result`.

FAKE_CLAUDE_MODE chooses the script:
  normal   text, three permission questions (an allowed Read, a Write, a Read
           under data/), the answers echoed back as text, a result
  slow     one delta, then hangs (for stop, timeout and the 409)
  error    a result with is_error
  crash    a line on stderr and exit 3 with no result

For new-course (the talk), the brief's path is read from the context block:
  brief        writes a valid brief (courseId $FAKE_BRIEF_COURSE, default
               tiny-course) to the path it was given
  brief-taken  writes a brief whose courseId is taken and whose node is missing
  brief-escape asks to write everywhere it must not, then reports the answers

For build-course, the folder is read from the first message; the files come
from fixtures/tiny-course with the id and node put in:
  build          writes the valid tiny course
  build-fix      writes it with a wrong key, then fixes it on the repair turn
  build-invalid  writes it with a wrong key every time
  build-escape   asks to write outside its folder (and a subfolder, a non-JSON
                 file, an existing course), then writes the valid course
  build-slow     writes course.json, then hangs (for stop)

An allowed Write or Edit is carried out by this script, as the real tool would.
FAKE_CLAUDE_LOG, if set, is a file this appends one JSON line to per run:
{argv, stdin: [every message it read]}.
"""

import json
import os
import re
import sys
import time
import uuid

MODE = os.environ.get("FAKE_CLAUDE_MODE", "normal")
LOG = os.environ.get("FAKE_CLAUDE_LOG")
FIXTURE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "tiny-course")
seen = []


def out(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def read():
    line = sys.stdin.readline()
    if not line:
        return None
    msg = json.loads(line)
    seen.append(msg)
    return msg


def save_log():
    if LOG:
        with open(LOG, "a") as fh:
            fh.write(json.dumps({"argv": sys.argv[1:], "stdin": seen}) + "\n")


def delta(text):
    out({"type": "stream_event", "event": {"type": "content_block_delta", "index": 0,
                                           "delta": {"type": "text_delta", "text": text}},
         "session_id": SESSION, "parent_tool_use_id": None, "uuid": str(uuid.uuid4())})


def ask(request_id, tool, inp):
    out({"type": "control_request", "request_id": request_id,
         "request": {"subtype": "can_use_tool", "tool_name": tool, "input": inp,
                     "tool_use_id": "toolu_" + request_id}})
    while True:
        msg = read()
        if msg is None:
            return "eof"
        if msg.get("type") == "control_response" and (msg.get("response") or {}).get("request_id") == request_id:
            return (msg["response"].get("response") or {}).get("behavior", "?")


argv = sys.argv[1:]
SESSION = argv[argv.index("--resume") + 1] if "--resume" in argv else str(uuid.uuid4())

# The host's initialize request, then the user message.
user = None
while user is None:
    msg = read()
    if msg is None:
        save_log()
        sys.exit(1)
    if msg.get("type") == "control_request":
        out({"type": "control_response", "response": {"subtype": "success", "request_id": msg.get("request_id"),
                                                      "response": {}}})
    elif msg.get("type") == "user":
        user = msg

if MODE == "crash":
    save_log()
    sys.stderr.write("boom: fake crash\n")
    sys.exit(3)

out({"type": "system", "subtype": "init", "session_id": SESSION, "model": "claude-sonnet-fake",
     "tools": ["Read", "Grep", "Glob"], "cwd": os.getcwd(), "permissionMode": "default"})
out({"type": "stream_event", "event": {"type": "message_start", "message": {"id": "msg_1", "role": "assistant"}},
     "session_id": SESSION, "parent_tool_use_id": None})

if MODE == "error":
    out({"type": "result", "subtype": "success", "is_error": True, "result": "API Error: overloaded",
         "session_id": SESSION, "total_cost_usd": 0})
    save_log()
    sys.exit(1)

if MODE == "slow":
    delta("Thinking")
    save_log()
    time.sleep(120)
    sys.exit(0)


def finish(text, cost=0.01):
    delta(text)
    out({"type": "result", "subtype": "success", "is_error": False, "result": text, "session_id": SESSION,
         "total_cost_usd": cost, "duration_ms": 10})
    while read() is not None:
        pass
    save_log()
    sys.exit(0)


counter = [0]


def write(path, content, tool="Write"):
    """Ask to write; on allow, write it as the tool would. Returns the answer."""
    counter[0] += 1
    inp = {"file_path": path, "content": content} if tool == "Write" else \
        {"file_path": path, "old_string": "x", "new_string": "y"}
    answer = ask("w%d" % counter[0], tool, inp)
    if answer == "allow" and tool == "Write":
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(content)
    return answer


TEXT = user["message"]["content"] if isinstance(user["message"]["content"], str) else ""

BRIEF = """title: A tiny test course
courseId: {course}
nodeId: {node}

## Who it is for
Mark, who can add.

## Lessons
1. Adding two numbers — the sum of two small numbers.
2. Adding three numbers — one more term.
3. Adding a column — many terms.

## Worked examples
2 + 3 = 5.

## Widgets
- line-fitter: not really, but it exists.

## Missing widgets
None.

## Sources
- https://en.wikipedia.org/wiki/Addition — the definition of a sum.
"""

if MODE.startswith("brief"):
    found = re.search(r"to exactly this file and no other: (\S+)", "\n".join(
        (m.get("message") or {}).get("content", "") for m in seen if m.get("type") == "user"))
    path = found.group(1) if found else None
    if MODE == "brief-escape":
        answers = []
        for target in ["data/sessions/x.json", "content/maths/courses/existing-course/course.json", "docs/x.md",
                       "../outside.md", "schema/x.json", "data/drafts/0123456789abcdef/brief.md",
                       (path or "") + ".bak", "public/content/maths/map.json"]:
            answers.append(write(target, "{}"))
        answers.append(ask("f1", "WebFetch", {"url": "http://127.0.0.1:8791/api/sessions", "prompt": "x"}))
        answers.append(ask("f2", "WebFetch", {"url": "https://en.wikipedia.org/wiki/Addition", "prompt": "x"}))
        answers.append(ask("f3", "WebSearch", {"query": "addition"}))
        answers.append(ask("f4", "Edit", {"file_path": path or "x", "old_string": "a", "new_string": "b"}))
        answers.append(ask("f5", "Bash", {"command": "ls"}))
        finish("answers " + " ".join(answers))
    course = os.environ.get("FAKE_BRIEF_COURSE", "tiny-course")
    node = "15Axx"
    if MODE == "brief-taken":
        course, node = "existing-course", "99Zzz"
    read_answer = ask("r1", "Read", {"file_path": path}) if path else "none"
    answer = write(path, BRIEF.format(course=course, node=node)) if path else "no path"
    finish("I wrote the brief (read=%s write=%s)." % (read_answer, answer))


def course_files(course_id, node, wrong):
    files = {}
    for name in sorted(os.listdir(FIXTURE)):
        with open(os.path.join(FIXTURE, name), encoding="utf-8") as fh:
            text = fh.read()
        text = text.replace('"tiny-course"', json.dumps(course_id)).replace('"15Axx"', json.dumps(node))
        if wrong and name != "course.json":
            text = text.replace('"key": "5"', '"key": "6"')
        files[name] = text
    return files


if MODE.startswith("build"):
    everything = "\n".join((m.get("message") or {}).get("content", "") for m in seen if m.get("type") == "user")
    folder = re.search(r"exactly this folder[^:]*: (\S+?)/?$", everything, re.M)
    ids = re.search(r"course\.json \(id '([^']+)', nodeId '([^']+)'\)", everything)
    if not folder or not ids:
        finish("I could not find the folder.")
    folder, course_id, node = folder.group(1), ids.group(1), ids.group(2)
    repairing = "[app-validator" in TEXT
    files = course_files(course_id, node, wrong=(MODE == "build-invalid" or (MODE == "build-fix" and not repairing)))
    answers = []
    if MODE == "build-escape":
        parent = os.path.dirname(folder)
        for target in [os.path.join(parent, "existing-course", "course.json"), os.path.join(parent, "existing-course", "x.json"),
                       "schema/x.json", "tools/x.py", "src/x.ts", "docs/x.md", "server/x.py", ".claude/x.json", ".git/x",
                       os.path.join(folder, "sub", "x.json"), os.path.join(folder, "notes.md"),
                       os.path.join(folder, "..", "other-course", "course.json"), "content/maths/resources/62Hxx.json",
                       "data/builds/x.json", "/tmp/rabbit-escape.json"]:
            answers.append(write(target, "{}"))
    if MODE == "build-slow":
        write(os.path.join(folder, "course.json"), files["course.json"])
        delta("Writing")
        save_log()
        time.sleep(120)
        sys.exit(0)
    for name, text in files.items():
        answers.append(write(os.path.join(folder, name), text))
    finish("Wrote the course. answers " + " ".join(answers))

text = ["The middle term ", "comes from $3 \\cdot (-2m)$ twice. "]
for piece in text:
    delta(piece)
answers = {
    "read": ask("r1", "Read", {"file_path": "content/maths/courses/least-squares-to-the-pseudo-inverse/the-smallest-best-fit.json"}),
    "write": ask("r2", "Write", {"file_path": "content/x.json", "content": "{}"}),
    "data": ask("r3", "Read", {"file_path": "data/sessions/secret.json"}),
}
out({"type": "stream_event", "event": {"type": "message_start", "message": {"id": "msg_2", "role": "assistant"}},
     "session_id": SESSION, "parent_tool_use_id": None})
tail = "answers read=%s write=%s data=%s" % (answers["read"], answers["write"], answers["data"])
delta(tail)
full = "".join(text) + "\n\n" + tail
out({"type": "assistant", "message": {"id": "msg_2", "role": "assistant", "content": [{"type": "text", "text": tail}],
                                      "usage": {"input_tokens": 10, "output_tokens": 5}},
     "session_id": SESSION, "parent_tool_use_id": None})
out({"type": "result", "subtype": "success", "is_error": False, "result": full, "session_id": SESSION,
     "total_cost_usd": 0.0125 if "--resume" not in argv else 0.02, "duration_ms": 10})
# The real CLI exits once its stdin closes.
while read() is not None:
    pass
save_log()
