import { useCallback, type PointerEvent as ReactPointerEvent } from "react"

/**
 * Pointer drag for resize handles. `onStart` returns a function that receives
 * the pointer movement (in px) since the drag began.
 */
export function useDrag(
  onStart: () => (dx: number, dy: number) => void
): (event: ReactPointerEvent<HTMLElement>) => void {
  return useCallback(
    (event) => {
      if (event.button !== 0) return
      event.preventDefault()
      const target = event.currentTarget
      const startX = event.clientX
      const startY = event.clientY
      const onMove = onStart()
      target.setPointerCapture(event.pointerId)
      target.dataset.dragging = "true"

      const move = (e: PointerEvent): void => onMove(e.clientX - startX, e.clientY - startY)
      const end = (): void => {
        delete target.dataset.dragging
        target.removeEventListener("pointermove", move)
        target.removeEventListener("pointerup", end)
        target.removeEventListener("pointercancel", end)
      }
      target.addEventListener("pointermove", move)
      target.addEventListener("pointerup", end)
      target.addEventListener("pointercancel", end)
    },
    [onStart]
  )
}
