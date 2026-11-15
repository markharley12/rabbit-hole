# Handoff: first implementation brief

For the stronger model that builds this. Read [../CLAUDE.md](../CLAUDE.md), then
[PLAN.md](PLAN.md) and [REUSE.md](REUSE.md). Nothing is built yet.

## Before you write code

1. Read [seed-context.md](seed-context.md): Mark's learning style in his own words, where he
   got to, his slip patterns, and the product implications (step-based lessons, slip
   diagnosis, learner state as the resume prompt). It shapes Phases 1–2 more than Phase 0.
   Note section 5 (a conflict with his notes repo's mastery scores) before seeding any scores.
2. Resolve PLAN.md section 7 with Mark only where it blocks Phase 0 (name, how deep the map
   zooms). Everything else has a stated default.
3. Pick the project's git branch policy (this repo starts on `main`; no remote yet).

## Phase 0 task: the map, on his phone

**Goal:** an installable PWA that shows all of mathematics as one zoomable map, with a node
sheet, working well with one thumb. No server, no AI, no lessons.

Done when:

- `tools/build_maths_map.py` (Python, stdlib) reads `~/git/TreeQuiz/datasets/maths/{tree,info,manifest}.json`
  and writes `public/content/maths/map.json` (unique stable ids, tree, per-node `items`/`url`,
  source commit and licence recorded). Tested.
- The app renders the map (PLAN.md 4.2: zoomable circle packing is the recommendation; build
  the data layer so the renderer is swappable), with: pinch/pan, tap-to-zoom, adaptive labels,
  breadcrumb showing the ancestry, a home button, branch colours, sizes by topic count.
- Tapping a node opens a bottom sheet: name, MSC code, where it sits, its topics, and an
  honest "No course yet" (no fake Generate button until the server exists, or a clearly
  disabled one).
- Works offline once loaded (service worker per REUSE.md's traps), installable, dark and light.
- Tested in the **built-in browser at mobile size** during development (screenshots, console
  clean), and then **on his real phone** (Mark runs it; the emulator doesn't work on this PC).
- Unit tests for the data build and the pure layout/label helpers; lint and typecheck clean.
- CLAUDE.md "Status" updated; commits are small and meaningful.

**Do not** in Phase 0: add Capacitor/Android (Phase 0.5, once the map is good), invent
prerequisite or difficulty data, or write lessons.

## Standing guidance

- Keep it simple and small; the map is the product.
- Prefer deterministic, tested data tooling over LLM-in-the-loop at runtime.
- Every claim about content gets a source; every score is a score or a blank.
- When a design choice needs Mark, ask in one short question with a recommended default.
- Commit to this repo only; don't push anything anywhere without being asked.
