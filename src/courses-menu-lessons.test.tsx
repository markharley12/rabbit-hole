// The Courses menu: each course card opens a list of its lessons, any of which can be opened.

import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import App from './App.tsx'
import { forgetCachedProgress, writeProgress } from './lesson/progress-store.ts'
import { finishLesson, openLesson } from './lesson/progress.ts'
import type { Course } from './lesson/types.ts'
import { forgetCachedReview } from './review/review-store.ts'
import { forgetFetchedSheets } from './review/use-review-queue.ts'

const pca = JSON.parse(readFileSync('content/maths/courses/principal-components-from-the-svd/course.json', 'utf8')) as Course

beforeEach(() => {
  window.location.hash = ''
  localStorage.clear()
  forgetCachedProgress()
  forgetCachedReview()
  forgetFetchedSheets()
  vi.stubGlobal('requestAnimationFrame', () => 0)
  vi.stubGlobal('cancelAnimationFrame', () => {})
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const files: Record<string, unknown> = {
        './content/maths/map.json': JSON.parse(readFileSync('public/content/maths/map.json', 'utf8')),
        './content/maths/courses/index.json': { format: 1, courses: [pca] },
      }
      return url in files ? { ok: true, json: async () => files[url] } : { ok: false, status: 404, statusText: 'Not Found', json: async () => ({}) }
    }),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('lessons inside a course card of the Courses menu', () => {
  it('opens and closes the list, shows each lesson\'s state, and opens the lesson tapped', async () => {
    const first = pca.lessons[0].id
    writeProgress(pca.id, (r) => finishLesson(openLesson(r, first, '2026-11-17T10:00:00Z'), first, 3, '2026-11-17T10:05:00Z'))
    render(<App />)
    await screen.findByRole('heading', { level: 1, name: 'Mathematics' })
    await act(async () => {
      window.location.hash = '62Hxx/courses'
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    const toggle = await screen.findByRole('button', { name: 'Lessons' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('list', { name: /Lessons in/ })).toBeNull()

    fireEvent.click(toggle)
    const list = screen.getByRole('list', { name: `Lessons in ${pca.title}` })
    const rows = within(list).getAllByRole('button')
    expect(rows).toHaveLength(pca.lessons.length)
    expect(rows[0].textContent).toContain('Done')
    expect(rows[1].textContent).not.toContain('Done')
    expect(screen.getByRole('button', { name: 'Hide lessons' }).getAttribute('aria-expanded')).toBe('true')

    fireEvent.click(rows[2])
    await screen.findByRole('button', { name: 'Close the lesson' })
    expect(window.location.hash).toBe(`#62Hxx/learn/${pca.id}/${pca.lessons[2].id}`)
  })
})
