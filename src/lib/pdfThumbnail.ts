/**
 * Lazily renders page 1 of a song's PDF to a small JPEG data URL for the library
 * card preview. Optimised for fast loading: low render scale + JPEG compression,
 * with a module-level cache (and in-flight de-dupe) so a given PDF is rasterised
 * at most once per session and re-renders are instant.
 */
import { getDocument } from 'pdfjs-dist'
import { getBlob } from './library'

const cache = new Map<string, string>()
const inflight = new Map<string, Promise<string | null>>()

export type ThumbnailOptions = {
  /** Target raster width in CSS px. Small = fast; the card scales it up. */
  width?: number
  /** JPEG quality 0–1. */
  quality?: number
}

export async function getPdfThumbnail(
  pdfBlobKey: string,
  opts: ThumbnailOptions = {}
): Promise<string | null> {
  const cached = cache.get(pdfBlobKey)
  if (cached) return cached
  const pending = inflight.get(pdfBlobKey)
  if (pending) return pending

  const run = (async (): Promise<string | null> => {
    try {
      const blob = await getBlob(pdfBlobKey)
      if (!blob) return null
      const data = await blob.arrayBuffer()
      const pdf = await getDocument({ data }).promise
      try {
        const page = await pdf.getPage(1)
        const targetWidth = opts.width ?? 320
        const base = page.getViewport({ scale: 1 })
        const scale = base.width > 0 ? targetWidth / base.width : 1
        const viewport = page.getViewport({ scale })
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.ceil(viewport.width))
        canvas.height = Math.max(1, Math.ceil(viewport.height))
        const ctx = canvas.getContext('2d')
        if (!ctx) return null
        await page.render({ canvasContext: ctx, viewport }).promise
        const url = canvas.toDataURL('image/jpeg', opts.quality ?? 0.7)
        cache.set(pdfBlobKey, url)
        return url
      } finally {
        void pdf.destroy()
      }
    } catch {
      return null
    } finally {
      inflight.delete(pdfBlobKey)
    }
  })()

  inflight.set(pdfBlobKey, run)
  return run
}
