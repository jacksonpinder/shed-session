/**
 * Client for the Whisper sidecar (see `sidecar/`). Sends audio, gets word-level
 * timestamps back. The base URL defaults to localhost and can be overridden with
 * the `VITE_WHISPER_URL` env var for a deployed sidecar.
 */

/** One transcribed word with its time span (seconds). */
export type Word = {
  text: string
  start: number
  end: number
  confidence: number
}

/** Beat/tempo analysis of the recording (sidecar #4). Optional — older caches
 * and analysis failures simply omit it. */
export type BeatAnalysis = {
  /** Estimated global tempo, BPM. */
  tempo: number
  /** Beat onset times, seconds. */
  beatTimes: number[]
  /** Global pulse clarity 0…1 (1 = metronomic, low = rubato/free). */
  pulseClarity: number
  /** Pulse clarity in ~8 s windows, so a rubato intro that hops into tempo shows up. */
  clarityWindows: { t: number; clarity: number }[]
}

export type Transcription = {
  words: Word[]
  language: string
  duration: number
  /** Beat/tempo analysis, when the sidecar produced it. */
  beat?: BeatAnalysis
  /** sha256 of the audio, for caching the resulting sync map. */
  sourceHash: string
}

const WHISPER_URL =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_WHISPER_URL) || 'http://localhost:8123'

/** POST audio to the sidecar and return word timestamps. */
export async function transcribe(audio: Blob, signal?: AbortSignal): Promise<Transcription> {
  const form = new FormData()
  form.append('file', audio, 'audio')
  const response = await fetch(`${WHISPER_URL}/transcribe`, {
    method: 'POST',
    body: form,
    signal,
  })
  if (!response.ok) {
    throw new Error(`Whisper sidecar error ${response.status}: ${await response.text().catch(() => '')}`)
  }
  const data = (await response.json()) as Transcription
  if (!data || !Array.isArray(data.words)) {
    throw new Error('Whisper sidecar returned a malformed response (no words array)')
  }
  return data
}

/** Quick reachability check for the sidecar (for UI/health gating). */
export async function whisperHealthy(signal?: AbortSignal): Promise<boolean> {
  try {
    const response = await fetch(`${WHISPER_URL}/health`, { signal })
    return response.ok
  } catch {
    return false
  }
}
