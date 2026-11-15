import { describe, expect, it } from 'vitest'
import { bestFit, frame, lineThrough, scores, snap } from './line-fitter-math.ts'
import type { Point } from './line-fitter-math.ts'
import { along, error, fitLine, levelOffset, minNorm, normalEquations, positionOn, project } from './dependent-columns-math.ts'
import { apply, compose, ellipse, pinvSigma, rotation, stageMap, svd2 } from './svd-geometry-math.ts'
import type { M2 } from './svd-geometry-math.ts'

// Mark's numbers (docs/seed-context.md section 3).
const POINTS: Point[] = [
  [1, 1],
  [2, 2],
  [3, 6],
]
const A2 = [
  [1, 2],
  [1, 2],
  [1, 2],
]
const B = [1, 2, 6]

describe('line fitter', () => {
  it('scores his guesses as he did', () => {
    expect(scores(POINTS, 0, 1).rr).toBeCloseTo(9)
    expect(scores(POINTS, 1, 1.5).rr).toBeCloseTo(6.5)
    expect(scores(POINTS, 1, 1).rr).toBeCloseTo(6)
  })

  it('finds his best line, where r is perpendicular to both columns', () => {
    const best = bestFit(POINTS)!
    expect(best.c).toBeCloseTo(-2)
    expect(best.m).toBeCloseTo(2.5)
    const at = scores(POINTS, best.c, best.m)
    expect(at.rr).toBeCloseTo(1.5)
    expect(at.dotOnes).toBeCloseTo(0)
    expect(at.dotX).toBeCloseTo(0)
    expect(at.r.map((e) => +e.toFixed(9))).toEqual([0.5, -1, 0.5])
  })

  it('has no unique best line when every x is the same', () => {
    expect(bestFit([
      [2, 1],
      [2, 2],
      [2, 6],
    ])).toBeNull()
  })

  it('draws lines through handles, frames the points, snaps cleanly', () => {
    expect(lineThrough([1, 0.5], [3, 5.5])).toEqual({ c: -2, m: 2.5 })
    expect(frame(POINTS)).toEqual({ xmin: 0, xmax: 4, ymin: 0, ymax: 7 })
    expect(snap(0.1 + 0.2, 0.05)).toBe(0.3)
    expect(snap(-2.04, 0.05)).toBe(-2.05)
  })
})

describe('dependent columns', () => {
  const line = fitLine(A2, B)

  it('builds his normal equations and their one line, c + 2m = 3', () => {
    expect(normalEquations(A2, B)).toEqual({
      gram: [
        [3, 6],
        [6, 12],
      ],
      rhs: [9, 18],
    })
    // 3c + 6m = 9 is c + 2m = 3.
    expect(line.n[1] / line.n[0]).toBe(2)
    expect(line.d / line.n[0]).toBe(3)
  })

  it('puts the minimum-norm point at (0.6, 1.2), ‖p‖² = 1.8', () => {
    const [c, m] = minNorm(line)
    expect(c).toBeCloseTo(0.6)
    expect(m).toBeCloseTo(1.2)
    expect(c * c + m * m).toBeCloseTo(1.8)
  })

  it('keeps ‖r‖² at 14 all along the line', () => {
    for (const t of [-3, -1, 0, 0.5, 2.7]) expect(error(A2, B, along(line, t))).toBeCloseTo(14)
    expect(error(A2, B, [1, 1])).toBeCloseTo(14)
  })

  it('projects onto the line and measures position along it', () => {
    const foot = project(line, [3, 3])
    expect(foot[0] + 2 * foot[1]).toBeCloseTo(3)
    expect(positionOn(line, along(line, 1.25))).toBeCloseTo(1.25)
  })

  it('puts each level line where the error really is that level', () => {
    const offset = levelOffset(A2, line, 3)
    const n2 = line.n[0] ** 2 + line.n[1] ** 2
    const onLevel: [number, number] = [((line.d + offset) * line.n[0]) / n2, ((line.d + offset) * line.n[1]) / n2]
    expect(error(A2, B, onLevel)).toBeCloseTo(17)
  })

  it('refuses independent columns', () => {
    expect(() =>
      fitLine(
        [
          [1, 1],
          [1, 2],
          [1, 3],
        ],
        B,
      ),
    ).toThrow('independent')
  })
})

describe('SVD geometry', () => {
  const close = (A: M2, B: M2) => A.flat().forEach((x, i) => expect(x).toBeCloseTo(B.flat()[i], 9))

  // Wrapped in objects: it.each would spread a bare matrix's rows as arguments.
  it.each<{ A: M2 }>([
    { A: [[2, 1], [1, 3]] },
    { A: [[1, 2], [3, 4]] },
    { A: [[0, -1], [2, 0]] },
    { A: [[1, 2], [2, 4]] },
    { A: [[3, 0], [0, 1]] },
  ])('rebuilds $A from its SVD, σ₁ ≥ σ₂ ≥ 0', ({ A }) => {
    const svd = svd2(A)
    expect(svd.sigma[0]).toBeGreaterThanOrEqual(svd.sigma[1])
    expect(svd.sigma[1]).toBeGreaterThanOrEqual(0)
    close(compose(svd), A)
    close(stageMap(svd, 3), A)
  })

  it('starts at the circle and passes through Vᵀ and ΣVᵀ', () => {
    const svd = { sigma: [3, 1] as [number, number], angleU: 20, angleV: 30, reflect: false }
    close(stageMap(svd, 0), rotation(0))
    close(stageMap(svd, 1), rotation(-30))
    // After Vᵀ, v₁ lies on the x-axis; after Σ it has length σ₁.
    const v1: [number, number] = [Math.cos(Math.PI / 6), Math.sin(Math.PI / 6)]
    const [x, y] = apply(stageMap(svd, 2), v1)
    expect(x).toBeCloseTo(3)
    expect(y).toBeCloseTo(0)
  })

  it('traces a closed ellipse with the right semi-axes', () => {
    const points = ellipse(compose({ sigma: [3, 1], angleU: 0, angleV: 0, reflect: false }))
    expect(points[0][0]).toBeCloseTo(points[points.length - 1][0])
    expect(Math.max(...points.map((p) => Math.hypot(...p)))).toBeCloseTo(3)
    expect(Math.min(...points.map((p) => Math.hypot(...p)))).toBeCloseTo(1, 2)
  })

  it('inverts non-zero σ and sends zero to zero', () => {
    expect(pinvSigma(4)).toBe(0.25)
    expect(pinvSigma(0)).toBe(0)
  })
})
