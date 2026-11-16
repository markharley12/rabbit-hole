// When a step offers "Show the answer". One rule, used by the step screen for
// its button and by the Ask tutor (src/ai/context.ts), which may give the
// answer only when the app itself would.

import type { StepRecord } from './progress.ts'

/** All three hints taken and at least one attempt made, on a step not yet solved or shown. */
export function canShowAnswer(record: StepRecord | undefined): boolean {
  if (!record || record.solved || record.revealed) return false
  return record.hints >= 3 && record.attempts > 0
}
