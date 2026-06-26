# Score Sync — status & handoff

Snapshot of what's built and the precise remaining wiring. See
`docs/score-sync-plan.md` for the full design.

## Done & tested (Phases 0–5 + sidecar)

| Piece | File | Status |
|---|---|---|
| Types / `Anchor` / `SyncMap` / `anchorAtTime` / `resolveScrollPosition` | `src/lib/syncMap.ts` | done |
| System-band detector (+ `isLikelyScanned`, `bandForY`) | `src/lib/detectSystems.ts` | done, stress-tested on 19 PDFs |
| Lyric extractor (font-independent) | `src/lib/lyricsExtract.ts` | done, tested on real fixtures |
| Whisper client + word types | `src/lib/transcribe.ts` | done |
| Whisper sidecar (FastAPI + WhisperX) | `sidecar/` | scaffolded — not run here (needs your machine) |
| Alignment (NW + monotonic chain) | `src/lib/alignSyncMap.ts` | done, unit-tested |
| Orchestrator | `src/lib/generateSyncMap.ts` | done |
| Bands exposed from viewer | `PDFViewer` handle `getSystemBands()` | done, no app regression |

Run the tests: `npm test` (uses Node 22 type-stripping; no new deps).

Note: `npm run build`'s `tsc` step fails project-wide for a **pre-existing** reason
(tsconfig has no `jsx`). Typecheck with `npx tsc -p tsconfig.json --jsx react-jsx`;
the only errors are pre-existing dead-code unused-vars, none in Score Sync files.

## Data flow

```
PDF  ──extractLyrics──▶ LyricToken[]  ─┐
                                       ├─alignSyncMap─▶ Anchor[]  (in SyncMap)
MP3  ──transcribe(sidecar)──▶ Word[]  ─┘
PDF canvases ──detectSystems──▶ bandsByPage   (PDFViewer.getSystemBands)

at playback/loop time t:  resolveScrollPosition(anchors, bandsByPage, t) ──▶ SheetPosition (system top)
```

`generateSyncMap()` returns `{ reason: 'no-lyrics' }` when the PDF has no text
layer — that's the **scan gate** (scans have no text). The caller should fall back
to manual linking then.

## Remaining wiring (Phase 6 = P1, Phase 7 = P2) — needs the running sidecar to validate

Kept out of the delicate `PlayerDock` until it can be happy-path tested. Each step
is small and the building blocks are tested.

1. **Hold the sync map.** Add `anchors: Anchor[]` state in `App` (or PlayerDock).
   A generate trigger (button/dropzone, Phase 7) calls `generateSyncMap(pdfDoc,
   audioBlob, { onProgress })`. Get `pdfDoc` from react-pdf's `onLoadSuccess`
   (`PDFDocumentProxy`); `audioBlob` by `fetch('/sample.mp3').then(r=>r.blob())`.
   Handle `reason: 'no-lyrics'` and a sidecar-down error with a toast.
   Cache the result in `localStorage` keyed by `sourceHash` (skip re-transcribe).

2. **Loop auto-link (Phase 6).** In PlayerDock loop creation (the
   `sheetLinkDraft: pdfViewerRef.current.getSheetPosition()` at ~`PlayerDock.tsx:2634`),
   prefer the sync map when anchors exist:
   ```ts
   const bands = pdfViewerRef.current?.getSystemBands() ?? {}
   const auto = anchors.length ? resolveScrollPosition(anchors, bands, region.start) : null
   sheetLinkDraft: auto ?? pdfViewerRef.current?.getSheetPosition() ?? undefined
   ```
   Fully gated: with no anchors it's byte-identical to today. The existing
   draft→confirm UX is unchanged.

3. **Auto-scroll on playback (Phase 7, P2).** In the WaveSurfer `timeupdate`
   handler (~`PlayerDock.tsx:1619`), behind a toggle, debounce so it only fires on
   crossing into a new system:
   ```ts
   const pos = resolveScrollPosition(anchors, bands, time)
   if (pos && pos.page !== lastPos.page || Math.abs(pos.yWithinPageRatio - lastPos.y) > eps) {
     if (!isPdfScrollingRef.current) pdfViewerRef.current.scrollToSheetPosition(pos, { behavior: 'smooth' })
   }
   ```
   Reuse `isPdfScrollingRef` (already exists) to not fight manual scrolling.

4. **Upload UI (Phase 7).** Replace the hardcoded `/sheetmusic.pdf` + `/sample.mp3`
   with a picker; feed the chosen PDF/MP3 into the same flow. The `?pdf=` query
   param already lets you swap the score for testing.

## Engine improvements (no UI/UX change)

Done while waiting, all safe and gated:

- **Load speed — lazy system-band detection.** `detectSystems` no longer runs
  eagerly on every page on load (that was an unnecessary full-canvas-readback pass
  ×14–17 per load). `PDFViewer.getSystemBands()` now computes on first call and
  caches; band ratios are scale-invariant so the cache survives zoom, and pages
  whose canvas wasn't painted yet are filled in on a later call. A normal load now
  does **zero** detection work. The debug overlay (`DEBUG_SYSTEMS`) still computes
  eagerly when enabled.
- **Transpose audio quality.** The SoundTouch node now uses **Lanczos**
  interpolation (vs the default linear) for resampling and **`quickSeek: false`**
  (full WSOLA cross-correlation seek, vs the default quick seek) — both documented,
  built-in, bundled in the worklet. Higher pitch-shift quality for a little more
  CPU; only active while transposing (node is bypassed at transpose 0), so the
  default playback path is untouched. `setStretchParameters` is wrapped in
  try/catch. **Not audibly verified here** (can't listen) — worth a quick
  listen-test on transpose; trivially revertible if disliked.
- **Speed (playback-rate) quality:** intentionally left alone. Speed uses the media
  element's `preservesPitch` time-stretch (browser-fixed quality, not tunable).
  Routing speed through SoundTouch would change the loop/fade timing design
  (CLAUDE.md warns against it), so it's out of scope.

## Known limitations (carried forward)

- **Scanned PDFs** (no text layer) → gated out via `reason: 'no-lyrics'`; manual
  linking only. Detecting them is free (the extractor returns nothing).
- **Repeats / D.C. / strophic** lyrics → the monotonic chain keeps one consistent
  pass; deferred.
- **Whisper latency** → first transcription is slow; cache by `sourceHash`.
- One **no-barline intro system** edge in detection is fixed; see plan.
