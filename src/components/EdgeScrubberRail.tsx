import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { packIntervals } from '../lib/assignLanes'
import type { SheetMarker, SheetPosition } from './PDFViewer'

const DESKTOP_RAIL_W = 60
const GHOST_RAIL_W = 4
// Loop bands live in a left gutter; page-number cards sit BESIDE them (not under).
const BAND_COL_W = 4
const BAND_COL_GAP = 1.5
const MIN_BAND_PX = 6 // a loop with no resolvable end still reads as a tick
const BAND_GUTTER_PAD = 5 // gap between the band gutter and the page cards
const CARD_INSET_X = 5 // page cards inset from the rail's right edge
const CARD_GAP_Y = 4 // vertical gap between stacked page cards (clean margin)
const GHOST_HIDE_MS = 1500

type EdgeScrubberRailProps = {
  /** The score scroll container; the rail reads/sets its scrollTop directly. */
  containerRef: MutableRefObject<HTMLDivElement | null>
  markers: SheetMarker[]
  /** Absolute scroll-Y (within the container content) of a sheet position. */
  getDocY: (pos: SheetPosition) => number | null
  numPages: number
  /** Re-measure trigger: PDF reflow (zoom / fit) changes content height. */
  effectiveScale: number
  isTouch: boolean
  /** Toggle a loop's selection (same as the page-margin bars / dock chips). */
  onSelectLoop: (id: string) => void
}

type RailMetrics = { scrollTop: number; scrollHeight: number; clientHeight: number }

export default function EdgeScrubberRail({
  containerRef,
  markers,
  getDocY,
  numPages,
  effectiveScale,
  isTouch,
  onSelectLoop,
}: EdgeScrubberRailProps) {
  const [metrics, setMetrics] = useState<RailMetrics>({
    scrollTop: 0,
    scrollHeight: 0,
    clientHeight: 0,
  })
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const hoverLeaveTimerRef = useRef<number | null>(null)
  // Mobile ghost rail auto-hides ~1.5s after the last scroll.
  const [ghostVisible, setGhostVisible] = useState(false)
  const ghostTimerRef = useRef<number | null>(null)
  const dragRef = useRef<{ startY: number; startScrollTop: number } | null>(null)

  const railW = isTouch ? GHOST_RAIL_W : DESKTOP_RAIL_W

  const measure = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    setMetrics((prev) => {
      const next = {
        scrollTop: el.scrollTop,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
      }
      return prev.scrollTop === next.scrollTop &&
        prev.scrollHeight === next.scrollHeight &&
        prev.clientHeight === next.clientHeight
        ? prev
        : next
    })
  }, [containerRef])

  // Attach scroll + resize listeners to the container; re-measure on PDF reflow.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onScroll = () => {
      measure()
      if (isTouch) {
        setGhostVisible(true)
        if (ghostTimerRef.current) window.clearTimeout(ghostTimerRef.current)
        ghostTimerRef.current = window.setTimeout(() => setGhostVisible(false), GHOST_HIDE_MS)
      }
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    let ro: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => measure())
      ro.observe(el)
    }
    // Initial + post-layout measure (pages paint after mount).
    measure()
    const raf = window.requestAnimationFrame(measure)
    const t = window.setTimeout(measure, 250)
    return () => {
      el.removeEventListener('scroll', onScroll)
      ro?.disconnect()
      window.cancelAnimationFrame(raf)
      window.clearTimeout(t)
      if (ghostTimerRef.current) window.clearTimeout(ghostTimerRef.current)
    }
  }, [containerRef, measure, isTouch])

  useEffect(() => {
    return () => {
      if (hoverLeaveTimerRef.current !== null) window.clearTimeout(hoverLeaveTimerRef.current)
    }
  }, [])

  const startHover = useCallback((id: string) => {
    if (hoverLeaveTimerRef.current !== null) {
      window.clearTimeout(hoverLeaveTimerRef.current)
      hoverLeaveTimerRef.current = null
    }
    setHoveredId(id)
  }, [])

  const endHover = useCallback((id: string) => {
    hoverLeaveTimerRef.current = window.setTimeout(() => {
      setHoveredId((current) => (current === id ? null : current))
      hoverLeaveTimerRef.current = null
    }, 80)
  }, [])

  // Re-measure when the document reflows (zoom changes content height).
  useEffect(() => {
    measure()
  }, [measure, effectiveScale, numPages])

  const { scrollTop, scrollHeight, clientHeight } = metrics
  const scrollable = scrollHeight > clientHeight + 1
  const railH = clientHeight
  const toRailY = useCallback(
    (docY: number) => (scrollHeight > 0 ? (docY / scrollHeight) * railH : 0),
    [scrollHeight, railH]
  )

  // Resolve each loop to a rail band {top,height}, then pack overlapping bands
  // into columns so they never occlude. Recomputed on scroll/reflow (getDocY
  // reads live page geometry) and whenever the loops change.
  const bands = useMemo(() => {
    if (!scrollable) return [] as {
      marker: SheetMarker
      top: number
      height: number
      col: number
    }[]
    const raw = markers
      .map((marker) => {
        const startY = getDocY(marker.sheetLink)
        if (startY == null) return null
        const endY = marker.sheetLinkEnd ? getDocY(marker.sheetLinkEnd) : null
        const top = toRailY(startY)
        const bottom = endY != null ? toRailY(endY) : top
        const height = Math.max(MIN_BAND_PX, bottom - top)
        return { marker, top, height, docTop: startY, docBottom: endY ?? startY }
      })
      .filter((b): b is NonNullable<typeof b> => b !== null)
    const cols = packIntervals(
      raw.map((b) => ({ id: b.marker.id, start: b.docTop, end: Math.max(b.docBottom, b.docTop + 1) }))
    )
    return raw.map((b) => ({ marker: b.marker, top: b.top, height: b.height, col: cols[b.marker.id] ?? 0 }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markers, getDocY, toRailY, scrollable, scrollTop, effectiveScale])

  const numCols = bands.reduce((m, b) => Math.max(m, b.col + 1), 1)
  // Width reserved on the left for the loop-band gutter — the cards sit beside it.
  const bandGutterW = isTouch ? 0 : numCols * (BAND_COL_W + BAND_COL_GAP)

  // Page "cards" — stacked-paper look with a big centered page number.
  const pageCards = useMemo(() => {
    if (isTouch || !scrollable || numPages <= 0) return [] as { page: number; top: number; height: number }[]
    const cards: { page: number; top: number; height: number }[] = []
    for (let page = 1; page <= numPages; page++) {
      const topDoc = getDocY({ page, yWithinPageRatio: 0 })
      const botDoc = getDocY({ page, yWithinPageRatio: 1 })
      if (topDoc == null || botDoc == null) continue
      const top = toRailY(topDoc)
      const height = Math.max(2, toRailY(botDoc) - top)
      cards.push({ page, top, height })
    }
    return cards
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTouch, scrollable, numPages, getDocY, toRailY, scrollTop, effectiveScale])

  // Viewport window rect.
  const windowTop = scrollHeight > 0 ? (scrollTop / scrollHeight) * railH : 0
  const windowHeight = scrollHeight > 0 ? (clientHeight / scrollHeight) * railH : railH

  const setScrollTop = useCallback(
    (next: number) => {
      const el = containerRef.current
      if (!el) return
      el.scrollTop = Math.max(0, Math.min(next, scrollHeight - clientHeight))
    },
    [containerRef, scrollHeight, clientHeight]
  )

  const onWindowPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      e.stopPropagation()
      e.currentTarget.setPointerCapture(e.pointerId)
      dragRef.current = { startY: e.clientY, startScrollTop: scrollTop }
    },
    [scrollTop]
  )
  const onWindowPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      const drag = dragRef.current
      if (!drag || railH <= 0) return
      const dy = e.clientY - drag.startY
      setScrollTop(drag.startScrollTop + (dy / railH) * scrollHeight)
    },
    [railH, scrollHeight, setScrollTop]
  )
  const onWindowPointerUp = useCallback((e: ReactPointerEvent) => {
    dragRef.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* no-op */
    }
  }, [])

  if (!scrollable) return null
  const show = !isTouch || ghostVisible

  return (
    <div
      className="absolute inset-y-0 right-0 z-10 transition-opacity duration-300"
      style={{
        width: railW,
        opacity: show ? 1 : 0,
        pointerEvents: 'none',
        background: isTouch ? 'rgba(0,0,0,0.04)' : 'transparent',
      }}
    >
      {/* Stacked page cards (beside the band gutter) with a centered page number. */}
      {pageCards.map(({ page, top, height }) => {
        const cardH = Math.max(2, height - CARD_GAP_Y)
        const numSize = Math.min(14, Math.max(8, cardH * 0.4))
        return (
          <div
            key={page}
            className="pointer-events-none absolute flex items-center justify-center"
            style={{
              top: top + CARD_GAP_Y / 2,
              height: cardH,
              left: bandGutterW + BAND_GUTTER_PAD,
              right: CARD_INSET_X,
              background: '#ffffff',
              border: '1px solid rgba(15,23,42,0.07)',
              borderRadius: 5,
              boxShadow: '0 1px 2px rgba(15,23,42,0.05)',
            }}
          >
            <span style={{ fontSize: numSize, fontWeight: 500, color: 'rgba(15,23,42,0.30)', lineHeight: 1 }}>
              {page}
            </span>
          </div>
        )
      })}

      {/* Loop bands on the left edge */}
      {bands.map(({ marker, top, height, col }) => {
        const left = isTouch ? (col * GHOST_RAIL_W) / numCols : col * (BAND_COL_W + BAND_COL_GAP)
        const width = isTouch ? GHOST_RAIL_W / numCols : BAND_COL_W
        const isHovered = hoveredId === marker.id
        return (
          <div
            key={marker.id}
            className="absolute"
            // Above the scrubber so a band inside the viewport window stays
            // clickable/hoverable (matches the mockup's in-viewport hover).
            style={{ top, left, width, height, zIndex: 20, pointerEvents: 'auto' }}
            onPointerEnter={isTouch ? undefined : () => startHover(marker.id)}
            onPointerLeave={isTouch ? undefined : () => endHover(marker.id)}
          >
            <button
              type="button"
              aria-label={marker.name}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                onSelectLoop(marker.id)
              }}
              className="absolute inset-0"
              style={{
                backgroundColor: marker.color,
                opacity: isTouch ? 0.55 : 1,
                borderRadius: isTouch ? 2 : 2,
                cursor: 'pointer',
                boxShadow: marker.active
                  ? '0 0 0 1.5px rgba(255,255,255,0.9)'
                  : isHovered
                    ? '0 0 0 1.5px rgba(255,255,255,0.7), 0 0 8px rgba(0,0,0,0.18)'
                    : undefined,
              }}
            />
            {/* Chip — shown on hover OR when active; clickable to select the loop.
                Hover stays alive while the cursor moves from band → chip via the
                startHover/endHover delay approach. */}
            {(isHovered || marker.active) && (
              <button
                type="button"
                aria-label={marker.name}
                onPointerEnter={isTouch ? undefined : () => startHover(marker.id)}
                onPointerLeave={isTouch ? undefined : () => endHover(marker.id)}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); onSelectLoop(marker.id) }}
                className="absolute max-w-[180px] truncate whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-white"
                style={{
                  right: 'calc(100% + 6px)',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: marker.color,
                  textShadow: '0 1px 2px rgba(0,0,0,0.3)',
                  boxShadow: marker.active
                    ? '0 0 0 1.5px rgba(255,255,255,0.95), 0 1px 3px rgba(15,23,42,0.25)'
                    : '0 1px 3px rgba(15,23,42,0.2)',
                  cursor: 'pointer',
                  pointerEvents: 'auto',
                }}
              >
                {marker.name}
                <span
                  className="absolute top-1/2"
                  style={{
                    right: -4,
                    transform: 'translateY(-50%)',
                    width: 0,
                    height: 0,
                    borderTop: '4px solid transparent',
                    borderBottom: '4px solid transparent',
                    borderLeft: `5px solid ${marker.color}`,
                  }}
                />
              </button>
            )}
          </div>
        )
      })}

      {/* Viewport scrubber — deliberately differentiated from the white page
          cards: accent-tinted translucent fill + a bold accent border + grip. */}
      <div
        className="absolute right-0"
        style={{
          top: windowTop + 2,
          height: Math.max(8, windowHeight - 4),
          left: isTouch ? 0 : bandGutterW + BAND_GUTTER_PAD,
          zIndex: 10,
          pointerEvents: show ? 'auto' : 'none',
          boxSizing: 'border-box',
          background: isTouch ? 'rgba(0,0,0,0.18)' : 'rgba(79,127,122,0.14)',
          border: isTouch ? undefined : '1.5px solid #4F7F7A',
          borderRadius: isTouch ? 2 : 7,
          boxShadow: isTouch
            ? undefined
            : '0 2px 6px rgba(79,127,122,0.28), inset 0 0 0 1px rgba(255,255,255,0.5)',
          cursor: isTouch ? undefined : 'grab',
          touchAction: 'none',
        }}
        onPointerDown={onWindowPointerDown}
        onPointerMove={onWindowPointerMove}
        onPointerUp={onWindowPointerUp}
        onPointerCancel={onWindowPointerUp}
      >
        {/* grip (desktop) */}
        {!isTouch && (
          <div
            className="absolute left-1/2 top-1/2 flex flex-col gap-[2px]"
            style={{ transform: 'translate(-50%,-50%)' }}
          >
            <span style={{ width: 12, height: 1.5, background: '#4F7F7A', borderRadius: 1 }} />
            <span style={{ width: 12, height: 1.5, background: '#4F7F7A', borderRadius: 1 }} />
            <span style={{ width: 12, height: 1.5, background: '#4F7F7A', borderRadius: 1 }} />
          </div>
        )}
      </div>
    </div>
  )
}
