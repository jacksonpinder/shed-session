/**
 * Lead-in offset detection. Every track of a song is the SAME performance (just a
 * different mix / intro), so a non-reference track's timeline differs from the
 * reference only by a constant lead-in (a spoken part name + tuning pitch before
 * the music). We recover that constant by cross-correlating onset envelopes of the
 * first ~30s of each — no transcription, no sidecar, runs client-side in ms.
 *
 * Convention: song-time == reference-time. For a track whose music starts Δ seconds
 * later than the reference's, `leadInOffset = Δ` and song-time = track-time − Δ.
 *
 * The decode step (Web Audio) is split from the pure envelope/correlation math so
 * the core is unit-testable under Node (no OfflineAudioContext there).
 */

const SAMPLE_RATE = 8000
const HOP = 128 // ~16 ms/frame at 8 kHz
const WINDOW_SEC = 30
const MIN_LAG_SEC = -2
const MAX_LAG_SEC = 25
const MIN_CONFIDENCE = 0.3

export type LeadInResult = {
  /** Seconds the track's music is delayed vs the reference (≥0 typically). */
  offsetSec: number
  /** Peak normalized correlation 0…1; low ⇒ untrustworthy, treat as 0. */
  confidence: number
}

/**
 * Half-wave-rectified frame-energy difference — a cheap onset envelope. Timing of
 * note attacks is shared across mixes even when the spectral balance differs, so
 * this correlates well between a full mix and a part-predominant track.
 */
export function computeOnsetEnvelope(samples: Float32Array, hop = HOP): Float32Array {
  const frames = Math.max(0, Math.floor((samples.length - hop) / hop))
  const env = new Float32Array(frames)
  let prevEnergy = 0
  for (let f = 0; f < frames; f++) {
    let energy = 0
    const base = f * hop
    for (let i = 0; i < hop; i++) {
      const s = samples[base + i]
      energy += s * s
    }
    env[f] = Math.max(0, energy - prevEnergy)
    prevEnergy = energy
  }
  return env
}

/**
 * Normalized (Pearson) cross-correlation of two envelopes over a bounded lag range.
 * Returns the lag (in frames) where `track[i] ≈ ref[i − lag]` is strongest, i.e. how
 * many frames the track is delayed relative to the reference. Pearson per-lag makes
 * it invariant to the amplitude/level differences between mixes.
 */
export function correlateOffsetFrames(
  ref: Float32Array,
  track: Float32Array,
  minLag: number,
  maxLag: number
): { lagFrames: number; confidence: number } {
  let bestLag = 0
  let bestCorr = -Infinity
  for (let lag = minLag; lag <= maxLag; lag++) {
    // Overlap where both ref[i-lag] and track[i] are valid.
    const iStart = Math.max(0, lag)
    const iEnd = Math.min(track.length, ref.length + lag)
    const n = iEnd - iStart
    if (n < 16) continue

    let sumA = 0
    let sumB = 0
    for (let i = iStart; i < iEnd; i++) {
      sumA += ref[i - lag]
      sumB += track[i]
    }
    const meanA = sumA / n
    const meanB = sumB / n

    let num = 0
    let denA = 0
    let denB = 0
    for (let i = iStart; i < iEnd; i++) {
      const a = ref[i - lag] - meanA
      const b = track[i] - meanB
      num += a * b
      denA += a * a
      denB += b * b
    }
    const denom = Math.sqrt(denA * denB)
    if (denom <= 0) continue
    const corr = num / denom
    if (corr > bestCorr) {
      bestCorr = corr
      bestLag = lag
    }
  }
  return { lagFrames: bestLag, confidence: bestCorr === -Infinity ? 0 : bestCorr }
}

/** Decode the first `maxSec` of a blob to mono Float32 at `sampleRate`. Browser-only. */
async function decodeMono(blob: Blob, sampleRate: number, maxSec: number): Promise<Float32Array> {
  const arrayBuffer = await blob.arrayBuffer()
  const Ctx =
    (typeof window !== 'undefined' && (window.OfflineAudioContext ||
      (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext))
  if (!Ctx) throw new Error('OfflineAudioContext unavailable')
  const ctx = new Ctx(1, 1, sampleRate)
  const buf = await ctx.decodeAudioData(arrayBuffer) // resampled to ctx.sampleRate
  const ch0 = buf.getChannelData(0)
  let mono: Float32Array = ch0
  if (buf.numberOfChannels > 1) {
    const ch1 = buf.getChannelData(1)
    mono = new Float32Array(ch0.length)
    for (let i = 0; i < ch0.length; i++) mono[i] = 0.5 * (ch0[i] + ch1[i])
  }
  const maxSamples = Math.min(mono.length, Math.floor(maxSec * sampleRate))
  return mono.subarray(0, maxSamples)
}

/**
 * Detect a track's lead-in offset (seconds) relative to the reference track. Returns
 * `{ offsetSec: 0, confidence }` when correlation is too weak to trust (caller can
 * fall back to a manual offset). Both args are the audio blobs.
 */
export async function detectLeadInOffset(
  referenceBlob: Blob,
  trackBlob: Blob,
  opts: { windowSec?: number; minLagSec?: number; maxLagSec?: number } = {}
): Promise<LeadInResult> {
  const windowSec = opts.windowSec ?? WINDOW_SEC
  const [refSamples, trackSamples] = await Promise.all([
    decodeMono(referenceBlob, SAMPLE_RATE, windowSec),
    decodeMono(trackBlob, SAMPLE_RATE, windowSec),
  ])
  const refEnv = computeOnsetEnvelope(refSamples)
  const trackEnv = computeOnsetEnvelope(trackSamples)

  const hopSec = HOP / SAMPLE_RATE
  const minLag = Math.round((opts.minLagSec ?? MIN_LAG_SEC) / hopSec)
  const maxLag = Math.round((opts.maxLagSec ?? MAX_LAG_SEC) / hopSec)
  const { lagFrames, confidence } = correlateOffsetFrames(refEnv, trackEnv, minLag, maxLag)

  if (confidence < MIN_CONFIDENCE) return { offsetSec: 0, confidence }
  return { offsetSec: lagFrames * hopSec, confidence }
}
