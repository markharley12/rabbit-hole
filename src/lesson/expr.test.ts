import { describe, expect, it } from 'vitest'
import { decimalPlaces, evaluate, numberOf, parse, ParseError } from './expr.ts'

describe('the answer grammar', () => {
  it.each([
    ['2', 2],
    ['-3', -3],
    ['0.6', 0.6],
    ['.5', 0.5],
    ['3/5', 0.6],
    ['5/2', 2.5],
    ['−2', -2],
    ['2 + 3*4', 14],
    ['2^3', 8],
    ['2^-1', 0.5],
    ['-2^2', -4],
    ['(1+2)(3+4)', 21],
    ['2sqrt(5)', 2 * Math.sqrt(5)],
    ['sqrt(15)', Math.sqrt(15)],
    ['√15', Math.sqrt(15)],
    ['√(3)/3', Math.sqrt(3) / 3],
    ['1/sqrt(5)', 1 / Math.sqrt(5)],
    ['3×4', 12],
    ['3·4', 12],
    ['2**3', 8],
    ['3²', 9],
    ['0,6', 0.6],
    ['1 - 2/3', 1 / 3],
  ])('reads %s', (text, value) => {
    expect(numberOf(text)).toBeCloseTo(value, 12)
  })

  it('reads expressions in the letters a step declares', () => {
    const tree = parse('3 - 2m', ['m'])
    expect(evaluate(tree, { m: 1.2 })).toBeCloseTo(0.6, 12)
    expect(evaluate(parse('5m^2 - 12m + 9', ['m']), { m: 2 })).toBeCloseTo(5, 12)
    expect(evaluate(parse('(3-2m)^2 + m^2', ['m']), { m: 2 })).toBeCloseTo(5, 12)
    expect(evaluate(parse('n + 1', ['n', 'k']), { n: 4, k: 9 })).toBe(5)
    // A run of declared letters is their product.
    expect(evaluate(parse('2cm', ['c', 'm']), { c: 3, m: 5 })).toBe(30)
  })

  it.each([
    ['', 'empty'],
    ['2 3', 'two numbers'],
    ['x', "isn't a number"],
    ['sqrt 5', 'brackets'],
    ['(1+2', 'expected ")"'],
    ['3$', "isn't something"],
    ['2 +', 'too early'],
  ])('refuses %j and says why', (text, reason) => {
    expect(() => parse(text)).toThrow(ParseError)
    expect(() => parse(text)).toThrow(reason)
  })

  it('refuses letters the step did not declare', () => {
    expect(() => parse('3 - 2c', ['m'])).toThrow('only m can appear here')
  })

  it('counts decimal places only for plain decimals', () => {
    expect(decimalPlaces('3.87')).toBe(2)
    expect(decimalPlaces('-0.333')).toBe(3)
    expect(decimalPlaces('2')).toBeNull()
    expect(decimalPlaces('1/3')).toBeNull()
    expect(decimalPlaces('0.5m')).toBeNull()
  })
})
