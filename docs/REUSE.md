# What to reuse, and the traps already found

Everything here was checked on 15 Nov 2026 by reading the repos, not by running them. Paths
are on Mark's PC. **Copy, don't import**: these are separate repos with their own histories.

## TreeQuiz — `~/git/TreeQuiz` (public on GitHub, `markharley12/TreeQuiz`)

**Data (the seed of the map).** `datasets/maths/`:

- `tree.json` — `{name, children[]}`; 5 branches (Logic and discrete; Algebra and number
  theory; Analysis; Geometry and topology; Applied), then areas, MSC subjects, MSC sections.
  **517 leaves, depth 5.** Coded nodes carry `label`, `rank` (Branch/Area/Subject/Section)
  and `aliases` (e.g. `05Cxx` → `Graph theory`, alias `05C`). Branch and area names above the
  subjects are TreeQuiz's own grouping, not MSC.
- `info.json` — 572 keyed entries (MSC codes like `03-XX`, `03Axx`): `description` (mostly
  empty), `items[]` (the topic list under that code, 4,810 topics under the 517 sections; counted 15 Nov 2026, an earlier "about 1,280" here was wrong), `url`
  (zbMATH page). 358 KB.
- `manifest.json` — title, sources and **licence (CC BY-NC-SA 4.0)**. Keep this attribution.

Build a `map.json` from these with a script in `tools/` that records the source commit
(TreeQuiz HEAD at time of writing: `e45a884`). Node ids: the MSC code when there is one,
otherwise a slug of the name; assert uniqueness.

**Front end.** `frontend/` is Vite 8 + React 19 + TypeScript 6 + MUI 9 + `react-d3-tree` +
Capacitor 8.5.2 (core/android/cli) / app 8.1.1, tests with Vitest 5 + Testing Library (570
tests). Worth lifting: `src/theme.ts`, `src/backButton.ts` (Android back closes popups, then
goes home), the PWA service worker `frontend/pwa/sw.js` and the build plugin in
`vite.config.ts` (cache-first, new worker waits), `frontend/android/` Gradle project and
icon/splash generation, the release-signing setup.

**Traps documented in `docs/android.md` and `docs/website.md`:**

- Build with **JDK 21** (`JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64`; JDK 25 untested),
  `ANDROID_HOME=~/Android/Sdk`. `sdkmanager` is gone; the `android` CLI replaces it and
  **collects metrics unless you pass `--no-metrics`**.
- `android/`'s copy of the web build is gitignored, so a bare `./gradlew` packages the
  *previous* build. Always `build → cap sync → assemble` (`npm run android:apk` does it).
- **The emulator was unusable on this PC** (killed for low memory); `./gradlew --stop` after
  building. Test on a real phone.
- **`appId` is permanent** once published (`io.github.markharley12.treequiz` is TreeQuiz's);
  choose this app's deliberately.
- Release signing reuses TaxoQuiz's key via `~/.gradle/gradle.properties`
  (`TREEQUIZ_RELEASE_*` falling back to `TAXOQUIZ_RELEASE_*`). Never commit these.
- Service worker pitfalls (two builds on one origin, old worker answering new routes,
  `localStorage` shared per domain, don't await a reload inside `activate`). Don't serve two
  builds from one origin; key `localStorage` by pack.
- Run Python with `env -u PYTHONPATH` on this machine (ROS's `PYTHONPATH` breaks pytest).
- Its CLAUDE.md is the model for "comments say which real failure code fixes"; tests replay
  real failures.

**Other trees** (`datasets/`): animals, chemistry, chess, cities, instruments, languages,
physics (PhySH, 487 topics), plants. Physics and chemistry are the natural second and third
fields for rabbit-hole.

## jarvis-voice — `~/git/jarvis-voice` (public-ready, fresh history)

**What it is:** Python 3 stdlib-only server (`server/voice_agent_server.py`, ~3,000 lines)
that runs `claude -p` per turn, plus a Kotlin Android app (`android/`, no AndroidX) and a web
page it serves. Phone ↔ PC over Tailscale (`tailscale serve`, bound to 127.0.0.1); the service
runs as a systemd user unit (`server/voice-agent.service`, `setup.sh`) with the notes repo as
its working folder. **Run its tests before and after touching it:**
`~/.venvs/wakeword/bin/python3 ~/git/jarvis-voice/tests/server/test_voice_agent.py` (`--fast`
skips browser tests). rabbit-hole should not modify it; copy what's useful.

**Patterns to take:**

- **The turn runner** (`turn_command`, `run_turn`, about lines 895–1110): spawns
  `claude -p --input-format stream-json --output-format stream-json --verbose
  --include-partial-messages --permission-mode default --permission-prompt-tool stdio
  --allowedTools … --disallowedTools … --settings <json> --append-system-prompt …`, always
  passes `--model` and `--effort`, resumes with `--resume <session_id>`, `cwd` = the repo,
  stderr to a temp file (a pipe nobody reads can stall the run), `start_new_session=True`,
  `TURN_TIMEOUT` 300 s. Cost per turn comes from the difference in session cost.
- **Permission relay:** the tool-permission question is sent to the phone and answered on
  a separate request (`/api/answer`); stale answers are rejected; no answer in 2 min = no.
  Four approval levels; `sudo`, `git push`, `rm -r` refused at every level (including
  `git -C dir push`, `rm -fr`). Read-only shell commands can auto-allow. **For rabbit-hole,
  scope writes to `content/` and `data/`.**
- **API surface to imitate:** `/api/state`, `/api/turn` (streamed events), `/api/answer`,
  `/api/stop`, `/api/new`, `/api/chats` (+ open/rename/compact), `/api/transcript`.
- **Settings the user already has:** model and effort per session; Claude plan usage view.
- Not needed here: wake-word, whisper, piper (voice). Possibly later: voice control of the map
  via Jarvis.

**Trap:** Jarvis's own Android app is Kotlin because it needs a microphone foreground
service. Don't copy its UI stack for rabbit-hole.

## Mark's notes repo — `~/Documents/Mark` (read-only from here)

`Routine/Growth/Learning/Maths/`: `Session-Start.md` (**the spec of the marking loop**),
`Maths.md` (scoring bands, how a check works, syllabus), `Map.md` (28 areas from MSC sections
+ an ML bridge, scores as `score: 72, low, 2026-10-19`; the only record), `Notes.md`,
`Mistakes.md`, `Derivations.md` (about 30 results to reproduce), `Diagnostic/Diagnostic-Pack.md`
(18 questions; **the marking key must not be shown to Mark before he attempts the question**).
Photos flow: `Data/Maths-Attempts/Inbox/` → `Marked/<date>/` (gitignored, Syncthing only).
`Scripts/maths_map.py` rolls section scores into area scores.

Where it stands (19 Oct 2026): probability P1 scored 70, linear algebra L1–L3 about 1/10 each
(didn't know what was asked), SVD was taught from his own matrix and he was watching
Strang 18.065 lecture 6 and Brunton's SVD videos; **PCA has not been taught**. His weak point
is stating *why* a right answer is right. He wants to start areas with something that makes
him feel capable.

**Marking rules to carry into the app:** mark each question out of 10 from the key *and* your
own working (the key loses if wrong); report solid vs not; compare his circled 1–5 confidence
against his marks; if a page can't be read, ask for a clearer photo and mark nothing on it;
**a blank answer is not a zero**, ask whether he didn't know or ran out of steam before scoring.

## Landscape (so nobody re-researches)

Closest existing things, none covering the combination wanted: Mathigon and OpenAha
(hand-authored interactive lessons; OpenAha has 140+ courses but stops short of advanced);
OpenMAIC (Tsinghua, topic → interactive classroom, heavyweight, licence reported inconsistently);
`codebase-to-course` (Claude Code skill → HTML course with quizzes, code-focused); ChatTutor
(whiteboard tutor with plots); commercial handwritten-work graders (Math-Tutor AI, MathGPT.ai,
Learnosity). Licences and star counts were not verified first-hand.
