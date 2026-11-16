import { describe, expect, it } from 'vitest'
import { emptyCourse, finishLesson, goTo, openLesson, recordAttempt, revealAnswer } from './lesson/progress.ts'
import type { CourseRecord } from './lesson/progress.ts'
import type { Course } from './lesson/types.ts'
import { enter } from './review/schedule.ts'
import type { Scheduled } from './review/schedule.ts'
import { ago, countsText, nextAction, repeatedSlips, reviewText, startedCourses } from './where-i-am.ts'

const NOW = new Date(2026, 10, 16, 12)
const at = (day: number, hour = 9) => new Date(2026, 10, day, hour).toISOString()

const course = (id: string, lessons: string[], tunnels: Course['tunnels'] = undefined): Course =>
  ({ format: 1, id, nodeId: '15Axx', title: `Course ${id}`, lessons: lessons.map((l) => ({ id: l, title: `Lesson ${l}` })), tunnels }) as Course

const wrong = (slip: string | undefined, when = at(15)) => ({ at: when, values: {}, result: 'wrong' as const, slip })

/** Records the way the lesson writes them: open, go to a screen, attempt, finish. */
function record(build: (r: CourseRecord) => CourseRecord): CourseRecord {
  return build(emptyCourse())
}

describe('ago', () => {
  it.each([
    [at(16, 8), 'today'],
    [at(15, 23), 'yesterday'],
    [at(14), '2 days ago'],
    [at(10), '6 days ago'],
    [at(9), '1 week ago'],
    [new Date(2026, 9, 20).toISOString(), '3 weeks ago'],
    [new Date(2026, 7, 16).toISOString(), '3 months ago'],
    [at(20), 'today'],
  ])('reads %s as %s', (iso, text) => {
    expect(ago(iso, NOW)).toBe(text)
  })

  it('says nothing for a time that is missing or not a time', () => {
    expect(ago(undefined, NOW)).toBeUndefined()
    expect(ago('last Tuesday', NOW)).toBeUndefined()
  })
})

describe('countsText', () => {
  it('gives plain counts, and nothing like a zero for what was not done', () => {
    expect(countsText(14, 1)).toBe('14 solved, 1 shown')
    expect(countsText(3, 0)).toBe('3 solved')
    expect(countsText(0, 2)).toBe('2 shown')
    expect(countsText(0, 0)).toBe('Nothing solved yet')
  })
})

describe('startedCourses', () => {
  const a = course('a', ['one', 'two', 'three'])
  const b = course('b', ['x', 'y'])
  const c = course('c', ['p'])

  it('lists only courses he has started, the latest first, with where he is', () => {
    const records = new Map<string, CourseRecord>([
      ['a', record((r) => goTo(openLesson(finishLesson(openLesson(r, 'one', at(10)), 'one', 4, at(10)), 'two', at(11)), 'two', 2, at(11)))],
      ['b', record((r) => goTo(openLesson(r, 'x', at(14)), 'x', 5, at(14)))],
    ])
    const list = startedCourses([a, b, c], records)
    expect(list.map((s) => s.course.id)).toEqual(['b', 'a'])
    expect(list[0]).toMatchObject({ lessonNumber: 1, lessonTitle: 'Lesson x', screen: 6, finished: false, lastAt: at(14) })
    expect(list[1]).toMatchObject({ lessonNumber: 2, lessonTitle: 'Lesson two', screen: 3, finished: false, lastAt: at(11) })
  })

  it('counts screens solved and shown, solved winning, and no percentage anywhere', () => {
    const ok = { at: at(12), values: {}, result: 'correct' as const }
    const r = record((x) => {
      x = openLesson(x, 'one', at(12))
      x = recordAttempt(x, 'one', 's1', ok)
      x = recordAttempt(x, 'one', 's2', ok)
      x = revealAnswer(x, 'one', 's3', at(12))
      x = revealAnswer(recordAttempt(x, 'one', 's4', ok), 'one', 's4', at(12))
      return recordAttempt(x, 'one', 's5', wrong('sign', at(12)))
    })
    const [s] = startedCourses([a], new Map([['a', r]]))
    expect([s.solved, s.shown]).toEqual([3, 1])
    expect(JSON.stringify(s)).not.toMatch(/%|percent|score/i)
  })

  it('marks a finished course and shows its last lesson', () => {
    const r = record((x) => ['x', 'y'].reduce((acc, id) => finishLesson(openLesson(acc, id, at(13)), id, 3, at(13)), x))
    const [s] = startedCourses([b], new Map([['b', r]]))
    expect(s).toMatchObject({ finished: true, lessonNumber: 2, lessonTitle: 'Lesson y' })
    expect(s.screen).toBeUndefined()
  })

  it('is empty when nothing has been started, even with a record that has no lessons', () => {
    expect(startedCourses([a, b], new Map([['a', emptyCourse()]]))).toEqual([])
  })
})

describe('nextAction', () => {
  const base = course('base', ['b1', 'b2'])
  const top = course('top', ['t1', '  t2'], [{ to: 'base', kind: 'needs', why: 'It uses base.' }])
  const solo = course('solo', ['s1'])
  const done = (c: Course) => record((r) => c.lessons.reduce((acc, l) => finishLesson(openLesson(acc, l.id, at(12)), l.id, 3, at(12)), r))
  const midway = (c: Course, day: number) => record((r) => goTo(openLesson(r, c.lessons[0].id, at(day)), c.lessons[0].id, 2, at(day)))

  it('puts reviews first, whatever else is going on', () => {
    const records = new Map([['base', midway(base, 15)]])
    expect(nextAction([base], records, 4)).toEqual({ kind: 'review', due: 4 })
  })

  it('then continues the lesson in progress, in the course he was last in', () => {
    const records = new Map([
      ['base', midway(base, 14)],
      ['solo', midway(solo, 15)],
    ])
    expect(nextAction([base, solo], records, 0)).toMatchObject({ kind: 'lesson', verb: 'Continue', course: { id: 'solo' }, lessonId: 's1', title: 'Lesson s1' })
  })

  it('then starts the first lesson of the first unfinished course whose needs are finished', () => {
    // top comes before base in the list, but needs it; base is not started.
    expect(nextAction([top, base], new Map(), 0)).toMatchObject({ verb: 'Start', course: { id: 'base' }, lessonId: 'b1' })
    // With base finished, top is next.
    const records = new Map([['base', done(base)]])
    expect(nextAction([top, base], records, 0)).toMatchObject({ verb: 'Start', course: { id: 'top' }, lessonId: 't1' })
  })

  it('starts the next lesson of a course he is between lessons in, rather than its first again', () => {
    const r = record((x) => finishLesson(openLesson(x, 'b1', at(13)), 'b1', 3, at(13)))
    expect(nextAction([base], new Map([['base', r]]), 0)).toMatchObject({ verb: 'Start', lessonId: 'b2' })
  })

  it('says there is nothing when everything is done', () => {
    const records = new Map([
      ['base', done(base)],
      ['top', done(top)],
    ])
    expect(nextAction([base, top], records, 0)).toEqual({ kind: 'none' })
    expect(nextAction([], new Map(), 0)).toEqual({ kind: 'none' })
  })
})

describe('repeatedSlips', () => {
  const withLog = (...slips: (string | undefined)[]) =>
    record((r) => slips.reduce((acc, slip, i) => recordAttempt(acc, 'one', `s${i % 2}`, wrong(slip)), r))

  it('names slips that happened twice or more, most often first, three at most', () => {
    const r = withLog('sign', 'sign', 'sign', 'symmetric', 'symmetric', 'scaled', 'scaled', 'transpose', 'transpose', 'swapped')
    expect(repeatedSlips([r])).toEqual([
      { name: 'Every sign flipped', count: 3 },
      { name: 'A matrix that should be symmetric was not', count: 2 },
      // A tie keeps the order the slips are named in (symmetric, transpose, sign, scaled, ...).
      { name: 'Rows and columns swapped (a transpose)', count: 2 },
    ])
  })

  it('counts every known slip together, across courses', () => {
    expect(repeatedSlips([withLog('known'), withLog('known', 'sign')])).toEqual([{ name: 'A specific arithmetic slip', count: 2 }])
  })

  it('shows nothing for a slip that happened once, a right answer, or an accept rule', () => {
    const ok = { at: at(15), values: {}, result: 'correct' as const, slip: 'negated' }
    const r = recordAttempt(recordAttempt(withLog('sign', undefined), 'one', 's0', ok), 'one', 's0', ok)
    expect(repeatedSlips([r])).toEqual([])
    expect(repeatedSlips([])).toEqual([])
  })
})

describe('reviewText', () => {
  const item = (due: Date): Scheduled => ({ key: String(due), group: 'g', state: { ...enter(at(10)), due: due.toISOString() } })

  it('counts what is due and says when the next one is', () => {
    expect(reviewText([item(new Date(2026, 10, 15)), item(new Date(2026, 10, 16, 20)), item(new Date(2026, 10, 19))], NOW)).toBe('2 due today. Next: in 3 days.')
  })

  it('says tomorrow, and nothing due', () => {
    expect(reviewText([item(new Date(2026, 10, 17))], NOW)).toBe('Nothing due today. Next: tomorrow.')
  })

  it('leaves out "Next" when nothing is left to come, and says so when there is nothing at all', () => {
    expect(reviewText([item(new Date(2026, 10, 16))], NOW)).toBe('1 due today.')
    expect(reviewText([], NOW)).toBe('Nothing to review yet.')
  })
})
