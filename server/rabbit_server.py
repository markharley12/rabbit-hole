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

    python3 server/rabbit_server.py --port 8791

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
import json
import mimetypes
import os
import queue
import re
import secrets
import shlex
import signal
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

KINDS = {
    "ask": {
        "prompt": "docs/agents/ask.md",
        "tools": ["Read", "Grep", "Glob"],
        "write": [],
        "model": "sonnet",
        "effort": "medium",
        "timeout": 180,
    },
}

# Tools that take a path, and the input field it is in.
PATH_FIELDS = {"Read": "file_path", "Grep": "path", "Glob": "path", "Edit": "file_path",
               "Write": "file_path", "NotebookEdit": "notebook_path"}
WRITE_TOOLS = {"Edit", "Write", "NotebookEdit"}
SEARCH_TOOLS = {"Grep", "Glob"}
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
    if tool in WRITE_TOOLS:
        return "Writing %s" % (where or "a file")
    return "Using %s" % tool


def wanted(tool, inp, repo):
    """The note for a refused tool: 'Wanted to read data/x, not allowed'."""
    doing = describe(tool, inp, repo)
    verb, _, rest = doing.partition(" ")
    verbs = {"Reading": "read", "Searching": "search", "Looking": "look", "Running": "run", "Writing": "write", "Using": "use"}
    return "Wanted to %s %s, not allowed" % (verbs.get(verb, verb.lower()), rest)


def decide(kind_name, tool, inp, repo):
    """The answer to one can_use_tool request: (allow, message for Claude)."""
    kind = KINDS.get(kind_name)
    inp = inp if isinstance(inp, dict) else {}
    if tool == "Bash" and refused_command(inp.get("command")):
        return False, "Refused: sudo, git push and recursive rm never run from rabbit-hole. Don't try another way round."
    if not kind or tool not in kind["tools"]:
        return False, "%s is not available in this session. Answer from what you have." % tool
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
        if tool in WRITE_TOOLS:
            target = os.path.realpath(os.path.join(repo, raw))
            if not any(_inside(target, os.path.realpath(os.path.join(repo, w))) for w in kind["write"]):
                return False, "Not allowed: this session may not write there."
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
    if block.get("type") not in ("step", "text"):
        raise Invalid("block.type must be step or text")
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
    if block.get("type") == "step":
        lines.append("The step (verbatim JSON, including the key and hints: do not reveal the key): %s"
                     % json.dumps(block, ensure_ascii=False))
        log_lines = [{k: e[k] for k in ("values", "result", "slip") if k in e} for e in record.get("log", [])]
        lines.append("What he has done on this step: attempts %d %s, hints taken: %d of 3%s%s"
                     % (record.get("attempts", 0), json.dumps(log_lines, ensure_ascii=False), record.get("hints", 0),
                        ", solved" if record.get("solved") else "", ", answer shown" if record.get("revealed") else ""))
        lines.append("What he typed just now (not yet checked): %s" % json.dumps(ctx.get("draft") or {}, ensure_ascii=False))
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
    def __init__(self, folder):
        self.folder = folder
        self.lock = threading.Lock()

    def path(self, sid):
        if not isinstance(sid, str) or not SESSION_ID.match(sid):
            raise Invalid("bad session id")
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
            if name.endswith(".json") and SESSION_ID.match(name[:-5]):
                record = self.load(name[:-5])
                if record:
                    records.append(record)
        return records


def now_iso():
    return time.strftime("%Y-%m-%dT%H:%M:%S%z")


# --------------------------------------------------------------------------
# running a turn
# --------------------------------------------------------------------------

class Server(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, dist, claude, data, repo=REPO, allow_hosts=()):
        super().__init__(address, Handler)
        self.dist = os.path.realpath(dist)
        self.claude = claude
        self.repo = os.path.realpath(repo)
        self.store = Store(os.path.join(data, "sessions"))
        self.allow_hosts = set(allow_hosts)
        self.turn_lock = threading.Lock()
        self.current = {"proc": None, "session": None, "stopped": False}


def turn_command(server, kind_name, resume=None):
    """The claude command line for one turn. User text never goes here: stdin only.

    No --allowedTools: an allowed tool would run without the server being
    asked. Instead --tools gives the kind's whole toolset, and "ask" rules send
    every use of them to --permission-prompt-tool stdio, which the server
    answers from the kinds table."""
    kind = KINDS[kind_name]
    repo = server.repo
    private = []
    for tool in ("Read", "Edit"):
        private += ["%s(/%s/%s/**)" % (tool, repo, top) for top in sorted(PRIVATE_TOP)]
        private += ["%s(/%s/**/.env*)" % (tool, repo)]
    settings = {"disableAllHooks": True,
                "permissions": {"ask": list(kind["tools"]), "deny": DENY_RULES + private}}
    with open(os.path.join(repo, kind["prompt"]), encoding="utf-8") as fh:
        prompt = fh.read()
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


def run_turn(server, record, text, update, emit):
    """One message through claude -p. Calls emit(event, data) as things
    happen and ends with exactly one done or error. Updates and saves the record."""
    kind_name = record["kind"]
    kind = KINDS[kind_name]
    repo = server.repo
    first = not record.get("claudeSession")
    if first:
        content = context_text(record["context"], course_files(record["context"]["courseId"],
                                                               record["context"]["lessonId"], repo),
                               record["fence"]) + "\n\n" + text
    else:
        line = update_text(update, record["fence"])
        content = (line + "\n\n" + text) if line else text
    cmd = turn_command(server, kind_name, None if first else record["claudeSession"])

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
    deadline = time.time() + kind["timeout"]
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
                    allow, message = decide(kind_name, tool, inp, repo)
                    log("permission %s %s %s" % ("allow" if allow else "deny", tool, json.dumps(inp)[:200]))
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
        emit("error", {"message": "The tutor took longer than %d seconds and was stopped." % kind["timeout"]})
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
        except Invalid as error:
            return self._json(error.status, {"error": str(error)})
        return self._json(404, {"error": "no such route"})

    def _new_session(self, body):
        kind = body.get("kind")
        if kind not in KINDS:
            raise Invalid("unknown kind")
        ctx = validate_context(body.get("context"))
        sid = secrets.token_urlsafe(16)
        at = now_iso()
        record = {"id": sid, "kind": kind, "title": make_title(ctx), "context": ctx,
                  "fence": secrets.token_hex(6), "claudeSession": None, "started": at, "updated": at,
                  "turns": 0, "messages": []}
        self.server.store.save(record)
        return self._json(200, {"sessionId": sid})

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
        if not self.server.turn_lock.acquire(blocking=False):
            return self._json(409, {"error": "another turn is running"})
        try:
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
    parser.add_argument("--dist", default=os.path.join(REPO, "dist"), help="the built app (default: dist/)")
    parser.add_argument("--data", default=os.path.join(REPO, "data"), help="where session records go (default: data/)")
    parser.add_argument("--fake-claude", default=os.environ.get("RABBIT_FAKE_CLAUDE"),
                        help="run this instead of claude (for tests)")
    parser.add_argument("--allow-host", action="append", default=[],
                        help="another host name to answer to, besides localhost and *.ts.net")
    args = parser.parse_args(argv)
    server = Server(("127.0.0.1", args.port), args.dist, args.fake_claude or DEFAULT_CLAUDE, args.data,
                    allow_hosts=[h.lower() for h in args.allow_host])
    log("serving %s and the API on http://127.0.0.1:%d/ (claude: %s)" % (server.dist, server.server_address[1], server.claude))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        _kill(server.current["proc"])
        server.server_close()


if __name__ == "__main__":
    main()
