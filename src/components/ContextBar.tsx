import {
  useEffect,
  useRef,
  useState,
  type RefObject,
} from 'react'
import { Check, ChevronRight, Music2, ZoomIn, ZoomOut } from 'lucide-react'
import type { PDFViewerHandle } from './PDFViewer'
import { SONG_META, type Track } from '../lib/songMeta'

const TRACK_STORAGE_KEY = 'practice:track'

const useMediaQuery = (query: string) => {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false
  )
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mql = window.matchMedia(query)
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches)
    setMatches(mql.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [query])
  return matches
}

// ---------------------------------------------------------------------------
// TrackMenu
// ---------------------------------------------------------------------------

type TrackMenuProps = {
  tracks: Track[]
  activeTrackId: string
  onSelect: (id: string) => void
  onClose: () => void
  anchorRef: RefObject<HTMLElement | null>
}

function TrackMenu({ tracks, activeTrackId, onSelect, onClose, anchorRef }: TrackMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [submenuPart, setSubmenuPart] = useState<string | null>(null)

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

  // Group: Full Mix first, then by part
  const fullMix = tracks.find((t) => t.part === null)
  const parts = Array.from(new Set(tracks.filter((t) => t.part !== null).map((t) => t.part as string)))

  const handlePartClick = (part: string) => {
    const partTracks = tracks.filter((t) => t.part === part)
    if (partTracks.length === 1) {
      onSelect(partTracks[0].id)
    } else {
      setSubmenuPart((current) => (current === part ? null : part))
    }
  }

  return (
    <div
      ref={menuRef}
      className="absolute top-full right-0 mt-2 z-[200] w-44 rounded-xl border border-slate-200 bg-white py-1.5 shadow-xl"
    >
      {fullMix && (
        <button
          type="button"
          onClick={() => onSelect(fullMix.id)}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-[13px] text-slate-800 transition hover:bg-slate-50 active:bg-slate-100"
        >
          <span className="flex-1">Full Mix</span>
          {activeTrackId === fullMix.id && <Check size={13} className="text-[#4F7F7A]" strokeWidth={2.5} />}
        </button>
      )}
      {parts.length > 0 && fullMix && (
        <div className="my-1 border-t border-slate-100" />
      )}
      {parts.map((part) => {
        const partTracks = tracks.filter((t) => t.part === part)
        const isActive = partTracks.some((t) => t.id === activeTrackId)
        const hasSubmenu = partTracks.length > 1

        return (
          <div key={part} className="relative">
            <button
              type="button"
              onClick={() => handlePartClick(part)}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-[13px] transition hover:bg-slate-50 active:bg-slate-100 ${
                isActive ? 'font-semibold text-[#4F7F7A]' : 'text-slate-800'
              }`}
            >
              <span className="flex-1">{part}</span>
              {isActive && !hasSubmenu && <Check size={13} className="text-[#4F7F7A]" strokeWidth={2.5} />}
              {hasSubmenu && <ChevronRight size={13} className="text-slate-400" />}
            </button>
            {hasSubmenu && submenuPart === part && (
              <div className="absolute top-0 left-full ml-1 z-[201] w-36 rounded-xl border border-slate-200 bg-white py-1.5 shadow-xl">
                {partTracks.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => onSelect(t.id)}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-[13px] text-slate-800 transition hover:bg-slate-50 active:bg-slate-100"
                  >
                    <span className="flex-1">{t.variant === 'loud' ? `Loud ${t.part}` : `No ${t.part}`}</span>
                    {activeTrackId === t.id && <Check size={13} className="text-[#4F7F7A]" strokeWidth={2.5} />}
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ContextBar
// ---------------------------------------------------------------------------

type ContextBarProps = {
  pdfViewerRef: RefObject<PDFViewerHandle | null>
  zoomOutDisabled: boolean
  zoomInDisabled: boolean
}

export default function ContextBar({
  pdfViewerRef,
  zoomOutDisabled,
  zoomInDisabled,
}: ContextBarProps) {
  const isMobile = useMediaQuery('(max-width: 1024px), (pointer: coarse)')

  const [trackOpen, setTrackOpen] = useState(false)
  const [activeTrackId, setActiveTrackId] = useState<string>(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem(TRACK_STORAGE_KEY) : null
    if (saved && SONG_META.tracks.some((t) => t.id === saved)) return saved
    return 'full-mix'
  })

  const trackButtonRef = useRef<HTMLButtonElement | null>(null)

  const activeTrack = SONG_META.tracks.find((t) => t.id === activeTrackId) ?? SONG_META.tracks[0]

  const handleTrackSelect = (id: string) => {
    setActiveTrackId(id)
    localStorage.setItem(TRACK_STORAGE_KEY, id)
    setTrackOpen(false)
  }

  const pillButtonClass =
    'flex h-7 items-center gap-1.5 rounded-full bg-[#e7e9ec] px-3 text-[11px] font-semibold uppercase tracking-[0.15em] text-[#0b1220]/85 shadow-sm transition hover:bg-slate-200 active:bg-slate-200/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4F7F7A]/40'

  const zoomButtonClass =
    'flex h-8 w-8 items-center justify-center rounded-full border border-transparent bg-[#e7e9ec] text-[#0b1220] shadow-sm transition hover:bg-slate-200 active:bg-slate-200/80 disabled:cursor-not-allowed disabled:opacity-40'

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex h-12 items-center justify-between px-3">
      {/* Icon + song name + track selector — floating top-left, overlaid on the sheet music */}
      <div className="pointer-events-auto flex h-8 items-center gap-1.5 rounded-full bg-white/70 px-2 shadow-sm backdrop-blur-md">
        <img src="/shed session.png" alt="" className="h-full w-auto shrink-0 mix-blend-multiply" />
        <span className="max-w-[120px] truncate text-[11px] font-medium uppercase tracking-[0.15em] text-[#0b1220]/75 sm:max-w-[180px]">
          {SONG_META.title}
        </span>
        <div className="relative">
          <button
            ref={trackButtonRef}
            type="button"
            onClick={() => {
              setTrackOpen((v) => !v)
            }}
            className={pillButtonClass}
            aria-label="Select track"
            aria-expanded={trackOpen}
            title="Select track"
          >
            <Music2 size={11} className="shrink-0 opacity-60" />
            {activeTrack.name}
          </button>

          {trackOpen && (
            <TrackMenu
              tracks={SONG_META.tracks}
              activeTrackId={activeTrackId}
              onSelect={handleTrackSelect}
              onClose={() => setTrackOpen(false)}
              anchorRef={trackButtonRef as RefObject<HTMLElement | null>}
            />
          )}
        </div>
      </div>

      {/* Zoom buttons — desktop only, floating top-right */}
      {!isMobile && (
        <div className="pointer-events-auto flex items-center gap-2">
          <button
            type="button"
            className={zoomButtonClass}
            onClick={() => pdfViewerRef.current?.zoomOut()}
            disabled={zoomOutDisabled}
            aria-label="Zoom out"
          >
            <ZoomOut size={16} />
          </button>
          <button
            type="button"
            className={zoomButtonClass}
            onClick={() => pdfViewerRef.current?.zoomIn()}
            disabled={zoomInDisabled}
            aria-label="Zoom in"
          >
            <ZoomIn size={16} />
          </button>
        </div>
      )}
    </div>
  )
}
