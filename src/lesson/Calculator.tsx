import { useState } from 'react'
import { numberOf } from './expr.ts'
import { formatValue } from './check.ts'

/** A one-line calculator in the answer grammar, for checking sums before sending. */
export function Calculator() {
  const [text, setText] = useState('')
  let shown = ''
  if (text.trim()) {
    try {
      shown = `= ${formatValue(numberOf(text))}`
    } catch {
      // Mid-typing ("2 +") is not an error worth shouting about.
      shown = '…'
    }
  }
  return (
    <label className="calculator">
      <span className="calculator-label">Calculator</span>
      <input
        type="text"
        inputMode="text"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        placeholder="1*1 + 2*2 + 3*6"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <output aria-live="polite">{shown}</output>
    </label>
  )
}
