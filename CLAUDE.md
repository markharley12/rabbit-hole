# CLAUDE.md — rabbit-hole

A mobile app that shows a whole field of knowledge as one map (maths first), lets you dig
down any rabbit hole on it, and fills the map with courses that Claude Code generates into
the app's own content files. Personal project of Mark's; public on GitHub in the end, but
built around his setup (Claude Code on his PC, phone over Tailscale), so it is not meant to
be turnkey for anyone else. **"rabbit-hole" is a working name** — rename freely.

## Status: Phase 2 slice built, waiting for Mark's phone test (15 Nov 2026)

The map, plus one real course: **"Least squares to the pseudo-inverse"** on `15Axx` (Basic
linear algebra), five lessons resuming where Mark's chat stopped. No server, no AI, no photo
marking, no Capacitor yet. What is where:

- **Map.** `tools/build_maths_map.py` → `public/content/maths/map.json` (593 nodes, 517
  sections, 4,810 topics; never hand-edited). `src/map/layout.ts` and `gestures.ts` hold the
  pure, tested geometry; `MapView.tsx` only draws. `src/components/`: top bar and sheet.
- **Course format.** `schema/` (course, lesson, widget catalogue). A lesson is screens; the
  main one is a `step` (define, why, prompt, answer, three hints, check-it-yourself, one
  `next`). Types in `src/lesson/types.ts`.
- **Content** lives in `content/maths/courses/<node-id>/` (source, in git).
  `tools/validate_courses.py` checks it (schema, widgets, links, hints, and every answer key
  re-derived with sympy) and with `--publish` copies it into `public/content/…/courses/`
  (gitignored). `npm run dev` and `npm run build` publish first, so **invalid content
  never reaches the app**. The app joins courses to the map by `nodeId`.
- **Checking answers** on the phone: `src/lesson/expr.ts` (the answer grammar, mirrored in
  the validator) and `check.ts` (deterministic slip detectors). Tests use Mark's real slips.
- **Lesson UI:** `src/lesson/LessonView.tsx`, `StepScreen.tsx`; routes are
  `#<node>/learn/<lesson>` (`src/route.ts`). A lazy chunk with KaTeX (woff2 only).
- **Widgets:** `src/widgets/` (line fitter, dependent columns, SVD geometry), pure maths in
  `*-math.ts`, registry kept equal to `schema/widgets.json` by a test.
- **Finding courses:** every node counts the courses under it (`src/courses.ts`), the sheet
  says "1 course inside" instead of "No course yet" on any ancestor, the map rings each node
  that has a course, and the top bar's search button opens a Courses menu
  (`src/components/CoursesMenu.tsx`, route `#<node>/courses`) that lists every course and
  searches courses, sections and topics. Added after Mark's first look on 15 Nov: he saw no
  course at the top level and assumed there were none.
- **Lesson tools** (`src/tools/`): a dock of round buttons at the right edge of the lesson,
  riding on the footer's top edge (`ToolDock.tsx`; a tool is `{ id, label, icon, render(close) }`,
  so a cheat sheet or reading links are one more entry in `lesson-tools.tsx`). A tool opens as an
  overlay over the lesson, never unmounting the step; Escape, a tap outside, or the phone's back
  button (a `pushState` entry plus `popstate`) closes it. **Scratch pad** (`ScratchPad.tsx`, pure
  `scratch-pad.ts`): one finger draws, two pan and pinch; pen, eraser (whole strokes), undo, redo,
  clear (tap twice), fit; saved per lesson in `rabbit-hole:scratch:<course>:<lesson>`, capped.
  **Calculator** keeps a tape of the last 20 lines (`calculator.ts`); tap a result to reuse it.
  **Number keyboard**: a box gets `inputMode="decimal"` only when the answer has no `vars` and
  that field's key is a plain number (`src/lesson/input-mode.ts`); an "abc"/"123" switch under the
  boxes changes every box's keyboard without clearing anything.
- **Progress** is on the device only (`localStorage`, `rabbit-hole:progress:<course>`):
  attempts, hints, drafts, where he is. **No scores** (claimed is not scored).
- `pwa/sw.js`: offline. A new build waits until the app is fully closed, so an update
  shows the second time the app is opened, or at once from the **Update** bar the app shows
  when a new build is waiting (`src/pwa-update.ts`; every open page reloads together).
- Decided with Mark on 15 Nov: map stops at MSC sections; one tap zooms in and opens the
  sheet; name stays `rabbit-hole`; commit straight to `main`; the course hangs on `15Axx`;
  KaTeX bundled; typed answers only until photo marking (Phase 5).

Run everything with `npm run check` (typecheck, lint, Vitest, Python tests, course
validation). Build and phone access are in [README.md](README.md). Open points and next
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
