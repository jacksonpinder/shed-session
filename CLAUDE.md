# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Project Management

The `/project-management/` folder is the source of truth for current state, priorities, and decisions.

**Before starting work:**
1. Read `project-management/PROJECT_STATE.md` — architecture, known issues, next actions
2. Read `project-management/BACKLOG.md` — what's prioritized Now/Soon
3. Check `project-management/DECISIONS.md` if you're about to make a structural choice

**After completing work:**
1. Update `project-management/PROJECT_STATE.md` — mark active items done, update known issues
2. Update `project-management/BACKLOG.md` — move completed items out, reprioritize if needed
3. Add a `project-management/DECISIONS.md` entry for any non-obvious choices made
4. Add a `project-management/WORKLOG.md` entry with what was done, what's next, and current app state

**Before stopping mid-task:** Leave a handoff note in `WORKLOG.md` so the next session can continue cleanly.

---

## Commands

```bash
npm run dev
npm run build
npm run preview
npm test          # node --experimental-strip-types; tests in tests/*.test.ts (Node 22+)
```

> `npm run build` is broken (pre-existing: tsconfig missing `jsx`). Typecheck with:
> `npx tsc -p tsconfig.json --jsx react-jsx`

---

## What This App Does

**Shed Session** is a music practice tool for singers and musicians who learn parts from recordings and printed sheet music.

The core loop: the user uploads a PDF of their sheet music and one or more MP3s of a reference recording. The app transcribes the audio with Whisper (via a local sidecar), extracts lyrics from the PDF, and aligns them to produce a time → score anchor map. The user creates named loop regions on the waveform; loops auto-link to the correct position in the score. During playback the score auto-scrolls to keep the active system on screen. The user can transpose, adjust speed, balance stereo channels, collapse to mono, and record their own voice over a loop.

**Multi-song library:** The app is a library of songs (`#/` route). Each song has a PDF, one or more MP3 tracks, a set of named loops, a sync anchor map, and per-song settings. Songs are persisted in IndexedDB; settings in localStorage via a pluggable KV store injected into `PlayerDock`.

**Score sync pipeline:** `detectSystems` (barline-based system detection) → `lyricsExtract` (font-agnostic lyric extraction) → `transcribe` (Whisper sidecar, hash-cached) → `alignSyncMap` (many-to-one DP + monotonic chain) → `generateSyncMap` (orchestrator). Scanned PDFs are gated out early via `isScannedPdf()`. The anchor map is persisted to `localStorage` under `practice:syncMap`.

**Auto-scroll:** A continuous `startPlayheadFollow` rAF loop in `PDFViewer` moves the scroll container to keep the playing system at an adaptive anchor fraction down the viewport. The timing model (`timingModel.ts`) maps audio time to a fractional position through each system via a MEASURE axis (not pixels or wall-clock), with tempo-aware gap traversal. A monotonic ratchet (`scrollMotion.ts`) prevents jitter from confidence wobble. Gated behind the Nav button (default OFF when no sync map, default ON when synced).

**Multiple tracks:** Each song can have multiple MP3 tracks (e.g. full mix + learning track). The first uploaded track is the reference (Whisper-transcribed). Additional tracks get `leadInOffset` via client-side onset-envelope cross-correlation against the reference. All tracks share the same loops and anchor map; the lead-in offset is applied at three seams in `PlayerDock`.

**Recording:** Mic takes are recorded via `RecordPlugin` and stored as Blobs in IndexedDB. Playback uses an `AudioBufferSourceNode` in the existing `AudioContext`.

---

## Architecture

### App shell

`App.tsx` is a hash router (`#/` = library, `#/song/:id` = song view). `Library.tsx` lists songs. `SongView.tsx` loads the song from IndexedDB, injects a per-song `PracticeStore` into `PlayerDock`, and renders `PDFViewer` + `PlayerDock` side by side. `AnalysisProvider` (above the router in `analysisManager.tsx`) owns the Whisper/sync pipeline and notifies open song views when anchors arrive.

### Data flow

`SongView` is the shared-state layer for the active song. `PlayerDock` pushes loop marker data **up** via `onLoopMarkersChange`; `SongView` passes it **down** to `PDFViewer` as `loopMarkers`. The PDF imperative handle (`pdfViewerRef`) lets `PlayerDock` call `scrollToSheetPosition()`, `getSystemBands()`, `startPlayheadFollow()` / `stopPlayheadFollow()` directly without re-rendering through the parent.

### Audio engine (`PlayerDock.tsx`)

The heaviest file. WaveSurfer is set up with two plugins (`RegionsPlugin` for loops, `RecordPlugin` for mic input). Audio chain:

```
MediaElementSource → [SoundTouchNode (±7 semitones, bypassed at 0)]
  → masterGain → monoGain → stereoPanner → destination
                                    takeGain ──────────────→ destination (mic takes)
```

Key subsystems:

- **Loop playback**: Each loop has `extendedStart`/`extendedEnd` bounds with a half-second pad. `audioprocess` + `timeupdate` events watch for the playback position crossing the end boundary and trigger a seek back to `extendedStart`. A drift guard prevents double-fires (80 ms threshold, 150 ms cooldown).
- **Fade envelope**: `useGainEnvelope` (Web Audio linear ramps) handles fade-out at loop end and fade-in at loop start to avoid clicks. `useVolumeEnvelope` (rAF + ease-in-out) handles WaveSurfer's software volume separately.
- **Lead-in offset**: `songToTrackTime`/`trackToSongTime` conversions applied at three seams — loop↔region sync, writeback on drag/new-loop, and time→anchor resolution.
- **Balance / mono**: `masterGain → monoGain → stereoPanner → destination`. `setBalance(-1…+1)` ramps `stereoPannerRef.pan` (`setTargetAtTime`, 15 ms). `setMono(bool)` flips `monoGainRef` channel mode. Mono toggle is hidden for mono sources (detected via `OfflineAudioContext` decode, not WaveSurfer which downmixes).
- **Transpose**: `@soundtouchjs/audio-worklet` (`SoundTouchNode`) provides ±7 semitones, inserted upstream of `masterGain`. Lazy init on first non-zero transpose. `applyTransposeRouting()` must run on every WaveSurfer re-init (the `MediaElementSourceNode` is recreated each time). Uses Lanczos interpolation + `quickSeek: false`.
- **Persistence**: Per-song via `PracticeStore` injection (maps `practice:*` keys → Song/Track fields in IndexedDB). Blobs in IndexedDB.

### PDF viewer (`PDFViewer.tsx`)

`react-pdf`, all pages in a vertical scroll container. `ResizeObserver` → `fitWidthScale` (desktop default 1.4×). `IntersectionObserver` per page tracks visible page.

Imperative handle:
- `getSheetPosition()` — current scroll as `{page, yWithinPageRatio}`
- `scrollToSheetPosition(pos)` — pixel-accurate scroll to a stored position
- `getSystemBands()` — lazy, cached; returns system bands per page (scale-invariant ratios)
- `startPlayheadFollow(getAnchor)` — starts the rAF auto-scroll loop
- `stopPlayheadFollow()` — stops it

**Margin loop bars**: 6px vertical bars just outside the PDF's right edge. Each bar spans the full docY of its loop (continuous across page breaks). Chip at bar top is `position:sticky`. Overlapping bars packed into sub-lanes via `packIntervals`.

**Edge scrubber rail** (`EdgeScrubberRail.tsx`, 60px): white page cards with loop bands in a left gutter; draggable teal viewport window.

### Transport (`TransportBar.tsx`)

Purely presentational. Three-zone grid (`1fr auto 1fr`):
- **Left**: Add loop / Exit loop button (Infinity / X icon)
- **Center**: scaling pill — Repeat / Back / Play / Forward / Nav
- **Right**: AudioLines button → stacked panel with Speed / Transpose / Balance+Mono (`AudioSlider`)

All state and logic live in `PlayerDock`; everything is passed down as props.

`AudioSlider` is a shared slider with center-out fill, magnetic center detent, optional `live` flag, and a `centerSlot` render-prop. Transpose is `live={false}` (commits on pointer-up only).

### Loop lane (`LoopLaneStrip.tsx`)

**Expanded**: color-coded rows of loop chips. The active region connects to the active chip via a colored connector bracket (left + right + bottom borders), running behind intervening chips (`zIndex:0`; active chip `zIndex:2`).

**Collapsed** ("LG peek"): blurred whisper of micro-rows (3–5px tall, fading opacity, `blur(2px)`). Tap anywhere on the peek to expand. A full-width bumper (invisible at rest, hover shows gradient + chevron) collapses the lane.

### Score sync pipeline

```
PDF  ──lyricsExtract──▶ LyricToken[]  ─┐
                                       ├─alignSyncMap──▶ Anchor[]
MP3  ──transcribe (sidecar)──▶ Word[] ─┘
PDF canvases ──detectSystems──▶ bandsByPage (lazy, cached in PDFViewer handle)

at playback time t:
  resolveTimedPosition(timingModel, t) → TimedPosition
  scrollMotion.advanceFollowTarget(rawTarget, t, state) → monotonic scroll target
```

**System detection** (`detectSystems.ts`): staff-first (detect staff lines → group into staves → group staves via barline connectivity). Per-staff barline scan (run ≥ 0.92 of staff height, touching both outer lines). Cross-staff alignment with `minBarlineStaves` vote. `pageSpanRatio` filter excludes page-spanning vertical rules.

**Lyric extraction** (`lyricsExtract.ts`): font-agnostic, splits multi-word runs, strips digits/colons/PUA symbols, cue/stage-direction stripping. Tested on 38+ non-scan PDFs.

**Alignment** (`alignSyncMap.ts`): many-to-one DP (each Whisper word absorbs a run of score syllables, scored on concatenation), longest monotonic chain with weighted continuity tiebreak.

**Timing model** (`timingModel.ts`): MEASURE axis (all systems laid end-to-end with cumulative measure offsets). `resolveTimedPosition` interpolates linearly between bracketing anchors, with tempo-aware gap traversal (beat-clock when confident, measured-rate with lag factor when not). Outlier anchors pre-filtered. Outro extrapolation when `tempoStability ≥ 0.6`.

**Scroll motion** (`scrollMotion.ts`): `dwellGlideBlend` (linear after 8% dwell), `adaptiveAnchorFraction` (0.33 confident → 0.52 low-confidence), `advanceFollowTarget` (monotonic ratchet, resets on seek detected by audio time).

### Small hooks / utilities

| File | Purpose |
|---|---|
| `useGainEnvelope` | Wraps a `GainNode` ref; exposes `setGainImmediate` / `rampGainTo` / `cancelRamps` |
| `useVolumeEnvelope` | rAF-based ease-in-out volume animation for WaveSurfer's software volume |
| `useTransportVisibility` | `expanded`/`collapsed` state for the dock (currently auto-collapse disabled) |
| `pdfWorker` | Points `pdfjs-dist` at its bundled Web Worker — must be imported before any PDF rendering (done in `main.tsx`) |
| `pdfThumbnail.ts` | Renders PDF page 1 to a small canvas for library card thumbnails |
| `leadIn.ts` | Client-side onset-envelope cross-correlation for `leadInOffset` detection |
| `assignLanes.ts` / `packIntervals` | Packs overlapping intervals into sub-lanes for margin bars and scrubber bands |
| `scanCheck.ts` | `isScannedPdf()` — gates out raster PDFs from the sync pipeline |
| `formatters.ts` | Time/duration formatting utilities |

### Temporarily disabled features

**Transport auto-collapse** — `useTransportVisibility` is called with `autoHideEnabled: false` in `PlayerDock.tsx` and `transportMode` is hardcoded to `'expanded'`. The hook and `collapsed` mode code in `TransportBar.tsx` still exist. To re-enable: remove `autoHideEnabled: false` and restore `const transportMode = seekExtensionOpen ? 'collapsed' : autoTransportMode`.

**Hold-to-seek radial menu** — The `handleSeekPointerDown/Move/Up/Cancel` handlers still exist in `TransportBar.tsx` but are commented out of the button JSX. The `renderSeekHoldMenu` calls are also commented out. To re-enable: restore the `onPointerDown/Move/Up/Cancel` props and uncomment the menu renders on the back/forward buttons.

### Planned but not yet implemented

**D3 mobile audio settings sheet** — Currently mobile gets the same button-anchored popover as desktop. Design calls for an `AudioLines` button that opens a full-width bottom sheet on touch devices. `AudioSlider` is already reusable for this.

**Manual lead-in nudge** — No UI yet to fine-tune `leadInOffset` for a track or change the reference track.

**C4 / B6** — LoopDetail card still exists; `sheetLinkDraft`/`isDraft` draft trio still wired in. Both to be removed together.

### Assets

`public/sheetmusic.pdf` and `public/sample.mp3` are the development fixture (a barbershop arrangement, "Monster Dance Medley", Dorico 6 export). In production, all assets are uploaded by the user via `AddSongModal` and stored as IndexedDB Blobs. A second bundled "demo song" (separate assets) is planned but not yet implemented.

A corpus of ~69 PDF scores lives in `public/PDFs/` and is used for pipeline regression testing (`tests/` via `tests/fixtures.ts`).

### Debugging notes

`DEBUG_LOOP_BG` in `PlayerDock.tsx` emits `console.warn('[LoopBG] ...')` throughout playback. Currently `false`. Set to `true` to debug loop boundary/timing issues.

`DEBUG_SYSTEMS` in `PDFViewer.tsx` renders system band overlays. Currently `false`.

`window.__detectSystems`, `window.__isLikelyScanned`, `window.__ws`, `window.__regions`, `window.__syncModel` are exposed in dev only. Use these (especially `__detectSystems`) to validate detection on the live browser render — the Node headless harness under-counts thin barlines.

`?pdf=/other.pdf` query param loads an alternate score without overwriting the fixture.

The dev cluster (bottom-left, `z-[60]`) shows **Sync Score** / **Export** / **overlay** / **scroll** controls when anchors are available.
