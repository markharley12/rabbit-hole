import { useEffect, useRef, useState } from 'react'
import { AnswerFields } from './AnswerFields.tsx'
import { Calculator } from './Calculator.tsx'
import { check } from './check.ts'
import type { Verdict } from './check.ts'
import { Md } from './Md.tsx'
import type { Attempt, StepRecord } from './progress.ts'
import { canShowAnswer } from './reveal.ts'
import type { StepBlock } from './types.ts'
import { Widget } from '../widgets/Widget.tsx'

interface Props {
  block: StepBlock
  record: StepRecord | undefined
  onDraft: (values: Record<string, string>) => void
  onAttempt: (attempt: Attempt) => void
  onHint: () => void
  onReveal: () => void
  onNext: () => void
}

function Feedback({ verdict, block }: { verdict: Verdict; block: StepBlock }) {
  if (verdict.status === 'correct') {
    return (
      <div className="feedback right" role="status">
        <p className="feedback-head">Right.</p>
        {verdict.note && <Md text={verdict.note} />}
      </div>
    )
  }
  if (verdict.status === 'unreadable') {
    const field = block.answer.fields.find((f) => f.name === verdict.field)
    const which = block.answer.fields.length > 1 ? ` ${field?.label ? field.label.replace(/=\s*$/, '').trim() : 'one box'}` : ''
    return (
      <div className="feedback unreadable" role="status">
        <p className="feedback-head">
          I can't read{which ? <Md text={which} inline /> : ' that'}: {verdict.reason}.
        </p>
        <p className="feedback-tip">Fractions and roots are fine: 3/5, sqrt(15), 2.5.</p>
      </div>
    )
  }
  if (verdict.status === 'wrong') {
    return (
      <div className="feedback wrong" role="status">
        <p className="feedback-head">Not yet.</p>
        {verdict.message ? <Md text={verdict.message} /> : <p>{block.answer.fields.length > 1 ? 'Check each box again' : 'Check it again'}, or take a hint.</p>}
      </div>
    )
  }
  return null
}

/**
 * One step: what the words mean, why it matters, one task, the answer boxes,
 * and exactly one main button (Check, then the step's `next`). Hints come one
 * at a time; the answer is offered only after all three and a further try.
 */
export function StepScreen({ block, record, onDraft, onAttempt, onHint, onReveal, onNext }: Props) {
  const { answer } = block
  const [values, setValues] = useState<Record<string, string>>(() => record?.draft ?? {})
  const [verdict, setVerdict] = useState<Verdict | null>(null)
  const [checking, setChecking] = useState(false)
  const feedback = useRef<HTMLDivElement>(null)
  const selfCheck = useRef<HTMLElement>(null)

  const solved = record?.solved ?? false
  const revealed = record?.revealed ?? false
  const finished = solved || revealed
  const hints = record?.hints ?? 0
  const complete = answer.fields.every((field) => values[field.name]?.trim())

  useEffect(() => {
    if (verdict) feedback.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [verdict])

  // The panel opens below the answer; bring it into view, or the button seems to do nothing.
  useEffect(() => {
    if (checking) selfCheck.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
  }, [checking])

  const change = (name: string, value: string) => {
    const next = { ...values, [name]: value }
    setValues(next)
    setVerdict(null)
    onDraft(next)
  }

  const submit = () => {
    if (finished || !complete) return
    const result = check(answer, values)
    setVerdict(result)
    if (result.status === 'incomplete') return
    onAttempt({
      at: new Date().toISOString(),
      values,
      result: result.status === 'correct' ? 'correct' : result.status === 'wrong' ? 'wrong' : 'unreadable',
      slip: result.status === 'correct' ? (result.via === 'key' ? undefined : result.via) : result.status === 'wrong' ? result.slip : undefined,
    })
  }

  const reveal = () => {
    const keys = Object.fromEntries(answer.fields.map((field) => [field.name, field.key]))
    setValues(keys)
    setVerdict(null)
    onReveal()
  }

  const shown = revealed && !solved ? Object.fromEntries(answer.fields.map((field) => [field.name, field.key])) : values
  const canReveal = canShowAnswer(record)

  return (
    <>
      <div className="lesson-body">
        {block.title && <h2 className="screen-title">{block.title}</h2>}
        {block.define?.map((item) => (
          <div className="define" key={item.term}>
            <p className="define-term">{item.term}</p>
            <Md text={item.meaning} />
          </div>
        ))}
        <Md className="why" text={block.why} />
        <Md className="prompt" text={block.prompt} />
        {block.widget && <Widget widget={block.widget} />}

        <div className="answer">
          <AnswerFields
            answer={answer}
            values={shown}
            off={verdict?.status === 'wrong' ? verdict.off : []}
            disabled={finished}
            onChange={change}
            onSubmit={submit}
          />
        </div>

        <div ref={feedback}>
          {verdict && <Feedback verdict={verdict} block={block} />}
          {!verdict && solved && (
            <div className="feedback right" role="status">
              <p className="feedback-head">Done: you got this one.</p>
            </div>
          )}
          {revealed && !solved && (
            <div className="feedback shown" role="status">
              <p className="feedback-head">That's the answer. Worth redoing on paper later.</p>
            </div>
          )}
          {finished && block.solution && <Md className="solution" text={block.solution} />}
        </div>

        {hints > 0 && !finished && (
          <ol className="hints" aria-label="Hints">
            {block.hints.slice(0, hints).map((hint, i) => (
              <li key={i}>
                <Md text={hint} />
              </li>
            ))}
          </ol>
        )}

        {checking && (
          <section className="self-check" aria-label="Check it yourself" ref={selfCheck}>
            {block.check && <Md text={block.check.say} />}
            <Calculator />
            {block.check?.widget && <Widget widget={block.check.widget} />}
          </section>
        )}
      </div>

      <footer className="lesson-action">
        {!finished && (
          <div className="secondary">
            {hints < 3 && (
              <button className="text-button" onClick={onHint}>
                {hints === 0 ? 'Hint' : 'Another hint'}
              </button>
            )}
            {canReveal && (
              <button className="text-button" onClick={reveal}>
                Show the answer
              </button>
            )}
            <button className="text-button" onClick={() => setChecking(!checking)} aria-expanded={checking}>
              {checking ? 'Hide the check' : 'Check it yourself'}
            </button>
          </div>
        )}
        {finished ? (
          <button className="primary" onClick={onNext}>
            {block.next}
          </button>
        ) : (
          <button className="primary" onClick={submit} disabled={!complete}>
            Check
          </button>
        )}
      </footer>
    </>
  )
}
