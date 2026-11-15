import type { Answer, Field } from './types.ts'

const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/

/**
 * The number pad for a box whose answer is a plain number (4, -2, 0.6); the
 * full keyboard for everything else, since a numeric pad has no / or sqrt:
 * fractions (3/5), roots, expressions, and any answer with variables. Decided
 * per box. Only the keyboard changes; how the answer is checked does not.
 */
export function inputModeFor(answer: Pick<Answer, 'vars'>, field: Pick<Field, 'key'>): 'decimal' | 'text' {
  if (answer.vars?.length) return 'text'
  return PLAIN_NUMBER.test(field.key.trim()) ? 'decimal' : 'text'
}
