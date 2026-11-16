# AI sessions: design (steps 1 to 3 built; see section 10)

Design for ROADMAP.md stage D, written 15 Nov 2026 by the orchestrating session. Everything
here is **Recommended** unless marked Decided. It turns PLAN.md 4.5 and Mark's brain dump
(ROADMAP.md section 1, items 2, 3, 5, 7, 8, 13) into something a subagent can build in
pieces. Read [REUSE.md](REUSE.md) (the jarvis-voice section) first: the turn runner and the
permission relay are copied from there, not reinvented.

## 1. The rule that shapes everything

**A session is never a blank chat.** The app knows where Mark is (course, lesson, step, what
he typed, which hints he took). Every session starts from a context the app and server build
together, so the first reply is already about his step. (Decided, his words: it must not
start "as a new chat that doesn't even know that it's part of this app".)

Second rule (Decided): a course works with no AI. If the server is unreachable, the chat
button says so and nothing else changes.

## 2. Pieces

```
phone (PWA)  ──HTTPS over Tailscale──▶  server/rabbit_server.py  ──spawns──▶  claude -p
   builds a context block                 127.0.0.1, behind `tailscale serve`     cwd = this repo
   shows the stream                        serves dist/ and content               one process per turn
```

- `server/rabbit_server.py`: Python stdlib only, bound to 127.0.0.1, published with
  `tailscale serve` (HANDOFF.md records two traps: `/index.html` redirects, `.webmanifest`
  type). It serves the built app, so app and API share one origin (no CORS).
- Its own systemd user unit; Jarvis is not modified. (**Open**, ROADMAP.md section 6.)
- No API keys: only `claude -p`, as in Jarvis (`--input-format stream-json --output-format
  stream-json`, `--resume <session-id>`, stderr to a file, a turn timeout, always `--model`
  and `--effort`).

## 3. Session kinds

Each kind is a row in one table in the server: its system prompt file, the tools it may use,
where it may write, its model, its timeout. Adding a kind is adding a row and a prompt file.

| Kind | Started from | System prompt | Tools | May write | Model |
| --- | --- | --- | --- | --- | --- |
| `ask` | The chat button on a lesson screen | `docs/agents/ask.md` | Read, Grep, Glob | nothing | Sonnet |
| `new-course` (talk) | "New rabbit hole" on the map | `docs/agents/new-course.md` | Read, Grep, Glob, WebSearch, WebFetch | `data/drafts/<id>/brief.md` | Sonnet |
| `new-course` (build) | Accepting the brief | `docs/agents/build-course.md` + [course-authoring.md](course-authoring.md) | above + Write, Edit, Bash limited to `npm run validate` | `content/<field>/courses/<id>/` | Opus |
| `edit-cheatsheet` | "Add this to my cheat sheet" in an `ask` chat | `docs/agents/edit-cheatsheet.md` | Read, Edit | one `cheatsheet.json` | Sonnet |
| `mark` | A photo of paper work (PLAN.md Phase 5) | `docs/agents/mark.md` | Read | `data/attempts/` | Opus |

Writes are enforced by the permission relay, not by trust in the prompt: the server answers
tool-permission requests itself from the table (allow inside the kind's write path, deny
everything else) and refuses `sudo`, `git push`, `rm -r` in every kind. Nothing is relayed to
the phone in the first version; a denied request is shown in the chat as "wanted to …, not
allowed".

## 4. The context block

Built by the app, sent with the first turn, and put in front of the user's first message by
the server. For `ask`:

```
You are helping inside the rabbit-hole app. The learner is on:
course: <title> (<course-id>), on map node <nodeId> (<node name>)
lesson <n> of <N>: <lesson title>; screen <k> of <K>: <step title>
The step (verbatim JSON, including the key and hints: do not reveal the key): {…}
What he has done on this step: attempts [{values, result, slip}], hints taken: 2 of 3
What he typed just now (not yet checked): {…}
```

The server adds file paths (the lesson file, the cheat sheet) so the session can read more.
The teaching style is in the kind's system prompt, taken from seed-context.md section 2:
small steps, hints not answers, define terms, one next step, short replies.

`ask` may give a further hint, explain a term, or point at one of the node's reading links.
It does not give the answer unless the step's own "Show the answer" would already be
available (three hints taken and a wrong attempt after them): the same rule as the app.

## 5. New course: talk, brief, build

1. **Talk.** Mark says what he wants to learn, vaguely. The session asks at most one
   question per reply, and looks things up (web) so its suggestions rest on sources. It
   proposes where on the landscape the course belongs (course-authoring.md section 2); Mark
   need not choose a node (Decided: the agent can decide).
2. **Brief.** When the shape is clear the session writes `data/drafts/<id>/brief.md`: title,
   node, who it is for and from what starting point, lesson list with one line each, the
   worked examples, the widgets it will use (and any it is missing), sources opened. The app
   shows the brief with two buttons: **Build this** and **Keep talking**.
3. **Build.** A background job, not a chat turn: a longer timeout, progress events (lesson
   written, validation run, errors being fixed). It may only finish by passing
   `npm run validate`; on failure the validator's messages go back to the session, up to a
   fixed number of rounds, then it stops and reports. On success the server republishes
   content and the app shows the new course, marked "new, not yet read by Mark". The files
   stay uncommitted.

## 6. API (first version)

| Route | Does |
| --- | --- |
| `GET /api/state` | Server alive, version, kinds available |
| `POST /api/session` | `{kind, context}` → `{sessionId}` |
| `POST /api/turn` | `{sessionId, text}` → server-sent events: text deltas, tool notes, done, error |
| `POST /api/stop` | Stop the running turn |
| `GET /api/sessions` | Past sessions with kind, course, title, date (this is the "history" in ROADMAP 1.10) |
| `GET /api/transcript?id=` | One session's messages |
| `POST /api/build` / `GET /api/build?id=` | Start and follow a course build |

Session records live in `data/sessions/` (gitignored).

## 7. In the app

- A chat tool in the lesson tool dock (ROADMAP stage A2 built the dock for this). It opens
  as an overlay over the step, so the step stays as it was.
- "New rabbit hole" on the map's top bar opens the same chat view in `new-course` kind.
- The server's address: same origin when the app is served by the server; when the app is
  opened from elsewhere, no AI and an honest message.

## 8. Build order, as subagent briefs

1. Server skeleton: static files, `/api/state`, the kinds table, tests with a fake `claude`
   executable (a script that prints canned stream-json), so nothing in the test suite spends
   plan usage.
2. Turn runner and SSE, `ask` kind end to end, permission answers from the table. Tests for
   every refusal.
3. Chat tool in the app, context block builder (pure, tested).
4. `new-course` talk and brief; then the build job.
5. `edit-cheatsheet`.

## 9. Risks specific to this stage

- **A session that can write is reachable from the tailnet.** Keep the bind on 127.0.0.1,
  keep writes inside the table's paths, and resolve every path (symlinks, `..`) before
  comparing.
- **Web content is untrusted.** The build session reads web pages; its prompt must say that
  page text is data, and its write path is one course folder, so the worst case is a bad
  course that the validator rejects or Mark deletes.
- **Usage.** Builds are long. Default model per kind is in the table; show the session cost
  in the chat as Jarvis does.

## 10. As built (16 Nov 2026: build-order steps 1 to 3)

`server/rabbit_server.py`, `server/tests/` (with `fake_claude.py`), `docs/agents/ask.md`,
`src/ai/` (context builder, client and SSE parser, chat store), `src/tools/Chat.tsx`. What
differs from the design above, and what was learned:

- **The command line.** `claude -p --input-format stream-json --output-format stream-json
  --verbose --include-partial-messages --permission-mode default --permission-prompt-tool stdio
  --tools Read,Grep,Glob --disallowedTools <the rest> --strict-mcp-config --disable-slash-commands
  --settings <json> --append-system-prompt <docs/agents/ask.md> --model sonnet --effort medium
  [--resume <id>]`, `cwd` = the repo. **No `--allowedTools`**: an allowed tool runs without
  the server being asked. Instead `--tools` is the kind's whole toolset, the settings' `ask`
  rules send every use to the server (an ask rule outranks an allow rule, Jarvis found), and
  the settings' `deny` rules repeat the private folders and the sudo / git push / rm -r
  prefixes as a second lock. User text goes on stdin only. `--permission-mode default` is
  accepted by 2.1.325 though its help lists `manual` instead.
- **Path rule.** Read, Grep and Glob are allowed only inside the repo after resolving symlinks
  and `..`, never under `data/`, `Credentials/`, `.git/`, `.claude/` (other worktrees and
  settings), `node_modules/` or any `.env*`. A search may not start at the repo root (it would
  walk into those folders): Grep needs a `path`, Glob's literal prefix (`content/maths/**`) counts.
- **The context block** is fenced by `[app-context <random>]` ... `[end app-context <random>]`,
  random per session so no string in it can close it early. Later messages carry the step's
  current state as a structured `update` that the server turns into one fenced
  `[app-update <random>]` line (the brief had the app write that line; the server writing it
  keeps the fence secret and the values validated).
- **The answer rule** in the prompt also allows the answer once the step is solved or shown
  (the app's own `canReveal` is false then, because the button is gone).
- **Turns are not tied to the phone's connection.** If the phone drops mid-reply the turn
  finishes and is kept in the transcript; reopening the chat reloads it. A failed turn's
  message is marked and left out of the transcript, so Retry does not show it twice.
- **Origin and host.** A POST must be JSON (a cross-origin page would need a CORS preflight,
  which is never answered) and its `Origin`, when sent, must match `Host` or
  `X-Forwarded-Host` (scheme not compared, since `tailscale serve` turns https into http). The
  `Host` must be localhost, 127.0.0.1, `[::1]` or a `*.ts.net` name (stops DNS rebinding);
  `--allow-host` adds one.
- **Environment.** Started from inside a Claude Code session, the server would hand that
  session's variables (`CLAUDECODE`, `CLAUDE_CODE_*`, `ANTHROPIC_BASE_URL`) to every turn; it
  drops them in that case (`child_env`), keeping `CLAUDE_CODE_OAUTH_TOKEN`.
- **Event shapes** handled (from Jarvis's parser and the fake): `system/init` (session id),
  `stream_event` wrapping `content_block_delta`/`text_delta` and `message_start`,
  `control_request` `can_use_tool` (answered with `control_response` `success`), `assistant`,
  `result` (`is_error`, `result`, `total_cost_usd`; the turn's cost is the difference from the
  session's last total). Confirmed against the real CLI only for the error path: the smoke test
  on 15 Nov got `result` with `is_error` and "Failed to authenticate: this login reached its time
  limit", because the CLI on the PC was not signed in. **The streaming and permission shapes are
  not yet confirmed against the real CLI**: run `server/smoke_ask.py` once signed in.
- **Service worker.** Its fetch handler only answered GETs for files in the build's list, so
  `/api/` was already never cached; an explicit pass-through now says so.
- Open: `tailscale serve` and the systemd unit (`server/rabbit-hole.service`) are written but
  not switched on; whether `tailscale serve` keeps the `Host` header (the Origin check relies on
  `Host` or `X-Forwarded-Host`) is untested.
