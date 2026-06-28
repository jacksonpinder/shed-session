# Feature: PDF Viewer

## Purpose

The PDF viewer renders the user's sheet music as the primary visual element, filling the viewport. It also serves as the display layer for all score-related spatial information: loop position markers (margin bars), a navigation scrubber (EdgeScrubberRail), and the auto-scroll playhead follow loop. Everything else in the app floats over it.

## User value

- See as much of the score as possible at once — the PDF fills the full viewport at reading scale.
- Loop positions are shown as vertical bars in the right margin, spanning the exact range of score the loop covers.
- The edge scrubber rail gives a minimap view of the whole score with loop bands and a draggable viewport window.
- The score stays focused on the playing system during playback (via auto-scroll).

## Current implementation

Built on `react-pdf`. All pages render in a single vertical scroll container at `fitWidthScale` (default 1.4× of the container width). A `ResizeObserver` updates `fitWidthScale` whenever the container resizes. An `IntersectionObserver` per page tracks which pages are visible.

**Imperative handle** (called by PlayerDock without triggering a React re-render):
- `getSheetPosition()` / `scrollToSheetPosition()` — read/write the current scroll as `{page, yWithinPageRatio}`
- `getSystemBands()` — lazy, cached; returns system band positions per page as scale-invariant ratios (runs `detectSystems` on the live canvas renders)
- `startPlayheadFollow(getAnchor)` / `stopPlayheadFollow()` — start/stop the rAF auto-scroll loop

**Margin loop bars** — 6 px vertical bars positioned just outside the page's right edge, spanning the full docY of each loop. A `position: sticky` chip sits at the bar's top. Overlapping bars are packed into sub-lanes via `packIntervals` (`assignLanes.ts`).

**EdgeScrubberRail** — 60 px column: stacked white page cards with loop bands in a left gutter; a draggable teal viewport window that mirrors the main scroll container.

→ See [docs/architecture/pdf-viewer.md](../docs/architecture/pdf-viewer.md) for the full component breakdown, system detection, and scroll mechanics.

## Architecture dependencies

**Depends on:**
- `score-sync` — `detectSystems` (called via `getSystemBands()`) and the auto-scroll loop both require anchors
- `loop-regions` — `loopMarkers` prop (from SongView) drives both margin bars and scrubber bands

**Depended on by:**
- `auto-scroll` — the rAF follow loop runs inside PDFViewer; `PlayerDock` drives it via the imperative handle
- `score-sync` — `getSystemBands()` is called by the timing model builder at playback time

## Known issues

- **Scrubber viewport width mismatch** — The teal viewport window in EdgeScrubberRail is wider or narrower than the actual page. Needs to match the full page width exactly.
- **Rail-to-page padding** — Visible padding between the left scrubber rail bands and the adjacent page edge is inconsistent at narrow widths.
- **Touch target enlargement** — Loop bars in the margin rail and the collapse/expand bumper are small; tap areas need enlarging.
- **D3 mobile bottom sheet** — Currently mobile uses the same desktop popover layout for audio settings; not a PDF viewer issue per se but affects viewport space.

## Planned improvements

- **Scrubber viewport width** — Match the teal viewport window to the rendered page width exactly.
- **Rail-to-page padding** — Ensure consistent visible padding on all four sides of the rail and scrubber track.
- **Touch target enlargement** — Enlarge tap areas for margin loop bars and collapse/expand bumper.
- **Collapse interior page margins (Later)** — Remove most blank white space at the top and bottom of interior PDF pages (add small padding). First-page top and last-page bottom remain intact. Requires auditing impact on scroll-position math and loop bar positioning.
- **Desktop zoom gestures (Later)** — Pinch-to-zoom and keyboard zoom should scale the PDF canvas only, not the whole page (transport bar stays unscaled).

## Acceptance criteria

- Given a PDF is loaded, all pages render at `fitWidthScale` in a single vertical scroll container.
- Given the container is resized, `fitWidthScale` updates and pages re-render at the new scale without losing scroll position.
- Given a loop exists, its margin bar spans the full vertical extent of the loop's score range, continuous across page breaks.
- Given a loop's margin bar chip is hovered, the chip expands to show the loop name.
- Given the EdgeScrubberRail viewport window is dragged, the main scroll container scrolls to the corresponding position.
- Given `startPlayheadFollow` is called during playback, the PDF scrolls to keep the active system on screen.

## Related decisions

- **Score fills the viewport; controls float over it** — the PDF is the primary visual. The transport dock is a floating overlay. A sidebar layout would waste ~30% horizontal viewport.
- **Margin loop bars replace floating pill markers** — a bar spanning the loop's range gives better spatial sense of coverage than a pill at a single point.

## Status

Active — core rendering stable; scrubber sizing and touch targets are open polish items.
