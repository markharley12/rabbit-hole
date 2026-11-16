import { describe, expect, it } from 'vitest'
import type { CourseRecord, StepRecord } from '../lesson/progress.ts'
import {
  LADDER,
  SESSION_CAP,
  TOP_RUNG,
  addDays,
  dayIndex,
  daysUntil,
  dueItems,
  enter,
  formulaEarnedAt,
  grade,
  gradeStep,
  inDays,
  isDue,
  localDate,
  nextDue,
  sessionOrder,
  stepEarnedAt,
} from './schedule.ts'
import type { ItemState, Scheduled } from './schedule.ts'

// Local times, as the learner lives them: the tests do not depend on the machine's zone.
const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min)
const state = (rung: number, due: Date): ItemState => ({ rung, due: due.toISOString(), reps: 0, lapses: 0 })
const dayOf = (iso: string) => localDate(new Date(iso))

describe('the ladder', () => {
  it('is 1, 3, 7, 16, 35, 90 days', () => {
    expect([...LADDER]).toEqual([1, 3, 7, 16, 35, 90])
    expect(TOP_RUNG).toBe(5)
  })
})

describe('entering', () => {
  it('starts on the bottom rung, due a day after it was earned', () => {
    const s = enter(at(2026, 11, 16, 9).toISOString())
    expect(s).toMatchObject({ rung: 0, reps: 0, lapses: 0 })
    expect(dayOf(s.due)).toBe('2026-11-17')
    expect(s.last).toBeUndefined()
  })
})

describe('grading, on every rung', () => {
  const now = at(2026, 11, 16, 20)
  const from = (rung: number) => state(rung, at(2026, 11, 16, 8))

  it('good goes one rung up and waits that rung’s gap', () => {
    for (let rung = 0; rung < TOP_RUNG; rung++) {
      const next = grade(from(rung), 'good', now)
      expect(next.rung).toBe(rung + 1)
      expect(daysUntil(next, now)).toBe(LADDER[rung + 1])
    }
  })

  it('good on the top rung stays there, 90 days', () => {
    const next = grade(from(TOP_RUNG), 'good', now)
    expect(next.rung).toBe(TOP_RUNG)
    expect(daysUntil(next, now)).toBe(90)
  })

  it('hard stays on its rung and waits that rung’s gap', () => {
    for (let rung = 0; rung <= TOP_RUNG; rung++) {
      const next = grade(from(rung), 'hard', now)
      expect(next.rung).toBe(rung)
      expect(daysUntil(next, now)).toBe(LADDER[rung])
    }
  })

  it('again drops two rungs, never below 0, and is due tomorrow', () => {
    const expected = [0, 0, 0, 1, 2, 3]
    for (let rung = 0; rung <= TOP_RUNG; rung++) {
      const next = grade(from(rung), 'again', now)
      expect(next.rung).toBe(expected[rung])
      expect(daysUntil(next, now)).toBe(1)
    }
  })

  it('counts repeats and lapses, and records when', () => {
    const a = grade(from(2), 'good', now)
    expect(a).toMatchObject({ reps: 1, lapses: 0, last: now.toISOString() })
    const b = grade(a, 'again', now)
    expect(b).toMatchObject({ reps: 2, lapses: 1 })
    expect(grade(b, 'hard', now)).toMatchObject({ reps: 3, lapses: 1 })
  })

  it('does not change the state it is given', () => {
    const before = from(2)
    const copy = { ...before }
    grade(before, 'good', now)
    expect(before).toEqual(copy)
  })
})

describe('how a step went', () => {
  it('right first try with no hint is good', () => {
    expect(gradeStep({ solved: true, revealed: false, hints: 0, wrong: 0 })).toBe('good')
  })
  it('right after a wrong try, or with a hint, is hard', () => {
    expect(gradeStep({ solved: true, revealed: false, hints: 0, wrong: 1 })).toBe('hard')
    expect(gradeStep({ solved: true, revealed: false, hints: 1, wrong: 0 })).toBe('hard')
  })
  it('the answer shown is again', () => {
    expect(gradeStep({ solved: false, revealed: true, hints: 3, wrong: 4 })).toBe('again')
  })
})

describe('calendar days', () => {
  it('an item due at 23:00 is due from the morning of that day', () => {
    const s = state(0, at(2026, 11, 17, 23, 0))
    expect(isDue(s, at(2026, 11, 16, 23, 59))).toBe(false)
    expect(isDue(s, at(2026, 11, 17, 0, 1))).toBe(true)
    expect(isDue(s, at(2026, 11, 17, 7, 0))).toBe(true)
    expect(isDue(s, at(2026, 11, 18, 7, 0))).toBe(true)
  })

  it('an item due at 00:01 is not due the evening before', () => {
    const s = state(0, at(2026, 11, 17, 0, 1))
    expect(isDue(s, at(2026, 11, 16, 23, 59))).toBe(false)
    expect(isDue(s, at(2026, 11, 17, 0, 2))).toBe(true)
  })

  it('counts whole calendar days across midnight, not 24-hour periods', () => {
    expect(dayIndex(at(2026, 11, 17, 0, 1)) - dayIndex(at(2026, 11, 16, 23, 59))).toBe(1)
    expect(dayIndex(at(2026, 11, 16, 0, 0))).toBe(dayIndex(at(2026, 11, 16, 23, 59)))
  })

  it('a gap is calendar days over a daylight-saving change', () => {
    // 90 days from 1 Oct 2026 crosses the end of summer time in Europe (25 Oct) and in the US (1 Nov).
    const start = at(2026, 10, 1, 21, 0)
    const due = addDays(start, 90)
    expect(localDate(due)).toBe('2026-12-30')
    expect(due.getHours()).toBe(21)
    expect(dayIndex(due) - dayIndex(start)).toBe(90)
    // And through the spring change, one day at a time.
    for (const [y, m, d] of [[2026, 3, 28], [2026, 3, 29], [2026, 3, 8], [2026, 11, 1]]) {
      const day = at(y, m, d, 23, 30)
      expect(dayIndex(addDays(day, 1)) - dayIndex(day)).toBe(1)
      expect(addDays(day, 1).getHours()).toBe(23)
    }
  })

  it('good then good then good is a day, three, and seven later, by the calendar', () => {
    let s = enter(at(2026, 10, 24, 22, 0).toISOString())
    expect(dayOf(s.due)).toBe('2026-10-25')
    s = grade(s, 'good', at(2026, 10, 25, 22, 0))
    expect(dayOf(s.due)).toBe('2026-10-28')
    s = grade(s, 'good', at(2026, 10, 28, 22, 0))
    expect(dayOf(s.due)).toBe('2026-11-04')
  })

  it('names the days to the next as tomorrow, or in n days', () => {
    expect(inDays(1)).toBe('tomorrow')
    expect(inDays(3)).toBe('in 3 days')
  })
})

describe('what is due and what is next', () => {
  const now = at(2026, 11, 16, 12)
  const item = (key: string, due: Date, group = key): Scheduled => ({ key, group, state: state(0, due) })
  const items = [item('late', at(2026, 11, 10)), item('today', at(2026, 11, 16, 23)), item('soon', at(2026, 11, 19)), item('far', at(2026, 12, 20))]

  it('dueItems keeps today’s and overdue', () => {
    expect(dueItems(items, now).map((i) => i.key)).toEqual(['late', 'today'])
  })

  it('nextDue is the soonest day not yet due', () => {
    expect(nextDue(items, now)).toMatchObject({ days: 3 })
    expect(nextDue(items.slice(0, 2), now)).toBeUndefined()
    expect(nextDue([], now)).toBeUndefined()
  })
})

describe('the session order', () => {
  const now = at(2026, 11, 16, 12)
  const make = (key: string, group: string, daysOverdue: number): Scheduled => ({ key, group, state: state(0, addDays(now, -daysOverdue)) })
  const adjacent = (list: Scheduled[]) => list.filter((x, i) => i > 0 && list[i - 1].group === x.group).length

  it('has at most ten items, the oldest due', () => {
    const many = Array.from({ length: 15 }, (_, i) => make(`k${i}`, `g${i % 5}`, i))
    const session = sessionOrder(many, '2026-11-16')
    expect(session).toHaveLength(SESSION_CAP)
    const keys = new Set(session.map((s) => s.key))
    for (let i = 5; i < 15; i++) expect(keys.has(`k${i}`)).toBe(true)
    for (let i = 0; i < 5; i++) expect(keys.has(`k${i}`)).toBe(false)
  })

  it('keeps items of one lesson apart when it can', () => {
    const list = [make('a1', 'a', 5), make('a2', 'a', 4), make('a3', 'a', 3), make('b1', 'b', 2), make('b2', 'b', 1), make('c1', 'c', 0)]
    for (const seed of ['x', 'y', '2026-11-16', '2026-11-17']) {
      const session = sessionOrder(list, seed)
      expect(session).toHaveLength(6)
      expect(adjacent(session)).toBe(0)
    }
  })

  it('finds the arrangement when the oldest-first greedy choice would trap itself', () => {
    // Taking the oldest each time would give A, B, B (two b's side by side); B, A, B is possible.
    const list = [make('a1', 'a', 3), make('b1', 'b', 2), make('b2', 'b', 1)]
    const session = sessionOrder(list, 's')
    expect(adjacent(session)).toBe(0)
    expect(session.map((s) => s.group)).toEqual(['b', 'a', 'b'])
  })

  it('goes oldest first when nothing needs rearranging', () => {
    const list = [make('c', 'c', 1), make('a', 'a', 3), make('b', 'b', 2)]
    expect(sessionOrder(list, 's').map((s) => s.key)).toEqual(['a', 'b', 'c'])
  })

  it('keeps every item when keeping apart is impossible', () => {
    const list = [make('a1', 'a', 3), make('a2', 'a', 2), make('a3', 'a', 1)]
    const session = sessionOrder(list, 's')
    expect(session.map((s) => s.key).sort()).toEqual(['a1', 'a2', 'a3'])
  })

  it('is the same for the same seed, however the input is ordered', () => {
    // Everything due the same day: only the seed breaks the tie.
    const list = Array.from({ length: 8 }, (_, i) => make(`k${i}`, `g${i % 3}`, 0))
    const a = sessionOrder(list, '2026-11-16').map((s) => s.key)
    const b = sessionOrder([...list].reverse(), '2026-11-16').map((s) => s.key)
    expect(b).toEqual(a)
    expect(sessionOrder(list, '2026-11-16').map((s) => s.key)).toEqual(a)
  })

  it('can differ between days', () => {
    const list = Array.from({ length: 8 }, (_, i) => make(`k${i}`, `g${i}`, 0))
    const orders = new Set(['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19'].map((d) => sessionOrder(list, d).map((s) => s.key).join()))
    expect(orders.size).toBeGreaterThan(1)
  })

  it('does not change what it is given', () => {
    const list = [make('b', 'b', 1), make('a', 'a', 3)]
    sessionOrder(list, 's')
    expect(list.map((i) => i.key)).toEqual(['b', 'a'])
  })

  it('is empty when nothing is due', () => {
    expect(sessionOrder([], 's')).toEqual([])
  })
})

// ---- Earning an item, from a progress record

const step = (over: Partial<StepRecord>): StepRecord => ({ attempts: 1, solved: false, hints: 0, log: [], ...over })
const attempt = (result: 'correct' | 'wrong', time: string) => ({ at: time, values: {}, result })
const record = (over: Partial<CourseRecord> & Pick<CourseRecord, 'lessons'>): CourseRecord => ({ format: 1, ...over })
const lesson = (over: object = {}) => ({ at: 0, done: false, started: '2026-11-10T09:00:00.000Z', steps: {}, ...over })

describe('earning a step', () => {
  it('a solved step is earned at its first correct attempt', () => {
    const r = record({
      updated: '2026-11-15T10:00:00.000Z',
      lessons: {
        l: lesson({
          finished: '2026-11-14T10:00:00.000Z',
          steps: {
            s: step({ solved: true, log: [attempt('wrong', '2026-11-12T10:00:00.000Z'), attempt('correct', '2026-11-12T10:05:00.000Z')] }),
          },
        }),
      },
    })
    expect(stepEarnedAt(r, 'l', 's')).toBe('2026-11-12T10:05:00.000Z')
  })

  it('with no correct attempt in the log it falls back to the lesson’s finish, then the record’s update', () => {
    const solved = step({ solved: true, log: [] })
    expect(stepEarnedAt(record({ updated: '2026-11-15T10:00:00.000Z', lessons: { l: lesson({ finished: '2026-11-14T10:00:00.000Z', steps: { s: solved } }) } }), 'l', 's')).toBe(
      '2026-11-14T10:00:00.000Z',
    )
    expect(stepEarnedAt(record({ updated: '2026-11-15T10:00:00.000Z', lessons: { l: lesson({ steps: { s: solved } }) } }), 'l', 's')).toBe('2026-11-15T10:00:00.000Z')
  })

  it('a revealed step is earned too, when he last tried it', () => {
    const r = record({
      updated: '2026-11-15T10:00:00.000Z',
      lessons: { l: lesson({ steps: { s: step({ revealed: true, log: [attempt('wrong', '2026-11-12T10:00:00.000Z')] }) } }) },
    })
    expect(stepEarnedAt(r, 'l', 's')).toBe('2026-11-12T10:00:00.000Z')
  })

  it('a step only seen, or never opened, is not earned', () => {
    const r = record({ lessons: { l: lesson({ steps: { s: step({ attempts: 2, log: [attempt('wrong', '2026-11-12T10:00:00.000Z')] }) } }) } })
    expect(stepEarnedAt(r, 'l', 's')).toBeUndefined()
    expect(stepEarnedAt(r, 'l', 'other')).toBeUndefined()
    expect(stepEarnedAt(r, 'nope', 's')).toBeUndefined()
  })

  it('has no time to give when the record has none', () => {
    expect(stepEarnedAt(record({ lessons: { l: lesson({ steps: { s: step({ solved: true }) } }) } }), 'l', 's')).toBeUndefined()
  })
})

describe('earning a formula', () => {
  const r = record({
    updated: '2026-11-15T10:00:00.000Z',
    lessons: {
      one: lesson({ done: true, finished: '2026-11-12T10:00:00.000Z' }),
      two: lesson({ done: true, finished: '2026-11-11T10:00:00.000Z' }),
      three: lesson({ done: false }),
    },
  })

  it('comes with its lesson’s finish', () => {
    expect(formulaEarnedAt(r, 'one')).toBe('2026-11-12T10:00:00.000Z')
  })
  it('does not come before its lesson is done', () => {
    expect(formulaEarnedAt(r, 'three')).toBeUndefined()
    expect(formulaEarnedAt(r, 'unknown')).toBeUndefined()
  })
  it('with no lesson, comes when the first lesson of the course was done', () => {
    expect(formulaEarnedAt(r, undefined)).toBe('2026-11-11T10:00:00.000Z')
    expect(formulaEarnedAt(record({ lessons: { x: lesson() } }), undefined)).toBeUndefined()
    expect(formulaEarnedAt(record({ lessons: {} }), undefined)).toBeUndefined()
  })
})
