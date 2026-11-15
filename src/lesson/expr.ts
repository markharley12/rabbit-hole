// The answer grammar: what can be typed into an answer box, and what answer
// keys are written in. tools/validate_courses.py parses the same grammar into
// sympy, so a key means the same thing on both sides.
//
//   numbers      2   -3   0.6   .5   3/5
//   operators    + - * / ^ and implicit multiplication: 2m, 3(1 - m), 2sqrt(5)
//   functions    sqrt(x), or √x / √(x)
//   variables    single letters the step declares (e.g. m in 3 - 2m)
//
// Phone keyboards produce other characters for the same things, so − × · ÷ ²
// ³ and ** are read as - * * / ^2 ^3 ^. Nothing is evaluated with eval().

export type Node =
  | { kind: 'num'; value: number }
  | { kind: 'var'; name: string }
  | { kind: 'neg'; arg: Node }
  | { kind: 'bin'; op: '+' | '-' | '*' | '/' | '^'; left: Node; right: Node }
  | { kind: 'sqrt'; arg: Node }

export class ParseError extends Error {}

type Token = { t: 'num'; v: number } | { t: 'id'; v: string } | { t: 'op'; v: string }

/** Phone and maths characters to the plain grammar. */
export function normalise(text: string): string {
  return text
    .replace(/[−–—]/g, '-')
    .replace(/[×·⋅∙]/g, '*')
    .replace(/÷/g, '/')
    .replace(/\*\*/g, '^')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .replace(/,/g, '.')
    .trim()
}

function tokenise(text: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (/\s/.test(ch)) {
      i++
    } else if (/[0-9.]/.test(ch)) {
      const match = /^(\d+\.?\d*|\.\d+)/.exec(text.slice(i))
      if (!match) throw new ParseError(`can't read the number at "${text.slice(i)}"`)
      tokens.push({ t: 'num', v: Number(match[1]) })
      i += match[1].length
    } else if (/[A-Za-z]/.test(ch)) {
      const match = /^[A-Za-z]+/.exec(text.slice(i))!
      tokens.push({ t: 'id', v: match[0] })
      i += match[0].length
    } else if ('+-*/^()√'.includes(ch)) {
      tokens.push({ t: 'op', v: ch })
      i++
    } else {
      throw new ParseError(`"${ch}" isn't something I can read`)
    }
  }
  return tokens
}

/** Parse an answer. `vars` are the letters that may appear; anything else is an error. */
export function parse(text: string, vars: readonly string[] = []): Node {
  const tokens = tokenise(normalise(text))
  if (tokens.length === 0) throw new ParseError('empty')
  let at = 0
  const peek = () => tokens[at]
  const isOp = (v: string) => peek()?.t === 'op' && peek()!.v === v
  const expect = (v: string) => {
    if (!isOp(v)) throw new ParseError(`expected "${v}"`)
    at++
  }

  // A multi-letter run is a function name or a product of single-letter
  // variables (so "cm" is c·m), never an unknown name passed through quietly.
  const identifier = (name: string): Node => {
    if (name === 'sqrt') {
      const arg = isOp('(') ? (at++, parseSum()) : null
      if (!arg) throw new ParseError('sqrt needs brackets: sqrt(5)')
      expect(')')
      return { kind: 'sqrt', arg }
    }
    const letters = [...name].map((letter): Node => {
      if (!vars.includes(letter)) {
        throw new ParseError(vars.length ? `only ${vars.join(', ')} can appear here, not "${letter}"` : `"${name}" isn't a number`)
      }
      return { kind: 'var', name: letter }
    })
    return letters.reduce((left, right) => ({ kind: 'bin', op: '*', left, right }))
  }

  const parseAtom = (): Node => {
    const token = peek()
    if (!token) throw new ParseError('it ends too early')
    if (token.t === 'num') {
      at++
      return { kind: 'num', value: token.v }
    }
    if (token.t === 'id') {
      at++
      return identifier(token.v)
    }
    if (token.v === '(') {
      at++
      const inner = parseSum()
      expect(')')
      return inner
    }
    if (token.v === '√') {
      at++
      return { kind: 'sqrt', arg: parsePower() }
    }
    throw new ParseError(`"${token.v}" can't go there`)
  }

  const parsePower = (): Node => {
    const base = parseAtom()
    if (isOp('^')) {
      at++
      return { kind: 'bin', op: '^', left: base, right: parseUnary() }
    }
    return base
  }

  const parseUnary = (): Node => {
    if (isOp('-')) {
      at++
      return { kind: 'neg', arg: parseUnary() }
    }
    if (isOp('+')) {
      at++
      return parseUnary()
    }
    return parsePower()
  }

  // Implicit multiplication: a factor followed directly by a name, a bracket
  // or a root (2m, 3(1 - m), 2√5). Two numbers side by side are an error.
  const startsFactor = () => {
    const token = peek()
    return !!token && (token.t === 'id' || (token.t === 'op' && (token.v === '(' || token.v === '√')))
  }

  const parseProduct = (): Node => {
    let left = parseUnary()
    for (;;) {
      if (isOp('*') || isOp('/')) {
        const op = peek()!.v as '*' | '/'
        at++
        left = { kind: 'bin', op, left, right: parseUnary() }
      } else if (startsFactor()) {
        left = { kind: 'bin', op: '*', left, right: parsePower() }
      } else {
        return left
      }
    }
  }

  const parseSum = (): Node => {
    let left = parseProduct()
    while (isOp('+') || isOp('-')) {
      const op = peek()!.v as '+' | '-'
      at++
      left = { kind: 'bin', op, left, right: parseProduct() }
    }
    return left
  }

  const tree = parseSum()
  if (at < tokens.length) {
    const token = tokens[at]
    throw new ParseError(token.t === 'num' ? 'two numbers next to each other' : `"${token.v}" can't go there`)
  }
  return tree
}

export function evaluate(node: Node, env: Record<string, number> = {}): number {
  switch (node.kind) {
    case 'num':
      return node.value
    case 'var': {
      const value = env[node.name]
      if (value === undefined) throw new ParseError(`no value for ${node.name}`)
      return value
    }
    case 'neg':
      return -evaluate(node.arg, env)
    case 'sqrt':
      return Math.sqrt(evaluate(node.arg, env))
    case 'bin': {
      const a = evaluate(node.left, env)
      const b = evaluate(node.right, env)
      if (node.op === '+') return a + b
      if (node.op === '-') return a - b
      if (node.op === '*') return a * b
      if (node.op === '/') return a / b
      return a ** b
    }
  }
}

/** Decimal places when the text is a plain decimal (0.33, -1.25), else null. */
export function decimalPlaces(text: string): number | null {
  const match = /^[-+]?\d*\.(\d+)$/.exec(normalise(text).replace(/\s/g, ''))
  return match ? match[1].length : null
}

/** Parse and evaluate a number with no variables. */
export function numberOf(text: string): number {
  return evaluate(parse(text))
}
