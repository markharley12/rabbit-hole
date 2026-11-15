// Courses on the map: how many sit under each node, and searching courses and
// map sections by words. Pure, so it is tested without React.

import type { Layout, Placed } from './map/layout.ts'
import type { Course } from './lesson/types.ts'

/** Courses in each node's subtree (its own included). Nodes with none are absent. */
export function countCourses(layout: Layout, courses: Map<string, Course>): Map<string, number> {
  const counts = new Map<string, number>()
  for (const nodeId of courses.keys()) {
    for (let n: Placed | null = layout.byId.get(nodeId) ?? null; n; n = n.parent) counts.set(n.id, (counts.get(n.id) ?? 0) + 1)
  }
  return counts
}

/** Lower case, no accents, single spaces: "Eckart–Young" and "eckart young" match. */
export function fold(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9⁺ᵀ]+/g, ' ')
    .trim()
}

const words = (query: string) => fold(query).split(' ').filter(Boolean)

/** Every word of the query appears somewhere in the text (as the start of a word). */
function matches(haystack: string, query: string[]): boolean {
  const padded = ` ${haystack} `
  return query.every((word) => padded.includes(` ${word}`))
}

export interface CourseHit {
  course: Course
  node: Placed | undefined
}

/** Courses whose title, summary, lessons or place on the map match. An empty query lists them all. */
export function searchCourses(query: string, courses: Course[], layout: Layout): CourseHit[] {
  const q = words(query)
  return courses
    .map((course) => ({ course, node: layout.byId.get(course.nodeId) }))
    .filter(({ course, node }) => {
      if (!q.length) return true
      const place = node ? placeText(node) : ''
      const text = [course.title, course.summary, ...course.lessons.flatMap((l) => [l.title, l.summary ?? '', l.badge ?? '']), place]
      return matches(fold(text.join(' ')), q)
    })
    .sort((a, b) => a.course.title.localeCompare(b.course.title))
}

/** A node's name, MSC code (15Axx, 15A), aliases and those of its ancestors. */
function placeText(node: Placed): string {
  const parts: string[] = []
  for (let n: Placed | null = node; n; n = n.parent) {
    parts.push(n.node.name, n.node.code ?? '', ...(n.node.aliases ?? []))
  }
  return parts.join(' ')
}

export interface NodeHit {
  node: Placed
  /** A topic of the node that matched, when the name itself did not. */
  topic?: string
}

/**
 * Map nodes matching the query: by name or MSC code first, then by one of
 * their topics. Two letters at least, so one keystroke doesn't list hundreds.
 */
export function searchNodes(query: string, layout: Layout, limit = 30): NodeHit[] {
  const q = words(query)
  if (!q.length || q.join('').length < 2) return []
  const byName: NodeHit[] = []
  const byTopic: NodeHit[] = []
  for (const node of layout.all) {
    if (!node.parent) continue
    const name = fold([node.node.name, node.node.code ?? '', ...(node.node.aliases ?? [])].join(' '))
    if (matches(name, q)) {
      byName.push({ node })
      continue
    }
    const topic = node.node.items?.find((item) => matches(fold(item), q))
    if (topic && node.children.length === 0) byTopic.push({ node, topic })
  }
  // Broad things first among name matches (a subject before its sections).
  byName.sort((a, b) => a.node.depth - b.node.depth)
  return [...byName, ...byTopic].slice(0, limit)
}
