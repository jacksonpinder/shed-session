/**
 * One-time bootstrap of the multi-song library. On first run (no songs in the DB)
 * the legacy single-song assets (`/sample.mp3`, `/sheetmusic.pdf`) and the existing
 * `practice:*` localStorage state (loops, settings, sync map, take) are imported
 * into a real library song so nothing the user already created is lost.
 *
 * Non-destructive: the old localStorage keys are left in place; the library simply
 * stops reading them. Safe to call on every launch — it no-ops once a song exists.
 */
import { listSongs, createSong, createTrack, updateSong, updateTrack, putBlob } from './library.ts'
import type { SongSettings, TakeMeta } from './library.ts'
import { DEFAULT_SETTINGS } from './library.ts'
import { getAudioBlob } from './audioStore.ts'
import { loadJson, saveJson } from './storage.ts'
import { SONG_META } from './songMeta.ts'
import type { SavedLoop } from './types'
import type { Anchor } from './syncMap.ts'

const LEGACY_PDF_URL = '/sheetmusic.pdf'
const LEGACY_AUDIO_URL = '/sample.mp3'
// Set once the legacy import has run so an intentionally-emptied library stays empty
// (we must not re-seed the sample every time the library happens to be empty).
const MIGRATED_FLAG = 'practice:migrated'

const fetchBlob = async (url: string): Promise<Blob | null> => {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    return await res.blob()
  } catch {
    return null
  }
}

/** Read the legacy global settings out of localStorage into a SongSettings. */
const readLegacySettings = (): Partial<SongSettings> => {
  const out: Partial<SongSettings> = {}
  const balance = loadJson<number>('practice:balance')
  if (typeof balance === 'number') out.balance = balance
  const mono = loadJson<boolean>('practice:mono')
  if (typeof mono === 'boolean') out.mono = mono
  const transpose = loadJson<number>('practice:transpose')
  if (typeof transpose === 'number') out.transpose = transpose
  const scrollOnRepeat = loadJson<boolean>('practice:scroll-on-repeat')
  if (typeof scrollOnRepeat === 'boolean') out.scrollOnRepeat = scrollOnRepeat
  const lanesVisible = loadJson<boolean>('practice:lanesVisible')
  if (typeof lanesVisible === 'boolean') out.lanesVisible = lanesVisible
  return out
}

/**
 * Ensure the library has at least the migrated sample song. Returns the id of a
 * song to open on first launch (the migrated one), or null if the library already
 * had songs (caller should use the last-opened pointer instead).
 */
export async function ensureLibrary(): Promise<string | null> {
  // One-time only: if we've already migrated, never re-seed (even if now empty).
  if (loadJson<boolean>(MIGRATED_FLAG)) return null
  const existing = await listSongs()
  if (existing.length > 0) {
    saveJson(MIGRATED_FLAG, true)
    return null
  }

  const [pdfBlob, audioBlob] = await Promise.all([
    fetchBlob(LEGACY_PDF_URL),
    fetchBlob(LEGACY_AUDIO_URL),
  ])

  const pdfBlobKey = pdfBlob ? await putBlob(pdfBlob) : undefined
  const song = await createSong({
    title: SONG_META.title,
    pdfBlobKey,
    settings: { ...DEFAULT_SETTINGS, ...readLegacySettings() },
  })

  // Import existing loops + sync map (song-time; legacy single track ⇒ offset 0).
  const loops = loadJson<SavedLoop[]>('practice:loops')
  const syncMap = loadJson<{ anchors?: Anchor[] }>('practice:syncMap')
  await updateSong(song.id, {
    loops: Array.isArray(loops) ? loops : [],
    anchors: Array.isArray(syncMap?.anchors) ? syncMap!.anchors : undefined,
  })

  if (audioBlob) {
    const audioBlobKey = await putBlob(audioBlob)
    const track = await createTrack({ songId: song.id, name: 'Full Mix', audioBlobKey })
    // Carry over a recorded take if one was saved (blob already lives in audio-blobs).
    const take = loadJson<TakeMeta>('practice:take')
    if (take?.id) {
      const takeBlob = await getAudioBlob(take.id)
      if (takeBlob) {
        const takeKey = await putBlob(takeBlob, take.id)
        await updateTrack(track.id, { takeMeta: { ...take, id: takeKey } })
      }
    }
  }

  saveJson(MIGRATED_FLAG, true)
  return song.id
}
