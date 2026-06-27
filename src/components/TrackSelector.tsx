import { useEffect, useRef, useState, type RefObject } from 'react'
import { Check, ListMusic, Settings2 } from 'lucide-react'

/** Minimal track shape the selector needs. */
export type TrackOption = { id: string; name: string }

// ---------------------------------------------------------------------------
// TrackMenu — flat list of the song's tracks. Opens up or down depending on
// where the selector sits (down in the top header, up when docked at bottom).
// ---------------------------------------------------------------------------

type TrackMenuProps = {
  tracks: TrackOption[]
  activeTrackId: string
  onSelect: (id: string) => void
  onClose: () => void
  onManageTracks?: () => void
  anchorRef: RefObject<HTMLElement | null>
  openDirection: 'up' | 'down'
}

function TrackMenu({ tracks, activeTrackId, onSelect, onClose, onManageTracks, anchorRef, openDirection }: TrackMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        menuRef.current &&
        !menuRef.current.contains(target) &&
        anchorRef.current &&
        !anchorRef.current.contains(target)
      ) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose, anchorRef])

  const positionClass = openDirection === 'up' ? 'bottom-full mb-2' : 'top-full mt-2'
  const originClass = openDirection === 'up' ? 'origin-bottom-left' : 'origin-top-left'

  return (
    <div
      ref={menuRef}
      className={`absolute left-0 ${positionClass} ${originClass} z-[200] max-h-72 w-52 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1.5 shadow-xl animate-[menu-in_150ms_ease-out]`}
    >
      {onManageTracks && (
        <>
          <button
            type="button"
            onClick={() => { onManageTracks(); onClose() }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-[13px] text-slate-500 transition hover:bg-slate-50 hover:text-slate-700 active:bg-slate-100"
          >
            <Settings2 size={13} className="shrink-0" />
            <span>Add / manage tracks</span>
          </button>
          <div className="my-1.5 border-t border-slate-100" />
        </>
      )}

      {tracks.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onSelect(t.id)}
          className={`flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-[13px] transition hover:bg-slate-50 active:bg-slate-100 ${
            activeTrackId === t.id ? 'font-semibold text-[#4F7F7A]' : 'text-slate-800'
          }`}
        >
          <span className="flex-1 truncate">{t.name}</span>
          {activeTrackId === t.id && <Check size={13} className="text-[#4F7F7A]" strokeWidth={2.5} />}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// TrackSelector — the "Full Mix" pill. Track list opens on click.
// ---------------------------------------------------------------------------

type TrackSelectorProps = {
  tracks: TrackOption[]
  activeTrackId?: string
  onSelectTrack?: (id: string) => void
  /** Opens the track manager (rename / add / remove). Adds a menu item when provided. */
  onManageTracks?: () => void
  /** Which way the dropdown opens. Defaults to 'up' for the bottom dock. */
  openDirection?: 'up' | 'down'
}

export default function TrackSelector({
  tracks,
  activeTrackId,
  onSelectTrack,
  onManageTracks,
  openDirection = 'up',
}: TrackSelectorProps) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement | null>(null)

  const activeTrack = tracks.find((t) => t.id === activeTrackId) ?? tracks[0]
  if (!activeTrack || tracks.length === 0) return null

  const handleSelect = (id: string) => {
    onSelectTrack?.(id)
    setOpen(false)
  }

  const controlButtonClass =
    'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#4F7F7A]/55 bg-black/5 text-[#0b1220] shadow-sm shadow-black/10 backdrop-blur-sm transition hover:bg-black/10 active:bg-black/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4F7F7A]/40 focus-visible:ring-offset-2 focus-visible:ring-offset-white/80'

  return (
    <div className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={controlButtonClass}
        aria-label="Select track"
        aria-expanded={open}
        title="Select track"
      >
        <ListMusic size={15} />
      </button>

      {open && (
        <TrackMenu
          tracks={tracks}
          activeTrackId={activeTrack.id}
          onSelect={handleSelect}
          onClose={() => setOpen(false)}
          onManageTracks={onManageTracks}
          anchorRef={buttonRef as RefObject<HTMLElement | null>}
          openDirection={openDirection}
        />
      )}
    </div>
  )
}
