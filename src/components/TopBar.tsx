import { useEffect, useRef } from 'react'
import type { Placed } from '../map/layout.ts'
import type { Theme } from '../theme.ts'

interface Props {
  /** Root first, the focused node last. */
  path: Placed[]
  theme: Theme
  onSelect: (id: string) => void
  onToggleTheme: () => void
  onOpenCourses: () => void
  /** Items due for review today; the badge shows only above zero. */
  dueCount?: number
  /** Omitted where review is not offered (the button is then not drawn). */
  onOpenReview?: () => void
}

const HomeIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
    <circle cx="9" cy="13.5" r="3.2" fill="currentColor" />
    <circle cx="15.5" cy="9.5" r="2" fill="currentColor" />
  </svg>
)

const CoursesIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
    <circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" strokeWidth="2" />
    <path d="M15 15l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
)

const ReviewIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
    <path d="M19 8a7.5 7.5 0 0 0-13-2M5 16a7.5 7.5 0 0 0 13 2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <path d="M19.5 3v5h-5M4.5 21v-5h5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const ThemeIcon = ({ theme }: { theme: Theme }) => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
    {theme === 'dark' ? (
      <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" fill="currentColor" />
    ) : (
      <>
        <circle cx="12" cy="12" r="4.5" fill="currentColor" />
        <path
          d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </>
    )}
  </svg>
)

/** Home, the trail from Mathematics down to where you are, courses and search, and the theme switch. */
export function TopBar({ path, theme, onSelect, onToggleTheme, onOpenCourses, dueCount = 0, onOpenReview }: Props) {
  const trail = useRef<HTMLOListElement>(null)
  const current = path[path.length - 1]

  // The trail scrolls sideways when it is long; keep its end, where you are, in view.
  useEffect(() => {
    const element = trail.current
    if (element) element.scrollLeft = element.scrollWidth
  }, [current.id])

  return (
    <header className="top-bar">
      <button className="icon-button" onClick={() => onSelect(path[0].id)} aria-label="Home: the whole map">
        <HomeIcon />
      </button>
      <nav aria-label="Where you are" className="trail-wrap">
        <ol className="trail" ref={trail}>
          {path.map((node, i) => (
            <li key={node.id}>
              {i === path.length - 1 ? (
                <span className="crumb here" aria-current="location">
                  {node.node.name}
                </span>
              ) : (
                <button className="crumb" onClick={() => onSelect(node.id)}>
                  {node.node.name}
                </button>
              )}
            </li>
          ))}
        </ol>
      </nav>
      <button className="icon-button" onClick={onOpenCourses} aria-label="Courses and search">
        <CoursesIcon />
      </button>
      {onOpenReview && (
        <button
          className="icon-button review-button"
          onClick={onOpenReview}
          aria-label={dueCount > 0 ? `Review, ${dueCount} due` : 'Review'}
        >
          <ReviewIcon />
          {dueCount > 0 && (
            <span className="review-badge" aria-hidden="true">
              {dueCount > 99 ? '99+' : dueCount}
            </span>
          )}
        </button>
      )}
      <button
        className="icon-button"
        onClick={onToggleTheme}
        aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      >
        <ThemeIcon theme={theme} />
      </button>
    </header>
  )
}
