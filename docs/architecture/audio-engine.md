# Audio Engine

Covers: `src/components/PlayerDock.tsx`, `src/lib/useGainEnvelope.ts`, `src/lib/useVolumeEnvelope.ts`, `src/lib/useTransportVisibility.ts`, `src/lib/leadIn.ts`, `src/lib/formatters.ts`, `src/lib/assignLanes.ts`

**Related docs:** [app-shell](./app-shell.md) · [ui-system](./ui-system.md) · [persistence](./persistence.md) · [pdf-viewer](./pdf-viewer.md)

---

## Responsibilities

`PlayerDock.tsx` is the heaviest file (~3,600 lines). It owns:
- WaveSurfer initialization and lifecycle
- The Web Audio DSP chain (balance, mono, transpose, gain envelopes)
- Loop region management (create, delete, resize, persist)
- Loop playback mechanics (fade in/out, drift guard, wrap timing)
- Lead-in offset tracking across multiple tracks
- Take recording and playback
- Driving the PDFViewer's auto-scroll via the timing model

`PlayerDock` is intentionally pure in the persistence sense — it knows nothing about IndexedDB. All state is loaded and saved through an injected `PracticeStore`. See [persistence.md](./persistence.md).

---

## Web Audio Graph

```
HTMLAudioElement (MediaElement backend)
    │
    ▼
MediaElementAudioSourceNode          ← recreated on every WaveSurfer init
    │
    ├─ (when transpose = 0, bypass) ──────────────────────────┐
    │                                                         │
    └─ SoundTouchNode (AudioWorklet)  ← lazy, only when ≠ 0  │
                                                              │
                                                              ▼
                                                   masterGainRef (GainNode)
                                                              │
                                                              ▼
                                                   monoGainRef (GainNode)
                                                              │
                                                              ▼
                                                   stereoPannerRef (StereoPannerNode)
                                                              │
                                                              ▼
                                                   AudioContext.destination

takeGainRef (GainNode) ──────────────────────────────────────▶ destination
```

**Important:** `masterGain`, `monoGain`, `stereoPanner`, and `takeGain` persist across WaveSurfer reinits. Only `MediaElementAudioSourceNode` is recreated each time WaveSurfer sets up. `applyTransposeRouting()` must be called after every WaveSurfer init to reconnect the source node into the correct graph position.

---

## WaveSurfer Setup

WaveSurfer uses the MediaElement backend (not Web Audio directly). Two plugins are attached:

- **RegionsPlugin** — visual loop regions on the waveform
- **RecordPlugin** — live mic input capture

Key event handlers: `ready`, `play`, `pause`, `finish`, `seeking`, `audioprocess`, `timeupdate`.

---

## Loop Playback Mechanics

### Bounds

Each active loop has extended bounds:

```
extendedStart = loop.start − LOOP_PAD_SECONDS  (0.5s)
extendedEnd   = loop.end   + LOOP_PAD_SECONDS  (0.5s)
```

The fade zone is the 0.5s pad on each end. WaveSurfer plays through `extendedStart → extendedEnd`, with the audible content between `loop.start` and `loop.end`.

### Timer scheduling

`scheduleLoopTimers()` arms two timers on every loop activation or play/pause:

| Timer | Fires at | Action |
|---|---|---|
| Fade-out | `loop.end − 0.5s` | `startFadeOut()` — ramp masterGain to near-zero |
| Wrap | `extendedEnd` | `doWrap()` — seek to `extendedStart`, re-arm fade-in |

Timers are computed in playback-rate-adjusted wall-clock time via `getLoopDelayMs(currentTime, target, rate)`.

### Drift guard

`audioprocess` and `timeupdate` events run a secondary check: if playback has drifted >80ms past `extendedEnd` (timer missed due to CPU stall), an emergency wrap fires. Throttled with a 150ms cooldown to prevent double-fires.

Set `DEBUG_LOOP_BG = true` in `PlayerDock.tsx` for detailed console output on loop boundary events.

### Fade envelope (`src/lib/useGainEnvelope.ts`)

```ts
const { setGainImmediate, rampGainTo, cancelRamps } = useGainEnvelope(masterGainRef, volumeValueRef)
```

Wraps a `GainNode` with three operations:
- `setGainImmediate(v)` — cancel any scheduled changes, set value at current time
- `rampGainTo(v, durationSec)` — cancel, then `linearRampToValueAtTime`
- `cancelRamps()` — snapshot current value, cancel all scheduled changes, freeze

**Invariant:** Always call `cancelRamps()` before scheduling a new ramp. Concurrent ramp schedules are undefined behavior in Web Audio.

`skipNextFadeInRef` suppresses the fade-in after an interactive seek within a loop, preventing a jarring mute at the seek point.

### Volume envelope (`src/lib/useVolumeEnvelope.ts`)

RAF-based cosine ease-in-out (`0.5 − 0.5·cos(π·t)`) for WaveSurfer's software volume. Separate from the Web Audio gain chain — controls the media element volume, not the GainNode. Not currently used in the main playback path but available.

---

## Balance, Mono, Transpose

### Balance

```ts
stereoPannerRef.current.pan.setTargetAtTime(clamped, context.currentTime, 0.015)
```

15ms smoothing constant avoids zipper noise during slider drag.

### Mono downmix

```ts
// Enable mono:
monoGainRef.current.channelCountMode = 'explicit'
monoGainRef.current.channelCount = 1   // browser sums L+R × 0.5

// Restore stereo:
monoGainRef.current.channelCountMode = 'max'
monoGainRef.current.channelCount = 2
```

Mono toggle is hidden for sources that are already mono (detected via `OfflineAudioContext` decode on load).

### Transpose (`@soundtouchjs/audio-worklet`)

SoundTouchNode is lazy-initialized on the first non-zero transpose value. It uses Lanczos resampling and `quickSeek: false` for quality pitch-shifting at ±7 semitones.

`preservesPitch = true` is set on the HTMLAudioElement so that playback rate changes (speed slider) don't affect pitch. SoundTouch and speed are orthogonal.

After every WaveSurfer reinit, `applyTransposeRouting()` reconnects either:
- `source → masterGain` (transpose = 0, bypass)
- `source → soundTouch → masterGain` (transpose ≠ 0)

---

## Time Coordinate System

Loops, anchors, and settings live in **song-time** (0-based, shared across tracks). WaveSurfer plays in **track-time**, which includes a `leadInOffset`:

```
song-time = track-time − leadInOffset
track-time = song-time + leadInOffset
```

Conversions happen only at three seams:
1. **Region placement:** loop.start/end converted to track-time when placing WaveSurfer regions
2. **Drag/new-loop writeback:** WaveSurfer region bounds converted back to song-time before saving
3. **Anchor resolution:** `ws.getCurrentTime()` converted to song-time before querying the timing model

The loop engine and WaveSurfer always operate in track-time. Song-time is only visible at the seams.

---

## Lead-in Offset Detection (`src/lib/leadIn.ts`)

For tracks beyond the reference, `detectLeadInOffset(referenceBlob, trackBlob)` detects how many seconds the track's music starts after the reference:

1. Decode both to mono Float32 at 8 kHz, first ~30s
2. Compute onset envelope (half-wave-rectified frame energy difference, 128-sample hops)
3. Pearson normalized cross-correlation over lag range −2s…+25s
4. Return `{ offsetSec, confidence }` — if confidence < 0.3, return offsetSec = 0

---

## Take Recording & Playback

Recording uses WaveSurfer's `RecordPlugin`. Completed takes are stored as Blobs in IndexedDB and referenced via `TakeMeta` on the Track record.

Playback uses a decoded `AudioBufferSourceNode` connected through `takeGain` directly to the destination (bypasses the main DSP chain so the take can be heard alongside the reference at independent volume).

Take playback is synced every audio frame: if drift exceeds 50ms, the source is restarted at the correct offset. This handles playback rate changes cleanly.

---

## Auto-Scroll Driver

When playback is active and anchors exist, PlayerDock drives PDFViewer's auto-scroll:

```ts
pdfViewerRef.current?.startPlayheadFollow(getAnchor, suspendCallback)
```

`getAnchor()` is called each rAF frame by PDFViewer. It queries the timing model (built from `Song.anchors` + system bands + optional beat) and returns a `PlayheadAnchor`:

```ts
type PlayheadAnchor = {
  current: SheetPosition   // current system
  next: SheetPosition      // next system
  blend: number            // 0…1 interpolation between them
  stability: number        // tempo steadiness
  systemHeightRatio: number
  time: number             // audio time sampled at
}
```

The timing model is rebuilt whenever `timingModelVersion` bumps (on anchors change, beat change, or system bands ready). See [score-sync.md](./score-sync.md) and [pdf-viewer.md](./pdf-viewer.md) for the other ends of this pipeline.

---

## Transport Visibility (`src/lib/useTransportVisibility.ts`)

Auto-hide hook with 2500ms delay. Currently disabled: PlayerDock calls it with `autoHideEnabled: false` and hardcodes `transportMode = 'expanded'`. The hook and collapsed-mode rendering in `TransportBar.tsx` still exist. To re-enable: remove `autoHideEnabled: false` and restore `const transportMode = seekExtensionOpen ? 'collapsed' : autoTransportMode`.

---

## Formatters (`src/lib/formatters.ts`)

```ts
formatTime(seconds: number): string    // "2:35"
pageLabel(pos: SheetPosition | undefined): string | null  // "pg 5", "Top of pg 5", etc.
```

---

## PracticeStore Persistence

PlayerDock loads and saves all state through `store.load(key)` / `store.save(key, value)`. The keys used:

| Key | State |
|---|---|
| `practice:loops` | `SavedLoop[]` |
| `practice:settings.transpose` | `number` |
| `practice:settings.speed` | `number` |
| `practice:settings.balance` | `number` |
| `practice:settings.mono` | `boolean` |
| `practice:settings.scrollOnRepeat` | `boolean` |
| `practice:settings.lanesVisible` | `boolean` |
| `practice:take` | `TakeMeta` |
| `practice:repeat-song` | `boolean` |
| `practice:repeat-loop` | `boolean` |
| `practice:autoscroll-song` | `boolean` |
| `practice:autoscroll-loop` | `boolean` |

All keys are mapped to Song/Track fields in IndexedDB by SongView's injected store. See [persistence.md](./persistence.md).

---

## When modifying this system

- **Any WaveSurfer reinit** must call `applyTransposeRouting()` after setup. The `MediaElementAudioSourceNode` is recreated each time and the routing doesn't survive it.
- **Adding a new DSP node** between `masterGain` and `destination` must not break the existing chain. Balance/mono/transpose apply to all sources (including takes) — this is intentional.
- **Changing `LOOP_PAD_SECONDS`** affects both `extendedStart` latency and fade timing. Test with loops shorter than `2 × LOOP_PAD_SECONDS`.
- **Adding a new `practice:*` key** requires mapping it in SongView's injected store or it falls through to global localStorage (silent per-song isolation break). See [persistence.md](./persistence.md).
- **Loop timer cleanup** must be thorough when switching loops or stopping playback. Orphaned timers cause spurious wraps and fades.

---

## Common failure modes

- **Transpose silently broken:** SoundTouch AudioWorklet failed to register (CORS, browser support, or module URL issue). Check `applyTransposeRouting()` — it has a try/catch that can swallow errors. Verify `AudioContext.audioWorklet.addModule()` resolved.
- **Double-wrap after CPU stall:** Drift guard fires after a timer that already fired. The 150ms cooldown prevents most cases; a sustained stall can still trigger both. Adding a flag cleared by the scheduled timer can eliminate the duplicate.
- **Fade-in not playing after loop creation while paused:** `pendingFadeInRef` must be set synchronously when creating the loop so it's ready when the `play` event fires. If it's set asynchronously, the event may fire first.
- **Take playback out of sync:** Decode of the take buffer failed silently, or `takeStartAt` is wrong due to a leadInOffset conversion mistake. Check `syncTakePlayback` logs.
- **Speed slider has no effect:** `preservesPitch` might not have been set on the media element, causing pitch correction to counteract the rate change. Check `enablePitchCorrection()` was called on the media element ref.
