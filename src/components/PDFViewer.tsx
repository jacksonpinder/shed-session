import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from 'react'
import { AudioLines } from 'lucide-react'
import { Document, Page } from 'react-pdf'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'

const PDF_URL = '/sheetmusic.pdf'
const RESIZE_DEBOUNCE_MS = 120
const MIN_ZOOM = 0.6
const MAX_ZOOM = 2
const DEFAULT_DESKTOP_ZOOM = 1.4
const ZOOM_STEP = 0.1
const SCROLL_PADDING_RATIO = 0.05
const SCROLL_PADDING_PX = 32

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const getPageHeight = (page: HTMLElement) => {
  const rect = page.getBoundingClientRect()
  return rect.height || page.offsetHeight || 0
}

type PDFViewerProps = {
  scrollContainerRef?: MutableRefObject<HTMLDivElement | null>
  sheetMarkers?: SheetMarker[]
  onMarkerClick?: (loopId: string) => void
  onPageChange?: (page: number, numPages: number) => void
  onZoomStateChange?: (zoomOutDisabled: boolean, zoomInDisabled: boolean) => void
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
  isDraft?: boolean
}

export type PDFViewerHandle = {
  getSheetPosition: () => SheetPosition
  scrollToSheetPosition: (
    pos: SheetPosition,
    opts?: { behavior?: 'auto' | 'smooth' }
  ) => void
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
  { scrollContainerRef, sheetMarkers, onMarkerClick, onPageChange, onZoomStateChange }: PDFViewerProps,
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
  const [currentPage, setCurrentPage] = useState(1)
  const currentPageRef = useRef(1)
  const [zoom, setZoom] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const [markerOffsets, setMarkerOffsets] = useState<Record<string, number>>({})

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
  const pages = useMemo(() => Array.from({ length: numPages }, (_, index) => index + 1), [numPages])
  const markersByPage = useMemo(() => {
    const map = new Map<number, SheetMarker[]>()
    if (!sheetMarkers) {
      return map
    }
    sheetMarkers.forEach((marker) => {
      const list = map.get(marker.sheetLink.page) ?? []
      list.push(marker)
      map.set(marker.sheetLink.page, list)
    })
    return map
  }, [sheetMarkers])

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
      container.scrollTo({
        top: Math.max(0, top),
        behavior: opts?.behavior ?? 'auto',
      })
    },
    [containerRef, currentPage, getPageOffsetTop, numPages, resolvePageElement, resolveYWithinPagePx]
  )

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

  useEffect(() => {
    if (!sheetMarkers || sheetMarkers.length === 0) {
      setMarkerOffsets({})
      return
    }
    let rafId = 0
    let cancelled = false
    const candidates = [-40, -32, -24, -16, -8, 0, 8, 12]
    const sampleX = 12
    const sampleWidth = 18
    const sampleHeight = 18
    const computeOffsets = () => {
      const nextOffsets: Record<string, number> = {}
      sheetMarkers.forEach((marker) => {
        const page = pageRefs.current.get(marker.sheetLink.page)
        if (!page) {
          nextOffsets[marker.id] = 0
          return
        }
        const canvas = page.querySelector('canvas')
        if (!canvas) {
          nextOffsets[marker.id] = 0
          return
        }
        const rect = page.getBoundingClientRect()
        if (!rect.height || !rect.width) {
          nextOffsets[marker.id] = 0
          return
        }
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (!ctx) {
          nextOffsets[marker.id] = 0
          return
        }
        const scaleX = canvas.width / rect.width
        const scaleY = canvas.height / rect.height
        if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY)) {
          nextOffsets[marker.id] = 0
          return
        }
        const baseY = resolveYWithinPagePx(marker.sheetLink, page)
        let bestOffset = 0
        let bestScore = -1
        candidates.forEach((offset) => {
          const cssY = Math.min(
            Math.max(0, baseY + offset),
            Math.max(0, rect.height - sampleHeight)
          )
          const cssX = Math.min(Math.max(0, sampleX), Math.max(0, rect.width - sampleWidth))
          const sx = Math.round(cssX * scaleX)
          const sy = Math.round(cssY * scaleY)
          const sw = Math.max(1, Math.round(sampleWidth * scaleX))
          const sh = Math.max(1, Math.round(sampleHeight * scaleY))
          try {
            const data = ctx.getImageData(sx, sy, sw, sh).data
            let white = 0
            for (let i = 0; i < data.length; i += 4) {
              if (data[i] > 230 && data[i + 1] > 230 && data[i + 2] > 230) {
                white += 1
              }
            }
            const score = data.length ? white / (data.length / 4) : 0
            if (score > bestScore) {
              bestScore = score
              bestOffset = offset
            }
          } catch (error) {
            bestOffset = 0
            bestScore = 0
          }
        })
        nextOffsets[marker.id] = bestOffset
      })
      if (!cancelled) {
        setMarkerOffsets(nextOffsets)
      }
    }
    rafId = window.requestAnimationFrame(computeOffsets)
    return () => {
      cancelled = true
      window.cancelAnimationFrame(rafId)
    }
  }, [effectiveScale, numPages, pageWidth, resolveYWithinPagePx, sheetMarkers])

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

  useImperativeHandle(
    ref,
    () => ({ getSheetPosition, scrollToSheetPosition, zoomIn: handleZoomIn, zoomOut: handleZoomOut }),
    [getSheetPosition, scrollToSheetPosition]
  )

  useEffect(() => {
    onZoomStateChange?.(zoomOutDisabled, zoomInDisabled)
  }, [onZoomStateChange, zoomOutDisabled, zoomInDisabled])

  return (
    <section className="h-full w-full">
      <div
        ref={containerRef}
        className="relative h-full w-full overflow-y-auto overflow-x-hidden touch-pan-y touch-pinch-zoom"
      >
        {error ? (
          <div className="flex min-h-full items-center justify-center text-sm text-red-600">
            {error}
          </div>
        ) : (
          <Document
            file={PDF_URL}
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
                const markersForPage = markersByPage.get(pageNumber) ?? []
                const pageNode = pageRefs.current.get(pageNumber) ?? null
                return (
                  <div key={pageNumber} className="flex w-full justify-center">
                    <div
                      ref={setPageRef(pageNumber)}
                      data-page-number={pageNumber}
                      className="relative"
                    >
                      {pageNumber > 1 && (
                        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-px bg-slate-300" />
                      )}
                      <Page
                        pageNumber={pageNumber}
                        scale={effectiveScale}
                        devicePixelRatio={devicePixelRatio}
                        renderTextLayer={false}
                        renderAnnotationLayer={false}
                        onLoadSuccess={handlePageLoadSuccess}
                        onLoadError={handlePageLoadError}
                        onRenderError={handlePageRenderError}
                      />
                      {markersForPage.map((marker) => {
                        const markerOffset = markerOffsets[marker.id] ?? 0
                        const baseY = resolveYWithinPagePx(marker.sheetLink, pageNode)
                        return (
                          <button
                            key={marker.id}
                            className={`sheet-marker absolute left-2 z-10 flex max-w-[180px] items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-semibold text-white transition sm:left-1 md:-left-4 md:max-w-[210px] md:gap-2 md:px-3 md:py-1.5 md:text-[11px] lg:-left-6 lg:max-w-[240px] lg:text-xs${marker.isDraft ? ' opacity-60 border-dashed' : ''}`}
                            style={{
                              top: Math.max(0, baseY + markerOffset),
                              ['--marker-color' as string]: marker.color ?? '#94a3b8',
                            }}
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation()
                              onMarkerClick?.(marker.id)
                            }}
                          >
                            <span className="flex items-center gap-0.5 text-white/90">
                              <span className="h-2.5 w-[2px] rounded-full bg-white/80 md:h-3" />
                              <AudioLines size={11} strokeWidth={3} className="text-white/90" />
                              <span className="h-2.5 w-[2px] rounded-full bg-white/80 md:h-3" />
                            </span>
                            <span className="truncate pl-1">{marker.name}</span>
                            {marker.isDraft && (
                              <span className="ml-1 text-[9px] uppercase tracking-wide opacity-60">draft</span>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </Document>
        )}
      </div>
    </section>
  )
})

export default PDFViewer
