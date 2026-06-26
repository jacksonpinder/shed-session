import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { createCanvas } from '@napi-rs/canvas'
import { readFileSync } from 'node:fs'
import { detectSystems } from '../src/lib/detectSystems.ts'
import { allFixturePdfs } from './fixtures.ts'

// Regression guard for the page-spanning-line exclusion (pageSpanRatio). That change
// can ONLY alter a score's grouping if a column spans ≥ pageSpanRatio of the page
// height. So render each page and compare system counts with the exclusion ON
// (default) vs OFF (pageSpanRatio huge). Any difference is a score the change
// touches — expected only for page-spanning-line scores; a legit-bracket score that
// flips would be a regression to investigate.
//
// NOTE: @napi-rs under-renders THIN vertical lines, so a thin page-spanning margin
// rule (e.g. And So It Goes) may not even appear here — that case is validated in
// the browser. This catches the inverse risk: a THICK tall element wrongly excluded.

const SCALE = 2
const MAX_PAGES = 5
let diffs = 0

for (const path of allFixturePdfs()) {
  const name = path.split('/').pop() ?? path
  let doc
  try {
    doc = await getDocument({ data: new Uint8Array(readFileSync(path)) }).promise
  } catch {
    continue
  }
  if ((await (await doc.getPage(1)).getTextContent()).items.length === 0) continue // scan

  const onCounts: number[] = []
  const offCounts: number[] = []
  for (let p = 1; p <= Math.min(doc.numPages, MAX_PAGES); p += 1) {
    try {
      const page = await doc.getPage(p)
      const vp = page.getViewport({ scale: SCALE })
      const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height))
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = 'white'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvasContext: ctx as never, viewport: vp }).promise
      onCounts.push(detectSystems(canvas as never).bands.length)
      offCounts.push(detectSystems(canvas as never, { pageSpanRatio: 5 }).bands.length)
    } catch {
      /* skip page */
    }
  }
  if (onCounts.join(',') !== offCounts.join(',')) {
    diffs += 1
    console.log(`DIFF ${name.slice(0, 42).padEnd(42)} on=[${onCounts.join(',')}] off=[${offCounts.join(',')}]`)
  }
}
console.log(diffs === 0 ? '\nno grouping differences from pageSpanRatio in the Node corpus' : `\n${diffs} scores differ`)
