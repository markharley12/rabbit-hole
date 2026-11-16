import { useEffect, useMemo, useRef, useState } from 'react'
import { LinksContext } from '../lesson/links-context.ts'
import { Md } from '../lesson/Md.tsx'
import type { Attempt, StepRecord } from '../lesson/progress.ts'
import { ChoiceScreen } from '../lesson/ChoiceScreen.tsx'
import { OrderScreen } from '../lesson/OrderScreen.tsx'
import { StepScreen } from '../lesson/StepScreen.tsx'
import type { ChoiceBlock, Course, Lesson, OrderBlock, StepBlock } from '../lesson/types.ts'
import { gradeItem } from './review-record.ts'
import { writeReview } from './review-store.ts'
import type { ReviewItem } from './queue.ts'
import { dueItems, grade, gradeStep, inDays, localDate, nextDue, sessionOrder } from './schedule.ts'
import type { Grade, ItemState } from './schedule.ts'
import 'katex/dist/katex.min.css'

interface Props {
  /** Every item earned so far (the session takes those due today when it opens). */
  items: ReviewItem[]
  /** Where courses are served, ending in a slash. */
  base: string
  /** Courses whose cheat sheet could not be fetched, so their formula cards are missing. */
  unavailable?: Course[]
  onClose: () => void
}

type LessonCache = Map<string, Promise<Lesson>>

function fetchLesson(cache: LessonCache, url: string): Promise<Lesson> {
  let promise = cache.get(url)
  if (!promise) {
    promise = fetch(url).then((response) => {
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
      return response.json() as Promise<Lesson>
    })
    cache.set(url, promise)
    promise.catch(() => cache.delete(url))
  }
  return promise
}

/** A fresh record kept in memory: a review never reads or writes the course's own progress. */
const freshStep = (): StepRecord => ({ attempts: 0, solved: false, hints: 0, log: [] })

const CloseIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
    <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
)

/** What a marked block can be: the three screens that keep a record and have a right answer. */
type Question = StepBlock | ChoiceBlock | OrderBlock

const isQuestion = (block: Lesson['blocks'][number] | undefined): block is Question =>
  block?.type === 'step' || block?.type === 'choice' || block?.type === 'order'

/**
 * A marked step, quiz question or ordering puzzle: the lesson's own screen, answered from a clean
 * record, graded when its button is pressed (right first try with no hint is good, right after a
 * wrong try or the hint is hard, shown is again). A quiz or puzzle opens with a fresh shuffle each
 * time, because the screen draws a new seed when the record has no draft.
 */
function StepItem({ item, base, cache, onDone }: { item: ReviewItem & { kind: 'step' }; base: string; cache: LessonCache; onDone: (grade?: Grade) => void }) {
  const [loaded, setLoaded] = useState<{ state: 'loading' } | { state: 'failed' } | { state: 'ready'; block: Question }>({ state: 'loading' })
  const [record, setRecord] = useState<StepRecord>(freshStep)
  const links = useMemo(() => ({ nodeId: item.course.nodeId, courseId: item.course.id }), [item.course.nodeId, item.course.id])
  const title = item.course.lessons.find((l) => l.id === item.lessonId)?.title ?? item.lessonId

  useEffect(() => {
    let live = true
    fetchLesson(cache, `${base}${item.course.id}/${item.lessonId}.json`)
      .then((lesson) => {
        const block = lesson.blocks.find((b) => b.id === item.stepId)
        if (!live) return
        setLoaded(isQuestion(block) ? { state: 'ready', block } : { state: 'failed' })
      })
      .catch(() => live && setLoaded({ state: 'failed' }))
    return () => {
      live = false
    }
  }, [base, cache, item.course.id, item.lessonId, item.stepId])

  if (loaded.state !== 'ready') {
    return (
      <>
        <div className="lesson-body">
          <p className="review-from">From {title}</p>
          <p className="status-inline" role={loaded.state === 'failed' ? 'alert' : undefined}>
            {loaded.state === 'failed' ? 'This question could not be loaded, so it is skipped for now.' : 'Loading the question…'}
          </p>
        </div>
        <footer className="lesson-action">
          <button className="primary" onClick={() => onDone()} disabled={loaded.state === 'loading'}>
            {loaded.state === 'loading' ? 'Loading…' : 'Next'}
          </button>
        </footer>
      </>
    )
  }

  const wrong = record.log.filter((a) => a.result === 'wrong').length
  const shared = {
    record,
    onDraft: () => {},
    onAttempt: (attempt: Attempt) =>
      setRecord((r) => ({ ...r, attempts: r.attempts + 1, solved: r.solved || attempt.result === 'correct', log: [...r.log, attempt] })),
    onHint: () => setRecord((r) => ({ ...r, hints: Math.min(3, r.hints + 1) })),
    onReveal: () => setRecord((r) => ({ ...r, revealed: true })),
    onNext: () => onDone(gradeStep({ solved: record.solved, revealed: !!record.revealed, hints: record.hints, wrong })),
  }
  const { block } = loaded
  return (
    <LinksContext.Provider value={links}>
      <p className="review-from">From {title}</p>
      {block.type === 'choice' ? (
        <ChoiceScreen block={block} {...shared} />
      ) : block.type === 'order' ? (
        <OrderScreen block={block} {...shared} />
      ) : (
        <StepScreen block={block} {...shared} />
      )}
    </LinksContext.Provider>
  )
}

/** A cheat-sheet formula: see the name and cue, write it on paper, reveal it (with when to use it), say how it went. */
function FormulaItem({ item, onDone }: { item: ReviewItem & { kind: 'formula' }; onDone: (grade: Grade) => void }) {
  const [shown, setShown] = useState(false)
  const { formula } = item
  return (
    <>
      <div className="lesson-body">
        <p className="review-from">Cheat sheet: {item.course.title}</p>
        <h2 className="screen-title">{formula.name}</h2>
        {/* The front is the name and the cue only: `when` often nearly states the formula, so it waits for the back. */}
        {formula.cue && <Md className="prompt" text={formula.cue} />}
        {shown ? (
          <div className="review-formula" role="status">
            <Md text={formula.formula} />
            <Md className="note small" text={formula.when} />
          </div>
        ) : (
          <p className="note">Write it on paper first.</p>
        )}
      </div>
      <footer className="lesson-action">
        {shown ? (
          <div className="review-grade">
            <button className="primary outline" onClick={() => onDone('again')}>
              Not yet
            </button>
            <button className="primary" onClick={() => onDone('good')}>
              Got it
            </button>
          </div>
        ) : (
          <button className="primary" onClick={() => setShown(true)}>
            Show the formula
          </button>
        )}
      </footer>
    </>
  )
}

/** A session of spaced review, full screen over the map: today's due items, one at a time. */
export default function ReviewView({ items, base, unavailable = [], onClose }: Props) {
  // The session is fixed when it opens: grading must not reshuffle what is left.
  const [session] = useState(() => {
    const now = new Date()
    return sessionOrder(dueItems(items, now), localDate(now))
  })
  const [at, setAt] = useState(0)
  const [graded, setGraded] = useState<Record<string, ItemState>>({})
  const cache = useRef<LessonCache>(new Map())
  const total = session.length
  const item = session[at]

  const finish = (how?: Grade) => {
    if (how && item) {
      const now = new Date()
      writeReview((record) => gradeItem(record, item.key, item.state, how, now))
      setGraded((g) => ({ ...g, [item.key]: grade(item.state, how, now) }))
    }
    setAt((n) => n + 1)
  }

  const header = (subtitle: string) => (
    <header className="lesson-bar">
      <button className="icon-button" onClick={onClose} aria-label="Close review">
        <CloseIcon />
      </button>
      <div className="lesson-heading">
        <p className="lesson-title">Review</p>
        <p className="lesson-sub">{subtitle}</p>
      </div>
      <span className="icon-spacer" />
    </header>
  )

  const missing = unavailable.length > 0 && (
    <p className="note small">
      The cheat sheet of {unavailable.map((c) => c.title).join(' and ')} could not be loaded, so its formula cards are skipped for now.
    </p>
  )

  if (!item) {
    const now = new Date()
    const after = items.map((i) => (graded[i.key] ? { ...i, state: graded[i.key] } : i))
    const still = dueItems(after, now).length
    const next = nextDue(after, now)
    const worked = total > 0
    return (
      <div className="lesson review" role="dialog" aria-label="Review">
        {header(worked ? 'Done' : 'Nothing due')}
        <div className="lesson-body">
          <h2 className="screen-title">{worked ? 'Done for today.' : 'Nothing to review today.'}</h2>
          {still > 0 && <p className="prompt">{still === 1 ? '1 more is due. Open Review again for it.' : `${still} more are due. Open Review again for them.`}</p>}
          {still === 0 && next && <p className="prompt">The next review is due {inDays(next.days)}.</p>}
          {still === 0 && !next && !worked && items.length === 0 && (
            <p className="prompt">Finish a lesson and its key steps come back here after a day.</p>
          )}
          {missing}
        </div>
        <footer className="lesson-action">
          <button className="primary" onClick={onClose}>
            Back to the map
          </button>
        </footer>
      </div>
    )
  }

  return (
    <div className="lesson review" role="dialog" aria-label="Review">
      {header(`${at + 1} of ${total}`)}
      <div className="lesson-progress" aria-hidden="true">
        {session.map((s, i) => (
          <span key={s.key} className={i < at ? 'seg done' : i === at ? 'seg here' : 'seg'} />
        ))}
      </div>
      {item.kind === 'step' ? (
        <StepItem key={item.key} item={item} base={base} cache={cache.current} onDone={finish} />
      ) : (
        <FormulaItem key={item.key} item={item} onDone={finish} />
      )}
    </div>
  )
}
