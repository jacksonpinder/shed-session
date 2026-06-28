# Feature: Loop Regions

## Purpose

Loop regions are named, time-bounded segments of the waveform that the user creates to isolate a passage for repeated practice. When a region is active, playback stays within it — the app seeks back to the region's start when the playhead reaches the end. Loops are the central unit of practice in Shed Session: everything else (score linking, auto-scroll, recording) is anchored to the active loop.

## User value

- Isolate a difficult passage for focused drilling without manually re-scrubbing each repetition.
- See at a glance the different sections of the song: Intro, Verse, Chorus, etc.
- Laser focus on a particular section to learn: If I must learn Verse 1 by next week, I'll rehearse that section repeatedly.
- Named loops persist across sessions — return to any practiced section instantly.
- Each loop auto-links to the corresponding position in the score, so the sheet music provides context for the passage being drilled.

## Current implementation

Loops are WaveSurfer `RegionsPlugin` regions on the waveform. Each region gets `extendedStart` and `extendedEnd` bounds (half a second pad on each side via `LOOP_PAD_SECONDS`) to give the fade envelope room before the boundary fires. The `audioprocess` and `timeupdate` events run a boundary check: when the playhead crosses `extendedEnd`, PlayerDock seeks back to `extendedStart`. A drift guard (80 ms threshold) and cooldown (150 ms) prevent double-fires on rapid event bursts.

→ See [docs/architecture/audio-engine.md](../docs/architecture/audio-engine.md) for the full loop mechanics, fade envelope (`useGainEnvelope`), and Web Audio graph.

## Architecture dependencies

**Depends on:**
- `library-system` — loops are persisted per-song via `PracticeStore`; `practice:loops` key maps to `Song.loops` in IndexedDB
- `audio-controls` — playback rate and transpose affect how the loop timing *feels* but not the time values themselves
- `score-sync` — the anchor map is consulted at loop creation time to set `sheetLink` on the new loop

**Depended on by:**
- `auto-scroll` — loop start position triggers initial score scroll on loop activation
- `pdf-viewer` — margin loop bars and EdgeScrubberRail bands both derive their positions from `loopMarkers` (passed via SongView → PDFViewer)
- `recording` — mic takes are recorded over the active loop region

## Known issues

- **B6: Legacy draft trio** — `sheetLinkDraft`, `isDraft`, and the "Link this loop" toast are still wired into `LoopDetail.tsx`. They must be removed together with C4. `sheetLink` itself is load-bearing and stays.
- **C4: LoopDetail card** — The per-loop detail card exists but is slated for removal. Replacement: inline name editing + trash-with-undo directly on the loop chip.

## Planned improvements

- **C4** — Remove LoopDetail card; replace with inline name editing + trash icon on the loop chip (immediate delete + undo toast). → [docs/architecture/ui-system.md](../docs/architecture/ui-system.md)
- **B6** — After C4 lands: remove `sheetLinkDraft` / `isDraft` / "Link this loop" toast and delete `LoopDetail.tsx`. → [docs/architecture/ui-system.md](../docs/architecture/ui-system.md)

## Acceptance criteria

- Given no active loop, clicking "Add loop" creates a new region at the current playhead position spanning a default duration; it appears in the loop lane immediately.
- Given an active loop and `repeatLoop = true`, playback wraps from `extendedEnd` back to `extendedStart` without an audible click (fade-out completes before seek; fade-in starts on arrival).
- Given a loop is renamed inline, the new name persists after page reload.
- Given the trash icon is clicked, the loop is removed immediately and an undo toast appears; clicking undo restores the loop.
- Given a synced song, a newly created loop's `sheetLink` resolves to the score position corresponding to the loop's start time.
- Given `repeatLoop = false`, reaching the loop end stops playback (does not wrap).

## Related decisions

- **Loop regions use the connector-bracket visual** — the active waveform region's bottom edge connects to the active chip in the loop lane via a continuous colored bracket.
- **SoundTouch placed upstream of masterGain** — ensures the gain-envelope ramps that eliminate click noise fire in sync with the actual (possibly pitched) audio.
- **Repeat and auto-scroll have separate song/loop defaults** — `repeatLoop` defaults ON; `repeatSong` defaults OFF. This matches the typical practice workflow.
- **Loop chip selection outline: outward shadow** — inset shadows were clipped by the lane container; outward `box-shadow` renders cleanly at the lane edges.

## Status

Stable
