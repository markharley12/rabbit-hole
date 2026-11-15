// Checking a typed answer, and naming the slip when it is wrong.
//
// Everything here is deterministic: Mark's errors in the seed chat were all
// mechanical (an Aᵀ written transposed, an AᵀA that wasn't symmetric, sum
// slips, a factor applied to one term only, a sign convention flip), and each
// of those can be named by code. The detectors are the ones a step lists in
// `answer.slips`; "which entries are off" is always on.

import { decimalPlaces, evaluate, parse, ParseError } from './expr.ts'
import type { Node } from './expr.ts'
import type { AcceptRule, Answer } from './types.ts'

export type Verdict =
  | { status: 'incomplete'; missing: string[] }
  | { status: 'unreadable'; field: string; reason: string }
  | { status: 'correct'; via: 'key' | AcceptRule; note?: string }
  | { status: 'wrong'; slip?: string; message?: string; off: string[] }

// Where an answer with variables is compared: distinct, irregular points, so
// two different polynomials of low degree cannot agree on all of them.
const SAMPLES = [0.7, -1.3, 2.9, 0.35, -2.2, 1.7]

interface Value {
  /** One number per sample point (one in all for a plain number). */
  at: number[]
  tol: number
  raw: string
}

function environments(vars: readonly string[]): Record<string, number>[] {
  if (vars.length === 0) return [{}]
  return SAMPLES.map((_, s) => Object.fromEntries(vars.map((name, v) => [name, SAMPLES[(s + 2 * v) % SAMPLES.length] + v / 7])))
}

const values = (node: Node, envs: Record<string, number>[]) => envs.map((env) => evaluate(node, env))

// `tol` is absolute (a typed decimal's last place); on top of that, a tiny
// relative allowance for floating point.
const close = (a: number[], b: number[], tol: number) => a.every((x, i) => Math.abs(x - b[i]) <= Math.max(tol, 1e-9 * Math.max(1, Math.abs(b[i]))))

/** A short exact-looking form for a factor: 2, -1/2, 15, else 3 significant figures. */
export function nice(x: number): string {
  for (let q = 1; q <= 30; q++) {
    const p = Math.round(x * q)
    if (Math.abs(p / q - x) < 1e-9) return q === 1 ? `${p}` : `${p}/${q}`
  }
  return x.toPrecision(3)
}

/** Compare typed answers with the keys; on a miss, name the slip if a detector sees one. */
export function check(answer: Answer, inputs: Record<string, string | undefined>): Verdict {
  const vars = answer.vars ?? []
  const envs = environments(vars)
  const missing = answer.fields.filter((field) => !inputs[field.name]?.trim()).map((field) => field.name)
  if (missing.length) return { status: 'incomplete', missing }

  const typed: Value[] = []
  for (const field of answer.fields) {
    const raw = inputs[field.name]!.trim()
    try {
      const at = values(parse(raw, vars), envs)
      if (at.some((x) => !Number.isFinite(x))) return { status: 'unreadable', field: field.name, reason: "that doesn't come out as a number" }
      const places = vars.length ? null : decimalPlaces(raw)
      // A decimal with two or more places counts if it is the key rounded or
      // cut off there (3.87 for √15); otherwise the match must be exact.
      typed.push({ at, raw, tol: places !== null && places >= 2 ? 10 ** -places : 0 })
    } catch (error) {
      if (error instanceof ParseError) return { status: 'unreadable', field: field.name, reason: error.message }
      throw error
    }
  }
  const keys = answer.fields.map((field) => values(parse(field.key, vars), envs))

  const matches = (scale: number) => typed.every((u, i) => close(u.at, keys[i].map((k) => k * scale), u.tol))
  if (matches(1)) return { status: 'correct', via: 'key' }
  const accept = answer.accept ?? []
  if (accept.includes('negated') && matches(-1)) return { status: 'correct', via: 'negated', note: answer.acceptNote }
  const factor = ratio(typed, keys)
  if (accept.includes('multiple') && factor !== null && factor !== 0 && matches(factor)) {
    return { status: 'correct', via: 'multiple', note: answer.acceptNote }
  }

  const off = answer.fields.filter((_, i) => !close(typed[i].at, keys[i], typed[i].tol)).map((field) => field.name)
  const numeric = vars.length === 0
  const u = typed.map((value) => value.at[0])
  const k = keys.map((value) => value[0])
  const shape = answer.matrix

  for (const slip of answer.slips ?? []) {
    const name = 'name' in slip && slip.name ? slip.name : 'it'
    if (slip.detect === 'known') {
      const hit = Object.entries(slip.when).every(([fieldName, wrong]) => {
        const i = answer.fields.findIndex((field) => field.name === fieldName)
        return i >= 0 && close(typed[i].at, values(parse(wrong, vars), envs), typed[i].tol)
      })
      if (hit) return { status: 'wrong', slip: 'known', message: slip.say, off }
      continue
    }
    if (!numeric) continue
    if (slip.detect === 'sign' && matches(-1)) {
      return {
        status: 'wrong',
        slip: 'sign',
        message: answer.fields.length > 1 ? 'Right sizes, but every sign is flipped. Check which way round you subtracted.' : 'Right size, wrong sign.',
        off,
      }
    }
    if (slip.detect === 'transpose' && shape && isTranspose(u, k, shape)) {
      return { status: 'wrong', slip: 'transpose', message: `Rows and columns are swapped: that's the transpose of ${name}.`, off }
    }
    if (slip.detect === 'swapped' && answer.fields.length === 2 && close([u[0]], [k[1]], typed[0].tol) && close([u[1]], [k[0]], typed[1].tol)) {
      const [a, b] = answer.fields.map((field) => field.name)
      return { status: 'wrong', slip: 'swapped', message: `The right numbers, in the wrong boxes: ${a} and ${b} are swapped.`, off }
    }
    if (slip.detect === 'scaled' && factor !== null && factor !== 0 && Math.abs(factor) !== 1 && matches(factor)) {
      return {
        status: 'wrong',
        slip: 'scaled',
        message: `Every entry is off by the same factor (yours are ×${nice(factor)} the right ones). Check the number out front.`,
        off,
      }
    }
    if (slip.detect === 'symmetric' && shape && shape[0] === shape[1]) {
      const pair = asymmetry(u, shape[0])
      if (pair) {
        const [i, j] = pair
        const n = shape[0]
        return {
          status: 'wrong',
          slip: 'symmetric',
          message: `${name} equals its own transpose, so row ${i + 1}, column ${j + 1} and row ${j + 1}, column ${i + 1} should match. You have ${typed[i * n + j].raw} and ${typed[j * n + i].raw}.`,
          off,
        }
      }
    }
  }

  return { status: 'wrong', message: whichAreOff(answer, off), off }
}

/** The λ with typed ≈ λ·key, read off the largest key entry; null if there is none. */
function ratio(typed: Value[], keys: number[][]): number | null {
  let best = -1
  let largest = 0
  keys.forEach((key, i) => {
    const size = Math.max(...key.map(Math.abs))
    if (size > largest) {
      largest = size
      best = i
    }
  })
  if (best < 0 || largest < 1e-12) return null
  const s = keys[best].findIndex((x) => Math.abs(x) === largest)
  return typed[best].at[s] / keys[best][s]
}

function isTranspose(u: number[], k: number[], [rows, cols]: [number, number]) {
  if (rows !== cols) return false
  let symmetric = true
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      if (Math.abs(u[i * cols + j] - k[j * cols + i]) > 1e-9 * Math.max(1, Math.abs(k[j * cols + i]))) return false
      if (Math.abs(k[i * cols + j] - k[j * cols + i]) > 1e-12) symmetric = false
    }
  }
  // The transpose of a symmetric key is the key itself: that is not a slip.
  return !symmetric
}

function asymmetry(u: number[], n: number): [number, number] | null {
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(u[i * n + j] - u[j * n + i]) > 1e-9 * Math.max(1, Math.abs(u[i * n + j]))) return [i, j]
    }
  }
  return null
}

/** "Row 1, column 2 is off; the rest are right", when some but not all are. */
function whichAreOff(answer: Answer, off: string[]): string | undefined {
  const total = answer.fields.length
  if (total < 2 || off.length === 0 || off.length === total) return undefined
  const index = (name: string) => answer.fields.findIndex((field) => field.name === name)
  let names: string[]
  if (answer.matrix) {
    const cols = answer.matrix[1]
    names = off.map((name) => `row ${Math.floor(index(name) / cols) + 1}, column ${(index(name) % cols) + 1}`)
  } else if (answer.fields.every((field) => /^[a-z]+\d+$/.test(field.name))) {
    names = off.map((name) => `entry ${index(name) + 1}`)
  } else {
    names = off
  }
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  // Field names are variables (c, m) and keep their case; "row"/"entry" start a sentence.
  const capital = names === off ? list : list[0].toUpperCase() + list.slice(1)
  const rest = total - off.length === 1 ? 'the other one is right' : 'the rest are right'
  return `${capital} ${off.length === 1 ? 'is' : 'are'} off; ${rest}.`
}
