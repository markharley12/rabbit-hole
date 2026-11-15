// Noticing that a new build is waiting, and switching to it when asked.
//
// pwa/sw.js makes a new build wait until every page of the old one is closed.
// That kept code from changing under a running page, but on a phone it meant
// "close the app twice" to see an update. Now the app shows an "Update" bar
// when a build is waiting; tapping it tells the waiting worker to take over,
// and every open page reloads when it does, so a page is still one build.

export interface UpdateEnvironment {
  container: Pick<ServiceWorkerContainer, 'controller' | 'addEventListener'>
  registration: Pick<ServiceWorkerRegistration, 'waiting' | 'installing' | 'addEventListener' | 'update'>
  reload: () => void
  /** Called when the app comes back into view, to look for a new build. */
  onVisible: (check: () => void) => void
}

let waiting: Pick<ServiceWorker, 'postMessage'> | null = null
const listeners = new Set<() => void>()

const announce = (worker: typeof waiting) => {
  waiting = worker
  listeners.forEach((listener) => listener())
}

export const updateWaiting = () => waiting !== null

export function subscribeUpdate(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Ask the waiting build to take over. The reload follows from watchForUpdates. */
export function applyUpdate() {
  waiting?.postMessage({ type: 'skip-waiting' })
}

export function watchForUpdates({ container, registration, reload, onVisible }: UpdateEnvironment) {
  // A worker installed while another controls the page is an update. The very
  // first install (no controller yet) is not: there is nothing to update.
  const consider = (worker: ServiceWorker | null) => {
    if (worker && container.controller) announce(worker)
  }
  consider(registration.waiting)
  registration.addEventListener('updatefound', () => {
    const installing = registration.installing
    installing?.addEventListener('statechange', () => {
      if (installing.state === 'installed') consider(installing)
    })
  })

  let reloading = false
  container.addEventListener('controllerchange', () => {
    // Only when replacing a controller: the first install never takes over a
    // page, but guard anyway against reloading twice.
    if (reloading) return
    reloading = true
    reload()
  })

  // Opening the app from the recent apps list doesn't load it again, so look
  // for a new build whenever it comes back into view.
  onVisible(() => {
    registration.update().catch(() => {
      // Offline: nothing to fetch, nothing to do.
    })
  })
}

/** For tests. */
export function forgetUpdate() {
  waiting = null
  listeners.clear()
}
