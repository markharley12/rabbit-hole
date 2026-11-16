// The pieces every chat in the app shares: the message list (with the reply
// streaming in, tool notes, the failure line and Retry) and the input (a box
// that grows to four lines, Enter sends on a real keyboard, Send or Stop).
// Used by the Ask tool (src/tools/Chat.tsx) and the new-course chat
// (NewCourse.tsx). The class names are the Ask chat's, styled in styles.css.

import { useLayoutEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent, ReactNode, RefObject } from 'react'
import { Md } from '../lesson/Md.tsx'
import type { ChatState } from './chat-store.ts'

/** Enter sends where there is a real keyboard; on a phone Enter is a new line and Send sends. */
const enterSends = () => typeof window.matchMedia === 'function' && window.matchMedia('(hover: hover) and (pointer: fine)').matches

interface ListProps {
  state: ChatState
  /** The line shown when a reply failed. */
  failed: string
  onRetry: () => void
  /** Shown when nothing has been said yet. */
  empty?: ReactNode
  /** Shown under the messages (the new-course brief card). */
  children?: ReactNode
}

export function MessageList({ state, failed, onRetry, empty, children }: ListProps) {
  const list = useRef<HTMLDivElement>(null)

  // New text at the bottom stays in view.
  useLayoutEffect(() => {
    const element = list.current
    if (element) element.scrollTop = element.scrollHeight
  }, [state.messages, state.pending, state.status, children])

  const nothingYet = state.messages.length === 0 && state.status === 'idle'

  return (
    <div className="ask-messages" ref={list} aria-live="polite">
      {state.status === 'loading' && <p className="ask-quiet">Loading this chat…</p>}
      {nothingYet && empty}
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
          <p>{failed}</p>
          <button type="button" className="ask-retry" onClick={onRetry}>
            Retry
          </button>
        </div>
      )}
      {children}
    </div>
  )
}

interface InputProps {
  /** Sends the text; the box empties. */
  onSend: (text: string) => void
  onStop: () => void
  streaming: boolean
  /** Sending is not possible now (loading, or streaming). */
  busy: boolean
  label: string
  placeholder: string
  /** Lets the owner focus the box ("Keep talking"). */
  inputRef?: RefObject<HTMLTextAreaElement | null>
  /** Text to start with (an entry screen's draft carried into the chat). */
  initial?: string
}

export function ChatInput({ onSend, onStop, streaming, busy, label, placeholder, inputRef, initial = '' }: InputProps) {
  const [text, setText] = useState(initial)
  const own = useRef<HTMLTextAreaElement>(null)
  const input = inputRef ?? own

  // The box grows with its text up to four lines (the CSS caps the height).
  useLayoutEffect(() => {
    const box = input.current
    if (!box) return
    box.style.height = 'auto'
    if (box.scrollHeight) box.style.height = `${box.scrollHeight}px`
  }, [text, input])

  const send = (message: string) => {
    if (busy || !message.trim()) return
    onSend(message)
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

  return (
    <form className="ask-form" onSubmit={submit}>
      <textarea
        ref={input}
        className="ask-input"
        aria-label={label}
        placeholder={placeholder}
        rows={1}
        maxLength={4000}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={key}
      />
      {streaming ? (
        <button type="button" className="ask-send" onClick={onStop}>
          Stop
        </button>
      ) : (
        <button type="submit" className="ask-send" disabled={busy || !text.trim()}>
          Send
        </button>
      )}
    </form>
  )
}
