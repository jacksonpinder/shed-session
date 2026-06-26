import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { readFileSync } from 'node:fs'
import { extractLyrics } from '../src/lib/lyricsExtract.ts'
import { allFixturePdfs } from './fixtures.ts'

// Diagnostic sweep over every public/*.pdf. Not a pass/fail test — it surfaces
// suspicious extraction so we can spot non-lyric junk leaking in across many
// engravers/styles (not just the barbershop fixtures).

const STAFF_LABELS = new Set([
  'soprano', 'alto', 'tenor', 'bass', 'baritone', 'bari', 'lead', 'piano', 'voice',
  'descant', 'melody', 'solo', 'tutti', 'unis', 'div', 'men', 'women',
])
const DIRECTIONS = new Set([
  'rit', 'ritard', 'accel', 'rall', 'cresc', 'dim', 'poco', 'molto', 'subito', 'tempo',
  'rubato', 'tacet', 'coda', 'fine', 'segno', 'dolce', 'legato', 'staccato', 'simile',
])

const files = allFixturePdfs()

for (const path of files) {
  const file = path.split('/').pop() ?? path
  let toks
  try {
    const doc = await getDocument({ data: new Uint8Array(readFileSync(path)) }).promise
    toks = await extractLyrics(doc)
  } catch (e) {
    console.log(`\n### ${file}\n  ERROR: ${e}`)
    continue
  }
  const texts = toks.map((t) => t.text)
  const lower = texts.map((t) => t.toLowerCase())
  const n = toks.length

  const endsColon = texts.filter((t) => t.endsWith(':'))
  const hasDigit = texts.filter((t) => /\d/.test(t))
  const longToks = texts.filter((t) => t.length > 14)
  const multiWord = texts.filter((t) => /\s/.test(t.trim()))
  const allCaps = texts.filter((t) => t.length >= 3 && /^[A-Z][A-Z'.\- ]+$/.test(t))
  const labelHits = lower.filter((t) => STAFF_LABELS.has(t.replace(/[^a-z]/g, '')))
  const dirHits = lower.filter((t) => DIRECTIONS.has(t.replace(/[^a-z]/g, '')))
  const uniq = new Set(lower)

  const sample = (arr: string[], k = 6) => [...new Set(arr)].slice(0, k).map((s) => JSON.stringify(s)).join(' ')

  console.log(`\n### ${file}`)
  console.log(`  tokens=${n}  pages=${new Set(toks.map((t) => t.page)).size}  uniq=${uniq.size}`)
  if (n === 0) { console.log('  (no text layer — scan, gated)'); continue }
  console.log(`  sample: ${texts.slice(0, 16).join(' ')}`)
  if (endsColon.length) console.log(`  ⚠ ${endsColon.length} end-with-colon: ${sample(endsColon)}`)
  if (hasDigit.length) console.log(`  ⚠ ${hasDigit.length} contain-digit: ${sample(hasDigit)}`)
  if (longToks.length) console.log(`  ⚠ ${longToks.length} long(>14): ${sample(longToks)}`)
  if (multiWord.length) console.log(`  ⚠ ${multiWord.length} multi-word: ${sample(multiWord)}`)
  if (allCaps.length) console.log(`  ⚠ ${allCaps.length} all-caps: ${sample(allCaps)}`)
  if (labelHits.length) console.log(`  ⚠ ${labelHits.length} staff-label-ish: ${sample(labelHits)}`)
  if (dirHits.length) console.log(`  ⚠ ${dirHits.length} direction-ish: ${sample(dirHits)}`)
}
