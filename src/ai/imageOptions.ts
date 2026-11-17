/** Choices of the AI Image node, shared by the node definition and the main process that builds the request. */

/** How the picture gets its alpha. */
export const AI_IMAGE_MODES = ["transparent", "mask"] as const
export const AI_IMAGE_SIZES = ["1024x1024", "1536x1024", "1024x1536"] as const
export const AI_IMAGE_QUALITIES = ["low", "medium", "high"] as const

export type AiImageRequest = {
  prompt: string
  mode: (typeof AI_IMAGE_MODES)[number]
  size: (typeof AI_IMAGE_SIZES)[number]
  quality: (typeof AI_IMAGE_QUALITIES)[number]
}

/** What the renderer may know about the AI image setup. The key itself never leaves the main process. */
export type AiStatus = {
  hasKey: boolean
  /** False when this machine cannot encrypt the key; a key cannot be saved then. */
  canEncrypt: boolean
  model: string
  /** Whether connected agents may generate images, and how many per agent session. */
  agentAllowed: boolean
  agentLimit: number
}

export type AiGenerateResult = { ok: true; ref: string } | { ok: false; error: string }
