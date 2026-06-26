import { buildTimingModel, resolveTimedPosition, resolveScrollSegment, systemIndexForMeasure } from '../src/lib/timingModel.ts'
import type { SystemBand } from '../src/lib/detectSystems.ts'

let failures = 0
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
  if (!cond) failures += 1
}

// Three systems, one per page, each 4 measures, barlines evenly spaced 0.1..0.9.
const band = (topRatio: number, measureCount: number): SystemBand => {
  const barlineXRatios = Array.from({ length: measureCount + 1 }, (_, i) => 0.1 + (0.8 * i) / measureCount)
  return { topRatio, bottomRatio: topRatio + 0.25, firstLineRatio: topRatio + 0.05, lastLineRatio: topRatio + 0.2, measureCount, barlineXRatios }
}
const anc = (time: number, page: number, y: number, x: number) =>
  ({ time, page, yWithinPageRatio: y, xWithinPageRatio: x, text: 'w', confidence: 1, heard: 'w' })

// Steady tempo, ~1 measure/sec. Page 2 deliberately has NO anchors — the model
// must still place its measures in time by interpolation.
{
  const bands = { 1: [band(0.1, 4)], 2: [band(0.1, 4)], 3: [band(0.1, 4)] }
  const anchors = [
    anc(0.5, 1, 0.15, 0.15), anc(1.5, 1, 0.15, 0.35), anc(2.5, 1, 0.15, 0.55), anc(3.5, 1, 0.15, 0.75),
    // page 2 (measures 4..8) — silent, no anchors
    anc(8.5, 3, 0.15, 0.15), anc(9.5, 3, 0.15, 0.35), anc(10.5, 3, 0.15, 0.55),
  ]
  const model = buildTimingModel(anchors, bands)
  check('model builds', !!model)
  check('total measures = 12', model!.totalMeasures === 12)
  check('tempo reads as steady', model!.tempoStability > 0.8, `stability=${model!.tempoStability.toFixed(2)}`)

  // At t≈6 we're mid-page-2 (measures ~4–8) even though page 2 has no anchors.
  const mid = resolveTimedPosition(model!, 6)
  check('fills the silent page 2 by interpolation', mid!.page === 2, `got page ${mid!.page}, measure ${mid!.measure.toFixed(2)}`)
  check('interpolated flag set in the gap', mid!.interpolated === true)

  // This piece reads steady (no beat data → anchor-derived steadiness is high), so the
  // intro is best-guessed: t=0 pre-rolls from the top of page 1. After the last anchor → hold.
  check('steady intro pre-rolls from page 1 (no manual yield)', resolveTimedPosition(model!, 0)!.page === 1)
  check('holds at end after last anchor', resolveTimedPosition(model!, 99)!.page === 3)

  // Monotonic: position never goes backward as time advances.
  let last = -1
  let monotonic = true
  for (let t = 0; t <= 12; t += 0.25) {
    const tp = resolveTimedPosition(model!, t)
    if (!tp) continue // intro yields (null) when unsteady — skip
    if (tp.measure < last - 1e-9) monotonic = false
    last = tp.measure
  }
  check('measure axis is monotonic in time', monotonic)
}

// Rubato: genuinely erratic local tempo (every close-pair slope differs, no majority
// cluster) → robust stability stays low. μ rises 0.25→1→1.5→3 over times 0.5,2.4,2.6,3.0,
// so the three local rates are ~0.39, 2.5, 3.75 measures/s — a real spread, not one glitch.
{
  const bands = { 1: [band(0.1, 4)] }
  const anchors = [anc(0.5, 1, 0.15, 0.15), anc(2.4, 1, 0.15, 0.30), anc(2.6, 1, 0.15, 0.40), anc(3.0, 1, 0.15, 0.70)]
  const model = buildTimingModel(anchors, bands)
  check('rubato reads as unsteady', model!.tempoStability < 0.6, `stability=${model!.tempoStability.toFixed(2)}`)
  // Below the medium intro-confidence bar (and no beat data) → still yield to manual scroll.
  check('unsteady intro (no beat) yields to manual scroll', resolveTimedPosition(model!, 0) === null)
}

// Beat analysis: a steady intro (high pulse clarity before the first anchor) should
// blind-scroll the intro; a rubato intro should hold.
{
  const bands = { 1: [band(0.1, 4)], 2: [band(0.1, 4)] }
  // first sung anchor not until page 2 (measures 4..8); page 1 is an instrumental intro
  const anchors = [anc(8.5, 2, 0.15, 0.15), anc(9.5, 2, 0.15, 0.35), anc(10.5, 2, 0.15, 0.55)]
  const beatSteady = { tempo: 120, beatTimes: [], pulseClarity: 0.9, clarityWindows: [{ t: 0, clarity: 0.9 }, { t: 8, clarity: 0.9 }] }
  const steady = buildTimingModel(anchors, bands, beatSteady)
  check('steady intro flagged', steady!.introSteady === true)
  check('pulse clarity blended into stability', steady!.pulseClarity === 0.9)
  // mid-intro (t≈4) should be scrolling page 1, not jumped to page 2
  const introPos = resolveTimedPosition(steady!, 4)
  check('steady intro pre-rolls page 1', introPos!.page === 1 && introPos!.interpolated)

  const beatRubato = { tempo: 80, beatTimes: [], pulseClarity: 0.2, clarityWindows: [{ t: 0, clarity: 0.2 }] }
  const rubato = buildTimingModel(anchors, bands, beatRubato)
  check('rubato intro not flagged', rubato!.introSteady === false)
  check('rubato intro yields to manual scroll (no pre-roll jump-through)', resolveTimedPosition(rubato!, 4) === null)
}

// Graceful degradation: when measure detection failed (no measureCount, e.g. a
// score with very faint barlines like monster.pdf), each system counts as 1
// measure and the model still builds + resolves at system granularity.
{
  const noMeasures: SystemBand[] = [
    { topRatio: 0.1, bottomRatio: 0.35, firstLineRatio: 0.15, lastLineRatio: 0.3 },
    { topRatio: 0.4, bottomRatio: 0.65, firstLineRatio: 0.45, lastLineRatio: 0.6 },
  ]
  const bands = { 1: [noMeasures[0]], 2: [noMeasures[1]] }
  const anchors = [anc(1, 1, 0.2, 0.3), anc(5, 2, 0.5, 0.3)]
  const model = buildTimingModel(anchors, bands)
  check('builds without measure counts', !!model && model.totalMeasures === 2)
  check('resolves at system granularity', resolveTimedPosition(model!, 3)!.page >= 1)
}

// Gap traversal: straight line between bracketing anchors ───────────────────

// A lyric-less gap is a straight line in measure space: constant speed, exact landing on
// both anchors, never leading ahead of the audio (what the old tempo-shaping did, which
// read as the scroll racing past the sung line).
{
  const bands = { 1: [band(0.1, 4)], 2: [band(0.1, 4)] }
  const anchors = [
    anc(0.5, 1, 0.15, 0.15), anc(1.5, 1, 0.15, 0.35), anc(2.5, 1, 0.15, 0.55), anc(3.5, 1, 0.15, 0.75),
    anc(7.5, 2, 0.15, 0.55), // a 4-second lyric-less gap from μ≈3.25 to μ≈6.25
  ]
  const model = buildTimingModel(anchors, bands)!
  const a = resolveTimedPosition(model, 3.5)!.measure
  const b = resolveTimedPosition(model, 7.5)!.measure
  const mid = resolveTimedPosition(model, 5.5)!.measure
  check('gap lands exactly on the near anchor', Math.abs(a - 3.25) < 1e-6, `μ=${a.toFixed(3)}`)
  check('gap lands exactly on the far anchor', Math.abs(b - 6.25) < 1e-6, `μ=${b.toFixed(3)}`)
  check('gap midpoint is the straight-line midpoint (no lead/lag)', Math.abs(mid - (a + b) / 2) < 1e-6, `μ=${mid.toFixed(3)}`)
  // Constant speed: equal time steps give equal measure steps across the gap.
  const q1 = resolveTimedPosition(model, 4.5)!.measure - a
  const q2 = resolveTimedPosition(model, 6.5)!.measure - resolveTimedPosition(model, 5.5)!.measure
  check('gap speed is constant (equal Δtime → equal Δmeasure)', Math.abs(q1 - q2) < 1e-6, `Δ1=${q1.toFixed(3)} Δ2=${q2.toFixed(3)}`)
}

// Outlier rejection: an anchor inconsistent with BOTH neighbors (a bad detection) is
// dropped, so it can't yank the measure axis; a one-sided surprise (fermata) is kept.
{
  const bands = { 1: [band(0.1, 8)] }
  // steady ~1 measure/s, but the 4th anchor's x lands it way ahead (μ≈6.5) then back.
  const anchors = [
    anc(0.5, 1, 0.15, 0.15), anc(1.5, 1, 0.15, 0.25), anc(2.5, 1, 0.15, 0.35),
    anc(3.5, 1, 0.15, 0.85), // spike: far ahead in score, out of line both sides
    anc(4.5, 1, 0.15, 0.45), anc(5.5, 1, 0.15, 0.55),
  ]
  const model = buildTimingModel(anchors, bands)
  // At t=3.5 the spike is gone → position follows the steady ~1/s trend (μ≈3.x), not ≈6.5.
  check('both-sides outlier anchor is dropped', resolveTimedPosition(model!, 3.5)!.measure < 4.5, `μ=${resolveTimedPosition(model!, 3.5)!.measure.toFixed(2)}`)
}

// Outro: extrapolate past the last anchor at the measured rate when steady (clamped to the
// score end); hold when rubato.
{
  const bands = { 1: [band(0.1, 4)], 2: [band(0.1, 4)], 3: [band(0.1, 4)] }
  const steady = buildTimingModel([
    anc(0.5, 1, 0.15, 0.15), anc(1.5, 1, 0.15, 0.35), anc(2.5, 1, 0.15, 0.55), anc(3.5, 1, 0.15, 0.75),
    anc(8.5, 3, 0.15, 0.15), anc(9.5, 3, 0.15, 0.35), anc(10.5, 3, 0.15, 0.55),
  ], bands)!
  const last = steady.samples[steady.samples.length - 1].mu
  const outro = resolveTimedPosition(steady, 15)!.measure
  check('steady outro keeps scrolling past the last anchor', outro > last, `μ=${outro.toFixed(2)} > last ${last.toFixed(2)}`)
  check('outro extrapolation is clamped to the score end', outro <= steady.totalMeasures + 1e-9)

  const rubato = buildTimingModel(
    [anc(0.5, 1, 0.15, 0.15), anc(2.4, 1, 0.15, 0.30), anc(2.6, 1, 0.15, 0.40), anc(3.0, 1, 0.15, 0.70)],
    { 1: [band(0.1, 4)] }
  )!
  const rlast = rubato.samples[rubato.samples.length - 1].mu
  check('rubato outro holds (no blind scroll)', Math.abs(resolveTimedPosition(rubato, 30)!.measure - rlast) < 1e-6)
}

// Backward (misaligned) anchors are excluded from samples so they don't create
// zero-measure flat segments. A misaligned anchor at t=4.5 landing *behind* the
// last real position in the score must be dropped — interpolation should keep
// advancing through the gap to the next legitimate anchor on page 2.
{
  const bands = { 1: [band(0.1, 4)], 2: [band(0.1, 4)] }
  const anchors = [
    anc(0.5, 1, 0.15, 0.15), anc(1.5, 1, 0.15, 0.35), anc(2.5, 1, 0.15, 0.55), anc(3.5, 1, 0.15, 0.75),
    anc(4.5, 1, 0.15, 0.15), // backward: x=0.15 « prev x=0.75 → μ goes backward, must be excluded
    anc(5.5, 2, 0.15, 0.15),
    anc(6.5, 2, 0.15, 0.35),
  ]
  const model = buildTimingModel(anchors, bands)!
  const tp3 = resolveTimedPosition(model, 3.5)!
  const tp4 = resolveTimedPosition(model, 4.5)!
  const tp5 = resolveTimedPosition(model, 5.5)!
  check('backward anchor excluded: position advances past it', tp4.measure > tp3.measure, `μ@3.5=${tp3.measure.toFixed(3)} μ@4.5=${tp4.measure.toFixed(3)}`)
  check('backward anchor excluded: t=4.5 is interpolated (not frozen)', tp4.interpolated)
  check('backward anchor excluded: measure still advances toward t=5.5', tp4.measure < tp5.measure)
}

// resolveScrollSegment: constant-pixel-velocity scroll between sync points ──────
// A lyric-less gap spanning several systems/pages becomes ONE segment whose blend is
// LINEAR IN TIME (not per-measure), so the scroll glides at constant pixel velocity
// instead of pulsing faster across each page break.
{
  const bands = { 1: [band(0.1, 4)], 2: [band(0.1, 4)], 3: [band(0.1, 4)] }
  const anchors = [
    anc(0.5, 1, 0.15, 0.15), anc(1.5, 1, 0.15, 0.35), anc(2.5, 1, 0.15, 0.55), anc(3.5, 1, 0.15, 0.75),
    anc(8.5, 3, 0.15, 0.15), anc(9.5, 3, 0.15, 0.35), anc(10.5, 3, 0.15, 0.55), // silent page 2 between
  ]
  const model = buildTimingModel(anchors, bands)!
  const seg = resolveScrollSegment(model, 6.0)! // mid-gap, t=3.5..8.5
  check('gap segment bridges the bracketing anchors’ systems', seg.startSystem === 0 && seg.endSystem === 2, `start=${seg.startSystem} end=${seg.endSystem}`)
  check('gap blend is the TIME fraction (constant pixel velocity)', Math.abs(seg.blend - (6.0 - 3.5) / (8.5 - 3.5)) < 1e-9, `blend=${seg.blend.toFixed(3)}`)
  const d1 = resolveScrollSegment(model, 5.5)!.blend - resolveScrollSegment(model, 4.5)!.blend
  const d2 = resolveScrollSegment(model, 7.5)!.blend - resolveScrollSegment(model, 6.5)!.blend
  check('equal time steps → equal blend steps across the gap', Math.abs(d1 - d2) < 1e-9, `d1=${d1.toFixed(3)} d2=${d2.toFixed(3)}`)
  // Steady outro: glide to the final system at the measured tempo (since the model is steady)
  const last = model.samples[model.samples.length - 1]
  const outroSteady = resolveScrollSegment(model, 12)!
  check('steady outro glides toward the final system', outroSteady.startSystem <= outroSteady.endSystem && outroSteady.endSystem === model.systems.length - 1, `start=${outroSteady.startSystem} end=${outroSteady.endSystem}`)
  check('steady outro blend advances over time', resolveScrollSegment(model, 15)!.blend > outroSteady.blend, `blend@12=${outroSteady.blend.toFixed(2)} blend@15=${resolveScrollSegment(model, 15)!.blend.toFixed(2)}`)
  check('steady outro blend is clamped at 1 (reaches the end)', resolveScrollSegment(model, 999)!.blend === 1)
}

// Intro: one steady sweep from the top of the score to the first sung system, when the
// intro reads steady; otherwise yield (null) so the user scrolls.
{
  const bands = { 1: [band(0.1, 4)], 2: [band(0.1, 4)] }
  const anchors = [anc(8.5, 2, 0.15, 0.15), anc(9.5, 2, 0.15, 0.35), anc(10.5, 2, 0.15, 0.55)]
  const beatSteady = { tempo: 120, beatTimes: [], pulseClarity: 0.9, clarityWindows: [{ t: 0, clarity: 0.9 }, { t: 8, clarity: 0.9 }] }
  const steady = buildTimingModel(anchors, bands, beatSteady)!
  const seg = resolveScrollSegment(steady, 4.25)! // halfway through the intro
  check('intro sweeps top system → first sung system', seg.startSystem === 0 && seg.endSystem === systemIndexForMeasure(steady, steady.samples[0].mu))
  check('intro blend is linear in time', Math.abs(seg.blend - 4.25 / 8.5) < 1e-9, `blend=${seg.blend.toFixed(3)}`)

  const beatRubato = { tempo: 80, beatTimes: [], pulseClarity: 0.2, clarityWindows: [{ t: 0, clarity: 0.2 }] }
  const rubato = buildTimingModel(anchors, bands, beatRubato)!
  check('low-confidence intro yields (null)', resolveScrollSegment(rubato, 4) === null)
  // Rubato outro: hold on the last sung system (don't blindly extrapolate when tempo is unreliable)
  const outroRubato = resolveScrollSegment(rubato, 50)!
  const lastRubato = rubato.samples[rubato.samples.length - 1]
  const lastSysRubato = systemIndexForMeasure(rubato, lastRubato.mu)
  check('rubato outro holds on the last sung system (no blind extrapolation)', outroRubato.startSystem === lastSysRubato && outroRubato.endSystem === lastSysRubato && outroRubato.blend === 0)
}

// PROOF that a scroll offset is an anchor-TIME error, not an engine/playback desync:
// the scroll is a deterministic function of anchor times — at every anchor's timestamp
// the scroll sits exactly on that anchor's system. So if Whisper stamps a correctly-
// positioned word early, the scroll reaches that correct position early, by the same
// delta. The alignment (word → page/y) is untouched; only the time is wrong.
{
  const bands = { 1: [band(0.1, 4)], 2: [band(0.1, 4)], 3: [band(0.1, 4)] }
  const anchors = [
    anc(1, 1, 0.15, 0.2), anc(2, 1, 0.15, 0.6),
    anc(3, 2, 0.15, 0.2), anc(4, 2, 0.15, 0.6),
    anc(5, 3, 0.15, 0.2), anc(6, 3, 0.15, 0.6),
  ]
  const model = buildTimingModel(anchors, bands)!
  let faithful = true
  let detail = ''
  for (const s of model.samples) {
    const seg = resolveScrollSegment(model, s.time)!
    const effSystem = seg.startSystem + seg.blend * (seg.endSystem - seg.startSystem)
    const want = systemIndexForMeasure(model, s.mu)
    if (Math.abs(effSystem - want) > 1e-6) { faithful = false; detail = `t=${s.time} got ${effSystem.toFixed(2)} want ${want}` }
  }
  check('scroll sits exactly on each anchor’s system at its timestamp (engine faithful to anchor TIMES)', faithful, detail)
  // Same positions, but the page-3 line stamped 1s EARLIER → the scroll reaches page 3
  // exactly 1s sooner. The offset equals the timestamp error.
  const early = anchors.map((a) => (a.page === 3 ? { ...a, time: a.time - 1 } : a))
  const earlyModel = buildTimingModel(early, bands)!
  const sysAt = (m: typeof model, t: number) => { const s = resolveScrollSegment(m, t)!; return s.startSystem + s.blend * (s.endSystem - s.startSystem) }
  check('a 1s-early timestamp puts the scroll ~1s ahead at the same playback time',
    sysAt(earlyModel, 4) > sysAt(model, 4) + 0.5, `early@4=${sysAt(earlyModel, 4).toFixed(2)} base@4=${sysAt(model, 4).toFixed(2)}`)
}

// No anchors / no bands → null (caller falls back to manual).
check('null with no anchors', buildTimingModel([], { 1: [band(0.1, 4)] }) === null)
check('null with no bands', buildTimingModel([anc(1, 1, 0.15, 0.15)], {}) === null)

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURES'}`)
process.exit(failures === 0 ? 0 : 1)
