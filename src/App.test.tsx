import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import App from './App.tsx'
import { layoutMap } from './map/layout.ts'
import type { MapDocument } from './map/types.ts'

// The real map, as the app ships it.
const MAP = JSON.parse(readFileSync('public/content/maths/map.json', 'utf8')) as MapDocument

const serveMap = (response: Partial<Response> = { ok: true, json: async () => MAP }) =>
  vi.stubGlobal('fetch', vi.fn(async () => response))

const goTo = async (id: string) => {
  await act(async () => {
    window.location.hash = id
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  })
}

beforeEach(() => {
  window.location.hash = ''
  localStorage.clear()
  // jsdom has no layout engine and no animation clock worth waiting on.
  vi.stubGlobal('requestAnimationFrame', () => 0)
  vi.stubGlobal('cancelAnimationFrame', () => {})
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('App', () => {
  it('opens on the whole of mathematics, honestly without a course', async () => {
    serveMap()
    render(<App />)
    expect(await screen.findByRole('heading', { level: 1, name: 'Mathematics' })).toBeTruthy()
    expect(screen.getByText('5 branches · 4,810 topics')).toBeTruthy()
    expect(screen.getByText('No course yet')).toBeTruthy()
    // No button that pretends to generate one.
    expect(screen.queryByRole('button', { name: /generate/i })).toBeNull()
    // One circle per node of the map, plus the focus ring.
    expect(document.querySelectorAll('circle.node')).toHaveLength(MAP.totals.nodes)
  })

  it('shows a section with its code, topics, ancestry and source link', async () => {
    serveMap()
    render(<App />)
    await screen.findByRole('heading', { level: 1, name: 'Mathematics' })
    await goTo('15Axx')

    expect(screen.getByRole('heading', { level: 1, name: 'Basic linear algebra' })).toBeTruthy()
    expect(screen.getByText('Section · MSC 15A')).toBeTruthy()
    expect(screen.getByText('32 topics')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Show more' }))
    expect(screen.getByText('Eigenvalues, singular values, and eigenvectors')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'MSC 15A on zbMATH Open' }).getAttribute('href')).toBe('https://zbmath.org/classification/?q=cc:15A')

    const trail = within(screen.getByRole('navigation', { name: 'Where you are' }))
    expect(trail.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Mathematics',
      'Algebra and number theory',
      'Rings, fields and algebras',
      'Linear and multilinear algebra; matrix theory',
      'Basic linear algebra',
    ])
  })

  it('walks down through the sheet and back up through the trail and home', async () => {
    serveMap()
    render(<App />)
    await screen.findByRole('heading', { level: 1, name: 'Mathematics' })

    fireEvent.click(screen.getByRole('button', { name: 'Show more' }))
    fireEvent.click(screen.getByRole('button', { name: /^Analysis/ }))
    await goTo(window.location.hash.slice(1))
    expect(window.location.hash).toBe('#analysis')
    expect(screen.getByRole('heading', { level: 1, name: 'Analysis' })).toBeTruthy()
    // Choosing something closes the sheet so the map shows again.
    expect(screen.getByRole('button', { name: 'Show more' })).toBeTruthy()

    await goTo('28-XX')
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Where you are' })).getByRole('button', { name: 'Analysis' }))
    expect(window.location.hash).toBe('#analysis')

    fireEvent.click(screen.getByRole('button', { name: 'Home: the whole map' }))
    expect(window.location.hash).toBe('#mathematics')
  })

  it('selects the circle that is tapped, and ignores a drag', async () => {
    serveMap()
    render(<App />)
    await screen.findByRole('heading', { level: 1, name: 'Mathematics' })
    const map = document.querySelector('svg.map')!

    // Where the map draws a branch on the home view, from the same geometry.
    const transform = map.querySelector('g')!.getAttribute('transform')!
    const [x, y, k] = transform.match(/-?[\d.]+(e-?\d+)?/g)!.map(Number)
    const branch = layoutMap(MAP.root).byId.get('analysis')!
    const at = { clientX: branch.x * k + x, clientY: branch.y * k + y, pointerId: 1 }

    fireEvent.pointerDown(map, at)
    fireEvent.pointerMove(map, { ...at, clientX: at.clientX + 60 })
    fireEvent.pointerUp(map, { ...at, clientX: at.clientX + 60 })
    expect(window.location.hash).toBe('')

    fireEvent.pointerDown(map, at)
    fireEvent.pointerUp(map, at)
    expect(window.location.hash).toBe('#analysis')
  })

  it('treats an unknown address as the whole map', async () => {
    serveMap()
    window.location.hash = 'no-such-node'
    render(<App />)
    expect(await screen.findByRole('heading', { level: 1, name: 'Mathematics' })).toBeTruthy()
  })

  it('credits MSC2020 and its licence on the home sheet', async () => {
    serveMap()
    render(<App />)
    await screen.findByRole('heading', { level: 1, name: 'Mathematics' })
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }))
    expect(screen.getByRole('link', { name: 'CC BY-NC-SA 4.0' }).getAttribute('href')).toBe('https://creativecommons.org/licenses/by-nc-sa/4.0/')
    expect(screen.getByRole('link', { name: /MSC2020/ })).toBeTruthy()
  })

  it('switches theme and remembers it', async () => {
    serveMap()
    render(<App />)
    await screen.findByRole('heading', { level: 1, name: 'Mathematics' })
    expect(document.documentElement.dataset.theme).toBe('light')
    fireEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }))
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem('rabbit-hole:theme')).toBe('dark')
  })

  it('says so when the map cannot be loaded', async () => {
    serveMap({ ok: false, status: 404, statusText: 'Not Found' })
    render(<App />)
    expect((await screen.findByRole('alert')).textContent).toContain('404 Not Found')
  })
})
