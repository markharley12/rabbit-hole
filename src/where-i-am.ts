// "Where I am": what the device knows about what Mark has done, as the short resume note he used
// to write by hand (what I have done, where I stopped, what is next). Pure: the component only
// shows it. No scores, no streaks, no percentages (docs/seed-context.md section 5: claimed is not
// scored): counts of screens solved and shown, and a name for slips that came back.

import { courseFinished, tunnelsOf } from './courses.ts'
import { lessonState, nextUp } from './lesson/progress.ts'
import type { CourseRecord } from './lesson/progress.ts'
import type { Course } from './lesson/types.ts'
import { dayIndex, dueItems, inDays, isValidTime, nextDue } from './review/schedule.ts'
import type { Scheduled } from './review/schedule.ts'

/** "today", "yesterday", "2 days ago", "3 weeks ago", "4 months ago": by calendar days, not hours. */
export function ago(iso: string | undefined, now: Date): string | undefined {
  if (!isValidTime(iso)) return undefined
  const days = dayIndex(now) - dayIndex(new Date(iso))
  // A clock set back since the visit reads as today rather than as the future.
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  if (days < 60) {
    const weeks = Math.floor(days / 7)
    return weeks === 1 ? '1 week ago' : `${weeks} weeks ago`
  }
  return `${Math.floor(days / 30)} months ago`
}

const started = (record: CourseRecord) => Object.keys(record.lessons).length > 0

export interface CourseSummary {
  course: Course
  /** The lesson he is on, counting from 1 (the last one when the course is done). */
  lessonNumber: number
  lessonTitle: string
  finished: boolean
  /** The screen he is on in that lesson, counting from 1; absent between lessons and when done. */
  screen?: number
  /** When he was last in the course. */
  lastAt?: string
  /** Screens with an answer he got right, and (of the rest) those he asked to be shown. */
  solved: number
  shown: number
}

/**
 * One line of counts: "14 solved, 1 shown". Solved wins over shown, as on the lesson's done screen,
 * so each screen is counted once. An unassessed step is not a zero, so nothing says "0".
 */
export function countsText(solved: number, shown: number): string {
  const parts = [solved > 0 && `${solved} solved`, shown > 0 && `${shown} shown`].filter(Boolean)
  return parts.length ? parts.join(', ') : 'Nothing solved yet'
}

/** The courses he has started, most recently visited first. */
export function startedCourses(courses: Course[], records: Map<string, CourseRecord>): CourseSummary[] {
  const out: CourseSummary[] = []
  for (const course of courses) {
    const record = records.get(course.id)
    if (!record || !started(record)) continue
    const finished = courseFinished(course, record)
    const next = finished ? null : nextUp(course, record)
    const lessonId = next?.lessonId ?? course.lessons[course.lessons.length - 1].id
    const lesson = record.lessons[lessonId]
    let solved = 0
    let shown = 0
    for (const l of Object.values(record.lessons)) {
      for (const step of Object.values(l.steps)) {
        if (step.solved) solved++
        else if (step.revealed) shown++
      }
    }
    out.push({
      course,
      lessonNumber: course.lessons.findIndex((l) => l.id === lessonId) + 1,
      lessonTitle: course.lessons.find((l) => l.id === lessonId)?.title ?? lessonId,
      finished,
      screen: lesson && lessonState(record, lessonId).state === 'started' ? lesson.at + 1 : undefined,
      lastAt: [record.updated, ...Object.values(record.lessons).map((l) => l.finished ?? l.started)].filter(isValidTime).sort().at(-1),
      solved,
      shown,
    })
  }
  return out.sort((a, b) => time(b.lastAt) - time(a.lastAt))
}

const time = (iso: string | undefined) => (isValidTime(iso) ? new Date(iso).getTime() : 0)

export type NextAction =
  | { kind: 'review'; due: number }
  | { kind: 'lesson'; verb: 'Continue' | 'Start'; course: Course; lessonId: string; title: string }
  | { kind: 'none' }

/**
 * The one thing to do next. Reviews due come first (they are short and they decay); then the lesson
 * he is in the middle of, in the course he was last in; then the next lesson of the first course not
 * finished: one he has begun (most recent first, his own choice, so its `needs` are not asked
 * again), else the first in the index whose `needs` are all finished.
 */
export function nextAction(courses: Course[], records: Map<string, CourseRecord>, dueNow: number): NextAction {
  if (dueNow > 0) return { kind: 'review', due: dueNow }
  const record = (course: Course) => records.get(course.id) ?? { format: 1 as const, lessons: {} }
  const lessonAction = (course: Course, verb: 'Continue' | 'Start', lessonId: string): NextAction => ({
    kind: 'lesson',
    verb,
    course,
    lessonId,
    title: course.lessons.find((l) => l.id === lessonId)?.title ?? lessonId,
  })

  const begun = startedCourses(courses, records).filter((s) => !s.finished)
  for (const { course } of begun) {
    const next = nextUp(course, record(course))
    if (next?.verb === 'Continue') return lessonAction(course, 'Continue', next.lessonId)
  }
  for (const { course } of begun) {
    const next = nextUp(course, record(course))
    if (next) return lessonAction(course, 'Start', next.lessonId)
  }
  for (const course of courses) {
    if (started(record(course)) || courseFinished(course, record(course))) continue
    const ready = tunnelsOf(course, courses).needs.every((link) => courseFinished(link.course, record(link.course)))
    if (ready) return lessonAction(course, 'Start', course.lessons[0].id)
  }
  return { kind: 'none' }
}

/** The plain names of the slips the checker can name; anything else (an accept rule) is not a slip. */
const SLIP_NAMES: Record<string, string> = {
  symmetric: 'A matrix that should be symmetric was not',
  transpose: 'Rows and columns swapped (a transpose)',
  sign: 'Every sign flipped',
  scaled: 'Every entry off by the same factor',
  swapped: 'The right numbers in the wrong boxes',
  known: 'A specific arithmetic slip',
}

export interface SlipCount {
  name: string
  count: number
}

/**
 * Slips that came back: wrong attempts the checker named, across all courses, counted by kind
 * (every `known` one together), only those that happened at least twice, the three most frequent.
 * It reads the attempt logs, which keep each step's last 20 attempts, so it is "lately", not "ever".
 */
export function repeatedSlips(records: Iterable<CourseRecord>): SlipCount[] {
  const counts = new Map<string, number>()
  for (const record of records) {
    for (const lesson of Object.values(record.lessons)) {
      for (const step of Object.values(lesson.steps)) {
        for (const attempt of step.log) {
          if (attempt.result !== 'wrong' || !attempt.slip || !(attempt.slip in SLIP_NAMES)) continue
          counts.set(attempt.slip, (counts.get(attempt.slip) ?? 0) + 1)
        }
      }
    }
  }
  const order = Object.keys(SLIP_NAMES)
  return [...counts]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1] || order.indexOf(a[0]) - order.indexOf(b[0]))
    .slice(0, 3)
    .map(([id, count]) => ({ name: SLIP_NAMES[id], count }))
}

/** "5 due today. Next: tomorrow." / "Nothing due today. Next: in 3 days." / "Nothing to review yet." */
export function reviewText(items: Scheduled[], now: Date): string {
  if (items.length === 0) return 'Nothing to review yet.'
  const due = dueItems(items, now).length
  const next = nextDue(items, now)
  const first = due > 0 ? `${due} due today.` : 'Nothing due today.'
  return next ? `${first} Next: ${inDays(next.days)}.` : first
}
