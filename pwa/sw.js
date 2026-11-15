// The service worker: what lets the map open with no connection once it has
// been visited, and so what makes "Add to Home Screen" behave like an app.
// TreeQuiz's worker, less its downloads and its one-off migration.
//
// The build (`serviceWorker()` in vite.config.ts) fills in VERSION and FILES
// and emits this as dist/sw.js. One rule decides everything below: **a page
// is always exactly one build.** So:
//
// - Everything the build lists is served cache-first, index.html and the
//   bundled map (content/maths/map.json) included.
// - A new build installs in the background and **waits** until every page of
//   the old one is closed, so code is never swapped under a running page. An
//   update therefore shows the second time the app is opened after a deploy,
//   unless the person taps "Update" on the bar the app shows when a new build
//   is waiting: then the page asks this worker to take over (the message
//   below), and **every** open page reloads on the controllerchange that
//   follows (src/pwa-update.ts), so a page is still exactly one build.
// - The old cache is deleted on activate, when nothing uses it any more.
//
// Later phases download newer content packs; those must go in a cache of
// their own, which the clean-up below will not touch as long as its name does
// not start with PREFIX.

const VERSION = 'dev'
const FILES = []

const SCOPE = self.registration.scope
// The path is in the name because caches are shared by a whole origin
// (TreeQuiz trap: two apps on one origin deleting each other's caches).
const PREFIX = `rabbit-hole-app-${new URL(SCOPE).pathname}-`
const CACHE = PREFIX + VERSION

const url = (name) => new URL(name, SCOPE).href
const PRECACHED = new Set(FILES.map(url))

// index.html is fetched as the scope's own address, not by name. `tailscale
// serve` (Go's file server) answers /index.html with a redirect to ./, and a
// redirected response may be cached but cannot answer a navigation: the page
// would have installed and then failed to open offline. Seen on the first
// deploy to the tailnet, 15 Nov 2026. `cache: 'reload'` skips the HTTP cache,
// so a new build never precaches a stale file.
const fetchFile = async (name) => {
  const response = await fetch(name === 'index.html' ? SCOPE : url(name), { cache: 'reload' })
  if (!response.ok || response.redirected) throw new Error(`cannot precache ${name}: ${response.status}${response.redirected ? ' (redirected)' : ''}`)
  return response
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => Promise.all(FILES.map(async (name) => cache.put(url(name), await fetchFile(name))))),
  )
})

// The app's "Update" button. Only ever sent by a page of this app, after the
// person asked for it.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'skip-waiting') self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  // Nothing here waits on a page reload: awaiting one inside `activate`
  // deadlocks (it froze every TaxoQuiz tab on its origin).
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith(PREFIX) && key !== CACHE).map((key) => caches.delete(key)))),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const target = new URL(request.url)
  target.search = ''
  const href = target.href

  // The page itself, under either name it is reached by.
  if (request.mode === 'navigate') {
    if (href !== SCOPE && href !== url('index.html')) return
    event.respondWith(caches.open(CACHE).then((cache) => cache.match(url('index.html'))).then((hit) => hit ?? fetch(request)))
    return
  }

  // `ignoreVary`: a module script's request carries an Origin header that the
  // install's requests did not, so a server answering `Vary: Origin` made
  // every module a miss in TreeQuiz. `ignoreSearch` matches the `target` above.
  if (PRECACHED.has(href)) {
    event.respondWith(
      caches.open(CACHE).then((cache) => cache.match(href, { ignoreVary: true, ignoreSearch: true })).then((hit) => hit ?? fetch(request)),
    )
  }
  // Anything else goes to the network untouched.
})
