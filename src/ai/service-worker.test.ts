// pwa/sw.js's fetch handler, run in a fake worker scope: a course the server
// on the PC has just built must show up without a new app build, so the
// content indexes come from the network first; everything else in the build's
// list stays cache-first; anything not in the list goes to the network.

import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

const SCOPE = 'https://pc.tail.ts.net/'
const FILES = ['index.html', 'content/maths/courses/index.json', 'content/maths/resources/index.json', 'content/maths/map.json']

function worker(online: boolean) {
  const handlers: Record<string, (event: unknown) => void> = {}
  const cached = new Map(FILES.map((f) => [new URL(f, SCOPE).href, `cached ${f}`]))
  const cache = { match: vi.fn(async (href: string) => cached.get(href)), put: vi.fn() }
  const network = vi.fn(async (request: { url: string }) => {
    if (!online) throw new TypeError('offline')
    return `network ${request.url}`
  })
  const scope = {
    registration: { scope: SCOPE },
    addEventListener: (name: string, handler: (event: unknown) => void) => (handlers[name] = handler),
  }
  const source = readFileSync('pwa/sw.js', 'utf8').replace('const FILES = []', `const FILES = ${JSON.stringify(FILES)}`)
  new Function('self', 'caches', 'fetch', 'Response', source)(scope, { open: async () => cache, keys: async () => [] }, network, {
    error: () => 'error',
  })

  /** What the worker answers for a GET of `path`, or 'passed' if it lets the browser go to the network. */
  const get = async (path: string) => {
    let answer: Promise<unknown> | null = null
    handlers.fetch({ request: { method: 'GET', url: new URL(path, SCOPE).href, mode: 'cors' }, respondWith: (p: Promise<unknown>) => (answer = p) })
    return answer ? await answer : 'passed'
  }
  return { get, network }
}

describe('the service worker', () => {
  it('fetches the content indexes from the network first', async () => {
    const { get } = worker(true)
    expect(await get('content/maths/courses/index.json')).toBe(`network ${SCOPE}content/maths/courses/index.json`)
    expect(await get('content/maths/resources/index.json?x=1')).toBe(`network ${SCOPE}content/maths/resources/index.json?x=1`)
  })

  it('falls back to the precached index offline', async () => {
    const { get } = worker(false)
    expect(await get('content/maths/courses/index.json')).toBe('cached content/maths/courses/index.json')
  })

  it('keeps the rest of the build cache-first', async () => {
    const { get, network } = worker(true)
    expect(await get('content/maths/map.json')).toBe('cached content/maths/map.json')
    expect(network).not.toHaveBeenCalled()
  })

  it('lets a new course file and the API go to the network untouched', async () => {
    const { get } = worker(true)
    expect(await get('content/maths/courses/new-course/course.json')).toBe('passed')
    expect(await get('api/state')).toBe('passed')
  })
})
