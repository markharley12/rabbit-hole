// Talking to server/rabbit_server.py: the app and the API share one origin, so
// every address is relative (./api/...). A turn's reply arrives as
// server-sent events over a POST, read with fetch and a ReadableStream
// (EventSource can only GET).

import type { AskContext, StepSnapshot } from './context.ts'

export interface SseEvent {
  event: string
  data: string
}

/**
 * A server-sent events parser that is fed text in any chunks (an event may be
 * split anywhere, even inside "\r\n"). Comments (": ping") are skipped. Calls
 * onEvent once per complete event.
 */
export function createSseParser(onEvent: (event: SseEvent) => void) {
  let buffer = ''
  let name = ''
  let data: string[] = []

  const line = (text: string) => {
    if (text === '') {
      if (data.length > 0 || name) onEvent({ event: name || 'message', data: data.join('\n') })
      name = ''
      data = []
      return
    }
    if (text.startsWith(':')) return
    const colon = text.indexOf(':')
    const field = colon === -1 ? text : text.slice(0, colon)
    let value = colon === -1 ? '' : text.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'event') name = value
    else if (field === 'data') data.push(value)
  }

  return {
    feed(chunk: string) {
      buffer += chunk
      // A lone \r at the very end may be the first half of \r\n: wait for more.
      for (;;) {
        const match = /\r\n|\n|\r(?!$)/.exec(buffer)
        if (!match) break
        line(buffer.slice(0, match.index))
        buffer = buffer.slice(match.index + match[0].length)
      }
    },
    /** The stream has ended: a last event without its blank line still counts. */
    end() {
      if (buffer) line(buffer.replace(/\r$/, ''))
      buffer = ''
      line('')
    },
  }
}

export interface TranscriptMessage {
  role: 'user' | 'assistant'
  text: string
  at: string
}

export interface TurnHandlers {
  onDelta: (text: string) => void
  onNote: (text: string) => void
}

export interface TurnResult {
  text: string
  costUsd?: number
  stopped?: boolean
}

/** The server said no, or could not be reached, or the stream broke. */
export class TutorError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
  }
}

export interface ChatClient {
  /** True when the server is there and offers the ask kind. Never throws. */
  available(): Promise<boolean>
  createSession(context: AskContext): Promise<string>
  turn(sessionId: string, text: string, update: StepSnapshot | null, handlers: TurnHandlers, signal?: AbortSignal): Promise<TurnResult>
  stop(sessionId: string): Promise<void>
  /** The session's messages, or null when the server no longer has it. */
  transcript(sessionId: string): Promise<TranscriptMessage[] | null>
}

/** Server ids are secrets.token_urlsafe(16); anything else from storage is ignored. */
export const SESSION_ID = /^[A-Za-z0-9_-]{16,64}$/

const STATE_TIMEOUT = 2000

/**
 * The session kinds the server offers, from GET state; [] when it is not
 * there, not ours, or slower than two seconds. Never throws. The Ask chat and
 * the new-course entry buttons both decide from this.
 */
export async function serverKinds(base = './api/', fetcher: typeof fetch = (...args) => fetch(...args)): Promise<string[]> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), STATE_TIMEOUT)
  try {
    const response = await fetcher(`${base}state`, { signal: controller.signal, cache: 'no-store' })
    if (!response.ok) return []
    const state = (await response.json()) as { ok?: unknown; kinds?: unknown }
    if (state?.ok !== true || !Array.isArray(state.kinds)) return []
    return state.kinds.filter((k): k is string => typeof k === 'string')
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }
}

export function createClient(base = './api/', fetcher: typeof fetch = (...args) => fetch(...args)): ChatClient {
  const post = (path: string, body: unknown, signal?: AbortSignal) =>
    fetcher(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal })

  return {
    async available() {
      return (await serverKinds(base, fetcher)).includes('ask')
    },

    async createSession(context) {
      const response = await post('session', { kind: 'ask', context })
      if (!response.ok) throw new TutorError(`session refused (${response.status})`, response.status)
      const body = (await response.json()) as { sessionId?: unknown }
      if (typeof body.sessionId !== 'string' || !SESSION_ID.test(body.sessionId)) throw new TutorError('no session id')
      return body.sessionId
    },

    async turn(sessionId, text, update, handlers, signal) {
      const response = await post('turn', update ? { sessionId, text, update } : { sessionId, text }, signal)
      if (!response.ok || !response.body) throw new TutorError(`turn refused (${response.status})`, response.status)
      // Set from inside the parser's callback, so an object (narrowing does not see into callbacks).
      const end: { result?: TurnResult; failure?: string } = {}
      const parser = createSseParser(({ event, data }) => {
        if (end.result || end.failure) return
        let payload: Record<string, unknown>
        try {
          payload = JSON.parse(data) as Record<string, unknown>
        } catch {
          return
        }
        const said = typeof payload.text === 'string' ? payload.text : ''
        if (event === 'delta') handlers.onDelta(said)
        else if (event === 'note') handlers.onNote(said)
        else if (event === 'done') {
          const result: TurnResult = { text: said }
          if (typeof payload.costUsd === 'number') result.costUsd = payload.costUsd
          if (payload.stopped === true) result.stopped = true
          end.result = result
        } else if (event === 'error') end.failure = typeof payload.message === 'string' ? payload.message : 'error'
      })
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        parser.feed(decoder.decode(value, { stream: true }))
        if (end.result || end.failure) break
      }
      parser.feed(decoder.decode())
      parser.end()
      reader.cancel().catch(() => {})
      if (end.failure) throw new TutorError(end.failure)
      if (!end.result) throw new TutorError('the reply stopped before it finished')
      return end.result
    },

    async stop(sessionId) {
      try {
        await post('stop', { sessionId })
      } catch {
        // The local stream is aborted anyway.
      }
    },

    async transcript(sessionId) {
      const response = await fetcher(`${base}transcript?id=${encodeURIComponent(sessionId)}`, { cache: 'no-store' })
      if (response.status === 404) return null
      if (!response.ok) throw new TutorError(`transcript refused (${response.status})`, response.status)
      const body = (await response.json()) as { messages?: unknown }
      if (!Array.isArray(body.messages)) return []
      return body.messages.filter(
        (m): m is TranscriptMessage =>
          typeof m === 'object' && m !== null && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string',
      )
    },
  }
}
