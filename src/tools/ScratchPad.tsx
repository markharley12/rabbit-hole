import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react'
import { pinch, zoomAbout } from '../map/gestures.ts'
import { EraserIcon, FitIcon, PenIcon, RedoIcon, TrashIcon, UndoIcon } from './icons.tsx'
import {
  HOME,
  INKS,
  addStroke,
  canRedo,
  canUndo,
  clampView,
  clearPad,
  emptyPad,
  eraseAt,
  load,
  redo,
  save,
  toPage,
  undo,
} from './scratch-pad.ts'
import type { Ink, Pad, Point, Stroke, View } from './scratch-pad.ts'

interface Props {
  courseId: string
  lessonId: string
}

/** Pen width in page units, so ink scales with the page like ink on paper. */
const PEN = 2.4
/** The eraser's reach, in screen pixels. */
const ERASER = 14
const SAVE_AFTER_MS = 600
const CONFIRM_MS = 3000

/** Colours come from the theme, so the ink stays readable in light and dark. */
const INK_VAR: Record<Ink, string> = { ink: '--fg', a: '--b0', b: '--b1' }
const INK_NAME: Record<Ink, string> = { ink: 'ink', a: 'blue', b: 'red' }

function paint(canvas: HTMLCanvasElement, strokes: Stroke[], live: Stroke | null, view: View) {
  // jsdom has no canvas: getContext is null there (and returns nothing, not an error).
  const ctx = canvas.getContext?.('2d')
  if (!ctx) return
  const dpr = window.devicePixelRatio || 1
  const style = getComputedStyle(canvas)
  const colour = (ink: Ink) => style.getPropertyValue(INK_VAR[ink]).trim() || '#888'
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.setTransform(dpr * view.k, 0, 0, dpr * view.k, dpr * view.x, dpr * view.y)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.lineWidth = PEN
  for (const stroke of live ? [...strokes, live] : strokes) {
    const pts = stroke.points
    ctx.strokeStyle = colour(stroke.ink)
    ctx.fillStyle = colour(stroke.ink)
    if (pts.length === 1) {
      ctx.beginPath()
      ctx.arc(pts[0].x, pts[0].y, PEN / 2, 0, Math.PI * 2)
      ctx.fill()
      continue
    }
    // Quadratic curves through the midpoints: smooth, and passes near every point.
    ctx.beginPath()
    ctx.moveTo(pts[0].x, pts[0].y)
    for (let i = 1; i < pts.length - 1; i++) {
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, (pts[i].x + pts[i + 1].x) / 2, (pts[i].y + pts[i + 1].y) / 2)
    }
    const last = pts[pts.length - 1]
    ctx.lineTo(last.x, last.y)
    ctx.stroke()
  }
}

/**
 * A page to draw on. One finger, pen or mouse draws or erases; two fingers pan
 * and pinch the page. Strokes are kept on this device for this lesson.
 */
export function ScratchPad({ courseId, lessonId }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [pad, setPad] = useState<Pad>(() => emptyPad(load(courseId, lessonId)))
  const [mode, setMode] = useState<'pen' | 'eraser'>('pen')
  const [ink, setInk] = useState<Ink>('ink')
  const [armed, setArmed] = useState(false)

  const padRef = useRef(pad)
  const view = useRef<View>(HOME)
  const live = useRef<Stroke | null>(null)
  const erasing = useRef<{ erased: boolean } | null>(null)
  const pointers = useRef(new Map<number, Point>())
  const dirty = useRef(false)

  const redraw = useCallback(() => {
    if (canvas.current) paint(canvas.current, padRef.current.strokes, live.current, view.current)
  }, [])

  const apply = useCallback(
    (next: Pad) => {
      if (next === padRef.current) return
      padRef.current = next
      dirty.current = true
      setPad(next)
      redraw()
    },
    [redraw],
  )

  // Sharp lines: the bitmap is the CSS size times the device pixel ratio.
  useEffect(() => {
    const element = canvas.current
    if (!element) return
    const fit = () => {
      const dpr = window.devicePixelRatio || 1
      const box = element.getBoundingClientRect()
      element.width = Math.max(1, Math.round(box.width * dpr))
      element.height = Math.max(1, Math.round(box.height * dpr))
      redraw()
    }
    fit()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit)
    observer?.observe(element)
    // Orientation changes resize the element, but not every browser says so.
    window.addEventListener('resize', fit)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', fit)
    }
  }, [redraw])

  // Kept on the device a moment after the last change, and when the pad closes.
  useEffect(() => {
    if (!dirty.current) return
    const timer = setTimeout(() => save(courseId, lessonId, pad.strokes), SAVE_AFTER_MS)
    return () => clearTimeout(timer)
  }, [pad.strokes, courseId, lessonId])
  useEffect(
    () => () => {
      if (dirty.current) save(courseId, lessonId, padRef.current.strokes)
    },
    [courseId, lessonId],
  )

  useEffect(() => {
    if (!armed) return
    const timer = setTimeout(() => setArmed(false), CONFIRM_MS)
    return () => clearTimeout(timer)
  }, [armed])

  const screenPoint = (event: ReactPointerEvent | ReactWheelEvent): Point => {
    const box = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - box.left, y: event.clientY - box.top }
  }

  const erase = (at: Point) => {
    const gesture = erasing.current
    if (!gesture) return
    const next = eraseAt(padRef.current, toPage(view.current, at), ERASER / view.current.k, gesture.erased)
    if (next !== padRef.current) gesture.erased = true
    apply(next)
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const at = screenPoint(event)
    event.currentTarget.setPointerCapture?.(event.pointerId)
    pointers.current.set(event.pointerId, at)
    if (pointers.current.size === 1) {
      if (mode === 'pen') live.current = { ink, points: [toPage(view.current, at)] }
      else {
        erasing.current = { erased: false }
        erase(at)
      }
    } else {
      // A second finger: this was a pan or pinch, not a line, so drop the half-drawn one.
      live.current = null
      erasing.current = null
    }
    redraw()
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const before = pointers.current.get(event.pointerId)
    if (!before) return
    const at = screenPoint(event)
    if (pointers.current.size === 2) {
      const other = [...pointers.current.entries()].find(([id]) => id !== event.pointerId)?.[1]
      if (other) {
        const mid = { x: (at.x + other.x) / 2, y: (at.y + other.y) / 2 }
        view.current = clampView(pinch(view.current, before, other, at, other), mid)
      }
    } else if (pointers.current.size === 1) {
      if (live.current) {
        const page = toPage(view.current, at)
        const last = live.current.points[live.current.points.length - 1]
        // Closer than a third of a pixel adds weight to the file and nothing to the line.
        if (Math.hypot(page.x - last.x, page.y - last.y) * view.current.k >= 0.35) live.current.points.push(page)
      } else if (erasing.current) erase(at)
    }
    pointers.current.set(event.pointerId, at)
    redraw()
  }

  const onPointerEnd = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!pointers.current.delete(event.pointerId)) return
    if (pointers.current.size === 0) {
      if (live.current && event.type !== 'pointercancel') apply(addStroke(padRef.current, live.current))
      live.current = null
      erasing.current = null
      redraw()
    }
  }

  // A mouse has no pinch: the wheel zooms about the cursor.
  const onWheel = (event: ReactWheelEvent<HTMLCanvasElement>) => {
    const at = screenPoint(event)
    view.current = clampView(zoomAbout(view.current, at, Math.exp(-event.deltaY * 0.002)), at)
    redraw()
  }

  const fit = () => {
    view.current = HOME
    redraw()
  }

  const clear = () => {
    if (!armed) {
      setArmed(true)
      return
    }
    setArmed(false)
    apply(clearPad(padRef.current))
  }

  return (
    <div className="scratch">
      <canvas
        ref={canvas}
        className="scratch-canvas"
        aria-label="Scratch page"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onWheel={onWheel}
      />
      <div className="scratch-bar" role="toolbar" aria-label="Drawing tools">
        <button type="button" className="tool-button" aria-label="Pen" aria-pressed={mode === 'pen'} onClick={() => setMode('pen')}>
          <PenIcon />
        </button>
        <button type="button" className="tool-button" aria-label="Eraser" aria-pressed={mode === 'eraser'} onClick={() => setMode('eraser')}>
          <EraserIcon />
        </button>
        <button type="button" className="tool-button" aria-label="Undo" disabled={!canUndo(pad)} onClick={() => apply(undo(padRef.current))}>
          <UndoIcon />
        </button>
        <button type="button" className="tool-button" aria-label="Redo" disabled={!canRedo(pad)} onClick={() => apply(redo(padRef.current))}>
          <RedoIcon />
        </button>
        <button type="button" className="tool-button" aria-label="Fit the page" onClick={fit}>
          <FitIcon />
        </button>
        <button
          type="button"
          className={`tool-button${armed ? ' armed' : ''}`}
          aria-label={armed ? 'Tap again to clear the page' : 'Clear the page'}
          disabled={pad.strokes.length === 0 && !armed}
          onClick={clear}
        >
          {armed ? <span className="tool-sure">Sure?</span> : <TrashIcon />}
        </button>
        <span className="ink-choice" role="group" aria-label="Pen colour">
          {INKS.map((name) => (
            <button
              key={name}
              type="button"
              className={`ink ink-${name}`}
              aria-label={INK_NAME[name]}
              aria-pressed={ink === name}
              onClick={() => {
                setInk(name)
                setMode('pen')
              }}
            />
          ))}
        </span>
      </div>
    </div>
  )
}
