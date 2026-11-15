import { useId, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { along, direction, error, fitLine, levelOffset, minNorm, positionOn, project } from './dependent-columns-math.ts'
import type { FitLine, Vec2 } from './dependent-columns-math.ts'
import { fmt, pointerIn, scale } from './svg.ts'

export interface DependentColumnsParams {
  A: number[][]
  b: number[]
  mode?: 'line' | 'free'
  start?: Vec2
  circle?: boolean
  levels?: boolean
  revealMinNorm?: boolean
}

const W = 320
const H = 240
const PAD = 18
/** How far along the line (either side of the minimum-norm point) the slider reaches. */
const REACH = 3.5

/** View bounds holding the origin, the start, the minimum-norm point and a stretch of the line, at the picture's aspect. */
function view(line: FitLine, start: Vec2) {
  const pts: Vec2[] = [[0, 0], start, minNorm(line), along(line, -2.5), along(line, 2.5)]
  let [x0, x1] = [Math.min(...pts.map((p) => p[0])) - 0.8, Math.max(...pts.map((p) => p[0])) + 0.8]
  let [y0, y1] = [Math.min(...pts.map((p) => p[1])) - 0.8, Math.max(...pts.map((p) => p[1])) + 0.8]
  const aspect = (W - 2 * PAD) / (H - 2 * PAD)
  if ((x1 - x0) / (y1 - y0) < aspect) {
    const grow = ((y1 - y0) * aspect - (x1 - x0)) / 2
    x0 -= grow
    x1 += grow
  } else {
    const grow = ((x1 - x0) / aspect - (y1 - y0)) / 2
    y0 -= grow
    y1 += grow
  }
  return { x0, x1, y0, y1 }
}

/** Two far points of the line n·x = d, to draw it edge to edge. */
function ends(line: FitLine, d: number): [Vec2, Vec2] {
  const shifted = { n: line.n, d }
  const [p, u] = [minNorm(shifted), direction(shifted)]
  return [
    [p[0] - 50 * u[0], p[1] - 50 * u[1]],
    [p[0] + 50 * u[0], p[1] + 50 * u[1]],
  ]
}

/**
 * Least squares with dependent columns, in the (c, m) plane: the line of best
 * fits, error level lines parallel to it, a point p to drag (along the line,
 * or anywhere), its ‖r‖² and ‖p‖², and the circle through p about the origin.
 */
export function DependentColumns({ params }: { params: DependentColumnsParams }) {
  const { A, b, mode = 'line' } = params
  const line = useMemo(() => fitLine(A, b), [A, b])
  const start = useMemo(() => params.start ?? along(line, 1.5), [params.start, line])
  const [p, setP] = useState<Vec2>(mode === 'line' ? project(line, start) : start)
  const [dragging, setDragging] = useState(false)
  const svg = useRef<SVGSVGElement>(null)
  const clip = `clip-${useId().replace(/[^A-Za-z0-9-]/g, '')}`

  const box = useMemo(() => view(line, start), [line, start])
  const sx = scale([box.x0, box.x1], [PAD, W - PAD])
  const sy = scale([box.y0, box.y1], [H - PAD, PAD])
  const least = error(A, b, minNorm(line))
  const rr = error(A, b, p)
  const pp = p[0] ** 2 + p[1] ** 2
  const best = minNorm(line)
  const t = positionOn(line, p)

  const moveTo = (q: Vec2) => {
    if (mode === 'line') {
      const s = Math.max(-REACH, Math.min(REACH, positionOn(line, q)))
      setP(along(line, Math.round(s * 100) / 100))
    } else {
      setP([Math.round(q[0] * 20) / 20, Math.round(q[1] * 20) / 20])
    }
  }

  const onMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!dragging) return
    const at = pointerIn(event, svg.current)
    if (at) moveTo([sx.from(at[0]), sy.from(at[1])])
  }

  const segment = (d: number, className: string, key: string) => {
    const [e0, e1] = ends(line, d)
    return <line key={key} className={className} x1={sx.to(e0[0])} y1={sy.to(e0[1])} x2={sx.to(e1[0])} y2={sy.to(e1[1])} />
  }

  const levels = params.levels ? [3, 12, 27] : []
  const ticks = (from: number, to: number) => Array.from({ length: Math.floor(to) - Math.ceil(from) + 1 }, (_, i) => Math.ceil(from) + i)

  return (
    <div className="widget-body dependent-columns">
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        className="widget-svg"
        role="img"
        aria-label={`The (c, m) plane: p = (${fmt(p[0])}, ${fmt(p[1])}) on the line of best fits`}
        onPointerMove={onMove}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
      >
        <clipPath id={clip}>
          <rect x={PAD} y={PAD} width={W - 2 * PAD} height={H - 2 * PAD} />
        </clipPath>
        <g clipPath={`url(#${clip})`}>
          {ticks(box.x0, box.x1).map((x) => (
            <line key={`gx${x}`} className={x === 0 ? 'w-axis' : 'w-grid'} x1={sx.to(x)} x2={sx.to(x)} y1={0} y2={H} />
          ))}
          {ticks(box.y0, box.y1).map((y) => (
            <line key={`gy${y}`} className={y === 0 ? 'w-axis' : 'w-grid'} x1={0} x2={W} y1={sy.to(y)} y2={sy.to(y)} />
          ))}
          {levels.flatMap((extra) => {
            const offset = levelOffset(A, line, extra)
            return [segment(line.d - offset, 'w-level', `l-${extra}`), segment(line.d + offset, 'w-level', `l+${extra}`)]
          })}
          {segment(line.d, 'w-line', 'fit')}
          {params.circle && <circle className="w-circle" cx={sx.to(0)} cy={sy.to(0)} r={Math.hypot(sx.to(p[0]) - sx.to(0), sy.to(p[1]) - sy.to(0))} />}
          {params.revealMinNorm && <circle className="w-best-point" cx={sx.to(best[0])} cy={sy.to(best[1])} r={5} />}
          <line className="w-to-p" x1={sx.to(0)} y1={sy.to(0)} x2={sx.to(p[0])} y2={sy.to(p[1])} />
        </g>
        <text className="w-tick" x={W - PAD + 2} y={sy.to(0) - 4} textAnchor="end">
          c
        </text>
        <text className="w-tick" x={sx.to(0) + 5} y={PAD + 10}>
          m
        </text>
        <g
          className="w-handle"
          onPointerDown={(event) => {
            event.currentTarget.ownerSVGElement?.setPointerCapture?.(event.pointerId)
            setDragging(true)
          }}
        >
          <circle cx={sx.to(p[0])} cy={sy.to(p[1])} r={20} className="w-hit" />
          <circle cx={sx.to(p[0])} cy={sy.to(p[1])} r={8} className={dragging ? 'w-knob active' : 'w-knob'} />
          <text className="w-label" x={sx.to(p[0]) + 11} y={sy.to(p[1]) - 10}>
            p
          </text>
        </g>
      </svg>

      {mode === 'line' && (
        <div className="w-sliders">
          <label>
            <span>Slide p along the line</span>
            <input type="range" min={-REACH} max={REACH} step={0.01} value={Math.round(t * 100) / 100} onChange={(e) => setP(along(line, Number(e.target.value)))} />
          </label>
        </div>
      )}

      <dl className="w-readout">
        <dt>p = (c, m)</dt>
        <dd>
          ({fmt(p[0])}, {fmt(p[1])})
        </dd>
        <dt>‖r‖²</dt>
        <dd>{fmt(rr)}</dd>
        <dt>‖p‖² = c² + m²</dt>
        <dd>{fmt(pp)}</dd>
      </dl>
      {params.levels && <p className="w-note">Faint lines: ‖r‖² = {levels.map((e) => fmt(least + e, 0)).join(', ')}. The solid line is every best fit, ‖r‖² = {fmt(least, 0)}.</p>}
    </div>
  )
}
