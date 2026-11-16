// What is kept on the device about spaced review: for each item that has been graded, where it
// is on the ladder and when it is due. Pure; review-store.ts saves it.
//
// An item that has been earned but not yet graded is not in here: it is derived from the
// course's progress record (schedule.ts), so nothing hooks into the lesson screens.

import { TOP_RUNG, grade, isValidTime } from './schedule.ts'
import type { Grade, ItemState } from './schedule.ts'

export interface ReviewRecord {
  format: 1
  /** Keyed by `step:<course>:<lesson>:<step>` or `formula:<course>:<item>`. */
  items: Record<string, ItemState>
}

export const emptyReview = (): ReviewRecord => ({ format: 1, items: {} })

const count = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0

function validState(value: unknown): value is ItemState {
  if (typeof value !== 'object' || value === null) return false
  const s = value as Record<string, unknown>
  return (
    typeof s.rung === 'number' &&
    Number.isInteger(s.rung) &&
    s.rung >= 0 &&
    s.rung <= TOP_RUNG &&
    isValidTime(s.due) &&
    (s.last === undefined || isValidTime(s.last)) &&
    count(s.reps) &&
    count(s.lapses)
  )
}

/** A stored record if it has the shape this version writes (items that do not are dropped), else an empty one. */
export function parseReview(text: string | null): ReviewRecord {
  if (!text) return emptyReview()
  try {
    const value = JSON.parse(text) as { format?: unknown; items?: unknown }
    if (value && value.format === 1 && typeof value.items === 'object' && value.items !== null && !Array.isArray(value.items)) {
      const items: Record<string, ItemState> = {}
      for (const [key, state] of Object.entries(value.items)) if (validState(state)) items[key] = state
      return { format: 1, items }
    }
  } catch {
    // Fall through: a corrupt record is not worth crashing the app over.
  }
  return emptyReview()
}

/** The record after `key`, which stood at `before`, is graded `how` at `now`. */
export const gradeItem = (record: ReviewRecord, key: string, before: ItemState, how: Grade, now: Date): ReviewRecord => ({
  ...record,
  items: { ...record.items, [key]: grade(before, how, now) },
})
