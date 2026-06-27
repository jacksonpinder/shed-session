# Backlog

_Prioritized work queue. Move items between sections as priorities shift._

---

## Now
_What's actively being worked on or is the immediate next thing._

- (Empty — see Next Actions in PROJECT_STATE.md for the queue.)

---

## Soon
_High-priority, well-defined, can be picked up next._

### Branding / Page Identity

- **Title** — Page title: "Shed Session" on homepage; "[song title] - Shed Session" when a song is open.
- **Song view header** — Back button as its own standalone button (top-left). Remove the song title from the header entirely.

### Home Page / Library

- ~~**PDF indicator**~~ — ✅ Already done.
- **Loop count on track card** — Show loop count next to track number using the loop icon (e.g. `🔁 3`).

### Add Song Modal

- **Track title editing** — Make track title fields editable in the Add Song modal; subtly prompt the user to edit (e.g. placeholder or focus cue).
- **"Shorten" suggestion** — Trigger when: (a) track title begins with the song title, (b) track title contains "full mix", "bass", "baritone", "lead", or "tenor" (strip text before those terms). Re-evaluate after any upload or song-title blur.
- **"Shorten all" option** — When ≥2 tracks have the shorten suggestion available, show a single "Shorten all" action.

### Icon & Button Styling

- ~~**Icon color consistency**~~ — ✅ Already done.
- **Trash icon + hover** — Replace trash icon with lucide `Trash2` (or `Delete` if available). Hover color: a shade of red that fits the design system.
- ~~**Add loop button redesign**~~ — ✅ Done (2026-06-26): pill with text + Plus icon that rotates 45° to × on active.

### Audio Controls

- ~~**Audio button badges**~~ — ✅ Done (2026-06-26): teal pill badges above the AudioLines button when any control is non-default. Hide when panel is open. Speed: `1.25x`; transpose: `+♭3`/`-M2`; balance: `L`/`R`.
- ~~**Audio controls menu polish**~~ — ✅ Done (2026-06-26): labels moved below slider track; section headers now show large prominent value (17px active / 14px muted-default); Mono toggle moved into Balance header row; dividers tightened (my-3→my-2).
- **Audio hover UI** — Improve hover/focus behavior so the popover doesn't close when the mouse moves across the gap to the panel. Use a hover-intent delay or pointer-bridge approach per standard best practices.

### Loop Lane & Rail

- **Loop chip outline clipping** — Chips at the far left/right edge of the waveform have their selection outline cut off. Add `overflow: visible` to the relevant loop lane container(s).
- **Collapsed lane click** — In the collapsed loop lane, clicking on or near a loop chip should only expand the lane, not activate that loop.
- **Scrubber z-index** — Scrubber rail overlays pages but sits beneath the loop bars to its left. Add padding on all four sides of the rail and scrubber track.
- **Rail-to-page padding** — Ensure visible padding between the left rail bars and the adjacent page/scrubber area (or the edge of the screen at narrow widths).
- **Touch target enlargement** — Enlarge tap/click areas for small elements: loop bars in the margin rail, collapse/expand bump, etc.
- ~~**Scrubber rail scroll passthrough**~~ — ✅ Done (2026-06-26): outer rail `pointer-events: none`; bands + viewport window re-enabled selectively.
- **Scrubber viewport width** — The viewport window (teal rectangle) should match the full page width, not wider or narrower.
- ~~**Rail hover chip interaction**~~ — ✅ Done (2026-06-26): chip is now a button; hover uses 80ms leave-delay so cursor can travel band → chip without flicker.
- ~~**Reduce loop lane padding**~~ — ✅ Done (2026-06-26): `LANE_BOTTOM_CLEARANCE` reduced from 12 → 4.

### Navigation / Auto-scroll

- **Waveform scrub → score scroll** — When Navigate/auto-scroll is on, clicking or scrubbing the waveform should scroll the score to the corresponding position.
- **"Navigation suspended" toast** — Rewrite copy (current wording is awkward). Add a donut/spinner indicator. Make it auto-dismiss after a few seconds.

### UI / Interaction (existing)

- **C4** — Remove LoopDetail card. Replace with inline name editing + delete on the loop button. Delete = trash icon → immediate delete + undo toast (already implemented). Drop per-loop repeat/scroll/time/length/location UI. _Waiting on loop lane redesign decision._
- **B6** — After C4: remove legacy `sheetLinkDraft` / `isDraft` / `"Link this loop"` toast. `sheetLink` itself is load-bearing; only the draft trio goes. Also remove `LoopDetail.tsx`.
- **B2** — Match play-progress bar height to the collapsed waveform height. Defer until D-group pill sizing is final.
- **D3 mobile** — Audio settings bottom drawer (speed, transpose, balance, mono) opening from the `AudioLines` button on touch devices. Desktop popover stays. `AudioSlider` already reusable.
- ~~**Dead-code cleanup**~~ — ✅ Done (2026-06-26): removed from `TransportBar`: `speedMenuOpen`/`balanceOpen`/`transposeOpen` state + their click-outside effects; dead button refs; `speedLabel`; unused `Headphones`/`useMemo` imports.

### Content

- **Demo song** — A second bundled song (separate from `public/sample.mp3` + `public/sheetmusic.pdf`) to ship as the "welcome" example alongside the user's real library. Needs PDF + MP3 assets from the user.

---

## Later
_Important but not blocking. Needs more thought or depends on Soon items._

### Score Sync / System Detection

- **System band detection: exclude headers/footers** — Exclude from system detection: page numbers, and text strings near the top or bottom of a page that **begin with** "Words", "Text", "Words and music", "Music", "Arrangement", "Arranged", "Copyright", "Page", or similar credits. These are already excluded from lyrics alignment; apply the same rules to band detection. Mid-system text starting with those words (e.g. a lyric like "Page me when you're there") should still be detected.
- **Loop span bottom edge** — Loop bars in the margin and rail should extend to the BOTTOM of the loop's last system, not the TOP. Includes loops extended to the final system when no aligned lyrics exist in the last several systems.

### PDF Rendering

- **Collapse interior page margins** — Remove most of the blank white space at the top and bottom of interior PDF pages (add a small padding instead). First-page top and last-page bottom remain intact. Audit impact on scroll-position math and loop bar positioning.

### Navigation

- **Desktop zoom gestures** — Pinch-to-zoom and keyboard zoom shortcuts should scale the rendered PDF, not the whole page (transport bar, etc. should remain unscaled).

### Existing Later items

- **Transport auto-collapse** — `useTransportVisibility` with `autoHideEnabled: true`; restore `const transportMode = seekExtensionOpen ? 'collapsed' : autoTransportMode`. Disabled pending UX review.
- **Hold-to-seek radial menu** — `handleSeekPointerDown/Move/Up/Cancel` handlers exist but are commented out of the button JSX. Re-enable when UX is ready.
- **Manual lead-in nudge** — UI slider/control so the user can fine-tune `leadInOffset` for a track. Currently auto-detected via cross-correlation (accurate but not adjustable).
- **Reference-track picker** — Currently the first uploaded track is always the reference (gets Whisper transcription). Add a UI to change which track is the reference.
- **Score sync for repeats / D.C. / strophic** — The monotonic chain keeps one forward pass; repeated sections (verse/chorus reprises, D.C. al Fine) match only one occurrence. Complex but high-value for barbershop repertoire.
- **Scanned PDF support** — Currently gated out via `isScannedPdf()`. OMR (e.g. deskew + binarize + detect staff lines in raster) is out of scope for now. Could offer a "manual link" fallback UI more prominently.
- **Scanned PDF modal** — When the greyed-out auto-scroll button is clicked on a non-syncable score, show a modal explaining why (scanned PDFs don't work) and let the user substitute a different button in its place (any audio option, new loop, or future feature). Persistent per song, only for non-syncable scores.
- **Measure-bar scroll mode** — Instead of continuous follow, allow a "snap to measure" mode that jumps to the start of the current measure on each beat. Simpler and might feel more predictable on metrical music.

---

## Ideas
_Speculative / not yet approved. Needs design + user validation._

### Loop Lane & Representation

- **Horizontal loop bars** — Design idea: replace the current full-width loop chips in the lane with a horizontal bar + chip system (like the margin bars, but horizontal). Each loop would have a small colored bar spanning its duration, with the chip at the start. Reduces visual bulk and matches the margin bar pattern. Requires significant refactor; deprioritize until current loop UX is solid.

### Practice Features

- **Practice statistics** — Loop play count, time spent on each loop, sessions history. The data is all there; just needs a display layer.
- **Loop export** — Export loop timings as JSON, SRT (subtitle), or a simple text file. Useful for sharing "where I got stuck" with a coach.
- **Woodshedding mode** — A focused single-loop view that hides everything except the current loop's score region and the record button.
- **Metronome overlay** — Visual beat flash on the score tied to `beat.beatTimes` from the timing model.

### Score / PDF

- **Panorama view** — Side-by-side or scrollable horizontal layout alternative.
- **Annotations** — Allow the user to mark up the PDF within the app.
- **Chord symbol extraction** — Parse chord symbols from the PDF text layer (they're often separate small-cap tokens near the top of each system).

### Instrument / Part Support

- **Piano mode** — Instrument-specific practice features.
- **Fable / Opus mode** — AI-assisted practice feedback.

### Library / Organization

- **Folders and tags** — Organize songs in the library beyond a flat list.
- **Keyboard shortcuts** — Hotkeys for play/pause, loop navigation, repeat toggle, etc.

### Performance

- **Loading speed** — Smarter asset loading order: chunk by what's first visible, proactive preloading, loading screen with progress.

### Platform

- **Sign-in and cross-device sync** — Persist all songs, loops, and settings across devices. Can be delivered in waves (auth first, then sync).
- **Collaborative annotations** — Share a song's loop set or annotation layer with another user (e.g. coach → student).

### Developer / Infrastructure

- **In-app sidecar management** — Start/stop the WhisperX sidecar from within the UI, show its status, trigger re-sync.
