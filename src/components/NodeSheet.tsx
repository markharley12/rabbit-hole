import { useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { ancestry, shortCode } from '../map/layout.ts'
import type { Placed } from '../map/layout.ts'
import type { MapDocument } from '../map/types.ts'
import { lessonState, nextUp } from '../lesson/progress.ts'
import { useProgress } from '../lesson/progress-store.ts'
import type { Course } from '../lesson/types.ts'

interface Props {
  node: Placed
  document: MapDocument
  /** The course on this node, if there is one. */
  course?: Course
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (id: string) => void
  onOpenLesson: (lessonId: string) => void
}

const plural = (n: number, one: string, many = one + 's') => `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`

/** What the children of a node are called, from their own ranks. */
function childNoun(node: Placed): [string, string] {
  const ranks = new Set(node.children.map((c) => c.node.rank))
  if (ranks.size === 1) {
    const rank = [...ranks][0]
    if (rank === 'Branch') return ['branch', 'branches']
    if (rank === 'Area') return ['area', 'areas']
    if (rank === 'Subject') return ['subject', 'subjects']
    if (rank === 'Section') return ['section', 'sections']
  }
  return ['part', 'parts']
}

/** The one button for a course: start it, carry on where you left off, or go over it again. */
function CourseButton({ course, onOpenLesson }: { course: Course; onOpenLesson: (lessonId: string) => void }) {
  const [record] = useProgress(course.id)
  const next = nextUp(course, record)
  const fresh = Object.keys(record.lessons).length === 0
  const target = next?.lessonId ?? course.lessons[0].id
  const number = course.lessons.findIndex((l) => l.id === target) + 1
  const label = fresh ? 'Start course' : next ? `${next.verb} lesson ${number}` : 'Go over it again'
  return (
    <button className="course-start" onClick={() => onOpenLesson(target)}>
      {label}
    </button>
  )
}

function CourseSection({ course, onOpenLesson }: { course: Course; onOpenLesson: (lessonId: string) => void }) {
  const [record] = useProgress(course.id)
  return (
    <>
      <p className="note course-title">{course.title}</p>
      <p className="note">{course.summary}</p>
      <ol className="lessons">
        {course.lessons.map((lesson, i) => {
          const state = lessonState(record, lesson.id)
          return (
            <li key={lesson.id}>
              <button className="lesson-row" onClick={() => onOpenLesson(lesson.id)}>
                <span className="lesson-number">{i + 1}</span>
                <span className="lesson-name">
                  {lesson.title}
                  {lesson.badge && <span className="badge">{lesson.badge}</span>}
                </span>
                <span className="lesson-state">{state.state === 'done' ? 'Done' : state.state === 'started' ? 'Started' : ''}</span>
              </button>
            </li>
          )
        })}
      </ol>
      <p className="note small">{course.written}</p>
      {course.sources.map((source) => (
        <p className="note small" key={source.name}>
          Source: {source.url ? <a href={source.url} target="_blank" rel="noopener noreferrer">{source.name}</a> : source.name}
          {source.note && `. ${source.note}`}
        </p>
      ))}
    </>
  )
}

/**
 * The bottom sheet for the focused node. Closed it is a short card (what this
 * is, how big, whether there is a course); opened it lists where the node sits
 * and what is in it.
 */
export function NodeSheet({ node, document: doc, course, open, onOpenChange, onSelect, onOpenLesson }: Props) {
  const drag = useRef<number | null>(null)
  const { node: data } = node
  const leaf = node.children.length === 0
  const path = ancestry(node)
  const [one, many] = childNoun(node)

  // A flick up or down on the header opens or closes it; a tap toggles.
  const onPointerDown = (event: ReactPointerEvent) => {
    drag.current = event.clientY
  }
  const onPointerUp = (event: ReactPointerEvent) => {
    if (drag.current === null) return
    const moved = event.clientY - drag.current
    drag.current = null
    if (moved < -24) onOpenChange(true)
    else if (moved > 24) onOpenChange(false)
  }

  const kind = [data.rank ?? (node.parent ? 'Group' : 'Field'), data.code && `MSC ${shortCode(data.code)}`].filter(Boolean).join(' · ')
  const size = leaf
    ? plural(node.topics, 'topic')
    : `${plural(node.children.length, one, many)} · ${plural(node.topics, 'topic')}`

  return (
    <section className={`sheet ${open ? 'open' : ''}`} aria-label={`About ${data.name}`}>
      <div className="sheet-head" onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={() => (drag.current = null)}>
        <button
          className="sheet-handle"
          onClick={() => onOpenChange(!open)}
          aria-expanded={open}
          aria-controls="sheet-body"
          aria-label={open ? 'Show less' : 'Show more'}
        >
          <span className="grip" />
        </button>
        <p className="kind">{kind}</p>
        <h1 className="title">{data.name}</h1>
        <p className="meta">
          <span>{size}</span>
          {course ? <CourseButton course={course} onOpenLesson={onOpenLesson} /> : <span className="course-none">No course yet</span>}
        </p>
      </div>

      <div className="sheet-body" id="sheet-body" hidden={!open}>
        {path.length > 1 && (
          <>
            <h2>Where it sits</h2>
            <ol className="where">
              {path.slice(0, -1).map((step) => (
                <li key={step.id}>
                  <button className="link" onClick={() => onSelect(step.id)}>
                    {step.node.name}
                  </button>
                </li>
              ))}
              <li aria-current="location">{data.name}</li>
            </ol>
          </>
        )}

        {data.description && (
          <>
            <h2>MSC note</h2>
            <p className="note">{data.description}</p>
          </>
        )}

        {leaf ? (
          <>
            <h2>Topics</h2>
            <ul className="topics">{data.items?.map((item, i) => <li key={i}>{item}</li>)}</ul>
          </>
        ) : (
          <>
            <h2>Inside</h2>
            <ul className="inside">
              {node.children.map((child) => (
                <li key={child.id}>
                  <button className={`inside-row b${child.branch}`} onClick={() => onSelect(child.id)}>
                    <span className="dot" />
                    <span className="inside-name">{child.node.name}</span>
                    <span className="inside-count">{child.topics.toLocaleString('en-GB')}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        <h2>Course</h2>
        {course ? (
          <CourseSection course={course} onOpenLesson={onOpenLesson} />
        ) : (
          <p className="note">No course yet. Generating courses is a later phase; nothing here can make one today.</p>
        )}

        {data.url && (
          <p className="note">
            <a href={data.url} target="_blank" rel="noopener noreferrer">
              {data.urlTitle ?? 'This code on zbMATH Open'}
            </a>
          </p>
        )}

        {!node.parent && (
          <>
            <h2>About this map</h2>
            <p className="note">
              {plural(doc.totals.leaves, 'section')} and {plural(doc.totals.topics, 'topic')}. A circle's size is its number of topics.
            </p>
            {doc.sources.map((source) => (
              <p className="note" key={source.url}>
                <a href={source.url} target="_blank" rel="noopener noreferrer">
                  {source.name}
                </a>
                , licensed{' '}
                {source.licence_url ? (
                  <a href={source.licence_url} target="_blank" rel="noopener noreferrer">
                    {source.licence}
                  </a>
                ) : (
                  source.licence
                )}{' '}
                (non-commercial, share-alike). {source.note}
              </p>
            ))}
            <p className="note">
              Built from{' '}
              <a href={doc.builtFrom.repo} target="_blank" rel="noopener noreferrer">
                TreeQuiz
              </a>{' '}
              at commit {doc.builtFrom.commit.slice(0, 7)}.
            </p>
          </>
        )}
      </div>
    </section>
  )
}
