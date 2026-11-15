import { useState, useSyncExternalStore } from 'react'
import { useResourceFiles } from '../resource-store.ts'
import { formatChecked, latestChecked, readingGroups } from '../resources.ts'
import type { ReadingNode, Resource } from '../resources.ts'

interface Props {
  /** The nodes to read for, nearest first (see readingNodes). */
  nodes: ReadingNode[]
  /** Where the reading files are served, ending in a slash. */
  base: string
}

const subscribeOnline = (changed: () => void) => {
  window.addEventListener('online', changed)
  window.addEventListener('offline', changed)
  return () => {
    window.removeEventListener('online', changed)
    window.removeEventListener('offline', changed)
  }
}
const readOnline = () => navigator.onLine

// Mark is overwhelmed by long lists: a node shows its first few links, the rest on request.
const FIRST = 4

function ReadingGroup({ resources }: { resources: Resource[] }) {
  const [all, setAll] = useState(false)
  const shown = all ? resources : resources.slice(0, FIRST)
  return (
    <>
      <ul className="reading-list">
        {shown.map((resource) => (
          <ReadingRow key={resource.id} resource={resource} />
        ))}
      </ul>
      {shown.length < resources.length && (
        <button className="text-button" onClick={() => setAll(true)}>
          Show {resources.length - shown.length} more
        </button>
      )}
    </>
  )
}

/** One link: the title is the link, with who made it, what kind, and when to reach for it. */
function ReadingRow({ resource }: { resource: Resource }) {
  return (
    <li className="reading-row">
      <p className="reading-title">
        <a href={resource.url} target="_blank" rel="noopener noreferrer">
          {resource.title}
        </a>
      </p>
      <p className="reading-meta">
        {resource.by} <span className="reading-kind">{resource.kind}</span> <span className="reading-cost">{resource.free ? 'free' : 'paid'}</span>
      </p>
      <p className="reading-use">{resource.use}</p>
    </li>
  )
}

/**
 * The reading for a place on the map: its own links and those of the nodes above
 * it. Shared by the lesson's Reading tool and the node sheet. Grouped by the node
 * a link came from only when more than one node has some.
 */
export function ReadingList({ nodes, base }: Props) {
  const { files, loading, failed } = useResourceFiles(base, nodes)
  const online = useSyncExternalStore(subscribeOnline, readOnline)
  const groups = readingGroups(nodes, files)
  const checked = latestChecked(groups)

  return (
    <div className="reading">
      {!online && <p className="note reading-offline">You are offline; these open when you are back online.</p>}
      {loading && <p className="status-inline">Loading the reading list…</p>}
      {failed && (
        <p className="status-inline" role="alert">
          {groups.length ? 'Some of the reading list' : 'The reading list'} could not be loaded ({failed}).
        </p>
      )}
      {groups.map((group) => (
        <section key={group.from.id} aria-label={groups.length > 1 ? `Reading from ${group.from.name}` : undefined}>
          {groups.length > 1 && <h3 className="reading-from">{group.from.name}</h3>}
          <ReadingGroup resources={group.resources} />
        </section>
      ))}
      {checked && <p className="note small">Links were checked on {formatChecked(checked)}.</p>}
    </div>
  )
}
