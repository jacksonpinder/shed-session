# Feature: Multi-track

## Purpose

A song can have multiple MP3 tracks — for example, a full-mix recording and a learning track that emphasizes one voice part. All tracks share the same loops, sync anchor map, and song timeline. The user switches between them with the track selector, and each track plays back in sync with the others via a `leadInOffset` that compensates for any intro difference.

## User value

- Practice with the full mix for context, then switch to the learning track to hear your own part more clearly — without losing loops or the sync map.
- Tracks that have a different amount of intro before the arrangement starts align automatically (no manual offset needed).
- Adding a second track is non-destructive: existing loops and anchors continue to work.

## Current implementation

Each `Track` in IndexedDB has a `leadInOffset` (seconds) representing how much later its audio starts relative to the reference track (track 0). For track 0 (the reference), `leadInOffset = 0` and it's the one sent to the Whisper sidecar. For subsequent tracks, `leadInOffset` is computed client-side via `leadIn.ts`: onset-envelope cross-correlation against the reference track's decoded audio.

All time-based operations use **song-time** (a shared reference timeline). Conversion happens at exactly three seams in `PlayerDock`: loop↔region sync, writeback on drag/new-loop, and time→anchor resolution. The helpers are `songToTrackTime` / `trackToSongTime`.

→ See [docs/architecture/audio-engine.md](../docs/architecture/audio-engine.md) for the full lead-in and seam details, and [docs/architecture/persistence.md](../docs/architecture/persistence.md) for the Track schema.

## Architecture dependencies

**Depends on:**
- `library-system` — tracks are stored as blobs in IndexedDB; `TrackManager` modal handles add/delete; `TrackSelector` handles switching
- `score-sync` — only the reference track (track 0) is transcribed by Whisper; anchors are stored on the song, not per-track

**Depended on by:**
- `loop-regions` — loop start/end times are in song-time; the three conversion seams must remain consistent
- `auto-scroll` — `time → anchor` resolution applies `trackToSongTime` before querying the timing model
- `recording` — mic takes are aligned to song-time, so they play back correctly regardless of which track is active

## Known issues

- **No manual lead-in nudge** — `leadInOffset` is auto-detected via cross-correlation (accurate for same-performance tracks). If tracks are fundamentally different performances (different tempo, different cut), the offset will be wrong with no UI to correct it.
- **Reference track is always track 0** — the first uploaded track is always sent to Whisper. There is no UI to designate a different track as the reference or re-trigger transcription on a later track.

## Planned improvements

- **Manual lead-in nudge (Later)** — A slider or control to fine-tune `leadInOffset` per track. Critical for edge cases where cross-correlation produces a wrong offset.
- **Reference-track picker (Later)** — UI to change which track is the reference (gets Whisper transcription). Useful when track 0 is a full mix but a later-added isolated voice track would align better.

## Acceptance criteria

- Given two tracks uploaded for the same song, switching tracks via `TrackSelector` changes the audio source without affecting loop positions, sync map, or settings.
- Given track 1 has a 4-second intro before the arrangement starts, its `leadInOffset` is detected as ~4 s and loops defined at arrangement start play back at the correct position on both tracks.
- Given the reference track (track 0) plays a Whisper-aligned anchor at t=10 s, track 1 with `leadInOffset = 4` plays the same anchor at t=14 s on its own audio timeline.
- Given a track is deleted, the remaining tracks retain their loops, settings, and sync map.

## Related decisions

- **Song-time vs track-time** — loops and sync anchors are stored in song-time (the reference track's timeline). Conversion to each track's local time happens at three seams in PlayerDock only. Centralizing conversion means a missed seam is the only failure mode.
- **Auto lead-in via cross-correlation (non-reference tracks only)** — avoids multiple slow Whisper jobs for what is usually the same performance at different mic positions. Assumes all tracks share the same anchor timeline.

## Status

Stable
