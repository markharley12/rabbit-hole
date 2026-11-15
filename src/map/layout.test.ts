import { describe, expect, it } from 'vitest'
import { MIN_NAME, MIN_TAP, WORLD, ancestry, clampView, fitView, hitTest, layoutMap, pickLabels, shortCode, splitSize, wrapLabel } from './layout.ts'
import type { Layout, Placed, Rect } from './layout.ts'
import type { MapNode } from './types.ts'

const section = (id: string, name: string, topics: number): MapNode => ({
  id,
  name,
  code: id,
  rank: 'Section',
  items: Array.from({ length: topics }, (_, i) => `${name} topic ${i + 1}`),
})

// Shaped like the real map but small: 4 branches x 3 areas x 3 subjects x 4
// sections of 8 topics, with one subject (15-XX) given uneven sections.
const subject = (id: string, name: string, sections: MapNode[]): MapNode => ({
  id,
  name,
  code: id,
  rank: 'Subject',
  items: sections.map((s) => s.name),
  children: sections,
})
const BRANCHES = ['Algebra and number theory', 'Analysis', 'Geometry and topology', 'Applied mathematics']
const BRANCH_IDS = ['algebra', 'analysis', 'geometry', 'applied']
const TREE: MapNode = {
  id: 'mathematics',
  name: 'Mathematics',
  children: BRANCHES.map((branchName, b) => ({
    id: BRANCH_IDS[b],
    name: branchName,
    rank: 'Branch',
    children: [0, 1, 2].map((a) => ({
      id: b === 0 && a === 0 ? 'rings' : `area-${b}-${a}`,
      name: b === 0 && a === 0 ? 'Rings, fields and algebras' : `Area ${b}.${a}`,
      rank: 'Area',
      children: [0, 1, 2].map((s) =>
        b === 0 && a === 0 && s === 0
          ? subject('15-XX', 'Linear and multilinear algebra; matrix theory', [
              section('15Axx', 'Basic linear algebra', 32),
              section('15Bxx', 'Special matrices', 8),
              section('15Cxx', 'Matrix groups', 8),
              section('15Dxx', 'Odds and ends', 1),
            ])
          : subject(`${b}${a}${s}-XX`, `Subject ${b}.${a}.${s}`, [0, 1, 2, 3].map((n) => section(`${b}${a}${s}${'ABCD'[n]}xx`, `Section ${b}.${a}.${s}.${n}`, 8))),
      ),
    })),
  })),
}

const layout = layoutMap(TREE)
const get = (id: string) => layout.byId.get(id)!
const PHONE = { width: 375, height: 812 }
const AREA: Rect = { left: 0, top: 56, width: 375, height: 606 }
const distance = (a: Placed, b: Placed) => Math.hypot(a.x - b.x, a.y - b.y)

describe('layoutMap', () => {
  it('places every node once, parents before children', () => {
    expect(layout.all.map((n) => n.id)).toHaveLength(197)
    expect(layout.byId.size).toBe(197)
    for (const n of layout.all) if (n.parent) expect(layout.all.indexOf(n.parent)).toBeLessThan(layout.all.indexOf(n))
  })

  it('fills the world square with the root', () => {
    expect(layout.root.x).toBeCloseTo(WORLD / 2)
    expect(layout.root.y).toBeCloseTo(WORLD / 2)
    expect(layout.root.r).toBeCloseTo(WORLD / 2)
  })

  it('keeps every child inside its parent and siblings apart', () => {
    for (const n of layout.all) {
      if (n.parent) expect(distance(n, n.parent) + n.r).toBeLessThanOrEqual(n.parent.r + 1e-6)
      n.children.forEach((a, i) => n.children.slice(i + 1).forEach((b) => expect(distance(a, b)).toBeGreaterThanOrEqual(a.r + b.r - 1e-6)))
    }
  })

  it('sizes leaves by their number of topics', () => {
    // Area is proportional to topics: 32 topics against 8 is twice the radius.
    expect(get('15Axx').r / get('15Bxx').r).toBeCloseTo(2, 5)
    expect(get('15Axx').r).toBeGreaterThan(get('100Axx').r)
  })

  it('counts topics and leaves under leaves only', () => {
    // 15-XX's own `items` are its sections' names, not more topics.
    expect(get('15-XX').topics).toBe(49)
    expect(get('15-XX').leaves).toBe(4)
    expect(layout.root.topics).toBe(35 * 32 + 49)
    expect(layout.root.leaves).toBe(144)
    expect(get('15Dxx').leaves).toBe(1)
  })

  it('numbers branches in the source order, whatever their size', () => {
    expect(layout.root.branch).toBe(-1)
    expect(get('algebra').branch).toBe(0)
    expect(get('15Bxx').branch).toBe(0)
    // Reversing the source swaps the numbers even though sizes are unchanged.
    const swapped = layoutMap({ ...TREE, children: [...TREE.children!].reverse() })
    expect(swapped.byId.get('algebra')!.branch).toBe(3)
    expect(swapped.byId.get('100Axx')!.branch).toBe(2)
  })

  it('is deterministic', () => {
    const again = layoutMap(TREE)
    expect(again.all.map(({ id, x, y, r }) => [id, x, y, r])).toEqual(layout.all.map(({ id, x, y, r }) => [id, x, y, r]))
  })

  it('gives a topic-less leaf a size rather than none', () => {
    const lone = layoutMap({ id: 'root', name: 'Root', children: [{ id: 'a', name: 'A' }, section('b', 'B', 4)] })
    expect(lone.byId.get('a')!.r).toBeGreaterThan(0)
  })
})

describe('ancestry', () => {
  it('runs from the root down to the node', () => {
    expect(ancestry(get('15Axx')).map((n) => n.id)).toEqual(['mathematics', 'algebra', 'rings', '15-XX', '15Axx'])
    expect(ancestry(layout.root).map((n) => n.id)).toEqual(['mathematics'])
  })
})

describe('fitView', () => {
  it('centres the circle in the area and fits it to the short side', () => {
    const view = fitView({ x: 200, y: 300, r: 50 }, AREA, 12)
    expect(view.k).toBeCloseTo((375 - 24) / 100)
    expect(200 * view.k + view.x).toBeCloseTo(187.5)
    expect(300 * view.k + view.y).toBeCloseTo(56 + 303)
  })

  it('uses the height when the area is wide', () => {
    const view = fitView({ x: 0, y: 0, r: 10 }, { left: 0, top: 0, width: 800, height: 200 }, 0)
    expect(view.k).toBeCloseTo(10)
  })
})

describe('clampView', () => {
  const home = fitView(layout.root, AREA)

  it('leaves a sensible view alone', () => {
    expect(clampView(home, layout, PHONE)).toEqual(home)
  })

  it('limits zooming out and in', () => {
    const tiny = clampView({ k: home.k / 100, x: 0, y: 0 }, layout, PHONE)
    expect(tiny.k).toBeCloseTo((0.5 * 375) / WORLD)
    const smallest = Math.min(...layout.all.map((n) => n.r))
    const huge = clampView({ k: 1e9, x: 0, y: 0 }, layout, PHONE)
    expect(huge.k).toBeCloseTo((1.5 * 375) / (2 * smallest))
  })

  it('never lets the whole map leave the screen', () => {
    for (const [dx, dy] of [[1e6, 0], [-1e6, 0], [0, 1e6], [0, -1e6]]) {
      const view = clampView({ k: home.k, x: home.x + dx, y: home.y + dy }, layout, PHONE)
      const cx = layout.root.x * view.k + view.x
      const cy = layout.root.y * view.k + view.y
      const r = layout.root.r * view.k
      // Some of the root circle still overlaps the screen.
      expect(cx + r).toBeGreaterThan(0)
      expect(cx - r).toBeLessThan(PHONE.width)
      expect(cy + r).toBeGreaterThan(0)
      expect(cy - r).toBeLessThan(PHONE.height)
    }
  })
})

/** Tap the centre of a node under a view fitted to `focus`. */
const tapCentre = (target: Placed, focus: Placed, of: Layout = layout) => hitTest(of, target.x, target.y, fitView(focus, AREA).k, AREA)

describe('hitTest', () => {
  it('is null outside the map', () => {
    expect(hitTest(layout, -5, -5, 1, AREA)).toBeNull()
  })

  it('on the home view picks a branch, not the tiny section under the finger', () => {
    expect(tapCentre(get('15Axx'), layout.root)?.id).toBe('algebra')
    expect(tapCentre(get('100Axx'), layout.root)?.id).toBe('analysis')
  })

  it('steps one level down each time the focus opens up', () => {
    expect(tapCentre(get('15Axx'), get('algebra'))?.id).toBe('rings')
    expect(tapCentre(get('15Axx'), get('rings'))?.id).toBe('15-XX')
    expect(tapCentre(get('15Axx'), get('15-XX'))?.id).toBe('15Axx')
    expect(tapCentre(get('15Axx'), get('15Axx'))?.id).toBe('15Axx')
  })

  it('in the gap of an open node means that node, which is the way back out', () => {
    const subject = get('15-XX')
    const k = fitView(subject, AREA).k
    // Just inside the subject's edge on each side: find a spot in no section.
    const gap = [0, 1, 2, 3, 4, 5, 6, 7]
      .map((i) => ({ x: subject.x + subject.r * 0.97 * Math.cos(i), y: subject.y + subject.r * 0.97 * Math.sin(i) }))
      .find((p) => subject.children.every((c) => Math.hypot(p.x - c.x, p.y - c.y) > c.r))!
    expect(hitTest(layout, gap.x, gap.y, k, AREA)?.id).toBe('15-XX')
  })

  it('ignores children too small to hit with a finger', () => {
    const small = get('15Dxx')
    // A zoom at which the subject is open but 15Dxx is under a fingertip wide.
    const k = (MIN_TAP - 1) / (2 * small.r)
    expect(2 * get('15-XX').r * k).toBeGreaterThan(splitSize(AREA))
    expect(hitTest(layout, small.x, small.y, k, AREA)?.id).toBe('15-XX')
    // A little closer and it can be hit.
    expect(hitTest(layout, small.x, small.y, (MIN_TAP + 1) / (2 * small.r), AREA)?.id).toBe('15Dxx')
  })
})

describe('wrapLabel', () => {
  it('keeps short text on one line', () => {
    expect(wrapLabel('Analysis', 20, 3)).toEqual(['Analysis'])
  })

  it('breaks on spaces within the width', () => {
    expect(wrapLabel('Algebra and number theory', 12, 3)).toEqual(['Algebra and', 'number', 'theory'])
  })

  it('ends in an ellipsis when it runs out of lines', () => {
    const lines = wrapLabel('Linear and multilinear algebra; matrix theory', 12, 2)
    expect(lines).toEqual(['Linear and', 'multilinear…'])
    lines.forEach((line) => expect(line.length).toBeLessThanOrEqual(12))
  })

  it('cuts a word longer than the line', () => {
    expect(wrapLabel('Thermodynamics', 8, 2)).toEqual(['Thermod…'])
  })

  it('never exceeds the width or the line count', () => {
    const text = 'Numerical methods for partial differential equations, initial value and time-dependent problems'
    for (const width of [4, 7, 10, 16, 30]) {
      for (const lines of [1, 2, 4]) {
        const wrapped = wrapLabel(text, width, lines)
        expect(wrapped.length).toBeLessThanOrEqual(lines)
        wrapped.forEach((line) => expect(line.length).toBeLessThanOrEqual(width))
      }
    }
  })

  it('copes with empty text and silly limits', () => {
    expect(wrapLabel('', 10, 2)).toEqual([])
    expect(wrapLabel('Sets', 0, 0)).toEqual(['S…'])
  })
})

describe('shortCode', () => {
  it('drops the placeholder suffix', () => {
    expect(shortCode('15Axx')).toBe('15A')
    expect(shortCode('15-XX')).toBe('15')
  })
})

describe('pickLabels', () => {
  const labelsAt = (focus: Placed) => pickLabels(layout, fitView(focus, AREA), PHONE, AREA)

  it('names the branches on the home view and nothing inside them', () => {
    expect(labelsAt(layout.root).map((l) => l.id).sort()).toEqual(['algebra', 'analysis', 'applied', 'geometry'])
  })

  it('names the children of the focused node, not the node itself', () => {
    const ids = labelsAt(get('15-XX')).map((l) => l.id)
    expect(ids).toContain('15Axx')
    expect(ids).toContain('15Bxx')
    expect(ids).not.toContain('15-XX')
  })

  it('names a focused leaf', () => {
    const label = labelsAt(get('15Bxx')).find((l) => l.id === '15Bxx')!
    expect(label.kind).toBe('name')
    expect(label.leaf).toBe(true)
    expect(label.lines.join(' ')).toBe('Special matrices')
  })

  it('puts a label at its circle centre on screen', () => {
    const focus = get('15-XX')
    const view = fitView(focus, AREA)
    const label = pickLabels(layout, view, PHONE, AREA).find((l) => l.id === '15Axx')!
    expect(label.x).toBeCloseTo(get('15Axx').x * view.k + view.x)
    expect(label.y).toBeCloseTo(get('15Axx').y * view.k + view.y)
  })

  it('never labels a node inside another labelled node', () => {
    for (const focus of layout.all) {
      const ids = new Set(labelsAt(focus).map((l) => l.id))
      for (const id of ids) for (const above of ancestry(get(id)).slice(0, -1)) expect(ids.has(above.id)).toBe(false)
    }
  })

  it('skips what is off screen', () => {
    // Zoomed far into one section: the other branch is nowhere near.
    expect(labelsAt(get('15Bxx')).map((l) => l.id)).not.toContain('analysis')
  })

  it('falls back to the short code when a coded circle is too small for a name', () => {
    const small = get('15Dxx')
    const k = (MIN_NAME - 4) / (2 * small.r)
    const view = { k, x: PHONE.width / 2 - small.x * k, y: PHONE.height / 2 - small.y * k }
    const label = pickLabels(layout, view, PHONE, AREA).find((l) => l.id === '15Dxx')!
    expect(label.kind).toBe('code')
    expect(label.lines).toEqual(['15D'])
  })

  it('still names a small uncoded region, which has no code to fall back on', () => {
    // The real home view on a phone: "Logic and discrete mathematics" is a
    // branch too small for a fitted name, and a branch has no code.
    const lopsided = layoutMap({
      id: 'root',
      name: 'Root',
      children: [
        { id: 'big', name: 'Big branch', rank: 'Branch', children: [section('90Axx', 'Big', 30), section('90Bxx', 'Big too', 30), section('90Cxx', 'Big three', 30)] },
        { id: 'logic', name: 'Logic and discrete mathematics', rank: 'Branch', children: [section('03Axx', 'Small', 2)] },
      ],
    })
    const view = fitView(lopsided.root, AREA)
    const size = 2 * lopsided.byId.get('logic')!.r * view.k
    expect(size).toBeGreaterThan(34)
    expect(size).toBeLessThan(MIN_NAME)
    const label = pickLabels(lopsided, view, PHONE, AREA).find((l) => l.id === 'logic')!
    expect(label.kind).toBe('name')
    expect(label.lines.join(' ')).toBe('Logic and discrete mathematics')
  })

  it('keeps name labels inside their circle', () => {
    for (const focus of layout.all) {
      const view = fitView(focus, AREA)
      for (const label of pickLabels(layout, view, PHONE, AREA)) {
        const size = 2 * get(label.id).r * view.k
        if (label.kind !== 'name' || size < MIN_NAME) continue
        const widest = Math.max(...label.lines.map((line) => line.length)) * label.fontSize * 0.52
        expect(widest).toBeLessThanOrEqual(size)
        expect(label.lines.length * label.fontSize * 1.18).toBeLessThanOrEqual(size)
      }
    }
  })
})
