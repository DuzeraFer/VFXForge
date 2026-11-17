/**
 * AI Image generation (docs/06 §6.11). Everything that touches the OpenAI key
 * is in this file, in the main process: the key is stored encrypted with the
 * operating system's keychain, is sent only to OpenAI, and is never handed to
 * the window, to agents, to project files or to logs.
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { AI_IMAGE_MODES, AI_IMAGE_QUALITIES, AI_IMAGE_SIZES, type AiImageRequest, type AiStatus } from "../src/ai/imageOptions"

export const OPENAI_IMAGES_URL = "https://api.openai.com/v1/images/generations"
export const DEFAULT_MODEL = "gpt-image-2"
const REQUEST_TIMEOUT_MS = 240_000

export type AiSettings = { model: string; agentAllowed: boolean; agentLimit: number }

export const DEFAULT_SETTINGS: AiSettings = { model: DEFAULT_MODEL, agentAllowed: false, agentLimit: 4 }

/** The operating system's encryption (Electron `safeStorage`), passed in so this file is testable. */
export type KeyCrypto = {
  available: () => boolean
  encrypt: (text: string) => Buffer
  decrypt: (data: Buffer) => string
}

const keyFile = (dir: string): string => join(dir, "openai-key.bin")
const settingsFile = (dir: string): string => join(dir, "ai-settings.json")

export function readSettings(dir: string): AiSettings {
  try {
    const raw = JSON.parse(readFileSync(settingsFile(dir), "utf8")) as Partial<AiSettings>
    return cleanSettings({ ...DEFAULT_SETTINGS, ...raw })
  } catch {
    return DEFAULT_SETTINGS
  }
}

function cleanSettings(settings: AiSettings): AiSettings {
  const model = typeof settings.model === "string" && /^[\w.:-]{1,64}$/.test(settings.model.trim()) ? settings.model.trim() : DEFAULT_MODEL
  const limit = Number.isInteger(settings.agentLimit) ? Math.min(50, Math.max(1, settings.agentLimit)) : DEFAULT_SETTINGS.agentLimit
  return { model, agentAllowed: settings.agentAllowed === true, agentLimit: limit }
}

export function writeSettings(dir: string, patch: Partial<AiSettings>): AiSettings {
  const next = cleanSettings({ ...readSettings(dir), ...patch })
  writeFileSync(settingsFile(dir), JSON.stringify(next, null, 2), "utf8")
  return next
}

export function hasKey(dir: string): boolean {
  return existsSync(keyFile(dir))
}

export function saveKey(dir: string, crypto: KeyCrypto, key: string): void {
  const trimmed = key.trim()
  if (trimmed === "") throw new Error("The key is empty.")
  if (/\s/.test(trimmed) || trimmed.length > 400) throw new Error("That does not look like an OpenAI API key.")
  if (!crypto.available()) throw new Error("This computer cannot encrypt the key, so it was not saved.")
  writeFileSync(keyFile(dir), crypto.encrypt(trimmed), { mode: 0o600 })
}

export function clearKey(dir: string): void {
  rmSync(keyFile(dir), { force: true })
}

function loadKey(dir: string, crypto: KeyCrypto): string {
  if (!hasKey(dir)) throw new Error("Add your OpenAI API key in Settings first.")
  try {
    return crypto.decrypt(readFileSync(keyFile(dir)))
  } catch {
    throw new Error("The saved OpenAI key could not be read on this computer. Enter it again in Settings.")
  }
}

export function aiStatus(dir: string, crypto: KeyCrypto): AiStatus {
  return { hasKey: hasKey(dir), canEncrypt: crypto.available(), ...readSettings(dir) }
}

export function checkRequest(request: AiImageRequest): string | null {
  if (typeof request.prompt !== "string" || request.prompt.trim() === "") return "Write a prompt first."
  if (request.prompt.length > 4000) return "The prompt is too long (4000 characters at most)."
  if (!AI_IMAGE_MODES.includes(request.mode)) return `mode must be one of ${AI_IMAGE_MODES.join(", ")}.`
  if (!AI_IMAGE_SIZES.includes(request.size)) return `size must be one of ${AI_IMAGE_SIZES.join(", ")}.`
  if (!AI_IMAGE_QUALITIES.includes(request.quality)) return `quality must be one of ${AI_IMAGE_QUALITIES.join(", ")}.`
  return null
}

/** Added to the prompt in mask mode, where brightness becomes alpha. */
export const MASK_HINT = "Grayscale picture: a bright white subject on a pure black background, filling the frame without touching its edges. No border, no text."

/** The JSON sent to OpenAI. */
export function buildImageBody(request: AiImageRequest, model: string): Record<string, unknown> {
  const mask = request.mode === "mask"
  return {
    model,
    prompt: mask ? `${request.prompt.trim()}\n\n${MASK_HINT}` : request.prompt.trim(),
    n: 1,
    size: request.size,
    quality: request.quality,
    background: mask ? "opaque" : "transparent",
    output_format: "png"
  }
}

/** Turns OpenAI's answer into PNG bytes, or an error in plain words. */
export function readImageResponse(status: number, body: unknown, request: AiImageRequest, model: string): Buffer {
  const data = body as { data?: { b64_json?: unknown }[]; error?: { message?: unknown; code?: unknown } } | null
  if (status >= 200 && status < 300) {
    const encoded = data?.data?.[0]?.b64_json
    if (typeof encoded !== "string" || encoded === "") throw new Error("OpenAI answered without a picture.")
    const bytes = Buffer.from(encoded, "base64")
    const png = bytes.length > 8 && bytes.readUInt32BE(0) === 0x89504e47
    if (!png) throw new Error("OpenAI answered with something that is not a PNG picture.")
    return bytes
  }
  // OpenAI sometimes quotes part of the key in its message; that part is never passed on.
  const detail = typeof data?.error?.message === "string" ? data.error.message.slice(0, 400).replace(/sk-[\w*-]+/g, "sk-…") : ""
  if (status === 401) throw new Error("OpenAI did not accept the key. Check it in Settings.")
  if (status === 429) throw new Error(`OpenAI is rate limiting this key, or it is out of credit.${detail ? ` ${detail}` : ""}`)
  if (status === 400 && request.mode === "transparent" && /background|transparen/i.test(detail)) {
    throw new Error(`The model "${model}" refused a transparent background. Switch the node to mask mode, or pick another model in Settings. ${detail}`)
  }
  throw new Error(`OpenAI refused the request (${status}).${detail ? ` ${detail}` : ""}`)
}

/**
 * Tests point the app at a stand-in server on this machine. Nothing else is
 * accepted, so the key cannot be redirected to another host.
 */
export function endpoint(override: string | undefined): string {
  return override && /^http:\/\/127\.0\.0\.1:\d+\//.test(override) ? override : OPENAI_IMAGES_URL
}

/** Calls OpenAI and returns the PNG. The key is read here and goes nowhere else. */
export async function generateImage(dir: string, crypto: KeyCrypto, request: AiImageRequest, url = endpoint(process.env.VFXFORGE_OPENAI_URL)): Promise<Buffer> {
  const problem = checkRequest(request)
  if (problem) throw new Error(problem)
  const key = loadKey(dir, crypto)
  const { model } = readSettings(dir)
  let response: Response
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(buildImageBody(request, model)),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError"
    throw new Error(timedOut ? "OpenAI took too long to answer. Try again, or use a lower quality." : "Could not reach OpenAI. Check the internet connection.")
  }
  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    // An empty or non-JSON answer is reported by its status below.
  }
  return readImageResponse(response.status, body, request, model)
}

/** Counts pictures per agent session, so an agent cannot spend without limit. */
export function createAgentBudget(): { take: (session: string, settings: AiSettings) => string | null; refund: (session: string) => void } {
  const used = new Map<string, number>()
  return {
    take(session, settings) {
      if (!settings.agentAllowed) return "The artist has not allowed agents to generate images. They can turn it on in Settings, under AI images. Until then, set the prompt and ask them to press Generate."
      const count = used.get(session) ?? 0
      if (count >= settings.agentLimit) return `This session already generated ${count} image(s), the limit the artist set. Ask them to press Generate, or to raise the limit in Settings.`
      used.set(session, count + 1)
      return null
    },
    refund(session) {
      used.set(session, Math.max(0, (used.get(session) ?? 1) - 1))
    }
  }
}
