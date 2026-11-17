import { useMemo, useState, type ReactElement, type ReactNode } from "react"
import { searchNodes, usable } from "../../canvas/NodeSearch"
import type { Graph, Transaction } from "../../doc"
import { registry } from "../../nodes"
import { recipes } from "../../library/recipes"
import { addGraph, addNodeAtCenter, prettyName } from "../commands"
import { addRecipe, importFunctionFromFile } from "../functions"
import { session, useSession, type ActivityEntry } from "../session"
import { Icon } from "./Icon"

/** Library categories in the order of docs/04-node-library.md. */
const CATEGORY_ORDER = ["Inputs", "Shapes", "Splines", "Noises", "Patterns", "Transform", "Tone & Color", "Filters", "Blending", "Math", "Outputs", "Functions"]

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }): ReactElement {
  const [open, setOpen] = useState(true)
  return (
    <section className="panel-section">
      <div className="section-header">
        <button className="section-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <span className="label">{title}</span>
        </button>
        {action}
      </div>
      {open && <div className="section-body">{children}</div>}
    </section>
  )
}

function Library(): ReactElement {
  const [query, setQuery] = useState("")
  // Categories start folded, as in the design; searching opens the ones with matches.
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set())
  const revision = registry.revision?.() ?? 0
  const { activeGraphId, project } = useSession()
  // A recipe already copied into the project is listed under Functions instead.
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const shipped = recipes.filter((r) => !project.graphs.some((g) => g.id === r.id && g.function)).filter((r) => words.every((w) => `${r.name} ${r.description} recipes`.toLowerCase().includes(w)))
  const groups = useMemo(() => {
    const nodeDefs = registry.list().filter((def) => usable(def, activeGraphId))
    const found = searchNodes(query, null, nodeDefs)
    const names = [...CATEGORY_ORDER, ...new Set(nodeDefs.map((d) => d.category).filter((c) => !CATEGORY_ORDER.includes(c)))]
    return names.map((name) => ({ name, total: nodeDefs.filter((d) => d.category === name).length, defs: found.filter((d) => d.category === name) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the revision stands for the list of functions
  }, [query, revision, activeGraphId])
  const searching = query.trim() !== ""

  return (
    <>
      <label className="search-field">
        <Icon name="search" size={14} />
        <input type="text" placeholder="Search nodes" value={query} onChange={(e) => setQuery(e.target.value)} data-testid="library-search" />
        <kbd>Space</kbd>
      </label>
      <ul className="row-list">
        {groups
          .filter((group) => (searching ? group.defs.length > 0 : true))
          .map((group) => {
            const open = searching || opened.has(group.name)
            return (
              <li key={group.name}>
                <button
                  className="row row-button row-category"
                  aria-expanded={open}
                  disabled={group.total === 0}
                  onClick={() =>
                    setOpened((current) => {
                      const next = new Set(current)
                      if (!next.delete(group.name)) next.add(group.name)
                      return next
                    })
                  }
                >
                  <span className="row-title">{group.name}</span>
                  <span className="row-meta">{group.total}</span>
                </button>
                {open && group.defs.length > 0 && (
                  <ul className="row-list">
                    {group.defs.map((def) => (
                      <li key={def.type}>
                        <button className="row row-button row-node" title={def.doc} onClick={() => addNodeAtCenter(def.type)} data-node-type={def.type}>
                          <span className="socket-dot" data-type={/^(same|param):/.test(Object.values(def.outputs)[0] ?? "") ? "image" : Object.values(def.outputs)[0]} />
                          <span className="row-title">{prettyName(def.type)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        {shipped.length > 0 && (
          <li>
            <button
              className="row row-button row-category"
              aria-expanded={searching || opened.has("Recipes")}
              onClick={() =>
                setOpened((current) => {
                  const next = new Set(current)
                  if (!next.delete("Recipes")) next.add("Recipes")
                  return next
                })
              }
            >
              <span className="row-title">Recipes</span>
              <span className="row-meta">{shipped.length}</span>
            </button>
            {(searching || opened.has("Recipes")) && (
              <ul className="row-list">
                {shipped.map((r) => (
                  <li key={r.id}>
                    <button className="row row-button row-node row-recipe" title={`${r.description} Adding it copies the function into this project, where you can open and change it.`} onClick={() => addRecipe(r.id)} data-recipe={r.id}>
                      <span className="socket-dot" data-type="color" />
                      <span className="row-title">{r.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </li>
        )}
        {!searching && window.vfxforge && (
          <li>
            <button className="row row-button row-node row-recipe" title="Adds a function saved from another project (.vfxfn)" onClick={() => void importFunctionFromFile()} data-testid="import-function">
              <span className="row-title">Open a function file…</span>
            </button>
          </li>
        )}
      </ul>
    </>
  )
}

function HistoryList({ history }: { history: { done: readonly Transaction[]; undone: readonly Transaction[] } }): ReactElement {
  // Newest first; steps that were undone stay listed, dimmed, until a new edit replaces them.
  const undone = history.undone
  const done = [...history.done].reverse()
  if (done.length === 0 && undone.length === 0) return <p className="empty-note">No changes yet.</p>
  const row = (t: Transaction, state: "done" | "undone" | "current"): ReactElement => (
    <li key={t.id}>
      <button className="row row-button row-history" data-state={state} onClick={() => session.store.jumpTo(t.id)} title={new Date(t.timestamp).toLocaleTimeString()}>
        <span className="row-title">{t.label}</span>
        {t.author.kind === "agent" && <span className="row-meta row-agent">Claude</span>}
      </button>
    </li>
  )
  return (
    <ul className="row-list history-list">
      {undone.map((t) => row(t, "undone"))}
      {done.map((t, i) => row(t, i === 0 ? "current" : "done"))}
      <li>
        <button className="row row-button row-history" data-state={done.length === 0 ? "current" : "done"} onClick={() => session.store.jumpTo(0)}>
          <span className="row-title">Opened</span>
        </button>
      </li>
    </ul>
  )
}

/** What agents did, newest first, in their own words. Edits can be shown and undone one by one. */
function ActivityList({ activity }: { activity: readonly ActivityEntry[] }): ReactElement {
  return (
    <ul className="row-list history-list">
      {[...activity].reverse().map((entry) => (
        <li key={entry.id} className="activity-row" data-reverted={entry.reverted || undefined} title={`${entry.agent} · ${new Date(entry.time).toLocaleTimeString()}`}>
          <span className="agent-dot agent-dot-small">{entry.agent.charAt(0).toUpperCase()}</span>
          <button
            className="activity-text"
            disabled={!entry.nodeIds || entry.nodeIds.length === 0}
            onClick={() => {
              if (entry.graphId && entry.graphId !== session.getState().activeGraphId) session.setActiveGraph(entry.graphId)
              session.select(entry.nodeIds ?? [])
            }}
          >
            {entry.text}
          </button>
          {entry.transactionId !== undefined && !entry.reverted && (
            <button
              className="text-button"
              onClick={() => {
                const problem = session.revertAgentEdit(entry.transactionId!)
                if (problem) session.say(problem, true)
              }}
            >
              Undo
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}

type Props = {
  graphs: Graph[]
  activeGraphId: string | null
  history: { done: readonly Transaction[]; undone: readonly Transaction[] }
  activity: readonly ActivityEntry[]
}

export function LeftPanel({ graphs, activeGraphId, history, activity }: Props): ReactElement {
  return (
    <aside className="left-panel">
      <div className="left-panel-scroll">
        <Section
          title="Graphs"
          action={
            <button className="icon-button" title="New graph" aria-label="New graph" onClick={addGraph}>
              <Icon name="plus" size={14} />
            </button>
          }
        >
          <ul className="row-list">
            {graphs.map((graph) => (
              <li key={graph.id}>
                <button className="row row-button" aria-current={graph.id === activeGraphId} onClick={() => session.setActiveGraph(graph.id)}>
                  <span className="row-title">{graph.name}</span>
                  {graph.function && <span className="row-tag" title="A function: other graphs can use it as a node">fn</span>}
                  <span className="row-meta">
                    {graph.settings.width}×{graph.settings.height}
                    {graph.settings.frames > 1 ? ` · ${graph.settings.frames}f` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Library">
          <Library />
        </Section>

        {activity.length > 0 && (
          <Section title="Agent activity">
            <ActivityList activity={activity} />
          </Section>
        )}

        <Section title="History">
          <HistoryList history={history} />
        </Section>
      </div>
      <footer className="left-panel-footer">VFXForge 0.0.1</footer>
    </aside>
  )
}
