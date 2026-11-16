// Making a new course by talking to the app (server kinds `new-course` and
// `build-course`, docs/ai-sessions.md section 10). The talk is an ordinary
// chat (turn, stop, transcript come from the Ask client); this adds the
// draft (the brief the session wrote, as the server parsed and checked it) and
// the build job. Everything from the server is checked here before the app
// shows it.

import { SESSION_ID, TutorError, createClient } from './client.ts'
import type { ChatClient } from './client.ts'

/** Draft and build ids are the server's secrets.token_hex(8). */
export const JOB_ID = /^[0-9a-f]{16}$/

export interface BriefLesson {
  title: string
  summary: string
}

export interface Brief {
  title: string | null
  courseId: string | null
  nodeId: string | null
  nodeName: string | null
  lessons: BriefLesson[]
  missingWidgets: string[]
  sources: { url: string; note: string }[]
}

export type DraftState = 'talking' | 'ready' | 'problems' | 'building' | 'built' | 'failed'

export interface Draft {
  id: string
  sessionId: string
  title: string
  state: DraftState
  brief: Brief | null
  problems: string[]
  build: { id: string; state: BuildState } | null
}

export type BuildState = 'queued' | 'running' | 'validating' | 'repairing' | 'done' | 'failed' | 'stopped'
export const BUILD_ACTIVE: BuildState[] = ['queued', 'running', 'validating', 'repairing']

export interface Build {
  id: string
  draftId: string
  courseId: string
  title: string
  state: BuildState
  round: number
  log: { at: string; text: string }[]
  problems: string[]
  missingWidgets: string[]
  unread: boolean
}

const DRAFT_STATES: DraftState[] = ['talking', 'ready', 'problems', 'building', 'built', 'failed']
const BUILD_STATES: BuildState[] = [...BUILD_ACTIVE, 'done', 'failed', 'stopped']

const str = (value: unknown, limit = 2000) => (typeof value === 'string' ? value.slice(0, limit) : '')
const strs = (value: unknown, limit = 2000) => (Array.isArray(value) ? value.filter((v) => typeof v === 'string').map((v: string) => v.slice(0, limit)) : [])
const obj = (value: unknown): Record<string, unknown> | null => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null)
const orNull = (value: unknown) => (typeof value === 'string' && value ? value.slice(0, 200) : null)

export function parseBrief(value: unknown): Brief | null {
  const b = obj(value)
  if (!b) return null
  return {
    title: orNull(b.title),
    courseId: orNull(b.courseId),
    nodeId: orNull(b.nodeId),
    nodeName: orNull(b.nodeName),
    lessons: (Array.isArray(b.lessons) ? b.lessons : [])
      .map(obj)
      .filter((l): l is Record<string, unknown> => !!l)
      .map((l) => ({ title: str(l.title, 200), summary: str(l.summary, 400) }))
      .filter((l) => l.title),
    missingWidgets: strs(b.missingWidgets, 1000),
    sources: (Array.isArray(b.sources) ? b.sources : [])
      .map(obj)
      .filter((s): s is Record<string, unknown> => !!s)
      .map((s) => ({ url: str(s.url, 500), note: str(s.note, 300) }))
      .filter((s) => /^https?:\/\//.test(s.url)),
  }
}

/** A draft from the server, or null if it is not one. */
export function parseDraft(value: unknown): Draft | null {
  const d = obj(value)
  if (!d || typeof d.id !== 'string' || !JOB_ID.test(d.id) || typeof d.sessionId !== 'string' || !SESSION_ID.test(d.sessionId)) return null
  const state = DRAFT_STATES.includes(d.state as DraftState) ? (d.state as DraftState) : 'talking'
  const build = obj(d.build)
  return {
    id: d.id,
    sessionId: d.sessionId,
    title: str(d.title, 200) || 'New course',
    state,
    brief: parseBrief(d.brief),
    problems: strs(d.problems, 600),
    build:
      build && typeof build.id === 'string' && JOB_ID.test(build.id) && BUILD_STATES.includes(build.state as BuildState)
        ? { id: build.id, state: build.state as BuildState }
        : null,
  }
}

/** A build from the server, or null if it is not one. */
export function parseBuild(value: unknown): Build | null {
  const b = obj(value)
  if (!b || typeof b.id !== 'string' || !JOB_ID.test(b.id) || !BUILD_STATES.includes(b.state as BuildState)) return null
  return {
    id: b.id,
    draftId: typeof b.draftId === 'string' && JOB_ID.test(b.draftId) ? b.draftId : '',
    courseId: str(b.courseId, 60),
    title: str(b.title, 200) || 'New course',
    state: b.state as BuildState,
    round: typeof b.round === 'number' ? b.round : 0,
    log: (Array.isArray(b.log) ? b.log : [])
      .map(obj)
      .filter((l): l is Record<string, unknown> => !!l)
      .map((l) => ({ at: str(l.at, 40), text: str(l.text, 300) })),
    problems: strs(b.problems, 600),
    missingWidgets: strs(b.missingWidgets, 1000),
    unread: b.unread === true,
  }
}

/** What the server said when it refused, in its own plain words where it gave them. */
async function refusal(response: Response, fallback: string): Promise<TutorError> {
  try {
    const body = obj(await response.json())
    if (body && typeof body.error === 'string') return new TutorError(body.error.slice(0, 300), response.status)
  } catch {
    // not JSON
  }
  return new TutorError(fallback, response.status)
}

export interface NewCourseClient extends ChatClient {
  /** Opens a new-course chat, from the node the map was on (a suggestion for the session). */
  createCourseChat(nodeId: string | null): Promise<{ sessionId: string; draftId: string }>
  draft(draftId: string): Promise<Draft | null>
  drafts(): Promise<Draft[]>
  startBuild(draftId: string): Promise<string>
  build(buildId: string): Promise<Build | null>
  builds(): Promise<Build[]>
  stopBuild(buildId: string): Promise<void>
  /** Mark has opened the course: it is no longer "new, not yet read". */
  seen(buildId: string): Promise<void>
}

export function createCourseClient(base = './api/', fetcher: typeof fetch = (...args) => fetch(...args)): NewCourseClient {
  const chat = createClient(base, fetcher)
  const post = (path: string, body: unknown) =>
    fetcher(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const getJson = async (path: string) => {
    const response = await fetcher(`${base}${path}`, { cache: 'no-store' })
    if (response.status === 404) return null
    if (!response.ok) throw await refusal(response, `refused (${response.status})`)
    return (await response.json()) as unknown
  }

  return {
    ...chat,
    async createCourseChat(nodeId) {
      const response = await post('session', { kind: 'new-course', context: nodeId ? { nodeId } : {} })
      if (!response.ok) throw await refusal(response, `session refused (${response.status})`)
      const body = obj(await response.json())
      const sessionId = body?.sessionId
      const draftId = body?.draftId
      if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId) || typeof draftId !== 'string' || !JOB_ID.test(draftId)) {
        throw new TutorError('no session id')
      }
      return { sessionId, draftId }
    },
    async draft(draftId) {
      return parseDraft(await getJson(`draft?id=${encodeURIComponent(draftId)}`))
    },
    async drafts() {
      const body = obj(await getJson('drafts'))
      return (Array.isArray(body?.drafts) ? body.drafts : []).map(parseDraft).filter((d): d is Draft => !!d)
    },
    async startBuild(draftId) {
      const response = await post('build', { draftId })
      if (!response.ok) throw await refusal(response, `build refused (${response.status})`)
      const body = obj(await response.json())
      if (typeof body?.buildId !== 'string' || !JOB_ID.test(body.buildId)) throw new TutorError('no build id')
      return body.buildId
    },
    async build(buildId) {
      return parseBuild(await getJson(`build?id=${encodeURIComponent(buildId)}`))
    },
    async builds() {
      const body = obj(await getJson('builds'))
      return (Array.isArray(body?.builds) ? body.builds : []).map((b) => parseBuild({ log: [], ...obj(b) })).filter((b): b is Build => !!b)
    },
    async stopBuild(buildId) {
      try {
        await post('build/stop', { buildId })
      } catch {
        // The next poll says what happened.
      }
    },
    async seen(buildId) {
      try {
        await post('build/seen', { buildId })
      } catch {
        // Only a mark; nothing depends on it.
      }
    },
  }
}

/** Words for a build's state, as the progress view shows them. */
export function buildStateText(state: BuildState): string {
  return {
    queued: 'Starting',
    running: 'Writing the course',
    validating: 'Checking it with the validator',
    repairing: 'Fixing what the validator found',
    done: 'Ready',
    failed: 'Did not finish',
    stopped: 'Stopped',
  }[state]
}
