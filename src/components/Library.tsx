import { useCallback, useEffect, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { listSongs, deleteSong, updateSong, duplicateSong, type Song } from '../lib/library'
import { useAddTracks } from '../lib/analysisManager'
import SongCard from './SongCard'
import TrackManager from './TrackManager'

type LibraryProps = {
  onOpenSong: (id: string) => void
  onAddSong: () => void
  /** Bumped by the parent to force a re-list (e.g. after a song is created). */
  refreshToken?: number
}

export default function Library({ onOpenSong, onAddSong, refreshToken }: LibraryProps) {
  const addTracks = useAddTracks()
  const [songs, setSongs] = useState<Song[]>([])
  const [loading, setLoading] = useState(true)
  const [managingSongId, setManagingSongId] = useState<string | null>(null)
  const pendingAddSongRef = useRef<string | null>(null)
  const addInputRef = useRef<HTMLInputElement | null>(null)

  const refresh = useCallback(async () => {
    setSongs(await listSongs())
    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh, refreshToken])

  useEffect(() => {
    document.title = 'Shed Session'
  }, [])

  const handleDelete = useCallback(
    async (song: Song) => {
      if (!window.confirm(`Delete “${song.title}”? This removes its loops, tracks, and recordings.`)) return
      await deleteSong(song.id)
      void refresh()
    },
    [refresh]
  )

  const handleRename = useCallback(
    async (song: Song, title: string) => {
      await updateSong(song.id, { title })
      void refresh()
    },
    [refresh]
  )

  const handleDuplicate = useCallback(
    async (song: Song) => {
      const dup = await duplicateSong(song.id)
      if (dup) toast.success(`Duplicated “${song.title}”`)
      void refresh()
    },
    [refresh]
  )

  const handleAddTrackClick = useCallback((song: Song) => {
    pendingAddSongRef.current = song.id
    addInputRef.current?.click()
  }, [])

  const handleAddInputChange = useCallback(
    async (files: File[]) => {
      const songId = pendingAddSongRef.current
      pendingAddSongRef.current = null
      if (!songId || files.length === 0) return
      const created = await addTracks(songId, files)
      if (created.length) toast.info(`Added ${created.length} track${created.length === 1 ? '' : 's'} — analyzing…`)
      void refresh()
    },
    [addTracks, refresh]
  )

  const managingSong = songs.find((s) => s.id === managingSongId) ?? null

  return (
    <div className="min-h-screen overflow-y-auto bg-[#f8fafc] text-slate-900">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 pb-2 pt-10">
        <div className="flex items-center gap-2">
          <img src="/shed session.png" alt="" className="h-7 w-auto mix-blend-multiply" />
          <h1 className="text-lg font-semibold tracking-tight">Your songs</h1>
        </div>
        <button
          type="button"
          onClick={onAddSong}
          className="inline-flex items-center gap-1.5 rounded-full bg-[#4F7F7A] px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-[#446e69] active:bg-[#3d625e]"
        >
          <Plus size={16} />
          Add a song
        </button>
      </header>

      <main className="mx-auto max-w-5xl px-6 pb-16 pt-4">
        {loading ? (
          <p className="py-20 text-center text-slate-400">Loading…</p>
        ) : songs.length === 0 ? (
          <button
            type="button"
            onClick={onAddSong}
            className="flex w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-slate-300 bg-white/50 py-24 text-slate-400 transition hover:border-[#4F7F7A]/40 hover:text-[#4F7F7A]"
          >
            <Plus size={28} />
            <span className="text-sm font-medium">Add your first song</span>
          </button>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {songs.map((song) => (
              <SongCard
                key={song.id}
                song={song}
                onOpen={() => onOpenSong(song.id)}
                onRename={(title) => handleRename(song, title)}
                onAddTrack={() => handleAddTrackClick(song)}
                onManageTracks={() => setManagingSongId(song.id)}
                onDuplicate={() => handleDuplicate(song)}
                onDelete={() => handleDelete(song)}
              />
            ))}
          </div>
        )}
      </main>

      {managingSong && (
        <TrackManager
          songId={managingSong.id}
          songTitle={managingSong.title}
          onChanged={refresh}
          onClose={() => setManagingSongId(null)}
        />
      )}

      <input
        ref={addInputRef}
        type="file"
        accept="audio/*,.mp3,.wav,.m4a,.ogg,.flac"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) void handleAddInputChange(Array.from(e.target.files))
          e.target.value = ''
        }}
      />
    </div>
  )
}
