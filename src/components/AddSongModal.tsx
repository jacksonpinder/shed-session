import { useCallback, useRef, useState, type ReactElement, type RefObject } from 'react'
import { FileMusic, Loader2, Music2, Check, X, AlertCircle } from 'lucide-react'
import {
  createSong,
  createTrack,
  updateSong,
  deleteSong,
  putBlob,
  type Track,
} from '../lib/library'
import { useAnalysis } from '../lib/analysisManager'

type AddSongModalProps = {
  onCreated: (songId: string) => void
  onClose: () => void
}

const stripExt = (name: string) => name.replace(/\.[^.]+$/, '')

export default function AddSongModal({ onCreated, onClose }: AddSongModalProps) {
  const { analyzeNewTrack, analyzePdf, state } = useAnalysis()
  const [title, setTitle] = useState('')
  const [draftId, setDraftId] = useState<string | null>(null)
  const [tracks, setTracks] = useState<Track[]>([])
  const [pdfName, setPdfName] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const draftIdRef = useRef<string | null>(null)
  const filesByTrackRef = useRef(new Map<string, File>())
  const audioInputRef = useRef<HTMLInputElement | null>(null)
  const pdfInputRef = useRef<HTMLInputElement | null>(null)

  // Create the draft song on first file drop so analysis has records to write to.
  const ensureDraft = useCallback(async (): Promise<string> => {
    if (draftIdRef.current) return draftIdRef.current
    const song = await createSong({ title: title.trim() || 'Untitled' })
    draftIdRef.current = song.id
    setDraftId(song.id)
    return song.id
  }, [title])

  const addAudioFiles = useCallback(
    async (files: File[]) => {
      const audio = files.filter((f) => f.type.startsWith('audio/') || /\.(mp3|wav|m4a|ogg|flac)$/i.test(f.name))
      if (!audio.length) return
      const songId = await ensureDraft()
      for (const file of audio) {
        const audioBlobKey = await putBlob(file)
        const track = await createTrack({ songId, name: stripExt(file.name), audioBlobKey })
        filesByTrackRef.current.set(track.id, file)
        setTracks((prev) => [...prev, track])
        analyzeNewTrack(track, file)
      }
    },
    [ensureDraft, analyzeNewTrack]
  )

  const retryTrack = useCallback(
    (track: Track) => {
      const file = filesByTrackRef.current.get(track.id)
      if (file) analyzeNewTrack(track, file)
    },
    [analyzeNewTrack]
  )

  const addPdfFile = useCallback(
    async (files: File[]) => {
      const pdf = files.find((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name))
      if (!pdf) return
      const songId = await ensureDraft()
      const pdfBlobKey = await putBlob(pdf)
      const song = await updateSong(songId, { pdfBlobKey })
      setPdfName(pdf.name)
      analyzePdf(song, pdf)
    },
    [ensureDraft, analyzePdf]
  )

  const handleCreate = useCallback(async () => {
    if (!draftIdRef.current || busy) return
    setBusy(true)
    await updateSong(draftIdRef.current, { title: title.trim() || 'Untitled' })
    onCreated(draftIdRef.current)
  }, [busy, title, onCreated])

  const handleCancel = useCallback(async () => {
    const id = draftIdRef.current
    draftIdRef.current = null
    if (id) await deleteSong(id).catch(() => {})
    onClose()
  }, [onClose])

  const canCreate = (tracks.length > 0 || pdfName !== null) && title.trim().length > 0 && !busy

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Add a song</h2>
          <button
            onClick={handleCancel}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          >
            <X size={18} />
          </button>
        </div>

        {/* Audio first — leads the form so its (slow) analysis starts early. */}
        <DropZone
          primary
          label="Add your audio first"
          hint="MP3, WAV, M4A — drop one or more"
          icon={<Music2 size={22} />}
          inputRef={audioInputRef}
          accept="audio/*,.mp3,.wav,.m4a,.ogg,.flac"
          multiple
          onFiles={addAudioFiles}
        />
        {tracks.length > 0 && (
          <ul className="mt-2 space-y-1">
            {tracks.map((t) => (
              <li key={t.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-1.5 text-[13px]">
                <span className="truncate text-slate-700">{t.name}</span>
                <TrackStatusChip
                  status={state.tracks[t.id]?.status}
                  error={state.tracks[t.id]?.error}
                  onRetry={() => retryTrack(t)}
                />
              </li>
            ))}
          </ul>
        )}

        <DropZone
          className="mt-3"
          label="Add the score (PDF)"
          hint="Optional — drop the sheet music"
          icon={<FileMusic size={22} />}
          inputRef={pdfInputRef}
          accept="application/pdf,.pdf"
          onFiles={addPdfFile}
        />
        {pdfName && (
          <div className="mt-2 flex items-center justify-between rounded-lg bg-slate-50 px-3 py-1.5 text-[13px]">
            <span className="truncate text-slate-700">{pdfName}</span>
            <PdfStatusChip status={draftId ? state.pdfs[draftId]?.status : undefined} />
          </div>
        )}

        <label className="mt-4 block text-[13px] font-medium text-slate-600">
          Title
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Song title"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#4F7F7A] focus:ring-2 focus:ring-[#4F7F7A]/30"
          />
        </label>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={handleCancel}
            className="rounded-full px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!canCreate}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#4F7F7A] px-5 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-[#446e69] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

function DropZone({
  label,
  hint,
  icon,
  accept,
  multiple,
  primary,
  className,
  inputRef,
  onFiles,
}: {
  label: string
  hint: string
  icon: ReactElement
  accept: string
  multiple?: boolean
  primary?: boolean
  className?: string
  inputRef: RefObject<HTMLInputElement | null>
  onFiles: (files: File[]) => void
}) {
  const [dragging, setDragging] = useState(false)
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        onFiles(Array.from(e.dataTransfer.files))
      }}
      onClick={() => inputRef.current?.click()}
      className={`flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-4 text-center transition ${
        primary ? 'py-7' : 'py-5'
      } ${
        dragging
          ? 'border-[#4F7F7A] bg-[#4F7F7A]/5'
          : primary
            ? 'border-[#4F7F7A]/50 bg-[#4F7F7A]/5 hover:border-[#4F7F7A]'
            : 'border-slate-300 hover:border-slate-400'
      } ${className ?? ''}`}
    >
      <span className={primary ? 'text-[#4F7F7A]' : 'text-slate-400'}>{icon}</span>
      <span className={`text-sm font-medium ${primary ? 'text-[#4F7F7A]' : 'text-slate-600'}`}>{label}</span>
      <span className="text-[11px] text-slate-400">{hint}</span>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          if (e.target.files) onFiles(Array.from(e.target.files))
          e.target.value = ''
        }}
      />
    </div>
  )
}

function TrackStatusChip({ status, error, onRetry }: { status?: string; error?: string; onRetry?: () => void }) {
  if (!status || status === 'idle' || status === 'transcribing') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
        <Loader2 size={11} className="animate-spin" /> Analyzing…
      </span>
    )
  }
  if (status === 'aligning' || status === 'matching') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
        <Loader2 size={11} className="animate-spin" /> {status === 'matching' ? 'Matching lead-in…' : 'Aligning…'}
      </span>
    )
  }
  if (status === 'done') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-[#4F7F7A]">
        <Check size={11} /> Ready
      </span>
    )
  }
  // error — analysis failed (e.g. sidecar offline); the song still works manually.
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-amber-600" title={error}>
      <AlertCircle size={11} /> Manual
      {onRetry && (
        <button onClick={onRetry} className="ml-1 rounded px-1 text-[11px] font-medium text-[#4F7F7A] underline-offset-2 hover:underline">
          Retry
        </button>
      )}
    </span>
  )
}

function PdfStatusChip({ status }: { status?: string }) {
  if (!status || status === 'extracting') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
        <Loader2 size={11} className="animate-spin" /> Reading score…
      </span>
    )
  }
  if (status === 'done') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-[#4F7F7A]">
        <Check size={11} /> Score ready
      </span>
    )
  }
  const label = status === 'scanned' ? 'Scanned (manual)' : status === 'no-lyrics' ? 'No lyrics (manual)' : 'Failed'
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-amber-600">
      <AlertCircle size={11} /> {label}
    </span>
  )
}
