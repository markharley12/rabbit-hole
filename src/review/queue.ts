// Which items exist and where they stand: the courses' marked steps (a marked quiz question or
// ordering puzzle is listed as a "step" too: the index and the progress record key every block by
// its id, and the review screen shows whichever kind of block it finds) and cheat-sheet formulas,
// joined to the progress records (when each was earned) and the review record (how each has
// been graded). Pure. Items of courses or steps that no longer exist are not here: they stay in
// the stored record, ignored, not deleted.

import type { CourseRecord } from '../lesson/progress.ts'
import type { CheatItem, CheatSheet, Course } from '../lesson/types.ts'
import type { ReviewRecord } from './review-record.ts'
import { enter, formulaEarnedAt, formulaKey, stepEarnedAt, stepKey } from './schedule.ts'
import type { Scheduled } from './schedule.ts'

export type ReviewItem = Scheduled &
  (
    | { kind: 'step'; course: Course; lessonId: string; stepId: string }
    | { kind: 'formula'; course: Course; formula: CheatItem }
  )

/** A course and, if it has one and it loaded, its cheat sheet. */
export interface CourseSource {
  course: Course
  sheet?: CheatSheet
}

/**
 * Every item that has been earned, with its state: the graded one if there is one, else a new
 * item due a day after it was earned. Items not yet earned are left out.
 */
export function buildQueue(sources: CourseSource[], progress: (courseId: string) => CourseRecord, stored: ReviewRecord): ReviewItem[] {
  const items: ReviewItem[] = []
  for (const { course, sheet } of sources) {
    const record = progress(course.id)
    const lessons = new Set(course.lessons.map((l) => l.id))
    for (const { lesson, step } of course.review ?? []) {
      if (!lessons.has(lesson)) continue
      const key = stepKey(course.id, lesson, step)
      const earned = stepEarnedAt(record, lesson, step)
      const state = stored.items[key] ?? (earned ? enter(earned) : undefined)
      if (state) items.push({ kind: 'step', key, group: `${course.id}:${lesson}`, state, course, lessonId: lesson, stepId: step })
    }
    for (const section of sheet?.sections ?? []) {
      for (const formula of section.items) {
        // A formula whose lesson is gone from the course would never be earned.
        if (formula.lesson && !lessons.has(formula.lesson)) continue
        const key = formulaKey(course.id, formula.id)
        const earned = formulaEarnedAt(record, formula.lesson)
        const state = stored.items[key] ?? (earned ? enter(earned) : undefined)
        if (state) items.push({ kind: 'formula', key, group: `${course.id}:${formula.lesson ?? 'sheet'}`, state, course, formula })
      }
    }
  }
  return items
}
