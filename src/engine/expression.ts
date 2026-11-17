/**
 * A small calculator for the Value Expression node: numbers, names, + - * / % ^,
 * brackets and a fixed set of functions. Nothing here can run code, so text
 * from a project file or an agent is safe to evaluate.
 */

export class ExpressionError extends Error {}

type Fn = { args: [number, number]; run: (...v: number[]) => number }

const turn = Math.PI * 2
const FUNCTIONS: Record<string, Fn> = {
  sin: { args: [1, 1], run: (x) => Math.sin(x * turn) },
  cos: { args: [1, 1], run: (x) => Math.cos(x * turn) },
  abs: { args: [1, 1], run: Math.abs },
  floor: { args: [1, 1], run: Math.floor },
  ceil: { args: [1, 1], run: Math.ceil },
  round: { args: [1, 1], run: Math.round },
  fract: { args: [1, 1], run: (x) => x - Math.floor(x) },
  sqrt: { args: [1, 1], run: (x) => Math.sqrt(Math.max(x, 0)) },
  sign: { args: [1, 1], run: Math.sign },
  min: { args: [2, 8], run: Math.min },
  max: { args: [2, 8], run: Math.max },
  pow: { args: [2, 2], run: Math.pow },
  mod: { args: [2, 2], run: (a, b) => (b === 0 ? 0 : a - b * Math.floor(a / b)) },
  step: { args: [2, 2], run: (edge, x) => (x >= edge ? 1 : 0) },
  clamp: { args: [3, 3], run: (x, lo, hi) => Math.min(Math.max(x, lo), hi) },
  lerp: { args: [3, 3], run: (a, b, t) => a + (b - a) * t },
  smoothstep: {
    args: [3, 3],
    run: (lo, hi, x) => {
      const t = hi === lo ? (x >= hi ? 1 : 0) : Math.min(Math.max((x - lo) / (hi - lo), 0), 1)
      return t * t * (3 - 2 * t)
    }
  },
  // 0 → 1 → 0 over one unit: a loop-safe pulse.
  ping: { args: [1, 1], run: (x) => 1 - Math.abs(2 * (x - Math.floor(x)) - 1) }
}

export const EXPRESSION_FUNCTIONS = Object.keys(FUNCTIONS)

const MAX_LENGTH = 500

/** Evaluates `text` with the given names. Throws ExpressionError with a plain message. */
export function evaluateExpression(text: string, names: Record<string, number>): number {
  if (text.length > MAX_LENGTH) throw new ExpressionError(`The expression is longer than ${MAX_LENGTH} characters.`)
  let at = 0
  let depth = 0

  const skip = (): void => {
    while (at < text.length && /\s/.test(text[at])) at++
  }
  const take = (symbol: string): boolean => {
    skip()
    if (text.startsWith(symbol, at)) {
      at += symbol.length
      return true
    }
    return false
  }
  const fail = (message: string): never => {
    throw new ExpressionError(message)
  }

  function primary(): number {
    skip()
    if (take("(")) {
      if (++depth > 40) fail("Too many brackets inside each other.")
      const value = sum()
      if (!take(")")) fail("A bracket is not closed.")
      depth--
      return value
    }
    const number = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(text.slice(at))
    if (number) {
      at += number[0].length
      return Number(number[0])
    }
    const word = /^[a-z_][a-z0-9_]*/i.exec(text.slice(at))
    if (!word) return fail(at >= text.length ? "The expression ends too soon." : `"${text[at]}" is not expected here.`)
    at += word[0].length
    const name = word[0].toLowerCase()
    if (take("(")) {
      const fn = Object.hasOwn(FUNCTIONS, name) ? FUNCTIONS[name] : fail(`There is no function called "${name}". Functions: ${EXPRESSION_FUNCTIONS.join(", ")}.`)
      if (++depth > 40) fail("Too many brackets inside each other.")
      const args: number[] = []
      if (!take(")")) {
        do args.push(sum())
        while (take(","))
        if (!take(")")) fail(`The bracket of ${name}( is not closed.`)
      }
      depth--
      if (args.length < fn.args[0] || args.length > fn.args[1]) {
        fail(`${name} takes ${fn.args[0] === fn.args[1] ? fn.args[0] : `${fn.args[0]} to ${fn.args[1]}`} value${fn.args[1] === 1 ? "" : "s"}, not ${args.length}.`)
      }
      return fn.run(...args)
    }
    if (!Object.hasOwn(names, name)) fail(`"${name}" is not known. Names: ${Object.keys(names).join(", ")}.`)
    return names[name]
  }
  function unary(): number {
    if (take("-")) return -unary()
    if (take("+")) return unary()
    return power()
  }
  function power(): number {
    const base = primary()
    return take("^") ? Math.pow(base, unary()) : base
  }
  function product(): number {
    let value = unary()
    for (;;) {
      if (take("*")) value *= unary()
      else if (take("/")) {
        const by = unary()
        value = by === 0 ? 0 : value / by
      } else if (take("%")) {
        const by = unary()
        value = by === 0 ? 0 : value - by * Math.floor(value / by)
      } else return value
    }
  }
  function sum(): number {
    let value = product()
    for (;;) {
      if (take("+")) value += product()
      else if (take("-")) value -= product()
      else return value
    }
  }

  const result = sum()
  skip()
  if (at < text.length) fail(`"${text[at]}" is not expected here.`)
  return Number.isFinite(result) ? result : 0
}
