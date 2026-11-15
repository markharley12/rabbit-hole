// Fetching a course's cheat sheet. Kept apart from the component so the
// cache can be reset in tests.

import { useEffect, useState } from 'react'
import type { CheatSheet as Sheet } from '../lesson/types.ts'

export type Loaded = { state: 'loading' } | { state: 'failed'; reason: string } | { state: 'ready'; sheet: Sheet }

// The sheet is fetched when first opened, then kept for the visit, so opening it again is instant.
const fetched = new Map<string, Sheet>()
export const forgetFetchedSheets = () => fetched.clear()

export function useSheet(url: string): Loaded {
  const [loaded, setLoaded] = useState<Loaded>(() => {
    const hit = fetched.get(url)
    return hit ? { state: 'ready', sheet: hit } : { state: 'loading' }
  })
  useEffect(() => {
    if (fetched.has(url)) return
    let live = true
    fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
        return response.json() as Promise<Sheet>
      })
      .then((sheet) => {
        fetched.set(url, sheet)
        if (live) setLoaded({ state: 'ready', sheet })
      })
      .catch((error: unknown) => live && setLoaded({ state: 'failed', reason: error instanceof Error ? error.message : String(error) }))
    return () => {
      live = false
    }
  }, [url])
  return loaded
}

