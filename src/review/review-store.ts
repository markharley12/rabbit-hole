// Spaced-review state in localStorage, one key for the whole app, shared by every screen that
// shows it (the top bar's badge, the sheet and the session) through useReview(). The same shape
// as progress-store.ts, plus a listener for the `storage` event so a second tab or a second
// window of the installed app sees a grade at once.

import { useSyncExternalStore } from 'react'
import { parseReview } from './review-record.ts'
import type { ReviewRecord } from './review-record.ts'

// Prefixed: localStorage is shared by everything on an origin (a TreeQuiz trap).
export const REVIEW_KEY = 'rabbit-hole:review'

let cache: ReviewRecord | undefined
const listeners = new Set<() => void>()

export function readReview(): ReviewRecord {
  if (!cache) {
    let text: string | null = null
    try {
      text = localStorage.getItem(REVIEW_KEY)
    } catch {
      // Storage blocked: reviews last for this visit only.
    }
    cache = parseReview(text)
  }
  return cache
}

export function writeReview(change: (record: ReviewRecord) => ReviewRecord) {
  const next = change(readReview())
  cache = next
  try {
    localStorage.setItem(REVIEW_KEY, JSON.stringify(next))
  } catch {
    // Not saved, but the session still works for this visit.
  }
  listeners.forEach((listener) => listener())
}

const onStorage = (event: StorageEvent) => {
  // key is null when the whole storage was cleared.
  if (event.key !== null && event.key !== REVIEW_KEY) return
  cache = undefined
  listeners.forEach((listener) => listener())
}

const subscribe = (listener: () => void) => {
  if (listeners.size === 0) window.addEventListener('storage', onStorage)
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) window.removeEventListener('storage', onStorage)
  }
}

export function useReview(): ReviewRecord {
  return useSyncExternalStore(subscribe, readReview)
}

/** For tests: forget what is cached so the next read comes from storage. */
export function forgetCachedReview() {
  cache = undefined
}
