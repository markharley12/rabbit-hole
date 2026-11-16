// The Ask tool on a real lesson screen, against a fake tutor client: no
// server, no claude. Each turn waits until the test pushes text into it.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { storageKey } from '../ai/chat-store.ts'
import { TutorError } from '../ai/client.ts'
import type { ChatClient, TranscriptMessage, TurnHandlers, TurnResult } from '../ai/client.ts'
import type { AskContext, StepSnapshot } from '../ai/context.ts'
import LessonView from '../lesson/LessonView.tsx'
import { forgetCachedProgress } from '../lesson/progress-store.ts'
import type { Course, Lesson } from '../lesson/types.ts'

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
  title: 'Lesson one',
  blocks: [
    {
      type: 'step',
      id: 's1',
      title: 'Add them',
      why: 'Because.',
      prompt: 'What is 2 + 2?',
      answer: { fields: [{ name: 'x', key: '4' }], verify: '4' },
      hints: ['a', 'b', 'c'],
      next: 'On',
    },
  ],
}

const SID = 'S'.repeat(22)

interface Turn {
  sessionId: string
  text: string
  update: StepSnapshot | null
  handlers: TurnHandlers
  resolve: (result: TurnResult) => void
  reject: (error: unknown) => void
}

function fakeTutor({ available = true, transcript = [] as TranscriptMessage[] | null } = {}) {
  const turns: Turn[] = []
  const state = { available }
  const client = {
    available: vi.fn(async () => state.available),
    createSession: vi.fn(async (context: AskContext) => {
      void context
      return SID
    }),
    turn: vi.fn(
      (sessionId: string, text: string, update: StepSnapshot | null, handlers: TurnHandlers, signal?: AbortSignal) =>
        new Promise<TurnResult>((resolve, reject) => {
          turns.push({ sessionId, text, update, handlers, resolve, reject })
          signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        }),
    ),
    stop: vi.fn(async () => {}),
    transcript: vi.fn(async () => transcript),
  } satisfies ChatClient
  return { client, turns, state }
}

const mount = async (tutor: ChatClient) => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => lesson })))
  render(<LessonView course={course} lessonId="one" base="./" onClose={() => {}} onOpenLesson={() => {}} tutor={tutor} />)
  await screen.findByRole('textbox', { name: 'x' })
  // Let the availability check settle.
  await act(async () => {})
}

const openAsk = () => fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
const chat = () => within(screen.getByRole('dialog', { name: 'Ask' }))
const flush = () => act(async () => {})

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  localStorage.clear()
  forgetCachedProgress()
  window.history.replaceState(null, '', '/')
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('whether Ask is offered', () => {
  it('is not in the dock when the server did not answer, and nothing else changes', async () => {
    const { client } = fakeTutor({ available: false })
    await mount(client)
    const dock = screen.getByRole('group', { name: 'Tools' })
    expect(within(dock).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Scratch pad', 'Calculator'])
  })

  it('is checked again when another tool is opened, and appears once the server is back', async () => {
    const { client, state } = fakeTutor({ available: false })
    await mount(client)
    expect(client.available).toHaveBeenCalledTimes(1)
    state.available = true
    fireEvent.click(screen.getByRole('button', { name: 'Calculator' }))
    await flush()
    expect(client.available).toHaveBeenCalledTimes(2)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByRole('button', { name: 'Ask' })).toBeTruthy()
  })
})

describe('the Ask chat', () => {
  it('says what it is about and offers starters; a starter sends with the context built then', async () => {
    const { client, turns } = fakeTutor()
    await mount(client)
    fireEvent.change(screen.getByRole('textbox', { name: 'x' }), { target: { value: '5' } })
    openAsk()
    expect(chat().getByText('About: Add them, Lesson one')).toBeTruthy()
    fireEvent.click(chat().getByRole('button', { name: 'Give me another hint' }))
    await flush()

    expect(client.createSession).toHaveBeenCalledTimes(1)
    const context = client.createSession.mock.calls[0][0]
    expect(context).toMatchObject({ courseId: 'demo', lessonId: 'one', block: { id: 's1' }, draft: { x: '5' }, canReveal: false })
    expect(turns).toHaveLength(1)
    expect(turns[0]).toMatchObject({ sessionId: SID, text: 'Give me another hint', update: null })
    expect(localStorage.getItem(storageKey('demo:one:s1'))).toBe(SID)
    expect(chat().getByText('Give me another hint').closest('[data-role]')?.getAttribute('data-role')).toBe('user')
    expect(chat().queryByRole('button', { name: 'Explain the terms on this screen' })).toBeNull()
  })

  it('shows streamed text as it arrives, notes quietly, and the final text typeset', async () => {
    const { client, turns } = fakeTutor()
    await mount(client)
    openAsk()
    fireEvent.change(chat().getByRole('textbox', { name: 'Your question' }), { target: { value: 'Why four?' } })
    fireEvent.click(chat().getByRole('button', { name: 'Send' }))
    await flush()
    expect((chat().getByRole('textbox', { name: 'Your question' }) as HTMLTextAreaElement).value).toBe('')
    expect(chat().getByText('Thinking…')).toBeTruthy()

    act(() => {
      turns[0].handlers.onDelta('Two and ')
      turns[0].handlers.onNote('Reading the lesson file')
      turns[0].handlers.onDelta('two.')
    })
    expect(chat().getByText('Two and two.')).toBeTruthy()
    expect(chat().getByText('Reading the lesson file')).toBeTruthy()
    expect(chat().getByRole('button', { name: 'Stop' })).toBeTruthy()

    await act(async () => turns[0].resolve({ text: 'It is $2 + 2$.' }))
    const reply = document.querySelector('.ask-message.assistant')!
    expect(reply.querySelector('.katex')).not.toBeNull()
    expect(reply.textContent).toContain('It is')
    expect(chat().getByText('Reading the lesson file')).toBeTruthy()
    expect(chat().getByRole('button', { name: 'Send' })).toBeTruthy()
  })

  it('Stop asks the server to stop and keeps what had arrived', async () => {
    const { client, turns } = fakeTutor()
    await mount(client)
    openAsk()
    fireEvent.click(chat().getByRole('button', { name: 'Why does this step matter?' }))
    await flush()
    act(() => turns[0].handlers.onDelta('Half a th'))
    fireEvent.click(chat().getByRole('button', { name: 'Stop' }))
    await flush()
    expect(client.stop).toHaveBeenCalledWith(SID)
    expect(chat().getByText('Half a th')).toBeTruthy()
    expect(chat().getByText('Stopped.')).toBeTruthy()
    expect(chat().queryByRole('alert')).toBeNull()
  })

  it('a failed reply says the lesson is unaffected, and Retry sends the same message once', async () => {
    const { client, turns } = fakeTutor()
    await mount(client)
    openAsk()
    fireEvent.click(chat().getByRole('button', { name: 'Give me another hint' }))
    await flush()
    await act(async () => turns[0].reject(new TutorError('turn refused (409)', 409)))
    expect(chat().getByRole('alert').textContent).toContain('The tutor could not be reached. Your lesson is unaffected.')
    // The step is still there and usable.
    expect(screen.getByRole('textbox', { name: 'x', hidden: true })).toBeTruthy()

    fireEvent.click(chat().getByRole('button', { name: 'Retry' }))
    await flush()
    expect(turns).toHaveLength(2)
    expect(turns[1].text).toBe('Give me another hint')
    expect(client.createSession).toHaveBeenCalledTimes(1)
    await act(async () => turns[1].resolve({ text: 'Count on.' }))
    expect(chat().getAllByText('Give me another hint')).toHaveLength(1)
    expect(chat().getByText('Count on.')).toBeTruthy()
  })

  it('keeps streaming while closed, and opens again as it was', async () => {
    const { client, turns } = fakeTutor()
    await mount(client)
    openAsk()
    fireEvent.click(chat().getByRole('button', { name: 'Give me another hint' }))
    await flush()
    fireEvent.keyDown(window, { key: 'Escape' })
    await act(async () => turns[0].resolve({ text: 'Done while closed.' }))
    openAsk()
    expect(chat().getByText('Done while closed.')).toBeTruthy()
  })

  it('tells the tutor what changed on the step since the chat began', async () => {
    const { client, turns } = fakeTutor()
    await mount(client)
    openAsk()
    fireEvent.click(chat().getByRole('button', { name: 'Give me another hint' }))
    await flush()
    await act(async () => turns[0].resolve({ text: 'Try it.' }))
    fireEvent.keyDown(window, { key: 'Escape' })

    fireEvent.change(screen.getByRole('textbox', { name: 'x' }), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Hint' }))
    openAsk()
    fireEvent.change(chat().getByRole('textbox', { name: 'Your question' }), { target: { value: 'Is that it?' } })
    fireEvent.click(chat().getByRole('button', { name: 'Send' }))
    await flush()
    expect(turns[1].update).toMatchObject({ draft: { x: '3' }, hints: 1, attempts: 0, canReveal: false })
    await act(async () => turns[1].resolve({ text: 'Nearly.' }))

    // Nothing new since: no update.
    fireEvent.change(chat().getByRole('textbox', { name: 'Your question' }), { target: { value: 'And?' } })
    fireEvent.click(chat().getByRole('button', { name: 'Send' }))
    await flush()
    expect(turns[2].update).toBeNull()
  })

  it('never writes to the progress record', async () => {
    const { client, turns } = fakeTutor()
    await mount(client)
    const before = localStorage.getItem('rabbit-hole:progress:demo')
    openAsk()
    fireEvent.click(chat().getByRole('button', { name: 'Give me another hint' }))
    await flush()
    await act(async () => turns[0].resolve({ text: 'Fine.' }))
    expect(localStorage.getItem('rabbit-hole:progress:demo')).toBe(before)
  })

  it('New chat asks twice, then starts a fresh session for this step', async () => {
    const { client, turns } = fakeTutor()
    await mount(client)
    openAsk()
    fireEvent.click(chat().getByRole('button', { name: 'Give me another hint' }))
    await flush()
    await act(async () => turns[0].resolve({ text: 'One.' }))
    fireEvent.click(chat().getByRole('button', { name: 'New chat' }))
    expect(chat().getByText('One.')).toBeTruthy()
    fireEvent.click(chat().getByRole('button', { name: 'Tap again for a new chat' }))
    expect(chat().queryByText('One.')).toBeNull()
    expect(localStorage.getItem(storageKey('demo:one:s1'))).toBeNull()
    fireEvent.click(chat().getByRole('button', { name: 'Explain the terms on this screen' }))
    await flush()
    expect(client.createSession).toHaveBeenCalledTimes(2)
  })

  it('continues a stored session, reloading its messages from the server', async () => {
    localStorage.setItem(storageKey('demo:one:s1'), SID)
    const { client, turns } = fakeTutor({
      transcript: [
        { role: 'user', text: 'Earlier question', at: 't' },
        { role: 'assistant', text: 'Earlier answer with $x$', at: 't' },
      ],
    })
    await mount(client)
    openAsk()
    await flush()
    expect(client.transcript).toHaveBeenCalledWith(SID)
    expect(chat().getByText('Earlier question')).toBeTruthy()
    expect(document.querySelector('.ask-message.assistant .katex')).not.toBeNull()
    fireEvent.change(chat().getByRole('textbox', { name: 'Your question' }), { target: { value: 'More?' } })
    fireEvent.click(chat().getByRole('button', { name: 'Send' }))
    await flush()
    expect(client.createSession).not.toHaveBeenCalled()
    expect(turns[0].sessionId).toBe(SID)
    // What the tutor was last told is not known after a reopen, so it is told now.
    expect(turns[0].update).not.toBeNull()
  })

  it('starts afresh when the server no longer has the stored session', async () => {
    localStorage.setItem(storageKey('demo:one:s1'), SID)
    const { client } = fakeTutor({ transcript: null })
    await mount(client)
    openAsk()
    await flush()
    expect(localStorage.getItem(storageKey('demo:one:s1'))).toBeNull()
    expect(chat().getByRole('button', { name: 'Give me another hint' })).toBeTruthy()
  })
})
