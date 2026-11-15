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
```

- `<course-id>` equals `course.json`'s `id` (kebab-case). `nodeId` is an id in
  `public/content/maths/map.json` (an MSC code such as `15Axx`, or a slug). Several courses
  may hang on one node.
- Schemas: `schema/course.schema.json`, `schema/lesson.schema.json`. Widgets:
  `schema/widgets.json`. Read all three before writing.
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

Only `content/<field>/courses/<its-course-id>/`. Not `schema/`, `tools/`, `src/`, the map, or
another course. Leave the result uncommitted for Mark to look at unless told otherwise.

## 9. Parts that arrive with later stages

Added to this file when they exist (ROADMAP.md): a course's formula cheat sheet (B1), reading
links attached to map nodes (B2), steps marked for spaced review (C), tunnels to other
courses (E1).
