# PDF Viewer

Covers: `src/components/PDFViewer.tsx`, `src/components/EdgeScrubberRail.tsx`, `src/lib/pdfWorker.ts`, `src/lib/pdfThumbnail.ts`, `src/lib/assignLanes.ts`

**Related docs:** [app-shell](./app-shell.md) · [score-sync](./score-sync.md) · [ui-system](./ui-system.md)

---

## Responsibilities

PDFViewer renders the score, manages scroll state, detects musical systems (staff groups + measure bands) on the rendered canvas, hosts the playback auto-scroll rAF loop, and overlays per-loop colored bars with sticky labels. It exposes an imperative handle (`PDFViewerHandle`) — the only way for parent components to control it.

---

## Rendering

`react-pdf` `<Document>` + `<Page>` (canvas backend). All pages are stacked vertically in a single scrollable `div`. `pdfWorker.ts` must be imported before any `<Document>` mounts — this is done in `src/main.tsx`:

```ts
// src/lib/pdfWorker.ts
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString()
```

Import order matters: the worker URL must be set before the first render.

---

## Scaling

A `ResizeObserver` (120ms debounce) watches the container width and recomputes `fitWidthScale = containerWidth / pageWidth`. The effective rendering scale is:

```
effectiveScale = min(zoom × 1.4 × fitWidthScale, fitWidthScale)
```

The `1.4` desktop multiplier provides the default zoomed-in view. The `min()` cap prevents the page from bleeding past the container. `zoom` is a discrete step controlled by `zoomIn()` / `zoomOut()` on the handle.

---

## Page Tracking

Each page gets its own `IntersectionObserver` with thresholds `[0, 0.25, 0.5, 0.75, 1]`. The `currentPage` state tracks which page has the highest intersection ratio. This drives the page number display and scroll position reporting.

---

## Imperative Handle (`PDFViewerHandle`)

The only contract between parent components and PDFViewer. Exposed via `forwardRef` + `useImperativeHandle`.

```ts
type PDFViewerHandle = {
  getSheetPosition(): SheetPosition                           // current viewport → page + yWithinPageRatio
  scrollToSheetPosition(pos: SheetPosition, opts?): void     // pixel-accurate scroll (adds 5%/32px padding)
  setSyncHighlight(h: SyncHighlight | null): void            // dev-only sync anchor overlay
  getSystemBands(): Record<number, SystemBand[]>             // lazy detection, cached
  startPlayheadFollow(getAnchor, onManualScroll?): void      // begin rAF loop
  stopPlayheadFollow(): void                                 // cancel rAF
  zoomIn(): void
  zoomOut(): void
}
```

`getSystemBands()` is the trigger for system detection. It computes any un-cached pages on demand and fires the `onSystemBandsReady` callback (wired by SongView) once all pages are covered.

---

## Playhead Follow rAF Loop

Started by `startPlayheadFollow(getAnchor, onManualScroll?)`. Runs on every animation frame:

```
1.  anchor = getAnchor()                                     ← PlayheadAnchor from PlayerDock
2.  anchorDocY = docYForPosition(anchor.current)             ← page+ratio → absolute scrollTop
3.  fraction = adaptiveAnchorFraction(stability, sysH)       ← 0.40 (confident) … 0.52 (low)
4.  rawTarget = anchorDocY − (viewportH × fraction)
5.  {target, seeked} = advanceFollowTarget(rawTarget, time, state)   ← monotonic ratchet
6.  step = cappedScrollStep(target − scrollTop, systemPx, dtSec)     ← floor at 0.7s/system
7.  scrollTop += step × EASE (0.15)                                  ← smooth blend
8.  container.scrollTop = Math.round(scrollTop)
```

**Monotonic ratchet** (`advanceFollowTarget` in `scrollMotion.ts`): `followMaxTargetRef` tracks the running maximum scroll target. Normal frames can only advance the target forward. Resets when a real audio seek is detected (time jump >1s forward or >50ms backward).

**Manual scroll suspension:** A `scroll` event handler checks whether `scrollTop` changed without the rAF loop writing it. If so, `followUserUntilRef = now + 1200ms` suspends auto-scroll until the user is quiet.

**Geometry invalidation:** `followGeomRef` records the last-seen `{width, height}` of the viewport. If they change (zoom, resize), the ratchet resets to re-anchor from the new geometry.

See [score-sync.md](./score-sync.md) for `adaptiveAnchorFraction`, `advanceFollowTarget`, and `cappedScrollStep`.

---

## System Band Detection

System bands (staff groups + measure regions) are detected by running `detectSystems()` from [score-sync.md](./score-sync.md) on the rendered canvas of each page. Results are scale-invariant ratios, cached in `systemBandsRef`.

Detection is **lazy**: `getSystemBands()` checks which pages are missing and computes them on demand. Pages that haven't rendered yet (canvas not painted) will be missing; the cache self-heals on subsequent calls. Once all pages are covered, the `onSystemBandsReady` callback fires once.

Enable `DEBUG_SYSTEMS = true` in `PDFViewer.tsx` to render colored overlays showing detected system bands.

```
window.__detectSystems(pageNumber)  // call from console to inspect detection on live render
```

---

## Margin Loop Bars

Each `SheetMarker` (loop) is rendered as a colored vertical bar just outside the PDF's right edge. Bars span the full document height of the loop, crossing page breaks.

**Two rendering phases, both per-page:**

| Phase | Element | z-index | Updates |
|---|---|---|---|
| Bars | `position: absolute` colored rect, clickable | 20 | React render (loop list changes) |
| Chips | `position: sticky` label at bar top | 40+ | Direct DOM mutation on scroll |

Chips are updated by the `updateChipSlots` scroll handler — no React state, no re-render. This keeps scroll at 60fps.

**Chip stacking algorithm:**
- *Pinned* chips: loop's doc-Y range overlaps the viewport → chip sits at `PAGE_CHIP_STICKY_TOP + slotIndex × CHIP_STACK_STEP` (stacked from top)
- *Resting* chips: loop is above/below viewport → chip nudges down from its natural bar-top position to avoid overlapping the chip below it

**Sub-lanes:** When bars overlap in doc-Y, `packIntervals()` assigns each to a column (`subLane`). Each column is 6px wide with a 1.5px gap. Bars in different columns don't visually occlude.

---

## EdgeScrubberRail (`src/components/EdgeScrubberRail.tsx`)

A 60px right-edge mini-map with three visual layers:

1. **Loop bands** (left gutter, 4px columns): colored segments in doc-Y space, packed via `packIntervals`
2. **Page cards** (main area): white rectangles proportional to page height; show page numbers
3. **Viewport window**: teal-tinted rectangle at the current scroll position; draggable to seek

On desktop: always visible. On touch: 4px ghost rail that auto-hides 1.5s after scroll stops.

Hover over a band (desktop) shows a chip with the loop name (80ms leave debounce to prevent flicker). Click a band → `onSelectLoop(id)`.

Band heights have a `MIN_BAND_PX` (6px) floor so short loops remain clickable.

---

## Thumbnail Generation (`src/lib/pdfThumbnail.ts`)

```ts
getPdfThumbnail(pdfBlobKey: string, opts?: { width?: number; quality?: number }): Promise<string | null>
```

Renders page 1 to a JPEG data URL at 320px width (default). Module-level cache + in-flight dedup ensures only one rasterize call per blob key per session.

---

## When modifying this system

- **System band cache is not invalidated on zoom.** Bands are scale-invariant ratios computed from the canvas pixels. They only need recomputing if the canvas content changes (new PDF or re-render at a different resolution). Do not clear the cache on zoom changes.
- **Chip stacking is pure DOM mutation.** Changes to chip positioning logic must go in the `updateChipSlots` scroll handler, not React state. Adding a React state update here will kill scroll performance.
- **`followGeomRef` intentionally resets the ratchet on resize.** This re-anchors auto-scroll after reflow. Do not remove this reset or auto-scroll will drift after zoom.
- **`pdfWorker.ts` must be imported before the first `<Document>` render.** The import in `main.tsx` handles this — don't move it.
- **`scrollToSheetPosition` adds 5%/32px padding.** This is intentional to avoid landing the target exactly at the viewport top. Don't remove it or synced scroll targets will feel clipped.

---

## Common failure modes

- **Auto-scroll does nothing on a synced song:** `onSystemBandsReady` never fired because `getSystemBands()` was called before any page canvases had painted. Add a wait or retry — `getSystemBands()` self-heals on repeated calls.
- **Auto-scroll jumps backward:** `advanceFollowTarget` ratchet state is stale. Check `followStateRef` — `lastTime` or `maxTarget` may not be resetting on seek. Seeks must be detected by the `time` parameter's jump (>1s forward or >50ms backward).
- **Chips overlapping at scroll extremes:** `CHIP_STACK_STEP` is too small for the number of active loops. Increase or add a max-chip-count cap per viewport.
- **Scale mismatch between detection and rendering:** `detectSystems` ran on a canvas at a different resolution than the displayed page. Ensure `getSystemBands()` reads the canvas after it's been painted at `effectiveScale`.
- **Rail bands not matching PDF content position:** `getDocY` callback producing wrong coordinates. Check that `scrollToSheetPosition` and `docYForPosition` use the same `pageHeightPx` calculation.
