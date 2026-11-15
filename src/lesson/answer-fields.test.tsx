import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AnswerFields } from './AnswerFields.tsx'
import { inputModeFor } from './input-mode.ts'
import type { Answer } from './types.ts'

afterEach(cleanup)

const field = (key: string) => ({ key })

describe('inputModeFor', () => {
  it.each(['4', '-2', '0.6', '-10.25', '007'])('%s gets the number pad', (key) => {
    expect(inputModeFor({}, field(key))).toBe('decimal')
  })

  it.each(['3/5', 'sqrt(15)', '2.5e3', '.5', '5.', '1 + 2', '3 - 2m', '', '-', '1,5'])('%s keeps the full keyboard', (key) => {
    expect(inputModeFor({}, field(key))).toBe('text')
  })

  it('any answer with variables keeps the full keyboard, even for a plain number', () => {
    expect(inputModeFor({ vars: ['m'] }, field('4'))).toBe('text')
    expect(inputModeFor({ vars: [] }, field('4'))).toBe('decimal')
  })
})

const mix: Answer = {
  fields: [
    { name: 'a', label: 'a', key: '4' },
    { name: 'b', label: 'b', key: '3/5' },
  ],
  verify: 'x',
}

const show = (answer: Answer, values: Record<string, string> = {}) =>
  render(<AnswerFields answer={answer} values={values} off={[]} disabled={false} onChange={() => {}} onSubmit={() => {}} />)

const mode = (name: string) => screen.getByRole('textbox', { name }).getAttribute('inputmode')

describe('the number keyboard', () => {
  it('decides per box', () => {
    show(mix)
    expect(mode('a')).toBe('decimal')
    expect(mode('b')).toBe('text')
  })

  it('has no switch when no box is numeric', () => {
    show({ fields: [{ name: 'a', key: '3/5' }], verify: 'x' })
    expect(screen.queryByRole('button', { name: /keyboard/ })).toBeNull()
  })

  it('has no switch for an answer with variables', () => {
    show({ fields: [{ name: 'a', key: '4' }], vars: ['m'], verify: 'x' })
    expect(screen.queryByRole('button', { name: /keyboard/ })).toBeNull()
    expect(mode('a')).toBe('text')
  })

  it('"abc" puts every box on the full keyboard and "123" brings the pad back, keeping what is typed', () => {
    const { rerender } = show(mix, { a: '2', b: '1/2' })
    const abc = screen.getByRole('button', { name: 'Switch to the full keyboard' })
    expect(abc.textContent).toBe('abc')
    fireEvent.click(abc)
    expect(mode('a')).toBe('text')
    expect(mode('b')).toBe('text')
    expect((screen.getByRole('textbox', { name: 'a' }) as HTMLInputElement).value).toBe('2')

    const back = screen.getByRole('button', { name: 'Switch to the number keyboard' })
    expect(back.textContent).toBe('123')
    fireEvent.click(back)
    expect(mode('a')).toBe('decimal')
    expect(mode('b')).toBe('text')
    rerender(<AnswerFields answer={mix} values={{ a: '2', b: '1/2' }} off={[]} disabled={false} onChange={() => {}} onSubmit={() => {}} />)
    expect((screen.getByRole('textbox', { name: 'b' }) as HTMLInputElement).value).toBe('1/2')
  })

  it('does not take the cursor away from the box it was in: it is focused again so the keyboard swaps', () => {
    show(mix)
    const a = screen.getByRole('textbox', { name: 'a' }) as HTMLInputElement
    a.focus()
    const blur = vi.spyOn(a, 'blur')
    const focus = vi.spyOn(a, 'focus')
    const press = screen.getByRole('button', { name: 'Switch to the full keyboard' })
    // The press itself must not move focus: mousedown is cancelled.
    expect(fireEvent.mouseDown(press)).toBe(false)
    fireEvent.click(press)
    expect(blur).toHaveBeenCalled()
    expect(focus).toHaveBeenCalled()
    expect(document.activeElement).toBe(a)
  })

  it('does not focus a box when none had focus', () => {
    show(mix)
    const a = screen.getByRole('textbox', { name: 'a' })
    const focus = vi.spyOn(a, 'focus')
    fireEvent.click(screen.getByRole('button', { name: 'Switch to the full keyboard' }))
    expect(focus).not.toHaveBeenCalled()
  })
})
