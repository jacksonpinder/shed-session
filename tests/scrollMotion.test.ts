import {
  adaptiveAnchorFraction,
  advanceFollowTarget,
  cappedScrollStep,
  MIN_SECONDS_PER_SYSTEM,
  type FollowState,
  BASE_FRACTION,
  SAFE_FRACTION,
  MAX_FRACTION,
} from '../src/lib/scrollMotion.ts'

let failures = 0
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
  if (!cond) failures += 1
}
const approx = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps

// adaptive anchor fraction: confident → upper third; unsure → lower; clamped.
{
  check('confident sync → BASE_FRACTION', approx(adaptiveAnchorFraction(1, 0.25), BASE_FRACTION))
  check('low confidence → toward SAFE_FRACTION', approx(adaptiveAnchorFraction(0, 0.25), SAFE_FRACTION))
  check(
    'mid confidence sits between base and safe',
    adaptiveAnchorFraction(0.5, 0.25) > BASE_FRACTION && adaptiveAnchorFraction(0.5, 0.25) < SAFE_FRACTION
  )
  check(
    'never less than the system height (keep it fully visible)',
    approx(adaptiveAnchorFraction(1, 0.45), 0.45),
    `got ${adaptiveAnchorFraction(1, 0.45).toFixed(3)}`
  )
  check('capped at MAX_FRACTION for tall systems', approx(adaptiveAnchorFraction(1, 0.9), MAX_FRACTION))
  check('confidence is clamped (>1 same as 1)', approx(adaptiveAnchorFraction(5, 0.2), BASE_FRACTION))
}

// monotonic ratchet: forward play with a WOBBLING raw target never scrolls up
// (the actual reported bug), but real time-seeks reposition.
{
  // raw target drifts downward at +10/step but wobbles ±60 (the frac-driven jitter)
  let state: FollowState = { maxTarget: null, lastTime: null }
  const wobble = [0, 60, -60, 40, -50, 30, -40, 55, -30, 20]
  let t = 0
  let prev = -Infinity
  let monotonic = true
  const outs: number[] = []
  for (let i = 0; i < wobble.length; i++) {
    t += 0.5 // forward play, no seek
    const raw = 100 + i * 10 + wobble[i]
    const r = advanceFollowTarget(raw, t, state)
    state = r.state
    outs.push(r.target)
    if (r.target < prev - 1e-9) monotonic = false
    if (r.seeked && i > 0) monotonic = false // none of these are seeks
    prev = r.target
  }
  check('forward play is monotonic despite raw-target wobble', monotonic, `targets=${outs.join(',')}`)
  // Cold start (no prior time) is NOT a seek — the caller eases onto the target instead
  // of teleporting (so emerging from a lyric-less intro glides onto the first sung line),
  // but rawTarget still seeds the ratchet baseline.
  {
    const cold = advanceFollowTarget(500, 0, { maxTarget: null, lastTime: null })
    check('cold start is not a seek (eases in, no teleport)', !cold.seeked)
    check('cold start seeds the ratchet baseline', cold.target === 500)
  }
}
{
  // a backward time jump (loop wrap) — even a SMALL one — resets the ratchet downward
  let state: FollowState = { maxTarget: 1000, lastTime: 12.0 }
  const back = advanceFollowTarget(300, 11.4, state) // 0.6s back
  check('backward seek detected', back.seeked)
  check('backward seek lets the target drop (loop repositions)', back.target === 300)
  // a tiny backward wobble in time (< SEEK_BACK_S) is NOT a seek → stays monotonic
  const tiny = advanceFollowTarget(300, 11.39, { maxTarget: 1000, lastTime: 11.4 })
  check('sub-threshold time wobble is not a seek', !tiny.seeked && tiny.target === 1000)
  // a forward skip (> SEEK_FWD_S) is a seek → jumps to the new (smaller-allowed) target
  const fwd = advanceFollowTarget(2000, 30, { maxTarget: 1000, lastTime: 12 })
  check('forward skip detected', fwd.seeked && fwd.target === 2000)
}

// slew-rate limit: normal slow motion passes; a multi-system lurch is capped so the
// scroll can't cross a system faster than MIN_SECONDS_PER_SYSTEM.
{
  const systemPx = 140 // a system is 140px tall
  const dt = 1 / 60
  const maxStep = (systemPx / MIN_SECONDS_PER_SYSTEM) * dt
  // a gentle per-frame step (well under one system / 0.7s) is untouched
  check('normal step passes through uncapped', cappedScrollStep(1.2, systemPx, dt) === 1.2)
  // a huge lurch step is capped to the max
  check('lurch step is capped to the slew limit', approx(cappedScrollStep(500, systemPx, dt), maxStep), `got ${cappedScrollStep(500, systemPx, dt).toFixed(2)} max ${maxStep.toFixed(2)}`)
  // crossing a full system at the cap takes ~MIN_SECONDS_PER_SYSTEM
  check('capped speed crosses one system in MIN_SECONDS_PER_SYSTEM', approx(systemPx / (maxStep / dt), MIN_SECONDS_PER_SYSTEM))
  check('backward / zero steps are not capped', cappedScrollStep(-30, systemPx, dt) === -30 && cappedScrollStep(0, systemPx, dt) === 0)
  check('unknown system height ⇒ no cap', cappedScrollStep(500, 0, dt) === 500)
}

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURES'}`)
process.exit(failures === 0 ? 0 : 1)
