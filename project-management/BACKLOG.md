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

- **Title** — Page title: "Shed Session" on homepage; "[song title] - Shed Session" when a song is open. → features/library-system.md
- **Song view header** — Back button as its own standalone button (top-left). Remove the song title from the header entirely. → features/library-system.md

### Home Page / Library

- ~~**PDF indicator**~~ — ✅ Already done.
- **Loop count on track card** — Show loop count next to track number using the loop icon (e.g. `🔁 3`). → features/library-system.md

### Add Song Modal

- **Track title editing** — Make track title fields editable in the Add Song modal; subtly prompt the user to edit (e.g. placeholder or focus cue). → features/library-system.md
- **"Shorten" suggestion** — Trigger when: (a) track title begins with the song title, (b) track title contains "full mix", "bass", "baritone", "lead", or "tenor" (strip text before those terms). Re-evaluate after any upload or song-title blur. → features/library-system.md
- **"Shorten all" option** — When ≥2 tracks have the shorten suggestion available, show a single "Shorten all" action. → features/library-system.md

### Icon & Button Styling

- ~~**Icon color consistency**~~ — ✅ Already done.
- **Trash icon + hover** — Replace trash icon with lucide `Trash2` (or `Delete` if available). Hover color: a shade of red that fits the design system. → docs/architecture/ui-system.md
- ~~**Add loop button redesign**~~ — ✅ Done (2026-06-26): pill with text + Plus icon that rotates 45° to × on active.

### Audio Controls

- ~~**Audio button badges**~~ — ✅ Done (2026-06-26): teal pill badges above the AudioLines button when any control is non-default. Hide when panel is open. Speed: `1.25x`; transpose: `+♭3`/`-M2`; balance: `L`/`R`.
- ~~**Audio controls menu polish**~~ — ✅ Done (2026-06-26): labels moved below slider track; section headers now show large prominent value (17px active / 14px muted-default); Mono toggle moved into Balance header row; dividers tightened (my-3→my-2).
- **Audio hover UI** — Improve hover/focus behavior so the popover doesn't close when the mouse moves across the gap to the panel. Use a hover-intent delay or pointer-bridge approach per standard best practices. → features/audio-controls.md

### Loop Lane & Rail

- **Loop chip outline clipping** — Chips at the far left/right edge of the waveform have their selection outline cut off. Add `overflow: visible` to the relevant loop lane container(s). → docs/architecture/ui-system.md
- **Collapsed lane click** — In the collapsed loop lane, clicking on or near a loop chip should only expand the lane, not activate that loop. → docs/architecture/ui-system.md
- **Scrubber z-index** — Scrubber rail overlays pages but sits beneath the loop bars to its left. Add padding on all four sides of the rail and scrubber track. → features/pdf-viewer.md
- **Rail-to-page padding** — Ensure visible padding between the left rail bars and the adjacent page/scrubber area (or the edge of the screen at narrow widths). → features/pdf-viewer.md
- **Touch target enlargement** — Enlarge tap/click areas for small elements: loop bars in the margin rail, collapse/expand bump, etc. → features/pdf-viewer.md
- ~~**Scrubber rail scroll passthrough**~~ — ✅ Done (2026-06-26): outer rail `pointer-events: none`; bands + viewport window re-enabled selectively.
- **Scrubber viewport width** — The viewport window (teal rectangle) should match the full page width, not wider or narrower. → features/pdf-viewer.md
- ~~**Rail hover chip interaction**~~ — ✅ Done (2026-06-26): chip is now a button; hover uses 80ms leave-delay so cursor can travel band → chip without flicker.
- ~~**Reduce loop lane padding**~~ — ✅ Done (2026-06-26): `LANE_BOTTOM_CLEARANCE` reduced from 12 → 4.

### Navigation / Auto-scroll

- **Waveform scrub → score scroll** — When Navigate/auto-scroll is on, clicking or scrubbing the waveform should scroll the score to the corresponding position. → features/auto-scroll.md
- **"Navigation suspended" toast** — Rewrite copy (current wording is awkward). Add a donut/spinner indicator. Make it auto-dismiss after a few seconds. → features/auto-scroll.md

### UI / Interaction (existing)

- **C4** — Remove LoopDetail card. Replace with inline name editing + delete on the loop button. Delete = trash icon → immediate delete + undo toast (already implemented). Drop per-loop repeat/scroll/time/length/location UI. _Waiting on loop lane redesign decision._ → docs/architecture/ui-system.md
- **B6** — After C4: remove legacy `sheetLinkDraft` / `isDraft` / `"Link this loop"` toast. `sheetLink` itself is load-bearing; only the draft trio goes. Also remove `LoopDetail.tsx`. → features/loop-regions.md
- **B2** — Match play-progress bar height to the collapsed waveform height. Defer until D-group pill sizing is final. → docs/architecture/ui-system.md
- **D3 mobile** — Audio settings bottom drawer (speed, transpose, balance, mono) opening from the `AudioLines` button on touch devices. Desktop popover stays. `AudioSlider` already reusable. → features/audio-controls.md
- ~~**Dead-code cleanup**~~ — ✅ Done (2026-06-26): removed from `TransportBar`: `speedMenuOpen`/`balanceOpen`/`transposeOpen` state + their click-outside effects; dead button refs; `speedLabel`; unused `Headphones`/`useMemo` imports.
- **Move track icon**- Because the track selector button is distinct in purpose from audio controls, more transformative to the app experience, I want to place it in the same row as the back button, just to its right. It should also get the floating button style.
- ***floating buttons auto-hide**- the floating buttons (back, track selector) should hide on scroll down, and show again on scroll up. when we implement this, research best practices for this feature (hide on scroll down, show on scroll up. Does stopping scrolling o anything?).

### Content

- **Demo song** — A second bundled song (separate from `public/sample.mp3` + `public/sheetmusic.pdf`) to ship as the "welcome" example alongside the user's real library. Needs PDF + MP3 assets from the user. → features/library-system.md

---

## Later
_Important but not blocking. Needs more thought or depends on Soon items._

### Score Sync / System Detection

- **System band detection: exclude headers/footers** — Exclude from system detection: page numbers, and text strings near the top or bottom of a page that **begin with** "Words", "Text", "Words and music", "Music", "Arrangement", "Arranged", "Copyright", "Page", or similar credits. These are already excluded from lyrics alignment; apply the same rules to band detection. Mid-system text starting with those words (e.g. a lyric like "Page me when you're there") should still be detected. → features/score-sync.md
- **Loop span bottom edge** — Loop bars in the margin and rail should extend to the BOTTOM of the loop's last system, not the TOP. Includes loops extended to the final system when no aligned lyrics exist in the last several systems. → features/score-sync.md

### PDF Rendering

- **Collapse interior page margins** — Remove most of the blank white space at the top and bottom of interior PDF pages (add a small padding instead). First-page top and last-page bottom remain intact. Audit impact on scroll-position math and loop bar positioning. → features/pdf-viewer.md

### Navigation

- **Desktop zoom gestures** — Pinch-to-zoom and keyboard zoom shortcuts should scale the rendered PDF, not the whole page (transport bar, etc. should remain unscaled). → features/pdf-viewer.md

### Existing Later items

- **Transport auto-collapse** — `useTransportVisibility` with `autoHideEnabled: true`; restore `const transportMode = seekExtensionOpen ? 'collapsed' : autoTransportMode`. Disabled pending UX review. → docs/architecture/ui-system.md
- **Hold-to-seek radial menu** — `handleSeekPointerDown/Move/Up/Cancel` handlers exist but are commented out of the button JSX. Re-enable when UX is ready. → docs/architecture/ui-system.md
- **Develop lead-in logic** — Smart detect the `leadInOffset` for a track. Currently started to be auto-detected via cross-correlation, but accuracy hasn't been checked or refined. After testing, we may determine that we'll need to add a manual UI to mark the start point for each track. → features/multi-track.md
- **Smart reference-track picker** — Currently the first uploaded track is always the reference (gets Whisper transcription). Add logic to change which track is the reference. → features/multi-track.md
- **Fancy Whisper** — Add logic to determine when the advanced mode of whisper is needed to run. → features/score-sync.md
- **Scanned PDF support** — Currently gated out via `isScannedPdf()`. OMR (e.g. deskew + binarize + detect staff lines in raster) is out of scope for now. Could offer a "manual link" fallback UI more prominently. → features/score-sync.md
- **Scanned PDF modal** — When the greyed-out auto-scroll button is clicked on a non-syncable score, show a modal explaining why (scanned PDFs don't work) and let the user substitute a different button in its place (any audio option, new loop, or future feature). Persistent per song, only for non-syncable scores. → features/score-sync.md
- **Auto-scroll** — The sheet music scrolls along with the audio automatically. → features/auto-scroll.md
---

## Ideas
_Speculative / not yet approved. Needs design + user validation._

### Loop Lane & Representation

- **Horizontal loop bars** — Design idea: replace the current full-width loop chips in the lane with a horizontal bar + chip system (like the margin bars, but horizontal). Each loop would have a small colored bar spanning its duration, with the chip at the start. Reduces visual bulk and matches the margin bar pattern. Requires significant refactor; deprioritize until current loop UX is solid. → docs/architecture/ui-system.md

### Practice Features

- **Practice statistics** — Loop play count, time spent on each loop, sessions history. The data is all there; just needs a display layer.

### Score / PDF

- **Panorama view** — Scrollable horizontal layout alternative. → features/panorama-view.md
- **Annotations** — Allow the user to mark up the PDF within the app. → features/annotations.md

### Library / Organization

- **Folders and tags** — Organize songs in the library beyond a flat list. → features/library-system.md
- **Keyboard shortcuts** — Hotkeys for play/pause, loop navigation, repeat toggle, etc. → features/keyboard-shortcuts.md

### Performance

- **Loading speed** — Smarter asset loading order: chunk by what's first visible, proactive preloading, loading screen with progress.

### Platform

- **Sign-in and cross-device sync** — Persist all songs, loops, and settings across devices. Can be delivered in waves (auth first, then sync). → features/cross-device-sync.md
- **Collaborative annotations** — Share a song's loop set or annotation layer with another user (e.g. coach → student). → features/sharing.md
