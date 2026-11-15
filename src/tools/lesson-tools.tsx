import { useMemo, useState } from 'react'
import { Calculator } from '../lesson/Calculator.tsx'
import { CalculatorIcon, PadIcon } from './icons.tsx'
import { ScratchPad } from './ScratchPad.tsx'
import type { Tool } from './ToolDock.tsx'
import type { CalcLine } from './calculator.ts'

const NO_LINES: CalcLine[] = []

/**
 * The tools a lesson offers, for the dock. The calculator's lines live here,
 * above the overlay, so closing it and opening it again finds them still
 * there (kept while the lesson is open, not stored). The pad keeps its own
 * strokes on the device. Add the cheat sheet and reading links to this list.
 */
export function useLessonTools(courseId: string, lessonId: string): Tool[] {
  // One tape per lesson: a new lesson starts with an empty one.
  const [tape, setTape] = useState<{ lessonId: string; lines: CalcLine[] }>({ lessonId, lines: [] })
  const lines = tape.lessonId === lessonId ? tape.lines : NO_LINES

  return useMemo(
    () => [
      {
        id: 'scratch',
        label: 'Scratch pad',
        icon: <PadIcon />,
        render: () => <ScratchPad key={`${courseId}:${lessonId}`} courseId={courseId} lessonId={lessonId} />,
      },
      {
        id: 'calculator',
        label: 'Calculator',
        icon: <CalculatorIcon />,
        render: () => <Calculator history={lines} onHistory={(next) => setTape({ lessonId, lines: next })} />,
      },
    ],
    [courseId, lessonId, lines],
  )
}
