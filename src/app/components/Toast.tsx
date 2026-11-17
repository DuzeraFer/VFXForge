import { useEffect, useState, type ReactElement } from "react"

type Props = { notice: { id: number; text: string; error?: boolean } | null }

/** Bottom center, short, gone after a few seconds (docs/02 §2.5). */
export function Toast({ notice }: Props): ReactElement | null {
  const [visibleId, setVisibleId] = useState<number | null>(null)

  useEffect(() => {
    if (!notice) return
    setVisibleId(notice.id)
    const timer = window.setTimeout(() => setVisibleId(null), notice.error ? 8000 : 2500)
    return () => window.clearTimeout(timer)
  }, [notice])

  if (!notice || visibleId !== notice.id) return null
  return (
    <div className="toast" role="status" data-error={notice.error ? "true" : undefined}>
      {notice.text}
    </div>
  )
}
