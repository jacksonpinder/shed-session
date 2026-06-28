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

- **Title** — Page title: Waveform Studio flashed, then "Shed Session" displays; same thing with the song page.. Instead, the correct title should appear first.

### Home Page / Library


### Add Song Modal

- **Track title editing** — Make track title fields editable in the Add Song modal; subtly prompt the user to edit (e.g. placeholder, focus cue, or toast/message). → features/library-system.md
- **"Shorten" suggestion** — Trigger when: (a) track title begins with the song title, (b) track title contains "full mix", "bass", "baritone", "lead", or "tenor" (strip text before those terms and Sentence case the remaining text). Re-evaluate after any upload or song-title blur. → features/library-system.md
- **"Shorten all" option** — When ≥2 tracks have the shorten suggestion available, show a single "Shorten all" action. → features/library-system.md

### Icon & Button Styling

- **Trash icon + hover** — Replace trash icon with lucide `Trash2` (or `Delete` if available). Hover color: a shade of red that fits the design system. → docs/architecture/ui-system.md

### Audio Controls

- ~~**Remove Audio button badges**~~ — Remove badges below the AudioLines button when any control is non-default.
- **Audio hover UI** — Improve hover/focus behavior so the popover doesn't close when the mouse moves across the gap to the panel. Use a hover-intent delay or pointer-bridge approach per standard best practices. → features/audio-controls.md

### Loop Lane & Rail

- **Loop chip outline clipping** — Chips at the far left/right edge of the waveform have their selection outline cut off. Add `overflow: visible` to the relevant loop lane container(s). → docs/architecture/ui-system.md
- **Scrubber placement and padding** — Scrubber left edge is even with the left edge of the pages. Right edge is against the edge of the page. Both sides shuold be even with the edges of the pages. → features/pdf-viewer.md
- **Touch target enlargement** — Enlarge tap/click areas for small elements: loop bars in the margins, rails, and loop lanes, etc. → features/pdf-viewer.md
- ~~**Rail hover chip interaction**~~ — Chip should be a button; hover uses 80ms leave-delay so cursor can travel band → chip without flicker.

### Navigation / Auto-scroll

- **Waveform scrub → score scroll** — When Navigate/auto-scroll is on, clicking or scrubbing the waveform should scroll the score to the corresponding position. → features/auto-scroll.md
- **"Navigation suspended" toast** — Rewrite copy (current wording is awkward). Add a donut/spinner indicator. Make it auto-dismiss after a few seconds. → features/auto-scroll.md

### UI / Interaction (existing)

- **Add inline Loop renaming** - immediate rename (everywhere) on blur
- **Remove legacy `sheetLinkDraft` / `isDraft` / `"Link this loop"` toast. `sheetLink` itself is load-bearing; only the draft trio goes. Also remove `LoopDetail.tsx`. → features/loop-regions.md
- **D3 mobile** — Audio settings bottom drawer (speed, transpose, balance, mono) opening from the `AudioLines` button on touch devices. Desktop popover stays. `AudioSlider` already reusable. → features/audio-controls.md
- **Move track icon**- Because the track selector button is distinct in purpose from audio controls, more transformative to the app experience, I want to place it in the same row as the back button, just to its right. It should also get the floating button style.
- ***floating buttons auto-hide**- the floating buttons (back, track selector) should hide on scroll down, and show again on scroll up. when we implement this, research best practices for this feature (hide on scroll down, show on scroll up. Does stopping scrolling o anything?).
- **Audio settings refinement** - When the non-default value is displayed, the value display text grows bigger. When this happens, the window size/position shifts, like it only had room for the smaller text size, and the larger size is a surprise it has to make room for. it looks unprofessional. 
- **Make speed UI and functionality consistent with transpose** - Make the Balance slider and UI operate like the Transpose one: As the user drags, the current position of the slider is displayed under the center of the slider, but not implemented in the audio or displayed on the right. when the user releases, the Reset button appears, the audio is affected, and the currently selected setting is displayed in the new styling on the right.
- ** Make Balance UI more consistent with other audio settings** - Move the Mono toggle below the "Reset" row. Add another toggle: Reverse L/R. This only appears when the track is stereo, and the Mono toggle is off. In the "Balance" row, on the right side, we want the currently selected setting, like the other two audio settings. Difference: The balance audio AND currently selected setting (the larger text on the right) can update in real time, before click/tap release. Use a UI/Design skill to design LR→ or ←LR text that simply and visually reflects the current setting. (Middle is plan LR. 10% left is ←LR, 30% left is longer arrow, smaller R, and so on. the animation/transition should be smooth and professional looking.
- *Loop lane redesign for consistency and less vertical space** - The loop lane chips should be styled and displayed similar to those in the rail area, but displayed horizontally instead. 4px tall, with a chip below. A row 1 chip may overlap a row 2 bar, but chips shouldn't overlap. Both chips and bars act as buttons to select/deselect loops. Delete button is on the chip. Double-click or -tap to edit the loop name. (Idea: a loop long enough to fit this text is called "Double-[click or tap] to rename".) Padding between waveform and loop bars is minimal. padding between bottom of loop chips and bottom edge of the transport pill is minimal.

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

- **Zoom gestures** — Pinch-to-zoom, keyboard zoom shortcuts, and other zoom methods should scale the rendered PDF, not the whole page (transport bar, etc. should remain unscaled). → features/pdf-viewer.md

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
- ~~**Annotations**~~ ✅ Completed 2026-06-28 — Pen, highlighter, eraser tools; undo/redo; per-song persistence in IndexedDB. Merged to main.

### Library / Organization

- **Folders and tags** — Organize songs in the library beyond a flat list. → features/library-system.md
- **Keyboard shortcuts** — Hotkeys for play/pause, loop navigation, repeat toggle, etc. → features/keyboard-shortcuts.md

### Performance

- **Loading speed** — Smarter asset loading order: chunk by what's first visible, proactive preloading, loading screen with progress.

### Platform

- **Sign-in and cross-device sync** — Persist all songs, loops, and settings across devices. Can be delivered in waves (auth first, then sync). → features/cross-device-sync.md
- **Collaborative annotations** — Share a song's loop set or annotation layer with another user (e.g. coach → student). → features/sharing.md
