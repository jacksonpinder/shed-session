/**
 * Pure motion math for the playback auto-scroll. Kept DOM-free so it's
 * unit-testable and the scroll "feel" lives in one tunable block. The impure
 * parts (the rAF loop, reading/writing scrollTop, gesture detection) live in
 * PDFViewer.startPlayheadFollow; the musical "where are we" part lives in
 * timingModel.resolveTimedPosition and PlayerDock's follow effect.
 *
 * The driver keeps a continuous "system-progress" anchor — the top of the system
 * being played, ramped LINEARLY toward the next system's top as the music crosses
 * the current one — pinned at an adaptive fraction down the viewport. With ~3 systems
 * on screen and the anchor at ~1/3, playing system 2 shows {1,2,3} at its start and
 * {2,3,4} by its end. The ramp is a straight line in musical progress → constant
 * scroll velocity (the rAF easing only softens frame-to-frame steps), which reads far
 * easier than any speed-up/slow-down within a system.
 */

// ── Tunables (one block) ─────────────────────────────────────────────────────
/** Viewport fraction for the playing system's top when sync is confident (max look-ahead).
 * ~0.4 keeps the playing system centred-high so its LAST measures keep clear headroom
 * below (a lower value pins it too high and the bar being sung skims the top edge). */
export const BASE_FRACTION = 0.4
/** Viewport fraction when confidence is low — sung line sits lower, never ahead of the audio. */
export const SAFE_FRACTION = 0.52
/** Hard cap on the anchor fraction (keeps some look-ahead even for tall systems). */
export const MAX_FRACTION = 0.55
/** Per-frame easing toward the target scrollTop (higher = snappier, lower = smoother). */
export const EASE = 0.15
/** Hard floor on how fast the scroll may advance: it never crosses a system in less than
 * this many seconds. Normal reading speed (a system every ~2–3 s) is well under the cap,
 * so it's unaffected; a sudden multi-system LURCH (mistimed-early anchors) is spread into
 * a steady glide that tracks the real tempo — the sung measure never flies off the top. */
export const MIN_SECONDS_PER_SYSTEM = 0.7
/** After a manual scroll gesture, suspend following for this long. */
export const USER_QUIET_MS = 1200
/** Audio-time drop (s) that counts as a backward seek (loop wrap / scrub back). */
export const SEEK_BACK_S = 0.05
/** Audio-time jump (s) that counts as a forward seek (skip button / scrub ahead). */
export const SEEK_FWD_S = 1

export const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi)

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

/**
 * Cap a forward (downward) scroll step so the view can't cross a whole system in less
 * than MIN_SECONDS_PER_SYSTEM — turning a multi-system lurch into a steady glide while
 * leaving normal, slower motion untouched. `systemPx` is the current system's pixel
 * height; `dtSec` is the frame duration. Only forward steps are capped (the eased
 * approach handles settling); backward/zero steps pass through unchanged.
 */
export const cappedScrollStep = (step: number, systemPx: number, dtSec: number): number => {
  if (step <= 0 || systemPx <= 0 || dtSec <= 0) return step
  const maxStep = (systemPx / MIN_SECONDS_PER_SYSTEM) * dtSec
  return Math.min(step, maxStep)
}

/**
 * The viewport fraction at which to pin the current system's top. Confident sync →
 * BASE_FRACTION (upper third, most look-ahead); low confidence → toward SAFE_FRACTION
 * (lower, so we never scroll ahead of the singing). Never less than the system's own
 * height fraction (so the whole current system stays on screen), and capped at
 * MAX_FRACTION so there's always some look-ahead.
 */
export const adaptiveAnchorFraction = (confidence: number, systemHeightFraction: number): number => {
  const byConfidence = lerp(BASE_FRACTION, SAFE_FRACTION, 1 - clamp(confidence, 0, 1))
  return clamp(Math.max(byConfidence, systemHeightFraction), BASE_FRACTION, MAX_FRACTION)
}

/** Follow-loop carry-over: the running-max scroll target and the last audio time. */
export type FollowState = { maxTarget: number | null; lastTime: number | null }

/**
 * Decide the follow loop's next scroll target. Forward playback is kept MONOTONIC
 * (the target never decreases) so the per-frame wobble in the anchor fraction — and
 * any page-layout reflow — can't read as an up/down jitter. A real seek, detected by
 * a jump in AUDIO TIME (not pixels, so even a short loop wrap counts), resets the
 * ratchet so loops/skips reposition freely. `rawTarget` should already be clamped to
 * the scrollable range. Pure → unit-tested.
 *
 * `seeked` (caller snaps instantly when true) fires ONLY on a genuine audio-time
 * jump — never on a cold start. A cold start (`lastTime == null`: first frame, or
 * the first frame after the loop idled through a lyric-less intro or a manual
 * gesture) takes `rawTarget` as the ratchet baseline but is NOT a seek, so the
 * caller eases toward it. That's the difference between gliding onto the first sung
 * line and teleporting to it.
 */
export const advanceFollowTarget = (
  rawTarget: number,
  time: number,
  state: FollowState
): { target: number; seeked: boolean; state: FollowState } => {
  const { maxTarget, lastTime } = state
  const coldStart = lastTime == null
  // A real seek is a discontinuity in audio time — only detectable once we have a
  // prior time to compare against. Cold starts ease in instead of snapping.
  const seeked = !coldStart && (time < lastTime - SEEK_BACK_S || time > lastTime + SEEK_FWD_S)
  const target = seeked || maxTarget == null ? rawTarget : Math.max(rawTarget, maxTarget)
  return { target, seeked, state: { maxTarget: target, lastTime: time } }
}
