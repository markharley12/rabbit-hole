# AI sessions: design (not built)

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
