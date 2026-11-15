import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { CloseIcon } from './icons.tsx'

/**
 * One tool in the dock. Later stages (cheat sheet, reading links) add an entry
 * to the list the lesson passes in; the dock itself does not change.
 *
 *   id      stable name, used for keys and the `data-tool` attribute
 *   label   shown as the overlay's title and read out as the button's name
 *   icon    the round button's picture (an inline SVG in currentColor)
 *   render  the overlay's content; `close` shuts the overlay from inside
 */
export interface Tool {
  id: string
  label: string
  icon: ReactNode
  render: (close: () => void) => ReactNode
}

interface Props {
  tools: Tool[]
}

/** The tool's own content, rendered apart from the dock so `close` reaches it as a plain prop. */
function ToolBody({ tool, close }: { tool: Tool; close: () => void }) {
  return <>{tool.render(close)}</>
}

/**
 * Round buttons at the right edge, just above the lesson's action footer
 * (the dock's anchor sits between the body and the footer, so it follows the
 * footer's height whatever it holds). A button opens its tool as an overlay
 * over the lesson. The lesson is never unmounted, so what he had typed, the
 * hints shown and the scroll position are all as he left them.
 *
 * Closing: the close button, Escape, a tap outside the panel, or the phone's
 * back button. Opening pushes one history entry with the same URL; popstate
 * (back) closes the tool, and the app's hash routing, which listens to
 * hashchange only, never sees it.
 */
export function ToolDock({ tools }: Props) {
  const [openId, setOpenId] = useState<string | null>(null)
  const opener = useRef<HTMLButtonElement | null>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  // Whether the open overlay owns a history entry, and how many popstates we caused ourselves.
  const pushed = useRef(false)
  const expected = useRef(0)
  const open = tools.find((tool) => tool.id === openId) ?? null

  const close = useCallback(() => {
    setOpenId(null)
    if (pushed.current) {
      pushed.current = false
      expected.current += 1
      window.history.back()
    }
  }, [])

  useEffect(() => {
    const onPop = () => {
      if (expected.current > 0) {
        expected.current -= 1
        return
      }
      // The phone's back button: the entry is already gone, so only close.
      pushed.current = false
      setOpenId(null)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  // Focus moves into the overlay, and back to the button that opened it.
  useEffect(() => {
    if (!open) return
    const button = opener.current
    closeButton.current?.focus()
    return () => button?.focus()
  }, [open])

  const show = (tool: Tool, button: HTMLButtonElement) => {
    opener.current = button
    if (!pushed.current) {
      window.history.pushState({ tool: tool.id }, '')
      pushed.current = true
    }
    setOpenId(tool.id)
  }

  return (
    <div className="tool-anchor">
      <div className="tool-dock" role="group" aria-label="Tools">
        {tools.map((tool) => (
          <button
            key={tool.id}
            type="button"
            className="tool-round"
            data-tool={tool.id}
            aria-label={tool.label}
            aria-haspopup="dialog"
            onClick={(event) => show(tool, event.currentTarget)}
          >
            {tool.icon}
          </button>
        ))}
      </div>
      {open && (
        <div className="tool-layer">
          <div className="tool-backdrop" onClick={close} aria-hidden="true" />
          <section className="tool-panel" role="dialog" aria-modal="true" aria-label={open.label} data-tool={open.id}>
            <header className="tool-head">
              <h2 className="tool-title">{open.label}</h2>
              <button ref={closeButton} type="button" className="icon-button" aria-label={`Close ${open.label.toLowerCase()}`} onClick={close}>
                <CloseIcon />
              </button>
            </header>
            <div className="tool-content"><ToolBody tool={open} close={close} /></div>
          </section>
        </div>
      )}
    </div>
  )
}
