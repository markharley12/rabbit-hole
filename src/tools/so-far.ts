// "So far": what he has already worked out in a course, for the lesson dock.
// Pure: given the course's lesson order, the lesson files that are available and his
// progress record, which solved or revealed steps lie before the screen he is on.
// Nothing here reads or writes the device.

import type { CourseRecord, StepRecord } from '../lesson/progress.ts'
import type { Answer, Block, StepBlock } from '../lesson/types.ts'

export interface SoFarEntry {
  lessonId: string
  step: StepBlock
  /** Solved wins over revealed: he got it himself. */
  how: 'solved' | 'revealed'
}

export interface SoFarGroup {
  lessonId: string
  /** The lesson he is in; the others are earlier lessons. */
  current: boolean
  /** Most recent step first. */
  entries: SoFarEntry[]
}

const finished = (record: StepRecord | undefined): 'solved' | 'revealed' | null =>
  record?.solved ? 'solved' : record?.revealed ? 'revealed' : null

function entriesOf(lessonId: string, blocks: Block[], record: CourseRecord): SoFarEntry[] {
  const out: SoFarEntry[] = []
  for (const block of blocks) {
    if (block.type !== 'step') continue
    const how = finished(record.lessons[lessonId]?.steps[block.id])
    if (how) out.push({ lessonId, step: block, how })
  }
  return out.reverse()
}

interface Input {
  /** The course's lesson ids in order. */
  lessonIds: string[]
  /** The blocks of the lessons that are loaded; a lesson not here is left out. */
  blocks: Record<string, Block[] | undefined>
  record: CourseRecord
  currentLessonId: string
  /** The screen he is on (a block index): it and everything after it are never shown. */
  at: number
}

/** This lesson first (only the steps before the screen), then earlier lessons, nearest first. Empty groups are dropped. */
export function soFar({ lessonIds, blocks, record, currentLessonId, at }: Input): SoFarGroup[] {
  const position = lessonIds.indexOf(currentLessonId)
  const groups: SoFarGroup[] = []
  const here = entriesOf(currentLessonId, (blocks[currentLessonId] ?? []).slice(0, Math.max(0, at)), record)
  if (here.length > 0) groups.push({ lessonId: currentLessonId, current: true, entries: here })
  for (let i = position - 1; i >= 0; i--) {
    const id = lessonIds[i]
    const entries = entriesOf(id, blocks[id] ?? [], record)
    if (entries.length > 0) groups.push({ lessonId: id, current: false, entries })
  }
  return groups
}

/** The earlier lessons worth fetching: those where the record shows a solved or revealed step. Nearest first. */
export function lessonsToFetch(lessonIds: string[], currentLessonId: string, record: CourseRecord): string[] {
  const position = lessonIds.indexOf(currentLessonId)
  return lessonIds
    .slice(0, Math.max(0, position))
    .reverse()
    .filter((id) => Object.values(record.lessons[id]?.steps ?? {}).some((step) => finished(step)))
}

/** Whether any step lies before the screen: in the lesson before `at`, or (assumed, until fetched) in an earlier lesson. */
export function hasEarlierSteps(position: number, blocks: Block[], at: number): boolean {
  return position > 0 || blocks.slice(0, Math.max(0, at)).some((b) => b.type === 'step')
}

// --- Showing an answer key as maths -----------------------------------------------------

/** Index of the bracket closing the one at `open`, or -1. */
function closing(text: string, open: number): number {
  let depth = 0
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++
    else if (text[i] === ')' && --depth === 0) return i
  }
  return -1
}

/** Splits before each top-level (outside brackets) occurrence of one of `chars`. */
function splitTop(text: string, chars: string): string[] {
  const parts: string[] = []
  let depth = 0
  let from = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '(') depth++
    else if (c === ')') depth--
    else if (depth === 0 && chars.includes(c) && i > from) {
      parts.push(text.slice(from, i))
      from = i
    }
  }
  parts.push(text.slice(from))
  return parts
}

const unwrap = (text: string): string => (text.startsWith('(') && closing(text, 0) === text.length - 1 ? text.slice(1, -1) : text)

function atoms(text: string): string {
  let out = ''
  for (let i = 0; i < text.length; ) {
    if (text.startsWith('sqrt(', i)) {
      const end = closing(text, i + 4)
      if (end > 0) {
        out += `\\sqrt{${keyToTex(text.slice(i + 5, end))}}`
        i = end + 1
        continue
      }
    }
    if (text.startsWith('pi', i) && !/[a-z]/.test(text[i + 2] ?? '')) {
      out += '\\pi '
      i += 2
    } else if (text[i] === '*') {
      out += '\\cdot '
      i++
    } else {
      out += text[i]
      i++
    }
  }
  return out
}

/**
 * An answer key ("-16/5", "1/sqrt(10)", "2*x+1") as TeX: fractions, roots, pi, products.
 * Anything it does not recognise passes through unchanged, so it never loses a character.
 */
export function keyToTex(key: string): string {
  const text = key.replace(/\s+/g, '')
  return splitTop(text, '+-')
    .map((term) => {
      const sign = /^[+-]/.test(term) ? term[0] : ''
      const body = sign ? term.slice(1) : term
      const sides = splitTop(body, '/')
      // A fraction only when the term has exactly one top-level slash.
      if (sides.length !== 2 || sides[1].length < 2) return sign + atoms(body)
      return `${sign}\\frac{${keyToTex(unwrap(sides[0]))}}{${keyToTex(unwrap(sides[1].slice(1)))}}`
    })
    .join('')
}

export interface AnswerLine {
  /** The field's label as lesson Markdown (maths in dollars), when it has one. */
  label?: string
  /** Lesson Markdown: the value typeset. */
  value: string
}

/** The answer as lines to show: a matrix or an unlabelled vector as one bracketed line, otherwise one line per field. */
export function answerLines(answer: Answer): AnswerLine[] {
  const unlabelled = answer.fields.every((field) => !field.label)
  if (answer.matrix) {
    const [rows, cols] = answer.matrix
    const cells = answer.fields.map((field) => keyToTex(field.key))
    const lines = Array.from({ length: rows }, (_, r) => cells.slice(r * cols, (r + 1) * cols).join(' & '))
    return [{ value: `$\\displaystyle \\begin{bmatrix}${lines.join(' \\\\ ')}\\end{bmatrix}$` }]
  }
  if (answer.fields.length > 1 && unlabelled) {
    return [{ value: `$\\displaystyle \\begin{bmatrix}${answer.fields.map((field) => keyToTex(field.key)).join(' \\\\ ')}\\end{bmatrix}$` }]
  }
  return answer.fields.map((field) => ({ label: field.label, value: `$\\displaystyle ${keyToTex(field.key)}$` }))
}
