# Project State

_Update this file whenever a significant piece of work lands or the focus shifts._

## Current Architecture (as of 2026-06-25)

### App shell

`App.tsx` is a hash router (`#/` = library, `#/song/:id`). `Library.tsx` lists songs from IndexedDB. `SongView.tsx` is the old App body — it loads blobs, injects the per-song store, and renders `PDFViewer` + `PlayerDock`. `AnalysisProvider` (above the router) owns the Whisper/sync pipeline and surfaces status to `SongView`.

### Storage

- **IndexedDB** (`practice-audio`, v2): `blobs`, `songs`, `tracks`, legacy `audio-blobs`
- **localStorage**: per-song settings (`practice:loops`, `practice:speed`, `practice:transpose`, `practice:balance`, `practice:mono`, `practice:repeat-song`, `practice:repeat-loop`, `practice:autoscroll-song`, `practice:autoscroll-loop`, `practice:syncMap`)
- Pluggable KV (`PracticeStore` in `storage.ts`): `SongView` injects a store that maps `practice:*` keys → Song/Track fields in the DB. `PlayerDock` sees the same API whether it's talking to localStorage (legacy) or IndexedDB (library).

### Audio engine (`PlayerDock.tsx`)

WaveSurfer + RegionsPlugin + RecordPlugin, routed through a Web Audio chain:

```
MediaElementSource → [SoundTouchNode (±7 semitones, bypassed at 0)]
  → masterGain → monoGain → stereoPanner → destination
                                    takeGain ──────────────→ destination (mic takes)
```

Loop boundary enforcement: `audioprocess`/`timeupdate` cross-check `extendedStart`/`extendedEnd` with 80 ms drift guard + 150 ms cooldown. Fade envelopes: `useGainEnvelope` (Web Audio ramps) for click-free loop wrap; `useVolumeEnvelope` (rAF) for the waveform software volume.

Lead-in offset: `songToTrackTime`/`trackToSongTime` applied at three seams — loop↔region sync, writeback on drag/new loop, and time→anchor resolution. Non-reference tracks cross-correlate onset envelopes against the reference (`src/lib/leadIn.ts`) to get `leadInOffset` without a second Whisper pass.

### Score sync pipeline

```
PDF  ──lyricsExtract──▶ LyricToken[]  ─┐
                                       ├─alignSyncMap──▶ Anchor[]
MP3  ──transcribe (sidecar)──▶ Word[] ─┘
PDF canvases ──detectSystems──▶ bandsByPage (lazy, cached in PDFViewer handle)

at playback time t:
  resolveTimedPosition(timingModel, t) → TimedPosition {fractionThroughSystem, …}
  scrollMotion.advanceFollowTarget(rawTarget, t, state) → monotonic eased target
  PDFViewer.startPlayheadFollow(getAnchor) → rAF loop → smooth continuous scroll
```

Scan gate: `isScannedPdf()` in `scanCheck.ts` (image-present + ≤8 path ops per page). Scanned PDFs bail early with `reason:'scanned'`.

### PDF viewer (`PDFViewer.tsx`)

`react-pdf`, all pages in a vertical scroll container. `ResizeObserver` → `fitWidthScale` (desktop default 1.4×). Imperative handle: `getSheetPosition()`, `scrollToSheetPosition()`, `getSystemBands()` (lazy), `startPlayheadFollow(getAnchor)`, `stopPlayheadFollow()`.

**Margin loop bars**: 6px vertical bars running the full docY span of each loop (continuous across page breaks), positioned just outside the page's right edge. Chip at bar top (`position:sticky`). Overlap handling via `packIntervals`.

**Edge scrubber rail** (`EdgeScrubberRail.tsx`, 60px): stacked white page cards with loop bands in a left gutter, draggable teal viewport window, hover chip per loop.

### Transport (`TransportBar.tsx`)

Three-zone grid (`1fr auto 1fr`): left = Add/Exit loop button; center = pill (Repeat / Back / Play / Forward / Nav); right = AudioLines button. `AudioLines` opens a stacked panel with Speed / Transpose / Balance+Mono sliders (`AudioSlider`). All purely presentational — state and logic in `PlayerDock`.

### Loop lane (`LoopLaneStrip.tsx`)

Expanded: color-coded rows of loop chips with a connector bracket from the active waveform region down to the active chip. Collapsed: blurred "whisper" peek (5/4/3px rows, opacity fadeout, blur 2px) + tap-to-expand; invisible bumper at bottom for collapse.

---

## Active Work

_Batch B styling iteration (loop buttons, rail padding) complete. No active work — see BACKLOG.md for what's next._

---

## Known Issues / Deferred

| Item | Notes |
|---|---|
| Score Sync auto-scroll not live-verified | Autoplay gesture block in preview environment prevents `isPlaying` flip. Needs a real browser click to test. |
| `npm run build` broken (pre-existing) | tsconfig missing `jsx`. Use `npx tsc -p tsconfig.json --jsx react-jsx` to typecheck. |
| D3 mobile bottom sheet | Currently mobile gets the same button-anchored popover as desktop, not a full-width bottom sheet. |
| B2: Play-bar height | Should match collapsed waveform height. Deferred until D group pill sizing settles. |
| B6: Legacy sheetLinkDraft machinery | `sheetLink`/`isDraft`/draft trio wired into LoopDetail. Remove together with C4. |
| C4: LoopDetail card | To be removed; replaced with inline name edit + trash-with-undo on the loop button. |
| Demo song | Needs separate bundled PDF+MP3 assets (not `public/sample.mp3` + `public/sheetmusic.pdf`). |
| Dead-code in TransportBar | `speedMenuOpen`, `transposeOpen`, `balanceOpen` state, button refs and click-outside effects are now unused. |
| Lead-in nudge control | Currently reference = first uploaded track; no manual UI to nudge offset or change reference. |

---

## Next Actions

1. **C4**: Replace LoopDetail with inline loop rename + trash-with-undo
2. **B6**: Remove legacy `sheetLinkDraft`/`isDraft` after C4 lands
3. **D3 mobile**: Bottom sheet for audio settings on touch devices
4. **Dead-code pass**: Remove unused state/refs in TransportBar (see table above)
5. **Live-verify auto-scroll**: Open the app in a real browser, start the sidecar, click play
