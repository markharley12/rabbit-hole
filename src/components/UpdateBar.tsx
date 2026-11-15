import { useState, useSyncExternalStore } from 'react'
import { applyUpdate, subscribeUpdate, updateWaiting } from '../pwa-update.ts'

/** "A new version is ready", with one button to switch to it now. */
export function UpdateBar() {
  const ready = useSyncExternalStore(subscribeUpdate, updateWaiting)
  const [later, setLater] = useState(false)
  const [updating, setUpdating] = useState(false)
  if (!ready || later) return null
  return (
    <div className="update-bar" role="status">
      <span className="update-text">{updating ? 'Updating…' : 'A new version is ready.'}</span>
      <button
        className="update-now"
        disabled={updating}
        onClick={() => {
          setUpdating(true)
          applyUpdate()
        }}
      >
        Update
      </button>
      <button className="icon-button small" onClick={() => setLater(true)} aria-label="Not now">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  )
}
