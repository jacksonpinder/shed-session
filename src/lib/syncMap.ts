import type { SheetPosition } from './types'
import { bandForY, type SystemBand } from './detectSystems.ts'

/**
 * A single time→score anchor. `page` + `yWithinPageRatio` are exactly the fields
 * the scroll engine consumes (see SheetPosition), so an Anchor can be handed
 * straight to scrollToSheetPosition() or stored as a loop's sheetLink.
 */
export type Anchor = {
  /** Audio position, seconds. */
  time: number
  /** 1-based PDF page. */
  page: number
  /** Vertical position within the page, 0 (top) … 1 (bottom). */
  yWithinPageRatio: number
  /** The matched lyric word, for debugging/inspection. */
  text: string
  /** Alignment confidence, 0…1. */
  confidence: number
  /** Horizontal position of the matched lyric within the page, 0…1 (optional; for overlays). */
  xWithinPageRatio?: number
  /** The Whisper word that matched this lyric (optional; for overlays/inspection). */
  heard?: string
}

/** The generated sync map: anchors sorted ascending by time. */
export type SyncMap = {
  version: 1
  /** Content hash of the source audio, for caching. */
  sourceHash: string
  anchors: Anchor[]
}

/** An Anchor narrowed to the shape the scroll engine consumes. */
export function anchorToSheetPosition(anchor: Anchor): SheetPosition {
  return { page: anchor.page, yWithinPageRatio: anchor.yWithinPageRatio }
}

/**
 * Binary-search the anchor at or just before `time`. Anchors must be sorted by
 * time. Returns null if the map is empty. Used by both loop auto-link (nearest
 * anchor to loop.start) and the playback auto-scroll driver.
 */
export function anchorAtTime(anchors: Anchor[], time: number): Anchor | null {
  if (anchors.length === 0) {
    return null
  }
  let lo = 0
  let hi = anchors.length - 1
  if (time <= anchors[0].time) {
    return anchors[0]
  }
  if (time >= anchors[hi].time) {
    return anchors[hi]
  }
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (anchors[mid].time <= time) {
      lo = mid
    } else {
      hi = mid - 1
    }
  }
  // lo is the last anchor with time <= target; return whichever neighbour is closer.
  const before = anchors[lo]
  const after = anchors[Math.min(lo + 1, anchors.length - 1)]
  return Math.abs(time - before.time) <= Math.abs(after.time - time) ? before : after
}

/**
 * Resolve an audio time to a scroll position: find the nearest anchor, then map
 * its lyric y to the TOP of the system it sits in (so scrolling reveals the whole
 * system, not just the lyric line). `bandsByPage` is the detectSystems output per
 * page (1-based). Falls back to the lyric's own y if no bands are known for that
 * page. Returns null only when there are no anchors. Used by both loop auto-link
 * (time = loop start) and the playback auto-scroll driver (time = currentTime).
 */
export function resolveScrollPosition(
  anchors: Anchor[],
  bandsByPage: Record<number, SystemBand[]>,
  time: number
): SheetPosition | null {
  const anchor = anchorAtTime(anchors, time)
  if (!anchor) {
    return null
  }
  const bands = bandsByPage[anchor.page]
  const band = bands ? bandForY(bands, anchor.yWithinPageRatio) : null
  return {
    page: anchor.page,
    yWithinPageRatio: band ? band.topRatio : anchor.yWithinPageRatio,
  }
}
