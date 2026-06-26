import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { createCanvas } from '@napi-rs/canvas'
import { readFileSync } from 'node:fs'
import { detectSystems } from '../src/lib/detectSystems.ts'
import { allFixturePdfs } from './fixtures.ts'

// Headless validation of SYSTEM detection across the corpus — the part of the
// pipeline that needs no MP3. Renders each page to a real canvas and runs the
// actual detector, flagging anomalies (no systems on a content page, bands out of
// range, overlapping bands, absurd measure counts).
//
// NOTE: the measure numbers here are NOT reliable — @napi-rs/canvas rasterizes thin
// vertical barlines more weakly than the browser, so the barline scan under-counts
// (medMeas often shows 1). Measure detection is validated in the BROWSER instead
// (faithful render): sheetmusic.pdf p8 = 4/5/6/6 etc. Some scores (e.g. monster.pdf,
// whose systems are bracket-connected with very faint internal barlines) fall back
// to measureCount=1 even in the browser — the timing model degrades gracefully to
// system-level (equal-weight) timing there.

const SCALE = 2
const MAX_PAGES = 5 // sample per PDF, enough to validate

const files = allFixturePdfs()
let totalPdfs = 0
let vectorPdfs = 0
let anomalies = 0

for (const path of files) {
  const name = path.split('/').pop() ?? path
  totalPdfs += 1
  let doc
  try {
    doc = await getDocument({ data: new Uint8Array(readFileSync(path)) }).promise
  } catch (e) {
    console.log(`### ${name}\n  ERROR open: ${e}`)
    continue
  }
  // Skip scans: no text layer ⇒ extraction gates to 0 anyway.
  const firstText = await (await doc.getPage(1)).getTextContent()
  if (firstText.items.length === 0) continue
  vectorPdfs += 1

  const pageCount = Math.min(doc.numPages, MAX_PAGES)
  const sysCounts: number[] = []
  const measCounts: number[] = []
  const flags: string[] = []

  for (let p = 1; p <= pageCount; p += 1) {
    try {
      const page = await doc.getPage(p)
      const viewport = page.getViewport({ scale: SCALE })
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = 'white'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport }).promise
      const { bands } = detectSystems(canvas as unknown as HTMLCanvasElement)
      sysCounts.push(bands.length)
      const textItems = (await page.getTextContent()).items.length

      if (textItems > 40 && bands.length === 0) flags.push(`p${p}: 0 systems but ${textItems} text items`)
      bands.forEach((b, i) => {
        if (b.topRatio < 0 || b.bottomRatio > 1 || b.topRatio >= b.bottomRatio)
          flags.push(`p${p} band${i}: bad range ${b.topRatio.toFixed(2)}..${b.bottomRatio.toFixed(2)}`)
        if (i > 0 && b.topRatio < bands[i - 1].bottomRatio - 0.001)
          flags.push(`p${p} band${i}: overlaps previous`)
        const mc = b.measureCount ?? 0
        measCounts.push(mc)
        if (mc < 1 || mc > 32) flags.push(`p${p} band${i}: measureCount=${mc}`)
      })
    } catch (e) {
      flags.push(`p${p}: render/detect error ${e}`)
    }
  }

  const sysTotal = sysCounts.reduce((a, b) => a + b, 0)
  const measMed = measCounts.length ? [...measCounts].sort((a, b) => a - b)[measCounts.length >> 1] : 0
  const ok = flags.length === 0
  if (!ok) anomalies += 1
  console.log(
    `${ok ? '  ok ' : '⚠ FLAG'} ${name.slice(0, 40).padEnd(40)} ` +
      `pages=${pageCount} sys/pg=[${sysCounts.join(',')}] tot=${sysTotal} medMeas=${measMed}` +
      (flags.length ? `\n     ${flags.slice(0, 6).join('\n     ')}` : '')
  )
}

console.log(`\n${vectorPdfs}/${totalPdfs} vector PDFs checked, ${anomalies} with anomalies`)
