// A cheat-sheet formula card in review: the front gives a prompt that does not state the formula
// (the name, and the item's `cue` when it has one); the formula and its `when` line are the back.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { CheatItem, Course } from '../lesson/types.ts'
import ReviewView from './ReviewView.tsx'
import type { ReviewItem } from './queue.ts'
import { forgetCachedReview } from './review-store.ts'

const course = { format: 1, id: 'c', nodeId: '15Axx', title: 'A course', lessons: [{ id: 'l1', title: 'One' }] } as unknown as Course
const WHEN = 'Data minus fit, one entry per point.'

const card = (extra: Partial<CheatItem> = {}): ReviewItem => ({
  kind: 'formula',
  key: 'formula:c:residual',
  group: 'c:l1',
  state: { rung: 0, due: new Date(2020, 0, 1).toISOString(), reps: 0, lapses: 0 },
  course,
  formula: { id: 'residual', name: 'Residual', formula: '$r = b - Ax$', when: WHEN, ...extra },
})

const show = (item: ReviewItem) => render(<ReviewView items={[item]} base="./content/maths/courses/" onClose={() => {}} />)

beforeEach(() => {
  localStorage.clear()
  forgetCachedReview()
})
afterEach(cleanup)

describe('a formula card', () => {
  it('shows the name and the cue on the front, and neither the formula nor the when line', () => {
    show(card({ cue: 'The residual of a fit, in terms of $A$, $x$ and $b$' }))
    expect(screen.getByRole('heading', { name: 'Residual' })).toBeTruthy()
    expect(document.querySelector('.prompt')?.textContent).toContain('The residual of a fit, in terms of')
    expect(screen.queryByText(WHEN)).toBeNull()
    expect(document.querySelector('.review-formula')).toBeNull()
    expect(screen.getByText('Write it on paper first.')).toBeTruthy()
  })

  it('shows the name alone when the item has no cue, still without the when line', () => {
    show(card())
    expect(screen.getByRole('heading', { name: 'Residual' })).toBeTruthy()
    expect(document.querySelector('.prompt')).toBeNull()
    expect(screen.queryByText(WHEN)).toBeNull()
  })

  it('puts the formula on the back with the when line under it, the question staying above', () => {
    show(card({ cue: 'The residual of a fit, in terms of $A$, $x$ and $b$' }))
    fireEvent.click(screen.getByRole('button', { name: 'Show the formula' }))
    const back = document.querySelector('.review-formula')!
    expect(back.querySelector('.katex')).not.toBeNull()
    expect(back.textContent).toContain(WHEN)
    // The formula comes before the line about when to use it.
    const formula = back.querySelector('.katex')!
    const when = screen.getByText(WHEN)
    expect(formula.compareDocumentPosition(when) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(document.querySelector('.prompt')?.textContent).toContain('The residual of a fit')
    expect(screen.getByRole('button', { name: 'Got it' })).toBeTruthy()
  })
})
