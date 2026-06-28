# Shed Session — UI System Reference

> **Purpose:** Codify every pattern already present in the codebase so future UI
> additions automatically feel native. Rules are extracted from the code, not
> invented. Where the code is inconsistent, inconsistencies are flagged separately
> at the bottom.

---

## Table of contents

1. [Layout principles](#1-layout-principles)
2. [Spacing scale](#2-spacing-scale)
3. [Color usage](#3-color-usage)
4. [Typography](#4-typography)
5. [Button hierarchy](#5-button-hierarchy)
6. [Icon usage](#6-icon-usage)
7. [Slider behavior](#7-slider-behavior)
8. [Popover patterns](#8-popover-patterns)
9. [Panel behavior](#9-panel-behavior)
10. [Motion rules](#10-motion-rules)
11. [Mobile patterns](#11-mobile-patterns)
12. [Accessibility rules](#12-accessibility-rules)
13. [Rules Claude should follow when creating new UI](#13-rules-claude-should-follow-when-creating-new-ui)
14. [Violation log](#14-violation-log)

---

## 1. Layout principles

### App shell

There are two top-level routes:

- **Library** (`#/`): full-page scroll, `min-h-screen bg-[#f8fafc]`. Content lives inside `mx-auto max-w-5xl px-6`.
- **Song view** (`#/song/:id`): split layout — PDF fills a scroll container on the left; `PlayerDock` (transport + waveform + loop lane) is docked at the bottom or right.

### Layering model

The z-index stack from bottom to top:

| Level | Element |
|---|---|
| 0 | PDF pages, waveform canvas |
| 10 | Edge scrubber rail |
| 20 | Scrubber loop bands |
| 30 | ContextBar (floating, `pointer-events: none` shell, `pointer-events: auto` children) |
| 60 | SongCard overflow menu |
| 200 | TrackSelector dropdown |
| 300 | Modals (AddSongModal, TrackManager) |
| 9999 | Button-anchored popovers (audio panel, auto-scroll hint) |
| 10050 | Seek-hold radial menu |

### Floating chrome (ContextBar)

The ContextBar floats `absolute inset-x-0 top-0`. Its shell has `pointer-events-none`; only the actual button children have `pointer-events-auto`. This allows PDF content to be reachable through the bar's "empty" space.

### PDF + scrubber rail

The PDF scroll container hides its native scrollbar (`.no-scrollbar`). The edge scrubber rail (60 px wide on desktop, 4 px ghost on touch) replaces it visually and positions itself `absolute inset-y-0 right-0`.

### Responsive grid (Library)

```
grid-cols-2 gap-4      (< sm, i.e. < 640 px)
sm:grid-cols-3         (640–1023 px)
lg:grid-cols-4         (≥ 1024 px)
```

---

## 2. Spacing scale

The app uses Tailwind's default 4-px base. The values actually used:

| Token | px | Usage |
|---|---|---|
| `gap-1` | 4 | Transport button cluster tight spacing |
| `gap-1.5` | 6 | Transport bar outer gap, dock elements |
| `gap-2` | 8 | Most horizontal label/icon pairs |
| `gap-3` | 12 | Control-button groups |
| `gap-4` | 16 | Card grid, section gaps |
| `p-4` | 16 | Popovers, drop-zone padding |
| `p-6` | 24 | Modal inner padding |
| `px-3 py-2` | 12/8 | Standard text input |
| `px-4 py-2` | 16/8 | Pill button (primary CTA, ghost) |
| `px-3 py-1.5` | 12/6 | Menu items, list-item rows |
| `px-6` | 24 | Page-level horizontal margin |
| `pt-10 pb-2` | 40/8 | Library header vertical rhythm |
| `pt-4 pb-16` | 16/64 | Library main content |
| `mb-2` | 8 | Audio-panel label row bottom margin |
| `my-2` | 8 | Divider vertical margin inside panels |
| `mt-4` | 16 | Form field spacing inside modal |
| `mt-5` | 20 | Modal action-row top margin |

### Insets and offsets

- Modal horizontal padding on small screens: `p-4` on the wrapper
- Popover centering: `left-1/2 -translate-x-1/2`
- Popover bottom offset: `bottom-full mb-2`
- Chip-over-bar tooltip right offset: `right: calc(100% + 6px)`
- ContextBar zoom buttons: `mr-[68px]` to clear the 60 px scrubber rail

---

## 3. Color usage

### Palette

| Role | Value | Tailwind equivalent |
|---|---|---|
| **Accent / primary** | `#4F7F7A` | — (no Tailwind name) |
| **Accent hover** | `#446e69` | — |
| **Accent active** | `#3d625e` | — |
| **Accent tint (10 %)** | `#4F7F7A/10` | — |
| **Accent tint (25 %)** | `#4F7F7A/25` | — |
| **Accent border (55 %)** | `#4F7F7A/55` | — |
| **On-accent text** | `#0b1220` | Nearly slate-900 |
| **App background** | `#f8fafc` | `slate-50` |
| **Card / surface** | `#ffffff` | `white` |
| **Subtle surface** | `slate-50` | — |
| **Input hover border** | `slate-200` | — |
| **Divider** | `slate-100` | — |
| **Separator (menus)** | `slate-200` | — |
| **Disabled / placeholder** | `slate-400` | — |
| **Body text** | `slate-900` | — |
| **Secondary text** | `slate-700` / `slate-600` / `slate-500` | — |
| **Muted / label** | `slate-400` | — |
| **Danger** | `rose-600` hover `rose-50` | — |
| **Warning** | `amber-600` / `amber-500` | — |
| **Zoom button fill** | `#e7e9ec` | — (no Tailwind name) |
| **Waveform cursor** | `rgba(17,24,39,1)` | `gray-900` equivalent |

### Loop color palette

Eight named colors assigned round-robin to new loops (`LOOP_COLORS` in `PlayerDock.tsx`):

| Name | Value |
|---|---|
| Dusty Rose | `rgb(143, 103, 95)` |
| Muted Indigo | `rgb(90, 95, 143)` |
| Slate Blue | `rgb(91, 109, 138)` |
| Mossy Green | `rgb(108, 123, 104)` |
| Dusty Plum | `rgb(143, 112, 133)` |
| Warm Umber | `rgb(158, 122, 86)` |
| Cool Gray-Blue | `rgb(120, 132, 146)` |
| Deep Steel | `rgb(96, 110, 125)` |

All eight are muted mid-tones, **fully opaque**. Partial transparency was removed because it introduced noise where loop bars and chips overlapped. No color mirrors the app accent — all loops are equal in importance.

**Consistency check:** The palette is internally consistent. All values share the same saturation band and are fully opaque. The fallback color for loops missing a value is `#94a3b8` (`slate-400`) — also in the muted-neutral family.

**Rule**: Do not add a loop color that is bright/saturated (no `#ff0000`, `#00ff00` etc.). The goal is readable color-coding, not decoration.

### Usage rules

- The accent `#4F7F7A` is the *only* color used for interactive confirmation, active states, and primary actions. Never introduce a second action color.
- Loop-region colors are user-assigned from the palette above. Those colors appear only on loop bars, chips, and waveform regions — never used to style shell UI elements.
- Danger states use `rose-*`. Do not use `red-*`.
- Warning / partial-success states use `amber-*`.
- Success (analysis done, synced) reuses the accent `#4F7F7A` — there is no separate green.
- `opacity-40` marks disabled / unavailable state. Do not use `text-slate-300` for disabled.

### Dark mode

Dark mode is not a near-term target. The `dark:` variants present on control buttons are vestigial from an earlier exploration and should not be treated as a complete dark theme. Do not write new UI assuming dark mode support.

---

## 4. Typography

### Scale

| Role | Size | Weight | Color | Notes |
|---|---|---|---|---|
| Page heading | `text-lg` (18 px) | `font-semibold` | `slate-900` | `tracking-tight` |
| Modal heading | `text-lg` | `font-semibold` | `slate-900` | — |
| Card title | `text-sm` (14 px) | `font-semibold` | `slate-900` | `truncate` |
| Body / list item | `text-sm` | normal | `slate-700` – `slate-900` | — |
| Menu item | `text-[13px]` | normal | `slate-800` | — |
| Form label | `text-[13px]` | `font-medium` | `slate-600` | — |
| Metadata / secondary | `text-[11px]` | normal | `slate-500` | — |
| Section label / unit | `text-[10px]` | `font-medium uppercase tracking-widest` | `slate-400` | Audio panel row labels |
| Badge / chip | `text-[10px]` | `font-semibold` | varies | Seek toast, status badges |
| Loop chip label | `text-[10px]` | `font-medium` | `white` | `text-shadow: 0 1px 2px rgba(0,0,0,0.3)` |
| TrackSelector pill | `text-[11px]` | `font-semibold uppercase tracking-[0.15em]` | `#0b1220` | — |
| Waveform seek badge | `text-[9px]` | `font-semibold` | current | Overlaid on icon |
| Transpose interval | custom inline SVG + spans | `font-semibold` | `#0b1220` | `ArrowUp/Down size={12}` + glyph |

### Value display in audio panel

When a control is at its default (zero/center):
```
text-[14px] text-slate-400
```
When it is off-center (user-set):
```
text-[17px] tracking-tight text-[#0b1220] tabular-nums
```
This size shift is a deliberate signal that the value is non-default.

---

## 5. Button hierarchy

There are five distinct button tiers. Use the correct tier — do not mix styles from different tiers.

### Tier 1 — Primary CTA (filled pill)

Used for the main affirmative action on a screen (Add a song, Create).

```
rounded-full bg-[#4F7F7A] px-4 py-2 text-sm font-medium text-white
shadow-sm transition hover:bg-[#446e69] active:bg-[#3d625e]
disabled:cursor-not-allowed disabled:opacity-40
focus-visible:outline-none focus-visible:ring-2
focus-visible:ring-[#4F7F7A]/40 focus-visible:ring-offset-2
focus-visible:ring-offset-white/80
```

Instances: Library "Add a song", AddSongModal "Create".

### Tier 2 — Primary icon (play button)

The one action button that uses the filled accent *without* a label.

```
h-9 w-9 rounded-full bg-[#4F7F7A] text-[#0b1220] (icon: text-white)
shadow-lg shadow-[#4F7F7A]/30 transition
hover:scale-[1.02] hover:bg-[#4F7F7A]
focus-visible:outline-none focus-visible:ring-2
focus-visible:ring-[#4F7F7A]/40 focus-visible:ring-offset-2
focus-visible:ring-offset-white/80
```

One instance only: the play/pause button in TransportBar.

### Tier 3 — Glass control button (icon)

Transport controls, repeat, auto-scroll, AudioLines trigger.

```
h-8 w-8 rounded-full
border border-[#4F7F7A]/55
bg-black/5 text-[#0b1220]
shadow-sm shadow-black/10 backdrop-blur-sm
transition hover:bg-black/10 active:bg-black/15
focus-visible:outline-none focus-visible:ring-2
focus-visible:ring-[#4F7F7A]/40 focus-visible:ring-offset-2
focus-visible:ring-offset-white/80
dark:border-[#4F7F7A]/45 dark:bg-white/10 dark:text-slate-100
```

**Active/toggle variant**: apply these classes on top:
```
!border-[#4F7F7A] !bg-[#4F7F7A]/25 hover:!bg-[#4F7F7A]/30 active:!bg-[#4F7F7A]/35
```

**Playback (back/forward) variant**: these additionally use a light fill:
```
!bg-[#f1f1f1] !text-[#0b1220] hover:!bg-[#e7e7e7] active:!bg-[#dedede]
```

### Tier 4 — Ghost / text button

Cancel, secondary text actions. No border, no shadow.

```
rounded-full px-4 py-2 text-sm font-medium text-slate-600
transition hover:bg-slate-100
focus-visible:outline-none focus-visible:ring-2
focus-visible:ring-[#4F7F7A]/40
```

### Tier 5 — Icon-only utility (no background at rest)

Close buttons in modal headers, card overflow trigger.

```
flex h-7 w-7 (or h-8 w-8) items-center justify-center
rounded-full text-slate-400
transition hover:bg-slate-100 hover:text-slate-600
focus-visible:outline-none focus-visible:ring-2
focus-visible:ring-[#4F7F7A]/40
```

The card overflow trigger is initially `opacity-0 group-hover:opacity-100`; it becomes `opacity-100` when its menu is open.

### Track selector button

The track selector is now a standard Tier-3 glass control button: `h-8 w-8 rounded-full` with `ListMusic size={15}` icon. No track name label is displayed. The button opens a dropdown menu to show and switch between available tracks for the song.

### Floating chrome buttons (ContextBar — special case)

The back button and zoom buttons float directly over the PDF with no containing pill. They must be legible against both white PDF pages and dark-ish PDF content. Both use a solid-white + border + shadow treatment — the border creates a visible edge on white PDF pages, and the shadow grows on hover for an unmistakable state change:

```
h-8 w-8 rounded-full
bg-white text-[#0b1220]
shadow border border-slate-200
transition hover:bg-slate-50 hover:shadow-md hover:border-slate-300
active:bg-slate-100
disabled:cursor-not-allowed disabled:opacity-40
focus-visible:outline-none focus-visible:ring-2
focus-visible:ring-[#4F7F7A]/40
```

All floating-chrome buttons use full-opacity `text-[#0b1220]` — they are functional controls, not secondary decorations.

The logo pill (when no `onBack` is provided) uses the same `bg-white shadow border border-slate-200` shell.

**Rule**: any button that floats over the PDF without a containing background uses `bg-white border border-slate-200 shadow`, not a translucent or glassmorphism fill. `hover:shadow-md` is the primary hover signal (not background color alone) because background changes are subtle on white pages.

### Destructive menu item

```
flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left
text-[13px] transition text-rose-600 hover:bg-rose-50 active:bg-rose-100
```

---

## 6. Icon usage

All icons come from **lucide-react**. No other icon library is used.

### Size conventions

| Context | Size | StrokeWidth |
|---|---|---|
| Tier-3 glass control buttons | `size={15}` or `16` | default (2) |
| Play/Pause in Tier-2 button | `size={16}` | default |
| Seek back/forward | `size={21}` | `1.4` |
| Repeat, MapPin (Navigation), ListMusic (Track selector) | `size={15}` | default |
| Modal close / card overflow | `size={18}` or `15` | default |
| Menu item icon | `size={14}` | default |
| Metadata inline (SongCard) | `size={11}` | default |
| Status chip (Loader2, Check, AlertCircle) | `size={11}` | default |
| Empty state (FileMusic placeholder) | `size={36}` | `1.5` |
| Add song empty state | `size={28}` | default |
| Transpose direction arrow | `size={12}` | `2.5` |
| Zoom buttons | `size={16}` | default |

### Expressing icon state

- **Available, off**: render at normal opacity
- **Available, active**: parent button receives `toggleActiveClass` (accent border + tint background); icon itself does not change color
- **Unavailable / disabled**: `opacity-40 cursor-help` on the button; icon unchanged
- **Suspended / paused auto-scroll**: `text-amber-500` on the button (the only case where an icon's parent color is non-default)
- **Spinner**: `Loader2 className="animate-spin"`
- **Success**: `Check` with `text-[#4F7F7A]`
- **Delete on a colored loop chip**: `text-white/80 hover:bg-black/20 hover:text-white` — hover darkens the loop-color background rather than changing icon color, which ensures the icon stays readable on any loop color.

### Seek icon

The seek back/forward icon is composite: `RotateCcw`/`RotateCw` at `size={21} strokeWidth={1.4}` with a `text-[9px] font-semibold` number overlay positioned `absolute` in the center of a `h-6 w-6` span.

---

## 7. Slider behavior

There is one slider component: `AudioSlider`. Do not build new sliders from scratch — extend this one.

### Visual anatomy

```
[ left label ]  [ center slot ]  [ right label ]

  ←────────────────────────────────────────→
       track (bg-slate-200, h-1.5)
       center tick (slate-300, h-3, w-px)
       fill (accent, center-out, h-1.5)
       thumb (white border-accent, h-4 w-4)
```

- **Track**: `h-1.5 rounded-full bg-slate-200`
- **Center tick**: `h-3 w-px bg-slate-300`, positioned at `centerFrac`
- **Fill**: starts at `center`, extends left or right; color `#4F7F7A`
- **Thumb**: `h-4 w-4 rounded-full border-2 bg-white shadow-sm`; border `#4F7F7A`

### Snap / detent

The `snapThreshold` prop creates a magnetic snap to `center`. The snapped-in threshold for the sliders in use:

| Slider | `snapThreshold` |
|---|---|
| Speed | `0.03` |
| Transpose | `0.6` |
| Balance | `0.05` |

### Live vs. committed

- `live={true}` (default): `onChange` fires on every pointer move (speed, balance).
- `live={false}`: thumb tracks drag visually but `onChange` only fires on pointer-up (transpose — avoids the SoundTouchNode "catch" on intermediate values).

While `live=false` and dragging: fill opacity drops to `0.45`, thumb opacity to `0.7`.

### Labels and center slot

- Left/right labels: `text-[10px] font-medium text-slate-400`
- Center slot: receives `(display, dragging)` — callers use this to show a Reset chip when off-center, or a live value preview while dragging

### Reset chip

```
rounded-full bg-slate-100 px-2 py-0.5
text-[10px] font-semibold uppercase tracking-wide text-slate-500
hover:bg-slate-200 active:bg-slate-300
focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4F7F7A]/40
```

Appears in the `centerSlot` when `Math.abs(display - center) > threshold`.

### Keyboard

`ArrowLeft`/`ArrowDown` → decrement step; `ArrowRight`/`ArrowUp` → increment step; `Home` → min; `End` → max. All fire `onChange` immediately (live regardless of `live` prop).

---

## 8. Popover patterns

### Audio panel (stacked controls behind AudioLines button)

Shape:
```
absolute bottom-full left-1/2 mb-2 z-[9999]
w-64 max-w-[calc(100vw-16px)]
-translate-x-1/2 origin-bottom
rounded-2xl border border-slate-200 bg-white p-4 shadow-xl
```

Open/close transition:
```
transition-[opacity,transform] duration-200 ease-out
open:  opacity-100  translate-y-0  scale-100  pointer-events-auto
closed: opacity-0   translate-y-2  scale-95   pointer-events-none
```

**Stagger**: each row inside the panel gets a per-index `transitionDelay` of `60 + index * 55` ms on open; `0ms` on close. Three rows = delays of 60, 115, 170 ms.

**Dismiss**: `mousedown` outside the `audioClusterRef` closes it. On desktop (fine pointer), the panel also reveals on hover (`onPointerEnter`/`Leave` with `e.pointerType === 'mouse'` guard).

**Active state badge**: when closed and any setting is non-default, a small badge cluster appears below the AudioLines button:
```
rounded-full border border-[#4F7F7A]/30 bg-[#4F7F7A]/10
px-1.5 py-px text-[10px] font-medium tabular-nums text-[#0b1220]
```

### Hint popovers (auto-scroll unavailable, suspended)

Smaller, text-only, no transition (instant show/hide via conditional render):

```
absolute bottom-12 left-1/2 z-[9999]
w-44 -translate-x-1/2
rounded-xl border border-slate-200 bg-white
px-3 py-2 text-[11px] font-medium leading-snug text-slate-600 shadow-xl
```

Warning variant (suspended):
```
border-amber-200 text-amber-700
```

Auto-dismiss: hint shown for 2600 ms, then hidden.

### Dropdown menus (SongCard, TrackSelector)

```
absolute right-0 top-full z-[60] mt-1
w-44 (SongCard) / w-52 (TrackSelector, max-h-72 overflow-y-auto)
rounded-xl border border-slate-200 bg-white
py-1.5 shadow-xl
```

- Open/close: no animation — conditional render only.
- Dismiss: `mousedown` outside the containing `ref`.
- Items: `rounded-lg px-3 py-1.5 text-[13px] text-slate-800 hover:bg-slate-50 active:bg-slate-100`
- Dividers: `<div className="my-1 border-t border-slate-100" />`
- Manage/settings item at top before divider: `text-slate-500 hover:text-slate-700`
- Active item (TrackSelector): `font-semibold text-[#4F7F7A]` + `Check size={13}` at trailing edge.

---

## 9. Panel behavior

### Modal (AddSongModal, TrackManager)

Backdrop:
```
fixed inset-0 z-[300] flex items-center justify-center
bg-slate-900/40 p-4 backdrop-blur-sm
```

Container:
```
w-full max-w-lg (AddSongModal) / max-w-md (TrackManager)
rounded-2xl bg-white p-6 shadow-2xl
```

Header row:
```
mb-4 flex items-center justify-between
  h2: text-lg font-semibold text-slate-900
  close: h-8 w-8 rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600 (Tier 5)
```

Footer row (AddSongModal):
```
mt-5 flex justify-end gap-2
  cancel: Tier 4 ghost
  create: Tier 1 CTA
```

Click-outside dismiss: TrackManager closes when clicking the backdrop. AddSongModal does not (to prevent accidental data loss).

### Drop zones

Primary (audio upload):
```
rounded-xl border-2 border-dashed border-[#4F7F7A]/50 bg-[#4F7F7A]/5
py-7 gap-1.5 cursor-pointer
hover:border-[#4F7F7A]
dragging: border-[#4F7F7A] bg-[#4F7F7A]/5
icon: text-[#4F7F7A]
label: text-sm font-medium text-[#4F7F7A]
```

Secondary (PDF upload):
```
border-slate-300 py-5
hover:border-slate-400
icon: text-slate-400
label: text-sm font-medium text-slate-600
```

Dragging state: both switch to `border-[#4F7F7A] bg-[#4F7F7A]/5`.

### Audio panel section dividers

```
<div className="my-2 border-t border-slate-100" />
```

Used between Speed / Transpose / Balance rows inside the audio panel.

### Loop lane strip

- **Expanded**: `height = LANE_PAD(8) + n*(20+8) - 8 + LANE_BOTTOM_CLEARANCE(4)`
- **Collapsed peek**: `height = LANE_TOP_PAD(4) + sum(peekRowHeights) + LANE_BOTTOM_CLEARANCE(4)`
- **Transition**: `transition-[height] duration-200 ease-out motion-reduce:transition-none`

Peek rows (collapsed):
- Lane 0: `height: 5px, opacity: 1`
- Lane 1: `height: 4px, opacity: 0.7`
- Lane 2+: `height: 3px, opacity: 0.45`
- All lanes: `filter: blur(2px)`, container `opacity: 0.45`

Expand trigger: full-width tap on peek zone.
Collapse trigger: invisible bumper at bottom of expanded lane; hover shows gradient wash + `ChevronDown size={10}`.

### Status chips (inline)

Used in AddSongModal track list and PDF row:
```
inline-flex items-center gap-1 text-[11px]
  analyzing: text-slate-500 + Loader2 animate-spin
  done:      text-[#4F7F7A] + Check
  error:     text-amber-600 + AlertCircle
```

---

## 10. Motion rules

### Standard transitions

Every interactive element carries `transition` (Tailwind shorthand = `transition-property: color, background-color, border-color, text-decoration-color, fill, stroke, opacity, box-shadow, transform, filter, backdrop-filter; duration: 150ms; timing: cubic-bezier(0.4, 0, 0.2, 1)`). This is the baseline. Do not remove it.

### Durations in use

| Duration | Use |
|---|---|
| 150 ms (default) | Hover state changes (color, bg, border) |
| 200 ms | Expand/collapse (loop lane height, audio panel scale/opacity) |
| 220 ms | Audio-panel row stagger entries |
| 240 ms | Seek-hold menu scale/opacity |
| 300 ms | Edge scrubber ghost fade-in/out |
| 650 ms | Seek toast keyframe animation |

### Easing

- `ease-in-out`: expand/collapse that feels like a physical spring
- `ease-out`: panel scale (items arriving)
- `ease-in`: nothing (explicitly avoided)
- Custom keyframe `seek-toast`: scale 0.88→1 (20%), hold (80%), scale 1→0.92 + translateY (100%)

### Transforms used

- `hover:scale-[1.02]`: play button, seek-hold option buttons
- `hover:scale-[1.06]`: seek-hold active button
- `active:scale-[0.98]`: seek-hold option buttons
- `translateX(calc(-100% - 2px))`: scrubber chip positions to left of band
- `translate(-50%, -50%)`: centering utility (various)
- `translateY(6px) → translateY(0)`: audio panel rows on stagger-in
- `translateY(2px) → translateY(0)`: audio panel container on open

### Motion reduce

Every element with a duration or transform must include:
```
motion-reduce:transition-none
```
The rAF loops (auto-scroll, volume envelope) check `prefers-reduced-motion` in `scrollMotion.ts` — but this is an engine concern, not a UI concern.

### Hover interactions

- Fine pointer (mouse): `isFinePointer` flag gates hover-reveal of the audio panel.
- Touch: hover states do not apply. Touch users get tap-to-open only.
- Detection: `window.matchMedia('(pointer: fine)')` with `change` event listener.

---

## 11. Mobile patterns

### Breakpoints

| Breakpoint | px | Used for |
|---|---|---|
| `sm:` | 640 | Grid 2→3 cols, transport scale skip |
| `lg:` | 1024 | Grid 3→4 cols, zoom button show/hide |

The "mobile" concept in the app is primarily driven by **pointer type**, not screen width:
```
const isMobile = useMediaQuery('(max-width: 1024px), (pointer: coarse)')
```

For the fine/touch distinction in event handlers:
```
const isFinePointer = window.matchMedia('(pointer: fine)')
```

### Touch-specific behaviors

| Element | Desktop | Touch |
|---|---|---|
| Audio panel | Reveals on hover OR tap | Tap only |
| Edge scrubber rail | 60 px, page cards, loop bands, grip | 4 px ghost, no page cards, no grip |
| Scrubber visibility | Always | Auto-hides 1.5 s after last scroll |
| Zoom buttons | Shown (top-right of ContextBar) | Hidden |
| Transport scale | Constant 1× on `sm:` | Scales down to fit viewport − 36 px |

### Transport scaling on mobile

When the expanded transport cluster overflows its container on viewport widths below `sm`, a `ResizeObserver + rAF` loop computes:

```
scale = min(1, (window.innerWidth - 36) / expandedControls.scrollWidth)
```

Applied as `transform: scale(${scale})` with `transformOrigin: 'center bottom'`.

---

## 12. Accessibility rules

### Focus rings

**All** interactive elements use `focus-visible:` (not `focus:`):
```
focus-visible:outline-none
focus-visible:ring-2
focus-visible:ring-[#4F7F7A]/40
focus-visible:ring-offset-2
focus-visible:ring-offset-white/80    ← on light backgrounds
focus-visible:ring-offset-slate-900/70 ← on dark backgrounds (dark mode)
```

Never use browser default focus outline (no `outline: none` without a ring replacement).

### ARIA semantics

| Pattern | Element | Attributes |
|---|---|---|
| Toggle button | Repeat, AutoScroll, Mono switch | `aria-pressed={bool}` |
| Menu trigger | AudioLines, card overflow | `aria-expanded={bool}` |
| Radio-like selection | TrackSelector items | active item: `font-semibold` + `Check` icon (no explicit ARIA) |
| Track selector button | Pill | `aria-expanded={bool}` |
| Slider | AudioSlider track div | `role="slider" aria-valuemin aria-valuemax aria-valuenow aria-valuetext` |
| Toggle switch | Mono toggle | `role="switch" aria-checked={bool}` |
| Unavailable state | AutoScroll button | `aria-disabled={!autoScrollAvailable}` |
| Decorative img | Logo, thumbnails | `alt=""` |
| Icon-only buttons | ALL | `aria-label="…"` required |
| Groups | Audio panel | `role="group" aria-label="Audio settings"` |

### Touch tap highlight

```css
* { -webkit-tap-highlight-color: transparent; }
```

Defined in `tailwind.css`. All custom focus rings handle the visual feedback instead.

### Slider keyboard

The `AudioSlider` handles: `ArrowLeft`, `ArrowRight`, `ArrowUp`, `ArrowDown`, `Home`, `End`. No other custom keyboard handling is needed for sliders.

### Inline edit

Inline rename inputs (LoopLaneStrip, TrackManager, SongCard) handle:
- `Enter` → commit (blur)
- `Escape` → cancel (revert)
- `onBlur` → commit

### `touch-none`

The AudioSlider track div uses `touch-none` to prevent scroll interference during horizontal drags.

---

## 13. Rules Claude should follow when creating new UI

These rules are derived mechanically from the patterns above. When in doubt, look at an existing component.

---

### Colors

**R-C1** — Use only `#4F7F7A` as the accent. Never introduce `teal-500`, `emerald-*`, or any other green/teal for interactive states.

**R-C2** — Background is always `bg-[#f8fafc]` at the page level and `bg-white` for surfaces (cards, modals, popovers). Never use `bg-slate-100` or `bg-gray-*` for surfaces.

**R-C3** — For destructive actions, use `text-rose-600 hover:bg-rose-50 active:bg-rose-100`. Never use `red-*`.

**R-C4** — For disabled/unavailable state, use `opacity-40` on the element (not a lighter text color).

**R-C5** — Loop colors belong only on loop elements (waveform regions, lane bars, margin bars, scrubber bands). Never borrow them for shell chrome.

---

### Buttons

**R-B1** — Every new button must fall into one of the five tiers. Pick the tier that matches the button's importance, not its position.

**R-B2** — Icon-only buttons are `h-8 w-8` (Tier 3/5) or `h-7 w-7` (small utility). Never create a bare `<svg>` clickable element.

**R-B3** — Every button must have `type="button"` unless it is explicitly inside a `<form>`.

**R-B4** — Every icon-only button must have `aria-label="…"`. A `title` is a nice-to-have, not a replacement for `aria-label`.

**R-B5** — The play button (`h-9 w-9`) is the only Tier-2 button in the app. Do not create a second `h-9` icon button; if a new action needs this emphasis, reconsider the hierarchy first.

**R-B6** — Active / toggle state is expressed via `border-[#4F7F7A] bg-[#4F7F7A]/25`, not via a completely different button style. Do not swap to a filled accent button for an active toggle.

**R-B7** — All pill/CTA buttons use `rounded-full`. All list-item buttons and inline utilities use `rounded-lg`. All icon buttons use `rounded-full`.

**R-B8** — Buttons that float over the PDF (back button, zoom buttons) use `bg-white border border-slate-200 shadow hover:bg-slate-50 hover:shadow-md hover:border-slate-300`. Never use a translucent fill — it becomes invisible against white PDF pages.

---

### Focus and accessibility

**R-A1** — Always use `focus-visible:` prefixed utilities. Never use bare `focus:` for ring styles.

**R-A2** — The focus ring color is always `ring-[#4F7F7A]/40` at `ring-2` width. Do not use `ring-blue-500` or any other color.

**R-A3** — `aria-pressed` goes on toggles; `aria-expanded` goes on triggers for menus/panels; `aria-disabled` goes on grayed-out-but-present actions (not just `disabled` attribute, because `disabled` removes keyboard focus).

**R-A4** — Decorative images (logo, thumbnails) always have `alt=""`.

---

### Typography

**R-T1** — Section / panel labels (like "Speed", "Transpose", "Balance") are `text-[10px] font-medium uppercase tracking-widest text-slate-400`. Do not use `text-xs` or `text-sm` for these.

**R-T2** — A value display that can be at-center or off-center should animate between `text-[14px] text-slate-400` (default) and `text-[17px] tracking-tight text-[#0b1220]` (non-default). Use `transition-[color,font-size] duration-150`.

**R-T3** — Menu item text is `text-[13px]`. Never use `text-sm` (14 px) in menus.

**R-T4** — Truncation for name fields uses Tailwind `truncate` (overflow-hidden + text-overflow + whitespace-nowrap). Never clip with fixed pixel widths alone.

---

### Spacing

**R-S1** — Modal padding is `p-6`. Popover padding is `p-4`. List-item padding is `px-3 py-1.5`. Do not mix these.

**R-S2** — Horizontal gaps between control buttons in a group are `gap-1` (tight transport cluster) or `gap-3` (relaxed groups). Do not use `gap-2` for button groups.

**R-S3** — Dividers inside panels use `border-t border-slate-100 my-2`. Dividers inside dropdown menus use `border-t border-slate-100 my-1`.

---

### Popovers and menus

**R-P1** — A popover that stacks vertically over its trigger uses `absolute bottom-full left-1/2 -translate-x-1/2 mb-2`. A dropdown that opens below uses `absolute top-full mt-1` (right-aligned) or `absolute top-full mt-2` (left-aligned).

**R-P2** — Popovers animate in with `opacity: 0 → 1`, `translateY: 2px → 0`, `scale: 0.95 → 1`, with `origin-bottom` when opening upward. Menus (SongCard, TrackSelector) are conditional-rendered only (no animation). Pick one approach per new element: if the content is rich (has sliders, staggered rows), animate it; if it is a flat list, render/unmount.

**R-P3** — All popovers and menus are dismissed by `mousedown` outside (not `click` outside). Store the container ref; compare `contains(e.target)`.

**R-P4** — New popovers use `rounded-2xl border border-slate-200 bg-white shadow-xl`. New dropdown menus use `rounded-xl border border-slate-200 bg-white shadow-xl`.

---

### Modals

**R-M1** — Modal backdrops are `fixed inset-0 z-[300] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm`.

**R-M2** — The modal container is `w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl`. Use `max-w-md` only if the content genuinely needs a narrower container (forms with short fields). Do not use `max-w-sm` or `max-w-xl`.

**R-M3** — Every modal has a header row with an `h2` title and a close button (Tier 5 `h-8 w-8 rounded-full`). Footer actions (if any) are right-aligned: ghost cancel first, then CTA.

---

### Icons

**R-I1** — Use only lucide-react. Import individual icons, not the default barrel.

**R-I2** — Control-button icons are `size={15}` or `size={16}`. Do not use `size={20}` inside `h-8 w-8` buttons — the icon will feel too large.

**R-I3** — Inline metadata icons (next to text in cards, lists) are `size={11}`.

**R-I4** — `Loader2` with `animate-spin` is the spinner. Never use a different icon for loading.

**R-I5** — `Check` in accent color is the success state. `AlertCircle` in amber is the warning/error state. Do not invent new status icons.

---

### Motion

**R-Mo1** — Every element with an explicit `duration-*` or transform animation must also have `motion-reduce:transition-none`.

**R-Mo2** — Standard hover state changes use `transition` only (no explicit duration needed — 150 ms default). Structural open/close uses `duration-200`.

**R-Mo3** — Stagger panels by 55 ms per row (delay formula: `60 + index * 55` ms on open, `0ms` on close).

**R-Mo4** — Scale transforms on hover are small: `hover:scale-[1.02]`. Active/pressed: `active:scale-[0.98]`. Never use `hover:scale-110` or larger.

---

### Layout

**R-L1** — New content pages use `mx-auto max-w-5xl px-6` for their inner container.

**R-L2** — The ContextBar (floating top chrome) uses `absolute inset-x-0 top-0 z-30 pointer-events-none` with `pointer-events-auto` on its children. Do not make the shell itself interactive.

**R-L3** — New modals go at `z-[300]`. New popovers go at `z-[9999]`. Nothing except the seek-hold radial menu goes above `z-[9999]`.

**R-L4** — When adding items to the edge scrubber rail or ContextBar, account for the 60 px rail width by offsetting `mr-[68px]` or similar.

---

### Forms and inputs

**R-F1** — Standard form inputs: `rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#4F7F7A] focus:ring-2 focus:ring-[#4F7F7A]/30`.

> Note: inputs use `focus:` (not `focus-visible:`) because the browser's `:focus-visible` heuristic incorrectly hides rings after mouse clicks on form fields. This is the one exception to R-A1.

**R-F2** — Inline-editable fields (no outer border at rest): `border border-transparent bg-transparent hover:border-slate-200 focus:border-[#4F7F7A] focus:bg-white focus:ring-2 focus:ring-[#4F7F7A]/30`.

> The ring opacity is `/30` everywhere — standalone and inline inputs both use the same value.

**R-F3** — Drop zones are `border-2 border-dashed`. Primary zones use accent tint; secondary zones use slate. Both switch to accent on active drag.

---

### Destructive confirmations

**R-D1** — **Low-impact destruction** (delete a loop, remove a track): use a `sonner` toast with an undo action. Do not use `window.confirm()`.

**R-D2** — **High-impact destruction** (delete a whole song): use a confirm dialog (modal or browser `confirm()`). The cost of a mistake is high enough to warrant a blocking prompt.

**R-D3** — Never use `window.confirm()` for low-impact actions — it is visually jarring and blocks the thread. The `sonner` Toaster is already mounted in `App.tsx`; use `toast()` with an action button.

---

## 14. Violation log

The following inconsistencies were found in the current codebase. They should be fixed before adding new UI, or at minimum, new code should not introduce the same inconsistencies.

---

### V-01 · Modal max-width mismatch

- **File:** `AddSongModal.tsx:96` uses `max-w-lg`; `TrackManager.tsx:71` uses `max-w-md`
- **Rule violated:** R-M2 (modals should use `max-w-lg` unless the form is narrow)
- **Fix:** Align to `max-w-lg` unless there is a deliberate reason TrackManager needs narrower. Both contain similar vertical lists.

---

### ~~V-02 · focus ring opacity inconsistency on text inputs~~ ✓ Fixed

- **Was:** `focus:ring-[#4F7F7A]/30` on most inputs, `/20` on the TrackManager inline input.
- **Fix applied:** Standardized to `focus:ring-[#4F7F7A]/30` everywhere. One value, no exceptions.

---

### ~~V-03 · `role="button"` on a `<div>` in SongCard~~ ✓ Fixed

- **Was:** `<div role="button" tabIndex={0}>` wrapping the entire card including the overflow menu.
- **Fix applied:** Card is now a proper `<button type="button">`. The overflow menu `<div>` was moved outside the button as a sibling, both wrapped in a plain `<div class="group relative">`. No nested interactive elements. Keyboard and screen-reader behavior is now native.

---

### ~~V-04 · Missing `type="button"` on SongCard menu items~~ ✓ Fixed

- **Was:** Five menu item `<button>` elements without `type="button"`.
- **Fix applied:** All five menu item buttons now have `type="button"`.

---

### V-05 · Divider styles — documented

Two divider contexts, both using `border-slate-100`:

| Context | Class |
|---|---|
| Inside popovers / panels (audio panel) | `my-2 border-t border-slate-100` |
| Inside dropdown menus | `my-1 border-t border-slate-100` |

Neither modals nor the header row inside a modal use a divider — spacing alone (e.g. `mb-4`) separates header from body.

**Rule**: use `border-slate-100` for all interior dividers. Use `border-slate-200` only for *card* borders and *input* borders (which need more contrast against the page background).

---

### ~~V-06 · Icon opacity inconsistency~~ ✓ Fixed

- **Was:** `Music2 className="shrink-0 opacity-60"` in TrackSelector pill.
- **Fix applied:** Changed to `className="shrink-0 text-slate-400"`. All de-emphasized icons now use `text-slate-400`, not `opacity-*`.

---

### ~~V-07 · `#e7e9ec` zoom-button fill is outside the documented palette~~ ✓ Fixed

- **Was:** `bg-[#e7e9ec]` — an undocumented hex that wasn't consistent with either the back button or any named palette entry.
- **Fix applied:** Both zoom buttons and the back button now share the same frosted-glass treatment: `bg-white/70 backdrop-blur-md hover:bg-white/90 active:bg-white/80`. Documented as R-B8.

---

### V-08 · `window.confirm()` for destructive confirmations — partially fixed

- **Delete track** (`TrackManager.tsx`) ✓ Fixed — now uses optimistic removal + `sonner` toast with 5-second undo window. The actual `deleteTrack` call is deferred by 5 s; canceling clears the timer and re-fetches from IndexedDB (the blob is still there).
- **Delete song** (`Library.tsx`) — open. High-impact action; `window.confirm()` is acceptable here until a styled confirm modal is built (see R-D2).

---

### ~~V-09 · Dead-code state in TransportBar~~ N/A

- **Finding on re-audit:** `speedMenuOpen`, `transposeOpen`, `balanceOpen` are not present in the current `TransportBar.tsx`. They were already removed in a prior session. The `PROJECT_STATE.md` entry is stale. No action needed.

---

### ~~V-10 · TrackSelector dropdown lacks animation~~ ✓ Fixed

- **Was:** TrackMenu rendered/unmounted with no transition.
- **Fix applied:** Added `animate-[menu-in_150ms_ease-out]` with `origin-bottom-left` (opens upward) or `origin-top-left` (opens downward). The `@keyframes menu-in` (scale 0.95→1, opacity 0→1) is defined in `tailwind.css`. Mount animation only — no unmount animation needed for conditional-render menus.

---

### ~~V-11 · Uppercase tracking inconsistency~~ ✓ Fixed

- **Was:** `tracking-[0.15em]` in TrackSelector pill vs `tracking-widest` in audio panel labels.
- **Fix applied:** Changed TrackSelector to `tracking-widest`. One value everywhere for uppercase labels.
