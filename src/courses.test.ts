import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { countCourses, courseFinished, fold, groupByNode, nextCourseAfter, searchCourses, searchNodes, tunnelsOf } from './courses.ts'
import type { CourseRecord } from './lesson/progress.ts'
import type { Course } from './lesson/types.ts'
import { layoutMap } from './map/layout.ts'
import type { MapDocument } from './map/types.ts'

const MAP = JSON.parse(readFileSync('public/content/maths/map.json', 'utf8')) as MapDocument
const layout = layoutMap(MAP.root)
const course = JSON.parse(readFileSync('content/maths/courses/least-squares-to-the-pseudo-inverse/course.json', 'utf8')) as Course
const courses = groupByNode([course])

describe('course counts', () => {
  it('counts a course on its node and every node above it, and nowhere else', () => {
    const counts = countCourses(layout, courses)
    // Mathematics › Algebra and number theory › … › Basic linear algebra.
    expect(counts.get('mathematics')).toBe(1)
    expect(counts.get('15Axx')).toBe(1)
    expect(counts.get('15-XX')).toBe(1)
    expect(counts.get('analysis')).toBeUndefined()
    expect(counts.get('65Fxx')).toBeUndefined()
    expect([...counts.keys()]).toHaveLength(5)
  })

  it('adds up two courses in one branch', () => {
    const second = { ...course, id: 'other', nodeId: '15Bxx' }
    const counts = countCourses(layout, groupByNode([course, second]))
    expect(counts.get('mathematics')).toBe(2)
    expect(counts.get('15-XX')).toBe(2)
    expect(counts.get('15Axx')).toBe(1)
  })

  it('counts two courses on one node twice', () => {
    const counts = countCourses(layout, groupByNode([course, { ...course, id: 'other' }]))
    expect(counts.get('15Axx')).toBe(2)
    expect(counts.get('mathematics')).toBe(2)
  })

  it('groups by node, keeping the order', () => {
    const other = { ...course, id: 'other' }
    expect(groupByNode([course, other]).get('15Axx')?.map((c) => c.id)).toEqual([course.id, 'other'])
  })
})

describe('search', () => {
  it('folds case, accents and dashes', () => {
    expect(fold('Eckart–Young')).toBe('eckart young')
    expect(fold('  Pseudo-Inverse ')).toBe('pseudo inverse')
  })

  it('lists every course for an empty query', () => {
    expect(searchCourses('', [course], layout)).toHaveLength(1)
  })

  it.each(['least squares', 'pseudo', 'eckart', 'SVD', 'singular value', 'linear algebra', '15A', 'algebra number', 'open task'])('finds the course by %j', (query) => {
    expect(searchCourses(query, [course], layout).map((hit) => hit.course.id)).toEqual([course.id])
  })

  it.each(['probability', 'topology', 'squares zzz'])('does not find it by %j', (query) => {
    expect(searchCourses(query, [course], layout)).toEqual([])
  })

  it('finds map sections by name, code and topic', () => {
    expect(searchNodes('numerical linear', layout).map((hit) => hit.node.id)).toContain('65Fxx')
    expect(searchNodes('15A', layout)[0].node.id).toBe('15Axx')
    const pinv = searchNodes('pseudoinverses', layout)
    expect(pinv.map((hit) => hit.node.id)).toContain('65Fxx')
    expect(pinv.find((hit) => hit.node.id === '65Fxx')?.topic).toMatch(/pseudoinverses/i)
  })

  it('waits for two letters before searching the map', () => {
    expect(searchNodes('a', layout)).toEqual([])
    expect(searchNodes('  ', layout)).toEqual([])
  })
})

describe('tunnels', () => {
  const make = (id: string, tunnels: Course['tunnels'] = undefined): Course => ({
    ...course,
    id,
    title: `Title of ${id}`,
    lessons: [{ id: 'l1', title: 'One' }, { id: 'l2', title: 'Two' }],
    tunnels,
  })
  const base = make('base')
  const mid = make('mid', [
    { to: 'base', kind: 'needs', why: 'It uses base.' },
    { to: 'side', kind: 'related', why: 'Same idea.' },
  ])
  const side = make('side')
  const top = make('top', [{ to: 'mid', kind: 'needs', why: 'It uses mid.' }])
  const top2 = make('top2', [{ to: 'mid', kind: 'needs', why: 'It also uses mid.' }])
  const all = [base, mid, side, top, top2]
  const lesson = { at: 2, done: true, started: 'x', steps: {} }
  const done =
    (...ids: string[]) =>
    (courseId: string): CourseRecord => ({ format: 1, lessons: ids.includes(courseId) ? { l1: lesson, l2: lesson } : {} })

  it('splits what a course needs, what is related, and derives what it leads to', () => {
    const t = tunnelsOf(mid, all)
    expect(t.needs.map((l) => [l.course.id, l.why])).toEqual([['base', 'It uses base.']])
    expect(t.related.map((l) => l.course.id)).toEqual(['side'])
    expect(t.leadsTo.map((l) => [l.course.id, l.why])).toEqual([
      ['top', 'It uses mid.'],
      ['top2', 'It also uses mid.'],
    ])
  })

  it('derives "leads to" from needs only, never from related', () => {
    expect(tunnelsOf(side, all)).toEqual({ needs: [], related: [], leadsTo: [] })
    expect(tunnelsOf(base, all).leadsTo.map((l) => l.course.id)).toEqual(['mid'])
  })

  it('leaves out a tunnel to a course that is not in the app, and a course with no tunnels has none', () => {
    const lonely = make('lonely', [{ to: 'gone', kind: 'needs', why: 'It uses gone.' }])
    expect(tunnelsOf(lonely, [lonely, base])).toEqual({ needs: [], related: [], leadsTo: [] })
    expect(tunnelsOf(base, [base])).toEqual({ needs: [], related: [], leadsTo: [] })
  })

  it('says a course is finished only when every lesson is done', () => {
    expect(courseFinished(base, done('base')('base'))).toBe(true)
    expect(courseFinished(base, done()('base'))).toBe(false)
    expect(courseFinished(base, { format: 1, lessons: { l1: lesson } })).toBe(false)
  })

  it('recommends the first unfinished course it leads to, one only', () => {
    expect(nextCourseAfter(mid, all, done())?.id).toBe('top')
    expect(nextCourseAfter(mid, all, done('top'))?.id).toBe('top2')
    expect(nextCourseAfter(mid, all, done('top', 'top2'))).toBeUndefined()
    expect(nextCourseAfter(top, all, done())).toBeUndefined()
  })

  it('is in the real course index: PCA needs least squares, which leads to PCA', () => {
    const pca = JSON.parse(readFileSync('content/maths/courses/principal-components-from-the-svd/course.json', 'utf8')) as Course
    expect(tunnelsOf(pca, [course, pca]).needs.map((l) => l.course.id)).toEqual([course.id])
    expect(tunnelsOf(course, [course, pca]).leadsTo.map((l) => l.course.id)).toEqual([pca.id])
  })
})
