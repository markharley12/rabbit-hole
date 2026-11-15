// Reading links attached to map nodes (content/<field>/resources/<node-id>.json,
// published with an index of counts). Pure: which nodes to read for a place on
// the map, and how to group and date what came back. Mirrors
// schema/resources.schema.json.

import type { Layout, Placed } from './map/layout.ts'

export type ResourceKind = 'video' | 'book' | 'notes' | 'article' | 'course'

export interface Resource {
  id: string
  title: string
  by: string
  kind: ResourceKind
  url: string
  about: string
  use: string
  free: boolean
  /** ISO date the URL was last opened and confirmed. */
  checked: string
  topics?: string[]
}

export interface ResourceFile {
  format: 1
  nodeId: string
  resources: Resource[]
}

/** public/content/<field>/resources/index.json: how many resources each node has of its own. */
export interface ResourceIndex {
  format: 1
  nodes: Record<string, number>
}

/** A map node that has reading of its own, as the lesson and the sheet name it. */
export interface ReadingNode {
  id: string
  name: string
}

/** The resources of one node, tagged with where they came from. */
export interface ReadingGroup {
  from: ReadingNode
  resources: Resource[]
}

/** The index in a fetched value, or an empty one for anything else (a missing index is fine). */
export function parseIndex(value: unknown): Record<string, number> {
  const nodes = (value as { nodes?: unknown } | null)?.nodes
  if (typeof nodes !== 'object' || nodes === null) return {}
  const counts: Record<string, number> = {}
  for (const [id, count] of Object.entries(nodes)) if (typeof count === 'number' && count > 0) counts[id] = count
  return counts
}

/**
 * The node and each of its ancestors that has reading, nearest first (the node's
 * own, then its parent's, and so on up to the field). Empty when the node is not
 * on the map or nothing above it has any.
 */
export function readingNodes(layout: Layout, nodeId: string, counts: Record<string, number>): ReadingNode[] {
  const found: ReadingNode[] = []
  for (let n: Placed | null = layout.byId.get(nodeId) ?? null; n; n = n.parent) {
    if ((counts[n.id] ?? 0) > 0) found.push({ id: n.id, name: n.node.name })
  }
  return found
}

/** The loaded files in the order of `nodes` (nearest first); a node whose file has not loaded, or is empty, is left out. */
export function readingGroups(nodes: ReadingNode[], files: ReadonlyMap<string, ResourceFile>): ReadingGroup[] {
  return nodes.flatMap((from) => {
    const resources = files.get(from.id)?.resources ?? []
    return resources.length ? [{ from, resources }] : []
  })
}

/** The newest `checked` date among the groups (ISO dates sort as text), or undefined when there are none. */
export function latestChecked(groups: ReadingGroup[]): string | undefined {
  return groups
    .flatMap((g) => g.resources.map((r) => r.checked))
    .sort()
    .pop()
}

/** "2026-11-15" as "15 Nov 2026", the same on every device whatever its time zone. */
export function formatChecked(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

/** What the screens are given to find reading for a node: the map, the index of counts, and where the files are. */
export interface ReadingSource {
  layout: Layout
  counts: Record<string, number>
  /** Ends in a slash. */
  base: string
}
