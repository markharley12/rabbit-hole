// The scratch pad's data, with no canvas in sight so it can be tested: strokes
// in page coordinates, undo and redo, the view (pan and zoom) and what is kept
// on the device. Pinch and pan arithmetic is the map's (src/map/gestures.ts).

import type { View } from '../map/layout.ts'
import { toWorld } from '../map/gestures.ts'
import type { Point } from '../map/gestures.ts'

export type { Point, View }

/** Ink colours are names, not values: the canvas looks them up in the theme when drawing. */
export type Ink = 'ink' | 'a' | 'b'
export const INKS: readonly Ink[] = ['ink', 'a', 'b']

export interface Stroke {
  ink: Ink
  points: Point[]
}

export interface Pad {
  strokes: Stroke[]
  /** Earlier states of `strokes`, oldest first. */
  past: Stroke[][]
  /** States undone, most recently undone last. */
  future: Stroke[][]
}

export const emptyPad = (strokes: Stroke[] = []): Pad => ({ strokes, past: [], future: [] })

/** How many steps of undo are kept. */
export const UNDO_DEPTH = 100

const commit = (pad: Pad, strokes: Stroke[]): Pad => ({
  strokes,
  past: [...pad.past, pad.strokes].slice(-UNDO_DEPTH),
  future: [],
})

/** A stroke needs a point to show; a single tap is a dot. */
export function addStroke(pad: Pad, stroke: Stroke): Pad {
  if (stroke.points.length === 0) return pad
  return commit(pad, [...pad.strokes, stroke])
}

/** Distance from `p` to the segment a-b. */
export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length2 = dx * dx + dy * dy
  const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

export const touches = (stroke: Stroke, at: Point, radius: number): boolean => {
  const pts = stroke.points
  if (pts.length === 1) return Math.hypot(at.x - pts[0].x, at.y - pts[0].y) <= radius
  return pts.some((pt, i) => i > 0 && distanceToSegment(at, pts[i - 1], pt) <= radius)
}

/**
 * Remove every stroke within `radius` of `at`. One drag of the eraser is one
 * undo step: pass `merge` once that drag has already erased something, and the
 * change joins the step already on the stack instead of starting another.
 */
export function eraseAt(pad: Pad, at: Point, radius: number, merge = false): Pad {
  const kept = pad.strokes.filter((stroke) => !touches(stroke, at, radius))
  if (kept.length === pad.strokes.length) return pad
  return merge ? { ...pad, strokes: kept, future: [] } : commit(pad, kept)
}

export const clearPad = (pad: Pad): Pad => (pad.strokes.length ? commit(pad, []) : pad)

export const canUndo = (pad: Pad) => pad.past.length > 0
export const canRedo = (pad: Pad) => pad.future.length > 0

export function undo(pad: Pad): Pad {
  if (!canUndo(pad)) return pad
  return { strokes: pad.past[pad.past.length - 1], past: pad.past.slice(0, -1), future: [...pad.future, pad.strokes] }
}

export function redo(pad: Pad): Pad {
  if (!canRedo(pad)) return pad
  return { strokes: pad.future[pad.future.length - 1], past: [...pad.past, pad.strokes], future: pad.future.slice(0, -1) }
}

// ---------- the view: page coordinates <-> screen ----------

export const HOME: View = { k: 1, x: 0, y: 0 }
export const MIN_ZOOM = 0.25
export const MAX_ZOOM = 8

/** Keep a gesture from zooming the page to a dot or to a pixel; the point `at` stays put. */
export function clampView(view: View, at: Point = { x: 0, y: 0 }): View {
  const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.k))
  if (k === view.k) return view
  const factor = k / view.k
  return { k, x: at.x - (at.x - view.x) * factor, y: at.y - (at.y - view.y) * factor }
}

export const toPage = toWorld
export const toScreen = (view: View, page: Point): Point => ({ x: page.x * view.k + view.x, y: page.y * view.k + view.y })

// ---------- what is kept on the device ----------

const VERSION = 1
/** Oldest strokes go first beyond either cap, so localStorage cannot fill up. */
export const MAX_STROKES = 400
export const MAX_POINTS = 20000
/** A stored value longer than this is not read at all. */
export const MAX_CHARS = 600_000

const round1 = (n: number) => Math.round(n * 10) / 10

/** Newest strokes that fit the caps, oldest dropped. */
export function capStrokes(strokes: Stroke[]): Stroke[] {
  let points = 0
  let from = strokes.length
  while (from > 0 && strokes.length - from < MAX_STROKES && points + strokes[from - 1].points.length <= MAX_POINTS) {
    from -= 1
    points += strokes[from].points.length
  }
  return strokes.slice(from)
}

export function serialise(strokes: Stroke[]): string {
  const kept = capStrokes(strokes).map((s) => ({ c: s.ink, p: s.points.flatMap((pt) => [round1(pt.x), round1(pt.y)]) }))
  return JSON.stringify({ v: VERSION, strokes: kept })
}

/** The strokes in a stored value, or none for anything corrupt, oversized or from another version. */
export function parse(text: string | null | undefined): Stroke[] {
  if (!text || text.length > MAX_CHARS) return []
  try {
    const data = JSON.parse(text) as { v?: unknown; strokes?: unknown }
    if (data?.v !== VERSION || !Array.isArray(data.strokes)) return []
    const strokes: Stroke[] = []
    for (const raw of data.strokes as { c?: unknown; p?: unknown }[]) {
      if (!raw || !Array.isArray(raw.p) || raw.p.length < 2 || raw.p.length % 2 !== 0) return []
      if (!raw.p.every((n) => typeof n === 'number' && Number.isFinite(n))) return []
      const ink = INKS.includes(raw.c as Ink) ? (raw.c as Ink) : 'ink'
      const points: Point[] = []
      for (let i = 0; i < raw.p.length; i += 2) points.push({ x: raw.p[i] as number, y: raw.p[i + 1] as number })
      strokes.push({ ink, points })
    }
    return capStrokes(strokes)
  } catch {
    return []
  }
}

// Prefixed: localStorage is shared by everything on an origin (a TreeQuiz trap).
export const storageKey = (courseId: string, lessonId: string) => `rabbit-hole:scratch:${courseId}:${lessonId}`

export function load(courseId: string, lessonId: string): Stroke[] {
  try {
    return parse(localStorage.getItem(storageKey(courseId, lessonId)))
  } catch {
    return []
  }
}

export function save(courseId: string, lessonId: string, strokes: Stroke[]) {
  try {
    const key = storageKey(courseId, lessonId)
    if (strokes.length) localStorage.setItem(key, serialise(strokes))
    else localStorage.removeItem(key)
  } catch {
    // Not kept, but the pad still works for this visit.
  }
}
