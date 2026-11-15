import { useId, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { bestFit, clamp, frame, lineThrough, scores, snap } from './line-fitter-math.ts'
import type { Point } from './line-fitter-math.ts'
import { fmt, pointerIn, scale } from './svg.ts'

export interface LineFitterParams {
  points: Point[]
  start?: { c: number; m: number }
  cRange?: [number, number]
  mRange?: [number, number]
  showDots?: boolean
  table?: boolean
  revealBest?: boolean
}

const W = 320
const H = 220
const PAD = { left: 26, right: 10, top: 10, bottom: 22 }
const STEP = 0.05

interface Guess {
  c: number
  m: number
  rr: number
}

const lineText = (c: number, m: number) => `y = ${fmt(c)} + ${fmt(m)}x`.replace('+ −', '− ')

/**
 * Fit y = c + mx to a few points. Drag the two handles on the line (its height
 * at the first and last x) or use the sliders; residuals, ‖r‖² and r·columns
 * update live. Optionally keep guesses in a table and show the best line.
 */
export function LineFitter({ params }: { params: LineFitterParams }) {
  const { points, cRange = [-4, 4], mRange = [-2, 4] } = params
  const [c, setC] = useState(params.start?.c ?? 0)
  const [m, setM] = useState(params.start?.m ?? 1)
  const [kept, setKept] = useState<Guess[]>([])
  const [showBest, setShowBest] = useState(false)
  const [dragging, setDragging] = useState<number | null>(null)
  const svg = useRef<SVGSVGElement>(null)
  // useId has characters (colons, guillemets) that do not belong in url(#…).
  const clip = `clip-${useId().replace(/[^A-Za-z0-9-]/g, "")}`

  const box = frame(points)
  const sx = scale([box.xmin, box.xmax], [PAD.left, W - PAD.right])
  const sy = scale([box.ymin, box.ymax], [H - PAD.bottom, PAD.top])
  const now = scores(points, c, m)
  const best = bestFit(points)
  const xs = points.map((p) => p[0])
  const handles = [Math.min(...xs), Math.max(...xs)]

  const set = (next: { c: number; m: number }) => {
    setC(clamp(snap(next.c, STEP), cRange))
    setM(clamp(snap(next.m, STEP), mRange))
  }

  const onMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (dragging === null) return
    const at = pointerIn(event, svg.current)
    if (!at) return
    const y = sy.from(at[1])
    const moved = handles[dragging]
    const fixed = handles[1 - dragging]
    set(lineThrough([moved, y], [fixed, c + m * fixed]))
  }

  const keep = () => {
    setKept((list) =>
      [...list.filter((g) => g.c !== c || g.m !== m), { c, m, rr: now.rr }].sort((a, b) => a.rr - b.rr).slice(0, 6),
    )
  }

  const gridX = Array.from({ length: box.xmax - box.xmin + 1 }, (_, i) => box.xmin + i)
  const gridY = Array.from({ length: box.ymax - box.ymin + 1 }, (_, i) => box.ymin + i)

  return (
    <div className="widget-body line-fitter">
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        className="widget-svg"
        role="img"
        aria-label={`Points and the line ${lineText(c, m)}`}
        onPointerMove={onMove}
        onPointerUp={() => setDragging(null)}
        onPointerCancel={() => setDragging(null)}
      >
        {gridX.map((x) => (
          <g key={`x${x}`}>
            <line className={x === 0 ? 'w-axis' : 'w-grid'} x1={sx.to(x)} x2={sx.to(x)} y1={sy.to(box.ymin)} y2={sy.to(box.ymax)} />
            <text className="w-tick" x={sx.to(x)} y={H - 6} textAnchor="middle">
              {x}
            </text>
          </g>
        ))}
        {gridY.map((y) => (
          <g key={`y${y}`}>
            <line className={y === 0 ? 'w-axis' : 'w-grid'} x1={sx.to(box.xmin)} x2={sx.to(box.xmax)} y1={sy.to(y)} y2={sy.to(y)} />
            <text className="w-tick" x={PAD.left - 6} y={sy.to(y) + 4} textAnchor="end">
              {y}
            </text>
          </g>
        ))}
        <clipPath id={clip}>
          <rect x={sx.to(box.xmin)} y={sy.to(box.ymax)} width={sx.to(box.xmax) - sx.to(box.xmin)} height={sy.to(box.ymin) - sy.to(box.ymax)} />
        </clipPath>
        <g clipPath={`url(#${clip})`}>
        {showBest && best && (
          <line
            className="w-best"
            x1={sx.to(box.xmin)}
            y1={sy.to(best.c + best.m * box.xmin)}
            x2={sx.to(box.xmax)}
            y2={sy.to(best.c + best.m * box.xmax)}
          />
        )}
        <line className="w-line" x1={sx.to(box.xmin)} y1={sy.to(c + m * box.xmin)} x2={sx.to(box.xmax)} y2={sy.to(c + m * box.xmax)} />
        {points.map(([x, y], i) => (
          <line key={`r${i}`} className="w-resid" x1={sx.to(x)} x2={sx.to(x)} y1={sy.to(y)} y2={sy.to(c + m * x)} />
        ))}
        </g>
        {points.map(([x, y], i) => (
          <circle key={`p${i}`} className="w-point" cx={sx.to(x)} cy={sy.to(y)} r={5} />
        ))}
        {handles.map((x, i) => (
          <g key={`h${i}`} className="w-handle" onPointerDown={(event) => {
            event.currentTarget.ownerSVGElement?.setPointerCapture?.(event.pointerId)
            setDragging(i)
          }}>
            <circle cx={sx.to(x)} cy={sy.to(c + m * x)} r={20} className="w-hit" />
            <circle cx={sx.to(x)} cy={sy.to(c + m * x)} r={8} className={dragging === i ? 'w-knob active' : 'w-knob'} />
          </g>
        ))}
      </svg>

      <div className="w-sliders">
        <label>
          <span>
            c (where it crosses x = 0) <output>{fmt(c)}</output>
          </span>
          <input type="range" min={cRange[0]} max={cRange[1]} step={STEP} value={c} onChange={(e) => set({ c: Number(e.target.value), m })} />
        </label>
        <label>
          <span>
            m (slope) <output>{fmt(m)}</output>
          </span>
          <input type="range" min={mRange[0]} max={mRange[1]} step={STEP} value={m} onChange={(e) => set({ c, m: Number(e.target.value) })} />
        </label>
      </div>

      <dl className="w-readout">
        <dt>r = data − fit</dt>
        <dd>({now.r.map((e) => fmt(e)).join(', ')})</dd>
        <dt>‖r‖²</dt>
        <dd>{fmt(now.rr)}</dd>
        {params.showDots && (
          <>
            <dt>r · (1, …, 1)</dt>
            <dd>{fmt(now.dotOnes)}</dd>
            <dt>r · x</dt>
            <dd>{fmt(now.dotX)}</dd>
          </>
        )}
      </dl>

      {(params.table || params.revealBest) && (
        <div className="w-actions">
          {params.table && (
            <button className="small-button" onClick={keep}>
              Keep this guess
            </button>
          )}
          {params.revealBest && best && (
            <button className="small-button" onClick={() => setShowBest(!showBest)} aria-pressed={showBest}>
              {showBest ? 'Hide the best line' : 'Show the best line'}
            </button>
          )}
        </div>
      )}
      {showBest && best && (
        <p className="w-note">
          Best: {lineText(best.c, best.m)}, ‖r‖² = {fmt(scores(points, best.c, best.m).rr)}
        </p>
      )}
      {kept.length > 0 && (
        <table className="w-table">
          <thead>
            <tr>
              <th>Guess</th>
              <th>‖r‖²</th>
            </tr>
          </thead>
          <tbody>
            {kept.map((g) => (
              <tr key={`${g.c},${g.m}`}>
                <td>{lineText(g.c, g.m)}</td>
                <td>{fmt(g.rr)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
