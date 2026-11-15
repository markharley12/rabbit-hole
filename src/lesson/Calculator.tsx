import { useEffect, useRef, useState } from 'react'
import { enter, insertResult, read } from '../tools/calculator.ts'
import type { CalcLine } from '../tools/calculator.ts'

interface Props {
  /**
   * Given, the calculator keeps a tape: each line entered (Enter or "=") is
   * kept with its result above the input, and tapping a result puts it back
   * into the input. Left out, it is the compact one-liner of "Check it yourself".
   */
  history?: CalcLine[]
  onHistory?: (history: CalcLine[]) => void
}

const fieldProps = {
  type: 'text',
  inputMode: 'text',
  autoComplete: 'off',
  autoCorrect: 'off',
  autoCapitalize: 'none',
  spellCheck: false,
} as const

/** A calculator in the answer grammar, for checking sums before sending. */
export function Calculator({ history, onHistory }: Props) {
  const [text, setText] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const tape = useRef<HTMLOListElement>(null)
  const reading = read(text)
  const shown = reading.kind === 'ok' ? `= ${reading.shown}` : reading.kind === 'partial' ? '…' : ''

  // The newest line is the one to see.
  useEffect(() => {
    const element = tape.current
    if (element) element.scrollTop = element.scrollHeight
  }, [history?.length])

  if (!history || !onHistory) {
    return (
      <label className="calculator">
        <span className="calculator-label">Calculator</span>
        <input {...fieldProps} placeholder="1*1 + 2*2 + 3*6" value={text} onChange={(event) => setText(event.target.value)} />
        <output aria-live="polite">{shown}</output>
      </label>
    )
  }

  const submit = () => {
    const next = enter(history, text)
    if (next === history) return
    onHistory(next)
    setText('')
  }

  return (
    <div className="calculator calculator-tape">
      {history.length > 0 ? (
        <ol className="calc-history" aria-label="Earlier lines" ref={tape}>
          {history.map((line, i) => (
            <li key={i}>
              <span className="calc-text">{line.text}</span>
              <button
                type="button"
                className="calc-result"
                aria-label={`Use ${line.plain}`}
                onClick={() => {
                  setText((current) => insertResult(current, line.plain))
                  input.current?.focus()
                }}
              >
                = {line.shown}
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="calc-empty">Type a sum and press = to keep it here. Tap a result to use it again.</p>
      )}
      <div className="calc-entry">
        <input
          {...fieldProps}
          ref={input}
          aria-label="Calculator line"
          enterKeyHint="done"
          placeholder="1*1 + 2*2 + 3*6"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit()
          }}
        />
        <button type="button" className="primary calc-equals" aria-label="Keep this line" disabled={reading.kind !== 'ok'} onClick={submit}>
          =
        </button>
      </div>
      <output aria-live="polite">{shown}</output>
    </div>
  )
}
