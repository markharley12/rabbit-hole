import { describe, expect, it, vi } from 'vitest'
import { TutorError, createClient, createSseParser } from './client.ts'
import type { SseEvent } from './client.ts'

const STREAM =
  'event: delta\ndata: {"text": "The middle "}\n\n' +
  ': ping\n\n' +
  'event: note\ndata: {"text": "Reading the lesson file"}\n\n' +
  'event: delta\ndata: {"text": "term is $-12m$."}\n\n' +
  'event: done\ndata: {"text": "The middle term is $-12m$.", "costUsd": 0.01}\n\n'

const parseIn = (pieces: string[]) => {
  const events: SseEvent[] = []
  const parser = createSseParser((event) => events.push(event))
  pieces.forEach((piece) => parser.feed(piece))
  parser.end()
  return events
}

describe('the SSE parser', () => {
  const whole = parseIn([STREAM])

  it('reads events and skips comments', () => {
    expect(whole.map((e) => e.event)).toEqual(['delta', 'note', 'delta', 'done'])
    expect(JSON.parse(whole[3].data)).toEqual({ text: 'The middle term is $-12m$.', costUsd: 0.01 })
  })

  it('gives the same events whatever the chunk boundaries', () => {
    for (let size = 1; size <= 17; size++) {
      const pieces = []
      for (let i = 0; i < STREAM.length; i += size) pieces.push(STREAM.slice(i, i + size))
      expect(parseIn(pieces)).toEqual(whole)
    }
  })

  it('handles CRLF and CR line ends, even split between chunks', () => {
    const crlf = STREAM.replace(/\n/g, '\r\n')
    expect(parseIn([crlf])).toEqual(whole)
    const at = crlf.indexOf('\r\n') + 1
    expect(parseIn([crlf.slice(0, at), crlf.slice(at)])).toEqual(whole)
    expect(parseIn([STREAM.replace(/\n/g, '\r')])).toEqual(whole)
  })

  it('joins multi-line data and keeps a last event that has no blank line', () => {
    expect(parseIn(['event: x\ndata: a\ndata: b\n\nevent: done\ndata: {}'])).toEqual([
      { event: 'x', data: 'a\nb' },
      { event: 'done', data: '{}' },
    ])
  })
})

const streamOf = (text: string, size = 7) => {
  const bytes = new TextEncoder().encode(text)
  let i = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= bytes.length) return controller.close()
      controller.enqueue(bytes.slice(i, i + size))
      i += size
    },
  })
}

const response = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body, body: null }) as unknown as Response

describe('the client', () => {
  it('streams a turn: deltas and notes as they come, the final text at the end', async () => {
    const fetcher = vi.fn(async () => ({ ok: true, status: 200, body: streamOf(STREAM) }) as unknown as Response)
    const deltas: string[] = []
    const notes: string[] = []
    const result = await createClient('./api/', fetcher).turn('s'.repeat(22), 'why?', null, { onDelta: (t) => deltas.push(t), onNote: (t) => notes.push(t) })
    expect(deltas.join('')).toBe('The middle term is $-12m$.')
    expect(notes).toEqual(['Reading the lesson file'])
    expect(result).toEqual({ text: 'The middle term is $-12m$.', costUsd: 0.01 })
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('./api/turn')
    expect(JSON.parse(init.body as string)).toEqual({ sessionId: 's'.repeat(22), text: 'why?' })
  })

  it('sends the update when there is one', async () => {
    const fetcher = vi.fn(async () => ({ ok: true, status: 200, body: streamOf('event: done\ndata: {"text": "ok"}\n\n') }) as unknown as Response)
    const update = { draft: { f: '5' }, attempts: 1, hints: 2, canReveal: false, solved: false, revealed: false }
    await createClient('./api/', fetcher).turn('s'.repeat(22), 'and now?', update, { onDelta: () => {}, onNote: () => {} })
    const init = (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1]
    expect(JSON.parse(init.body as string).update).toEqual(update)
  })

  it('throws on an error event, a refused turn, and a stream that ends without done', async () => {
    const handlers = { onDelta: () => {}, onNote: () => {} }
    const failing = createClient('./api/', async () => ({ ok: true, status: 200, body: streamOf('event: error\ndata: {"message": "API Error"}\n\n') }) as unknown as Response)
    await expect(failing.turn('s'.repeat(22), 'x', null, handlers)).rejects.toThrow('API Error')
    const busy = createClient('./api/', async () => response(409, {}))
    await expect(busy.turn('s'.repeat(22), 'x', null, handlers)).rejects.toBeInstanceOf(TutorError)
    const cut = createClient('./api/', async () => ({ ok: true, status: 200, body: streamOf('event: delta\ndata: {"text": "half"}\n\n') }) as unknown as Response)
    await expect(cut.turn('s'.repeat(22), 'x', null, handlers)).rejects.toThrow('stopped before it finished')
  })

  it('is available only when the state says ok and offers ask', async () => {
    expect(await createClient('./api/', async () => response(200, { ok: true, version: 1, kinds: ['ask'], busy: false })).available()).toBe(true)
    expect(await createClient('./api/', async () => response(200, { ok: true, kinds: [] })).available()).toBe(false)
    expect(await createClient('./api/', async () => response(200, { format: 1 })).available()).toBe(false)
    expect(await createClient('./api/', async () => response(404, {})).available()).toBe(false)
    expect(
      await createClient('./api/', async () => {
        throw new TypeError('offline')
      }).available(),
    ).toBe(false)
  })

  it('gives up on the state after two seconds', async () => {
    vi.useFakeTimers()
    try {
      const hang = (_: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
      const answer = createClient('./api/', hang as typeof fetch).available()
      await vi.advanceTimersByTimeAsync(2000)
      expect(await answer).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('checks the session id it is given, and reads transcripts', async () => {
    await expect(createClient('./api/', async () => response(200, { sessionId: '../x' })).createSession({} as never)).rejects.toThrow('no session id')
    expect(await createClient('./api/', async () => response(200, { sessionId: 'a'.repeat(22) })).createSession({} as never)).toBe('a'.repeat(22))
    expect(await createClient('./api/', async () => response(404, {})).transcript('a'.repeat(22))).toBeNull()
    const messages = [
      { role: 'user', text: 'hi', at: 't' },
      { role: 'system', text: 'no', at: 't' },
    ]
    expect(await createClient('./api/', async () => response(200, { messages })).transcript('a'.repeat(22))).toEqual([messages[0]])
  })
})
