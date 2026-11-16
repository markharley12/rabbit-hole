// Where "make a new course" is offered: only when the server on the PC answers
// and offers the new-course kind. No server, no buttons, nothing else changes.

import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import App from './App.tsx'

const files: Record<string, unknown> = {
  './content/maths/map.json': JSON.parse(readFileSync('public/content/maths/map.json', 'utf8')),
  './content/maths/courses/index.json': { format: 1, courses: [] },
}

const serve = (kinds: string[] | null) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === './api/state') {
        if (!kinds) throw new TypeError('offline')
        return { ok: true, json: async () => ({ ok: true, version: 1, kinds, busy: false }) }
      }
      if (url === './api/drafts') return { ok: true, status: 200, json: async () => ({ drafts: [] }) }
      return url in files ? { ok: true, json: async () => files[url] } : { ok: false, status: 404, json: async () => ({}) }
    }),
  )

const goTo = async (hash: string) => {
  await act(async () => {
    window.location.hash = hash
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  })
}

beforeEach(() => {
  window.location.hash = ''
  localStorage.clear()
  vi.stubGlobal('requestAnimationFrame', () => 0)
  vi.stubGlobal('cancelAnimationFrame', () => {})
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('making a new course', () => {
  it('is offered on an empty node’s sheet and in the Courses menu when the server offers it', async () => {
    serve(['ask', 'build-course', 'new-course'])
    render(<App />)
    await screen.findByRole('heading', { level: 1, name: 'Mathematics' })
    await goTo('15Axx')
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Make a course here' }))
    expect(window.location.hash).toBe('#15Axx/new-course')
    expect(await screen.findByText('Say what you want to learn. A rough idea is enough.', {}, { timeout: 5000 })).toBeTruthy()
    expect(screen.getByText('From Basic linear algebra')).toBeTruthy()

    await goTo('15Axx/courses')
    fireEvent.click(await screen.findByRole('button', { name: 'New course' }))
    expect(window.location.hash).toBe('#15Axx/new-course')
  })

  it('is not offered without the server, or by a server without the kind', async () => {
    for (const kinds of [null, ['ask']]) {
      serve(kinds)
      render(<App />)
      await screen.findByRole('heading', { level: 1, name: 'Mathematics' })
      await goTo('15Axx')
      fireEvent.click(screen.getByRole('button', { name: 'Show more' }))
      await act(async () => {})
      expect(screen.getByText('No course yet.')).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Make a course here' })).toBeNull()
      await goTo('15Axx/courses')
      expect(screen.queryByRole('button', { name: 'New course' })).toBeNull()
      cleanup()
      window.location.hash = ''
    }
  })
})
