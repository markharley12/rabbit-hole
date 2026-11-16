import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import type { ChatStore, ChatTarget } from '../ai/chat-store.ts'
import { Md } from '../lesson/Md.tsx'

interface Props {
  store: ChatStore
  target: ChatTarget
  /** "One variable, The smallest best fit" */
  about: string
  /** A step has hints to ask for; a text screen does not. */
  isStep: boolean
}

/**
 * Renders nothing; runs `onOpen` when the tool overlay it is in opens. The
 * lesson's tools carry it so that opening any tool checks again for a tutor
 * that was not there when the lesson opened (the Ask button has none to tap).
 */
export function Opened({ onOpen }: { onOpen?: () => void }) {
  useEffect(() => {
    onOpen?.()
  }, [onOpen])
  return null
}

const FAILED ='The tutor could not be reached. Your lesson is unaffected.'

/** Enter sends where there is a real keyboard; on a phone Enter is a new line and Send sends. */
const enterSends = () => typeof window.matchMedia === 'function' && window.matchMedia('(hover: hover) and (pointer: fine)').matches

/**
 * The Ask tool: a chat with the tutor about the screen the lesson is on. The
 * chat lives in the store, not here, so closing the overlay mid-reply loses
 * nothing. It reads the step's progress when a message is sent and never
 * writes to it.
 */
export function Chat({ store, target, about, isStep }: Props) {
  const state = useSyncExternalStore(store.subscribe, () => store.get(target.key))
  const [text, setText] = useState('')
  const [armed, setArmed] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const busy = state.status === 'streaming' || state.status === 'loading'

  useEffect(() => {
    void store.open(target.key)
  }, [store, target.key])

  // New text at the bottom stays in view.
  useLayoutEffect(() => {
    const element = list.current
    if (element) element.scrollTop = element.scrollHeight
  }, [state.messages, state.pending, state.status])

  // The box grows with its text up to four lines (the CSS caps the height).
  useLayoutEffect(() => {
    const box = input.current
    if (!box) return
    box.style.height = 'auto'
    if (box.scrollHeight) box.style.height = `${box.scrollHeight}px`
  }, [text])

  useEffect(() => {
    if (!armed) return
    const timer = setTimeout(() => setArmed(false), 3000)
    return () => clearTimeout(timer)
  }, [armed])

  const send = (message: string) => {
    if (busy || !message.trim()) return
    void store.send(target, message)
    setText('')
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    send(text)
  }
  const key = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && enterSends()) {
      event.preventDefault()
      send(text)
    }
  }
  const startOver = () => {
    if (!armed) return setArmed(true)
    setArmed(false)
    store.reset(target.key)
    input.current?.focus()
  }

  const starters = [...(isStep ? ['Give me another hint'] : []), 'Explain the terms on this screen', 'Why does this step matter?']
  const empty = state.messages.length === 0 && state.status === 'idle'

  return (
    <div className="ask">
      <div className="ask-about">
        <p className="ask-about-line">About: {about}</p>
        {(state.messages.length > 0 || state.sessionId) && (
          <button type="button" className={armed ? 'ask-new armed' : 'ask-new'} onClick={startOver} disabled={busy}>
            {armed ? 'Tap again for a new chat' : 'New chat'}
          </button>
        )}
      </div>

      <div className="ask-messages" ref={list} aria-live="polite">
        {state.status === 'loading' && <p className="ask-quiet">Loading this chat…</p>}
        {empty && (
          <div className="ask-starters">
            <p className="ask-quiet">Ask about this screen, or start with one of these.</p>
            {starters.map((starter) => (
              <button key={starter} type="button" className="ask-starter" onClick={() => send(starter)}>
                {starter}
              </button>
            ))}
          </div>
        )}
        {state.messages.map((message) => (
          <div key={message.id} className={`ask-message ${message.role}`} data-role={message.role}>
            {message.notes?.map((note, i) => (
              <p key={i} className="ask-note">
                {note}
              </p>
            ))}
            {message.role === 'assistant' ? <Md className="ask-text" text={message.text} /> : <p className="ask-text">{message.text}</p>}
            {message.stopped && <p className="ask-note">Stopped.</p>}
          </div>
        ))}
        {state.pending && (
          <div className="ask-message assistant streaming" data-role="assistant">
            {state.pending.notes.map((note, i) => (
              <p key={i} className="ask-note">
                {note}
              </p>
            ))}
            {state.pending.text ? <Md className="ask-text" text={state.pending.text} /> : <p className="ask-quiet">Thinking…</p>}
          </div>
        )}
        {state.status === 'failed' && (
          <div className="ask-failed" role="alert">
            <p>{FAILED}</p>
            <button type="button" className="ask-retry" onClick={() => void store.retry(target)}>
              Retry
            </button>
          </div>
        )}
      </div>

      <form className="ask-form" onSubmit={submit}>
        <textarea
          ref={input}
          className="ask-input"
          aria-label="Your question"
          placeholder="Ask about this screen"
          rows={1}
          maxLength={4000}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={key}
        />
        {state.status === 'streaming' ? (
          <button type="button" className="ask-send" onClick={() => store.stop(target.key)}>
            Stop
          </button>
        ) : (
          <button type="submit" className="ask-send" disabled={busy || !text.trim()}>
            Send
          </button>
        )}
      </form>
    </div>
  )
}
