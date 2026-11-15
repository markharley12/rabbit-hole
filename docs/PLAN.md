# Plan

Written 15 Nov 2026 from Mark's voice description. **Three kinds of statement below, kept
apart on purpose:** *Decided* (Mark said it), *Recommended* (the planner's call, argue with
it), *Open* (needs Mark or an experiment).

## 1. Why this exists

Mark was learning fields of maths (linear algebra: SVD and so on) inside a Claude chat. The
loop was: get a description of the field, get problems, solve them on paper, photograph the
page, get it marked and taught. It worked but was **slow and unpolished**:

- Feedback needed a round trip per step; marking was a manual photo-upload-and-wait.
- When a concept didn't land he had to *decide to ask* for a visualisation, then wait for it.
- Content (videos, PDFs) was outside the chat, so he left the tool to learn.
- Much of this is **deterministic**: the path through SVD is well known, so lessons,
  visualisations and problems can be generated *once, ahead of time*, not improvised in a chat.

Brilliant.org has the right feel but a fixed catalogue. OpenAha and Mathigon (open source) are
lovely but their "advanced" ends well before where Mark wants to go, and they can't be
extended by asking. Nothing found combines: a **map of the whole field**, **AI-generated
courses** into the app's own format, interactive widgets, deterministic problem checking, and
**photo marking**. (The landscape check is summarised at the end of [REUSE.md](REUSE.md).)

## 2. Decided (Mark's words)

1. **A new Git project.** Public on GitHub eventually, but it is **for Mark**: marking and
   generation depend on his setup, so it need not be turnkey for others (same as Jarvis).
2. **Start with the map.** A UI that shows the **entire field of mathematics** as a big
   visualisation, then lets him go into subject areas. Maths first, other fields later.
3. **The picture must show where a rabbit hole sits in the broader field**, difficulty rising
   as you go down, and the **prerequisites** needed to go further.
4. **Mobile app first.** Desktop version possibly later.
5. **AI-native, via Claude Code sessions, no API keys** — like Jarvis. Claude Code on his PC
   has file editing and context; the app is a front end to it.
6. **Content is generated and baked in as files.** The map starts mostly empty (no courses).
   In a node, a button proposes **auto-generated course prompts**; accepting one has the AI
   (which knows the app's file structure) write the course files into the app.
7. **Updates without a new app version:** the app can download updated/new content files via
   the AI integration, not only via an app release.
8. **Reuse his earlier work:** the maths tree in TreeQuiz, his Maths notes repo (diagnostic,
   marking loop, scores) as prerequisites, and components from jarvis-voice. See REUSE.md.
9. **Photo marking** (take a picture of paper work, send it into a Claude Code session) stays,
   and is the main reason this is personal-setup-specific.
10. **A stronger model implements this.** This repo's docs are the condensed handoff. Mark
    will separately supply recent maths chats as seed context.

## 3. The product in one picture

```
 MAP (whole field)  ──tap──▶  NODE (a subject / topic)  ──tap──▶  COURSE  ──▶  LESSON
 size = how big a field        what it is, where it sits,         generated     text + widgets
 colour = branch               prerequisites, depth/level,        files         + problems
 overlay = my mastery          [Generate a course ✦]                            (auto + paper)
```

The zoom levels are the hierarchy Mark already has in TreeQuiz's maths tree:
**Mathematics → branch (5) → area → MSC subject → MSC section (517 leaves) → topic (about
4,810 in `info.json`) → course → lesson.** The MSC leaves are research-field granularity; the
*topic* layer under them is where actual courses attach, and courses can be proposed below even
that (e.g. SVD sits under 15A/65F topics).

## 4. Recommended architecture

### 4.1 Stack — web app, wrapped for Android

**Vite + React + TypeScript, installable as a PWA, wrapped with Capacitor for an APK.** Why:
it is exactly what TreeQuiz already ships (React 19, Vite 8, TS 6, MUI, Capacitor 8.5.2, a
signed APK sideloaded and working, iPhone via Add to Home Screen); lessons need rich
interactive visualisations, which the web does far better than Flutter/React Native/Kotlin;
and generated content is just JSON/Markdown plus widget names. Jarvis's Kotlin app is the
wrong template here: it exists for a foreground microphone service, which the map doesn't need.
Only reach for native if a concrete need appears.

*Open:* UI kit (MUI like TreeQuiz, or lighter). Rendering library for the map (4.2).

### 4.2 The map visualisation — the hard part

**Recommended: zoomable circle packing (semantic zoom) with `d3-hierarchy` + `d3-zoom`**,
SVG at first (about 600 nodes is fine), canvas if prerequisite edges make it heavy. Pinch/pan
free, tap to zoom to a node, labels appear for the deepest nodes big enough to read, so the
whole field and a single section are the same continuous picture. Breadcrumb and a "home"
button always show where you are. A bottom sheet shows the node.

Alternatives considered: sunburst (poor on a phone, tiny wedges), treemap (good density but
weaker "where am I" feel), `react-d3-tree` node-link (what TreeQuiz uses for its explore
mode; fine for ancestry, bad for seeing the whole field at once). Worth a 1-hour prototype of
two before committing; the data layer must not depend on the choice.

Size encoding: leaf size by topic count, not 1 each, so big fields look big. Colour: one hue
per branch. **Overlays** (toggle): mastery (from Mark's Map.md scores, blank = grey, never
0), generated-course coverage, difficulty band, prerequisites of the selected node.

### 4.3 Difficulty and prerequisites — a separate layer, not part of MSC

MSC is a *classification*, not a learning order, and has no difficulty. So this is new data:

- `level` per node (suggested 1–5, e.g. school / first-year / upper undergrad / graduate /
  research). Needs a rubric written down so generated values are consistent.
- `prereqs`: directed edges between nodes (a DAG). Stored in a separate file, e.g.
  `content/maths/prereqs.json`, so the tree stays a faithful copy of its source.
- Produced by Claude Code from the tree + info, then **validated by a script** (no cycles,
  ids exist, level never decreases along a prerequisite chain) and reviewed by Mark in the app.
  Expect to iterate; treat the first pass as a draft.
- In the UI: selecting a node highlights its prerequisite chain on the map and lists them.

### 4.4 Data model and content packs

Content is **files in the repo** (Git for the human-meaningful ones), **bundled into the app
as a snapshot** and **updatable over the network** (Decided #7).

```
content/
  index.json                 # packs, versions, content hashes — what the app diffs against
  maths/
    map.json                 # tree + per-node info (built by tools/ from TreeQuiz's dataset)
    prereqs.json             # edges + levels (4.3)
    courses/<node-id>/
      course.json            # title, summary, lesson order, prereq node ids, level
      <lesson-id>.json       # blocks (below)
data/                        # gitignored: attempts (photos), marking results, progress export
```

**Update after the first seed chat ([seed-context.md](seed-context.md) section 6):** Mark's
real unit of learning is a *micro-step* (define → why → one task → attempt → check → one next
step), with deterministic slip diagnosis. Treat a `step` block as the main lesson shape, ahead
of long text pages, and make learner state a stored record, not a hand-written resume prompt.

A **lesson is a list of typed blocks**, validated against a JSON Schema in `schema/`:
`text` (Markdown + KaTeX), `widget` (name + params, from a vetted library), `problem` (auto-
checked: numeric/symbolic answer plus checker), `paper-problem` (photographed and marked),
`reveal`/`hint`, `figure`. **Recommended: LLM output may only reference widgets that exist
in the library** (matrix-transform, SVD sliders, function plotter, graph explorer, probability
tree…). Arbitrary generated JS is a security and quality risk; add a sandboxed-iframe escape
hatch later, if ever. Growing the widget library is itself a Claude Code task.

**Checking:** problems with a closed-form answer carry a machine checker. **sympy runs at
generation time** to verify every answer key (the generator must produce a key that its own
verifier confirms); the app does simple numeric/symbolic comparison at runtime. Only
`paper-problem` calls a model.

**Storage on device:** text is small (even all 4,810 topic summaries ≈ a few MB). Bundled
snapshot in the APK; downloaded updates in IndexedDB or Capacitor Filesystem; progress in
IndexedDB. "Lots of data" is not a real constraint unless videos/images are embedded; avoid that.

### 4.5 AI integration (the Jarvis pattern, no API keys)

A small **server on Mark's PC** (Python stdlib like Jarvis, or Node; reached over Tailscale
via `tailscale serve`, bound to 127.0.0.1) which:

1. **Serves content** to the app: `GET /rabbit/content/index.json` + pack files, so a phone
   without a new APK can pull new courses.
2. **Proposes courses**: app → "suggest courses for node X" → server runs `claude -p` in this
   repo (its CLAUDE.md and `schema/` give it the file contract) → returns 3–5 proposals as
   JSON (title, one-line aim, level, prereqs, estimated lessons) → Mark ticks what he wants.
3. **Generates courses** as a background job from accepted proposals: Claude Code writes
   files under `content/maths/courses/<id>/`, runs `tools/validate` (schema, sympy answer
   checks, widget names exist, links resolve); failures are fed back for repair; success bumps
   `index.json`; the app shows progress and then the new course.
4. **Marks paper work**: app uploads photos → `data/attempts/inbox/` → Claude Code session
   marks against the lesson's key (and its own working; the key loses if wrong) → structured
   result JSON → app shows feedback and updates mastery. This is Mark's existing Maths marking
   loop (Session-Start.md) productised.
5. **Permissions:** reuse Jarvis's model — headless `claude -p`, stream-json, permission
   prompts relayed to the phone (allow file writes under `content/`, ask for anything else),
   refuse `sudo`/`git push`/`rm -r`. Generation is bounded to `content/` and `data/`.

Review step: generated content lands as **uncommitted changes (or a branch)** that Mark can
glance at before it is committed; he decides what is "public". Courses are content and can
go on GitHub; `data/` never does.

*Open:* push vs poll for job progress (SSE like Jarvis's event stream is the obvious choice);
whether generation runs in a git worktree to keep `main` clean.

### 4.6 Learner state

Per node: `score` (0–100, or none), `confidence` (low/medium/high), `last checked`, mirroring
the scheme in Mark's `Map.md` ("done" = 80+ at medium confidence; scores fade after 12
months). Per lesson: blocks completed, problems attempted/correct, paper attempts. Stored on
the device and exportable to `data/`; **a one-way import from Map.md** seeds the mastery
overlay at first. *Open:* long-term, which is the source of truth (the notes repo or the app)?
Don't decide until the app has scores of its own.

## 5. Phases

Each phase ends with something Mark can hold on his phone.

| Phase | Deliverable | Notes |
| --- | --- | --- |
| **0. The map** | PWA showing all of maths as a zoomable map; tap a node → sheet with name, MSC code, topics, "no course yet". Installed on his phone | Data from `tools/build_maths_map.py` reading TreeQuiz's `datasets/maths/`. No server, no AI. Tests for data build and layout helpers |
| **1. Levels and prerequisites** | `level` + `prereqs` data (generated, validated), highlight a node's prerequisite chain, difficulty overlay | First real use of Claude Code to produce content; defines the validate-script pattern |
| **2. Lesson format + one hand-made slice** | Block schema, lesson renderer (KaTeX), 3–4 widgets, auto-checked problems. **One course: "Least squares to the pseudo-inverse"** (seed-context.md section 7), because it resumes exactly where he stopped | Prove the format on content Mark will actually use |
| **3. Server and sync** | PC server: serve content, content-pack diff/download in the app, **no-APK-update** works | Adapt Jarvis server skeleton and tailnet setup |
| **4. Generate** | "Suggest courses" → tick → background generation → validate → appears on the map | The AI-native loop. Needs 1–3 |
| **5. Photo marking** | Camera → upload → marking → feedback and mastery update | Port of the Maths-Attempts flow |
| **6. Mastery overlay, spaced re-checks** | Scores on the map, revisit prompts | Reconcile with Map.md |
| **7. Later** | Desktop layout, other fields (TreeQuiz already has physics, chemistry, languages… trees), voice via Jarvis, public release | |

Mark wants to **start using it straight away**: phases 0–2 are chosen so the first usable
thing is the map plus one real course, before the AI plumbing.

## 6. Risks

- **Generated maths is wrong.** Mitigation: sympy-verified keys at generation; a second-pass
  review prompt; a visible "report an error" action that writes to a log the generator reads.
- **Map readability on a phone.** 517 leaves + labels is the risk. Prototype early, test on
  the actual phone (TreeQuiz found the emulator unusable on this PC — use the device).
- **Prereq/level quality.** LLM-made, uneven. Keep it a separate editable layer; let Mark
  correct it in-app or in the file.
- **Handwriting OCR on messy paper.** Existing evidence is that the photos so far were
  legible; keep the "ask for a clearer photo and mark nothing unreadable" rule.
- **Scope.** The map is the product; resist building the whole lesson platform in phase 0.
- **Licence.** MSC data is non-commercial, share-alike; fine for this, note it in README.
- **Cost/latency of generation** is on his Claude plan, not an API bill; long jobs need
  timeouts, retries and resumability (Jarvis's turn timeout is 300 s: generation needs more).

## 7. Open questions for Mark

1. Name: keep `rabbit-hole`?
2. Hierarchy: should the map's finest zoom stop at MSC sections, or continue to the
   4,810 topics from `info.json`, or to hand-curated "concepts" (e.g. "SVD")? (Recommend:
   sections on the map, topics inside the node sheet, courses attached at either.)
3. Is a 5-point `level` the right shape, or should difficulty be "years of study"?
4. Progress/mastery: app-local, or keep Map.md as the record and sync into it?
5. iPhone matters? (PWA works there; an APK doesn't.)
6. How should the implementation be forked to the stronger model? (Mark: "we're going to find
   a new way of forking this off to a new model which will work within our new repo".)
