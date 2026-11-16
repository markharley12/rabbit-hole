import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ChatStore, ChatTarget } from '../ai/chat-store.ts'
import { ChatInput, MessageList } from '../ai/ChatParts.tsx'

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

const FAILED = 'The tutor could not be reached. Your lesson is unaffected.'

/**
 * The Ask tool: a chat with the tutor about the screen the lesson is on. The
 * chat lives in the store, not here, so closing the overlay mid-reply loses
 * nothing. It reads the step's progress when a message is sent and never
 * writes to it. The message list and the input are shared with the
 * new-course chat (src/ai/ChatParts.tsx).
 */
export function Chat({ store, target, about, isStep }: Props) {
  const state = useSyncExternalStore(store.subscribe, () => store.get(target.key))
  const [armed, setArmed] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null)
  const busy = state.status === 'streaming' || state.status === 'loading'

  useEffect(() => {
    void store.open(target.key)
  }, [store, target.key])

  useEffect(() => {
    if (!armed) return
    const timer = setTimeout(() => setArmed(false), 3000)
    return () => clearTimeout(timer)
  }, [armed])

  const send = (message: string) => {
    if (busy || !message.trim()) return
    void store.send(target, message)
  }
  const startOver = () => {
    if (!armed) return setArmed(true)
    setArmed(false)
    store.reset(target.key)
    input.current?.focus()
  }

  const starters = [...(isStep ? ['Give me another hint'] : []), 'Explain the terms on this screen', 'Why does this step matter?']

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

      <MessageList
        state={state}
        failed={FAILED}
        onRetry={() => void store.retry(target)}
        empty={
          <div className="ask-starters">
            <p className="ask-quiet">Ask about this screen, or start with one of these.</p>
            {starters.map((starter) => (
              <button key={starter} type="button" className="ask-starter" onClick={() => send(starter)}>
                {starter}
              </button>
            ))}
          </div>
        }
      />

      <ChatInput
        inputRef={input}
        label="Your question"
        placeholder="Ask about this screen"
        streaming={state.status === 'streaming'}
        busy={busy}
        onSend={send}
        onStop={() => store.stop(target.key)}
      />
    </div>
  )
}
