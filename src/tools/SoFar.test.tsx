// The "So far" tool on a real lesson screen: offered only after a step, shows solved and revealed
// answers, fetches earlier lessons on first open, copes with a failed fetch.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import LessonView from '../lesson/LessonView.tsx'
import { forgetCachedProgress } from '../lesson/progress-store.ts'
import type { Course, Lesson, StepBlock } from '../lesson/types.ts'
import { forgetFetchedLessons } from './so-far-store.ts'

const course: Course = {
  format: 1,
  id: 'demo',
  nodeId: '15Axx',
  title: 'Demo',
  summary: '',
  written: '2026-11-15',
  sources: [],
  lessons: [
    { id: 'one', title: 'First lesson' },
    { id: 'two', title: 'Second lesson' },
  ],
}

const step = (id: string, prompt: string, key: string, label?: string): StepBlock => ({
  type: 'step',
  id,
  why: 'Because.',
  prompt,
  answer: { fields: [{ name: 'x', key, label }], verify: key },
  hints: ['a', 'b', 'c'],
  next: 'On',
})

const lessons: Record<string, Lesson> = {
  one: { format: 1, id: 'one', title: 'First lesson', blocks: [step('a', 'Old question', '16/5', '$\\lambda =$'), step('b', 'Skipped question', '99')] },
  two: { format: 1, id: 'two', title: 'Second lesson', blocks: [step('c', 'Near question', '7'), step('d', 'Current question', '55'), step('e', 'Later question', '66')] },
}

const finished = (solved: string[], revealed: string[] = []) => ({
  format: 1,
  lessons: {
    one: { at: 2, done: true, started: 'x', steps: { a: { attempts: 1, solved: true, hints: 0, log: [] } } },
    two: {
      at: 1,
      done: false,
      started: 'x',
      steps: {
        ...Object.fromEntries(solved.map((s) => [s, { attempts: 1, solved: true, hints: 0, log: [] }])),
        ...Object.fromEntries(revealed.map((s) => [s, { attempts: 0, solved: false, revealed: true, hints: 3, log: [] }])),
      },
    },
  },
})

let lessonOne: () => Promise<unknown>

const mount = async (lessonId: string) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => (url.includes('one') ? lessonOne() : { ok: true, json: async () => lessons[lessonId] })),
  )
  render(<LessonView course={course} lessonId={lessonId} base="./" onClose={() => {}} onOpenLesson={() => {}} />)
  await screen.findByRole('textbox')
}

const open = () => fireEvent.click(screen.getByRole('button', { name: 'So far' }))
const panel = () => screen.getByRole('dialog', { name: 'So far' })
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
const seed = (record: object) => localStorage.setItem('rabbit-hole:progress:demo', JSON.stringify(record))

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  localStorage.clear()
  forgetCachedProgress()
  forgetFetchedLessons()
  window.history.replaceState(null, '', '/')
  lessonOne = async () => ({ ok: true, json: async () => lessons.one })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('So far', () => {
  it('is not offered on the first screen of the first lesson', async () => {
    await mount('one')
    expect(screen.queryByRole('button', { name: 'So far' })).toBeNull()
  })

  it('sits after the calculator and shows this lesson without fetching anything for it', async () => {
    seed({ ...finished(['c']), lessons: { ...finished(['c']).lessons, one: { at: 0, done: false, started: 'x', steps: {} } } })
    await mount('two')
    const dock = screen.getByRole('group', { name: 'Tools' })
    expect(within(dock).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Scratch pad', 'Calculator', 'So far'])
    open()
    await flush()
    const p = within(panel())
    expect(p.getByText('Near question')).toBeTruthy()
    expect(panel().querySelector('.sofar-value .katex')).toBeTruthy()
    // Nothing to fetch: lesson one has no finished step.
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls.filter(([url]) => String(url).includes('one'))).toHaveLength(0)
  })

  it('shows earlier lessons collapsed under their title, with the answer key and label, and no unsolved steps', async () => {
    seed(finished(['c']))
    await mount('two')
    open()
    await flush()
    const p = within(panel())
    expect(p.getByRole('heading', { name: 'This lesson' })).toBeTruthy()
    const group = panel().querySelector('details.sofar-earlier') as HTMLDetailsElement
    expect(group.open).toBe(false)
    expect(within(group).getByText('First lesson')).toBeTruthy()
    expect(group.textContent).toContain('Old question')
    expect(group.textContent).toContain('λ')
    expect(group.querySelector('.sofar-value .katex-mathml')?.textContent).toContain('16')
    expect(panel().textContent).not.toContain('Skipped question')
    expect(panel().textContent).not.toContain('Current question')
    expect(panel().textContent).not.toContain('Later question')
  })

  it('opens the nearest earlier lesson when this lesson has nothing yet', async () => {
    seed(finished([]))
    await mount('two')
    open()
    await flush()
    const group = panel().querySelector('details.sofar-earlier') as HTMLDetailsElement
    expect(group.open).toBe(true)
    expect(group.textContent).toContain('Old question')
  })

  it('includes a revealed step and says so', async () => {
    seed(finished([], ['c']))
    await mount('two')
    open()
    await flush()
    expect(within(panel()).getByText('Near question')).toBeTruthy()
    expect(within(panel()).getByText('answer was shown')).toBeTruthy()
  })

  it('says nothing yet when earlier steps exist but none is finished', async () => {
    seed({ format: 1, lessons: {} })
    await mount('two')
    open()
    await flush()
    expect(within(panel()).getByText('Nothing yet. Steps you finish show up here with their answers.')).toBeTruthy()
  })

  it('says so when the earlier lessons could not be loaded, and keeps what it has', async () => {
    seed(finished(['c']))
    lessonOne = async () => ({ ok: false, status: 500, statusText: 'Boom' })
    await mount('two')
    open()
    await flush()
    expect(within(panel()).getByRole('alert').textContent).toBe('Could not load earlier lessons.')
    expect(within(panel()).getByText('Near question')).toBeTruthy()
  })

  it('writes nothing to the device', async () => {
    seed(finished(['c']))
    await mount('two')
    const before = JSON.stringify(Object.entries(localStorage).sort())
    open()
    await flush()
    expect(JSON.stringify(Object.entries(localStorage).sort())).toBe(before)
  })
})
