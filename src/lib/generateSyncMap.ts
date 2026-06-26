import type { PDFDocumentProxy } from 'pdfjs-dist'
import { extractLyrics } from './lyricsExtract.ts'
import { transcribe } from './transcribe.ts'
import { alignSyncMap, alignSyncMapTrace, type AlignTrace } from './alignSyncMap.ts'
import { isScannedPdf } from './scanCheck.ts'
import type { SyncMap } from './syncMap.ts'
import type { BeatAnalysis } from './transcribe.ts'

/**
 * Orchestrator: PDF + audio → sync map. Extracts lyrics from the PDF text layer
 * and word timestamps from the Whisper sidecar in parallel, then aligns them.
 *
 * Scanned/raster PDFs are rejected up front (`reason: 'scanned'`): their staff and
 * lyric geometry can't be read reliably, and a scan with an OCR text layer would
 * otherwise sneak past the text-layer check and align garbage. If the PDF is vector
 * but has no usable text layer (an instrumental score), there are no lyrics to align
 * — `reason: 'no-lyrics'`. Either way the caller falls back to manual linking.
 */

export type GenerateSyncMapResult = SyncMap & {
  /** Set when the map is empty for a known reason. */
  reason?: 'scanned' | 'no-lyrics' | 'no-anchors'
  /** Full alignment trace, present only when `debug` was requested. */
  trace?: AlignTrace
  /** Beat/tempo analysis from the sidecar, for the timing model. */
  beat?: BeatAnalysis
}

export type GenerateSyncMapOptions = {
  signal?: AbortSignal
  /** Called with a coarse progress phase, for UI. */
  onProgress?: (phase: 'transcribing' | 'extracting' | 'aligning' | 'done') => void
  /** Also return the full alignment trace for inspection/export. */
  debug?: boolean
}

export async function generateSyncMap(
  pdf: PDFDocumentProxy,
  audio: Blob,
  options: GenerateSyncMapOptions = {}
): Promise<GenerateSyncMapResult> {
  // Cheap content-stream check first: a scan can't be auto-synced, and bailing here
  // skips the expensive Whisper transcription too.
  if (await isScannedPdf(pdf)) {
    options.onProgress?.('done')
    return { version: 1, sourceHash: '', anchors: [], reason: 'scanned' }
  }

  options.onProgress?.('extracting')
  const lyricsPromise = extractLyrics(pdf)
  options.onProgress?.('transcribing')
  const [lyrics, transcription] = await Promise.all([lyricsPromise, transcribe(audio, options.signal)])

  if (lyrics.length === 0) {
    return { version: 1, sourceHash: transcription.sourceHash, anchors: [], reason: 'no-lyrics' }
  }

  options.onProgress?.('aligning')
  const trace = options.debug ? alignSyncMapTrace(lyrics, transcription.words) : undefined
  const anchors = trace ? trace.anchors : alignSyncMap(lyrics, transcription.words)
  options.onProgress?.('done')

  return {
    version: 1,
    sourceHash: transcription.sourceHash,
    anchors,
    ...(anchors.length === 0 ? { reason: 'no-anchors' as const } : {}),
    ...(trace ? { trace } : {}),
    ...(transcription.beat ? { beat: transcription.beat } : {}),
  }
}
