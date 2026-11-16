// Course progress in localStorage, one key per course, shared by every screen
// that shows it (the node sheet and the lesson) through useProgress().

import { useCallback, useSyncExternalStore } from 'react'
import { parseRecord } from './progress.ts'
import type { CourseRecord } from './progress.ts'
import type { Course } from './types.ts'

// Prefixed: localStorage is shared by everything on an origin (a TreeQuiz trap).
const key = (courseId: string) => `rabbit-hole:progress:${courseId}`

const cache = new Map<string, CourseRecord>()
const listeners = new Set<() => void>()
let askedToPersist = false
// Bumped on every write, so a hook over several courses has one number to watch.
let version = 0

export function readProgress(courseId: string): CourseRecord {
  let record = cache.get(courseId)
  if (!record) {
    let text: string | null = null
    try {
      text = localStorage.getItem(key(courseId))
    } catch {
      // Storage blocked: progress lasts for this visit only.
    }
    record = parseRecord(text)
    cache.set(courseId, record)
  }
  return record
}

export function writeProgress(courseId: string, change: (record: CourseRecord) => CourseRecord) {
  const next = change(readProgress(courseId))
  cache.set(courseId, next)
  version++
  try {
    localStorage.setItem(key(courseId), JSON.stringify(next))
  } catch {
    // Not saved, but the lesson still works for this visit.
  }
  if (!askedToPersist) {
    // Ask the browser not to evict this origin's storage under pressure.
    // Installed PWAs usually get it; a refusal changes nothing.
    askedToPersist = true
    navigator.storage?.persist?.().catch(() => {})
  }
  listeners.forEach((listener) => listener())
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useProgress(courseId: string): [CourseRecord, (change: (record: CourseRecord) => CourseRecord) => void] {
  const record = useSyncExternalStore(subscribe, () => readProgress(courseId))
  const update = useCallback((change: (record: CourseRecord) => CourseRecord) => writeProgress(courseId, change), [courseId])
  return [record, update]
}

/** Every given course's record (a fresh empty one for a course never opened), keyed by course id. */
export function readAllProgress(courses: Course[]): Map<string, CourseRecord> {
  return new Map(courses.map((course) => [course.id, readProgress(course.id)]))
}

/** The records of all the courses, for screens that look across them ("Where I am"); re-reads on any write. */
export function useAllProgress(courses: Course[]): Map<string, CourseRecord> {
  useSyncExternalStore(subscribe, () => version)
  return readAllProgress(courses)
}

/** For tests: forget what is cached so the next read comes from storage. */
export function forgetCachedProgress() {
  cache.clear()
}
