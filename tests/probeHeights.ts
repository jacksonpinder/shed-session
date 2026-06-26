import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { readFileSync } from 'node:fs'
import { allFixturePdfs } from './fixtures.ts'

// Probe: is there a clean FONT-SIZE separation between lyric text and title/credit
// blocks? Size is the transform's vertical scale (item.height is often 0).

const isWordish = (s: string) => /\p{L}/u.test(s) && !/[0-9=]/.test(s) && s.trim().length <= 24
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0 }

const files = allFixturePdfs()
console.log(`probing ${files.length} files`)

for (const file of files) {
  try {
    const doc = await getDocument({ data: new Uint8Array(readFileSync(file)) }).promise
    const items: { text: string; size: number; page: number }[] = []
    for (let p = 1; p <= doc.numPages; p += 1) {
      try {
        const content = await (await doc.getPage(p)).getTextContent()
        for (const it of content.items) {
          if (!('str' in it) || !it.str || !isWordish(it.str)) continue
          const t = it.transform as number[]
          const size = Math.hypot(t[2] ?? 0, t[3] ?? 0)
          if (Number.isFinite(size) && size > 0) items.push({ text: it.str.trim(), size: +size.toFixed(2), page: p })
        }
      } catch { /* skip page */ }
    }
    if (items.length === 0) { console.log(`### ${file}\n  (scan/no text)`); continue }
    const med = median(items.map((i) => i.size))
    const big = items.filter((i) => i.size > med * 1.25)
    const top = [...new Map(items.map((i) => [i.text, i])).values()]
      .sort((a, b) => b.size - a.size).slice(0, 8)
      .map((i) => `${JSON.stringify(i.text)}@${i.size}`)
    console.log(`### ${file}`)
    console.log(`  items=${items.length} medSize=${med.toFixed(1)} >1.25x=${big.length} maxSize=${Math.max(...items.map((i) => i.size)).toFixed(1)}`)
    console.log(`  largest: ${top.join(' ')}`)
  } catch (e) {
    console.log(`### ${file}\n  ERROR ${e}`)
  }
}
console.log('done')
