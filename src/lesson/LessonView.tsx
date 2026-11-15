import { useEffect, useMemo, useRef, useState } from 'react'
import { LinksContext } from './links-context.ts'
import { Md } from './Md.tsx'
import { finishLesson, goTo, openLesson, recordAttempt, revealAnswer, saveDraft, takeHint } from './progress.ts'
import { useProgress } from './progress-store.ts'
import { StepScreen } from './StepScreen.tsx'
import type { Course, Lesson, TextBlock } from './types.ts'
import { Widget } from '../widgets/Widget.tsx'
import 'katex/dist/katex.min.css'

interface Props {
  course: Course
  lessonId: string
  /** Where the course's files are served, ending in a slash. */
  base: string
  onClose: () => void
  onOpenLesson: (lessonId: string) => void
}

type Loaded = { state: 'loading' } | { state: 'failed'; reason: string } | { state: 'ready'; lesson: Lesson }

const now = () => new Date().toISOString()

function TextScreen({ block, onNext }: { block: TextBlock; onNext: () => void }) {
  return (
    <>
      <div className="lesson-body">
        {block.title && <h2 className="screen-title">{block.title}</h2>}
        <Md className="prompt" text={block.body} />
        {block.widget && <Widget widget={block.widget} />}
      </div>
      <footer className="lesson-action">
        <button className="primary" onClick={onNext}>
          {block.next}
        </button>
      </footer>
    </>
  )
}

/** A lesson, full screen over the map: one screen at a time, resuming where it was left. */
export default function LessonView({ course, lessonId, base, onClose, onOpenLesson }: Props) {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  const [record, update] = useProgress(course.id)
  const body = useRef<HTMLDivElement>(null)
  const entry = course.lessons.find((l) => l.id === lessonId)
  const position = course.lessons.findIndex((l) => l.id === lessonId)
  const following = course.lessons[position + 1]

  useEffect(() => {
    let live = true
    setLoaded({ state: 'loading' })
    fetch(`${base}${lessonId}.json`)
      .then((response) => {
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
        return response.json() as Promise<Lesson>
      })
      .then((lesson) => live && setLoaded({ state: 'ready', lesson }))
      .catch((error: unknown) => live && setLoaded({ state: 'failed', reason: error instanceof Error ? error.message : String(error) }))
    return () => {
      live = false
    }
  }, [base, lessonId])

  useEffect(() => {
    if (loaded.state === 'ready') update((r) => openLesson(r, lessonId, now()))
  }, [loaded.state, lessonId, update])

  const lesson = loaded.state === 'ready' ? loaded.lesson : null
  const total = lesson?.blocks.length ?? 0
  const lessonRecord = record.lessons[lessonId]
  const at = Math.min(Math.max(0, lessonRecord?.at ?? 0), total)

  // Each new screen starts at its top.
  useEffect(() => {
    const element = body.current?.querySelector('.lesson-body')
    if (element) element.scrollTop = 0
  }, [at, lessonId])

  const links = useMemo(() => ({ nodeId: course.nodeId }), [course.nodeId])

  const header = (subtitle: string) => (
    <header className="lesson-bar">
      <button className="icon-button" onClick={onClose} aria-label="Close the lesson">
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
      <div className="lesson-heading">
        <p className="lesson-title">{entry?.title ?? lessonId}</p>
        <p className="lesson-sub">{subtitle}</p>
      </div>
      {lesson && at > 0 ? (
        <button className="icon-button" onClick={() => update((r) => goTo(r, lessonId, at - 1, now()))} aria-label="Previous screen">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      ) : (
        <span className="icon-spacer" />
      )}
    </header>
  )

  if (!lesson) {
    return (
      <div className="lesson" role="dialog" aria-label={entry?.title ?? 'Lesson'}>
        {header(loaded.state === 'loading' ? 'Loading…' : 'Not available')}
        <div className="lesson-body">
          <p className="status-inline" role={loaded.state === 'failed' ? 'alert' : undefined}>
            {loaded.state === 'failed' ? `This lesson could not be loaded (${loaded.reason}).` : 'Loading the lesson…'}
          </p>
        </div>
      </div>
    )
  }

  const block = lesson.blocks[at]
  const advance = () => update((r) => (at + 1 >= total ? finishLesson(r, lessonId, total, now()) : goTo(r, lessonId, at + 1, now())))

  let screen
  if (!block) {
    const steps = lesson.blocks.filter((b) => b.type === 'step')
    screen = (
      <>
        <div className="lesson-body">
          <h2 className="screen-title">Lesson done</h2>
          <ul className="done-list">
            {steps.map((step) => {
              const r = lessonRecord?.steps[step.id]
              const mark = r?.solved ? '✓' : r?.revealed ? 'shown' : '–'
              return (
                <li key={step.id}>
                  <span className="done-mark">{mark}</span> {step.title ?? step.id}
                </li>
              )
            })}
          </ul>
          {lesson.sideQuest && (
            <details className="side-quest">
              <summary>Optional: {lesson.sideQuest.title}</summary>
              <Md text={lesson.sideQuest.body} />
            </details>
          )}
        </div>
        <footer className="lesson-action">
          {following ? (
            <button className="primary" onClick={() => onOpenLesson(following.id)}>
              Next lesson: {following.title}
            </button>
          ) : (
            <button className="primary" onClick={onClose}>
              Course finished: back to the map
            </button>
          )}
        </footer>
      </>
    )
  } else if (block.type === 'text') {
    screen = <TextScreen key={block.id} block={block} onNext={advance} />
  } else {
    screen = (
      <StepScreen
        key={block.id}
        block={block}
        record={lessonRecord?.steps[block.id]}
        onDraft={(values) => update((r) => saveDraft(r, lessonId, block.id, values, now()))}
        onAttempt={(attempt) => update((r) => recordAttempt(r, lessonId, block.id, attempt))}
        onHint={() => update((r) => takeHint(r, lessonId, block.id, now()))}
        onReveal={() => update((r) => revealAnswer(r, lessonId, block.id, now()))}
        onNext={advance}
      />
    )
  }

  return (
    <LinksContext.Provider value={links}>
      <div className="lesson" role="dialog" aria-label={lesson.title} ref={body}>
        {header(block ? `${at + 1} of ${total}` : 'Done')}
        <div className="lesson-progress" aria-hidden="true">
          {lesson.blocks.map((b, i) => (
            <span key={b.id} className={i < at || (!block && i < total) ? 'seg done' : i === at ? 'seg here' : 'seg'} />
          ))}
        </div>
        {screen}
      </div>
    </LinksContext.Provider>
  )
}
