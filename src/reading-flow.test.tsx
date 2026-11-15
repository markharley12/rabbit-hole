// Reading and the cheat sheet through the whole app: the published indexes are
// read once, the node sheet and the lesson show what they find, and a missing
// index quietly means none.

import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import App from './App.tsx'
import { forgetCachedProgress } from './lesson/progress-store.ts'
import type { Course } from './lesson/types.ts'
import { forgetResourceFiles } from './resource-store.ts'
import { forgetFetchedSheets } from './tools/cheat-sheet-store.ts'

const COURSE_DIR = 'content/maths/courses/least-squares-to-the-pseudo-inverse'
const course = { ...(JSON.parse(readFileSync(`${COURSE_DIR}/course.json`, 'utf8')) as Course), cheatsheet: true }
const reading = JSON.parse(readFileSync('content/maths/resources/15Axx.json', 'utf8'))

const files: Record<string, unknown> = {
  './content/maths/map.json': JSON.parse(readFileSync('public/content/maths/map.json', 'utf8')),
  './content/maths/courses/index.json': { format: 1, courses: [course] },
  './content/maths/resources/index.json': { format: 1, nodes: { '15Axx': reading.resources.length } },
  './content/maths/resources/15Axx.json': reading,
  [`./content/maths/courses/${course.id}/cheatsheet.json`]: JSON.parse(readFileSync(`${COURSE_DIR}/cheatsheet.json`, 'utf8')),
}
for (const lesson of course.lessons) {
  files[`./content/maths/courses/${course.id}/${lesson.id}.json`] = JSON.parse(readFileSync(`${COURSE_DIR}/${lesson.id}.json`, 'utf8'))
}

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

beforeEach(() => {
  window.location.hash = ''
  localStorage.clear()
  forgetCachedProgress()
  forgetResourceFiles()
  forgetFetchedSheets()
  vi.stubGlobal('requestAnimationFrame', () => 0)
  vi.stubGlobal('cancelAnimationFrame', () => {})
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('reading in the app', () => {
  it('the sheet of a node with reading shows it, after the course, with the check date', async () => {
    serve()
    render(<App />)
    await goTo('15Axx')
    fireEvent.click(await screen.findByRole('button', { name: 'Show more' }))
    const heading = await screen.findByRole('heading', { name: 'Reading' })
    expect(await screen.findByText('Lecture 16: Projection matrices and least squares (18.06)')).toBeTruthy()
    // A long list overwhelms: four links first, the rest on request.
    const links = () => screen.getAllByRole('link').filter((a) => a.getAttribute('target') === '_blank' && a.closest('.reading'))
    expect(links()).toHaveLength(4)
    fireEvent.click(screen.getByRole('button', { name: 'Show 10 more' }))
    expect(links()).toHaveLength(14)
    expect(screen.getByText('Links were checked on 15 Nov 2026.')).toBeTruthy()
    const course = screen.getByRole('heading', { name: 'Course' })
    expect(course.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('a node below with none of its own shows no Reading section', async () => {
    serve()
    render(<App />)
    await goTo('15-XX')
    fireEvent.click(await screen.findByRole('button', { name: 'Show more' }))
    expect(screen.queryByRole('heading', { name: 'Reading' })).toBeNull()
  })

  it('a lesson on that node has the Reading and Cheat sheet tools', async () => {
    serve()
    render(<App />)
    await goTo(`15Axx/learn/${course.id}/dependent-columns`)
    fireEvent.click(await screen.findByRole('button', { name: 'Reading' }, LOAD))
    expect(await screen.findByText('Lecture 7: Eckart-Young: The Closest Rank k Matrix to A (18.065)')).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByRole('button', { name: 'Cheat sheet' })).toBeTruthy()
  })

  it('with no reading index the app is as before: no section, no tool', async () => {
    serve(['./content/maths/resources/index.json'])
    render(<App />)
    await goTo(`15Axx/learn/${course.id}/dependent-columns`)
    await screen.findByRole('button', { name: 'Calculator' }, LOAD)
    expect(screen.queryByRole('button', { name: 'Reading' })).toBeNull()
  })
})
