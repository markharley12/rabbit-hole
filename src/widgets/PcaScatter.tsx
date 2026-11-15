import { useId, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { centre as centrePoints, direction, frame, lineAngle, lineEnds, principal, spread } from './pca-scatter-math.ts'
import type { Denominator, Point } from './pca-scatter-math.ts'
import { fmt, pointerIn, scale } from './svg.ts'

export interface PcaScatterParams {
  points: Point[]
  centre?: boolean
  start?: number
  denominator?: Denominator
  table?: boolean
  revealBest?: boolean
  showSecond?: boolean
}

const SIZE = 300
const PAD = 22
/** How far from the mean the two handles sit, in viewBox units. */
const HANDLE = 92

interface Guess {
  angle: number
  along: number
}

const degrees = (angle: number) => `${Math.round(angle)}°`

/**
 * A few points and a line through their mean. Turn the line by dragging either
 * handle or with the slider; the projections (feet) and the perpendicular drops
 * are drawn, with live read-outs of u, the variance along the line and the mean
 * squared distance to it. Optionally keep guesses in a table, show the principal
 * direction, and draw the perpendicular direction with its own variance.
 */
export function PcaScatter({ params }: { params: PcaScatterParams }) {
  const denominator = params.denominator ?? 'n-1'
  const points: Point[] = params.centre ? centrePoints(params.points) : params.points
  const n = points.length
  const [angle, setAngle] = useState(lineAngle(Math.round(params.start ?? 0)))
  const [kept, setKept] = useState<Guess[]>([])
  const [showBest, setShowBest] = useState(false)
  const [dragging, setDragging] = useState(false)
  const svg = useRef<SVGSVGElement>(null)
  const clip = `clip-${useId().replace(/[^A-Za-z0-9-]/g, '')}`

  const box = frame(points)
  const sx = scale([box.xmin, box.xmax], [PAD, SIZE - PAD / 2])
  const sy = scale([box.ymin, box.ymax], [SIZE - PAD, PAD / 2])
  const at = (p: Point): Point => [sx.to(p[0]), sy.to(p[1])]
  const now = spread(points, angle, denominator)
  const second = spread(points, angle + 90, denominator)
  const best = principal(points, denominator)
  const m = at(now.mean)
  const ends = lineEnds(now.mean, now.u, box).map(at)
  const perpEnds = lineEnds(now.mean, second.u, box).map(at)
  // On screen y points down, so the handle offset flips its y.
  const handles: Point[] = [
    [m[0] + HANDLE * now.u[0], m[1] - HANDLE * now.u[1]],
    [m[0] - HANDLE * now.u[0], m[1] + HANDLE * now.u[1]],
  ]

  const onMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!dragging) return
    const p = pointerIn(event, svg.current)
    if (!p) return
    const dx = p[0] - m[0]
    const dy = m[1] - p[1]
    if (Math.hypot(dx, dy) < 4) return
    setAngle(lineAngle(Math.round((Math.atan2(dy, dx) * 180) / Math.PI)))
  }

  const keep = () => setKept((list) => [...list.filter((g) => g.angle !== angle), { angle, along: now.along }].sort((a, b) => b.along - a.along).slice(0, 6))

  const gridX = Array.from({ length: box.xmax - box.xmin + 1 }, (_, i) => box.xmin + i)
  const gridY = Array.from({ length: box.ymax - box.ymin + 1 }, (_, i) => box.ymin + i)
  const label = Math.max(box.xmax - box.xmin, 1) > 12 ? 2 : 1
  const divide = denominator === 'n' ? `n = ${n}` : `n − 1 = ${n - 1}`
  const bestEnds = best.angle === null ? null : lineEnds(now.mean, direction(best.angle), box).map(at)

  return (
    <div className="widget-body pca-scatter">
      <svg
        ref={svg}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="widget-svg square"
        role="img"
        aria-label={`${n} points and a line through their mean at ${degrees(angle)}; variance along it ${fmt(now.along)}`}
        onPointerMove={onMove}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
      >
        {gridX.map((x) => (
          <g key={`x${x}`}>
            <line className={x === 0 ? 'w-axis' : 'w-grid'} x1={sx.to(x)} x2={sx.to(x)} y1={sy.to(box.ymin)} y2={sy.to(box.ymax)} />
            {x % label === 0 && (
              <text className="w-tick" x={sx.to(x)} y={SIZE - 8} textAnchor="middle">
                {x}
              </text>
            )}
          </g>
        ))}
        {gridY.map((y) => (
          <g key={`y${y}`}>
            <line className={y === 0 ? 'w-axis' : 'w-grid'} x1={sx.to(box.xmin)} x2={sx.to(box.xmax)} y1={sy.to(y)} y2={sy.to(y)} />
            {y % label === 0 && (
              <text className="w-tick" x={PAD - 6} y={sy.to(y) + 4} textAnchor="end">
                {y}
              </text>
            )}
          </g>
        ))}
        <clipPath id={clip}>
          <rect x={sx.to(box.xmin)} y={sy.to(box.ymax)} width={sx.to(box.xmax) - sx.to(box.xmin)} height={sy.to(box.ymin) - sy.to(box.ymax)} />
        </clipPath>
        <g clipPath={`url(#${clip})`}>
          {showBest && bestEnds && <line className="w-best" x1={bestEnds[0][0]} y1={bestEnds[0][1]} x2={bestEnds[1][0]} y2={bestEnds[1][1]} />}
          {params.showSecond && <line className="w-pca-second" x1={perpEnds[0][0]} y1={perpEnds[0][1]} x2={perpEnds[1][0]} y2={perpEnds[1][1]} />}
          <line className="w-line" x1={ends[0][0]} y1={ends[0][1]} x2={ends[1][0]} y2={ends[1][1]} />
          {points.map((p, i) => {
            const [px, py] = at(p)
            const [fx, fy] = at(now.feet[i])
            return <line key={`d${i}`} className="w-resid" x1={px} y1={py} x2={fx} y2={fy} />
          })}
        </g>
        {now.feet.map((f, i) => {
          const [fx, fy] = at(f)
          return <circle key={`f${i}`} className="w-pca-foot" cx={fx} cy={fy} r={3.5} />
        })}
        {points.map((p, i) => {
          const [px, py] = at(p)
          return <circle key={`p${i}`} className="w-point" cx={px} cy={py} r={5} />
        })}
        {!params.centre && (
          <g className="w-pca-mean" aria-hidden="true">
            <line x1={m[0] - 7} y1={m[1] - 7} x2={m[0] + 7} y2={m[1] + 7} />
            <line x1={m[0] - 7} y1={m[1] + 7} x2={m[0] + 7} y2={m[1] - 7} />
          </g>
        )}
        {handles.map(([hx, hy], i) => (
          <g
            key={`h${i}`}
            className="w-handle"
            onPointerDown={(event) => {
              event.currentTarget.ownerSVGElement?.setPointerCapture?.(event.pointerId)
              setDragging(true)
            }}
          >
            <circle cx={hx} cy={hy} r={20} className="w-hit" />
            <circle cx={hx} cy={hy} r={8} className={dragging ? 'w-knob active' : 'w-knob'} />
          </g>
        ))}
      </svg>

      <div className="w-sliders">
        <label>
          <span>
            Angle of the line <output>{degrees(angle)}</output>
          </span>
          <input type="range" min={0} max={179} step={1} value={angle} onChange={(e) => setAngle(lineAngle(Number(e.target.value)))} />
        </label>
      </div>

      <dl className="w-readout">
        <dt>u</dt>
        <dd>
          ({fmt(now.u[0])}, {fmt(now.u[1])})
        </dd>
        <dt>Variance along u</dt>
        <dd>{fmt(now.along)}</dd>
        <dt>Mean sq. distance to the line</dt>
        <dd>{fmt(now.across)}</dd>
        {params.showSecond && (
          <>
            <dt>Variance along u⊥</dt>
            <dd>{fmt(second.along)}</dd>
            <dt>Sum (total variance)</dt>
            <dd>
              {fmt(now.along)} + {fmt(second.along)} = {fmt(now.total)}
            </dd>
          </>
        )}
      </dl>
      <p className="w-note">
        {params.centre ? 'Centred points.' : 'The cross is the mean.'} Sums of squares are divided by {divide}.
      </p>

      {(params.table || params.revealBest) && (
        <div className="w-actions">
          {params.table && (
            <button className="small-button" onClick={keep}>
              Keep this guess
            </button>
          )}
          {params.revealBest && best.angle !== null && (
            <button className="small-button" onClick={() => setShowBest(!showBest)} aria-pressed={showBest}>
              {showBest ? 'Hide the best direction' : 'Show the best direction'}
            </button>
          )}
        </div>
      )}
      {showBest && best.angle !== null && (
        <p className="w-note">
          Best: {degrees(best.angle)}, u = ({fmt(direction(best.angle)[0])}, {fmt(direction(best.angle)[1])}), variance {fmt(best.lambda[0])}
        </p>
      )}
      {kept.length > 0 && (
        <table className="w-table">
          <thead>
            <tr>
              <th>Angle</th>
              <th>u</th>
              <th>Variance along u</th>
            </tr>
          </thead>
          <tbody>
            {kept.map((g) => (
              <tr key={g.angle}>
                <td>{degrees(g.angle)}</td>
                <td>
                  ({fmt(direction(g.angle)[0])}, {fmt(direction(g.angle)[1])})
                </td>
                <td>{fmt(g.along)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
