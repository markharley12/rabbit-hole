// The quiz screen with a small stand-in for the lesson: it keeps a progress record the way
// LessonView does, so a "reload" is rendering again from what was saved.

import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { ChoiceScreen } from './ChoiceScreen.tsx'
import { emptyCourse, recordAttempt, revealAnswer, saveDraft, takeHint } from './progress.ts'
import type { CourseRecord } from './progress.ts'
import type { ChoiceBlock } from './types.ts'

afterEach(cleanup)

const T = '2026-11-16T10:00:00.000Z'

const single: ChoiceBlock = {
  type: 'choice',
  id: 'q',
  prompt: 'Which one is symmetric?',
  options: [
    { id: 'a', text: 'Option alpha', correct: true, say: 'Alpha is symmetric: its two off-diagonal entries agree.' },
    { id: 'b', text: 'Option beta', correct: false, say: 'Beta has 6 above the diagonal and 1 below.' },
    { id: 'c', text: 'Option gamma', correct: false, say: 'Gamma has a negative square.' },
    { id: 'd', text: 'Option delta', correct: false, say: 'Delta is the wrong size.' },
  ],
  hint: 'Compare the two off-diagonal entries.',
  solution: 'Symmetric means equal across the diagonal.',
  next: 'On to the next',
}

const several: ChoiceBlock = {
  ...single,
  id: 'm',
  prompt: 'Tick every true one.',
  multiple: true,
  options: [
    { id: 'a', text: 'Option alpha', correct: true, say: 'Alpha is true because of one.' },
    { id: 'b', text: 'Option beta', correct: true, say: 'Beta is true because of two.' },
    { id: 'c', text: 'Option gamma', correct: false, say: 'Gamma mixes up rows and columns.' },
    { id: 'd', text: 'Option delta', correct: false, say: 'Delta forgets the sign.' },
  ],
}

interface Saved {
  record: CourseRecord
}

function Harness({ block, start, saved, onNext = () => {} }: { block: ChoiceBlock; start: CourseRecord; saved: Saved; onNext?: () => void }) {
  const [record, setRecord] = useState(start)
  const change = (f: (r: CourseRecord) => CourseRecord) =>
    setRecord((r) => {
      const next = f(r)
      saved.record = next
      return next
    })
  return (
    <ChoiceScreen
      block={block}
      record={record.lessons.l?.steps[block.id]}
      onDraft={(values) => change((r) => saveDraft(r, 'l', block.id, values, T))}
      onAttempt={(attempt) => change((r) => recordAttempt(r, 'l', block.id, attempt))}
      onHint={() => change((r) => takeHint(r, 'l', block.id, T))}
      onReveal={() => change((r) => revealAnswer(r, 'l', block.id, T))}
      onNext={onNext}
    />
  )
}

const show = (block: ChoiceBlock, start: CourseRecord = emptyCourse(), onNext?: () => void) => {
  const saved: Saved = { record: start }
  const view = render(<Harness block={block} start={start} saved={saved} onNext={onNext} />)
  return { saved, view }
}

const pick = (name: string) => fireEvent.click(screen.getByRole(screen.queryAllByRole('radio').length ? 'radio' : 'checkbox', { name: new RegExp(name) }))
const check = () => fireEvent.click(screen.getByRole('button', { name: 'Check' }))
const shownNames = () => screen.getAllByRole(screen.queryAllByRole('radio').length ? 'radio' : 'checkbox').map((o) => o.closest('label')!.textContent!.replace(/^[A-D✓✕]/, '').trim())

describe('a single-answer question', () => {
  it('shows radio buttons in a group, a disabled Check, and no hint or answer button it does not have', () => {
    show({ ...single, hint: undefined })
    expect(screen.getByRole('radiogroup')).toBeTruthy()
    expect(screen.getAllByRole('radio')).toHaveLength(4)
    expect((screen.getByRole('button', { name: 'Check' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: 'Hint' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Show the answer' })).toBeNull()
  })

  it('picking enables Check; a wrong pick is marked and says why, and can be tried again', () => {
    const { saved } = show(single)
    pick('beta')
    expect((screen.getByRole('button', { name: 'Check' }) as HTMLButtonElement).disabled).toBe(false)
    check()
    const status = screen.getByRole('status')
    expect(within(status).getByText('Not yet.')).toBeTruthy()
    expect(within(status).getByText(single.options[1].say)).toBeTruthy()
    // Only the picked option's reason, not the others'.
    expect(within(status).queryByText(single.options[2].say)).toBeNull()
    expect(screen.getByRole('radio', { name: /beta/ }).closest('label')!.className).toContain('off')
    expect(saved.record.lessons.l.steps.q).toMatchObject({ attempts: 1, solved: false })
    expect(saved.record.lessons.l.steps.q.log[0].result).toBe('wrong')
    expect(saved.record.lessons.l.steps.q.log[0].values.picked).toBe('b')

    // Choosing again clears the mark and the message.
    pick('gamma')
    expect(screen.queryByText(single.options[1].say)).toBeNull()
    expect(screen.getByRole('radio', { name: /beta/ }).closest('label')!.className).not.toContain('off')
  })

  it('the right pick finishes it: Right, every reason, the solution, and the next button', () => {
    const onNext = vi.fn()
    const { saved } = show(single, emptyCourse(), onNext)
    pick('alpha')
    check()
    expect(within(screen.getByRole('status')).getByText('Right.')).toBeTruthy()
    expect(saved.record.lessons.l.steps.q.solved).toBe(true)
    const notes = screen.getByRole('list', { name: 'Why each option is right or wrong' })
    for (const option of single.options) expect(within(notes).getByText(option.say)).toBeTruthy()
    expect(screen.getByText(single.solution!)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Check' })).toBeNull()
    expect(screen.getAllByRole('radio').every((r) => (r as HTMLInputElement).disabled)).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: single.next }))
    expect(onNext).toHaveBeenCalledOnce()
  })

  it('offers the answer only after two wrong tries, and shows it only when asked', () => {
    show(single)
    pick('beta')
    check()
    expect(screen.queryByRole('button', { name: 'Show the answer' })).toBeNull()
    pick('gamma')
    check()
    // Two wrong tries: offered, but not shown.
    const reveal = screen.getByRole('button', { name: 'Show the answer' })
    expect((screen.getByRole('radio', { name: /alpha/ }) as HTMLInputElement).checked).toBe(false)
    expect(screen.queryByText(single.solution!)).toBeNull()
    fireEvent.click(reveal)
    expect((screen.getByRole('radio', { name: /alpha/ }) as HTMLInputElement).checked).toBe(true)
    expect(screen.getByText(single.solution!)).toBeTruthy()
    expect(screen.getByText(/That's the answer/)).toBeTruthy()
    expect(screen.getByRole('button', { name: single.next })).toBeTruthy()
  })

  it('the hint is one nudge, shown on request, and the button goes', () => {
    const { saved } = show(single)
    expect(screen.queryByText(single.hint!)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Hint' }))
    expect(screen.getByText(single.hint!)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Hint' })).toBeNull()
    expect(saved.record.lessons.l.steps.q.hints).toBe(1)
  })
})

describe('a multiple-answer question', () => {
  it('shows checkboxes in a group and takes several ticks', () => {
    show(several)
    expect(screen.getByRole('group', { name: /tick every right one/ })).toBeTruthy()
    pick('alpha')
    pick('gamma')
    expect((screen.getByRole('checkbox', { name: /alpha/ }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('checkbox', { name: /gamma/ }) as HTMLInputElement).checked).toBe(true)
    pick('alpha')
    expect((screen.getByRole('checkbox', { name: /alpha/ }) as HTMLInputElement).checked).toBe(false)
  })

  it('says how many ticks are right and why each wrong tick is wrong, without naming what is unticked', () => {
    show(several)
    pick('alpha')
    pick('gamma')
    pick('delta')
    check()
    const status = screen.getByRole('status')
    expect(within(status).getByText('1 of the 3 you ticked is right.')).toBeTruthy()
    expect(within(status).getByText(several.options[2].say)).toBeTruthy()
    expect(within(status).getByText(several.options[3].say)).toBeTruthy()
    // Neither right option's reason, and not the unticked one's.
    expect(within(status).queryByText(several.options[0].say)).toBeNull()
    expect(within(status).queryByText(several.options[1].say)).toBeNull()
  })

  it('when everything ticked is right but one is missing, says so and blames nothing', () => {
    show(several)
    pick('alpha')
    check()
    const status = screen.getByRole('status')
    expect(within(status).getByText('Everything you ticked is right, but a right option is not ticked yet.')).toBeTruthy()
    expect(status.querySelector('.says li')).toBeNull()
  })

  it('is right with exactly the right ticks, in any order', () => {
    const { saved } = show(several)
    pick('beta')
    pick('alpha')
    check()
    expect(saved.record.lessons.l.steps.m.solved).toBe(true)
    expect(saved.record.lessons.l.steps.m.log[0].values.picked).toBe('a,b')
  })
})

describe('the shuffle', () => {
  it('is kept with the draft: the same order after a re-render and after a reload', () => {
    const { saved, view } = show(single)
    const first = shownNames()
    expect(saved.record.lessons.l.steps.q.draft?.seed).toBeTruthy()
    pick('delta')
    expect(shownNames()).toEqual(first)
    view.unmount()
    show(single, saved.record)
    expect(shownNames()).toEqual(first)
    // The pick came back with it.
    expect((screen.getByRole('radio', { name: /delta/ }) as HTMLInputElement).checked).toBe(true)
  })

  it('saves the seed even before anything is picked', () => {
    const { saved, view } = show(single)
    const first = shownNames()
    view.unmount()
    show(single, saved.record)
    expect(shownNames()).toEqual(first)
  })

  it('varies between fresh screens (not one fixed order)', () => {
    const orders = new Set<string>()
    for (let i = 0; i < 12; i++) {
      const { view } = show(single)
      orders.add(shownNames().join('|'))
      view.unmount()
    }
    expect(orders.size).toBeGreaterThan(1)
  })

  it('keeps the written order when shuffle is false', () => {
    show({ ...single, shuffle: false })
    expect(shownNames()).toEqual(['Option alpha', 'Option beta', 'Option gamma', 'Option delta'])
  })
})

describe('from the record', () => {
  const done = (extra: object) => {
    const record = recordAttempt(emptyCourse(), 'l', 'q', { at: T, values: { picked: 'b', seed: 'x' }, result: 'wrong' })
    return recordAttempt(record, 'l', 'q', { at: T, values: { picked: 'a', seed: 'x' }, result: 'correct', ...extra })
  }

  it('a solved question opens solved, with the right option ticked and the next button', () => {
    show(single, done({}))
    expect((screen.getByRole('radio', { name: /alpha/ }) as HTMLInputElement).checked).toBe(true)
    expect(within(screen.getByRole('status')).getByText('Right.')).toBeTruthy()
    expect(screen.getByRole('button', { name: single.next })).toBeTruthy()
  })

  it('a shown question opens as shown', () => {
    show(single, revealAnswer(emptyCourse(), 'l', 'q', T))
    expect(screen.getByText(/That's the answer/)).toBeTruthy()
    expect((screen.getByRole('radio', { name: /alpha/ }) as HTMLInputElement).checked).toBe(true)
  })
})
