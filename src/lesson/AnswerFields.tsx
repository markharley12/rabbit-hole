import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { plainLabel } from './markdown.ts'
import { inputModeFor } from './input-mode.ts'
import { Md } from './Md.tsx'
import type { Answer, Field } from './types.ts'

interface Props {
  answer: Answer
  values: Record<string, string>
  /** Fields the last check found wrong. */
  off: string[]
  disabled: boolean
  onChange: (name: string, value: string) => void
  onSubmit: () => void
}

// Phone keyboards: nothing "helpful" like capitals or autocorrect turning 2m
// into 2 m. Which keyboard is inputModeFor()'s decision, box by box.
const inputProps = {
  type: 'text',
  autoComplete: 'off',
  autoCorrect: 'off',
  autoCapitalize: 'none',
  spellCheck: false,
  enterKeyHint: 'done',
} as const

/**
 * The boxes for an answer, laid out as it reads on paper: a matrix in
 * brackets, a vector as a bracketed column, or labelled rows ("c = ").
 * When some box wants the number pad, a small switch beside them flips every
 * box to the full keyboard ("abc") and back ("123").
 */
export function AnswerFields({ answer, values, off, disabled, onChange, onSubmit }: Props) {
  const [full, setFull] = useState(false)
  const anyNumeric = answer.fields.some((field) => inputModeFor(answer, field) === 'decimal')
  const boxes = useRef(new Map<string, HTMLInputElement>())
  // The box the cursor is in, kept across the switch press, and the one to focus again afterwards.
  const focused = useRef<string | null>(null)
  const refocus = useRef<string | null>(null)

  // A focused box keeps its old keyboard until it is focused afresh.
  useEffect(() => {
    const name = refocus.current
    refocus.current = null
    const element = name ? boxes.current.get(name) : undefined
    if (element && document.activeElement === element) {
      element.blur()
      element.focus()
    }
  }, [full])

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') onSubmit()
  }

  const box = (field: Field, label: string) => {
    const name = field.name
    return (
      <input
        key={name}
        {...inputProps}
        ref={(element) => {
          if (element) boxes.current.set(name, element)
          else boxes.current.delete(name)
        }}
        inputMode={full ? 'text' : inputModeFor(answer, field)}
        className={`answer-box${off.includes(name) ? ' off' : ''}`}
        aria-label={label}
        aria-invalid={off.includes(name) || undefined}
        value={values[name] ?? ''}
        disabled={disabled}
        onChange={(event) => onChange(name, event.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => {
          focused.current = name
        }}
        onBlur={(event) => {
          // Pressing the switch is not leaving the box.
          if (!(event.relatedTarget as HTMLElement | null)?.classList.contains('keyboard-switch')) focused.current = null
        }}
      />
    )
  }

  const layout = () => {
    if (answer.matrix) {
      const [rows, cols] = answer.matrix
      return (
        <div className="bracketed" role="group" aria-label={`${rows} by ${cols} matrix`}>
          <div className="matrix" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 4.6em))` }}>
            {answer.fields.map((field, i) => box(field, `row ${Math.floor(i / cols) + 1}, column ${(i % cols) + 1}`))}
          </div>
        </div>
      )
    }

    if (answer.fields.length > 1 && answer.fields.every((field) => !field.label)) {
      return (
        <div className="bracketed" role="group" aria-label={`vector of ${answer.fields.length} entries`}>
          <div className="matrix" style={{ gridTemplateColumns: 'minmax(0, 6em)' }}>
            {answer.fields.map((field, i) => box(field, `entry ${i + 1}`))}
          </div>
        </div>
      )
    }

    return (
      <div className="labelled" role="group" aria-label="answer">
        {answer.fields.map((field) => (
          <label className="labelled-row" key={field.name}>
            <span className="labelled-text">{field.label ? <Md text={field.label} inline /> : field.name}</span>
            {box(field, field.label ? plainLabel(field.label) : field.name)}
          </label>
        ))}
      </div>
    )
  }

  return (
    <>
      {layout()}
      {anyNumeric && (
        <button
          type="button"
          className="keyboard-switch"
          aria-label={full ? 'Switch to the number keyboard' : 'Switch to the full keyboard'}
          disabled={disabled}
          // Keeps the cursor in the box instead of dropping the keyboard first.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            refocus.current = focused.current
            setFull(!full)
          }}
        >
          {full ? '123' : 'abc'}
        </button>
      )}
    </>
  )
}
