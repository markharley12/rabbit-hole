import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { OrderScreen } from './OrderScreen.tsx'
import { emptyCourse, recordAttempt, revealAnswer, saveDraft, takeHint } from './progress.ts'
import type { CourseRecord } from './progress.ts'
import type { OrderBlock } from './types.ts'

afterEach(cleanup)

const T = '2026-11-16T10:00:00.000Z'
const ids = ['s1', 's2', 's3', 's4', 's5']

const block: OrderBlock = {
  type: 'order',
  id: 'p',
  prompt: 'Put the steps of the argument in order.',
  items: ids.map((id) => ({ id, text: `Line ${id}` })),
  say: { s2: 'Something must be set up before this line.' },
  hint: 'Start from what is given.',
  solution: 'Each line uses the one before.',
  next: 'On to the next',
}
const fixed: OrderBlock = { ...block, id: 'f', fixed: ['s1', 's5'] }

interface Saved {
  record: CourseRecord
}

function Harness({ block, start, saved, onNext = () => {} }: { block: OrderBlock; start: CourseRecord; saved: Saved; onNext?: () => void }) {
  const [record, setRecord] = useState(start)
  const change = (f: (r: CourseRecord) => CourseRecord) =>
    setRecord((r) => {
      const next = f(r)
      saved.record = next
      return next
    })
  return (
    <OrderScreen
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

const show = (b: OrderBlock, start: CourseRecord = emptyCourse(), onNext?: () => void) => {
  const saved: Saved = { record: start }
  const view = render(<Harness block={b} start={start} saved={saved} onNext={onNext} />)
  return { saved, view }
}

const rows = () => [...screen.getByRole('list', { name: 'Lines to put in order' }).querySelectorAll<HTMLElement>('li[data-item]')]
const order = () => rows().map((r) => r.dataset.item!)
const row = (id: string) => rows().find((r) => r.dataset.item === id)!
const up = (id: string) => fireEvent.click(within(row(id)).getByRole('button', { name: 'Move up' }))
const down = (id: string) => fireEvent.click(within(row(id)).getByRole('button', { name: 'Move down' }))
const check = () => fireEvent.click(screen.getByRole('button', { name: 'Check' }))

/** Move lines with the buttons until the list reads `target`. */
function arrange(target: string[]) {
  target.forEach((id, i) => {
    while (order().indexOf(id) > i) up(id)
  })
  expect(order()).toEqual(target)
}

describe('the list', () => {
  it('opens shuffled, never in the correct order, with every line once', () => {
    for (let i = 0; i < 15; i++) {
      show(block)
      expect(order()).not.toEqual(ids)
      expect([...order()].sort()).toEqual(ids)
      cleanup()
    }
  })

  it('has a Move up and a Move down button on every line', () => {
    show(block)
    expect(screen.getAllByRole('button', { name: 'Move up' })).toHaveLength(5)
    expect(screen.getAllByRole('button', { name: 'Move down' })).toHaveLength(5)
  })

  it('the buttons move a line one place and say where it went', () => {
    show(block)
    const start = order()
    const moved = start[2]
    up(moved)
    expect(order()).toEqual([start[0], moved, start[1], start[3], start[4]])
    expect(screen.getByTestId('order-announce').textContent).toBe('Moved to position 2 of 5.')
    down(moved)
    down(moved)
    expect(order()).toEqual([start[0], start[1], start[3], moved, start[4]])
    expect(screen.getByTestId('order-announce').textContent).toBe('Moved to position 4 of 5.')
  })

  it('disables Move up on the top line and Move down on the bottom one', () => {
    show(block)
    const list = order()
    expect((within(row(list[0])).getByRole('button', { name: 'Move up' }) as HTMLButtonElement).disabled).toBe(true)
    expect((within(row(list[0])).getByRole('button', { name: 'Move down' }) as HTMLButtonElement).disabled).toBe(false)
    expect((within(row(list[4])).getByRole('button', { name: 'Move down' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('keeps focus on the button that was pressed, as the line moves', () => {
    show(block)
    const moved = order()[3]
    const button = within(row(moved)).getByRole('button', { name: 'Move up' })
    button.focus()
    fireEvent.click(button)
    expect(document.activeElement).toBe(within(row(moved)).getByRole('button', { name: 'Move up' }))
  })

  it('hands focus to the other button when a line reaches the end', () => {
    show(block)
    const moved = order()[1]
    const button = within(row(moved)).getByRole('button', { name: 'Move up' })
    button.focus()
    fireEvent.click(button)
    expect(order()[0]).toBe(moved)
    expect(document.activeElement).toBe(within(row(moved)).getByRole('button', { name: 'Move down' }))
  })
})

describe('fixed lines', () => {
  it('start in place, say so, and cannot be moved; the rest cannot pass them', () => {
    show(fixed)
    const list = order()
    expect(list[0]).toBe('s1')
    expect(list[4]).toBe('s5')
    expect(within(row('s1')).getByText('Given: stays here')).toBeTruthy()
    for (const id of ['s1', 's5']) {
      for (const name of ['Move up', 'Move down']) expect((within(row(id)).getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true)
    }
    // The first movable line cannot go up, the last cannot go down.
    expect((within(row(list[1])).getByRole('button', { name: 'Move up' }) as HTMLButtonElement).disabled).toBe(true)
    expect((within(row(list[3])).getByRole('button', { name: 'Move down' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('stay put through every move', () => {
    show(fixed)
    arrange(['s1', 's4', 's3', 's2', 's5'])
    expect(order()[0]).toBe('s1')
    expect(order()[4]).toBe('s5')
  })
})

describe('Check', () => {
  it('right: done, with the solution, the order shown, and the next button', () => {
    const onNext = vi.fn()
    const { saved } = show(block, emptyCourse(), onNext)
    arrange(ids)
    check()
    expect(within(screen.getByRole('status')).getByText('Right: that is the order.')).toBeTruthy()
    expect(saved.record.lessons.l.steps.p.solved).toBe(true)
    expect(saved.record.lessons.l.steps.p.log[0].values.order).toBe('s1,s2,s3,s4,s5')
    expect(screen.getByText(block.solution!)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Check' })).toBeNull()
    expect(screen.getAllByRole('button', { name: /Move/ }).every((b) => (b as HTMLButtonElement).disabled)).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: block.next }))
    expect(onNext).toHaveBeenCalledOnce()
  })

  it('wrong: marks only the first line out of place and gives the generic nudge', () => {
    const { saved } = show(block)
    arrange(['s1', 's3', 's2', 's4', 's5'])
    check()
    expect(within(screen.getByRole('status')).getByText('Not yet.')).toBeTruthy()
    expect(within(screen.getByRole('status')).getByText('The line marked is not where it belongs yet.')).toBeTruthy()
    expect(rows().filter((r) => r.className.includes('off')).map((r) => r.dataset.item)).toEqual(['s3'])
    expect(saved.record.lessons.l.steps.p).toMatchObject({ attempts: 1, solved: false })
    expect(saved.record.lessons.l.steps.p.log[0]).toMatchObject({ result: 'wrong', values: { order: 's1,s3,s2,s4,s5' } })
  })

  it("wrong: says that line's own nudge when it has one", () => {
    show(block)
    arrange(['s2', 's1', 's3', 's4', 's5'])
    check()
    expect(within(screen.getByRole('status')).getByText(block.say!.s2)).toBeTruthy()
    expect(rows().filter((r) => r.className.includes('off')).map((r) => r.dataset.item)).toEqual(['s2'])
  })

  it('moving a line clears the mark and the message', () => {
    show(block)
    arrange(['s2', 's1', 's3', 's4', 's5'])
    check()
    up('s1')
    expect(rows().some((r) => r.className.includes('off'))).toBe(false)
    expect(screen.queryByText(block.say!.s2)).toBeNull()
  })

  it('never offers a blamed fixed line', () => {
    show(fixed)
    check()
    const marked = rows().filter((r) => r.className.includes('off')).map((r) => r.dataset.item!)
    expect(marked).toHaveLength(1)
    expect(['s1', 's5']).not.toContain(marked[0])
  })
})

describe('the answer', () => {
  it('is offered after three wrong tries, and shown only when asked', () => {
    show(block)
    check()
    check()
    expect(screen.queryByRole('button', { name: 'Show the answer' })).toBeNull()
    check()
    const reveal = screen.getByRole('button', { name: 'Show the answer' })
    expect(order()).not.toEqual(ids)
    fireEvent.click(reveal)
    expect(order()).toEqual(ids)
    expect(screen.getByText(/That's the order/)).toBeTruthy()
    expect(screen.getByRole('button', { name: block.next })).toBeTruthy()
  })

  it('the hint is one nudge, on request', () => {
    const { saved } = show(block)
    expect(screen.queryByText(block.hint!)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Hint' }))
    expect(screen.getByText(block.hint!)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Hint' })).toBeNull()
    expect(saved.record.lessons.l.steps.p.hints).toBe(1)
  })
})

describe('from the record', () => {
  it('the same order after a re-render and after a reload, moves included', () => {
    const { saved, view } = show(block)
    const first = order()
    expect(saved.record.lessons.l.steps.p.draft?.seed).toBeTruthy()
    view.unmount()
    const again = show(block, saved.record)
    expect(order()).toEqual(first)
    up(order()[3])
    const moved = order()
    cleanup()
    show(block, again.saved.record)
    expect(order()).toEqual(moved)
  })

  it('a solved puzzle opens solved, a shown one opens shown, both in the right order', () => {
    const solved = recordAttempt(emptyCourse(), 'l', 'p', { at: T, values: { order: ids.join(','), seed: 'x' }, result: 'correct' })
    show(block, solved)
    expect(order()).toEqual(ids)
    expect(within(screen.getByRole('status')).getByText('Right: that is the order.')).toBeTruthy()
    cleanup()
    show(block, revealAnswer(emptyCourse(), 'l', 'p', T))
    expect(order()).toEqual(ids)
    expect(screen.getByText(/That's the order/)).toBeTruthy()
  })

  it('starts again from the seed when the stored order no longer fits the block', () => {
    const stale = saveDraft(emptyCourse(), 'l', 'p', { order: 's1,s2,gone', seed: 'abc' }, T)
    show(block, stale)
    expect([...order()].sort()).toEqual(ids)
    expect(order()).not.toEqual(ids)
  })
})
