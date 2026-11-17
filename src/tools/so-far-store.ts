// Fetching the earlier lessons of a course for "So far". Kept apart from the component
// so the cache can be reset in tests.

import { useEffect, useState } from 'react'
import type { Lesson } from '../lesson/types.ts'

export interface Earlier {
  /** What has arrived so far, by lesson id. */
  lessons: Record<string, Lesson>
  state: 'loading' | 'ready' | 'failed'
}

// A lesson file does not change while the app is open, so each is fetched once per visit.
const fetched = new Map<string, Lesson>()
export const forgetFetchedLessons = () => fetched.clear()

async function fetchLesson(url: string): Promise<Lesson> {
  const hit = fetched.get(url)
  if (hit) return hit
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  const lesson = (await response.json()) as Lesson
  fetched.set(url, lesson)
  return lesson
}

export function useEarlierLessons(base: string, ids: string[]): Earlier {
  const key = ids.join('\n')
  const [result, setResult] = useState<Earlier>(() => {
    const lessons: Record<string, Lesson> = {}
    for (const id of ids) {
      const hit = fetched.get(`${base}${id}.json`)
      if (hit) lessons[id] = hit
    }
    return { lessons, state: Object.keys(lessons).length === ids.length ? 'ready' : 'loading' }
  })
  useEffect(() => {
    const wanted = key ? key.split('\n') : []
    let live = true
    Promise.allSettled(wanted.map((id) => fetchLesson(`${base}${id}.json`))).then((settled) => {
      if (!live) return
      const lessons: Record<string, Lesson> = {}
      settled.forEach((s, i) => {
        if (s.status === 'fulfilled') lessons[wanted[i]] = s.value
      })
      setResult({ lessons, state: settled.some((s) => s.status === 'rejected') ? 'failed' : 'ready' })
    })
    return () => {
      live = false
    }
  }, [base, key])
  return result
}
