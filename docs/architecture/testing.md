# Testing

Covers: `tests/*.test.ts`, `tests/fixtures.ts`, `tests/*.ts` (probe scripts)

**Related docs:** [score-sync](./score-sync.md) · [persistence](./persistence.md) · [audio-engine](./audio-engine.md)

---

## Overview

The test suite runs under Node 22 using native TypeScript type-stripping (`--experimental-strip-types`). No transpile step; no test framework. Each test file is a self-contained script that prints `PASS`/`FAIL` per assertion and exits with code 0 (all pass) or 1 (any failure).

```bash
npm test    # runs node --experimental-strip-types on tests/*.test.ts
```

Tests live in `tests/`. Fixtures live in `public/` (dev fixture) and `public/PDFs/` (corpus of ~69 scores).

---

## Test files

### `tests/alignSyncMap.test.ts`

Unit tests for the alignment DP (`alignSyncMap`). Pure function — no DOM, no file I/O.

Scenarios covered:
- Basic phrase: "Fly me to the moon" — syllables matched to Whisper words, positions monotonic
- Monotonicity pruning: duplicate lyric with later page/y is dropped by chain selection
- Echo/reprise: same phrase on two systems; single sung pass stays on the first system
- Empty inputs (lyrics or words): returns `[]`
- Accent/case robustness: "Glo-ri-a" → "gloria"
- **Regression: substring inflation** — `"corner"` must bind `cor+ner`, not a bare `"or"` in the same row (false 0.9 similarity)
- **Regression: reprise "beach"** — `"beach"` must not bind the `"be"` prefix of `"Maybe"` on the next page
- **Regression: repeated-lyric trap ("it's" bug)** — `"its"` appearing far up (page 3) and near (page 4) must bind the near instance when followed 0.6s later by `"only"` and `"just"` on page 4; the far instance implies an impossible spatial velocity

### `tests/timingModel.test.ts`

Unit tests for `buildTimingModel` and `resolveTimedPosition`/`resolveScrollSegment`. Synthetic `SystemBand` fixtures (three-page, 4-measure bands with evenly-spaced barlines).

Scenarios covered:
- Steady tempo: model builds, total measures correct, stability > 0.8, silent page 2 filled by interpolation
- Monotonicity: position never decreases as time advances (full 0..12s sweep at 0.25s steps)
- Rubato: erratic local slopes → stability < 0.6, unsteady intro yields `null`
- Beat analysis: steady `pulseClarity` → intro pre-rolls page 1; rubato `pulseClarity` → holds
- No measure counts (faint barlines): falls back to 1 measure/system, still builds and resolves
- Gap traversal: linear in measure space (equal time steps → equal Δmeasure; no lead/lag)
- Outlier rejection: both-sides outlier dropped; one-sided surprise (fermata) kept
- Outro: steady → extrapolates clamped to `totalMeasures`; rubato → holds
- Backward anchor exclusion: anchor that would move μ backward is dropped; interpolation advances through it
- `resolveScrollSegment`: gap spans anchor systems with constant-pixel-velocity blend (linear in time); intro sweeps start→first-sung-system; rubato intro yields `null`; rubato outro holds
- Anchor-time faithfulness: at each anchor's timestamp, scroll sits exactly on that anchor's system (proof that visible scroll offset = Whisper timestamp error, not engine desync)

### `tests/scrollMotion.test.ts`

Unit tests for the three pure math functions in `scrollMotion.ts`.

Scenarios covered:
- `adaptiveAnchorFraction`: confident → `BASE_FRACTION`; low → `SAFE_FRACTION`; tall system floor; `MAX_FRACTION` cap; clamped confidence
- `advanceFollowTarget` ratchet: forward play with ±60 raw-target wobble stays monotonic; cold start is not a seek; backward time jump (0.6s back) resets ratchet; sub-threshold wobble ignored; forward skip (> 1s) detected
- `cappedScrollStep`: gentle step passes through; lurch capped to `systemPx / MIN_SECONDS_PER_SYSTEM`; backward/zero steps uncapped; unknown system height → no cap

### `tests/pipeline.test.ts`

Integration tests using real PDFs and synthetic word data.

Scenarios covered:
- `resolveScrollPosition`: synthetic anchors + bands → maps lyric y to system top; fallback to lyric y when no bands; null when no anchors; `anchorAtTime` picks nearest
- End-to-end `monster.pdf`: extract lyrics, simulate Whisper words (drop 1/5, inject noise "zzz"), run `alignSyncMap`, assert >30 anchors, strictly increasing times, monotonic reading-order, noise word "zzz" not anchored
- Scanned PDF short-circuit: `generateSyncMap` returns `reason: 'scanned'` before hitting the transcription sidecar (proves scan gate fires before I/O)

### `tests/extractLyrics.test.ts`

Tests `extractLyrics` against real PDFs from the corpus.

Scenarios covered (per PDF):
- `sheetmusic.pdf`: >20 tokens, includes "nuh", no digit-only tokens, no notehead glyphs, all yRatio in 0..1, cue labels ("solo") stripped
- Additional corpus PDFs when present: no digit-only tokens, reasonable token count

### `tests/scanCheck.test.ts`

Runs `isScannedPdf` against every corpus PDF. Prints verdicts for eyeball review; asserts known-label cases (specific scanned PDFs must be flagged, specific vector scores must not).

### `tests/library.test.ts`

Tests `src/lib/library.ts` CRUD under Node using `fake-indexeddb/auto` as the IndexedDB shim.

Scenarios covered: `createSong`, `getSong`, `updateSong`, `deleteSong`, `duplicateSong`, `listSongs`, `createTrack`, `getTrack`, `listTracks`, `updateTrack`, `deleteTrack`, `putBlob`, `getBlob`, `deleteBlob`, `DEFAULT_SETTINGS`.

### `tests/leadIn.test.ts`

Tests the pure math core of `leadIn.ts` with synthetic audio data. The full decode step needs Web Audio API, which Node doesn't have — only `computeOnsetEnvelope` and `correlateOffsetFrames` are exported and tested here.

Scenarios covered:
- Onset envelope: silence → burst produces positive peak at burst frame, half-wave rectified (no negatives)
- Cross-correlation with known lag: synthetic signal delayed by N frames → `correlateOffsetFrames` returns correct lag within 1 frame

---

## Probe / diagnostic scripts

These are **not** pass/fail tests. They sweep the full corpus and print summaries for human review. Run them with `node --experimental-strip-types tests/<script>.ts`.

| Script | Purpose |
|---|---|
| `analyzeAll.ts` | Runs `extractLyrics` on every corpus PDF; flags suspicious output (staff labels, tempo directions, PUA glyphs leaking through) |
| `scanCheck.test.ts` | (doubles as probe) Prints scan classification + ink profile for every corpus PDF |
| `systemsAll.ts` | Renders each PDF page to a canvas via `@napi-rs/canvas`, runs `detectSystems`, flags anomalies (no systems on content pages, bands out of range, overlapping bands, absurd measure counts) |
| `barlineProbe.ts` | Per-PDF per-page barline detection detail; used to tune `barlineHeightRatio` and `minMeasureWidthRatio` |
| `spanCompare.ts` | Compares page-spanning rule detection across PDFs |
| `overlayShots.ts` | Renders system band overlays to PNG for visual inspection |
| `measureGroundTruth.ts` | Compares detected measure counts against manually-entered ground truth |
| `probeHeights.ts` | Inspects staff height / staff spacing ratios across the corpus |

**Important:** `systemsAll.ts` (and by extension any headless canvas test) under-counts thin barlines. `@napi-rs/canvas` rasterizes thin vertical rules more weakly than the browser. Measure counts from headless runs are not reliable — use `window.__detectSystems(pageNumber)` in the browser console to validate measure detection.

---

## Fixture setup (`tests/fixtures.ts`)

```ts
fixturePath(file: string): string     // resolves across public/ and public/PDFs/
hasFixture(file: string): boolean
allFixturePdfs(): string[]            // sorted by base name across both dirs
```

PDFs are in two locations:
- `public/` — dev fixture (`sheetmusic.pdf`, `sample.mp3`, a few known-label test PDFs)
- `public/PDFs/` — corpus of ~69 scores for regression testing (not committed to the main branch; expected to be present locally)

Tests that use corpus PDFs wrap their assertions in `if (hasFixture('file.pdf'))` so they degrade gracefully when the corpus isn't present.

---

## Constraints and limitations

| Constraint | Reason | Workaround |
|---|---|---|
| No Web Audio in Node | `AudioContext`, `OfflineAudioContext` are browser-only | `leadIn.test.ts` tests only the pure math core (`computeOnsetEnvelope`, `correlateOffsetFrames`) |
| No browser canvas in Node | Real canvas rendering differs from `@napi-rs/canvas` for thin lines | System/barline detection validated in-browser via `window.__detectSystems` |
| No Whisper sidecar in CI | `transcribe()` hits `localhost:8123` | `pipeline.test.ts` uses synthetic word data for end-to-end tests; scanned-PDF test uses a stub audio blob |
| No IndexedDB in Node | Browser-only API | `library.test.ts` uses `fake-indexeddb/auto` shim |
| No React in tests | Components not tested here | UI components tested manually via browser dev server |

---

## When modifying this system

- **Adding a new alignment invariant** (e.g., a new edge case found in a corpus PDF): add a named regression test to `alignSyncMap.test.ts` with a clear comment explaining the bug it catches. The existing regression tests all include the original bug description.
- **Adding a new timing model behavior**: add to `timingModel.test.ts` with synthetic bands. Name the scenario clearly — e.g., "gap traversal: straight line", "outlier rejection: both-sides vs one-sided".
- **Adding a new `library.ts` operation**: add a test case to `library.test.ts`. The `fake-indexeddb` shim is accurate enough for CRUD testing.
- **Adding a new corpus PDF**: drop it in `public/PDFs/` and run `analyzeAll.ts` and `scanCheck.test.ts` to check it doesn't produce unexpected output. If it's a known scan, add an assertion to `scanCheck.test.ts`.
- **Changing `scrollMotion.ts` constants** (`BASE_FRACTION`, `MIN_SECONDS_PER_SYSTEM`, etc.): update `scrollMotion.test.ts` assertions that reference those constants — they import them directly, so numeric changes don't silently break expectations.

---

## Common failure modes

- **`npm test` exits 1 on CI but passes locally:** Most likely a corpus PDF in `public/PDFs/` is present locally but not in CI. Tests that use `hasFixture()` guards pass; tests with hardcoded paths fail. Check that all hardcoded fixture paths use `fixturePath()` and guard with `hasFixture()`.
- **`library.test.ts` fails with `IDBFactory not defined`:** `fake-indexeddb/auto` import is missing or the test file isn't importing it before `library.ts`. The `auto` import must come first.
- **`pipeline.test.ts` hangs:** The scanned-PDF test triggered actual transcription (Whisper sidecar running on port 8123). The test uses a 4-byte stub blob specifically to hit the scan gate before reaching the sidecar. If `isScannedPdf` returned false for the test PDF, the test will await `transcribe()`.
- **`systemsAll.ts` shows `medMeas=1` for all PDFs:** Expected — `@napi-rs/canvas` under-counts barlines. Not a regression; validate measure detection in the browser instead.
- **Test output shows `FAIL` but the check seems trivially true:** Floating-point comparison. Use the `approx(a, b, eps)` helper from `scrollMotion.test.ts` for any numeric assertion with tolerance.
