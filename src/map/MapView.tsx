// The map as SVG: every circle once, inside one transformed group, with the
// labels drawn on top in screen pixels so text stays the same size at any zoom.
// All the rules (layout, taps, labels, view maths) are in layout.ts and
// gestures.ts; this file only draws and listens.

import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { clampView, fitView, hitTest, pickLabels } from './layout.ts'
import type { Layout, Rect, View } from './layout.ts'
import { easeInOut, interpolateView, panBy, pinch, toWorld, zoomAbout } from './gestures.ts'
import type { Point } from './gestures.ts'

interface Props {
  layout: Layout
  focusId: string
  /** Bumped to re-centre on the focus even when it has not changed. */
  refit: number
  screen: { width: number; height: number }
  /** The part of the screen not covered by the top bar and the sheet. */
  area: Rect
  /** Nodes that carry a course, marked with a pin that keeps its size at any zoom. */
  courseIds?: ReadonlyMap<string, unknown>
  onSelect: (id: string) => void
}

// A finger that moves less than this between down and up is a tap.
const TAP_SLOP = 8
const MOVE_MS = 480

const Circles = memo(function Circles({ layout }: { layout: Layout }) {
  return (
    <>
      {layout.all.map((n) => (
        <circle
          key={n.id}
          cx={n.x}
          cy={n.y}
          r={n.r}
          className={`node ${n.children.length ? 'inner' : 'leaf'} ${n.branch < 0 ? 'root' : `b${n.branch}`}`}
        />
      ))}
    </>
  )
})

export function MapView({ layout, focusId, refit, screen, area, courseIds, onSelect }: Props) {
  const focus = layout.byId.get(focusId) ?? layout.root
  const [view, setView] = useState<View>(() => fitView(focus, area))
  // The latest view for the event handlers and the animation, which must not
  // wait for a render to see it.
  const latest = useRef(view)
  const frame = useRef(0)
  const svg = useRef<SVGSVGElement>(null)
  const pointers = useRef(new Map<number, Point>())
  const tap = useRef<{ start: Point; moved: boolean } | null>(null)

  const apply = (next: View) => {
    const clamped = clampView(next, layout, screen)
    latest.current = clamped
    setView(clamped)
  }
  const stop = () => cancelAnimationFrame(frame.current)

  // Glide to the focused node whenever it, or the space around it, changes.
  const { left, top, width, height } = area
  useEffect(() => {
    const zone = { left, top, width, height }
    const from = latest.current
    const to = fitView(focus, zone)
    const anchor = { x: left + width / 2, y: top + height / 2 }
    const started = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, (now - started) / MOVE_MS)
      const next = interpolateView(from, to, easeInOut(t), anchor)
      latest.current = next
      setView(next)
      if (t < 1) frame.current = requestAnimationFrame(step)
    }
    frame.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame.current)
  }, [focus, refit, left, top, width, height])

  // Wheel zoom for a desktop browser. Not passive: the page must not scroll.
  useEffect(() => {
    const element = svg.current
    if (!element) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      cancelAnimationFrame(frame.current)
      const next = zoomAbout(latest.current, { x: event.clientX, y: event.clientY }, Math.exp(-event.deltaY * 0.0015))
      const clamped = clampView(next, layout, screen)
      latest.current = clamped
      setView(clamped)
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [layout, screen])

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    stop()
    // jsdom has no pointer capture; a real browser always does.
    event.currentTarget.setPointerCapture?.(event.pointerId)
    const at = { x: event.clientX, y: event.clientY }
    pointers.current.set(event.pointerId, at)
    // Only a lone finger can tap; a second one makes it a pinch for good.
    tap.current = pointers.current.size === 1 ? { start: at, moved: false } : null
  }

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const before = pointers.current.get(event.pointerId)
    if (!before) return
    const at = { x: event.clientX, y: event.clientY }
    if (pointers.current.size === 1) {
      if (tap.current && !tap.current.moved) {
        if (Math.hypot(at.x - tap.current.start.x, at.y - tap.current.start.y) < TAP_SLOP) return
        tap.current.moved = true
      }
      pointers.current.set(event.pointerId, at)
      apply(panBy(latest.current, at.x - before.x, at.y - before.y))
      return
    }
    const other = [...pointers.current.entries()].find(([id]) => id !== event.pointerId)?.[1]
    pointers.current.set(event.pointerId, at)
    if (other) apply(pinch(latest.current, before, other, at, other))
  }

  const onPointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!pointers.current.delete(event.pointerId)) return
    const was = tap.current
    if (pointers.current.size === 0) tap.current = null
    if (event.type !== 'pointerup' || !was || was.moved || pointers.current.size) return
    const world = toWorld(latest.current, { x: event.clientX, y: event.clientY })
    const hit = hitTest(layout, world.x, world.y, latest.current.k, area)
    if (hit) onSelect(hit.id)
  }

  const labels = useMemo(() => pickLabels(layout, view, screen, area), [layout, view, screen, area])

  return (
    <svg
      ref={svg}
      className="map"
      width={screen.width}
      height={screen.height}
      role="img"
      aria-label={`Map of mathematics, centred on ${focus.node.name}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
        <Circles layout={layout} />
        <circle className="focus-ring" cx={focus.x} cy={focus.y} r={focus.r} />
      </g>
      {/* Under the labels: a ring big enough to show around a name, which stays readable on top. */}
      <g className="course-pins" aria-hidden="true">
        {[...(courseIds?.keys() ?? [])].map((id) => {
          const n = layout.byId.get(id)
          if (!n) return null
          const [x, y] = [n.x * view.k + view.x, n.y * view.k + view.y]
          // Over a big circle, sit on its rim rather than on its label.
          const r = n.r * view.k
          const py = r > 30 ? y - r : y
          return (
            <g key={id}>
              <circle className="course-pin-ring" cx={x} cy={py} r={11} />
              <circle className="course-pin" cx={x} cy={py} r={4} />
            </g>
          )
        })}
      </g>
      <g className="labels" aria-hidden="true">
        {labels.map((label) => (
          <text
            key={label.id}
            className={`label ${label.kind} ${label.leaf ? 'on-leaf' : ''}`}
            x={label.x}
            y={label.y - ((label.lines.length - 1) * label.fontSize * 1.18) / 2}
            fontSize={label.fontSize}
          >
            {label.lines.map((line, i) => (
              <tspan key={i} x={label.x} dy={i ? label.fontSize * 1.18 : 0}>
                {line}
              </tspan>
            ))}
          </text>
        ))}
      </g>
    </svg>
  )
}
