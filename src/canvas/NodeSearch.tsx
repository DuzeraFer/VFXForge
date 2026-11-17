import { useEffect, useMemo, useRef, useState, type ReactElement } from "react"
import { matchingSocket, prettyName, type PendingWire } from "../app/commands"
import { session } from "../app/session"
import { usesGraph } from "../engine/functions"
import type { ResolvedNodeDef } from "../engine/nodeDef"
import { registry } from "../nodes"

type Props = {
  /** Position inside the canvas wrapper, in px. */
  x: number
  y: number
  /** When set, only nodes that can take this wire are listed. */
  wire: PendingWire | null
  onPick: (type: string) => void
  onClose: () => void
}

export function searchNodes(query: string, wire: PendingWire | null, defs: readonly ResolvedNodeDef[] = registry.list()): ResolvedNodeDef[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const scored: { def: ResolvedNodeDef; score: number }[] = []
  for (const def of defs) {
    if (wire && !matchingSocket(def, wire)) continue
    const name = prettyName(def.type).toLowerCase()
    const haystack = `${name} ${def.category.toLowerCase()} ${def.doc.toLowerCase()}`
    if (!words.every((word) => haystack.includes(word))) continue
    // Name matches first, prefix matches before the rest.
    const score = words.length === 0 ? 2 : name.startsWith(words[0]) ? 0 : words.every((w) => name.includes(w)) ? 1 : 2
    scored.push({ def, score })
  }
  return scored.sort((a, b) => a.score - b.score || a.def.type.localeCompare(b.def.type)).map((s) => s.def)
}

/** A function cannot be put inside itself, or inside a function it uses. */
export function usable(def: ResolvedNodeDef, graphId: string | null = session.getState().activeGraphId): boolean {
  return graphId === null || !usesGraph(def, graphId, registry)
}

export function NodeSearch({ x, y, wire, onPick, onClose }: Props): ReactElement {
  const [query, setQuery] = useState("")
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const revision = registry.revision?.() ?? 0
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the revision stands for the list of functions
  const results = useMemo(() => searchNodes(query, wire).filter((def) => usable(def)), [query, wire, revision])

  const rootRef = useRef<HTMLDivElement>(null)
  // Opened from a key press or the end of a wire drag: take focus once that
  // gesture is over, and close on the next press anywhere outside.
  useEffect(() => {
    const frame = requestAnimationFrame(() => inputRef.current?.focus())
    const onDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as globalThis.Node)) onClose()
    }
    document.addEventListener("pointerdown", onDown, true)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener("pointerdown", onDown, true)
    }
  }, [onClose])
  useEffect(() => setIndex(0), [query])
  useEffect(() => {
    listRef.current?.children[index]?.scrollIntoView({ block: "nearest" })
  }, [index])

  return (
    <div ref={rootRef} className="node-search nowheel" style={{ left: x, top: y }} onPointerDown={(e) => e.stopPropagation()}>
      <input
        ref={inputRef}
        value={query}
        placeholder={wire ? "Add a node to this wire" : "Add a node"}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === "Escape") onClose()
          else if (e.key === "ArrowDown") {
            e.preventDefault()
            setIndex((i) => Math.min(results.length - 1, i + 1))
          } else if (e.key === "ArrowUp") {
            e.preventDefault()
            setIndex((i) => Math.max(0, i - 1))
          } else if (e.key === "Enter" && results[index]) onPick(results[index].type)
          else if (e.key === "Tab") e.preventDefault()
        }}
      />
      <ul ref={listRef} className="node-search-list">
        {results.map((def, i) => (
          <li key={def.type}>
            <button
              className="node-search-item"
              data-active={i === index || undefined}
              // mousedown, so the pick lands before the input's blur closes the popup
              onMouseDown={(e) => {
                e.preventDefault()
                onPick(def.type)
              }}
              onMouseEnter={() => setIndex(i)}
            >
              <span>{prettyName(def.type)}</span>
              <span className="node-search-category">{def.category}</span>
            </button>
          </li>
        ))}
        {results.length === 0 && <li className="empty-note">No matching nodes.</li>}
      </ul>
    </div>
  )
}
