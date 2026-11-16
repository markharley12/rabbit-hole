import { useMemo } from 'react'
import { useAllProgress } from '../lesson/progress-store.ts'
import type { Course } from '../lesson/types.ts'
import type { ReviewItem } from '../review/queue.ts'
import { dueItems } from '../review/schedule.ts'
import { ago, countsText, nextAction, repeatedSlips, reviewText, startedCourses } from '../where-i-am.ts'

interface Props {
  courses: Course[]
  /** Every review item earned so far (the same list the top bar's count comes from). */
  reviewItems: ReviewItem[]
  onClose: () => void
  onOpenLesson: (course: Course, lessonId: string) => void
  onOpenReview: () => void
  onOpenCourses: () => void
}

/**
 * The note Mark used to write by hand: what he has done, where he stopped, what is next, from what
 * the device already keeps. One main button; counts, never scores. Full screen like the Courses menu.
 */
export function WhereIAm({ courses, reviewItems, onClose, onOpenLesson, onOpenReview, onOpenCourses }: Props) {
  const records = useAllProgress(courses)
  const now = new Date()
  const started = useMemo(() => startedCourses(courses, records), [courses, records])
  const due = dueItems(reviewItems, now).length
  const action = nextAction(courses, records, due)
  const slips = repeatedSlips(records.values())

  return (
    <div className="lesson menu" role="dialog" aria-label="Where I am">
      <header className="lesson-bar">
        <button className="icon-button" onClick={onClose} aria-label="Close where I am">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
        <div className="lesson-heading">
          <p className="lesson-title">Where I am</p>
        </div>
        <span className="icon-spacer" />
      </header>
      <div className="lesson-body">
        {started.length === 0 ? (
          <>
            <p className="prompt">You have not started a course yet. Pick one from the Courses menu and this page fills in as you go.</p>
            <button className="primary" onClick={onOpenCourses}>
              Open the Courses menu
            </button>
          </>
        ) : (
          <>
            {action.kind === 'review' ? (
              <button className="primary" onClick={onOpenReview}>
                Review ({action.due} due)
              </button>
            ) : action.kind === 'lesson' ? (
              <button className="primary" onClick={() => onOpenLesson(action.course, action.lessonId)}>
                {action.verb}: {action.title}
              </button>
            ) : (
              <p className="prompt">Everything here is done.</p>
            )}

            <h2 className="menu-heading">Courses</h2>
            <ul className="menu-list">
              {started.map((s) => {
                const total = s.course.lessons.length
                const last = ago(s.lastAt, now)
                return (
                  <li key={s.course.id} className="course-card where-card">
                    <p className="course-card-title">{s.course.title}</p>
                    <p className="course-card-meta">
                      {s.finished
                        ? `All ${total} lessons done`
                        : s.screen
                          ? `Lesson ${s.lessonNumber} of ${total}: ${s.lessonTitle}, screen ${s.screen}`
                          : `Lesson ${s.lessonNumber} of ${total} is next: ${s.lessonTitle}`}
                    </p>
                    {last && <p className="course-card-meta">Last here {last}</p>}
                    <p className="course-card-meta">{countsText(s.solved, s.shown)}</p>
                  </li>
                )
              })}
            </ul>

            {slips.length > 0 && (
              <>
                <h2 className="menu-heading">Slips to watch</h2>
                <ul className="where-slips">
                  {slips.map((slip) => (
                    <li key={slip.name}>
                      {slip.name}: {slip.count} times
                    </li>
                  ))}
                </ul>
              </>
            )}

            <h2 className="menu-heading">Review</h2>
            <p className="note">{reviewText(reviewItems, now)}</p>
          </>
        )}
      </div>
    </div>
  )
}
