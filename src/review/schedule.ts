// When a reviewed item comes back. Pure: no React, no storage, and no clock of its own:
// every function that needs the time is given it, so tests can put it anywhere.
//
// The ladder is a convention, not an optimum (docs/learning-science.md says so): what the
// evidence supports is that gaps which grow beat gaps that do not, and that retrieving the
// answer beats reading it again. A rung is NOT a mastery level and is never shown as one:
// the learner sees how many are due and when the next is, nothing else.

import type { CourseRecord } from '../lesson/progress.ts'

/** Days to wait on each rung. The first is the gap after an item is earned. */
export const LADDER = [1, 3, 7, 16, 35, 90] as const
export const TOP_RUNG = LADDER.length - 1
/** The most items in one session. */
export const SESSION_CAP = 10

export type Grade = 'good' | 'hard' | 'again'

export interface ItemState {
  /** Index into LADDER: how long the next gap is after a right answer. */
  rung: number
  /** ISO date-time. The item is due from the start of that local calendar day. */
  due: string
  last?: string
  reps: number
  lapses: number
}

// ---- Calendar days (the learner's own, local)

/** Whole days since 1970 of the local calendar date: two times on one local day are equal, DST or not. */
export const dayIndex = (date: Date) => Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000)

/** `days` calendar days later at the same wall-clock time (not 24 h steps, so a DST change does not move it). */
export function addDays(date: Date, days: number): Date {
  const next = new Date(date.getTime())
  next.setDate(next.getDate() + days)
  return next
}

/** "2026-11-16", the local date: the seed for a day's session order. */
export const localDate = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

export const isValidTime = (iso: unknown): iso is string => typeof iso === 'string' && !Number.isNaN(new Date(iso).getTime())

/** Due on this local day or an earlier one. An item due at 23:00 is due from the morning. */
export const isDue = (state: ItemState, now: Date) => dayIndex(new Date(state.due)) <= dayIndex(now)

/** Calendar days from `now` to the item's due day: 0 or less is due. */
export const daysUntil = (state: ItemState, now: Date) => dayIndex(new Date(state.due)) - dayIndex(now)

// ---- Entering and grading

/** A newly earned item: the bottom rung, due one day after `at`. */
export const enter = (at: string): ItemState => ({
  rung: 0,
  due: addDays(new Date(at), LADDER[0]).toISOString(),
  reps: 0,
  lapses: 0,
})

/**
 * good: one rung up, due after the new rung's gap (the top rung stays, 90 days).
 * hard: same rung, due after its gap.
 * again: two rungs down (not below 0), due tomorrow.
 */
export function grade(state: ItemState, how: Grade, now: Date): ItemState {
  const rung = how === 'good' ? Math.min(TOP_RUNG, state.rung + 1) : how === 'hard' ? state.rung : Math.max(0, state.rung - 2)
  const gap = how === 'again' ? LADDER[0] : LADDER[rung]
  return {
    rung,
    due: addDays(now, gap).toISOString(),
    last: now.toISOString(),
    reps: state.reps + 1,
    lapses: state.lapses + (how === 'again' ? 1 : 0),
  }
}

/** How a step went, as a grade. A wrong try or a hint makes it hard; showing the answer makes it again. */
export function gradeStep(went: { solved: boolean; revealed: boolean; hints: number; wrong: number }): Grade {
  if (!went.solved) return 'again'
  return went.wrong === 0 && went.hints === 0 ? 'good' : 'hard'
}

// ---- Earning an item, from the progress record that already exists

/**
 * When a step was earned, or undefined if it has not been: the time of its first correct
 * attempt; failing that (a revealed step) its last attempt; failing that the lesson's
 * `finished`, then the record's `updated`.
 */
export function stepEarnedAt(record: CourseRecord, lessonId: string, stepId: string): string | undefined {
  const lesson = record.lessons[lessonId]
  const step = lesson?.steps[stepId]
  if (!lesson || !step || !(step.solved || step.revealed)) return undefined
  const log = step.log ?? []
  const correct = log.find((a) => a.result === 'correct')?.at
  const lastTry = step.revealed ? log[log.length - 1]?.at : undefined
  return [correct, lastTry, lesson.finished, record.updated].find(isValidTime)
}

/**
 * When a formula card was earned: its lesson's `finished` once that lesson is done; a formula
 * with no lesson, when the first lesson of the course was finished.
 */
export function formulaEarnedAt(record: CourseRecord, lessonId: string | undefined): string | undefined {
  const finishedAt = (id: string) => {
    const lesson = record.lessons[id]
    return lesson?.done ? [lesson.finished, record.updated, lesson.started].find(isValidTime) : undefined
  }
  if (lessonId) return finishedAt(lessonId)
  const times = Object.keys(record.lessons)
    .map(finishedAt)
    .filter(isValidTime)
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())
  return times[0]
}

export const stepKey = (courseId: string, lessonId: string, stepId: string) => `step:${courseId}:${lessonId}:${stepId}`
export const formulaKey = (courseId: string, itemId: string) => `formula:${courseId}:${itemId}`

// ---- What is due, and in what order

export interface Scheduled {
  key: string
  /** Items in one group are the same topic (one lesson): a session keeps them apart. */
  group: string
  state: ItemState
}

export const dueItems = <T extends Scheduled>(items: T[], now: Date): T[] => items.filter((item) => isDue(item.state, now))

/** The soonest due day among items not yet due, or undefined when there are none. */
export function nextDue<T extends Scheduled>(items: T[], now: Date): { days: number; due: Date } | undefined {
  let best: { days: number; due: Date } | undefined
  for (const item of items) {
    const days = daysUntil(item.state, now)
    if (days <= 0) continue
    const due = new Date(item.state.due)
    if (!best || due.getTime() < best.due.getTime()) best = { days, due }
  }
  return best
}

/** "tomorrow", "in 3 days": how far off a number of calendar days is. */
export const inDays = (days: number) => (days <= 1 ? 'tomorrow' : `in ${days} days`)

/** A small string hash (FNV-1a), for a repeatable tie-break that is not the key's alphabet. */
function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return h >>> 0
}

/** Can `counts` (items left per group) be laid out with no two of a group side by side, if it may not start with `last`? */
function arrangeable(counts: Map<string, number>, last: string | undefined): boolean {
  let total = 0
  for (const n of counts.values()) total += n
  for (const [group, n] of counts) {
    const room = group === last ? Math.floor(total / 2) : Math.ceil(total / 2)
    if (n > room) return false
  }
  return true
}

/**
 * Today's session from the due items: the SESSION_CAP oldest (ties broken by a hash of the
 * seed, so the same day gives the same order), arranged so two items of one group are not
 * adjacent when that can be avoided (interleaving), otherwise keeping the oldest first.
 */
export function sessionOrder<T extends Scheduled>(due: T[], seed: string, cap = SESSION_CAP): T[] {
  const oldest = [...due]
    .sort((a, b) => {
      const by = dayIndex(new Date(a.state.due)) - dayIndex(new Date(b.state.due))
      return by || hash(seed + a.key) - hash(seed + b.key) || (a.key < b.key ? -1 : 1)
    })
    .slice(0, cap)

  const left = [...oldest]
  const counts = new Map<string, number>()
  for (const item of left) counts.set(item.group, (counts.get(item.group) ?? 0) + 1)
  const out: T[] = []
  while (left.length) {
    const last = out[out.length - 1]?.group
    const fits = (item: T) => {
      if (item.group === last) return false
      const after = new Map(counts)
      after.set(item.group, (after.get(item.group) ?? 0) - 1)
      return arrangeable(after, item.group)
    }
    // The oldest that keeps the rest arrangeable; else the oldest that is not next to its own group; else the oldest.
    const at = [fits, (item: T) => item.group !== last, () => true].map((test) => left.findIndex(test)).find((i) => i >= 0) as number
    const [pick] = left.splice(at, 1)
    counts.set(pick.group, (counts.get(pick.group) ?? 0) - 1)
    out.push(pick)
  }
  return out
}
