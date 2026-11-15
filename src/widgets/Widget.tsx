import { Component } from 'react'
import type { ReactNode } from 'react'
import { Md } from '../lesson/Md.tsx'
import type { WidgetRef } from '../lesson/types.ts'
import { registry } from './registry.ts'

/** A widget that throws shows a note instead of taking the lesson down with it. */
class Contained extends Component<{ name: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? <p className="widget-missing">The {this.props.name} picture hit a problem; the step still works without it.</p> : this.props.children
  }
}

/** A named widget from the library, with its params and caption. */
export function Widget({ widget }: { widget: WidgetRef }) {
  const Found = registry[widget.name]
  return (
    <figure className="widget">
      {Found ? (
        <Contained name={widget.name}>
          <Found params={(widget.params ?? {}) as never} />
        </Contained>
      ) : (
        <p className="widget-missing">This needs the “{widget.name}” picture, which this version of the app doesn't have.</p>
      )}
      {widget.caption && (
        <figcaption>
          <Md text={widget.caption} />
        </figcaption>
      )}
    </figure>
  )
}
