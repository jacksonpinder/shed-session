import {
  useEffect,
  useState,
  type RefObject,
} from 'react'
import { ArrowLeft, ZoomIn, ZoomOut } from 'lucide-react'
import type { PDFViewerHandle } from './PDFViewer'

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
// ContextBar — song title + zoom. The track selector now lives in the docked
// transport bar (see TransportBar → TrackSelector).
// ---------------------------------------------------------------------------

type ContextBarProps = {
  pdfViewerRef: RefObject<PDFViewerHandle | null>
  zoomOutDisabled: boolean
  zoomInDisabled: boolean
  /** Active song title. */
  title?: string
  /** When provided, renders a back-to-library button. */
  onBack?: () => void
}

export default function ContextBar({
  pdfViewerRef,
  zoomOutDisabled,
  zoomInDisabled,
  title,
  onBack,
}: ContextBarProps) {
  const isMobile = useMediaQuery('(max-width: 1024px), (pointer: coarse)')

  // Shared style for all buttons that float directly over the PDF with no
  // containing background. Solid white + border ensures visibility on white
  // PDF pages; shadow-md hover makes the state change unmistakable.
  const floatingButtonClass =
    'flex h-8 w-8 items-center justify-center rounded-full bg-white text-[#0b1220] shadow border border-slate-200 transition hover:bg-slate-50 hover:shadow-md hover:border-slate-300 active:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4F7F7A]/40'

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-start justify-between px-3 pt-2">
      {/* Left: standalone back button or logo mark. */}
      <div className="pointer-events-auto">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to library"
            title="Back to library"
            className={floatingButtonClass}
          >
            <ArrowLeft size={16} />
          </button>
        ) : (
          <div className="flex h-8 items-center px-2 rounded-full bg-white shadow border border-slate-200">
            <img src="/shed session.png" alt="" className="h-full w-auto mix-blend-multiply" />
          </div>
        )}
      </div>

      {/* Zoom buttons — desktop only, floating top-right, offset left to clear
          the edge scrubber rail. */}
      {!isMobile && (
        <div className="pointer-events-auto mr-[68px] flex items-center gap-2">
          <button
            type="button"
            className={floatingButtonClass}
            onClick={() => pdfViewerRef.current?.zoomOut()}
            disabled={zoomOutDisabled}
            aria-label="Zoom out"
          >
            <ZoomOut size={16} />
          </button>
          <button
            type="button"
            className={floatingButtonClass}
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
