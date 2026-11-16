// The logic of an order (puzzle) screen, apart from the screen: the shuffled start, moving a
// line, and grading. Pure.
//
// Progress encoding (also documented on OrderBlock): values of an attempt and of the draft are
// { order: "s2,s1,s3", seed: "k3x9" }: every item id, fixed ones included, in the order shown.
//
// A fixed line stays in the place it has in `items`; the others are the "movable" lines and
// only ever trade places with each other.

import { seededShuffle } from './seed.ts'
import type { OrderBlock } from './types.ts'

/** Wrong tries after which "Show the answer" appears. */
export const ORDER_REVEAL_AFTER = 3

export const correctOrder = (block: OrderBlock): string[] => block.items.map((i) => i.id)

const isFixed = (block: OrderBlock, id: string) => block.fixed?.includes(id) ?? false

/** The positions (indexes) the movable lines can take: every position not held by a fixed line. */
function movableSlots(block: OrderBlock): number[] {
  return block.items.flatMap((item, i) => (isFixed(block, item.id) ? [] : [i]))
}

/**
 * The order a screen starts in for this seed: fixed lines in place, the rest shuffled, and never
 * the correct order (a puzzle that opens solved is no puzzle).
 */
export function initialOrder(block: OrderBlock, seed: string): string[] {
  const slots = movableSlots(block)
  const right = slots.map((i) => block.items[i].id)
  let shuffled = seededShuffle(right, seed)
  if (shuffled.every((id, i) => id === right[i])) shuffled = [...right.slice(1), right[0]]
  const order = block.items.map((i) => i.id)
  slots.forEach((slot, k) => {
    order[slot] = shuffled[k]
  })
  return order
}

/**
 * The stored order if it is a permutation of the block's lines with the fixed ones in place,
 * else null (the content changed since, so the caller starts again from the seed).
 */
export function parseOrder(block: OrderBlock, values: Record<string, string> | undefined): string[] | null {
  const ids = (values?.order ?? '').split(',').filter(Boolean)
  const right = correctOrder(block)
  if (ids.length !== right.length || new Set(ids).size !== ids.length || !ids.every((id) => right.includes(id))) return null
  if (!right.every((id, i) => !isFixed(block, id) || ids[i] === id)) return null
  return ids
}

export const orderValues = (order: readonly string[], seed: string): Record<string, string> => ({ order: order.join(','), seed })

/** The slot index a line would move to, or null when it cannot (fixed, or already at that end). */
function target(block: OrderBlock, order: readonly string[], id: string, direction: -1 | 1): { from: number; to: number } | null {
  if (isFixed(block, id)) return null
  const slots = movableSlots(block)
  const from = order.indexOf(id)
  const k = slots.indexOf(from)
  const to = slots[k + direction]
  return k < 0 || to === undefined ? null : { from, to }
}

export const canMove = (block: OrderBlock, order: readonly string[], id: string, direction: -1 | 1): boolean =>
  target(block, order, id, direction) !== null

/** `id` swaps places with the next movable line up (-1) or down (1); a fixed line never moves. */
export function move(block: OrderBlock, order: readonly string[], id: string, direction: -1 | 1): string[] {
  const t = target(block, order, id, direction)
  if (!t) return [...order]
  const out = [...order]
  ;[out[t.from], out[t.to]] = [out[t.to], out[t.from]]
  return out
}

export type OrderVerdict =
  | { status: 'correct' }
  /** The first line, from the top, that is not where it belongs; and what to say about it. */
  | { status: 'wrong'; firstOut: string; position: number; say: string }

export const GENERIC_NUDGE = 'The line marked is not where it belongs yet.'

/** Right when every line is in place. Wrong marks one line only: a hint, not the answer. */
export function gradeOrder(block: OrderBlock, order: readonly string[]): OrderVerdict {
  const right = correctOrder(block)
  const position = right.findIndex((id, i) => order[i] !== id)
  if (position < 0) return { status: 'correct' }
  const firstOut = order[position]
  return { status: 'wrong', firstOut, position, say: block.say?.[firstOut] ?? GENERIC_NUDGE }
}
