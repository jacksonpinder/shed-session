/**
 * Timing model: turn sparse anchors into a continuous time → score-position map.
 *
 * The trick is a single global **measure axis**. Every system across every page
 * is laid end to end and given a cumulative measure offset (system 0 = measures
 * [0, m0), system 1 = [m0, m0+m1), …), using the geometric measure counts from
 * detectSystems. Each anchor maps to a fractional measure coordinate `mu` on that
 * axis (its system's offset + where its x falls between barlines). That gives a
 * set of (time, mu) samples; resolving an arbitrary time linearly interpolates mu
 * between the bracketing samples and converts back to a position.
 *
 * Why measures, not systems or words: systems hold wildly different measure counts
 * (3 vs 7), and held notes mean word density says nothing about duration — but a
 * measure is ~one unit of musical time. Interpolating in measure space therefore
 * fills the gaps (a system with zero matched words still gets scrolled to at the
 * right time, because `mu` passes through its measure range) and is robust to held
 * notes. `tempoStability` flags how steady the piece is so the caller can distrust
 * long interpolations through rubato.
 *
 * Pure (no DOM) → unit-testable. Before the first anchor / after the last it holds
 * position (the intro/outro have no alignable lyrics).
 */

import type { Anchor } from './syncMap.ts'
import type { BeatAnalysis } from './transcribe.ts'
import { bandForY, type SystemBand } from './detectSystems.ts'

export type TimingSystem = {
  page: number
  band: SystemBand
  /** Measures in this system (≥1). */
  measureCount: number
  /** Cumulative measures before this system on the global measure axis. */
  measureOffset: number
}

export type TimingModel = {
  systems: TimingSystem[]
  totalMeasures: number
  /** (time, measure) samples from anchors, sorted by time, monotonic in measure. */
  samples: { time: number; mu: number }[]
  /**
   * 0…1: how steady the tempo is (1 = metronomic, low = rubato). Blends the
   * anchor-spacing estimate with the audio pulse clarity when beat data is given.
   */
  tempoStability: number
  /** Audio-derived pulse clarity 0…1, when beat analysis was supplied. */
  pulseClarity?: number
  /** The intro (before the first anchor) reads as steady ⇒ blind pre-roll scroll. */
  introSteady: boolean
  /**
   * Robust measures/second from close anchor pairs — the measured "average measure
   * duration". Keeps the scroll moving at tempo through lyric-less gaps and the outro,
   * instead of stalling on a straight chord between two sparse, possibly-noisy anchors.
   */
  measuresPerSecond: number
}

export type TimedPosition = {
  page: number
  /** System top, for scrolling (matches SheetPosition.yWithinPageRatio). */
  yWithinPageRatio: number
  /** Where along the system the time falls, if barlines are known. */
  xWithinPageRatio?: number
  /** Global measure coordinate. */
  measure: number
  systemIndex: number
  /**
   * Progress through the current system, 0 (its first barline) … 1 (its last).
   * Drives the auto-scroll's linear ramp toward the next system — and it comes from
   * the measure axis (time), not horizontal pixels, so uneven note spacing doesn't
   * distort scroll speed.
   */
  fractionThroughSystem: number
  /** True when the time fell between anchors (interpolated, not on an anchor). */
  interpolated: boolean
  /** 0…1: lower for long interpolations through unsteady tempo. */
  confidence: number
}

// ── Debug ─────────────────────────────────────────────────────────────────────
/** Set to true to emit [SyncModel] console logs — model stats on build + gap
 * details on entry. Matches DEBUG_LOOP_BG pattern. */
const DEBUG_SYNC = false

// ── Tunables ─────────────────────────────────────────────────────────────────
/** Anchor pairs closer than this (s) define the local-tempo estimate (not gap chords). */
const CLOSE_DT = 3
/** Drop a sample only if its slope deviates from the global rate by >this on BOTH sides. */
const OUTLIER_RATIO = 3
/** tempoStability at/above which we blind-extrapolate past the last anchor (the outro). */
const OUTRO_STEADY = 0.6
/** Confidence (medium) at/above which we best-guess the lyric-less intro instead of
 * yielding to manual scroll. Low bar on purpose: a manual scroll always overrides the
 * pre-roll, so a wrong guess costs the user one gesture, while a right one saves it. */
const INTRO_CONF = 0.4

const clampUnit = (x: number): number => Math.min(Math.max(x, 0), 1)

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0
  const sorted = [...xs].sort((a, b) => a - b)
  const m = sorted.length >> 1
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2
}

/** Robust measures/second from CLOSE consecutive pairs (true local tempo, outlier-proof). */
const globalMeasureRate = (samples: { time: number; mu: number }[]): number => {
  const close: number[] = []
  const all: number[] = []
  for (let i = 1; i < samples.length; i += 1) {
    const dt = samples[i].time - samples[i - 1].time
    const dmu = samples[i].mu - samples[i - 1].mu
    if (dt > 1e-3 && dmu > 1e-6) {
      const slope = dmu / dt
      all.push(slope)
      if (dt <= CLOSE_DT) close.push(slope)
    }
  }
  return median(close.length >= 3 ? close : all)
}

/** Lay all systems end to end on one measure axis (reading order: page, then top→bottom). */
const buildSystems = (bandsByPage: Record<number, SystemBand[]>): TimingSystem[] => {
  const systems: TimingSystem[] = []
  let offset = 0
  for (const page of Object.keys(bandsByPage).map(Number).sort((a, b) => a - b)) {
    for (const band of bandsByPage[page]) {
      const measureCount = band.measureCount && band.measureCount > 0 ? band.measureCount : 1
      systems.push({ page, band, measureCount, measureOffset: offset })
      offset += measureCount
    }
  }
  return systems
}

/** Map one anchor to its global measure coordinate, using barlines when present. */
const anchorMeasure = (anchor: Anchor, systems: TimingSystem[]): number | null => {
  const onPage = systems.filter((s) => s.page === anchor.page)
  if (onPage.length === 0) return null
  const band = bandForY(onPage.map((s) => s.band), anchor.yWithinPageRatio)
  const sys = onPage.find((s) => s.band === band) ?? onPage[0]
  const bl = sys.band.barlineXRatios
  let within: number
  if (anchor.xWithinPageRatio != null && bl && bl.length >= 2) {
    const x = Math.min(Math.max(anchor.xWithinPageRatio, bl[0]), bl[bl.length - 1])
    let k = 0
    while (k < bl.length - 2 && x > bl[k + 1]) k += 1
    const seg = bl[k + 1] - bl[k]
    within = k + (seg > 1e-9 ? (x - bl[k]) / seg : 0)
  } else {
    within = sys.measureCount / 2 // no x → assume mid-system
  }
  return sys.measureOffset + within
}

/**
 * Build the timing model from anchors and the per-page system bands (with measure
 * counts from detectSystems). Returns null when there's nothing to model.
 */
export function buildTimingModel(
  anchors: Anchor[],
  bandsByPage: Record<number, SystemBand[]>,
  beat?: BeatAnalysis
): TimingModel | null {
  const systems = buildSystems(bandsByPage)
  if (systems.length === 0 || anchors.length === 0) return null
  const totalMeasures = systems[systems.length - 1].measureOffset + systems[systems.length - 1].measureCount

  // Raw (time, measure) per anchor, in time order, de-duped on identical times.
  const raw: { time: number; mu: number }[] = []
  for (const anchor of [...anchors].sort((a, b) => a.time - b.time)) {
    const mu = anchorMeasure(anchor, systems)
    if (mu == null) continue
    const prev = raw[raw.length - 1]
    if (prev && Math.abs(prev.time - anchor.time) < 1e-6) prev.mu = Math.max(prev.mu, mu)
    else raw.push({ time: anchor.time, mu })
  }
  if (raw.length === 0) return null

  // Drop anchors that are clearly mis-detected — inconsistent with the measured rate on
  // BOTH sides. A one-sided surprise (a fermata or a stray meter change) stays put, since
  // lyrics are ground truth for position; only a both-sides outlier is a bad detection.
  const provisionalRate = globalMeasureRate(raw)
  const kept = raw.filter((_, i) => {
    if (i === 0 || i === raw.length - 1 || provisionalRate <= 1e-9) return true
    const inSlope = (raw[i].mu - raw[i - 1].mu) / (raw[i].time - raw[i - 1].time)
    const outSlope = (raw[i + 1].mu - raw[i].mu) / (raw[i + 1].time - raw[i].time)
    const bad = (sl: number) => sl <= provisionalRate / OUTLIER_RATIO || sl >= provisionalRate * OUTLIER_RATIO
    return !(bad(inSlope) && bad(outSlope))
  })

  // Enforce a non-decreasing measure axis on the surviving anchors.
  // Anchors whose clamped mu doesn't advance (misalignments landing *behind* the
  // previous position in the score) are excluded. They'd create zero-measure flat
  // segments that freeze interpolation and inject huge catch-up slopes into the
  // variance, collapsing tempoStability to 0.
  const samples: { time: number; mu: number }[] = []
  let lastMu = -Infinity
  for (const s of kept) {
    const monotonicMu = Math.max(s.mu, lastMu)
    if (monotonicMu > lastMu) {
      samples.push({ time: s.time, mu: monotonicMu })
      lastMu = monotonicMu
    }
  }
  if (samples.length === 0) return null

  // Tempo stability = inverse *robust* coefficient of variation of local slopes
  // (measures/second) over CLOSE consecutive pairs — the same outlier-proof basis the
  // measure rate uses. Steady ⇒ slopes cluster ⇒ near 1; rubato ⇒ spread ⇒ near 0.
  // Median + MAD (not mean/std) on purpose: a single near-coincident anchor pair makes
  // one enormous slope that std/mean would let tank the whole estimate to 0 even on a
  // dead-steady piece (observed live: clean mps=1.19 but stability=0.00). MAD shrugs it
  // off exactly as the median rate does, so the intro pre-roll fires when it should.
  const slopes: number[] = []
  for (let i = 1; i < samples.length; i += 1) {
    const dt = samples[i].time - samples[i - 1].time
    const dmu = samples[i].mu - samples[i - 1].mu
    if (dt > 1e-3 && dt <= CLOSE_DT && dmu > 1e-6) slopes.push(dmu / dt)
  }
  let anchorStability = 1
  if (slopes.length >= 3) {
    const med = median(slopes)
    const mad = median(slopes.map((s) => Math.abs(s - med)))
    // 1.4826·MAD ≈ σ for a normal distribution → a robust coefficient of variation.
    const robustCv = med > 1e-9 ? (1.4826 * mad) / med : 1
    anchorStability = Math.max(0, Math.min(1, 1 - robustCv))
  }

  // The audio's pulse clarity is independent of (and steadier than) the sparse
  // anchor estimate, so weight it more when present.
  const pulseClarity = beat?.pulseClarity
  const tempoStability =
    pulseClarity != null ? 0.4 * anchorStability + 0.6 * pulseClarity : anchorStability

  // Intro = audio before the first anchor. With medium+ confidence we best-guess it
  // (pre-roll at the measured rate); below that we hold and let the user scroll. Prefer
  // the beat windows covering the intro, then the global pulse clarity, and finally the
  // anchor-derived steadiness — so a steady piece with no beat data still pre-rolls.
  const time0 = samples[0].time
  let introClarity = pulseClarity ?? tempoStability
  const introWindows = beat?.clarityWindows?.filter((w) => w.t < time0) ?? []
  if (introWindows.length) {
    introClarity = introWindows.reduce((a, w) => a + w.clarity, 0) / introWindows.length
  }
  const introSteady = introClarity >= INTRO_CONF

  const mps = globalMeasureRate(samples)
  if (DEBUG_SYNC) {
    console.warn(
      `[SyncModel] built: ${samples.length} samples, totalMeasures=${totalMeasures}, ` +
      `mps=${mps.toFixed(4)}, stability=${tempoStability.toFixed(2)}, ` +
      `introSteady=${introSteady}, hasBeat=${!!beat?.beatTimes?.length}, ` +
      `rawKept=${raw.length}→${kept.length}→${samples.length}`
    )
  }
  return {
    systems,
    totalMeasures,
    samples,
    tempoStability,
    pulseClarity,
    introSteady,
    measuresPerSecond: mps,
  }
}

/** Index of the system that contains measure μ (clamped to the last system). */
export function systemIndexForMeasure(model: TimingModel, mu: number): number {
  const i = model.systems.findIndex((sys) => mu < sys.measureOffset + sys.measureCount)
  return i < 0 ? model.systems.length - 1 : i
}

/**
 * Scroll target as constant-PIXEL-velocity interpolation between sync points: the two
 * bracketing anchors' SYSTEMS and the time-fraction between them. The follow loop lerps
 * the two systems' doc-Y by this fraction, so a lyric-less stretch (intro / instrumental
 * spanning several systems and page breaks) is one steady glide — no per-system or
 * per-page "pulse" — and each segment still lands exactly on its anchor's system.
 * Returns null during a low-confidence intro (caller yields to manual scroll).
 */
export function resolveScrollSegment(
  model: TimingModel,
  time: number
): { startSystem: number; endSystem: number; blend: number } | null {
  const s = model.samples
  if (s.length === 0) return null
  const last = s[s.length - 1]
  if (time <= s[0].time) {
    // Intro: glide from the top of the score to the first sung system, unless the intro
    // is too unsteady to trust (then yield). One straight pixel sweep over the intro.
    if (!model.introSteady || s[0].time <= 1e-6) return null
    return { startSystem: 0, endSystem: systemIndexForMeasure(model, s[0].mu), blend: clampUnit(time / s[0].time) }
  }
  if (time >= last.time) {
    // Outro: if tempo is steady, glide to the end of the score at the measured rate.
    // Otherwise hold on the last system (for rubato/free passages where tempo is unreliable).
    if (model.tempoStability >= OUTRO_STEADY && model.measuresPerSecond > 1e-6) {
      const dt = time - last.time
      const measuresLeft = model.totalMeasures - last.mu
      const timeToEnd = measuresLeft / model.measuresPerSecond
      // Blend from last system toward final system, clamped to 0..1 (reach the end and stay there).
      const blend = clampUnit(dt / timeToEnd)
      return {
        startSystem: systemIndexForMeasure(model, last.mu),
        endSystem: systemIndexForMeasure(model, model.totalMeasures),
        blend,
      }
    }
    // Rubato outro: hold on the last sung system.
    const sys = systemIndexForMeasure(model, last.mu)
    return { startSystem: sys, endSystem: sys, blend: 0 }
  }
  let lo = 0
  let hi = s.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (s[mid].time <= time) lo = mid
    else hi = mid - 1
  }
  const span = s[lo + 1].time - s[lo].time
  return {
    startSystem: systemIndexForMeasure(model, s[lo].mu),
    endSystem: systemIndexForMeasure(model, s[lo + 1].mu),
    blend: span > 1e-6 ? clampUnit((time - s[lo].time) / span) : 0,
  }
}

/** Resolve a time to a position via measure-space interpolation. */
export function resolveTimedPosition(model: TimingModel, time: number): TimedPosition | null {
  const s = model.samples
  if (s.length === 0) return null

  let mu: number
  let interpolated = false
  let gapMeasures = 0
  if (time <= s[0].time) {
    if (model.introSteady && s[0].time > 1e-6) {
      // Steady intro: blind-scroll measures 0 → first-anchor measure over the intro.
      mu = s[0].mu * Math.max(0, time / s[0].time)
      interpolated = true
    } else {
      return null // rubato/unknown intro: yield to manual scroll
    }
  } else if (time >= s[s.length - 1].time) {
    // Outro: keep scrolling at the measured rate when the tempo is steady enough to
    // trust blind motion (clamped to the score end below); otherwise hold (as before).
    const last = s[s.length - 1]
    if (model.measuresPerSecond > 1e-9 && model.tempoStability >= OUTRO_STEADY) {
      mu = last.mu + model.measuresPerSecond * (time - last.time)
      interpolated = true
    } else {
      mu = last.mu
    }
  } else {
    let lo = 0
    let hi = s.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (s[mid].time <= time) lo = mid
      else hi = mid - 1
    }
    const a = s[lo]
    const b = s[lo + 1]
    gapMeasures = b.mu - a.mu
    // Straight line between the two bracketing anchors: constant speed across the gap,
    // exact landing on each anchor. Lyrics are ground truth for position, so the most
    // honest interior is the one that tracks the elapsed fraction of the gap — no tempo
    // "leading ahead" of the audio (which read as the scroll racing past the sung line)
    // and no within-gap accel/decel. Mis-timed anchors are handled upstream by the
    // outlier + backward-sample filtering, not by reshaping the motion here.
    const span = b.time - a.time
    mu = a.mu + (span > 1e-9 ? (time - a.time) / span : 0) * gapMeasures
    interpolated = true
  }

  mu = Math.min(Math.max(mu, 0), model.totalMeasures)
  let si = model.systems.findIndex((sys) => mu < sys.measureOffset + sys.measureCount)
  if (si < 0) si = model.systems.length - 1
  const sys = model.systems[si]
  const within = Math.min(Math.max(mu - sys.measureOffset, 0), sys.measureCount)

  let xWithinPageRatio: number | undefined
  const bl = sys.band.barlineXRatios
  if (bl && bl.length >= 2) {
    const k = Math.min(Math.floor(within), bl.length - 2)
    const frac = within - k
    xWithinPageRatio = bl[k] + frac * (bl[k + 1] - bl[k])
  }

  // Trust drops for long interpolations across an unsteady tempo, so a murky gap lowers
  // confidence → the sung line sits lower in the viewport (safety).
  const gapPenalty = interpolated ? Math.min(1, gapMeasures / 4) * (1 - model.tempoStability) : 0
  const confidence = Math.max(0, 1 - gapPenalty)

  return {
    page: sys.page,
    yWithinPageRatio: sys.band.topRatio,
    xWithinPageRatio,
    measure: mu,
    systemIndex: si,
    fractionThroughSystem: sys.measureCount > 0 ? within / sys.measureCount : 0,
    interpolated,
    confidence,
  }
}
