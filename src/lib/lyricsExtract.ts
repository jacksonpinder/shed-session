import type { PDFDocumentProxy } from 'pdfjs-dist'

/**
 * Lyric extractor.
 *
 * Pulls sung lyrics (with positions) out of a PDF's text layer so they can be
 * aligned against Whisper word timestamps. Works from the text layer directly
 * (pdfjs getTextContent) — it does NOT need the text layer rendered to the DOM.
 *
 * Font-independent, by design (engravers use different fonts, and some encode
 * noteheads as ordinary characters — `œ`, `V`, `?`, `#` — not the Private Use
 * Area). Instead of trusting font names we use the *shape* of the data:
 *   - keep only "wordlike" tokens (have letters; not PUA glyphs, symbols, or pure
 *     digits like measure numbers),
 *   - cluster tokens into horizontal rows,
 *   - keep rows that look like a lyric line: several tokens spread across a wide
 *     part of the page width. This drops staff labels (a 1–2 token stack at the
 *     far left), titles/tempo (few tokens), and measure numbers (digits).
 *
 * A token's yRatio is its baseline; detectSystems' bandForY maps it to a system
 * whether the lyric sits above or below the staff.
 */

export type LyricToken = {
  /** The syllable / word as it appears (e.g. "glo", "ri", "a-", "stars"). */
  text: string
  /** 1-based page number. */
  page: number
  /** Left edge of the token, 0 (left) … 1 (right) of page width. */
  xRatio: number
  /** Text baseline, 0 (top) … 1 (bottom) of page height. */
  yRatio: number
}

export type ExtractLyricsOptions = {
  /** A lyric row needs at least this many tokens. */
  minTokensPerRow?: number
  /** A lyric row's tokens must span at least this fraction of the page width. */
  minRowSpanRatio?: number
  /** Tokens within this fraction of page height belong to the same row. */
  rowYToleranceRatio?: number
  /** Reject tokens longer than this (lyrics are short; this drops stray text). */
  maxTokenLength?: number
  /**
   * A font whose tokens are this fraction single-character is treated as a music
   * font and dropped — catches noteheads encoded as ordinary letters (`œ`, clef
   * `V`) that otherwise form wide rows just like lyrics.
   */
  musicFontSingleCharRatio?: number
  /**
   * Strip a leading stage-direction / performance-cue label from a lyric row — a
   * colon-terminated token among the first few ("VO:", "Melody solo:", "ALL Leads
   * Enter:"). Font-agnostic: lyrics don't end a token with a colon.
   */
  stripCuePrefix?: boolean
}

const DEFAULTS = {
  minTokensPerRow: 3,
  minRowSpanRatio: 0.22,
  rowYToleranceRatio: 0.012,
  maxTokenLength: 24,
  musicFontSingleCharRatio: 0.6,
  stripCuePrefix: true,
} satisfies Required<ExtractLyricsOptions>

// A cue label sits at the front of a row; only look this far in for its colon.
const CUE_PREFIX_WINDOW = 4

const isPua = (cp: number): boolean =>
  (cp >= 0xe000 && cp <= 0xf8ff) || (cp >= 0xf0000 && cp <= 0xffffd) || (cp >= 0x100000 && cp <= 0x10fffd)

// Connectors that legitimately appear inside lyric syllables.
const CONNECTORS = new Set(['-', '‐', '‑', '–', '—', "'", '’', '.', '…', ',', '_'])

/**
 * Is this string a lyric-like word? It must contain letters and be mostly letters
 * (allowing hyphen/apostrophe connectors), so noteheads, clefs, accidentals and
 * measure numbers are rejected.
 */
const isWordlike = (raw: string, maxLength: number): boolean => {
  const s = raw.trim()
  if (!s || s.length > maxLength) return false
  // Digits and '=' never occur in sung lyrics but do in navigation/section markers
  // ("Verse 2", "meas 89", "2nd time") and metronome marks ("♩ = ♪"). Reject them.
  if (/[0-9=]/.test(s)) return false
  let letters = 0
  let others = 0
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0
    if (isPua(cp)) return false
    if (/\p{L}/u.test(ch)) letters += 1
    else if (CONNECTORS.has(ch) || /\s/.test(ch)) continue
    else others += 1
  }
  return letters >= 1 && letters >= others
}

type RawItem = { text: string; x: number; y: number; font: string }
type PageItems = { pageNumber: number; width: number; height: number; items: RawItem[] }

/** Extract lyric tokens from every page of a PDF. */
export async function extractLyrics(
  pdf: PDFDocumentProxy,
  options: ExtractLyricsOptions = {}
): Promise<LyricToken[]> {
  const opts = { ...DEFAULTS, ...options }

  // Pass 1: gather wordlike items per page, and per-font single-character stats.
  const pages: PageItems[] = []
  const fontTotal = new Map<string, number>()
  const fontSingle = new Map<string, number>()
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber)
    const viewport = page.getViewport({ scale: 1 })
    const content = await page.getTextContent()
    const items: RawItem[] = []
    for (const item of content.items) {
      if (!('str' in item) || !item.str) continue
      const font = item.fontName ?? ''
      const baseX = item.transform[4]
      const y = viewport.height - item.transform[5]
      const runWidth = typeof item.width === 'number' ? item.width : 0
      const str = item.str
      // Split a multi-word text run into per-word tokens: the aligner matches one
      // Whisper word to a RUN of score tokens, but can't split a single score token
      // across several sung words — so "Dar lin' I've been" as one token matches
      // nothing. Each word's x is estimated from its character offset in the run.
      for (const m of str.matchAll(/\S+/g)) {
        const word = m[0]
        if (!isWordlike(word, opts.maxTokenLength)) continue
        const x = baseX + (str.length ? (m.index ?? 0) / str.length : 0) * runWidth
        fontTotal.set(font, (fontTotal.get(font) ?? 0) + 1)
        if ([...word].length === 1) fontSingle.set(font, (fontSingle.get(font) ?? 0) + 1)
        items.push({ text: word, x, y, font })
      }
    }
    pages.push({ pageNumber, width: viewport.width, height: viewport.height, items })
  }

  // Fonts that are mostly single characters are music fonts (noteheads as
  // letters, clefs, accidentals), not lyric text.
  const musicFonts = new Set<string>()
  for (const [font, total] of fontTotal) {
    if (total >= 4 && (fontSingle.get(font) ?? 0) / total >= opts.musicFontSingleCharRatio) {
      musicFonts.add(font)
    }
  }

  // Pass 2: drop music-font items, cluster the rest into rows, keep lyric rows.
  const rows: ExtractedRow[] = []
  for (const page of pages) {
    const items = page.items.filter((it) => !musicFonts.has(it.font))
    if (items.length === 0) continue
    extractRows(items, page.pageNumber, page.width, page.height, opts, rows)
  }

  // Drop running headers: a row near the top of the page whose text repeats at the
  // top of several pages is the song's title/credits header, not a lyric (e.g.
  // "SOMETHING'S COMING" printed atop every page). Left in, it matches sung title
  // words and anchors them to y≈0.06 — yanking the scroll to the page top. Detect by
  // recurrence so we never drop a real lyric line that happens to sit high once.
  const headerMinPages = Math.max(3, Math.ceil(pages.length * 0.34))
  const topBandPages = new Map<string, Set<number>>()
  for (const r of rows) {
    if (r.yRatio >= HEADER_TOP_BAND || !r.signature) continue
    let set = topBandPages.get(r.signature)
    if (!set) topBandPages.set(r.signature, (set = new Set()))
    set.add(r.page)
  }
  const headerSignatures = new Set(
    [...topBandPages].filter(([, set]) => set.size >= headerMinPages).map(([sig]) => sig)
  )

  const tokens: LyricToken[] = []
  for (const r of rows) {
    if (r.yRatio < HEADER_TOP_BAND && headerSignatures.has(r.signature)) continue
    tokens.push(...r.tokens)
  }
  return tokens
}

/** Rows whose median baseline sits above this fraction are header candidates. */
const HEADER_TOP_BAND = 0.13

type ExtractedRow = { page: number; yRatio: number; signature: string; tokens: LyricToken[] }

/** Normalized row fingerprint (letters only, lowercased) for cross-page header matching. */
const rowSignature = (texts: string[]): string =>
  texts.map((t) => t.toLowerCase().replace(/[^a-z]/g, '')).filter(Boolean).join(' ')

/** Cluster a page's wordlike items into rows and keep the lyric-shaped ones. */
const extractRows = (
  items: RawItem[],
  pageNumber: number,
  pageWidth: number,
  pageHeight: number,
  opts: Required<ExtractLyricsOptions>,
  out: ExtractedRow[]
): void => {
  const yTolerance = opts.rowYToleranceRatio * pageHeight
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x)

  let row: RawItem[] = []
  let rowY = sorted[0].y
  const flush = () => {
    if (row.length < opts.minTokensPerRow) return
    const xs = row.map((r) => r.x)
    const span = (Math.max(...xs) - Math.min(...xs)) / pageWidth
    if (span < opts.minRowSpanRatio) return
    // Handle the colon, the font-agnostic cue signal. A colon-terminated token at
    // the FRONT of the row is a stage-direction label ("Melody solo:", "ALL Leads
    // Enter:") → drop the whole prefix up to it. A trailing colon anywhere else is
    // a stray on a real lyric word ("…ya got:") → just strip the colon, keep the
    // word. (Multi-word runs are already split into words upstream.)
    let startIdx = 0
    if (opts.stripCuePrefix) {
      const window = Math.min(CUE_PREFIX_WINDOW, row.length - 1)
      for (let i = 0; i < window; i += 1) {
        if (row[i].text.endsWith(':')) startIdx = i + 1
      }
    }
    const tokens: LyricToken[] = []
    for (let i = startIdx; i < row.length; i += 1) {
      const item = row[i]
      const text = opts.stripCuePrefix && item.text.endsWith(':') ? item.text.slice(0, -1) : item.text
      if (!text) continue
      tokens.push({ text, page: pageNumber, xRatio: item.x / pageWidth, yRatio: item.y / pageHeight })
    }
    if (!tokens.length) return
    const yRatio = tokens.reduce((s, t) => s + t.yRatio, 0) / tokens.length
    out.push({ page: pageNumber, yRatio, signature: rowSignature(tokens.map((t) => t.text)), tokens })
  }
  for (const item of sorted) {
    if (item.y - rowY > yTolerance && row.length) {
      flush()
      row = []
    }
    row.push(item)
    rowY = item.y
  }
  if (row.length) flush()
}
