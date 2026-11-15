// The map's geometry, with no React and no DOM in it, so every rule here can be
// unit-tested and the renderer (SVG today) can be swapped without touching it.
//
// Two coordinate systems: **world** (the packed circles, in a fixed
// WORLD x WORLD square) and **screen** (CSS pixels). A `View` maps one to the
// other: screen = world * k + (x, y).

import { hierarchy, pack } from 'd3-hierarchy'
import type { MapNode } from './types.ts'

export const WORLD = 1000

export interface Placed {
  id: string
  node: MapNode
  parent: Placed | null
  children: Placed[]
  depth: number
  /** Index of the top-level branch this sits in; -1 for the root. */
  branch: number
  x: number
  y: number
  r: number
  /** Topics under this node: a leaf's own, or the sum over its leaves. */
  topics: number
  /** Leaves (MSC sections) under this node; 1 for a leaf. */
  leaves: number
}

export interface Layout {
  root: Placed
  /** Every node, parents before children. */
  all: Placed[]
  byId: Map<string, Placed>
}

export interface View {
  k: number
  x: number
  y: number
}

export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

/** A leaf's size on the map: its topic count, so big fields look big. */
export const leafValue = (node: MapNode) => Math.max(1, node.items?.length ?? 0)

// Gap between sibling circles, by the parent's depth, in world units. Wider at
// the top so the five branches read as separate countries.
const PADDING = [14, 7, 4, 2.5, 1.5]

/** Pack the tree into circles. Deterministic for a given tree. */
export function layoutMap(root: MapNode): Layout {
  const packed = pack<MapNode>()
    .size([WORLD, WORLD])
    .padding((d) => PADDING[Math.min(d.depth, PADDING.length - 1)])(
    hierarchy(root)
      .sum((node) => (node.children?.length ? 0 : leafValue(node)))
      // Biggest first: d3's packing is tighter, and the order is stable.
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0) || a.data.id.localeCompare(b.data.id)),
  )

  const all: Placed[] = []
  const byId = new Map<string, Placed>()
  const place = (d: typeof packed, parent: Placed | null, branch: number): Placed => {
    const placed: Placed = {
      id: d.data.id,
      node: d.data,
      parent,
      children: [],
      depth: d.depth,
      branch,
      x: d.x,
      y: d.y,
      r: d.r,
      topics: d.value ?? 0,
      leaves: 0,
    }
    all.push(placed)
    byId.set(placed.id, placed)
    // Branch numbers follow the source's order, not the packing's, so a
    // branch keeps its colour whatever its size.
    const sourceOrder = d.data.children ?? []
    placed.children = (d.children ?? []).map((child) =>
      place(child, placed, d.depth === 0 ? sourceOrder.indexOf(child.data) : branch),
    )
    placed.leaves = placed.children.length ? placed.children.reduce((sum, c) => sum + c.leaves, 0) : 1
    return placed
  }
  return { root: place(packed, null, -1), all, byId }
}

/** The node and everything above it, root first. */
export function ancestry(node: Placed): Placed[] {
  const path: Placed[] = []
  for (let at: Placed | null = node; at; at = at.parent) path.unshift(at)
  return path
}

/** The view that centres a circle in `area` and makes it fill the short side. */
export function fitView(circle: { x: number; y: number; r: number }, area: Rect, margin = 12): View {
  const k = Math.max(1, Math.min(area.width, area.height) - 2 * margin) / (2 * circle.r)
  return {
    k,
    x: area.left + area.width / 2 - circle.x * k,
    y: area.top + area.height / 2 - circle.y * k,
  }
}

/** Keep a view sane: zoom within limits and the map never wholly off screen. */
export function clampView(view: View, layout: Layout, screen: { width: number; height: number }): View {
  const short = Math.max(1, Math.min(screen.width, screen.height))
  const smallest = layout.all.reduce((min, n) => Math.min(min, n.r), layout.root.r)
  const kMin = (0.5 * short) / (2 * layout.root.r)
  const kMax = (1.5 * short) / (2 * smallest)
  const k = Math.min(kMax, Math.max(kMin, view.k))
  // If the zoom was limited, keep the screen centre fixed rather than drifting.
  const cx = screen.width / 2
  const cy = screen.height / 2
  let x = view.k === k ? view.x : cx - ((cx - view.x) / view.k) * k
  let y = view.k === k ? view.y : cy - ((cy - view.y) / view.k) * k
  // The root's centre stays within a root-radius of the screen, so some of
  // the map is always visible.
  const reach = layout.root.r * k
  const rootX = layout.root.x * k + x
  const rootY = layout.root.y * k + y
  x += Math.min(0, screen.width + reach * 0.6 - rootX) + Math.max(0, -reach * 0.6 - rootX)
  y += Math.min(0, screen.height + reach * 0.6 - rootY) + Math.max(0, -reach * 0.6 - rootY)
  return { k, x, y }
}

/**
 * A node is drawn "opened up" (its children are the things you read and tap)
 * once it is this many pixels across; below that it is one thing with one
 * label. Tied to the free map area so that the focused node, which fitView
 * makes nearly as wide as the area, is always open.
 */
export const splitSize = (area: Rect) => 0.55 * Math.min(area.width, area.height)

/** Smallest circle that takes a tap, in pixels across: about a fingertip. */
export const MIN_TAP = 28

/**
 * Which node a tap at a world point means: the deepest node there that is
 * shown as one thing. Null outside the map.
 *
 * It follows the same rule as the labels, so what you tap is what is named:
 * walk down while the node is opened up and a big-enough child is under the
 * finger. A tap in the gaps of an open node means that node, which is how you
 * step back out.
 */
export function hitTest(layout: Layout, wx: number, wy: number, k: number, area: Rect): Placed | null {
  const inside = (n: Placed) => (wx - n.x) ** 2 + (wy - n.y) ** 2 <= n.r ** 2
  if (!inside(layout.root)) return null
  const split = splitSize(area)
  let at = layout.root
  while (at.children.length && 2 * at.r * k >= split) {
    const child = at.children.find((c) => inside(c) && 2 * c.r * k >= MIN_TAP)
    if (!child) break
    at = child
  }
  return at
}

export interface Label {
  id: string
  /** Screen position of the label's centre. */
  x: number
  y: number
  /** `name`: wrapped lines of the node's name. `code`: just its short code. */
  kind: 'name' | 'code'
  lines: string[]
  fontSize: number
  leaf: boolean
}

/** Circles narrower than this get a short code instead of a name, if any. */
export const MIN_NAME = 52
const MIN_CODE = 26
const MIN_UNCODED = 34

/** `15Axx` -> `15A`, `15-XX` -> `15`: what a mathematician calls the code. */
export const shortCode = (code: string) => code.replace(/(-XX|xx)$/, '')

/**
 * Break a name into at most `maxLines` lines of at most `maxChars`, on spaces.
 * A word that is too long, or text that runs out of lines, ends in an ellipsis.
 */
export function wrapLabel(text: string, maxChars: number, maxLines: number): string[] {
  const width = Math.max(2, Math.floor(maxChars))
  const limit = Math.max(1, Math.floor(maxLines))
  const lines: string[] = []
  let line = ''
  let cut = false
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const joined = line ? `${line} ${word}` : word
    if (joined.length <= width) {
      line = joined
      continue
    }
    if (line) lines.push(line)
    if (lines.length === limit) {
      cut = true
      line = ''
      break
    }
    line = word.length <= width ? word : word.slice(0, width - 1) + '…'
  }
  if (line) lines.push(line)
  if (lines.length > limit) {
    lines.length = limit
    cut = true
  }
  if (cut) {
    const last = lines[limit - 1].replace(/[\s,;:]+$/, '')
    lines[limit - 1] = last.endsWith('…') ? last : (last.length >= width ? last.slice(0, width - 1) : last) + '…'
  }
  return lines
}

/**
 * The labels to draw for a view: one per node that is on screen and shown as
 * one thing (see splitSize), named if it is wide enough, coded if it is small
 * but has a code, unlabelled below that.
 *
 * Labelled nodes never contain one another, and each label is fitted inside
 * its own circle, so labels cannot overlap.
 */
export function pickLabels(layout: Layout, view: View, screen: { width: number; height: number }, area: Rect): Label[] {
  const labels: Label[] = []
  const split = splitSize(area)
  const visit = (n: Placed) => {
    const r = n.r * view.k
    const x = n.x * view.k + view.x
    const y = n.y * view.k + view.y
    if (x + r < 0 || y + r < 0 || x - r > screen.width || y - r > screen.height) return
    const size = 2 * r
    if (n.children.length && size >= split) {
      n.children.forEach(visit)
      return
    }
    const leaf = !n.children.length
    if (size >= MIN_NAME) {
      const fontSize = Math.min(16, Math.max(10.5, size / 8.5))
      // 0.52em is a safe average glyph width for the UI font.
      const maxChars = (size * 0.86) / (fontSize * 0.52)
      const maxLines = Math.min(4, Math.max(1, Math.floor((size * 0.62) / (fontSize * 1.18))))
      labels.push({ id: n.id, x, y, kind: 'name', lines: wrapLabel(n.node.name, maxChars, maxLines), fontSize, leaf })
    } else if (size >= MIN_CODE && n.node.code) {
      labels.push({ id: n.id, x, y, kind: 'code', lines: [shortCode(n.node.code)], fontSize: Math.min(11, Math.max(9, size / 3.4)), leaf })
    } else if (size >= MIN_UNCODED && !n.node.code) {
      // A branch or area has no code to fall back on, and on a phone the
      // smallest branch ("Logic and discrete mathematics") is under MIN_NAME
      // on the home view. Its name is allowed to spill a little past its
      // circle rather than leave a top-level region anonymous.
      const fontSize = 10.5
      labels.push({ id: n.id, x, y, kind: 'name', lines: wrapLabel(n.node.name, Math.max(12, (size * 1.5) / (fontSize * 0.52)), 3), fontSize, leaf })
    }
  }
  visit(layout.root)
  return labels
}
