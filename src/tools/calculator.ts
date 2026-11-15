// The calculator's logic, apart from the screen: what a typed line shows, what
// goes into the history, and what tapping a past result puts back.

import { formatValue } from '../lesson/check.ts'
import { numberOf } from '../lesson/expr.ts'

export interface CalcLine {
  /** What was typed. */
  text: string
  /** The result as shown: 0.6 (3/5). */
  shown: string
  /** The result as it can be typed back in: 0.6. */
  plain: string
}

export type Reading =
  | { kind: 'empty' }
  /** Half-typed ("2 +"): not an error worth shouting about. */
  | { kind: 'partial' }
  | { kind: 'ok'; shown: string; plain: string }

export const HISTORY_MAX = 20

export function read(text: string): Reading {
  if (!text.trim()) return { kind: 'empty' }
  try {
    const value = numberOf(text)
    if (!Number.isFinite(value)) return { kind: 'partial' }
    return { kind: 'ok', shown: formatValue(value), plain: `${+value.toPrecision(10)}` }
  } catch {
    return { kind: 'partial' }
  }
}

/** The history with this line added at the end (most recent last), oldest dropped beyond 20. Half-typed input is not kept. */
export function enter(history: CalcLine[], text: string): CalcLine[] {
  const reading = read(text)
  if (reading.kind !== 'ok') return history
  return [...history, { text: text.trim(), shown: reading.shown, plain: reading.plain }].slice(-HISTORY_MAX)
}

/** Put a past result at the end of the input (a negative one in brackets, so "5 - " then -3 stays 5 - (-3)). */
export function insertResult(input: string, plain: string): string {
  if (!input.trim()) return plain
  return `${input}${plain.startsWith('-') ? `(${plain})` : plain}`
}
