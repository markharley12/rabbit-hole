#!/usr/bin/env python3
"""rabbit-hole's server on Mark's PC: the built app, and Claude Code sessions.

Python 3 standard library only. It binds 127.0.0.1 and is published to his
own devices with `tailscale serve`, so the app and the API share one origin.
Design: docs/ai-sessions.md. The turn runner is copied from jarvis-voice's
server (turn_command and run_turn), not imported (docs/REUSE.md).

A session is one Claude Code conversation (`claude -p`, no API keys), of one
*kind* (a row in KINDS below). The first turn carries a context block the app
built (the lesson, the step, what he has done on it); later turns resume the
conversation. The server answers every tool-permission question itself, from
the kind's row: nothing is relayed to the phone.

Kinds (docs/ai-sessions.md section 10): `ask` (the lesson's tutor, read
only); `new-course` (a chat from the map that may write only its own
data/drafts/<draftId>/brief.md); `build-course` (a background job from an
accepted brief that may write only one new course folder, validated and
published by this server, never by the session).

    python3 server/rabbit_server.py --port 8791
    python3 server/rabbit_server.py --root /tmp/copy --fake-claude server/tests/fake_claude.py

Security, since a process that runs an agent is reachable from the tailnet:
- 127.0.0.1 only; the Host header must be a local name or a tailnet name
  (stops DNS rebinding); a cross-origin POST is refused (Origin must match
  Host), and a POST must be JSON (so a browser on another origin has to send a
  CORS preflight, which this server never answers).
- Everything from the client is validated (types, lengths, id patterns); ids
  touch paths only after matching a strict pattern; every path is resolved
  (symlinks, ..) before it is compared.
- Tools are limited per kind with --tools, every use is routed to the server
  by "ask" rules, and the server allows only what the kind's row allows.
"""

import argparse
import hashlib
import ipaddress
import json
import mimetypes
import os
import queue
import re
import secrets
import shlex
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlsplit

VERSION = 1
HERE = os.path.dirname(os.path.realpath(__file__))
REPO = os.path.realpath(os.path.dirname(HERE))
DEFAULT_PORT = 8791
DEFAULT_CLAUDE = os.environ.get("RABBIT_CLAUDE") or os.path.join(os.path.expanduser("~"), ".local", "bin", "claude")

# --------------------------------------------------------------------------
# the kinds table
# --------------------------------------------------------------------------
#
# One row per kind of session. Adding a kind is adding a row and a prompt file
# under docs/agents/. `tools` is the whole toolset the session gets (--tools)
# and the only tools the permission answers allow; `write` lists the
# repo-relative folders a write tool may touch (none for ask).

#
# `grant` names what a session of the kind may write beyond `write`, worked
# out per session from server-made ids (session_grant): "brief" is exactly its
# draft's data/drafts/<draftId>/brief.md; "course" is the files directly in
# one new content/<field>/courses/<courseId>/ folder, plus the node's reading
# file when it did not exist when the build began. `chat` kinds are started
# with POST /api/session and talked to with /api/turn; the others are run by
# the server itself (build-course by the build job). `append` are files added
# after the prompt, in order. `timeout` is per turn, in seconds.

KINDS = {
    "ask": {
        "prompt": "docs/agents/ask.md",
        "append": [],
        "tools": ["Read", "Grep", "Glob"],
        "write": [],
        "grant": None,
        "chat": True,
        "model": "sonnet",
        "effort": "medium",
        "timeout": 180,
    },
    "new-course": {
        "prompt": "docs/agents/new-course.md",
        "append": [],
        "tools": ["Read", "Grep", "Glob", "WebSearch", "WebFetch", "Write"],
        "write": [],
        "grant": "brief",
        "chat": True,
        "model": "sonnet",
        "effort": "medium",
        "timeout": 600,
    },
    "build-course": {
        "prompt": "docs/agents/build-course.md",
        "append": ["docs/course-authoring.md"],
        "tools": ["Read", "Grep", "Glob", "WebSearch", "WebFetch", "Write", "Edit"],
        "write": [],
        "grant": "course",
        "chat": False,
        "model": "opus",
        "effort": "high",
        "timeout": 1800,
    },
}

# A build: at most this many repair turns after the first, and this long in all.
BUILD_REPAIRS = 3
BUILD_CAP_SECONDS = 2 * 3600
VALIDATOR_TIMEOUT = 300
BUILD_ACTIVE = ("queued", "running", "validating", "repairing")
BUILD_STATES = BUILD_ACTIVE + ("done", "failed", "stopped")
MAX_LOG = 400
MAX_BRIEF = 32 * 1024
FIELD = "maths"

# Tools that take a path, and the input field it is in.
PATH_FIELDS = {"Read": "file_path", "Grep": "path", "Glob": "path", "Edit": "file_path",
               "Write": "file_path", "NotebookEdit": "notebook_path"}
WRITE_TOOLS = {"Edit", "Write", "NotebookEdit"}
SEARCH_TOOLS = {"Grep", "Glob"}
# A file a build may write in its course folder: course.json, cheatsheet.json,
# <lesson-id>.json. Nothing else, and no subfolders.
COURSE_FILE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*\.json$")
# Never read or written by a session, whatever the kind: learner data, secrets,
# git's internals (and other worktrees' settings), installed packages.
PRIVATE_TOP = {"data", "Credentials", ".git", "node_modules", ".claude"}
# Tools never wanted in an app session. --tools already leaves them out; this
# is the second lock.
DISALLOWED_TOOLS = ["Bash", "Edit", "Write", "NotebookEdit", "WebFetch", "WebSearch", "Task", "Agent",
                    "Skill", "Artifact", "ArtifactComments", "ArtifactData", "CronCreate", "CronDelete",
                    "CronList", "RemoteTrigger", "ScheduleWakeup", "PushNotification", "SendMessage",
                    "EnterWorktree", "ExitWorktree", "Monitor", "TaskStop"]
# Refused in every kind, by Claude Code's own rules (deny outranks everything)
# and again by refused_command() for the forms these prefixes miss.
DENY_RULES = ["Bash(sudo:*)", "Bash(git push:*)", "Bash(rm -rf:*)", "Bash(rm -r:*)",
              "Bash(rm -fr:*)", "Bash(rm -R:*)", "Bash(rm --recursive:*)"]
REFUSED_MENTION = re.compile(r"\bsudo\b|\bgit\b.*\bpush\b|\brm\b.*\s(-[A-Za-z]*[rR][A-Za-z]*|--recursive)\b")

# Ids. Ours are secrets.token_urlsafe(16); a course, lesson or step id is a
# slug (schema/lesson.schema.json); a map node id is an MSC code or a slug;
# Claude Code's session ids are UUIDs.
SESSION_ID = re.compile(r"^[A-Za-z0-9_-]{16,64}$")
# Draft and build ids are ours too: secrets.token_hex(8).
JOB_ID = re.compile(r"^[0-9a-f]{16}$")
SLUG = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
NODE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
CLAUDE_SESSION = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")

MAX_BODY = 64 * 1024
MAX_CONTEXT = 40 * 1024
MAX_TEXT = 4000
MAX_TITLE = 200
PING_SECONDS = 15

# Host names this server answers to. A page on any other name reaching
# 127.0.0.1 is DNS rebinding.
LOCAL_HOSTS = {"localhost", "127.0.0.1", "[::1]"}
TAILNET_SUFFIX = ".ts.net"


def log(message):
    sys.stderr.write("rabbit-server: %s\n" % message)
    sys.stderr.flush()


# --------------------------------------------------------------------------
# permission answers
# --------------------------------------------------------------------------

def shell_segments(command):
    """The simple commands in a shell command, as lists of words, or None if
    it uses anything but pipes, && / || / ; and output to /dev/null. From
    jarvis-voice."""
    if re.search(r"[\n\r`]|\$\(|\$\{", command):
        return None
    lexer = shlex.shlex(command, posix=True, punctuation_chars=True)
    lexer.whitespace_split = True
    lexer.commenters = ""
    try:
        words = list(lexer)
    except ValueError:
        return None
    segments, cur, i = [], [], 0
    while i < len(words):
        w = words[i]
        if w in ("|", "&&", "||", ";"):
            if not cur:
                return None
            segments.append(cur)
            cur = []
        elif w in (">", ">>", "&>", "&>>", ">&"):
            target = words[i + 1] if i + 1 < len(words) else None
            if not (target == "/dev/null" or (w == ">&" and target in ("1", "2"))):
                return None
            if cur and cur[-1].isdigit():
                cur.pop()
            i += 1
        elif w and set(w) <= set("|&;<>()"):
            return None
        else:
            cur.append(w)
        i += 1
    if not cur:
        return None
    segments.append(cur)
    return segments


def refused_command(command):
    """sudo, git push or recursive rm, in any form: as a command of its own
    (`git -C dir push`, `rm -fr`, `ls && sudo x`) or merely mentioned in a
    command too complex to read (`bash -c "sudo ..."`)."""
    command = command if isinstance(command, str) else ""
    if REFUSED_MENTION.search(command):
        return True
    for words in shell_segments(command) or []:
        cmd, args = os.path.basename(words[0]), words[1:]
        if cmd == "sudo":
            return True
        if cmd == "git":
            subs = [a for i, a in enumerate(args) if not a.startswith("-") and (i == 0 or args[i - 1] not in ("-C", "-c"))]
            if subs[:1] == ["push"]:
                return True
        if cmd == "rm" and any(a == "--recursive" or (a.startswith("-") and not a.startswith("--") and ("r" in a or "R" in a))
                               for a in args):
            return True
    return False


def _inside(real, root):
    return real == root or real.startswith(root + os.sep)


def path_problem(raw, repo, search=False):
    """Why a session may not touch this path, or None if it may.

    Resolved (symlinks and ..) before comparing, so a link inside the repo that
    points out of it is outside. A search (Grep, Glob) may not start at the
    repo's root, because it would walk into the private folders."""
    if raw is None and search:
        raw = "."
    if not isinstance(raw, str) or not raw.strip() or "\x00" in raw:
        return "no usable path"
    if raw.startswith("~"):
        return "outside the repo"
    joined = raw if os.path.isabs(raw) else os.path.join(repo, raw)
    real = os.path.realpath(joined)
    lexical = os.path.normpath(joined)
    for candidate in (real, lexical):
        if not _inside(candidate, repo):
            return "outside the repo"
        rel = os.path.relpath(candidate, repo)
        parts = [] if rel == "." else rel.split(os.sep)
        if parts and parts[0] in PRIVATE_TOP:
            return "a private folder (%s/)" % parts[0]
        if any(p.startswith(".env") or p in (".git", "node_modules") for p in parts):
            return "a private file"
        if search and not parts:
            return "the whole repo (search inside content/ or docs/ instead)"
    return None


def glob_root(pattern):
    """The literal folders at the start of a glob pattern ("content/maths" for
    "content/maths/**/*.json"), or None if the pattern climbs (..) or is absolute."""
    if not isinstance(pattern, str) or pattern.startswith(("/", "~")) or ".." in pattern.split("/"):
        return None
    literal = []
    for part in pattern.split("/")[:-1]:
        if any(c in part for c in "*?[]{}"):
            break
        literal.append(part)
    return "/".join(literal) or "."


def describe(tool, inp, repo):
    """A few words for what a tool is doing, for the chat's quiet note lines."""
    inp = inp if isinstance(inp, dict) else {}
    raw = inp.get(PATH_FIELDS.get(tool, ""), "")
    where = ""
    if isinstance(raw, str) and raw:
        full = os.path.normpath(raw if os.path.isabs(raw) else os.path.join(repo, raw))
        where = os.path.relpath(full, repo) if _inside(full, repo) else "a file outside the app"
    if tool == "Read":
        name = os.path.basename(where)
        if name == "cheatsheet.json":
            return "Reading the cheat sheet"
        if where.startswith("content" + os.sep) and os.sep + "courses" + os.sep in where and name.endswith(".json"):
            return "Reading the course file" if name == "course.json" else "Reading the lesson file"
        return "Reading %s" % (where or "a file")
    if tool == "Grep":
        return "Searching %s for “%s”" % (where or "the repo", str(inp.get("pattern", ""))[:40])
    if tool == "Glob":
        return "Looking for files: %s" % str(inp.get("pattern", ""))[:60]
    if tool == "Bash":
        return "Running a command"
    if tool == "WebSearch":
        return "Searching the web for “%s”" % str(inp.get("query", ""))[:60]
    if tool == "WebFetch":
        host = urlsplit(inp.get("url") if isinstance(inp.get("url"), str) else "").hostname or "a page"
        return "Opening %s" % host[:80]
    if tool in WRITE_TOOLS:
        return "%s %s" % ("Editing" if tool == "Edit" else "Writing", where or "a file")
    return "Using %s" % tool


def wanted(tool, inp, repo):
    """The note for a refused tool: 'Wanted to read data/x, not allowed'."""
    doing = describe(tool, inp, repo)
    verb, _, rest = doing.partition(" ")
    verbs = {"Reading": "read", "Searching": "search", "Looking": "look", "Running": "run", "Writing": "write",
             "Editing": "edit", "Opening": "open", "Using": "use"}
    return "Wanted to %s %s, not allowed" % (verbs.get(verb, verb.lower()), rest)


def url_problem(raw):
    """Why WebFetch may not open this URL, or None. Only public http(s) pages:
    never this PC, the tailnet or a private network (the server's own API is
    on 127.0.0.1). A name is resolved and refused if any of its addresses is
    not public, so a public name pointing at 127.0.0.1 is caught. What is not
    caught: a name that answers differently between this check and the fetch
    (DNS rebinding); the session's tools and write paths limit what that gains."""
    if not isinstance(raw, str) or len(raw) > 2000 or not raw.strip():
        return "no usable URL"
    try:
        parts = urlsplit(raw.strip())
        host = (parts.hostname or "").lower().rstrip(".")
    except ValueError:
        return "not a URL"
    if parts.scheme not in ("http", "https"):
        return "not an http(s) URL"
    if not host:
        return "a URL without a host"
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        address = None
    if address is not None:
        if not address.is_global:
            return "an address on this PC or a private network"
        return None
    if "." not in host or host == "localhost" or host.endswith((".localhost", ".local", ".internal", ".lan", ".home",
                                                                ".arpa", TAILNET_SUFFIX)):
        return "a name on this PC, the tailnet or a private network"
    if re.fullmatch(r"[0-9.]+|0x[0-9a-f.x]+", host):
        return "a numeric host that is not a plain address"
    try:
        found = RESOLVE(host)
    except OSError:
        return "a name that does not resolve"
    if not found:
        return "a name that does not resolve"
    for text in found:
        try:
            if not ipaddress.ip_address(text.split("%")[0]).is_global:
                return "a name that points at this PC or a private network"
        except ValueError:
            return "a name that does not resolve to an address"
    return None


def _resolve(host):
    """Every address a host name resolves to, as text."""
    return sorted({info[4][0] for info in socket.getaddrinfo(host, None)})


# Swapped by the tests, which must not touch the network.
RESOLVE = _resolve


def _granted_file(raw, repo, grant):
    """True if raw names exactly one of the files granted to this session."""
    if not isinstance(raw, str) or not raw.strip() or "\x00" in raw or raw.startswith("~"):
        return False
    joined = raw if os.path.isabs(raw) else os.path.join(repo, raw)
    real, lexical = os.path.realpath(joined), os.path.normpath(joined)
    return any(real == f and lexical == f for f in (grant or {}).get("files", []))


def write_problem(raw, repo, kind, grant):
    """Why a write tool may not touch this path, or None if it may.

    Allowed: exactly a granted file; a file named like course.json or
    <lesson-id>.json directly inside a granted folder; or a path inside the
    kind's static `write` folders that is not private. Both the resolved and
    the lexical path must agree, so neither a symlink nor `..` can lead out."""
    if not isinstance(raw, str) or not raw.strip() or "\x00" in raw:
        return "no usable path"
    if raw.startswith("~"):
        return "outside the repo"
    if _granted_file(raw, repo, grant):
        return None
    joined = raw if os.path.isabs(raw) else os.path.join(repo, raw)
    real, lexical = os.path.realpath(joined), os.path.normpath(joined)
    for folder in (grant or {}).get("folders", []):
        if os.path.dirname(real) == folder and os.path.dirname(lexical) == folder:
            if real != lexical:
                return "a link"
            if not COURSE_FILE.match(os.path.basename(real)):
                return "not a course file (course.json, cheatsheet.json or <lesson-id>.json)"
            return None
    if path_problem(raw, repo) is None and any(
            _inside(real, os.path.realpath(os.path.join(repo, w))) for w in kind.get("write", [])):
        return None
    return "not a file this session may write"


def decide(kind_name, tool, inp, repo, grant=None):
    """The answer to one can_use_tool request: (allow, message for Claude).

    `grant` is what this one session may write (session_grant), as absolute
    resolved paths: {"files": [...], "folders": [...]}."""
    kind = KINDS.get(kind_name)
    inp = inp if isinstance(inp, dict) else {}
    if tool == "Bash" and refused_command(inp.get("command")):
        return False, "Refused: sudo, git push and recursive rm never run from rabbit-hole. Don't try another way round."
    if not kind or tool not in kind["tools"]:
        return False, "%s is not available in this session. Answer from what you have." % tool
    if tool == "WebFetch":
        problem = url_problem(inp.get("url"))
        if problem:
            return False, "Not allowed: that URL is %s. Only public web pages." % problem
        return True, None
    if tool in WRITE_TOOLS:
        problem = write_problem(inp.get(PATH_FIELDS[tool]), repo, kind, grant)
        if problem:
            return False, "Not allowed: this session may not write there (%s)." % problem
        return True, None
    if tool == "Read" and _granted_file(inp.get("file_path"), repo, grant):
        # Its own brief, under data/: Claude Code's Write wants a file read before it is overwritten.
        return True, None
    if tool in PATH_FIELDS:
        raw = inp.get(PATH_FIELDS[tool])
        if tool == "Glob":
            # The search starts where the pattern's literal folders lead
            # ("content/maths" for content/maths/**/*.json), under `path` if given.
            root = glob_root(inp.get("pattern"))
            base = raw if isinstance(raw, str) and raw.strip() else "."
            problem = "a pattern that leaves the repo" if root is None else \
                path_problem(os.path.join(base, root), repo, search=True)
        else:
            problem = path_problem(raw, repo, search=tool in SEARCH_TOOLS)
        if problem is None and tool == "Grep" and inp.get("glob") is not None and glob_root(inp.get("glob")) is None:
            problem = "a pattern that leaves the repo"
        if problem:
            return False, "Not allowed: that path is %s." % problem
    return True, None


# --------------------------------------------------------------------------
# the context block
# --------------------------------------------------------------------------

class Invalid(ValueError):
    """Something from the client that is refused, with the HTTP status to answer."""

    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def _str(ctx, key, limit=MAX_TITLE, pattern=None, required=False):
    value = ctx.get(key)
    if value is None:
        if required:
            raise Invalid("%s is missing" % key)
        return None
    if not isinstance(value, str) or len(value) > limit:
        raise Invalid("%s must be a string of at most %d characters" % (key, limit))
    if pattern and not pattern.match(value):
        raise Invalid("%s is not a valid id" % key)
    return value


def _int(ctx, key, low=0, high=10000):
    value = ctx.get(key)
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
        raise Invalid("%s must be a whole number from %d to %d" % (key, low, high))
    return value


def _values(value, key):
    """A {field: typed text} map, as drafts and attempts carry."""
    if not isinstance(value, dict) or len(value) > 50:
        raise Invalid("%s must be an object of at most 50 fields" % key)
    out = {}
    for name, text in value.items():
        if not isinstance(name, str) or len(name) > 60 or not isinstance(text, str) or len(text) > 500:
            raise Invalid("%s has a field that is not short text" % key)
        out[name] = text
    return out


def _record(value):
    if not isinstance(value, dict):
        raise Invalid("record must be an object")
    out = {}
    for key in ("attempts", "hints"):
        n = value.get(key, 0)
        if isinstance(n, bool) or not isinstance(n, int) or not 0 <= n <= 100000:
            raise Invalid("record.%s must be a whole number" % key)
        out[key] = n
    for key in ("solved", "revealed"):
        flag = value.get(key, False)
        if not isinstance(flag, bool):
            raise Invalid("record.%s must be true or false" % key)
        out[key] = flag
    entries = value.get("log", [])
    if not isinstance(entries, list) or len(entries) > 5:
        raise Invalid("record.log must be a list of at most 5 attempts")
    out["log"] = []
    for entry in entries:
        if not isinstance(entry, dict):
            raise Invalid("record.log entries must be objects")
        result = entry.get("result")
        if result not in ("correct", "wrong", "unreadable"):
            raise Invalid("record.log result must be correct, wrong or unreadable")
        item = {"values": _values(entry.get("values", {}), "record.log values"), "result": result}
        for key in ("at", "slip"):
            if entry.get(key) is not None:
                item[key] = _str(entry, key, 80)
        out["log"].append(item)
    return out


# The screens the Ask tutor can be opened on (schema/lesson.schema.json).
BLOCK_TYPES = ("step", "text", "choice", "order")
# Screens with an answer the tutor must hold back until canReveal (docs/agents/ask.md).
ANSWERED = ("step", "choice", "order")


def validate_context(ctx):
    """The context the app sent, checked and with unknown keys dropped. Raises Invalid."""
    if not isinstance(ctx, dict):
        raise Invalid("context must be an object")
    if len(json.dumps(ctx)) > MAX_CONTEXT:
        raise Invalid("context is too large")
    out = {
        "courseId": _str(ctx, "courseId", 60, SLUG, required=True),
        "courseTitle": _str(ctx, "courseTitle"),
        "nodeId": _str(ctx, "nodeId", 64, NODE_ID),
        "nodeName": _str(ctx, "nodeName"),
        "lessonId": _str(ctx, "lessonId", 60, SLUG, required=True),
        "lessonTitle": _str(ctx, "lessonTitle"),
        "lessonIndex": _int(ctx, "lessonIndex"),
        "lessonCount": _int(ctx, "lessonCount"),
        "screenIndex": _int(ctx, "screenIndex"),
        "screenCount": _int(ctx, "screenCount"),
    }
    block = ctx.get("block")
    if not isinstance(block, dict):
        raise Invalid("block must be an object")
    if not isinstance(block.get("id"), str) or not SLUG.match(block["id"]) or len(block["id"]) > 60:
        raise Invalid("block.id is not a valid id")
    if block.get("type") not in BLOCK_TYPES:
        raise Invalid("block.type must be one of %s" % ", ".join(BLOCK_TYPES))
    if block.get("title") is not None and (not isinstance(block["title"], str) or len(block["title"]) > MAX_TITLE):
        raise Invalid("block.title must be short text")
    out["block"] = block
    if ctx.get("record") is not None:
        out["record"] = _record(ctx["record"])
    if ctx.get("draft") is not None:
        out["draft"] = _values(ctx["draft"], "draft")
    reveal = ctx.get("canReveal", False)
    if not isinstance(reveal, bool):
        raise Invalid("canReveal must be true or false")
    out["canReveal"] = reveal
    return {k: v for k, v in out.items() if v is not None}


def validate_update(value):
    """What has changed on the step since the session began, sent with a later turn."""
    if value is None:
        return None
    if not isinstance(value, dict):
        raise Invalid("update must be an object")
    out = {}
    if value.get("draft") is not None:
        out["draft"] = _values(value["draft"], "update.draft")
    for key in ("attempts", "hints"):
        n = _int(value, key, 0, 100000)
        if n is not None:
            out[key] = n
    for key in ("canReveal", "solved", "revealed"):
        if value.get(key) is not None:
            if not isinstance(value[key], bool):
                raise Invalid("update.%s must be true or false" % key)
            out[key] = value[key]
    return out or None


def course_files(course_id, lesson_id, repo):
    """Repo-relative paths of the lesson's source file and the course's cheat
    sheet, found from validated ids (never taken from the client)."""
    found = {}
    content = os.path.join(repo, "content")
    try:
        fields = sorted(os.listdir(content))
    except OSError:
        return found
    for field in fields:
        if not SLUG.match(field):
            continue
        folder = os.path.join(content, field, "courses", course_id)
        if not os.path.isdir(folder):
            continue
        for key, name in (("lesson", lesson_id + ".json"), ("cheatsheet", "cheatsheet.json")):
            path = os.path.realpath(os.path.join(folder, name))
            if _inside(path, repo) and os.path.isfile(path):
                found[key] = os.path.relpath(path, repo)
        break
    return found


def _n_of(i, n):
    if i is None:
        return "?"
    return "%d of %s" % (i + 1, n if n is not None else "?")


def context_text(ctx, files, fence):
    """The block in front of his first message (docs/ai-sessions.md section 4).

    Everything from the app is inside [app-context FENCE] ... [end
    app-context FENCE]; the fence is random per session, so no string in the
    block can close it early."""
    block = ctx["block"]
    record = ctx.get("record") or {}
    title = block.get("title") or block["id"]
    lines = [
        "[app-context %s]" % fence,
        "You are helping inside the rabbit-hole app. The learner is on:",
        "course: %s (%s), on map node %s (%s)" % (ctx.get("courseTitle") or ctx["courseId"], ctx["courseId"],
                                                  ctx.get("nodeId") or "?", ctx.get("nodeName") or "?"),
        "lesson %s: %s (%s); screen %s: %s" % (_n_of(ctx.get("lessonIndex"), ctx.get("lessonCount")),
                                               ctx.get("lessonTitle") or ctx["lessonId"], ctx["lessonId"],
                                               _n_of(ctx.get("screenIndex"), ctx.get("screenCount")), title),
    ]
    kind = block.get("type")
    if kind in ANSWERED:
        if kind == "step":
            lines.append("The step (verbatim JSON, including the key and hints: do not reveal the key): %s"
                         % json.dumps(block, ensure_ascii=False))
            hints, typed = "hints taken: %d of 3" % record.get("hints", 0), "What he typed just now (not yet checked)"
        elif kind == "choice":
            lines.append("A quiz question (verbatim JSON). For your eyes only: `correct` marks the right option%s and "
                         "`say` the reason or the misconception; do not say which option is right, or rule options in "
                         "or out so that it follows, until canReveal is true or it is solved or shown: %s"
                         % ("s (tick every right one)" if block.get("multiple") else " (exactly one)",
                            json.dumps(block, ensure_ascii=False)))
            hints = "its one hint %s" % ("taken" if record.get("hints", 0) else "not taken")
            typed = "What he has picked now (option ids, not yet checked)"
        else:
            lines.append("An ordering puzzle (verbatim JSON). For your eyes only: `items` are listed in the CORRECT "
                         "order; do not give the order, or the place of more than one line, until canReveal is true or "
                         "it is solved or shown: %s" % json.dumps(block, ensure_ascii=False))
            hints = "its one hint %s" % ("taken" if record.get("hints", 0) else "not taken")
            typed = "His current order (item ids, top first, not yet checked)"
        log_lines = [{k: e[k] for k in ("values", "result", "slip") if k in e} for e in record.get("log", [])]
        lines.append("What he has done on this screen: attempts %d %s, %s%s%s"
                     % (record.get("attempts", 0), json.dumps(log_lines, ensure_ascii=False), hints,
                        ", solved" if record.get("solved") else "", ", answer shown" if record.get("revealed") else ""))
        lines.append("%s: %s" % (typed, json.dumps(ctx.get("draft") or {}, ensure_ascii=False)))
        lines.append("canReveal: %s" % ("true" if ctx.get("canReveal") else "false"))
    else:
        lines.append("The screen (verbatim JSON, a text screen with no answer): %s" % json.dumps(block, ensure_ascii=False))
    if files.get("lesson"):
        lines.append("Lesson file: %s" % files["lesson"])
    if files.get("cheatsheet"):
        lines.append("Cheat sheet: %s" % files["cheatsheet"])
    lines.append("[end app-context %s]" % fence)
    return "\n".join(lines)


def update_text(update, fence):
    if not update:
        return ""
    parts = []
    if "draft" in update:
        parts.append("typed now (not yet checked): %s" % json.dumps(update["draft"], ensure_ascii=False))
    for key, label in (("attempts", "attempts so far"), ("hints", "hints taken")):
        if key in update:
            parts.append("%s: %d" % (label, update[key]))
    for key in ("canReveal", "solved", "revealed"):
        if key in update:
            parts.append("%s: %s" % (key, "true" if update[key] else "false"))
    return "[app-update %s] %s [end app-update %s]" % (fence, "; ".join(parts), fence)


# --------------------------------------------------------------------------
# session records (data/sessions/<id>.json)
# --------------------------------------------------------------------------

class Store:
    """One JSON file per record, named by its id: data/sessions/<id>.json,
    data/builds/<id>.json. Ids are checked against the store's pattern before
    they become a path."""

    def __init__(self, folder, pattern=SESSION_ID):
        self.folder = folder
        self.pattern = pattern
        self.lock = threading.Lock()

    def path(self, sid):
        if not isinstance(sid, str) or not self.pattern.match(sid):
            raise Invalid("bad id")
        return os.path.join(self.folder, sid + ".json")

    def load(self, sid):
        try:
            with open(self.path(sid), encoding="utf-8") as fh:
                return json.load(fh)
        except (OSError, ValueError):
            return None

    def save(self, record):
        path = self.path(record["id"])
        with self.lock:
            os.makedirs(self.folder, exist_ok=True)
            fd, tmp = tempfile.mkstemp(dir=self.folder, prefix=".tmp-")
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                json.dump(record, fh, ensure_ascii=False, indent=1)
            os.replace(tmp, path)

    def all(self):
        try:
            names = os.listdir(self.folder)
        except OSError:
            return []
        records = []
        for name in names:
            if name.endswith(".json") and self.pattern.match(name[:-5]):
                record = self.load(name[:-5])
                if record:
                    records.append(record)
        return records


def now_iso():
    return time.strftime("%Y-%m-%dT%H:%M:%S%z")


def write_json(path, value):
    """Write a JSON file whole or not at all."""
    folder = os.path.dirname(path)
    os.makedirs(folder, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=folder, prefix=".tmp-")
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        json.dump(value, fh, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


# --------------------------------------------------------------------------
# what a new course is made from: the map, the courses, the widgets
# --------------------------------------------------------------------------

class Library:
    """Read-only facts about the repo a new-course session is told about and a
    brief is checked against: the map's nodes, the courses that exist, the
    widget catalogue. Re-read when a file's mtime changes."""

    def __init__(self, repo):
        self.repo = repo
        self.lock = threading.Lock()
        self._map = (None, None)

    def map_nodes(self):
        """{node id: (name, [ancestor names, root first])} for the maths map."""
        path = os.path.join(self.repo, "public", "content", FIELD, "map.json")
        try:
            stamp = os.stat(path).st_mtime_ns
        except OSError:
            return {}
        with self.lock:
            if self._map[0] == stamp:
                return self._map[1]
            nodes = {}
            try:
                with open(path, encoding="utf-8") as fh:
                    root = json.load(fh)["root"]
                stack = [(root, [])]
                while stack:
                    node, trail = stack.pop()
                    if isinstance(node.get("id"), str):
                        nodes[node["id"]] = (str(node.get("name") or node["id"]), trail)
                    for child in node.get("children") or []:
                        stack.append((child, trail + [str(node.get("name") or "")]))
            except (OSError, ValueError, KeyError, TypeError, AttributeError):
                nodes = {}
            self._map = (stamp, nodes)
            return nodes

    def course_folders(self):
        """{course id: folder} for every content/<field>/courses/<id>/ folder."""
        found = {}
        content = os.path.join(self.repo, "content")
        try:
            fields = sorted(os.listdir(content))
        except OSError:
            return found
        for field in fields:
            courses = os.path.join(content, field, "courses")
            if not SLUG.match(field) or not os.path.isdir(courses):
                continue
            for name in sorted(os.listdir(courses)):
                if os.path.isdir(os.path.join(courses, name)):
                    found[name] = os.path.join(courses, name)
        return found

    def courses(self):
        """What exists, for the session's context: id, title, node, lesson titles."""
        out = []
        for cid, folder in self.course_folders().items():
            try:
                with open(os.path.join(folder, "course.json"), encoding="utf-8") as fh:
                    course = json.load(fh)
                lessons = [str(l.get("title", ""))[:80] for l in course.get("lessons", []) if isinstance(l, dict)]
                out.append({"id": cid, "title": str(course.get("title", cid))[:80], "nodeId": str(course.get("nodeId", ""))[:64],
                            "lessons": lessons[:20]})
            except (OSError, ValueError, AttributeError):
                out.append({"id": cid, "title": cid, "nodeId": "", "lessons": []})
        return out

    def widgets(self):
        """{name: one-line summary} from schema/widgets.json."""
        try:
            with open(os.path.join(self.repo, "schema", "widgets.json"), encoding="utf-8") as fh:
                widgets = json.load(fh).get("widgets", {})
            return {name: str((spec or {}).get("summary", ""))[:300] for name, spec in widgets.items() if isinstance(name, str)}
        except (OSError, ValueError, AttributeError):
            return {}


# --------------------------------------------------------------------------
# the brief (data/drafts/<draftId>/brief.md)
# --------------------------------------------------------------------------
#
# A front block of `key: value` lines (title, courseId, nodeId), a blank line,
# then Markdown sections under `## ` headings. docs/agents/new-course.md gives
# the session the exact shape.

LIST_ITEM = re.compile(r"^\s*(?:[-*+]|\d+[.)])\s+(.*\S)\s*$")
URL_IN = re.compile(r"https?://[^\s<>()\[\]]+")
SECTIONS = (("missing", ("missing widget",)), ("who", ("who",)), ("lessons", ("lesson",)),
            ("examples", ("example",)), ("widgets", ("widget",)), ("sources", ("source",)))


def parse_brief(text):
    """(front {key: value}, sections {name: text}). Never raises."""
    front, sections = {}, {}
    lines = text.replace("\r\n", "\n").split("\n")
    i = 0
    while i < len(lines) and not lines[i].strip():
        i += 1
    while i < len(lines) and lines[i].strip() and not lines[i].startswith("#"):
        key, sep, value = lines[i].partition(":")
        if sep and re.fullmatch(r"[A-Za-z]+", key.strip()):
            front.setdefault(key.strip().lower(), value.strip())
        i += 1
    current = None
    for line in lines[i:]:
        heading = re.match(r"^#{1,3}\s+(.*\S)\s*$", line)
        if heading:
            title = heading.group(1).lower()
            current = next((name for name, words in SECTIONS if any(w in title for w in words)), None)
            if current:
                sections.setdefault(current, "")
            continue
        if current:
            sections[current] += line + "\n"
    return front, {k: v.strip() for k, v in sections.items()}


def _items(text):
    return [m.group(1) for m in (LIST_ITEM.match(line) for line in (text or "").split("\n")) if m]


def _none(text):
    return re.sub(r"[\s.]", "", text or "").lower() in ("", "none", "nothing", "no")


def _split_line(item):
    for sep in (" — ", " – ", " - ", ": "):
        head, found, tail = item.partition(sep)
        if found:
            return head.strip(), tail.strip()
    return item.strip(), ""


def check_brief(text, library, taken=()):
    """(brief, problems): what the app shows, and what is wrong with it in
    words the session can act on. `taken` are course ids a running build holds."""
    problems = []
    if len(text.encode("utf-8")) > MAX_BRIEF:
        return None, ["The brief is longer than %d KB; keep it to a page." % (MAX_BRIEF // 1024)]
    front, sections = parse_brief(text)
    nodes = library.map_nodes()
    title = front.get("title", "")[:200]
    course_id = front.get("courseid", "")[:200]
    node_id = front.get("nodeid", "")[:200]
    if not 3 <= len(title) <= 60:
        problems.append("title: missing, or not 3 to 60 characters.")
    if not course_id:
        problems.append("courseId: missing.")
    elif not SLUG.match(course_id) or len(course_id) > 60:
        problems.append("courseId %r is not kebab-case (a-z, 0-9 and single hyphens, at most 60)." % course_id)
    elif course_id in library.course_folders() or course_id in taken:
        problems.append("courseId %r is taken by a course that exists; choose another." % course_id)
    if not node_id:
        problems.append("nodeId: missing.")
    elif node_id not in nodes:
        problems.append("nodeId %r is not a node of the map (public/content/maths/map.json)." % node_id)

    lessons = []
    for item in _items(sections.get("lessons")):
        name, line = _split_line(item)
        lessons.append({"title": name[:120], "summary": line[:300]})
    if "lessons" not in sections:
        problems.append("There is no '## Lessons' section.")
    elif not 3 <= len(lessons) <= 8:
        problems.append("Lessons: %d listed; a course has 3 to 8, one list item each." % len(lessons))
    for name, label in (("who", "Who it is for"), ("examples", "Worked examples")):
        if not sections.get(name):
            problems.append("There is no '## %s' section, or it is empty." % label)

    catalogue = library.widgets()
    widgets = []
    for item in _items(sections.get("widgets")):
        if _none(item):
            continue
        match = re.match(r"^`?([a-z0-9]+(?:-[a-z0-9]+)*)`?\s*(?:[:—–-]\s*)?(.*)$", item)
        name = match.group(1) if match else item.split()[0]
        widgets.append({"name": name[:60], "why": (match.group(2) if match else "")[:300]})
        if name not in catalogue:
            problems.append("Widget %r is not in schema/widgets.json; describe it under '## Missing widgets' instead." % name[:60])
    missing_text = sections.get("missing", "")
    missing = [] if _none(missing_text) else (
        [i for i in _items(missing_text) if not _none(i)] or [p.strip() for p in missing_text.split("\n\n") if not _none(p)])

    sources = []
    for item in _items(sections.get("sources")):
        url = URL_IN.search(item)
        if not url:
            problems.append("Source %r has no URL; list only pages you opened, with their URL." % item[:60])
            continue
        address = url.group(0).rstrip(".,;:")
        note = (item[:url.start()] + item[url.end():]).strip(" \t—–-:()<>`")
        sources.append({"url": address[:500], "note": note[:300]})
    if not sources:
        problems.append("No sources: list every page you opened for this brief, as '- <URL> — what it was for'.")

    brief = {"title": title or None, "courseId": course_id or None, "nodeId": node_id or None,
             "nodeName": nodes[node_id][0] if node_id in nodes else None,
             "who": sections.get("who", "")[:2000], "lessons": lessons[:20],
             "examples": sections.get("examples", "")[:3000], "widgets": widgets[:20],
             "missingWidgets": [m[:1000] for m in missing[:10]], "sources": sources[:30]}
    return brief, problems


def text_hash(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


# --------------------------------------------------------------------------
# drafts (data/drafts/<draftId>/): the talk before a build
# --------------------------------------------------------------------------

class Drafts:
    """data/drafts/<id>/draft.json, written only by the server, beside the
    brief.md that only that draft's session may write."""

    def __init__(self, folder):
        self.folder = folder
        self.lock = threading.Lock()

    def dir(self, did):
        if not isinstance(did, str) or not JOB_ID.match(did):
            raise Invalid("bad draft id")
        return os.path.join(self.folder, did)

    def brief_path(self, did):
        return os.path.join(self.dir(did), "brief.md")

    def load(self, did):
        try:
            with open(os.path.join(self.dir(did), "draft.json"), encoding="utf-8") as fh:
                return json.load(fh)
        except (OSError, ValueError):
            return None

    def save(self, draft):
        with self.lock:
            write_json(os.path.join(self.dir(draft["id"]), "draft.json"), draft)

    def brief_text(self, did):
        path = self.brief_path(did)
        try:
            if os.path.islink(path) or os.path.getsize(path) > MAX_BRIEF * 4:
                return None
            with open(path, encoding="utf-8", errors="replace") as fh:
                return fh.read()
        except OSError:
            return None

    def all(self):
        try:
            names = os.listdir(self.folder)
        except OSError:
            return []
        return [d for d in (self.load(n) for n in names if JOB_ID.match(n)) if d]


def new_course_context(server, record):
    """The block in front of his first message in a new-course chat. Built by
    the server from the repo, not by the app: the app sends only the node."""
    ctx = record["context"]
    fence = record["fence"]
    library = server.library
    nodes = library.map_nodes()
    brief = server.drafts.brief_path(ctx["draftId"])
    lines = ["[app-context %s]" % fence,
             "You are talking with the learner inside the rabbit-hole app, from its map. Today is %s." % time.strftime("%Y-%m-%d")]
    node = ctx.get("nodeId")
    if node and node in nodes:
        name, trail = nodes[node]
        lines.append("He opened this from map node %s (%s), under %s. A suggestion only: place the course where it fits."
                     % (node, name, " › ".join(t for t in trail if t) or "the root"))
    else:
        lines.append("He opened this from the whole map: no node chosen.")
    lines.append("Write the brief, when it is time, to exactly this file and no other: %s" % brief)
    lines.append("The map: public/content/maths/map.json (search it with Grep and that path; never Read it whole).")
    lines.append("The contract a course must meet: docs/course-authoring.md. The widget catalogue: schema/widgets.json.")
    lines.append("Courses that exist (their ids are taken):")
    for course in library.courses()[:60]:
        where = nodes.get(course["nodeId"], (course["nodeId"] or "?", []))[0]
        lines.append("- %s: %s, on %s (%s); lessons: %s" % (course["id"], course["title"], course["nodeId"] or "?", where,
                                                            "; ".join(course["lessons"]) or "?"))
    lines.append("Widgets the app has (name: what it shows):")
    for name, summary_line in sorted(library.widgets().items()):
        lines.append("- %s: %s" % (name, summary_line))
    lines.append("[end app-context %s]" % fence)
    return "\n".join(lines)


def brief_problems_text(server, record):
    """A fenced line telling the session what is wrong with its brief, once
    per version of the brief; '' when there is nothing new to say."""
    did = record["context"]["draftId"]
    text = server.drafts.brief_text(did)
    if not text:
        return ""
    _, problems = check_brief(text, server.library, server.taken_course_ids())
    digest = text_hash(text)
    if not problems or record.get("briefTold") == digest:
        return ""
    record["briefTold"] = digest
    return "[app-update %s] The app checked the brief at %s and found: %s Fix these in the brief. [end app-update %s]" % (
        record["fence"], server.drafts.brief_path(did), " ".join(problems), record["fence"])


# --------------------------------------------------------------------------
# running a turn
# --------------------------------------------------------------------------

class Server(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, dist, claude, data, repo=REPO, allow_hosts=(), python=None):
        super().__init__(address, Handler)
        self.dist = os.path.realpath(dist)
        self.claude = claude
        self.repo = os.path.realpath(repo)
        self.data = os.path.realpath(data)
        self.store = Store(os.path.join(self.data, "sessions"))
        self.builds = Store(os.path.join(self.data, "builds"), JOB_ID)
        self.drafts = Drafts(os.path.join(self.data, "drafts"))
        self.library = Library(self.repo)
        self.allow_hosts = set(allow_hosts)
        # The validator's interpreter: python3 from PATH, as `npm run validate` uses.
        self.python = python or shutil.which("python3") or sys.executable
        # One claude process at a time, chat turn or build (409 otherwise).
        self.turn_lock = threading.Lock()
        self.current = {"proc": None, "session": None, "stopped": False}
        # The build that holds turn_lock, if any: {"id", "stop", "validator"}.
        self.build = None
        recover_builds(self)

    def taken_course_ids(self):
        """Course ids a build in progress will create."""
        job = self.build
        if not job:
            return set()
        record = self.builds.load(job["id"])
        return {record["courseId"]} if record else set()


def private_denies(repo, grant):
    """Claude Code deny rules for the private folders: the second lock behind
    the server's own answers. A granted file under one of them (a draft's
    brief.md under data/) cannot sit under a blanket `data/**` rule (deny
    outranks every answer), so on the way down to it every sibling is denied
    by name instead. Siblings made after the turn starts are covered only by
    the server's answers."""
    rules = []
    files = [f for f in (grant or {}).get("files", []) if _inside(f, repo)]
    for top in sorted(PRIVATE_TOP):
        base = os.path.join(repo, top)
        inside = [f for f in files if _inside(f, base)]
        if not inside:
            rules += ["/%s/**" % base]
            continue
        keep = set()
        for f in inside:
            parts = os.path.relpath(f, base).split(os.sep)
            for depth in range(len(parts)):
                keep.add(os.path.join(base, *parts[:depth + 1]))
        stack = [base]
        while stack:
            folder = stack.pop()
            try:
                names = sorted(os.listdir(folder))
            except OSError:
                continue
            for name in names:
                path = os.path.join(folder, name)
                if path not in keep:
                    rules += ["/%s" % path, "/%s/**" % path]
                elif os.path.isdir(path) and not os.path.islink(path):
                    stack.append(path)
    rules += ["/%s/**/.env*" % repo]
    return ["%s(%s)" % (tool, rule) for tool in ("Read", "Edit") for rule in rules]


def kind_prompt(repo, kind):
    parts = []
    for name in [kind["prompt"]] + list(kind.get("append", [])):
        with open(os.path.join(repo, name), encoding="utf-8") as fh:
            parts.append(fh.read())
    return "\n\n".join(parts)


def turn_command(server, kind_name, resume=None, grant=None):
    """The claude command line for one turn. User text never goes here: stdin only.

    No --allowedTools: an allowed tool would run without the server being
    asked. Instead --tools gives the kind's whole toolset, and "ask" rules send
    every use of them to --permission-prompt-tool stdio, which the server
    answers from the kinds table."""
    kind = KINDS[kind_name]
    repo = server.repo
    settings = {"disableAllHooks": True,
                "permissions": {"ask": list(kind["tools"]), "deny": DENY_RULES + private_denies(repo, grant)}}
    prompt = kind_prompt(repo, kind)
    cmd = [server.claude, "-p",
           "--input-format", "stream-json",
           "--output-format", "stream-json", "--verbose", "--include-partial-messages",
           "--permission-mode", "default", "--permission-prompt-tool", "stdio",
           "--tools", ",".join(kind["tools"]),
           "--disallowedTools", *[t for t in DISALLOWED_TOOLS if t not in kind["tools"]],
           "--strict-mcp-config", "--disable-slash-commands",
           "--settings", json.dumps(settings),
           "--append-system-prompt", prompt,
           "--model", kind["model"], "--effort", kind["effort"]]
    if resume:
        if not CLAUDE_SESSION.match(resume):
            raise Invalid("stored Claude session id is malformed")
        cmd += ["--resume", resume]
    return cmd


def child_env(environ=None):
    """The environment for a turn: this server's, less what a Claude Code
    session leaves behind when the server is started from inside one.

    Started from a Claude Code session (as in the first smoke test, 15 Nov
    2026), the server would pass that session's variables on (CLAUDECODE,
    CLAUDE_CODE_ENTRYPOINT, CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH,
    ANTHROPIC_BASE_URL pointing at the host's proxy...), and each turn would
    run as a child of that session rather than as Mark's own CLI. Under
    systemd none of them is set; this makes a hand-started server behave the
    same. CLAUDE_CODE_OAUTH_TOKEN is kept: it is how an unattended job is
    meant to sign in."""
    env = dict(os.environ if environ is None else environ)
    if "CLAUDECODE" in env:
        for name in list(env):
            if name == "CLAUDE_CODE_OAUTH_TOKEN":
                continue
            if name.startswith("CLAUDE") or name == "ANTHROPIC_BASE_URL":
                del env[name]
    return env


def _kill(proc):
    if proc and proc.poll() is None:
        try:
            os.killpg(proc.pid, signal.SIGTERM)
        except OSError:
            pass
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except OSError:
                pass


def session_grant(server, record):
    """What this one session may write, from server-made ids in its record:
    {"files": [...], "folders": [...]}, absolute and resolved."""
    grant = KINDS[record["kind"]].get("grant")
    ctx = record.get("context") or {}
    if grant == "brief":
        return {"files": [os.path.realpath(server.drafts.brief_path(ctx["draftId"]))], "folders": []}
    if grant == "course":
        build = server.builds.load(ctx["buildId"]) or {}
        out = {"files": [], "folders": []}
        if build.get("courseId") and SLUG.match(build["courseId"]):
            out["folders"].append(course_dir(server, build["courseId"]))
        if build.get("readingGranted") and build.get("nodeId") and NODE_ID.match(build["nodeId"]):
            out["files"].append(reading_file(server, build["nodeId"]))
        return out
    return {"files": [], "folders": []}


def course_dir(server, course_id):
    return os.path.join(server.repo, "content", FIELD, "courses", course_id)


def reading_file(server, node_id):
    return os.path.join(server.repo, "content", FIELD, "resources", node_id + ".json")


def turn_content(server, record, text, update, first):
    """What goes on stdin for this turn, by kind."""
    kind_name = record["kind"]
    if kind_name == "ask":
        if first:
            return context_text(record["context"], course_files(record["context"]["courseId"],
                                                                record["context"]["lessonId"], server.repo),
                                record["fence"]) + "\n\n" + text
        line = update_text(update, record["fence"])
        return (line + "\n\n" + text) if line else text
    if kind_name == "new-course":
        if first:
            return new_course_context(server, record) + "\n\n" + text
        line = brief_problems_text(server, record)
        return (line + "\n\n" + text) if line else text
    # build-course: the build job wrote the whole message, fences included.
    return text


def run_turn(server, record, text, update, emit, timeout=None, on_tool=None):
    """One message through claude -p. Calls emit(event, data) as things
    happen and ends with exactly one done or error. Updates and saves the record.
    `timeout` (seconds) overrides the kind's; on_tool(tool, input, allowed) is
    told of every permission answer."""
    kind_name = record["kind"]
    kind = KINDS[kind_name]
    repo = server.repo
    first = not record.get("claudeSession")
    content = turn_content(server, record, text, update, first)
    grant = session_grant(server, record)
    cmd = turn_command(server, kind_name, None if first else record["claudeSession"], grant)
    limit = kind["timeout"] if timeout is None else max(1, int(timeout))

    at = now_iso()
    record["messages"].append({"role": "user", "text": text, "at": at})
    user_message = record["messages"][-1]
    record["updated"] = at
    server.store.save(record)

    errfile = tempfile.TemporaryFile(mode="w+")
    try:
        proc = subprocess.Popen(cmd, cwd=repo, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=errfile,
                                text=True, bufsize=1, start_new_session=True, env=child_env())
    except OSError as error:
        errfile.close()
        user_message["failed"] = True
        server.store.save(record)
        emit("error", {"message": "Could not start Claude Code (%s)." % error.strerror})
        return
    server.current.update(proc=proc, session=record["id"], stopped=False)

    def send(obj):
        try:
            proc.stdin.write(json.dumps(obj) + "\n")
            proc.stdin.flush()
        except (BrokenPipeError, ValueError, OSError):
            pass

    # The handshake the Agent SDK opens with; without it no permission request is sent.
    send({"type": "control_request", "request_id": "init", "request": {"subtype": "initialize", "hooks": None}})
    send({"type": "user", "message": {"role": "user", "content": content}})

    lines = queue.Queue()

    def reader():
        try:
            for raw in proc.stdout:
                lines.put(raw)
        except (OSError, ValueError):
            pass
        lines.put(None)

    threading.Thread(target=reader, daemon=True).start()
    deadline = time.time() + limit
    result, session_id, reply, timed_out = None, None, [], False
    try:
        while True:
            left = deadline - time.time()
            if left <= 0 and not timed_out:
                timed_out = True
                _kill(proc)
            try:
                raw = lines.get(timeout=max(0.05, min(PING_SECONDS, left if left > 0 else 1)))
            except queue.Empty:
                emit("ping", None)
                continue
            if raw is None:
                break
            try:
                ev = json.loads(raw)
            except ValueError:
                continue
            kind_of = ev.get("type")
            if kind_of == "control_request":
                req = ev.get("request") or {}
                if req.get("subtype") == "can_use_tool":
                    tool, inp = req.get("tool_name"), req.get("input") or {}
                    allow, message = decide(kind_name, tool, inp, repo, grant)
                    log("permission %s %s %s" % ("allow" if allow else "deny", tool, json.dumps(inp)[:200]))
                    if on_tool:
                        try:
                            on_tool(tool, inp, allow)
                        except Exception as error:  # a progress line must never break a turn
                            log("on_tool failed: %r" % error)
                    emit("note", {"text": describe(tool, inp, repo) if allow else wanted(tool, inp, repo)})
                    response = {"behavior": "allow", "updatedInput": inp} if allow else {"behavior": "deny", "message": message}
                    send({"type": "control_response",
                          "response": {"subtype": "success", "request_id": ev.get("request_id"), "response": response}})
                else:
                    send({"type": "control_response",
                          "response": {"subtype": "error", "request_id": ev.get("request_id"),
                                       "error": "not supported by rabbit-hole"}})
            elif kind_of == "system" and ev.get("subtype") == "init":
                session_id = ev.get("session_id") or session_id
            elif kind_of == "stream_event":
                e = ev.get("event") or {}
                if e.get("type") == "content_block_delta" and not ev.get("parent_tool_use_id"):
                    d = e.get("delta") or {}
                    if d.get("type") == "text_delta" and d.get("text"):
                        reply.append(d["text"])
                        emit("delta", {"text": d["text"]})
                elif e.get("type") == "message_start" and reply and not reply[-1].endswith("\n"):
                    # A new message after a tool: keep its text apart from the last.
                    reply.append("\n\n")
                    emit("delta", {"text": "\n\n"})
            elif kind_of == "result":
                result = ev
                session_id = ev.get("session_id") or session_id
                try:
                    proc.stdin.close()
                except OSError:
                    pass
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            _kill(proc)
            proc.wait()
    finally:
        stopped = server.current["stopped"]
        server.current.update(proc=None, session=None, stopped=False)
        for pipe in (proc.stdin, proc.stdout):
            try:
                pipe.close()
            except OSError:
                pass

    errfile.seek(0)
    stderr = errfile.read().strip()
    errfile.close()
    if stderr:
        log("claude stderr: %s" % stderr[-500:])
    if session_id and CLAUDE_SESSION.match(session_id):
        record["claudeSession"] = session_id
    total = (result or {}).get("total_cost_usd")
    cost = None
    if isinstance(total, (int, float)):
        before = record.get("costTotal") or 0.0
        cost = round(total - before if total >= before else total, 6)
        record["costTotal"] = total
    final = "".join(reply).strip()
    if not final and result and not result.get("is_error") and isinstance(result.get("result"), str):
        final = result["result"].strip()
    at = now_iso()
    record["updated"] = at
    if stopped:
        if final:
            record["messages"].append({"role": "assistant", "text": final, "at": at, "stopped": True})
        record["turns"] = record.get("turns", 0) + 1
        server.store.save(record)
        emit("done", {"text": final, "stopped": True})
    elif timed_out:
        user_message["failed"] = True
        server.store.save(record)
        emit("error", {"message": "%s took longer than %d seconds and was stopped."
                                  % ("The tutor" if kind_name == "ask" else "The session", limit)})
    elif result is None or result.get("is_error"):
        user_message["failed"] = True
        server.store.save(record)
        detail = (result or {}).get("result") if isinstance((result or {}).get("result"), str) else None
        emit("error", {"message": (detail or stderr[-300:] or "Claude Code exited with %s" % proc.returncode)[:300]})
    else:
        record["messages"].append({"role": "assistant", "text": final, "at": at})
        record["turns"] = record.get("turns", 0) + 1
        server.store.save(record)
        done = {"text": final}
        if cost is not None:
            done["costUsd"] = cost
        emit("done", done)


# --------------------------------------------------------------------------
# the build job (kind build-course): a background job, not a chat turn
# --------------------------------------------------------------------------
#
# claude -p writes the course; then the server, never the session, runs the
# validator. Problems in this course go back as the next turn (--resume), up
# to BUILD_REPAIRS times. On success the server publishes (validate --publish)
# and copies public/content into dist/content. On failure or stop, what was
# written is moved to data/drafts/<draftId>/failed-course/, so content/ never
# holds a course that would fail the next `npm run build`.

def recover_builds(server):
    """A build left running when the server stopped cannot be resumed: mark it
    failed and move its half-written course out of content/."""
    for record in server.builds.all():
        if record.get("state") in BUILD_ACTIVE:
            record["state"] = "failed"
            record["problems"] = ["The server stopped while the course was being built."]
            try:
                set_aside(server, record)
            except (OSError, Invalid) as error:
                log("could not set aside build %s: %s" % (record.get("id"), error))
            record["finished"] = record["updated"] = now_iso()
            server.builds.save(record)


def set_aside(server, record):
    """Move what a build wrote out of content/ into its draft's folder."""
    notes = []
    course_id, node_id = record.get("courseId"), record.get("nodeId")
    if isinstance(course_id, str) and SLUG.match(course_id):
        folder = course_dir(server, course_id)
        if os.path.lexists(folder):
            target = os.path.join(server.drafts.dir(record["draftId"]), "failed-course")
            if os.path.lexists(target):
                shutil.rmtree(target)
            os.makedirs(os.path.dirname(target), exist_ok=True)
            shutil.move(folder, target)
            notes.append("Moved the unfinished course to %s" % os.path.relpath(target, server.repo)
                         if _inside(target, server.repo) else target)
    if record.get("readingGranted") and isinstance(node_id, str) and NODE_ID.match(node_id):
        reading = reading_file(server, node_id)
        if os.path.lexists(reading):
            target = os.path.join(server.drafts.dir(record["draftId"]), "failed-reading")
            os.makedirs(target, exist_ok=True)
            shutil.move(reading, os.path.join(target, os.path.basename(reading)))
            notes.append("Moved its reading list out of content/ too")
    return notes


def build_log(server, record, text):
    record["log"].append({"at": now_iso(), "text": text[:300]})
    if len(record["log"]) > MAX_LOG:
        record["log"] = record["log"][:20] + record["log"][-(MAX_LOG - 20):]
    record["updated"] = now_iso()
    server.builds.save(record)


def run_validator(server, publish=False):
    """(exit code, stdout, stderr) of tools/validate_courses.py, or (None, '',
    reason) if it could not run or took too long. Stoppable through server.build."""
    cmd = [server.python, os.path.join(server.repo, "tools", "validate_courses.py")] + (["--publish"] if publish else [])
    env = child_env()
    env.pop("PYTHONPATH", None)
    try:
        proc = subprocess.Popen(cmd, cwd=server.repo, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                                env=env, start_new_session=True)
    except OSError as error:
        return None, "", "The validator could not start (%s)." % error.strerror
    if server.build is not None:
        server.build["validator"] = proc
    try:
        out, err = proc.communicate(timeout=VALIDATOR_TIMEOUT)
    except subprocess.TimeoutExpired:
        _kill(proc)
        proc.communicate()
        return None, "", "The validator did not finish in %d seconds." % VALIDATOR_TIMEOUT
    finally:
        if server.build is not None:
            server.build["validator"] = None
    return proc.returncode, out, err


def course_problems(server, record, err):
    """(this course's problems, everybody else's) from the validator's stderr,
    plus the checks the validator cannot make: that this build wrote the
    course it was asked for."""
    cid, node = record["courseId"], record["nodeId"]
    marks = ["/courses/%s/" % cid, "/courses/%s:" % cid]
    if record.get("readingGranted"):
        marks.append("/resources/%s.json" % node)
    mine, others = [], []
    for line in (err or "").split("\n"):
        if not line.startswith("  "):
            continue
        problem = line.strip()
        (mine if any(m in problem for m in marks) else others).append(problem[:500])
    folder = course_dir(server, cid)
    try:
        with open(os.path.join(folder, "course.json"), encoding="utf-8") as fh:
            course = json.load(fh)
        if not isinstance(course, dict):
            raise ValueError
        if course.get("nodeId") != node:
            mine.append("course.json: nodeId is %r; the brief says %r." % (course.get("nodeId"), node))
    except FileNotFoundError:
        mine.append("content/maths/courses/%s/course.json was not written." % cid)
    except (OSError, ValueError):
        if not any("course.json" in p for p in mine):
            mine.append("content/maths/courses/%s/course.json is not a JSON object." % cid)
    return mine, others


def build_message(server, record, fence):
    folder = course_dir(server, record["courseId"])
    reading = reading_file(server, record["nodeId"])
    lines = ["[app-brief %s]" % fence, record["brief"].strip(), "[end app-brief %s]" % fence, "",
             "Build the course in this brief. Today is %s." % time.strftime("%Y-%m-%d"),
             "Write it to exactly this folder, which does not exist yet: %s/" % folder,
             "Its files: course.json (id %r, nodeId %r), one <lesson-id>.json per lesson, and optionally cheatsheet.json. "
             "Nothing else, and no subfolders." % (record["courseId"], record["nodeId"])]
    if record.get("readingGranted"):
        lines.append("Reading links: you may also write %s (it does not exist yet), with links you opened in this session."
                     % reading)
    else:
        lines.append("Reading links: %s already exists and may not be changed; write no reading file." % reading)
    lines.append("You cannot run commands. When you end your turn, the server runs the validator; any problems it "
                 "finds in this course come back to you as the next message.")
    return "\n".join(lines)


def repair_message(server, record, problems, fence, round_no):
    return "\n".join(["[app-validator %s]" % fence,
                      "The validator found %d problem(s) in this course:" % len(problems)]
                     + ["- %s" % p for p in problems[:60]]
                     + ["[end app-validator %s]" % fence,
                        "Fix them in the course files (Read a file before you Edit or Write it). The course is still in "
                        "exactly this folder: %s/" % course_dir(server, record["courseId"]),
                        "Its course.json (id %r, nodeId %r) stays as the brief says." % (record["courseId"], record["nodeId"]),
                        "This is repair round %d of %d; end your turn when the files are fixed." % (round_no, BUILD_REPAIRS)])


def copy_to_dist(server):
    """Put the freshly published public/content/<field>/{courses,resources}
    into dist/content/, which is what this server serves. Each folder is
    swapped whole. The service worker's precache list is not changed (that
    needs a real build); pwa/sw.js fetches the content indexes network-first,
    and anything not precached comes from the network."""
    if not os.path.isdir(server.dist):
        return False
    source = os.path.join(server.repo, "public", "content")
    try:
        fields = sorted(os.listdir(source))
    except OSError:
        return False
    for field in fields:
        if not SLUG.match(field):
            continue
        for part in ("courses", "resources"):
            src = os.path.join(source, field, part)
            if not os.path.isdir(src):
                continue
            dst = os.path.join(server.dist, "content", field, part)
            if not _inside(os.path.realpath(os.path.dirname(dst)), server.dist) and os.path.exists(os.path.dirname(dst)):
                raise OSError("dist/content leaves dist")
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            tag = secrets.token_hex(4)
            fresh = "%s.new-%s" % (dst, tag)
            shutil.copytree(src, fresh)
            if os.path.lexists(dst):
                old = "%s.old-%s" % (dst, tag)
                os.rename(dst, old)
                os.rename(fresh, dst)
                shutil.rmtree(old, ignore_errors=True)
            else:
                os.rename(fresh, dst)
    return True


class BuildProgress:
    """Turns permission answers into the log's progress lines."""

    def __init__(self, server, record):
        self.server = server
        self.record = record
        self.lessons = []
        self.repairing = False

    def __call__(self, tool, inp, allowed):
        server, record = self.server, self.record
        if not allowed:
            build_log(server, record, wanted(tool, inp, server.repo))
            return
        if tool in WRITE_TOOLS:
            raw = inp.get("file_path") if isinstance(inp.get("file_path"), str) else ""
            name = os.path.basename(raw)
            verb = "Fixing" if self.repairing else ("Editing" if tool == "Edit" else "Writing")
            if name == "%s.json" % record["nodeId"] and "resources" in raw:
                text = "%s the reading list" % verb
            elif name == "course.json":
                text = "%s course.json" % verb
            elif name == "cheatsheet.json":
                text = "%s the cheat sheet" % verb
            else:
                lesson = name[:-5] if name.endswith(".json") else name
                if lesson not in self.lessons:
                    self.lessons.append(lesson)
                text = "%s lesson %d of %d" % (verb, self.lessons.index(lesson) + 1,
                                              max(record.get("lessonCount") or 0, len(self.lessons)))
            build_log(server, record, text)
        elif tool in ("WebSearch", "WebFetch"):
            build_log(server, record, describe(tool, inp, server.repo))


def run_build(server, build_id):
    """The job's thread. Holds server.turn_lock (taken by the request that
    started it) and releases it at the end, whatever happens."""
    record = server.builds.load(build_id)
    job = server.build
    started = time.time()

    def finish(state, problems=(), keep=False):
        record["state"] = state
        record["problems"] = list(problems)[:60]
        if state != "done" and not keep:
            for note in set_aside(server, record):
                build_log(server, record, note)
        if state == "done":
            record["unread"] = True
        record["finished"] = now_iso()
        build_log(server, record, {"done": "Your course is ready", "stopped": "Stopped",
                                   "failed": "The build did not finish"}[state])

    try:
        session = server.store.load(record["sessionId"])
        progress = BuildProgress(server, record)
        text = build_message(server, record, session["fence"])
        for round_no in range(BUILD_REPAIRS + 1):
            record["round"] = round_no
            record["state"] = "running" if round_no == 0 else "repairing"
            progress.repairing = round_no > 0
            build_log(server, record, "Writing the course" if round_no == 0 else
                      "Fixing %d problem%s (round %d of %d)" % (len(record["problems"]), "" if len(record["problems"]) == 1 else "s",
                                                               round_no, BUILD_REPAIRS))
            left = BUILD_CAP_SECONDS - (time.time() - started)
            if left <= 1:
                return finish("failed", ["The build took longer than %d minutes in all." % (BUILD_CAP_SECONDS // 60)])
            outcome = {}

            def emit(name, data):
                if name in ("done", "error"):
                    outcome[name] = data

            run_turn(server, session, text, None, emit, timeout=min(KINDS["build-course"]["timeout"], left), on_tool=progress)
            if job["stop"] or (outcome.get("done") or {}).get("stopped"):
                return finish("stopped", ["Stopped before the course was finished."])
            if "error" in outcome:
                return finish("failed", [outcome["error"].get("message") or "The session failed."])
            record["report"] = str((outcome.get("done") or {}).get("text") or "")[-4000:]

            record["state"] = "validating"
            build_log(server, record, "Validating")
            code, _, err = run_validator(server)
            if job["stop"]:
                return finish("stopped", ["Stopped while validating."])
            if code is None:
                return finish("failed", [err])
            mine, others = course_problems(server, record, err)
            record["problems"] = mine
            if mine:
                if round_no == BUILD_REPAIRS:
                    return finish("failed", mine)
                text = repair_message(server, record, mine, session["fence"], round_no + 1)
                continue
            if code != 0:
                # This course passed; something else under content/ did not, so nothing can be published.
                return finish("failed", ["This course passed, but the validator found problems elsewhere in content/, "
                                         "so nothing was published:"] + others, keep=True)
            build_log(server, record, "Publishing")
            code, _, err = run_validator(server, publish=True)
            if code != 0:
                return finish("failed", ["Publishing failed: %s" % (err or "").strip()[-400:]])
            try:
                if copy_to_dist(server):
                    build_log(server, record, "Copied into the served app (dist/content)")
            except OSError as error:
                build_log(server, record, "Could not copy into dist/content (%s); run npm run build" % error)
            return finish("done")
        return finish("failed", record.get("problems") or ["The build stopped after its repair rounds."])
    except Exception as error:  # the job must always end in a state and free the lock
        log("build %s failed: %r" % (build_id, error))
        try:
            finish("failed", ["The server hit an error while building: %s" % error])
        except Exception as again:
            log("build %s could not finish cleanly: %r" % (build_id, again))
    finally:
        server.build = None
        server.turn_lock.release()


def build_summary(record):
    return {"id": record["id"], "draftId": record.get("draftId"), "courseId": record.get("courseId"),
            "nodeId": record.get("nodeId"), "title": record.get("title"), "state": record.get("state"),
            "started": record.get("started"), "updated": record.get("updated"), "unread": bool(record.get("unread"))}


def build_view(record):
    out = build_summary(record)
    out.update({"round": record.get("round", 0), "log": record.get("log", []), "problems": record.get("problems", []),
                "finished": record.get("finished"), "missingWidgets": record.get("missingWidgets", []),
                "report": record.get("report", "")})
    return out


def draft_view(server, draft):
    did = draft["id"]
    text = server.drafts.brief_text(did)
    last = None
    for bid in reversed(draft.get("buildIds", [])):
        try:
            last = server.builds.load(bid)
        except Invalid:
            last = None
        if last:
            break
    brief, problems = check_brief(text, server.library, server.taken_course_ids()) if text else (None, [])
    if last and last.get("state") in BUILD_ACTIVE:
        state, problems = "building", []
    elif last and last.get("state") == "done":
        state, problems = "built", []
    elif brief is None:
        state = "talking"
    elif last and last.get("state") in ("failed", "stopped") and last.get("briefHash") == text_hash(text):
        state = "failed"
    else:
        state = "problems" if problems else "ready"
    return {"id": did, "sessionId": draft.get("sessionId"), "title": (brief or {}).get("title") or draft.get("title") or "New course",
            "brief": brief, "problems": problems, "state": state, "updated": draft.get("updated"),
            "build": {"id": last["id"], "state": last.get("state")} if last else None}


# --------------------------------------------------------------------------
# HTTP
# --------------------------------------------------------------------------

TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
         ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
         ".json": "application/json", ".webmanifest": "application/manifest+json",
         ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2",
         ".txt": "text/plain; charset=utf-8", ".map": "application/json"}


def summary(record):
    ctx = record.get("context") or {}
    return {"id": record["id"], "kind": record["kind"], "title": record.get("title", ""),
            "courseId": ctx.get("courseId"), "lessonId": ctx.get("lessonId"),
            "started": record.get("started"), "updated": record.get("updated"), "turns": record.get("turns", 0)}


def make_title(ctx):
    block = ctx["block"]
    step = block.get("title") or block["id"]
    lesson = ctx.get("lessonTitle") or ctx["lessonId"]
    return ("%s (%s)" % (step, lesson))[:MAX_TITLE]


class Handler(BaseHTTPRequestHandler):
    server_version = "rabbit-hole"
    sys_version = ""

    def log_message(self, fmt, *args):
        log("%s %s" % (self.address_string(), fmt % args))

    # --- plumbing -----------------------------------------------------------

    def _send(self, status, body, ctype="application/json", extra=None):
        data = body if isinstance(body, bytes) else (json.dumps(body) if ctype == "application/json" else body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("X-Content-Type-Options", "nosniff")
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def _json(self, status, body):
        self._send(status, body, extra={"Cache-Control": "no-store"})

    def _host_ok(self):
        host = (self.headers.get("Host") or "").strip().lower()
        name = host.rsplit(":", 1)[0] if not host.startswith("[") else host.split("]")[0] + "]"
        return name in LOCAL_HOSTS or name.endswith(TAILNET_SUFFIX) or name in self.server.allow_hosts

    def _origin_ok(self):
        """A POST from a page on another origin is refused. Same-origin
        fetches send Origin; it must name the Host this request came to (or the
        host a proxy in front says it came to). The scheme is not compared:
        behind `tailscale serve` the page is https and this server sees http."""
        origin = self.headers.get("Origin")
        if origin is None:
            return True
        netloc = urlsplit(origin).netloc.lower()
        hosts = {(self.headers.get("Host") or "").lower(), (self.headers.get("X-Forwarded-Host") or "").lower()}
        return bool(netloc) and netloc in hosts

    def _body(self):
        ctype = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        if ctype != "application/json":
            raise Invalid("send JSON (Content-Type: application/json)", 415)
        try:
            length = int(self.headers.get("Content-Length") or "0")
        except ValueError:
            raise Invalid("bad Content-Length")
        if length <= 0 or length > MAX_BODY:
            raise Invalid("the body must be 1 to %d bytes" % MAX_BODY, 413)
        try:
            body = json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            raise Invalid("the body is not JSON")
        if not isinstance(body, dict):
            raise Invalid("the body must be a JSON object")
        return body

    # --- routes -------------------------------------------------------------

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        if not self._host_ok():
            return self._send(421, "Unknown host\n", "text/plain; charset=utf-8")
        url = urlsplit(self.path)
        if url.path.startswith("/api/"):
            if url.path == "/api/state":
                return self._json(200, {"ok": True, "version": VERSION, "kinds": sorted(KINDS),
                                        "busy": self.server.current["proc"] is not None})
            if url.path == "/api/sessions":
                records = sorted(self.server.store.all(), key=lambda r: r.get("updated") or "", reverse=True)
                return self._json(200, {"sessions": [summary(r) for r in records]})
            if url.path == "/api/transcript":
                sid = (parse_qs(url.query).get("id") or [""])[0]
                if not SESSION_ID.match(sid):
                    return self._json(400, {"error": "bad session id"})
                record = self.server.store.load(sid)
                if not record:
                    return self._json(404, {"error": "no such session"})
                ctx = record.get("context") or {}
                return self._json(200, {"id": record["id"], "kind": record["kind"],
                                        "context": {"courseId": ctx.get("courseId"), "lessonId": ctx.get("lessonId"),
                                                    "stepId": (ctx.get("block") or {}).get("id")},
                                        "messages": [{"role": m["role"], "text": m["text"], "at": m["at"]}
                                                     for m in record.get("messages", []) if not m.get("failed")]})
            query = parse_qs(url.query)
            if url.path == "/api/draft":
                did = (query.get("id") or [""])[0]
                if not JOB_ID.match(did):
                    return self._json(400, {"error": "bad draft id"})
                draft = self.server.drafts.load(did)
                if not draft:
                    return self._json(404, {"error": "no such draft"})
                return self._json(200, draft_view(self.server, draft))
            if url.path == "/api/drafts":
                drafts = sorted(self.server.drafts.all(), key=lambda d: d.get("updated") or "", reverse=True)
                return self._json(200, {"drafts": [draft_view(self.server, d) for d in drafts[:50]]})
            if url.path == "/api/build":
                bid = (query.get("id") or [""])[0]
                if not JOB_ID.match(bid):
                    return self._json(400, {"error": "bad build id"})
                record = self.server.builds.load(bid)
                if not record:
                    return self._json(404, {"error": "no such build"})
                return self._json(200, build_view(record))
            if url.path == "/api/builds":
                records = sorted(self.server.builds.all(), key=lambda r: r.get("started") or "", reverse=True)
                return self._json(200, {"builds": [build_summary(r) for r in records[:50]]})
            return self._json(404, {"error": "no such route"})
        return self._static(url.path)

    def do_POST(self):
        if not self._host_ok():
            return self._send(421, "Unknown host\n", "text/plain; charset=utf-8")
        if not self._origin_ok():
            return self._json(403, {"error": "cross-origin request refused"})
        path = urlsplit(self.path).path
        try:
            body = self._body()
        except Invalid as error:
            return self._json(error.status, {"error": str(error)})
        try:
            if path == "/api/session":
                return self._new_session(body)
            if path == "/api/turn":
                return self._turn(body)
            if path == "/api/stop":
                return self._stop(body)
            if path == "/api/build":
                return self._start_build(body)
            if path == "/api/build/stop":
                return self._stop_build(body)
            if path == "/api/build/seen":
                return self._seen_build(body)
        except Invalid as error:
            return self._json(error.status, {"error": str(error)})
        return self._json(404, {"error": "no such route"})

    def _new_session(self, body):
        kind = body.get("kind")
        if kind not in KINDS or not KINDS[kind]["chat"]:
            raise Invalid("unknown kind")
        sid = secrets.token_urlsafe(16)
        at = now_iso()
        record = {"id": sid, "kind": kind, "fence": secrets.token_hex(6), "claudeSession": None, "started": at,
                  "updated": at, "turns": 0, "messages": []}
        if kind == "ask":
            ctx = validate_context(body.get("context"))
            record.update(title=make_title(ctx), context=ctx)
            self.server.store.save(record)
            return self._json(200, {"sessionId": sid})
        # new-course: the app sends at most the node it was opened from; the
        # server builds the rest of the context itself (new_course_context).
        given = body.get("context") if body.get("context") is not None else {}
        if not isinstance(given, dict):
            raise Invalid("context must be an object")
        node = _str(given, "nodeId", 64, NODE_ID)
        if node not in self.server.library.map_nodes():
            node = None
        did = secrets.token_hex(8)
        os.makedirs(self.server.drafts.dir(did))
        self.server.drafts.save({"id": did, "sessionId": sid, "created": at, "updated": at, "title": "", "nodeId": node,
                                 "buildIds": []})
        record.update(title="New course", context={"draftId": did, "nodeId": node})
        self.server.store.save(record)
        return self._json(200, {"sessionId": sid, "draftId": did})

    def _start_build(self, body):
        server = self.server
        did = body.get("draftId")
        if not isinstance(did, str) or not JOB_ID.match(did):
            raise Invalid("bad draft id")
        draft = server.drafts.load(did)
        if not draft:
            return self._json(404, {"error": "no such draft"})
        text = server.drafts.brief_text(did)
        if not text:
            return self._json(409, {"error": "There is no brief yet. Keep talking until the session writes one."})
        if server.build is not None:
            return self._json(409, {"error": "A course is already being built. One at a time."})
        if not server.turn_lock.acquire(blocking=False):
            return self._json(409, {"error": "A chat reply is still being written. Build when it has finished."})
        started = False
        try:
            brief, problems = check_brief(text, server.library)
            if problems:
                return self._json(409, {"error": "The brief has problems.", "problems": problems})
            if os.path.lexists(course_dir(server, brief["courseId"])):
                return self._json(409, {"error": "A course called %s exists already." % brief["courseId"]})
            bid, sid, at = secrets.token_hex(8), secrets.token_urlsafe(16), now_iso()
            reading_granted = not os.path.lexists(reading_file(server, brief["nodeId"]))
            session = {"id": sid, "kind": "build-course", "title": "Build: %s" % brief["title"],
                       "context": {"draftId": did, "buildId": bid, "courseId": brief["courseId"], "nodeId": brief["nodeId"]},
                       "fence": secrets.token_hex(6), "claudeSession": None, "started": at, "updated": at, "turns": 0,
                       "messages": []}
            record = {"id": bid, "draftId": did, "sessionId": sid, "courseId": brief["courseId"], "nodeId": brief["nodeId"],
                      "nodeName": brief["nodeName"], "title": brief["title"], "state": "queued", "round": 0, "log": [],
                      "problems": [], "started": at, "updated": at, "finished": None, "unread": False,
                      "readingGranted": reading_granted, "brief": text, "briefHash": text_hash(text),
                      "lessonCount": len(brief["lessons"]), "missingWidgets": brief["missingWidgets"], "report": ""}
            server.store.save(session)
            server.builds.save(record)
            draft["buildIds"] = (draft.get("buildIds") or []) + [bid]
            draft["updated"] = at
            server.drafts.save(draft)
            server.build = {"id": bid, "session": sid, "stop": False, "validator": None}
            threading.Thread(target=run_build, args=(server, bid), daemon=True).start()
            started = True
            return self._json(200, {"buildId": bid})
        finally:
            if not started:
                server.build = None
                server.turn_lock.release()

    def _stop_build(self, body):
        bid = body.get("buildId")
        if not isinstance(bid, str) or not JOB_ID.match(bid):
            raise Invalid("bad build id")
        job = self.server.build
        if not job or job["id"] != bid:
            return self._json(200, {"stopped": False})
        job["stop"] = True
        current = self.server.current
        if current["session"] == job["session"] and current["proc"] is not None:
            current["stopped"] = True
            _kill(current["proc"])
        if job.get("validator") is not None:
            _kill(job["validator"])
        return self._json(200, {"stopped": True})

    def _seen_build(self, body):
        bid = body.get("buildId")
        if not isinstance(bid, str) or not JOB_ID.match(bid):
            raise Invalid("bad build id")
        record = self.server.builds.load(bid)
        if not record:
            return self._json(404, {"error": "no such build"})
        if record.get("state") == "done" and record.get("unread"):
            record["unread"] = False
            self.server.builds.save(record)
        return self._json(200, {"ok": True})

    def _turn(self, body):
        sid = body.get("sessionId")
        if not isinstance(sid, str) or not SESSION_ID.match(sid):
            raise Invalid("bad session id")
        text = body.get("text")
        if not isinstance(text, str) or not text.strip() or len(text) > MAX_TEXT:
            raise Invalid("text must be 1 to %d characters" % MAX_TEXT)
        update = validate_update(body.get("update"))
        record = self.server.store.load(sid)
        if not record or record.get("kind") not in KINDS:
            return self._json(404, {"error": "no such session"})
        if not KINDS[record["kind"]]["chat"]:
            raise Invalid("this session is run by the server, not talked to")
        if self.server.build is not None:
            return self._json(409, {"error": "A course is being built. The chat waits until it has finished."})
        if not self.server.turn_lock.acquire(blocking=False):
            return self._json(409, {"error": "another turn is running"})
        try:
            if record["kind"] == "new-course":
                draft = self.server.drafts.load(record["context"]["draftId"])
                if draft:
                    if not draft.get("title"):
                        draft["title"] = " ".join(text.split())[:80]
                    draft["updated"] = now_iso()
                    self.server.drafts.save(draft)
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Accel-Buffering", "no")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Connection", "close")
            self.end_headers()
            self.close_connection = True
            gone = [False]

            def emit(name, data):
                # If the phone has gone (screen off, network), the turn carries
                # on and its reply is kept in the transcript.
                if gone[0]:
                    return
                chunk = ": ping\n\n" if name == "ping" else "event: %s\ndata: %s\n\n" % (name, json.dumps(data, ensure_ascii=False))
                try:
                    self.wfile.write(chunk.encode("utf-8"))
                    self.wfile.flush()
                except OSError:
                    gone[0] = True

            run_turn(self.server, record, text.strip(), update, emit)
        finally:
            self.server.turn_lock.release()

    def _stop(self, body):
        sid = body.get("sessionId")
        if not isinstance(sid, str) or not SESSION_ID.match(sid):
            raise Invalid("bad session id")
        current = self.server.current
        if current["session"] != sid or current["proc"] is None:
            return self._json(200, {"stopped": False})
        current["stopped"] = True
        _kill(current["proc"])
        return self._json(200, {"stopped": True})

    def _static(self, path):
        dist = self.server.dist
        if not os.path.isdir(dist):
            return self._send(503, "The app is not built yet. Run: npm run build\n", "text/plain; charset=utf-8")
        name = unquote(path)
        if "\x00" in name:
            return self._send(400, "Bad path\n", "text/plain; charset=utf-8")
        if name in ("/", ""):
            name = "/index.html"
        real = os.path.realpath(os.path.join(dist, name.lstrip("/")))
        if not _inside(real, dist) or real == dist or not os.path.isfile(real):
            return self._send(404, "Not found\n", "text/plain; charset=utf-8")
        ext = os.path.splitext(real)[1].lower()
        ctype = TYPES.get(ext) or mimetypes.guess_type(real)[0] or "application/octet-stream"
        extra = {"Cache-Control": "no-cache"} if os.path.basename(real) in ("index.html", "sw.js") else {}
        try:
            with open(real, "rb") as fh:
                data = fh.read()
        except OSError:
            return self._send(404, "Not found\n", "text/plain; charset=utf-8")
        return self._send(200, data, ctype, extra)


def main(argv=None):
    parser = argparse.ArgumentParser(description="rabbit-hole: the app and Claude Code sessions, on 127.0.0.1.")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--root", default=REPO,
                        help="the repo the sessions work in (default: this one; tests use a temporary copy)")
    parser.add_argument("--dist", default=None, help="the built app (default: <root>/dist/)")
    parser.add_argument("--data", default=None, help="where sessions, drafts and builds go (default: <root>/data/)")
    parser.add_argument("--fake-claude", default=os.environ.get("RABBIT_FAKE_CLAUDE"),
                        help="run this instead of claude (for tests)")
    parser.add_argument("--allow-host", action="append", default=[],
                        help="another host name to answer to, besides localhost and *.ts.net")
    args = parser.parse_args(argv)
    root = os.path.realpath(args.root)
    server = Server(("127.0.0.1", args.port), args.dist or os.path.join(root, "dist"), args.fake_claude or DEFAULT_CLAUDE,
                    args.data or os.path.join(root, "data"), repo=root, allow_hosts=[h.lower() for h in args.allow_host])
    log("serving %s and the API on http://127.0.0.1:%d/ (repo: %s, claude: %s)"
        % (server.dist, server.server_address[1], server.repo, server.claude))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        _kill(server.current["proc"])
        server.server_close()
        # A build cut off here is marked failed and set aside at the next start (recover_builds).


if __name__ == "__main__":
    main()
