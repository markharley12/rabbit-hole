// Small inline icons for the dock and the scratch pad's bar. Drawn on a 24px
// grid in currentColor, so they follow the theme.

import type { ReactNode } from 'react'

function Icon({ children, size = 22 }: { children: ReactNode; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}

export const PenIcon = () => (
  <Icon>
    <path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19z" />
    <path d="M14.5 6.5l3 3" />
  </Icon>
)

export const EraserIcon = () => (
  <Icon>
    <path d="M9 19h11" />
    <path d="M5.5 15.5l9-9a2 2 0 0 1 2.8 0l1.7 1.7a2 2 0 0 1 0 2.8L11.5 18H8z" />
  </Icon>
)

export const UndoIcon = () => (
  <Icon>
    <path d="M9 14L4 9l5-5" />
    <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
  </Icon>
)

export const RedoIcon = () => (
  <Icon>
    <path d="M15 14l5-5-5-5" />
    <path d="M20 9H10a6 6 0 0 0 0 12h3" />
  </Icon>
)

export const TrashIcon = () => (
  <Icon>
    <path d="M4 7h16M10 11v6M14 11v6" />
    <path d="M6 7l1 13h10l1-13M9 7V4h6v3" />
  </Icon>
)

export const FitIcon = () => (
  <Icon>
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
  </Icon>
)

export const CloseIcon = () => (
  <Icon>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
)

export const PadIcon = () => (
  <Icon>
    <rect x="4" y="3" width="16" height="18" rx="2" />
    <path d="M8 15c2-4 3 1 5-3s2 1 3-1" />
  </Icon>
)

export const CalculatorIcon = () => (
  <Icon>
    <rect x="5" y="3" width="14" height="18" rx="2" />
    <path d="M8 7h8M8 12h2M14 12h2M8 16h2M14 16h2" />
  </Icon>
)

export const SheetIcon = () => (
  <Icon>
    <path d="M6 3h9l4 4v14H6z" />
    <path d="M14 3v5h5" />
    <path d="M9 13h7M9 17h5" />
  </Icon>
)

export const AskIcon = () => (
  <Icon>
    <path d="M4 5h16v11H10l-4 4v-4H4z" />
    <path d="M10 9.5a2 2 0 1 1 2.8 1.8c-.5.3-.8.7-.8 1.2" />
    <path d="M12 14.5h.01" />
  </Icon>
)

export const BookIcon = () => (
  <Icon>
    <path d="M4 5a2 2 0 0 1 2-2h13v15H6a2 2 0 0 0-2 2z" />
    <path d="M4 20a2 2 0 0 0 2 2h13v-4" />
    <path d="M9 8h6" />
  </Icon>
)

export const SoFarIcon = () => (
  <Icon>
    <path d="M3 5h12M3 12h8M3 19h10" />
    <path d="M15 16l2.5 2.5L22 13" />
  </Icon>
)
