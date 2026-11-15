# CLAUDE.md — rabbit-hole

A mobile app that shows a whole field of knowledge as one map (maths first), lets you dig
down any rabbit hole on it, and fills the map with courses that Claude Code generates into
the app's own content files. Personal project of Mark's; public on GitHub in the end, but
built around his setup (Claude Code on his PC, phone over Tailscale), so it is not meant to
be turnkey for anyone else. **"rabbit-hole" is a working name** — rename freely.

## Status: planning only (15 Nov 2026)

No code exists yet. The plan was condensed by a cheaper model (Sonnet 5.5) so a stronger
model can implement it. **Read in this order:**

1. [docs/PLAN.md](docs/PLAN.md) — vision, decisions Mark has made, architecture, phases, open questions.
2. [docs/REUSE.md](docs/REUSE.md) — what to take from TreeQuiz and Jarvis, with paths and the traps they hit.
3. [docs/HANDOFF.md](docs/HANDOFF.md) — the first implementation brief (Phase 0).
4. [docs/seed-context.md](docs/seed-context.md) — how Mark actually learns, condensed from his
   claude.ai chats (one so far): his teaching-style spec in his own words, where he got to, his
   slip patterns, and what they imply for the lesson format and widgets. Add further chats as
   dated sections. Read it before designing lessons, widgets or marking.

## About the learner (the parts that matter here)

- Learning the maths behind CS and AI, being tested to find real gaps.
- Works **on paper, photographs the pages**, and wants those marked.
- Responds to precise language. Don't pad.

## Rules

- **Shell commands one per line, no `\` continuations** (he pastes them over SSH from his phone).
- **File names kebab-case, no spaces.**
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
