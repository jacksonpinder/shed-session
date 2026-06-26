/**
 * System-band detector.
 *
 * A "system" is a horizontal band of one or more staves that are played together
 * and span the page width. To auto-scroll so a full system is revealed, we need
 * the y of each system's top — which a lyric's position does NOT give us (lyrics
 * sit above OR below the staff, e.g. barbershop). So this detector works purely
 * from the rendered pixels and is independent of lyrics and of which notation app
 * / font produced the PDF.
 *
 * Approach — staves first, then group them into systems:
 *   1. Pick a dark/paper luma threshold per page (Otsu), then build per-row
 *      profiles: dark-pixel fraction (blank detection) and longest continuous
 *      dark run (staff lines — one long continuous line, unlike scattered note
 *      ink or a short final-system staff).
 *   2. Detect staff lines and group them into staves (5-line groups; lone
 *      horizontal runs like extender lines / ties are filtered out).
 *   3. Group staves into systems by BARLINE CONNECTIVITY: within a system a
 *      barline (or left-edge bracket) spans the gap between staves as a
 *      near-full-height vertical dark run; between systems nothing crosses. The
 *      vertical scan checks every column — a connector can be a 1–2px line. This
 *      is size-independent, so it's robust to varying gutter heights, annotation
 *      text bridging a gutter, and any number of staves per system.
 *   4. A system's top/bottom is the nearest blank gutter above / below it.
 *
 * Best on vector scores. Scanned PDFs (gray, noisy) are unreliable — call
 * isLikelyScanned() first to decide whether to trust the result.
 *
 * Output ratios are 0 (top) … 1 (bottom) of the page, matching the scroll
 * engine's yWithinPageRatio. The caller adds its own viewport padding at scroll
 * time.
 */

export type SystemBand = {
  /** Top of the system: bottom edge of the gutter above it. 0…1 of page height. */
  topRatio: number
  /** Bottom of the system: top edge of the gutter below it. 0…1. */
  bottomRatio: number
  /** Top staff line position, 0…1. */
  firstLineRatio: number
  /** Bottom staff line position, 0…1. */
  lastLineRatio: number
  /**
   * Number of measures in this system, counted from full-height barlines (0 if
   * not computed / undetectable). Approximate — see detectMeasuresInSystem.
   */
  measureCount?: number
  /**
   * The measure-boundary barline x-positions, left→right, 0…1 of page width
   * (length = measureCount + 1 when detected). Lets a timing model place a time
   * within a system, not just at its top.
   */
  barlineXRatios?: number[]
  /** Debug only (opts.debugBarlines): per-staff barline candidate x-ratios before
   * the cross-staff combine, to see which staff missed a barline. */
  perStaffBarlineXRatios?: number[][]
}

export type DetectSystemsResult = {
  bands: SystemBand[]
  /** Median spacing between adjacent staff lines, as a ratio of page height. */
  staffSpaceRatio: number
  /** Per-row dark-pixel fraction (length = page height), for debug overlays. */
  profile?: number[]
}

export type DetectSystemsOptions = {
  /**
   * A row counts as a staff line when its longest continuous dark run spans at
   * least this fraction of the width (0…1). Run-based (not total ink) so short,
   * indented final-system staves are caught and note-dense rows are excluded.
   */
  lineRunRatio?: number
  /** A row counts as blank when its dark fraction is at or below this (0…1). */
  blankThreshold?: number
  /**
   * A pixel is "dark" when its luminance is below this (0…255). Used as a
   * fallback / clamp anchor; the actual threshold is chosen per page by Otsu
   * unless `adaptiveLuma` is false. (Different PDFs render ink at different
   * darkness — thin lines anti-alias to gray at larger scales.)
   */
  darkLuma?: number
  /** Pick the dark/paper threshold per page via Otsu (recommended). */
  adaptiveLuma?: boolean
  /** Sample every Nth column when counting dark pixels (perf). */
  columnStep?: number
  /** Lines belong to different staves when their gap exceeds this × staff-space. */
  staffGapFactor?: number
  /**
   * Cap a staff's total span at this × its own line spacing. A 5-line staff spans
   * 4 spaces; this (default 4.5) keeps a stray sub-staff line just below the bottom
   * line (tie/slur/lyric underline) from being grouped in and inflating the box,
   * which otherwise makes full-height barlines read as too short. Span-based so it
   * tolerates a missing internal line (still ~4 spaces) while rejecting a trailing one.
   */
  maxStaffSpanFactor?: number
  /**
   * Minimum lines for a group to count as a staff. Filters lone horizontal runs
   * — melisma extender lines ("ah‿‿"), long ties, hairpins — that aren't staves.
   */
  minLinesPerStaff?: number
  /** Ignore blank runs shorter than this (px). */
  minBlankRunPx?: number
  /**
   * Two adjacent staves are in the same system when a barline connects them — a
   * vertical dark run spanning at least this fraction of the gap between them.
   * The signal is sharply bimodal (≈1.0 connected vs <0.35 not).
   */
  barlineConnectRatio?: number
  /** Fallback margin above the top staff line (× staff-space) when no gutter run. */
  topMarginStaves?: number
  /** Count measures per system from full-height barlines. */
  detectMeasures?: boolean
  /**
   * A column is a barline when its longest vertical dark run spans at least this
   * fraction of the STAFF height (scanned per-staff). Set high (0.92): a real barline
   * pierces both outer lines so its run is the full staff height (~1.0·sh), while a
   * note stem stops short of a line (its notehead/beam reaches the line via an offset
   * curve, not the column) so it runs ~0.85–0.90·sh and is rejected. This single
   * threshold replaced a separate notehead-blob filter (see detectMeasuresInSystem).
   */
  barlineHeightRatio?: number
  /**
   * Minimum measure width as a fraction of page width. Consecutive barlines closer
   * than this are merged — folds the system bracket into the opening barline and a
   * double/final barline (thin+thick, ~0.01–0.02·W apart) into one. Must stay below a
   * genuinely narrow real measure (~0.044·W) or those get eaten (under-count); 0.035
   * sits in the empty band between the two classes (ground-truth sweep flat 0.025–0.04).
   */
  minMeasureWidthRatio?: number
  /**
   * A column whose longest continuous vertical dark run spans at least this
   * fraction of the PAGE height is treated as a page-spanning line (a margin rule
   * or full-page bracket, e.g. "And So It Goes") and excluded from the inter-system
   * connectivity scan and from measure detection. Such a line bridges EVERY
   * inter-system gap and would merge all staves into one system; a real per-system
   * bracket spans only its own system (≤~0.31 of page height even on 2-system
   * pages, vs ≥~0.5 for a page-spanning line), so this cleanly separates them
   * without the false positives of a fixed left-margin skip (which also clobbers
   * legitimate left-edge system brackets, e.g. barbershop "All Of Me").
   */
  pageSpanRatio?: number
  /**
   * Minimum number of a system's staves a vertical must appear in to count as a
   * barline. 0 = auto (all staves for 1–2-staff systems; all-but-one for 3+).
   * Lower = more sensitive (catches a barline the scan missed in one staff) but
   * admits more single-staff note-ink false positives. Notehead rejection is the
   * primary stem filter, so this is a secondary cross-check.
   */
  minBarlineStaves?: number
  /** Include the raw profile array in the result (debug). */
  includeProfile?: boolean
  /** Attach per-staff barline candidates to each band (debug). */
  debugBarlines?: boolean
}

const DEFAULTS = {
  lineRunRatio: 0.15,
  blankThreshold: 0.004,
  darkLuma: 150,
  adaptiveLuma: true,
  columnStep: 3,
  staffGapFactor: 2.5,
  maxStaffSpanFactor: 4.5,
  minLinesPerStaff: 3,
  minBlankRunPx: 6,
  barlineConnectRatio: 0.5,
  topMarginStaves: 4,
  detectMeasures: true,
  barlineHeightRatio: 0.92,
  minMeasureWidthRatio: 0.035,
  pageSpanRatio: 0.5,
  minBarlineStaves: 0,
  includeProfile: false,
  debugBarlines: false,
} satisfies Required<DetectSystemsOptions>

const median = (values: number[]): number => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * Otsu's method: pick the luma threshold that best separates ink from paper for
 * this page, so detection adapts to how darkly a given PDF renders. Sampled
 * coarsely (the histogram doesn't need every pixel) and clamped to a sane range.
 */
const otsuThreshold = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  sampleStep: number,
  fallback: number
): number => {
  const hist = new Array<number>(256).fill(0)
  let total = 0
  for (let y = 0; y < height; y += sampleStep) {
    const rowStart = y * width * 4
    for (let x = 0; x < width; x += sampleStep) {
      const i = rowStart + x * 4
      const a = data[i + 3]
      const luma = a < 8 ? 255 : 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
      hist[Math.min(255, Math.max(0, Math.round(luma)))] += 1
      total += 1
    }
  }
  if (total === 0) return fallback
  let sum = 0
  for (let t = 0; t < 256; t += 1) sum += t * hist[t]
  let sumB = 0
  let wB = 0
  let maxVar = -1
  let threshold = fallback
  for (let t = 0; t < 256; t += 1) {
    wB += hist[t]
    if (wB === 0) continue
    const wF = total - wB
    if (wF === 0) break
    sumB += t * hist[t]
    const mB = sumB / wB
    const mF = (sum - sumB) / wF
    const between = wB * wF * (mB - mF) * (mB - mF)
    if (between > maxVar) {
      maxVar = between
      threshold = t
    }
  }
  return Math.min(210, Math.max(120, threshold))
}

type Run = { start: number; end: number; height: number } // inclusive rows
type Staff = { first: number; last: number } // top/bottom staff-line rows

/** The tallest blank run lying fully inside the open interval (lo, hi), or null. */
const tallestRunBetween = (runs: Run[], lo: number, hi: number): Run | null => {
  let best: Run | null = null
  for (const run of runs) {
    if (run.start > lo && run.end < hi && (!best || run.height > best.height)) best = run
  }
  return best
}

/** Merge a sorted list of barline columns (px) into line centres (a line is 1–3px
 * wide); columns within `mergePx` collapse to one. */
const mergeColumns = (cols: number[], mergePx: number): number[] => {
  if (cols.length === 0) return []
  const out: number[] = []
  let gStart = cols[0]
  let gPrev = cols[0]
  for (let k = 1; k < cols.length; k += 1) {
    if (cols[k] - gPrev <= mergePx) {
      gPrev = cols[k]
    } else {
      out.push((gStart + gPrev) / 2)
      gStart = cols[k]
      gPrev = cols[k]
    }
  }
  out.push((gStart + gPrev) / 2)
  return out
}

/**
 * Count measures in one system by finding barlines — scanning PER STAFF and then
 * keeping only the x-positions that line up across the system's staves.
 *
 * Why per-staff: in bracketed multi-staff systems (barbershop, piano-vocal) the
 * barlines are very often drawn one-per-staff and DON'T span the whole system, so
 * a single "0.8 × full-system-height" scan finds nothing (this was the long-
 * standing monster.pdf "faint barlines" red herring — they're not faint, they're
 * one-staff tall). Scanning each staff against its OWN height finds them.
 *
 * Two filters separate barlines from note ink, in order of strength:
 *   - height: the dark run spans the staff TOP line → BOTTOM line, reaching within
 *     `endTol` of both (the endpoint check, gated by `barlineHeightRatio` 0.92). This
 *     is the load-bearing filter: a real barline pierces both lines so its run is the
 *     full staff height (~1.0–1.02·sh), while a note STEM stops short of at least one
 *     line — its notehead/beam reaches the line only via an offset CURVE, not the
 *     column — so its longest in-column run is ~0.85–0.90·sh and fails. This holds
 *     even for homophonic writing (barbershop/SATB) where shared-rhythm stems align
 *     across every staff. (A prior `columnHitsNotehead` "wide blob beside the column"
 *     filter was REMOVED Jun '26: raising the height bar made it redundant for stems,
 *     and it actively mis-rejected real full-height barlines crossed by a tie/slur.)
 *   - alignment: a real barline sits at the SAME x in (nearly) every staff of the
 *     system; residual note ink does not. A single-staff system has no alignment
 *     signal, so every clean full-height line is kept.
 * The opening bracket is folded into the first barline (lines closer than a minimum
 * measure width collapse).
 */
const detectMeasuresInSystem = (
  data: Uint8ClampedArray,
  width: number,
  staves: Staff[],
  darkLuma: number,
  heightRatio: number,
  minWidthPx: number,
  mergePx: number,
  minBarlineStaves: number,
  spanningCols?: Uint8Array
): { count: number; boundaryXRatios: number[]; perStaff: number[][] } => {
  // Per-staff barline lines (centres, px), each scanned against that staff's own
  // top→bottom staff-line height.
  const perStaff: number[][] = []
  for (const staff of staves) {
    const yTop = Math.round(staff.first)
    const yBot = Math.round(staff.last)
    const sh = yBot - yTop
    if (sh <= 4) continue
    const need = heightRatio * sh
    // A barline's dark run spans the staff from its TOP line to its BOTTOM line; a
    // note stem (even a tall one) sits in the interior and its longest run reaches
    // neither outer line. So besides being tall enough, require the run to start
    // near the top line and end near the bottom line — this is what cleanly drops
    // stems that happen to align across staves (common when voices share a rhythm).
    const endTol = Math.max(2, Math.round((1 - heightRatio) * sh * 0.6))
    const cols: number[] = []
    for (let x = 0; x < width; x += 1) {
      if (spanningCols && spanningCols[x]) continue // skip page-spanning margin lines
      let run = 0
      let runStart = 0
      let bestLen = 0
      let bestStart = 0
      let bestEnd = -1
      for (let y = yTop; y <= yBot; y += 1) {
        const i = (y * width + x) * 4
        const a = data[i + 3]
        const luma = a < 8 ? 255 : 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
        if (luma < darkLuma) {
          if (run === 0) runStart = y
          run += 1
          if (run > bestLen) {
            bestLen = run
            bestStart = runStart
            bestEnd = y
          }
        } else {
          run = 0
        }
      }
      if (bestLen >= need && bestStart <= yTop + endTol && bestEnd >= yBot - endTol) cols.push(x)
    }
    perStaff.push(mergeColumns(cols, mergePx))
  }
  const perStaffRatios = perStaff.map((lines) => lines.map((x) => x / width))
  if (perStaff.length === 0) return { count: 1, boundaryXRatios: [], perStaff: perStaffRatios }

  // Combine across staves: cluster all per-staff lines by x, and keep a cluster as a
  // barline when it shows up in enough staves — note ink that slipped the per-staff
  // filters rarely lines up across the whole system. All staves for a 1–2-staff
  // system; allow one miss (render noise) from 3 staves up.
  const flat = perStaff.flatMap((lines, s) => lines.map((x) => ({ x, s }))).sort((a, b) => a.x - b.x)
  const n = perStaff.length
  const need = minBarlineStaves > 0 ? Math.min(n, minBarlineStaves) : n <= 2 ? n : n - 1
  const boundaries: number[] = []
  for (let i = 0; i < flat.length; ) {
    let j = i
    const staffSet = new Set<number>()
    let sumX = 0
    while (j < flat.length && flat[j].x - flat[i].x <= mergePx) {
      staffSet.add(flat[j].s)
      sumX += flat[j].x
      j += 1
    }
    if (staffSet.size >= need) boundaries.push(sumX / (j - i))
    i = j
  }

  // Collapse boundaries closer than a minimum measure width. This folds the opening
  // bracket/brace into the first barline AND merges a double/final barline (thin+thick,
  // drawn ~0.01–0.02·W apart) into one. The threshold must stay BELOW a genuinely narrow
  // real measure (~0.044·W, e.g. And Can It Be) or those get eaten and the system
  // under-counts — see minMeasureWidthRatio (0.035 sits in the empty band between the
  // two classes; the per-corpus ground-truth sweep is flat across 0.025–0.04).
  const kept: number[] = []
  for (const g of boundaries) {
    if (kept.length === 0 || g - kept[kept.length - 1] >= minWidthPx) kept.push(g)
  }
  return { count: Math.max(1, kept.length - 1), boundaryXRatios: kept.map((x) => x / width), perStaff: perStaffRatios }
}

export function detectSystems(
  canvas: HTMLCanvasElement,
  options: DetectSystemsOptions = {}
): DetectSystemsResult {
  const opts = { ...DEFAULTS, ...options }
  const width = canvas.width
  const height = canvas.height
  const empty: DetectSystemsResult = { bands: [], staffSpaceRatio: 0 }
  if (!width || !height) return empty

  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return empty

  let image: ImageData
  try {
    image = ctx.getImageData(0, 0, width, height)
  } catch {
    return empty // tainted canvas
  }
  const data = image.data

  // Adapt the dark/paper threshold to this page's rendering (anti-aliased thin
  // lines on a large canvas can be gray rather than black).
  const darkLuma = opts.adaptiveLuma
    ? otsuThreshold(data, width, height, Math.max(4, opts.columnStep), opts.darkLuma)
    : opts.darkLuma

  // 1. Per-row profiles: dark fraction (blank detection) and longest dark run
  //    fraction (staff-line detection).
  const step = Math.max(1, opts.columnStep)
  const sampledCols = Math.ceil(width / step)
  const profile = new Array<number>(height)
  const runProfile = new Array<number>(height)
  for (let y = 0; y < height; y += 1) {
    let dark = 0
    let run = 0
    let maxRun = 0
    const rowStart = y * width * 4
    for (let x = 0; x < width; x += step) {
      const i = rowStart + x * 4
      const a = data[i + 3]
      const luma = a < 8 ? 255 : 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
      if (luma < opts.darkLuma) {
        dark += 1
        run += 1
        if (run > maxRun) maxRun = run
      } else {
        run = 0
      }
    }
    profile[y] = dark / sampledCols
    runProfile[y] = maxRun / sampledCols
  }
  const withProfile = (result: DetectSystemsResult): DetectSystemsResult =>
    opts.includeProfile ? { ...result, profile } : result

  // 2. Staff lines → staves. Merge run-positive rows into lines, group lines into
  //    staves by spacing, and keep only groups with enough lines (drops lone
  //    horizontal runs: extender lines, ties, hairpins).
  const rawLines: number[] = []
  {
    let runStart = -1
    for (let y = 0; y <= height; y += 1) {
      const isLine = y < height && runProfile[y] >= opts.lineRunRatio
      if (isLine && runStart < 0) {
        runStart = y
      } else if (!isLine && runStart >= 0) {
        rawLines.push((runStart + (y - 1)) / 2)
        runStart = -1
      }
    }
  }
  const rawGaps: number[] = []
  for (let k = 1; k < rawLines.length; k += 1) rawGaps.push(rawLines[k] - rawLines[k - 1])
  const staffSpaceRaw = median(rawGaps.filter((g) => g > 0)) || height
  const staffBreak = staffSpaceRaw * opts.staffGapFactor

  const staves: Staff[] = []
  const withinStaffGaps: number[] = []
  {
    let group: number[] = rawLines.length ? [rawLines[0]] : []
    // A staff is ~5 evenly spaced lines spanning ~4 staff-spaces. A sub-staff-line
    // artifact (a tie/slur, hairpin, or lyric underline) running near-horizontally
    // just past the top or bottom line can fall within staffBreak (2.5×) of it and
    // get swallowed into the staff, stretching its box ~1–2 spaces too tall. That
    // then makes a genuine full-height barline read as only ~70% tall and get
    // rejected (the per-staff measure scan keys off staff.first→staff.last). Trim
    // such a line back off before recording the staff: while the group over-spans
    // (> maxStaffSpanFactor × staff-space) AND one end gap is clearly anomalous
    // (> 1.3× the group's median gap), drop that end. Gating on SPAN tolerates a
    // MISSING internal line (the remaining lines still span ~4 spaces, so no trim);
    // the anomalous-gap test leaves a uniformly large staff (all gaps equal) intact.
    const maxSpan = opts.maxStaffSpanFactor * staffSpaceRaw
    const flush = () => {
      let g = group
      while (g.length > opts.minLinesPerStaff && g[g.length - 1] - g[0] > maxSpan) {
        const gaps: number[] = []
        for (let i = 1; i < g.length; i += 1) gaps.push(g[i] - g[i - 1])
        const med = median(gaps)
        const firstGap = g[1] - g[0]
        const lastGap = g[g.length - 1] - g[g.length - 2]
        if (Math.max(firstGap, lastGap) <= 1.3 * med) break // uniform staff, not an artifact
        g = firstGap >= lastGap ? g.slice(1) : g.slice(0, -1)
      }
      if (g.length >= opts.minLinesPerStaff) {
        staves.push({ first: g[0], last: g[g.length - 1] })
        for (let i = 1; i < g.length; i += 1) withinStaffGaps.push(g[i] - g[i - 1])
      }
    }
    for (let k = 1; k <= rawLines.length; k += 1) {
      const line = rawLines[k]
      if (line === undefined || line - rawLines[k - 1] > staffBreak) {
        flush()
        group = line === undefined ? [] : [line]
      } else {
        group.push(line)
      }
    }
  }
  const staffSpace = median(withinStaffGaps) || staffSpaceRaw
  if (staves.length === 0) {
    return withProfile({ bands: [], staffSpaceRatio: staffSpace / height })
  }

  // 3. Blank runs across the page.
  const blankRuns: Run[] = []
  {
    let runStart = -1
    for (let y = 0; y <= height; y += 1) {
      const isBlank = y < height && profile[y] <= opts.blankThreshold
      if (isBlank && runStart < 0) {
        runStart = y
      } else if (!isBlank && runStart >= 0) {
        const len = y - runStart
        if (len >= opts.minBlankRunPx) blankRuns.push({ start: runStart, end: y - 1, height: len })
        runStart = -1
      }
    }
  }

  // Page-spanning lines (a left margin rule or a full-page bracket, e.g. "And So
  // It Goes") have a continuous vertical dark run covering most of the page, so they
  // bridge EVERY inter-system gap and would merge all staves into one system. A real
  // per-system bracket spans only its own system. Find the spanning columns (longest
  // run ≥ pageSpanRatio of page height) and exclude them — and their anti-aliased
  // neighbours — from connectivity and measure detection. This is robust where a
  // fixed left-margin skip is NOT: that skip also clobbers legitimate left-edge
  // system brackets (e.g. barbershop "All Of Me"'s bracket at x≈0.07, which connects
  // each Tenor/Lead + Bari/Bass pair), wrongly splitting double-staff systems.
  const spanNeed = opts.pageSpanRatio * height
  const spanning = new Uint8Array(width)
  for (let x = 0; x < width; x += 1) {
    let run = 0
    let best = 0
    for (let y = 0; y < height; y += 1) {
      const i = (y * width + x) * 4
      const a = data[i + 3]
      const luma = a < 8 ? 255 : 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
      if (luma < darkLuma) {
        run += 1
        if (run > best) best = run
      } else {
        run = 0
      }
    }
    if (best >= spanNeed) spanning[x] = 1
  }
  // Dilate by a couple px so a thin line's anti-aliased sibling columns (which can
  // fall below the run threshold) are excluded too.
  const spanningCols = new Uint8Array(width)
  const dilate = Math.max(1, Math.round(0.004 * width))
  for (let x = 0; x < width; x += 1) {
    if (!spanning[x]) continue
    for (let dx = -dilate; dx <= dilate; dx += 1) {
      const xx = x + dx
      if (xx >= 0 && xx < width) spanningCols[xx] = 1
    }
  }

  // 4. A gap between two staves is a system boundary when no barline connects
  //    them. Within a system, barlines span the gap (a near-full-height vertical
  //    dark run); between systems nothing crosses. This is size-independent, so
  //    it's robust where gutter heights vary widely or are bridged by annotation
  //    text, and it handles any number of staves per system.
  const isBoundary: boolean[] = []
  for (let k = 1; k < staves.length; k += 1) {
    // Staff positions are averaged line centres (fractional); round before using
    // them as pixel y-coordinates so the byte offset stays aligned.
    const y0 = Math.round(staves[k - 1].last) + 2
    const y1 = Math.round(staves[k].first) - 2
    const gapHeight = y1 - y0
    if (gapHeight <= 2) {
      isBoundary.push(false) // staves practically touching → same system
      continue
    }
    // Scan EVERY column (not subsampled): a connecting barline / system bracket
    // can be a 1–2px-wide vertical line that falls between coarser samples. Skip
    // page-spanning lines (see spanningCols above) so a margin rule / full-page
    // bracket doesn't bridge this gap.
    let maxRun = 0
    for (let x = 0; x < width; x += 1) {
      if (spanningCols[x]) continue
      let run = 0
      for (let y = y0; y <= y1; y += 1) {
        const i = (y * width + x) * 4
        const a = data[i + 3]
        const luma = a < 8 ? 255 : 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
        if (luma < darkLuma) {
          run += 1
          if (run > maxRun) maxRun = run
        } else {
          run = 0
        }
      }
      if (maxRun >= gapHeight) break // already a full-height barline; can't do better
    }
    isBoundary.push(maxRun / gapHeight < opts.barlineConnectRatio)
  }

  // 5. Group staves into systems, then build each band. A system's top is the
  //    bottom of the gutter above it; its bottom is the top of the gutter below.
  const systems: Staff[][] = []
  let current: Staff[] = [staves[0]]
  for (let k = 1; k < staves.length; k += 1) {
    if (isBoundary[k - 1]) {
      systems.push(current)
      current = []
    }
    current.push(staves[k])
  }
  systems.push(current)

  // Each system's top/bottom is the blank gutter in the gap to its neighbour. If
  // that gap has no clean gutter (tightly packed vocal+piano scores fill it with
  // lyrics/notes), fall back to the midpoint between the two systems' staves so
  // bands never overlap.
  const margin = staffSpace * opts.topMarginStaves
  const mergePx = Math.max(2, Math.round(staffSpace * 0.4))
  const minMeasureWidthPx = opts.minMeasureWidthRatio * width
  const bands: SystemBand[] = systems.map((system, i) => {
    const first = system[0].first
    const last = system[system.length - 1].last
    const upperBound = i > 0 ? systems[i - 1][systems[i - 1].length - 1].last : -1
    const lowerBound = i < systems.length - 1 ? systems[i + 1][0].first : height
    const aboveRun = tallestRunBetween(blankRuns, upperBound, first)
    const belowRun = tallestRunBetween(blankRuns, last, lowerBound)
    const top = aboveRun
      ? aboveRun.end + 1
      : i > 0
        ? Math.round((upperBound + first) / 2)
        : Math.max(0, first - margin)
    const bottom = belowRun
      ? belowRun.start - 1
      : i < systems.length - 1
        ? Math.round((last + lowerBound) / 2)
        : Math.min(height - 1, last + margin)
    // Scan barlines per-staff. The leftmost real barline (the opening bracket) IS
    // measure 1's left boundary, so we scan from x=0; only page-spanning margin
    // lines are excluded (spanningCols) so they don't add a spurious boundary.
    const measures = opts.detectMeasures
      ? detectMeasuresInSystem(
          data, width, system,
          darkLuma, opts.barlineHeightRatio, minMeasureWidthPx, mergePx,
          opts.minBarlineStaves, spanningCols
        )
      : null
    return {
      topRatio: top / height,
      bottomRatio: bottom / height,
      firstLineRatio: first / height,
      lastLineRatio: last / height,
      ...(measures ? { measureCount: measures.count, barlineXRatios: measures.boundaryXRatios } : {}),
      ...(measures && opts.debugBarlines ? { perStaffBarlineXRatios: measures.perStaff } : {}),
    }
  })

  return withProfile({ bands, staffSpaceRatio: staffSpace / height })
}

export type ScanCheck = {
  /** True when the page looks like a raster scan rather than vector notation. */
  scanned: boolean
  /** Fraction of ink pixels that are true black (low on scans — ink is gray). */
  blackInkRatio: number
  /** Fraction of sampled pixels that are ink at all. */
  inkFraction: number
}

/**
 * Cheap pixel heuristic for a scanned/raster page: vector ink is true black
 * (notes/lines render to ~0 luma), whereas a scan's ink is gray (anti-aliased /
 * JPEG), so almost none of its dark pixels are truly black.
 *
 * NOT authoritative on its own — it catches gray scans but MISSES cleaned scans
 * (e.g. HP "Digital Sending Device" output, whose background is pushed to white
 * and ink darkened, so it looks vector by pixels). The reliable gate is the PDF
 * text layer: scans have ~no text items, vector scores have hundreds — and a
 * score with no text can't feed the lyric-alignment phase anyway. So the pipeline
 * should gate on getTextContent() count; use this only as a secondary signal.
 */
export function isLikelyScanned(
  canvas: HTMLCanvasElement,
  options: { sampleStep?: number; inkLuma?: number; blackLuma?: number; ratioThreshold?: number } = {}
): ScanCheck {
  const sampleStep = options.sampleStep ?? 3
  const inkLuma = options.inkLuma ?? 160
  const blackLuma = options.blackLuma ?? 40
  const ratioThreshold = options.ratioThreshold ?? 0.05
  const fallback: ScanCheck = { scanned: false, blackInkRatio: 1, inkFraction: 0 }

  const width = canvas.width
  const height = canvas.height
  if (!width || !height) return fallback
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return fallback
  let data: Uint8ClampedArray
  try {
    data = ctx.getImageData(0, 0, width, height).data
  } catch {
    return fallback
  }

  let total = 0
  let ink = 0
  let black = 0
  for (let y = 0; y < height; y += sampleStep) {
    const rowStart = y * width * 4
    for (let x = 0; x < width; x += sampleStep) {
      const i = rowStart + x * 4
      total += 1
      if (data[i + 3] < 8) continue // transparent = paper
      const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
      if (luma < inkLuma) {
        ink += 1
        if (luma < blackLuma) black += 1
      }
    }
  }
  // Too little ink to judge — don't flag (let detection try).
  if (ink < total * 0.002) return { scanned: false, blackInkRatio: 1, inkFraction: ink / Math.max(1, total) }
  const blackInkRatio = black / ink
  return { scanned: blackInkRatio < ratioThreshold, blackInkRatio, inkFraction: ink / total }
}

/**
 * Pick the system band an anchor at `yRatio` belongs to. Prefers the band that
 * contains the point (top…bottom, which spans the whole system incl. its lyrics
 * above or below the staff); otherwise the nearest band by center. Returns null
 * if there are no bands.
 */
export function bandForY(bands: SystemBand[], yRatio: number): SystemBand | null {
  if (bands.length === 0) return null
  for (const band of bands) {
    if (yRatio >= band.topRatio && yRatio <= band.bottomRatio) return band
  }
  let best = bands[0]
  let bestDist = Infinity
  for (const band of bands) {
    const center = (band.topRatio + band.bottomRatio) / 2
    const dist = Math.abs(center - yRatio)
    if (dist < bestDist) {
      bestDist = dist
      best = band
    }
  }
  return best
}
