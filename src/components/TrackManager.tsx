import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Plus, Scissors, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { listTracks, updateTrack, deleteTrack, type Track } from '../lib/library'
import { useAddTracks, useAnalysis } from '../lib/analysisManager'

type TrackManagerProps = {
  songId: string
  /** The owning song's title — used to nudge trimming redundant name prefixes. */
  songTitle?: string
  /** Called whenever the track set changes, so the library card can refresh. */
  onChanged: () => void
  onClose: () => void
}

/** Strip a leading song-title prefix (and following separators) from a track name. */
const trimSongPrefix = (name: string, title?: string): string => {
  if (!title) return name
  if (!name.toLowerCase().startsWith(title.toLowerCase())) return name
  const rest = name.slice(title.length).replace(/^[\s\-–—:_.]+/, '')
  return rest || name
}

export default function TrackManager({ songId, songTitle, onChanged, onClose }: TrackManagerProps) {
  const addTracks = useAddTracks()
  const { state } = useAnalysis()
  const [tracks, setTracks] = useState<Track[]>([])
  const [loading, setLoading] = useState(true)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const refresh = useCallback(async () => {
    setTracks(await listTracks(songId))
    setLoading(false)
  }, [songId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const handleRename = async (id: string, name: string) => {
    const next = name.trim()
    if (!next) return
    await updateTrack(id, { name: next })
    setTracks((prev) => prev.map((t) => (t.id === id ? { ...t, name: next } : t)))
    onChanged()
  }

  const handleDelete = (t: Track) => {
    // Optimistically remove from UI; defer the actual DB delete until the
    // toast dismisses so the user can undo without re-uploading the file.
    setTracks((prev) => prev.filter((tr) => tr.id !== t.id))
    onChanged()

    let undone = false
    const timer = window.setTimeout(() => {
      if (!undone) void deleteTrack(t.id)
    }, 5000)

    toast(`Removed “${t.name}”`, {
      duration: 5000,
      action: {
        label: 'Undo',
        onClick: () => {
          undone = true
          window.clearTimeout(timer)
          void refresh()
          onChanged()
        },
      },
    })
  }

  const handleAdd = async (files: File[]) => {
    const added = await addTracks(songId, files)
    await refresh()
    onChanged()
    // Nudge a rename when an uploaded name just echoes the song title — the part
    // description is all that's needed (e.g. "Lead", not "Monster Dance — Lead").
    const redundant = added.some((t) => trimSongPrefix(t.name, songTitle) !== t.name)
    if (redundant) {
      toast('Tip: shorten track names to just the part (e.g. “Lead”).')
    } else if (added.length) {
      toast('Tip: rename tracks to a short part label for easier switching.')
    }
  }

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Manage tracks</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          >
            <X size={18} />
          </button>
        </div>

        {loading ? (
          <p className="py-8 text-center text-slate-400">Loading…</p>
        ) : tracks.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">No tracks yet — add an MP3 below.</p>
        ) : (
          <ul className="space-y-1.5">
            {tracks.map((t) => {
              const status = state.tracks[t.id]?.status
              const analyzing =
                status === 'transcribing' || status === 'aligning' || status === 'matching' || status === 'idle'
              const shortened = trimSongPrefix(t.name, songTitle)
              const canShorten = shortened !== t.name
              return (
                <li key={t.id} className="flex items-center gap-2 rounded-lg bg-slate-50 px-2 py-1.5">
                  <input
                    key={t.name}
                    defaultValue={t.name}
                    onBlur={(e) => handleRename(t.id, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                    }}
                    className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-[13px] text-slate-800 outline-none hover:border-slate-200 focus:border-[#4F7F7A] focus:bg-white focus:ring-2 focus:ring-[#4F7F7A]/30"
                  />
                  {canShorten && (
                    <button
                      onClick={() => handleRename(t.id, shortened)}
                      title={`Shorten to “${shortened}”`}
                      aria-label={`Shorten name to ${shortened}`}
                      className="flex h-7 shrink-0 items-center gap-1 rounded-full bg-[#4F7F7A]/10 px-2 text-[11px] font-medium text-[#4F7F7A] transition hover:bg-[#4F7F7A]/20"
                    >
                      <Scissors size={12} /> Shorten
                    </button>
                  )}
                  {analyzing && <Loader2 size={13} className="shrink-0 animate-spin text-slate-400" />}
                  <button
                    onClick={() => handleDelete(t)}
                    aria-label={`Delete ${t.name}`}
                    title="Remove track"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-rose-50 hover:text-rose-500"
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-slate-300 py-3 text-sm font-medium text-slate-500 transition hover:border-[#4F7F7A]/50 hover:text-[#4F7F7A]"
        >
          <Plus size={16} /> Add track
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="audio/*,.mp3,.wav,.m4a,.ogg,.flac"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void handleAdd(Array.from(e.target.files))
            e.target.value = ''
          }}
        />
      </div>
    </div>
  )
}
