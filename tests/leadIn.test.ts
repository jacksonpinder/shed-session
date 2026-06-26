// Pure-core tests for the lead-in detector. The decode step needs Web Audio, so we
// test the envelope + cross-correlation math directly with synthetic data.
import { computeOnsetEnvelope, correlateOffsetFrames } from '../src/lib/leadIn.ts'

let failures = 0
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
  if (!cond) failures += 1
}

// --- onset envelope: a silence→loud transition produces a positive onset frame ---
{
  const hop = 128
  const samples = new Float32Array(hop * 10)
  for (let i = hop * 5; i < samples.length; i++) samples[i] = 0.5 // burst at frame 5
  const env = computeOnsetEnvelope(samples, hop)
  const peakFrame = env.indexOf(Math.max(...env))
  check('onset envelope peaks at the burst onset', peakFrame === 4 || peakFrame === 5, `peak@${peakFrame}`)
  check('envelope is half-wave rectified (no negatives)', env.every((v) => v >= 0))
}

// --- cross-correlation recovers a known frame delay ---
const makeEnv = (n: number, seed = 1) => {
  // deterministic pseudo-random sparse impulse envelope
  const env = new Float32Array(n)
  let s = seed
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    env[i] = (s % 100) < 12 ? (s % 1000) / 1000 : 0 // ~12% impulses
  }
  return env
}
const delay = (env: Float32Array, k: number) => {
  const out = new Float32Array(env.length + k)
  for (let i = 0; i < env.length; i++) out[i + k] = env[i]
  return out
}

{
  const ref = makeEnv(1800)
  for (const k of [0, 30, 125, 400]) {
    const track = delay(ref, k)
    const { lagFrames, confidence } = correlateOffsetFrames(ref, track, -10, 800)
    check(`recovers delay of ${k} frames`, lagFrames === k, `got ${lagFrames}, conf ${confidence.toFixed(3)}`)
    check(`high confidence for clean delay ${k}`, confidence > 0.9, `conf ${confidence.toFixed(3)}`)
  }
}

// --- amplitude scaling (different mix level) must not change the detected lag ---
{
  const ref = makeEnv(1800, 7)
  const scaled = ref.map((v) => v * 0.25) as Float32Array
  const track = delay(scaled, 96)
  const { lagFrames } = correlateOffsetFrames(ref, track, -10, 400)
  check('lag is invariant to amplitude scaling', lagFrames === 96, `got ${lagFrames}`)
}

// --- uncorrelated signals yield low confidence ---
{
  const ref = makeEnv(1800, 3)
  const noise = makeEnv(1800, 999)
  const { confidence } = correlateOffsetFrames(ref, noise, -50, 50)
  check('uncorrelated envelopes give low confidence', confidence < 0.5, `conf ${confidence.toFixed(3)}`)
}

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURES'}`)
process.exit(failures === 0 ? 0 : 1)
