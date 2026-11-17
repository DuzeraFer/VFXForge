import { createContext, useContext } from "react"
import type { ResolvedGraph } from "../engine/validate"
import type { Thumbnails } from "../preview/thumbnails"

export type EditorContextValue = {
  resolved: ResolvedGraph | null
  thumbnails: Thumbnails | null
}

export const EditorContext = createContext<EditorContextValue>({ resolved: null, thumbnails: null })

export function useEditor(): EditorContextValue {
  return useContext(EditorContext)
}
