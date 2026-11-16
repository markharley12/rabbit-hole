// The new-course view against a fake client: no server, no claude.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import NewCourse, { POLL_MS } from './NewCourse.tsx'
import type { Build, Draft, NewCourseClient } from './course-client.ts'
import type { TurnHandlers, TurnResult } from './client.ts'

const SID = 'S'.repeat(22)
const DID = '0123456789abcdef'
const BID = 'fedcba9876543210'

const brief = {
  title: 'Eigenvalues of a 2x2 matrix',
  courseId: 'eigen-two',
  nodeId: '15Axx',
  nodeName: 'Basic linear algebra',
  lessons: [
    { title: 'What an eigenvector does', summary: 'a direction that only stretches' },
    { title: 'The characteristic polynomial', summary: '' },
    { title: 'Eigenvectors', summary: '' },
  ],
  missingWidgets: ['A matrix acting on a draggable vector.'],
  sources: [{ url: 'https://en.wikipedia.org/wiki/Eigenvalues', note: '' }],
}

const draft = (change: Partial<Draft> = {}): Draft => ({ id: DID, sessionId: SID, title: 'Eigen', state: 'ready', brief, problems: [], build: null, ...change })
const build = (change: Partial<Build> = {}): Build => ({
  id: BID, draftId: DID, courseId: 'eigen-two', title: 'Eigenvalues of a 2x2 matrix', state: 'running', round: 0,
  log: [{ at: 't', text: 'Writing the course' }], problems: [], missingWidgets: [], unread: false, ...change,
})

function fakeClient() {
  const state = { drafts: [] as Draft[], draft: null as Draft | null, build: build(), unreachable: false }
  const replies: { text: string; handlers: TurnHandlers; resolve: (r: TurnResult) => void }[] = []
  const client = {
    available: vi.fn(async () => true),
    createSession: vi.fn(async () => SID),
    turn: vi.fn(
      (_sid: string, text: string, _u: unknown, handlers: TurnHandlers) =>
        new Promise<TurnResult>((resolve) => replies.push({ text, handlers, resolve })),
    ),
    stop: vi.fn(async () => {}),
    transcript: vi.fn(async () => [
      { role: 'user' as const, text: 'eigen things', at: 't' },
      { role: 'assistant' as const, text: 'Here is a brief.', at: 't' },
    ]),
    createCourseChat: vi.fn(async () => ({ sessionId: SID, draftId: DID })),
    draft: vi.fn(async () => state.draft),
    drafts: vi.fn(async () => {
      if (state.unreachable) throw new TypeError('offline')
      return state.drafts
    }),
    startBuild: vi.fn(async () => BID),
    build: vi.fn(async () => state.build),
    builds: vi.fn(async () => []),
    stopBuild: vi.fn(async () => {}),
    seen: vi.fn(async () => {}),
  } satisfies NewCourseClient
  return { client, state, replies }
}

const flush = () => act(async () => {})

beforeEach(() => localStorage.clear())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('the new-course view', () => {
  it('starts from one sentence and a box, and sends the first words with the node as a suggestion', async () => {
    const { client, state, replies } = fakeClient()
    render(<NewCourse node={{ id: '15Axx', name: 'Basic linear algebra' }} onClose={() => {}} onOpenCourse={async () => true} client={client} />)
    await flush()
    expect(screen.getByText('Say what you want to learn. A rough idea is enough.')).toBeTruthy()
    expect(screen.getByText('From Basic linear algebra')).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: 'What you want to learn' }), { target: { value: 'eigen things' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await flush()
    expect(client.createCourseChat).toHaveBeenCalledWith('15Axx')
    expect(replies[0].text).toBe('eigen things')
    expect(screen.getByText('eigen things')).toBeTruthy()

    // The reply ends; the session has written a brief.
    state.draft = draft()
    await act(async () => replies[0].resolve({ text: 'I wrote the brief.' }))
    await flush()
    expect(screen.getByText('Eigenvalues of a 2x2 matrix')).toBeTruthy()
    expect(screen.getByText('On the map: Basic linear algebra (15Axx)')).toBeTruthy()
    expect(screen.getByText(/Missing picture/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'en.wikipedia.org' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Build this' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Keep talking' })).toBeTruthy()
  })

  it('shows a brief’s problems with only Keep talking', async () => {
    const { client, state } = fakeClient()
    state.drafts = [draft({ state: 'problems', problems: ['courseId "x" is taken by a course that exists; choose another.'] })]
    state.draft = state.drafts[0]
    render(<NewCourse node={null} onClose={() => {}} onOpenCourse={async () => true} client={client} />)
    await flush()
    expect(screen.getByText('From the whole map')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Continue: Eigen' }))
    await flush()
    expect(screen.getByText('Here is a brief.')).toBeTruthy()
    expect(screen.getByText(/is taken by a course/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Build this' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Keep talking' }))
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Your message' }))
  })

  it('builds, shows progress, and opens the course at the end', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { client, state } = fakeClient()
    state.drafts = [draft()]
    state.draft = draft()
    const onOpenCourse = vi.fn(async () => true)
    render(<NewCourse node={null} onClose={() => {}} onOpenCourse={onOpenCourse} client={client} />)
    await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Continue: Eigen' }))
    await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Build this' }))
    await flush()
    expect(client.startBuild).toHaveBeenCalledWith(DID)
    expect(screen.getByText('Writing the course', { selector: 'li' })).toBeTruthy()

    // Stop needs two taps.
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(client.stopBuild).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Tap again to stop the build' })).toBeTruthy()

    state.build = build({ state: 'done', log: [{ at: 't', text: 'Writing lesson 1 of 3' }, { at: 't', text: 'Your course is ready' }] })
    await act(async () => {
      vi.advanceTimersByTime(POLL_MS)
    })
    await flush()
    expect(screen.getByRole('heading', { name: 'Your course is ready' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open the course' }))
    await flush()
    expect(client.seen).toHaveBeenCalledWith(BID)
    expect(onOpenCourse).toHaveBeenCalledWith('eigen-two')
  })

  it('says what went wrong, and Keep talking goes back to the chat', async () => {
    const { client, state } = fakeClient()
    state.drafts = [draft({ state: 'building', build: { id: BID, state: 'running' } })]
    state.draft = draft({ state: 'failed', build: { id: BID, state: 'failed' } })
    state.build = build({ state: 'failed', problems: ['content/maths/courses/eigen-two/one.json: key 6 does not equal verify (5)'] })
    render(<NewCourse node={null} onClose={() => {}} onOpenCourse={async () => true} client={client} />)
    await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Continue: Eigen (building)' }))
    await flush()
    expect(screen.getByRole('heading', { name: 'The build did not finish.' })).toBeTruthy()
    expect(screen.getByText(/key 6 does not equal/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Keep talking' }))
    await flush()
    expect(screen.getByText('Here is a brief.')).toBeTruthy()
    expect(screen.getByText('The last build of this brief did not finish.')).toBeTruthy()
  })

  it('says plainly when the server cannot be reached', async () => {
    const { client, state } = fakeClient()
    state.unreachable = true
    render(<NewCourse node={null} onClose={() => {}} onOpenCourse={async () => true} client={client} />)
    await flush()
    expect(screen.getByRole('alert').textContent).toMatch(/cannot be reached now/)
  })
})
