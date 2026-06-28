/**
 * Per-page transparent drawing overlay for the PDF viewer.
 *
 * One `<canvas>` is rendered absolutely over each page (z-25). When write mode is
 * OFF the canvas is `pointer-events: none` / `touch-action: auto`, so the viewer
 * scrolls and zooms exactly as before. When write mode is ON the canvas owns all
 * gestures on the page surface (`pointer-events: auto` / `touch-action: none`):
 *
 *  - mouse / pen / single-finger touch → draw a stroke (pen / highlight) or erase.
 *  - two-finger touch → pan the scroll container; a pinch beyond a ratio threshold
 *    fires the host's discrete zoom-in/out (matching the app's stepped zoom model,
 *    avoiding per-frame PDF re-rasterization).
 *
 * Coordinates are normalized to [0..1] of the page (see `lib/annotations`), so a
 * stroke drawn at one zoom redraws correctly at any scale. The backing store is
 * sized at `devicePixelRatio` for crisp lines; `ctx` is transformed by `dpr` before
 * each redraw and the CSS (logical) width/height is passed to `redrawPage`.
 */

import { useContext, useEffect, useLayoutEffect, useRef } from 'react'
import { AnnotationContext } from '../contexts/AnnotationContext'
import {
  normalizePoint,
  redrawPage,
  strokeHitTest,
  nanoid,
  type AnnotationPoint,
  type AnnotationStroke,
} from '../lib/annotations'

type AnnotationCanvasProps = {
  /** 1-based page number. */
  page: number
  /** Current render scale — re-size + redraw when it changes (page resized). */
  effectiveScale: number
  /** Backing-store density for crisp strokes. */
  devicePixelRatio: number
  /** Scroll container, for two-finger pan. */
  scrollContainer: HTMLDivElement | null
  /** Host's discrete zoom-in (pinch-out past threshold). */
  onRequestZoomIn: () => void
  /** Host's discrete zoom-out (pinch-in past threshold). */
  onRequestZoomOut: () => void
}

// Pinch ratio thresholds: current/baseline finger distance. Crossing fires a
// discrete zoom step and resets the baseline so a continued pinch keeps stepping.
const PINCH_IN_RATIO = 0.85
const PINCH_OUT_RATIO = 1.18
// Eraser radius in CSS px (converted to normalized space per-page at use).
const ERASER_PX = 14

// ── Tool cursors: exact lucide icon SVGs as CSS cursor data-URIs ──────────────
// Paths are taken verbatim from lucide-react's bundled icon nodes so the cursor
// matches the toolbar icon pixel-for-pixel. Hotspots sit at each tool's drawing tip.
const _cur = (body: string, hx: number, hy: number) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#1e293b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${hx} ${hy}, crosshair`
}

// lucide Pencil — tip is the bottom-left of the filled body path
const PEN_CURSOR = _cur(
  '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
  2, 21
)
// lucide Highlighter — contact point is the lower-left corner of the highlighted area
const HIGHLIGHT_CURSOR = _cur(
  '<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>',
  3, 20
)
// lucide Eraser — active erasing corner is bottom-left of the block
const ERASER_CURSOR = _cur(
  '<path d="M21 21H8a2 2 0 0 1-1.42-.587l-3.994-3.999a2 2 0 0 1 0-2.828l10-10a2 2 0 0 1 2.829 0l5.999 6a2 2 0 0 1 0 2.828L12.834 21"/><path d="m5.082 11.09 8.828 8.828"/>',
  5, 14
)

function cursorForTool(tool: 'pen' | 'highlight' | 'eraser'): string {
  switch (tool) {
    case 'pen':
      return PEN_CURSOR
    case 'highlight':
      return HIGHLIGHT_CURSOR
    case 'eraser':
      return ERASER_CURSOR
    default:
      // A future tool that forgets to add a cursor falls back to crosshair
      // rather than returning undefined at runtime.
      return 'crosshair'
  }
}

export default function AnnotationCanvas(props: AnnotationCanvasProps) {
  const {
    page,
    effectiveScale,
    devicePixelRatio,
    scrollContainer,
    onRequestZoomIn,
    onRequestZoomOut,
  } = props

  const ctx = useContext(AnnotationContext)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  // CSS (logical) size of the canvas, kept in a ref so the rAF redraw + pointer
  // handlers read a stable current value without re-subscribing.
  const cssSizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 })

  // The stroke currently being drawn (uncommitted). null when not drawing.
  const liveStrokeRef = useRef<AnnotationPoint[] | null>(null)

  // Active pointers keyed by pointerId, for single-vs-multi-touch arbitration.
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map())

  // Two-finger gesture bookkeeping.
  const gestureRef = useRef<{
    active: boolean
    lastMidX: number
    lastMidY: number
    baseDist: number
  }>({ active: false, lastMidX: 0, lastMidY: 0, baseDist: 0 })

  // Eraser cursor indicator point (normalized), drawn while erasing. null = hidden.
  const eraserPointRef = useRef<AnnotationPoint | null>(null)

  const rafRef = useRef<number | null>(null)

  // ── Latest context values, read inside imperative handlers via a ref ───────────
  // Pointer handlers below close over `ctxRef.current` rather than `ctx` directly so
  // that mutable settings (active tool, colors, widths) are always read fresh without
  // the handlers needing to be recreated when those values change.
  const ctxRef = useRef(ctx)
  ctxRef.current = ctx

  // ── Redraw (coalesced via rAF) ─────────────────────────────────────────────────
  const scheduleRedraw = () => {
    if (rafRef.current != null) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      const canvas = canvasRef.current
      const c = ctxRef.current
      if (!canvas || !c) return
      const g = canvas.getContext('2d')
      if (!g) return
      const { w, h } = cssSizeRef.current
      if (w === 0 || h === 0) return

      g.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)

      const committed = c.annotations[page] ?? []

      // Build the live stroke (if drawing) as a transient stroke appended after the
      // committed ones so it paints on top.
      const live = liveStrokeRef.current
      let strokes = committed
      if (live && live.length > 0) {
        const isHighlight = c.activeTool === 'highlight'
        const liveStroke: AnnotationStroke = {
          id: '__live__',
          tool: isHighlight ? 'highlight' : 'pen',
          color: isHighlight ? c.highlightColor : c.penColor,
          width: isHighlight ? c.highlightWidth : c.penWidth,
          points: live,
        }
        strokes = [...committed, liveStroke]
      }

      redrawPage(g, strokes, w, h)

      // Faint eraser cursor indicator (nice-to-have).
      const ep = eraserPointRef.current
      if (ep) {
        g.beginPath()
        g.arc(ep[0] * w, ep[1] * h, ERASER_PX, 0, Math.PI * 2)
        g.strokeStyle = 'rgba(71,85,105,0.6)'
        g.lineWidth = 1
        g.stroke()
      }
    })
  }

  // ── Sizing: match the page wrapper's CSS box, backed at dpr ─────────────────────
  // `devicePixelRatio` is read from the render-time prop and is a dependency below,
  // so this effect re-runs only when React re-renders with a new value — it does NOT
  // observe a mid-session monitor-DPR change (e.g. dragging the window to a display
  // with a different scale factor). That matches react-pdf's `<Page devicePixelRatio>`
  // limitation; strokes re-crisp on the next state-driven render. Acceptable for now.
  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const parent = canvas.parentElement
    if (!parent) return

    const applySize = () => {
      const rect = parent.getBoundingClientRect()
      const cssW = rect.width
      const cssH = rect.height
      if (cssW === 0 || cssH === 0) return
      cssSizeRef.current = { w: cssW, h: cssH }
      const backingW = Math.round(cssW * devicePixelRatio)
      const backingH = Math.round(cssH * devicePixelRatio)
      if (canvas.width !== backingW) canvas.width = backingW
      if (canvas.height !== backingH) canvas.height = backingH
      canvas.style.width = `${cssW}px`
      canvas.style.height = `${cssH}px`
      scheduleRedraw()
    }

    applySize()

    const ro = new ResizeObserver(() => applySize())
    ro.observe(parent)
    return () => ro.disconnect()
    // effectiveScale is in deps so a zoom that resizes the page re-measures even if
    // the ResizeObserver hasn't fired yet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveScale, devicePixelRatio])

  // ── Redraw when committed annotations or scale change ───────────────────────────
  // Cancel any pending rAF before scheduling a fresh one so the new annotations are
  // always read by the redraw that fires — not a stale rAF queued before this render.
  useEffect(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    scheduleRedraw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx?.annotations, page, effectiveScale])

  // Cleanup any pending rAF on unmount.
  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  // ── Stroke / erase helpers ──────────────────────────────────────────────────────
  const finalizeStroke = () => {
    const c = ctxRef.current
    const live = liveStrokeRef.current
    liveStrokeRef.current = null
    if (!c || !live || live.length === 0) {
      scheduleRedraw()
      return
    }
    const isHighlight = c.activeTool === 'highlight'
    const stroke: AnnotationStroke = {
      id: nanoid(),
      tool: isHighlight ? 'highlight' : 'pen',
      color: isHighlight ? c.highlightColor : c.penColor,
      width: isHighlight ? c.highlightWidth : c.penWidth,
      points: live,
    }
    c.addStroke(page, stroke)
    // The committed-annotations change triggers a redraw; clear the live layer now.
    scheduleRedraw()
  }

  const eraseAt = (point: AnnotationPoint) => {
    const c = ctxRef.current
    if (!c) return
    const { w } = cssSizeRef.current
    const radiusNorm = ERASER_PX / (w || 1)
    const strokes = c.annotations[page] ?? []
    for (const stroke of strokes) {
      if (strokeHitTest(stroke, point, radiusNorm)) {
        c.removeStroke(page, stroke.id)
      }
    }
  }

  const beginGesture = () => {
    // Abort any in-progress stroke (discard, no commit, no stray dot) and erasing.
    liveStrokeRef.current = null
    eraserPointRef.current = null
    const pts = Array.from(pointersRef.current.values())
    if (pts.length >= 2) {
      const [a, b] = pts
      gestureRef.current = {
        active: true,
        lastMidX: (a.x + b.x) / 2,
        lastMidY: (a.y + b.y) / 2,
        baseDist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      }
    }
    scheduleRedraw()
  }

  // ── Pointer handlers ────────────────────────────────────────────────────────────
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = ctxRef.current
    const canvas = canvasRef.current
    if (!c || !c.writeMode || !canvas) return

    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const count = pointersRef.current.size

    if (e.pointerType === 'touch') {
      if (count >= 2) {
        // Second finger → multi-touch gesture; abort the tentative stroke/erase.
        beginGesture()
        return
      }
      // First finger → tentative draw/erase (may be aborted by a 2nd finger).
    } else {
      // Mouse / pen → draw/erase immediately, capturing the pointer.
      canvas.setPointerCapture(e.pointerId)
    }

    e.preventDefault()

    const point = normalizePoint(e.nativeEvent, canvas)
    if (c.activeTool === 'eraser') {
      eraserPointRef.current = point
      eraseAt(point)
    } else {
      liveStrokeRef.current = [point]
    }
    scheduleRedraw()
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = ctxRef.current
    const canvas = canvasRef.current
    if (!c || !c.writeMode || !canvas) return
    if (!pointersRef.current.has(e.pointerId)) return

    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    // ── Gesture mode (≥2 touch pointers): pan + pinch ─────────────────────────────
    if (gestureRef.current.active && pointersRef.current.size >= 2) {
      e.preventDefault()
      const pts = Array.from(pointersRef.current.values())
      const [a, b] = pts
      const midX = (a.x + b.x) / 2
      const midY = (a.y + b.y) / 2
      const g = gestureRef.current

      if (scrollContainer) {
        scrollContainer.scrollTop -= midY - g.lastMidY
        scrollContainer.scrollLeft -= midX - g.lastMidX
      }
      g.lastMidX = midX
      g.lastMidY = midY

      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1
      const ratio = dist / g.baseDist
      if (ratio > PINCH_OUT_RATIO) {
        onRequestZoomIn()
        g.baseDist = dist
      } else if (ratio < PINCH_IN_RATIO) {
        onRequestZoomOut()
        g.baseDist = dist
      }
      return
    }

    // ── Draw / erase mode (single pointer) ────────────────────────────────────────
    e.preventDefault()
    const point = normalizePoint(e.nativeEvent, canvas)
    if (c.activeTool === 'eraser') {
      // Only erase if a press is active (eraserPointRef set on pointerdown).
      if (eraserPointRef.current) {
        eraserPointRef.current = point
        eraseAt(point)
        scheduleRedraw()
      }
    } else if (liveStrokeRef.current) {
      liveStrokeRef.current.push(point)
      scheduleRedraw()
    }
  }

  const endPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = ctxRef.current
    const canvas = canvasRef.current
    const hadPointer = pointersRef.current.delete(e.pointerId)
    if (!c || !canvas || !hadPointer) return

    if (canvas.hasPointerCapture?.(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId)
    }

    // A gesture pointer lifted → if we drop below 2 fingers, exit gesture mode. Do
    // NOT resume drawing from the remaining finger; wait for a fresh pointerdown.
    if (gestureRef.current.active) {
      if (pointersRef.current.size < 2) {
        gestureRef.current.active = false
      }
    } else if (c.activeTool === 'eraser') {
      // Erasing pointer lifted.
      eraserPointRef.current = null
      scheduleRedraw()
    } else if (liveStrokeRef.current) {
      // Drawing pointer lifted.
      finalizeStroke()
    }

    // Belt-and-suspenders: once no pointers remain, force every interaction flag
    // back to rest so no path can leave the component stuck mid-gesture/-stroke.
    if (pointersRef.current.size === 0) {
      gestureRef.current.active = false
      liveStrokeRef.current = null
      eraserPointRef.current = null
      scheduleRedraw()
    }
  }

  // If no provider is mounted yet, render nothing so the viewer keeps working.
  if (!ctx) return null

  const { writeMode, activeTool } = ctx

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0"
      style={{
        zIndex: 25,
        pointerEvents: writeMode ? 'auto' : 'none',
        touchAction: writeMode ? 'none' : 'auto',
        cursor: writeMode ? cursorForTool(activeTool) : 'default',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
    />
  )
}
