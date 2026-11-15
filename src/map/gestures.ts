// View arithmetic for pan, pinch, wheel and animated moves. Pure functions:
// the pointer bookkeeping lives in MapView, the maths is here and tested.

import type { View } from './layout.ts'

export interface Point {
  x: number
  y: number
}

export const panBy = (view: View, dx: number, dy: number): View => ({ k: view.k, x: view.x + dx, y: view.y + dy })

/** Zoom by `factor`, keeping the world point under `at` (screen) where it is. */
export const zoomAbout = (view: View, at: Point, factor: number): View => ({
  k: view.k * factor,
  x: at.x - (at.x - view.x) * factor,
  y: at.y - (at.y - view.y) * factor,
})

/**
 * Two fingers moved from (a0, b0) to (a1, b1): scale by the change in their
 * distance and move with their midpoint, so the map stays under the fingers.
 */
export function pinch(view: View, a0: Point, b0: Point, a1: Point, b1: Point): View {
  const before = Math.hypot(a0.x - b0.x, a0.y - b0.y)
  const after = Math.hypot(a1.x - b1.x, a1.y - b1.y)
  // Fingers on the same pixel give no usable distance: pan only.
  const factor = before > 0 && after > 0 ? after / before : 1
  const mid0 = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 }
  const mid1 = { x: (a1.x + b1.x) / 2, y: (a1.y + b1.y) / 2 }
  return panBy(zoomAbout(view, mid0, factor), mid1.x - mid0.x, mid1.y - mid0.y)
}

export const toWorld = (view: View, at: Point): Point => ({ x: (at.x - view.x) / view.k, y: (at.y - view.y) / view.k })

/**
 * The view a fraction `t` (0..1) of the way from `from` to `to`. Zoom moves
 * geometrically (equal steps feel equal) and the world point at `anchor`
 * moves in a straight line, so an animated zoom does not swing sideways.
 */
export function interpolateView(from: View, to: View, t: number, anchor: Point): View {
  if (t <= 0) return from
  if (t >= 1) return to
  const k = from.k * (to.k / from.k) ** t
  const w0 = toWorld(from, anchor)
  const w1 = toWorld(to, anchor)
  const wx = w0.x + (w1.x - w0.x) * t
  const wy = w0.y + (w1.y - w0.y) * t
  return { k, x: anchor.x - wx * k, y: anchor.y - wy * k }
}

export const easeInOut = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2)
