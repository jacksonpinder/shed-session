# Score Sync

Covers: `src/lib/generateSyncMap.ts`, `src/lib/scanCheck.ts`, `src/lib/lyricsExtract.ts`, `src/lib/transcribe.ts`, `src/lib/alignSyncMap.ts`, `src/lib/detectSystems.ts`, `src/lib/timingModel.ts`, `src/lib/scrollMotion.ts`, `src/lib/syncMap.ts`

**Related docs:** [app-shell](./app-shell.md) · [pdf-viewer](./pdf-viewer.md) · [audio-engine](./audio-engine.md)

---

## Responsibilities

The score sync system converts a PDF score + audio file into a time → score position map (`Anchor[]`), then resolves that map at playback time into a scrollable position for the PDF viewer's auto-scroll loop.

The pipeline runs in two independent legs coordinated by `analysisManager.tsx` (see [app-shell.md](./app-shell.md)):

1. **PDF leg** (fast, client-side): scan check → lyric extraction → stored on `Song.pdf`
2. **Audio leg** (slow, via sidecar): Whisper transcription + beat analysis → stored on `Track`

When both legs are done, `tryAlign()` runs the alignment stage and stores `Anchor[]` on `Song.anchors`.

---

## Pipeline Overview

```
PDF blob ──scanCheck──▶  rejected (scanned)
         ──lyricsExtract──▶  LyricToken[]  ─────────────────┐
                                                             ├──alignSyncMap──▶  Anchor[]
Audio ──transcribe (Whisper sidecar)──▶  Word[]  ───────────┘
         └──beat analysis──▶  BeatAnalysis

PDF canvases ──detectSystems──▶  SystemBand[]  (lazy, cached in PDFViewer)

At playback time t:
  buildTimingModel(anchors, systemBands, beat?) ──▶  TimingModel
  resolveTimedPosition(model, t) ──▶  TimedPosition  ──▶  PlayheadAnchor
  advanceFollowTarget(rawTarget, t, state) ──▶  monotonic scroll target
```

`generateSyncMap.ts` is the orchestrator for the offline pipeline (PDF + audio → anchors in one call). In the live multi-song app, `analysisManager.tsx` runs the same stages incrementally with IndexedDB caching.

---

## Stage 1: Scan Check (`src/lib/scanCheck.ts`)

Detects raster PDFs (scans) before running any expensive analysis.

**Method:** Sample the first 5 pages, tally `imageOps` and `pathOps` per page from the PDF content stream.

- Vector score pages: many path ops (staff lines, note stems, beams), few/no image ops
- Scanned pages: ≥1 image op, ≤8 path ops

A page is "raster" if `imageOps ≥ 1 AND pathOps ≤ maxVectorPaths (8)`. The document is "scanned" if ≥60% of inked pages are raster.

**Why not pixel heuristics?** White-balanced scans have near-white pixels and fool ink-ratio checks. Content-stream op counts are invariant to image processing.

```ts
isScannedPdf(pdf: PDFDocumentProxy, opts?): Promise<boolean>
```

---

## Stage 2: Lyric Extraction (`src/lib/lyricsExtract.ts`)

Extracts lyric text tokens from the PDF text layer without knowing the font.

**Two-pass algorithm:**

*Pass 1:* Collect wordlike items per page. For each item: must contain letters, be <24 chars, contain no digits or `=` signs, allow hyphens/apostrophes. Track per-font statistics: if a font has ≥4 items and >60% single-character tokens, it's a music font (symbol, accidental, clef) — exclude all its items.

*Pass 2:* Cluster surviving items into rows by Y proximity (within 1.2% of page height). Keep rows with ≥3 tokens spanning ≥22% of page width. Drop running headers: rows whose text appears (≥34% identical) across ≥34% of pages at y < 0.13 (top 13%).

Cue/stage-direction stripping: if the first 1–4 tokens in a row are followed by a colon-terminated token, drop the cue prefix (e.g., "Melody solo:").

```ts
type LyricToken = {
  text: string
  page: number       // 1-based
  xRatio: number     // 0…1
  yRatio: number     // 0…1, baseline
}

extractLyrics(pdf: PDFDocumentProxy, opts?): Promise<LyricToken[]>
```

---

## Stage 3: Transcription (`src/lib/transcribe.ts`)

Posts the audio blob to the Whisper sidecar and returns timestamped words.

```ts
type Word = { text: string; start: number; end: number; confidence: number }
type BeatAnalysis = { tempo: number; beatTimes: number[]; pulseClarity: number; clarityWindows: {t, clarity}[] }
type Transcription = { words: Word[]; language: string; duration: number; beat?: BeatAnalysis; sourceHash: string }

transcribe(audio: Blob, signal?: AbortSignal): Promise<Transcription>
whisperHealthy(signal?: AbortSignal): Promise<boolean>
```

**Sidecar URL:** `VITE_WHISPER_URL` env var, default `http://localhost:8123`. The `sourceHash` (SHA-256 of audio) is used by the library layer to skip re-transcription when a track is re-analyzed.

---

## Stage 4: System Detection (`src/lib/detectSystems.ts`)

Detects staff groups (systems) and measure boundaries from the rendered PDF canvas. All outputs are scale-invariant ratios.

**Five-stage pixel pipeline:**

| Stage | Input | Output |
|---|---|---|
| 1. Luma threshold | Canvas pixels | Adaptive dark threshold (Otsu's method) |
| 2. Row profiles | Dark pixels | Per-row dark fraction + longest dark run fraction |
| 3. Staff grouping | Rows | `Staff[]` — groups of ≥3 lines within 2.5× staff-space |
| 4. Barline connectivity | Staves + gaps | `isBoundary[]` — which inter-staff gaps have no barline connecting across |
| 5. Systems + measures | Staves + boundaries | `SystemBand[]` — top/bottom ratios, optional measure count + barline x-positions |

```ts
type SystemBand = {
  topRatio: number          // top of system (0…1)
  bottomRatio: number       // bottom of system
  firstLineRatio: number    // top staff line
  lastLineRatio: number     // bottom staff line
  measureCount?: number
  barlineXRatios?: number[]
}

detectSystems(canvas: HTMLCanvasElement, opts?): DetectSystemsResult
bandForY(bands: SystemBand[], yRatio: number): SystemBand | null  // find band containing y
```

**Key options:**
- `barlineHeightRatio = 0.92` — barline must span ≥92% of staff height (per-staff scan, not system)
- `minMeasureWidthRatio = 0.035` — collapse barline candidates closer than this
- `pageSpanRatio = 0.5` — exclude columns that are dark for ≥50% of page height (margin rules)

**Dev note:** The Node.js headless test harness under-counts thin barlines because the canvas renderer renders thinner strokes than a browser. Use `window.__detectSystems(pageNumber)` in the browser console to validate detection on live renders.

---

## Stage 5: Alignment (`src/lib/alignSyncMap.ts`)

Aligns `LyricToken[]` (score syllables) to `Word[]` (Whisper words) to produce `Anchor[]`.

**Core insight:** Whisper transcribes whole words; scores may hyphenate across syllables. One Whisper word maps to ≥1 score syllable run. The algorithm finds the best many-to-one mapping.

**Algorithm:**

1. **Many-to-one DP (`alignManyToOne`):** State = (word index, syllable boundary). Each word absorbs ≤`MAX_RUN` (6) syllables. Score = `wordSimilarity(word, concat_run)` minus a tiny gap penalty (−1e-4 per unused syllable slot). `wordSimilarity` uses Sørensen-Dice bigram coefficient on normalized (lowercase, accent-stripped, alpha-only) text.

2. **Candidate filtering:** Keep pairs with similarity ≥ `minSimilarity` (default 0.5).

3. **Monotonic chain (`bestMonotonicChain`):** Find the longest path through candidates where score position never goes backward. Soft penalty (0.4×) for velocity discontinuities, capped at 0.9 so chain length always dominates. Hard limit: `MAX_KEY_PER_SEC = 0.6` page-units/sec — impossible spatial jumps (e.g., repeated lyrics jumping back a page) are rejected entirely.

```ts
type Anchor = {
  time: number              // audio time (seconds)
  page: number
  yWithinPageRatio: number
  text: string
  confidence: number
  xWithinPageRatio?: number
  heard?: boolean
}

alignSyncMap(lyrics: LyricToken[], words: Word[], opts?): Anchor[]
```

**Tuning notes:**
- `minSimilarity = 0.5` is calibrated for barbershop/choral. Instrumental-heavy sections or poor transcription quality will produce zero anchors. Check the `trace` debug output.
- `MAX_KEY_PER_SEC = 0.6` prevents repeated-lyric false positives (verse 1 matching verse 2's position). Lower values are safer but reject more real anchors.

---

## Stage 6: Timing Model (`src/lib/timingModel.ts`)

Converts sparse `Anchor[]` into a continuous time → score position function using a global **measure axis**.

### Measure axis

All detected systems are laid end-to-end by cumulative measure offset (μ). Each anchor maps to a fractional μ coordinate. Interpolation in μ-space fills gaps between anchors.

```
systems = [sys0 (0…N0 measures), sys1 (N0…N0+N1 measures), …]
anchor.mu = anchorMeasure(anchor, systems)
```

```ts
type TimingModel = {
  systems: TimingSystem[]
  totalMeasures: number
  samples: { time: number; mu: number }[]   // filtered, monotonic
  tempoStability: number                    // 0…1
  measuresPerSecond: number
  introSteady: boolean
}
```

### Building the model (`buildTimingModel`)

1. Map each anchor to μ via `anchorMeasure()` (uses barline x-positions when available, else system midpoint)
2. Filter outliers: drop anchors where both in-slope and out-slope deviate >3× from the global μ-rate (one-sided anomalies like fermatas are kept)
3. Enforce monotonic μ: clamp/drop any anchor that goes backward in score position
4. Compute `tempoStability` = 1 − robust coefficient of variation on close-anchor (≤3s apart) slope pairs; blended 40% anchor + 60% beat when beat analysis is present
5. Compute `introSteady`: use beat `pulseClarity` if available, else anchor stability; threshold 0.4

### Resolving position at playback time (`resolveTimedPosition`)

```ts
resolveTimedPosition(model: TimingModel, time: number): TimedPosition | null
```

Three regimes:

| Regime | Condition | Behavior |
|---|---|---|
| Intro | `time < firstAnchor.time` | Linear ramp from μ=0 to firstAnchor.mu if `introSteady`; else null (no auto-scroll) |
| Main | Between two anchors | Linear interpolation in μ-space; confidence penalized by `min(1, (gapMeasures/4) × (1−stability))` |
| Outro | `time > lastAnchor.time` | Extrapolate at `measuresPerSecond` if `tempoStability ≥ 0.6`; else hold on last system |

`confidence` drives `adaptiveAnchorFraction` in the scroll motion layer — low confidence anchors the current system lower in the viewport to prevent over-scrolling.

---

## Stage 7: Scroll Motion (`src/lib/scrollMotion.ts`)

Pure math, no DOM. Three functions called by PDFViewer's rAF loop:

### `adaptiveAnchorFraction(confidence, systemHeightFraction)`
Returns the viewport fraction at which to pin the top of the current system.
- Confident (1.0) → 0.40 (upper third of viewport, lookahead)
- Low confidence (0.0) → 0.52 (lower half, safety margin)
- Clamped [0.40, 0.55]

### `cappedScrollStep(step, systemPx, dtSec)`
Caps forward scroll so a system can't traverse the viewport in less than `MIN_SECONDS_PER_SYSTEM` (0.7s). Prevents multi-system lurches from early anchor firings.

### `advanceFollowTarget(rawTarget, time, state)`
Monotonic scroll ratchet:
- **Normal:** return `max(rawTarget, state.maxTarget)` — can only move forward
- **Cold start** (`lastTime === null`): ease in, don't snap
- **Real seek** (time jumps >1s forward or >50ms backward): snap to `rawTarget`, reset ratchet
- Returns `{ target, seeked, state }`

---

## Alignment Debug Export (`src/lib/syncDebug.ts`)

`formatSyncDebug(bundle: SyncDebugBundle): string` renders an `AlignTrace` (from `alignSyncMapTrace()`) as a human-readable text report for diagnosing misalignment:

```
=== ANCHORS ===          time  whisper_heard  → lyric  pos  conf
=== MATCHES ===          ✓ (kept in chain) / · (dropped) per candidate
=== WHISPER WORDS ===    raw word stream in time order
=== LYRIC TOKENS ===     reading-order syllables per page
```

This is the primary tool for diagnosing alignment failures. Enable via the `debug: true` option in `generateSyncMap()` and inspect `result.trace`.

---

## Sync Map Types (`src/lib/syncMap.ts`)

```ts
type Anchor = { time, page, yWithinPageRatio, text, confidence, xWithinPageRatio?, heard? }
type SyncMap = { version: 1, sourceHash: string, anchors: Anchor[] }

anchorAtTime(anchors: Anchor[], time: number): Anchor | null  // binary search
anchorToSheetPosition(anchor: Anchor): SheetPosition
resolveScrollPosition(anchors, bandsByPage, time): SheetPosition | null  // → system top
```

---

## Key invariants

- **Measure axis is non-decreasing.** `buildTimingModel` drops any anchor that would move μ backward. This is what guarantees scroll never jumps backward during normal playback.
- **Alignment output is in track-time.** `tryAlign()` in `analysisManager` subtracts `leadInOffset` before storing anchors so they're in song-time (shared across tracks). See [audio-engine.md](./audio-engine.md#time-coordinate-system).
- **`detectSystems` must run on the browser-rendered canvas.** Barline thickness varies by renderer; the Node headless harness under-counts thin barlines. Detection on a different canvas than the one being displayed will produce wrong bands.
- **Timing model rebuild is triggered by `timingModelVersion` in PlayerDock.** Any change to anchors, beat analysis, or system bands (including the first `onSystemBandsReady` fire) must bump this version counter.

---

## When modifying this system

- **`minSimilarity` in `alignSyncMap`** trades coverage vs. false positives. 0.5 works for choral/barbershop. Pop music with heavy melisma or instrumental breaks may need 0.4.
- **`detectSystems` options are score-type-dependent.** `barlineHeightRatio = 0.92` works for barbershop (one barline per staff height). Orchestral scores may need a lower value.
- **`tempoStability ≥ 0.6` for outro extrapolation** is a conservative gate. Songs with rubato endings should not try to extrapolate.
- **`MAX_KEY_PER_SEC = 0.6` in `alignSyncMap`** prevents repeated-lyric traps. Lowering it may reject valid anchors in fast-moving scores.
- **Adding a new pipeline stage** that produces score metadata: store it on `Song` or `Track` via `updateSong`/`updateTrack` (see [persistence.md](./persistence.md#atomic-read-merge-write)) and trigger `timingModelVersion` bump in PlayerDock when it arrives.

---

## Common failure modes

- **Zero anchors:** Usually lyric/transcription mismatch. Common causes: instrumental PDF (no lyrics), scanned PDF (slipped through `isScannedPdf`), or very different spelling between engraver and Whisper. Enable `alignSyncMapTrace()` and inspect `trace.pairs` to see what was matched.
- **Auto-scroll holds on last system after song ends:** `tempoStability < 0.6`; outro extrapolation is gated off. Verify beat analysis was attached to the song (check `Song.beat`).
- **System bands wrong on a specific score:** Wrong `barlineHeightRatio` or staff grouping threshold for that score's notation style. Use `window.__detectSystems(page)` in the browser console to inspect at render-time.
- **Intro auto-scroll starts too early:** `introSteady` is true when it shouldn't be. Check `pulseClarity` from beat analysis — if the track opens with drums/piano attack, Whisper beat detection may be overconfident.
- **Anchors appear at wrong vertical positions:** `anchorMeasure()` fell back to system midpoint (no barline x-positions). Measure detection failed for that page. Check `SystemBand.measureCount` — if 0 or null, barline detection didn't fire.
