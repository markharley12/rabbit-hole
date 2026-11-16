import { describe, expect, it } from 'vitest'
import { lessonHash, parseRoute, resolveLesson } from './route.ts'
import type { Course } from './lesson/types.ts'

const course = (id: string, ...lessons: string[]) =>
  ({ id, nodeId: '15Axx', title: id, lessons: lessons.map((l) => ({ id: l, title: l })) }) as unknown as Course

describe('parseRoute', () => {
  it('reads a plain node', () => {
    expect(parseRoute('15Axx')).toEqual({ nodeId: '15Axx' })
    expect(parseRoute('')).toEqual({ nodeId: '' })
  })

  it('reads the lesson form with a course id', () => {
    expect(parseRoute('15Axx/learn/some-course/lesson-1')).toEqual({ nodeId: '15Axx', courseId: 'some-course', lessonId: 'lesson-1' })
  })

  it('still reads the old form without one', () => {
    expect(parseRoute('15Axx/learn/lesson-1')).toEqual({ nodeId: '15Axx', lessonId: 'lesson-1' })
  })

  it('reads the courses menu form', () => {
    expect(parseRoute('mathematics/courses')).toEqual({ nodeId: 'mathematics', menu: true })
  })

  it('reads the review form, from any node', () => {
    expect(parseRoute('mathematics/review')).toEqual({ nodeId: 'mathematics', review: true })
    expect(parseRoute('15Axx/review')).toEqual({ nodeId: '15Axx', review: true })
  })

  it('reads the new-course form, from any node', () => {
    expect(parseRoute('mathematics/new-course')).toEqual({ nodeId: 'mathematics', newCourse: true })
    expect(parseRoute('15Axx/new-course')).toEqual({ nodeId: '15Axx', newCourse: true })
    expect(resolveLesson(parseRoute('15Axx/new-course'), [course('a', 'one')])).toBeUndefined()
  })

  it('does not take review for a lesson or a course', () => {
    expect(resolveLesson(parseRoute('15Axx/review'), [course('a', 'one')])).toBeUndefined()
  })
})

describe('resolveLesson', () => {
  const a = course('a', 'one', 'two')
  const b = course('b', 'two', 'three')

  it('opens the named course', () => {
    expect(resolveLesson({ nodeId: '15Axx', courseId: 'b', lessonId: 'two' }, [a, b])?.course.id).toBe('b')
  })

  it('does not open a lesson from a different course than the one named', () => {
    expect(resolveLesson({ nodeId: '15Axx', courseId: 'a', lessonId: 'three' }, [a, b])).toBeUndefined()
  })

  it('resolves the old form to the first course with that lesson id', () => {
    expect(resolveLesson({ nodeId: '15Axx', lessonId: 'two' }, [a, b])?.course.id).toBe('a')
    expect(resolveLesson({ nodeId: '15Axx', lessonId: 'three' }, [a, b])?.course.id).toBe('b')
    expect(resolveLesson({ nodeId: '15Axx', lessonId: 'nope' }, [a, b])).toBeUndefined()
  })

  it('has nothing to open without a lesson or a course', () => {
    expect(resolveLesson({ nodeId: '15Axx' }, [a])).toBeUndefined()
    expect(resolveLesson({ nodeId: '15Axx', lessonId: 'one' }, [])).toBeUndefined()
  })

  it('writes the address it reads', () => {
    expect(parseRoute(lessonHash(a, 'one'))).toEqual({ nodeId: '15Axx', courseId: 'a', lessonId: 'one' })
  })
})
