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
FAKE_CLAUDE_LOG, if set, is a file this appends one JSON line to per run:
{argv, stdin: [every message it read]}.
"""

import json
import os
import sys
import time
import uuid

MODE = os.environ.get("FAKE_CLAUDE_MODE", "normal")
LOG = os.environ.get("FAKE_CLAUDE_LOG")
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
