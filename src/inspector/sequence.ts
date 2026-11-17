/** Packing the frames of an image sequence into one sheet (docs/04, Image Sequence). */

export type PackedSequence = { width: number; height: number; data: Uint8Array; cols: number; rows: number; count: number; cell: [number, number]; scaled: boolean }

/** The largest sheet side. Well inside what every GPU takes as one texture. */
export const MAX_SHEET_SIDE = 4096

/** Grid and frame size for `count` frames of `width`×`height`: near-square, frames scaled down only if the sheet would be too large. */
export function sequenceLayout(count: number, width: number, height: number, maxSide = MAX_SHEET_SIDE): { cols: number; rows: number; cell: [number, number]; scaled: boolean } {
  const cols = Math.max(1, Math.ceil(Math.sqrt(count)))
  const rows = Math.max(1, Math.ceil(count / cols))
  const scale = Math.min(1, maxSide / (cols * width), maxSide / (rows * height))
  return { cols, rows, cell: [Math.max(1, Math.floor(width * scale)), Math.max(1, Math.floor(height * scale))], scaled: scale < 1 }
}

/** Decodes the frames and draws them into one sheet, row by row. Every frame takes the size of the first. */
export async function packSequence(files: readonly Uint8Array[]): Promise<PackedSequence> {
  if (files.length === 0) throw new Error("No frames were chosen.")
  const first = await createImageBitmap(new Blob([files[0] as BlobPart]))
  const { cols, rows, cell, scaled } = sequenceLayout(files.length, first.width, first.height)
  const canvas = new OffscreenCanvas(cols * cell[0], rows * cell[1])
  const context = canvas.getContext("2d")!
  for (let i = 0; i < files.length; i++) {
    const bitmap = i === 0 ? first : await createImageBitmap(new Blob([files[i] as BlobPart]))
    context.drawImage(bitmap, (i % cols) * cell[0], Math.floor(i / cols) * cell[1], cell[0], cell[1])
    bitmap.close()
  }
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
  return { width: canvas.width, height: canvas.height, data: new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength), cols, rows, count: files.length, cell, scaled }
}
