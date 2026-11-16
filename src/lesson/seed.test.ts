import { describe, expect, it } from 'vitest'
import { newSeed, seededShuffle } from './seed.ts'

describe('seededShuffle', () => {
  const items = ['a', 'b', 'c', 'd', 'e', 'f']

  it('gives the same order for the same seed, and leaves its input alone', () => {
    const copy = [...items]
    expect(seededShuffle(items, 'k3x9')).toEqual(seededShuffle(items, 'k3x9'))
    expect(items).toEqual(copy)
  })

  it('keeps every item exactly once', () => {
    for (const seed of ['1', '2', 'abc', 'zzz']) expect([...seededShuffle(items, seed)].sort()).toEqual(items)
  })

  it('differs between seeds (not all the same over many)', () => {
    const orders = new Set(Array.from({ length: 30 }, (_, i) => seededShuffle(items, `seed${i}`).join('')))
    expect(orders.size).toBeGreaterThan(10)
  })

  it('handles empty and single lists', () => {
    expect(seededShuffle([], 'x')).toEqual([])
    expect(seededShuffle(['a'], 'x')).toEqual(['a'])
  })
})

describe('newSeed', () => {
  it('is a short string and follows the generator it is given', () => {
    expect(newSeed(() => 0)).toBe('0')
    expect(newSeed(() => 0.5)).toBe(newSeed(() => 0.5))
    expect(newSeed(() => 0.999999)).toMatch(/^[0-9a-z]{1,8}$/)
  })
})
