/**
 * Pen/highlighter annotation primitives. DOM-free where possible so the math
 * (curve fitting, hit-testing, normalization) is unit-testable; the only
 * browser-coupled parts touch a `CanvasRenderingContext2D` / `Path2D` and are
 * exercised in the live app.
 *
 * Coordinates are stored NORMALIZED ([0..1] of page width/height) so a stroke
 * drawn at one zoom level redraws correctly at any scale: `x_pixel = x * canvasWidth`,
 * `y_pixel = y * canvasHeight`. Stroke width is stored in logical (pre-scale) px and
 * scaled at draw time by the caller's canvas-to-logical ratio if desired.
 */

// ── Types ────────────────────────────────────────────────────────────────────

/** Normalized point: [x / pageWidth, y / pageHeight], each in [0, 1]. */
export type AnnotationPoint = [number, number]

export type AnnotationStroke = {
  id: string
  tool: 'pen' | 'highlight'
  color: string // hex
  width: number // logical px (pre-scale)
  points: AnnotationPoint[]
}

export type SongAnnotations = {
  [page: number]: AnnotationStroke[]
}

// ── ID generation ────────────────────────────────────────────────────────────

const NANOID_ALPHABET = 'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict'

/** Tiny URL-safe id (~16 chars), no external dep. Uses crypto.getRandomValues. */
export function nanoid(): string {
  const size = 16
  const bytes = new Uint8Array(size)
  crypto.getRandomValues(bytes)
  let id = ''
  for (let i = 0; i < size; i++) {
    // 64-char alphabet → mask to 6 bits for a uniform pick.
    id += NANOID_ALPHABET[bytes[i] & 63]
  }
  return id
}

// ── Coordinate conversion ────────────────────────────────────────────────────

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

/**
 * Convert a pointer event's client coords to normalized [0..1, 0..1] relative to
 * the canvas's bounding rect. Values are clamped to [0, 1] so a pointer that
 * strays slightly outside the canvas during a fast stroke stays in range.
 */
export function normalizePoint(e: PointerEvent, canvas: HTMLCanvasElement): AnnotationPoint {
  const rect = canvas.getBoundingClientRect()
  const w = rect.width || 1
  const h = rect.height || 1
  const x = (e.clientX - rect.left) / w
  const y = (e.clientY - rect.top) / h
  return [clamp01(x), clamp01(y)]
}

// ── Curve fitting ────────────────────────────────────────────────────────────

/**
 * Smooth Catmull-Rom spline through `points` (normalized) rendered into canvas
 * pixel space (`canvasWidth` × `canvasHeight`). Each segment p(i)→p(i+1) uses its
 * neighbours p(i-1), p(i+2) as control influences; endpoints duplicate themselves
 * as phantom neighbours. Catmull-Rom is converted to a cubic Bézier per segment
 * with tension 0.5 (the canonical uniform form):
 *
 *   c1 = p1 + (p2 - p0) / 6
 *   c2 = p2 - (p3 - p1) / 6
 *
 * Returns an empty Path2D for fewer than 2 points.
 */
export function catmullRomPath(
  points: AnnotationPoint[],
  canvasWidth: number,
  canvasHeight: number
): Path2D {
  const path = new Path2D()
  if (points.length < 2) return path

  const px = (p: AnnotationPoint): [number, number] => [p[0] * canvasWidth, p[1] * canvasHeight]

  const start = px(points[0])
  path.moveTo(start[0], start[1])

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = px(points[i === 0 ? 0 : i - 1])
    const p1 = px(points[i])
    const p2 = px(points[i + 1])
    const p3 = px(points[i + 2 < points.length ? i + 2 : points.length - 1])

    const c1x = p1[0] + (p2[0] - p0[0]) / 6
    const c1y = p1[1] + (p2[1] - p0[1]) / 6
    const c2x = p2[0] - (p3[0] - p1[0]) / 6
    const c2y = p2[1] - (p3[1] - p1[1]) / 6

    path.bezierCurveTo(c1x, c1y, c2x, c2y, p2[0], p2[1])
  }

  return path
}

// ── Rendering ────────────────────────────────────────────────────────────────

/** Alpha applied to highlight strokes (source-over, since the canvas is transparent). */
const HIGHLIGHT_ALPHA = 0.35

/**
 * Clear the canvas and repaint every stroke. Single-point strokes render as a
 * filled dot of radius width/2 so a tap still leaves a mark.
 *
 * Highlight strokes intentionally use `source-over` at alpha 0.35 rather than the
 * `multiply` blend a highlighter would normally want: the canvas starts transparent,
 * and `multiply` against transparent pixels yields black. Alpha-blended source-over
 * gives the translucent look without the artefact. Alpha/composite are reset after
 * each highlight stroke so subsequent strokes are unaffected.
 *
 * Assumes exclusive ownership of ctx — caller must not share this canvas with other layers.
 */
export function redrawPage(
  ctx: CanvasRenderingContext2D,
  strokes: AnnotationStroke[],
  canvasWidth: number,
  canvasHeight: number
): void {
  ctx.clearRect(0, 0, canvasWidth, canvasHeight)

  for (const stroke of strokes) {
    const isHighlight = stroke.tool === 'highlight'

    ctx.globalAlpha = isHighlight ? HIGHLIGHT_ALPHA : 1.0
    ctx.globalCompositeOperation = 'source-over'
    ctx.lineWidth = stroke.width
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    if (stroke.points.length < 2) {
      // Single point → dot.
      if (stroke.points.length === 1) {
        const [nx, ny] = stroke.points[0]
        ctx.beginPath()
        ctx.fillStyle = stroke.color
        ctx.arc(nx * canvasWidth, ny * canvasHeight, stroke.width / 2, 0, Math.PI * 2)
        ctx.fill()
      }
    } else {
      const path = catmullRomPath(stroke.points, canvasWidth, canvasHeight)
      ctx.strokeStyle = stroke.color
      ctx.stroke(path)
    }

    if (isHighlight) {
      ctx.globalAlpha = 1.0
      ctx.globalCompositeOperation = 'source-over'
    }
  }
}

// ── Hit testing (eraser) ─────────────────────────────────────────────────────

const dist = (a: AnnotationPoint, b: AnnotationPoint): number => {
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  return Math.sqrt(dx * dx + dy * dy)
}

/** Shortest distance from point p to the segment a→b (normalized space). */
const pointSegmentDistance = (p: AnnotationPoint, a: AnnotationPoint, b: AnnotationPoint): number => {
  const abx = b[0] - a[0]
  const aby = b[1] - a[1]
  const apx = p[0] - a[0]
  const apy = p[1] - a[1]
  const lenSq = abx * abx + aby * aby
  if (lenSq === 0) return dist(p, a) // a and b coincide
  let t = (apx * abx + apy * aby) / lenSq
  t = t < 0 ? 0 : t > 1 ? 1 : t
  const cx = a[0] + t * abx
  const cy = a[1] + t * aby
  const dx = p[0] - cx
  const dy = p[1] - cy
  return Math.sqrt(dx * dx + dy * dy)
}

/**
 * True if any part of `stroke` comes within `radiusNorm` (normalized distance) of
 * `point`. Checks point-to-segment distance for each consecutive pair so a hit on
 * the line between two sampled points counts, not just on the vertices. A single
 * isolated point is treated as a degenerate segment (distance to that point).
 * @param radiusNorm - Eraser radius in normalized space. To convert from device pixels:
 *   radiusNorm = eraserPx / canvasWidth (use canvasWidth for both axes; asymmetry is negligible).
 */
export function strokeHitTest(
  stroke: AnnotationStroke,
  point: AnnotationPoint,
  radiusNorm: number
): boolean {
  const pts = stroke.points
  if (pts.length === 0) return false
  if (pts.length === 1) {
    return dist(point, pts[0]) <= radiusNorm
  }
  for (let i = 0; i < pts.length - 1; i++) {
    if (pointSegmentDistance(point, pts[i], pts[i + 1]) <= radiusNorm) return true
  }
  return false
}
