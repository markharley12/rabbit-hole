// The cheat sheet tool on a lesson: offered only when the course has one,
// fetched when first opened, marks the item for the lesson he is on, and keeps
// his own notes on the device.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import LessonView from '../lesson/LessonView.tsx'
import { forgetCachedProgress } from '../lesson/progress-store.ts'
import type { CheatSheet, Course, Lesson } from '../lesson/types.ts'
import { forgetFetchedSheets } from './cheat-sheet-store.ts'
import { MAX_NOTES, storageKey } from './cheat-notes.ts'

const course: Course = {
  format: 1,
  id: 'demo',
  nodeId: '15Axx',
  title: 'Demo',
  summary: '',
  written: '2026-11-15',
  sources: [],
  lessons: [
    { id: 'one', title: 'One' },
    { id: 'two', title: 'Two' },
  ],
  cheatsheet: true,
}

const lesson = (id: string): Lesson => ({
  format: 1,
  id,
  title: id,
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
})

const sheet: CheatSheet = {
  format: 1,
  sections: [
    {
      title: 'Least squares',
      items: [
        { id: 'residual', name: 'Residual', formula: '$r = b - Ax$', when: 'Data minus fit.', lesson: 'one' },
        { id: 'normal', name: 'Normal equations', formula: '$A^\\mathsf{T}A\\,x = A^\\mathsf{T}b$', when: 'To find the best fit.', lesson: 'two' },
      ],
    },
    { title: 'Other', items: [{ id: 'free', name: 'No lesson', formula: '$x$', when: 'Anywhere.' }] },
  ],
}

let sheetResponse: () => Promise<unknown>

const mount = async (lessonId = 'one', withSheet = true) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('cheatsheet.json')) return sheetResponse()
      return { ok: true, json: async () => lesson(url.includes('two') ? 'two' : 'one') }
    }),
  )
  render(<LessonView course={withSheet ? course : { ...course, cheatsheet: undefined }} lessonId={lessonId} base="./" onClose={() => {}} onOpenLesson={() => {}} />)
  await screen.findByRole('textbox', { name: 'x' })
}

const open = () => fireEvent.click(screen.getByRole('button', { name: 'Cheat sheet' }))
const panel = () => screen.getByRole('dialog', { name: 'Cheat sheet' })
const fetchedSheets = () => (fetch as ReturnType<typeof vi.fn>).mock.calls.filter(([url]) => String(url).endsWith('cheatsheet.json')).length
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  localStorage.clear()
  forgetCachedProgress()
  forgetFetchedSheets()
  window.history.replaceState(null, '', '/')
  sheetResponse = async () => ({ ok: true, json: async () => sheet })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('offering the tool', () => {
  it('is in the dock after the pad and calculator when the course has a sheet', async () => {
    await mount()
    const dock = screen.getByRole('group', { name: 'Tools' })
    expect(within(dock).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Scratch pad', 'Calculator', 'Cheat sheet'])
  })

  it('is absent when the course has none, and nothing is fetched', async () => {
    await mount('one', false)
    expect(screen.queryByRole('button', { name: 'Cheat sheet' })).toBeNull()
    expect(fetchedSheets()).toBe(0)
  })

  it('is not fetched until it is first opened, and then only once', async () => {
    await mount()
    expect(fetchedSheets()).toBe(0)
    open()
    await flush()
    expect(fetchedSheets()).toBe(1)
    fireEvent.keyDown(window, { key: 'Escape' })
    open()
    expect(fetchedSheets()).toBe(1)
  })
})

describe('the formulas', () => {
  it('shows sections with name, typeset formula and the when line', async () => {
    await mount()
    open()
    await flush()
    const p = within(panel())
    expect(p.getByRole('heading', { name: 'Least squares' })).toBeTruthy()
    expect(p.getByText('Normal equations')).toBeTruthy()
    expect(p.getByText('To find the best fit.')).toBeTruthy()
    expect(panel().querySelectorAll('.cheat-formula .katex')).toHaveLength(3)
  })

  it('marks only the items of the lesson he is on', async () => {
    await mount('two')
    open()
    await flush()
    const marks = panel().querySelectorAll('.cheat-here')
    expect(marks).toHaveLength(1)
    expect(marks[0].closest('.cheat-item')?.textContent).toContain('Normal equations')
  })

  it('says plainly while loading, and when it could not be loaded, and notes still work', async () => {
    sheetResponse = () => new Promise(() => {})
    await mount()
    open()
    expect(screen.getByText('Loading the cheat sheet…')).toBeTruthy()
    cleanup()
    forgetFetchedSheets()
    sheetResponse = async () => ({ ok: false, status: 404, statusText: 'Not Found' })
    await mount()
    open()
    await flush()
    expect(screen.getByRole('alert').textContent).toContain('The cheat sheet could not be loaded (404 Not Found)')
    expect(screen.getByRole('textbox', { name: 'Add a note' })).toBeTruthy()
  })
})

describe('my notes', () => {
  const field = () => screen.getByRole('textbox', { name: 'Add a note' }) as HTMLInputElement
  const add = (text: string) => {
    fireEvent.change(field(), { target: { value: text } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
  }
  const stored = () => JSON.parse(localStorage.getItem(storageKey('demo'))!)

  it('adds a line with maths, keeps it on the device, and clears the field', async () => {
    await mount()
    open()
    await flush()
    add('residual again: $\\|r\\|^2$')
    const list = screen.getByRole('list', { name: 'My notes' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(1)
    expect(list.querySelector('.katex')).not.toBeNull()
    expect(field().value).toBe('')
    expect(stored()).toMatchObject({ format: 1, notes: [{ id: 'n1', text: 'residual again: $\\|r\\|^2$' }] })
  })

  it('is still there after the lesson is opened again, in the same course', async () => {
    await mount()
    open()
    add('keep me')
    cleanup()
    await mount('two')
    open()
    await flush()
    expect(screen.getByText('keep me')).toBeTruthy()
  })

  it('does not add an empty line (the button is off)', async () => {
    await mount()
    open()
    expect((screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows typed HTML as text and injects nothing', async () => {
    await mount()
    open()
    add('<img src=x onerror=alert(1)> <b>bold</b>')
    const text = panel().querySelector('.cheat-note-text')!
    expect(text.querySelector('img, b, script')).toBeNull()
    expect(text.textContent).toContain('<img src=x onerror=alert(1)>')
  })

  it('removes after a second tap, and the first tap lapses after 3 seconds', async () => {
    localStorage.setItem(storageKey('demo'), JSON.stringify({ format: 1, notes: [{ id: 'n1', text: 'one', at: 'x' }, { id: 'n2', text: 'two', at: 'x' }] }))
    await mount()
    vi.useFakeTimers()
    try {
      open()
      fireEvent.click(screen.getByRole('button', { name: 'Remove: one' }))
      expect(screen.getByRole('button', { name: 'Tap again to remove: one' })).toBeTruthy()
      act(() => {
        vi.advanceTimersByTime(3100)
      })
      expect(screen.getByRole('button', { name: 'Remove: one' })).toBeTruthy()
      expect(screen.getAllByRole('listitem')).toHaveLength(2)

      fireEvent.click(screen.getByRole('button', { name: 'Remove: one' }))
      fireEvent.click(screen.getByRole('button', { name: 'Tap again to remove: one' }))
      expect(screen.queryByText('one')).toBeNull()
      expect(stored().notes.map((n: { id: string }) => n.id)).toEqual(['n2'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('a full list says so and takes no more', async () => {
    const notes = Array.from({ length: MAX_NOTES }, (_, i) => ({ id: `n${i + 1}`, text: `note ${i + 1}`, at: 'x' }))
    localStorage.setItem(storageKey('demo'), JSON.stringify({ format: 1, notes }))
    await mount()
    open()
    expect(field().disabled).toBe(true)
    expect(screen.getByText(/100 notes is the most/)).toBeTruthy()
  })

  it('reads corrupt stored notes as an empty list', async () => {
    localStorage.setItem(storageKey('demo'), '{{{')
    await mount()
    open()
    expect(screen.queryByRole('list', { name: 'My notes' })).toBeNull()
    expect(screen.getByText(/Nothing yet/)).toBeTruthy()
  })
})
