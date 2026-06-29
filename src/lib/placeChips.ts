// Horizontal de-overlap for the loop-lane name chips. Each chip wants to be
// centered on its bar; when neighbours in the same row would collide we offset
// them apart, and only when offsetting still can't fit do we shrink (truncate)
// them. Pure px-in / px-out so it's testable and the component just feeds
// measured widths. Run once PER bar row — chips in different rows are
// independent and never affect each other.

export type ChipInput = {
  id: string
  /** Desired centre of the chip (px), = midpoint of its bar. */
  centerPx: number
  /** Natural (untruncated) width of the chip in px. */
  widthPx: number
}

export type ChipPlacement = {
  id: string
  /** Left edge (px) within the row. */
  leftPx: number
  /** Final width (px) — equal to natural width unless truncation was needed. */
  widthPx: number
}

// A chip narrower than this can't show anything useful (ellipsis + icon), so we
// never shrink below it even if that means accepting overflow.
const MIN_CHIP_W = 28

/**
 * Place a row of chips so they (a) sit as close to their desired centre as
 * possible, (b) never overlap each other, and (c) stay within [0, containerWidth].
 * If the chips can't all fit at natural width, widths are reduced (water-filling:
 * narrow chips keep their size, wide ones give up space first) and the caller
 * applies the returned `widthPx` as a CSS max-width → ellipsis.
 */
export function placeChips(
  chips: ChipInput[],
  containerWidth: number,
  gap = 4
): ChipPlacement[] {
  const n = chips.length
  if (n === 0) return []

  // Sort by centre; remember original order so the output matches the input.
  const order = chips.map((_, i) => i).sort((a, b) => chips[a].centerPx - chips[b].centerPx)
  const sorted = order.map((i) => chips[i])

  const totalGap = gap * (n - 1)
  const available = Math.max(0, containerWidth - totalGap)

  // Step 1 — fit widths. Only shrink if natural widths overflow the row.
  const widths = sorted.map((c) => Math.max(0, c.widthPx))
  const naturalTotal = widths.reduce((s, w) => s + w, 0)
  const finalW = widths.slice()
  if (naturalTotal > available && available > 0) {
    // Water-filling: repeatedly hand each remaining chip an equal share; chips
    // that want less than their share keep their width and release the surplus.
    const idx = widths.map((_, i) => i).sort((a, b) => widths[a] - widths[b])
    let remaining = available
    let count = n
    const assigned = new Array<boolean>(n).fill(false)
    for (const i of idx) {
      const share = remaining / count
      if (widths[i] <= share) {
        finalW[i] = widths[i]
        remaining -= widths[i]
        count -= 1
        assigned[i] = true
      }
    }
    if (count > 0) {
      const share = Math.max(MIN_CHIP_W, remaining / count)
      for (let i = 0; i < n; i++) if (!assigned[i]) finalW[i] = share
    }
  }

  // Step 2 — forward pass: clamp left edges so nothing overlaps the previous chip.
  const left = new Array<number>(n)
  let cursor = 0
  for (let i = 0; i < n; i++) {
    const ideal = sorted[i].centerPx - finalW[i] / 2
    left[i] = Math.max(ideal, cursor)
    cursor = left[i] + finalW[i] + gap
  }

  // Step 3 — backward pass: pull edges back in so the row ends within bounds.
  let maxRight = containerWidth
  for (let i = n - 1; i >= 0; i--) {
    const maxLeft = maxRight - finalW[i]
    if (left[i] > maxLeft) left[i] = maxLeft
    maxRight = left[i] - gap
  }
  // The backward pass can push the first chip negative when the row truly can't
  // fit; clamp to 0 and accept any residual right overflow (caller clips it).
  if (left[0] < 0) left[0] = 0

  const out = new Array<ChipPlacement>(n)
  for (let s = 0; s < n; s++) {
    out[order[s]] = { id: sorted[s].id, leftPx: left[s], widthPx: finalW[s] }
  }
  return out
}
