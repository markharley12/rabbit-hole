// The Ask chats of an open lesson, one per step, kept above the overlay so a
// reply keeps streaming while the chat is closed, and a closed chat opens
// again as it was. The server's session id is kept on the device, so
// reopening the step later continues the same session and reloads its
// messages from the server. Nothing here writes to the progress record.

import { useCallback, useEffect, useState } from 'react'
import { SESSION_ID } from './client.ts'
import type { ChatClient } from './client.ts'
import { stepUpdate } from './context.ts'
import type { AskContext, StepSnapshot } from './context.ts'

export interface ShownMessage {
  id: number
  role: 'user' | 'assistant'
  text: string
  /** Quiet lines about tools used while this reply was written (this visit only). */
  notes?: string[]
  stopped?: boolean
}

export interface ChatState {
  sessionId: string | null
  messages: ShownMessage[]
  status: 'idle' | 'loading' | 'streaming' | 'failed'
  /** The reply as it streams in. */
  pending: { text: string; notes: string[] } | null
  /** The message whose reply failed, for Retry. */
  failedText: string | null
  /** The stored session (if any) has been looked up. */
  opened: boolean
}

/** What a chat is about: its key, and how to read the step at the moment a message is sent. */
export interface ChatTarget {
  /** `<course>:<lesson>:<block>` */
  key: string
  context: () => AskContext
  snapshot: () => StepSnapshot
}

export const chatKey = (courseId: string, lessonId: string, blockId: string) => `${courseId}:${lessonId}:${blockId}`
// Prefixed: localStorage is shared by everything on an origin.
export const storageKey = (key: string) => `rabbit-hole:chat:${key}`

const EMPTY: ChatState = { sessionId: null, messages: [], status: 'idle', pending: null, failedText: null, opened: false }

function readId(key: string): string | null {
  try {
    const id = localStorage.getItem(storageKey(key))
    return id && SESSION_ID.test(id) ? id : null
  } catch {
    return null
  }
}

function writeId(key: string, id: string | null) {
  try {
    if (id) localStorage.setItem(storageKey(key), id)
    else localStorage.removeItem(storageKey(key))
  } catch {
    // Not kept: the chat still works for this visit.
  }
}

export class ChatStore {
  private states = new Map<string, ChatState>()
  private listeners = new Set<() => void>()
  /** What the tutor was last told about each step; unknown after a reopen. */
  private told = new Map<string, StepSnapshot>()
  private running = new Map<string, { controller: AbortController; stopping: boolean }>()
  private nextId = 1
  private client: ChatClient

  constructor(client: ChatClient) {
    this.client = client
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  get = (key: string): ChatState => this.states.get(key) ?? EMPTY

  private set(key: string, change: Partial<ChatState>) {
    this.states.set(key, { ...this.get(key), ...change })
    this.listeners.forEach((listener) => listener())
  }

  private message(role: ShownMessage['role'], text: string, extra: Partial<ShownMessage> = {}): ShownMessage {
    return { id: this.nextId++, role, text, ...extra }
  }

  /** Look up the stored session once, and load its messages from the server. */
  async open(key: string) {
    if (this.get(key).opened) return
    const id = readId(key)
    if (!id) {
      this.set(key, { opened: true })
      return
    }
    this.set(key, { opened: true, sessionId: id, status: 'loading' })
    try {
      const messages = await this.client.transcript(id)
      if (messages === null) {
        // The server no longer has it: start afresh.
        writeId(key, null)
        this.set(key, { sessionId: null, status: 'idle' })
        return
      }
      this.set(key, { messages: messages.map((m) => this.message(m.role, m.text)), status: 'idle' })
    } catch {
      // Unreachable for now; a message sent later still continues the session.
      this.set(key, { status: 'idle' })
    }
  }

  send(target: ChatTarget, text: string) {
    const clean = text.trim()
    const state = this.get(target.key)
    if (!clean || state.status === 'streaming' || state.status === 'loading') return Promise.resolve()
    this.set(target.key, { messages: [...state.messages, this.message('user', clean)] })
    return this.run(target, clean)
  }

  /** Send the failed message again (it is already shown once). */
  retry(target: ChatTarget) {
    const text = this.get(target.key).failedText
    if (!text || this.get(target.key).status !== 'failed') return Promise.resolve()
    return this.run(target, text)
  }

  private async run(target: ChatTarget, text: string) {
    const { key } = target
    const job = { controller: new AbortController(), stopping: false }
    this.running.set(key, job)
    this.set(key, { status: 'streaming', pending: { text: '', notes: [] }, failedText: null })
    const pending = () => this.get(key).pending ?? { text: '', notes: [] }
    try {
      let sessionId = this.get(key).sessionId
      let update: StepSnapshot | null = null
      let now: StepSnapshot
      if (!sessionId) {
        // The context is built now, at the first message, so it is as fresh as can be.
        const context = target.context()
        now = target.snapshot()
        sessionId = await this.client.createSession(context)
        writeId(key, sessionId)
        this.set(key, { sessionId })
      } else {
        now = target.snapshot()
        update = stepUpdate(this.told.get(key), now)
      }
      const result = await this.client.turn(
        sessionId,
        text,
        update,
        {
          onDelta: (piece) => this.set(key, { pending: { ...pending(), text: pending().text + piece } }),
          onNote: (note) => this.set(key, { pending: { ...pending(), notes: [...pending().notes, note] } }),
        },
        job.controller.signal,
      )
      this.told.set(key, now)
      const { notes } = pending()
      const reply = result.text || pending().text
      this.set(key, {
        status: 'idle',
        pending: null,
        messages: [...this.get(key).messages, ...(reply ? [this.message('assistant', reply, { notes, stopped: result.stopped })] : [])],
      })
    } catch {
      if (job.stopping) {
        const { text: partial, notes } = pending()
        this.set(key, {
          status: 'idle',
          pending: null,
          messages: partial ? [...this.get(key).messages, this.message('assistant', partial, { notes, stopped: true })] : this.get(key).messages,
        })
      } else {
        // Any failure (refused, unreachable, the stream broke): the same honest line and Retry.
        this.set(key, { status: 'failed', pending: null, failedText: text })
      }
    } finally {
      if (this.running.get(key) === job) this.running.delete(key)
    }
  }

  stop(key: string) {
    const job = this.running.get(key)
    if (!job) return
    job.stopping = true
    const id = this.get(key).sessionId
    if (id) void this.client.stop(id)
    job.controller.abort()
  }

  /** A fresh session for this step, on the next message. */
  reset(key: string) {
    if (this.running.has(key)) return
    writeId(key, null)
    this.told.delete(key)
    this.states.set(key, { ...EMPTY, opened: true })
    this.listeners.forEach((listener) => listener())
  }

  /** The lesson closed: stop listening to any reply (the server keeps it in the transcript). */
  dispose() {
    for (const job of this.running.values()) {
      job.stopping = true
      job.controller.abort()
    }
    this.running.clear()
  }
}

/**
 * Whether the tutor's server answered: checked once when the lesson opens,
 * and again on `recheck` (opening another tool) after a failure.
 */
export function useTutorAvailable(client: ChatClient): { available: boolean; recheck: () => void } {
  const [available, setAvailable] = useState(false)
  const [round, setRound] = useState(0)
  useEffect(() => {
    let live = true
    client.available().then((ok) => {
      if (live) setAvailable(ok)
    })
    return () => {
      live = false
    }
  }, [client, round])
  const recheck = useCallback(() => {
    if (!available) setRound((n) => n + 1)
  }, [available])
  return { available, recheck }
}
