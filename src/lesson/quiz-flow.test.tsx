// A lesson holding all three kinds of screen, run from start to finish through LessonView, and a
// review session that holds a quiz question and an ordering puzzle.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import LessonView from './LessonView.tsx'
import { forgetCachedProgress } from './progress-store.ts'
import type { CourseRecord } from './progress.ts'
import type { Course, Lesson } from './types.ts'
import { forgetCachedReview, REVIEW_KEY } from '../review/review-store.ts'
import { buildQueue } from '../review/queue.ts'
import ReviewView from '../review/ReviewView.tsx'
import { stepKey } from '../review/schedule.ts'
import { emptyReview } from '../review/review-record.ts'

const course: Course = {
  format: 1,
  id: 'demo',
  nodeId: '15Axx',
  title: 'Demo',
  summary: '',
  written: '2026-11-16',
  sources: [],
  lessons: [
    { id: 'one', title: 'One' },
    { id: 'two', title: 'Two' },
  ],
  review: [
    { lesson: 'one', step: 'q' },
    { lesson: 'one', step: 'p' },
  ],
}

const lesson: Lesson = {
  format: 1,
  id: 'one',
  title: 'One',
  blocks: [
    {
      type: 'step',
      id: 's',
      why: 'Because.',
      prompt: 'What is 2 + 2?',
      answer: { fields: [{ name: 'x', key: '4' }], verify: '4' },
      hints: ['a', 'b', 'c'],
      next: 'On to the quiz',
    },
    {
      type: 'choice',
      id: 'q',
      prompt: 'Which is even?',
      options: [
        { id: 'a', text: 'Three', correct: false, say: 'Three is odd.' },
        { id: 'b', text: 'Four', correct: true, say: 'Four is two twos.' },
        { id: 'c', text: 'Five', correct: false, say: 'Five is odd.' },
      ],
      review: true,
      next: 'On to the puzzle',
    },
    {
      type: 'order',
      id: 'p',
      prompt: 'Order the steps.',
      items: [
        { id: 'one', text: 'First line' },
        { id: 'two', text: 'Second line' },
        { id: 'three', text: 'Third line' },
      ],
      review: true,
      next: 'Finish the lesson',
    },
  ],
}

const later: Lesson = { ...lesson, id: 'two', title: 'Two' }

const serve = () =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({ ok: true, json: async () => (String(url).includes('two') ? later : lesson) })),
  )

const stored = () => JSON.parse(localStorage.getItem('rabbit-hole:progress:demo') ?? '{}') as CourseRecord
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }))

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  localStorage.clear()
  forgetCachedProgress()
  forgetCachedReview()
  window.history.replaceState(null, '', '/')
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** The ordering puzzle, solved with the buttons. */
function arrangeOrder(target: string[]) {
  const rows = () => [...document.querySelectorAll<HTMLElement>('li[data-item]')]
  const at = (id: string) => rows().findIndex((r) => r.dataset.item === id)
  target.forEach((id, i) => {
    while (at(id) > i) fireEvent.click(within(rows()[at(id)]).getByRole('button', { name: 'Move up' }))
  })
}

describe('a lesson with a step, a quiz question and a puzzle', () => {
  it('runs from start to finish, records each, and lists all three on the end screen', async () => {
    serve()
    render(<LessonView course={course} lessonId="one" base="./" onClose={() => {}} onOpenLesson={() => {}} />)

    // The step.
    fireEvent.change(await screen.findByRole('textbox', { name: 'x' }), { target: { value: '4' } })
    click('Check')
    click('On to the quiz')

    // The quiz question: a wrong pick first, then the right one.
    fireEvent.click(await screen.findByRole('radio', { name: /Three/ }))
    click('Check')
    expect(within(screen.getByRole('status')).getByText('Three is odd.')).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: /Four/ }))
    click('Check')
    click('On to the puzzle')

    // The puzzle: a wrong Check first, then the order.
    await screen.findByRole('list', { name: 'Lines to put in order' })
    click('Check')
    expect(within(screen.getByRole('status')).getByText('Not yet.')).toBeTruthy()
    arrangeOrder(['one', 'two', 'three'])
    click('Check')
    click('Finish the lesson')

    // The end screen names all three, each done.
    await screen.findByRole('heading', { name: 'Lesson done' })
    const items = screen.getAllByRole('listitem').map((li) => li.textContent)
    expect(items).toEqual(['✓ s', '✓ q', '✓ p'])

    const record = stored().lessons.one
    expect(record.done).toBe(true)
    expect(record.steps.s).toMatchObject({ solved: true, attempts: 1 })
    expect(record.steps.q).toMatchObject({ solved: true, attempts: 2, hints: 0 })
    expect(record.steps.q.log.map((a) => a.result)).toEqual(['wrong', 'correct'])
    expect(record.steps.q.log[1].values).toMatchObject({ picked: 'b' })
    expect(record.steps.p).toMatchObject({ solved: true, attempts: 2 })
    expect(record.steps.p.log[1].values.order).toBe('one,two,three')
  })

  it('shows the progress bar, resumes on the quiz after a reload, and has no Ask tool on it', async () => {
    serve()
    const { unmount } = render(<LessonView course={course} lessonId="one" base="./" onClose={() => {}} onOpenLesson={() => {}} />)
    fireEvent.change(await screen.findByRole('textbox', { name: 'x' }), { target: { value: '4' } })
    click('Check')
    click('On to the quiz')
    fireEvent.click(await screen.findByRole('radio', { name: /Five/ }))
    unmount()
    forgetCachedProgress()
    render(<LessonView course={course} lessonId="one" base="./" onClose={() => {}} onOpenLesson={() => {}} />)
    expect(await screen.findByRole('radio', { name: /Five/ })).toBeTruthy()
    expect((screen.getByRole('radio', { name: /Five/ }) as HTMLInputElement).checked).toBe(true)
    expect(screen.queryByRole('button', { name: /Ask/ })).toBeNull()
  })

  it('a skipped-over answer is listed as shown, not done', async () => {
    serve()
    render(<LessonView course={course} lessonId="one" base="./" onClose={() => {}} onOpenLesson={() => {}} />)
    fireEvent.change(await screen.findByRole('textbox', { name: 'x' }), { target: { value: '4' } })
    click('Check')
    click('On to the quiz')
    await screen.findByRole('radio', { name: /Three/ })
    for (const name of [/Three/, /Five/]) {
      fireEvent.click(screen.getByRole('radio', { name }))
      click('Check')
    }
    click('Show the answer')
    click('On to the puzzle')
    await screen.findByRole('list', { name: 'Lines to put in order' })
    for (let i = 0; i < 3; i++) click('Check')
    click('Show the answer')
    click('Finish the lesson')
    await screen.findByRole('heading', { name: 'Lesson done' })
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['✓ s', 'shown q', 'shown p'])
  })
})

describe('a review session with a quiz question and a puzzle', () => {
  const NOW = new Date(2026, 10, 20, 12, 0)

  const items = () => {
    const record: CourseRecord = {
      format: 1,
      lessons: { one: { at: 3, done: true, started: '2026-11-10T09:00:00.000Z', finished: '2026-11-10T10:00:00.000Z', steps: {
        q: { attempts: 1, solved: true, hints: 0, log: [{ at: '2026-11-10T09:30:00.000Z', values: {}, result: 'correct' }] },
        p: { attempts: 1, solved: true, hints: 0, log: [{ at: '2026-11-10T09:40:00.000Z', values: {}, result: 'correct' }] },
      } } },
    }
    return buildQueue([{ course }], () => record, emptyReview())
  }

  const review = () => JSON.parse(localStorage.getItem(REVIEW_KEY) ?? '{"items":{}}').items as Record<string, { rung: number; reps: number; lapses: number }>

  it('queues marked quiz and puzzle blocks as items, like steps', () => {
    expect(items().map((i) => i.key).sort()).toEqual([stepKey('demo', 'one', 'p'), stepKey('demo', 'one', 'q')])
  })

  it('shows each with its own screen, grades them by the same rules, and leaves the lesson record alone', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    serve()
    render(<ReviewView items={items()} base="./" onClose={() => {}} />)

    // Whichever comes first: a quiz is answered right first try (good), a puzzle after a wrong try (hard).
    for (let n = 0; n < 2; n++) {
      await waitFor(() => expect(screen.queryByText(/Loading the question/)).toBeNull())
      if (screen.queryByRole('radiogroup')) {
        fireEvent.click(screen.getByRole('radio', { name: /Four/ }))
        click('Check')
        click('On to the puzzle')
      } else {
        await screen.findByRole('list', { name: 'Lines to put in order' })
        click('Check')
        arrangeOrder(['one', 'two', 'three'])
        click('Check')
        click('Finish the lesson')
      }
    }
    await screen.findByRole('heading', { name: 'Done for today.' })

    const graded = review()
    expect(graded[stepKey('demo', 'one', 'q')]).toMatchObject({ rung: 1, reps: 1, lapses: 0 })
    expect(graded[stepKey('demo', 'one', 'p')]).toMatchObject({ rung: 0, reps: 1, lapses: 0 })
    expect(localStorage.getItem('rabbit-hole:progress:demo')).toBeNull()
    vi.useRealTimers()
  })

  it('an answer shown is graded again', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    serve()
    const only = items().filter((i) => i.key.endsWith(':q'))
    render(<ReviewView items={only} base="./" onClose={() => {}} />)
    await screen.findByRole('radiogroup')
    for (const name of [/Three/, /Five/]) {
      fireEvent.click(screen.getByRole('radio', { name }))
      click('Check')
    }
    click('Show the answer')
    click('On to the puzzle')
    await screen.findByRole('heading', { name: 'Done for today.' })
    expect(review()[stepKey('demo', 'one', 'q')]).toMatchObject({ rung: 0, reps: 1, lapses: 1 })
    vi.useRealTimers()
  })
})
