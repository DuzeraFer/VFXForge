import { useState, type ReactElement } from "react"
import { answerComment, deleteComment, setCommentResolved, startComment } from "../app/board"
import { nodeTitle } from "../app/commands"
import { Icon } from "../app/components/Icon"
import { session } from "../app/session"
import { threadsOf, type CommentThread, type Graph, type Project } from "../doc"

function when(timestamp: string): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return ""
  const sameDay = date.toDateString() === new Date().toDateString()
  return sameDay ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : date.toLocaleDateString([], { month: "short", day: "numeric" })
}

function Composer({ placeholder, label, testid, onSend }: { placeholder: string; label: string; testid: string; onSend: (text: string) => void }): ReactElement {
  const [text, setText] = useState("")
  const send = (): void => {
    if (text.trim() === "") return
    onSend(text)
    setText("")
  }
  return (
    <div className="comment-composer">
      <textarea
        className="field-area comment-input"
        rows={2}
        value={text}
        aria-label={label}
        placeholder={placeholder}
        data-testid={testid}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // Enter sends, Shift+Enter makes a new line. Keys typed here are not editor shortcuts.
          e.stopPropagation()
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault()
            send()
          }
        }}
      />
      <button className="chip chip-button" disabled={text.trim() === ""} onClick={send} data-testid={`${testid}-send`}>
        Send
      </button>
    </div>
  )
}

function Thread({ thread, graph, showNode }: { thread: CommentThread; graph: Graph; showNode: boolean }): ReactElement {
  const [answering, setAnswering] = useState(false)
  const node = thread.nodeId ? graph.nodes.find((n) => n.id === thread.nodeId) : undefined
  return (
    <article className="comment-thread" data-resolved={thread.resolved || undefined} data-testid="comment-thread">
      {showNode && (
        <button className="comment-where" disabled={!node} onClick={() => node && session.select([node.id])} title={node ? "Select this node" : undefined}>
          {node ? nodeTitle(node) : "The whole graph"}
        </button>
      )}
      {thread.messages.map((m, i) => (
        <div className="comment-message" key={i} data-agent={m.agent || undefined}>
          <div className="comment-head">
            <span className="comment-author">{m.author}</span>
            <span className="comment-time">{when(m.timestamp)}</span>
          </div>
          <p className="comment-text">{m.text}</p>
        </div>
      ))}
      <div className="comment-actions">
        <button className="text-button" onClick={() => setAnswering((v) => !v)}>
          Reply
        </button>
        <button className="text-button" onClick={() => setCommentResolved(thread.id, !thread.resolved)} data-testid="comment-resolve">
          {thread.resolved ? "Reopen" : "Resolve"}
        </button>
        <span className="toolbar-spacer" />
        <button className="icon-button" aria-label="Delete this thread" title="Delete this thread" onClick={() => deleteComment(thread.id)}>
          <Icon name="trash" size={12} />
        </button>
      </div>
      {answering && (
        <Composer
          label="Reply"
          placeholder="Reply"
          testid="comment-reply"
          onSend={(text) => {
            answerComment(thread.id, text)
            setAnswering(false)
          }}
        />
      )}
    </article>
  )
}

/**
 * Comment threads (docs/05 §5.7). With a node: the threads on it. Without:
 * every thread of the graph. A connected agent reads these and answers here.
 */
export function Comments({ project, graph, nodeId }: { project: Project; graph: Graph; nodeId?: string }): ReactElement {
  const [showResolved, setShowResolved] = useState(false)
  const all = threadsOf(project, graph.id, nodeId)
  const open = all.filter((c) => !c.resolved)
  const resolved = all.filter((c) => c.resolved)
  return (
    <section className="inspector-group comments" data-testid="comments">
      <div className="group-header group-header-static">
        <span>Comments{open.length > 0 ? ` · ${open.length}` : ""}</span>
        {resolved.length > 0 && (
          <button className="text-button" onClick={() => setShowResolved((v) => !v)}>
            {showResolved ? "Hide resolved" : `${resolved.length} resolved`}
          </button>
        )}
      </div>
      <div className="group-body">
        {[...open, ...(showResolved ? resolved : [])].map((thread) => (
          <Thread key={thread.id} thread={thread} graph={graph} showNode={nodeId === undefined} />
        ))}
        <Composer
          label="New comment"
          placeholder={nodeId ? "Say what should change here. Claude reads this." : "A note on the whole graph. Claude reads this."}
          testid="comment-new"
          onSend={(text) => startComment(graph.id, nodeId, text)}
        />
      </div>
    </section>
  )
}
