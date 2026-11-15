import { useContext, useMemo } from 'react'
import { LinksContext } from './links-context.ts'
import { renderMarkdown } from './markdown.ts'

interface Props {
  text: string
  inline?: boolean
  className?: string
}

/** Lesson Markdown and maths. The HTML comes from renderMarkdown, which escapes raw HTML. */
export function Md({ text, inline, className }: Props) {
  const links = useContext(LinksContext)
  const html = useMemo(() => renderMarkdown(text, { inline, links }), [text, inline, links])
  const Tag = inline ? 'span' : 'div'
  return <Tag className={className ? `md ${className}` : 'md'} dangerouslySetInnerHTML={{ __html: html }} />
}
