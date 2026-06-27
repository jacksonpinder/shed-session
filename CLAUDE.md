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
npm run build      # vite build (no tsc; Netlify-ready)
npm run typecheck  # tsc strict check (doesn't block build)
npm run preview
npm test           # node --experimental-strip-types; tests in tests/*.test.ts (Node 22+)
```

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

Full system documentation lives in [`docs/architecture/`](docs/architecture/):

- [`app-shell.md`](docs/architecture/app-shell.md) — hash routing, SongView as state coordinator, AnalysisProvider, imperative handle ref pattern, background analysis legs, first-run migration
- [`audio-engine.md`](docs/architecture/audio-engine.md) — Web Audio graph, WaveSurfer setup, loop fade/wrap mechanics, balance/mono/transpose DSP, lead-in offset, take recording, auto-scroll driver
- [`pdf-viewer.md`](docs/architecture/pdf-viewer.md) — react-pdf rendering, scaling, system band detection, playhead follow rAF loop, margin loop bars, EdgeScrubberRail
- [`score-sync.md`](docs/architecture/score-sync.md) — scan check, lyric extraction, Whisper transcription, system detection, alignment DP, measure-axis timing model, scroll motion math
- [`persistence.md`](docs/architecture/persistence.md) — IndexedDB schema, typed CRUD, atomic read-merge-write, PracticeStore injection pattern, debounced flush
- [`ui-system.md`](docs/architecture/ui-system.md) — TransportBar, AudioSlider, LoopLaneStrip, ContextBar, TrackSelector, EdgeScrubberRail, packIntervals
- [`testing.md`](docs/architecture/testing.md) — test files, probe scripts, fixture corpus, Node constraints

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
