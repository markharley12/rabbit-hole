// Gradient descent on a quadratic bowl f(x) = ½ xᵀHx − gᵀx + c in the plane
// (H symmetric positive definite), and on f(x) = ½ λx² on a line. Pure; the
// picture is DescentPath.tsx. Nothing here may hand the picture NaN or
// Infinity: a diverging path is cut where it leaves the view.

export type Vec2 = [number, number]
export type Mat2 = [[number, number], [number, number]]

export const finite = (v: Vec2) => Number.isFinite(v[0]) && Number.isFinite(v[1])

/** The symmetric part of H, so a slightly unequal off-diagonal from content cannot break the eigenvalues. */
export function symmetric(H: Mat2): Mat2 {
  const b = (H[0][1] + H[1][0]) / 2
  return [
    [H[0][0], b],
    [b, H[1][1]],
  ]
}

export interface Eigen {
  /** Largest first. */
  values: [number, number]
  /** Unit eigenvectors, in the same order. */
  vectors: [Vec2, Vec2]
}

/** Eigenvalues and unit eigenvectors of a symmetric 2×2 matrix, largest first. */
export function eigen(H: Mat2): Eigen {
  const [[a, b], [, d]] = symmetric(H)
  const half = (a + d) / 2
  const r = Math.hypot((a - d) / 2, b)
  const values: [number, number] = [half + r, half - r]
  if (r < 1e-12) {
    return {
      values,
      vectors: [
        [1, 0],
        [0, 1],
      ],
    }
  }
  // The top eigenvector of [[a, b], [b, d]] is at ½·atan2(2b, a − d).
  const t = Math.atan2(2 * b, a - d) / 2
  return {
    values,
    vectors: [
      [Math.cos(t), Math.sin(t)],
      [-Math.sin(t), Math.cos(t)],
    ],
  }
}

export const isPositiveDefinite = (H: Mat2) => eigen(H).values[1] > 1e-12

export const times = (H: Mat2, v: Vec2): Vec2 => [H[0][0] * v[0] + H[0][1] * v[1], H[1][0] * v[0] + H[1][1] * v[1]]

/** ∇f(x) = Hx − g. */
export function gradient(H: Mat2, g: Vec2, x: Vec2): Vec2 {
  const hx = times(symmetric(H), x)
  return [hx[0] - g[0], hx[1] - g[1]]
}

/** f(x) = ½ xᵀHx − gᵀx + c. */
export function value(H: Mat2, g: Vec2, c: number, x: Vec2): number {
  const hx = times(symmetric(H), x)
  return (x[0] * hx[0] + x[1] * hx[1]) / 2 - (g[0] * x[0] + g[1] * x[1]) + c
}

/** The bottom of the bowl, where Hx = g. */
export function minimiser(H: Mat2, g: Vec2): Vec2 {
  const [[a, b], [, d]] = symmetric(H)
  const det = a * d - b * b
  return [(d * g[0] - b * g[1]) / det, (a * g[1] - b * g[0]) / det]
}

/** One step: x − η∇f(x). */
export function step(H: Mat2, g: Vec2, x: Vec2, eta: number): Vec2 {
  const grad = gradient(H, g, x)
  return [x[0] - eta * grad[0], x[1] - eta * grad[1]]
}

/** The view: a square of half-width `half` around a centre. */
export interface View {
  centre: Vec2
  half: number
}

export const inside = (p: Vec2, view: View) =>
  finite(p) && Math.abs(p[0] - view.centre[0]) <= view.half + 1e-9 && Math.abs(p[1] - view.centre[1]) <= view.half + 1e-9

export interface Path {
  /** x₀, x₁, …: every iterate up to the last one inside the view. All finite. */
  points: Vec2[]
  /** The step at which the path left the view (or stopped being a number); null if it stayed in. */
  leftAt: number | null
  /** The first iterate outside the view, when it is a finite number (to draw the step heading out). */
  outside: Vec2 | null
}

/** Up to `steps` iterates from `start`, stopping at the first one outside the view. */
export function descend(H: Mat2, g: Vec2, start: Vec2, eta: number, steps: number, view: View): Path {
  const points: Vec2[] = [start]
  let x = start
  for (let k = 1; k <= steps; k++) {
    const next = step(H, g, x, eta)
    if (!inside(next, view)) return { points, leftAt: k, outside: finite(next) ? next : null }
    points.push(next)
    x = next
  }
  return { points, leftAt: null, outside: null }
}

/** The 1D case f(x) = ½ λx²: x_{k+1} = (1 − ηλ) x_k. Iterates up to the last with |x| ≤ half. */
export function descend1D(lambda: number, start: number, eta: number, steps: number, half: number) {
  const xs: number[] = [start]
  let x = start
  for (let k = 1; k <= steps; k++) {
    const next = (1 - eta * lambda) * x
    if (!Number.isFinite(next) || Math.abs(next) > half + 1e-9) return { xs, leftAt: k as number | null }
    xs.push(next)
    x = next
  }
  return { xs, leftAt: null as number | null }
}

export type Verdict = 'still' | 'converges' | 'edge' | 'diverges'

/**
 * Whether gradient descent with step η converges on a bowl whose largest
 * curvature is λmax: it does exactly when 0 < η < 2/λmax (from any start
 * not already at the bottom). At η = 2/λmax it bounces for ever.
 */
export function verdict(eta: number, lambdaMax: number): Verdict {
  if (eta <= 0) return 'still'
  const limit = 2 / lambdaMax
  if (Math.abs(eta - limit) < 1e-9 * Math.max(1, limit)) return 'edge'
  return eta < limit ? 'converges' : 'diverges'
}

/** Each eigen-direction is multiplied by 1 − ηλ per step; the path's rate is the larger size. */
export function factors(eta: number, H: Mat2): [number, number] {
  const [l1, l2] = eigen(H).values
  return [1 - eta * l1, 1 - eta * l2]
}

export interface Ellipse {
  cx: number
  cy: number
  /** Semi-axis along the first (largest-eigenvalue) eigenvector, and along the second. */
  rx: number
  ry: number
  /** Angle of the first eigenvector, in degrees anticlockwise from the x-axis. */
  angle: number
}

/** The level curve f = level: an ellipse round the minimiser, narrow along the steep direction. Null below the bottom. */
export function levelEllipse(H: Mat2, g: Vec2, c: number, level: number): Ellipse | null {
  const centre = minimiser(H, g)
  const lowest = value(H, g, c, centre)
  const { values, vectors } = eigen(H)
  const rise = level - lowest
  if (!(rise > 0) || !(values[1] > 0)) return null
  const rx = Math.sqrt((2 * rise) / values[0])
  const ry = Math.sqrt((2 * rise) / values[1])
  const angle = (Math.atan2(vectors[0][1], vectors[0][0]) * 180) / Math.PI
  const e = { cx: centre[0], cy: centre[1], rx, ry, angle }
  return Object.values(e).every(Number.isFinite) ? e : null
}

/**
 * Levels to draw: the ellipses whose long semi-axis is 1/5, 2/5, … of the view's
 * half-width (and a little past it), so the picture looks alike at any scale.
 */
export function levels(H: Mat2, g: Vec2, c: number, half: number, count = 7): number[] {
  const lowest = value(H, g, c, minimiser(H, g))
  const small = eigen(H).values[1]
  return Array.from({ length: count }, (_, i) => lowest + (small * ((half * (i + 1)) / 5) ** 2) / 2)
}

/** The part of segment p→q inside the view (Liang–Barsky), or null if none. */
export function clipSegment(p: Vec2, q: Vec2, view: View): [Vec2, Vec2] | null {
  if (!finite(p) || !finite(q)) return null
  const [cx, cy] = view.centre
  const lo = [cx - view.half, cy - view.half]
  const hi = [cx + view.half, cy + view.half]
  const d: Vec2 = [q[0] - p[0], q[1] - p[1]]
  let t0 = 0
  let t1 = 1
  for (let axis = 0; axis < 2; axis++) {
    for (const [num, den] of [
      [p[axis] - lo[axis], -d[axis]],
      [hi[axis] - p[axis], d[axis]],
    ]) {
      if (Math.abs(den) < 1e-15) {
        if (num < 0) return null
        continue
      }
      const t = num / den
      if (den < 0) t0 = Math.max(t0, t)
      else t1 = Math.min(t1, t)
      if (t0 > t1) return null
    }
  }
  return [
    [p[0] + t0 * d[0], p[1] + t0 * d[1]],
    [p[0] + t1 * d[0], p[1] + t1 * d[1]],
  ]
}

/** A default slider range for η: from 0 to a little past the limit 2/λmax, to a round number. */
export function defaultEtaRange(lambdaMax: number): [number, number] {
  const top = 2.4 / lambdaMax
  const magnitude = 10 ** Math.floor(Math.log10(top))
  return [0, Math.ceil(top / (magnitude / 2)) * (magnitude / 2)]
}

/** The view's half-width when content does not set one: room for the start, rounded up. */
export function defaultHalf(start: Vec2, centre: Vec2): number {
  const reach = Math.max(Math.abs(start[0] - centre[0]), Math.abs(start[1] - centre[1]))
  return Math.max(1, Math.ceil(reach * 1.4))
}
