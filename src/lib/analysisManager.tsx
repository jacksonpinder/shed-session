/**
 * Background analysis orchestration for the Add-Song flow. Lives ABOVE the router
 * so jobs started in the modal keep running after the user hits Create and navigates
 * into the song ("create immediately, analyze in background").
 *
 * Two independent legs per song:
 *  - PDF leg  (fast, client): scan check → lyric extraction, cached on the Song.
 *  - Track leg (slow, sidecar): Whisper transcription + beat, cached on each Track.
 * When the reference track's words and the PDF's lyrics are both present, the legs
 * meet in `align()` → song-level `anchors` (song-time; reference offset subtracted).
 *
 * Results are written through `library.ts` (idempotent; the sidecar disk-caches by
 * audio hash so retries are cheap). An open SongView subscribes per song id to pick
 * up late-arriving anchors without remounting.
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { getDocument } from 'pdfjs-dist'
import { extractLyrics } from './lyricsExtract.ts'
import { isScannedPdf } from './scanCheck.ts'
import { transcribe } from './transcribe.ts'
import { alignSyncMap } from './alignSyncMap.ts'
import {
  getSong,
  getTrack,
  getBlob,
  updateSong,
  updateTrack,
  createTrack,
  putBlob,
  type Song,
  type Track,
  type TrackAnalysisStatus,
} from './library.ts'
import { detectLeadInOffset } from './leadIn.ts'

type PdfStatus = 'idle' | 'extracting' | 'done' | 'scanned' | 'no-lyrics' | 'error'

type AnalysisState = {
  tracks: Record<string, { status: TrackAnalysisStatus; error?: string }>
  pdfs: Record<string, { status: PdfStatus; error?: string }>
}

type AnalysisApi = {
  state: AnalysisState
  /** Analyze a freshly-added track: reference ⇒ Whisper, otherwise ⇒ lead-in only. */
  analyzeNewTrack: (track: Track, blob: Blob) => void
  analyzePdf: (song: Song, blob: Blob) => void
  /** Subscribe to writes for a song id (anchors/pdf); returns an unsubscribe. */
  subscribeSong: (songId: string, cb: () => void) => () => void
}

const AnalysisContext = createContext<AnalysisApi | null>(null)

export function AnalysisProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AnalysisState>({ tracks: {}, pdfs: {} })
  const subscribers = useRef(new Map<string, Set<() => void>>())

  const notify = useCallback((songId: string) => {
    subscribers.current.get(songId)?.forEach((cb) => cb())
  }, [])

  const setTrack = useCallback((id: string, status: TrackAnalysisStatus, error?: string) => {
    setState((s) => ({ ...s, tracks: { ...s.tracks, [id]: { status, error } } }))
  }, [])
  const setPdf = useCallback((id: string, status: PdfStatus, error?: string) => {
    setState((s) => ({ ...s, pdfs: { ...s.pdfs, [id]: { status, error } } }))
  }, [])

  // Try to produce song anchors once both legs are ready. Idempotent.
  const tryAlign = useCallback(
    async (songId: string) => {
      const song = await getSong(songId)
      if (!song?.pdf?.lyricTokens?.length) return
      const refId = song.referenceTrackId ?? song.trackIds[0]
      if (!refId) return
      const ref = await getTrack(refId)
      if (!ref?.transcription?.words?.length) return

      setTrack(ref.id, 'aligning')
      try {
        const anchorsRaw = alignSyncMap(song.pdf.lyricTokens, ref.transcription.words)
        // song-time = track-time − leadInOffset (0 by default until auto-detect lands)
        const anchors = ref.leadInOffset
          ? anchorsRaw.map((a) => ({ ...a, time: a.time - ref.leadInOffset }))
          : anchorsRaw
        await updateSong(songId, { anchors })
        setTrack(ref.id, 'done')
        notify(songId)
      } catch (err) {
        setTrack(ref.id, 'error', err instanceof Error ? err.message : String(err))
      }
    },
    [notify, setTrack]
  )

  const analyzePdf = useCallback(
    (song: Song, blob: Blob) => {
      setPdf(song.id, 'extracting')
      ;(async () => {
        try {
          const data = await blob.arrayBuffer()
          const pdf = await getDocument({ data }).promise
          if (await isScannedPdf(pdf)) {
            await updateSong(song.id, { pdf: { sourceHash: '', pageCount: pdf.numPages, scanned: true, lyricsReason: 'scanned' } })
            setPdf(song.id, 'scanned')
            notify(song.id)
            return
          }
          const lyricTokens = await extractLyrics(pdf)
          await updateSong(song.id, {
            pdf: {
              sourceHash: '',
              pageCount: pdf.numPages,
              scanned: false,
              lyricTokens,
              lyricsReason: lyricTokens.length ? undefined : 'no-lyrics',
            },
          })
          setPdf(song.id, lyricTokens.length ? 'done' : 'no-lyrics')
          notify(song.id)
          if (lyricTokens.length) void tryAlign(song.id)
        } catch (err) {
          setPdf(song.id, 'error', err instanceof Error ? err.message : String(err))
        }
      })()
    },
    [notify, setPdf, tryAlign]
  )

  const analyzeTrack = useCallback(
    (track: Track, blob: Blob) => {
      setTrack(track.id, 'transcribing')
      ;(async () => {
        try {
          const transcription = await transcribe(blob)
          await updateTrack(track.id, {
            transcription,
            beat: transcription.beat,
            sourceHash: transcription.sourceHash,
            duration: transcription.duration,
            analysis: { status: 'done' },
          })
          setTrack(track.id, 'done')
          notify(track.songId)
          void tryAlign(track.songId)
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          await updateTrack(track.id, { analysis: { status: 'error', error: message } }).catch(() => {})
          setTrack(track.id, 'error', message)
        }
      })()
    },
    [notify, setTrack, tryAlign]
  )

  // Non-reference track: recover its lead-in offset by correlating against the
  // reference audio. No transcription — the reference's words/beat are shared.
  const detectLeadIn = useCallback(
    (track: Track, blob: Blob) => {
      setTrack(track.id, 'matching')
      ;(async () => {
        try {
          const song = await getSong(track.songId)
          const refId = song?.referenceTrackId ?? song?.trackIds[0]
          const ref = refId && refId !== track.id ? await getTrack(refId) : null
          const refBlob = ref ? await getBlob(ref.audioBlobKey) : null
          let offsetSec = 0
          if (refBlob) {
            const result = await detectLeadInOffset(refBlob, blob)
            offsetSec = result.offsetSec
          }
          await updateTrack(track.id, { leadInOffset: offsetSec, analysis: { status: 'done' } })
          setTrack(track.id, 'done')
          notify(track.songId)
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          await updateTrack(track.id, { analysis: { status: 'error', error: message } }).catch(() => {})
          setTrack(track.id, 'error', message)
        }
      })()
    },
    [notify, setTrack]
  )

  // Decide how a freshly-added track is analyzed: the reference track (the one the
  // sync map is built from) gets full Whisper; every other track only needs its
  // lead-in offset, since beat + anchors are inherited from the reference.
  const analyzeNewTrack = useCallback(
    (track: Track, blob: Blob) => {
      ;(async () => {
        const song = await getSong(track.songId)
        const refId = song?.referenceTrackId ?? song?.trackIds[0]
        if (!refId || refId === track.id) analyzeTrack(track, blob)
        else detectLeadIn(track, blob)
      })()
    },
    [analyzeTrack, detectLeadIn]
  )

  const subscribeSong = useCallback((songId: string, cb: () => void) => {
    let set = subscribers.current.get(songId)
    if (!set) {
      set = new Set()
      subscribers.current.set(songId, set)
    }
    set.add(cb)
    return () => set!.delete(cb)
  }, [])

  const api = useMemo<AnalysisApi>(
    () => ({ state, analyzeNewTrack, analyzePdf, subscribeSong }),
    [state, analyzeNewTrack, analyzePdf, subscribeSong]
  )

  return <AnalysisContext.Provider value={api}>{children}</AnalysisContext.Provider>
}

export function useAnalysis(): AnalysisApi {
  const ctx = useContext(AnalysisContext)
  if (!ctx) throw new Error('useAnalysis must be used within an AnalysisProvider')
  return ctx
}

const isAudioFile = (f: File) => f.type.startsWith('audio/') || /\.(mp3|wav|m4a|ogg|flac)$/i.test(f.name)
const stripExt = (name: string) => name.replace(/\.[^.]+$/, '')

/**
 * Add one or more MP3s to an existing song: persists each blob, creates the track,
 * and kicks off background analysis. Returns the created tracks (created before
 * analysis finishes, so callers can refresh immediately).
 */
export function useAddTracks() {
  const { analyzeNewTrack } = useAnalysis()
  return useCallback(
    async (songId: string, files: File[]): Promise<Track[]> => {
      const created: Track[] = []
      for (const file of files.filter(isAudioFile)) {
        const audioBlobKey = await putBlob(file)
        const track = await createTrack({ songId, name: stripExt(file.name), audioBlobKey })
        analyzeNewTrack(track, file)
        created.push(track)
      }
      return created
    },
    [analyzeNewTrack]
  )
}
