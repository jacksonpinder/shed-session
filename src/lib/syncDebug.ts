/**
 * Human-readable export of a sync-map alignment, for diagnosing misalignment and
 * refactoring the engine. Pairs each score syllable (where it sits on the page)
 * with the Whisper word (and timestamp) it was matched to, and shows which
 * matches survived the threshold and the monotonic reading-order chain.
 */

import type { AlignTrace } from './alignSyncMap'

export type SyncDebugBundle = {
  source: { pdf: string; audio: string }
  sourceHash: string
  generatedAt: string
  trace: AlignTrace
}

const t = (sec: number) => `${sec.toFixed(2)}s`.padStart(8)
const y = (r: number) => r.toFixed(3)
const pad = (s: string, n: number) => (s.length >= n ? s : s + ' '.repeat(n - s.length))
const padL = (s: string, n: number) => (s.length >= n ? s : ' '.repeat(n - s.length) + s)
const q = (s: string) => `"${s}"`

/** Render a sync-map alignment trace as a readable text report. */
export function formatSyncDebug(bundle: SyncDebugBundle): string {
  const { trace } = bundle
  const kept = trace.pairs.filter((p) => p.keptInChain)
  const passed = trace.pairs.filter((p) => p.passedThreshold)
  const lines: string[] = []

  lines.push('=== SCORE SYNC DEBUG EXPORT ===')
  lines.push(`source:      ${bundle.source.pdf} + ${bundle.source.audio}`)
  lines.push(`sourceHash:  ${bundle.sourceHash}`)
  lines.push(`generated:   ${bundle.generatedAt}`)
  lines.push(
    `counts:      ${trace.orderedLyrics.length} lyric tokens | ` +
      `${trace.orderedWords.length} words | ` +
      `${trace.pairs.length} matches (${passed.length} ≥ threshold) | ` +
      `${kept.length} anchors`
  )
  lines.push('')

  // The driver: at each anchor time, what Whisper heard vs the lyric it landed on.
  lines.push('=== ANCHORS (time order — this drives the highlight/scroll) ===')
  lines.push(
    `${padL('time', 8)}  ${pad('whisper heard', 18)}  ${pad('→ lyric', 16)}  ${pad('pos', 12)}  conf`
  )
  for (const a of trace.anchors) {
    const heard = a.heard ?? '?'
    lines.push(
      `${t(a.time)}  ${pad(q(heard), 18)}  ${pad(q(a.text), 16)}  ` +
        `${pad(`p${a.page} y${y(a.yWithinPageRatio)}`, 12)}  ${a.confidence.toFixed(2)}`
    )
  }
  lines.push('')

  // Every threshold-passing match, in reading order, flagged kept/dropped. Lets
  // you see good matches the monotonic chain discarded (repeats, out-of-order).
  lines.push('=== MATCHES (reading order — ✓ kept as anchor, · dropped by chain) ===')
  lines.push(
    `   ${padL('time', 8)}  ${pad('whisper', 16)}  ${pad('lyric', 16)}  ${pad('pos', 12)}  sim`
  )
  for (const p of passed) {
    const flag = p.keptInChain ? '✓' : '·'
    lines.push(
      ` ${flag} ${t(p.word.start)}  ${pad(q(p.word.text), 16)}  ${pad(q(p.runText), 16)}  ` +
        `${pad(`p${p.lyric.page} y${y(p.lyric.yRatio)}`, 12)}  ${p.sim.toFixed(2)}`
    )
  }
  lines.push('')

  // Raw streams for cross-reference.
  lines.push('=== WHISPER WORDS (time order) ===')
  lines.push(trace.orderedWords.map((w) => `[${w.start.toFixed(2)}] ${w.text}`).join('  '))
  lines.push('')

  lines.push('=== LYRIC TOKENS (reading order) ===')
  let curPage = -1
  let row: string[] = []
  for (const tok of trace.orderedLyrics) {
    if (tok.page !== curPage) {
      if (row.length) lines.push(row.join('  '))
      row = []
      curPage = tok.page
      lines.push(`-- page ${curPage} --`)
    }
    row.push(`${tok.text}(y${y(tok.yRatio)})`)
  }
  if (row.length) lines.push(row.join('  '))
  lines.push('')

  return lines.join('\n')
}
