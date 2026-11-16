// Spaced review through the whole app, with a fake clock and a fake network: what is due comes
// from the progress records, a session grades it, and the course's own progress is never touched.

import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from './App.tsx'
import { forgetCachedProgress } from './lesson/progress-store.ts'
import type { Lesson, StepBlock, Course } from './lesson/types.ts'
import { forgetCachedReview } from './review/review-store.ts'
import { forgetFetchedSheets } from './review/use-review-queue.ts'
import { formulaKey, localDate, stepKey } from './review/schedule.ts'

const COURSE_DIR = 'content/maths/courses/least-squares-to-the-pseudo-inverse'
const base = JSON.parse(readFileSync(`${COURSE_DIR}/course.json`, 'utf8')) as Course
const lessons = Object.fromEntries(
  base.lessons.map((l) => [l.id, JSON.parse(readFileSync(`${COURSE_DIR}/${l.id}.json`, 'utf8')) as Lesson]),
)
// The validator's published index lists the marked steps; build the same list here.
const review = base.lessons.flatMap((l) =>
  lessons[l.id].blocks.filter((b) => b.type === 'step' && b.review).map((b) => ({ lesson: l.id, step: b.id })),
)
const course: Course = { ...base, cheatsheet: true, review }
const L1 = 'normal-equations-from-your-points'
const step = (id: string) => lessons[L1].blocks.find((b) => b.id === id) as StepBlock

// A small cheat sheet, so the count is easy to see: one formula of lesson 1, one of no lesson.
const sheet = {
  format: 1,
  sections: [
    {
      title: 'Test',
      items: [
        { id: 'f-a', name: 'Alpha formula', formula: '$a = 1$', when: 'When you need alpha.', lesson: L1 },
        { id: 'f-b', name: 'Beta formula', formula: '$b = 2$', when: 'When you need beta.' },
      ],
    },
  ],
}

const files: Record<string, unknown> = {
  './content/maths/map.json': JSON.parse(readFileSync('public/content/maths/map.json', 'utf8')),
  './content/maths/courses/index.json': { format: 1, courses: [course] },
  [`./content/maths/courses/${course.id}/cheatsheet.json`]: sheet,
}
for (const lesson of base.lessons) files[`./content/maths/courses/${course.id}/${lesson.id}.json`] = lessons[lesson.id]

const serve = (missing: string[] = []) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url in files && !missing.includes(url)
        ? { ok: true, json: async () => files[url] }
        : { ok: false, status: 404, statusText: 'Not Found', json: async () => ({}) },
    ),
  )

const goTo = async (hash: string) => {
  await act(async () => {
    window.location.hash = hash
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  })
}

const LOAD = { timeout: 5000 }
const NOW = new Date(2026, 10, 16, 12, 0)
const clockAt = (date: Date) => vi.setSystemTime(date)
const PROGRESS_KEY = `rabbit-hole:progress:${course.id}`

/**
 * Lesson 1 finished at `finished`: two steps solved first try then, one answer shown. By default that
 * is two days ago, and five items fall due: three steps, two formulas. With `steps` false only the
 * lesson is done, so only the two formulas come.
 */
function earnLesson1(finished = new Date(2026, 10, 14, 11, 0), steps = true) {
  const correct = { at: finished.toISOString(), values: {}, result: 'correct' as const }
  localStorage.setItem(
    PROGRESS_KEY,
    JSON.stringify({
      format: 1,
      lastLesson: L1,
      updated: finished.toISOString(),
      lessons: {
        [L1]: {
          at: lessons[L1].blocks.length,
          done: true,
          started: new Date(finished.getTime() - 3_600_000).toISOString(),
          finished: finished.toISOString(),
          steps: steps
            ? {
                'guess-y-equals-x': { attempts: 1, solved: true, hints: 0, log: [correct] },
                'build-ata': { attempts: 1, solved: true, hints: 0, log: [correct] },
                'solve-normal-equations': { attempts: 4, solved: false, revealed: true, hints: 3, log: [] },
              }
            : {},
        },
      },
    }),
  )
}

const boxes = () => [...document.querySelectorAll<HTMLInputElement>('.answer input')]
const fill = (values: string[]) => boxes().forEach((box, i) => fireEvent.change(box, { target: { value: values[i] } }))
const keysOf = (block: StepBlock) => block.answer.fields.map((f) => f.key)
const stored = () => JSON.parse(localStorage.getItem('rabbit-hole:review') ?? '{"items":{}}').items as Record<string, { rung: number; due: string; reps: number; lapses: number }>
const dueDay = (key: string) => localDate(new Date(stored()[key].due))

const openReview = async () => {
  render(<App />)
  await screen.findByRole('heading', { level: 1, name: 'Mathematics' })
  fireEvent.click(await screen.findByRole('button', { name: /^Review/ }))
  await goTo(window.location.hash.slice(1))
}

beforeEach(() => {
  window.location.hash = ''
  localStorage.clear()
  forgetCachedProgress()
  forgetCachedReview()
  forgetFetchedSheets()
  vi.useFakeTimers({ toFake: ['Date'] })
  clockAt(NOW)
  vi.stubGlobal('requestAnimationFrame', () => 0)
  vi.stubGlobal('cancelAnimationFrame', () => {})
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('the real course marks its steps', () => {
  it('has marked steps in every lesson, each one a step of that lesson', () => {
    expect(review.length).toBeGreaterThanOrEqual(base.lessons.length)
    for (const lesson of base.lessons) {
      const marked = review.filter((r) => r.lesson === lesson.id)
      expect(marked.length).toBeGreaterThanOrEqual(1)
      expect(marked.length).toBeLessThanOrEqual(3)
    }
  })
})

describe('the badge and the entry lines', () => {
  it('shows how many are due, and says so to a screen reader', async () => {
    earnLesson1()
    serve()
    render(<App />)
    const button = await screen.findByRole('button', { name: 'Review, 5 due' }, LOAD)
    expect(button.textContent).toBe('5')
  })

  it('has no badge at zero, and the button is still there', async () => {
    serve()
    render(<App />)
    const button = await screen.findByRole('button', { name: 'Review' })
    expect(button.querySelector('.review-badge')).toBeNull()
    expect(screen.queryByText(/to review$/)).toBeNull()
  })

  it('nothing is due on the day it was earned, and a day later it is', async () => {
    earnLesson1(new Date(2026, 10, 16, 9, 0))
    serve()
    const { unmount } = render(<App />)
    await screen.findByRole('button', { name: 'Review' }, LOAD)
    await waitFor(() => expect(screen.queryByRole('button', { name: /due/ })).toBeNull())
    unmount()
    clockAt(new Date(2026, 10, 17, 8, 0))
    render(<App />)
    await screen.findByRole('button', { name: /Review, \d+ due/ }, LOAD)
  })

  it('the root sheet and the Courses menu each offer one quiet line, only when something is due', async () => {
    earnLesson1()
    serve()
    render(<App />)
    const line = await screen.findByRole('button', { name: '5 to review' }, LOAD)
    expect(line.closest('.sheet')).toBeTruthy()
    // Not on the sheet of a node below the root.
    await goTo('analysis')
    expect(screen.queryByRole('button', { name: '5 to review' })).toBeNull()
    await goTo('')
    await goTo('mathematics/courses')
    const inMenu = await screen.findByRole('button', { name: '5 to review' })
    fireEvent.click(inMenu)
    expect(window.location.hash).toBe('#mathematics/review')
  })

  it('the menu has no line when nothing is due', async () => {
    serve()
    render(<App />)
    await screen.findByRole('button', { name: 'Review' })
    await goTo('mathematics/courses')
    await screen.findByRole('dialog', { name: 'Courses' })
    expect(screen.queryByText(/to review$/)).toBeNull()
  })
})

describe('a session', () => {
  it('grades steps and formulas, never touches the course progress, and brings the misses back tomorrow', async () => {
    earnLesson1()
    const progressBefore = localStorage.getItem(PROGRESS_KEY)
    serve()
    await openReview()

    const seen: string[] = []
    for (let i = 1; i <= 5; i++) {
      await screen.findByText(`${i} of 5`, {}, LOAD)
      const formula = screen.queryByRole('button', { name: 'Show the formula' })
      if (formula) {
        const name = screen.getByRole('heading', { level: 2 }).textContent!
        seen.push(name)
        // The answer is not on the screen before it is asked for.
        expect(screen.queryByText(/a = 1|b = 2/)).toBeNull()
        expect(screen.getByText('Write it on paper first.')).toBeTruthy()
        fireEvent.click(formula)
        expect(screen.getByRole('status').textContent).toMatch(/[ab]\s*=\s*[12]/)
        fireEvent.click(screen.getByRole('button', { name: name.startsWith('Alpha') ? 'Not yet' : 'Got it' }))
        continue
      }
      const title = screen.getByRole('heading', { level: 2 }).textContent!
      seen.push(title)
      expect(screen.getByText('From Normal equations from your three points')).toBeTruthy()
      if (title === 'A guess, scored') {
        // Right first try, no hint.
        const block = step('guess-y-equals-x')
        fill(keysOf(block))
        fireEvent.click(screen.getByRole('button', { name: 'Check' }))
        fireEvent.click(screen.getByRole('button', { name: block.next }))
      } else if (title === 'AᵀA') {
        // A wrong try first, then right.
        const block = step('build-ata')
        fill(['0', '0', '0', '0'])
        fireEvent.click(screen.getByRole('button', { name: 'Check' }))
        fill(keysOf(block))
        fireEvent.click(screen.getByRole('button', { name: 'Check' }))
        fireEvent.click(screen.getByRole('button', { name: block.next }))
      } else {
        // Gave up: three hints, one wrong try, the answer.
        const block = step('solve-normal-equations')
        fill(['0', '0'])
        fireEvent.click(screen.getByRole('button', { name: 'Check' }))
        for (let h = 0; h < 3; h++) fireEvent.click(screen.getByRole('button', { name: /hint/i }))
        fireEvent.click(screen.getByRole('button', { name: 'Show the answer' }))
        fireEvent.click(screen.getByRole('button', { name: block.next }))
      }
    }
    expect(seen.sort()).toEqual(['A guess, scored', 'AᵀA', 'Alpha formula', 'Beta formula', 'Solve them'].sort())

    // The end: done, and when the next one is.
    expect(await screen.findByRole('heading', { name: 'Done for today.' })).toBeTruthy()
    expect(screen.getByText('The next review is due tomorrow.')).toBeTruthy()

    const items = stored()
    // Right first try: up a rung, three days.
    expect(items[stepKey(course.id, L1, 'guess-y-equals-x')]).toMatchObject({ rung: 1, reps: 1, lapses: 0 })
    expect(dueDay(stepKey(course.id, L1, 'guess-y-equals-x'))).toBe('2026-11-19')
    // Right after a wrong try: same rung, one day (rung 0's gap).
    expect(items[stepKey(course.id, L1, 'build-ata')]).toMatchObject({ rung: 0, reps: 1, lapses: 0 })
    expect(dueDay(stepKey(course.id, L1, 'build-ata'))).toBe('2026-11-17')
    // The answer shown: again, tomorrow.
    expect(items[stepKey(course.id, L1, 'solve-normal-equations')]).toMatchObject({ rung: 0, reps: 1, lapses: 1 })
    expect(dueDay(stepKey(course.id, L1, 'solve-normal-equations'))).toBe('2026-11-17')
    // Formulas: "Not yet" is again, "Got it" is good.
    expect(items[formulaKey(course.id, 'f-a')]).toMatchObject({ rung: 0, lapses: 1 })
    expect(dueDay(formulaKey(course.id, 'f-a'))).toBe('2026-11-17')
    expect(items[formulaKey(course.id, 'f-b')]).toMatchObject({ rung: 1, lapses: 0 })
    expect(dueDay(formulaKey(course.id, 'f-b'))).toBe('2026-11-19')

    // The course's own record is exactly as it was.
    expect(localStorage.getItem(PROGRESS_KEY)).toBe(progressBefore)

    // Back to the map: nothing is due now.
    fireEvent.click(screen.getByRole('button', { name: 'Back to the map' }))
    await waitFor(() => expect(window.location.hash).not.toMatch(/review/))
    await screen.findByRole('button', { name: 'Review' })
    expect(document.querySelector('.review-badge')).toBeNull()
  })

  it('the misses are due again the next morning, and the rest are not', async () => {
    earnLesson1()
    serve()
    // Graded by hand-written record: two steps up a rung, three back on the bottom.
    const day = (d: number) => new Date(2026, 10, d, 12).toISOString()
    localStorage.setItem(
      'rabbit-hole:review',
      JSON.stringify({
        format: 1,
        items: {
          [stepKey(course.id, L1, 'guess-y-equals-x')]: { rung: 1, due: day(19), reps: 1, lapses: 0 },
          [stepKey(course.id, L1, 'build-ata')]: { rung: 0, due: day(17), reps: 1, lapses: 0 },
          [stepKey(course.id, L1, 'solve-normal-equations')]: { rung: 0, due: day(17), reps: 1, lapses: 1 },
          [formulaKey(course.id, 'f-a')]: { rung: 0, due: day(17), reps: 1, lapses: 1 },
          [formulaKey(course.id, 'f-b')]: { rung: 1, due: day(19), reps: 1, lapses: 0 },
        },
      }),
    )
    const { unmount } = render(<App />)
    await screen.findByRole('button', { name: 'Review' }, LOAD)
    expect(document.querySelector('.review-badge')).toBeNull()
    unmount()
    clockAt(new Date(2026, 10, 17, 7, 30))
    render(<App />)
    await screen.findByRole('button', { name: 'Review, 3 due' }, LOAD)
  })

  it('closing part way keeps what was graded and leaves the rest due', async () => {
    earnLesson1(new Date(2026, 10, 14, 11, 0), false)
    serve()
    await openReview()
    await screen.findByText('1 of 2', {}, LOAD)
    fireEvent.click(screen.getByRole('button', { name: 'Show the formula' }))
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
    await screen.findByText('2 of 2')
    fireEvent.click(screen.getByRole('button', { name: 'Close review' }))
    await waitFor(() => expect(window.location.hash).not.toMatch(/review/))
    expect(Object.keys(stored())).toHaveLength(1)
    await screen.findByRole('button', { name: 'Review, 1 due' })
  })

  it('says so when nothing is due, and when the next one is', async () => {
    earnLesson1(new Date(2026, 10, 16, 9, 0))
    serve()
    await openReview()
    expect(await screen.findByRole('heading', { name: 'Nothing to review today.' }, LOAD)).toBeTruthy()
    expect(screen.getByText('The next review is due tomorrow.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Back to the map' }))
    await waitFor(() => expect(window.location.hash).not.toMatch(/review/))
  })

  it('tells a new learner how items arrive', async () => {
    serve()
    await openReview()
    expect(await screen.findByRole('heading', { name: 'Nothing to review today.' }, LOAD)).toBeTruthy()
    expect(screen.getByText('Finish a lesson and its key steps come back here after a day.')).toBeTruthy()
  })

  it('skips a question whose lesson will not load, with one sentence, without grading it', async () => {
    earnLesson1()
    // Only a step of lesson 1 is due; drop the two formulas by taking the cheat sheet away too.
    serve([`./content/maths/courses/${course.id}/${L1}.json`, `./content/maths/courses/${course.id}/cheatsheet.json`])
    await openReview()
    for (let i = 1; i <= 3; i++) {
      await screen.findByText(`${i} of 3`, {}, LOAD)
      expect(await screen.findByText('This question could not be loaded, so it is skipped for now.')).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    }
    expect(await screen.findByRole('heading', { name: 'Done for today.' })).toBeTruthy()
    expect(Object.keys(stored())).toHaveLength(0)
    // They are still due, and the sentence says so.
    expect(screen.getByText('3 more are due. Open Review again for them.')).toBeTruthy()
    expect(screen.getByText(/cheat sheet of .* could not be loaded/)).toBeTruthy()
  })

  it('Back from a session returns to the map, as the courses menu does', async () => {
    earnLesson1()
    serve()
    await openReview()
    await screen.findByText('1 of 5', {}, LOAD)
    expect(window.location.hash).toMatch(/\/review$/)
    fireEvent.click(screen.getByRole('button', { name: 'Close review' }))
    await waitFor(() => expect(window.location.hash).not.toMatch(/review/))
    await screen.findByRole('heading', { level: 1, name: 'Mathematics' })
  })
})
