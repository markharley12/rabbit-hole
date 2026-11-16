// Making a new course by talking to the app (docs/ai-sessions.md section 5 and
// 10). Three screens over the map, at #<node>/new-course:
//
// 1. the entry: one sentence and the box, with any unfinished draft or
//    running build listed first ("Continue: <title>");
// 2. the talk: a chat with a new-course session; once the session has
//    written a brief, a card under the chat shows it with Build this and
//    Keep talking (or, if the server found problems in it, the problems and
//    Keep talking only);
// 3. the build: its state and log lines, polled every few seconds, and Stop;
//    at the end "Your course is ready" or what went wrong and Keep talking.
//
// Drafts and builds live on the server, so closing the app loses nothing:
// the entry screen finds them again. Loaded lazily (it carries KaTeX).

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { ChatStore } from './chat-store.ts'
import type { ChatTarget } from './chat-store.ts'
import { ChatInput, MessageList } from './ChatParts.tsx'
import { BUILD_ACTIVE, buildStateText, createCourseClient } from './course-client.ts'
import type { Build, Draft, NewCourseClient } from './course-client.ts'

const defaultClient = createCourseClient()

export const POLL_MS = 3000
const FAILED = 'The server could not be reached, or the reply broke off. Nothing is lost; try again.'
const UNREACHABLE = 'The course maker runs on the server on the PC, and it cannot be reached now. The rest of the app works without it.'

interface Props {
  /** The node the map was on, as a suggestion for the session; null on the whole map. */
  node: { id: string; name: string } | null
  onClose: () => void
  /** Reloads the course index and opens the course; false if it is not in the index. */
  onOpenCourse: (courseId: string) => Promise<boolean>
  client?: NewCourseClient
}

type View =
  | { kind: 'entry' }
  | { kind: 'chat'; key: string; draftId: string | null; sessionId: string | null; first?: string }
  | { kind: 'build'; buildId: string; draftId: string }

let nextKey = 1

export default function NewCourse({ node, onClose, onOpenCourse, client = defaultClient }: Props) {
  const [store] = useState(() => new ChatStore(client))
  const [view, setView] = useState<View>({ kind: 'entry' })
  useEffect(() => () => store.dispose(), [store])

  const openDraft = useCallback((draft: Draft) => {
    if (draft.state === 'building' && draft.build) setView({ kind: 'build', buildId: draft.build.id, draftId: draft.id })
    else setView({ kind: 'chat', key: `new-course:${draft.id}`, draftId: draft.id, sessionId: draft.sessionId })
  }, [])

  return (
    <div className="lesson menu new-course" role="dialog" aria-label="New course">
      <header className="lesson-bar">
        <button className="icon-button" onClick={onClose} aria-label="Close new course">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
        <div className="lesson-heading">
          <p className="lesson-title">New course</p>
          <p className="lesson-sub">{view.kind === 'build' ? 'The build' : node ? `From ${node.name}` : 'From the whole map'}</p>
        </div>
        <span className="icon-spacer" />
      </header>
      {view.kind === 'entry' && (
        <Entry
          client={client}
          onContinue={openDraft}
          onStart={(text) => setView({ kind: 'chat', key: `new-course:fresh-${nextKey++}`, draftId: null, sessionId: null, first: text })}
        />
      )}
      {view.kind === 'chat' && (
        <Talk
          key={view.key}
          client={client}
          store={store}
          node={node}
          view={view}
          onBuild={(buildId, draftId) => setView({ kind: 'build', buildId, draftId })}
        />
      )}
      {view.kind === 'build' && (
        <Progress
          key={view.buildId}
          client={client}
          buildId={view.buildId}
          onOpenCourse={onOpenCourse}
          onKeepTalking={async () => {
            const draft = await client.draft(view.draftId).catch(() => null)
            if (draft) openDraft({ ...draft, state: draft.state === 'building' ? 'failed' : draft.state })
          }}
        />
      )}
    </div>
  )
}

/** Unfinished drafts and running builds first, then the box. */
function Entry({ client, onContinue, onStart }: { client: NewCourseClient; onContinue: (draft: Draft) => void; onStart: (text: string) => void }) {
  const [drafts, setDrafts] = useState<Draft[] | null>(null)
  const [reachable, setReachable] = useState(true)

  useEffect(() => {
    let live = true
    client
      .drafts()
      .then((all) => live && setDrafts(all.filter((d) => d.state !== 'built').slice(0, 3)))
      .catch(() => {
        if (live) {
          setReachable(false)
          setDrafts([])
        }
      })
    return () => {
      live = false
    }
  }, [client])

  return (
    <>
      <div className="lesson-body new-course-entry">
        {drafts && drafts.length > 0 && (
          <ul className="menu-list">
            {drafts.map((draft) => (
              <li key={draft.id}>
                <button className="text-button new-course-continue" onClick={() => onContinue(draft)}>
                  Continue: {draft.title}
                  {draft.state === 'building' ? ' (building)' : ''}
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="new-course-lead">Say what you want to learn. A rough idea is enough.</p>
        {!reachable && (
          <p className="note" role="alert">
            {UNREACHABLE}
          </p>
        )}
      </div>
      <ChatInput label="What you want to learn" placeholder="I want to learn…" streaming={false} busy={false} onSend={onStart} onStop={() => {}} />
    </>
  )
}

function Talk({
  client,
  store,
  node,
  view,
  onBuild,
}: {
  client: NewCourseClient
  store: ChatStore
  node: { id: string; name: string } | null
  view: Extract<View, { kind: 'chat' }>
  onBuild: (buildId: string, draftId: string) => void
}) {
  const state = useSyncExternalStore(store.subscribe, () => store.get(view.key))
  const [draftId, setDraftId] = useState(view.draftId)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [building, setBuilding] = useState(false)
  const [refused, setRefused] = useState<string | null>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const busy = state.status === 'streaming' || state.status === 'loading'

  const target = useMemo<ChatTarget>(
    () => ({
      key: view.key,
      remember: false,
      start: async () => {
        const made = await client.createCourseChat(node?.id ?? null)
        setDraftId(made.draftId)
        return made.sessionId
      },
    }),
    [client, node, view.key],
  )

  // An existing draft: load its talk. A fresh one: send the entry screen's words.
  const sentFirst = useRef(false)
  useEffect(() => {
    if (view.sessionId) void store.open(view.key, view.sessionId)
    else if (view.first && !sentFirst.current) {
      sentFirst.current = true
      void store.open(view.key).then(() => store.send(target, view.first!))
    }
  }, [store, view, target])

  // After every reply, look for a brief.
  const turns = state.messages.length
  useEffect(() => {
    if (!draftId || state.status !== 'idle') return
    let live = true
    client
      .draft(draftId)
      .then((found) => live && setDraft(found))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [client, draftId, state.status, turns])

  const build = async () => {
    if (!draftId || building) return
    setBuilding(true)
    setRefused(null)
    try {
      onBuild(await client.startBuild(draftId), draftId)
    } catch (error) {
      setRefused(error instanceof Error ? error.message : 'The build could not start.')
      setBuilding(false)
    }
  }
  const keepTalking = () => input.current?.focus()

  const brief = draft?.brief
  const canBuild = draft && (draft.state === 'ready' || draft.state === 'failed') && draft.problems.length === 0

  return (
    <div className="ask new-course-talk">
      <MessageList state={state} failed={FAILED} onRetry={() => void store.retry(target)}>
        {brief && draft && draft.state !== 'talking' && (
          <section className="brief-card" aria-label="Brief">
            <p className="menu-heading">The brief</p>
            <p className="course-card-title">{brief.title ?? 'Untitled'}</p>
            <p className="course-card-meta">
              On the map: {brief.nodeName ?? '?'} ({brief.nodeId ?? '?'})
            </p>
            {brief.lessons.length > 0 && (
              <ol className="brief-lessons">
                {brief.lessons.map((lesson, i) => (
                  <li key={i}>
                    <strong>{lesson.title}</strong>
                    {lesson.summary && ` — ${lesson.summary}`}
                  </li>
                ))}
              </ol>
            )}
            {brief.missingWidgets.map((missing, i) => (
              <p key={i} className="ask-note">
                Missing picture (the course is written without it): {missing}
              </p>
            ))}
            {brief.sources.length > 0 && (
              <p className="ask-note">
                Sources opened:{' '}
                {brief.sources.map((source, i) => (
                  <span key={i}>
                    {i > 0 && ', '}
                    <a href={source.url} target="_blank" rel="noopener noreferrer">
                      {hostOf(source.url)}
                    </a>
                  </span>
                ))}
              </p>
            )}
            {draft.state === 'failed' && <p className="ask-note">The last build of this brief did not finish.</p>}
            {draft.problems.length > 0 && (
              <div className="ask-failed" role="alert">
                <p>The brief has problems; they go back to the session with your next message:</p>
                <ul className="brief-problems">
                  {draft.problems.map((problem, i) => (
                    <li key={i}>{problem}</li>
                  ))}
                </ul>
              </div>
            )}
            {refused && (
              <p className="ask-note" role="alert">
                {refused}
              </p>
            )}
            {draft.state === 'built' ? (
              <p className="ask-note">This brief has been built.</p>
            ) : (
              <div className="brief-actions">
                {canBuild && (
                  <button className="primary" onClick={() => void build()} disabled={busy || building}>
                    Build this
                  </button>
                )}
                <button className="text-button" onClick={keepTalking}>
                  Keep talking
                </button>
              </div>
            )}
          </section>
        )}
      </MessageList>
      <ChatInput
        inputRef={input}
        label="Your message"
        placeholder={draftId || view.sessionId ? 'Reply' : 'What you want to learn'}
        streaming={state.status === 'streaming'}
        busy={busy}
        onSend={(text) => void store.send(target, text)}
        onStop={() => store.stop(view.key)}
      />
    </div>
  )
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

function Progress({
  client,
  buildId,
  onOpenCourse,
  onKeepTalking,
}: {
  client: NewCourseClient
  buildId: string
  onOpenCourse: (courseId: string) => Promise<boolean>
  onKeepTalking: () => void
}) {
  const [build, setBuild] = useState<Build | null>(null)
  const [lost, setLost] = useState(false)
  const [armed, setArmed] = useState(false)
  const [notFound, setNotFound] = useState(false)
  const active = !build || BUILD_ACTIVE.includes(build.state)

  useEffect(() => {
    if (!active) return
    let live = true
    const poll = () =>
      client
        .build(buildId)
        .then((found) => {
          if (!live) return
          setLost(false)
          if (found) setBuild(found)
        })
        .catch(() => live && setLost(true))
    void poll()
    const timer = setInterval(poll, POLL_MS)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [client, buildId, active])

  useEffect(() => {
    if (!armed) return
    const timer = setTimeout(() => setArmed(false), 3000)
    return () => clearTimeout(timer)
  }, [armed])

  const stop = () => {
    if (!armed) return setArmed(true)
    setArmed(false)
    void client.stopBuild(buildId)
  }
  const open = async () => {
    if (!build) return
    void client.seen(build.id)
    if (!(await onOpenCourse(build.courseId))) setNotFound(true)
  }

  return (
    <>
      <div className="lesson-body new-course-build" aria-live="polite">
        <p className="course-card-title">{build?.title ?? 'Building…'}</p>
        {build && (
          <p className="course-card-meta">
            {buildStateText(build.state)}
            {build.round > 0 && active ? `, round ${build.round + 1}` : ''}
          </p>
        )}
        {lost && <p className="note">The server cannot be reached right now. The build carries on there; trying again…</p>}
        {build && (
          <ol className="build-log">
            {build.log.map((line, i) => (
              <li key={i}>{line.text}</li>
            ))}
          </ol>
        )}
        {active && <p className="ask-quiet">A course takes a while: often tens of minutes. You can close this; it carries on, and this screen finds it again.</p>}
        {build?.state === 'done' && (
          <>
            <h2 className="new-course-done">Your course is ready</h2>
            {build.missingWidgets.map((missing, i) => (
              <p key={i} className="note small">
                Written without a picture the app does not have yet: {missing}
              </p>
            ))}
            {notFound && <p className="note">The course is built but the app could not load it yet. Reload the app.</p>}
          </>
        )}
        {(build?.state === 'failed' || build?.state === 'stopped') && (
          <>
            <h2 className="new-course-done">{build.state === 'stopped' ? 'The build was stopped.' : 'The build did not finish.'}</h2>
            {build.problems.length > 0 && (
              <ul className="brief-problems">
                {build.problems.map((problem, i) => (
                  <li key={i}>{problem}</li>
                ))}
              </ul>
            )}
            <p className="note small">Nothing half-written was left among the courses.</p>
          </>
        )}
      </div>
      <div className="lesson-action">
        {active ? (
          <button className={armed ? 'primary outline armed' : 'primary outline'} onClick={stop}>
            {armed ? 'Tap again to stop the build' : 'Stop'}
          </button>
        ) : build?.state === 'done' ? (
          <button className="primary" onClick={() => void open()}>
            Open the course
          </button>
        ) : (
          <button className="primary" onClick={onKeepTalking}>
            Keep talking
          </button>
        )}
      </div>
    </>
  )
}
