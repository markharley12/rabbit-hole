// The logic of a choice (quiz) screen, apart from the screen: the shuffled order, the draft
// encoding, and the grading with the feedback it earns. Pure.
//
// Progress encoding (also documented on ChoiceBlock): values of an attempt and of the draft are
// { picked: "a,c", seed: "k3x9" }. `picked` lists option ids in the block's own order, so the
// same pick always encodes the same way whatever the shuffle was.

import { seededShuffle } from './seed.ts'
import type { ChoiceBlock, ChoiceOption } from './types.ts'

/** Wrong tries after which "Show the answer" appears (steps: all three hints and a try; see reveal.ts). */
export const CHOICE_REVEAL_AFTER = 2

/** The options in the order this seed shows them; the block's own order when it says not to shuffle. */
export function shownOptions(block: ChoiceBlock, seed: string): ChoiceOption[] {
  return block.shuffle === false ? block.options : seededShuffle(block.options, seed)
}

/** The picked ids from stored values: only options that still exist, in the block's order. */
export function parsePicked(block: ChoiceBlock, values: Record<string, string> | undefined): string[] {
  const named = new Set((values?.picked ?? '').split(',').filter(Boolean))
  return block.options.filter((o) => named.has(o.id)).map((o) => o.id)
}

export function choiceValues(block: ChoiceBlock, picked: readonly string[], seed: string): Record<string, string> {
  const set = new Set(picked)
  return { picked: block.options.filter((o) => set.has(o.id)).map((o) => o.id).join(','), seed }
}

/** Pick or unpick `id`: a single-answer question holds one pick, a multiple one any number. */
export function toggle(block: ChoiceBlock, picked: readonly string[], id: string): string[] {
  if (!block.multiple) return [id]
  return picked.includes(id) ? picked.filter((p) => p !== id) : [...picked, id]
}

export type ChoiceVerdict =
  | { status: 'correct' }
  | {
      status: 'wrong'
      /** Picked options that are wrong, in the block's order. */
      wrong: ChoiceOption[]
      /** How many of the picks are right. */
      rightPicked: number
      picked: number
      /** Every pick is right but a right option is still unpicked (multiple only). */
      missing: boolean
    }

/** Right when the picks are exactly the correct options. */
export function gradeChoice(block: ChoiceBlock, picked: readonly string[]): ChoiceVerdict {
  const chosen = new Set(picked)
  const wrong = block.options.filter((o) => chosen.has(o.id) && !o.correct)
  const rightPicked = block.options.filter((o) => chosen.has(o.id) && o.correct).length
  const rightTotal = block.options.filter((o) => o.correct).length
  if (wrong.length === 0 && rightPicked === rightTotal && rightTotal > 0) return { status: 'correct' }
  return { status: 'wrong', wrong, rightPicked, picked: chosen.size, missing: wrong.length === 0 && rightPicked < rightTotal }
}

/**
 * The line above the reasons for a multiple-choice miss: how many picks are right, without saying
 * which options are unpicked and right. Nothing for a single-answer question.
 */
export function partialLine(block: ChoiceBlock, verdict: ChoiceVerdict): string | undefined {
  if (!block.multiple || verdict.status !== 'wrong') return undefined
  if (verdict.missing) return 'Everything you ticked is right, but a right option is not ticked yet.'
  const { picked, rightPicked } = verdict
  if (rightPicked === 0) return picked === 1 ? 'The one you ticked is not right.' : `None of the ${picked} you ticked are right.`
  return `${rightPicked} of the ${picked} you ticked ${rightPicked === 1 ? 'is' : 'are'} right.`
}
