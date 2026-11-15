import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Md } from '../lesson/Md.tsx'
import { useSheet } from './cheat-sheet-store.ts'
import { MAX_CHARS, MAX_NOTES, addNote, isFull, loadNotes, removeNote, saveNotes } from './cheat-notes.ts'
import type { Note } from './cheat-notes.ts'

interface Props {
  courseId: string
  lessonId: string
  /** Where the course's files are served, ending in a slash. */
  base: string
}

/** One of his own lines, with a remove button that asks twice (as the scratch pad's clear does). */
function NoteRow({ note, onRemove }: { note: Note; onRemove: () => void }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const timer = setTimeout(() => setArmed(false), 3000)
    return () => clearTimeout(timer)
  }, [armed])
  return (
    <li className="cheat-note">
      <Md className="cheat-note-text" text={note.text} inline />
      <button
        type="button"
        className={armed ? 'cheat-remove armed' : 'cheat-remove'}
        aria-label={armed ? `Tap again to remove: ${note.text}` : `Remove: ${note.text}`}
        onClick={() => (armed ? onRemove() : setArmed(true))}
      >
        {armed ? 'Sure?' : 'Remove'}
      </button>
    </li>
  )
}

function MyNotes({ courseId }: { courseId: string }) {
  const [notes, setNotes] = useState<Note[]>(() => loadNotes(courseId))
  const [text, setText] = useState('')
  const [kept, setKept] = useState(true)
  const input = useRef<HTMLInputElement>(null)
  const full = isFull(notes)

  const change = (next: Note[]) => {
    setNotes(next)
    setKept(saveNotes(courseId, next))
  }
  const add = (event: FormEvent) => {
    event.preventDefault()
    const next = addNote(notes, text, new Date().toISOString())
    if (next === notes) return
    change(next)
    setText('')
    input.current?.focus()
  }

  return (
    <section className="cheat-section" aria-labelledby="my-notes">
      <h3 id="my-notes">My notes</h3>
      {notes.length > 0 ? (
        <ul className="cheat-notes" aria-label="My notes">
          {notes.map((note) => (
            <NoteRow key={note.id} note={note} onRemove={() => change(removeNote(notes, note.id))} />
          ))}
        </ul>
      ) : (
        <Md className="note" text="Nothing yet. Add a line of your own below. Maths goes between dollar signs, like $x^2$." />
      )}
      <form className="cheat-add" onSubmit={add}>
        <input
          ref={input}
          type="text"
          className="cheat-input"
          aria-label="Add a note"
          placeholder={full ? 'Remove a note to add another' : 'A line of your own'}
          maxLength={MAX_CHARS}
          disabled={full}
          autoComplete="off"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <button type="submit" className="cheat-add-button" disabled={full || !text.trim()}>
          Add
        </button>
      </form>
      {full && <p className="note small">{MAX_NOTES} notes is the most. Remove one to add another.</p>}
      {!kept && <p className="note small">This device would not keep your notes. They last until you close the app.</p>}
    </section>
  )
}

/** The course's formulas, then his own lines. His notes work even if the sheet could not load. */
export function CheatSheet({ courseId, lessonId, base }: Props) {
  const loaded = useSheet(`${base}cheatsheet.json`)
  return (
    <div className="cheat">
      {loaded.state === 'loading' && <p className="status-inline">Loading the cheat sheet…</p>}
      {loaded.state === 'failed' && (
        <p className="status-inline" role="alert">
          The cheat sheet could not be loaded ({loaded.reason}). Your own notes are below.
        </p>
      )}
      {loaded.state === 'ready' &&
        loaded.sheet.sections.map((section) => (
          <section className="cheat-section" key={section.title} aria-label={section.title}>
            <h3>{section.title}</h3>
            <ul className="cheat-items">
              {section.items.map((item) => (
                <li key={item.id} className="cheat-item">
                  <p className="cheat-name">
                    {item.name}
                    {item.lesson === lessonId && <span className="cheat-here">this lesson</span>}
                  </p>
                  <Md className="cheat-formula" text={item.formula} />
                  <Md className="cheat-when" text={item.when} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      <MyNotes courseId={courseId} />
    </div>
  )
}
