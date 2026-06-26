import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { readFileSync } from 'node:fs'
import { extractLyrics } from '../src/lib/lyricsExtract.ts'
import { fixturePath } from './fixtures.ts'

let failures = 0
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
  if (!cond) failures += 1
}

async function load(file: string) {
  const doc = await getDocument({ data: new Uint8Array(readFileSync(fixturePath(file))) }).promise
  return extractLyrics(doc)
}

async function main() {
  // sheetmusic.pdf (Something's Coming): ASCII noteheads, lyric "nuh"
  {
    const toks = await load('sheetmusic.pdf')
    const texts = toks.map((t) => t.text.toLowerCase())
    console.log(`\nsheetmusic.pdf: ${toks.length} tokens, pages ${new Set(toks.map(t=>t.page)).size}`)
    console.log('  sample:', texts.slice(0, 12).join(' '))
    check('extracted some lyrics', toks.length > 20)
    check('found "nuh" lyric', texts.includes('nuh'))
    check('no pure-digit tokens', !texts.some((t) => /^\d+$/.test(t)))
    check('no notehead glyph œ', !texts.some((t) => t.includes('œ')))
    check('all yRatio in 0..1', toks.every((t) => t.yRatio >= 0 && t.yRatio <= 1))
    // Cue labels (e.g. "Melody solo:", "ALL Leads Enter:") are stripped.
    check('no cue label "solo" leaked', !texts.includes('solo'))
    check('no token ends with a colon', !texts.some((t) => t.endsWith(':')))
    // Running header "SOMETHING'S COMING" (printed at y≈0.06 atop pages 2–14) is
    // dropped — it would otherwise match sung title words and anchor them to the page top.
    const topBand = toks.filter((t) => t.yRatio < 0.13)
    check('running "Page" header token dropped', !topBand.some((t) => t.text.toLowerCase() === 'page'))
    check('repeated top-of-page title not kept as lyric', topBand.filter((t) => t.text.toLowerCase() === 'coming').length === 0,
      `topBand "coming" count=${topBand.filter((t) => t.text.toLowerCase() === 'coming').length}`)
  }
  // monster.pdf (Dorico): lyrics like mon-sters, ghosts, ghouls
  {
    const toks = await load('monster.pdf')
    const texts = toks.map((t) => t.text.toLowerCase())
    console.log(`\nmonster.pdf: ${toks.length} tokens`)
    console.log('  sample:', texts.slice(0, 14).join(' '))
    check('extracted lyrics', toks.length > 30)
    check('found a known lyric word', ['sters','ghosts','ghouls','monsters','dut','ah'].some((w)=>texts.includes(w)))
    check('did not keep staff label "tenor" as lyric', texts.filter((t)=>t==='tenor').length <= 1)
    // Inline "VO:" cue is stripped but the lyric it prefixes ("…when darkness") survives.
    check('inline "vo:" cue dropped', !texts.some((t) => t.startsWith('vo:')))
    check('lyric after the cue survives', texts.some((t) => t.includes('darkness')))
  }
  // Brahms Lullaby: 4-staff choral, lyrics under each staff
  {
    const toks = await load('Brahms Lullaby.pdf')
    console.log(`\nBrahms Lullaby.pdf: ${toks.length} tokens`)
    console.log('  sample:', toks.slice(0, 14).map(t=>t.text).join(' '))
    check('extracted choral lyrics', toks.length > 20)
  }
  // Scanned PDF: no text layer -> no tokens (graceful)
  {
    const toks = await load('Jeepers Creepers.pdf')
    console.log(`\nJeepers Creepers.pdf (scan): ${toks.length} tokens`)
    check('scan yields no lyrics (gated upstream)', toks.length === 0)
  }
  // Breadth sweep: universal invariants across many engravers/styles (not just the
  // barbershop fixtures) — no digits (section/nav markers), no colon-terminated
  // tokens (cue labels), and a non-trivial lyric haul on vector scores.
  {
    const vector = [
      'A Little Patch of Heaven.pdf', 'Ain_t_Nobody_s_Business_If_I_Do-Ain_t_Nobody_s_Business_If_I_Do_17742263854152.pdf',
      'Black is the colour - Puerling.pdf', 'Like Someone In Love Puerling.pdf', 'Little Pal.pdf',
      'RedHot_final.pdf', 'Steppin Out sheet music.pdf', 'Ya Got Trouble.pdf',
      'You\'re From Heaven And You\'re Mine.pdf', 'this_is_the_moment.pdf',
    ]
    console.log('\nbreadth sweep:')
    for (const file of vector) {
      const toks = await load(file)
      const texts = toks.map((t) => t.text)
      const digit = texts.find((t) => /\d/.test(t))
      const colon = texts.find((t) => t.endsWith(':'))
      const multi = texts.find((t) => /\s/.test(t.trim()))
      console.log(`  ${file.slice(0, 28).padEnd(28)} ${String(toks.length).padStart(4)} tok` +
        `${digit ? `  digit:${JSON.stringify(digit)}` : ''}${colon ? `  colon:${JSON.stringify(colon)}` : ''}` +
        `${multi ? `  multi:${JSON.stringify(multi)}` : ''}`)
      check(`  ${file.slice(0, 22)}: extracted lyrics`, toks.length > 20)
      check(`  ${file.slice(0, 22)}: no digit tokens`, digit === undefined)
      check(`  ${file.slice(0, 22)}: no colon-end tokens`, colon === undefined)
      check(`  ${file.slice(0, 22)}: single-word tokens`, multi === undefined)
    }
  }
  console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURES'}`)
  process.exit(failures === 0 ? 0 : 1)
}
main()
