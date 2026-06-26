import { OPS, type PDFDocumentProxy } from 'pdfjs-dist'

/**
 * Robustly decide whether a PDF is a scanned / raster document by inspecting the
 * CONTENT STREAM, not pixels or the text layer — both of which a "cleaned" scan
 * fools. (`And So It Goes.pdf` is the motivating case: a white-balanced scan whose
 * ink reads mostly-black so `isLikelyScanned`'s pixel heuristic says vector, plus a
 * 70-item OCR text layer so the "has a text layer" gate also says vector. Yet every
 * page is ONE `paintImageXObject` with ZERO path ops.)
 *
 * A vector score draws its notation as hundreds of path ops per page (staff lines,
 * stems, beams) and embeds no full-page image; a scan draws one raster image and no
 * paths. So a page is "raster" when it paints an image yet has ~no path ops. We
 * sample the first few pages, ignore blank/text-only pages (no ink ops — they cast
 * no vote), and call the document a scan when the inked pages are predominantly
 * raster. Requiring an image (not merely "few paths") is what keeps a legitimately
 * sparse vector page — e.g. notation drawn entirely from a music FONT — from being
 * misread as a scan.
 */

const PATH_OPS = new Set<number>([
  OPS.constructPath,
  OPS.stroke,
  OPS.closeStroke,
  OPS.fill,
  OPS.eoFill,
  OPS.fillStroke,
  OPS.eoFillStroke,
  OPS.closeFillStroke,
  OPS.closeEOFillStroke,
])
const IMAGE_OPS = new Set<number>([
  OPS.paintImageXObject,
  OPS.paintInlineImageXObject,
  OPS.paintImageMaskXObject,
  OPS.paintImageXObjectRepeat,
])

export type ScanCheckOptions = {
  /** How many leading pages to sample (a scan is uniform, so a few suffice). */
  samplePages?: number
  /** Fraction of inked pages that must be raster to call the doc a scan. */
  rasterFraction?: number
  /** A raster page has at most this many path ops (a vector score has hundreds). */
  maxVectorPaths?: number
}

const DEFAULTS: Required<ScanCheckOptions> = {
  samplePages: 5,
  rasterFraction: 0.6,
  maxVectorPaths: 8,
}

/** Per-page operator tally, exposed for tests/inspection. */
export type PageInkProfile = { page: number; imageOps: number; pathOps: number; raster: boolean; blank: boolean }

/** Tally the image-paint and path-construct ops on one page. */
export async function pageInkProfile(pdf: PDFDocumentProxy, page: number, maxVectorPaths = DEFAULTS.maxVectorPaths): Promise<PageInkProfile> {
  let imageOps = 0
  let pathOps = 0
  try {
    const { fnArray } = await pdf.getPage(page).then((p) => p.getOperatorList())
    for (const fn of fnArray) {
      if (IMAGE_OPS.has(fn)) imageOps += 1
      else if (PATH_OPS.has(fn)) pathOps += 1
    }
  } catch {
    /* unreadable page → counts as blank (no vote) */
  }
  return { page, imageOps, pathOps, raster: imageOps >= 1 && pathOps <= maxVectorPaths, blank: imageOps === 0 && pathOps === 0 }
}

/** True when the PDF is a scanned/raster document (see module doc). */
export async function isScannedPdf(pdf: PDFDocumentProxy, options: ScanCheckOptions = {}): Promise<boolean> {
  const opts = { ...DEFAULTS, ...options }
  const n = Math.min(pdf.numPages, opts.samplePages)
  let raster = 0
  let judged = 0
  for (let p = 1; p <= n; p += 1) {
    const prof = await pageInkProfile(pdf, p, opts.maxVectorPaths)
    if (prof.blank) continue // text-only / empty page casts no vote
    judged += 1
    if (prof.raster) raster += 1
  }
  return judged > 0 && raster / judged >= opts.rasterFraction
}
