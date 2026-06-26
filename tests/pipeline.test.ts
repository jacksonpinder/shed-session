import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { readFileSync } from 'node:fs'
import { extractLyrics } from '../src/lib/lyricsExtract.ts'
import { fixturePath, hasFixture } from './fixtures.ts'
import { alignSyncMap } from '../src/lib/alignSyncMap.ts'
import { generateSyncMap } from '../src/lib/generateSyncMap.ts'
import { resolveScrollPosition, anchorAtTime } from '../src/lib/syncMap.ts'

let failures = 0
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
  if (!cond) failures += 1
}

// --- resolveScrollPosition with synthetic bands maps lyric y -> system top ---
{
  const anchors = [
    { time: 1, page: 1, yWithinPageRatio: 0.30, text: 'a', confidence: 1 },
    { time: 5, page: 1, yWithinPageRatio: 0.62, text: 'b', confidence: 1 },
  ]
  const bands = { 1: [
    { topRatio: 0.20, bottomRatio: 0.40, firstLineRatio: 0.25, lastLineRatio: 0.38 },
    { topRatio: 0.55, bottomRatio: 0.75, firstLineRatio: 0.60, lastLineRatio: 0.72 },
  ]}
  const p1 = resolveScrollPosition(anchors, bands, 1)
  const p2 = resolveScrollPosition(anchors, bands, 5)
  console.log('\nresolveScrollPosition:', JSON.stringify(p1), JSON.stringify(p2))
  check('maps lyric@0.30 to its system top 0.20', p1?.yWithinPageRatio === 0.20 && p1.page === 1)
  check('maps lyric@0.62 to its system top 0.55', p2?.yWithinPageRatio === 0.55)
  check('falls back to lyric y when no bands', resolveScrollPosition(anchors, {}, 1)?.yWithinPageRatio === 0.30)
  check('null when no anchors', resolveScrollPosition([], bands, 1) === null)
  check('anchorAtTime picks nearest', anchorAtTime(anchors, 4.9)?.time === 5)
}

// --- end-to-end: real lyrics + simulated (noisy) word timestamps ---
{
  const doc = await getDocument({ data: new Uint8Array(readFileSync(fixturePath('monster.pdf'))) }).promise
  const lyrics = await extractLyrics(doc)
  // Simulate Whisper words: lyric reading order, increasing times, drop 1/5,
  // and inject noise words that shouldn't anchor.
  const ordered = [...lyrics].sort((a, b) => a.page - b.page || a.yRatio - b.yRatio || a.xRatio - b.xRatio)
  const words: { text: string; start: number; end: number; confidence: number }[] = []
  let t = 0
  ordered.forEach((tok, i) => {
    t += 0.4
    if (i % 5 === 0) return // dropped word
    words.push({ text: tok.text, start: +t.toFixed(2), end: +(t + 0.3).toFixed(2), confidence: 0.9 })
    if (i % 17 === 0) { t += 0.4; words.push({ text: 'zzz', start: +t.toFixed(2), end: t + 0.3, confidence: 0.5 }) }
  })
  const anchors = alignSyncMap(lyrics, words)
  console.log(`\nend-to-end monster: ${lyrics.length} lyrics, ${words.length} words -> ${anchors.length} anchors`)
  console.log('  first anchors:', anchors.slice(0, 8).map(a => `${a.text}@${a.time}`).join(' '))
  check('produced a healthy number of anchors', anchors.length > 30)
  check('times strictly increasing', anchors.every((a, i) => i === 0 || a.time > anchors[i-1].time))
  check('reading order monotonic (page,y)', anchors.every((a, i) => i === 0 ||
    a.page > anchors[i-1].page || (a.page === anchors[i-1].page && a.yWithinPageRatio >= anchors[i-1].yWithinPageRatio)))
  check('did not anchor the noise word "zzz"', !anchors.some(a => a.text.toLowerCase() === 'zzz'))
}

// --- generateSyncMap bails on a scanned PDF before transcribing ---
if (hasFixture('And So It Goes.pdf')) {
  const doc = await getDocument({ data: new Uint8Array(readFileSync(fixturePath('And So It Goes.pdf'))) }).promise
  // A real transcribe() call would hit the sidecar and hang/throw here; reaching
  // 'scanned' proves the scan gate short-circuits before transcription.
  const audio = new Blob([new Uint8Array([0, 0, 0, 0])])
  const result = await generateSyncMap(doc, audio)
  console.log(`\ngenerateSyncMap(scan): reason=${result.reason} anchors=${result.anchors.length}`)
  check('scanned PDF → reason "scanned"', result.reason === 'scanned')
  check('scanned PDF → no anchors', result.anchors.length === 0)
}

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURES'}`)
process.exit(failures === 0 ? 0 : 1)
