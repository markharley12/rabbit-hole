import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './styles.css'
import { watchForUpdates } from './pwa-update.ts'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Offline and "Add to Home Screen". Built pages only: the dev server has no
// sw.js, and a worker caching dev modules would serve stale code.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .then((registration) =>
        watchForUpdates({
          container: navigator.serviceWorker,
          registration,
          reload: () => window.location.reload(),
          onVisible: (check) =>
            document.addEventListener('visibilitychange', () => {
              if (document.visibilityState === 'visible') check()
            }),
        }),
      )
      .catch((error: unknown) => {
        console.warn('Service worker not registered; the app will need a connection.', error)
      })
  })
}
