// A few points in 2D and a line through their mean: how much of their spread
// lies along the line, and how much across it. Pure; the picture is PcaScatter.tsx.

export type Point = [number, number]
export type Denominator = 'n-1' | 'n'

/** What the sums of squares are divided by: n − 1 (the sample convention) or n. */
export const divisor = (n: number, denominator: Denominator) => (denominator === 'n' ? n : n - 1)

export function mean(points: Point[]): Point {
  const n = points.length
  return [points.reduce((s, p) => s + p[0], 0) / n, points.reduce((s, p) => s + p[1], 0) / n]
}

/** Each point minus the mean. */
export function centre(points: Point[]): Point[] {
  const [mx, my] = mean(points)
  return points.map(([x, y]) => [x - mx, y - my])
}

/** The unit vector at `degrees` anticlockwise from the x-axis. */
export function direction(degrees: number): Point {
  const t = (degrees * Math.PI) / 180
  return [Math.cos(t), Math.sin(t)]
}

/** An angle for a line (not an arrow): 0 ≤ angle < 180, since θ and θ + 180 are the same line. */
export const lineAngle = (degrees: number) => ((degrees % 180) + 180) % 180

export interface Spread {
  mean: Point
  u: Point
  /** Each centred point dotted with u: its coordinate along the line. */
  scores: number[]
  /** Where each point lands on the line (its projection), in the points' own coordinates. */
  feet: Point[]
  /** Variance along u: Σ scoreᵢ² / divisor. */
  along: number
  /** Mean squared distance from the points to the line, with the same divisor. */
  across: number
  /** Total variance: Σ ‖xᵢ − mean‖² / divisor = along + across, for every line. */
  total: number
}

export function spread(points: Point[], degrees: number, denominator: Denominator = 'n-1'): Spread {
  const m = mean(points)
  const u = direction(degrees)
  const d = divisor(points.length, denominator)
  const centred = centre(points)
  const scores = centred.map(([x, y]) => x * u[0] + y * u[1])
  const feet = scores.map((s): Point => [m[0] + s * u[0], m[1] + s * u[1]])
  const sumSq = centred.reduce((s, [x, y]) => s + x * x + y * y, 0)
  const alongSum = scores.reduce((s, t) => s + t * t, 0)
  const acrossSum = centred.reduce((s, [x, y], i) => s + (x - scores[i] * u[0]) ** 2 + (y - scores[i] * u[1]) ** 2, 0)
  return { mean: m, u, scores, feet, along: alongSum / d, across: acrossSum / d, total: sumSq / d }
}

/** The covariance matrix [[a, b], [b, d]] of the centred points: XᵀX / divisor. */
export function covariance(points: Point[], denominator: Denominator = 'n-1'): [[number, number], [number, number]] {
  const d = divisor(points.length, denominator)
  const c = centre(points)
  const a = c.reduce((s, [x]) => s + x * x, 0) / d
  const b = c.reduce((s, [x, y]) => s + x * y, 0) / d
  const e = c.reduce((s, [, y]) => s + y * y, 0) / d
  return [
    [a, b],
    [b, e],
  ]
}

export interface Principal {
  /** The first principal direction as a line angle, 0 ≤ angle < 180; null when every direction ties. */
  angle: number | null
  /** The eigenvalues of the covariance matrix, largest first: the variances along v₁ and v₂. */
  lambda: [number, number]
}

/** The top eigenvector of the 2×2 covariance matrix, as an angle, and both eigenvalues. */
export function principal(points: Point[], denominator: Denominator = 'n-1'): Principal {
  const [[a, b], [, d]] = covariance(points, denominator)
  const half = (a + d) / 2
  const r = Math.hypot((a - d) / 2, b)
  const lambda: [number, number] = [half + r, half - r]
  if (r < 1e-12) return { angle: null, lambda }
  // For [[a, b], [b, d]], the top eigenvector is at ½·atan2(2b, a − d).
  const angle = lineAngle((Math.atan2(2 * b, a - d) * 90) / Math.PI)
  return { angle, lambda }
}

export interface Frame {
  xmin: number
  xmax: number
  ymin: number
  ymax: number
}

/**
 * Whole-number bounds around the points (and the origin), with a margin, made
 * square so one unit is as long across as up: angles must look like angles.
 */
export function frame(points: Point[]): Frame {
  const xs = points.map((p) => p[0])
  const ys = points.map((p) => p[1])
  let xmin = Math.min(0, Math.floor(Math.min(...xs) - 1))
  let xmax = Math.max(0, Math.ceil(Math.max(...xs) + 1))
  let ymin = Math.min(0, Math.floor(Math.min(...ys) - 1))
  let ymax = Math.max(0, Math.ceil(Math.max(...ys) + 1))
  const grow = (xmax - xmin) - (ymax - ymin)
  if (grow > 0) {
    ymin -= Math.floor(grow / 2)
    ymax += Math.ceil(grow / 2)
  } else if (grow < 0) {
    xmin -= Math.floor(-grow / 2)
    xmax += Math.ceil(-grow / 2)
  }
  return { xmin, xmax, ymin, ymax }
}

/** The two ends of the line through `at` with direction u, cut to the frame (a little past it is fine: the SVG clips). */
export function lineEnds(at: Point, u: Point, box: Frame): [Point, Point] {
  const reach = Math.hypot(box.xmax - box.xmin, box.ymax - box.ymin)
  return [
    [at[0] - reach * u[0], at[1] - reach * u[1]],
    [at[0] + reach * u[0], at[1] + reach * u[1]],
  ]
}
