import { lazy, Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { MapView } from './map/MapView.tsx'
import { ancestry, layoutMap } from './map/layout.ts'
import type { Rect } from './map/layout.ts'
import type { MapDocument } from './map/types.ts'
import { NodeSheet } from './components/NodeSheet.tsx'
import { TopBar } from './components/TopBar.tsx'
import { applyTheme, initialTheme, saveTheme } from './theme.ts'
import type { Theme } from './theme.ts'
import type { Course, CourseIndex } from './lesson/types.ts'
import { lessonHash, parseRoute, resolveLesson } from './route.ts'
import { countCourses, groupByNode, tunnelsOf } from './courses.ts'
import { nextUp } from './lesson/progress.ts'
import { readProgress } from './lesson/progress-store.ts'
import { CoursesMenu } from './components/CoursesMenu.tsx'
import { WhereIAm } from './components/WhereIAm.tsx'
import { UpdateBar } from './components/UpdateBar.tsx'
import { parseIndex } from './resources.ts'
import type { ReadingSource } from './resources.ts'
import { useReviewQueue } from './review/use-review-queue.ts'
import { useServerOffers } from './ai/server-offers.ts'

// The lesson screens, KaTeX and the widgets load only when a lesson opens.
const LessonView = lazy(() => import('./lesson/LessonView.tsx'))
// Review shows lessons' steps, so it needs KaTeX too.
const ReviewView = lazy(() => import('./review/ReviewView.tsx'))
// Making a course by talking to the server on the PC: the chat and KaTeX.
const NewCourse = lazy(() => import('./ai/NewCourse.tsx'))

const MAP_URL = './content/maths/map.json'
// Written by tools/validate_courses.py --publish, only from content that passed.
const COURSES_URL = './content/maths/courses/'
// The same for reading links: one file per node, and an index of how many each has.
const RESOURCES_URL = './content/maths/resources/'

// Heights the map must keep clear of, in CSS pixels. They match styles.css
// (--bar and --peek); the map only uses them to centre things, so a few
// pixels of safe-area inset either way does not matter.
const BAR = 56
const PEEK = 150

const subscribeHash = (changed: () => void) => {
  window.addEventListener('hashchange', changed)
  return () => window.removeEventListener('hashchange', changed)
}
const readHash = () => decodeURIComponent(window.location.hash.slice(1))

const subscribeResize = (changed: () => void) => {
  window.addEventListener('resize', changed)
  return () => window.removeEventListener('resize', changed)
}
// One string, so the snapshot is stable between resizes.
const readSize = () => `${window.innerWidth}x${window.innerHeight}`


/**
 * The published course index. `no-cache` asks the network first (the service
 * worker also fetches the content indexes network-first), so a course the
 * server has just built and published appears without a new app build.
 */
async function loadCourseIndex(): Promise<Course[]> {
  const response = await fetch(`${COURSES_URL}index.json`, { cache: 'no-cache' })
  if (!response.ok) return []
  const index = (await response.json()) as CourseIndex
  return Array.isArray(index.courses) ? index.courses : []
}

type Loaded = { state: 'loading' } | { state: 'failed'; reason: string } | { state: 'ready'; document: MapDocument }

export default function App() {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  const [theme, setTheme] = useState<Theme>(initialTheme)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [refit, setRefit] = useState(0)
  const [courseList, setCourseList] = useState<Course[]>([])
  const [readingCounts, setReadingCounts] = useState<Record<string, number>>({})
  // Whether the open lesson was opened from the map in this page, so closing
  // it can step back through history instead of piling up entries.
  const openedHere = useRef(false)
  // The focused node is the URL's hash, so the phone's back button steps back
  // out of the rabbit hole and a link opens at a node.
  const hash = useSyncExternalStore(subscribeHash, readHash)
  const size = useSyncExternalStore(subscribeResize, readSize)

  useEffect(() => applyTheme(theme), [theme])

  useEffect(() => {
    let live = true
    fetch(MAP_URL)
      .then((response) => {
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
        return response.json() as Promise<MapDocument>
      })
      .then((document) => live && setLoaded({ state: 'ready', document }))
      .catch((error: unknown) => live && setLoaded({ state: 'failed', reason: error instanceof Error ? error.message : String(error) }))
    return () => {
      live = false
    }
  }, [])

  // Courses are an extra: if the index is missing, the map still works.
  useEffect(() => {
    let live = true
    loadCourseIndex()
      .then((courses) => live && setCourseList(courses))
      .catch((error: unknown) => console.warn('No course index; the map shows no courses.', error))
    return () => {
      live = false
    }
  }, [])

  // Reading is an extra too: a missing index means no Reading anywhere. A node's own file is
  // fetched only when something shows it.
  useEffect(() => {
    let live = true
    fetch(`${RESOURCES_URL}index.json`)
      .then((response) => (response.ok ? response.json() : null))
      .then((index: unknown) => live && setReadingCounts(parseIndex(index)))
      .catch((error: unknown) => console.warn('No reading index; no reading links.', error))
    return () => {
      live = false
    }
  }, [])

  // The new-course entries show only when the server offers that kind; checked
  // at start and again on every change of address (opening the menu, a node).
  const canMakeCourses = useServerOffers('new-course', hash)

  const document = loaded.state === 'ready' ? loaded.document : null
  const layout = useMemo(() => (document ? layoutMap(document.root) : null), [document])
  const courses = useMemo(() => groupByNode(courseList), [courseList])
  const reading = useMemo<ReadingSource | undefined>(
    () => (layout ? { layout, counts: readingCounts, base: RESOURCES_URL } : undefined),
    [layout, readingCounts],
  )
  const counts = useMemo(() => (layout ? countCourses(layout, courses) : new Map<string, number>()), [layout, courses])
  const review = useReviewQueue(courseList, COURSES_URL)
  const screen = useMemo(() => {
    const [width, height] = size.split('x').map(Number)
    return { width, height }
  }, [size])
  const area = useMemo<Rect>(
    () => ({ left: 0, top: BAR, width: screen.width, height: Math.max(120, screen.height - BAR - PEEK) }),
    [screen],
  )

  if (loaded.state === 'loading') return <p className="status">Loading the map…</p>
  if (!document || !layout) {
    return (
      <p className="status" role="alert">
        The map could not be loaded ({loaded.state === 'failed' ? loaded.reason : 'unknown error'}). Check the connection and reload.
      </p>
    )
  }

  const route = parseRoute(hash)
  const focus = layout.byId.get(route.nodeId) ?? layout.root
  const onNode = courses.get(focus.id) ?? []
  const opened = resolveLesson(route, onNode)
  const menuOpen = !!route.menu
  const reviewOpen = !!route.review
  const newCourseOpen = !!route.newCourse
  const progressOpen = !!route.progress

  const select = (id: string) => {
    setSheetOpen(false)
    // Selecting what is already focused re-centres on it.
    if (id === focus.id) setRefit((n) => n + 1)
    else window.location.hash = id
  }
  const openLesson = (course: Course, lessonId: string) => {
    setSheetOpen(false)
    openedHere.current = true
    window.location.hash = lessonHash(course, lessonId)
  }
  const openMenu = () => {
    setSheetOpen(false)
    openedHere.current = true
    window.location.hash = `${focus.id}/courses`
  }
  const openReview = () => {
    setSheetOpen(false)
    openedHere.current = true
    window.location.hash = `${focus.id}/review`
  }
  // From the menu, replace its address: Back from what it opens returns to
  // where the menu was opened, not to the menu.
  const menuToLesson = (course: Course, lessonId: string) => window.location.replace(`#${lessonHash(course, lessonId)}`)
  const menuToReview = () => window.location.replace(`#${focus.id}/review`)
  const menuToProgress = () => window.location.replace(`#${focus.id}/progress`)
  const progressToMenu = () => window.location.replace(`#${focus.id}/courses`)
  const openNewCourse = () => {
    setSheetOpen(false)
    openedHere.current = true
    window.location.hash = `${focus.id}/new-course`
  }
  const menuToNewCourse = () => window.location.replace(`#${focus.id}/new-course`)
  // A course just built: read the index again (the server has republished it), then open it.
  const openBuiltCourse = async (courseId: string) => {
    let fresh: Course[]
    try {
      fresh = await loadCourseIndex()
    } catch {
      return false
    }
    setCourseList(fresh)
    const course = fresh.find((c) => c.id === courseId)
    if (!course) return false
    window.location.replace(`#${lessonHash(course, course.lessons[0].id)}`)
    return true
  }
  const menuToNode = (id: string) => {
    openedHere.current = false
    window.location.replace(`#${id}`)
  }
  const closeLesson = () => {
    if (openedHere.current) {
      openedHere.current = false
      window.history.back()
    } else {
      window.location.hash = focus.id
    }
  }
  // Lesson to lesson replaces the address, so Back still goes to the map.
  const nextLesson = (course: Course, lessonId: string) => window.location.replace(`#${lessonHash(course, lessonId)}`)

  // A tunnel line on the sheet: go to that course's own node and open the sheet there.
  const showCourse = (course: Course) => {
    setSheetOpen(true)
    if (course.nodeId === focus.id) setRefit((n) => n + 1)
    else window.location.hash = course.nodeId
  }
  // "Next course" at the end of a course: its next lesson, replacing the address like lesson to lesson.
  const openCourse = (course: Course) => {
    const target = nextUp(course, readProgress(course.id))?.lessonId ?? course.lessons[0].id
    window.location.replace(`#${lessonHash(course, target)}`)
  }

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    saveTheme(next)
    setTheme(next)
  }

  return (
    <>
      <MapView layout={layout} focusId={focus.id} refit={refit} screen={screen} area={area} courseIds={courses} onSelect={select} />
      {newCourseOpen ? (
        <Suspense fallback={<p className="status lesson-loading">Opening…</p>}>
          <NewCourse node={focus.parent ? { id: focus.id, name: focus.node.name } : null} onClose={closeLesson} onOpenCourse={openBuiltCourse} />
        </Suspense>
      ) : reviewOpen ? (
        review.ready ? (
          <Suspense fallback={<p className="status lesson-loading">Opening review…</p>}>
            <ReviewView items={review.items} base={COURSES_URL} unavailable={review.unavailable} onClose={closeLesson} />
          </Suspense>
        ) : (
          <p className="status lesson-loading">Opening review…</p>
        )
      ) : progressOpen ? (
        <WhereIAm
          courses={courseList}
          reviewItems={review.items}
          onClose={closeLesson}
          onOpenLesson={menuToLesson}
          onOpenReview={menuToReview}
          onOpenCourses={progressToMenu}
        />
      ) : menuOpen ? (
        <CoursesMenu
          layout={layout}
          courses={courseList}
          onClose={closeLesson}
          onOpenLesson={menuToLesson}
          onShowNode={menuToNode}
          dueCount={review.due}
          onOpenReview={menuToReview}
          onOpenProgress={menuToProgress}
          onNewCourse={canMakeCourses ? menuToNewCourse : undefined}
        />
      ) : opened ? (
        <Suspense fallback={<p className="status lesson-loading">Opening the lesson…</p>}>
          <LessonView
            course={opened.course}
            lessonId={opened.lessonId}
            base={`${COURSES_URL}${opened.course.id}/`}
            onClose={closeLesson}
            onOpenLesson={(lessonId) => nextLesson(opened.course, lessonId)}
            reading={reading}
            leadsTo={tunnelsOf(opened.course, courseList).leadsTo.map((link) => link.course)}
            onOpenCourse={openCourse}
          />
        </Suspense>
      ) : (
        <>
          <TopBar
            path={ancestry(focus)}
            theme={theme}
            onSelect={select}
            onToggleTheme={toggleTheme}
            onOpenCourses={openMenu}
            dueCount={review.due}
            onOpenReview={openReview}
          />
          <NodeSheet
            node={focus}
            document={document}
            courses={onNode}
            counts={counts}
            open={sheetOpen}
            onOpenChange={setSheetOpen}
            onSelect={select}
            onOpenLesson={openLesson}
            onOpenCourses={openMenu}
            reading={reading}
            dueCount={review.due}
            onOpenReview={openReview}
            allCourses={courseList}
            onShowCourse={showCourse}
            onMakeCourse={canMakeCourses ? openNewCourse : undefined}
          />
        </>
      )}
      <UpdateBar />
    </>
  )
}
