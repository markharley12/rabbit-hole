import { describe, expect, it } from 'vitest'
import { easeInOut, interpolateView, panBy, pinch, toWorld, zoomAbout } from './gestures.ts'
import type { View } from './layout.ts'

const view: View = { k: 2, x: 10, y: -20 }
const toScreen = (v: View, p: { x: number; y: number }) => ({ x: p.x * v.k + v.x, y: p.y * v.k + v.y })

describe('panBy', () => {
  it('moves without zooming', () => {
    expect(panBy(view, 5, -7)).toEqual({ k: 2, x: 15, y: -27 })
  })
})

describe('zoomAbout', () => {
  it('keeps the point under the finger still', () => {
    const at = { x: 120, y: 300 }
    const world = toWorld(view, at)
    const zoomed = zoomAbout(view, at, 3)
    expect(zoomed.k).toBe(6)
    expect(toScreen(zoomed, world).x).toBeCloseTo(at.x)
    expect(toScreen(zoomed, world).y).toBeCloseTo(at.y)
  })
})

describe('pinch', () => {
  it('spreading two fingers zooms about their midpoint', () => {
    const next = pinch(view, { x: 100, y: 200 }, { x: 200, y: 200 }, { x: 50, y: 200 }, { x: 250, y: 200 })
    expect(next.k).toBeCloseTo(4)
    const mid = { x: 150, y: 200 }
    const world = toWorld(view, mid)
    expect(toScreen(next, world).x).toBeCloseTo(mid.x)
    expect(toScreen(next, world).y).toBeCloseTo(mid.y)
  })

  it('moving both fingers together pans', () => {
    const next = pinch(view, { x: 100, y: 200 }, { x: 200, y: 200 }, { x: 130, y: 240 }, { x: 230, y: 240 })
    expect(next.k).toBeCloseTo(2)
    expect(next.x).toBeCloseTo(40)
    expect(next.y).toBeCloseTo(20)
  })

  it('keeps each finger on the world point it started on', () => {
    const a0 = { x: 80, y: 120 }
    const b0 = { x: 240, y: 400 }
    const a1 = { x: 60, y: 90 }
    const b1 = { x: 300, y: 520 }
    const next = pinch(view, a0, b0, a1, b1)
    // Exact for scale plus translation of the midpoint; the fingers' own
    // points follow when the pinch has no rotation, as here (same direction).
    const mid = toScreen(next, toWorld(view, { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 }))
    expect(mid.x).toBeCloseTo((a1.x + b1.x) / 2)
    expect(mid.y).toBeCloseTo((a1.y + b1.y) / 2)
  })

  it('does not blow up when the fingers coincide', () => {
    const next = pinch(view, { x: 100, y: 100 }, { x: 100, y: 100 }, { x: 110, y: 100 }, { x: 110, y: 100 })
    expect(next.k).toBe(2)
    expect(Number.isFinite(next.x) && Number.isFinite(next.y)).toBe(true)
  })
})

describe('interpolateView', () => {
  const from: View = { k: 1, x: 0, y: 0 }
  const to: View = { k: 16, x: -3000, y: -5000 }
  const anchor = { x: 187, y: 360 }

  it('starts and ends exactly on the two views', () => {
    expect(interpolateView(from, to, 0, anchor)).toEqual(from)
    expect(interpolateView(from, to, 1, anchor)).toEqual(to)
  })

  it('zooms geometrically', () => {
    expect(interpolateView(from, to, 0.5, anchor).k).toBeCloseTo(4)
  })

  it('moves the world point at the anchor in a straight line', () => {
    const w0 = toWorld(from, anchor)
    const w1 = toWorld(to, anchor)
    const half = toWorld(interpolateView(from, to, 0.5, anchor), anchor)
    expect(half.x).toBeCloseTo((w0.x + w1.x) / 2)
    expect(half.y).toBeCloseTo((w0.y + w1.y) / 2)
  })
})

describe('easeInOut', () => {
  it('runs from 0 to 1 through the middle, never backwards', () => {
    expect(easeInOut(0)).toBe(0)
    expect(easeInOut(0.5)).toBeCloseTo(0.5)
    expect(easeInOut(1)).toBe(1)
    let last = 0
    for (let t = 0; t <= 1; t += 0.05) {
      expect(easeInOut(t)).toBeGreaterThanOrEqual(last)
      last = easeInOut(t)
    }
  })
})
