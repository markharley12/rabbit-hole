import { describe, expect, it } from 'vitest'
import type { CourseRecord } from '../lesson/progress.ts'
import type { Block, StepBlock } from '../lesson/types.ts'
import { answerLines, hasEarlierSteps, keyToTex, lessonsToFetch, soFar } from './so-far.ts'

const step = (id: string, key = '4'): StepBlock => ({
  type: 'step',
  id,
  why: 'w',
  prompt: `Prompt ${id}`,
  answer: { fields: [{ name: 'x', key }], verify: key },
  hints: ['a', 'b', 'c'],
  next: 'On',
})
const text = (id: string): Block => ({ type: 'text', id, body: 'b', next: 'On' })
const choice = (id: string): Block => ({ type: 'choice', id, prompt: 'p', options: [], next: 'On' })

const record = (lessons: Record<string, { solved?: string[]; revealed?: string[] }>): CourseRecord => ({
  format: 1,
  lessons: Object.fromEntries(
    Object.entries(lessons).map(([id, { solved = [], revealed = [] }]) => [
      id,
      {
        at: 0,
        done: false,
        started: 'x',
        steps: {
          ...Object.fromEntries(solved.map((s) => [s, { attempts: 1, solved: true, hints: 0, log: [] }])),
          ...Object.fromEntries(revealed.map((s) => [s, { attempts: 0, solved: false, revealed: true, hints: 3, log: [] }])),
        },
      },
    ]),
  ),
})
const lessonIds = ['one', 'two', 'three']
const blocks = {
  one: [step('a'), text('t'), step('b')],
  two: [step('c'), choice('q'), step('d')],
  three: [step('e'), step('f'), step('g'), step('h')],
}
const ids = (groups: ReturnType<typeof soFar>) => groups.map((g) => [g.lessonId, g.entries.map((e) => e.step.id)])

describe('soFar', () => {
  const all = record({ one: { solved: ['a', 'b'] }, two: { solved: ['c', 'd'] }, three: { solved: ['e', 'f', 'g', 'h'] } })

  it('never shows the current step or later ones', () => {
    const groups = soFar({ lessonIds, blocks, record: all, currentLessonId: 'three', at: 2 })
    expect(ids(groups)[0]).toEqual(['three', ['f', 'e']])
    expect(JSON.stringify(groups)).not.toContain('"g"')
    expect(JSON.stringify(groups)).not.toContain('"h"')
  })

  it('shows nothing of the current lesson on its first screen', () => {
    const groups = soFar({ lessonIds, blocks, record: all, currentLessonId: 'three', at: 0 })
    expect(groups.some((g) => g.current)).toBe(false)
  })

  it('orders this lesson first, then earlier lessons nearest first, each most recent first', () => {
    const groups = soFar({ lessonIds, blocks, record: all, currentLessonId: 'three', at: 1 })
    expect(ids(groups)).toEqual([
      ['three', ['e']],
      ['two', ['d', 'c']],
      ['one', ['b', 'a']],
    ])
    expect(groups.map((g) => g.current)).toEqual([true, false, false])
  })

  it('omits steps that are neither solved nor revealed, and includes revealed ones', () => {
    const groups = soFar({ lessonIds, blocks, record: record({ one: { solved: ['a'], revealed: ['b'] }, two: {} }), currentLessonId: 'three', at: 0 })
    expect(ids(groups)).toEqual([['one', ['b', 'a']]])
    expect(groups[0].entries.map((e) => e.how)).toEqual(['revealed', 'solved'])
  })

  it('leaves out text and choice screens even if the record has them', () => {
    const groups = soFar({ lessonIds, blocks, record: record({ two: { solved: ['q', 'c'] }, one: { solved: ['t'] } }), currentLessonId: 'three', at: 0 })
    expect(ids(groups)).toEqual([['two', ['c']]])
  })

  it('skips an earlier lesson that is not loaded', () => {
    const groups = soFar({ lessonIds, blocks: { one: blocks.one, three: blocks.three }, record: all, currentLessonId: 'three', at: 3 })
    expect(ids(groups)).toEqual([
      ['three', ['g', 'f', 'e']],
      ['one', ['b', 'a']],
    ])
  })

  it('works when the lesson id is not in the list', () => {
    expect(soFar({ lessonIds, blocks, record: all, currentLessonId: 'zzz', at: 2 })).toEqual([])
  })
})

describe('lessonsToFetch', () => {
  it('lists earlier lessons with a finished step, nearest first', () => {
    const r = record({ one: { solved: ['a'] }, two: { revealed: ['c'] }, three: { solved: ['e'] } })
    expect(lessonsToFetch(lessonIds, 'three', r)).toEqual(['two', 'one'])
    expect(lessonsToFetch(lessonIds, 'one', r)).toEqual([])
    expect(lessonsToFetch(lessonIds, 'three', record({ one: {} }))).toEqual([])
  })
})

describe('hasEarlierSteps', () => {
  it('is false on the first screens of the first lesson, true after a step or in a later lesson', () => {
    const b: Block[] = [text('t'), step('a'), step('b')]
    expect(hasEarlierSteps(0, b, 0)).toBe(false)
    expect(hasEarlierSteps(0, b, 1)).toBe(false)
    expect(hasEarlierSteps(0, b, 2)).toBe(true)
    expect(hasEarlierSteps(1, b, 0)).toBe(true)
  })
})

describe('keyToTex', () => {
  it.each([
    ['4', '4'],
    ['-1/2', '-\\frac{1}{2}'],
    ['16/5', '\\frac{16}{5}'],
    ['sqrt(15)', '\\sqrt{15}'],
    ['1/sqrt(10)', '\\frac{1}{\\sqrt{10}}'],
    ['-1/sqrt(5)', '-\\frac{1}{\\sqrt{5}}'],
    ['(3+sqrt(5))/2', '\\frac{3+\\sqrt{5}}{2}'],
    ['2*x+1', '2\\cdot x+1'],
    ['2*pi', '2\\cdot \\pi '],
    ['1/2/3', '1/2/3'],
    ['0.5', '0.5'],
  ])('%s', (key, tex) => expect(keyToTex(key)).toBe(tex))
})

describe('answerLines', () => {
  it('gives one line per labelled field', () => {
    const lines = answerLines({ fields: [{ name: 'a', label: '$c =$', key: '1/2' }, { name: 'b', label: '$d =$', key: '3' }], verify: '' })
    expect(lines).toEqual([
      { label: '$c =$', value: '$\\displaystyle \\frac{1}{2}$' },
      { label: '$d =$', value: '$\\displaystyle 3$' },
    ])
  })
  it('gives a matrix as one bracketed line', () => {
    const fields = ['1', '2', '3', '4'].map((key, i) => ({ name: `m${i}`, key }))
    expect(answerLines({ fields, matrix: [2, 2], verify: '' })).toEqual([{ value: '$\\displaystyle \\begin{bmatrix}1 & 2 \\\\ 3 & 4\\end{bmatrix}$' }])
  })
  it('gives an unlabelled vector as a bracketed column', () => {
    const fields = ['1', '2'].map((key, i) => ({ name: `v${i}`, key }))
    expect(answerLines({ fields, verify: '' })).toEqual([{ value: '$\\displaystyle \\begin{bmatrix}1 \\\\ 2\\end{bmatrix}$' }])
  })
})
