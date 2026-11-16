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

/** A link between two courses. `needs`: do that one first. `related`: the same idea shows up there. */
export interface Tunnel {
  to: string
  kind: 'needs' | 'related'
  why: string
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
  /** Links to other courses in the same field; see schema/course.schema.json. */
  tunnels?: Tunnel[]
  /**
   * True when the course folder has a cheatsheet.json. Set by the validator in the
   * published index only; it is NOT part of course.schema.json or of course.json.
   */
  cheatsheet?: boolean
  /**
   * The steps its lessons mark `review: true`, for spaced review. Set by the validator in the
   * published index only (omitted when there are none); not part of course.json.
   */
  review?: { lesson: string; step: string }[]
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
  /** Worth coming back to after days, weeks, months: it joins the spaced review once solved. */
  review?: boolean
}

export interface TextBlock {
  type: 'text'
  id: string
  title?: string
  body: string
  widget?: WidgetRef
  next: string
}

export interface ChoiceOption {
  id: string
  text: string
  correct: boolean
  /** Why it is right, or the misconception it catches. Required: an option without a reason teaches nothing. */
  say: string
}

/**
 * A quiz question. Progress uses the same StepRecord as a step; the values of an attempt and of
 * the draft are `{ picked: "a,c", seed: "k3x9" }`: the picked option ids, comma-separated, in the
 * block's own option order (not the shuffled one), and the shuffle seed.
 */
export interface ChoiceBlock {
  type: 'choice'
  id: string
  title?: string
  why?: string
  prompt: string
  widget?: WidgetRef
  /** Two to five. */
  options: ChoiceOption[]
  /** True: tick every right option. False or absent: exactly one is right. */
  multiple?: boolean
  /** Default true. */
  shuffle?: boolean
  hint?: string
  solution?: string
  next: string
  review?: boolean
}

export interface OrderItem {
  id: string
  text: string
}

/**
 * An ordering puzzle; `items` are in the CORRECT order. Progress values (attempts and draft) are
 * `{ order: "s2,s1,s3", seed: "k3x9" }`: every item id, fixed ones included, in the order shown,
 * and the shuffle seed.
 */
export interface OrderBlock {
  type: 'order'
  id: string
  title?: string
  why?: string
  prompt: string
  items: OrderItem[]
  /** Item ids shown already in place. */
  fixed?: string[]
  /** Said when the item is the first one out of place. */
  say?: Record<string, string>
  hint?: string
  solution?: string
  next: string
  review?: boolean
}

export type Block = StepBlock | TextBlock | ChoiceBlock | OrderBlock

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
