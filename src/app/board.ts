/** Editor commands for the reference board, comment threads and snapshots, and pictures of the project for the UI. */

import { useEffect, useState } from "react"
import { addComment, addReference, addSnapshot, BoardError, removeComment, removeReference, removeSnapshot, replyToComment, resolveComment, updateReference } from "../doc/board"
import type { Op } from "../doc"
import type { Rgba8Image } from "../engine/render"
import { session } from "./session"

export const ARTIST = { author: "You" }

/** Runs a board change as one undoable step; a refusal becomes a toast. */
function run<T>(label: string, build: () => { op: Op; value: T }): T | null {
  try {
    const { op, value } = build()
    return session.apply([op], label) ? value : null
  } catch (error) {
    if (error instanceof BoardError) {
      session.say(error.message, true)
      return null
    }
    throw error
  }
}
const project = () => session.getState().project

export async function addReferenceFromFile(): Promise<void> {
  const ref = await window.vfxforge?.importAsset(session.getState().path)
  if (!ref) return
  run("Add reference", () => {
    const { op, id } = addReference(project(), ref)
    return { op, value: id }
  })
}
export const setReferenceNote = (id: string, note: string): unknown => run("Reference note", () => ({ op: updateReference(project(), id, { note }), value: true }))
export const deleteReference = (id: string): unknown => run("Remove reference", () => ({ op: removeReference(project(), id), value: true }))

export function startComment(graphId: string, nodeId: string | undefined, text: string): string | null {
  return run("Comment", () => {
    const { op, id } = addComment(project(), { graphId, nodeId }, text, ARTIST)
    return { op, value: id }
  })
}
export const answerComment = (id: string, text: string): unknown => run("Reply", () => ({ op: replyToComment(project(), id, text, ARTIST), value: true }))
export const setCommentResolved = (id: string, resolved: boolean): unknown => run(resolved ? "Resolve comment" : "Reopen comment", () => ({ op: resolveComment(project(), id, resolved), value: true }))
export const deleteComment = (id: string): unknown => run("Delete comment", () => ({ op: removeComment(project(), id), value: true }))

/** Stores a rendered picture with the project and returns the op that lists it as a snapshot. */
export async function snapshotOp(image: Rgba8Image, shot: { graphId: string; target: string; frame: number; name?: string; by?: string }): Promise<{ op: Op; id: string }> {
  const data = new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength)
  const ref = await window.vfxforge?.storeImage(session.getState().path, { width: image.width, height: image.height, data })
  if (!ref) throw new BoardError("The snapshot could not be stored.")
  return addSnapshot(project(), { ...shot, image: ref })
}

export async function takeSnapshot(image: Rgba8Image, shot: { graphId: string; target: string; frame: number }): Promise<string | null> {
  try {
    const { op, id } = await snapshotOp(image, shot)
    if (!session.apply([op], "Snapshot")) return null
    session.say("Snapshot saved. Pick it under Compare to see it next to the current image.")
    return id
  } catch (error) {
    session.say(error instanceof Error ? error.message : "The snapshot could not be stored.", true)
    return null
  }
}
export const deleteSnapshot = (id: string): unknown => run("Delete snapshot", () => ({ op: removeSnapshot(project(), id), value: true }))

// ── Pictures of the project, for <img> ────────────────────

const urls = new Map<string, Promise<string | null>>()

/** An object URL for an image of the project. Kept for the life of the window; these are few and small. */
export function assetUrl(ref: string): Promise<string | null> {
  const path = session.getState().path
  const key = `${path ?? ""}|${ref}`
  let pending = urls.get(key)
  if (!pending) {
    pending = (window.vfxforge?.readAsset(path, ref) ?? Promise.resolve(null))
      .then((bytes) => (bytes ? URL.createObjectURL(new Blob([bytes as BlobPart], { type: ref.endsWith(".png") ? "image/png" : ref.endsWith(".webp") ? "image/webp" : "image/jpeg" })) : null))
      .catch(() => null)
    urls.set(key, pending)
    // A file that is not there yet may be found after a save or a move.
    void pending.then((url) => url === null && urls.delete(key))
  }
  return pending
}

export function useAssetUrl(ref: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let stale = false
    setUrl(null)
    if (ref) void assetUrl(ref).then((found) => !stale && setUrl(found))
    return () => {
      stale = true
    }
  }, [ref])
  return url
}

/** The pixels of an image of the project, for putting next to a render. */
export async function assetPixels(ref: string): Promise<Rgba8Image | null> {
  const bytes = await window.vfxforge?.readAsset(session.getState().path, ref)
  if (!bytes) return null
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart]))
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const context = canvas.getContext("2d")!
  context.drawImage(bitmap, 0, 0)
  const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height)
  bitmap.close()
  return { width: canvas.width, height: canvas.height, data }
}
