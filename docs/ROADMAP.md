# Roadmap

Written 15 Nov 2026 from Mark's brain dump (two pasted notes, same day), after the first
course was built. It replaces the phase table in [PLAN.md](PLAN.md) section 5 as the order of
work; PLAN.md stays the reference for architecture. As in PLAN.md, three kinds of statement
are kept apart: **Decided** (Mark said it), **Recommended** (the orchestrator's call, argue
with it), **Open** (needs Mark).

## 0. Standing direction (Mark, 16 Nov 2026)

Decided, his words condensed. The orchestrating session works through the stages below on
its own judgement, choosing whatever is the best use of effort, without waiting to be asked:

- **The mission:** an alternative to Brilliant.org: learning through lessons, visualisation,
  puzzles, quizzes and problems.
- **Use what is scientifically shown to help people learn**, spaced repetition (Anki-style)
  first. Recommended reading of that, to be sourced when built: retrieval practice, spacing,
  interleaving, worked examples then fading, immediate specific feedback.
- **AI-native:** when someone is stuck they can ask, inside the course.
- **Building new courses with AI is part of the app**, not a separate tool.

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
| **Tunnel** | A link between two rabbit holes: a prerequisite, or "this is the same idea as" | built for courses (`tunnels` in `course.json`, `needs` or `related`); prerequisite levels between map nodes are still later (E1) |

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

- **E1. Tunnels**: levels and prerequisites between map nodes (PLAN.md 4.3). Cross-links between courses are built.
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
- **Second course: PCA** (16 Nov 2026). "Principal components from the SVD" on `62Hxx`: five lessons,
  cheat sheet (13 items), `62Hxx.json` with 7 links opened on 15 Nov; widget `pca-scatter` (pure maths
  tested). Every key re-derived by sympy; the data set's whole chain checked in sympy first. Lesson 1
  done end to end in the built-in browser at 375x812 (named slips for the mean, the sign, the raw x's
  and a non-unit u; handle drag, slider, guess table), lesson 3 through to the reveal, dark and light.
  Not checked: lessons 2, 4 and 5 by hand in the browser (only by tests); on the phone itself; touch
  drag of the handle with a finger; read by Mark.
- **D steps 1 to 3: AI server and Ask** (16 Nov 2026). `server/rabbit_server.py` with the `ask` kind,
  tests against a fake claude, `docs/agents/ask.md`, the Ask dock tool. Looked at in the built-in
  browser at 375x812, dark and light, against the fake claude (starter, typed message, notes and
  refusals, typeset maths, reload restoring the chat). Not checked: **any turn with the real CLI**
  (it was not signed in, so the smoke test got only "Failed to authenticate"); the tutor's replies
  and whether it keeps the answer back; `tailscale serve` and the systemd unit (not switched on);
  on the phone itself, including the on-screen keyboard over the input.
- **C Spaced review** (16 Nov 2026). `review: true` on steps (11 marked in the first course, 1 to 3 a
  lesson, only prompts that stand alone), index `review` list, pure scheduler and store, `#<node>/review`
  session reusing `StepScreen`, top-bar badge and "N to review" lines, `docs/learning-science.md`. Looked at
  in the built-in browser at 375x812, dark and light. Not checked: on the phone itself; offline with the
  network really off (the service worker's file list was read: it covers everything under `public/` and the
  built chunks, so lessons, cheat sheets and the review chunk are precached); a day actually passing on a
  real clock; the step buttons read oddly in review (they keep each step's own `next` label, "Set up the normal
  equations", since `StepScreen` is unchanged). The ladder numbers are a convention; sources were read as
  records only, not full papers.
- **D step 4: new course by talking** (16 Nov 2026). Kinds `new-course` (talk, writes only its brief) and
  `build-course` (background job, writes only one new course folder; the server validates, repairs up to 3
  rounds, publishes, copies into `dist/content/`), `docs/agents/new-course.md` and `build-course.md`, the
  New course view with brief card and build progress, entries in the Courses menu and on an empty sheet,
  content indexes network-first in the service worker. Walked in the built-in browser at 375x812 against the
  fake claude on a temporary copy of the repo (talk, brief card, build with one repair round, open the new
  course). Not checked: **anything with the real CLI** (signed out: no real brief, no real course, no real
  WebSearch/WebFetch; `server/smoke_new_course.py` is for that); the service worker path in a browser (it
  was not controlling the page on localhost; only the unit test covers it); offline; dark/light (dark only);
  on the phone itself; a build lasting the real tens of minutes; Stop and failure screens in the browser
  (tests only); whether WebFetch could reach a private address through a public DNS name.

- **Quiz and puzzle screens** (16 Nov 2026). Blocks `choice` and `order` (schema, validator rules and tests,
  `ChoiceScreen`, `OrderScreen`, pure `choice.ts`, `order.ts`, `seed.ts`), review support, 5 added to the first
  course and 4 to the PCA course, PCA steps marked for review. Looked at in the built-in browser at 375x812 where
  noted in the report. Not checked: on the phone itself; drag to reorder (not built: buttons only); the Ask tool is
  hidden on these screens because `server/rabbit_server.py` rejects block types other than step and text;
  whether the puzzles have exactly one valid order beyond the author's reading; read by Mark.
- **Ask on quiz and puzzle screens** (16 Nov 2026). The server accepts `choice` and `order` blocks and
  describes them with the answer for the tutor's eyes only (which options are `correct`; `items` in the
  correct order) under the step's withholding rule; the app sends the picked ids or the current order (not
  the seed) and `canReveal` by `reveal.ts`'s wrong-tries rule (2 for a quiz, 3 for a puzzle); `ask.md` says
  what the tutor may do on each. The Ask tool is no longer hidden on these screens (the note in the entry
  above is now out of date). Not checked: any of it with the real CLI, so whether the tutor keeps the
  answer back on these screens is untested; not looked at in the browser.
- **Tunnels, Where I am, review cues** (16 Nov 2026). `tunnels` in `course.json` (validator: real course, no repeat, no `needs` loop); "Builds on" / "Leads to" lines on the sheet and one "Next course" on the end of a last lesson; `#<node>/progress` ("Where I am": one next action, per-course counts, repeated slips, review); optional `cue` on cheat-sheet items so a review card's front does not give the formula away. Tested in jsdom; looked at in the browser pane where noted in the commit messages. Not checked: on the phone itself.
- **Third course: gradient descent** (16 Nov 2026). "Gradient descent on a bowl" on `65Kxx`: five lessons (gradient, one step, step size and 2/λ, eigenvalues and κ, least squares by walking downhill), cheat sheet (14 items with cues), tunnels (needs the least-squares course, related to PCA), `65Kxx.json` with 7 links opened on 16 Nov; widget `descent-path` (pure maths tested, including no NaN or Infinity on diverging paths). Every key re-derived by sympy. Lesson 1 done end to end in the built-in browser at 375x812 (named slips for f(2, 1), x² differentiated as x, a sign flip, and a wrong quiz option); the 1D widget diverging at η = 3/4 and the 2D one past the limit, dark and light. Not checked: lessons 2 to 5 by hand in the browser (only by tests); dragging the start with a finger; on the phone itself; read by Mark.
- **AI against the real Claude** (16 Nov 2026). After Mark signed the CLI in: `server/smoke_ask.py` passed (two streamed replies, the key held back on "just tell me the answer");
  `server/smoke_new_course.py --build` passed (brief in one turn with web search; build 9 minutes, 11 validator problems, one repair round, published). The build's output is the fourth course,
  "Eigenvalues and eigenvectors of a 2×2 matrix" on `15Axx` (four lessons, cheat sheet, 10 review steps, no widget: it asked for a draggable "matrix acts on a vector" widget that does not exist).
  Fixed: brief source URLs with a bracketed part were cut at "(". Not checked: the course has been read by nobody (validator and sympy only); its tunnels say `related` where the SVD and PCA
  courses arguably `need` it; nothing from the phone; the build prompt lets authors list slips on boxes whose value is right, which cost the repair round.
- **"So far" lesson tool** (17 Nov 2026). Mark kept going back to earlier screens to read constants he had worked out. New dock tool after Calculator (`src/tools/SoFar.tsx`, pure `so-far.ts`, fetching in `so-far-store.ts`): the solved or revealed `step` blocks before the current screen, this lesson first (most recent first), then earlier lessons nearest first, collapsed; each shows the prompt and the answer key per field, typeset by a small new `keyToTex` (fractions, roots, pi; matrices and unlabelled vectors as one bracketed line). Earlier lesson files are fetched on first open only for lessons with a finished step; a failed fetch shows "Could not load earlier lessons." Tested in jsdom (no leak of the current or later steps, ordering, revealed, empty state, failure, nothing written). Looked at in the built-in browser at 375x812 on the least-squares course with seeded progress (light theme). Not checked: dark theme, on the phone, offline with the service worker, `choice`/`order`/`text` screens (left out on purpose), a key `keyToTex` does not understand (passes through as written).
