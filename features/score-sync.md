# Feature: Score Sync

## Purpose

Score sync converts a PDF score and an MP3 recording into a time → score position map (`Anchor[]`). This map is the prerequisite for auto-scroll and loop auto-linking: it tells the app which point in the audio corresponds to which system on the page. The pipeline runs automatically in the background after a song is added — the user doesn't need to do anything manual for the happy path.

## User value

- The app knows where in the sheet music any given moment of audio lands — enabling auto-scroll and score-aware loop placement.
- Works from the user's own PDF and recording with no manual timestamping or calibration.
- Gracefully falls back (manual linking) when the PDF is scanned or the pipeline can't align with confidence.

## Current implementation

Two independent legs feed an alignment stage, coordinated by `AnalysisProvider` in `analysisManager.tsx`:

1. **PDF leg** (fast, client-side): `isScannedPdf()` gates out raster PDFs early. `lyricsExtract` pulls `LyricToken[]` from the PDF text layer in a font-agnostic way, splitting multi-word runs and stripping noise (digits, PUA symbols, cue directions).
2. **Audio leg** (slow, Whisper sidecar): `transcribe` sends the reference track to the local WhisperX sidecar and receives `Word[]` with timestamps. Beat analysis returns `BeatAnalysis` for the timing model.

When both legs are done, `alignSyncMap` runs a many-to-one DP alignment (each Whisper word absorbs a run of score syllables, scored on concatenation similarity), then extracts a longest monotonic chain with weighted continuity. The resulting `Anchor[]` is stored on `Song.anchors` in IndexedDB and cached to `localStorage` under `practice:syncMap`.

→ See [docs/architecture/score-sync.md](../docs/architecture/score-sync.md) for the full pipeline, types, and failure modes.

## Architecture dependencies

**Depends on:**
- `library-system` — `AnalysisProvider` reads `Song`/`Track` blobs from IndexedDB; anchors are persisted back via the same store
- `pdf-viewer` — `detectSystems` runs on the live PDF canvas renders (not Node headless) via the `getSystemBands()` imperative handle

**Depended on by:**
- `auto-scroll` — consumes `Anchor[]` to build the timing model at playback time
- `loop-regions` — consults anchors at loop-creation time to set `sheetLink`
- `pdf-viewer` — margin loop bars use `sheetLinkEnd` computed from anchors to span the correct score range

## Known issues

- **Scanned PDFs gated out** — `isScannedPdf()` rejects raster PDFs (image-present + ≤8 path ops per page). No OMR fallback exists; the user sees a greyed-out Nav button.
- **Repeats / D.C. / strophic not supported** — the monotonic chain forces a single forward pass through the score. Repeated sections match only the first occurrence.
- **Sidecar required** — `transcribe` needs the WhisperX sidecar running locally. No in-browser transcription fallback.
- **Auto-scroll not live-verified** — autoplay gesture block in the preview environment prevents the `isPlaying` flip. Needs a real browser click + running sidecar to confirm end-to-end.

## Planned improvements

- **System band detection: exclude headers/footers** — Exclude page numbers and credit lines (starting with "Words", "Music", "Arrangement", "Copyright", "Page", etc.) from band detection. Mid-system text that starts with those words should still count. → features/score-sync.md
- **Loop span bottom edge** — Margin bars and rail bands should extend to the BOTTOM of the loop's last system, not the TOP. Includes loops that extend past the last aligned lyric. → features/score-sync.md
- **Scanned PDF modal** — When the Nav button is clicked on a non-syncable score, show a modal explaining why (scanned PDF) and let the user substitute a different button. Persistent per song.
- **Scanned PDF support (Later)** — OMR pipeline (deskew + binarize + staff-line detection in raster). Complex; would require a sidecar extension or a third-party service.
- **Score sync for repeats / D.C. / strophic (Later)** — Allow the monotonic chain to match multiple occurrences of a passage. High value for barbershop and choral repertoire.

## Acceptance criteria

- Given a text-layer PDF and a matching MP3 (sidecar running), `AnalysisProvider` produces `Anchor[]` within ~30 s and stores them on the song.
- Given anchors are stored, the Nav button in TransportBar becomes active.
- Given a scanned PDF, `isScannedPdf()` returns true, the pipeline exits with `reason: 'scanned'`, and the Nav button shows a hint rather than activating.
- Given a re-upload of the same MP3, the sidecar result is returned from the hash cache (no second Whisper job).
- Given the sidecar is not running, `transcribe` fails gracefully; the UI shows a sync-unavailable state rather than crashing.

## Related decisions

- **Per-staff barline detection, not whole-system height** — barlines are detected per-staff (run ≥ 0.92 of staff height), then cross-staff-aligned. Prevents barbershop SATB systems from registering zero barlines.
- **Timing model uses a MEASURE axis** — anchors are mapped onto a measure axis (not pixels or wall-clock seconds) because note-spacing in engraved music is sublinear in time.
- **`pageSpanRatio` filter to exclude page-spanning rules** — columns whose longest run ≥ 0.5 × page height are excluded. A fixed left-pixel skip would clobber legitimate system brackets.

## Status

Active — pipeline complete; live-verification blocked by autoplay gesture in preview environment.
