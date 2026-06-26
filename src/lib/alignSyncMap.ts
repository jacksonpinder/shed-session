import type { LyricToken } from './lyricsExtract'
import type { Word } from './transcribe'
import type { Anchor } from './syncMap'

/**
 * Alignment: match extracted lyric syllables (with score positions) against
 * Whisper word timestamps to produce time→position anchors.
 *
 * Two sequences are aligned with Needleman–Wunsch (global alignment) using a
 * substring-aware similarity, so a sung word ("monsters") still scores against
 * its score syllables ("mon", "sters"). Confident matches become candidate
 * anchors. Finally we keep the longest chain that's monotonic in reading order —
 * as audio time increases, the score position (page, then y) must not go
 * backwards — which discards spurious matches (repeats, common words) without
 * needing to model them. Doesn't need to be note-perfect: a few solid anchors per
 * system is the goal.
 */

export type AlignOptions = {
  /** Minimum similarity for an aligned pair to become a candidate anchor. */
  minSimilarity?: number
  /** Gap penalty for Needleman–Wunsch. */
  gapPenalty?: number
}

const DEFAULTS = { minSimilarity: 0.5, gapPenalty: -0.4 } satisfies Required<AlignOptions>

/**
 * One match between a Whisper word and a *run* of consecutive score syllables
 * (many-to-one: a sung word like "corner" matches the syllable run "cor"+"ner").
 * The run's concatenation is what's scored, so word reconstruction is recovered
 * from the audio and we never have to trust the engraver's hyphenation. This is
 * the diagnostic unit: it pairs the reconstructed score word (and where its first
 * syllable sits) with the Whisper word it was matched to.
 */
export type AlignedPair = {
  /** First syllable of the run, in reading order (its position anchors the word). */
  lyric: LyricToken
  /** The full syllable run, in reading order. */
  run: LyricToken[]
  /** Reconstructed score word (run syllables joined) for display. */
  runText: string
  /** Whisper word in time order. */
  word: Word
  /** Normalized forms actually compared (concatenated run vs word). */
  sylNorm: string
  wordNorm: string
  /** Similarity 0…1. */
  sim: number
  /** sim >= minSimilarity. */
  passedThreshold: boolean
  /** Survived the monotonic reading-order chain ⇒ became a final anchor. */
  keptInChain: boolean
}

/** Full alignment trace for debugging/export. */
export type AlignTrace = {
  /** Lyrics in the reading order the aligner used. */
  orderedLyrics: LyricToken[]
  /** Words in the time order the aligner used. */
  orderedWords: Word[]
  /** Every NW diagonal match, annotated. */
  pairs: AlignedPair[]
  /** The final anchors (== pairs where keptInChain, as Anchor[]). */
  anchors: Anchor[]
}

const normalize = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .toLowerCase()
    .replace(/[^a-z]/g, '')

/** Sørensen–Dice coefficient over character bigrams (0…1). */
const diceBigram = (a: string, b: string): number => {
  if (a === b) return 1
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0
  const grams = new Map<string, number>()
  for (let i = 0; i < a.length - 1; i += 1) {
    const g = a.slice(i, i + 2)
    grams.set(g, (grams.get(g) ?? 0) + 1)
  }
  let overlap = 0
  for (let i = 0; i < b.length - 1; i += 1) {
    const g = b.slice(i, i + 2)
    const have = grams.get(g) ?? 0
    if (have > 0) {
      overlap += 1
      grams.set(g, have - 1)
    }
  }
  return (2 * overlap) / (a.length - 1 + (b.length - 1))
}

/**
 * Whole-string similarity, 0…1. No substring bonus — a fragment only scores well
 * if it (or its run) actually reconstructs the word. This is what kills the old
 * "or" ⊂ "corner" = 0.9 inflation: now "or" vs "corner" ≈ 0.33, while the run
 * "cor"+"ner" vs "corner" = 1.0.
 */
const wordSimilarity = (a: string, b: string): number => (a === b ? 1 : diceBigram(a, b))

/** Longest syllable run a single sung word may absorb (words rarely exceed this). */
const MAX_RUN = 6

type RunMatch = { wi: number; sStart: number; sEnd: number; sim: number }

/**
 * Many-to-one monotonic alignment: each Whisper word matches a *run* of
 * consecutive score syllables, scored on the concatenated run. Skipping score
 * syllables (percussion, other voices) or Whisper words (noise) is ~free, so the
 * alignment is a max-weight monotonic set of word↔run matches — only matches that
 * clear the threshold are positive. Returns matches in reading order.
 *
 * DP over (word i, syllable boundary j): from cell (i-1, j-k) take word i-1 as a
 * run of k syllables; or skip word i-1; or skip syllable j-1. Tiny gap epsilons
 * make the alignment compact and deterministic without distorting match scores.
 */
const alignManyToOne = (
  sylNorm: string[],
  wordNorm: string[],
  minSimilarity: number
): RunMatch[] => {
  const n = sylNorm.length
  const m = wordNorm.length
  const GAP = -1e-4
  const score = Array.from({ length: m + 1 }, () => new Float64Array(n + 1))
  // backpointer: 0 = match-run (k in bpK), 1 = skip word, 2 = skip syllable
  const bpType = Array.from({ length: m + 1 }, () => new Uint8Array(n + 1))
  const bpK = Array.from({ length: m + 1 }, () => new Uint8Array(n + 1))
  for (let i = 1; i <= m; i += 1) {
    score[i][0] = i * GAP
    bpType[i][0] = 1
  }
  for (let j = 1; j <= n; j += 1) {
    score[0][j] = j * GAP
    bpType[0][j] = 2
  }
  for (let i = 1; i <= m; i += 1) {
    const w = wordNorm[i - 1]
    for (let j = 1; j <= n; j += 1) {
      // skip word i-1, or skip syllable j-1
      let best = score[i - 1][j] + GAP
      let type = 1
      let k = 0
      const skipSyl = score[i][j - 1] + GAP
      if (skipSyl > best) {
        best = skipSyl
        type = 2
      }
      // word i-1 absorbs a run of the last 1..MAX_RUN syllables ending at j
      let concat = ''
      const maxK = Math.min(MAX_RUN, j)
      for (let kk = 1; kk <= maxK; kk += 1) {
        concat = sylNorm[j - kk] + concat
        const reward = wordSimilarity(w, concat) - minSimilarity
        const val = score[i - 1][j - kk] + reward
        if (val > best) {
          best = val
          type = 0
          k = kk
        }
      }
      score[i][j] = best
      bpType[i][j] = type
      bpK[i][j] = k
    }
  }
  const matches: RunMatch[] = []
  let i = m
  let j = n
  while (i > 0 && j > 0) {
    const type = bpType[i][j]
    if (type === 0) {
      const k = bpK[i][j]
      let concat = ''
      for (let kk = 1; kk <= k; kk += 1) concat = sylNorm[j - kk] + concat
      matches.push({ wi: i - 1, sStart: j - k, sEnd: j, sim: wordSimilarity(wordNorm[i - 1], concat) })
      i -= 1
      j -= k
    } else if (type === 1) {
      i -= 1
    } else {
      j -= 1
    }
  }
  matches.reverse()
  return matches
}

type ChainNode = { time: number; key: number; conf: number }

/**
 * Best monotonic chain of candidates (sorted by time, then key). Like a longest
 * non-decreasing subsequence on `key` (the no-backward-scroll guarantee), but
 * weighted: among chains it prefers higher-confidence anchors and penalizes
 * temporal-spatial discontinuity — a candidate whose spatial jump from its
 * predecessor doesn't match the elapsed time (vs a global velocity prior). This
 * is what disambiguates echoes/reprises: when the same line appears on two
 * systems, the smoother trajectory wins.
 *
 * The soft per-edge penalty is capped strictly below one anchor's base weight (1.0),
 * so length is never sacrificed for *smoothness* — it only chooses *which* equally-
 * long chain, and which predecessor. A separate HARD limit (`MAX_KEY_PER_SEC`) forbids
 * physically-impossible edges outright, which DOES drop an anchor: this resolves the
 * repeated-lyric trap where a sung word ("it's") matches the wrong printed instance a
 * page away, 0.6 s before the next correct anchor ("only") — an implied jump no singer
 * makes. Forbidding that edge lets the chain route through the real cluster instead.
 * Returns kept indices in order. O(N²).
 */
// Singing advances at most a fraction of a page per second; key = page + yRatio, so a
// page-sized jump (~1.0) in well under a second is impossible. Above this the edge is a
// misaligned repeat, not real motion. Generous vs. real local tempo (≈10× the global
// average), so legitimate fast page turns — which still take a beat or two — stay valid.
const MAX_KEY_PER_SEC = 0.6

const bestMonotonicChain = (nodes: ChainNode[], minSimilarity: number): number[] => {
  const N = nodes.length
  if (N === 0) return []
  // Global velocity prior: spatial (page+y) units per second across the span.
  let kMin = Infinity
  let kMax = -Infinity
  for (const n of nodes) {
    if (n.key < kMin) kMin = n.key
    if (n.key > kMax) kMax = n.key
  }
  const timeSpan = nodes[N - 1].time - nodes[0].time
  const velocity = timeSpan > 1e-6 ? (kMax - kMin) / timeSpan : 0
  const LAMBDA = velocity > 0 ? 0.4 : 0
  const PENALTY_CAP = 0.9 // < base weight 1.0 ⇒ chain length is never shortened
  // Base weight ~1 (count) + a small confidence nudge so ties prefer surer matches.
  const weight = (n: ChainNode) => 1 + 0.1 * (n.conf - minSimilarity)

  const dp = new Float64Array(N)
  const prev = new Int32Array(N).fill(-1)
  let best = 0
  for (let i = 0; i < N; i += 1) {
    dp[i] = weight(nodes[i])
    for (let j = 0; j < i; j += 1) {
      if (nodes[j].key > nodes[i].key) continue // keep monotonic (no backward scroll)
      const dt = nodes[i].time - nodes[j].time
      const dk = nodes[i].key - nodes[j].key
      if (dt > 1e-6 && dk / dt > MAX_KEY_PER_SEC) continue // impossible jump ⇒ not a valid predecessor
      const penalty = Math.min(LAMBDA * Math.abs(dk - velocity * dt), PENALTY_CAP)
      const score = dp[j] + weight(nodes[i]) - penalty
      if (score > dp[i]) {
        dp[i] = score
        prev[i] = j
      }
    }
    if (dp[i] > dp[best]) best = i
  }
  const result: number[] = []
  for (let k = best; k >= 0; k = prev[k]) result.push(k)
  return result.reverse()
}

/**
 * Build the anchor list from lyric tokens and word timestamps. Lyric tokens are
 * read in score order (page, then top-to-bottom, then left-to-right); words in
 * time order.
 */
export function alignSyncMap(
  lyrics: LyricToken[],
  words: Word[],
  options: AlignOptions = {}
): Anchor[] {
  return alignSyncMapTrace(lyrics, words, options).anchors
}

/**
 * Same alignment as `alignSyncMap`, but returns the full diagnostic trace: the
 * ordered inputs and every NW diagonal match annotated with both sides, its
 * similarity, and whether it passed the threshold / survived the monotonic
 * chain. `alignSyncMap` is just `.anchors` of this.
 */
export function alignSyncMapTrace(
  lyrics: LyricToken[],
  words: Word[],
  options: AlignOptions = {}
): AlignTrace {
  const opts = { ...DEFAULTS, ...options }
  if (lyrics.length === 0 || words.length === 0) {
    return { orderedLyrics: [], orderedWords: [], pairs: [], anchors: [] }
  }

  const orderedLyrics = [...lyrics].sort(
    (a, b) => a.page - b.page || a.yRatio - b.yRatio || a.xRatio - b.xRatio
  )
  const orderedWords = [...words].sort((a, b) => a.start - b.start)

  const sylNorm = orderedLyrics.map((t) => normalize(t.text))
  const wordNorm = orderedWords.map((w) => normalize(w.text))

  const runMatches = alignManyToOne(sylNorm, wordNorm, opts.minSimilarity)

  // Annotate each word↔run match with both sides and threshold status. The run's
  // first syllable carries the position (a word's onset lands on its first syllable).
  const pairs: AlignedPair[] = runMatches.map((p) => {
    const run = orderedLyrics.slice(p.sStart, p.sEnd)
    const runText = run.map((t) => t.text).join('').replace(/\s+/g, ' ').trim()
    return {
      lyric: run[0],
      run,
      runText,
      word: orderedWords[p.wi],
      sylNorm: sylNorm.slice(p.sStart, p.sEnd).join(''),
      wordNorm: wordNorm[p.wi],
      sim: p.sim,
      passedThreshold: p.sim >= opts.minSimilarity,
      keptInChain: false,
    }
  })

  // Candidates = threshold-passing matches, in (time, position) order.
  const candidates = pairs
    .map((p, pairIndex) => ({ p, pairIndex }))
    .filter(({ p }) => p.passedThreshold)
    .map(({ p, pairIndex }) => ({
      pairIndex,
      time: p.word.start,
      key: p.lyric.page + p.lyric.yRatio, // increasing in reading order
      conf: p.sim,
    }))
    .sort((a, b) => a.time - b.time || a.key - b.key)

  // Keep the best monotonic chain (no backward scroll), weighted for confidence
  // and temporal-spatial smoothness so echoes/reprises resolve to one pass.
  const keep = bestMonotonicChain(candidates, opts.minSimilarity)
  const anchors: Anchor[] = keep.map((i) => {
    const c = candidates[i]
    const pair = pairs[c.pairIndex]
    pair.keptInChain = true
    return {
      time: pair.word.start,
      page: pair.lyric.page,
      yWithinPageRatio: pair.lyric.yRatio,
      text: pair.runText || pair.lyric.text,
      confidence: pair.sim,
      xWithinPageRatio: pair.lyric.xRatio,
      heard: pair.word.text,
    }
  })

  return { orderedLyrics, orderedWords, pairs, anchors }
}
