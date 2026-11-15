import { describe, expect, it } from 'vitest'
import { HISTORY_MAX, enter, insertResult, read } from './calculator.ts'

describe('reading a line', () => {
  it('shows the result with a simple fraction', () => {
    expect(read('3/5')).toEqual({ kind: 'ok', shown: '0.6 (3/5)', plain: '0.6' })
    expect(read('1*1 + 2*2 + 3*6')).toEqual({ kind: 'ok', shown: '23', plain: '23' })
  })

  it('treats nothing as empty and half-typed input as partial, not an error', () => {
    expect(read('  ')).toEqual({ kind: 'empty' })
    expect(read('2 +')).toEqual({ kind: 'partial' })
    expect(read('2 (')).toEqual({ kind: 'partial' })
  })
})

describe('the history', () => {
  it('keeps entered lines, most recent last', () => {
    const h = enter(enter([], '1+1'), ' 2*3 ')
    expect(h.map((l) => [l.text, l.plain])).toEqual([
      ['1+1', '2'],
      ['2*3', '6'],
    ])
  })

  it('ignores empty and half-typed lines (same list back)', () => {
    const h = enter([], '1+1')
    expect(enter(h, '')).toBe(h)
    expect(enter(h, '2 +')).toBe(h)
  })

  it('keeps the last 20', () => {
    let h = enter([], '0+0')
    for (let i = 1; i <= HISTORY_MAX + 4; i++) h = enter(h, `${i}+0`)
    expect(h).toHaveLength(HISTORY_MAX)
    expect(h[0].text).toBe('5+0')
    expect(h[h.length - 1].text).toBe(`${HISTORY_MAX + 4}+0`)
  })

  it('puts a result at the end of the input, negatives in brackets', () => {
    expect(insertResult('', '0.6')).toBe('0.6')
    expect(insertResult('2*', '0.6')).toBe('2*0.6')
    expect(insertResult('5 - ', '-3')).toBe('5 - (-3)')
  })
})
