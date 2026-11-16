// What the Ask tutor is told about where Mark is: the context block the app
// sends when a chat begins (docs/ai-sessions.md section 4), and the short
// update sent with a later message when the step has moved on since. Pure:
// the server validates all of it again (server/rabbit_server.py).

import type { Attempt, StepRecord } from '../lesson/progress.ts'
import { canShowAnswer } from '../lesson/reveal.ts'
import type { Block, Course, Lesson } from '../lesson/types.ts'

/** Attempts sent with the context: the most recent ones. */
export const LOG_SENT = 5
/** The server refuses longer typed values. */
const MAX_VALUE = 500

export interface SentAttempt {
  at: string
  values: Record<string, string>
  result: Attempt['result']
  slip?: string
}

export interface AskContext {
  courseId: string
  courseTitle: string
  nodeId: string
  nodeName?: string
  lessonId: string
  lessonTitle: string
  /** Zero-based, as the server expects; it says "lesson 3 of 5". */
  lessonIndex: number
  lessonCount: number
  screenIndex: number
  screenCount: number
  /** The step or text screen, verbatim (the key included: the tutor is told not to reveal it). */
  block: Block
  record: { attempts: number; hints: number; solved: boolean; revealed: boolean; log: SentAttempt[] }
  /** What is typed but not yet checked. */
  draft: Record<string, string>
  /** The app's own "Show the answer" rule is met. */
  canReveal: boolean
}

export interface ContextInput {
  course: Course
  lesson: Lesson
  /** The screen's index in the lesson. */
  at: number
  /** The step's record from progress, if he has touched it. */
  record: StepRecord | undefined
  nodeName?: string
}

const trimValues = (values: Record<string, string> | undefined): Record<string, string> =>
  Object.fromEntries(Object.entries(values ?? {}).map(([name, text]) => [name, String(text).slice(0, MAX_VALUE)]))

export function buildContext({ course, lesson, at, record, nodeName }: ContextInput): AskContext {
  const block = lesson.blocks[at]
  const position = course.lessons.findIndex((entry) => entry.id === lesson.id)
  const log = (record?.log ?? []).slice(-LOG_SENT).map((attempt) => {
    const sent: SentAttempt = { at: attempt.at, values: trimValues(attempt.values), result: attempt.result }
    if (attempt.slip) sent.slip = attempt.slip
    return sent
  })
  const context: AskContext = {
    courseId: course.id,
    courseTitle: course.title,
    nodeId: course.nodeId,
    lessonId: lesson.id,
    lessonTitle: lesson.title,
    lessonIndex: Math.max(0, position),
    lessonCount: course.lessons.length,
    screenIndex: at,
    screenCount: lesson.blocks.length,
    block,
    record: {
      attempts: record?.attempts ?? 0,
      hints: record?.hints ?? 0,
      solved: record?.solved ?? false,
      revealed: record?.revealed ?? false,
      log,
    },
    draft: trimValues(record?.draft),
    canReveal: block?.type === 'step' && canShowAnswer(record),
  }
  if (nodeName) context.nodeName = nodeName
  return context
}

/** The facts about a step that can change while a chat is open. */
export interface StepSnapshot {
  draft: Record<string, string>
  attempts: number
  hints: number
  canReveal: boolean
  solved: boolean
  revealed: boolean
}

export function snapshot(record: StepRecord | undefined, isStep = true): StepSnapshot {
  return {
    draft: trimValues(record?.draft),
    attempts: record?.attempts ?? 0,
    hints: record?.hints ?? 0,
    canReveal: isStep && canShowAnswer(record),
    solved: record?.solved ?? false,
    revealed: record?.revealed ?? false,
  }
}

const sameDraft = (a: Record<string, string>, b: Record<string, string>) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  return [...keys].every((key) => (a[key] ?? '') === (b[key] ?? ''))
}

/**
 * The update to send with a later message: the whole current snapshot when
 * anything differs from what the tutor was last told (or when that is not
 * known, after the chat was reopened), otherwise null.
 */
export function stepUpdate(last: StepSnapshot | undefined, now: StepSnapshot): StepSnapshot | null {
  if (
    last &&
    sameDraft(last.draft, now.draft) &&
    last.attempts === now.attempts &&
    last.hints === now.hints &&
    last.canReveal === now.canReveal &&
    last.solved === now.solved &&
    last.revealed === now.revealed
  ) {
    return null
  }
  return now
}

/** "About: One variable, The smallest best fit". */
export function aboutLine(lesson: Lesson, at: number): string {
  const block = lesson.blocks[at]
  const screen = block?.title ?? `screen ${at + 1} of ${lesson.blocks.length}`
  return `${screen}, ${lesson.title}`
}
