// Tunnels between courses, as Mark meets them: quiet lines on a course's part of the node sheet,
// and one recommended next course on the end screen of a course's last lesson.

import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import App from './App.tsx'
import { forgetCachedProgress } from './lesson/progress-store.ts'
import type { Course } from './lesson/types.ts'

const dir = (id: string) => `content/maths/courses/${id}`
const read = (id: string) => JSON.parse(readFileSync(`${dir(id)}/course.json`, 'utf8')) as Course
const lsq = read('least-squares-to-the-pseudo-inverse')
const pca = read('principal-components-from-the-svd')

const files: Record<string, unknown> = {
  './content/maths/map.json': JSON.parse(readFileSync('public/content/maths/map.json', 'utf8')),
  './content/maths/courses/index.json': { format: 1, courses: [lsq, pca] },
}
for (const course of [lsq, pca]) {
  for (const lesson of course.lessons) {
    files[`./content/maths/courses/${course.id}/${lesson.id}.json`] = JSON.parse(readFileSync(`${dir(course.id)}/${lesson.id}.json`, 'utf8'))
  }
}

const goTo = async (hash: string) => {
  render(<App />)
  await screen.findByRole('heading', { level: 1, name: 'Mathematics' })
  await act(async () => {
    window.location.hash = hash
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  })
}

// Every lesson done, standing on its end screen (a screen number past the last is clamped to it).
const finish = (course: Course, upTo = course.lessons.length) => {
  const lessons = Object.fromEntries(
    course.lessons.slice(0, upTo).map((l) => [l.id, { at: 999, done: true, started: '2026-11-10T09:00:00.000Z', steps: {} }]),
  )
  localStorage.setItem(`rabbit-hole:progress:${course.id}`, JSON.stringify({ format: 1, lessons, lastLesson: course.lessons[upTo - 1].id }))
}

const LOAD = { timeout: 5000 }

beforeEach(() => {
  window.location.hash = ''
  localStorage.clear()
  forgetCachedProgress()
  vi.stubGlobal('requestAnimationFrame', () => 0)
  vi.stubGlobal('cancelAnimationFrame', () => {})
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url in files ? { ok: true, json: async () => files[url] } : { ok: false, status: 404, statusText: 'Not Found', json: async () => ({}) },
    ),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('tunnel lines on the node sheet', () => {
  it('says the PCA course builds on least squares, and that it is not finished yet', async () => {
    await goTo('62Hxx')
    expect(await screen.findByText('Builds on:', { exact: false })).toBeTruthy()
    const line = screen.getByText('Builds on:', { exact: false }).closest('p')!
    expect(line.textContent).toBe(`Builds on: ${lsq.title} (not finished yet)`)
    // It never blocks starting.
    expect(screen.getByRole('button', { name: 'Start course' })).toBeTruthy()
  })

  it('drops "not finished yet" once the needed course is done', async () => {
    finish(lsq)
    await goTo('62Hxx')
    const line = (await screen.findByText('Builds on:', { exact: false })).closest('p')!
    expect(line.textContent).toBe(`Builds on: ${lsq.title}`)
  })

  it('says on the least-squares sheet that it leads to PCA, with no "Builds on"', async () => {
    await goTo('15Axx')
    const line = (await screen.findByText('Leads to:', { exact: false })).closest('p')!
    expect(line.textContent).toBe(`Leads to: ${pca.title}`)
    expect(screen.queryByText('Builds on:', { exact: false })).toBeNull()
  })

  it('goes to the other course\'s node and opens its sheet when a line is tapped', async () => {
    await goTo('62Hxx')
    fireEvent.click(await screen.findByRole('button', { name: 'Show more' }))
    fireEvent.click(await screen.findByRole('button', { name: lsq.title }))
    expect(window.location.hash).toBe('#15Axx')
    expect(document.querySelector('.sheet.open')).not.toBeNull()
    expect(await screen.findByText('Leads to:', { exact: false })).toBeTruthy()
  })
})

describe('the end of the last lesson', () => {
  const last = (course: Course) => course.lessons[course.lessons.length - 1].id

  it('recommends the next course, with the way back as a quiet second button', async () => {
    finish(lsq)
    await goTo(`15Axx/learn/${lsq.id}/${last(lsq)}`)
    const next = await screen.findByRole('button', { name: `Next course: ${pca.title}` }, LOAD)
    expect(screen.getByRole('button', { name: 'Back to the map' }).className).toContain('text-button')
    expect(screen.queryByRole('button', { name: 'Course finished: back to the map' })).toBeNull()
    fireEvent.click(next)
    // The first lesson of the course (nothing of it is done yet).
    expect(window.location.hash).toBe(`#62Hxx/learn/${pca.id}/${pca.lessons[0].id}`)
  })

  it('is as before when the course leads nowhere', async () => {
    finish(pca)
    await goTo(`62Hxx/learn/${pca.id}/${last(pca)}`)
    expect(await screen.findByRole('button', { name: 'Course finished: back to the map' }, LOAD)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Next course/ })).toBeNull()
  })

  it('is as before when every course it leads to is finished', async () => {
    finish(lsq)
    finish(pca)
    await goTo(`15Axx/learn/${lsq.id}/${last(lsq)}`)
    expect(await screen.findByRole('button', { name: 'Course finished: back to the map' }, LOAD)).toBeTruthy()
  })

  it('does not change the end of a lesson that is not the last', async () => {
    finish(lsq, 1)
    await goTo(`15Axx/learn/${lsq.id}/${lsq.lessons[0].id}`)
    expect(await screen.findByRole('button', { name: `Next lesson: ${lsq.lessons[1].title}` }, LOAD)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Next course/ })).toBeNull()
  })
})
