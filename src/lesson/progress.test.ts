import { describe, expect, it } from 'vitest'
import { emptyCourse, finishLesson, goTo, LOG_LIMIT, lessonState, nextUp, openLesson, parseRecord, recordAttempt, takeHint } from './progress.ts'
import type { Course } from './types.ts'

const course: Course = {
  format: 1,
  id: 'c',
  nodeId: '15Axx',
  title: 'Course',
  summary: '',
  written: '',
  sources: [{ name: 's' }],
  lessons: [
    { id: 'one', title: 'One' },
    { id: 'two', title: 'Two' },
    { id: 'three', title: 'Three' },
  ],
}
const T = '2026-11-15T12:00:00.000Z'

describe('progress', () => {
  it('starts blank: no lesson state, nothing done, and Start on lesson 1', () => {
    const record = emptyCourse()
    expect(lessonState(record, 'one')).toEqual({ state: 'new' })
    expect(nextUp(course, record)).toEqual({ lessonId: 'one', verb: 'Start' })
  })

  it('continues the lesson last opened, wherever that is', () => {
    let record = openLesson(emptyCourse(), 'three', T)
    record = goTo(record, 'three', 2, T)
    expect(nextUp(course, record)).toEqual({ lessonId: 'three', verb: 'Continue' })
    expect(lessonState(record, 'three')).toEqual({ state: 'started', at: 2 })
  })

  it('moves on to the first unfinished lesson, and has nothing left when all are done', () => {
    let record = finishLesson(openLesson(emptyCourse(), 'one', T), 'one', 6, T)
    expect(nextUp(course, record)).toEqual({ lessonId: 'two', verb: 'Start' })
    for (const id of ['two', 'three']) record = finishLesson(openLesson(record, id, T), id, 6, T)
    expect(nextUp(course, record)).toBeNull()
  })

  it('counts attempts, keeps a bounded log, and caps hints at three', () => {
    let record = emptyCourse()
    for (let i = 0; i < LOG_LIMIT + 5; i++) record = recordAttempt(record, 'one', 's', { at: T, values: { x: `${i}` }, result: 'wrong' })
    record = recordAttempt(record, 'one', 's', { at: T, values: { x: '9' }, result: 'correct' })
    for (let i = 0; i < 5; i++) record = takeHint(record, 'one', 's', T)
    const step = record.lessons.one.steps.s
    expect(step.attempts).toBe(LOG_LIMIT + 6)
    expect(step.log).toHaveLength(LOG_LIMIT)
    expect(step.log.at(-1)!.values).toEqual({ x: '9' })
    expect(step.solved).toBe(true)
    expect(step.hints).toBe(3)
  })

  it('survives a corrupt or foreign stored record', () => {
    expect(parseRecord(null)).toEqual(emptyCourse())
    expect(parseRecord('{not json')).toEqual(emptyCourse())
    expect(parseRecord('{"format":2,"lessons":{}}')).toEqual(emptyCourse())
    expect(parseRecord('{"format":1,"lessons":{"one":{"at":1,"done":false,"started":"","steps":{}}}}').lessons.one.at).toBe(1)
  })
})
