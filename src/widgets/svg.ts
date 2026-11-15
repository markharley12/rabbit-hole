// Small helpers shared by the widgets' SVG pictures.

import type { PointerEvent as ReactPointerEvent } from 'react'

/** A pointer's position in the SVG's viewBox units (the SVG scales to its width). */
export function pointerIn(event: ReactPointerEvent<Element>, svg: SVGSVGElement | null): [number, number] | null {
  if (!svg) return null
  const rect = svg.getBoundingClientRect()
  const box = svg.viewBox.baseVal
  if (!rect.width || !rect.height || !box) return null
  return [box.x + ((event.clientX - rect.left) * box.width) / rect.width, box.y + ((event.clientY - rect.top) * box.height) / rect.height]
}

/** −2.50 rather than -2.5: a fixed number of places and a real minus sign. */
export function fmt(value: number, places = 2): string {
  const text = (Math.abs(value) < 0.5 * 10 ** -places ? 0 : value).toFixed(places)
  return text.startsWith('-') ? `−${text.slice(1)}` : text
}

/** A linear map from data to viewBox coordinates. */
export function scale(domain: [number, number], range: [number, number]) {
  const k = (range[1] - range[0]) / (domain[1] - domain[0])
  const to = (x: number) => range[0] + (x - domain[0]) * k
  const from = (y: number) => domain[0] + (y - range[0]) / k
  return { to, from }
}
