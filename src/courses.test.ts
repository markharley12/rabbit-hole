import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { countCourses, fold, groupByNode, searchCourses, searchNodes } from './courses.ts'
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
