import { useId, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import {
  clipSegment,
  defaultEtaRange,
  defaultHalf,
  descend,
  descend1D,
  eigen,
  finite,
  gradient,
  levelEllipse,
  levels,
  minimiser,
  symmetric,
  value,
  verdict,
} from './descent-path-math.ts'
import type { Mat2, Vec2, View } from './descent-path-math.ts'
import { fmt, pointerIn, scale } from './svg.ts'

export interface DescentPathParams {
  H: Mat2
  g?: Vec2
  c?: number
  view?: number
  start?: Vec2
  eta?: number
  etaRange?: [number, number]
  maxSteps?: number
  showGradient?: boolean
  stepByStep?: boolean
  revealLimit?: boolean
  oneD?: boolean
}

const SIZE = 300
const PAD = 14
const W1 = 320
const H1 = 220

/** η to three places: 0.125, 0.400. */
const eta3 = (eta: number) => fmt(eta, 3)

const STATUS: Record<string, string> = {
  still: 'η = 0: no step is taken.',
  converges: 'Converging: η is below the limit, so every direction shrinks.',
  edge: 'At the limit: the steep direction bounces for ever without shrinking.',
  diverges: 'Diverging: η is past the limit, so the steep direction grows every step.',
}

/**
 * Gradient descent on a quadratic bowl: level curves of f(x) = ½xᵀHx − gᵀx + c,
 * a start point to drag, and the path of iterates for the step size on the
 * slider (or one step per tap). In 1D (oneD), the parabola f = ½λx² with the
 * iterates bouncing on it. Read-outs: η, the last iterate, f there, and whether
 * the path converges (η < 2/λmax). Paths that leave the picture stop at its edge.
 */
export function DescentPath({ params }: { params: DescentPathParams }) {
  const H = useMemo(() => symmetric(params.H), [params.H])
  const g: Vec2 = params.g ?? [0, 0]
  const c = params.c ?? 0
  const oneD = !!params.oneD
  const lambda = oneD ? H[0][0] : eigen(H).values[0]
  const bottom: Vec2 = oneD ? [0, 0] : minimiser(H, g)
  const firstStart: Vec2 = params.start ?? [bottom[0] + 2, bottom[1] + 1]
  const half = params.view ?? defaultHalf(firstStart, bottom)
  const range = params.etaRange ?? defaultEtaRange(lambda)
  const maxSteps = Math.max(1, Math.min(30, Math.round(params.maxSteps ?? 12)))
  const limit = 2 / lambda

  const [start, setStart] = useState<Vec2>(firstStart)
  const [eta, setEta] = useState(params.eta ?? Math.min(range[1], limit / 2))
  const [steps, setSteps] = useState(params.stepByStep ? 0 : maxSteps)
  const [showLimit, setShowLimit] = useState(false)
  const [dragging, setDragging] = useState(false)
  const svg = useRef<SVGSVGElement>(null)
  const clip = `clip-${useId().replace(/[^A-Za-z0-9-]/g, '')}`

  const status = verdict(eta, lambda)
  const resetSteps = () => params.stepByStep && setSteps(0)

  const slider = (
    <div className="w-sliders">
      <label>
        <span>
          Step size η <output>{eta3(eta)}</output>
        </span>
        <input
          type="range"
          min={range[0]}
          max={range[1]}
          step="any"
          value={eta}
          onChange={(e) => {
            setEta(Math.round(Number(e.target.value) * 1000) / 1000)
            resetSteps()
          }}
        />
      </label>
      {showLimit && (
        <div className="w-descent-limit" aria-hidden="true">
          <span style={{ left: `${(100 * Math.min(Math.max(limit, range[0]), range[1]) - 100 * range[0]) / (range[1] - range[0])}%` }} />
        </div>
      )}
      {!params.stepByStep && (
        <label>
          <span>
            Steps shown <output>{steps}</output>
          </span>
          <input type="range" min={0} max={maxSteps} step={1} value={steps} onChange={(e) => setSteps(Number(e.target.value))} />
        </label>
      )}
    </div>
  )

  const actions = (
    <>
      {(params.stepByStep || params.revealLimit) && (
        <div className="w-actions">
          {params.stepByStep && (
            <>
              <button className="small-button" onClick={() => setSteps((k) => Math.min(maxSteps, k + 1))} disabled={steps >= maxSteps}>
                Take a step
              </button>
              <button className="small-button" onClick={() => setSteps(0)} disabled={steps === 0}>
                Start again
              </button>
            </>
          )}
          {params.revealLimit && (
            <button className="small-button" onClick={() => setShowLimit(!showLimit)} aria-pressed={showLimit}>
              {showLimit ? 'Hide the limit' : 'Show the limit'}
            </button>
          )}
        </div>
      )}
      {/* One tap at a time is for predicting a step; the verdict belongs where η is the question. */}
      {(!params.stepByStep || params.revealLimit) && (
        <p className="w-note">
          {STATUS[status]}
          {showLimit && ` The limit is 2/λ${oneD ? '' : 'max'} = ${fmt(limit, 3)}.`}
        </p>
      )}
    </>
  )

  if (oneD) {
    const top = (lambda * half * half) / 2
    const sx = scale([-half, half], [PAD, W1 - PAD])
    const sy = scale([0, top * 1.08], [H1 - PAD, PAD])
    const path = descend1D(lambda, start[0], eta, steps, half)
    const at = (x: number): Vec2 => [sx.to(x), sy.to((lambda * x * x) / 2)]
    const curve = Array.from({ length: 81 }, (_, i) => at(-half + (i * 2 * half) / 80))
    const last = path.xs[path.xs.length - 1]
    const onMove = (event: ReactPointerEvent<SVGSVGElement>) => {
      if (!dragging) return
      const p = pointerIn(event, svg.current)
      if (!p) return
      const x = Math.max(-half, Math.min(half, sx.from(p[0])))
      setStart([Math.round(x * 20) / 20, 0])
      resetSteps()
    }
    const s0 = at(path.xs[0])
    return (
      <div className="widget-body descent-path">
        <svg
          ref={svg}
          viewBox={`0 0 ${W1} ${H1}`}
          className="widget-svg"
          role="img"
          aria-label={`The parabola f = ½·${fmt(lambda, 0)}x² with ${path.xs.length - 1} steps of size ${eta3(eta)} from x = ${fmt(start[0])}`}
          onPointerMove={onMove}
          onPointerUp={() => setDragging(false)}
          onPointerCancel={() => setDragging(false)}
        >
          <line className="w-axis" x1={PAD} x2={W1 - PAD} y1={sy.to(0)} y2={sy.to(0)} />
          <line className="w-axis" x1={sx.to(0)} x2={sx.to(0)} y1={PAD} y2={H1 - PAD} />
          <polyline className="w-descent-curve" points={curve.map((p) => p.join(',')).join(' ')} />
          {path.xs.slice(1).map((x, k) => {
            const [a, b] = [at(path.xs[k]), at(x)]
            return <line key={`s${k}`} className="w-descent-step" x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />
          })}
          {path.xs.slice(1).map((x, k) => {
            const [px, py] = at(x)
            return <circle key={`p${k}`} className="w-descent-iterate" cx={px} cy={py} r={4} />
          })}
          <g
            className="w-handle"
            onPointerDown={(event) => {
              event.currentTarget.ownerSVGElement?.setPointerCapture?.(event.pointerId)
              setDragging(true)
            }}
          >
            <circle cx={s0[0]} cy={s0[1]} r={20} className="w-hit" />
            <circle cx={s0[0]} cy={s0[1]} r={8} className={dragging ? 'w-knob active' : 'w-knob'} />
          </g>
        </svg>
        {slider}
        <dl className="w-readout">
          <dt>η</dt>
          <dd>{eta3(eta)}</dd>
          <dt>{`x after ${path.xs.length - 1} step${path.xs.length - 1 === 1 ? '' : 's'}`}</dt>
          <dd>{fmt(last, 3)}</dd>
          <dt>f there</dt>
          <dd>{fmt((lambda * last * last) / 2, 3)}</dd>
        </dl>
        {path.leftAt !== null && <p className="w-note">Step {path.leftAt} left the picture.</p>}
        {actions}
      </div>
    )
  }

  const view: View = { centre: bottom, half }
  const sx = scale([bottom[0] - half, bottom[0] + half], [PAD, SIZE - PAD])
  const sy = scale([bottom[1] - half, bottom[1] + half], [SIZE - PAD, PAD])
  const at = (p: Vec2): Vec2 => [sx.to(p[0]), sy.to(p[1])]
  const unit = (SIZE - 2 * PAD) / (2 * half)
  const path = descend(H, g, start, eta, steps, view)
  const last = path.points[path.points.length - 1]
  const exit = path.outside ? clipSegment(last, path.outside, view) : null
  const ellipses = levels(H, g, c, half).flatMap((level) => {
    const e = levelEllipse(H, g, c, level)
    return e ? [e] : []
  })
  const grad = gradient(H, g, start)
  const size = Math.hypot(grad[0], grad[1])
  const arrow: [Vec2, Vec2] | null =
    params.showGradient && size > 1e-12 ? [at(start), at([start[0] - (0.4 * half * grad[0]) / size, start[1] - (0.4 * half * grad[1]) / size])] : null
  const ticks = (lo: number, hi: number) => Array.from({ length: Math.floor(hi) - Math.ceil(lo) + 1 }, (_, i) => Math.ceil(lo) + i)

  const onMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!dragging) return
    const p = pointerIn(event, svg.current)
    if (!p) return
    const clamp = (v: number, mid: number) => Math.max(mid - half, Math.min(mid + half, v))
    setStart([Math.round(clamp(sx.from(p[0]), bottom[0]) * 20) / 20, Math.round(clamp(sy.from(p[1]), bottom[1]) * 20) / 20])
    resetSteps()
  }

  return (
    <div className="widget-body descent-path">
      <svg
        ref={svg}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="widget-svg square"
        role="img"
        aria-label={`Level curves of a bowl with its bottom at (${fmt(bottom[0])}, ${fmt(bottom[1])}); ${path.points.length - 1} steps of size ${eta3(eta)} from (${fmt(start[0])}, ${fmt(start[1])})`}
        onPointerMove={onMove}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
      >
        <defs>
          <clipPath id={clip}>
            <rect x={PAD} y={PAD} width={SIZE - 2 * PAD} height={SIZE - 2 * PAD} />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clip})`}>
          {ticks(bottom[0] - half, bottom[0] + half).map((x) => (
            <line key={`gx${x}`} className={x === 0 ? 'w-axis' : 'w-grid'} x1={sx.to(x)} x2={sx.to(x)} y1={PAD} y2={SIZE - PAD} />
          ))}
          {ticks(bottom[1] - half, bottom[1] + half).map((y) => (
            <line key={`gy${y}`} className={y === 0 ? 'w-axis' : 'w-grid'} x1={PAD} x2={SIZE - PAD} y1={sy.to(y)} y2={sy.to(y)} />
          ))}
          {ellipses.map((e, i) => (
            <ellipse
              key={`e${i}`}
              className="w-level"
              cx={sx.to(e.cx)}
              cy={sy.to(e.cy)}
              rx={e.rx * unit}
              ry={e.ry * unit}
              transform={`rotate(${-e.angle} ${sx.to(e.cx)} ${sy.to(e.cy)})`}
            />
          ))}
          <circle className="w-best-point" cx={sx.to(bottom[0])} cy={sy.to(bottom[1])} r={3.5} />
          {path.points.slice(1).map((p, k) => {
            const [a, b] = [at(path.points[k]), at(p)]
            return <line key={`s${k}`} className="w-descent-step" x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />
          })}
          {exit && <line className="w-descent-step out" x1={at(exit[0])[0]} y1={at(exit[0])[1]} x2={at(exit[1])[0]} y2={at(exit[1])[1]} />}
          {path.points.slice(1).map((p, k) => {
            const [px, py] = at(p)
            return <circle key={`p${k}`} className="w-descent-iterate" cx={px} cy={py} r={3.5} />
          })}
          {arrow && (
            <g className="w-descent-arrow">
              <line x1={arrow[0][0]} y1={arrow[0][1]} x2={arrow[1][0]} y2={arrow[1][1]} />
              <circle cx={arrow[1][0]} cy={arrow[1][1]} r={3.5} />
              <text x={arrow[1][0] + 6} y={arrow[1][1] + 14}>
                −∇f
              </text>
            </g>
          )}
        </g>
        <g
          className="w-handle"
          onPointerDown={(event) => {
            event.currentTarget.ownerSVGElement?.setPointerCapture?.(event.pointerId)
            setDragging(true)
          }}
        >
          <circle cx={at(start)[0]} cy={at(start)[1]} r={20} className="w-hit" />
          <circle cx={at(start)[0]} cy={at(start)[1]} r={8} className={dragging ? 'w-knob active' : 'w-knob'} />
        </g>
      </svg>
      {slider}
      <dl className="w-readout">
        <dt>η</dt>
        <dd>{eta3(eta)}</dd>
        <dt>Start x₀</dt>
        <dd>
          ({fmt(start[0])}, {fmt(start[1])})
        </dd>
        <dt>{`x${toSub(path.points.length - 1)} after ${path.points.length - 1} step${path.points.length - 1 === 1 ? '' : 's'}`}</dt>
        <dd>{finite(last) ? `(${fmt(last[0], 3)}, ${fmt(last[1], 3)})` : '—'}</dd>
        <dt>f there</dt>
        <dd>{fmt(value(H, g, c, last), 3)}</dd>
      </dl>
      {path.leftAt !== null && <p className="w-note">Step {path.leftAt} left the picture; the path stops at its edge.</p>}
      {actions}
    </div>
  )
}

const SUBS = '₀₁₂₃₄₅₆₇₈₉'
const toSub = (n: number) => `${n}`.replace(/\d/g, (d) => SUBS[Number(d)])
