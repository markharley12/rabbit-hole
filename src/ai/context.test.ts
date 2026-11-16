import { describe, expect, it } from 'vitest'
import type { StepRecord } from '../lesson/progress.ts'
import { canShowAnswer } from '../lesson/reveal.ts'
import type { Course, Lesson } from '../lesson/types.ts'
import { LOG_SENT, aboutLine, buildContext, snapshot, stepUpdate } from './context.ts'

const course: Course = {
  format: 1,
  id: 'least-squares',
  nodeId: '15Axx',
  title: 'Least squares',
  summary: '',
  written: '2026-11-15',
  sources: [],
  lessons: [
    { id: 'first', title: 'First' },
    { id: 'smallest', title: 'The smallest best fit' },
  ],
}

const lesson: Lesson = {
  format: 1,
  id: 'smallest',
  title: 'The smallest best fit',
  blocks: [
    { type: 'text', id: 'intro', body: 'Hello.', next: 'On' },
    {
      type: 'step',
      id: 'expand-the-norm',
      title: 'One variable',
      why: 'Parabolas.',
      prompt: 'Expand.',
      answer: { fields: [{ name: 'f', key: '5m^2 - 12m + 9' }], vars: ['m'], verify: 'x' },
      hints: ['a', 'b', 'c'],
      next: 'On',
    },
  ],
}

const attempt = (i: number) => ({ at: `2026-11-15T10:0${i}:00Z`, values: { f: `try ${i}` }, result: 'wrong' as const, slip: i === 7 ? 'known' : undefined })

const record = (changes: Partial<StepRecord> = {}): StepRecord => ({ attempts: 0, solved: false, hints: 0, log: [], ...changes })

describe('the reveal rule shared with the step screen', () => {
  it('needs all three hints and an attempt, on a step not yet finished', () => {
    expect(canShowAnswer(undefined)).toBe(false)
    expect(canShowAnswer(record({ hints: 3 }))).toBe(false)
    expect(canShowAnswer(record({ hints: 2, attempts: 4 }))).toBe(false)
    expect(canShowAnswer(record({ hints: 3, attempts: 1 }))).toBe(true)
    expect(canShowAnswer(record({ hints: 3, attempts: 1, solved: true }))).toBe(false)
    expect(canShowAnswer(record({ hints: 3, attempts: 1, revealed: true }))).toBe(false)
  })
})

describe('buildContext', () => {
  it('says where he is, with the step verbatim', () => {
    const ctx = buildContext({ course, lesson, at: 1, record: record({ hints: 1, draft: { f: '5m^2' } }), nodeName: 'Basic linear algebra' })
    expect(ctx).toMatchObject({
      courseId: 'least-squares',
      courseTitle: 'Least squares',
      nodeId: '15Axx',
      nodeName: 'Basic linear algebra',
      lessonId: 'smallest',
      lessonTitle: 'The smallest best fit',
      lessonIndex: 1,
      lessonCount: 2,
      screenIndex: 1,
      screenCount: 2,
      draft: { f: '5m^2' },
      canReveal: false,
      record: { attempts: 0, hints: 1, solved: false, revealed: false, log: [] },
    })
    expect(ctx.block).toBe(lesson.blocks[1])
  })

  it('sends only the last five attempts, and no empty slip', () => {
    const log = Array.from({ length: 8 }, (_, i) => attempt(i))
    const ctx = buildContext({ course, lesson, at: 1, record: record({ attempts: 8, log }) })
    expect(ctx.record.log).toHaveLength(LOG_SENT)
    expect(ctx.record.log.map((a) => a.values.f)).toEqual(['try 3', 'try 4', 'try 5', 'try 6', 'try 7'])
    expect(ctx.record.log[4].slip).toBe('known')
    expect('slip' in ctx.record.log[0]).toBe(false)
    expect(ctx.record.attempts).toBe(8)
  })

  it('cuts typed values to what the server takes', () => {
    const ctx = buildContext({ course, lesson, at: 1, record: record({ draft: { f: 'x'.repeat(900) } }) })
    expect(ctx.draft.f).toHaveLength(500)
  })

  it('uses the same reveal rule as the step screen', () => {
    expect(buildContext({ course, lesson, at: 1, record: record({ hints: 3, attempts: 1 }) }).canReveal).toBe(true)
    expect(buildContext({ course, lesson, at: 1, record: record({ hints: 3 }) }).canReveal).toBe(false)
  })

  it('works for a text screen and an untouched step', () => {
    const ctx = buildContext({ course, lesson, at: 0, record: undefined })
    expect(ctx.block.type).toBe('text')
    expect(ctx.canReveal).toBe(false)
    expect(ctx.draft).toEqual({})
    expect('nodeName' in ctx).toBe(false)
  })
})

describe('stepUpdate', () => {
  const base = snapshot(record({ hints: 1, draft: { f: '5m' } }))

  it('is null when nothing changed', () => {
    expect(stepUpdate(base, snapshot(record({ hints: 1, draft: { f: '5m' } })))).toBeNull()
    // An empty box and a missing one are the same.
    expect(stepUpdate(snapshot(record({ draft: { f: '' } })), snapshot(record()))).toBeNull()
  })

  it('is the whole snapshot when the draft, attempts or hints changed, or when not known', () => {
    const typed = snapshot(record({ hints: 1, draft: { f: '5m^2' } }))
    expect(stepUpdate(base, typed)).toEqual(typed)
    expect(stepUpdate(base, snapshot(record({ hints: 2, draft: { f: '5m' } })))?.hints).toBe(2)
    expect(stepUpdate(base, snapshot(record({ hints: 1, attempts: 1, draft: { f: '5m' } })))?.attempts).toBe(1)
    expect(stepUpdate(undefined, base)).toEqual(base)
  })
})

describe('aboutLine', () => {
  it('names the screen and the lesson', () => {
    expect(aboutLine(lesson, 1)).toBe('One variable, The smallest best fit')
    expect(aboutLine(lesson, 0)).toBe('screen 1 of 2, The smallest best fit')
  })
})
