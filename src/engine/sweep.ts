/** Sweeps as text, for the command line (docs/06 §6.8). No engine code is needed to read one. */

import type { ParamValue } from "../doc/types"

export type Variation = {
  label: string
  /** Project seed for this variation. */
  seed?: number
  /** Node id → parameter → value. */
  params?: Record<string, Record<string, ParamValue>>
}

const short = (value: number): string => String(Math.round(value * 10000) / 10000)

/** "0.2:0.6:5" is five values from 0.2 to 0.6; "1,2,4" is those three. */
export function sweepValues(spec: string): number[] {
  const text = spec.trim()
  const range = /^(-?[\d.]+):(-?[\d.]+):(\d+)$/.exec(text)
  let values: number[]
  if (range) {
    const [from, to, count] = [Number(range[1]), Number(range[2]), Number(range[3])]
    if (count < 1) throw new Error(`"${spec}" asks for no values.`)
    values = count === 1 ? [from] : Array.from({ length: count }, (_, i) => from + ((to - from) * i) / (count - 1))
  } else {
    values = text.split(",").map((part) => Number(part.trim()))
  }
  if (values.length === 0 || values.some((v) => !Number.isFinite(v))) throw new Error(`"${spec}" is not a list of numbers. Write from:to:count, for example 0.2:0.6:5, or values with commas.`)
  if (values.length > 64) throw new Error(`"${spec}" asks for ${values.length} values; 64 is the most.`)
  return values
}

/** "warp.intensity=0.2:0.6:5": one variation per value of one parameter. */
export function parseSweep(text: string): Variation[] {
  const match = /^([^.=\s]+)\.([^.=\s]+)=(.+)$/.exec(text.trim())
  if (!match) throw new Error(`"${text}" is not a sweep. Write node.param=from:to:count, for example n5.intensity=0.2:0.6:5.`)
  const [, nodeId, param, spec] = match
  return sweepValues(spec).map((value) => ({ label: `${param} ${short(value)}`, params: { [nodeId]: { [param]: Number(short(value)) } } }))
}
