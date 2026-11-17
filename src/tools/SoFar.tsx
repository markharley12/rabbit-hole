import { Md } from '../lesson/Md.tsx'
import { useProgress } from '../lesson/progress-store.ts'
import type { Course, Lesson } from '../lesson/types.ts'
import { useEarlierLessons } from './so-far-store.ts'
import { answerLines, lessonsToFetch, soFar } from './so-far.ts'
import type { SoFarEntry } from './so-far.ts'

interface Props {
  course: Course
  /** The lesson he is in, and the screen he is on (a block index). */
  lesson: Lesson
  at: number
  /** Where the course's files are served, ending in a slash. */
  base: string
}

function Entry({ entry }: { entry: SoFarEntry }) {
  const { step } = entry
  return (
    <li className="sofar-entry">
      {step.title && <p className="sofar-name">{step.title}</p>}
      <Md className="sofar-prompt" text={step.prompt} />
      <ul className="sofar-answer" aria-label="Answer">
        {answerLines(step.answer).map((line, i) => (
          <li key={i} className="sofar-line">
            {line.label && <Md className="sofar-label" text={line.label} inline />}
            <Md className="sofar-value" text={line.value} inline />
          </li>
        ))}
      </ul>
      {entry.how === 'revealed' && <p className="sofar-shown">answer was shown</p>}
    </li>
  )
}

/**
 * What he has already worked out: the solved or revealed steps before this screen, this lesson
 * first, then earlier lessons nearest first (collapsed). Earlier lesson files are fetched when
 * the panel opens. Reads progress; writes nothing.
 */
export function SoFar({ course, lesson, at, base }: Props) {
  const [record] = useProgress(course.id)
  const ids = course.lessons.map((l) => l.id)
  const earlier = useEarlierLessons(base, lessonsToFetch(ids, lesson.id, record))
  const groups = soFar({
    lessonIds: ids,
    blocks: { ...Object.fromEntries(Object.entries(earlier.lessons).map(([id, l]) => [id, l.blocks])), [lesson.id]: lesson.blocks },
    record,
    currentLessonId: lesson.id,
    at,
  })
  const title = (id: string) => course.lessons.find((l) => l.id === id)?.title ?? id
  const headed = groups.some((g) => g.current) && groups.some((g) => !g.current)

  return (
    <div className="sofar">
      {groups.map((group) =>
        group.current ? (
          <section className="sofar-group" key={group.lessonId} aria-label="This lesson">
            {headed && <h3>This lesson</h3>}
            <ul className="sofar-entries">
              {group.entries.map((entry) => (
                <Entry key={entry.step.id} entry={entry} />
              ))}
            </ul>
          </section>
        ) : (
          <details className="sofar-group sofar-earlier" key={group.lessonId}>
            <summary>
              {title(group.lessonId)} <span className="sofar-count">{group.entries.length}</span>
            </summary>
            <ul className="sofar-entries">
              {group.entries.map((entry) => (
                <Entry key={entry.step.id} entry={entry} />
              ))}
            </ul>
          </details>
        ),
      )}
      {earlier.state === 'loading' && <p className="status-inline">Loading earlier lessons…</p>}
      {groups.length === 0 && earlier.state !== 'loading' && <p className="status-inline">Nothing yet. Steps you finish show up here with their answers.</p>}
      {earlier.state === 'failed' && (
        <p className="status-inline" role="alert">
          Could not load earlier lessons.
        </p>
      )}
    </div>
  )
}
