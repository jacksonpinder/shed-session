import { useEffect, useRef, useState } from 'react'
import { Copy, FileMusic, ListMusic, MoreVertical, Music2, Navigation, Pencil, Plus, Repeat, Trash2 } from 'lucide-react'
import type { Song } from '../lib/library'
import { getPdfThumbnail } from '../lib/pdfThumbnail'

type SongCardProps = {
  song: Song
  onOpen: () => void
  onRename: (title: string) => void
  onAddTrack: () => void
  onManageTracks: () => void
  onDuplicate: () => void
  onDelete: () => void
}

export default function SongCard({
  song,
  onOpen,
  onRename,
  onAddTrack,
  onManageTracks,
  onDuplicate,
  onDelete,
}: SongCardProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(song.title)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const synced = (song.anchors?.length ?? 0) > 0
  const trackCount = song.trackIds.length
  const loopCount = song.loops.length
  const [thumb, setThumb] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!song.pdfBlobKey) {
      setThumb(null)
      return
    }
    void getPdfThumbnail(song.pdfBlobKey).then((url) => {
      if (!cancelled) setThumb(url)
    })
    return () => {
      cancelled = true
    }
  }, [song.pdfBlobKey])

  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  useEffect(() => {
    if (renaming) {
      setDraft(song.title)
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [renaming, song.title])

  const commitRename = () => {
    const next = draft.trim()
    if (next && next !== song.title) onRename(next)
    setRenaming(false)
  }

  const runAction = (fn: () => void) => {
    setMenuOpen(false)
    fn()
  }

  const menuItem =
    'flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-[13px] transition hover:bg-slate-50 active:bg-slate-100'
  const menuItemDelete =
    'flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-[13px] transition text-rose-600 hover:bg-rose-50 active:bg-rose-100'

  return (
    <div className="group relative">
      <button
        type="button"
        onClick={() => !renaming && onOpen()}
        onKeyDown={(e) => {
          if (!renaming && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault()
            onOpen()
          }
        }}
        className="flex w-full cursor-pointer flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-[#4F7F7A]/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4F7F7A]/40"
      >
        <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-slate-100 to-slate-200 text-slate-400">
          {thumb ? (
            <img
              src={thumb}
              alt=""
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover object-top"
            />
          ) : (
            <FileMusic size={36} strokeWidth={1.5} />
          )}
        </div>
        <div className="min-w-0">
          {renaming ? (
            <input
              ref={inputRef}
              value={draft}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') commitRename()
                if (e.key === 'Escape') setRenaming(false)
              }}
              className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm font-semibold text-slate-900 outline-none focus:border-[#4F7F7A] focus:ring-2 focus:ring-[#4F7F7A]/30"
            />
          ) : (
            <h3 className="truncate text-sm font-semibold text-slate-900">{song.title}</h3>
          )}
          <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-500">
            <span className="inline-flex items-center gap-1">
              <Music2 size={11} />
              {trackCount} {trackCount === 1 ? 'track' : 'tracks'}
            </span>
            {loopCount > 0 && (
              <span className="inline-flex items-center gap-1">
                <Repeat size={11} />
                {loopCount}
              </span>
            )}
            {synced && (
              <span className="inline-flex items-center rounded-full bg-[#4F7F7A]/10 p-1 text-[#4F7F7A]">
                <Navigation size={11} />
              </span>
            )}
          </div>
        </div>
      </button>

      {/* Overflow menu — sibling to the card button, not nested inside it */}
      <div className="absolute right-2 top-2 z-10" ref={menuRef}>
        <button
          type="button"
          aria-label="Song actions"
          title="Song actions"
          onClick={(e) => {
            e.stopPropagation()
            setMenuOpen((v) => !v)
          }}
          className={`flex h-7 w-7 items-center justify-center rounded-full bg-white/80 text-slate-400 shadow-sm transition hover:bg-slate-100 hover:text-slate-600 ${
            menuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
        >
          <MoreVertical size={15} />
        </button>
        {menuOpen && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute right-0 top-full z-[60] mt-1 w-44 rounded-xl border border-slate-200 bg-white py-1.5 shadow-xl"
          >
            <button type="button" className={`${menuItem} text-slate-800`} onClick={() => runAction(() => setRenaming(true))}>
              <Pencil size={14} className="text-slate-400" /> Rename
            </button>
            <button type="button" className={`${menuItem} text-slate-800`} onClick={() => runAction(onAddTrack)}>
              <Plus size={14} className="text-slate-400" /> Add track
            </button>
            <button type="button" className={`${menuItem} text-slate-800`} onClick={() => runAction(onManageTracks)}>
              <ListMusic size={14} className="text-slate-400" /> Manage tracks
            </button>
            <button type="button" className={`${menuItem} text-slate-800`} onClick={() => runAction(onDuplicate)}>
              <Copy size={14} className="text-slate-400" /> Duplicate
            </button>
            <div className="my-1 border-t border-slate-100" />
            <button type="button" className={menuItemDelete} onClick={() => runAction(onDelete)}>
              <Trash2 size={14} /> Delete
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
