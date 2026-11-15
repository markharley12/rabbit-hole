import { afterEach, describe, expect, it } from 'vitest'
import { MAX_CHARS, MAX_NOTES, addNote, isFull, loadNotes, parseNotes, removeNote, saveNotes, serialise, storageKey } from './cheat-notes.ts'
import type { Note } from './cheat-notes.ts'
import { renderMarkdown } from '../lesson/markdown.ts'

afterEach(() => localStorage.clear())

const AT = '2026-11-15T10:00:00.000Z'
const many = (n: number): Note[] => Array.from({ length: n }, (_, i) => ({ id: `n${i + 1}`, text: `note ${i + 1}`, at: AT }))

describe('adding and removing', () => {
  it('adds a trimmed one-line note with a fresh id', () => {
    const notes = addNote([], '  the  residual\n is $r = b - Ax$  ', AT)
    expect(notes).toEqual([{ id: 'n1', text: 'the residual is $r = b - Ax$', at: AT }])
    expect(addNote(notes, 'second', AT).map((n) => n.id)).toEqual(['n1', 'n2'])
  })

  it('ignores an empty line', () => {
    const notes = many(1)
    expect(addNote(notes, '   \n ', AT)).toBe(notes)
  })

  it('cuts a note at 500 characters', () => {
    expect(addNote([], 'x'.repeat(MAX_CHARS + 50), AT)[0].text).toHaveLength(MAX_CHARS)
  })

  it('refuses a 101st note instead of dropping an old one', () => {
    const full = many(MAX_NOTES)
    expect(isFull(full)).toBe(true)
    expect(addNote(full, 'one more', AT)).toBe(full)
    expect(isFull(removeNote(full, 'n1'))).toBe(false)
  })

  it('does not reuse the id of a note still in the list after a removal', () => {
    const notes = removeNote(many(3), 'n2')
    expect(addNote(notes, 'new', AT).map((n) => n.id)).toEqual(['n1', 'n3', 'n4'])
  })

  it('removes by id and leaves the list alone for an unknown id', () => {
    const notes = many(3)
    expect(removeNote(notes, 'n2').map((n) => n.id)).toEqual(['n1', 'n3'])
    expect(removeNote(notes, 'nope')).toBe(notes)
  })
})

describe('what is kept on the device', () => {
  it('round-trips', () => {
    const notes = addNote(addNote([], 'a', AT), 'b $x^2$', AT)
    expect(parseNotes(serialise(notes))).toEqual(notes)
    expect(JSON.parse(serialise(notes)).format).toBe(1)
  })

  it.each([null, '', '{{{', 'null', '[]', '"x"', '{"format":2,"notes":[]}', '{"format":1}', '{"format":1,"notes":"x"}'])('reads %j as no notes', (text) => {
    expect(parseNotes(text)).toEqual([])
  })

  it('drops bad entries and repeated ids, and keeps the good ones', () => {
    const text = JSON.stringify({
      format: 1,
      notes: [{ id: 'n1', text: 'ok', at: AT }, null, 3, { id: 'n2', text: 7, at: AT }, { id: 'n1', text: 'again', at: AT }, { id: 'n3', text: '  ', at: AT }, { id: 'n4', text: 'fine', at: AT }],
    })
    expect(parseNotes(text).map((n) => n.id)).toEqual(['n1', 'n4'])
  })

  it('caps what it reads at 100 notes of 500 characters', () => {
    const text = JSON.stringify({ format: 1, notes: many(150).map((n) => ({ ...n, text: 'y'.repeat(600) })) })
    const notes = parseNotes(text)
    expect(notes).toHaveLength(MAX_NOTES)
    expect(notes.every((n) => n.text.length === MAX_CHARS)).toBe(true)
  })

  it('does not read an oversized value at all', () => {
    expect(parseNotes(' '.repeat(200_000) + serialise(many(1)))).toEqual([])
  })

  it('saves and loads under a key of its own, per course', () => {
    expect(storageKey('demo')).toBe('rabbit-hole:cheatsheet-notes:demo')
    expect(saveNotes('demo', many(2))).toBe(true)
    expect(loadNotes('demo')).toEqual(many(2))
    expect(loadNotes('other')).toEqual([])
  })

  it('a corrupt stored value loads as empty', () => {
    localStorage.setItem(storageKey('demo'), 'not json')
    expect(loadNotes('demo')).toEqual([])
  })
})

describe('typed text goes through the safe renderer', () => {
  it('shows typed HTML as text, never as markup', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)> and <script>alert(2)</script> and <a href="javascript:alert(3)">x</a>', { inline: true })
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('<a href')
    expect(html).toContain('&lt;img')
  })

  it('does not let a link or a maths command run script', () => {
    const html = renderMarkdown('[x](javascript:alert(1)) and $\\href{javascript:alert(1)}{y}$', { inline: true })
    expect(html).not.toMatch(/href="javascript/i)
  })

  it('still typesets the maths in a note', () => {
    expect(renderMarkdown('so $r = b - Ax$', { inline: true })).toContain('class="katex"')
  })
})
