# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev
npm run build
npm run preview
```

There is no test suite or linter configured.

## What This App Does

A music practice tool. The PDF of sheet music (`public/sheetmusic.pdf`) fills the entire viewport. The audio player dock is a floating overlay anchored to the bottom of the page, layered on top of the PDF. It plays `public/sample.mp3`. The user can create named loop regions on the audio waveform, link each loop to a position in the PDF, and the PDF auto-scrolls to that position on every loop repeat.

## Architecture

### Data flow between the two panels

`App` is the only shared-state layer. `PlayerDock` pushes loop marker data **up** via `onLoopMarkersChange`; `App` passes it **down** to `PDFViewer` as `sheetMarkers`. Clicking a marker on the PDF calls `onMarkerClick` → `markerActivateRef` (a callback ref) → back into `PlayerDock` to activate that loop. The PDF imperative handle (`pdfViewerRef`) lets `PlayerDock` call `scrollToSheetPosition()` directly without re-rendering through `App`.

### Audio engine (`PlayerDock.tsx`)

The heaviest file. WaveSurfer is set up with two plugins (`RegionsPlugin` for loops, `RecordPlugin` for mic input) and wired through a Web Audio `GainNode` for volume control. Key subsystems:

- **Loop playback**: Each loop has `extendedStart`/`extendedEnd` bounds with a half-second pad. `audioprocess` + `timeupdate` events watch for the playback position crossing the end boundary and trigger a seek back to `extendedStart`. A drift guard prevents double-fires (80 ms threshold, 150 ms cooldown).
- **Fade envelope**: `useGainEnvelope` (Web Audio linear ramps) handles fade-out at loop end and fade-in at loop start to avoid clicks. `useVolumeEnvelope` (rAF + ease-in-out) handles WaveSurfer's software volume separately.
- **Recording**: Mic takes are saved as `Blob`s in IndexedDB via `audioStore.ts`. Playback uses an `AudioBufferSourceNode` → `takeGainRef` in the existing `AudioContext`. `takeWaveSurferRef` / `takeWaveContainerRef` are only for visualizing the recorded waveform, not for playback.
- **Sheet link**: When "scroll on repeat" is on, `PlayerDock` calls `pdfViewerRef.current.scrollToSheetPosition()` after seeking to the loop start.
- **Balance / mono**: The main chain is `masterGain → monoGain → stereoPanner → destination` (built once by `ensureBalanceChain`, persists across WaveSurfer re-inits). `setBalance(-1…+1)` ramps `stereoPannerRef.pan` (`setTargetAtTime`, 15 ms). `setMono(bool)` flips `monoGainRef` between `channelCountMode:'max'`/`channelCount:2` (stereo passthrough) and `'explicit'`/`1` (down-mix L+R to one channel, which the panner then re-spreads). Take playback (`takeGainRef`) stays wired straight to `destination` — balance/mono apply to the main track only. UI is the headphones popover (see Task 14).
- **Transpose**: `@soundtouchjs/audio-worklet` (`SoundTouchNode`) provides independent pitch shift (±5 semitones). The node is inserted **upstream of masterGain**: `mediaSource → soundTouch → masterGain → …` when transposing, and bypassed to `mediaSource → masterGain` at 0. The worklet module is registered (`SoundTouchNode.register`, URL from a Vite `?url` import of `@soundtouchjs/audio-worklet/processor`) and the node is created **lazily on the first non-zero transpose** — until then the default path is byte-identical to before and carries zero worklet cost. `setTranspose(semitones)` is async (awaits lazy init), sets `node.pitchSemitones.value`, then calls `applyTransposeRouting()`. **`applyTransposeRouting()` must run on every WaveSurfer (re)init** because the `MediaElementSourceNode` is recreated each time — the WaveSurfer setup effect calls it instead of a direct `mediaSource.connect(masterGain)`. The media element keeps `preservesPitch = true` (the speed control), and SoundTouch only adds an orthogonal pitch shift on top — so we deliberately did **not** disable `preservesPitch` or sync `soundTouch.playbackRate` (the design doc floated both; they're unnecessary and riskier). Placing SoundTouch upstream of masterGain keeps the loop fade ramps (on masterGain) real-time-accurate; the only cost is ~tens-of-ms desync between the waveform cursor and audio when transposing, well within `LOOP_PAD_SECONDS`.
- **Persistence**: Loop metadata (name, start/end, color, sheet link) is stored in `localStorage` under `practice:loops`. Take metadata under `practice:take`. Balance under `practice:balance`, mono under `practice:mono`, transpose under `practice:transpose` (all restored into refs during hydration, before the audio graph is built; transpose is then re-applied by an `audioReady` effect that builds the worklet node if the restored value is non-zero). Audio blobs in IndexedDB (`practice-audio` DB).

### PDF viewer (`PDFViewer.tsx`)

`react-pdf` renders all pages in a vertical scroll container. A `ResizeObserver` tracks container width and computes `fitWidthScale`; desktop adds a `1.4×` default zoom. An `IntersectionObserver` on each page element tracks which page is currently visible. The imperative handle exposes `getSheetPosition()` (captures current scroll as `{page, yWithinPageRatio}`) and `scrollToSheetPosition()` (translates back to a pixel offset).

Sheet markers are colored pill buttons overlaid on each page. Before positioning a marker, the component samples pixels from the page's `<canvas>` at several candidate y-offsets and picks the one landing on the whitest area (i.e., a gap between staff lines).

### Small hooks / utilities

| File | Purpose |
|---|---|
| `useGainEnvelope` | Wraps a `GainNode` ref; exposes `setGainImmediate` / `rampGainTo` / `cancelRamps` |
| `useVolumeEnvelope` | rAF-based ease-in-out volume animation for WaveSurfer's software volume |
| `useTransportVisibility` | `expanded`/`collapsed` state for the dock; auto-collapses after 2.5 s, holds open while pointer is down |
| `pdfWorker` | Points `pdfjs-dist` at its bundled Web Worker — must be imported before any PDF rendering (done in `main.tsx`) |

### Temporarily disabled features

**Transport auto-collapse** — `useTransportVisibility` is called with `autoHideEnabled: false` in `PlayerDock.tsx` and `transportMode` is hardcoded to `'expanded'`. The hook and `collapsed` mode code in `TransportBar.tsx` still exist. To re-enable: remove `autoHideEnabled: false` and restore `const transportMode = seekExtensionOpen ? 'collapsed' : autoTransportMode`.

**Hold-to-seek radial menu** — The `handleSeekPointerDown/Move/Up/Cancel` handlers still exist in `TransportBar.tsx` but are commented out of the button JSX. The `renderSeekHoldMenu` calls are also commented out. To re-enable: restore the `onPointerDown/Move/Up/Cancel` props and uncomment the menu renders on the back/forward buttons.

### Planned but not yet implemented

**Mobile audio settings sheet** — Balance/mono (headphones popover), speed, and transpose (♭♯ popover) are all desktop transport-bar buttons. The design calls for a single mobile `AudioLines` button that opens a bottom sheet stacking all the controls instead of cramming the popovers into the scaled-down mobile transport. Not built yet — but the three popovers already share the reusable `AudioSlider`, so the sheet can reuse it.

### Static assets

`public/sheetmusic.pdf` and `public/sample.mp3` are hardcoded paths with no file-picker yet.

### Debugging notes

`DEBUG_LOOP_BG` in `PlayerDock.tsx` emits `console.warn('[LoopBG] ...')` throughout playback. It is currently `false`. Set to `true` to debug loop boundary/timing issues.

### TransportBar

`TransportBar.tsx` is purely presentational — all buttons, the loop list, and the speed/transpose/balance popovers. `PlayerDock` owns all state and logic and passes everything down as props.

The three audio-setting popovers (speed, transpose, balance) all use the shared **`AudioSlider`** (`AudioSlider.tsx`): a custom slider with a **center-out** accent fill (fills from `center` to the thumb in either direction), a magnetic center **detent** (`snapThreshold`), a `live` flag, and a `centerSlot(display, dragging)` render-prop placed on the min/max label row. Balance (step 0.01) and speed (0.5–1.5, step 0.05) are `live`; **transpose (step 1, `live={false}`) commits only on pointer-up** — the thumb tracks the drag with a translucent fill and `setTranspose` fires once on release to avoid the worklet "catch" on every intermediate semitone. The `centerSlot` shows a subtly-shaded **"Reset"** chip when off-center (nothing when neutral — the button face carries the state); transpose additionally previews the live interval there while dragging (committing it to the button on release). `renderTransposeLabel` renders the flat glyph as a lighter superscript with M/P at the degree's size, and a larger ♭♯ neutral glyph. Popovers center on their button. The mono toggle (label simply "Mono") is **only shown for stereo sources** — a mono track can't be made stereo, so there's nothing to collapse. `PlayerDock` detects the true channel count by decoding the file itself in a low-sample-rate `OfflineAudioContext` (`sourceChannelCount`); `waveSurfer.getDecodedData()` is unreliable here because WaveSurfer downmixes to mono for the waveform. The balance button's gradient starts subtly and spills to ~80% coverage at full pan.