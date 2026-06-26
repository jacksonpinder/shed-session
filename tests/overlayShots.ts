import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { createCanvas, type Canvas } from '@napi-rs/canvas'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { detectSystems } from '../src/lib/detectSystems.ts'
import { extractLyrics } from '../src/lib/lyricsExtract.ts'
import { allFixturePdfs } from './fixtures.ts'

// Generate one overlay montage per non-scan score for visual QA across the corpus:
//   green = detected system bands (top/bottom + label "S# · N meas")
//   red   = detected measure barlines
//   blue  = extracted lyric token positions
// Systems + lyrics render faithfully here; measures are a LOWER BOUND (napi-rs
// rasterizes thin barlines weaker than the browser) — cross-check measures live.

const SCALE = 3
const MAX_PAGES = 8
const CELL_W = 460 // montage cell width; height follows page aspect
const COLS = 3
const OUT = 'debug-overlays'
mkdirSync(OUT, { recursive: true })

const files = allFixturePdfs()
let made = 0

for (const path of files) {
  const name = (path.split('/').pop() ?? path).replace(/\.pdf$/i, '')
  let doc
  try {
    doc = await getDocument({ data: new Uint8Array(readFileSync(path)) }).promise
  } catch { continue }
  if ((await (await doc.getPage(1)).getTextContent()).items.length === 0) continue // scan

  let lyrics: Awaited<ReturnType<typeof extractLyrics>> = []
  try { lyrics = await extractLyrics(doc) } catch { /* keep going */ }
  const byPage = new Map<number, typeof lyrics>()
  for (const t of lyrics) { const a = byPage.get(t.page) ?? []; a.push(t); byPage.set(t.page, a) }

  const pageCount = Math.min(doc.numPages, MAX_PAGES)
  const cells: Canvas[] = []
  const sysPerPage: number[] = []
  const measPerPage: string[] = []
  let tokTotal = 0, tokOrphan = 0
  for (let p = 1; p <= pageCount; p += 1) {
    try {
      const page = await doc.getPage(p)
      const vp = page.getViewport({ scale: SCALE })
      const W = Math.ceil(vp.width), H = Math.ceil(vp.height)
      const cv = createCanvas(W, H)
      const ctx = cv.getContext('2d')
      ctx.fillStyle = 'white'; ctx.fillRect(0, 0, W, H)
      await page.render({ canvasContext: ctx as never, viewport: vp }).promise
      const { bands } = detectSystems(cv as never)
      sysPerPage.push(bands.length)
      measPerPage.push('[' + bands.map((b) => b.measureCount ?? '?').join(',') + ']')

      // Overlays are drawn at full render resolution, then the cell is scaled DOWN
      // into the montage (CELL_W wide). Size every stroke/dot/glyph relative to that
      // downscale so it stays visible (a raw 2px line would shrink to ~0.4px).
      const px = (final: number) => final * (W / CELL_W)

      // lyric tokens (blue) + orphan check (token outside every band's top..bottom)
      for (const t of byPage.get(p) ?? []) {
        const inBand = bands.some((b) => t.yRatio >= b.topRatio && t.yRatio <= b.bottomRatio)
        tokTotal += 1; if (!inBand) tokOrphan += 1
        ctx.fillStyle = inBand ? 'rgba(37,99,235,0.85)' : 'rgba(234,88,12,0.98)' // orphans = orange
        ctx.beginPath(); ctx.arc(t.xRatio * W, t.yRatio * H, px(2), 0, Math.PI * 2); ctx.fill()
      }
      // system bands (green) + barlines (red)
      bands.forEach((b, i) => {
        const top = b.topRatio * H, bot = b.bottomRatio * H
        ctx.fillStyle = 'rgba(16,185,129,0.10)'; ctx.fillRect(0, top, W, bot - top)
        ctx.strokeStyle = '#10b981'; ctx.lineWidth = px(2)
        ctx.beginPath(); ctx.moveTo(0, top); ctx.lineTo(W, top); ctx.moveTo(0, bot); ctx.lineTo(W, bot); ctx.stroke()
        ctx.strokeStyle = 'rgba(220,30,30,0.9)'; ctx.lineWidth = px(1.5)
        for (const xr of b.barlineXRatios ?? []) { ctx.beginPath(); ctx.moveTo(xr * W, top); ctx.lineTo(xr * W, bot); ctx.stroke() }
        // label last so it sits on top of the band tint
        const label = `S${i + 1} ${b.measureCount ?? '?'}m`
        ctx.font = `bold ${px(13)}px sans-serif`
        const lw = ctx.measureText(label).width
        ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(px(3), top + px(3), lw + px(8), px(18))
        ctx.fillStyle = '#0f766e'; ctx.fillText(label, px(7), top + px(16))
      })
      cells.push(cv)
    } catch { /* skip page */ }
  }
  if (cells.length === 0) continue

  // montage grid, with a title header + legend and a page label per cell.
  const HEAD = 56
  const cellH = Math.round(CELL_W * (cells[0].height / cells[0].width))
  const rows = Math.ceil(cells.length / COLS)
  const M = createCanvas(CELL_W * Math.min(COLS, cells.length), HEAD + cellH * rows)
  const mctx = M.getContext('2d')
  mctx.fillStyle = '#f4f4f5'; mctx.fillRect(0, 0, M.width, M.height)
  // header
  mctx.fillStyle = '#111'; mctx.font = 'bold 24px sans-serif'
  mctx.fillText(name, 10, 26)
  mctx.font = '15px sans-serif'
  mctx.fillStyle = '#0f766e'; mctx.fillText('■ system band  "S# Nm" = N measures', 10, 48)
  mctx.fillStyle = '#dc2626'; mctx.fillText('| barline', 330, 48)
  mctx.fillStyle = '#2563eb'; mctx.fillText('• lyric', 430, 48)
  mctx.fillStyle = '#ea580c'; mctx.fillText('• lyric outside any band', 500, 48)
  cells.forEach((cell, i) => {
    const cx = (i % COLS) * CELL_W, cy = HEAD + Math.floor(i / COLS) * cellH
    mctx.drawImage(cell as never, cx, cy, CELL_W, cellH)
    // page label badge
    mctx.fillStyle = 'rgba(0,0,0,0.72)'; mctx.fillRect(cx + 4, cy + 4, 56, 22)
    mctx.fillStyle = '#fff'; mctx.font = 'bold 15px sans-serif'
    mctx.fillText(`p${i + 1}`, cx + 12, cy + 20)
  })
  writeFileSync(`${OUT}/${name.replace(/[^a-z0-9]+/gi, '_')}.png`, M.toBuffer('image/png'))
  made += 1
  const orphanPct = tokTotal ? Math.round((100 * tokOrphan) / tokTotal) : 0
  const flag = orphanPct > 12 || sysPerPage.includes(0) ? '⚠' : ' '
  console.log(`${flag} ${name.slice(0, 34).padEnd(34)} sys/pg=[${sysPerPage.join(',')}] meas/pg=${measPerPage.join('')} lyr=${tokTotal} orphan=${orphanPct}%`)
}
console.log(`\nwrote ${made} montages to ${OUT}/`)
