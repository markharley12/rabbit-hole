// The course from the map, as Mark meets it: the 15Axx sheet offers it, Start
// opens lesson 1, answers are checked and slips named, and closing the app
// and coming back continues at the same screen.

import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import App from './App.tsx'
import { forgetCachedProgress } from './lesson/progress-store.ts'
import type { Course } from './lesson/types.ts'

const COURSE_DIR = 'content/maths/courses/15Axx'
const course = JSON.parse(readFileSync(`${COURSE_DIR}/course.json`, 'utf8')) as Course
const files: Record<string, unknown> = {
  './content/maths/map.json': JSON.parse(readFileSync('public/content/maths/map.json', 'utf8')),
  './content/maths/courses/index.json': { format: 1, courses: [course] },
}
for (const lesson of course.lessons) {
  files[`./content/maths/courses/15Axx/${lesson.id}.json`] = JSON.parse(readFileSync(`${COURSE_DIR}/${lesson.id}.json`, 'utf8'))
}

const serve = (missing: string[] = []) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url in files && !missing.includes(url)
        ? { ok: true, json: async () => files[url] }
        : { ok: false, status: 404, statusText: 'Not Found', json: async () => ({}) },
    ),
  )

const goTo = async (hash: string) => {
  await act(async () => {
    window.location.hash = hash
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  })
}

// The lesson screens are a lazy chunk; its first load can take over a second in a full run.
const LOAD = { timeout: 5000 }

const box = (name: string) => screen.getByRole('textbox', { name })
const type = (name: string, value: string) => fireEvent.change(box(name), { target: { value } })

beforeEach(() => {
  window.location.hash = ''
  localStorage.clear()
  forgetCachedProgress()
  vi.stubGlobal('requestAnimationFrame', () => 0)
  vi.stubGlobal('cancelAnimationFrame', () => {})
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('the first course', () => {
  it('shows a Course entry on 15Axx and none elsewhere', async () => {
    serve()
    render(<App />)
    await screen.findByRole('heading', { level: 1, name: 'Mathematics' })
    // The root counts what is inside it rather than saying there is nothing.
    expect(await screen.findByRole('button', { name: '1 course inside' })).toBeTruthy()
    // One pin on the map, where the course is.
    expect(document.querySelectorAll('.course-pin')).toHaveLength(1)
    await goTo('analysis')
    expect(screen.getByText('No courses yet')).toBeTruthy()

    await goTo('15Axx')
    expect(await screen.findByRole('button', { name: 'Start course' })).toBeTruthy()
    expect(screen.queryByText('No course yet')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Show more' }))
    expect(screen.getByText('Least squares to the pseudo-inverse')).toBeTruthy()
    expect(screen.getByText('Your open task')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /^\d/ }).map((b) => b.textContent)).toHaveLength(5)
  })

  it('starts lesson 1, checks an answer, names a slip, and resumes after the app is closed', async () => {
    serve()
    const { unmount } = render(<App />)
    await screen.findByRole('heading', { level: 1, name: 'Mathematics' })
    await goTo('15Axx')
    fireEvent.click(await screen.findByRole('button', { name: 'Start course' }))
    await goTo(window.location.hash.slice(1))
    expect(window.location.hash).toBe('#15Axx/learn/normal-equations-from-your-points')

    expect(await screen.findByText('1 of 6', {}, LOAD)).toBeTruthy()
    expect(screen.getByRole('dialog', { name: 'Normal equations from your three points' })).toBeTruthy()

    // One clear action: Check, disabled until there is something to check.
    const checkButton = screen.getByRole('button', { name: 'Check' })
    expect((checkButton as HTMLButtonElement).disabled).toBe(true)
    type('‖r‖²', '6')
    fireEvent.click(checkButton)
    expect(screen.getByText('Not yet.')).toBeTruthy()
    // One box, so not "each box" (seen in the browser check, 15 Nov).
    expect(screen.getByText('Check it again, or take a hint.')).toBeTruthy()

    // Hints come one at a time.
    fireEvent.click(screen.getByRole('button', { name: 'Hint' }))
    expect(screen.getAllByRole('listitem').filter((li) => li.closest('.hints'))).toHaveLength(1)

    type('‖r‖²', '9')
    fireEvent.click(screen.getByRole('button', { name: 'Check' }))
    expect(screen.getByText('Right.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Set up the normal equations' }))
    expect(screen.getByText('2 of 6')).toBeTruthy()

    // His real slip: an AᵀA with 12 and 1 off the diagonal.
    type('row 1, column 1', '3')
    type('row 1, column 2', '12')
    type('row 2, column 1', '1')
    type('row 2, column 2', '14')
    fireEvent.click(screen.getByRole('button', { name: 'Check' }))
    expect(screen.getByText(/AᵀA equals its own transpose.*You have 12 and 1\./)).toBeTruthy()

    // The record has attempts and a draft, and no score anywhere.
    const saved = JSON.parse(localStorage.getItem(`rabbit-hole:progress:${course.id}`)!)
    const lesson = saved.lessons['normal-equations-from-your-points']
    expect(lesson.at).toBe(1)
    expect(lesson.steps['guess-y-equals-x']).toMatchObject({ attempts: 2, solved: true, hints: 1 })
    expect(lesson.steps['build-ata'].log[0]).toMatchObject({ result: 'wrong', slip: 'symmetric' })
    expect(JSON.stringify(saved)).not.toMatch(/score|mastery/i)

    // Close the app entirely and open it again.
    unmount()
    forgetCachedProgress()
    window.location.hash = ''
    render(<App />)
    await screen.findByRole('heading', { level: 1, name: 'Mathematics' })
    await goTo('15Axx')
    fireEvent.click(await screen.findByRole('button', { name: 'Continue lesson 1' }))
    await goTo(window.location.hash.slice(1))
    expect(await screen.findByText('2 of 6', {}, LOAD)).toBeTruthy()
    // What he had typed is still there.
    expect((box('row 1, column 2') as HTMLInputElement).value).toBe('12')
  })

  it('accepts r as fit − data and says why', async () => {
    serve()
    localStorage.setItem(
      `rabbit-hole:progress:${course.id}`,
      JSON.stringify({ format: 1, lessons: { 'normal-equations-from-your-points': { at: 4, done: false, started: '', steps: {} } } }),
    )
    render(<App />)
    await screen.findByRole('heading', { level: 1, name: 'Mathematics' })
    await goTo('15Axx/learn/normal-equations-from-your-points')
    await screen.findByText('5 of 6', {}, LOAD)
    type('entry 1', '-0.5')
    type('entry 2', '1')
    type('entry 3', '-1/2')
    fireEvent.click(screen.getByRole('button', { name: 'Check' }))
    expect(screen.getByText('Right.')).toBeTruthy()
    expect(screen.getByText(/the other sign convention/)).toBeTruthy()
  })

  it('offers the answer only after three hints and a further try', async () => {
    serve()
    render(<App />)
    await screen.findByRole('heading', { level: 1, name: 'Mathematics' })
    await goTo('15Axx/learn/the-smallest-best-fit')
    await screen.findByText('1 of 7', {}, LOAD)
    for (let i = 0; i < 3; i++) {
      expect(screen.queryByRole('button', { name: 'Show the answer' })).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: i === 0 ? 'Hint' : 'Another hint' }))
    }
    expect(screen.queryByRole('button', { name: 'Show the answer' })).toBeNull()
    type('c', '3 + 2m')
    fireEvent.click(screen.getByRole('button', { name: 'Check' }))
    // KaTeX writes maths twice (HTML and MathML), so match the words around it.
    expect(document.querySelector('.feedback.wrong')!.textContent).toMatch(/^Not yet\.Moving .* to the other side flips its sign\.\s*$/)
    fireEvent.click(screen.getByRole('button', { name: 'Show the answer' }))
    expect((box('c') as HTMLInputElement).value).toBe('3 - 2m')
    expect(screen.getByRole('button', { name: 'Substitute into c² + m²' })).toBeTruthy()
  })

  it('finishes a lesson and recommends exactly the next one', async () => {
    serve()
    const blocks = (files['./content/maths/courses/15Axx/dependent-columns.json'] as { blocks: unknown[] }).blocks
    localStorage.setItem(
      `rabbit-hole:progress:${course.id}`,
      JSON.stringify({ format: 1, lessons: { 'dependent-columns': { at: blocks.length - 1, done: false, started: '', steps: {} } } }),
    )
    render(<App />)
    await screen.findByRole('heading', { level: 1, name: 'Mathematics' })
    await goTo('15Axx/learn/dependent-columns')
    fireEvent.click(await screen.findByRole('button', { name: 'Finish the lesson' }, LOAD))
    expect(screen.getByRole('heading', { name: 'Lesson done' })).toBeTruthy()
    const next = screen.getAllByRole('button').filter((b) => b.classList.contains('primary'))
    expect(next.map((b) => b.textContent)).toEqual(['Next lesson: The smallest best fit'])
  })

  it('marks the branch that holds a course in the sheet', async () => {
    serve()
    render(<App />)
    await screen.findByRole('button', { name: '1 course inside' })
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }))
    expect(screen.getByRole('button', { name: /^Algebra and number theory\s*1 course/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Analysis\s*\d/ })).toBeTruthy()
  })

  it('lists and searches courses and the map from the courses menu', async () => {
    serve()
    render(<App />)
    await screen.findByRole('button', { name: '1 course inside' })
    fireEvent.click(screen.getByRole('button', { name: 'Courses and search' }))
    await goTo(window.location.hash.slice(1))
    expect(window.location.hash).toBe('#mathematics/courses')

    const menu = within(screen.getByRole('dialog', { name: 'Courses' }))
    expect(menu.getByText('1 in the app')).toBeTruthy()
    expect(menu.getByText('Least squares to the pseudo-inverse')).toBeTruthy()
    expect(menu.getByText('Not started')).toBeTruthy()

    const search = menu.getByRole('searchbox', { name: 'Search courses, sections and topics' })
    fireEvent.change(search, { target: { value: 'eckart' } })
    expect(menu.getByText('Courses (1)')).toBeTruthy()
    fireEvent.change(search, { target: { value: 'pseudoinverses' } })
    expect(menu.getByText('Courses (0)')).toBeTruthy()
    // Not a course, but a place on the map, found by one of its topics.
    fireEvent.click(menu.getByRole('button', { name: /^Numerical linear algebra/ }))
    await goTo(window.location.hash.slice(1))
    expect(window.location.hash).toBe('#65Fxx')
    expect(screen.getByRole('heading', { level: 1, name: 'Numerical linear algebra' })).toBeTruthy()

    // Back to the menu, and start the course from it.
    fireEvent.click(screen.getByRole('button', { name: 'Courses and search' }))
    await goTo(window.location.hash.slice(1))
    fireEvent.click(screen.getByRole('button', { name: /^Least squares to the pseudo-inverse/ }))
    await goTo(window.location.hash.slice(1))
    expect(window.location.hash).toBe('#15Axx/learn/normal-equations-from-your-points')
    expect(await screen.findByText('1 of 6', {}, LOAD)).toBeTruthy()
  })

  it('still shows the map when there is no course index', async () => {
    serve(['./content/maths/courses/index.json'])
    render(<App />)
    await screen.findByRole('heading', { level: 1, name: 'Mathematics' })
    await goTo('15Axx')
    expect(screen.getByText('No course yet')).toBeTruthy()
  })
})
