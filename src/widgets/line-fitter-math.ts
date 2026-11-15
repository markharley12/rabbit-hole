// Fitting y = c + mx to a few points. Pure; the picture is LineFitter.tsx.

export type Point = [number, number]

export interface Scores {
  /** Data minus fit, one per point. */
  r: number[]
  rr: number
  /** r · (1, …, 1) and r · x: both zero exactly at the best fit. */
  dotOnes: number
  dotX: number
}

export function scores(points: Point[], c: number, m: number): Scores {
  const r = points.map(([x, y]) => y - (c + m * x))
  return {
    r,
    rr: r.reduce((sum, e) => sum + e * e, 0),
    dotOnes: r.reduce((sum, e) => sum + e, 0),
    dotX: r.reduce((sum, e, i) => sum + e * points[i][0], 0),
  }
}

/** The least-squares line, or null when every x is the same (no unique best). */
export function bestFit(points: Point[]): { c: number; m: number } | null {
  const n = points.length
  let sx = 0
  let sy = 0
  let sxx = 0
  let sxy = 0
  for (const [x, y] of points) {
    sx += x
    sy += y
    sxx += x * x
    sxy += x * y
  }
  const det = n * sxx - sx * sx
  if (Math.abs(det) < 1e-12) return null
  const m = (n * sxy - sx * sy) / det
  return { c: (sy - m * sx) / n, m }
}

/** The line through two points with different x. */
export function lineThrough([x1, y1]: Point, [x2, y2]: Point): { c: number; m: number } {
  const m = (y2 - y1) / (x2 - x1)
  return { c: y1 - m * x1, m }
}

export interface Frame {
  xmin: number
  xmax: number
  ymin: number
  ymax: number
}

/** Whole-number bounds around the points, with a margin and the origin's axis lines in reach. */
export function frame(points: Point[]): Frame {
  const xs = points.map((p) => p[0])
  const ys = points.map((p) => p[1])
  return {
    xmin: Math.min(0, Math.floor(Math.min(...xs) - 1)),
    xmax: Math.ceil(Math.max(...xs) + 1),
    ymin: Math.min(0, Math.floor(Math.min(...ys) - 1)),
    ymax: Math.ceil(Math.max(...ys) + 1),
  }
}

/** To the nearest multiple of `step`, without 0.30000000000000004. */
export const snap = (value: number, step: number) => +(Math.round(value / step) * step).toFixed(6)

export const clamp = (value: number, [low, high]: [number, number]) => Math.min(high, Math.max(low, value))
