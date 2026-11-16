import { useMemo, useState } from 'react'
import { ReadingList } from '../components/ReadingList.tsx'
import type { ChatStore, ChatTarget } from '../ai/chat-store.ts'
import { Calculator } from '../lesson/Calculator.tsx'
import type { Course } from '../lesson/types.ts'
import type { ReadingNode } from '../resources.ts'
import { Chat, Opened } from './Chat.tsx'
import { CheatSheet } from './CheatSheet.tsx'
import { AskIcon, BookIcon, CalculatorIcon, PadIcon, SheetIcon } from './icons.tsx'
import { ScratchPad } from './ScratchPad.tsx'
import type { Tool } from './ToolDock.tsx'
import type { CalcLine } from './calculator.ts'

const NO_LINES: CalcLine[] = []

/** The Ask tool's inputs: given only when the tutor's server answered. */
export interface AskOption {
  store: ChatStore
  target: ChatTarget
  about: string
  isStep: boolean
}

interface Options {
  course: Course
  lessonId: string
  /** Where the course's files are served, ending in a slash. */
  base: string
  /** The course's node and its ancestors that have reading, nearest first; none means no Reading tool. */
  reading?: { nodes: ReadingNode[]; base: string }
  /** The tutor for the screen the lesson is on; none means no Ask tool. */
  ask?: AskOption
  /** Called whenever a tool opens (the tutor's server is checked again if it was not there). */
  onOpen?: () => void
}

/**
 * The tools a lesson offers, for the dock. The calculator's lines live here,
 * above the overlay, so closing it and opening it again finds them still
 * there (kept while the lesson is open, not stored). The pad keeps its own
 * strokes on the device. The cheat sheet is offered only to a course that has
 * one (the published index says so), Reading only where the course's node or
 * an ancestor has links, Ask only when the tutor's server answered.
 */
export function useLessonTools({ course, lessonId, base, reading, ask, onOpen }: Options): Tool[] {
  // One tape per lesson: a new lesson starts with an empty one.
  const [tape, setTape] = useState<{ lessonId: string; lines: CalcLine[] }>({ lessonId, lines: [] })
  const lines = tape.lessonId === lessonId ? tape.lines : NO_LINES
  const courseId = course.id
  const hasSheet = course.cheatsheet === true
  const readingNodes = reading?.nodes
  const readingBase = reading?.base ?? ''

  return useMemo(() => {
    const tools: Tool[] = [
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
    ]
    if (hasSheet) {
      tools.push({
        id: 'cheatsheet',
        label: 'Cheat sheet',
        icon: <SheetIcon />,
        render: () => <CheatSheet courseId={courseId} lessonId={lessonId} base={base} />,
      })
    }
    if (readingNodes && readingNodes.length > 0) {
      tools.push({
        id: 'reading',
        label: 'Reading',
        icon: <BookIcon />,
        render: () => (
          <div className="reading-panel">
            <ReadingList nodes={readingNodes} base={readingBase} />
          </div>
        ),
      })
    }
    if (ask) {
      tools.push({
        id: 'ask',
        label: 'Ask',
        icon: <AskIcon />,
        render: () => <Chat key={ask.target.key} store={ask.store} target={ask.target} about={ask.about} isStep={ask.isStep} />,
      })
    }
    if (!onOpen) return tools
    return tools.map((tool) => ({
      ...tool,
      render: (close: () => void) => (
        <>
          <Opened onOpen={onOpen} />
          {tool.render(close)}
        </>
      ),
    }))
  }, [courseId, lessonId, base, hasSheet, lines, readingNodes, readingBase, ask, onOpen])
}
