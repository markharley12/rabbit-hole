# Writing a course

The contract for any session (human or agent) that writes or changes course content. It is
also the context the "new course" session will be started with (ROADMAP.md stage D). If this
file and the validator disagree, the validator is right and this file needs fixing.

Read [seed-context.md](seed-context.md) section 2 first: it is the learner's own spec of how
he wants to be taught, and every screen must obey it.

## 1. What a course is

A folder of JSON files, complete on its own: **the learner can finish it with no AI and no
network.** AI is for questions and for marking that code cannot do; it is never needed to get
from one screen to the next.

```
content/maths/courses/<course-id>/
  course.json          title, summary, the map node it hangs on, sources, lesson order
  <lesson-id>.json     one per lesson: screens ("blocks"), shown one at a time
  cheatsheet.json      optional: the formulas the course uses (section 9)
```

- `<course-id>` equals `course.json`'s `id` (kebab-case). `nodeId` is an id in
  `public/content/maths/map.json` (an MSC code such as `15Axx`, or a slug). Several courses
  may hang on one node.
- Schemas: `schema/course.schema.json`, `schema/lesson.schema.json`, `schema/cheatsheet.schema.json`.
  Widgets: `schema/widgets.json`. Read them before writing.
- A finished course is the example to copy: `content/maths/courses/least-squares-to-the-pseudo-inverse/`.

## 2. Where it goes on the landscape

Pick the **deepest map node the whole course fits under**. Search `map.json` by name, MSC
code and topic (`items`). If the course spans two sections of one subject, hang it on the
subject. Say in `course.json`'s `summary` what it covers in plain words, with both the short
and the long form of a name ("singular value decomposition (SVD)") so search finds either.
Never edit `map.json`.

## 3. Before writing: research and sources

- **Nothing from recall alone.** Every definition, theorem and worked number rests on a
  source you opened in this session (a textbook page, lecture notes, a reference article) or
  on a computation the validator repeats. List each in `course.json` `sources` with what was
  taken from it. A URL you did not open does not go in.
- Numbers come from one small worked example per lesson, held in the lesson's `data`. Every
  answer key is re-derived from `data` by sympy (section 5). Choose examples whose arithmetic
  is clean by hand: small integers, answers that are integers or simple fractions.
- If the learner has state (what he has done, his slips), start from it: reuse numbers he has
  already computed, so the first screens feel within reach.

## 4. The shape of a lesson

Three to eight lessons per course; four to ten screens per lesson (the schema allows twelve).
A lesson has one idea and ends on something the learner worked out himself.

Three kinds of screen: the **step** below (one task, a typed answer), a **text** screen, and the
two quiz screens, **choice** (pick the right option) and **order** (put the lines in order),
for what a typed number cannot test (section 12). Quizzes support the worked problems and never
replace them: a lesson has at least one step, and at most half its screens are choice or order.
Aim for 0 to 2 a lesson.

The main screen is a **step**: one task. In order it gives:

| Part | Rule |
| --- | --- |
| `define` | Every term the step uses for the first time, before it is used. At most three. |
| `why` | One or two sentences: why this step matters. Not a summary of the step. |
| `prompt` | Exactly one task, doable on paper in a few minutes. Say the form of the answer if it is not obvious. |
| `widget` | Optional. Put one where a picture answers "what is going on?" before he has to ask. |
| `answer` | Typed fields with exact keys, a `verify` expression, and `slips` (section 5). |
| `hints` | Exactly three: a nudge; a narrower nudge; a worked fragment. The first two must not contain the key. Never the answer first. |
| `check` | How he can verify his own answer before sending it (a dot product that should be zero, a value to substitute). Give one whenever such a check exists. |
| `solution` | Shown once he is right: what the result means. Short. |
| `next` | The one next action, as the button will say it. Never a choice. |

A **text** screen is only read. Use it rarely: to set a scene, or for a result too long to
derive here. Code appears only in a lesson's `sideQuest`, never in a step.

Writing rules: short sentences; he reads on a phone. Maths in `$...$` (KaTeX, strict). No
raw HTML. Links: `https://…`, `lesson:<lesson-id>`, `node:<node-id>`. Plain, specific titles
("Dependent columns: many best fits"), no cleverness. Do not praise.

## 5. Answers the app can check

Answers are typed, and checked on the phone with no model.

- A field's `key` is exact, in the answer grammar: integers, fractions (`3/5`), decimals,
  `sqrt(15)`, `^`, and single-letter variables listed in `vars` (`5m^2 - 12m + 9`).
- `matrix: [rows, cols]` lays fields out as a matrix; several unlabelled fields are a column
  vector; labelled fields (`"label": "$c$ ="`) are separate values.
- `verify` is an expression over the lesson's `data` that must equal the key. Its whole
  vocabulary is the `FUNCTIONS` table in `tools/validate_courses.py`: `sqrt tr pinv rank det
  sq unit dot entry eye eigs sv rsv lsv nullvec expand solvefor argmin vec`, plus `+ - * / ^`
  and the data names. **Write `verify` from the question, not from your key**: it is the
  independent check that catches a wrong key.
- `accept`: `negated` when either sign is right (a residual as fit − data, a singular
  vector); `multiple` when any non-zero multiple is right (a direction). Say so in
  `acceptNote`.
- `slips` name the mistakes worth catching, so the reply is precise instead of "wrong":
  `symmetric` and `transpose` (matrix answers), `scaled`, `swapped`, `sign`, and `known` (one
  specific wrong value and what causes it). For each step ask: what are the two or three
  likeliest wrong answers, and which slip of arithmetic produces each? Mark's own are in
  seed-context.md section 4: transposed rows, a non-symmetric AᵀA, sums, a factor not applied
  to both terms, sign conventions.

If a task cannot be checked this way (a proof, an explanation), split it into checkable
pieces (a dimension, a count, a specific vector), or make it a text screen followed by a step
that tests the consequence.

## 6. Widgets

Content may only name widgets in `schema/widgets.json`, with params that match the schema
there. Content never contains code. If a lesson needs a picture that no widget gives, **stop
and say which widget is missing and what it must show**; a new widget is a separate task
(app code under `src/widgets/` with pure, tested maths), not something a course invents.

## 7. Checking your work

```
npm run validate
```

It must end with every course valid. It checks the schemas, that the node exists, widget
names and params, every key against `verify` with sympy, that listed slips are not right
answers, that hints one and two do not give the key away, and that links resolve. Fix the
content, never the validator, unless the validator is provably wrong (then say so and stop).

Then read the course once as the learner: is every term defined before use; does each step
have one task; does each `next` say what happens next; would the first screen make him feel
capable?

## 8. What a course-writing session may touch

Only `content/<field>/courses/<its-course-id>/`, and `content/<field>/resources/<node-id>.json`
for the node it hangs on (section 10). Not `schema/`, `tools/`, `src/`, the map, or another
course. Leave the result uncommitted for Mark to look at unless told otherwise.

## 9. The cheat sheet

An optional `cheatsheet.json` beside `course.json` (`schema/cheatsheet.schema.json`). The
lesson shows it as a dock tool, marking the items of the lesson he is on; he adds his own
lines under "My notes", on his device, so nothing he types is ever in this file.

```
{ "format": 1, "sections": [ { "title": "Least squares", "items": [
    { "id": "normal-equations", "name": "Normal equations",
      "formula": "$A^\\mathsf{T}A\\,x = A^\\mathsf{T}b$",
      "when": "To find the best fit. There is exactly one best line when $A^\\mathsf{T}A$ is invertible.",
      "lesson": "normal-equations-from-your-points" } ] } ] }
```

- **Only what the course derives or uses.** Every formula is in one of its lessons. Nothing
  "while we are here"; a cheat sheet that grows past what he has met is a second course.
- **The course's own notation, exactly** (`A^\mathsf{T}`, `\|r\|^2`, `\sigma_{k+1}`), copied from the
  lessons, so the sheet looks like the screen he came from. Name a thing as the lesson does.
- 1 to 8 sections, 1 to 10 items each; aim for 10 to 16 items in all, in 3 to 5 sections. He
  gets overwhelmed by long lists.
- `name`: plain words, at most 50. `formula`: Markdown with KaTeX (strict, like lessons).
  `when`: one sentence, at most 200, that says when to reach for it, not what it is called.
- `lesson`: the lesson that derives it, when there is one. The validator checks it is one of the
  course's lessons.
- The validator checks the schema, that item ids are unique, and the Markdown as for lessons;
  the app's `src/lesson/content.test.ts` typesets every formula in strict KaTeX.
- The published `index.json` gets `"cheatsheet": true` for a course that has one. That flag is
  written by `--publish`; never put it in `course.json`.

### Tunnels to other courses

A tunnel joins two rabbit holes. Optional in `course.json`, at most 5:
`"tunnels": [{ "to": "<course-id>", "kind": "needs", "why": "One sentence, at most 160." }]`.

- `needs`: do that course first. Add it only for a **real prerequisite**: this course uses
  something from there without teaching it again (the PCA course uses the SVD and Eckart–Young
  from the least-squares one). If the learner could follow without it, it is not a `needs`.
  `needs` links may not form a loop; the validator checks.
- `related`: the same idea shows up there. Use it sparingly; one or two are plenty.
- `to` is another course in the same field; no repeats. Only the earlier course is named by the
  later one: "leads to" is worked out by the app from other courses' `needs`, so never write it.
- The app shows them as quiet lines on the node sheet ("Builds on", "Leads to") and offers the
  next course after the last lesson. A needed course that is not finished never blocks starting.

## 10. Reading for a node

Outside links belong to a **map node**, not to a course: `content/<field>/resources/<node-id>.json`
(`schema/resources.schema.json`). The lesson shows them as the Reading tool (the course's node and
its ancestors, nearest first), and the node's sheet shows its own. Other courses on the node, and
courses not written yet, get them for free.

```
{ "format": 1, "nodeId": "15Axx", "resources": [ {
    "id": "strang-1806-lecture-16", "title": "...", "by": "...",
    "kind": "video", "url": "https://...",
    "about": "What it is, one sentence.", "use": "When to reach for it, one sentence.",
    "free": true, "checked": "2026-11-15", "topics": ["least squares", "projection"] } ] }
```

- **Every URL was opened in this session and confirmed to be what the entry says.** The
  validator never fetches (it runs offline on every build), so `checked` is your word: the ISO
  date you opened it. A URL you could not open is not listed; say so in your report instead.
- Prefer **stable landing pages** (a course or book page, a lecture's page) over deep links,
  files that move, or search results. HTTPS only.
- A resource belongs to the **deepest node it fits**. A general linear algebra book goes on the
  linear algebra node, not on the section a course happens to hang on.
- `use` names the **topic**, not a lesson of one course ("When the SVD itself feels shaky", not
  "in lesson 4"): the file belongs to the node, and other courses will hang there.
- `about` and `use` are your own sentences. **Never copy text from the source**: summarise.
- `free` is `false` for anything behind a payment, even if part is free (say which part in `about`
  or `use`). `kind` is one of video, book, notes, article, course.
- `topics`: 1 to 6 short tags. 1 to 30 resources per file. Keep the list short enough to read on a phone.
- The validator checks the schema, that the file is named after `nodeId`, that the node is on the
  map, unique ids, https, and that `checked` is a real date that is not in the future.

## 11. Steps for spaced review

A step may carry `"review": true`. Once the learner has solved it (or been shown its answer) it
comes back in the app's Review after 1, 3, 7, 16, 35, 90 days, answered again from scratch. The
app's cheat-sheet formulas come back too, as recall cards, with no work from you.

- **Mark 1 to 3 steps per lesson**: the ones that are a skill worth still having in a month
  (build AᵀA, solve the normal equations, find a singular value), not the warm-up and not the
  last link of a derivation.
- **The prompt must stand on its own screen.** A review step is shown alone, with a clean
  record. Read its `prompt` as if nothing came before: if it says "with this A" or "using v1"
  and the matrix or vector is not written in the prompt, do not mark it. Do not rewrite a prompt
  to make it eligible without re-deriving its key and checking its hints.
- A step whose point is a widget interaction is a poor choice; the review screen does show the
  widget, but nothing checks that the prompt can be answered without it (the validator has no
  rule for this: nothing in a step says reliably).
- Its `next` label is shown on the review screen's button, so a label that names the next step
  ("Now Aᵀb") reads oddly there. Prefer steps whose `next` still makes sense, but do not rewrite.
- Nothing else changes: the schema allows `review` on steps only, and `--publish` lists the marked
  steps in the course's entry in `index.json` (`review: [{lesson, step}]`), not in `course.json`.

## 12. Quiz and puzzle screens

A **choice** is one question with two to five options; an **order** is three to seven lines to put
in sequence. Both keep the step's record (attempts, hint, shown), are checked on the phone with no
model, and can be marked `"review": true` (section 11).

**Use one when a typed number cannot test the idea:**

- which statement is true, or which object could exist ("which of these could be $A^\mathsf{T}A$?");
- why a step is valid ("what is $r$ perpendicular to?"), with the wrong reasons as the options;
- what stays the same and what changes (tick every one);
- the order of a proof, a derivation or an algorithm.

**Do not use one** when a number would do (make it a step, which also checks the arithmetic he slips
on); for a definition to be recalled with no reasoning; to pad a lesson; or for a question whose
wrong options are silly. A wrong option nobody could believe teaches nothing.

### choice

```
{ "type": "choice", "id": "which-could-be-ata", "title": "...", "why": "...",
  "prompt": "The question.", "widget": { ... },
  "options": [ { "id": "symmetric", "text": "...", "correct": true,  "say": "Why this is right." },
               { "id": "unequal",   "text": "...", "correct": false, "say": "The misconception it catches." } ],
  "multiple": false, "shuffle": true, "hint": "One nudge.", "solution": "...", "review": false, "next": "..." }
```

- `title`, `why`, `widget`, `hint`, `solution`, `multiple`, `shuffle`, `review` are optional. `multiple`
  true means "tick every right one" (at least one correct, at least one wrong); otherwise exactly one
  is correct. `shuffle` is on by default; turn it off only when the order carries meaning.
- **Every option has a `say`.** For a wrong option it names the misconception precisely and, where
  the lesson has the numbers, shows the check ("$r \cdot b = \frac32$, not 0"). It is shown when that
  option is picked wrongly, and for every option once the question is done, so write the `say`s to be
  read together, as a list: "A. Right. ..." then "B. Not this one. ...".
- **Each distractor is a real misconception**, one he could hold: a slip from seed-context.md section 4
  (a non-symmetric $A^\mathsf{T}A$, a transposed factor), a near-by true statement that answers a different
  question ($\lambda$ for $\sigma$), or a result that is true of something else. Not a joke, not "none of
  the above", not an option that is wrong only by being longer or vaguer.
- Options of one length and shape, so the right one cannot be picked by looking. Texts must differ.
- The prompt asks one thing, in the positive ("which could be", not "which could not be").
- `multiple`: the app says how many of his ticks are right, and gives the `say` of each wrong tick. It
  never says which unticked options are right.
- What he is told: after two wrong tries "Show the answer" appears; it is never shown unasked. One `hint`
  at most, a nudge toward the idea, never the answer.
- Add nothing the lessons do not already establish. Use the course's own notation and numbers.

### order

```
{ "type": "order", "id": "order-the-proof", "title": "...", "why": "...",
  "prompt": "What is being ordered.",
  "items": [ { "id": "take-b", "text": "..." }, { "id": "null-space", "text": "..." }, ... ],
  "fixed": ["take-b"], "say": { "null-space": "A nudge for when this line is the first out of place." },
  "hint": "...", "solution": "...", "review": false, "next": "..." }
```

- **List `items` in the correct order**; the app shuffles them (never into the correct order).
- **Exactly one valid order.** Lines the checker cannot tell apart are not supported: it marks the
  first line from the top that is not where you wrote it. Test your puzzle: could any two lines swap and
  still read as a proof? If so, rewrite the lines so each uses something the one above it gave ("add the
  dimension of the span to that"), or drop one of them. The validator can only check that the texts differ.
- Three to seven items. `fixed` lists lines shown already in place (the first or last, given), at least
  three stay movable. `say` is optional, per item id: the nudge shown when that line is the first one out
  of place (a good one asks "what must come before this?"). Without it he sees "The line marked is not
  where it belongs yet." The app marks one line only: a hint, not the answer.
- After three wrong tries "Show the answer" appears; it is never shown unasked.
- Lines are Markdown (maths in `$...$`); one short sentence each, so they fit a phone row.

### Review

Marked quiz screens come back in review like steps: from a clean record, with a fresh shuffle, graded
the same way (right first time and no hint is good; right after a wrong try or the hint is hard; shown is
again). The prompt, the options and the lines must make sense alone: put every number in the screen
itself, not "the matrix above".

### What the validator checks

The schema; ids unique; choice: one correct option (or at least one when `multiple`), at least one
incorrect, distinct texts; order: `fixed` and `say` name real items, three movable, distinct texts; every
Markdown string; widgets; the lesson rules (one step at least, quizzes at most half). It cannot check
that distractors are good or that the order is unique: that is for the author and the reviewer.

## 13. Parts that arrive with later stages

Added to this file when they exist (ROADMAP.md): prerequisite levels between map nodes (E1).
