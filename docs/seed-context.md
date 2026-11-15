# Seed context: how Mark actually learns maths with Claude

Condensed 15 Nov 2026 from **one pasted claude.ai chat** (two sessions on least squares, then
dependent columns). More chats may follow; add them as dated sections. **Provenance caveats:**
the paste had no dates, and its two blocks arrived in reverse order. Session A (full-rank
least squares) came first and ended with a hand-written "start a new chat" prompt; session B
(dependent columns) began from that prompt. Anything marked *(derived)* is my own arithmetic,
not in the chat, and should be sympy-checked before it goes into a course.

## 1. What this chat is evidence of

The workflow the app replaces, as it really ran:

1. Mark pastes a prompt giving the **teaching style** and **where he is**.
2. Claude gives **one short task**; he does it **on paper** and sends a photo or **types the
   result**; Claude checks it, names slips precisely, and gives one next task.
3. When the chat gets long he asks to **compact** it (a Claude Code command, which doesn't
   exist in claude.ai) and ends up **hand-writing a resume prompt** to start a fresh chat.

Step 3 is the clearest product signal: **he is manually maintaining learner state** (what I
understand, the worked example, the next step, how I like to work). The app should keep that
state itself and never make him write it.

## 2. His teaching-style spec, verbatim (this is the tutor's system prompt, as he wrote it)

> Small steps, one at a time. Give me one short task, I do it on paper and send a photo or type
> the result, then you check it and give the next step.
> Hints, not answers. If I'm stuck, nudge me and let me try again. Point out slips (arithmetic
> or conceptual) precisely.
> Define terms before using them, and say why a step matters. I get overwhelmed by long lists
> of options, so recommend one next step rather than a menu.
> Keep replies short. I'm reading on my phone.

Every generated lesson step and every marking reply should obey this. "Recommend one next step
rather than a menu" applies to the app's own UI too: **one clear next action per screen**.

## 3. Where he was (understanding, as he stated it)

- **SVD:** understands the geometry (rotate, stretch, rotate). Proved the **easy half of
  Eckart–Young by hand**: ‖A − A_k‖₂ = σ_{k+1}. **Still to do: the hard half**, that no matrix
  of rank ≤ k does better. His key idea: a rank-≤k matrix has a large null space, which must
  overlap span(v₁…v_{k+1}).
- **Least squares:** best fit = minimise ‖Ax − b‖². At the best fit the residual r = b − Ax is
  perpendicular to every column of A, which gives AᵀAx = Aᵀb. Each entry of AᵀA is a dot
  product of two columns; each entry of Aᵀb is a column dotted with b.
- **Worked example (hand-solved and checked):** points (1,1), (2,2), (3,6), fit y = c + mx.
  Columns (1,1,1), (1,2,3), b = (1,2,6). Normal equations 3c + 6m = 9 and 6c + 14m = 23,
  so c = −2, m = 2.5, ‖r‖² = 1.5. He compared guessed lines first (y = x: 9; y = 1 + 1.5x: 6.5;
  y = 1 + x: 6) before finding the best, and noticed the best intercept is negative, which no
  guess near the data would have found.
- **Dependent columns (session B):** same b, all three x = 2, so a₂ = 2a₁. He built AᵀA and
  Aᵀb, saw the two normal equations were the same equation (c + 2m = 3), found r = (−2, −1, 3)
  (predictions all 3), and confirmed r·(1,1,1) = r·(2,2,2) = 0, concluding **every point on the
  line c + 2m = 3 is a genuine best fit** (same predictions, same residual, same error).
- **Where it stopped:** the task "find the p on c + 2m = 3 with the smallest c² + m²" (the
  minimum-norm solution, which the pseudo-inverse returns) was set and **not yet answered**.
  *(Derived, and checked in numpy on 15 Nov: AᵀA = [[3, 6], [6, 12]], Aᵀb = (9, 18); the
  minimum-norm p is c = 0.6, m = 1.2 with ‖p‖² = 1.8; ‖r‖² = 14. The full-rank example's
  lstsq gives c = −2, m = 2.5, ‖r‖² = 1.5, matching his.)*
- **Declared next:** pseudo-inverse via SVD; the hard half of Eckart–Young.

## 4. How he works, from the evidence

- **Conceptual strength, bookkeeping slips.** Every error in the chat was mechanical:
  transposed rows of Aᵀ; an AᵀA that wasn't symmetric (12 and 1 off the diagonal); addition
  slips in Aᵀb (1+2+6, 2+4+12), twice; 6(3 − 2m) expanded as 18 − 12m wrong (6 not applied to
  both terms); and a harmless sign convention flip (fit − data instead of data − fit). He
  **self-corrected well when given a way to check**, and used perpendicularity to verify his
  own answers, which is the right instinct. Add these to the slip catalogue (section 6).
- **He likes comparing before optimising** (guess lines, tabulate errors, then the best),
  and derived the normal equations from "r ⊥ every column" rather than being handed them.
- **He declined code.** Offered a numpy check against `np.linalg.lstsq`, he said: *"Nah I don't
  want to do programming let's just do some more paper maths."* Code exercises are **opt-in,
  never the default**, even though he is a software engineer.
- **Phone reading.** Short replies. A table was used for the error comparison and read fine;
  long option lists overwhelm him.
- **He asks for titles.** ("also what's a good title for this") Name lessons and sessions in
  plain, specific words (e.g. "Least squares with dependent columns").
- **Typing vs photo:** he sent typed answers for short results, photos for page work. The
  app should accept both on every step.

## 5. A conflict to reconcile (don't paper over it)

His notes repo (`Routine/Growth/Learning/Maths/Session-Start.md`, as of **19 Oct 2026**)
records linear algebra as scored **low** (L1–L3 about 1/10: didn't know what Σ and U in the
SVD questions meant; SVD was taught that day from his own matrix; PCA not taught; re-test
pending). This chat describes a clear understanding of SVD geometry and an Eckart–Young proof.
**The chat is undated.** Either it is after 19 Oct and he has genuinely moved on (videos,
practice), or it is a different, easier framing. **Do not seed the mastery overlay from this
chat.** Treat it as *claimed*, and let the planned re-test (L1–L3) or the app's own marking
set the score. Ask Mark for the chat's date. This is also the example of why "a blank is not
a zero" and "claimed is not scored" must be first-class in the data model.

## 6. What this means for the product (inputs to PLAN.md, for the implementer to weigh)

1. **A step-based lesson block.** The unit of teaching here isn't a page of text, it's a
   micro-step: *term defined → why it matters → one task → attempt → check → next*. Add a
   `step` block (or make it the main lesson shape) with: `prompt`, optional `define`, `why`,
   `expect` (one or more accepted forms), `hint` ladder (nudge → narrower nudge → worked
   fragment, never the answer first), and `next` (exactly one).
2. **Deterministic slip diagnosis.** Most of his errors can be named by code, not a model:
   Aᵀ row order, AᵀA symmetry (a free sanity check), sum slips, distribution slips, and sign
   convention (accept r = data − fit *or* fit − data). The checker returns *which* slip, e.g.
   "AᵀA should equal its own transpose; entries 12 and 1 should match". Build a small library
   of slip detectors per topic; the generator proposes new ones, sympy verifies them.
3. **Self-check affordances.** He solved his own problem once told "check r·(1,1,1) = 0
   yourself". Give each step a **"check it yourself" tool** (a small calculator or widget)
   so he can verify before sending.
4. **Widgets this chat points at** (build as vetted library entries, not generated JS):
   - *Line fitter:* drag a line over three points; live ‖r‖² and r·columns; shows the best
     line is where residual ⟂ columns. Includes the guess-and-tabulate comparison.
   - *Column-space projection:* b, its shadow on the column space, residual as the
     perpendicular drop (2D and 3D).
   - *Dependent columns:* the solution set c + 2m = 3 as a line in the (c, m) plane, error
     level curves constant along it, and the minimum-norm point where a circle touches it.
   - *SVD geometry:* unit circle → rotate → stretch → rotate → ellipse, sliders on σ's; and a
     rank-k truncation that shows error = σ_{k+1}.
   - *Eckart–Young hard half:* a dimension-counting picture (null space of a rank-≤k map must
     meet span(v₁…v_{k+1})), likely 3D with a rank-1 example.
5. **Learner state is the resume prompt.** The prompt he wrote by hand (style, understanding
   bullets, worked example, next options) is the exact shape of the learner-state record:
   `style`, `understands[]`, `workedExamples[]`, `stuckOn[]`, `nextCandidates[]`. The app
   keeps it and can render it as "where I am" or feed it to a Claude session. No more manual
   compaction.
6. **Capture a "next step" at every stopping point.** Both sessions ended on one explicit
   next action; that is what makes returning easy.
7. **Code is optional.** Provide "check in numpy" as an offered side-quest per lesson, off by
   default.

## 7. Good first course (Phase 2 slice), given all this

**"Least squares to the pseudo-inverse"**, picking up exactly where he stopped, rather than
the SVD course the plan first guessed: (1) normal equations (recap, already his), (2)
dependent columns and non-unique best fit, (3) minimum-norm solution (his pending task),
(4) pseudo-inverse via the SVD, (5) why Eckart–Young's hard half holds. It reuses the
line-fitter, dependent-columns and SVD-geometry widgets, uses numbers he has already
computed (so the first screens feel capable, per his Session-Start preference), and ends at
the thing he named as next. Verify every key with sympy before shipping.

## 8. Open questions about this seed

- What date was the chat, and what led up to the understanding it states (the Strang and
  Brunton videos?). See section 5. *Asked 15 Nov 2026: Mark doesn't remember the date, so it
  stays undated; nothing depends on it.*
- Does he want the app's tutor tone to match the chat's (warm, short, "Good setup, and A is
  exactly right")? The chat's replies suited him enough that he asked to continue.
- Are there other chats (probability, optimisation, the SVD teaching session)? Add them as
  further dated sections.
