# rabbit-hole

An open-source, AI-native cousin of Brilliant.org, built around a **map**: see all of
mathematics on one screen, zoom into a subject, see what it depends on and how deep it goes,
and have Claude Code generate the course for any node you want to learn. Mobile first.

Status: **the map and one course.** All of mathematics (the MSC2020 classification: 517
sections, 4,810 topics) as zoomable circles, sized by topic count, one colour per branch. Tap
a circle to zoom in and read what is in it. One node, Basic linear algebra, has a course:
*Least squares to the pseudo-inverse*, step by step, with typed answers checked on the phone
and interactive pictures. The plan is in [docs/PLAN.md](docs/PLAN.md).

This is a personal project built around its author's own setup; it is not meant to be turnkey.

## Run it

Node 22 and Python 3. The map build uses the standard library only; the course validator
needs `sympy` and `jsonschema`.

```bash
npm install
```

```bash
npm run dev
```

All checks (typecheck, lint, app tests, data-tool tests):

```bash
npm run check
```

Check the courses in `content/` (schema, widgets, and every answer key re-derived with
sympy) and publish them into `public/` if they pass. `npm run dev` and `npm run build` do this
first anyway:

```bash
npm run courses
```

Rebuild the map data from TreeQuiz's dataset (expects `~/git/TreeQuiz`):

```bash
npm run build:map
```

## On a phone

Build, then serve the `dist` folder over HTTPS. The author serves it to his own devices over
Tailscale, on a port of its own so it shares no origin (caches, storage) with anything else:

```bash
npm run build
```

```bash
tailscale serve --bg --https=8443 ~/git/rabbit-hole/dist
```

Open `https://<machine>.<tailnet>.ts.net:8443/` on the phone and use the browser's "Install
app" / "Add to Home Screen". After that it opens offline. The serve setting survives reboots;
`tailscale serve --https=8443 off` removes it. After a new `npm run build`, the phone picks the
update up the second time the app is opened (the new version waits until the old one is closed).
To see which build is running, open the sheet on the home view: "This version" gives the build
time and commit.

## Attribution

The first map is built from the [MSC2020](https://msc2020.org) Mathematics Subject
Classification by zbMATH Open and Mathematical Reviews, under
[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/), via the curated tree in
the author's [TreeQuiz](https://github.com/markharley12/TreeQuiz).
