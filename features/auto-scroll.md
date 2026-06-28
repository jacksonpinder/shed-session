# Feature: Score Jump (jump-on-event navigation)

> **Note:** This feature replaced continuous auto-scroll. Earlier versions ran a
> per-frame `requestAnimationFrame` loop (`startPlayheadFollow`) that scrolled the
> score continuously during playback. That model was removed — the score now only
> moves on discrete user-navigation events. The file keeps its `auto-scroll.md`
> name for link stability, but the behavior described below is the current one.

## Purpose

Score Jump keeps the score positioned where the user is working without scrolling continuously during playback. When the user navigates — clicking/scrubbing the waveform, using the seek buttons, or wrapping a loop — the score jumps once to the matching system, then stays put. The user reads from a stable page while listening, rather than chasing a constantly moving viewport.

## User value

- The page stays still during playback — no motion to track or fight while singing.
- Each navigation action produces exactly one smooth, snappy jump to the right system.
- Jumps feel equally fast for near and far targets (fixed-duration tween, not native smooth-scroll which drags on long cross-page jumps).
- Toggleable per song, and gracefully disabled when no sync map exists.

## Current implementation

There is **no continuous follow loop.** The score is moved only by `viewer.scrollToSheetPosition(pos, { behavior: 'smooth' })`, called from a handful of discrete event sites in `PlayerDock`:

1. **Waveform `click` and `dragend`** — WaveSurfer emits `interaction` on every drag mousemove, which would look like continuous auto-scroll, so those are *not* used for jumping. Instead `click` (one-shot seek) and `dragend` (scrub release) each fire exactly once per action → `scrollScoreToSongTime`.
2. **Seek buttons (±15s)** — programmatic `setTime` emits no `interaction` event, so the handler calls `scrollScoreToSongTime(trackToSongTime(next))` directly.
3. **Loop wrap / loop activation** — on repeat, if the active loop has a `sheetLink` and scroll-on-repeat is enabled, the score jumps back to the loop's sheet position.
4. **Loop creation** — a newly created loop jumps the score to its resolved sheet position.

`scrollScoreToSongTime` is gated on the `jumpOnEvent` toggle (`jumpOnEventRef.current`), resolves the song time to a `SheetPosition` via `resolveLoopSheetPosition` (the same engine that places the loop markers), and special-cases a restart-to-top (`songTime <= 0.05` → page 1) for intros too unsteady for the timing model.

The jump itself is animated by `animateScrollTo` in `PDFViewer` — a fixed-duration (~320ms) `easeInOutCubic` tween that cancels any in-flight tween first, so rapid seeks retarget cleanly instead of stacking.

→ See [docs/architecture/score-sync.md](../docs/architecture/score-sync.md) (position resolution) and [docs/architecture/pdf-viewer.md](../docs/architecture/pdf-viewer.md) (`scrollToSheetPosition`, `animateScrollTo` tween).

## Architecture dependencies

**Depends on:**
- `score-sync` — requires `Anchor[]` to resolve a song time to a `SheetPosition`; the Score Jump toggle is disabled (with a hint) when no anchors exist (`jumpOnEventAvailable`)
- `pdf-viewer` — `scrollToSheetPosition` and the `animateScrollTo` tween live on the PDFViewer imperative handle
- `loop-regions` — loop wrap/activation are jump triggers; per-loop `scrollOnRepeat` (falling back to the global `scrollOnRepeat` default) gates the loop-wrap jump

**Depended on by:**
- Nothing directly; Score Jump is a terminal consumer of the sync map.

## State & persistence

- **`jumpOnEvent`** (`useState(true)`, persisted to the KV store under `JUMP_ON_EVENT_STORAGE_KEY`) — master toggle. Surfaced as the `MapPinned` button in `TransportBar`; defaults ON. Disabled with a "needs a synced score" hint when no anchors exist.
- **`scrollOnRepeat`** (`useState(true)`, persisted under `SCROLL_ON_REPEAT_STORAGE_KEY`) — whether a loop wrap re-jumps to the loop's sheet position. Separate from `jumpOnEvent` so a user can keep navigation jumps while suppressing the per-repeat jump (or vice versa). Per-loop `SavedLoop.scrollOnRepeat` overrides the global default.

## Known issues

- **Not live-verified end-to-end** — the autoplay gesture block in the preview environment makes scripted playback verification unreliable; needs a real browser click + running sidecar to confirm jump timing on seek/loop-wrap.

## Planned improvements

- **Measure-bar jump mode (Later)** — optionally snap to the start of the current measure on each navigation rather than the resolved fractional position.
- **Transport auto-collapse (Later)** — re-enable `useTransportVisibility` with `autoHideEnabled: true`; restore `transportMode = seekExtensionOpen ? 'collapsed' : autoTransportMode`. Currently hardcoded `expanded`.

## Acceptance criteria

- Given a synced song and Score Jump ON, **playback alone does not scroll the score** — the page stays still until the user navigates.
- Given a waveform click or scrub release, the score jumps once (no per-mousemove scrolling) to the corresponding system.
- Given a seek button press, the score jumps to the new position.
- Given a loop wrap with scroll-on-repeat enabled, the score jumps back to the loop's sheet position.
- Given a restart to the very top, the score jumps to page 1 even when the intro is too unsteady to resolve a segment.
- Given a scanned or unsynced PDF, the Score Jump button is visually disabled and shows a hint explaining why.
- Given rapid successive seeks, in-flight jump tweens are cancelled and retarget cleanly without stacking.

## Related decisions

- **Continuous auto-scroll removed in favor of jump-on-event** — continuous follow during playback was distracting and fought the user's eye; discrete jumps on explicit navigation keep the page stable while still landing on the right system.
- **`click`/`dragend` instead of `interaction`** — WaveSurfer's `interaction` fires on every drag mousemove, which reproduced the continuous-scroll feel. `click` and `dragend` each fire exactly once per user action.
- **Fixed-duration tween instead of native smooth-scroll** — native `behavior:'smooth'` drags on long cross-page jumps; the `easeInOutCubic` tween makes near and far jumps feel equally snappy and cancels cleanly on retarget.
- **`jumpOnEvent` and `scrollOnRepeat` are separate toggles** — a user may want navigation jumps but no per-repeat jump (or the reverse), so the loop-wrap behavior has its own setting (with a per-loop override).

## Status

Active — implemented (continuous auto-scroll removed); live-verification pending (needs real browser + sidecar).
