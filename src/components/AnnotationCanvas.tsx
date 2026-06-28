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

// ── Tool cursors (tiny inline SVG data-URIs) ───────────────────────────────────
// Hotspot coordinates are chosen so the "tip" of each tool sits at the pointer.
const PEN_CURSOR =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%23334155' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M12 19l7-7 3 3-7 7-3-3z'/%3E%3Cpath d='M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z'/%3E%3Cpath d='M2 2l7.586 7.586'/%3E%3Ccircle cx='11' cy='11' r='2'/%3E%3C/svg%3E\") 2 22, crosshair"
const HIGHLIGHT_CURSOR =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%23ca8a04' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M9 11l-6 6v3h9l3-3'/%3E%3Cpath d='M22 12l-4.6 4.6a2 2 0 0 1-2.8 0l-3.2-3.2a2 2 0 0 1 0-2.8L16 6'/%3E%3C/svg%3E\") 3 21, crosshair"
const ERASER_CURSOR =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%23475569' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M20 20H7L3 16a1.5 1.5 0 0 1 0-2L13 4a1.5 1.5 0 0 1 2 0l6 6a1.5 1.5 0 0 1 0 2l-8 8'/%3E%3Cpath d='M6 11l7 7'/%3E%3C/svg%3E\") 12 12, crosshair"

function cursorForTool(tool: 'pen' | 'highlight' | 'eraser'): string {
  switch (tool) {
    case 'pen':
      return PEN_CURSOR
    case 'highlight':
      return HIGHLIGHT_CURSOR
    case 'eraser':
      return ERASER_CURSOR
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
  useEffect(() => {
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
      return
    }

    // Drawing / erasing pointer lifted.
    if (c.activeTool === 'eraser') {
      eraserPointRef.current = null
      scheduleRedraw()
    } else if (liveStrokeRef.current) {
      finalizeStroke()
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
