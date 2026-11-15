import type { KeyboardEvent } from 'react'
import { plainLabel } from './markdown.ts'
import { Md } from './Md.tsx'
import type { Answer } from './types.ts'

interface Props {
  answer: Answer
  values: Record<string, string>
  /** Fields the last check found wrong. */
  off: string[]
  disabled: boolean
  onChange: (name: string, value: string) => void
  onSubmit: () => void
}

// Phone keyboards: plain text (a numeric pad has no / or √), and nothing
// "helpful" like capitals or autocorrect turning 2m into 2 m.
const inputProps = {
  type: 'text',
  inputMode: 'text',
  autoComplete: 'off',
  autoCorrect: 'off',
  autoCapitalize: 'none',
  spellCheck: false,
  enterKeyHint: 'done',
} as const

/**
 * The boxes for an answer, laid out as it reads on paper: a matrix in
 * brackets, a vector as a bracketed column, or labelled rows ("c = ").
 */
export function AnswerFields({ answer, values, off, disabled, onChange, onSubmit }: Props) {
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') onSubmit()
  }
  const box = (name: string, label: string) => (
    <input
      key={name}
      {...inputProps}
      className={`answer-box${off.includes(name) ? ' off' : ''}`}
      aria-label={label}
      aria-invalid={off.includes(name) || undefined}
      value={values[name] ?? ''}
      disabled={disabled}
      onChange={(event) => onChange(name, event.target.value)}
      onKeyDown={onKeyDown}
    />
  )

  if (answer.matrix) {
    const [rows, cols] = answer.matrix
    return (
      <div className="bracketed" role="group" aria-label={`${rows} by ${cols} matrix`}>
        <div className="matrix" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 4.6em))` }}>
          {answer.fields.map((field, i) => box(field.name, `row ${Math.floor(i / cols) + 1}, column ${(i % cols) + 1}`))}
        </div>
      </div>
    )
  }

  if (answer.fields.length > 1 && answer.fields.every((field) => !field.label)) {
    return (
      <div className="bracketed" role="group" aria-label={`vector of ${answer.fields.length} entries`}>
        <div className="matrix" style={{ gridTemplateColumns: 'minmax(0, 6em)' }}>
          {answer.fields.map((field, i) => box(field.name, `entry ${i + 1}`))}
        </div>
      </div>
    )
  }

  return (
    <div className="labelled" role="group" aria-label="answer">
      {answer.fields.map((field) => (
        <label className="labelled-row" key={field.name}>
          <span className="labelled-text">{field.label ? <Md text={field.label} inline /> : field.name}</span>
          {box(field.name, field.label ? plainLabel(field.label) : field.name)}
        </label>
      ))}
    </div>
  )
}
