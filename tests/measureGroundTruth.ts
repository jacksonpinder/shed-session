import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { createCanvas } from '@napi-rs/canvas'
import { readFileSync } from 'node:fs'
import { detectSystems } from '../src/lib/detectSystems.ts'
import { fixturePath } from './fixtures.ts'

// Ground-truth measure counts from the user's manual review (1-indexed page + system).
// Node @napi-rs at SCALE=3 matches the live browser for measure detection (verified
// on monster), so this is a fast proxy for the user's eyes. `soft: true` marks cases
// the user excused (pickup measures / blank-space edge cases) — reported but not failed.
type GT = { page: number; sys: number; meas: number; soft?: boolean; note?: string }
const TRUTH: Record<string, GT[]> = {
  '1927 Kansas City.pdf': [{ page: 1, sys: 2, meas: 4 }, { page: 1, sys: 3, meas: 3 }, { page: 3, sys: 3, meas: 4 }],
  'A Dream Is a Wish.pdf': [{ page: 4, sys: 1, meas: 4 }],
  'A Fool Such As I.pdf': [{ page: 2, sys: 3, meas: 3 }, { page: 2, sys: 4, meas: 3 }, { page: 6, sys: 1, meas: 3 }, { page: 4, sys: 2, meas: 3 }],
  'A Little Patch of Heaven.pdf': [{ page: 2, sys: 3, meas: 3 }],
  'AaronDaleDavidWrightMedley.pdf': [{ page: 4, sys: 2, meas: 3 }, { page: 5, sys: 5, meas: 5 }],
  "Ain't Misbehavin'.pdf": [{ page: 2, sys: 1, meas: 3 }, { page: 2, sys: 3, meas: 3 }, { page: 2, sys: 4, meas: 4 }, { page: 4, sys: 1, meas: 4 }],
  'All Nations Rise.pdf': [{ page: 8, sys: 1, meas: 4 }],
  'All Of Me Brockman.pdf': [{ page: 5, sys: 1, meas: 4 }, { page: 5, sys: 2, meas: 4 }, { page: 5, sys: 3, meas: 4 }],
  'And Can It Be.pdf': [{ page: 1, sys: 1, meas: 11 }, { page: 3, sys: 1, meas: 11 }, { page: 3, sys: 3, meas: 10 }],
  // SCANNED PDF (every page is one raster image, zero vector paths — confirmed via
  // getOperatorList; the 70-item text layer is an OCR/overlay that fools the text gate
  // and isLikelyScanned's pixel heuristic). Out of scope for vector measure detection,
  // so soft (reported, never failed) — and it must NOT constrain barlineHeightRatio.
  'And So It Goes.pdf': [
    { page: 1, sys: 1, meas: 3, soft: true, note: 'scan' }, { page: 1, sys: 2, meas: 3, soft: true, note: 'scan' }, { page: 2, sys: 2, meas: 3, soft: true, note: 'scan' },
    { page: 3, sys: 1, meas: 3, soft: true, note: 'scan' }, { page: 3, sys: 2, meas: 3, soft: true, note: 'scan' }, { page: 3, sys: 3, meas: 3, soft: true, note: 'scan' },
    { page: 4, sys: 3, meas: 3, soft: true, note: 'scan' }, { page: 4, sys: 4, meas: 3, soft: true, note: 'scan' }, { page: 5, sys: 1, meas: 3, soft: true, note: 'scan' }, { page: 5, sys: 4, meas: 4, soft: true, note: 'scan' },
  ],
  'Any Time At All.pdf': [{ page: 3, sys: 4, meas: 2 }, { page: 4, sys: 1, meas: 2 }, { page: 5, sys: 1, meas: 2 }],
  'Are You Lonesome Tonight.pdf': [{ page: 2, sys: 5, meas: 4 }, { page: 3, sys: 5, meas: 4 }],
  'At the end of the day.pdf': [
    { page: 1, sys: 2, meas: 5 }, { page: 1, sys: 3, meas: 5 }, { page: 2, sys: 1, meas: 5 },
    { page: 2, sys: 2, meas: 5 }, { page: 2, sys: 4, meas: 3, soft: true, note: 'blank space between measures; 5 ok' },
  ],
  'Baby Face.pdf': [{ page: 4, sys: 4, meas: 5 }, { page: 3, sys: 2, meas: 4 }],
  // p4 has 4 systems (no S5 — earlier truth entry was bogus; user confirmed detection correct).
  'Back In Dad And Mothers Day Parody.pdf': [{ page: 6, sys: 1, meas: 3 }, { page: 3, sys: 4, meas: 5, note: 'eighth-note stems over-count' }],
  'Steppin Out sheet music.pdf': [{ page: 4, sys: 3, meas: 4, note: 'tie across barline → under-count' }],
  'monster.pdf': [{ page: 1, sys: 2, meas: 5, note: 'half-note stem over-count' }, { page: 7, sys: 3, meas: 5, note: 'half-note stem over-count' }],
  'Black is the colour - Puerling.pdf': [{ page: 2, sys: 2, meas: 4 }, { page: 2, sys: 4, meas: 5 }],
  // S1 geometric count is 5 (includes the 1-beat pickup measure) — user confirmed 5 is correct.
  'Brahms Lullaby.pdf': [{ page: 1, sys: 1, meas: 5, note: 'incl. pickup' }, { page: 1, sys: 2, meas: 6 }, { page: 2, sys: 1, meas: 6 }],
  'Like Someone In Love Puerling.pdf': [{ page: 1, sys: 1, meas: 5 }, { page: 4, sys: 2, meas: 4 }, { page: 6, sys: 1, meas: 5 }, { page: 7, sys: 2, meas: 3 }],
}

const SCALE = 3
const VERBOSE = process.argv.includes('-v')

{
  let pass = 0, fail = 0, soft = 0
  const fails: string[] = []
  for (const [file, gts] of Object.entries(TRUTH)) {
    let doc
    try {
      doc = await getDocument({ data: new Uint8Array(readFileSync(fixturePath(file))) }).promise
    } catch {
      continue
    }
    const pagesNeeded = [...new Set(gts.map((g) => g.page))]
    const measByPage = new Map<number, number[]>()
    for (const p of pagesNeeded) {
      try {
        const page = await doc.getPage(p)
        const vp = page.getViewport({ scale: SCALE })
        const cv = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height))
        const ctx = cv.getContext('2d')
        ctx.fillStyle = 'white'; ctx.fillRect(0, 0, cv.width, cv.height)
        await page.render({ canvasContext: ctx as never, viewport: vp }).promise
        measByPage.set(p, detectSystems(cv as never).bands.map((b) => b.measureCount ?? 0))
      } catch {
        /* skip */
      }
    }
    for (const g of gts) {
      const got = measByPage.get(g.page)?.[g.sys - 1]
      const ok = got === g.meas
      if (ok) pass += 1
      else if (g.soft) soft += 1
      else { fail += 1; fails.push(`${file.slice(0, 26).padEnd(26)} p${g.page} S${g.sys}: got ${got}, want ${g.meas}`) }
    }
  }
  console.log(`measure ground-truth:  ${pass} pass, ${fail} FAIL, ${soft} soft`)
  if (VERBOSE) for (const f of fails) console.log(`    ${f}`)
}
