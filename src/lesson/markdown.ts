// Lesson text: Markdown with maths in $...$ (inline) and $$...$$ (display),
// typeset by KaTeX. Raw HTML in the Markdown is shown as text, never parsed:
// the validator forbids it, and this makes sure.
//
// Links may be https://…, lesson:<id> (another lesson of the same course) or
// node:<id> (a node on the map); the last two become in-app addresses.

import katex from 'katex'
import { Marked } from 'marked'

export interface LinkContext {
  /** The node the course hangs on, for lesson: links. */
  nodeId: string
}

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Math is lifted out before Markdown runs (so _ and * inside it are safe) and
// put back after, typeset. Code spans and fences are left alone.
const CODE = /(```[\s\S]*?```|`[^`\n]*`)/
const MATH = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g
const hole = (i: number) => `§§${i}§§`

export function typeset(tex: string, display: boolean, strict = false): string {
  return katex.renderToString(tex, { displayMode: display, throwOnError: strict, strict: strict ? 'error' : 'ignore', output: 'htmlAndMathml' })
}

function makeMarked(links: LinkContext | undefined) {
  return new Marked({
    gfm: true,
    async: false,
    renderer: {
      html: ({ text }) => escapeHtml(text),
    },
    walkTokens(token) {
      if (token.type !== 'link') return
      const href: string = token.href
      if (href.startsWith('lesson:') && links) token.href = `#${links.nodeId}/learn/${href.slice(7)}`
      else if (href.startsWith('node:')) token.href = `#${href.slice(5)}`
      else if (!/^https?:\/\//.test(href)) token.href = '#'
    },
  })
}

/** Markdown and maths to HTML. `inline` drops the paragraph wrapper (labels, buttons). */
export function renderMarkdown(text: string, options: { inline?: boolean; links?: LinkContext; strict?: boolean } = {}): string {
  const maths: string[] = []
  const lifted = text
    .split(CODE)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part.replace(MATH, (_, display: string | undefined, inline: string | undefined) => {
            maths.push(typeset((display ?? inline)!.trim(), display !== undefined, options.strict))
            return hole(maths.length - 1)
          }),
    )
    .join('')
  const marked = makeMarked(options.links)
  const html = (options.inline ? marked.parseInline(lifted) : marked.parse(lifted)) as string
  return html.replace(/§§(\d+)§§/g, (_, i: string) => maths[Number(i)])
}

/**
 * A label's maths as plain text for screen readers: "$\\|r\\|^2$ =" is "‖r‖²".
 * Covers what labels use (norms, powers, subscripts, a few Greek letters).
 */
export function plainLabel(label: string): string {
  const sub: Record<string, string> = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', k: 'ₖ' }
  const sup: Record<string, string> = { '2': '²', '3': '³' }
  return label
    .replace(/\\\|/g, '‖')
    .replace(/\\(lambda|sigma|cdot)/g, (_, name: string) => ({ lambda: 'λ', sigma: 'σ', cdot: '·' })[name]!)
    .replace(/\^\{?(\w)\}?/g, (m, c: string) => sup[c] ?? m)
    .replace(/_\{?(\w)\}?/g, (m, c: string) => sub[c] ?? m)
    .replace(/[${}]/g, '')
    .replace(/\s*[=≥]\s*$/, '')
    .trim()
}
