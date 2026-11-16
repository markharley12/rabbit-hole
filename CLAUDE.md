# CLAUDE.md — rabbit-hole

A mobile app that shows a whole field of knowledge as one map (maths first), lets you dig
down any rabbit hole on it, and fills the map with courses that Claude Code generates into
the app's own content files. Personal project of Mark's; public on GitHub in the end, but
built around his setup (Claude Code on his PC, phone over Tailscale), so it is not meant to
be turnkey for anyone else. **"rabbit-hole" is a working name** — rename freely.

## Status: four courses (one built by the app's own AI), review, quizzes, and an AI server that works against the real Claude (16 Nov 2026)

The map, plus one real course: **"Least squares to the pseudo-inverse"** on `15Axx` (Basic
linear algebra), five lessons resuming where Mark's chat stopped; and a second,
**"Principal components from the SVD"** (`principal-components-from-the-svd`) on `62Hxx`
(Multivariate analysis), five lessons of PCA on one five-point data set, with 7 reading links; and a third,
**"Gradient descent on a bowl"** (`gradient-descent-on-a-bowl`) on `65Kxx`, five lessons from the gradient to least
squares by walking downhill, with the widget `descent-path` and 7 reading links. A fourth, **"Eigenvalues and eigenvectors of a 2×2 matrix"** (`eigenvalues-and-eigenvectors-of-a-2x2-matrix`) on `15Axx`, four lessons, was built by the app's own new-course flow on 16 Nov (the smoke test) and has been read by nobody. The AI server (Ask, new course, build) passed its smoke tests against the real `claude` on 16 Nov, from the PC only, never from the phone. No photo
marking, no Capacitor yet. What is where:

- **Map.** `tools/build_maths_map.py` → `public/content/maths/map.json` (593 nodes, 517
  sections, 4,810 topics; never hand-edited). `src/map/layout.ts` and `gestures.ts` hold the
  pure, tested geometry; `MapView.tsx` only draws. `src/components/`: top bar and sheet.
- **Course format.** `schema/` (course, lesson, widget catalogue). A lesson is screens; the
  main one is a `step` (define, why, prompt, answer, three hints, check-it-yourself, one
  `next`); also `choice` (quiz question, every option has a `say`) and `order` (puzzle, items listed in
  correct order), at most half a lesson, never without a step (authoring doc section 12). Types in
  `src/lesson/types.ts`.
- **Content** lives in `content/maths/courses/<course-id>/` (source, in git; the folder name is
  the course's `id`, and several courses may share a `nodeId`).
  `tools/validate_courses.py` checks it (schema, widgets, links, hints, and every answer key
  re-derived with sympy) and with `--publish` copies it into `public/content/…/courses/`
  (gitignored). `npm run dev` and `npm run build` publish first, so **invalid content
  never reaches the app**. The app joins courses to the map by `nodeId`.
- **Checking answers** on the phone: `src/lesson/expr.ts` (the answer grammar, mirrored in
  the validator) and `check.ts` (deterministic slip detectors). Tests use Mark's real slips.
- **Lesson UI:** `src/lesson/LessonView.tsx`, `StepScreen.tsx`; routes are
  `#<node>/learn/<course>/<lesson>` (`src/route.ts`; the old `#<node>/learn/<lesson>` still opens the
  first course on the node with that lesson). A lazy chunk with KaTeX (woff2 only).
- **Widgets:** `src/widgets/` (line fitter, dependent columns, SVD geometry, PCA scatter), pure maths in
  `*-math.ts`, registry kept equal to `schema/widgets.json` by a test.
- **Finding courses:** every node counts the courses under it (`src/courses.ts`), the sheet
  says "1 course inside" instead of "No course yet" on any ancestor, the map rings each node
  that has a course, and the top bar's search button opens a Courses menu
  (`src/components/CoursesMenu.tsx`, route `#<node>/courses`) that lists every course and
  searches courses, sections and topics. Added after Mark's first look on 15 Nov: he saw no
  course at the top level and assumed there were none.
- **Course packs:** `tools/pack_course.py pack|unpack` (`npm run pack -- …`) turns a course into one
  `.rhpack` file and back, treating the file as untrusted; tests in `tools/tests/test_pack_course.py`.
- **Lesson tools** (`src/tools/`): a row of round buttons at the right of the lesson,
  riding on the footer's top edge (`ToolDock.tsx`; a tool is `{ id, label, icon, render(close) }`,
  so the cheat sheet and Reading are entries in `lesson-tools.tsx`, each shown only when there is
  something to show). A tool opens as an
  overlay over the lesson, never unmounting the step; Escape, a tap outside, or the phone's back
  button (a `pushState` entry plus `popstate`) closes it. **Scratch pad** (`ScratchPad.tsx`, pure
  `scratch-pad.ts`): one finger draws, two pan and pinch; pen, eraser (whole strokes), undo, redo,
  clear (tap twice), fit; saved per lesson in `rabbit-hole:scratch:<course>:<lesson>`, capped.
  **Calculator** keeps a tape of the last 20 lines (`calculator.ts`); tap a result to reuse it.
  **Number keyboard**: a box gets `inputMode="decimal"` only when the answer has no `vars` and
  that field's key is a plain number (`src/lesson/input-mode.ts`); an "abc"/"123" switch under the
  boxes changes every box's keyboard without clearing anything.
- **Cheat sheet:** optional `cheatsheet.json` beside `course.json` (`schema/cheatsheet.schema.json`;
  validator checks ids, `lesson`, Markdown; `--publish` flags `cheatsheet: true` in the course index
  only). Dock tool "Cheat sheet" (`src/tools/CheatSheet.tsx`) fetched on first open, marks "this
  lesson", ends with **My notes**: his own lines on the device (`rabbit-hole:cheatsheet-notes:<course>`,
  pure `cheat-notes.ts`, max 100 x 500 chars, through the same safe Markdown renderer). Written for the
  first course. No line on the node sheet (it would need an overlay outside a lesson). Authoring: course-authoring.md section 9.
- **Reading:** outside links belong to a map **node**: `content/maths/resources/<node-id>.json`
  (`schema/resources.schema.json`; validator never fetches URLs, `checked` is the date someone opened
  it), published with an index of counts (`public/content/maths/resources/`, gitignored). Lesson dock
  tool "Reading" (the course's node and ancestors, nearest first; `src/resources.ts`,
  `src/components/ReadingList.tsx`) and a "Reading" section on the sheet of a node that has its own.
  The app reads the index once and a node's file only when shown. 14 links on `15Axx`. course-authoring.md section 10.
- **AI server and Ask** (stage D, steps 1 to 3): `server/rabbit_server.py` (stdlib, 127.0.0.1, serves
  `dist/` and `/api/`, runs `claude -p` per turn, kinds table, answers every tool permission itself;
  tests use `server/tests/fake_claude.py`), tutor prompt `docs/agents/ask.md`, dock tool "Ask"
  (`src/tools/Chat.tsx`, `src/ai/`) shown only when `./api/state` answers. As built and open points:
  docs/ai-sessions.md section 10. `server/smoke_ask.py` passed against the real CLI on 16 Nov (two replies streamed, key held back).
- **New course by talking** (stage D, step 4): "New course" in the Courses menu and "Make a course
  here" on an empty sheet (only when the server offers `new-course`), route `#<node>/new-course`
  (`src/ai/NewCourse.tsx`): chat (kind `new-course`, writes only `data/drafts/<id>/brief.md`), brief
  card, Build this; build job (kind `build-course`, Opus, writes only one new course folder; the
  server validates, up to 3 repair rounds, publishes, copies into `dist/content/`, sets a failure
  aside in `data/drafts/<id>/failed-course/`). `server/smoke_new_course.py --build` passed against the real CLI on 16 Nov: brief in one turn, course built in 9 minutes with one repair round.
- **Review** (stage C): lessons mark steps `review: true` (11 in the first course; `--publish` lists
  them in the index as `review`), plus cheat-sheet formulas as recall cards. Pure ladder 1/3/7/16/35/90
  days, good/hard/again, local-calendar-day due rule, interleaved sessions of at most 10:
  `src/review/schedule.ts`; items are earned from the progress records (no hook in lessons), graded
  state is one device key `rabbit-hole:review`. Route `#<node>/review`, `ReviewView.tsx` reuses
  `StepScreen` with an in-memory record (course progress untouched); top-bar button with a due badge,
  a "N to review" line on the root sheet and Courses menu. No scores. Evidence and its limits:
  docs/learning-science.md; authoring: course-authoring.md section 11.
- **Tunnels and Where I am:** optional `tunnels` in `course.json` (`needs` / `related`, validated; shown as "Builds on" / "Leads to"
  lines on the sheet and one "Next course" at the end of a last lesson; pure logic in `src/courses.ts`). "Where I am"
  (`#<node>/progress`, button in the Courses menu header; `src/where-i-am.ts`, `WhereIAm.tsx`): next action, counts per course,
  slips seen twice, review line; counts never scores. Cheat-sheet items have a `cue` that is the review card's front.
- **Progress** is on the device only (`localStorage`, `rabbit-hole:progress:<course>`):
  attempts, hints, drafts, where he is. **No scores** (claimed is not scored).
- `pwa/sw.js`: offline. A new build waits until the app is fully closed, so an update
  shows the second time the app is opened, or at once from the **Update** bar the app shows
  when a new build is waiting (`src/pwa-update.ts`; every open page reloads together).
- Decided with Mark on 15 Nov: map stops at MSC sections; one tap zooms in and opens the
  sheet; name stays `rabbit-hole`; commit straight to `main`; the course hangs on `15Axx`;
  KaTeX bundled; typed answers only until photo marking (Phase 5).

Run everything with `npm run check` (typecheck, lint, Vitest, Python tests, course
validation). Build and phone access are in [README.md](README.md). **What to build next, and how work is delegated to subagents, is in [docs/ROADMAP.md](docs/ROADMAP.md)** (written from Mark's brain dump of 15 Nov; stages A to D are built; **next: Mark tests on his phone (since 16 Nov the server runs as the user unit `rabbit-hole.service` and `tailscale serve` port 8443 proxies to it; app, API and a same-origin POST were checked through the tailnet address from the PC), and reads the AI-built eigenvalues course**, then stage E. The AI design and what was built is in [docs/ai-sessions.md](docs/ai-sessions.md)). Course content is written to the contract in [docs/course-authoring.md](docs/course-authoring.md). Older open points and next
steps are at the end of [docs/HANDOFF.md](docs/HANDOFF.md).

The planning docs, still the reference for later phases. **Read in this order:**

1. [docs/PLAN.md](docs/PLAN.md) — vision, decisions Mark has made, architecture, phases, open questions.
2. [docs/REUSE.md](docs/REUSE.md) — what to take from TreeQuiz and Jarvis, with paths and the traps they hit.
3. [docs/HANDOFF.md](docs/HANDOFF.md) — the Phase 0 brief, what Phase 0 and the first course
   left open.
4. [docs/first-course-brief.md](docs/first-course-brief.md) — the brief the first course was
   built from (Phase 2 slice).
5. [docs/seed-context.md](docs/seed-context.md) — how Mark actually learns, condensed from his
   claude.ai chats (one so far): his teaching-style spec in his own words, where he got to, his
   slip patterns, and what they imply for the lesson format and widgets. Add further chats as
   dated sections. Read it before designing lessons, widgets or marking.

## About the learner (the parts that matter here)

- Learning the maths behind CS and AI, being tested to find real gaps.
- Works **on paper, photographs the pages**, and wants those marked.
- Responds to precise language. Don't pad.

## Rules

- **Shell commands one per line, no `\` continuations** (he pastes them over SSH from his phone).
- **File names kebab-case, no spaces.** (Exceptions forced by tools: Python modules use
  underscores so tests can import them; React components are PascalCase.)
- **No API keys.** All AI goes through `claude -p` on his PC (see docs/REUSE.md, Jarvis).
- **Never commit** handwritten-work photos, marking results, or anything under `Credentials/`.
  The repo is meant to go public; learner data stays out of it (gitignored, `data/`).
- **Source everything.** Every dataset records where it came from and its licence. The MSC2020
  tree is CC BY-NC-SA 4.0: keep the attribution and the non-commercial note.
- **A blank is not a zero.** An unassessed topic has no score, never 0.
- Run the tests before and after changes once there are tests; every fixed bug gets a test.
- Claude's local memory does not sync between his PC and phone: anything that matters goes in this repo.
- Mark's notes repo is `~/Documents/Mark` (his maths map and scores live in
  `Routine/Growth/Learning/Maths/`). It is separate; read it, don't write to it from here
  unless asked.
