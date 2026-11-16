import { useEffect, useId, useRef, useState } from 'react'
import { CHOICE_REVEAL_AFTER, choiceValues, gradeChoice, parsePicked, partialLine, shownOptions, toggle } from './choice.ts'
import type { ChoiceVerdict } from './choice.ts'
import { Md } from './Md.tsx'
import type { Attempt, StepRecord } from './progress.ts'
import { canShowAnswerAfterTries } from './reveal.ts'
import { newSeed } from './seed.ts'
import type { ChoiceBlock } from './types.ts'
import { Widget } from '../widgets/Widget.tsx'

interface Props {
  block: ChoiceBlock
  record: StepRecord | undefined
  onDraft: (values: Record<string, string>) => void
  onAttempt: (attempt: Attempt) => void
  onHint: () => void
  onReveal: () => void
  onNext: () => void
}

const letter = (i: number) => String.fromCharCode(65 + i)

/**
 * One quiz question: the options as large rows (radio buttons, or checkboxes when several are
 * right), one Check button, then the block's `next`. A wrong pick says why that option is wrong;
 * the answer is offered only after two wrong tries, and never shown unasked.
 */
export function ChoiceScreen({ block, record, onDraft, onAttempt, onHint, onReveal, onNext }: Props) {
  // The seed is kept with the draft, so the order survives a re-render and a reload.
  const [seed] = useState(() => record?.draft?.seed || newSeed())
  const [picked, setPicked] = useState<string[]>(() => parsePicked(block, record?.draft))
  const [verdict, setVerdict] = useState<ChoiceVerdict | null>(null)
  const feedback = useRef<HTMLDivElement>(null)
  const group = useId()

  const solved = record?.solved ?? false
  const revealed = record?.revealed ?? false
  const finished = solved || revealed
  const hints = record?.hints ?? 0
  const options = shownOptions(block, seed)
  const multiple = block.multiple === true

  // Save the seed at once, so even an untouched screen opens in the same order next time.
  const saved = useRef(!!record?.draft?.seed)
  useEffect(() => {
    if (saved.current) return
    saved.current = true
    onDraft(choiceValues(block, picked, seed))
  }, [block, picked, seed, onDraft])

  useEffect(() => {
    if (verdict) feedback.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [verdict])

  const pick = (id: string) => {
    if (finished) return
    const next = toggle(block, picked, id)
    setPicked(next)
    setVerdict(null)
    onDraft(choiceValues(block, next, seed))
  }

  const submit = () => {
    if (finished || picked.length === 0) return
    const result = gradeChoice(block, picked)
    setVerdict(result)
    onAttempt({ at: new Date().toISOString(), values: choiceValues(block, picked, seed), result: result.status === 'correct' ? 'correct' : 'wrong' })
  }

  // Once done, the right options show as ticked whatever was picked.
  const ticked = new Set(finished ? block.options.filter((o) => o.correct).map((o) => o.id) : picked)
  const off = new Set(verdict?.status === 'wrong' ? verdict.wrong.map((o) => o.id) : [])
  const canReveal = canShowAnswerAfterTries(record, CHOICE_REVEAL_AFTER)
  const partial = verdict ? partialLine(block, verdict) : undefined

  return (
    <>
      <div className="lesson-body">
        {block.title && <h2 className="screen-title">{block.title}</h2>}
        {block.why && <Md className="why" text={block.why} />}
        <Md className="prompt" text={block.prompt} />
        {block.widget && <Widget widget={block.widget} />}

        <div className="options" role={multiple ? 'group' : 'radiogroup'} aria-label={multiple ? 'Options: tick every right one' : 'Options: pick one'}>
          {options.map((option, i) => {
            const classes = ['option', ticked.has(option.id) ? 'picked' : '', off.has(option.id) ? 'off' : '', finished && option.correct ? 'right' : '']
            return (
              <label key={option.id} className={classes.filter(Boolean).join(' ')}>
                <input
                  type={multiple ? 'checkbox' : 'radio'}
                  name={group}
                  className="option-input"
                  checked={ticked.has(option.id)}
                  disabled={finished}
                  onChange={() => pick(option.id)}
                />
                <span className="option-mark" aria-hidden="true">
                  {finished && option.correct ? '✓' : off.has(option.id) ? '✕' : letter(i)}
                </span>
                <Md className="option-text" text={option.text} />
              </label>
            )
          })}
        </div>

        <div className="feedback-live" role="status" ref={feedback}>
          {verdict?.status === 'wrong' && (
            <div className="feedback wrong">
              <p className="feedback-head">Not yet.</p>
              {partial && <p>{partial}</p>}
              <ul className="says">
                {verdict.wrong.map((option) => (
                  <li key={option.id}>
                    <span className="say-letter">{letter(options.findIndex((o) => o.id === option.id))}</span>
                    <Md text={option.say} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          {solved && (
            <div className="feedback right">
              <p className="feedback-head">Right.</p>
            </div>
          )}
          {revealed && !solved && (
            <div className="feedback shown">
              <p className="feedback-head">That's the answer. Worth coming back to.</p>
            </div>
          )}
        </div>

        {finished && (
          <>
            <ul className="option-notes" aria-label="Why each option is right or wrong">
              {options.map((option, i) => (
                <li key={option.id} className={option.correct ? 'right' : ''}>
                  <span className="note-head">
                    {letter(i)}. {option.correct ? 'Right.' : 'Not this one.'}
                  </span>
                  <Md text={option.say} />
                </li>
              ))}
            </ul>
            {block.solution && <Md className="solution" text={block.solution} />}
          </>
        )}

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
          <button className="primary" onClick={submit} disabled={picked.length === 0}>
            Check
          </button>
        )}
      </footer>
    </>
  )
}
