import { useState, type ReactElement, type ReactNode } from "react"
import { nodeTitle, prettyName, toggleBypass } from "../app/commands"
import { Icon } from "../app/components/Icon"
import { session } from "../app/session"
import type { GradientStop, Graph, Node, ParamValue, Project } from "../doc"
import type { ParamSchema, ResolvedNodeDef } from "../engine/nodeDef"
import type { Problem } from "../engine/validate"
import { registry } from "../nodes"
import { generateFor, generationKey, useGeneration } from "../ai/generation"
import { openSettings } from "../app/components/Settings"
import { ColorField, NumberField, Segmented, Select, Slider, TextArea, TextField, Toggle, newGesture, type Rgba } from "./fields"
import { GradientEditor } from "./GradientEditor"

type Props = { project: Project; graph: Graph | null; selection: readonly string[]; problems: readonly Problem[] }

function Group({ title, children }: { title: string; children: ReactNode }): ReactElement {
  const [open, setOpen] = useState(true)
  return (
    <section className="inspector-group">
      <button className="group-header" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span>{title}</span>
        <span className="group-caret" data-open={open}>
          ⌄
        </span>
      </button>
      {open && <div className="group-body">{children}</div>}
    </section>
  )
}

function Row({ label, title, children, stacked }: { label: string; title?: string; children: ReactNode; stacked?: boolean }): ReactElement {
  return (
    <div className="param-row" data-stacked={stacked || undefined} title={title}>
      <span className="param-label">{label}</span>
      {children}
    </div>
  )
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Range the slider covers: hard limits first, soft ones otherwise. */
function sliderRange(schema: Extract<ParamSchema, { type: "float" | "int" }>): [number, number] | null {
  const low = schema.min ?? schema.softMin
  const high = schema.max ?? schema.softMax
  return low !== undefined && high !== undefined && high > low ? [low, high] : null
}

function ParamControl({ graph, node, name, schema }: { graph: Graph; node: Node; name: string; schema: ParamSchema }): ReactElement {
  const label = prettyName(name)
  const value = (name in node.params ? node.params[name] : schema.default) as ParamValue
  const set = (next: ParamValue, gesture?: string): void => {
    // The document stores only what differs from the defaults.
    const stored = sameValue(next, schema.default) ? null : next
    session.apply([{ op: "set_params", graphId: graph.id, id: node.id, params: { [name]: stored } }], `Set ${label}`, gesture && `${node.id}.${name}.${gesture}`)
  }

  const driver = node.driven[name]
  if (driver) {
    return (
      <Row label={label} title={schema.doc}>
        <span className="field field-grow field-driven">
          <span className="field-prefix">←</span>
          <span className="field-value mono">{driver}</span>
        </span>
        <button
          className="icon-button"
          title="Stop driving this parameter"
          aria-label={`Stop driving ${label}`}
          onClick={() => session.apply([{ op: "drive_param", graphId: graph.id, id: node.id, param: name, from: null }], `Stop driving ${label}`)}
        >
          <Icon name="close" size={12} />
        </button>
      </Row>
    )
  }

  switch (schema.type) {
    case "float":
    case "int": {
      const integer = schema.type === "int"
      const range = sliderRange(schema)
      const number = value as number
      if (name === "seed") {
        return (
          <Row label={label} title={schema.doc}>
            <NumberField className="field-grow" value={number} integer label={label} onChange={set} min={schema.min} max={schema.max} />
            <button className="square-button" title="Random seed" aria-label="Random seed" onClick={() => set(Math.floor(Math.random() * 100000))}>
              <Icon name="dice" size={14} />
            </button>
          </Row>
        )
      }
      if (!range) {
        return (
          <Row label={label} title={schema.doc}>
            <NumberField className="field-grow" value={number} integer={integer} label={label} onChange={set} min={schema.min} max={schema.max} />
          </Row>
        )
      }
      return (
        <Row label={label} title={schema.doc}>
          <Slider value={number} min={range[0]} max={range[1]} integer={integer} label={label} onChange={set} />
          <NumberField
            className="field-narrow"
            value={number}
            integer={integer}
            label={`${label} value`}
            onChange={set}
            min={schema.min}
            max={schema.max}
            step={integer ? 0.1 : (range[1] - range[0]) / 300}
          />
        </Row>
      )
    }
    case "angle":
      return (
        <Row label={label} title={schema.doc}>
          <Slider value={value as number} min={-180} max={180} label={label} onChange={set} />
          <NumberField className="field-narrow" value={value as number} suffix="°" step={0.5} label={`${label} value`} onChange={set} />
        </Row>
      )
    case "bool":
      return (
        <Row label={label} title={schema.doc}>
          <span className="toolbar-spacer" />
          <Toggle value={value as boolean} label={label} onChange={(v) => set(v)} />
        </Row>
      )
    case "enum":
      return (
        <Row label={label} title={schema.doc}>
          {schema.options.length <= 3 ? (
            <Segmented value={value as string} options={schema.options} label={label} onChange={(v) => set(v)} />
          ) : (
            <Select value={value as string} options={schema.options} label={label} onChange={(v) => set(v)} />
          )}
        </Row>
      )
    case "vec2": {
      const [x, y] = value as [number, number]
      return (
        <Row label={label} title={schema.doc}>
          <NumberField className="field-grow" prefix="X" value={x} min={schema.min} max={schema.max} label={`${label} X`} onChange={(v, g) => set([v, y], g)} />
          <NumberField className="field-grow" prefix="Y" value={y} min={schema.min} max={schema.max} label={`${label} Y`} onChange={(v, g) => set([x, v], g)} />
        </Row>
      )
    }
    case "color":
      return (
        <Row label={label} title={schema.doc}>
          <ColorField value={value as Rgba} label={label} onChange={set} />
        </Row>
      )
    case "floatList": {
      const list = value as number[]
      return (
        <Row label={label} title={schema.doc} stacked>
          <div className="list-fields">
            {list.map((item, i) => (
              <NumberField
                key={i}
                prefix={String(i + 1)}
                value={item}
                min={schema.min}
                max={schema.max}
                label={`${label} ${i + 1}`}
                onChange={(v, g) => set(list.map((old, j) => (j === i ? v : old)), `${i}.${g}`)}
              />
            ))}
            <button
              className="square-button"
              title="Add a value"
              aria-label={`Add a value to ${label}`}
              disabled={list.length >= schema.maxLength}
              onClick={() => set([...list, list.length > 0 ? Math.round((list[list.length - 1] + 0.1) * 1000) / 1000 : 0.5])}
            >
              <Icon name="plus" size={14} />
            </button>
            <button className="square-button" title="Remove the last value" aria-label={`Remove the last value of ${label}`} disabled={list.length === 0} onClick={() => set(list.slice(0, -1))}>
              <Icon name="trash" size={14} />
            </button>
          </div>
        </Row>
      )
    }
    case "gradient":
      return (
        <Row label={label} title={schema.doc} stacked>
          <GradientEditor value={value as unknown as GradientStop[]} onChange={(stops, g) => set(stops as unknown as ParamValue, g)} />
        </Row>
      )
    case "string":
      return (
        <Row label={label} title={schema.doc}>
          <TextField value={value as string} label={label} onChange={(v) => set(v)} />
        </Row>
      )
  }
}

const COMMON = new Set(["seed", "tiling"])

/** Image Sample: the file is chosen with a dialog and copied into the project. */
function ImageFileRow({ graph, node }: { graph: Graph; node: Node }): ReactElement {
  const file = typeof node.params.file === "string" ? node.params.file : ""
  const choose = async (): Promise<void> => {
    const api = window.vfxforge
    if (!api) return session.say("Images can only be chosen inside the VFXForge app.", true)
    try {
      const ref = await api.importAsset(session.getState().path)
      if (ref) session.apply([{ op: "set_params", graphId: graph.id, id: node.id, params: { file: ref } }], "Choose image")
    } catch (error) {
      session.say(`Could not use that image. ${error instanceof Error ? error.message : String(error)}`, true)
    }
  }
  return (
    <div className="param-row">
      <span className="param-label">Image</span>
      <span className="field field-grow field-driven" title={file || undefined}>
        <span className="field-value mono">{file ? file.split("/").pop() : "None"}</span>
      </span>
      <button className="chip chip-button" onClick={() => void choose()}>
        Choose…
      </button>
    </div>
  )
}

/** AI Image: prompt and options, then Generate. The key is set once, in Settings. */
function AiImagePanel({ graph, node, def }: { graph: Graph; node: Node; def: ResolvedNodeDef }): ReactElement {
  const { status, busy, errors } = useGeneration()
  const key = generationKey(graph.id, node.id)
  const working = !!busy[key]
  const prompt = typeof node.params.prompt === "string" ? node.params.prompt : ""
  const hasImage = typeof node.params.image === "string" && node.params.image !== ""
  const ready = status?.hasKey === true
  return (
    <Group title="Picture">
      <div className="param-row" data-stacked>
        <span className="param-label">Prompt</span>
        <TextArea
          value={prompt}
          label="Prompt"
          placeholder="A stylized smoke puff, soft round shapes, seen from the side"
          onChange={(text) => session.apply([{ op: "set_params", graphId: graph.id, id: node.id, params: { prompt: text === "" ? null : text } }], "Set Prompt")}
        />
      </div>
      {(["mode", "size", "quality"] as const).map((name) => (
        <ParamControl key={name} graph={graph} node={node} name={name} schema={def.params[name]} />
      ))}
      <div className="param-row">
        <button
          className="button-primary button-wide"
          data-testid="ai-generate"
          disabled={working || !ready || prompt.trim() === ""}
          title={!ready ? "Add your OpenAI API key in Settings first" : prompt.trim() === "" ? "Write a prompt first" : "Sends the prompt to OpenAI with your key"}
          onClick={() => void generateFor(graph, node.id, { kind: "human" })}
        >
          {working ? "Generating…" : hasImage ? "Generate again" : "Generate"}
        </button>
      </div>
      {errors[key] && (
        <p className="inspector-problems inspector-note" data-testid="ai-error">
          {errors[key]}
        </p>
      )}
      {status && !status.hasKey && (
        <p className="inspector-doc inspector-note">
          This node uses your own OpenAI API key.{" "}
          <button className="link-button" onClick={openSettings}>
            Add it in Settings
          </button>
          . It is stored encrypted on this computer and is only sent to OpenAI.
        </p>
      )}
      {working && <p className="inspector-doc inspector-note">This usually takes between ten seconds and a minute. You can keep working.</p>}
    </Group>
  )
}

function NodeInspector({ graph, node, def, problems }: { graph: Graph; node: Node; def: ResolvedNodeDef; problems: readonly Problem[] }): ReactElement {
  // The AI Image node has its own panel; an image file is chosen with a button, not typed.
  const special = node.type === "ai_image"
  const own = special ? [] : Object.entries(def.params).filter(([name]) => !COMMON.has(name) && name !== def.asset)
  const common = Object.entries(def.params).filter(([name]) => COMMON.has(name))
  return (
    <>
      <header className="inspector-title">
        <TextField
          value={nodeTitle(node)}
          label="Node name"
          onChange={(name) => session.apply([{ op: "rename", graphId: graph.id, id: node.id, name: name.trim() === "" || name === prettyName(node.type) ? null : name.trim() }], "Rename node")}
        />
        <span className="inspector-meta">
          {node.type} · {node.id} · v{node.version}
        </span>
      </header>
      {problems.length > 0 && (
        <ul className="inspector-problems">
          {problems.map((p, i) => (
            <li key={i}>{p.message}</li>
          ))}
        </ul>
      )}
      <p className="inspector-doc">{def.doc}</p>
      {special && <AiImagePanel graph={graph} node={node} def={def} />}
      {!special && def.asset !== undefined && (
        <Group title="Image">
          <ImageFileRow graph={graph} node={node} />
        </Group>
      )}
      {own.length > 0 && (
        <Group title="Parameters">
          {own.map(([name, schema]) => (
            <ParamControl key={name} graph={graph} node={node} name={name} schema={schema} />
          ))}
        </Group>
      )}
      <Group title="Node">
        {common.map(([name, schema]) => (
          <ParamControl key={name} graph={graph} node={node} name={name} schema={schema} />
        ))}
        <div className="param-row">
          <span className="param-label">Bypass</span>
          <kbd className="shortcut">B</kbd>
          <span className="toolbar-spacer" />
          <Toggle value={!!node.bypass} label="Bypass" onChange={toggleBypass} />
        </div>
      </Group>
    </>
  )
}

function GraphInspector({ project, graph }: { project: Project; graph: Graph }): ReactElement {
  const setting = (key: "width" | "height" | "frames" | "fps", value: number, gesture: string): void => {
    session.apply([{ op: "set_graph", graphId: graph.id, settings: { [key]: value } }], `Set ${key}`, `${graph.id}.${key}.${gesture}`)
  }
  const s = graph.settings
  return (
    <>
      <header className="inspector-title">
        <TextField value={graph.name} label="Graph name" onChange={(name) => name.trim() && session.apply([{ op: "set_graph", graphId: graph.id, name: name.trim() }], "Rename graph")} />
        <span className="inspector-meta">graph · {graph.nodes.length} nodes</span>
      </header>
      <Group title="Image">
        <Row label="Size">
          <NumberField className="field-grow" prefix="W" value={s.width} integer min={1} max={4096} step={1} label="Width" onChange={(v, g) => setting("width", v, g)} />
          <NumberField className="field-grow" prefix="H" value={s.height} integer min={1} max={4096} step={1} label="Height" onChange={(v, g) => setting("height", v, g)} />
        </Row>
        <Row label="Preset">
          <Segmented
            value={s.width === s.height && [128, 256, 512, 1024].includes(s.width) ? String(s.width) : ""}
            options={["128", "256", "512", "1024"]}
            label="Size preset"
            onChange={(v) => session.apply([{ op: "set_graph", graphId: graph.id, settings: { width: Number(v), height: Number(v) } }], "Set size")}
          />
        </Row>
      </Group>
      <Group title="Animation">
        <Row label="Frames">
          <Slider value={s.frames} min={1} max={64} integer label="Frames" onChange={(v, g) => setting("frames", v, g)} />
          <NumberField className="field-narrow" value={s.frames} integer min={1} max={1024} label="Frames value" onChange={(v, g) => setting("frames", v, g)} />
        </Row>
        <Row label="Speed">
          <Slider value={s.fps} min={1} max={60} integer label="Frames per second" onChange={(v, g) => setting("fps", v, g)} />
          <NumberField className="field-narrow" value={s.fps} integer min={1} max={240} label="Frames per second value" onChange={(v, g) => setting("fps", v, g)} />
        </Row>
      </Group>
      <Group title="Project">
        <Row label="Seed" title="Every seeded node adds its own offset to this.">
          <NumberField className="field-grow" value={project.seed} integer label="Project seed" onChange={(seed, g) => session.apply([{ op: "set_project", seed }], "Set project seed", `project.seed.${g}`)} />
          <button
            className="square-button"
            title="Random seed"
            aria-label="Random project seed"
            onClick={() => session.apply([{ op: "set_project", seed: Math.floor(Math.random() * 100000) }], "Set project seed", newGesture())}
          >
            <Icon name="dice" size={14} />
          </button>
        </Row>
      </Group>
    </>
  )
}

export function Inspector({ project, graph, selection, problems }: Props): ReactElement {
  const nodes = graph ? graph.nodes.filter((n) => selection.includes(n.id)) : []
  let body: ReactElement
  if (!graph) body = <p className="empty-note">No graph open.</p>
  else if (nodes.length === 0) body = <GraphInspector project={project} graph={graph} />
  else if (nodes.length > 1) {
    body = (
      <>
        <header className="inspector-title">
          <span className="inspector-name">{nodes.length} nodes selected</span>
        </header>
        <p className="inspector-doc">Ctrl+D duplicates them, L lines them up, B bypasses them, Delete removes them.</p>
      </>
    )
  } else {
    const node = nodes[0]
    const def = registry.get(node.type)
    body = def ? (
      <NodeInspector key={node.id} graph={graph} node={node} def={def} problems={problems.filter((p) => p.nodeId === node.id)} />
    ) : (
      <p className="empty-note">Unknown node type “{node.type}”.</p>
    )
  }
  return (
    <section className="inspector" data-testid="inspector">
      {body}
    </section>
  )
}
