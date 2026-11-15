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
import { parseRoute } from './route.ts'
import { countCourses } from './courses.ts'
import { CoursesMenu } from './components/CoursesMenu.tsx'
import { UpdateBar } from './components/UpdateBar.tsx'

// The lesson screens, KaTeX and the widgets load only when a lesson opens.
const LessonView = lazy(() => import('./lesson/LessonView.tsx'))

const MAP_URL = './content/maths/map.json'
// Written by tools/validate_courses.py --publish, only from content that passed.
const COURSES_URL = './content/maths/courses/'

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


type Loaded = { state: 'loading' } | { state: 'failed'; reason: string } | { state: 'ready'; document: MapDocument }

export default function App() {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  const [theme, setTheme] = useState<Theme>(initialTheme)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [refit, setRefit] = useState(0)
  const [courses, setCourses] = useState<Map<string, Course>>(new Map())
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
    fetch(`${COURSES_URL}index.json`)
      .then((response) => (response.ok ? (response.json() as Promise<CourseIndex>) : { format: 1 as const, courses: [] }))
      .then((index) => live && setCourses(new Map(index.courses.map((course) => [course.nodeId, course]))))
      .catch((error: unknown) => console.warn('No course index; the map shows no courses.', error))
    return () => {
      live = false
    }
  }, [])

  const document = loaded.state === 'ready' ? loaded.document : null
  const layout = useMemo(() => (document ? layoutMap(document.root) : null), [document])
  const counts = useMemo(() => (layout ? countCourses(layout, courses) : new Map<string, number>()), [layout, courses])
  const courseList = useMemo(() => [...courses.values()], [courses])
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
  const course = courses.get(focus.id)
  const lessonOpen = !!(course && route.lessonId && course.lessons.some((l) => l.id === route.lessonId))
  const menuOpen = !!route.menu

  const select = (id: string) => {
    setSheetOpen(false)
    // Selecting what is already focused re-centres on it.
    if (id === focus.id) setRefit((n) => n + 1)
    else window.location.hash = id
  }
  const openLesson = (lessonId: string) => {
    setSheetOpen(false)
    openedHere.current = true
    window.location.hash = `${focus.id}/learn/${lessonId}`
  }
  const openMenu = () => {
    setSheetOpen(false)
    openedHere.current = true
    window.location.hash = `${focus.id}/courses`
  }
  // From the menu, replace its address: Back from what it opens returns to
  // where the menu was opened, not to the menu.
  const menuToLesson = (target: { nodeId: string }, lessonId: string) => window.location.replace(`#${target.nodeId}/learn/${lessonId}`)
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
  const nextLesson = (lessonId: string) => window.location.replace(`#${focus.id}/learn/${lessonId}`)

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    saveTheme(next)
    setTheme(next)
  }

  return (
    <>
      <MapView layout={layout} focusId={focus.id} refit={refit} screen={screen} area={area} courseIds={courses} onSelect={select} />
      {menuOpen ? (
        <CoursesMenu layout={layout} courses={courseList} onClose={closeLesson} onOpenLesson={menuToLesson} onShowNode={menuToNode} />
      ) : lessonOpen && course ? (
        <Suspense fallback={<p className="status lesson-loading">Opening the lesson…</p>}>
          <LessonView course={course} lessonId={route.lessonId!} base={`${COURSES_URL}${course.nodeId}/`} onClose={closeLesson} onOpenLesson={nextLesson} />
        </Suspense>
      ) : (
        <>
          <TopBar path={ancestry(focus)} theme={theme} onSelect={select} onToggleTheme={toggleTheme} onOpenCourses={openMenu} />
          <NodeSheet
            node={focus}
            document={document}
            course={course}
            counts={counts}
            open={sheetOpen}
            onOpenChange={setSheetOpen}
            onSelect={select}
            onOpenLesson={openLesson}
            onOpenCourses={openMenu}
          />
        </>
      )}
      <UpdateBar />
    </>
  )
}
