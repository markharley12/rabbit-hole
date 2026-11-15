// Fetching a node's reading file, only when something needs it, and keeping it
// for the visit. Apart from the components so the cache can be reset in tests.

import { useEffect, useState } from 'react'
import type { ReadingNode, ResourceFile } from './resources.ts'

const cache = new Map<string, ResourceFile>()
const urlOf = (base: string, id: string) => `${base}${id}.json`
export const forgetResourceFiles = () => cache.clear()

export interface LoadedReading {
  files: ReadonlyMap<string, ResourceFile>
  loading: boolean
  /** One plain reason when any file could not be loaded. */
  failed: string | null
}

/** The files of `nodes` under `base` (ending in a slash). Loaded ones are served from the cache at once. */
export function useResourceFiles(base: string, nodes: ReadingNode[]): LoadedReading {
  const [, tick] = useState(0)
  // A failure belongs to the request that had it, so a new request starts clean without resetting state in an effect.
  const [failure, setFailure] = useState<{ request: string; reason: string } | null>(null)
  const ids = nodes.map((n) => n.id).join('|')
  const request = `${base}${ids}`
  const failed = failure?.request === request ? failure.reason : null

  useEffect(() => {
    let live = true
    for (const id of ids ? ids.split('|') : []) {
      if (cache.has(urlOf(base, id))) continue
      fetch(urlOf(base, id))
        .then((response) => {
          if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
          return response.json() as Promise<ResourceFile>
        })
        .then((file) => {
          cache.set(urlOf(base, id), file)
          if (live) tick((n) => n + 1)
        })
        .catch((error: unknown) => live && setFailure({ request: `${base}${ids}`, reason: error instanceof Error ? error.message : String(error) }))
    }
    return () => {
      live = false
    }
  }, [base, ids])

  const files = new Map<string, ResourceFile>()
  for (const { id } of nodes) {
    const hit = cache.get(urlOf(base, id))
    if (hit) files.set(id, hit)
  }
  return { files, loading: failed === null && files.size < nodes.length, failed }
}
