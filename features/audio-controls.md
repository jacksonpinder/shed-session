# Feature: Audio Controls

## Purpose

Audio controls let the user adjust playback to suit their practice needs: slow down to learn a fast passage, transpose to match a different key, balance stereo channels to isolate a voice part, or collapse to mono. All controls are grouped behind a single `AudioLines` button in the transport bar.

## User value

- Slow down a passage without changing pitch (or vice versa) to learn difficult runs at a manageable tempo.
- Transpose up or down by up to ±7 semitones (a perfect fifth) to practice in a comfortable key or match a different arrangement.
- Balance the stereo field to emphasize one voice in a stereo learning track; collapse to mono for headphone practice without left/right fatigue.
- All settings persist per-song — return the next day with the same speed and transpose.

## Current implementation

Four controls, each on its own `AudioSlider`:

- **Speed** — `WaveSurfer.setPlaybackRate()`. Affects both speed and pitch unless transpose compensates.
- **Transpose** — `SoundTouchNode` (Web Audio Worklet, `@soundtouchjs/audio-worklet`) inserted upstream of `masterGain`. Lazy init on first non-zero value. Commits on pointer-up only (`live={false}`) to avoid repeated async init during drag. Range: ±7 semitones.
- **Balance** — `stereoPannerRef.pan` ramped via `setTargetAtTime` (15 ms). Left/right or center.
- **Mono** — Flips `monoGainRef`'s channel merge mode. Hidden when the source file is already mono (detected via `OfflineAudioContext` decode on load).

The `AudioSlider` component handles center-out fill, magnetic center detent, optional `live` flag, and a `centerSlot` render-prop. The `AudioLines` button shows teal pill badges above it when panel is closed and any control is non-default.

→ See [docs/architecture/audio-engine.md](../docs/architecture/audio-engine.md) for the DSP chain and [docs/architecture/ui-system.md](../docs/architecture/ui-system.md) for `AudioSlider` and the panel layout.

## Architecture dependencies

**Depends on:**
- `library-system` — speed, transpose, balance, mono persist via `PracticeStore` (`practice:speed`, `practice:transpose`, `practice:balance`, `practice:mono`)
- `loop-regions` — the fade envelope ramps on `masterGain` must be accurate relative to pitched audio (hence SoundTouch is upstream)

**Depended on by:**
- `multi-track` — when switching tracks, the same gain/panner/transpose settings continue to apply

## Known issues

- **Audio hover UI** — The stacked panel (AudioLines popover) closes when the mouse moves across the gap from the button to the panel. Needs a hover-intent delay or pointer-bridge approach.
- **D3 mobile bottom sheet** — On touch devices, the panel currently opens as the same button-anchored popover as desktop. Design calls for a full-width bottom drawer. `AudioSlider` is already reusable for this.

## Planned improvements

- **Audio hover intent** — Prevent the panel from closing when the mouse travels across the gap between button and panel. Standard hover-bridge/pointer-capture approach.
- **D3 mobile bottom sheet** — Open a full-width bottom drawer from the `AudioLines` button on touch devices. Desktop popover stays unchanged.

## Acceptance criteria

- Given speed is set to 0.75×, playback runs at 75% speed without pitch change.
- Given transpose is dragged and released at +2 semitones, audio pitch shifts up two semitones; the waveform cursor position is unaffected.
- Given balance is set to L, the left channel is louder; the badge above AudioLines shows `L`.
- Given mono is toggled ON, both ears receive the same signal regardless of the source's stereo field.
- Given the panel is opened, all controls display their current values; non-default controls show a large active value in the section header.
- Given any control is at a non-default value and the panel is closed, a badge appears above the AudioLines button.
- Given the page is reloaded, all audio control values are restored to their persisted values for this song.

## Related decisions

- **SoundTouch placed upstream of masterGain** — The gain-envelope ramps (for loop fade) must fire in sync with the actual pitched audio. Placing SoundTouch downstream would introduce latency between the ramp and the audio it affects.
- **Transpose commits on pointer-up (not live)** — Firing `setTranspose` on every intermediate drag value triggers repeated async SoundTouch node init, causing audible catches. The center-slot interval label previews the value during drag.
- **Single `AudioLines` button for all audio settings** — Replaces 3 in-pill buttons (Speed / Transpose / Balance). Reduces visual noise; one extra tap is mitigated by fine-pointer hover reveal on desktop.

## Status

Active — core controls complete; hover-intent and mobile bottom sheet are open.
