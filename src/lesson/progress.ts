// What Mark has done in a course, kept on the device (localStorage), never in
// git. It records attempts and where he is, and **no scores**: an unassessed
// topic has no score, and a course step being right once is not mastery
// (seed-context.md section 5: claimed is not scored). Pure functions here;
// the store that saves them is progress-store.ts.

import type { Course } from './types.ts'

export interface Attempt {
  at: string
  values: Record<string, string>
  result: 'correct' | 'wrong' | 'unreadable'
  /** Which slip the checker named, or which accept rule made it right. */
  slip?: string
}

export interface StepRecord {
  attempts: number
  solved: boolean
  /** He asked to see the answer after the hints ran out. */
  revealed?: boolean
  hints: number
  draft?: Record<string, string>
  log: Attempt[]
}

export interface LessonRecord {
  /** The screen he is on: a block index, or the block count for the end screen. */
  at: number
  done: boolean
  started: string
  finished?: string
  steps: Record<string, StepRecord>
}

export interface CourseRecord {
  format: 1
  lessons: Record<string, LessonRecord>
  lastLesson?: string
  updated?: string
}

/** Attempts kept per step; the count goes on past it. */
export const LOG_LIMIT = 20

export const emptyCourse = (): CourseRecord => ({ format: 1, lessons: {} })

const emptyStep = (): StepRecord => ({ attempts: 0, solved: false, hints: 0, log: [] })

function withLesson(record: CourseRecord, lessonId: string, now: string, change: (lesson: LessonRecord) => LessonRecord): CourseRecord {
  const lesson = record.lessons[lessonId] ?? { at: 0, done: false, started: now, steps: {} }
  return { ...record, lessons: { ...record.lessons, [lessonId]: change(lesson) }, updated: now }
}

function withStep(record: CourseRecord, lessonId: string, stepId: string, now: string, change: (step: StepRecord) => StepRecord): CourseRecord {
  return withLesson(record, lessonId, now, (lesson) => ({
    ...lesson,
    steps: { ...lesson.steps, [stepId]: change(lesson.steps[stepId] ?? emptyStep()) },
  }))
}

export const openLesson = (record: CourseRecord, lessonId: string, now: string): CourseRecord => ({
  ...withLesson(record, lessonId, now, (lesson) => lesson),
  lastLesson: lessonId,
})

export const goTo = (record: CourseRecord, lessonId: string, at: number, now: string) =>
  withLesson(record, lessonId, now, (lesson) => ({ ...lesson, at }))

export const finishLesson = (record: CourseRecord, lessonId: string, at: number, now: string) =>
  withLesson(record, lessonId, now, (lesson) => ({ ...lesson, at, done: true, finished: lesson.finished ?? now }))

export const saveDraft = (record: CourseRecord, lessonId: string, stepId: string, draft: Record<string, string>, now: string) =>
  withStep(record, lessonId, stepId, now, (step) => ({ ...step, draft }))

export const takeHint = (record: CourseRecord, lessonId: string, stepId: string, now: string) =>
  withStep(record, lessonId, stepId, now, (step) => ({ ...step, hints: Math.min(3, step.hints + 1) }))

export const revealAnswer = (record: CourseRecord, lessonId: string, stepId: string, now: string) =>
  withStep(record, lessonId, stepId, now, (step) => ({ ...step, revealed: true }))

export const recordAttempt = (record: CourseRecord, lessonId: string, stepId: string, attempt: Attempt) =>
  withStep(record, lessonId, stepId, attempt.at, (step) => ({
    ...step,
    attempts: step.attempts + 1,
    solved: step.solved || attempt.result === 'correct',
    log: [...step.log, attempt].slice(-LOG_LIMIT),
  }))

export type LessonState = { state: 'new' } | { state: 'started'; at: number } | { state: 'done' }

export function lessonState(record: CourseRecord, lessonId: string): LessonState {
  const lesson = record.lessons[lessonId]
  if (!lesson) return { state: 'new' }
  if (lesson.done) return { state: 'done' }
  return { state: 'started', at: lesson.at }
}

/**
 * The one thing to do next in a course: carry on with the last lesson opened
 * if it isn't finished, else the first lesson not done, else nothing left.
 */
export function nextUp(course: Course, record: CourseRecord): { lessonId: string; verb: 'Start' | 'Continue' } | null {
  const last = record.lastLesson && course.lessons.some((l) => l.id === record.lastLesson) ? record.lastLesson : undefined
  if (last && !record.lessons[last]?.done) return { lessonId: last, verb: 'Continue' }
  const open = course.lessons.find((l) => !record.lessons[l.id]?.done)
  if (!open) return null
  return { lessonId: open.id, verb: record.lessons[open.id] ? 'Continue' : 'Start' }
}

/** A stored record if it has the shape this version writes, else a fresh one. */
export function parseRecord(text: string | null): CourseRecord {
  if (!text) return emptyCourse()
  try {
    const value = JSON.parse(text) as CourseRecord
    if (value && value.format === 1 && typeof value.lessons === 'object' && value.lessons !== null) return value
  } catch {
    // Fall through: a corrupt record is not worth crashing the app over.
  }
  return emptyCourse()
}
