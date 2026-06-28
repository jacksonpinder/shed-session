import {
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from 'react'
import { Document, Page } from 'react-pdf'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import { detectSystems, isLikelyScanned, bandForY, type SystemBand } from '../lib/detectSystems'
import EdgeScrubberRail from './EdgeScrubberRail'
import AnnotationCanvas from './AnnotationCanvas'
import { AnnotationContext } from '../contexts/AnnotationContext'
import { packIntervals } from '../lib/assignLanes'

// Debug: overlay detected system bands on each page. Flip to true to tune.
const DEBUG_SYSTEMS = false
// Dev-only: expose the detector on window for quick per-page verification in the
// browser console (stripped from production builds).
if (import.meta.env.DEV && typeof window !== 'undefined') {
  const w = window as unknown as {
    __detectSystems?: typeof detectSystems
    __isLikelyScanned?: typeof isLikelyScanned
  }
  w.__detectSystems = detectSystems
  w.__isLikelyScanned = isLikelyScanned
}

// Fallback when no `pdfUrl` prop is supplied (single-song legacy / dev). Override
// with ?pdf=/other.pdf to test another score without overwriting the fixture.
const DEFAULT_PDF_URL =
  (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('pdf')) ||
  '/sheetmusic.pdf'
const RESIZE_DEBOUNCE_MS = 120
const MIN_ZOOM = 0.6
const MAX_ZOOM = 2
const DEFAULT_DESKTOP_ZOOM = 1.4
const ZOOM_STEP = 0.1
const SCROLL_PADDING_RATIO = 0.05
const SCROLL_PADDING_PX = 32
// Page-margin loop bars (the 90°-rotated rhyme of the edge-rail bands).
const PAGE_BAR_W = 6
// Gap between sub-lane bars — wide enough that the ~3.5px selected ring on one bar
// doesn't bleed into its neighbour.
const PAGE_BAR_GAP = 5
const PAGE_BAR_MIN_PX = 8
// Bars sit just OFF the page's left edge, in the margin.
const PAGE_BAR_OFFSET = 5
// Chip rests at its bar's top; only sticks once the bar scrolls within this many px
// of the viewport top (small, so chips stay top-aligned to their bars at rest).
const PAGE_CHIP_STICKY_TOP = 12
// When multiple chips are sticky at the top simultaneously, each one offsets by this
// amount so they stack vertically instead of physically overlapping. ~chip height + gap.
const CHIP_STACK_STEP = 22
// Chips float to the LEFT of their bar; the scroll handler appends an optional translateY
// for resting de-overlap, so this base must be shared between the handler and the render.
const CHIP_BASE_TRANSFORM = 'translateX(calc(-100% - 2px))'

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const getPageHeight = (page: HTMLElement) => {
  const rect = page.getBoundingClientRect()
  return rect.height || page.offsetHeight || 0
}

type PDFViewerProps = {
  scrollContainerRef?: MutableRefObject<HTMLDivElement | null>
  /** PDF source for the active song. Defaults to the legacy /sheetmusic.pdf. */
  pdfUrl?: string
  sheetMarkers?: SheetMarker[]
  onMarkerClick?: (loopId: string) => void
  onPageChange?: (page: number, numPages: number) => void
  onZoomStateChange?: (zoomOutDisabled: boolean, zoomInDisabled: boolean) => void
  /** Fired once when system bands are first available (PDF has rendered enough pages). */
  onSystemBandsReady?: () => void
  /** Permanent sync-anchor overlay for debugging the alignment (dev only). */
  syncAnchors?: SyncAnchorOverlay[]
}

/** One sync anchor positioned for the permanent debug overlay. */
export type SyncAnchorOverlay = {
  time: number
  page: number
  xWithinPageRatio?: number
  yWithinPageRatio: number
  /** The matched lyric (score) word. */
  text: string
  /** The Whisper word that matched it. */
  heard?: string
  confidence: number
}

export type SheetPosition = {
  page: number
  yWithinPagePx?: number
  yWithinPageRatio?: number
  scrollTop?: number
}

export type SheetMarker = {
  id: string
  name: string
  color: string
  sheetLink: SheetPosition
  /** Score position of the loop's END (timing-model resolved), when available.
   * Drives the proportional extent of the edge-rail band + page-margin bar. */
  sheetLinkEnd?: SheetPosition
  /** Active (selected) loop — page-margin bar shows a selection ring. */
  active?: boolean
  isDraft?: boolean
}

export type SyncHighlight = {
  page: number
  yWithinPageRatio: number
  text: string
  confidence: number
  time: number
}

export type PDFViewerHandle = {
  getSheetPosition: () => SheetPosition
  scrollToSheetPosition: (
    pos: SheetPosition,
    opts?: { behavior?: 'auto' | 'smooth' }
  ) => void
  setSyncHighlight: (h: SyncHighlight | null) => void
  /** Detected system bands per page (1-based), for Score Sync's system-top mapping. */
  getSystemBands: () => Record<number, SystemBand[]>
  zoomIn: () => void
  zoomOut: () => void
}

const useMediaQuery = (query: string) => {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined') {
      return false
    }
    return window.matchMedia(query).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    const mediaQueryList = window.matchMedia(query)
    const handleChange = (event: MediaQueryListEvent) => {
      setMatches(event.matches)
    }
    setMatches(mediaQueryList.matches)

    if (mediaQueryList.addEventListener) {
      mediaQueryList.addEventListener('change', handleChange)
      return () => mediaQueryList.removeEventListener('change', handleChange)
    }
    mediaQueryList.addListener(handleChange)
    return () => mediaQueryList.removeListener(handleChange)
  }, [query])

  return matches
}

const PDFViewer = forwardRef<PDFViewerHandle, PDFViewerProps>(function PDFViewer(
  { scrollContainerRef, pdfUrl = DEFAULT_PDF_URL, sheetMarkers, onMarkerClick, onPageChange, onZoomStateChange, onSystemBandsReady, syncAnchors }: PDFViewerProps,
  ref
) {
  const internalContainerRef = useRef<HTMLDivElement | null>(null)
  const containerRef = scrollContainerRef ?? internalContainerRef
  const containerWidthRef = useRef(0)
  const resizeTimeoutRef = useRef<number | null>(null)
  const pageRefs = useRef(new Map<number, HTMLDivElement>())
  const observerRef = useRef<IntersectionObserver | null>(null)

  const [containerWidth, setContainerWidth] = useState(0)
  const [pageWidth, setPageWidth] = useState<number | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [syncHighlight, setSyncHighlight] = useState<SyncHighlight | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const currentPageRef = useRef(1)
  const [zoom, setZoom] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const [systemBands, setSystemBands] = useState<Record<number, SystemBand[]>>({})
  const systemBandsRef = useRef<Record<number, SystemBand[]>>({})
  const systemBandsReadyFiredRef = useRef(false)
  // Pages whose canvas has finished rendering — once all pages are painted,
  // getSystemBands() returns a COMPLETE map, so we fire onSystemBandsReady then
  // (the production trigger; the systemBands-state effect below is debug-only).
  const renderedPagesRef = useRef<Set<number>>(new Set())
  // Chip DOM refs — direct DOM updates on scroll (no React state) for dynamic stacking.
  const chipRefsMapRef = useRef<Map<string, HTMLSpanElement>>(new Map())
  const updateChipSlotsRef = useRef<(() => void) | null>(null)
  // In-flight handle for the custom fast scroll tween (animateScrollTo). Bounded and
  // self-terminating; cancelled on each new call and on unmount so it can't leak.
  const scrollAnimRef = useRef<number | null>(null)


  const isTouch = useMediaQuery('(max-width: 1024px), (pointer: coarse)')

  useEffect(() => {
    const element = containerRef.current
    if (!element) {
      return
    }

    const updateWidth = (nextWidth: number) => {
      const rounded = Math.round(nextWidth)
      if (!rounded || rounded === containerWidthRef.current) {
        return
      }
      containerWidthRef.current = rounded
      setContainerWidth(rounded)
    }

    const scheduleUpdate = (nextWidth: number) => {
      if (resizeTimeoutRef.current !== null) {
        window.clearTimeout(resizeTimeoutRef.current)
      }
      resizeTimeoutRef.current = window.setTimeout(() => {
        updateWidth(nextWidth)
      }, RESIZE_DEBOUNCE_MS)
    }

    updateWidth(element.getBoundingClientRect().width)

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver((entries) => {
        const entry = entries[0]
        if (!entry) {
          return
        }
        scheduleUpdate(entry.contentRect.width)
      })
      observer.observe(element)
      return () => {
        observer.disconnect()
        if (resizeTimeoutRef.current !== null) {
          window.clearTimeout(resizeTimeoutRef.current)
        }
      }
    }

    const handleResize = () => scheduleUpdate(element.getBoundingClientRect().width)
    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
      if (resizeTimeoutRef.current !== null) {
        window.clearTimeout(resizeTimeoutRef.current)
      }
    }
  }, [])

  const handleDocumentLoadSuccess = useCallback((documentProxy: PDFDocumentProxy) => {
    setError(null)
    // New document → reset the render tally so the bands-ready signal re-fires.
    renderedPagesRef.current = new Set()
    systemBandsReadyFiredRef.current = false
    setNumPages(documentProxy.numPages)
    const next =
      currentPageRef.current > documentProxy.numPages ? 1 : currentPageRef.current
    currentPageRef.current = next
    setCurrentPage(next)
    onPageChange?.(next, documentProxy.numPages)
  }, [onPageChange])

  const handleDocumentLoadError = useCallback((loadError: Error) => {
    setError(loadError.message || 'Failed to load PDF')
  }, [])

  const handlePageLoadSuccess = useCallback((page: PDFPageProxy) => {
    const viewport = page.getViewport({ scale: 1 })
    const nextWidth = viewport.width
    setError(null)
    setPageWidth((current) => {
      if (current && Math.abs(current - nextWidth) < 0.5) {
        return current
      }
      return nextWidth
    })
  }, [])

  const handlePageLoadError = useCallback((pageError: Error) => {
    setError(pageError.message || 'Failed to load PDF page')
  }, [])

  const handlePageRenderError = useCallback((renderError: Error) => {
    setError(renderError.message || 'Failed to render PDF page')
  }, [])

  // Fire onSystemBandsReady() once every page's canvas has painted. At that point
  // getSystemBands() returns a complete bands map, so consumers (PlayerDock's timing
  // model) rebuild loop-marker positions from the full document — not a partial map.
  const handlePageRendered = useCallback(
    (pageNumber: number) => {
      renderedPagesRef.current.add(pageNumber)
      if (
        !systemBandsReadyFiredRef.current &&
        numPages > 0 &&
        renderedPagesRef.current.size >= numPages
      ) {
        systemBandsReadyFiredRef.current = true
        onSystemBandsReady?.()
      }
    },
    [numPages, onSystemBandsReady]
  )

  const fitWidthScale = useMemo(() => {
    if (!containerWidth || !pageWidth) {
      return 1
    }
    return containerWidth / pageWidth
  }, [containerWidth, pageWidth])

  const baseScale = useMemo(() => Math.min(1, fitWidthScale), [fitWidthScale])
  const baseZoom = isTouch ? 1 : DEFAULT_DESKTOP_ZOOM
  const zoomedScale = baseScale * baseZoom * zoom
  const effectiveScale = useMemo(() => {
    if (!fitWidthScale) {
      return zoomedScale
    }
    return Math.min(zoomedScale, fitWidthScale)
  }, [fitWidthScale, zoomedScale])

  const canZoom = Boolean(pageWidth) && !error
  const zoomOutDisabled = !canZoom || zoom <= MIN_ZOOM + 0.001
  const zoomInDisabled = !canZoom || zoom >= MAX_ZOOM - 0.001
  const devicePixelRatio = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
  // Annotation write mode — read defensively so the viewer still works if no
  // AnnotationProvider is mounted (context defaults to null).
  const annoCtx = useContext(AnnotationContext)
  const writeMode = annoCtx?.writeMode ?? false
  const pages = useMemo(() => Array.from({ length: numPages }, (_, index) => index + 1), [numPages])
  // Page-margin loop bars: a loop becomes a vertical bar spanning its start→end Y
  // on each page it touches (first page: start→bottom, interior: full, last:
  // top→end). Overlapping bars on a page are packed into sub-lanes so they don't
  // occlude — the 90°-rotated rhyme of the edge-rail bands. Ratios here are
  // page-height-independent; converted to px at render time.
  const marginBars = useMemo(() => {
    type Bar = {
      marker: SheetMarker
      startPage: number
      startRatio: number
      endPage: number
      endRatio: number
      subLane: number
      /** Bar stacking z (bars layer). */
      z: number
      /** Chip stacking z (chip layer, always above all bars). */
      chipZ: number
      /** Position in the input (audio-timeline) order — drives chip stack offset. */
      audioIdx: number
    }
    if (!sheetMarkers) return [] as Bar[]
    const bars: Bar[] = sheetMarkers.map((marker) => {
      const startPage = marker.sheetLink.page
      const startRatio = Number.isFinite(marker.sheetLink.yWithinPageRatio)
        ? (marker.sheetLink.yWithinPageRatio as number)
        : 0
      const end = marker.sheetLinkEnd
      let endPage = end?.page ?? startPage
      let endRatio = Number.isFinite(end?.yWithinPageRatio)
        ? (end!.yWithinPageRatio as number)
        : startRatio
      if (!end || endPage < startPage || (endPage === startPage && endRatio <= startRatio)) {
        endPage = startPage
        endRatio = startRatio // point loop → min-height bar at render
      }
      return { marker, startPage, startRatio, endPage, endRatio, subLane: 0, z: 0, chipZ: 0, audioIdx: 0 }
    })
    // One global sub-lane assignment (page-major coordinate) so a loop keeps the
    // same column on every page it crosses — no per-page swapping.
    const lanes = packIntervals(
      bars.map((b) => ({
        id: b.marker.id,
        start: b.startPage + b.startRatio,
        end: Math.max(b.endPage + b.endRatio, b.startPage + b.startRatio + 0.001),
      }))
    )
    // Use INPUT ARRAY ORDER (= audio start-time order) for z: the loop that starts
    // earlier in the song gets higher z, matching the user's mental model.
    // chipZ is in a separate band (40+) so chips always paint above all bars (20-).
    bars.forEach((b, audioIdx) => {
      b.subLane = lanes[b.marker.id] ?? 0
      b.z = 20 - audioIdx
      b.chipZ = 40 - audioIdx
      b.audioIdx = audioIdx
    })
    return bars
  }, [sheetMarkers])

  // Stable refs updated synchronously each render so scroll effects always see the
  // latest values without needing to be re-registered as dependencies.
  const marginBarsRef = useRef(marginBars)
  marginBarsRef.current = marginBars
  // docYForPositionRef is set after docYForPosition is defined below.
  const docYForPositionRef = useRef<null | ((pos: SheetPosition) => number | null)>(null)

  const syncAnchorsByPage = useMemo(() => {
    const map = new Map<number, SyncAnchorOverlay[]>()
    if (!syncAnchors) {
      return map
    }
    syncAnchors.forEach((anchor) => {
      const list = map.get(anchor.page) ?? []
      list.push(anchor)
      map.set(anchor.page, list)
    })
    return map
  }, [syncAnchors])

  const resolvePageElement = useCallback(
    (pageNumber: number, container: HTMLElement) =>
      pageRefs.current.get(pageNumber) ??
      container.querySelector<HTMLElement>(`[data-page-number="${pageNumber}"]`),
    []
  )

  const getPageOffsetTop = useCallback((page: HTMLElement, container: HTMLElement) => {
    const pageRect = page.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()
    return pageRect.top - containerRect.top + container.scrollTop
  }, [])

  const resolveYWithinPagePx = useCallback((pos: SheetPosition, page: HTMLElement | null) => {
    if (page) {
      const pageHeight = getPageHeight(page)
      if (Number.isFinite(pos.yWithinPageRatio) && pageHeight > 0) {
        return clamp((pos.yWithinPageRatio as number) * pageHeight, 0, pageHeight)
      }
    }
    const fallback = Number.isFinite(pos.yWithinPagePx)
      ? (pos.yWithinPagePx as number)
      : Number.isFinite(pos.scrollTop)
        ? (pos.scrollTop as number)
        : 0
    return Math.max(0, fallback)
  }, [])

  const getSheetPosition = useCallback(() => {
    const container = containerRef.current
    const pageNumber = currentPage || 1
    if (!container) {
      return { page: pageNumber, yWithinPagePx: 0 }
    }
    const page = resolvePageElement(pageNumber, container)
    if (!page) {
      return { page: pageNumber, yWithinPagePx: Math.max(0, container.scrollTop) }
    }
    const pageTop = getPageOffsetTop(page, container)
    const pageHeight = getPageHeight(page)
    const yWithinPagePx = Math.max(0, container.scrollTop - pageTop)
    return {
      page: pageNumber,
      yWithinPagePx,
      yWithinPageRatio: pageHeight > 0 ? clamp(yWithinPagePx / pageHeight, 0, 1) : undefined,
    }
  }, [containerRef, currentPage, getPageOffsetTop, resolvePageElement])

  const cancelScrollAnim = useCallback(() => {
    if (scrollAnimRef.current != null) {
      window.cancelAnimationFrame(scrollAnimRef.current)
      scrollAnimRef.current = null
    }
  }, [])

  // Custom fast scroll: a fixed-duration easeInOutCubic tween, so near and far jumps
  // feel equally snappy (native `behavior:'smooth'` drags on long, cross-page jumps).
  // Cancels any in-flight tween first, so rapid seeks retarget cleanly.
  const animateScrollTo = useCallback(
    (targetTop: number, duration = 320) => {
      const container = containerRef.current
      if (!container) return
      cancelScrollAnim()
      const startTop = container.scrollTop
      const delta = targetTop - startTop
      if (Math.abs(delta) < 1) {
        container.scrollTop = targetTop
        return
      }
      const start = typeof performance !== 'undefined' ? performance.now() : Date.now()
      const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
      const step = (now: number) => {
        const p = Math.min(1, (now - start) / duration)
        container.scrollTop = startTop + delta * ease(p)
        if (p < 1) {
          scrollAnimRef.current = window.requestAnimationFrame(step)
        } else {
          scrollAnimRef.current = null
        }
      }
      scrollAnimRef.current = window.requestAnimationFrame(step)
    },
    [containerRef, cancelScrollAnim]
  )

  const scrollToSheetPosition = useCallback(
    (pos: SheetPosition, opts?: { behavior?: 'auto' | 'smooth' }) => {
      const container = containerRef.current
      if (!container) {
        return
      }
      const pageNumber = Number.isFinite(pos.page) ? pos.page : currentPage || 1
      const safePage = numPages ? Math.min(Math.max(1, pageNumber), numPages) : Math.max(1, pageNumber)
      const page = resolvePageElement(safePage, container)
      const offset = resolveYWithinPagePx(pos, page)
      const pageRect = page?.getBoundingClientRect()
      const visualOffset =
        pageRect?.height && pageRect.height > 0
          ? Math.round(pageRect.height * SCROLL_PADDING_RATIO)
          : SCROLL_PADDING_PX
      const top = page ? getPageOffsetTop(page, container) + offset - visualOffset : offset - visualOffset
      const finalTop = Math.max(0, top)
      if ((opts?.behavior ?? 'auto') === 'smooth') {
        animateScrollTo(finalTop)
      } else {
        cancelScrollAnim()
        container.scrollTop = finalTop
      }
    },
    [animateScrollTo, cancelScrollAnim, containerRef, currentPage, getPageOffsetTop, numPages, resolvePageElement, resolveYWithinPagePx]
  )

  // Cancel any in-flight scroll tween on unmount.
  useEffect(() => cancelScrollAnim, [cancelScrollAnim])

  // Absolute scroll-Y (within the scroll container) of a sheet position — the same
  // page-offset + within-page math scrollToSheetPosition uses, minus the padding.
  // The follow loop interpolates between two of these.
  const docYForPosition = useCallback(
    (pos: SheetPosition): number | null => {
      const container = containerRef.current
      if (!container) return null
      const pageNumber = Number.isFinite(pos.page) ? pos.page : currentPage || 1
      const safePage = numPages ? Math.min(Math.max(1, pageNumber), numPages) : Math.max(1, pageNumber)
      const page = resolvePageElement(safePage, container)
      const offset = resolveYWithinPagePx(pos, page)
      return page ? getPageOffsetTop(page, container) + offset : offset
    },
    [containerRef, currentPage, getPageOffsetTop, numPages, resolvePageElement, resolveYWithinPagePx]
  )

  // Keep the docY ref current so the scroll effect always calls the latest version.
  docYForPositionRef.current = docYForPosition

  // Re-run chip slot assignment whenever the loop set changes (no scroll needed).
  useEffect(() => {
    updateChipSlotsRef.current?.()
  }, [marginBars])

  // Direct-DOM chip slot updater — reads marginBarsRef + docYForPositionRef (stable
  // refs updated inline each render) and writes style.top on each chip span element
  // directly, bypassing React re-renders entirely. A bar is "active" when its top has
  // scrolled above the viewport; chips are assigned sequential slots so they stack.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const updateChipSlots = () => {
      const st = container.scrollTop
      const bars = marginBarsRef.current
      const getDocY = docYForPositionRef.current
      if (!getDocY) return

      const stickyLine = st + PAGE_CHIP_STICKY_TOP
      // Classify each loop by its TRUE span against the viewport:
      // - PINNED:  viewport is inside the loop (start at/above the sticky line, end still
      //            below the top) → chip sticks at the top, stacked with other pinned chips.
      // - RESTING: loop is approaching from below (start below the sticky line) → chip sits
      //            at its bar top, nudged down only to avoid colliding with a neighbour.
      // - else:    loop has fully scrolled past (end above the top) → leave it alone.
      const pinned: { bar: (typeof bars)[number]; docTop: number }[] = []
      const resting: { bar: (typeof bars)[number]; docTop: number }[] = []
      for (const bar of bars) {
        const docTop = getDocY(bar.marker.sheetLink)
        if (docTop == null) continue
        const docEnd = bar.marker.sheetLinkEnd ? getDocY(bar.marker.sheetLinkEnd) : docTop
        const bottom = docEnd ?? docTop
        if (docTop <= stickyLine && bottom >= st) {
          pinned.push({ bar, docTop })
        } else if (docTop > stickyLine) {
          resting.push({ bar, docTop })
        }
      }

      const chipMap = chipRefsMapRef.current

      // Pinned chips: sequential slots in start-time (audioIdx) order, no vertical nudge.
      pinned.sort((a, b) => a.bar.audioIdx - b.bar.audioIdx)
      pinned.forEach(({ bar }, slotIdx) => {
        const elem = chipMap.get(bar.marker.id)
        if (!elem) return
        elem.style.top = `${PAGE_CHIP_STICKY_TOP + slotIdx * CHIP_STACK_STEP}px`
        elem.style.transform = CHIP_BASE_TRANSFORM
      })

      // Resting chips: greedily push down any that lands within one step of the previous,
      // applied as a translateY (purely visual — sticky stays disengaged below the line).
      resting.sort((a, b) => a.docTop - b.docTop)
      let prevY = -Infinity
      for (const { bar, docTop } of resting) {
        const y = Math.max(docTop, prevY + CHIP_STACK_STEP)
        prevY = y
        const elem = chipMap.get(bar.marker.id)
        if (!elem) continue
        elem.style.transform = `${CHIP_BASE_TRANSFORM} translateY(${y - docTop}px)`
      }
    }

    updateChipSlotsRef.current = updateChipSlots
    container.addEventListener('scroll', updateChipSlots, { passive: true })
    updateChipSlots()
    return () => {
      container.removeEventListener('scroll', updateChipSlots)
      updateChipSlotsRef.current = null
    }
  }, [containerRef])

  const setPageRef = useCallback(
    (pageNumber: number) => (node: HTMLDivElement | null) => {
      const observer = observerRef.current
      const nodes = pageRefs.current
      if (node) {
        nodes.set(pageNumber, node)
        if (observer) {
          observer.observe(node)
        }
        return
      }
      const existing = nodes.get(pageNumber)
      if (existing && observer) {
        observer.unobserve(existing)
      }
      nodes.delete(pageNumber)
    },
    []
  )

  // Debug overlay only: eagerly computes bands for every page so they can be
  // drawn. Real (Score Sync) consumers use getSystemBands() which computes
  // lazily on demand — so a normal load does NO detection work.
  useEffect(() => {
    if (!DEBUG_SYSTEMS || numPages === 0) {
      return
    }
    let cancelled = false
    let attempts = 0
    let timeoutId: number | null = null
    const compute = () => {
      const next: Record<number, SystemBand[]> = {}
      let pending = false
      pageRefs.current.forEach((page, pageNumber) => {
        const canvas = page.querySelector('canvas')
        if (!canvas || !canvas.width) {
          pending = true
          return
        }
        next[pageNumber] = detectSystems(canvas).bands
      })
      if (cancelled) {
        return
      }
      setSystemBands(next)
      // Canvases paint after this effect; retry until they're ready.
      if ((pending || Object.keys(next).length < numPages) && attempts < 20) {
        attempts += 1
        timeoutId = window.setTimeout(compute, 200)
      }
    }
    timeoutId = window.setTimeout(compute, 100)
    return () => {
      cancelled = true
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [effectiveScale, numPages, pageWidth])

  // Fire onSystemBandsReady once when bands are first available so callers can
  // rebuild any derived state (e.g. loop marker positions) that needs system geometry.
  useEffect(() => {
    if (!systemBandsReadyFiredRef.current && Object.keys(systemBands).length > 0 && onSystemBandsReady) {
      systemBandsReadyFiredRef.current = true
      onSystemBandsReady()
    }
  }, [systemBands, onSystemBandsReady])

  useEffect(() => {
    const root = containerRef.current
    if (!root || numPages === 0) {
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        let nextPage: number | null = null
        let bestRatio = 0
        entries.forEach((entry) => {
          if (!entry.isIntersecting) {
            return
          }
          if (entry.intersectionRatio < bestRatio) {
            return
          }
          const target = entry.target as HTMLElement
          const pageNumber = Number(target.dataset.pageNumber)
          if (!Number.isFinite(pageNumber)) {
            return
          }
          bestRatio = entry.intersectionRatio
          nextPage = pageNumber
        })
        if (nextPage !== null && nextPage !== currentPageRef.current) {
          currentPageRef.current = nextPage
          setCurrentPage(nextPage)
          onPageChange?.(nextPage, numPages)
        }
      },
      { root, threshold: [0, 0.25, 0.5, 0.75, 1] }
    )

    observerRef.current = observer
    pageRefs.current.forEach((node) => observer.observe(node))

    return () => {
      observer.disconnect()
      observerRef.current = null
    }
  }, [numPages, onPageChange])

  const handleZoomOut = () => {
    setZoom((current) => clamp(Math.round((current - ZOOM_STEP) * 100) / 100, MIN_ZOOM, MAX_ZOOM))
  }

  const handleZoomIn = () => {
    setZoom((current) => clamp(Math.round((current + ZOOM_STEP) * 100) / 100, MIN_ZOOM, MAX_ZOOM))
  }

  // Lazy + cached: compute bands only for pages not already in the cache, and
  // only when first asked (never on a normal load). Band ratios are scale-
  // invariant, so the cache survives zoom; pages whose canvas wasn't painted yet
  // are filled in on a later call (self-healing).
  const getSystemBands = useCallback(() => {
    const cache = systemBandsRef.current
    pageRefs.current.forEach((page, pageNumber) => {
      if (cache[pageNumber]) {
        return
      }
      const canvas = page.querySelector('canvas')
      if (canvas && canvas.width) {
        cache[pageNumber] = detectSystems(canvas).bands
      }
    })
    return cache
  }, [])

  useImperativeHandle(
    ref,
    () => ({
      getSheetPosition,
      scrollToSheetPosition,
      getSystemBands,
      setSyncHighlight,
      zoomIn: handleZoomIn,
      zoomOut: handleZoomOut,
    }),
    [getSheetPosition, scrollToSheetPosition, getSystemBands, setSyncHighlight]
  )

  useEffect(() => {
    onZoomStateChange?.(zoomOutDisabled, zoomInDisabled)
  }, [onZoomStateChange, zoomOutDisabled, zoomInDisabled])

  return (
    <section className="relative h-full w-full">
      <div
        ref={containerRef}
        className={`no-scrollbar relative h-full w-full overflow-y-auto overflow-x-hidden touch-pan-y touch-pinch-zoom${
          writeMode ? ' bg-amber-100' : ''
        }`}
      >
        {error ? (
          <div className="flex min-h-full items-center justify-center text-sm text-red-600">
            {error}
          </div>
        ) : (
          <Document
            file={pdfUrl}
            onLoadSuccess={handleDocumentLoadSuccess}
            onLoadError={handleDocumentLoadError}
            loading={
              <div className="flex min-h-full items-center justify-center text-sm text-slate-500">
                Loading PDF...
              </div>
            }
          >
            <div className="flex flex-col items-center">
              {pages.map((pageNumber) => {
                const barsStartingHere = marginBars.filter((b) => b.startPage === pageNumber)
                const syncAnchorsForPage = syncAnchorsByPage.get(pageNumber) ?? []
                const pageNode = pageRefs.current.get(pageNumber) ?? null
                return (
                  <div key={pageNumber} className="flex w-full justify-center">
                    <div
                      ref={setPageRef(pageNumber)}
                      data-page-number={pageNumber}
                      className="relative"
                      style={pageNumber > 1 ? { marginTop: '6px' } : undefined}
                    >
                      <Page
                        pageNumber={pageNumber}
                        scale={effectiveScale}
                        devicePixelRatio={devicePixelRatio}
                        renderTextLayer={false}
                        renderAnnotationLayer={false}
                        onLoadSuccess={handlePageLoadSuccess}
                        onLoadError={handlePageLoadError}
                        onRenderSuccess={() => handlePageRendered(pageNumber)}
                        onRenderError={handlePageRenderError}
                      />
                      <AnnotationCanvas
                        page={pageNumber}
                        effectiveScale={effectiveScale}
                        devicePixelRatio={devicePixelRatio}
                        scrollContainer={containerRef.current}
                        onRequestZoomIn={handleZoomIn}
                        onRequestZoomOut={handleZoomOut}
                      />
                      {DEBUG_SYSTEMS &&
                        (systemBands[pageNumber] ?? []).map((band, index) => {
                          const pageHeight = pageNode ? getPageHeight(pageNode) : 0
                          if (!pageHeight) {
                            return null
                          }
                          return (
                            <div key={`band-${index}`} className="pointer-events-none absolute inset-x-0 z-20">
                              <div
                                className="absolute inset-x-0 border-y-2 border-emerald-500 bg-emerald-400/15"
                                style={{
                                  top: band.topRatio * pageHeight,
                                  height: (band.bottomRatio - band.topRatio) * pageHeight,
                                }}
                              />
                              <div
                                className="absolute inset-x-0 border-t-2 border-dashed border-rose-500"
                                style={{ top: band.firstLineRatio * pageHeight }}
                              />
                            </div>
                          )
                        })}
                      {import.meta.env.DEV && syncHighlight?.page === pageNumber && (() => {
                        const pageHeight = pageNode ? getPageHeight(pageNode) : 0
                        if (!pageHeight) return null
                        const bands = systemBandsRef.current[pageNumber]
                        const band = bands ? bandForY(bands, syncHighlight.yWithinPageRatio) : null
                        const topRatio = band ? band.topRatio : Math.max(0, syncHighlight.yWithinPageRatio - 0.06)
                        const botRatio = band ? band.bottomRatio : Math.min(1, syncHighlight.yWithinPageRatio + 0.06)
                        return (
                          <div className="pointer-events-none absolute inset-x-0 z-30">
                            <div
                              className="absolute inset-x-0 bg-amber-400/25 border-y-2 border-amber-500"
                              style={{ top: topRatio * pageHeight, height: (botRatio - topRatio) * pageHeight }}
                            />
                            <div
                              className="absolute right-2 flex items-center gap-1.5 rounded-sm bg-amber-500 px-1.5 py-0.5 text-[10px] font-mono font-semibold text-white"
                              style={{ top: topRatio * pageHeight + 2 }}
                            >
                              <span>{syncHighlight.text}</span>
                              <span className="opacity-70">{syncHighlight.time.toFixed(2)}s</span>
                              <span className="opacity-60">{Math.round(syncHighlight.confidence * 100)}%</span>
                            </div>
                          </div>
                        )
                      })()}
                      {syncAnchorsForPage.length > 0 && (() => {
                        const pageHeight = pageNode ? getPageHeight(pageNode) : 0
                        const pageW = pageNode ? pageNode.getBoundingClientRect().width : 0
                        if (!pageHeight || !pageW) return null
                        return (
                          <div className="absolute inset-0 z-20">
                            {syncAnchorsForPage.map((anchor, index) => {
                              const x = (anchor.xWithinPageRatio ?? 0.5) * pageW
                              const y = anchor.yWithinPageRatio * pageHeight
                              const conf = anchor.confidence
                              const color =
                                conf >= 0.95 ? '#059669' : conf >= 0.85 ? '#d97706' : '#e11d48'
                              const mismatch =
                                anchor.heard &&
                                anchor.heard.replace(/[^a-z]/gi, '').toLowerCase() !==
                                  anchor.text.replace(/[^a-z]/gi, '').toLowerCase()
                              return (
                                <div
                                  key={index}
                                  className="group absolute -translate-y-1/2 leading-none"
                                  style={{ left: x, top: y }}
                                  title={`${anchor.time.toFixed(2)}s  heard "${anchor.heard ?? '?'}" → score "${anchor.text}"  (conf ${conf.toFixed(2)}, p${anchor.page})`}
                                >
                                  <div
                                    className="h-1.5 w-1.5 rounded-full ring-1 ring-white"
                                    style={{ backgroundColor: color }}
                                  />
                                  <div
                                    className="pointer-events-none absolute left-2 top-1/2 flex -translate-y-1/2 items-center gap-0.5 whitespace-nowrap rounded-sm bg-white/85 px-0.5 font-mono text-[8px] font-semibold shadow-sm ring-1 group-hover:bg-white group-hover:text-[10px] group-hover:z-50"
                                    style={{ color, ['--tw-ring-color' as string]: color }}
                                  >
                                    <span>{anchor.time.toFixed(1)}</span>
                                    <span className={mismatch ? 'underline decoration-rose-500 decoration-wavy' : ''}>
                                      {anchor.heard ?? '?'}
                                    </span>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        )
                      })()}
                      {(() => {
                        const pageHeight = pageNode ? getPageHeight(pageNode) : 0
                        if (!pageHeight) return null
                        const barGeom = barsStartingHere.map((bar) => {
                          const m = bar.marker
                          const topPx = Math.max(0, bar.startRatio * pageHeight)
                          const docTop = docYForPosition(m.sheetLink)
                          const docEnd = m.sheetLinkEnd ? docYForPosition(m.sheetLinkEnd) : docTop
                          const spanPx =
                            docTop != null && docEnd != null
                              ? docEnd - docTop
                              : (bar.endRatio - bar.startRatio) * pageHeight
                          const height = Math.max(PAGE_BAR_MIN_PX, spanPx)
                          const right = PAGE_BAR_OFFSET + bar.subLane * (PAGE_BAR_W + PAGE_BAR_GAP)
                          // Wrapper = the loop's true span (with a small floor so even a
                          // min-height bar gives the chip enough range to engage one step).
                          // This makes CSS sticky release the chip exactly as the loop's end
                          // scrolls past the top — matching the span test in updateChipSlots.
                          const wrapperH = Math.max(height, PAGE_CHIP_STICKY_TOP + CHIP_STACK_STEP)
                          return { bar, m, topPx, height, wrapperH, right }
                        })
                        return (
                          <>
                            {/* Phase 1: Bars — clickable colored rectangles, lower z. */}
                            {barGeom.map(({ bar, m, topPx, height, right }) => (
                              <button
                                key={`bar-${m.id}`}
                                type="button"
                                aria-label={m.name}
                                className="absolute"
                                style={{
                                  top: topPx,
                                  right: `calc(100% + ${right}px)`,
                                  width: PAGE_BAR_W,
                                  height,
                                  zIndex: bar.z,
                                  backgroundColor: m.color ?? '#94a3b8',
                                  borderRadius: 3,
                                  opacity: m.isDraft ? 0.6 : 1,
                                  boxShadow: m.active
                                    ? '0 0 0 2px rgba(255,255,255,0.95), 0 0 0 3.5px rgba(15,23,42,0.18)'
                                    : undefined,
                                  transition: 'box-shadow 80ms ease-out',
                                }}
                                onMouseEnter={(e) => {
                                  const btn = e.currentTarget
                                  btn.style.boxShadow = '0 0 0 1.5px rgba(255,255,255,0.7), 0 0 8px rgba(0,0,0,0.18)'
                                }}
                                onMouseLeave={(e) => {
                                  const btn = e.currentTarget
                                  btn.style.boxShadow = m.active
                                    ? '0 0 0 2px rgba(255,255,255,0.95), 0 0 0 3.5px rgba(15,23,42,0.18)'
                                    : 'none'
                                }}
                                onClick={(event) => {
                                  event.stopPropagation()
                                  onMarkerClick?.(m.id)
                                }}
                              />
                            ))}
                            {/* Phase 2: Chips — rendered separately (higher chipZ than all
                                bars) so chips always paint above bars regardless of loop
                                order. `position: sticky` + direct style.top updates via the
                                scroll effect (no React state) give smooth stacking without
                                re-renders. Wrapper is taller than the bar to give the sticky
                                chip enough range to actually engage. */}
                            {barGeom.map(({ bar, m, topPx, wrapperH, right }) => (
                              <div
                                key={`chip-${m.id}`}
                                className="pointer-events-none absolute overflow-visible"
                                style={{
                                  top: topPx,
                                  right: `calc(100% + ${right}px)`,
                                  width: PAGE_BAR_W,
                                  height: wrapperH,
                                  zIndex: bar.chipZ,
                                }}
                              >
                                <span
                                  ref={(el) => {
                                    if (el) chipRefsMapRef.current.set(m.id, el)
                                    else chipRefsMapRef.current.delete(m.id)
                                  }}
                                  className="pointer-events-auto max-w-[160px] truncate whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-white"
                                  style={{
                                    position: 'sticky',
                                    // First-paint fallbacks; updateChipSlots reconciles top
                                    // (pinned slot) and transform (resting nudge) on mount + scroll.
                                    top: PAGE_CHIP_STICKY_TOP,
                                    transform: CHIP_BASE_TRANSFORM,
                                    display: 'inline-block',
                                    backgroundColor: m.color ?? '#94a3b8',
                                    textShadow: '0 1px 2px rgba(0,0,0,0.3)',
                                    boxShadow: m.active
                                      ? '0 0 0 1.5px rgba(255,255,255,0.95), 0 1px 3px rgba(15,23,42,0.25)'
                                      : '0 1px 3px rgba(15,23,42,0.18)',
                                    cursor: 'pointer',
                                    transition: 'top 120ms ease-out, transform 120ms ease-out, box-shadow 80ms ease-out',
                                  }}
                                  onMouseEnter={(e) => {
                                    const span = e.currentTarget
                                    span.style.boxShadow = '0 0 0 1.5px rgba(255,255,255,0.7), 0 0 8px rgba(0,0,0,0.18)'
                                  }}
                                  onMouseLeave={(e) => {
                                    const span = e.currentTarget
                                    span.style.boxShadow = m.active
                                      ? '0 0 0 1.5px rgba(255,255,255,0.95), 0 1px 3px rgba(15,23,42,0.25)'
                                      : '0 1px 3px rgba(15,23,42,0.18)'
                                  }}
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    onMarkerClick?.(m.id)
                                  }}
                                >
                                  {m.name}
                                </span>
                              </div>
                            ))}
                          </>
                        )
                      })()}
                    </div>
                  </div>
                )
              })}
            </div>
          </Document>
        )}
      </div>
      {!error && (
        <EdgeScrubberRail
          containerRef={containerRef}
          markers={sheetMarkers ?? []}
          getDocY={docYForPosition}
          numPages={numPages}
          effectiveScale={effectiveScale}
          isTouch={isTouch}
          onSelectLoop={(id) => onMarkerClick?.(id)}
        />
      )}
    </section>
  )
})

export default PDFViewer
