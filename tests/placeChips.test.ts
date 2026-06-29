import { placeChips, type ChipInput } from '../src/lib/placeChips.ts'

let failures = 0
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
  if (!cond) failures += 1
}

const chip = (id: string, centerPx: number, widthPx: number): ChipInput => ({ id, centerPx, widthPx })

// No overlap: each chip stays centred on its bar.
{
  const r = placeChips([chip('a', 100, 40), chip('b', 300, 40)], 400, 4)
  const a = r.find((c) => c.id === 'a')!
  const b = r.find((c) => c.id === 'b')!
  check('isolated chips stay centred', a.leftPx === 80 && b.leftPx === 280, `a=${a.leftPx} b=${b.leftPx}`)
  check('isolated chips keep natural width', a.widthPx === 40 && b.widthPx === 40)
}

// Output order matches input order regardless of centre order.
{
  const r = placeChips([chip('right', 300, 20), chip('left', 50, 20)], 400)
  check('output preserves input order', r[0].id === 'right' && r[1].id === 'left')
}

// Single chip is centred and clamped into view at the right edge.
{
  const r = placeChips([chip('only', 395, 40)], 400, 4)
  check('single chip clamps to right edge', r[0].leftPx === 360, `left=${r[0].leftPx}`)
}
{
  const r = placeChips([chip('only', 5, 40)], 400, 4)
  check('single chip clamps to left edge', r[0].leftPx === 0, `left=${r[0].leftPx}`)
}

// Overlapping chips get pushed apart (offset opposite the crowding) without truncation.
{
  const r = placeChips([chip('a', 100, 60), chip('b', 130, 60)], 400, 4)
  const a = r.find((c) => c.id === 'a')!
  const b = r.find((c) => c.id === 'b')!
  const noOverlap = a.leftPx + a.widthPx + 4 <= b.leftPx + 0.001
  check('overlapping chips are separated', noOverlap, `a=[${a.leftPx},${a.leftPx + a.widthPx}] b=[${b.leftPx},${b.leftPx + b.widthPx}]`)
  check('separated chips keep full width', a.widthPx === 60 && b.widthPx === 60)
  // The collision is resolved by offsetting at least one chip off its ideal centre.
  check('crowded chip offset off its centre', b.leftPx + b.widthPx / 2 > 130)
  check('separated chips stay in bounds', a.leftPx >= -0.001 && b.leftPx + b.widthPx <= 400 + 0.001)
}

// Too wide to fit at natural size → widths shrink (truncation) and stay in bounds.
{
  const r = placeChips([chip('a', 100, 300), chip('b', 300, 300)], 400, 4)
  const total = r.reduce((s, c) => s + c.widthPx, 0)
  check('overflowing chips are truncated', total <= 400 - 4 + 0.001, `total=${total}`)
  check('truncated chips stay in [0, width]', r.every((c) => c.leftPx >= -0.001 && c.leftPx + c.widthPx <= 400 + 0.001))
  const sortedByLeft = [...r].sort((x, y) => x.leftPx - y.leftPx)
  check('truncated chips do not overlap', sortedByLeft[0].leftPx + sortedByLeft[0].widthPx + 4 <= sortedByLeft[1].leftPx + 0.001)
}

// Water-filling: a narrow chip keeps its size; the wide one gives up space.
{
  const r = placeChips([chip('narrow', 50, 30), chip('wide', 200, 400)], 300, 4)
  const narrow = r.find((c) => c.id === 'narrow')!
  const wide = r.find((c) => c.id === 'wide')!
  check('narrow chip keeps natural width', narrow.widthPx === 30, `narrow=${narrow.widthPx}`)
  check('wide chip absorbs the shrink', wide.widthPx > 30 && narrow.widthPx + wide.widthPx + 4 <= 300 + 0.001)
}

// Empty input.
check('empty input returns empty', placeChips([], 400).length === 0)

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURES'}`)
process.exit(failures === 0 ? 0 : 1)
