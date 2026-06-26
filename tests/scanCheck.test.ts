import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { readFileSync } from 'node:fs'
import { isScannedPdf, pageInkProfile } from '../src/lib/scanCheck.ts'
import { allFixturePdfs, fixturePath, hasFixture } from './fixtures.ts'

// Classify every corpus PDF as scan vs vector via the content-stream check, print
// the verdict (eyeball that scans are flagged and vector scores are not), then assert
// the known-label cases. OPS values are identical across pdfjs builds, so the lib's
// `import { OPS } from 'pdfjs-dist'` matches operator lists from the legacy build here.

let fail = 0
const flagged: string[] = []

for (const path of allFixturePdfs()) {
  const name = path.split('/').pop() ?? path
  let pdf
  try {
    pdf = await getDocument({ data: new Uint8Array(readFileSync(path)) }).promise
  } catch {
    console.log(`  (open fail) ${name}`)
    continue
  }
  const scan = await isScannedPdf(pdf)
  const p1 = await pageInkProfile(pdf, 1)
  if (scan) flagged.push(name)
  console.log(`${scan ? 'SCAN  ' : 'vector'}  ${name.slice(0, 40).padEnd(40)} p1: img=${p1.imageOps} path=${p1.pathOps}`)
}

console.log(`\nflagged as scans: ${flagged.length ? flagged.join(', ') : '(none)'}`)

// Known labels (confirmed via getOperatorList this session).
const expect = async (file: string, want: boolean) => {
  if (!hasFixture(file)) { console.log(`  SKIP (absent) ${file}`); return }
  const pdf = await getDocument({ data: new Uint8Array(readFileSync(fixturePath(file))) }).promise
  const got = await isScannedPdf(pdf)
  if (got !== want) { fail += 1; console.log(`  FAIL ${file}: got ${got}, want ${want}`) }
}
await expect('And So It Goes.pdf', true) // confirmed scan (raster pages + OCR text layer)
await expect('monster.pdf', false) // vector (335 path ops/page)
await expect('sheetmusic.pdf', false) // vector dev fixture
await expect('A Dream Is a Wish.pdf', false)
await expect('Ya Got Trouble.pdf', false)

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAIL`)
process.exitCode = fail === 0 ? 0 : 1
