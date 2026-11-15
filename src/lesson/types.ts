// The course and lesson format. Mirrors schema/course.schema.json and
// schema/lesson.schema.json; tools/validate_courses.py checks content against
// those, so the app can trust what it is given.

export interface CourseSource {
  name: string
  url?: string
  note?: string
}

export interface LessonEntry {
  id: string
  title: string
  summary?: string
  badge?: string
}

export interface Course {
  format: 1
  id: string
  nodeId: string
  title: string
  summary: string
  written: string
  sources: CourseSource[]
  lessons: LessonEntry[]
  /**
   * True when the course folder has a cheatsheet.json. Set by the validator in the
   * published index only; it is NOT part of course.schema.json or of course.json.
   */
  cheatsheet?: boolean
}

/** public/content/<field>/courses/index.json, written by the validator on publish. */
export interface CourseIndex {
  format: 1
  courses: Course[]
}

export type Entry = number | string
export type Value = Entry | Entry[] | Entry[][]

export interface WidgetRef {
  name: string
  params?: Record<string, unknown>
  caption?: string
}

export interface Define {
  term: string
  meaning: string
}

export interface Field {
  name: string
  label?: string
  key: string
}

export type Slip =
  | { detect: 'symmetric' | 'transpose' | 'scaled' | 'swapped' | 'sign'; name?: string }
  | { detect: 'known'; when: Record<string, string>; say: string }

export type AcceptRule = 'negated' | 'multiple'

export interface Answer {
  fields: Field[]
  matrix?: [number, number]
  vars?: string[]
  accept?: AcceptRule[]
  acceptNote?: string
  verify: string
  slips?: Slip[]
}

export interface StepBlock {
  type: 'step'
  id: string
  title?: string
  define?: Define[]
  why: string
  prompt: string
  widget?: WidgetRef
  answer: Answer
  hints: [string, string, string]
  check?: { say: string; widget?: WidgetRef }
  solution?: string
  next: string
}

export interface TextBlock {
  type: 'text'
  id: string
  title?: string
  body: string
  widget?: WidgetRef
  next: string
}

export type Block = StepBlock | TextBlock

export interface Lesson {
  format: 1
  id: string
  title: string
  summary?: string
  data?: Record<string, Value>
  blocks: Block[]
  sideQuest?: { title: string; body: string }
}

/** cheatsheet.json beside course.json. Mirrors schema/cheatsheet.schema.json. */
export interface CheatItem {
  id: string
  name: string
  formula: string
  when: string
  lesson?: string
}

export interface CheatSection {
  title: string
  items: CheatItem[]
}

export interface CheatSheet {
  format: 1
  sections: CheatSection[]
}
