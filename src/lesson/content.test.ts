// The real course, checked from the app's side. tools/validate_courses.py
// proves each key right with sympy; these prove the app reads the same keys
// the same way, that every known slip is named, and that all the maths
// typesets. Together they are what lets content into public/.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { check } from './check.ts'
import { gradeChoice } from './choice.ts'
import { correctOrder, gradeOrder, initialOrder } from './order.ts'
import { plainLabel, renderMarkdown } from './markdown.ts'
import type { Block, CheatSheet, Course, Lesson, WidgetRef } from './types.ts'
import { registry } from '../widgets/registry.ts'

const ROOT = 'content/maths/courses'
const courses = readdirSync(ROOT).map((dir) => {
  const course = JSON.parse(readFileSync(`${ROOT}/${dir}/course.json`, 'utf8')) as Course
  const lessons = course.lessons.map((entry) => JSON.parse(readFileSync(`${ROOT}/${dir}/${entry.id}.json`, 'utf8')) as Lesson)
  const sheetPath = `${ROOT}/${dir}/cheatsheet.json`
  const sheet = existsSync(sheetPath) ? (JSON.parse(readFileSync(sheetPath, 'utf8')) as CheatSheet) : undefined
  return { course, lessons, sheet }
})

function markdownOf(block: Block): string[] {
  const texts: string[] = []
  const widget = (w?: WidgetRef) => w?.caption && texts.push(w.caption)
  if (block.type === 'text') {
    texts.push(block.body)
    widget(block.widget)
    return texts
  }
  if (block.type === 'choice') {
    if (block.why) texts.push(block.why)
    texts.push(block.prompt)
    block.options.forEach((o) => texts.push(o.text, o.say))
    if (block.hint) texts.push(block.hint)
    if (block.solution) texts.push(block.solution)
    widget(block.widget)
    return texts
  }
  if (block.type === 'order') {
    if (block.why) texts.push(block.why)
    texts.push(block.prompt)
    block.items.forEach((i) => texts.push(i.text))
    Object.values(block.say ?? {}).forEach((say) => texts.push(say))
    if (block.hint) texts.push(block.hint)
    if (block.solution) texts.push(block.solution)
    return texts
  }
  texts.push(block.why, block.prompt, ...block.hints)
  if (block.solution) texts.push(block.solution)
  block.define?.forEach((d) => texts.push(d.meaning))
  if (block.check) texts.push(block.check.say)
  widget(block.widget)
  widget(block.check?.widget)
  if (block.answer.acceptNote) texts.push(block.answer.acceptNote)
  block.answer.fields.forEach((f) => f.label && texts.push(f.label))
  block.answer.slips?.forEach((s) => s.detect === 'known' && texts.push(s.say))
  return texts
}

describe.each(courses)('course $course.id', ({ course, lessons, sheet }) => {
  const steps = lessons.flatMap((lesson) => lesson.blocks.filter((b) => b.type === 'step').map((step) => ({ lesson: lesson.id, step })))

  it.each(steps)('$lesson / $step.id: the app accepts its own key', ({ step }) => {
    const keys = Object.fromEntries(step.answer.fields.map((f) => [f.name, f.key]))
    expect(check(step.answer, keys)).toEqual({ status: 'correct', via: 'key' })
  })

  it.each(steps.filter(({ step }) => step.answer.slips?.some((s) => s.detect === 'known')))(
    '$lesson / $step.id: names each known slip',
    ({ step }) => {
      for (const slip of step.answer.slips!) {
        if (slip.detect !== 'known') continue
        // The slip's fields as given, the rest right.
        const values = Object.fromEntries(step.answer.fields.map((f) => [f.name, slip.when[f.name] ?? f.key]))
        expect(check(step.answer, values)).toMatchObject({ status: 'wrong', slip: 'known', message: slip.say })
      }
    },
  )

  const quizzes = lessons.flatMap((lesson) => lesson.blocks.filter((b) => b.type === 'choice' || b.type === 'order').map((block) => ({ lesson: lesson.id, block })))

  it.each(quizzes)('$lesson / $block.id: the app grades its own key right, and an order does not open solved', ({ block }) => {
    if (block.type === 'choice') {
      const right = block.options.filter((o) => o.correct).map((o) => o.id)
      expect(gradeChoice(block, right)).toEqual({ status: 'correct' })
      expect(gradeChoice(block, block.options.filter((o) => !o.correct).map((o) => o.id)).status).toBe('wrong')
    }
    if (block.type === 'order') {
      expect(gradeOrder(block, correctOrder(block))).toEqual({ status: 'correct' })
      for (const seed of ['a', 'b', 'c', 'd']) expect(gradeOrder(block, initialOrder(block, seed)).status).toBe('wrong')
    }
  })

  it('typesets every piece of maths without a KaTeX error', () => {
    for (const lesson of lessons) {
      const texts = [...lesson.blocks.flatMap(markdownOf), ...(lesson.sideQuest ? [lesson.sideQuest.body] : [])]
      for (const text of texts) {
        expect(() => renderMarkdown(text, { strict: true, links: { nodeId: course.nodeId } }), `${lesson.id}: ${text}`).not.toThrow()
      }
    }
  })

  it('typesets every cheat-sheet formula in strict KaTeX, and the sheet is one the lessons derive', () => {
    if (!sheet) return
    const lessonIds = course.lessons.map((l) => l.id)
    for (const item of sheet.sections.flatMap((s) => s.items)) {
      for (const text of [item.formula, item.when, ...(item.cue ? [item.cue] : [])]) {
        expect(() => renderMarkdown(text, { strict: true, links: { nodeId: course.nodeId } }), `${item.id}: ${text}`).not.toThrow()
      }
      if (item.lesson) expect(lessonIds, item.id).toContain(item.lesson)
    }
  })

  it('gives every cheat-sheet item a cue that does not contain its formula', () => {
    if (!sheet) return
    // Maths inside $...$ with spaces dropped. A cue may name the symbols, but must not copy a formula
    // that is one whole $...$ span, nor what stands right of the "=" in any span (what is to be recalled).
    const maths = (text: string) => [...text.matchAll(/\$([^$]+)\$/g)].map((m) => m[1].replace(/\s+/g, ''))
    for (const item of sheet.sections.flatMap((s) => s.items)) {
      expect(item.cue, `${item.id} has no cue`).toBeTruthy()
      const squashed = item.cue!.replace(/\s+/g, '')
      const pieces = maths(item.formula)
      if (pieces.length === 1 && /^\$[^$]+\$$/.test(item.formula.trim())) {
        expect(squashed, `${item.id}: the cue contains the whole formula`).not.toContain(pieces[0])
      }
      for (const piece of pieces) {
        const answer = piece.split('=').pop()!
        if (piece.includes('=') && answer.length > 3) expect(squashed, `${item.id}: the cue contains ${answer}`).not.toContain(answer)
      }
    }
  })

  it('names only widgets the app has', () => {
    for (const lesson of lessons) {
      for (const block of lesson.blocks) {
        const own = block.type === 'order' ? undefined : block.widget
        const widgets = [own, block.type === 'step' ? block.check?.widget : undefined].filter(Boolean) as WidgetRef[]
        for (const widget of widgets) expect(Object.keys(registry), `${lesson.id}/${block.id}`).toContain(widget.name)
      }
    }
  })
})

describe('markdown', () => {
  it('typesets maths, keeps Markdown, and shows raw HTML as text', () => {
    const html = renderMarkdown('**Bold** and $x_1^2$ and <script>alert(1)</script>')
    expect(html).toContain('<strong>Bold</strong>')
    expect(html).toContain('class="katex"')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('leaves dollars in code alone and turns lesson links into app addresses', () => {
    const html = renderMarkdown('`cost $5` and [next](lesson:dependent-columns) and [map](node:15Axx) and [x](javascript:alert(1))', { links: { nodeId: '15Axx' } })
    expect(html).toContain('<code>cost $5</code>')
    expect(html).toContain('href="#15Axx/learn/dependent-columns"')
    expect(html).toContain('href="#15Axx"')
    expect(html).not.toContain('javascript:')
    // Two courses on a node may share a lesson id, so inside a course the address names the course.
    const inCourse = renderMarkdown('[next](lesson:dependent-columns)', { links: { nodeId: '15Axx', courseId: 'least-squares' } })
    expect(inCourse).toContain('href="#15Axx/learn/least-squares/dependent-columns"')
  })

  it('throws on bad maths only when asked to be strict', () => {
    expect(() => renderMarkdown('$\\frac{1}$', { strict: true })).toThrow()
    expect(() => renderMarkdown('$\\frac{1}$')).not.toThrow()
  })
})

describe('plainLabel', () => {
  it.each([
    ['$\\|r\\|^2$ =', '‖r‖²'],
    ['$\\lambda_1$ =', 'λ₁'],
    ['$c$ =', 'c'],
    ['smallest $\\|Aw\\|^2$ =', 'smallest ‖Aw‖²'],
    ['dim ≥', 'dim'],
    ['$p \\cdot d$ =', 'p · d'],
  ])('reads %s as %s', (label, text) => {
    expect(plainLabel(label)).toBe(text)
  })
})
