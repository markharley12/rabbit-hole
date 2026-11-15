# Brief: the first course, "Least squares to the pseudo-inverse"

For the session that builds PLAN.md's Phase 2 slice: the lesson format, a small widget
library, and one real course on the map. Written 15 Nov 2026 after Phase 0 shipped. Start
the session in `~/git/rabbit-hole`; it will read [../CLAUDE.md](../CLAUDE.md) first.

## Read first, in this order

1. [../CLAUDE.md](../CLAUDE.md): rules, and what Phase 0 built and where.
2. [seed-context.md](seed-context.md), **all of it**. It is Mark's own spec of how he wants to
   be taught, where he got to, and his slip patterns. This brief only summarises it.
3. [PLAN.md](PLAN.md) sections 4.4 (data model, block types, checking) and 5 (phases).
4. [HANDOFF.md](HANDOFF.md), the last section ("Phase 0 as built"): what exists, what is untested.

## The goal

One course Mark will actually use, on the map, in the app on his phone, picking up exactly
where he stopped. Order of work, because the format must exist before the content:

1. **Lesson format.** A JSON Schema in `schema/` and TypeScript types. Block types from
   PLAN.md 4.4, with `step` as the main shape (see below).
2. **Lesson renderer** in the app: Markdown plus KaTeX, steps one at a time, a progress
   record kept on the device. Phone first; one clear next action per screen.
3. **Widgets**, from a vetted library (generated content may only name widgets that exist).
   Build three: *line fitter*, *dependent columns*, *SVD geometry*. A fourth, *column-space
   projection*, only if the first three go cleanly.
4. **The course**, attached to the map node for least squares / generalized inverses, so the
   sheet says "Course" instead of "No course yet" for that node and its Start button opens it.
5. **A validator** in `tools/` (schema, widget names exist, every answer key re-verified by
   sympy, links resolve) that must pass before the course is allowed into `public/`.

## What Mark has already done (the course starts from here)

Understands SVD geometry; proved the easy half of Eckart–Young; derived the normal equations
from "residual is perpendicular to every column of A" and hand-solved a worked example. He has
**not** yet answered the task he was last set. Full detail and the arithmetic are in
seed-context.md sections 3 and 6. The numbers he already computed, which the first screens
should reuse so he feels capable:

- Points (1,1), (2,2), (3,6), fit y = c + mx. Columns (1,1,1) and (1,2,3), b = (1,2,6).
  Normal equations 3c + 6m = 9 and 6c + 14m = 23, so c = −2, m = 2.5, ‖r‖² = 1.5.
- Dependent columns: same b, all x = 2, so a₂ = 2a₁. AᵀA = [[3,6],[6,12]], Aᵀb = (9,18), both
  equations are c + 2m = 3, residual r = (−2,−1,3), ‖r‖² = 14. Every point on c + 2m = 3 is a
  best fit.
- His unanswered task: the point on c + 2m = 3 with the smallest c² + m². **Answer (verified
  in numpy on 15 Nov, re-verify with sympy): c = 0.6, m = 1.2, ‖p‖² = 1.8.**

## Course outline (from seed-context.md section 7; change it if it teaches better)

1. Normal equations, a recap built from his own example (he can skim it).
2. Dependent columns: the best fit is not unique.
3. The minimum-norm solution: his pending task, as the first real new step.
4. The pseudo-inverse via the SVD, and why it returns that minimum-norm point.
5. Why the hard half of Eckart–Young holds: a rank ≤ k matrix has a large null space that
   must meet span(v₁…v_{k+1}).

Aim for roughly 5 to 7 short steps per lesson. Name lessons in plain, specific words.

## The `step` block (the unit of teaching)

From Mark's teaching spec: small steps, one task at a time; hints not answers; define terms
before using them and say why a step matters; recommend one next step, never a menu; short
replies, because he reads on his phone. So a step carries: `prompt`, optional `define`, `why`,
`expect` (one or more accepted forms, typed or from a photo), a `hint` ladder (nudge, then a
narrower nudge, then a worked fragment, **never the answer first**), and `next` (exactly one).

**Deterministic slip diagnosis** is part of the format, not an extra. His real errors were all
mechanical: transposed rows of Aᵀ, an AᵀA that is not symmetric, addition slips in Aᵀb, a
factor not applied to both terms, and a sign convention flip (accept r = data − fit *or*
fit − data). The checker should name which slip, e.g. "AᵀA should equal its own transpose;
entries 12 and 1 should match". Each step gets a "check it yourself" affordance he can use
before sending (a small calculator or the widget).

## Rules that bite here

- **Code is opt-in.** He declined numpy ("I don't want to do programming"). Any "check in
  numpy" is an offered side-quest, off by default, never a step.
- **Verify every key with sympy** (sympy 1.14 and numpy are installed for `python3`; run
  Python with `env -u PYTHONPATH`). The generator must produce a key its own verifier
  confirms. Anything in seed-context.md marked *(derived)* is unchecked until you do it.
- **Claimed is not scored.** Do not set any mastery score for him from the chat. His notes
  repo scored linear algebra about 1/10 on 19 Oct 2026; the chat describes much more
  understanding and is undated (seed-context.md section 5). The course records attempts and
  progress only. A blank is not a zero.
- **No generated JavaScript.** Widgets are named, parameterised library entries, written and
  tested as ordinary app code.
- **Learner data stays out of git.** Progress is on the device; any export goes under the
  gitignored `data/`.
- Keep the Phase 0 rules: kebab-case file names (React components PascalCase), one shell
  command per line in anything he will paste, no API keys, commit small and often to `main`,
  push nothing. Run `npm run check` before and after changes; every fixed bug gets a test.
- The map data layer (`tools/build_maths_map.py`) is regenerated from TreeQuiz and must stay a
  faithful copy. Do not hand-edit `map.json`. Attach the course through a separate file (for
  example `content/maths/courses/<node-id>/course.json`) and have the app join them by node id.
- Mark's notes repo (`~/Documents/Mark`) is read-only from here.

## Questions to ask Mark early (one short message, with a recommended default for each)

1. **Which map node** carries the course? Recommend `15Axx` (Basic linear algebra), whose
   topics include generalized inverses, singular values and factorization. Alternative: `65Fxx`
   (numerical linear algebra) for the least squares side.
2. **Math rendering:** KaTeX bundled in the app (recommended; offline) is the default. Say if he
   prefers plain-text maths on the phone.
3. **Answer entry on the phone:** typed answers first (recommended), with photo marking left
   for Phase 5 (it needs the server). Confirm he is happy with typed-only for now.
4. The date of the seed chat, if he remembers (seed-context.md section 5). Not blocking.

## Done when

- The schema, renderer, three widgets and the validator exist, with tests, and `npm run check`
  passes.
- The course has 5 lessons, every answer key sympy-verified by the validator, and no lesson
  contradicts seed-context.md's description of what he already knows.
- On the map, the chosen node shows a real Course entry and Start opens lesson 1; progress
  survives closing the app; it all works offline.
- Checked in the built-in browser at mobile size, then handed to Mark for his phone (the
  tailnet URL is in README.md). Say plainly what only his phone can check.
- CLAUDE.md "Status" and HANDOFF.md updated. Commits small and meaningful.

## Suggested session setup

Run it in Opus 5.5, in this folder, with this prompt:

> Read docs/first-course-brief.md and follow it. Start by reading the four docs it lists, then
> ask me the early questions in one message and wait.
