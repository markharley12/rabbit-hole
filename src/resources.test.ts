import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { layoutMap } from './map/layout.ts'
import type { MapDocument } from './map/types.ts'
import { formatChecked, latestChecked, parseIndex, readingGroups, readingNodes } from './resources.ts'
import type { Resource, ResourceFile } from './resources.ts'

const MAP = JSON.parse(readFileSync('public/content/maths/map.json', 'utf8')) as MapDocument
const layout = layoutMap(MAP.root)

const resource = (id: string, checked = '2026-11-15'): Resource => ({
  id,
  title: id,
  by: 'Someone',
  kind: 'notes',
  url: `https://example.org/${id}`,
  about: 'About.',
  use: 'Use.',
  free: true,
  checked,
})
const file = (nodeId: string, ...resources: Resource[]): ResourceFile => ({ format: 1, nodeId, resources })

describe('which nodes to read for', () => {
  // Mathematics › Algebra and number theory › … › 15-XX › Basic linear algebra (15Axx).
  const path = (id: string) => {
    const ids: string[] = []
    for (let n = layout.byId.get(id) ?? null; n; n = n.parent) ids.push(n.id)
    return ids
  }

  it('lists the node and its ancestors that have reading, nearest first', () => {
    const counts = { '15Axx': 3, 'mathematics': 1, '15-XX': 2, 'analysis': 5 }
    expect(readingNodes(layout, '15Axx', counts).map((n) => n.id)).toEqual(['15Axx', '15-XX', 'mathematics'])
    expect(readingNodes(layout, '15Axx', counts)[0]).toEqual({ id: '15Axx', name: layout.byId.get('15Axx')!.node.name })
  })

  it('takes a parent’s reading for a child with none of its own, and nothing for a node off that branch', () => {
    expect(path('15Axx')).toContain('15-XX')
    expect(readingNodes(layout, '15Axx', { '15-XX': 1 }).map((n) => n.id)).toEqual(['15-XX'])
    expect(readingNodes(layout, '15Axx', { '65Fxx': 4 })).toEqual([])
  })

  it('never looks below the node: a child’s reading is not its parent’s', () => {
    expect(readingNodes(layout, '15-XX', { '15Axx': 3 })).toEqual([])
  })

  it('gives nothing for an unknown node or an empty index', () => {
    expect(readingNodes(layout, 'no-such-node', { '15Axx': 3 })).toEqual([])
    expect(readingNodes(layout, '15Axx', {})).toEqual([])
  })

  it('ignores a zero count', () => {
    expect(readingNodes(layout, '15Axx', { '15Axx': 0 })).toEqual([])
  })
})

describe('grouping what loaded', () => {
  const nodes = [
    { id: '15Axx', name: 'Basic linear algebra' },
    { id: '15-XX', name: 'Linear algebra' },
    { id: 'mathematics', name: 'Mathematics' },
  ]

  it('keeps the nearest-first order and tags each group with its node', () => {
    const files = new Map([
      ['15-XX', file('15-XX', resource('b'))],
      ['15Axx', file('15Axx', resource('a1'), resource('a2'))],
    ])
    const groups = readingGroups(nodes, files)
    expect(groups.map((g) => [g.from.id, g.resources.map((r) => r.id)])).toEqual([
      ['15Axx', ['a1', 'a2']],
      ['15-XX', ['b']],
    ])
    expect(groups[0].from.name).toBe('Basic linear algebra')
  })

  it('leaves out a file that has not loaded or has nothing in it', () => {
    expect(readingGroups(nodes, new Map([['mathematics', file('mathematics')]]))).toEqual([])
  })

  it('finds the latest date across groups', () => {
    const groups = readingGroups(nodes, new Map([
      ['15Axx', file('15Axx', resource('a', '2026-11-15'), resource('b', '2026-03-01'))],
      ['15-XX', file('15-XX', resource('c', '2026-12-02'))],
    ]))
    expect(latestChecked(groups)).toBe('2026-12-02')
    expect(latestChecked([])).toBeUndefined()
  })

  it('writes the date the same everywhere', () => {
    expect(formatChecked('2026-11-15')).toBe('15 Nov 2026')
    expect(formatChecked('2026-01-01')).toBe('1 Jan 2026')
    expect(formatChecked('garbage')).toBe('garbage')
  })
})

describe('the index', () => {
  it('reads counts, and anything else as none', () => {
    expect(parseIndex({ format: 1, nodes: { '15Axx': 14 } })).toEqual({ '15Axx': 14 })
    expect(parseIndex({ format: 1, nodes: { a: 0, b: 'x', c: 2 } })).toEqual({ c: 2 })
    for (const bad of [null, undefined, 3, 'x', {}, { nodes: null }, { nodes: 4 }]) expect(parseIndex(bad)).toEqual({})
  })
})

describe('the real reading files', () => {
  const dir = 'content/maths/resources'
  const files = existsSync(dir) ? readdirSync(dir) : []

  it('exists, one file per node, each for a node on the map', () => {
    expect(files).toContain('15Axx.json')
    for (const name of files) {
      const document = JSON.parse(readFileSync(`${dir}/${name}`, 'utf8')) as ResourceFile
      expect(name).toBe(`${document.nodeId}.json`)
      expect(layout.byId.has(document.nodeId)).toBe(true)
    }
  })

  it('15Axx keeps all fourteen, https only, free or paid stated, with topics', () => {
    const { resources } = JSON.parse(readFileSync(`${dir}/15Axx.json`, 'utf8')) as ResourceFile
    expect(resources).toHaveLength(14)
    for (const r of resources) {
      expect(r.url, r.id).toMatch(/^https:\/\//)
      expect(typeof r.free).toBe('boolean')
      expect(r.topics?.length, r.id).toBeGreaterThan(0)
      // Written for the node, not for one course's lesson numbers.
      expect(r.use, r.id).not.toMatch(/lesson \d/i)
    }
  })
})
