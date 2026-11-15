// Least squares with two dependent columns: the best fits are a line in the
// (c, m) plane. Pure; the picture is DependentColumns.tsx.

export type Vec2 = [number, number]

/** The best fits: every x with n · x = d (the one independent normal equation). */
export interface FitLine {
  n: Vec2
  d: number
}

const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1]

export function normalEquations(A: number[][], b: number[]): { gram: [Vec2, Vec2]; rhs: Vec2 } {
  const col = (j: number) => A.map((row) => row[j])
  const dotN = (u: number[], v: number[]) => u.reduce((sum, x, i) => sum + x * v[i], 0)
  const [a1, a2] = [col(0), col(1)]
  return {
    gram: [
      [dotN(a1, a1), dotN(a1, a2)],
      [dotN(a2, a1), dotN(a2, a2)],
    ],
    rhs: [dotN(a1, b), dotN(a2, b)],
  }
}

/** The line of best fits, from whichever normal equation is not 0 = 0. */
export function fitLine(A: number[][], b: number[]): FitLine {
  const { gram, rhs } = normalEquations(A, b)
  const row = Math.hypot(...gram[0]) >= Math.hypot(...gram[1]) ? 0 : 1
  const n = gram[row]
  if (Math.hypot(...n) < 1e-12) throw new Error('A is zero: every x is a best fit')
  if (Math.abs(gram[0][0] * gram[1][1] - gram[0][1] * gram[1][0]) > 1e-9 * dot(n, n)) {
    throw new Error('the columns are independent: there is one best fit, not a line')
  }
  return { n, d: rhs[row] }
}

/** The best fit nearest the origin: d n / |n|². */
export function minNorm({ n, d }: FitLine): Vec2 {
  const k = d / dot(n, n)
  return [k * n[0], k * n[1]]
}

/** A unit vector along the line. */
export function direction({ n }: FitLine): Vec2 {
  const length = Math.hypot(...n)
  return [-n[1] / length, n[0] / length]
}

/** The point at signed distance t along the line from the minimum-norm point. */
export function along(line: FitLine, t: number): Vec2 {
  const [p, u] = [minNorm(line), direction(line)]
  return [p[0] + t * u[0], p[1] + t * u[1]]
}

/** Where p's foot on the line sits, as a distance from the minimum-norm point. */
export function positionOn(line: FitLine, p: Vec2): number {
  const [q, u] = [minNorm(line), direction(line)]
  return dot([p[0] - q[0], p[1] - q[1]], u)
}

export function project(line: FitLine, p: Vec2): Vec2 {
  return along(line, positionOn(line, p))
}

export function error(A: number[][], b: number[], [c, m]: Vec2): number {
  return A.reduce((sum, [a1, a2], i) => sum + (b[i] - (a1 * c + a2 * m)) ** 2, 0)
}

/**
 * Error level lines: where ‖r‖² = least + extra, at distance √(extra / ‖Aν‖²)
 * either side of the best-fit line along its unit normal ν. Returned as
 * offsets of d, so each level is two lines n · x = d ± offset.
 */
export function levelOffset(A: number[][], line: FitLine, extra: number): number {
  const length = Math.hypot(...line.n)
  const nu: Vec2 = [line.n[0] / length, line.n[1] / length]
  const stretch = A.reduce((sum, [a1, a2]) => sum + (a1 * nu[0] + a2 * nu[1]) ** 2, 0)
  return Math.sqrt(extra / stretch) * length
}
