// The dock on a real lesson screen: opening and closing tools leaves the step
// as it was, Escape and the back button close, the calculator keeps its tape,
// the scratch pad is kept per lesson.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import LessonView from '../lesson/LessonView.tsx'
import { forgetCachedProgress } from '../lesson/progress-store.ts'
import type { Course, Lesson } from '../lesson/types.ts'
import { ToolDock } from './ToolDock.tsx'
import { storageKey } from './scratch-pad.ts'

const course: Course = {
  format: 1,
  id: 'demo',
  nodeId: '15Axx',
  title: 'Demo',
  summary: '',
  written: '2026-11-15',
  sources: [],
  lessons: [{ id: 'one', title: 'One' }],
}

const lesson: Lesson = {
  format: 1,
  id: 'one',
  title: 'One',
  blocks: [
    {
      type: 'step',
      id: 's1',
      why: 'Because.',
      prompt: 'What is 2 + 2?',
      answer: { fields: [{ name: 'x', key: '4' }], verify: '4' },
      hints: ['a', 'b', 'c'],
      next: 'On',
    },
  ],
}

const mount = async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => lesson })))
  render(<LessonView course={course} lessonId="one" base="./" onClose={() => {}} onOpenLesson={() => {}} />)
  await screen.findByRole('textbox', { name: 'x' })
}

const openTool = (name: string) => fireEvent.click(screen.getByRole('button', { name }))
const panel = (name: string) => screen.getByRole('dialog', { name })

beforeEach(() => {
  // jsdom has no canvas and prints a complaint for each getContext; null is what the pad guards against.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  localStorage.clear()
  forgetCachedProgress()
  window.history.replaceState(null, '', '/')
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('the dock on a lesson', () => {
  it('offers the scratch pad and the calculator, with no overlay until one is tapped', async () => {
    await mount()
    const dock = screen.getByRole('group', { name: 'Tools' })
    expect(within(dock).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Scratch pad', 'Calculator'])
    expect(screen.queryByRole('dialog', { name: 'Calculator' })).toBeNull()
  })

  it('is not on the loading screen', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    render(<LessonView course={course} lessonId="one" base="./" onClose={() => {}} onOpenLesson={() => {}} />)
    expect(screen.queryByRole('group', { name: 'Tools' })).toBeNull()
  })

  it('leaves the typed answer, shown hints and the step itself in place while a tool is open', async () => {
    await mount()
    const input = screen.getByRole('textbox', { name: 'x' })
    fireEvent.change(input, { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Hint' }))

    openTool('Calculator')
    expect(panel('Calculator')).toBeTruthy()
    // The same element, still in the document, behind the overlay.
    expect(screen.getByRole('textbox', { name: 'x', hidden: true })).toBe(input)

    fireEvent.click(screen.getByRole('button', { name: 'Close calculator' }))
    expect(screen.queryByRole('dialog', { name: 'Calculator' })).toBeNull()
    const after = screen.getByRole('textbox', { name: 'x' }) as HTMLInputElement
    expect(after).toBe(input)
    expect(after.value).toBe('3')
    expect(screen.getByRole('list', { name: 'Hints' })).toBeTruthy()
  })

  it('keeps one tool open at a time and closes it with Escape', async () => {
    await mount()
    openTool('Scratch pad')
    expect(panel('Scratch pad')).toBeTruthy()
    // The backdrop covers the dock, but in the document tree only one panel exists.
    expect(screen.getAllByRole('dialog', { name: /Scratch pad|Calculator/ })).toHaveLength(1)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Scratch pad' })).toBeNull()
  })

  it('closes on a tap outside the panel', async () => {
    await mount()
    openTool('Calculator')
    fireEvent.click(document.querySelector('.tool-backdrop')!)
    expect(screen.queryByRole('dialog', { name: 'Calculator' })).toBeNull()
  })

  it('closes on the back button without touching the route, and the page stays', async () => {
    await mount()
    const hashchange = vi.fn()
    window.addEventListener('hashchange', hashchange)
    const url = window.location.href

    openTool('Calculator')
    expect(window.history.state).toEqual({ tool: 'calculator' })
    expect(window.location.href).toBe(url)

    await act(async () => {
      window.history.back()
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(screen.queryByRole('dialog', { name: 'Calculator' })).toBeNull()
    expect(screen.getByRole('textbox', { name: 'x' })).toBeTruthy()
    expect(hashchange).not.toHaveBeenCalled()
    window.removeEventListener('hashchange', hashchange)
  })

  it('closing by hand takes its history entry back, so back is not spent', async () => {
    await mount()
    const back = vi.spyOn(window.history, 'back')
    openTool('Calculator')
    fireEvent.click(screen.getByRole('button', { name: 'Close calculator' }))
    expect(back).toHaveBeenCalledTimes(1)
    // That popstate is ours: opening again straight away must not be closed by it.
    openTool('Scratch pad')
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(panel('Scratch pad')).toBeTruthy()
  })

  it('gives focus to the overlay and back to its button', async () => {
    await mount()
    const button = screen.getByRole('button', { name: 'Calculator' })
    button.focus()
    fireEvent.click(button)
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close calculator' })))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(document.activeElement).toBe(button)
  })
})

describe('the calculator tool', () => {
  const calc = () => screen.getByRole('textbox', { name: 'Calculator line' }) as HTMLInputElement
  const enterLine = (text: string) => {
    fireEvent.change(calc(), { target: { value: text } })
    fireEvent.keyDown(calc(), { key: 'Enter' })
  }

  it('keeps entered lines with results, and clears the input', async () => {
    await mount()
    openTool('Calculator')
    fireEvent.change(calc(), { target: { value: '3/5' } })
    expect(screen.getByText('= 0.6 (3/5)')).toBeTruthy()
    enterLine('1*1 + 2*2 + 3*6')
    const tape = screen.getByRole('list', { name: 'Earlier lines' })
    expect(within(tape).getByText('1*1 + 2*2 + 3*6')).toBeTruthy()
    expect(within(tape).getByRole('button', { name: 'Use 23' }).textContent).toBe('= 23')
    expect(calc().value).toBe('')
  })

  it('the = button keeps the line too, and half-typed input is quietly left alone', async () => {
    await mount()
    openTool('Calculator')
    fireEvent.change(calc(), { target: { value: '2 +' } })
    expect((screen.getByRole('button', { name: 'Keep this line' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.keyDown(calc(), { key: 'Enter' })
    expect(screen.queryByRole('list', { name: 'Earlier lines' })).toBeNull()
    expect(calc().value).toBe('2 +')

    fireEvent.change(calc(), { target: { value: '3/5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Keep this line' }))
    expect(screen.getByRole('button', { name: 'Use 0.6' }).textContent).toBe('= 0.6 (3/5)')
  })

  it('tapping a past result puts it into the input', async () => {
    await mount()
    openTool('Calculator')
    enterLine('3/5')
    fireEvent.change(calc(), { target: { value: '10*' } })
    fireEvent.click(screen.getByRole('button', { name: 'Use 0.6' }))
    expect(calc().value).toBe('10*0.6')
  })

  it('keeps at most 20 lines, and keeps them when the overlay is closed and opened again', async () => {
    await mount()
    openTool('Calculator')
    for (let i = 1; i <= 22; i++) enterLine(`${i}+0`)
    expect(within(screen.getByRole('list', { name: 'Earlier lines' })).getAllByRole('listitem')).toHaveLength(20)
    fireEvent.keyDown(window, { key: 'Escape' })
    openTool('Calculator')
    const items = within(screen.getByRole('list', { name: 'Earlier lines' })).getAllByRole('listitem')
    expect(items).toHaveLength(20)
    expect(items[0].textContent).toContain('3+0')
  })

  it('the inline calculator in "Check it yourself" still works as before', async () => {
    await mount()
    fireEvent.click(screen.getByRole('button', { name: 'Check it yourself' }))
    const inline = screen.getByLabelText('Calculator', { selector: 'input' })
    fireEvent.change(inline, { target: { value: '3/5' } })
    expect(screen.getByText('= 0.6 (3/5)')).toBeTruthy()
    fireEvent.change(inline, { target: { value: '2 +' } })
    expect(screen.getByText('…')).toBeTruthy()
  })
})

describe('the scratch pad tool', () => {
  it('opens without a canvas context (jsdom), starts empty and cannot undo', async () => {
    await mount()
    openTool('Scratch pad')
    expect(screen.getByLabelText('Scratch page')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Clear the page' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('draws a stroke with one pointer, undoes it, and keeps it for this lesson on close', async () => {
    await mount()
    openTool('Scratch pad')
    const canvas = screen.getByLabelText('Scratch page')
    const send = (type: string, x: number, y: number) => fireEvent(canvas, new MouseEvent(type, { clientX: x, clientY: y, bubbles: true }))
    // jsdom has no PointerEvent: React listens for the event by name, so a MouseEvent of that type does.
    Object.defineProperty(MouseEvent.prototype, 'pointerId', { value: 1, configurable: true })
    send('pointerdown', 10, 10)
    send('pointermove', 40, 40)
    send('pointerup', 40, 40)
    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(false)

    fireEvent.keyDown(window, { key: 'Escape' })
    const saved = localStorage.getItem(storageKey('demo', 'one'))
    expect(saved).not.toBeNull()
    expect(JSON.parse(saved!).strokes).toHaveLength(1)

    // Back again: the stroke is there.
    openTool('Scratch pad')
    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Clear the page' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('clear asks once: the second tap within 3 seconds confirms, otherwise it lapses', async () => {
    localStorage.setItem(storageKey('demo', 'one'), JSON.stringify({ v: 1, strokes: [{ c: 'ink', p: [1, 1, 5, 5] }] }))
    await mount()
    vi.useFakeTimers()
    try {
      openTool('Scratch pad')
      fireEvent.click(screen.getByRole('button', { name: 'Clear the page' }))
      expect(screen.getByRole('button', { name: 'Tap again to clear the page' })).toBeTruthy()
      act(() => {
        vi.advanceTimersByTime(3100)
      })
      expect(screen.getByRole('button', { name: 'Clear the page' })).toBeTruthy()
      expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(true)

      fireEvent.click(screen.getByRole('button', { name: 'Clear the page' }))
      fireEvent.click(screen.getByRole('button', { name: 'Tap again to clear the page' }))
      expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(false)
      expect((screen.getByRole('button', { name: 'Clear the page' }) as HTMLButtonElement).disabled).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a corrupt saved page opens empty instead of crashing', async () => {
    localStorage.setItem(storageKey('demo', 'one'), '{{{')
    await mount()
    openTool('Scratch pad')
    expect((screen.getByRole('button', { name: 'Clear the page' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('offers the pen, the eraser and exactly three colours', async () => {
    await mount()
    openTool('Scratch pad')
    expect(screen.getByRole('button', { name: 'Pen' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Eraser' }))
    expect(screen.getByRole('button', { name: 'Eraser' }).getAttribute('aria-pressed')).toBe('true')
    expect(within(screen.getByRole('group', { name: 'Pen colour' })).getAllByRole('button')).toHaveLength(3)
  })
})

describe('the dock on its own', () => {
  it('takes any list of tools and gives each its close function', () => {
    render(
      <ToolDock
        tools={[
          { id: 'x', label: 'Extra', icon: <b>x</b>, render: (close) => <button onClick={close}>done here</button> },
        ]}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Extra' }))
    fireEvent.click(screen.getByRole('button', { name: 'done here' }))
    expect(screen.queryByRole('dialog', { name: 'Extra' })).toBeNull()
  })
})
