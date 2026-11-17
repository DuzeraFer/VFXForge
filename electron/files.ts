/**
 * Project files on disk (docs/03 §3.1): atomic saves, rolling backups and
 * auto-save. Plain functions on paths, so they are tested without Electron.
 */

import { copyFileSync, existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs"

/** How many backups are kept next to a project: name.vfxf.bak, .bak2 … .bak10. */
export const BACKUP_COUNT = 10

export function backupPath(file: string, index: number): string {
  return index === 1 ? `${file}.bak` : `${file}.bak${index}`
}

export function autosavePath(file: string): string {
  return `${file}.autosave`
}

function writeAtomic(file: string, text: string): void {
  const temp = `${file}.tmp-${process.pid}`
  writeFileSync(temp, text, "utf8")
  renameSync(temp, file)
}

/** Shifts existing backups up by one and copies the current file to `.bak`. */
function rotateBackups(file: string): void {
  rmSync(backupPath(file, BACKUP_COUNT), { force: true })
  for (let i = BACKUP_COUNT - 1; i >= 1; i--) {
    if (existsSync(backupPath(file, i))) renameSync(backupPath(file, i), backupPath(file, i + 1))
  }
  copyFileSync(file, backupPath(file, 1))
}

/**
 * Saves a project. The version being replaced is kept as a backup (unless
 * nothing changed), and the auto-save for this file is cleared.
 */
export function saveProject(file: string, text: string): void {
  if (existsSync(file)) {
    if (readFileSync(file, "utf8") !== text) {
      rotateBackups(file)
      writeAtomic(file, text)
    }
  } else {
    writeAtomic(file, text)
  }
  rmSync(autosavePath(file), { force: true })
}

/** Writes unsaved work next to the project without touching the project itself. */
export function writeAutosave(file: string, text: string): void {
  writeAtomic(autosavePath(file), text)
}

export type OpenedProject = {
  path: string
  text: string
  /** Unsaved work from a session that did not end cleanly, if it is newer than the file. */
  recovered?: string
}

export function openProject(file: string): OpenedProject {
  const text = readFileSync(file, "utf8")
  const autosave = autosavePath(file)
  if (existsSync(autosave) && statSync(autosave).mtimeMs >= statSync(file).mtimeMs) {
    const recovered = readFileSync(autosave, "utf8")
    if (recovered !== text) return { path: file, text, recovered }
  }
  return { path: file, text }
}

/** Backups that exist for a project, newest first. */
export function listBackups(file: string): string[] {
  const found: string[] = []
  for (let i = 1; i <= BACKUP_COUNT; i++) {
    if (existsSync(backupPath(file, i))) found.push(backupPath(file, i))
  }
  return found
}
