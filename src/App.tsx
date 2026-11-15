import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { MapView } from './map/MapView.tsx'
import { ancestry, layoutMap } from './map/layout.ts'
import type { Rect } from './map/layout.ts'
import type { MapDocument } from './map/types.ts'
import { NodeSheet } from './components/NodeSheet.tsx'
import { TopBar } from './components/TopBar.tsx'
import { applyTheme, initialTheme, saveTheme } from './theme.ts'
import type { Theme } from './theme.ts'

const MAP_URL = './content/maths/map.json'

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

  const document = loaded.state === 'ready' ? loaded.document : null
  const layout = useMemo(() => (document ? layoutMap(document.root) : null), [document])
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

  const focus = layout.byId.get(hash) ?? layout.root

  const select = (id: string) => {
    setSheetOpen(false)
    // Selecting what is already focused re-centres on it.
    if (id === focus.id) setRefit((n) => n + 1)
    else window.location.hash = id
  }
  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    saveTheme(next)
    setTheme(next)
  }

  return (
    <>
      <MapView layout={layout} focusId={focus.id} refit={refit} screen={screen} area={area} onSelect={select} />
      <TopBar path={ancestry(focus)} theme={theme} onSelect={select} onToggleTheme={toggleTheme} />
      <NodeSheet node={focus} document={document} open={sheetOpen} onOpenChange={setSheetOpen} onSelect={select} />
    </>
  )
}
