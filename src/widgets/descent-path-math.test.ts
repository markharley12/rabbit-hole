import { describe, expect, it } from 'vitest'
import {
  clipSegment,
  defaultEtaRange,
  descend,
  descend1D,
  eigen,
  factors,
  gradient,
  inside,
  isPositiveDefinite,
  levelEllipse,
  levels,
  minimiser,
  step,
  value,
  verdict,
} from './descent-path-math.ts'
import type { Mat2, Vec2 } from './descent-path-math.ts'

// The gradient-descent course's bowls (content/maths/courses/gradient-descent-on-a-bowl/).
const BOWL: Mat2 = [
  [2, 0],
  [0, 4],
] // f = x² + 2y²
const ROTATED: Mat2 = [
  [5, 3],
  [3, 5],
] // eigenvalues 8 and 2
const ATA: Mat2 = [
  [2, 1],
  [1, 2],
] // AᵀA for A = [[1, 0], [1, 1], [0, 1]]
const ATB: Vec2 = [3, 3] // Aᵀb for b = (2, 1, 2)

const close = (v: Vec2) => v.map((x) => expect.closeTo(x, 9))

describe('descent path maths', () => {
  it('finds eigenvalues and unit eigenvectors of a symmetric 2×2, largest first', () => {
    const e = eigen(ROTATED)
    expect(e.values[0]).toBeCloseTo(8)
    expect(e.values[1]).toBeCloseTo(2)
    for (const [i, v] of e.vectors.entries()) {
      expect(Math.hypot(...v)).toBeCloseTo(1)
      const hv = [5 * v[0] + 3 * v[1], 3 * v[0] + 5 * v[1]]
      expect(hv).toEqual(close([e.values[i] * v[0], e.values[i] * v[1]]))
    }
    expect(eigen(BOWL).values).toEqual([4, 2])
    expect(isPositiveDefinite(ATA)).toBe(true)
    expect(
      isPositiveDefinite([
        [1, 2],
        [2, 1],
      ]),
    ).toBe(false)
  })

  it('takes the course’s steps on x² + 2y² from (2, 1) with η = 1/8', () => {
    expect(gradient(BOWL, [0, 0], [2, 1])).toEqual([4, 4])
    const x1 = step(BOWL, [0, 0], [2, 1], 1 / 8)
    expect(x1).toEqual(close([3 / 2, 1 / 2]))
    expect(step(BOWL, [0, 0], x1, 1 / 8)).toEqual(close([9 / 8, 1 / 4]))
    expect(value(BOWL, [0, 0], 0, [2, 1])).toBe(6)
    expect(value(BOWL, [0, 0], 0, x1)).toBeCloseTo(11 / 4)
  })

  it('runs least squares as a bowl: H = AᵀA, g = Aᵀb, c = ½‖b‖²', () => {
    expect(minimiser(ATA, ATB)).toEqual(close([1, 1]))
    expect(value(ATA, ATB, 9 / 2, [1, 0])).toBeCloseTo(5 / 2)
    expect(value(ATA, ATB, 9 / 2, [1, 1])).toBeCloseTo(3 / 2)
    const path = descend(ATA, ATB, [1, 0], 1 / 4, 2, { centre: [1, 1], half: 2 })
    expect(path.points).toEqual([[1, 0], close([5 / 4, 1 / 2]), close([5 / 4, 11 / 16])])
    expect(path.leftAt).toBeNull()
  })

  it('lands the rotated bowl’s steep part in one step at η = 1/8', () => {
    const path = descend(ROTATED, [0, 0], [1, 0], 1 / 8, 2, { centre: [0, 0], half: 2 })
    expect(path.points[1]).toEqual(close([3 / 8, -3 / 8]))
    expect(path.points[2]).toEqual(close([9 / 32, -9 / 32]))
    expect(factors(1 / 8, ROTATED)).toEqual(close([0, 3 / 4]))
  })

  it('says converge exactly when 0 < η < 2/λmax', () => {
    expect(verdict(0, 4)).toBe('still')
    expect(verdict(0.49, 4)).toBe('converges')
    expect(verdict(0.5, 4)).toBe('edge')
    expect(verdict(0.51, 4)).toBe('diverges')
    expect(verdict(1 / 5, 10)).toBe('edge')
  })

  it('bounces the 1D iterates by the factor 1 − ηλ', () => {
    expect(descend1D(4, 1, 1 / 8, 3, 2).xs).toEqual([1, 1 / 2, 1 / 4, 1 / 8])
    expect(descend1D(4, 1, 3 / 8, 2, 2).xs).toEqual([1, -1 / 2, 1 / 4])
    expect(descend1D(4, 1, 1 / 2, 4, 2)).toEqual({ xs: [1, -1, 1, -1, 1], leftAt: null })
    expect(descend1D(4, 1, 3 / 4, 5, 2)).toEqual({ xs: [1, -2], leftAt: 2 })
  })

  it('stops a diverging path at the edge of the view, with no NaN or Infinity anywhere', () => {
    const view = { centre: [0, 0] as Vec2, half: 3 }
    for (const eta of [0.6, 1, 10, 1e6, 1e300]) {
      const path = descend(ROTATED, [0, 0], [2, 1], eta, 30, view)
      expect(path.leftAt).not.toBeNull()
      for (const p of path.points) {
        expect(p.every(Number.isFinite)).toBe(true)
        expect(inside(p, view)).toBe(true)
      }
      if (path.outside) {
        const seg = clipSegment(path.points[path.points.length - 1], path.outside, view)
        expect(seg).not.toBeNull()
        for (const q of seg!) {
          expect(q.every(Number.isFinite)).toBe(true)
          expect(inside(q, view)).toBe(true)
        }
      }
    }
    // An iterate that overflows to Infinity is not drawn at all.
    const huge = descend(ROTATED, [0, 0], [2, 1], 1e308, 30, view)
    expect(huge.outside === null || huge.outside.every(Number.isFinite)).toBe(true)
    for (const eta of [1, 1e200]) {
      const one = descend1D(4, 1, eta, 30, 2)
      expect(one.xs.every(Number.isFinite)).toBe(true)
      expect(one.leftAt).not.toBeNull()
    }
  })

  it('clips a segment to the view, or drops it when it misses', () => {
    const view = { centre: [0, 0] as Vec2, half: 1 }
    expect(clipSegment([0, 0], [3, 0], view)).toEqual([
      [0, 0],
      [1, 0],
    ])
    expect(clipSegment([2, 2], [3, 3], view)).toBeNull()
    expect(clipSegment([0, 0], [Infinity, 0], view)).toBeNull()
    expect(clipSegment([0, 0], [NaN, 0], view)).toBeNull()
  })

  it('draws level curves as ellipses round the bottom, narrow along the steep eigenvector', () => {
    const e = levelEllipse(BOWL, [0, 0], 0, 4)!
    // x² + 2y² = 4: semi-axes 2 along x and √2 along y; the steep direction (λ = 4) is y.
    expect(e.rx).toBeCloseTo(Math.SQRT2)
    expect(e.ry).toBeCloseTo(2)
    expect(Math.abs(e.angle)).toBeCloseTo(90)
    expect(levelEllipse(BOWL, [0, 0], 0, -1)).toBeNull()
    const shifted = levelEllipse(ATA, ATB, 9 / 2, 5 / 2)!
    expect([shifted.cx, shifted.cy]).toEqual(close([1, 1]))
    // The start (1, 0) lies on the level f = 5/2.
    expect(value(ATA, ATB, 9 / 2, [1, 0])).toBeCloseTo(5 / 2)
    for (const level of levels(ROTATED, [0, 0], 0, 3)) {
      const l = levelEllipse(ROTATED, [0, 0], 0, level)!
      expect(Object.values(l).every(Number.isFinite)).toBe(true)
    }
  })

  it('picks an η slider range a little past the limit', () => {
    for (const lambda of [3, 4, 8, 10, 0.5, 250]) {
      const [lo, hi] = defaultEtaRange(lambda)
      expect(lo).toBe(0)
      expect(hi).toBeGreaterThan(2 / lambda)
      expect(hi).toBeLessThan(4 / lambda)
    }
  })
})
