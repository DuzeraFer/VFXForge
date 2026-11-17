/** Panel sizing rules for the shell (docs/02-design-language.md §2.3). */

export const LEFT_PANEL = { initial: 232, min: 180, max: 420 } as const
export const RIGHT_COLUMN = { initial: 360, min: 280, max: 640 } as const
/** Preview height as a fraction of the right column. */
export const PREVIEW_SPLIT = { initial: 0.46, min: 0.25, max: 0.8 } as const

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min
  return Math.min(max, Math.max(min, value))
}

/**
 * New size of a panel after its edge was dragged by `delta` pixels.
 * `direction` is +1 when dragging toward positive coordinates grows the panel
 * (left panel) and -1 when it shrinks it (right column).
 */
export function resizeBy(
  start: number,
  delta: number,
  direction: 1 | -1,
  limits: { min: number; max: number }
): number {
  return clamp(start + delta * direction, limits.min, limits.max)
}
