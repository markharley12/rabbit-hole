# Roadmap

Written 15 Nov 2026 from Mark's brain dump (two pasted notes, same day), after the first
course was built. It replaces the phase table in [PLAN.md](PLAN.md) section 5 as the order of
work; PLAN.md stays the reference for architecture. As in PLAN.md, three kinds of statement
are kept apart: **Decided** (Mark said it), **Recommended** (the orchestrator's call, argue
with it), **Open** (needs Mark).

## 1. What Mark said (condensed, his meaning kept)

1. **Orchestration.** One strong session orchestrates; the bulk of the work runs in
   subagents on weaker models. The repo must carry enough context for that to work.
2. **AI-native.** A chat window inside the app for questions about what he is learning. It
   starts a session already filled with the course context; it must not open as a blank chat
   that does not know it is part of this app.
3. **New course by conversation.** From the map, "I want to learn X". Maybe no section is
   chosen: the agent decides where the course belongs. A vague start, some back and forth,
   then a commitment to build. The result is reliable and structured: puzzles, problems,
   interactive pieces, visualisations.
4. **Courses are shareable files.** A course is a set of files someone could download and use.
5. **A course should be completable with no agent.** AI is for questions and for marking
   that code cannot do.
6. **The metaphor.** A field's map is a **landscape**. Topics you go down are **rabbit
   holes**. Connections between them are **tunnels**.
7. **Sessions run like Jarvis:** a Claude Code session on his PC with access to the repo.
8. **Grounded generation.** The course-building agent gets a written description of what a
   course contains and how landscapes and tunnels work, and researches with web access, so
   courses rest on sources and not on recall.
9. **Spaced repetition** (Anki-style), built into the app, not the Anki app.
10. **Supersede the old maths routine** in his notes repo: move what is there into this app.
    Some history of past sessions, importance unclear.
11. **A scratch pad** to draw on, and **a calculator**, as icons that expand into overlays
    and collapse again.
12. **Links to outside sources.** When blocked in a course he wants to go and read. He thinks
    these belong to the topic, outside the course files.
13. **A formula cheat sheet** per course, which the AI help could edit.
14. **Number keyboard** when the answer is a number.

## 2. How extensible the current structure is (evaluated 15 Nov 2026)

Holds up: the lesson format (steps, hints, slips, sympy-verified keys), the validator as the
gate before anything reaches the app, the widget registry, progress keyed by course id.

Limits found, each fixed by a stage below:

| Limit | Why it blocks the ideas above | Stage |
| --- | --- | --- |
| One course per node; the folder name is the node id | An agent placing courses, and shared courses, need many per node | A1 |
| A course is a loose folder | No single file to hand to someone | A1 |
| Lesson screen has no place for tools | Scratch pad, calculator, cheat sheet, reading all need one | A2 |
| Nothing can be attached to a node except a course | Outside links belong to the topic | B2 |
| No server | Chat, course creation, cheat-sheet edits, marking | D |
| Progress stores attempts but schedules nothing | Spaced repetition | C |

## 3. Vocabulary (Decided by Mark, wording Recommended)

| Word | Means | In the code today |
| --- | --- | --- |
| **Landscape** | The whole map of one field (maths first) | `map.json`, `src/map/` |
| **Rabbit hole** | A place you go down: a node, and the courses under it | node, course |
| **Tunnel** | A link between two rabbit holes: a prerequisite, or "this is the same idea as" | not built (E1) |

Use these words in the app's own text when a screen is next touched. Do not rename code
identifiers for it.

## 4. Stages

Each stage is one subagent brief. A stage is done when `npm run check` passes, the feature
was looked at in the built-in browser at 375x812, and CLAUDE.md's status says what changed.

### A. Structure and the lesson tool dock (no server)

- **A1. Courses by id, and course packs.** Source moves to
  `content/maths/courses/<course-id>/`; `nodeId` stays inside `course.json`; several courses
  may hang on one node. Route becomes `#<node>/learn/<course-id>/<lesson-id>` (the old
  two-part form still opens). `tools/pack_course.py` writes one `.rhpack` file (a zip of the
  course folder plus a manifest with format, id, hash) and unpacks one into `content/`,
  running the validator on it. This is the "course someone could download" (1.4).
- **A2. Tool dock.** A column of small round buttons on the lesson screen; each opens an
  overlay that collapses again. First tools: **scratch pad** (draw, erase, undo, pan and
  pinch, kept per lesson on the device) and **calculator** (the existing one, with a history
  of lines). Also the **number keyboard** (1.14): a field whose key is a plain integer or
  decimal opens the numeric pad, with a visible switch to the full keyboard.

### B. Course extras (no server)

- **B1. Cheat sheet.** `cheatsheet.json` beside `course.json`: sections of named formulas
  (KaTeX) with a one-line "when to use it". Validated; shown as a dock tool and on the course
  sheet. Written for the first course. The learner's own additions are kept on the device;
  AI edits arrive with stage D.
- **B2. Reading for a node.** `content/maths/resources/<node-id>.json`: outside links (video,
  book, notes) attached to **map nodes**, each with what it is, why it helps and when it was
  checked. A lesson shows the resources of its course's node and that node's ancestors, as a
  dock tool; the node sheet shows them too. Every URL is fetched and confirmed before it is
  written (rule: source everything).

### C. Spaced review (no server)

Recommended: review items come from two places, both already in the files. (1) **Steps** a
course marks `review: true` (a step he solved comes back later). (2) **Cheat-sheet formulas**
as recall cards (see the name, recall the formula, reveal, say how it went). Scheduling is a
fixed ladder (1, 3, 7, 16, 35, 90 days; a miss drops two rungs), pure and tested, on the
device. A "Review" entry shows how many are due. No scores: a due date is not a mastery score.
**Open:** whether repeated steps should change their numbers each time (needs parametrised
steps; not in the first version).

### D. The PC server and AI sessions (Phase 3 and 4 of PLAN.md)

Design first, in `docs/ai-sessions.md`, then build. Outline (Recommended):

- A small server in `server/` (Python stdlib, the Jarvis pattern in [REUSE.md](REUSE.md)):
  serves the built app and content, and runs `claude -p` sessions in this repo.
- **Session kinds**, each with its own context file under `docs/agents/` that the server
  passes as the system prompt, plus a context block the app builds (course, lesson, step, his
  attempts and hints so far):
  - `ask`: questions about the step he is on. Read-only. Hints, not answers.
  - `new-course`: the conversation in 1.3, ending in a written brief he accepts; then a
    background build that researches with web access, writes files, and must pass the
    validator before the course appears.
  - `edit-cheatsheet`: may write only `cheatsheet.json` of one course.
  - `mark` (photo marking, PLAN.md Phase 5).
- Writes are limited to `content/` and `data/`. Generated content stays uncommitted until
  Mark has seen it.
- `docs/course-authoring.md` is the contract every course-writing agent reads: what a course
  must contain, the step format, widgets, sources, the validator.

### E. Later

- **E1. Tunnels**: levels and prerequisites (PLAN.md 4.3), plus cross-links between courses.
- **E2. Import the old maths routine** (1.10): Map.md scores, Mistakes, Derivations (these
  become review cards), the diagnostic. Learner data goes under `data/` (never in git).
  **Open:** see section 6.
- **E3. History**: a "where I am" view from the progress record.
- Capacitor APK; other fields (physics, chemistry).

## 5. How work is delegated

The orchestrating session (a strong model) designs, writes briefs, reviews and merges.
Subagents (Sonnet by default) build. To make that work:

- **A brief is self-contained.** It names the files to read first, the files it may change,
  the exact behaviour wanted, what not to touch, and how done is checked. It never says
  "see the conversation".
- **One writer per file set.** Stages that run together get separate git worktrees and
  separate files; the orchestrator merges.
- **Every stage adds tests**, and runs `npm run check` before reporting.
- **The subagent reports** what it built, what it could not check, and any choice it made
  without asking. The orchestrator checks the diff and the running app before saying "done".
- **Content is never trusted because a model wrote it.** Keys are re-derived by sympy; URLs
  are fetched; a claim has a source.

## 6. Open questions for Mark

1. **Old maths routine (E2).** Import the Map.md scores into the app as *claimed* (not
   scored), or leave scores out and bring only Derivations and Mistakes? And once imported,
   may this repo's sessions edit the notes repo to mark the old section as superseded?
2. **Server (D).** Should the new server be its own service next to Jarvis, or a mode of
   Jarvis's server? (Recommended: its own, in `server/` here; Jarvis is not modified.)
3. **Review (C).** Should a review of a step reuse the same numbers, at first?

## 7. Done log

Filled in as stages land (date, commit, what was not checked).

- **A1 Courses by id, course packs** (15 Nov 2026). Source in `content/maths/courses/<course-id>/`,
  many courses per node, route `#<node>/learn/<course-id>/<lesson-id>` (the old two-part form still
  opens, checked in the built-in browser), `tools/pack_course.py` with `.rhpack` files. Not checked:
  a node with two real courses on the phone (only in tests; there is one course); sending a pack to
  another machine.
- **A2 Tool dock** (15 Nov 2026). Dock, scratch pad, calculator tape, number keyboard. Looked at in
  the built-in browser at 375x812 (mouse drawing, Escape and back close, strokes saved). The dock
  became one row along the footer after four stacked buttons covered an answer box. Not checked:
  two-finger pan and pinch, a palm on the screen, and whether the phone's keyboard really swaps
  between the number pad and letters. An iPhone's decimal pad has no minus key ("abc" is the way out).

- **B1 Cheat sheet** (15 Nov 2026, "Cheat sheet: cheatsheet.json per course..."). `cheatsheet.json`
  with its schema, validator rules and tests; dock tool with "this lesson" marks and his own notes
  (device only); 16 formulas in 5 sections for the first course, every one typeset in strict KaTeX by
  `content.test.ts`. Looked at in the built-in browser at 375x812, dark and light. Not checked: on the
  phone itself; the offline path (the build's file list is read from `public/`, which includes
  `cheatsheet.json`, but no offline run was made); the line on the node sheet was skipped (needs an
  overlay outside a lesson). The formulas were written from the lessons by a model and not yet read by Mark.
- **B2 Reading for a node** (15 Nov 2026). `content/maths/resources/`, schema, a second validator
  pass and publish (with an index; stale files removed), `src/resources.ts`, a "Reading" dock tool and
  a "Reading" section on the node sheet; the 14 links of `15Axx` were opened by another agent on 15 Nov
  (nothing here fetched them again) and their `use` lines were rewritten for the node. Not checked: any
  URL in this stage; the offline message with the real network off; on the phone itself; the list now
  shows four links and a "Show 10 more" button (added by the orchestrator after review).
- **D steps 1 to 3: AI server and Ask** (16 Nov 2026). `server/rabbit_server.py` with the `ask` kind,
  tests against a fake claude, `docs/agents/ask.md`, the Ask dock tool. Looked at in the built-in
  browser at 375x812, dark and light, against the fake claude (starter, typed message, notes and
  refusals, typeset maths, reload restoring the chat). Not checked: **any turn with the real CLI**
  (it was not signed in, so the smoke test got only "Failed to authenticate"); the tutor's replies
  and whether it keeps the answer back; `tailscale serve` and the systemd unit (not switched on);
  on the phone itself, including the on-screen keyboard over the input.
