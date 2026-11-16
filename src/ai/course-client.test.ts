import { describe, expect, it } from 'vitest'
import { createCourseClient, parseBuild, parseDraft } from './course-client.ts'
import { serverKinds } from './client.ts'

const SID = 'S'.repeat(22)
const DID = '0123456789abcdef'
const BID = 'fedcba9876543210'

const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body }) as unknown as Response

describe('parsing what the server sends', () => {
  it('keeps a good draft and its brief', () => {
    const draft = parseDraft({
      id: DID,
      sessionId: SID,
      title: 'Eigen',
      state: 'ready',
      problems: [],
      build: null,
      brief: {
        title: 'Eigen',
        courseId: 'eigen',
        nodeId: '15Axx',
        nodeName: 'Basic linear algebra',
        lessons: [{ title: 'One', summary: 'first' }, { nope: 1 }],
        missingWidgets: ['a dragger', 5],
        sources: [{ url: 'https://example.org', note: 'x' }, { url: 'javascript:alert(1)', note: 'bad' }],
      },
    })
    expect(draft?.brief?.lessons).toEqual([{ title: 'One', summary: 'first' }])
    expect(draft?.brief?.missingWidgets).toEqual(['a dragger'])
    expect(draft?.brief?.sources).toEqual([{ url: 'https://example.org', note: 'x' }])
  })

  it('refuses drafts and builds with ids that are not the server’s', () => {
    expect(parseDraft({ id: '../x', sessionId: SID, state: 'ready' })).toBeNull()
    expect(parseDraft({ id: DID, sessionId: 'x', state: 'ready' })).toBeNull()
    expect(parseDraft(null)).toBeNull()
    expect(parseBuild({ id: BID, state: 'exploded' })).toBeNull()
    expect(parseBuild({ id: 'x', state: 'done' })).toBeNull()
  })

  it('reads a build', () => {
    const build = parseBuild({ id: BID, draftId: DID, courseId: 'eigen', title: 'Eigen', state: 'repairing', round: 1,
      log: [{ at: 't', text: 'Validating' }, 'junk'], problems: ['x'], unread: true })
    expect(build).toMatchObject({ state: 'repairing', round: 1, log: [{ at: 't', text: 'Validating' }], problems: ['x'], unread: true })
  })
})

describe('the client', () => {
  it('opens a course chat with only the node', async () => {
    const sent: unknown[] = []
    const client = createCourseClient('./api/', async (_url, init) => {
      sent.push(JSON.parse(String(init?.body)))
      return json(200, { sessionId: SID, draftId: DID })
    })
    expect(await client.createCourseChat('15Axx')).toEqual({ sessionId: SID, draftId: DID })
    expect(await client.createCourseChat(null)).toEqual({ sessionId: SID, draftId: DID })
    expect(sent).toEqual([{ kind: 'new-course', context: { nodeId: '15Axx' } }, { kind: 'new-course', context: {} }])
  })

  it('passes on the server’s own words when a build is refused', async () => {
    const client = createCourseClient('./api/', async () => json(409, { error: 'A course is already being built. One at a time.' }))
    await expect(client.startBuild(DID)).rejects.toThrow('A course is already being built. One at a time.')
  })

  it('reads lists and a missing draft', async () => {
    const client = createCourseClient('./api/', async (url) =>
      String(url).includes('drafts')
        ? json(200, { drafts: [{ id: DID, sessionId: SID, state: 'talking' }, { id: 'bad' }] })
        : String(url).includes('builds')
          ? json(200, { builds: [{ id: BID, state: 'done', courseId: 'c' }] })
          : json(404, {}),
    )
    expect((await client.drafts()).map((d) => d.id)).toEqual([DID])
    expect((await client.builds()).map((b) => b.courseId)).toEqual(['c'])
    expect(await client.draft(DID)).toBeNull()
  })

  it('knows which kinds the server offers', async () => {
    expect(await serverKinds('./api/', async () => json(200, { ok: true, kinds: ['ask', 'new-course', 3] }))).toEqual(['ask', 'new-course'])
    expect(await serverKinds('./api/', async () => json(200, { ok: true }))).toEqual([])
    expect(await serverKinds('./api/', async () => { throw new TypeError('offline') })).toEqual([])
  })
})
