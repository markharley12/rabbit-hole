// The review queue as the app shows it: formula cards need each course's cheat sheet, fetched
// once (small files, precached by the build), so the count in the top bar is right before the
// session is opened. A sheet that cannot be fetched means that course gives no formula cards
// for now, said plainly in the session; nothing else is affected.

import { useEffect, useState } from 'react'
import { readProgress } from '../lesson/progress-store.ts'
import type { CheatSheet, Course } from '../lesson/types.ts'
import { buildQueue } from './queue.ts'
import type { CourseSource, ReviewItem } from './queue.ts'
import { useReview } from './review-store.ts'
import { dueItems } from './schedule.ts'

type Fetched = CheatSheet | 'failed'
// What each cheat sheet came to, kept for the visit: a failure is asked again on the next load.
const settled = new Map<string, Fetched>()

/** For tests. */
export function forgetFetchedSheets() {
  settled.clear()
}

function load(url: string): Promise<void> {
  if (settled.has(url)) return Promise.resolve()
  return fetch(url)
    .then((response) => {
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
      return response.json() as Promise<CheatSheet>
    })
    .then((sheet): Fetched => (sheet && Array.isArray(sheet.sections) ? sheet : 'failed'))
    .catch((): Fetched => 'failed')
    .then((result) => {
      settled.set(url, result)
    })
}

export interface ReviewQueue {
  /** False until every cheat sheet has been fetched or has failed. */
  ready: boolean
  /** Every item earned so far, with its state. */
  items: ReviewItem[]
  due: number
  /** Courses whose cheat sheet could not be fetched. */
  unavailable: Course[]
}

/** `base` is where courses are served, ending in a slash. */
export function useReviewQueue(courses: Course[], base: string): ReviewQueue {
  const stored = useReview()
  const [, bump] = useState(0)
  const urls = courses.filter((c) => c.cheatsheet).map((c) => ({ course: c, url: `${base}${c.id}/cheatsheet.json` }))
  const wanted = urls.map((u) => u.url).join('\n')

  useEffect(() => {
    let live = true
    Promise.all(wanted.split('\n').filter(Boolean).map(load)).then(() => live && bump((n) => n + 1))
    return () => {
      live = false
    }
  }, [wanted])

  const sources: CourseSource[] = courses.map((course) => {
    const hit = course.cheatsheet ? settled.get(`${base}${course.id}/cheatsheet.json`) : undefined
    return { course, sheet: hit && hit !== 'failed' ? hit : undefined }
  })
  const unavailable = urls.filter(({ url }) => settled.get(url) === 'failed').map((u) => u.course)
  const ready = urls.every(({ url }) => settled.has(url))
  // The queue is cheap to rebuild and reads the progress records as they are now.
  const items = buildQueue(sources, readProgress, stored)
  return { ready, items, due: dueItems(items, new Date()).length, unavailable }
}
