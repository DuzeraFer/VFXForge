import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  aiStatus,
  buildImageBody,
  checkRequest,
  clearKey,
  createAgentBudget,
  DEFAULT_SETTINGS,
  endpoint,
  generateImage,
  MASK_HINT,
  OPENAI_IMAGES_URL,
  readImageResponse,
  readSettings,
  saveKey,
  writeSettings,
  type KeyCrypto
} from "../electron/ai"
import type { AiImageRequest } from "../src/ai/imageOptions"

/** Stands in for the operating system's keychain: reversible, but not the plain text. */
const crypto: KeyCrypto = {
  available: () => true,
  encrypt: (text) => Buffer.from([...Buffer.from(`enc:${text}`)].map((b) => b ^ 0x5a)),
  decrypt: (data) => {
    const text = Buffer.from([...data].map((b) => b ^ 0x5a)).toString()
    if (!text.startsWith("enc:")) throw new Error("bad data")
    return text.slice(4)
  }
}

const KEY = "sk-test-0123456789abcdef"
const request: AiImageRequest = { prompt: "a stylized smoke puff", mode: "transparent", size: "1024x1024", quality: "medium" }
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])

let dir: string
let server: Server | null = null
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "vfxforge-ai-"))
})
afterEach(async () => {
  rmSync(dir, { recursive: true, force: true })
  await new Promise<void>((done) => (server ? server.close(() => done()) : done()))
  server = null
})

type Seen = { authorization?: string; body: Record<string, unknown> }

async function standIn(answer: (seen: Seen) => { status: number; body: unknown }): Promise<{ url: string; seen: Seen[] }> {
  const seen: Seen[] = []
  server = createServer((req, res) => {
    let raw = ""
    req.on("data", (chunk: Buffer) => (raw += chunk.toString()))
    req.on("end", () => {
      const entry = { authorization: req.headers.authorization, body: JSON.parse(raw) as Record<string, unknown> }
      seen.push(entry)
      const { status, body } = answer(entry)
      res.writeHead(status, { "Content-Type": "application/json" })
      res.end(JSON.stringify(body))
    })
  })
  await new Promise<void>((done) => server!.listen(0, "127.0.0.1", done))
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/images/generations`, seen }
}

describe("OpenAI key", () => {
  it("is stored encrypted and never reported back", () => {
    expect(aiStatus(dir, crypto)).toEqual({ hasKey: false, canEncrypt: true, ...DEFAULT_SETTINGS })
    saveKey(dir, crypto, `  ${KEY}\n`)
    const status = aiStatus(dir, crypto)
    expect(status.hasKey).toBe(true)
    expect(JSON.stringify(status)).not.toContain("sk-")
    // Nothing on disk holds the key in plain text.
    for (const name of readdirSync(dir)) expect(readFileSync(join(dir, name)).includes(Buffer.from(KEY))).toBe(false)
    clearKey(dir)
    expect(aiStatus(dir, crypto).hasKey).toBe(false)
  })

  it("is refused when it cannot be encrypted or is not a key", () => {
    expect(() => saveKey(dir, { ...crypto, available: () => false }, KEY)).toThrow(/cannot encrypt/)
    expect(() => saveKey(dir, crypto, "   ")).toThrow(/empty/)
    expect(() => saveKey(dir, crypto, "two words")).toThrow(/does not look like/)
    expect(aiStatus(dir, crypto).hasKey).toBe(false)
  })
})

describe("settings", () => {
  it("default to agents off and survive bad values", () => {
    expect(readSettings(dir)).toEqual(DEFAULT_SETTINGS)
    expect(DEFAULT_SETTINGS.agentAllowed).toBe(false)
    expect(writeSettings(dir, { agentAllowed: true, agentLimit: 999, model: "gpt-image-2.5-flare" })).toEqual({ agentAllowed: true, agentLimit: 50, model: "gpt-image-2.5-flare" })
    expect(writeSettings(dir, { model: "not a model name!", agentLimit: 0 })).toEqual({ agentAllowed: true, agentLimit: 1, model: DEFAULT_SETTINGS.model })
    expect(readSettings(dir).agentAllowed).toBe(true)
  })
})

describe("image request", () => {
  it("asks for a transparent PNG, or for a bright subject on black in mask mode", () => {
    expect(buildImageBody(request, "gpt-image-2")).toEqual({
      model: "gpt-image-2",
      prompt: "a stylized smoke puff",
      n: 1,
      size: "1024x1024",
      quality: "medium",
      background: "transparent",
      output_format: "png"
    })
    const mask = buildImageBody({ ...request, mode: "mask" }, "gpt-image-2")
    expect(mask.background).toBe("opaque")
    expect(mask.prompt).toBe(`a stylized smoke puff\n\n${MASK_HINT}`)
  })

  it("is checked before anything is sent", () => {
    expect(checkRequest(request)).toBeNull()
    expect(checkRequest({ ...request, prompt: "  " })).toMatch(/prompt/)
    expect(checkRequest({ ...request, size: "64x64" as never })).toMatch(/size/)
    expect(checkRequest({ ...request, mode: "x" as never })).toMatch(/mode/)
    expect(checkRequest({ ...request, quality: "ultra" as never })).toMatch(/quality/)
  })

  it("only ever goes to OpenAI, or to a stand-in on this machine for tests", () => {
    expect(endpoint(undefined)).toBe(OPENAI_IMAGES_URL)
    expect(endpoint("https://evil.example/v1/images")).toBe(OPENAI_IMAGES_URL)
    expect(endpoint("http://127.0.0.1.evil.example:80/x")).toBe(OPENAI_IMAGES_URL)
    expect(endpoint("http://127.0.0.1:5000/v1/images/generations")).toBe("http://127.0.0.1:5000/v1/images/generations")
  })

  it("turns answers into pictures or plain errors", () => {
    expect(readImageResponse(200, { data: [{ b64_json: PNG_BYTES.toString("base64") }] }, request, "m")).toEqual(PNG_BYTES)
    expect(() => readImageResponse(200, { data: [] }, request, "m")).toThrow(/without a picture/)
    expect(() => readImageResponse(200, { data: [{ b64_json: Buffer.from("<html>").toString("base64") }] }, request, "m")).toThrow(/not a PNG/)
    expect(() => readImageResponse(401, { error: { message: "Incorrect API key provided: sk-te**cdef" } }, request, "m")).toThrow(/^OpenAI did not accept the key\. Check it in Settings\.$/)
    expect(() => readImageResponse(429, { error: { message: "Quota exceeded." } }, request, "m")).toThrow(/out of credit\. Quota exceeded\./)
    expect(() => readImageResponse(400, { error: { message: "Transparent background is not supported for this model." } }, request, "m")).toThrow(/mask mode/)
    expect(() => readImageResponse(500, null, request, "m")).toThrow(/refused the request \(500\)/)
  })
})

describe("generating", () => {
  it("sends the key only in the request and returns the PNG", async () => {
    const { url, seen } = await standIn(() => ({ status: 200, body: { data: [{ b64_json: PNG_BYTES.toString("base64") }] } }))
    saveKey(dir, crypto, KEY)
    writeSettings(dir, { model: "gpt-image-2.5-flare" })
    expect(await generateImage(dir, crypto, request, url)).toEqual(PNG_BYTES)
    expect(seen).toHaveLength(1)
    expect(seen[0].authorization).toBe(`Bearer ${KEY}`)
    expect(seen[0].body.model).toBe("gpt-image-2.5-flare")
    expect(JSON.stringify(seen[0].body)).not.toContain(KEY)
  })

  it("needs a key and a prompt, and reports failures without the key in them", async () => {
    const { url, seen } = await standIn(() => ({ status: 401, body: { error: { message: `Incorrect API key provided: ${KEY}` } } }))
    await expect(generateImage(dir, crypto, request, url)).rejects.toThrow(/Add your OpenAI API key in Settings/)
    saveKey(dir, crypto, KEY)
    await expect(generateImage(dir, crypto, { ...request, prompt: "" }, url)).rejects.toThrow(/Write a prompt/)
    expect(seen).toHaveLength(0)
    const failure = await generateImage(dir, crypto, request, url).catch((e: Error) => e.message)
    expect(failure).toBe("OpenAI did not accept the key. Check it in Settings.")
    await expect(generateImage(dir, crypto, request, "http://127.0.0.1:9/none")).rejects.toThrow(/Could not reach OpenAI/)
  })
})

describe("agent budget", () => {
  it("is closed until the artist opens it, then limited per session", () => {
    const budget = createAgentBudget()
    expect(budget.take("s1", DEFAULT_SETTINGS)).toMatch(/has not allowed/)
    const open = { ...DEFAULT_SETTINGS, agentAllowed: true, agentLimit: 2 }
    expect(budget.take("s1", open)).toBeNull()
    expect(budget.take("s1", open)).toBeNull()
    expect(budget.take("s1", open)).toMatch(/already generated 2/)
    // Another session has its own count; a failed request gives its turn back.
    expect(budget.take("s2", open)).toBeNull()
    budget.refund("s1")
    expect(budget.take("s1", open)).toBeNull()
  })
})
