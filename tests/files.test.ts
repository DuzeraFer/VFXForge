import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { autosavePath, BACKUP_COUNT, backupPath, listBackups, openProject, saveProject, writeAutosave } from "../electron/files"

let dir: string
let file: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "vfxforge-"))
  file = join(dir, "fire.vfxf")
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe("project files", () => {
  it("saves and opens", () => {
    saveProject(file, "v1")
    expect(openProject(file)).toEqual({ path: file, text: "v1" })
    expect(listBackups(file)).toEqual([])
  })

  it("keeps the replaced version as a backup, newest first", () => {
    saveProject(file, "v1")
    saveProject(file, "v2")
    saveProject(file, "v3")
    expect(readFileSync(file, "utf8")).toBe("v3")
    expect(listBackups(file).map((b) => readFileSync(b, "utf8"))).toEqual(["v2", "v1"])
  })

  it("does not back up when nothing changed", () => {
    saveProject(file, "v1")
    saveProject(file, "v1")
    expect(listBackups(file)).toEqual([])
  })

  it(`keeps at most ${BACKUP_COUNT} backups`, () => {
    for (let i = 0; i <= BACKUP_COUNT + 3; i++) saveProject(file, `v${i}`)
    const backups = listBackups(file)
    expect(backups).toHaveLength(BACKUP_COUNT)
    expect(readFileSync(backups[0], "utf8")).toBe(`v${BACKUP_COUNT + 2}`)
    expect(readFileSync(backupPath(file, BACKUP_COUNT), "utf8")).toBe("v3")
  })

  it("auto-save never touches the project and is cleared by a save", () => {
    saveProject(file, "v1")
    writeAutosave(file, "unsaved")
    expect(readFileSync(file, "utf8")).toBe("v1")
    expect(openProject(file).recovered).toBe("unsaved")
    saveProject(file, "v2")
    expect(existsSync(autosavePath(file))).toBe(false)
    expect(openProject(file).recovered).toBeUndefined()
  })

  it("ignores an auto-save older than the project", () => {
    saveProject(file, "v1")
    writeFileSync(autosavePath(file), "stale")
    const past = new Date(Date.now() - 60_000)
    utimesSync(autosavePath(file), past, past)
    expect(openProject(file).recovered).toBeUndefined()
  })
})
