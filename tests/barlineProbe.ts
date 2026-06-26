import { getDocument, OPS, Util } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { readFileSync } from 'node:fs'
import { fixturePath } from './fixtures.ts'

// Vector ground-truth probe for barline detection. Instead of rasterizing and
// fighting anti-aliasing, replay the operator list, track the CTM, and decode every
// path into device-space segments. Then:
//   1. staff lines  = long thin HORIZONTAL segments → grouped into staves → systems
//   2. barline cands = thin VERTICAL segments spanning a staff's full height
//   3. a real barline = an x where (nearly) all staves of a system have one — note
//      stems sit in a single staff at x's that don't align across staves.
// Validates the "cross-staff x-alignment" detector design before porting to pixels.

const file = process.argv[2] ?? 'monster.pdf'
const pageNum = Number(process.argv[3] ?? 2)

const doc = await getDocument({ data: new Uint8Array(readFileSync(fixturePath(file))) }).promise
const page = await doc.getPage(pageNum)
const vp = page.getViewport({ scale: 1 })
const W = vp.width
const H = vp.height
const opList = await page.getOperatorList()

const ARGN: Record<number, number> = { 0: 2, 1: 2, 2: 6, 3: 0 }

type Seg = { xc: number; yc: number; x0: number; x1: number; y0: number; y1: number; w: number; h: number }
const segs: Seg[] = []
let ctm: number[] = [1, 0, 0, 1, 0, 0]
const stack: number[][] = []
const apply = (m: number[], x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]

for (let i = 0; i < opList.fnArray.length; i += 1) {
  const fn = opList.fnArray[i]
  const args = opList.argsArray[i]
  if (fn === OPS.save) stack.push(ctm)
  else if (fn === OPS.restore) ctm = stack.pop() ?? ctm
  else if (fn === OPS.transform) ctm = Util.transform(ctm, args as number[])
  else if (fn === OPS.constructPath) {
    for (const flat of args[1] as ArrayLike<number>[]) {
      let j = 0
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      const note = (ux: number, uy: number) => {
        const [dx, dy] = apply(ctm, ux, uy)
        if (dx < minX) minX = dx; if (dx > maxX) maxX = dx
        if (dy < minY) minY = dy; if (dy > maxY) maxY = dy
      }
      const n = (flat as { length: number }).length
      while (j < n) {
        const code = flat[j]; const k = ARGN[code]
        if (k === undefined) break
        if (code === 0 || code === 1) note(flat[j + 1], flat[j + 2])
        else if (code === 2) { note(flat[j + 1], flat[j + 2]); note(flat[j + 3], flat[j + 4]); note(flat[j + 5], flat[j + 6]) }
        j += 1 + k
      }
      if (!isFinite(minX)) continue
      // Convert to top-down device space (flip y).
      const y0 = H - maxY, y1 = H - minY
      segs.push({ xc: (minX + maxX) / 2, yc: (y0 + y1) / 2, x0: minX, x1: maxX, y0, y1, w: maxX - minX, h: y1 - y0 })
    }
  }
}

// 1. Staff lines: long thin horizontal segments.
const staffLines = segs
  .filter((s) => s.h <= 3 && s.w >= 0.3 * W)
  .map((s) => s.yc)
  .sort((a, b) => a - b)
// merge near-duplicate y's (lines drawn as multiple coincident segments)
const lines: number[] = []
for (const y of staffLines) if (!lines.length || y - lines[lines.length - 1] > 2) lines.push(y)
// group into staves (gap > 2.5× median line spacing breaks a staff)
const gaps: number[] = []
for (let i = 1; i < lines.length; i += 1) gaps.push(lines[i] - lines[i - 1])
const med = [...gaps].sort((a, b) => a - b)[gaps.length >> 1] || 10
type Staff = { top: number; bot: number; lines: number[] }
const staves: Staff[] = []
let grp: number[] = lines.length ? [lines[0]] : []
for (let i = 1; i <= lines.length; i += 1) {
  if (lines[i] === undefined || lines[i] - lines[i - 1] > med * 2.5) {
    if (grp.length >= 3) staves.push({ top: grp[0], bot: grp[grp.length - 1], lines: grp })
    grp = lines[i] === undefined ? [] : [lines[i]]
  } else grp.push(lines[i])
}
// group staves into systems (gap between staves > 1.5× staff height)
const staffH = staves.length ? staves.reduce((a, s) => a + (s.bot - s.top), 0) / staves.length : 0
const systems: Staff[][] = []
let sys: Staff[] = staves.length ? [staves[0]] : []
for (let i = 1; i < staves.length; i += 1) {
  if (staves[i].top - staves[i - 1].bot > staffH * 1.5) { systems.push(sys); sys = [] }
  sys.push(staves[i])
}
if (sys.length) systems.push(sys)

// A barline candidate in a staff: thin vertical spanning ≥85% of that staff's
// height (top line to bottom line) — excludes note stems, which don't reach both
// outer lines. Dump per-staff so we can verify intersection across a system's
// staves recovers real barlines and drops stems.
const verts = segs.filter((s) => s.w <= 3)
const round = (x: number) => Math.round((x / W) * 200) / 200 // ~3px buckets

console.log(`${file} p${pageNum}: ${staves.length} staves, staffH≈${(staffH / H).toFixed(3)}`)
const perStaff: number[][] = staves.map((st) => {
  const sh = st.bot - st.top
  const xs = new Set<number>()
  for (const v of verts) {
    if (v.h < 0.85 * sh) continue
    if (v.y0 <= st.top + 0.1 * sh && v.y1 >= st.bot - 0.1 * sh) xs.add(round(v.xc))
  }
  return [...xs].sort((a, b) => a - b)
})
perStaff.forEach((xs, i) => {
  console.log(`  staff${i + 1} y≈${(staves[i].top / H).toFixed(2)}  n=${xs.length}  x: ${xs.map((x) => x.toFixed(3)).join(' ')}`)
})
