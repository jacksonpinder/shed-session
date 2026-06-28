# UI System

Covers: `src/components/TransportBar.tsx`, `src/components/LoopLaneStrip.tsx`, `src/components/AudioSlider.tsx`, `src/components/EdgeScrubberRail.tsx`, `src/lib/assignLanes.ts`

**Related docs:** [audio-engine](./audio-engine.md) · [pdf-viewer](./pdf-viewer.md) · [app-shell](./app-shell.md)

---

## Responsibilities

The UI system provides the presentational layer for playback controls, loop management, and navigation. All logic and state live in `PlayerDock` — these components receive props and fire callbacks. They contain no business logic.

---

## TransportBar (`src/components/TransportBar.tsx`)

Purely presentational. Three-zone CSS grid (`1fr auto 1fr`):

```
[Left zone]         [Center zone]              [Right zone]
Add loop / Exit     Repeat Back Play Fwd Nav   AudioLines → panel
```

**Left zone:** Single button toggles between Add loop (∞ icon, creates a new loop at playhead) and Exit loop (× icon, deactivates active loop).

**Center zone:** A "scaling pill" — Repeat / Back / Play / Forward / Nav. The pill shrinks when space is constrained. Nav button toggles auto-scroll; only shown when a sync map exists.

**Right zone:** `AudioLines` icon — on desktop, hover reveals the audio settings panel; on mobile/touch, click toggles it. The panel contains three `AudioSlider` rows stacked vertically.

### Audio settings panel

```
Speed      [slider]    [reset]
Transpose  [slider]    [reset]
Balance    [slider]    [reset + mono toggle]
```

Rows animate in with staggered delays (Speed first at +60ms, Transpose at +115ms, Balance at +170ms) when the panel opens.

### Disabled features

**Hold-to-seek radial menu:** `handleSeekPointerDown/Move/Up/Cancel` handlers exist in `TransportBar.tsx` but are commented out of the Back and Forward button JSX. The `renderSeekHoldMenu()` calls are also commented out. To re-enable: restore `onPointerDown/Move/Up/Cancel` props and uncomment the menu renders.

**Auto-collapse:** Controlled by `useTransportVisibility` in `PlayerDock.tsx`. Called with `autoHideEnabled: false`; `transportMode` hardcoded to `'expanded'`. Hook and collapsed-mode rendering still exist. To re-enable: remove `autoHideEnabled: false` and restore `const transportMode = seekExtensionOpen ? 'collapsed' : autoTransportMode`.

---

## AudioSlider (`src/components/AudioSlider.tsx`)

Reusable slider with center-out fill and magnetic center snap. Used for Speed, Transpose, and Balance.

```ts
type AudioSliderProps = {
  value: number
  min: number
  max: number
  step: number
  center?: number           // neutral point (fill origin)
  snapThreshold?: number    // magnetic snap radius in value units
  live?: boolean            // true: onChange fires during drag; false: only on release
  onChange: (value: number) => void
  leftLabel?: ReactNode
  rightLabel?: ReactNode
  centerSlot?: (value: number, dragging: boolean) => ReactNode  // reset button area
  formatValue?: (value: number) => string
  ariaLabel?: string
}
```

### Center-out fill

The filled track segment runs between the center point and the thumb, not from the left edge:

```
fillLeft  = min(centerFrac, thumbFrac) × 100%
fillWidth = abs(thumbFrac − centerFrac) × 100%
```

This makes the "departure from neutral" visually obvious.

### Magnetic snap

Quantization + snap applied on every pointer move:

1. If `|raw − center| ≤ snapThreshold` → snap to `center`
2. Round to step grid: `Math.round((raw − min) / step) × step + min`
3. If rounded result is within `snapThreshold` of `center` → snap to `center`
4. Clamp to [min, max]
5. Fix floating-point decimals

**Invariant:** `step` should be ≤ `snapThreshold`, or quantization can jump over the snap zone and the magnet won't engage.

### `live` flag

- `live={true}` (Speed, Balance): `onChange` fires on every pointer move — real-time DSP effect
- `live={false}` (Transpose): `onChange` fires only on pointer-up — prevents triggering SoundTouch worklet initialization on every intermediate drag position

---

## LoopLaneStrip (`src/components/LoopLaneStrip.tsx`)

Visual strip of loop time-bars rendered below the waveform.

### Expanded state

Color-coded rows, one per non-overlapping lane (assigned via `packIntervals`). Each lane is 20px tall with an 8px gap.

Each loop chip shows:
- Name (if chip is wide enough, ≥44px)
- Delete button on hover or when active
- Edit mode: double-click to rename (inline input, Enter to commit, Escape to cancel)

**Active loop connector bracket:** The active chip has `zIndex: 2`. A bracket pseudo-element (left + right + bottom borders, same color as the loop) runs behind all intervening chips at `zIndex: 0`, visually connecting the chip to the waveform region.

### Collapsed state ("LG peek")

Three micro-rows that suggest the loop lane without showing it:

| Row | Height | Opacity |
|---|---|---|
| Front | 5px | 1.0 |
| Middle | 4px | 0.7 |
| Back | 3px | 0.45 |

All rows have `filter: blur(2px)`. The entire peek area is a tap target that expands the lane.

A full-width bumper div at the bottom of the expanded lane (invisible at rest, shows a gradient + chevron on hover) collapses the lane.

---

## ContextBar (`src/components/ContextBar.tsx`)

Absolutely positioned overlay at the top of the song view (z-index 30, pointer-events off the container, on the buttons). Two zones:

- **Left:** Back-to-library button (arrow icon) when `onBack` is provided; otherwise a logo mark
- **Right:** Zoom out / zoom in buttons

Both zoom buttons call `pdfViewerRef.current.zoomIn()` / `zoomOut()` on the `PDFViewerHandle`. They are disabled (greyed out) at the scale extremes via `zoomOutDisabled` / `zoomInDisabled` props from SongView.

The component is purely presentational. `isMobile` (via `matchMedia`) adjusts button sizing but does not change the control set.

---

## TrackSelector (`src/components/TrackSelector.tsx`)

Dropdown for switching between a song's tracks. Used inside `TransportBar` (docked at the bottom). Shows the active track name; opens a flat `TrackMenu` up or down depending on the `openDirection` prop.

```ts
type TrackOption = { id: string; name: string }
```

`TrackMenu` includes:
- One button per track; active track shows a check mark
- Optional "Manage tracks" link → calls `onManageTracks()` (opens TrackManager modal in SongView)
- Click-outside handler (mousedown on document) closes the menu

`TrackSelector` is stateless beyond open/closed. All selection state lives in SongView (`activeTrackId`, `onSelectTrack`).

---

## EdgeScrubberRail (`src/components/EdgeScrubberRail.tsx`)

Documented in detail in [pdf-viewer.md](./pdf-viewer.md). In the UI system context:

- Right-edge 60px strip (desktop) or 4px ghost rail (touch)
- Touch ghost rail auto-hides 1.5s after scroll stops
- Click or drag the viewport window to seek
- Click a loop band to select the loop (calls `onSelectLoop(id)`)

---

## `assignLanes.ts` / `packIntervals`

Greedy interval scheduling used across three contexts:

```ts
packIntervals(intervals: { id: string; start: number; end: number }[]): Record<string, number>
  // Returns map of id → lane index (0-based)

assignLanes(loops: SavedLoop[]): Record<string, number>
  // Thin wrapper; loops use start/end in song-time

laneCount(lanes: Record<string, number>): number
  // Max lane index + 1
```

**Algorithm:** Sort by start time. For each interval, find the lowest lane whose last occupant has ended (i.e., `laneEnd[lane] ≤ interval.start`). If no lane is free, open a new one.

**Where it's used:**

| Consumer | Domain | Meaning of start/end |
|---|---|---|
| `LoopLaneStrip` | Time (seconds) | Loop start/end in song-time |
| `PDFViewer` margin bars | Page-Y (ratio) | Loop's Y range within a page |
| `EdgeScrubberRail` bands | Doc-Y (pixels) | Loop's absolute scroll position range |

---

## When modifying this system

- **TransportBar is 100% presentational.** Adding a new control: add prop to `TransportBarProps`, add state + callback in `PlayerDock`, pass through SongView if needed. Never add local state or logic to TransportBar.
- **AudioSlider's `live={false}` on Transpose is critical.** Changing it to `live={true}` will call `onChange` on every pointer-move tick during drag, triggering worklet initialization mid-gesture.
- **AudioSlider snap requires `step ≤ snapThreshold`.** If you change either constant, verify the magnet still engages smoothly across the full range.
- **LoopLaneStrip peek heights are hardcoded pixel constants.** Changing them requires matching updates in the bumper/gradient overlay CSS.
- **The connector bracket uses `zIndex` ordering.** Adding a new chip variant between `zIndex: 0` and `zIndex: 2` will break the visual hierarchy.

---

## Common failure modes

- **Connector bracket misaligned:** A new element in the chip row has a non-default `zIndex` that occluds the bracket. The bracket must sit at `zIndex: 0`; active chip at `zIndex: 2`.
- **AudioSlider snapping doesn't engage:** `snapThreshold` is smaller than `step`. Quantization rounds past the snap zone before the magnet can pull. Fix: ensure `step ≤ snapThreshold`.
- **Loop chips all in one lane despite non-overlapping loops:** `packIntervals` sort or comparison is off. The sort key should be `start`, and the occupancy check should be strict `≤` (not `<`).
- **Collapsed peek not appearing:** `lanesVisible` setting is false but the collapse button isn't rendering the peek. Check that the peek rendering branch is not gated by an extra condition.
- **Audio panel not opening on touch:** The `isFinePointer` detection (via `window.matchMedia('(pointer: fine)')`) might be misclassifying the device. Touch devices use click-to-toggle; pointer devices use hover.
