import { describe, expect, it } from 'vitest'
import { choiceValues, gradeChoice, parsePicked, partialLine, shownOptions, toggle } from './choice.ts'
import type { ChoiceBlock } from './types.ts'

const single: ChoiceBlock = {
  type: 'choice',
  id: 'q',
  prompt: 'Which?',
  options: [
    { id: 'a', text: 'A', correct: true, say: 'because a' },
    { id: 'b', text: 'B', correct: false, say: 'not b' },
    { id: 'c', text: 'C', correct: false, say: 'not c' },
    { id: 'd', text: 'D', correct: false, say: 'not d' },
  ],
  next: 'On',
}

const many: ChoiceBlock = {
  ...single,
  multiple: true,
  options: [
    { id: 'a', text: 'A', correct: true, say: 'a is right' },
    { id: 'b', text: 'B', correct: true, say: 'b is right' },
    { id: 'c', text: 'C', correct: false, say: 'not c' },
    { id: 'd', text: 'D', correct: false, say: 'not d' },
  ],
}

describe('shownOptions', () => {
  it('is fixed by the seed, keeps every option, and differs between seeds', () => {
    expect(shownOptions(single, 's1')).toEqual(shownOptions(single, 's1'))
    expect(shownOptions(single, 's1').map((o) => o.id).sort()).toEqual(['a', 'b', 'c', 'd'])
    const orders = new Set(Array.from({ length: 20 }, (_, i) => shownOptions(single, `s${i}`).map((o) => o.id).join('')))
    expect(orders.size).toBeGreaterThan(5)
  })

  it('keeps the written order when the block says not to shuffle', () => {
    const fixed = { ...single, shuffle: false }
    expect(shownOptions(fixed, 'any').map((o) => o.id)).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('the stored picks', () => {
  it('encode in the block order whatever order they were picked in', () => {
    expect(choiceValues(many, ['b', 'a'], 'k')).toEqual({ picked: 'a,b', seed: 'k' })
    expect(choiceValues(single, [], 'k')).toEqual({ picked: '', seed: 'k' })
  })

  it('read back, dropping ids the block no longer has', () => {
    expect(parsePicked(many, { picked: 'b,gone,a', seed: 'k' })).toEqual(['a', 'b'])
    expect(parsePicked(many, undefined)).toEqual([])
    expect(parsePicked(many, { picked: '' })).toEqual([])
  })
})

describe('toggle', () => {
  it('a single-answer question holds one pick, and the same pick again keeps it', () => {
    expect(toggle(single, [], 'a')).toEqual(['a'])
    expect(toggle(single, ['a'], 'b')).toEqual(['b'])
    expect(toggle(single, ['b'], 'b')).toEqual(['b'])
  })

  it('a multiple question ticks and unticks', () => {
    expect(toggle(many, ['a'], 'b')).toEqual(['a', 'b'])
    expect(toggle(many, ['a', 'b'], 'a')).toEqual(['b'])
  })
})

describe('gradeChoice', () => {
  it('is right only for exactly the right option', () => {
    expect(gradeChoice(single, ['a'])).toEqual({ status: 'correct' })
    const wrong = gradeChoice(single, ['c'])
    expect(wrong).toMatchObject({ status: 'wrong', rightPicked: 0, picked: 1, missing: false })
    expect(wrong.status === 'wrong' && wrong.wrong.map((o) => o.say)).toEqual(['not c'])
  })

  it('nothing picked is wrong, not right', () => {
    expect(gradeChoice(single, []).status).toBe('wrong')
  })

  it('a multiple question needs every right option and no wrong one', () => {
    expect(gradeChoice(many, ['b', 'a'])).toEqual({ status: 'correct' })
    expect(gradeChoice(many, ['a'])).toMatchObject({ status: 'wrong', missing: true, rightPicked: 1 })
    expect(gradeChoice(many, ['a', 'b', 'c'])).toMatchObject({ status: 'wrong', missing: false, rightPicked: 2, picked: 3 })
  })

  it('names every wrong pick, in the block order', () => {
    const verdict = gradeChoice(many, ['d', 'a', 'c'])
    expect(verdict.status === 'wrong' && verdict.wrong.map((o) => o.id)).toEqual(['c', 'd'])
  })
})

describe('partialLine', () => {
  it('says how many picks are right without saying which options are missing', () => {
    expect(partialLine(many, gradeChoice(many, ['a', 'c', 'd']))).toBe('1 of the 3 you ticked is right.')
    expect(partialLine(many, gradeChoice(many, ['a', 'b', 'c']))).toBe('2 of the 3 you ticked are right.')
    expect(partialLine(many, gradeChoice(many, ['c', 'd']))).toBe('None of the 2 you ticked are right.')
    expect(partialLine(many, gradeChoice(many, ['c']))).toBe('The one you ticked is not right.')
  })

  it('only says something is still missing when every pick is right', () => {
    expect(partialLine(many, gradeChoice(many, ['a']))).toBe('Everything you ticked is right, but a right option is not ticked yet.')
  })

  it('has nothing to add for a single-answer question or a right answer', () => {
    expect(partialLine(single, gradeChoice(single, ['b']))).toBeUndefined()
    expect(partialLine(many, gradeChoice(many, ['a', 'b']))).toBeUndefined()
  })
})
