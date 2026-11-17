import { useEffect, useRef, useState, type ReactElement } from "react"
import type { GradientStop } from "../doc/types"
import { MAX_GRADIENT_STOPS } from "../engine/nodeDef"
import { Icon } from "../app/components/Icon"
import { ColorField, newGesture, NumberField, Slider, type OnChange } from "./fields"
import { projectGradients } from "../doc/board"
import { deleteProjectGradient, saveProjectGradient } from "../app/board"
import { useSession } from "../app/session"
import { GradientFromPicture } from "./GradientFromPicture"
import { GRADIENT_PRESETS, sampleGradient, spaceEvenly } from "./gradient"

type Props = { value: GradientStop[]; onChange: OnChange<GradientStop[]> }

function withHardness(stop: GradientStop, hardness: number): GradientStop {
  const { hardness: _old, ...rest } = stop
  return hardness === 0 ? rest : { ...rest, hardness }
}

const round3 = (v: number): number => Math.round(v * 1000) / 1000

/** Gradient bar with draggable stops. Double-click the bar to add a stop; each stop has a color and a hardness. */
export function GradientEditor({ value, onChange }: Props): ReactElement {
  const barRef = useRef<HTMLCanvasElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ index: number; gesture: string } | null>(null)
  const [selected, setSelected] = useState(0)
  const { project } = useSession()
  const saved = projectGradients(project)
  const [saving, setSaving] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const load = (stops: GradientStop[]): void => {
    onChange(stops.map((s) => ({ ...s })), newGesture())
    setSelected(0)
  }
  const index = Math.min(selected, value.length - 1)
  const stop = value[index]

  useEffect(() => {
    const canvas = barRef.current
    const context = canvas?.getContext("2d")
    if (!canvas || !context) return
    const width = canvas.width
    const image = context.createImageData(width, 1)
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = sampleGradient(value, x / (width - 1), 1 / width)
      image.data.set([r * 255, g * 255, b * 255, a * 255], x * 4)
    }
    context.putImageData(image, 0, 0)
  }, [value])

  const positionAt = (clientX: number): number => {
    const rect = trackRef.current!.getBoundingClientRect()
    return round3(Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)))
  }
  const replace = (at: number, next: GradientStop, gesture: string): void => onChange(value.map((s, i) => (i === at ? next : s)), gesture)

  const addAt = (position: number): void => {
    if (value.length >= MAX_GRADIENT_STOPS) return
    const color = sampleGradient(value, position).map(round3) as GradientStop["color"]
    onChange([...value, { position, color }], newGesture())
    setSelected(value.length)
  }
  const remove = (): void => {
    if (value.length <= 1) return
    onChange(value.filter((_, i) => i !== index), newGesture())
    setSelected(Math.max(0, index - 1))
  }

  return (
    <div className="gradient-editor">
      <div className="gradient-track" ref={trackRef} onDoubleClick={(e) => addAt(positionAt(e.clientX))} title="Double-click to add a stop">
        <canvas ref={barRef} className="gradient-bar" width={256} height={1} />
      </div>
      <div className="gradient-stops">
        {value.map((s, i) => (
          <button
            key={i}
            className="gradient-stop"
            data-selected={i === index || undefined}
            data-testid={`gradient-stop-${i}`}
            aria-label={`Stop ${i + 1} at ${s.position}`}
            style={{ left: `${s.position * 100}%`, background: `rgb(${s.color.slice(0, 3).map((v) => Math.round(v * 255)).join(",")})` }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId)
              setSelected(i)
              drag.current = { index: i, gesture: newGesture() }
            }}
            onPointerMove={(e) => {
              const d = drag.current
              if (!d || e.buttons !== 1) return
              const position = positionAt(e.clientX)
              if (position !== value[d.index].position) replace(d.index, { ...value[d.index], position }, d.gesture)
            }}
            onPointerUp={() => (drag.current = null)}
            onKeyDown={(e) => {
              if (e.key === "Delete" || e.key === "Backspace") {
                e.stopPropagation()
                remove()
              }
            }}
          />
        ))}
      </div>

      <div className="param-row">
        <span className="param-label">Stop</span>
        <NumberField prefix="At" value={stop.position} min={0} max={1} label="Stop position" onChange={(position, g) => replace(index, { ...stop, position }, g)} />
        <span className="toolbar-spacer" />
        <button className="icon-button" title="Add a stop" aria-label="Add a stop" disabled={value.length >= MAX_GRADIENT_STOPS} onClick={() => addAt(round3(Math.min(1, stop.position + 0.1)))}>
          <Icon name="plus" size={14} />
        </button>
        <button className="icon-button" title="Remove this stop" aria-label="Remove this stop" disabled={value.length <= 1} onClick={remove}>
          <Icon name="trash" size={14} />
        </button>
      </div>
      <div className="param-row">
        <span className="param-label">Color</span>
        <ColorField value={stop.color} label="Stop color" onChange={(color, g) => replace(index, { ...stop, color }, g)} />
      </div>
      <div className="param-row" title="0 blends over the whole gap from the previous stop; 1 is a hard edge at this stop.">
        <span className="param-label">Hardness</span>
        <Slider value={stop.hardness ?? 0} min={0} max={1} label="Stop hardness" onChange={(hardness, g) => replace(index, withHardness(stop, hardness), g)} />
        <NumberField className="field-narrow" value={stop.hardness ?? 0} min={0} max={1} label="Stop hardness value" onChange={(hardness, g) => replace(index, withHardness(stop, hardness), g)} />
      </div>
      <div className="param-row">
        <span className="param-label">Library</span>
        <label className="field field-select field-grow">
          <select
            value=""
            aria-label="Gradient library"
            data-testid="gradient-library"
            onChange={(e) => {
              const [kind, name] = [e.target.value.slice(0, 1), e.target.value.slice(2)]
              const found = kind === "p" ? saved.find((g) => g.name === name) : GRADIENT_PRESETS.find((p) => p.name === name)
              if (!found) return
              load(found.stops)
              if (kind === "p") setSaving(name)
            }}
          >
            <option value="">Load a gradient…</option>
            {saved.length > 0 && (
              <optgroup label="This project">
                {saved.map((g) => (
                  <option key={g.id} value={`p:${g.name}`}>
                    {g.name}
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label="Built in">
              {GRADIENT_PRESETS.map((preset) => (
                <option key={preset.name} value={`b:${preset.name}`}>
                  {preset.name}
                </option>
              ))}
            </optgroup>
          </select>
          <span className="field-caret">⌄</span>
        </label>
        <button className="text-button" title="Move the stops to even positions, for cel bands from Band" onClick={() => onChange(spaceEvenly(value), newGesture())}>
          Even
        </button>
      </div>
      <div className="param-row">
        <span className="param-label" />
        <button className="text-button" data-on={saving !== null || undefined} data-testid="gradient-save-toggle" title="Keep this gradient with the project, to use on other nodes" onClick={() => setSaving(saving === null ? "" : null)}>
          Save to project
        </button>
        <button
          className="text-button"
          data-testid="gradient-from-picture"
          disabled={project.references.length === 0}
          title={project.references.length === 0 ? "Add a picture under References first" : "Read the colors along a line across a reference picture"}
          onClick={() => setPicking(true)}
        >
          From a picture…
        </button>
      </div>
      {saving !== null && (
        <form
          className="param-row"
          onSubmit={(e) => {
            e.preventDefault()
            if (saveProjectGradient(saving, value)) setSaving(saving.trim())
          }}
        >
          <span className="param-label">Name</span>
          <label className="field field-grow">
            <input className="field-input" value={saving} maxLength={60} placeholder="Fire, toxic green…" aria-label="Gradient name" data-testid="gradient-name" onChange={(e) => setSaving(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
          </label>
          <button className="text-button" type="submit" disabled={saving.trim() === ""} data-testid="gradient-save">
            {saved.some((g) => g.name === saving.trim()) ? "Replace" : "Save"}
          </button>
          {saved.some((g) => g.name === saving.trim()) && (
            <button className="icon-button" type="button" title="Remove this gradient from the project" aria-label="Remove this gradient from the project" data-testid="gradient-forget" onClick={() => deleteProjectGradient(saving.trim())}>
              <Icon name="trash" size={14} />
            </button>
          )}
        </form>
      )}
      {picking && <GradientFromPicture onPick={load} onClose={() => setPicking(false)} />}
    </div>
  )
}
