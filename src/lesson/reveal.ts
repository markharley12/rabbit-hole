// When a screen offers "Show the answer". One rule per kind of screen, used by the screen for its
// button and (for steps) by the Ask tutor (src/ai/context.ts), which may give the answer only
// when the app itself would.

import type { StepRecord } from './progress.ts'

/** All three hints taken and at least one attempt made, on a step not yet solved or shown. */
export function canShowAnswer(record: StepRecord | undefined): boolean {
  if (!record || record.solved || record.revealed) return false
  return record.hints >= 3 && record.attempts > 0
}

/**
 * A quiz question or an ordering puzzle has at most one hint, so the answer is offered after a
 * number of wrong tries instead (choice.ts and order.ts name the number). Every attempt on an
 * unsolved screen is a wrong one, so the attempt count is the count of wrong tries.
 */
export function canShowAnswerAfterTries(record: StepRecord | undefined, tries: number): boolean {
  if (!record || record.solved || record.revealed) return false
  return record.attempts >= tries
}
