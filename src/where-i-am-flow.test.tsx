// "Where I am" through the whole app: opened from the Courses menu, read from the progress records
// on the device, with one main button, plain counts and no scores.

import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import App from './App.tsx'
import { forgetCachedProgress, readAllProgress, writeProgress } from './lesson/progress-store.ts'
import { finishLesson, goTo as goToScreen, openLesson, recordAttempt } from './lesson/progress.ts'
import type { Course } from './lesson/types.ts'
import { forgetCachedReview } from './review/review-store.ts'
import { forgetFetchedSheets } from './review/use-review-queue.ts'

const dir = (id: string) => `content/maths/courses/${id}`
const read = (id: string) => JSON.parse(readFileSync(`${dir(id)}/course.json`, 'utf8')) as Course
const lsq = read('least-squares-to-the-pseudo-inverse')
const pca = read('principal-components-from-the-svd')
const L1 = lsq.lessons[0].id

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()
const attempt = (result: 'correct' | 'wrong', slip?: string, at = daysAgo(2)) => ({ at, values: {}, result, slip })

const serve = (courses: Course[]) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const files: Record<string, unknown> = {
        './content/maths/map.json': JSON.parse(readFileSync('public/content/maths/map.json', 'utf8')),
        './content/maths/courses/index.json': { format: 1, courses },
      }
      return url in files ? { ok: true, json: async () => files[url] } : { ok: false, status: 404, statusText: 'Not Found', json: async () => ({}) }
    }),
  )

const open = async (hash: string) => {
  render(<App />)
  await screen.findByRole('heading', { level: 1, name: 'Mathematics' })
  await act(async () => {
    window.location.hash = hash
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  })
}

beforeEach(() => {
  window.location.hash = ''
  localStorage.clear()
  forgetCachedProgress()
  forgetCachedReview()
  forgetFetchedSheets()
  vi.stubGlobal('requestAnimationFrame', () => 0)
  vi.stubGlobal('cancelAnimationFrame', () => {})
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('reading every course\'s progress', () => {
  it('gives each course its own record, empty for one never opened, and changes when one is written', () => {
    writeProgress(lsq.id, (r) => openLesson(r, L1, daysAgo(1)))
    const all = readAllProgress([lsq, pca])
    expect(Object.keys(all.get(lsq.id)!.lessons)).toEqual([L1])
    expect(all.get(pca.id)!.lessons).toEqual({})
  })
})

describe('Where I am', () => {
  it('opens from the Courses menu, and Back closes it to the map', async () => {
    serve([lsq])
    await open('15Axx/courses')
    fireEvent.click(await screen.findByRole('button', { name: 'Where I am' }))
    expect(window.location.hash).toBe('#15Axx/progress')
    expect(await screen.findByRole('dialog', { name: 'Where I am' })).toBeTruthy()
  })

  it('with nothing started says so in one sentence and offers the Courses menu', async () => {
    serve([lsq, pca])
    await open('15Axx/progress')
    const dialog = await screen.findByRole('dialog', { name: 'Where I am' })
    expect(within(dialog).getByText(/not started a course yet/)).toBeTruthy()
    expect(within(dialog).queryByRole('heading', { name: 'Review' })).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Open the Courses menu' }))
    expect(window.location.hash).toBe('#15Axx/courses')
    expect(await screen.findByRole('dialog', { name: 'Courses' })).toBeTruthy()
  })

  it('shows the lesson he is on, when, counts, repeated slips and review, with Continue as the one button', async () => {
    // A solved step earned five days ago is due for review; a lesson is part way through.
    const course: Course = { ...lsq, review: [{ lesson: L1, step: 's1' }] }
    serve([course, pca])
    writeProgress(lsq.id, (r) => {
      r = openLesson(r, L1, daysAgo(5))
      r = recordAttempt(r, L1, 's1', attempt('correct', undefined, daysAgo(5)))
      r = recordAttempt(r, L1, 's2', attempt('wrong', 'sign', daysAgo(3)))
      r = recordAttempt(r, L1, 's2', attempt('wrong', 'sign', daysAgo(3)))
      r = recordAttempt(r, L1, 's3', attempt('wrong', 'known', daysAgo(2)))
      r = recordAttempt(r, L1, 's3', attempt('wrong', 'known', daysAgo(2)))
      r = recordAttempt(r, L1, 's3', attempt('wrong', 'transpose', daysAgo(2)))
      return goToScreen(r, L1, 3, daysAgo(2))
    })
    await open('15Axx/progress')
    const dialog = await screen.findByRole('dialog', { name: 'Where I am' })
    // The review is due, so it is the one button.
    expect(within(dialog).getByRole('button', { name: 'Review (1 due)' })).toBeTruthy()
    expect(within(dialog).getAllByRole('button')).toHaveLength(2) // close, and that one
    const card = within(dialog).getByText(lsq.title).closest('li')!
    expect(card.textContent).toContain(`Lesson 1 of ${lsq.lessons.length}: ${lsq.lessons[0].title}, screen 4`)
    expect(card.textContent).toContain('Last here 2 days ago')
    expect(card.textContent).toContain('1 solved')
    // Only the started course is listed.
    expect(within(dialog).queryByText(pca.title)).toBeNull()
    expect(within(dialog).getByRole('heading', { name: 'Slips to watch' })).toBeTruthy()
    expect(within(dialog).getByText('Every sign flipped: 2 times')).toBeTruthy()
    expect(within(dialog).getByText('A specific arithmetic slip: 2 times')).toBeTruthy()
    // A slip that happened once is not listed.
    expect(within(dialog).queryByText(/transpose/)).toBeNull()
    expect(within(dialog).getByText('1 due today.')).toBeTruthy()
    expect(dialog.textContent).not.toMatch(/%|score|streak/i)
  })

  it('offers Continue when nothing is due, and opens that lesson', async () => {
    serve([lsq])
    writeProgress(lsq.id, (r) => goToScreen(openLesson(r, L1, daysAgo(1)), L1, 2, daysAgo(1)))
    await open('15Axx/progress')
    fireEvent.click(await screen.findByRole('button', { name: `Continue: ${lsq.lessons[0].title}` }))
    expect(window.location.hash).toBe(`#15Axx/learn/${lsq.id}/${L1}`)
  })

  it('says everything is done when it is, with no button but Close', async () => {
    serve([lsq])
    writeProgress(lsq.id, (r) => lsq.lessons.reduce((acc, l) => finishLesson(openLesson(acc, l.id, daysAgo(0)), l.id, 3, daysAgo(0)), r))
    await open('15Axx/progress')
    const dialog = await screen.findByRole('dialog', { name: 'Where I am' })
    expect(within(dialog).getByText('Everything here is done.')).toBeTruthy()
    expect(within(dialog).getByText(`All ${lsq.lessons.length} lessons done`)).toBeTruthy()
    expect(within(dialog).getAllByRole('button')).toHaveLength(1)
    expect(within(dialog).getByText('Last here today')).toBeTruthy()
  })
})
