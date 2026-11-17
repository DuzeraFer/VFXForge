import { useMemo, useState, type ReactElement, type ReactNode } from "react"
import { searchNodes } from "../../canvas/NodeSearch"
import type { Graph, Transaction } from "../../doc"
import { nodeDefs } from "../../nodes"
import { addGraph, addNodeAtCenter, prettyName } from "../commands"
import { session, type ActivityEntry } from "../session"
import { Icon } from "./Icon"

/** Library categories in the order of docs/04-node-library.md. */
const CATEGORY_ORDER = ["Inputs", "Shapes", "Splines", "Noises", "Patterns", "Transform", "Tone & Color", "Filters", "Blending", "Math", "Outputs"]

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
  const groups = useMemo(() => {
    const found = searchNodes(query, null)
    const names = [...CATEGORY_ORDER, ...new Set(nodeDefs.map((d) => d.category).filter((c) => !CATEGORY_ORDER.includes(c)))]
    return names.map((name) => ({ name, total: nodeDefs.filter((d) => d.category === name).length, defs: found.filter((d) => d.category === name) }))
  }, [query])
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
                          <span className="socket-dot" data-type={Object.values(def.outputs)[0]?.startsWith("same:") ? "image" : Object.values(def.outputs)[0]} />
                          <span className="row-title">{prettyName(def.type)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
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
