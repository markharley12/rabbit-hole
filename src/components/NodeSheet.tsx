import { useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { ancestry, shortCode } from '../map/layout.ts'
import type { Placed } from '../map/layout.ts'
import type { MapDocument } from '../map/types.ts'
import { lessonState, nextUp } from '../lesson/progress.ts'
import { readProgress, useProgress } from '../lesson/progress-store.ts'
import { courseFinished, tunnelsOf } from '../courses.ts'
import type { TunnelLink } from '../courses.ts'
import type { Course } from '../lesson/types.ts'
import { ReadingList } from './ReadingList.tsx'
import type { ReadingSource } from '../resources.ts'

interface Props {
  node: Placed
  document: MapDocument
  /** The courses on this node: none, one, or several. */
  courses: Course[]
  /** Courses under each node (its own included); absent means none. */
  counts: Map<string, number>
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (id: string) => void
  onOpenLesson: (course: Course, lessonId: string) => void
  onOpenCourses: () => void
  /** Where to find reading; the sheet shows only the node's own. */
  reading?: ReadingSource
  /** Items due for review today; the line on the root sheet shows only above zero. */
  dueCount?: number
  onOpenReview?: () => void
  /** Every course in the app, so a course's part of the sheet can show its tunnels. */
  allCourses?: Course[]
  /** Go to a course's own node and open its sheet (what a tunnel line does when tapped). */
  onShowCourse?: (course: Course) => void
  /** Given only when the server on the PC offers the new-course chat: the "Make a course here" line. */
  onMakeCourse?: () => void
}

// "15 Nov 2026, 19:04", in the phone's own time zone.
const buildTime = new Date(__APP_BUILD__.time).toLocaleString('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

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
function CourseButton({ course, onOpenLesson }: { course: Course; onOpenLesson: (course: Course, lessonId: string) => void }) {
  const [record] = useProgress(course.id)
  const next = nextUp(course, record)
  const fresh = Object.keys(record.lessons).length === 0
  const target = next?.lessonId ?? course.lessons[0].id
  const number = course.lessons.findIndex((l) => l.id === target) + 1
  const label = fresh ? 'Start course' : next ? `${next.verb} lesson ${number}` : 'Go over it again'
  return (
    <button className="course-start" onClick={() => onOpenLesson(course, target)}>
      {label}
    </button>
  )
}

/**
 * A course's tunnels as quiet lines: at most one per kind. "Builds on" says when a needed course
 * is not finished, and never blocks starting; "Leads to" is derived from the other courses' `needs`.
 */
function TunnelLines({ course, all, onShow }: { course: Course; all: Course[]; onShow: (course: Course) => void }) {
  const { needs, related, leadsTo } = tunnelsOf(course, all)
  const line = (label: string, links: TunnelLink[], showUnfinished: boolean) =>
    links.length > 0 && (
      <p className="note small tunnel-line">
        {label}:{' '}
        {links.map(({ course: other, why }, i) => (
          <span key={other.id}>
            {i > 0 && ', '}
            <button className="link" title={why} onClick={() => onShow(other)}>
              {other.title}
            </button>
            {showUnfinished && !courseFinished(other, readProgress(other.id)) && ' (not finished yet)'}
          </span>
        ))}
      </p>
    )
  return (
    <>
      {line('Builds on', needs, true)}
      {line('Leads to', leadsTo, false)}
      {line('Related', related, false)}
    </>
  )
}

/** One course: title, summary, lessons. With several courses on a node each carries its own button; with one, the header has it. */
function CourseSection({
  course,
  withButton,
  onOpenLesson,
  allCourses,
  onShowCourse,
}: {
  course: Course
  withButton: boolean
  onOpenLesson: (course: Course, lessonId: string) => void
  allCourses?: Course[]
  onShowCourse?: (course: Course) => void
}) {
  const [record] = useProgress(course.id)
  return (
    <>
      <p className="note course-title">{course.title}</p>
      <p className="note">{course.summary}</p>
      {allCourses && onShowCourse && <TunnelLines course={course} all={allCourses} onShow={onShowCourse} />}
      {withButton && <CourseButton course={course} onOpenLesson={onOpenLesson} />}
      <ol className="lessons">
        {course.lessons.map((lesson, i) => {
          const state = lessonState(record, lesson.id)
          return (
            <li key={lesson.id}>
              <button className="lesson-row" onClick={() => onOpenLesson(course, lesson.id)}>
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
export function NodeSheet({ node, document: doc, courses, counts, open, onOpenChange, onSelect, onOpenLesson, onOpenCourses, reading, dueCount = 0, onOpenReview, allCourses, onShowCourse, onMakeCourse }: Props) {
  const inside = counts.get(node.id) ?? 0
  const course = courses.length === 1 ? courses[0] : undefined
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
          {course ? (
            <CourseButton course={course} onOpenLesson={onOpenLesson} />
          ) : courses.length > 1 ? (
            // Each course has its own button below; here one tap shows them.
            <button className="course-count" onClick={() => onOpenChange(true)}>
              {plural(courses.length, 'course')} here
            </button>
          ) : inside > 0 ? (
            // A count is not the thing itself: show where they are rather than pretend to start one.
            <button className="course-count" onClick={onOpenCourses}>
              {plural(inside, 'course')} inside
            </button>
          ) : (
            <span className="course-none">{leaf ? 'No course yet' : 'No courses yet'}</span>
          )}
        </p>
        {!node.parent && onOpenReview && dueCount > 0 && (
          <button className="text-button review-line" onClick={onOpenReview}>
            {dueCount} to review
          </button>
        )}
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
                    <span className="inside-name">
                      {child.node.name}
                      {counts.get(child.id) ? <span className="has-courses">{plural(counts.get(child.id)!, 'course')}</span> : null}
                    </span>
                    <span className="inside-count">{child.topics.toLocaleString('en-GB')}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        <h2>{courses.length > 1 ? 'Courses' : leaf || course ? 'Course' : 'Courses'}</h2>
        {courses.length > 0 ? (
          courses.map((c) => <CourseSection key={c.id} course={c} withButton={courses.length > 1} onOpenLesson={onOpenLesson} allCourses={allCourses} onShowCourse={onShowCourse} />)
        ) : inside > 0 ? (
          <p className="note">
            {plural(inside, 'course')} in here.{' '}
            <button className="link" onClick={onOpenCourses}>
              See {inside === 1 ? 'it' : 'them'} in Courses
            </button>
            , or follow the marked circles on the map.
          </p>
        ) : (
          <>
            <p className="note">{leaf ? 'No course yet.' : 'No courses in here yet.'}</p>
            {onMakeCourse && (
              <button className="text-button review-line" onClick={onMakeCourse}>
                Make a course here
              </button>
            )}
          </>
        )}

        {open && reading && (reading.counts[node.id] ?? 0) > 0 && (
          <>
            <h2>Reading</h2>
            <ReadingList nodes={[{ id: node.id, name: data.name }]} base={reading.base} />
          </>
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

            <h2>This version</h2>
            <p className="note">
              Built {buildTime} from commit {__APP_BUILD__.commit}. A newer build arrives the second time the app is opened after it is
              made.
            </p>
          </>
        )}
      </div>
    </section>
  )
}
