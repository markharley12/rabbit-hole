import { describe, expect, it } from 'vitest'
import { GENERIC_NUDGE, canMove, correctOrder, gradeOrder, initialOrder, move, orderValues, parseOrder } from './order.ts'
import { canShowAnswerAfterTries } from './reveal.ts'
import type { OrderBlock } from './types.ts'

const block: OrderBlock = {
  type: 'order',
  id: 'p',
  prompt: 'Order these.',
  items: ['s1', 's2', 's3', 's4', 's5'].map((id) => ({ id, text: `line ${id}` })),
  say: { s3: 'what must come before s3?' },
  next: 'On',
}
const withFixed: OrderBlock = { ...block, fixed: ['s1', 's5'] }

describe('initialOrder', () => {
  it('is never the correct order, for many seeds and both shapes', () => {
    for (const b of [block, withFixed]) {
      for (let i = 0; i < 200; i++) expect(initialOrder(b, `seed${i}`)).not.toEqual(correctOrder(b))
    }
  })

  it('is the same for the same seed and a permutation of the lines', () => {
    expect(initialOrder(block, 'k')).toEqual(initialOrder(block, 'k'))
    expect([...initialOrder(block, 'k')].sort()).toEqual(correctOrder(block))
  })

  it('leaves fixed lines in place', () => {
    for (let i = 0; i < 50; i++) {
      const order = initialOrder(withFixed, `seed${i}`)
      expect(order[0]).toBe('s1')
      expect(order[4]).toBe('s5')
    }
  })

  it('with three movable lines can still never open solved', () => {
    const three: OrderBlock = { ...block, items: block.items.slice(0, 3), fixed: undefined }
    for (let i = 0; i < 100; i++) expect(initialOrder(three, `s${i}`)).not.toEqual(['s1', 's2', 's3'])
  })
})

describe('the stored order', () => {
  it('reads back a permutation with the fixed lines in place', () => {
    expect(parseOrder(withFixed, orderValues(['s1', 's3', 's2', 's4', 's5'], 'k'))).toEqual(['s1', 's3', 's2', 's4', 's5'])
  })

  it('refuses anything that no longer fits the block', () => {
    expect(parseOrder(block, undefined)).toBeNull()
    expect(parseOrder(block, { order: 's1,s2,s3' })).toBeNull()
    expect(parseOrder(block, { order: 's1,s1,s3,s4,s5' })).toBeNull()
    expect(parseOrder(block, { order: 's1,s2,s3,s4,zz' })).toBeNull()
    expect(parseOrder(withFixed, { order: 's2,s1,s3,s4,s5' })).toBeNull()
  })
})

describe('move', () => {
  const order = ['s2', 's4', 's1', 's3', 's5']

  it('swaps a line with its neighbour', () => {
    expect(move(block, order, 's4', -1)).toEqual(['s4', 's2', 's1', 's3', 's5'])
    expect(move(block, order, 's4', 1)).toEqual(['s2', 's1', 's4', 's3', 's5'])
  })

  it('cannot go past either end', () => {
    expect(canMove(block, order, 's2', -1)).toBe(false)
    expect(canMove(block, order, 's5', 1)).toBe(false)
    expect(move(block, order, 's2', -1)).toEqual(order)
    expect(canMove(block, order, 's2', 1)).toBe(true)
  })

  it('never moves a fixed line, and moving past one trades with the next movable line', () => {
    const fixedMiddle: OrderBlock = { ...block, fixed: ['s3'] }
    const shown = ['s2', 's4', 's3', 's1', 's5']
    expect(canMove(fixedMiddle, shown, 's3', -1)).toBe(false)
    expect(canMove(fixedMiddle, shown, 's3', 1)).toBe(false)
    expect(move(fixedMiddle, shown, 's4', 1)).toEqual(['s2', 's1', 's3', 's4', 's5'])
    expect(move(fixedMiddle, shown, 's1', -1)).toEqual(['s2', 's1', 's3', 's4', 's5'])
  })

  it('stops at the movable lines next to fixed ends', () => {
    const shown = ['s1', 's3', 's2', 's4', 's5']
    expect(canMove(withFixed, shown, 's3', -1)).toBe(false)
    expect(canMove(withFixed, shown, 's4', 1)).toBe(false)
    expect(canMove(withFixed, shown, 's2', -1)).toBe(true)
  })

  it('leaves its input alone', () => {
    const copy = [...order]
    move(block, order, 's4', -1)
    expect(order).toEqual(copy)
  })
})

describe('gradeOrder', () => {
  it('is right only for the written order', () => {
    expect(gradeOrder(block, correctOrder(block))).toEqual({ status: 'correct' })
  })

  it('marks the first line out of place, from the top, and only that one', () => {
    expect(gradeOrder(block, ['s1', 's2', 's4', 's3', 's5'])).toEqual({ status: 'wrong', firstOut: 's4', position: 2, say: GENERIC_NUDGE })
    // Everything is off after the first slip, but only the first is named.
    expect(gradeOrder(block, ['s2', 's1', 's4', 's3', 's5'])).toMatchObject({ firstOut: 's2', position: 0 })
  })

  it("says that line's own nudge when it has one", () => {
    expect(gradeOrder(block, ['s1', 's2', 's3', 's5', 's4'])).toMatchObject({ firstOut: 's5', say: GENERIC_NUDGE })
    expect(gradeOrder(block, ['s1', 's2', 's5', 's4', 's3'])).toMatchObject({ firstOut: 's5' })
    expect(gradeOrder(block, ['s3', 's1', 's2', 's4', 's5'])).toMatchObject({ firstOut: 's3', say: 'what must come before s3?' })
  })

  it('never blames a fixed line', () => {
    for (let i = 0; i < 50; i++) {
      const verdict = gradeOrder(withFixed, initialOrder(withFixed, `s${i}`))
      expect(verdict.status).toBe('wrong')
      if (verdict.status === 'wrong') expect(['s1', 's5']).not.toContain(verdict.firstOut)
    }
  })
})

describe('when the answer is offered', () => {
  const record = (attempts: number, extra = {}) => ({ attempts, solved: false, hints: 0, log: [], ...extra })

  it('only after the wrong tries, and never once solved or shown', () => {
    expect(canShowAnswerAfterTries(undefined, 3)).toBe(false)
    expect(canShowAnswerAfterTries(record(2), 3)).toBe(false)
    expect(canShowAnswerAfterTries(record(3), 3)).toBe(true)
    expect(canShowAnswerAfterTries(record(5, { solved: true }), 3)).toBe(false)
    expect(canShowAnswerAfterTries(record(5, { revealed: true }), 3)).toBe(false)
    expect(canShowAnswerAfterTries(record(2), 2)).toBe(true)
  })
})
