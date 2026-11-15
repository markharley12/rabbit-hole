import { describe, expect, it } from 'vitest'
import { check, nice } from './check.ts'
import type { Answer } from './types.ts'

// The answers are Mark's worked example from the seed chat (docs/seed-context.md
// sections 3 and 4): points (1,1), (2,2), (3,6), fit y = c + mx.
const AtA: Answer = {
  fields: [
    { name: 'a11', key: '3' },
    { name: 'a12', key: '6' },
    { name: 'a21', key: '6' },
    { name: 'a22', key: '14' },
  ],
  matrix: [2, 2],
  verify: 'tr(A1)*A1',
  slips: [{ detect: 'symmetric', name: 'AᵀA' }, { detect: 'transpose' }],
}
const matrix = (a: string, b: string, c: string, d: string) => ({ a11: a, a12: b, a21: c, a22: d })

const solve: Answer = {
  fields: [
    { name: 'c', label: '$c$ =', key: '-2' },
    { name: 'm', label: '$m$ =', key: '5/2' },
  ],
  verify: 'pinv(A1)*b',
  slips: [
    { detect: 'known', when: { m: '5/12' }, say: 'The 6 in 6(3 − 2m) multiplies both terms.' },
    { detect: 'swapped' },
  ],
}

const residual: Answer = {
  fields: [
    { name: 'r1', key: '1/2' },
    { name: 'r2', key: '-1' },
    { name: 'r3', key: '1/2' },
  ],
  accept: ['negated'],
  acceptNote: 'That is fit − data; fine, it is −r.',
  verify: 'b - A1*pinv(A1)*b',
}

describe('check', () => {
  it('accepts the key in any form that equals it', () => {
    expect(check(solve, { c: '-2', m: '2.5' })).toEqual({ status: 'correct', via: 'key' })
    expect(check(solve, { c: '−2', m: '5/2' })).toEqual({ status: 'correct', via: 'key' })
    expect(check(solve, { c: '-4/2', m: '10/4' }).status).toBe('correct')
  })

  it('waits for every box, and says which one it cannot read', () => {
    expect(check(solve, { c: '-2', m: ' ' })).toEqual({ status: 'incomplete', missing: ['m'] })
    expect(check(solve, { c: '-2', m: '2..5' })).toMatchObject({ status: 'unreadable', field: 'm' })
    expect(check(solve, { c: '-2', m: '1/0' })).toMatchObject({ status: 'unreadable', field: 'm' })
  })

  it('names the AᵀA that is not symmetric, with his entries (12 and 1)', () => {
    const verdict = check(AtA, matrix('3', '12', '1', '14'))
    expect(verdict).toMatchObject({ status: 'wrong', slip: 'symmetric' })
    expect(verdict.status === 'wrong' && verdict.message).toBe(
      'AᵀA equals its own transpose, so row 1, column 2 and row 2, column 1 should match. You have 12 and 1.',
    )
  })

  it('names the entry with a sum slip and says the rest are right', () => {
    const Atb: Answer = {
      fields: [
        { name: 'v1', key: '9' },
        { name: 'v2', key: '23' },
      ],
      verify: 'tr(A1)*b',
    }
    // 1·1 + 2·2 + 3·6 added up wrong.
    expect(check(Atb, { v1: '9', v2: '21' })).toEqual({ status: 'wrong', message: 'Entry 2 is off; the other one is right.', off: ['v2'] })
    expect(check(AtA, matrix('3', '6', '6', '13'))).toMatchObject({ message: 'Row 2, column 2 is off; the rest are right.', off: ['a22'] })
    // Nothing right: no pretend precision.
    expect(check(Atb, { v1: '1', v2: '2' })).toEqual({ status: 'wrong', message: undefined, off: ['v1', 'v2'] })
  })

  it('names the factor applied to one term only (6(3 − 2m) as 18 − 2m)', () => {
    expect(check(solve, { c: '13/6', m: '5/12' })).toMatchObject({ status: 'wrong', slip: 'known', message: 'The 6 in 6(3 − 2m) multiplies both terms.' })
  })

  it('accepts r as fit − data, and says so', () => {
    expect(check(residual, { r1: '-0.5', r2: '1', r3: '-0.5' })).toEqual({ status: 'correct', via: 'negated', note: 'That is fit − data; fine, it is −r.' })
  })

  it('spots swapped boxes, a transpose, a common factor and a flipped sign', () => {
    expect(check(solve, { c: '5/2', m: '-2' })).toMatchObject({ slip: 'swapped' })

    const A: Answer = {
      fields: [
        { name: 'a11', key: '1' },
        { name: 'a12', key: '1' },
        { name: 'a21', key: '1' },
        { name: 'a22', key: '2' },
        { name: 'a31', key: '1' },
        { name: 'a32', key: '3' },
      ],
      matrix: [3, 2],
      verify: 'A1',
      slips: [{ detect: 'scaled' }],
    }
    expect(check(A, { a11: '15', a12: '15', a21: '15', a22: '30', a31: '15', a32: '45' })).toMatchObject({
      slip: 'scaled',
      message: 'Every entry is off by the same factor (yours are ×15 the right ones). Check the number out front.',
    })

    const square: Answer = {
      fields: [
        { name: 'a11', key: '1' },
        { name: 'a12', key: '2' },
        { name: 'a21', key: '3' },
        { name: 'a22', key: '4' },
      ],
      matrix: [2, 2],
      verify: 'M',
      slips: [{ detect: 'transpose', name: 'Aᵀ' }],
    }
    expect(check(square, { a11: '1', a12: '3', a21: '2', a22: '4' })).toMatchObject({
      slip: 'transpose',
      message: "Rows and columns are swapped: that's the transpose of Aᵀ.",
    })

    const signed: Answer = { ...residual, accept: [], slips: [{ detect: 'sign' }] }
    expect(check(signed, { r1: '-1/2', r2: '1', r3: '-1/2' })).toMatchObject({ slip: 'sign' })
  })

  it('does not call a symmetric key transposed', () => {
    // AᵀA is symmetric, so its transpose is itself: right, not a slip.
    expect(check(AtA, matrix('3', '6', '6', '14'))).toEqual({ status: 'correct', via: 'key' })
  })

  it('accepts a rounded decimal with two or more places, not a bare whole number', () => {
    const sigma: Answer = { fields: [{ name: 's', key: 'sqrt(15)' }], verify: 'sv(A2, 1)' }
    expect(check(sigma, { s: '3.87' }).status).toBe('correct')
    expect(check(sigma, { s: '3.873' }).status).toBe('correct')
    expect(check(sigma, { s: '√15' }).status).toBe('correct')
    expect(check(sigma, { s: '4' }).status).toBe('wrong')
    expect(check(sigma, { s: '3.9' }).status).toBe('wrong')
    // The tolerance is the last place, not a percentage of the key.
    const big: Answer = { fields: [{ name: 'v', key: '23' }], verify: '23' }
    expect(check(big, { v: '22.99' }).status).toBe('wrong')
  })

  it('accepts any non-zero multiple when the answer is a direction', () => {
    const direction: Answer = {
      fields: [
        { name: 'w1', key: '1' },
        { name: 'w2', key: '-3' },
        { name: 'w3', key: '0' },
      ],
      accept: ['multiple'],
      verify: 'nullvec(C5)',
    }
    expect(check(direction, { w1: '-2', w2: '6', w3: '0' })).toMatchObject({ status: 'correct', via: 'multiple' })
    expect(check(direction, { w1: '1/sqrt(10)', w2: '-3/sqrt(10)', w3: '0' }).status).toBe('correct')
    expect(check(direction, { w1: '0', w2: '0', w3: '0' }).status).toBe('wrong')
    expect(check(direction, { w1: '1', w2: '3', w3: '0' }).status).toBe('wrong')
  })

  it('compares expressions by value, and still names a known slip in one', () => {
    const expand: Answer = {
      fields: [{ name: 'f', key: '5m^2 - 12m + 9' }],
      vars: ['m'],
      verify: 'expand((3 - 2*m)^2 + m^2)',
      slips: [{ detect: 'known', when: { f: '5m^2 + 9' }, say: '(3 − 2m)² has a middle term.' }],
    }
    expect(check(expand, { f: '(3-2m)^2 + m^2' }).status).toBe('correct')
    expect(check(expand, { f: '9 - 12m + 5m²' }).status).toBe('correct')
    expect(check(expand, { f: '5m^2 + 9' })).toMatchObject({ slip: 'known' })
    expect(check(expand, { f: '5m^2 - 6m + 9' }).status).toBe('wrong')
    expect(check(expand, { f: '5c^2' })).toMatchObject({ status: 'unreadable' })
  })

  it('writes factors short', () => {
    expect(nice(15)).toBe('15')
    expect(nice(-0.5)).toBe('-1/2')
    expect(nice(Math.sqrt(2))).toBe('1.41')
  })
})
