// A 2×2 matrix as rotate, stretch, rotate: A = U Σ Vᵀ. Pure; the picture is
// SvdGeometry.tsx. Angles are in degrees, as the sliders show them.

export type M2 = [[number, number], [number, number]]
export type V2 = [number, number]

const rad = (deg: number) => (deg * Math.PI) / 180

export const rotation = (deg: number): M2 => {
  const [c, s] = [Math.cos(rad(deg)), Math.sin(rad(deg))]
  return [
    [c, -s],
    [s, c],
  ]
}

export const multiply = (A: M2, B: M2): M2 => [
  [A[0][0] * B[0][0] + A[0][1] * B[1][0], A[0][0] * B[0][1] + A[0][1] * B[1][1]],
  [A[1][0] * B[0][0] + A[1][1] * B[1][0], A[1][0] * B[0][1] + A[1][1] * B[1][1]],
]

export const apply = (A: M2, [x, y]: V2): V2 => [A[0][0] * x + A[0][1] * y, A[1][0] * x + A[1][1] * y]

export const transpose = (A: M2): M2 => [
  [A[0][0], A[1][0]],
  [A[0][1], A[1][1]],
]

const diag = (a: number, b: number): M2 => [
  [a, 0],
  [0, b],
]

/** The pieces of an SVD in the widget's terms. `reflect` puts a mirror in U when det A < 0. */
export interface Svd {
  sigma: V2
  angleU: number
  angleV: number
  reflect: boolean
}

export const U = ({ angleU, reflect }: Svd): M2 => (reflect ? multiply(rotation(angleU), diag(1, -1)) : rotation(angleU))
export const V = ({ angleV }: Svd): M2 => rotation(angleV)

export const compose = (svd: Svd): M2 => multiply(U(svd), multiply(diag(svd.sigma[0], svd.sigma[1]), transpose(V(svd))))

const degrees = (x: number, y: number) => (Math.atan2(y, x) * 180) / Math.PI

/** The SVD of a 2×2 matrix, from the eigenvectors of AᵀA. */
export function svd2(A: M2): Svd {
  const G = multiply(transpose(A), A)
  const [p, q, r] = [G[0][0], G[0][1], G[1][1]]
  const mean = (p + r) / 2
  const spread = Math.hypot((p - r) / 2, q)
  const [l1, l2] = [mean + spread, Math.max(0, mean - spread)]
  // v₁: the eigenvector for l1. (q, l1 - p) unless that is zero, then an axis.
  let v1: V2 = Math.abs(q) > 1e-12 ? [q, l1 - p] : p >= r ? [1, 0] : [0, 1]
  const length = Math.hypot(...v1)
  v1 = [v1[0] / length, v1[1] / length]
  const angleV = degrees(...v1)
  const s1 = Math.sqrt(l1)
  const s2 = Math.sqrt(l2)
  const u1 = s1 > 1e-12 ? apply(A, v1).map((x) => x / s1) : [1, 0]
  const det = A[0][0] * A[1][1] - A[0][1] * A[1][0]
  return { sigma: [s1, s2], angleU: degrees(u1[0], u1[1]), angleV, reflect: det < -1e-12 }
}

/**
 * The map at a point t in [0, 3] of the story: 0 the identity, 1 Vᵀ, 2 ΣVᵀ,
 * 3 UΣVᵀ = A. In between, each piece is partway done (a part rotation, a part
 * stretch), so a slider can move smoothly through it.
 */
export function stageMap(svd: Svd, t: number): M2 {
  const part = (k: number) => Math.min(1, Math.max(0, t - k))
  const vt = rotation(-svd.angleV * part(0))
  const f = part(1)
  const stretch = diag(1 + (svd.sigma[0] - 1) * f, 1 + (svd.sigma[1] - 1) * f)
  const g = part(2)
  // The mirror, when there is one, flips in at the end of the last stage.
  const u = multiply(rotation(svd.angleU * g), svd.reflect && g >= 1 ? diag(1, -1) : diag(1, 1))
  return multiply(u, multiply(stretch, vt))
}

/** Points of the image of the unit circle under M. */
export function ellipse(M: M2, count = 96): V2[] {
  return Array.from({ length: count + 1 }, (_, i) => apply(M, [Math.cos((2 * Math.PI * i) / count), Math.sin((2 * Math.PI * i) / count)]))
}

/** σ⁺: 1/σ where σ is non-zero, 0 where it is zero. The pseudo-inverse's rule. */
export const pinvSigma = (sigma: number, tolerance = 1e-9) => (sigma > tolerance ? 1 / sigma : 0)
