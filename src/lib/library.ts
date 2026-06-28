/**
 * Multi-song library persistence. Songs, tracks, and their blobs (uploaded PDFs,
 * uploaded MP3s, recorded takes) live in the shared IndexedDB opened by
 * `audioStore.openDb()`. localStorage holds only true globals (last opened song).
 *
 * Scoping model (see the approved plan):
 *  - A Song owns N Tracks (MP3s) and at most one PDF.
 *  - Loops and the sync map (`anchors`) are SHARED per song, stored in song-time.
 *  - Each Track carries a `leadInOffset` mapping song-time ↔ that track's timeline
 *    (song-time = track-time − leadInOffset). Default 0; auto-detection is future work.
 *  - Session settings (transpose/speed/balance/mono/scroll/selected track) are per song.
 */
import {
  openDb,
  BLOBS_STORE,
  SONGS_STORE,
  TRACKS_STORE,
  ANNOTATIONS_STORE,
} from './audioStore.ts'
import type { SavedLoop } from './types'
import type { SongAnnotations } from './annotations.ts'
import type { Anchor } from './syncMap.ts'
import type { Transcription, BeatAnalysis } from './transcribe.ts'
import type { LyricToken } from './lyricsExtract.ts'
import type { SystemBand } from './detectSystems.ts'

/** Recorded mic-take metadata (was `practice:take`; blob lives in the `blobs` store). */
export type TakeMeta = {
  id: string
  offsetSec: number
  duration: number
  volume: number
}

/** Per-song session settings, re-applied to whichever track is active. */
export type SongSettings = {
  transpose: number
  speed: number
  balance: number
  mono: boolean
  scrollOnRepeat: boolean
  lanesVisible: boolean
}

export const DEFAULT_SETTINGS: SongSettings = {
  transpose: 0,
  speed: 1,
  balance: 0,
  mono: false,
  scrollOnRepeat: true,
  lanesVisible: true,
}

/** PDF-derived analysis cached on the song so re-opens are instant. */
export type SongPdfMeta = {
  sourceHash: string
  pageCount: number
  scanned: boolean
  lyricTokens?: LyricToken[]
  lyricsReason?: 'scanned' | 'no-lyrics'
}

export type Song = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  pdfBlobKey?: string
  pdf?: SongPdfMeta
  /** System/measure bands per 1-based page, cached once PDFViewer computes them. */
  systemBands?: Record<number, SystemBand[]>
  trackIds: string[]
  selectedTrackId?: string
  /** Track the sync map was aligned against (defaults to the first track). */
  referenceTrackId?: string
  /** Shared across all tracks, in song-time. */
  loops: SavedLoop[]
  anchors?: Anchor[]
  settings: SongSettings
}

export type TrackAnalysisStatus =
  | 'idle'
  | 'extracting'
  | 'transcribing'
  | 'aligning'
  | 'matching' // non-reference track: detecting its lead-in offset vs the reference
  | 'done'
  | 'error'

export type Track = {
  id: string
  songId: string
  /** Filename or user label, e.g. "Full mix", "Lead predom". */
  name: string
  audioBlobKey: string
  sourceHash?: string
  duration?: number
  channelCount?: number
  /** Seconds; song-time = track-time − leadInOffset. Default 0. */
  leadInOffset: number
  analysis: { status: TrackAnalysisStatus; error?: string }
  transcription?: Transcription
  beat?: BeatAnalysis
  takeMeta?: TakeMeta
}

const LAST_SONG_KEY = 'practice:lastSongId'

const uuid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`

// ---------------------------------------------------------------------------
// Low-level generic store helpers (one transaction each, db closed on complete).
// ---------------------------------------------------------------------------

const tx = <T>(
  store: string | string[],
  mode: IDBTransactionMode,
  run: (t: IDBTransaction) => void,
  result: () => T
) =>
  openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode)
        t.oncomplete = () => {
          db.close()
          resolve(result())
        }
        t.onerror = () => {
          db.close()
          reject(t.error)
        }
        t.onabort = () => {
          db.close()
          reject(t.error)
        }
        run(t)
      })
  )

// ---------------------------------------------------------------------------
// Blobs (PDFs, uploaded MP3s, recorded takes).
// ---------------------------------------------------------------------------

export const putBlob = async (blob: Blob, key = uuid()): Promise<string> => {
  await tx(BLOBS_STORE, 'readwrite', (t) => t.objectStore(BLOBS_STORE).put(blob, key), () => undefined)
  return key
}

export const getBlob = (key: string): Promise<Blob | null> => {
  let req: IDBRequest
  return tx<Blob | null>(
    BLOBS_STORE,
    'readonly',
    (t) => {
      req = t.objectStore(BLOBS_STORE).get(key)
    },
    () => (req.result as Blob) ?? null
  )
}

export const deleteBlob = (key: string): Promise<void> =>
  tx(BLOBS_STORE, 'readwrite', (t) => t.objectStore(BLOBS_STORE).delete(key), () => undefined)

// ---------------------------------------------------------------------------
// Annotations (pen/highlighter strokes, kept in their own store keyed by songId
// so large stroke JSON doesn't bloat the songs record).
// ---------------------------------------------------------------------------

export const loadAnnotations = (songId: string): Promise<SongAnnotations | null> => {
  let req: IDBRequest
  return tx<SongAnnotations | null>(
    ANNOTATIONS_STORE,
    'readonly',
    (t) => {
      req = t.objectStore(ANNOTATIONS_STORE).get(songId)
    },
    () => (req.result as SongAnnotations) ?? null
  )
}

export const saveAnnotations = (songId: string, annotations: SongAnnotations): Promise<void> =>
  tx(
    ANNOTATIONS_STORE,
    'readwrite',
    (t) => t.objectStore(ANNOTATIONS_STORE).put(annotations, songId),
    () => undefined
  )

// ---------------------------------------------------------------------------
// Songs.
// ---------------------------------------------------------------------------

export const listSongs = (): Promise<Song[]> => {
  let req: IDBRequest
  return tx<Song[]>(
    SONGS_STORE,
    'readonly',
    (t) => {
      req = t.objectStore(SONGS_STORE).getAll()
    },
    () => ((req.result as Song[]) ?? []).sort((a, b) => b.updatedAt - a.updatedAt)
  )
}

export const getSong = (id: string): Promise<Song | null> => {
  let req: IDBRequest
  return tx<Song | null>(
    SONGS_STORE,
    'readonly',
    (t) => {
      req = t.objectStore(SONGS_STORE).get(id)
    },
    () => (req.result as Song) ?? null
  )
}

export type NewSongInput = {
  title: string
  pdfBlobKey?: string
  pdf?: SongPdfMeta
  settings?: Partial<SongSettings>
}

export const createSong = async (input: NewSongInput): Promise<Song> => {
  const now = Date.now()
  const song: Song = {
    id: uuid(),
    title: input.title,
    createdAt: now,
    updatedAt: now,
    pdfBlobKey: input.pdfBlobKey,
    pdf: input.pdf,
    trackIds: [],
    loops: [],
    settings: { ...DEFAULT_SETTINGS, ...input.settings },
  }
  await tx(SONGS_STORE, 'readwrite', (t) => t.objectStore(SONGS_STORE).put(song), () => undefined)
  return song
}

/**
 * Shallow-merge a patch into a song and bump `updatedAt`. The read-merge-write runs
 * INSIDE one readwrite transaction so concurrent patches can't lose updates: the two
 * background-analysis legs and the modal's title write all hit the same Song record at
 * once, and a stale-snapshot write would otherwise clobber freshly-written `anchors`
 * (the "auto-sync didn't stick until I pressed Sync" bug). IndexedDB serializes
 * overlapping readwrite transactions by scope, so get→put within one tx is atomic.
 */
export const updateSong = async (
  id: string,
  patch: Partial<Omit<Song, 'id'>>
): Promise<Song> => {
  let next: Song | null = null
  await tx(
    SONGS_STORE,
    'readwrite',
    (t) => {
      const store = t.objectStore(SONGS_STORE)
      const req = store.get(id)
      req.onsuccess = () => {
        const existing = req.result as Song | undefined
        if (!existing) return
        next = { ...existing, ...patch, id, updatedAt: Date.now() }
        store.put(next)
      }
    },
    () => undefined
  )
  if (!next) throw new Error(`updateSong: no song ${id}`)
  return next
}

/** Delete a song and cascade: its tracks, their take blobs, and the PDF blob. */
export const deleteSong = async (id: string): Promise<void> => {
  const song = await getSong(id)
  if (!song) return
  const tracks = await listTracks(id)
  const blobKeys = [
    ...(song.pdfBlobKey ? [song.pdfBlobKey] : []),
    ...tracks.map((t) => t.audioBlobKey),
    ...tracks.flatMap((t) => (t.takeMeta ? [t.takeMeta.id] : [])),
  ]
  await tx(
    [SONGS_STORE, TRACKS_STORE, BLOBS_STORE, ANNOTATIONS_STORE],
    'readwrite',
    (t) => {
      t.objectStore(SONGS_STORE).delete(id)
      const trackStore = t.objectStore(TRACKS_STORE)
      tracks.forEach((tr) => trackStore.delete(tr.id))
      const blobStore = t.objectStore(BLOBS_STORE)
      blobKeys.forEach((k) => blobStore.delete(k))
      t.objectStore(ANNOTATIONS_STORE).delete(id)
    },
    () => undefined
  )
  if (loadLastSongId() === id) localStorage.removeItem(LAST_SONG_KEY)
}

/**
 * Deep-clone a song into a new library entry: copies the PDF blob, loops, anchors,
 * settings, and every track (with fresh audio blobs). Analysis results are carried
 * over so the copy is immediately synced — no re-transcription needed.
 */
export const duplicateSong = async (id: string): Promise<Song | null> => {
  const src = await getSong(id)
  if (!src) return null
  const srcTracks = await listTracks(id)

  let pdfBlobKey: string | undefined
  if (src.pdfBlobKey) {
    const b = await getBlob(src.pdfBlobKey)
    if (b) pdfBlobKey = await putBlob(b)
  }

  const copy = await createSong({
    title: `${src.title} (copy)`,
    pdfBlobKey,
    pdf: src.pdf,
    settings: src.settings,
  })
  await updateSong(copy.id, { loops: src.loops, anchors: src.anchors, systemBands: src.systemBands })

  for (const t of srcTracks) {
    const audio = await getBlob(t.audioBlobKey)
    if (!audio) continue
    const audioBlobKey = await putBlob(audio)
    const nt = await createTrack({ songId: copy.id, name: t.name, audioBlobKey, leadInOffset: t.leadInOffset })
    await updateTrack(nt.id, {
      transcription: t.transcription,
      beat: t.beat,
      sourceHash: t.sourceHash,
      duration: t.duration,
      analysis: t.analysis,
    })
  }
  return getSong(copy.id)
}

// ---------------------------------------------------------------------------
// Tracks.
// ---------------------------------------------------------------------------

export const listTracks = (songId: string): Promise<Track[]> => {
  let req: IDBRequest
  return tx<Track[]>(
    TRACKS_STORE,
    'readonly',
    (t) => {
      req = t.objectStore(TRACKS_STORE).index('bySong').getAll(songId)
    },
    () => (req.result as Track[]) ?? []
  )
}

export const getTrack = (id: string): Promise<Track | null> => {
  let req: IDBRequest
  return tx<Track | null>(
    TRACKS_STORE,
    'readonly',
    (t) => {
      req = t.objectStore(TRACKS_STORE).get(id)
    },
    () => (req.result as Track) ?? null
  )
}

export type NewTrackInput = {
  songId: string
  name: string
  audioBlobKey: string
  leadInOffset?: number
}

/** Create a track and append its id to the owning song (selecting it if first). */
export const createTrack = async (input: NewTrackInput): Promise<Track> => {
  const track: Track = {
    id: uuid(),
    songId: input.songId,
    name: input.name,
    audioBlobKey: input.audioBlobKey,
    leadInOffset: input.leadInOffset ?? 0,
    analysis: { status: 'idle' },
  }
  const song = await getSong(input.songId)
  if (!song) throw new Error(`createTrack: no song ${input.songId}`)
  const trackIds = [...song.trackIds, track.id]
  await tx(
    [TRACKS_STORE, SONGS_STORE],
    'readwrite',
    (t) => {
      t.objectStore(TRACKS_STORE).put(track)
      t.objectStore(SONGS_STORE).put({
        ...song,
        trackIds,
        selectedTrackId: song.selectedTrackId ?? track.id,
        referenceTrackId: song.referenceTrackId ?? track.id,
        updatedAt: Date.now(),
      })
    },
    () => undefined
  )
  return track
}

/** Atomic read-merge-write, same reasoning as `updateSong`: the transcription and
 * lead-in legs both patch the reference Track, so a stale snapshot must not clobber. */
export const updateTrack = async (
  id: string,
  patch: Partial<Omit<Track, 'id' | 'songId'>>
): Promise<Track> => {
  let next: Track | null = null
  await tx(
    TRACKS_STORE,
    'readwrite',
    (t) => {
      const store = t.objectStore(TRACKS_STORE)
      const req = store.get(id)
      req.onsuccess = () => {
        const existing = req.result as Track | undefined
        if (!existing) return
        next = { ...existing, ...patch, id, songId: existing.songId }
        store.put(next)
      }
    },
    () => undefined
  )
  if (!next) throw new Error(`updateTrack: no track ${id}`)
  return next
}

/** Delete a track, its blobs, and unlink it from the song. */
export const deleteTrack = async (id: string): Promise<void> => {
  const track = await getTrack(id)
  if (!track) return
  const song = await getSong(track.songId)
  const blobKeys = [track.audioBlobKey, ...(track.takeMeta ? [track.takeMeta.id] : [])]
  await tx(
    [TRACKS_STORE, SONGS_STORE, BLOBS_STORE],
    'readwrite',
    (t) => {
      t.objectStore(TRACKS_STORE).delete(id)
      const blobStore = t.objectStore(BLOBS_STORE)
      blobKeys.forEach((k) => blobStore.delete(k))
      if (song) {
        const trackIds = song.trackIds.filter((tid) => tid !== id)
        t.objectStore(SONGS_STORE).put({
          ...song,
          trackIds,
          selectedTrackId: song.selectedTrackId === id ? trackIds[0] : song.selectedTrackId,
          referenceTrackId: song.referenceTrackId === id ? trackIds[0] : song.referenceTrackId,
          updatedAt: Date.now(),
        })
      }
    },
    () => undefined
  )
}

// ---------------------------------------------------------------------------
// Last-opened-song pointer (localStorage global).
// ---------------------------------------------------------------------------

export const saveLastSongId = (id: string) => {
  try {
    localStorage.setItem(LAST_SONG_KEY, id)
  } catch {
    /* ignore quota/availability */
  }
}

export const loadLastSongId = (): string | null => {
  try {
    return localStorage.getItem(LAST_SONG_KEY)
  } catch {
    return null
  }
}
