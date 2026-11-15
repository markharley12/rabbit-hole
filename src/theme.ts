// Light and dark. The system's setting is used until the switch is pressed;
// after that the choice is remembered on this device.

export type Theme = 'light' | 'dark'

// Prefixed: localStorage is shared by everything on an origin (a TreeQuiz trap).
const KEY = 'rabbit-hole:theme'

const BACKGROUND: Record<Theme, string> = { light: '#f6f3ec', dark: '#14161a' }

export function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    // Storage can be blocked (private mode); fall through to the system's.
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', BACKGROUND[theme])
}

export function saveTheme(theme: Theme) {
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    // Not remembered, but the switch still works for this visit.
  }
}
