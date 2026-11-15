// Reading on screen: the lesson's Reading tool and the node sheet's Reading section.

import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import LessonView from '../lesson/LessonView.tsx'
import { forgetCachedProgress } from '../lesson/progress-store.ts'
import type { Course, Lesson } from '../lesson/types.ts'
import { layoutMap } from '../map/layout.ts'
import type { MapDocument } from '../map/types.ts'
import { forgetResourceFiles } from '../resource-store.ts'
import type { ReadingSource, Resource, ResourceFile } from '../resources.ts'
import { NodeSheet } from './NodeSheet.tsx'

const MAP = JSON.parse(readFileSync('public/content/maths/map.json', 'utf8')) as MapDocument
const layout = layoutMap(MAP.root)

const course: Course = {
  format: 1,
  id: 'demo',
  nodeId: '15Axx',
  title: 'Demo',
  summary: '',
  written: '2026-11-15',
  sources: [],
  lessons: [{ id: 'one', title: 'One' }],
}

const lesson: Lesson = {
  format: 1,
  id: 'one',
  title: 'One',
  blocks: [
    {
      type: 'step',
      id: 's1',
      why: 'Because.',
      prompt: 'What is 2 + 2?',
      answer: { fields: [{ name: 'x', key: '4' }], verify: '4' },
      hints: ['a', 'b', 'c'],
      next: 'On',
    },
  ],
}

const item = (id: string, over: Partial<Resource> = {}): Resource => ({
  id,
  title: `Title of ${id}`,
  by: 'An Author',
  kind: 'video',
  url: `https://example.org/${id}`,
  about: 'About it.',
  use: `Use of ${id}.`,
  free: true,
  checked: '2026-11-15',
  ...over,
})

const files: Record<string, ResourceFile> = {
  '15Axx': { format: 1, nodeId: '15Axx', resources: [item('own-1'), item('own-2', { free: false, kind: 'book', checked: '2026-10-01' })] },
  '15-XX': { format: 1, nodeId: '15-XX', resources: [item('parent-1')] },
}

let respond: (url: string) => Promise<unknown>
const requested = () => (fetch as ReturnType<typeof vi.fn>).mock.calls.map(([url]) => String(url))

const source = (counts: Record<string, number>): ReadingSource => ({ layout, counts, base: './res/' })

const mount = async (reading?: ReadingSource) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.startsWith('./res/')) return respond(url)
      return { ok: true, json: async () => lesson }
    }),
  )
  render(<LessonView course={course} lessonId="one" base="./" onClose={() => {}} onOpenLesson={() => {}} reading={reading} />)
  await screen.findByRole('textbox', { name: 'x' })
}

const open = () => fireEvent.click(screen.getByRole('button', { name: 'Reading' }))
const panel = () => screen.getByRole('dialog', { name: 'Reading' })

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  localStorage.clear()
  forgetCachedProgress()
  forgetResourceFiles()
  window.history.replaceState(null, '', '/')
  respond = async (url) => {
    const id = url.replace('./res/', '').replace('.json', '')
    return files[id] ? { ok: true, json: async () => files[id] } : { ok: false, status: 404, statusText: 'Not Found' }
  }
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('the Reading tool in a lesson', () => {
  it('is not offered when no node on the way up has reading, and nothing is fetched', async () => {
    await mount(source({ '65Fxx': 3 }))
    expect(screen.queryByRole('button', { name: 'Reading' })).toBeNull()
    expect(requested().filter((u) => u.startsWith('./res/'))).toEqual([])
  })

  it('is not offered when the app has no reading index at all', async () => {
    await mount(undefined)
    expect(screen.queryByRole('button', { name: 'Reading' })).toBeNull()
  })

  it('is offered when only an ancestor has reading', async () => {
    await mount(source({ '15-XX': 1 }))
    expect(screen.getByRole('button', { name: 'Reading' })).toBeTruthy()
  })

  it('fetches the files only when opened, the nearest node’s and each ancestor’s that has some', async () => {
    await mount(source({ '15Axx': 2, '15-XX': 1, '65Fxx': 9 }))
    expect(requested().filter((u) => u.startsWith('./res/'))).toEqual([])
    open()
    await screen.findByText('Title of own-1')
    expect(requested().filter((u) => u.startsWith('./res/')).sort()).toEqual(['./res/15-XX.json', './res/15Axx.json'])
  })

  it('lists title as a link in a new tab, by, kind, free or paid and the use line', async () => {
    await mount(source({ '15Axx': 2 }))
    open()
    const link = (await screen.findByRole('link', { name: 'Title of own-2' })) as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe('https://example.org/own-2')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    const row = link.closest('li')!
    expect(within(row).getByText('An Author', { exact: false })).toBeTruthy()
    expect(within(row).getByText('book')).toBeTruthy()
    expect(within(row).getByText('paid')).toBeTruthy()
    expect(within(row).getByText('Use of own-2.')).toBeTruthy()
    expect(within(panel().querySelectorAll('li')[0] as HTMLElement).getByText('free')).toBeTruthy()
  })

  it('has no group headings when one node contributes, and names the nodes when two do, nearest first', async () => {
    await mount(source({ '15Axx': 2 }))
    open()
    await screen.findByText('Title of own-1')
    expect(panel().querySelector('h3')).toBeNull()
    cleanup()
    forgetResourceFiles()

    await mount(source({ '15Axx': 2, '15-XX': 1 }))
    open()
    await screen.findByText('Title of parent-1')
    const headings = [...panel().querySelectorAll('h3')].map((h) => h.textContent)
    expect(headings).toEqual([layout.byId.get('15Axx')!.node.name, layout.byId.get('15-XX')!.node.name])
    const titles = [...panel().querySelectorAll('.reading-title')].map((t) => t.textContent)
    expect(titles).toEqual(['Title of own-1', 'Title of own-2', 'Title of parent-1'])
  })

  it('ends with one quiet line giving the latest date checked', async () => {
    await mount(source({ '15Axx': 2 }))
    open()
    expect(await screen.findByText('Links were checked on 15 Nov 2026.')).toBeTruthy()
  })

  it('says it is loading, and says plainly when a file could not be loaded', async () => {
    respond = () => new Promise(() => {})
    await mount(source({ '15Axx': 2 }))
    open()
    expect(screen.getByText('Loading the reading list…')).toBeTruthy()
    cleanup()
    forgetResourceFiles()

    respond = async () => ({ ok: false, status: 404, statusText: 'Not Found' })
    await mount(source({ '15Axx': 2 }))
    open()
    expect((await screen.findByRole('alert')).textContent).toContain('The reading list could not be loaded (404 Not Found).')
  })

  it('shows what did load when one of two files fails', async () => {
    respond = async (url) => (url.includes('15-XX') ? { ok: false, status: 500, statusText: 'Oops' } : { ok: true, json: async () => files['15Axx'] })
    await mount(source({ '15Axx': 2, '15-XX': 1 }))
    open()
    expect((await screen.findByRole('alert')).textContent).toContain('Some of the reading list could not be loaded (500 Oops).')
    expect(screen.getByText('Title of own-1')).toBeTruthy()
  })

  it('says it is offline above the list, and drops that when back online', async () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    await mount(source({ '15Axx': 2 }))
    open()
    await screen.findByText('Title of own-1')
    const message = 'You are offline; these open when you are back online.'
    const list = panel().querySelector('.reading-list')!
    const note = screen.getByText(message)
    expect(note.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    online.mockReturnValue(true)
    fireEvent(window, new Event('online'))
    await waitFor(() => expect(screen.queryByText(message)).toBeNull())
  })

  it('sits after the other tools in the dock', async () => {
    await mount(source({ '15Axx': 2 }))
    const dock = screen.getByRole('group', { name: 'Tools' })
    expect(within(dock).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Scratch pad', 'Calculator', 'Reading'])
  })
})

describe('the node sheet', () => {
  const sheet = (nodeId: string, counts: Record<string, number>, open = true) => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => respond(url)))
    const node = layout.byId.get(nodeId)!
    render(
      <NodeSheet
        node={node}
        document={MAP}
        courses={[]}
        counts={new Map()}
        open={open}
        onOpenChange={() => {}}
        onSelect={() => {}}
        onOpenLesson={() => {}}
        onOpenCourses={() => {}}
        reading={source(counts)}
      />,
    )
  }

  it('shows a Reading section for a node with reading of its own, after the course part', async () => {
    sheet('15Axx', { '15Axx': 2 })
    const heading = screen.getByRole('heading', { name: 'Reading' })
    expect(await screen.findByText('Title of own-1')).toBeTruthy()
    const course = screen.getByRole('heading', { name: /^Courses?$/ })
    expect(course.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(requested()).toEqual(['./res/15Axx.json'])
  })

  it('shows nothing new for a node with none of its own, even if an ancestor has some', () => {
    sheet('15Axx', { '15-XX': 1 })
    expect(screen.queryByRole('heading', { name: 'Reading' })).toBeNull()
    expect(requested()).toEqual([])
  })

  it('does not fetch while the sheet is closed', () => {
    sheet('15Axx', { '15Axx': 2 }, false)
    expect(requested()).toEqual([])
  })
})
