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
// - A new build installs in the background and **waits** (no skipWaiting())
//   until every page of the old one is closed, so code is never swapped under
//   a running page. An update therefore shows the second time the app is
//   opened after a deploy.
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

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)))
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
