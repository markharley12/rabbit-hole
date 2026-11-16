// Courses on the map: how many sit under each node, and searching courses and
// map sections by words. Pure, so it is tested without React.

import type { Layout, Placed } from './map/layout.ts'
import type { CourseRecord } from './lesson/progress.ts'
import type { Course } from './lesson/types.ts'

/** The courses of each node, in the order given. Many courses may hang on one node. */
export function groupByNode(courses: Course[]): Map<string, Course[]> {
  const byNode = new Map<string, Course[]>()
  for (const course of courses) byNode.set(course.nodeId, [...(byNode.get(course.nodeId) ?? []), course])
  return byNode
}

/** Courses in each node's subtree (its own included, each one counted). Nodes with none are absent. */
export function countCourses(layout: Layout, courses: Map<string, Course[]>): Map<string, number> {
  const counts = new Map<string, number>()
  for (const [nodeId, onNode] of courses) {
    for (let n: Placed | null = layout.byId.get(nodeId) ?? null; n; n = n.parent) counts.set(n.id, (counts.get(n.id) ?? 0) + onNode.length)
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

// ---- Tunnels: links between courses (course.json "tunnels")

/** The other end of a tunnel, with the sentence the author gave for it. */
export interface TunnelLink {
  course: Course
  why: string
}

export interface Tunnels {
  /** Courses to do first (this course's own `needs`). */
  needs: TunnelLink[]
  /** Courses where the same idea shows up. */
  related: TunnelLink[]
  /** Derived, the other direction: courses that `need` this one. Nobody writes these. */
  leadsTo: TunnelLink[]
}

/**
 * What a course is joined to. A tunnel to a course that is not in the app (a typo the validator
 * would have caught, or a course not published yet) is left out rather than shown as a dead link.
 */
export function tunnelsOf(course: Course, all: Course[]): Tunnels {
  const byId = new Map(all.map((c) => [c.id, c]))
  const links = (kind: 'needs' | 'related'): TunnelLink[] =>
    (course.tunnels ?? []).flatMap((t) => {
      const other = byId.get(t.to)
      return t.kind === kind && other && other.id !== course.id ? [{ course: other, why: t.why }] : []
    })
  const leadsTo = all.flatMap((other) => {
    const t = other.id === course.id ? undefined : other.tunnels?.find((x) => x.kind === 'needs' && x.to === course.id)
    return t ? [{ course: other, why: t.why }] : []
  })
  return { needs: links('needs'), related: links('related'), leadsTo }
}

/** Every lesson done. A course with no record is not finished. */
export const courseFinished = (course: Course, record: CourseRecord): boolean =>
  course.lessons.length > 0 && course.lessons.every((l) => record.lessons[l.id]?.done)

/**
 * The one course to recommend after finishing `course`: the first of those it leads to that is not
 * finished yet. Undefined when it leads nowhere, or every one of them is done.
 */
export function nextCourseAfter(course: Course, all: Course[], progress: (courseId: string) => CourseRecord): Course | undefined {
  return tunnelsOf(course, all).leadsTo.find((link) => !courseFinished(link.course, progress(link.course.id)))?.course
}
