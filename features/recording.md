# Feature: Recording

## Purpose

Recording lets the user capture a mic take over the currently active loop, then play it back alongside the reference recording. The intent is self-monitoring: hear how your own voice sounds against the arrangement, without leaving the app.

## User value

- Record your own voice over a loop and hear it back immediately — catch pitch, timing, and blend issues.
- Takes are stored per-song in IndexedDB so you can compare across sessions.
- Recording integrates with the existing loop system — you record exactly what you're drilling.

## Current implementation

Recording uses WaveSurfer's `RecordPlugin` wired to the microphone. A `takeGain` branch on the Web Audio graph routes mic playback to the destination separately from the main audio chain. Recorded Blobs are stored in IndexedDB and played back via `AudioBufferSourceNode` on the existing `AudioContext`.

→ See [docs/architecture/audio-engine.md](../docs/architecture/audio-engine.md) for the Web Audio graph, `RecordPlugin` setup, and `takeGain` branch details.

## Architecture dependencies

**Depends on:**
- `loop-regions` — recording is scoped to the active loop region
- `library-system` — takes are stored as Blobs in the `blobs` IndexedDB store, keyed per-song

**Depended on by:**
- Nothing currently.

## Known issues

- **Minimally exercised** — the recording infrastructure exists and is wired up, but take management (listing, deleting, naming takes) and playback UI are not prominently surfaced in the current interface. This feature exists but is not a primary workflow for most users yet.

## Planned improvements

No items in the Soon or Later backlog for recording. The **Woodshedding mode** idea (a focused single-loop view with the record button as the primary action) would make recording more prominent, but that is speculative.

## Acceptance criteria

- Given a microphone is available and a loop is active, clicking the Record button starts recording.
- Given recording is in progress, stopping it saves the take to IndexedDB.
- Given a take is saved, it can be played back through the app's audio output.
- Given the song is closed and re-opened, previously recorded takes are still available.

## Related decisions

No decisions in `DECISIONS.md` are specific to recording.

## Status

Stable — infrastructure complete, low-priority, not prominently surfaced in the UI.
