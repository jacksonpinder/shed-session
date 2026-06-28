# Decisions

_Architectural and UX decisions with rationale. Add an entry whenever a non-obvious choice is made._

---

## Architecture

### Pluggable KV store (`PracticeStore`) instead of rewriting PlayerDock
**Decision:** Per-song persistence is handled by injecting a `PracticeStore {load, save}` interface into `PlayerDock`, not by rewriting its internal storage logic.
**Why:** PlayerDock is the heaviest and most delicate file in the codebase. A full rewrite to make it library-aware would have introduced regressions. The injection approach lets it keep its existing `practice:*` key names while `SongView` maps them to the correct Song/Track fields in IndexedDB.
**Trade-off:** The mapping layer in `SongView` is a thin indirection, but adds a place where new keys can be silently missed if not mapped.

### Song-time vs track-time
**Decision:** Loops and sync anchors are stored in **song-time** (a shared reference timeline). Each track has a `leadInOffset`; conversion happens at three seams in `PlayerDock` only.
**Why:** If a second track of the same song has a 4-second intro before the same arrangement starts, the loops should still align. Song-time makes this transparent.
**Trade-off:** Every time→position resolution must apply `trackToSongTime(currentTime - leadInOffset)`; missing a seam causes off-by-offset bugs.

### Auto lead-in via cross-correlation (non-reference tracks only)
**Decision:** Only the reference track (first uploaded) is sent to the Whisper sidecar. Every subsequent track gets `leadInOffset` from client-side onset-envelope cross-correlation vs the reference.
**Why:** Avoids multiple slow Whisper jobs for what is often the same performance at different mic positions or pitches. The assumption is that all tracks share the same anchor timeline.
**Trade-off:** If tracks are fundamentally different performances (different tempo, cut), the cross-correlation will produce a wrong offset and the user will need a manual nudge (not yet built).

### Timing model uses a MEASURE axis, not elapsed time or pixel x
**Decision:** The auto-scroll timing model maps anchors onto a per-system measure axis (integer + fractional measure), not wall-clock seconds or horizontal pixel positions.
**Why:** Note spacing in engraved music is sublinear in time — a whole note doesn't occupy 4× the x-pixels of a quarter note. A pixel-based model would scroll too fast through dense passages and too slow through sustained notes. The measure axis is uniform in musical time.
**Trade-off:** Measure counts must be detected from the score (the barline detection pipeline). When detection fails, `measureCount` falls back to 1 and the model uses system-level equal-weight timing.

### Monotonic ratchet for scroll target (prevents jitter from confidence wobble)
**Decision:** `scrollMotion.advanceFollowTarget()` ratchets the scroll target forward — it never decreases except on a detected seek (identified by audio time, not pixels).
**Why:** When the per-frame `confidence` fluctuated between dense anchors, the adaptive anchor fraction caused the target to wobble up and down slightly — visible as micro-reversal jitter on the user's monitor.
**Trade-off:** If an anchor is genuinely slightly mis-timed (too early), the ratchet holds and then lurches forward. The tempo-aware gap traversal in `resolveTimedPosition` mitigates this.

### Per-staff barline detection, not whole-system height
**Decision:** Barline detection scans each staff against its own height (column run ≥ 0.92 of staff height, touching both outer staff lines), then cross-staff-aligns. Does **not** require the barline to span the full multi-staff system.
**Why:** Barbershop and SATB scores draw barlines one-per-staff (each ~half the 2-staff system height). The original approach (run ≥ 0.8 of system height) found 0 barlines in every barbershop system.
**Trade-off:** The cross-staff alignment (`minBarlineStaves`) is a clustering vote — if a stem happens to align between staves, it could pass. Raising `barlineHeightRatio` to 0.92 (stems peak ~0.90, real barlines ≥ 0.97) makes this extremely unlikely.

### SoundTouch placed upstream of masterGain
**Decision:** `mediaSource → soundTouch → masterGain → …` (not downstream).
**Why:** The fade-out/fade-in envelope ramps on `masterGain` must be real-time-accurate relative to the audio content. Placing SoundTouch downstream would introduce latency between when the ramp fires and when the pitched audio actually reaches the gain node.
**Trade-off:** There's a small (~tens-of-ms) desync between the waveform cursor and the actual audio when transposing. This is within `LOOP_PAD_SECONDS` and imperceptible.

---

## UX

### Score fills the viewport; controls float over it
**Decision:** The PDF is the primary visual. The transport dock is a floating overlay, not a sidebar panel.
**Why:** Musicians need to see as much of the score as possible. A sidebar layout wastes ~30% of the horizontal viewport on chrome.
**Trade-off:** Floating overlays can occlude content at the bottom of each page. Addressed with `paddingBottom` on the PDF scroll container matching the dock height.

### Loop regions use the connector-bracket visual (active region top → active chip)
**Decision:** The active waveform region's bottom edge connects to the active loop chip in the lane via a continuous colored bracket (left + bottom + right borders, running under intervening chips).
**Why:** Users need to see which waveform region corresponds to which chip without relying on color memory alone. The bracket makes the connection explicit and spatial.
**Trade-off:** The connector runs under chips at `zIndex:0`; active chip at `z:2`. In very dense lane configurations (6+ loops), the bracket can be visually hidden behind chips for part of its run.

### Transpose commits on pointer-up (not live)
**Decision:** The transpose slider is `live={false}` — the thumb tracks the drag visually but `setTranspose()` fires only on release.
**Why:** The SoundTouch worklet node initializes lazily on the first non-zero transpose. Firing on every intermediate semitone would trigger repeated async init calls and audible "catches" as the node tries to pitch-shift through each value.
**Trade-off:** The user doesn't hear the pitch change mid-drag. The center slot previews the interval label during drag to compensate.

### Margin loop bars replace floating pill markers
**Decision:** Loop positions on the PDF are shown as 6px vertical bars in the right margin spanning the full docY of each loop, not as floating pill buttons at the linked scroll position.
**Why:** A bar spanning the loop's range gives a better spatial sense of how much of the score the loop covers. Pills only mark a single point and require visual scanning to find them.
**Trade-off:** Margin bars require `sheetLinkEnd` to be computed (via the timing model or a fallback stored draft). Unsynced loops without an end position fall back to a minimum-height bar at the start position.

### Single `AudioLines` button for all audio settings (replaces 3 separate pills)
**Decision:** Speed, Transpose, and Balance+Mono are grouped behind one `AudioLines` button that opens a stacked panel. Previously each had its own in-pill button and popover.
**Why:** The pill was getting crowded. Grouping reduces visual noise and makes the transport pill read clearly as: Repeat / Back / Play / Forward / Nav.
**Trade-off:** One extra tap to reach audio settings. Mitigated by the fine-pointer hover reveal (desktop hover shows the panel without clicking).

### Repeat and auto-scroll have separate song/loop defaults
**Decision:** `repeatSong` (default OFF) and `repeatLoop` (default ON) are independent refs. `autoScrollSong` (default OFF) and `autoScrollLoop` (default ON) follow the same pattern.
**Why:** The most common use case is: loop a difficult passage, have it repeat and scroll automatically, but stop repeating when in free-play mode (no active loop).
**Trade-off:** Two booleans per feature is more state to serialize and restore.

### `pageSpanRatio` filter (not left-margin skip) to exclude page-spanning rules
**Decision:** Barline detection excludes columns whose longest continuous vertical run ≥ 0.5 × page height (a "page-spanning rule"), not a fixed left-pixel skip.
**Why:** A fixed left-skip (`bracketMarginRatio 0.12`) clobbered legitimate system brackets at x ≈ 0.07 (barbershop "All Of Me"), wrongly splitting 2-staff systems into singles.
**Trade-off:** The threshold (0.5) must stay well above the tallest real system bracket. Measured: real brackets ≤ 0.31 of page height even on 2-system pages. The 0.5 value is conservative.

### Loop chip selection outline: outward shadow not inset
**Decision:** Active loop chips render the selection outline as an outward box-shadow (`0 0 0 2px white, 0 0 0 3.5px rgba(0,0,0,0.18)`), not inset shadows.
**Why:** Inset shadows were being clipped by the loop lane container's `overflow: hidden` even though the container width matched the waveform. Outward shadows render cleanly outside the box boundary.
**Trade-off:** Outward shadows require the parent container to have `overflow: visible`, which increases the risk of accidental overflow of sibling content. Mitigated by ensuring the lane's inset positioning and zIndex layering contain it.
**Status (2026-06-26):** After test, confirmed chips at far left/right edges now display selection rings cleanly without clipping. Outward shadow is the persistent solution.

---

## Annotation Layer

### In-flow horizontal toolbar vs. fixed vertical sidebar
**Decision:** Annotation toolbar is in-flow (pushes the PDF down) and horizontal (stretching full width), not fixed/overlaid and vertical.
**Why:** Musicians need to see the score while annotating. A floating overlay hides content behind it with no easy workaround. In-flow pushes the viewport down, ensuring all content is reachable. Horizontal layout fits naturally in the component flow above the PDF.
**Trade-off:** The toolbar takes vertical space. Mitigated by keeping it compact (h-11, ~44px) and using popovers for color/width pickers so controls don't expand inline.

### Popover pickers for colors and widths
**Decision:** Color and width options live in popovers (chip+chevron → grid), not inline lists.
**Why:** Reclaims horizontal space in the toolbar. Most users pick a color/width once and draw; the picker is a secondary control. Popovers keep the toolbar visually lightweight.
**Trade-off:** One extra tap to access options. Mitigated by showing the active value in the chip (color dot, squiggly width sample) so the user knows what's current at a glance.

### Warm manila background (#faf3e0) for write mode
**Decision:** Write-mode background is a low-saturation cream (`#faf3e0`), not amber or teal.
**Why:** Visually evokes physical paper or a sketchpad on a table — the strongest "draft / annotation mode" association. Warmer than sage, less saturated than amber; reads as calm and paper-like.
**Trade-off:** Cream is closer to the white PDF page than other colors, so the contrast is subtle. Mitigated by the amber tint still being noticeably warm (not white).

### Cursor icons as exact lucide SVG paths
**Decision:** Cursor SVGs are the exact icon paths from lucide-react (`Pencil`, `Highlighter`, `Eraser`), not bespoke designs.
**Why:** Pixel-perfect consistency with the toolbar icons. The user sees the icon in the button, then that same icon as their cursor — no ambiguity about which tool is active.
**Trade-off:** Lucide stroke-width (2px) is fine at 20–24px sizes (icons) but can look faint at smaller cursor sizes. Mitigated by using the icons at 24px with solid `stroke` and no fill.
