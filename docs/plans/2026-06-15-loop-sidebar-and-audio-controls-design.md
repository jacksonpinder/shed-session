# Design: Loop Sidebar Redesign + Audio Controls

**Date:** 2026-06-15
**Status:** Approved, ready for implementation planning

---

## Overview

Two parallel feature areas:

1. **Loop sidebar** — move loop management from a transport dropdown into a persistent left-side panel with compact chips, inline controls, and a reworked create/mark flow.
2. **Audio controls** — implement Balance L/R, Stereo/Mono, and Transpose (±5 semitones) with purpose-built UI for each.

---

## 1. Loop Sidebar

### Layout

**Desktop:** Fixed left panel, always open, ~220px wide. Pushes the PDF viewer right (no overlay). Sits between the context bar and the bottom of the viewport. The transport bar dock position is unaffected.

**Mobile:** Collapses to a 28px tab on the left edge (loop icon). Swipe right or tap the tab to open as an overlay covering ~75% of screen width. Tap the backdrop to close.

### Chip List

The sidebar contains a sorted list of loop chips, ordered by start time. The list reorders live as the user drags waveform handles (start point crosses another loop's start point).

**`+` New Loop button** sits at the top of the panel, full width, subtle styling.

**Empty state:** "Hit + to create your first loop."

### Inactive Chip (~28px tall)

```
● Loop Name ················· pg 3 · 0:32
```

- Colored dot (left)
- Truncated loop name
- Page number from sheet position (right) — omitted if no position marked
- Start timestamp (right)

This chip gives enough "big picture" context that it can replace the `x / x` page pill in the context bar.

### Scroll-linked Highlighting

As the PDF scrolls, any chip whose sheet position falls within the current viewport gets a soft left-border accent and slightly brighter background. Passive — no interaction required. Updates continuously as the user scrolls.

### Active / Expanded Chip

Clicking a chip expands it to show controls below the name row:

```
● [Loop name — editable inline]          pg 3 · 0:32
  ────────────────────────────────────────────────
  [↺ Repeat]   [↕ Scroll on repeat — only if Repeat on]
  ────────────────────────────────────────────────
  📍 Middle of pg 3   [Re-mark]   [Confirm]      ← draft state
     OR
  📍 Middle of pg 3   [Re-mark]                  ← saved state
     OR
  [Mark position]                                 ← no position yet
  ────────────────────────────────────────────────
  [Delete]
```

**Name:** Click to edit inline. Enter or blur to confirm.

**Repeat:** Toggle button. When off, "Scroll on repeat" is hidden entirely.

**Scroll on repeat:** Appears (fade in) only when Repeat is on. Per-loop setting — moves here from the transport bar dropdown.

**Sheet position label:** Derived from `yWithinPageRatio`:
- < 0.33 → `Top of pg N`
- 0.33–0.66 → `Middle of pg N`
- > 0.66 → `Bottom of pg N`

**Delete:** Text-only, red, no icon. Single tap to delete with a brief undo toast. No modal.

### Sheet Position: Three States

| State | Display | Actions |
|---|---|---|
| Draft | Dashed border, ~60% opacity, "Draft" badge | **Confirm**, **Re-mark** |
| Saved | Normal solid style | **Re-mark** |
| None | — | **Mark position** |

The **Re-mark flow:** User taps Re-mark → toast: *"Scroll to the right spot, then tap Confirm"* → Confirm stays prominent on chip → user scrolls PDF → taps Confirm → position captured.

### PDF Marker (Sheet Music Overlay)

The existing colored pill marker on the PDF page is kept and extended:

- **Draft state:** Dashed border, reduced opacity, small "Draft" badge on the pill
- **Saved state:** Normal solid pill (existing behavior)
- **Mobile tap on draft marker:** Opens a bottom sheet with Confirm / Re-mark actions — no need to open the sidebar

### Loop Creation Flow

1. Tap **+** — new chip appears, name field immediately focused
2. Type name, hit Enter — waveform region appears at current playhead (default 30s)
3. Sheet position auto-captured from current PDF scroll as a **draft mark**
4. User drags waveform handles to set region — chip reorders in list as start point moves
5. User taps **Confirm** on draft mark (or **Re-mark** to scroll first) — position saved
6. If user never confirms the draft, position remains in "None" state — no silent auto-saves

### Context Bar Changes

- The `x / x` page pill can be removed or made minimal once the sidebar is in place — loop chips show page numbers that serve the same navigational purpose.
- The loop icon button in the transport bar is removed — the sidebar replaces it.
- "Scroll on repeat" moves off the transport dropdown entirely.

---

## 2. Audio Controls

### Balance L/R + Stereo/Mono (Headphones button → Popover)

The existing headphones button opens a popover above the transport bar containing:

- **L/R balance slider** — centered at 0, labeled `L` and `R` at the ends
- **Stereo / Mono toggle** — directly beneath the slider (conceptually related: mono collapses the stereo field)

**Headphones button visual state:** The button background uses a smooth CSS `linear-gradient` that reflects the current balance value. At center, uniform. As balance shifts left, the right half fades toward a muted tone; as it shifts right, the left half fades. Smooth gradient — no hard midpoint transition. Clear at a glance without opening the popover.

The button shows a subtle active indicator when balance ≠ center or mono is on.

### Transpose (Dedicated button in transport bar)

A separate stepper button sits next to the speed button.

**Inactive icon:** ♭♯ symbol (both flat and sharp together — immediately legible as "transpose" to musicians)

**Active labels** (by semitone value, −5 to +5):

| Semitones | Label |
|---|---|
| −5 | −P4 |
| −4 | −M3 |
| −3 | −b3 |
| −2 | −M2 |
| −1 | −b2 |
| 0 | ♭♯ (default icon) |
| +1 | +b2 |
| +2 | +M2 |
| +3 | +b3 |
| +4 | +M3 |
| +5 | +P4 |

Tapping the button opens a small popover with **−** / **+** steppers and the current label centered. Tapping the label itself resets to 0.

### Mobile Audio Settings

On mobile, a single **audio settings button** (icon: `AudioLines` / waveform — distinct from the desktop headphones icon) opens a bottom sheet containing all three controls stacked:

- Balance slider
- Stereo/Mono toggle
- Transpose stepper

### Audio Engine Changes

**Balance:** Insert a `StereoPannerNode` between the master `GainNode` and `AudioContext.destination`. Pan value maps linearly from −1 (full left) to +1 (full right).

**Mono:** Set `StereoPannerNode.pan = 0` and use a `ChannelMergerNode` to sum L+R channels. Alternatively: when mono is toggled, set `channelCountMode` to `'explicit'` with `channelCount = 1` on the downstream node.

**Transpose:** Use `@soundtouchjs/audio-worklet` inserted after the `GainNode`. Runs on the audio thread (not the main thread) via AudioWorklet — no UI-interaction glitches.

**Latency compensation:** Soundtouch introduces buffering latency (~20–100ms). Measure at init and offset all GainNode ramp scheduling (fade envelopes) by that amount. The waveform visualizer is unaffected — WaveSurfer reads the raw file for rendering, not the processed output.

**Preserve pitch flag:** With transpose active, `preservesPitch` on the media element can be set to `false` — soundtouch handles pitch independently. At transpose = 0, `preservesPitch = true` behavior is restored.

---

## What Is Not Changing

- Transport bar play/pause, seek buttons, speed control — layout unchanged
- PDF viewer zoom, page rendering — unchanged
- Loop persistence (localStorage) and audio blob storage (IndexedDB) — unchanged
- The existing sheet marker pixel-sampling logic (finds whitest area for marker placement) — unchanged

---

## Future (Out of Scope for This Implementation)

- Multi-song account: save loops per song to a user account
- Loop sharing: share a song + its loops with other users
