/** Small controls the inspector is built from. Each reports changes with a gesture key, so one drag is one undo step. */

import { useEffect, useRef, useState, type ReactElement } from "react"

let gestureCounter = 0
/** A fresh key for one continuous gesture (a drag, or typing in one field). */
export function newGesture(): string {
  return `gesture-${++gestureCounter}`
}

export type OnChange<T> = (value: T, gesture: string) => void

export function formatNumber(value: number, integer = false): string {
  if (integer) return String(Math.round(value))
  const rounded = Math.round(value * 1000) / 1000
  return Object.is(rounded, -0) ? "0" : String(rounded)
}

function clampTo(value: number, min?: number, max?: number): number {
  if (min !== undefined && value < min) return min
  if (max !== undefined && value > max) return max
  return value
}

type NumberProps = {
  value: number
  onChange: OnChange<number>
  /** Hard limits. */
  min?: number
  max?: number
  integer?: boolean
  /** Change per pixel when scrubbing. */
  step?: number
  prefix?: string
  suffix?: string
  label?: string
  className?: string
}

/**
 * A number field. Drag sideways to scrub (Shift = fine, Ctrl = coarse), click
 * to type. Enter or leaving the field commits; Escape cancels.
 */
export function NumberField({ value, onChange, min, max, integer, step, prefix, suffix, label, className }: NumberProps): ReactElement {
  const [text, setText] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const drag = useRef<{ x: number; start: number; gesture: string; moved: boolean } | null>(null)
  const perPixel = step ?? (integer ? 0.1 : 0.005)

  useEffect(() => {
    if (text !== null) inputRef.current?.select()
    // Select once, when editing starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text !== null])

  const commit = (): void => {
    if (text === null) return
    const parsed = Number(text.replace(",", "."))
    if (text.trim() !== "" && Number.isFinite(parsed)) {
      const next = clampTo(integer ? Math.round(parsed) : parsed, min, max)
      if (next !== value) onChange(next, newGesture())
    }
    setText(null)
  }

  if (text !== null) {
    return (
      <span className={`field ${className ?? ""}`} data-editing>
        {prefix && <span className="field-prefix">{prefix}</span>}
        <input
          ref={inputRef}
          className="field-input mono"
          value={text}
          aria-label={label}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit()
            else if (e.key === "Escape") setText(null)
          }}
        />
      </span>
    )
  }

  return (
    <span
      className={`field field-scrub ${className ?? ""}`}
      role="spinbutton"
      tabIndex={0}
      aria-label={label}
      aria-valuenow={value}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.currentTarget.setPointerCapture(e.pointerId)
        drag.current = { x: e.clientX, start: value, gesture: newGesture(), moved: false }
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d) return
        const dx = e.clientX - d.x
        if (!d.moved && Math.abs(dx) < 3) return
        d.moved = true
        const speed = perPixel * (e.shiftKey ? 0.1 : e.ctrlKey || e.metaKey ? 10 : 1)
        let next = d.start + dx * speed
        next = integer ? Math.round(next) : Math.round(next * 1000) / 1000
        next = clampTo(next, min, max)
        if (next !== value) onChange(next, d.gesture)
      }}
      onPointerUp={() => {
        const d = drag.current
        drag.current = null
        if (d && !d.moved) setText(formatNumber(value, integer))
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") setText(formatNumber(value, integer))
        else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault()
          const unit = integer ? 1 : (e.shiftKey ? 0.1 : 0.01)
          const next = clampTo(Math.round((value + (e.key === "ArrowUp" ? unit : -unit)) * 1000) / 1000, min, max)
          if (next !== value) onChange(next, newGesture())
        }
      }}
    >
      {prefix && <span className="field-prefix">{prefix}</span>}
      <span className="field-value mono">
        {formatNumber(value, integer)}
        {suffix}
      </span>
    </span>
  )
}

type SliderProps = { value: number; onChange: OnChange<number>; min: number; max: number; integer?: boolean; label?: string }

export function Slider({ value, onChange, min, max, integer, label }: SliderProps): ReactElement {
  const gesture = useRef("")
  const fraction = max > min ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0
  const at = (element: HTMLElement, clientX: number): number => {
    const rect = element.getBoundingClientRect()
    const t = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    const raw = min + t * (max - min)
    return integer ? Math.round(raw) : Math.round(raw * 1000) / 1000
  }
  return (
    <span
      className="slider"
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.currentTarget.setPointerCapture(e.pointerId)
        gesture.current = newGesture()
        const next = at(e.currentTarget, e.clientX)
        if (next !== value) onChange(next, gesture.current)
      }}
      onPointerMove={(e) => {
        if (e.buttons !== 1 || !gesture.current) return
        const next = at(e.currentTarget, e.clientX)
        if (next !== value) onChange(next, gesture.current)
      }}
      onPointerUp={() => (gesture.current = "")}
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return
        e.preventDefault()
        const unit = integer ? 1 : (max - min) / 100
        const next = Math.min(max, Math.max(min, Math.round((value + (e.key === "ArrowRight" ? unit : -unit)) * 1000) / 1000))
        if (next !== value) onChange(next, newGesture())
      }}
    >
      <span className="slider-track">
        <span className="slider-fill" style={{ width: `${fraction * 100}%` }} />
      </span>
    </span>
  )
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: readonly T[]; onChange: (value: T) => void; label?: string }): ReactElement {
  return (
    <span className="segmented segmented-fill" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button key={option} role="radio" aria-checked={option === value} aria-selected={option === value} onClick={() => onChange(option)}>
          {option.replace(/_/g, " ")}
        </button>
      ))}
    </span>
  )
}

export function Toggle({ value, onChange, label }: { value: boolean; onChange: (value: boolean) => void; label?: string }): ReactElement {
  return (
    <button className="toggle" role="switch" aria-checked={value} aria-label={label} onClick={() => onChange(!value)}>
      <span className="toggle-knob" />
    </button>
  )
}

export type Rgba = [number, number, number, number]

export function toHex(color: readonly number[]): string {
  const part = (v: number): string =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, "0")
  return `#${part(color[0])}${part(color[1])}${part(color[2])}`
}

export function fromHex(hex: string, alpha: number): Rgba | null {
  const match = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex.trim())
  if (!match) return null
  const digits = match[1].length === 3 ? [...match[1]].map((d) => d + d).join("") : match[1]
  const channel = (i: number): number => Math.round((parseInt(digits.slice(i, i + 2), 16) / 255) * 1000) / 1000
  return [channel(0), channel(2), channel(4), alpha]
}

/** Swatch (opens the system color picker), hex text, and alpha. */
export function ColorField({ value, onChange, label }: { value: Rgba; onChange: OnChange<Rgba>; label?: string }): ReactElement {
  const gesture = useRef("")
  const [text, setText] = useState<string | null>(null)
  const hex = toHex(value)
  const commitText = (): void => {
    if (text !== null) {
      const parsed = fromHex(text, value[3])
      if (parsed && toHex(parsed) !== hex) onChange(parsed, newGesture())
    }
    setText(null)
  }
  return (
    <span className="color-field">
      <label className="swatch" style={{ background: `rgba(${value.slice(0, 3).map((v) => Math.round(v * 255)).join(",")},${value[3]})` }}>
        <input
          type="color"
          value={hex}
          aria-label={label}
          onFocus={() => (gesture.current = newGesture())}
          onInput={(e) => {
            const parsed = fromHex(e.currentTarget.value, value[3])
            if (parsed) onChange(parsed, gesture.current || (gesture.current = newGesture()))
          }}
        />
      </label>
      <span className="field field-grow">
        <input
          className="field-input mono"
          value={text ?? hex.toUpperCase()}
          aria-label={label ? `${label} hex` : "Hex"}
          onChange={(e) => setText(e.target.value)}
          onBlur={commitText}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitText()
            else if (e.key === "Escape") setText(null)
          }}
        />
      </span>
      <NumberField
        className="field-narrow"
        prefix="A"
        value={value[3]}
        min={0}
        max={1}
        label={label ? `${label} alpha` : "Alpha"}
        onChange={(alpha, g) => onChange([value[0], value[1], value[2], alpha], g)}
      />
    </span>
  )
}

export function Select({ value, options, onChange, label }: { value: string; options: readonly string[]; onChange: (value: string) => void; label?: string }): ReactElement {
  return (
    <label className="field field-select">
      <select value={value} aria-label={label} onChange={(e) => onChange(e.target.value)}>
        {options.map((option) => (
          <option key={option} value={option}>
            {(option.charAt(0).toUpperCase() + option.slice(1)).replace(/_/g, " ")}
          </option>
        ))}
      </select>
      <span className="field-caret">⌄</span>
    </label>
  )
}

export function TextField({ value, onChange, label }: { value: string; onChange: (value: string) => void; label?: string }): ReactElement {
  const [text, setText] = useState<string | null>(null)
  const commit = (): void => {
    if (text !== null && text !== value) onChange(text)
    setText(null)
  }
  return (
    <span className="field field-grow">
      <input
        className="field-input"
        value={text ?? value}
        aria-label={label}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur()
          else if (e.key === "Escape") setText(null)
        }}
      />
    </span>
  )
}
