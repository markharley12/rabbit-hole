import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Md } from './Md.tsx'
import { ORDER_REVEAL_AFTER, canMove, correctOrder, gradeOrder, initialOrder, move, orderValues, parseOrder } from './order.ts'
import type { OrderVerdict } from './order.ts'
import type { Attempt, StepRecord } from './progress.ts'
import { canShowAnswerAfterTries } from './reveal.ts'
import { newSeed } from './seed.ts'
import type { OrderBlock } from './types.ts'

interface Props {
  block: OrderBlock
  record: StepRecord | undefined
  onDraft: (values: Record<string, string>) => void
  onAttempt: (attempt: Attempt) => void
  onHint: () => void
  onReveal: () => void
  onNext: () => void
}

/**
 * An ordering puzzle for one thumb: every line has an up and a down button (no dragging needed).
 * A wrong Check marks the first line out of place, only that one; after three wrong tries the
 * answer is offered, and never shown unasked.
 */
export function OrderScreen({ block, record, onDraft, onAttempt, onHint, onReveal, onNext }: Props) {
  const [seed] = useState(() => record?.draft?.seed || newSeed())
  // The stored order if it still fits the block (content may have changed), else the seed's.
  const [order, setOrder] = useState<string[]>(() => parseOrder(block, record?.draft) ?? initialOrder(block, seed))
  const [verdict, setVerdict] = useState<OrderVerdict | null>(null)
  const [announce, setAnnounce] = useState('')
  const list = useRef<HTMLOListElement>(null)
  const refocus = useRef<{ id: string; direction: -1 | 1 } | null>(null)
  const feedback = useRef<HTMLDivElement>(null)

  const solved = record?.solved ?? false
  const revealed = record?.revealed ?? false
  const finished = solved || revealed
  const hints = record?.hints ?? 0
  const text = new Map(block.items.map((item) => [item.id, item.text]))
  const shown = finished ? correctOrder(block) : order

  // Save the order at once, so even an untouched puzzle opens the same way next time.
  const saved = useRef(!!record?.draft?.seed)
  useEffect(() => {
    if (saved.current) return
    saved.current = true
    onDraft(orderValues(order, seed))
  }, [order, seed, onDraft])

  useEffect(() => {
    if (verdict) feedback.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [verdict])

  // A moved row is re-inserted by the browser, which drops focus: put it back on the same button,
  // or on the other one when this one has just reached an end of the list.
  useLayoutEffect(() => {
    const target = refocus.current
    if (!target) return
    refocus.current = null
    const row = list.current?.querySelector(`[data-item="${target.id}"]`)
    const wanted = row?.querySelector<HTMLButtonElement>(`[data-direction="${target.direction}"]`)
    const other = row?.querySelector<HTMLButtonElement>(`[data-direction="${-target.direction}"]`)
    ;(wanted && !wanted.disabled ? wanted : other)?.focus()
  }, [order])

  const step = (id: string, direction: -1 | 1) => {
    if (finished || !canMove(block, order, id, direction)) return
    const next = move(block, order, id, direction)
    refocus.current = { id, direction }
    setOrder(next)
    setVerdict(null)
    setAnnounce(`Moved to position ${next.indexOf(id) + 1} of ${next.length}.`)
    onDraft(orderValues(next, seed))
  }

  const submit = () => {
    if (finished) return
    const result = gradeOrder(block, order)
    setVerdict(result)
    onAttempt({ at: new Date().toISOString(), values: orderValues(order, seed), result: result.status === 'correct' ? 'correct' : 'wrong' })
  }

  const canReveal = canShowAnswerAfterTries(record, ORDER_REVEAL_AFTER)
  const marked = verdict?.status === 'wrong' ? verdict.firstOut : undefined

  return (
    <>
      <div className="lesson-body">
        {block.title && <h2 className="screen-title">{block.title}</h2>}
        {block.why && <Md className="why" text={block.why} />}
        <Md className="prompt" text={block.prompt} />

        <ol className="order-list" aria-label="Lines to put in order" ref={list}>
          {shown.map((id, i) => {
            const fixed = block.fixed?.includes(id) ?? false
            const classes = ['order-row', fixed ? 'fixed' : '', id === marked ? 'off' : '', finished ? 'right' : '']
            return (
              <li key={id} className={classes.filter(Boolean).join(' ')} data-item={id}>
                <span className="order-pos" aria-hidden="true">
                  {i + 1}
                </span>
                <div className="order-text" id={`order-${block.id}-${id}`}>
                  <Md text={text.get(id) ?? ''} />
                  {fixed && <span className="order-given">Given: stays here</span>}
                  {id === marked && <span className="quiz-sr">Not in place yet.</span>}
                </div>
                <div className="order-buttons">
                  <button
                    type="button"
                    className="order-move"
                    data-direction="-1"
                    aria-label="Move up"
                    aria-describedby={`order-${block.id}-${id}`}
                    disabled={finished || fixed || !canMove(block, order, id, -1)}
                    onClick={() => step(id, -1)}
                  >
                    <span aria-hidden="true">↑</span>
                  </button>
                  <button
                    type="button"
                    className="order-move"
                    data-direction="1"
                    aria-label="Move down"
                    aria-describedby={`order-${block.id}-${id}`}
                    disabled={finished || fixed || !canMove(block, order, id, 1)}
                    onClick={() => step(id, 1)}
                  >
                    <span aria-hidden="true">↓</span>
                  </button>
                </div>
              </li>
            )
          })}
        </ol>
        <p className="quiz-sr" aria-live="polite" data-testid="order-announce">
          {announce}
        </p>

        <div className="feedback-live" role="status" ref={feedback}>
          {verdict?.status === 'wrong' && (
            <div className="feedback wrong">
              <p className="feedback-head">Not yet.</p>
              <Md text={verdict.say} />
            </div>
          )}
          {solved && (
            <div className="feedback right">
              <p className="feedback-head">Right: that is the order.</p>
            </div>
          )}
          {revealed && !solved && (
            <div className="feedback shown">
              <p className="feedback-head">That's the order. Worth coming back to.</p>
            </div>
          )}
        </div>
        {finished && block.solution && <Md className="solution" text={block.solution} />}

        {hints > 0 && !finished && block.hint && (
          <ol className="hints" aria-label="Hint">
            <li>
              <Md text={block.hint} />
            </li>
          </ol>
        )}
      </div>

      <footer className="lesson-action">
        {!finished && (block.hint || canReveal) && (
          <div className="secondary">
            {block.hint && hints === 0 && (
              <button className="text-button" onClick={onHint}>
                Hint
              </button>
            )}
            {canReveal && (
              <button className="text-button" onClick={onReveal}>
                Show the answer
              </button>
            )}
          </div>
        )}
        {finished ? (
          <button className="primary" onClick={onNext}>
            {block.next}
          </button>
        ) : (
          <button className="primary" onClick={submit}>
            Check
          </button>
        )}
      </footer>
    </>
  )
}
