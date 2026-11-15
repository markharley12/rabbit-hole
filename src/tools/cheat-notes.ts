// The learner's own lines on a course's cheat sheet. Pure model: no React, no
// storage calls except load/save at the bottom, which never throw. The text is
// Markdown with maths in $...$, shown through the same renderer as lessons.

export interface Note {
  id: string
  text: string
  /** ISO time it was added. */
  at: string
}

export interface NotesFile {
  format: 1
  notes: Note[]
}

/** Most notes a course keeps, and the longest one. A full list refuses a new line; it never drops an old one. */
export const MAX_NOTES = 100
export const MAX_CHARS = 500
/** A stored value longer than this is not read at all (100 notes of 500 characters, with room for the rest). */
export const MAX_STORED = 100_000

// Prefixed: localStorage is shared by everything on an origin.
export const storageKey = (courseId: string) => `rabbit-hole:cheatsheet-notes:${courseId}`

export const isFull = (notes: Note[]) => notes.length >= MAX_NOTES

/** One line: whitespace folded, cut to the limit. Empty means nothing to add. */
export function cleanText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS)
}

/** The list with a new note at the end; unchanged when the text is empty or the list is full. Ids are "n1", "n2", … and never reused while a later one exists. */
export function addNote(notes: Note[], text: string, at: string): Note[] {
  const clean = cleanText(text)
  if (!clean || isFull(notes)) return notes
  const last = notes.reduce((max, note) => Math.max(max, Number(note.id.slice(1)) || 0), 0)
  return [...notes, { id: `n${last + 1}`, text: clean, at }]
}

export function removeNote(notes: Note[], id: string): Note[] {
  return notes.some((note) => note.id === id) ? notes.filter((note) => note.id !== id) : notes
}

export const serialise = (notes: Note[]): string => JSON.stringify({ format: 1, notes } satisfies NotesFile)

const isNote = (x: unknown): x is Note => {
  if (typeof x !== 'object' || x === null) return false
  const n = x as Record<string, unknown>
  return typeof n.id === 'string' && n.id !== '' && typeof n.text === 'string' && typeof n.at === 'string'
}

/** The notes in a stored value; none for anything corrupt, oversized or from another format. Bad entries and repeated ids are dropped, long ones cut, extras beyond the cap ignored. */
export function parseNotes(text: string | null): Note[] {
  if (!text || text.length > MAX_STORED) return []
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return []
  }
  if (typeof data !== 'object' || data === null) return []
  const file = data as { format?: unknown; notes?: unknown }
  if (file.format !== 1 || !Array.isArray(file.notes)) return []
  const seen = new Set<string>()
  const notes: Note[] = []
  for (const item of file.notes) {
    if (!isNote(item) || seen.has(item.id)) continue
    const clean = cleanText(item.text)
    if (!clean) continue
    seen.add(item.id)
    notes.push({ id: item.id, text: clean, at: item.at })
    if (notes.length === MAX_NOTES) break
  }
  return notes
}

export function loadNotes(courseId: string): Note[] {
  try {
    return parseNotes(localStorage.getItem(storageKey(courseId)))
  } catch {
    return []
  }
}

/** False when the device would not keep it; the notes still work for this visit. */
export function saveNotes(courseId: string, notes: Note[]): boolean {
  try {
    localStorage.setItem(storageKey(courseId), serialise(notes))
    return true
  } catch {
    return false
  }
}
