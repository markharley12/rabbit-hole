import { afterEach, describe, expect, it } from 'vitest'
import {
  HOME,
  MAX_CHARS,
  MAX_POINTS,
  MAX_STROKES,
  addStroke,
  canRedo,
  canUndo,
  clampView,
  clearPad,
  distanceToSegment,
  emptyPad,
  eraseAt,
  load,
  parse,
  redo,
  save,
  serialise,
  storageKey,
  toPage,
  toScreen,
  undo,
} from './scratch-pad.ts'
import type { Stroke } from './scratch-pad.ts'
import { pinch } from '../map/gestures.ts'

const line = (x0: number, y0: number, x1: number, y1: number): Stroke => ({
  ink: 'ink',
  points: [
    { x: x0, y: y0 },
    { x: x1, y: y1 },
  ],
})

afterEach(() => localStorage.clear())

describe('strokes, undo and redo', () => {
  it('adds a stroke, and undoes and redoes it', () => {
    let pad = addStroke(emptyPad(), line(0, 0, 10, 0))
    pad = addStroke(pad, line(0, 5, 10, 5))
    expect(pad.strokes).toHaveLength(2)
    expect(canUndo(pad)).toBe(true)
    pad = undo(pad)
    expect(pad.strokes).toHaveLength(1)
    expect(canRedo(pad)).toBe(true)
    pad = redo(pad)
    expect(pad.strokes).toHaveLength(2)
    expect(canRedo(pad)).toBe(false)
  })

  it('a new stroke after an undo drops the redo stack', () => {
    let pad = addStroke(addStroke(emptyPad(), line(0, 0, 1, 1)), line(2, 2, 3, 3))
    pad = addStroke(undo(pad), line(9, 9, 9, 9))
    expect(canRedo(pad)).toBe(false)
  })

  it('undo and redo on an empty history change nothing', () => {
    const pad = emptyPad()
    expect(undo(pad)).toBe(pad)
    expect(redo(pad)).toBe(pad)
  })

  it('ignores a stroke with no points', () => {
    const pad = emptyPad()
    expect(addStroke(pad, { ink: 'ink', points: [] })).toBe(pad)
  })

  it('clear is one undo step, and clearing nothing is not a step', () => {
    const pad = addStroke(emptyPad(), line(0, 0, 10, 0))
    const cleared = clearPad(pad)
    expect(cleared.strokes).toEqual([])
    expect(undo(cleared).strokes).toHaveLength(1)
    expect(clearPad(emptyPad())).toEqual(emptyPad())
  })
})

describe('the eraser', () => {
  it('measures distance to a segment, including past its ends', () => {
    expect(distanceToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(3)
    expect(distanceToSegment({ x: 13, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5)
    expect(distanceToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(5)
  })

  it('removes whole strokes it touches, and only those', () => {
    let pad = addStroke(emptyPad(), line(0, 0, 100, 0))
    pad = addStroke(pad, line(0, 50, 100, 50))
    const next = eraseAt(pad, { x: 40, y: 3 }, 5)
    expect(next.strokes).toEqual([line(0, 50, 100, 50)])
  })

  it('leaves the pad as it was (same object) when nothing is touched', () => {
    const pad = addStroke(emptyPad(), line(0, 0, 100, 0))
    expect(eraseAt(pad, { x: 40, y: 30 }, 5)).toBe(pad)
  })

  it('erases a dot', () => {
    const pad = addStroke(emptyPad(), { ink: 'a', points: [{ x: 10, y: 10 }] })
    expect(eraseAt(pad, { x: 12, y: 10 }, 3).strokes).toEqual([])
    expect(eraseAt(pad, { x: 20, y: 10 }, 3)).toBe(pad)
  })

  it('one drag is one undo step when the later erases merge', () => {
    let pad = addStroke(addStroke(emptyPad(), line(0, 0, 100, 0)), line(0, 50, 100, 50))
    pad = eraseAt(pad, { x: 10, y: 0 }, 3)
    pad = eraseAt(pad, { x: 10, y: 50 }, 3, true)
    expect(pad.strokes).toEqual([])
    expect(undo(pad).strokes).toHaveLength(2)
  })
})

describe('the view', () => {
  it('maps page to screen and back', () => {
    const view = { k: 2.5, x: 40, y: -17 }
    const page = { x: 12.5, y: 80 }
    const back = toPage(view, toScreen(view, page))
    expect(back.x).toBeCloseTo(page.x)
    expect(back.y).toBeCloseTo(page.y)
  })

  it('a pinch keeps the page under the fingers', () => {
    const a0 = { x: 100, y: 100 }
    const b0 = { x: 200, y: 100 }
    const under = toPage(HOME, a0)
    const view = pinch(HOME, a0, b0, { x: 100, y: 100 }, { x: 300, y: 100 })
    expect(view.k).toBeCloseTo(2)
    const now = toScreen(view, under)
    expect(now.x).toBeCloseTo(100)
    expect(now.y).toBeCloseTo(100)
  })

  it('clamps the zoom and keeps the given point fixed', () => {
    const at = { x: 50, y: 50 }
    const before = { k: 100, x: 3, y: 4 }
    const view = clampView(before, at)
    expect(view.k).toBe(8)
    const page = toPage(before, at)
    expect(toScreen(view, page).x).toBeCloseTo(50)
    expect(toScreen(view, page).y).toBeCloseTo(50)
    expect(clampView(HOME)).toBe(HOME)
  })
})

describe('what is kept', () => {
  it('round trips, rounding to one decimal', () => {
    const strokes: Stroke[] = [
      {
        ink: 'a',
        points: [
          { x: 1.26, y: 2.04 },
          { x: 3, y: 4.96 },
        ],
      },
    ]
    expect(parse(serialise(strokes))).toEqual([
      {
        ink: 'a',
        points: [
          { x: 1.3, y: 2 },
          { x: 3, y: 5 },
        ],
      },
    ])
  })

  it('keeps a dot', () => {
    const dot: Stroke[] = [{ ink: 'ink', points: [{ x: 5, y: 6 }] }]
    expect(parse(serialise(dot))).toEqual(dot)
  })

  it('stores a version number', () => {
    expect(JSON.parse(serialise([])).v).toBe(1)
  })

  it('drops the oldest strokes beyond the stroke cap', () => {
    const strokes = Array.from({ length: MAX_STROKES + 5 }, (_, i) => line(i, 0, i, 1))
    const kept = parse(serialise(strokes))
    expect(kept).toHaveLength(MAX_STROKES)
    expect(kept[0].points[0].x).toBe(5)
    expect(kept[kept.length - 1].points[0].x).toBe(MAX_STROKES + 4)
  })

  it('drops the oldest strokes beyond the point cap', () => {
    const long = (x: number): Stroke => ({ ink: 'ink', points: Array.from({ length: MAX_POINTS / 2 }, (_, i) => ({ x, y: i })) })
    const kept = parse(serialise([long(1), long(2), long(3)]))
    expect(kept.map((s) => s.points[0].x)).toEqual([2, 3])
  })

  it.each([
    ['not json', '{nope'],
    ['an array', '[]'],
    ['a newer version', JSON.stringify({ v: 2, strokes: [] })],
    ['no version', JSON.stringify({ strokes: [] })],
    ['strokes not a list', JSON.stringify({ v: 1, strokes: 7 })],
    ['an odd number of coordinates', JSON.stringify({ v: 1, strokes: [{ c: 'ink', p: [1, 2, 3] }] })],
    ['text in the coordinates', JSON.stringify({ v: 1, strokes: [{ c: 'ink', p: [1, 'x'] }] })],
    ['null', 'null'],
  ])('discards %s', (_, text) => {
    expect(parse(text)).toEqual([])
  })

  it('discards an oversized value without reading it', () => {
    expect(parse(' '.repeat(MAX_CHARS + 1) + serialise([line(0, 0, 1, 1)]))).toEqual([])
  })

  it('falls back to ink for an unknown colour', () => {
    expect(parse(JSON.stringify({ v: 1, strokes: [{ c: 'pink', p: [1, 2] }] }))[0].ink).toBe('ink')
  })

  it('saves per course and lesson, and clearing removes the key', () => {
    save('c1', 'l1', [line(0, 0, 1, 1)])
    expect(localStorage.getItem('rabbit-hole:scratch:c1:l1')).not.toBeNull()
    expect(storageKey('c1', 'l1')).toBe('rabbit-hole:scratch:c1:l1')
    expect(load('c1', 'l1')).toHaveLength(1)
    expect(load('c1', 'l2')).toEqual([])
    save('c1', 'l1', [])
    expect(localStorage.getItem('rabbit-hole:scratch:c1:l1')).toBeNull()
  })

  it('a corrupt stored value loads as an empty page, not a crash', () => {
    localStorage.setItem(storageKey('c', 'l'), '{{{')
    expect(load('c', 'l')).toEqual([])
  })
})
