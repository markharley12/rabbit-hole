import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import type { CourseRecord } from '../lesson/progress.ts'
import type { CheatSheet, Course } from '../lesson/types.ts'
import { buildQueue } from './queue.ts'
import { emptyReview, gradeItem, parseReview } from './review-record.ts'
import { REVIEW_KEY, forgetCachedReview, readReview, useReview, writeReview } from './review-store.ts'
import { enter, formulaKey, stepKey } from './schedule.ts'

const NOW = new Date(2026, 10, 16, 12)
const state = (rung = 0) => ({ rung, due: new Date(2026, 10, 17, 12).toISOString(), reps: 0, lapses: 0 })

beforeEach(() => {
  localStorage.clear()
  forgetCachedReview()
})
afterEach(cleanup)

describe('parseReview', () => {
  it('reads what it writes', () => {
    const record = { format: 1 as const, items: { a: state(2) } }
    expect(parseReview(JSON.stringify(record))).toEqual(record)
  })

  it('gives an empty record for nothing, for rubbish, and for another format', () => {
    for (const text of [null, '', '{not json', '[]', '"x"', '{"format":2,"items":{}}', '{"format":1}', '{"format":1,"items":[]}', 'null']) {
      expect(parseReview(text)).toEqual(emptyReview())
    }
  })

  it('drops an item that is not shaped right and keeps the rest', () => {
    const text = JSON.stringify({
      format: 1,
      items: {
        good: state(1),
        rung: { ...state(), rung: 9 },
        noDue: { rung: 0, reps: 0, lapses: 0 },
        badDue: { ...state(), due: 'tomorrow-ish' },
        negative: { ...state(), reps: -1 },
        text: 'x',
        empty: null,
      },
    })
    expect(Object.keys(parseReview(text).items)).toEqual(['good'])
  })

  it('gradeItem returns a new record with the item moved on', () => {
    const before = emptyReview()
    const after = gradeItem(before, 'k', state(0), 'good', NOW)
    expect(before.items).toEqual({})
    expect(after.items.k).toMatchObject({ rung: 1, reps: 1 })
  })
})

describe('the store', () => {
  it('starts empty when storage is empty or corrupt', () => {
    expect(readReview()).toEqual(emptyReview())
    localStorage.setItem(REVIEW_KEY, '{oops')
    forgetCachedReview()
    expect(readReview()).toEqual(emptyReview())
  })

  it('saves under one prefixed key', () => {
    writeReview((r) => gradeItem(r, 'k', state(0), 'good', NOW))
    expect(JSON.parse(localStorage.getItem('rabbit-hole:review')!).items.k.rung).toBe(1)
    forgetCachedReview()
    expect(readReview().items.k.rung).toBe(1)
  })

  it('still works for the visit when storage refuses to write', () => {
    const real = Storage.prototype.setItem
    Storage.prototype.setItem = () => {
      throw new Error('full')
    }
    try {
      expect(() => writeReview((r) => gradeItem(r, 'k', state(0), 'again', NOW))).not.toThrow()
      expect(readReview().items.k.lapses).toBe(1)
    } finally {
      Storage.prototype.setItem = real
    }
  })

  it('tells the screens that show it, and another tab’s change', () => {
    const Count = () => <p>{Object.keys(useReview().items).length} graded</p>
    render(<Count />)
    expect(screen.getByText('0 graded')).toBeTruthy()
    act(() => writeReview((r) => gradeItem(r, 'k', state(0), 'good', NOW)))
    expect(screen.getByText('1 graded')).toBeTruthy()
    // Another tab writes: the storage event arrives with the key it changed.
    localStorage.setItem(REVIEW_KEY, JSON.stringify({ format: 1, items: { a: state(), b: state() } }))
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: REVIEW_KEY }))
    })
    expect(screen.getByText('2 graded')).toBeTruthy()
    // A storage event about something else leaves it alone.
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'rabbit-hole:progress:x' }))
    })
    expect(screen.getByText('2 graded')).toBeTruthy()
  })
})

describe('buildQueue', () => {
  const course = {
    id: 'c',
    nodeId: 'n',
    title: 'C',
    lessons: [
      { id: 'l1', title: 'One' },
      { id: 'l2', title: 'Two' },
    ],
    review: [
      { lesson: 'l1', step: 's1' },
      { lesson: 'l2', step: 's2' },
      { lesson: 'gone', step: 'x' },
    ],
  } as unknown as Course
  const sheet: CheatSheet = {
    format: 1,
    sections: [
      {
        title: 'S',
        items: [
          { id: 'f1', name: 'F1', formula: '$a$', when: 'w', lesson: 'l1' },
          { id: 'f2', name: 'F2', formula: '$b$', when: 'w' },
          { id: 'f3', name: 'F3', formula: '$c$', when: 'w', lesson: 'gone' },
        ],
      },
    ],
  }
  const progress: CourseRecord = {
    format: 1,
    updated: '2026-11-15T10:00:00.000Z',
    lessons: {
      l1: {
        at: 3,
        done: true,
        started: '2026-11-14T10:00:00.000Z',
        finished: '2026-11-14T11:00:00.000Z',
        steps: { s1: { attempts: 1, solved: true, hints: 0, log: [{ at: '2026-11-14T10:30:00.000Z', values: {}, result: 'correct' }] } },
      },
      l2: { at: 1, done: false, started: '2026-11-15T09:00:00.000Z', steps: {} },
    },
  }
  const keys = (items: { key: string }[]) => items.map((i) => i.key).sort()

  it('has only what has been earned, due a day after it was', () => {
    const items = buildQueue([{ course, sheet }], () => progress, emptyReview())
    expect(keys(items)).toEqual([stepKey('c', 'l1', 's1'), formulaKey('c', 'f1'), formulaKey('c', 'f2')].sort())
    const step = items.find((i) => i.kind === 'step')!
    expect(step.state.due).toBe(enter('2026-11-14T10:30:00.000Z').due)
    expect(step.group).toBe('c:l1')
  })

  it('uses the graded state over the derived one', () => {
    const stored = gradeItem(emptyReview(), stepKey('c', 'l1', 's1'), state(0), 'good', NOW)
    const items = buildQueue([{ course, sheet }], () => progress, stored)
    expect(items.find((i) => i.kind === 'step')!.state.rung).toBe(1)
  })

  it('ignores stored items whose course, lesson or step no longer exists, and keeps them in the record', () => {
    const stored = {
      format: 1 as const,
      items: {
        [stepKey('gone-course', 'l1', 's1')]: state(),
        [stepKey('c', 'l1', 'no-such-step')]: state(),
        [formulaKey('c', 'no-such-formula')]: state(),
        [stepKey('c', 'gone', 'x')]: state(),
      },
    }
    const items = buildQueue([{ course, sheet }], () => progress, stored)
    expect(keys(items)).toEqual([stepKey('c', 'l1', 's1'), formulaKey('c', 'f1'), formulaKey('c', 'f2')].sort())
    expect(Object.keys(stored.items)).toHaveLength(4)
  })

  it('has no formula cards without a cheat sheet, and none before a lesson is done', () => {
    expect(keys(buildQueue([{ course }], () => progress, emptyReview()))).toEqual([stepKey('c', 'l1', 's1')])
    expect(buildQueue([{ course, sheet }], () => ({ format: 1, lessons: {} }), emptyReview())).toEqual([])
  })
})
