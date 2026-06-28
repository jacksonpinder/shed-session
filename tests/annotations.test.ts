// Pure-math tests for src/lib/annotations.ts. Run via:
//   node --experimental-strip-types tests/annotations.test.ts
//
// Path2D does not exist in Node, so we install a minimal mock that records the
// path-building calls. That lets us assert catmullRomPath emits geometry without
// a real canvas. crypto.getRandomValues IS available as a Node global, so nanoid
// runs unmocked.

// ── Path2D mock ──────────────────────────────────────────────────────────────
type PathOp = { op: string; args: number[] }
class MockPath2D {
  ops: PathOp[] = []
  moveTo(x: number, y: number) {
    this.ops.push({ op: 'moveTo', args: [x, y] })
  }
  bezierCurveTo(a: number, b: number, c: number, d: number, e: number, f: number) {
    this.ops.push({ op: 'bezierCurveTo', args: [a, b, c, d, e, f] })
  }
}
;(globalThis as unknown as { Path2D: typeof MockPath2D }).Path2D = MockPath2D

const {
  catmullRomPath,
  normalizePoint,
  strokeHitTest,
  nanoid,
} = await import('../src/lib/annotations.ts')
import type { AnnotationStroke, AnnotationPoint } from '../src/lib/annotations.ts'

let failures = 0
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
  if (!cond) failures += 1
}
const approx = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps

// ── catmullRomPath ───────────────────────────────────────────────────────────
{
  const empty = catmullRomPath([], 100, 100) as unknown as MockPath2D
  check('empty input → no path ops', empty.ops.length === 0)

  const single = catmullRomPath([[0.5, 0.5]], 100, 100) as unknown as MockPath2D
  check('single point → no path ops (< 2)', single.ops.length === 0)

  const pts: AnnotationPoint[] = [
    [0, 0],
    [0.5, 0.5],
    [1, 1],
  ]
  const path = catmullRomPath(pts, 200, 100) as unknown as MockPath2D
  check('>=2 points → non-empty path', path.ops.length > 0, `${path.ops.length} ops`)
  check('first op is moveTo to first point in px', path.ops[0].op === 'moveTo' &&
    approx(path.ops[0].args[0], 0) && approx(path.ops[0].args[1], 0))
  check('one bezier per segment (3 pts → 2 segments)',
    path.ops.filter((o) => o.op === 'bezierCurveTo').length === 2)
  // Last bezier must end at the last point in pixel space (1*200, 1*100).
  const lastBez = [...path.ops].reverse().find((o) => o.op === 'bezierCurveTo')!
  check('last bezier ends at final point in px',
    approx(lastBez.args[4], 200) && approx(lastBez.args[5], 100),
    `(${lastBez.args[4]}, ${lastBez.args[5]})`)
}

// ── normalizePoint (mock the bounding rect) ──────────────────────────────────
{
  const fakeCanvas = {
    getBoundingClientRect: () => ({ left: 100, top: 50, width: 400, height: 200 }),
  } as unknown as HTMLCanvasElement

  const mid = normalizePoint({ clientX: 300, clientY: 150 } as PointerEvent, fakeCanvas)
  check('center maps to (0.5, 0.5)', approx(mid[0], 0.5) && approx(mid[1], 0.5),
    `(${mid[0]}, ${mid[1]})`)

  const topLeft = normalizePoint({ clientX: 100, clientY: 50 } as PointerEvent, fakeCanvas)
  check('rect origin maps to (0, 0)', approx(topLeft[0], 0) && approx(topLeft[1], 0))

  const bottomRight = normalizePoint({ clientX: 500, clientY: 250 } as PointerEvent, fakeCanvas)
  check('rect far corner maps to (1, 1)', approx(bottomRight[0], 1) && approx(bottomRight[1], 1))

  const outside = normalizePoint({ clientX: 700, clientY: -50 } as PointerEvent, fakeCanvas)
  check('out-of-bounds clamps to [0,1]',
    outside[0] === 1 && outside[1] === 0, `(${outside[0]}, ${outside[1]})`)
}

// ── strokeHitTest ────────────────────────────────────────────────────────────
{
  const stroke: AnnotationStroke = {
    id: 'x',
    tool: 'pen',
    color: '#000',
    width: 2,
    page: 1,
    points: [
      [0, 0],
      [1, 0],
    ],
  }
  check('point on the segment (midpoint) hits',
    strokeHitTest(stroke, [0.5, 0.0], 0.01))
  check('point within radius of segment hits',
    strokeHitTest(stroke, [0.5, 0.02], 0.05))
  check('point beyond radius misses',
    !strokeHitTest(stroke, [0.5, 0.5], 0.05))
  check('point past segment end (beyond radius) misses',
    !strokeHitTest(stroke, [2, 0], 0.05))

  const dot: AnnotationStroke = { ...stroke, points: [[0.5, 0.5]] }
  check('single-point stroke: near hits', strokeHitTest(dot, [0.51, 0.5], 0.05))
  check('single-point stroke: far misses', !strokeHitTest(dot, [0.9, 0.9], 0.05))

  const emptyStroke: AnnotationStroke = { ...stroke, points: [] }
  check('empty stroke never hits', !strokeHitTest(emptyStroke, [0, 0], 1))
}

// ── nanoid ───────────────────────────────────────────────────────────────────
{
  const ids = new Set<string>()
  let allRightLength = true
  for (let i = 0; i < 5000; i++) {
    const id = nanoid()
    if (id.length !== 16) allRightLength = false
    ids.add(id)
  }
  check('nanoid length is 16', allRightLength)
  check('nanoid 5000 generated are unique', ids.size === 5000, `${ids.size}/5000 unique`)
  check('nanoid is URL-safe (only safe chars)',
    [...ids].every((id) => /^[A-Za-z0-9_-]+$/.test(id)))
}

console.log(failures === 0 ? '\nAll annotations tests passed.' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
