import { useMemo, useState } from 'react'
import { searchCourses, searchNodes } from '../courses.ts'
import { lessonState, nextUp } from '../lesson/progress.ts'
import { readProgress } from '../lesson/progress-store.ts'
import type { Course } from '../lesson/types.ts'
import { ancestry, shortCode } from '../map/layout.ts'
import type { Layout, Placed } from '../map/layout.ts'

interface Props {
  layout: Layout
  courses: Course[]
  onClose: () => void
  onOpenLesson: (course: Course, lessonId: string) => void
  onShowNode: (id: string) => void
  /** Items due for review today; the line under the search box shows only above zero. */
  dueCount?: number
  onOpenReview?: () => void
  /** Opens "Where I am"; the quiet button under the title shows only when given. */
  onOpenProgress?: () => void
  /** Given only when the server on the PC offers the new-course chat: the "New course" button. */
  onNewCourse?: () => void
}

const where = (node: Placed) =>
  ancestry(node)
    .slice(1, -1)
    .map((n) => n.node.name)
    .join(' › ')

/** "Not started", "Lesson 3 of 5", "Done": what the device knows, never a score. */
function progressText(course: Course) {
  const record = readProgress(course.id)
  const done = course.lessons.filter((l) => lessonState(record, l.id).state === 'done').length
  if (done === course.lessons.length) return 'Done'
  if (Object.keys(record.lessons).length === 0) return 'Not started'
  const next = nextUp(course, record)
  const n = next ? course.lessons.findIndex((l) => l.id === next.lessonId) + 1 : 1
  return `On lesson ${n} of ${course.lessons.length}`
}

/**
 * Every course in the app, and a search over courses and the map's sections
 * and topics. Full screen over the map; Back or × closes it.
 */
export function CoursesMenu({ layout, courses, onClose, onOpenLesson, onShowNode, dueCount = 0, onOpenReview, onOpenProgress, onNewCourse }: Props) {
  const [query, setQuery] = useState('')
  const courseHits = useMemo(() => searchCourses(query, courses, layout), [query, courses, layout])
  const nodeHits = useMemo(() => searchNodes(query, layout), [query, layout])
  const searching = query.trim().length > 0

  return (
    <div className="lesson menu" role="dialog" aria-label="Courses">
      <header className="lesson-bar">
        <button className="icon-button" onClick={onClose} aria-label="Close courses">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
        <div className="lesson-heading">
          <p className="lesson-title">Courses</p>
          <p className="lesson-sub">
            {courses.length} in the app
          </p>
        </div>
        {onOpenProgress ? (
          <button className="text-button where-link" onClick={onOpenProgress}>
            Where I am
          </button>
        ) : (
          <span className="icon-spacer" />
        )}
      </header>
      <div className="lesson-body">
        <input
          className="search"
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="Search courses, sections, topics"
          aria-label="Search courses, sections and topics"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />

        {onOpenReview && dueCount > 0 && (
          <button className="text-button review-line" onClick={onOpenReview}>
            {dueCount} to review
          </button>
        )}

        <h2 className="menu-heading">{searching ? `Courses (${courseHits.length})` : 'All courses'}</h2>
        {courseHits.length === 0 && <p className="note">{searching ? 'No course matches.' : 'No courses yet.'}</p>}
        <ul className="menu-list">
          {courseHits.map(({ course, node }) => {
            const next = nextUp(course, readProgress(course.id))
            const target = next?.lessonId ?? course.lessons[0].id
            return (
              <li key={course.id} className="course-card">
                <button className="course-card-main" onClick={() => onOpenLesson(course, target)}>
                  <span className="course-card-title">{course.title}</span>
                  <span className="course-card-meta">
                    {node ? `${node.node.name}${node.node.code ? ` · MSC ${shortCode(node.node.code)}` : ''}` : course.nodeId} · {course.lessons.length} lessons
                  </span>
                  <span className="course-card-meta">{progressText(course)}</span>
                </button>
                {node && (
                  <button className="text-button" onClick={() => onShowNode(node.id)}>
                    Show on the map
                  </button>
                )}
              </li>
            )
          })}
        </ul>
        {onNewCourse && (
          <button className="primary outline new-course-button" onClick={onNewCourse}>
            New course
          </button>
        )}

        {searching && (
          <>
            <h2 className="menu-heading">On the map ({nodeHits.length === 30 ? '30+' : nodeHits.length})</h2>
            {nodeHits.length === 0 && <p className="note">{query.trim().length < 2 ? 'Type two letters or more.' : 'Nothing on the map matches.'}</p>}
            <ul className="menu-list">
              {nodeHits.map(({ node, topic }) => (
                <li key={node.id}>
                  <button className={`inside-row b${node.branch}`} onClick={() => onShowNode(node.id)}>
                    <span className="dot" />
                    <span className="inside-name">
                      {node.node.name}
                      <span className="hit-where">{topic ? `Topic: ${topic}` : where(node)}</span>
                    </span>
                    <span className="inside-count">{node.node.code ? shortCode(node.node.code) : ''}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}
