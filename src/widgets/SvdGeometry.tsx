import { useMemo, useState } from 'react'
import { apply, compose, ellipse, pinvSigma, rotation, stageMap, svd2 } from './svd-geometry-math.ts'
import type { M2, Svd, V2 } from './svd-geometry-math.ts'
import { fmt } from './svg.ts'

export interface SvdGeometryParams {
  matrix?: M2
  sigma?: V2
  angleV?: number
  angleU?: number
  controls?: boolean
  truncate?: boolean
  pinv?: boolean
}

const SIZE = 280
const STAGES = ['The unit circle, with v₁ and v₂', 'Vᵀ rotates v₁ and v₂ onto the axes', 'Σ stretches them by σ₁ and σ₂', 'U rotates them onto u₁ and u₂: this ellipse is A']

/**
 * A 2×2 matrix as rotate, stretch, rotate. A slider walks the unit circle
 * through Vᵀ, Σ and U to the ellipse A makes; sliders set σ₁, σ₂ and both
 * angles; options truncate to rank 1 (error σ₂) and show the 1/σ rule.
 */
export function SvdGeometry({ params }: { params: SvdGeometryParams }) {
  const initial = useMemo<Svd>(
    () => (params.matrix ? svd2(params.matrix) : { sigma: params.sigma ?? [2, 1], angleU: params.angleU ?? 30, angleV: params.angleV ?? -20, reflect: false }),
    [params],
  )
  const [s1, setS1] = useState(initial.sigma[0])
  const [s2, setS2] = useState(initial.sigma[1])
  const [angleV, setAngleV] = useState(initial.angleV)
  const [angleU, setAngleU] = useState(initial.angleU)
  const [t, setT] = useState(3)
  const [rankOne, setRankOne] = useState(false)

  const svd: Svd = { sigma: [s1, rankOne ? 0 : s2], angleU, angleV, reflect: initial.reflect }
  const full: Svd = { ...svd, sigma: [s1, s2] }
  const map = stageMap(svd, t)
  const reach = Math.max(1.2, s1 * 1.15)
  const k = SIZE / 2 / reach
  const to = ([x, y]: V2): V2 => [SIZE / 2 + x * k, SIZE / 2 - y * k]
  const path = (points: V2[]) => points.map((q, i) => `${i ? 'L' : 'M'}${to(q)[0].toFixed(1)},${to(q)[1].toFixed(1)}`).join('')

  const v1 = apply(rotation(angleV), [1, 0])
  const v2 = apply(rotation(angleV), [0, 1])
  const arrows: [V2, string, string][] = [
    [apply(map, v1), t >= 3 ? 'σ₁u₁' : t >= 2 ? 'σ₁e₁' : t >= 1 ? 'e₁' : 'v₁', 'w-arrow one'],
    [apply(map, v2), t >= 3 ? 'σ₂u₂' : t >= 2 ? 'σ₂e₂' : t >= 1 ? 'e₂' : 'v₂', 'w-arrow two'],
  ]
  const A = compose(svd)
  const stage = Math.min(3, Math.round(t))

  return (
    <div className="widget-body svd-geometry">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="widget-svg square" role="img" aria-label={`${STAGES[stage]}. σ₁ = ${fmt(s1)}, σ₂ = ${fmt(svd.sigma[1])}`}>
        <line className="w-axis" x1={0} x2={SIZE} y1={SIZE / 2} y2={SIZE / 2} />
        <line className="w-axis" y1={0} y2={SIZE} x1={SIZE / 2} x2={SIZE / 2} />
        <path className="w-ghost" d={path(ellipse(rotation(0)))} />
        {rankOne && t >= 2 && <path className="w-ghost dashed" d={path(ellipse(stageMap(full, t)))} />}
        <path className="w-shape" d={path(ellipse(map))} />
        {arrows.map(([tip, label, className]) => (
          <g key={className} className={className}>
            <line x1={SIZE / 2} y1={SIZE / 2} x2={to(tip)[0]} y2={to(tip)[1]} />
            <circle cx={to(tip)[0]} cy={to(tip)[1]} r={3.5} />
            {/* Labels on the right half sit left of the tip, so they never run off the edge. */}
            <text x={to(tip)[0] + (to(tip)[0] > SIZE * 0.6 ? -6 : 6)} y={to(tip)[1] - 8} textAnchor={to(tip)[0] > SIZE * 0.6 ? 'end' : 'start'}>
              {label}
            </text>
          </g>
        ))}
      </svg>

      <p className="w-note stage-caption">{STAGES[stage]}</p>
      <div className="w-stages" role="group" aria-label="Stages">
        {['x', 'Vᵀx', 'ΣVᵀx', 'UΣVᵀx'].map((name, i) => (
          <button key={name} className={stage === i ? 'small-button on' : 'small-button'} aria-pressed={stage === i} onClick={() => setT(i)}>
            {name}
          </button>
        ))}
      </div>
      <div className="w-sliders">
        <label>
          <span>Walk through it</span>
          <input type="range" min={0} max={3} step={0.01} value={t} onChange={(e) => setT(Number(e.target.value))} />
        </label>
        {params.controls && (
          <>
            <label>
              <span>
                σ₁ <output>{fmt(s1)}</output>
              </span>
              <input
                type="range"
                min={0.2}
                max={3}
                step={0.05}
                value={s1}
                onChange={(e) => {
                  const value = Number(e.target.value)
                  setS1(value)
                  if (s2 > value) setS2(value)
                }}
              />
            </label>
            <label>
              <span>
                σ₂ <output>{fmt(s2)}</output>
              </span>
              <input type="range" min={0} max={s1} step={0.05} value={s2} onChange={(e) => setS2(Number(e.target.value))} />
            </label>
            <label>
              <span>
                V's angle <output>{fmt(angleV, 0)}°</output>
              </span>
              <input type="range" min={-180} max={180} step={1} value={angleV} onChange={(e) => setAngleV(Number(e.target.value))} />
            </label>
            <label>
              <span>
                U's angle <output>{fmt(angleU, 0)}°</output>
              </span>
              <input type="range" min={-180} max={180} step={1} value={angleU} onChange={(e) => setAngleU(Number(e.target.value))} />
            </label>
          </>
        )}
      </div>

      <dl className="w-readout">
        <dt>A</dt>
        <dd>
          [{fmt(A[0][0])}, {fmt(A[0][1])}; {fmt(A[1][0])}, {fmt(A[1][1])}]
        </dd>
        <dt>σ₁, σ₂</dt>
        <dd>
          {fmt(s1)}, {fmt(svd.sigma[1])}
        </dd>
        {params.pinv && (
          <>
            <dt>A⁺ stretches by</dt>
            <dd>
              {fmt(pinvSigma(s1))} along u₁, {svd.sigma[1] > 1e-9 ? `${fmt(pinvSigma(svd.sigma[1]))} along u₂` : '0 along u₂ (σ₂ = 0: 0, not 1/0)'}
            </dd>
          </>
        )}
      </dl>
      {params.truncate && (
        <label className="w-toggle">
          <input type="checkbox" checked={rankOne} onChange={(e) => setRankOne(e.target.checked)} />
          <span>Keep rank 1 only (A₁)</span>
        </label>
      )}
      {params.truncate && rankOne && <p className="w-note">The ellipse flattens to a segment. ‖A − A₁‖₂ = σ₂ = {fmt(s2)}: the part thrown away.</p>}
    </div>
  )
}
