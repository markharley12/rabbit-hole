import { describe, expect, it } from 'vitest'
import { centre, covariance, direction, divisor, frame, lineAngle, mean, principal, spread } from './pca-scatter-math.ts'
import type { Point } from './pca-scatter-math.ts'

// The PCA course's data set (content/maths/courses/principal-components-from-the-svd/).
const POINTS: Point[] = [
  [0, 2],
  [3, 0],
  [5, 0],
  [5, 4],
  [7, 4],
]
const V1_ANGLE = (Math.atan2(1, 2) * 180) / Math.PI // (2, 1)/√5, about 26.57°

describe('PCA scatter', () => {
  it('centres the points on their mean', () => {
    expect(mean(POINTS)).toEqual([4, 2])
    expect(centre(POINTS)).toEqual([
      [-4, 0],
      [-1, -2],
      [1, -2],
      [1, 2],
      [3, 2],
    ])
  })

  it('scores the course’s guessed directions as the lessons do', () => {
    expect(spread(POINTS, 0).along).toBeCloseTo(7)
    expect(spread(POINTS, 90).along).toBeCloseTo(4)
    expect(spread(POINTS, 45).along).toBeCloseTo(7.5)
    expect(spread(POINTS, 135).along).toBeCloseTo(3.5)
    expect(spread(POINTS, V1_ANGLE).along).toBeCloseTo(8)
  })

  it('puts along + across at the total variance for every line, and the perpendicular variance equals across', () => {
    for (const angle of [0, 13, 45, 90, 121, 179]) {
      const s = spread(POINTS, angle)
      expect(s.total).toBeCloseTo(11)
      expect(s.along + s.across).toBeCloseTo(11)
      expect(spread(POINTS, angle + 90).along).toBeCloseTo(s.across)
    }
  })

  it('drops each point onto its foot at a right angle', () => {
    const s = spread(POINTS, 30)
    POINTS.forEach((p, i) => {
      const drop = [p[0] - s.feet[i][0], p[1] - s.feet[i][1]]
      expect(drop[0] * s.u[0] + drop[1] * s.u[1]).toBeCloseTo(0)
    })
    // The scores along v₁ are (−8, −4, 0, 4, 8)/√5.
    expect(spread(POINTS, V1_ANGLE).scores.map((x) => x * Math.sqrt(5))).toEqual([-8, -4, 0, 4, 8].map((x) => expect.closeTo(x)))
  })

  it('builds the covariance matrix with n − 1, or n when asked', () => {
    expect(covariance(POINTS)).toEqual([
      [7, 2],
      [2, 4],
    ])
    const byN = covariance(POINTS, 'n')
    expect(byN[0][0]).toBeCloseTo(28 / 5)
    expect(byN[0][1]).toBeCloseTo(8 / 5)
    expect(divisor(5, 'n-1')).toBe(4)
    expect(spread(POINTS, 0, 'n').along).toBeCloseTo(28 / 5)
  })

  it('finds the principal direction (2, 1)/√5 with eigenvalues 8 and 3', () => {
    const p = principal(POINTS)
    expect(p.angle).toBeCloseTo(V1_ANGLE)
    expect(p.lambda[0]).toBeCloseTo(8)
    expect(p.lambda[1]).toBeCloseTo(3)
    // No direction beats it.
    for (let angle = 0; angle < 180; angle += 1) expect(spread(POINTS, angle).along).toBeLessThanOrEqual(8 + 1e-9)
  })

  it('finds a direction with a negative covariance, and none when every direction ties', () => {
    const mirrored: Point[] = POINTS.map(([x, y]) => [x, -y])
    expect(principal(mirrored).angle).toBeCloseTo(180 - V1_ANGLE)
    const square: Point[] = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]
    expect(principal(square).angle).toBeNull()
  })

  it('keeps line angles in [0, 180) and makes unit directions', () => {
    expect(lineAngle(200)).toBe(20)
    expect(lineAngle(-30)).toBe(150)
    expect(lineAngle(180)).toBe(0)
    const [x, y] = direction(37)
    expect(Math.hypot(x, y)).toBeCloseTo(1)
  })

  it('frames the points squarely, with the origin in view', () => {
    const box = frame(POINTS)
    expect(box.xmax - box.xmin).toBe(box.ymax - box.ymin)
    expect(box.xmin).toBeLessThanOrEqual(0)
    expect(box.ymin).toBeLessThanOrEqual(0)
    expect(box.xmax).toBeGreaterThanOrEqual(8)
    const centred = frame(centre(POINTS))
    expect(centred.xmax - centred.xmin).toBe(centred.ymax - centred.ymin)
    expect(centred.xmin).toBeLessThanOrEqual(-5)
  })
})
