# Worklog

_Chronological development journal. Add an entry at the end of each working session._

---

## Entry format

```
## YYYY-MM-DD — [session title]

**What was done:**
- …

**Decisions made:**
- …

**What's next:**
- …

**Handoff state:**
[What the code is in right now — can the app load? Are there known breakages?]
```

---

## 2026-06-25 — Baseline: project-management files created

**What was done:**
- Created `/project-management/` with VISION.md, PROJECT_STATE.md, BACKLOG.md, DECISIONS.md, WORKLOG.md
- Updated CLAUDE.md with complete app description, corrected outdated sections (test suite, sheet markers, static assets), added project-management workflow instructions

**App state at this baseline:**
The app is in a working state. Key features all landed and verified:
- Multi-song library (IndexedDB, hash routing, per-song store injection)
- Score sync pipeline: `detectSystems` → `lyricsExtract` → `transcribe` (sidecar) → `alignSyncMap` → `generateSyncMap`
- Timing model with tempo-aware gap traversal, beat tracker integration, monotonic ratchet scroll
- Continuous playhead follow: `startPlayheadFollow` rAF loop in PDFViewer, `scrollMotion.ts` pure helpers
- Edge scrubber rail + margin loop bars (refinement pass 3)
- Loop lane strip with blurred-peek collapse + connector bracket
- Group D transport (AudioLines panel, C2 add/exit loop button, C3 repeat, D4 nav)
- Library card actions: rename, duplicate, add/manage tracks, delete
- Lead-in offset: cross-correlation for non-reference tracks; 3-seam conversion in PlayerDock

**Known non-verified:**
- Auto-scroll under live playback (blocked by autoplay gesture in preview; needs real browser + sidecar click)
- Transpose audio quality improvement (Lanczos + quickSeek:false — not audibly confirmed)

**What's next:**
- C4: inline loop rename + trash-with-undo (remove LoopDetail card)

---

## 2026-06-26 — Batch B styling + feature capture

**What was done:**
- **Loop chip outline** — Reverted inset shadow (which caused clipping) back to outward shadow (0 0 0 2px / 3.5px). Selection ring now renders cleanly without container clipping.
- **Rail & scrubber padding** — Increased `BAND_GUTTER_PAD` (3→5) and `CARD_INSET_X` (3→5) for more visual breathing room. Scrubber now starts at `bandGutterW + BAND_GUTTER_PAP` (flush with page cards, not overlapping bands).
- **Add loop button** — Restyled from text+icon pill to icon-only h-8 w-8 circle, matching `controlButtonBase`. Active state uses `toggleActiveClass` (teal fill); inactive = standard. Uses ∞ icon for Add, X for Exit. Removed text labels (kept via `title` attribute).
- **TrackSelector** — Changed from grey pill (`bg-[#e7e9ec]`) to frosted-glass dock style (`border-[#4F7F7A]/55 bg-black/5 backdrop-blur-sm`) matching the other transport buttons.
- **Feature capture** — Processed 6 new user requests into backlog:
  - **Soon**: Scrubber rail scroll passthrough, scrubber viewport width match, rail hover chip interaction, reduce loop lane padding, add loop button redesign (to pill with +/X animation)
  - **Ideas**: Horizontal loop bars (alternative loop lane design)

**Decisions made:**
- Loop chip outline: outward shadow instead of inset (better rendering, matches existing visual pattern)
- Add loop button: kept as icon-only (not reverted to pill — user will revisit in next iteration based on new feature capture)
- Removed loop chip height resize (kept at 20px, 8px gap) after user feedback; only kept outline fix

**What's next:**
- Implement the "Add loop button redesign" from the new feature capture (pill with text, + → X rotation animation)
- Implement scrubber rail scroll passthrough (quick pointer-events fix)
- Batch C: audio button badges + popover polish (hover intent, audio slider label positioning)

**Handoff state:**
✅ App loads and renders correctly. All changes are visual/styling only.
✅ No breaking changes; all button functionality intact.
⚠️ Batch B visual changes may need refinement (user is iterating on design). Ready for next round of feedback.
- B6: remove legacy sheetLinkDraft / isDraft
- D3 mobile: audio settings bottom drawer

---

## 2026-06-26 — Tier 1 & 2 polish: scroll passthrough, loop lane, rail chip, add-loop pill, dead-code

**What was done:**
- **Scrubber rail scroll passthrough** — Outer `EdgeScrubberRail` container set to `pointer-events: none`. Band divs + viewport window re-enable `pointer-events: auto` selectively. Removed unused `onTrackPointerDown` handler (click-to-scroll-to-rail-position was the only casualty).
- **Reduce loop lane padding** — `LANE_BOTTOM_CLEARANCE` reduced 12 → 4 in `LoopLaneStrip.tsx`. The "Loops" pill it was guarding no longer exists.
- **Rail hover chip fix** — Chip is now a `<button>` (was `<div pointer-events-none>`). Added `startHover`/`endHover` callbacks with an 80ms leave-delay so the cursor can travel from band to chip without flickering. Chip calls `onSelectLoop` on click.
- **Add loop button redesign** — Changed from icon-only `h-8 w-8` circle to pill (`h-8 px-3 gap-1.5`). Text: "Add loop" / "Exit loop". Icon: `Plus` rotates 45° (via `transition-transform`) when a loop is active instead of swapping to `XIcon`. Removed `InfinityIcon` import.
- **Dead-code cleanup in TransportBar** — Removed: `speedMenuOpen`/`balanceOpen`/`transposeOpen` state; three associated click-outside `useEffect` hooks; `speedButtonRef`/`headphonesRef`/`transposeButtonRef`/three `*PopoverRef` refs; `speedLabel` memoized value; unused `Headphones` + `useMemo` imports.

**Decisions made:**
- `Plus` rotate-45° → × pattern (not two separate icons with crossfade) — simpler, smooth, well-established UX pattern.
- Rail click-to-scroll-to-position removed alongside pointer passthrough; bands + scrubber are the interactive targets, not the background.

**What's next:**
- C4 & B6 on hold pending loop lane redesign thinking
- Batch C: audio button badges; audio controls label polish; hover-intent for the audio panel
- Remaining loop lane: collapsed-lane-click guard, touch target enlargement

**Handoff state:**
✅ App loads and renders correctly. All changes are styling/dead-code only; no logic regressions.
✅ Typecheck clean (no new errors vs pre-existing baseline).

---

## 2026-06-26 — Batch C: audio controls redesign

**What was done:**
- **AudioSlider label row below track** — Label row (`mt-1`) now renders after the slider track instead of above it (`mb-1.5`). Endpoint labels become `text-[10px] font-medium` (no uppercase, less weight — they're now anchors, not headers). Reset chip stays centered in same row.
- **Panel section headers** — Each section now has a small-caps label (`text-[10px] uppercase tracking-widest`) paired with a large right-anchored value. Value is 17px / `text-[#0b1220]` when non-default, 14px / `text-slate-400` when at default. Transitions via `transition-[color,font-size] duration-150`. Transpose shows "Original" when at 0.
- **Balance + Mono merged into one header row** — Mono toggle moved from its own sub-row into the Balance section header. Toggle resized (h-5 w-9 → h-4 w-7, thumb h-4→h-3). Balance value indicator (`← L` / `R →`) appears at 13px when non-default.
- **Divider tightening** — Panel section dividers `my-3` → `my-2`.
- **Audio button badges** — Teal pill badges render above the AudioLines button when panel is closed and any control is non-default. `fmtTransposeBadge()` produces text like `+♭3`, `-M2`, `+P5`. Badges conditionally rendered: speed / transpose / balance each independent.

**Decisions made:**
- Badge uses text-only interval notation (not ReactNode from `renderTransposeLabel`) — simpler, works in a tiny pill, avoids inline-flex SVG icon at 10px.
- Muted value at default vs hidden — shows the value at lower visual weight rather than hiding it, so the user can confirm "I'm at 1.0x" without opening the panel.
- `pointer-events-none` on badge row so it never intercepts clicks intended for the button.

**What's next:**
- Audio hover intent (panel doesn't close when mouse travels to it)
- C4 / B6 (deferred pending loop lane redesign decision)
- Loop lane: collapsed-lane-click guard, touch targets

**Handoff state:**
✅ App loads and renders correctly. All changes verified in browser — badges, label positions, section headers, Mono toggle all correct.
✅ Typecheck clean (no new errors vs pre-existing baseline).

---

## 2026-06-28 — Annotation feature: UI refinement & merge

**What was done:**
- **UI refinement per user feedback:**
  - Horizontal in-flow toolbar (pushes PDF down) instead of fixed vertical sidebar
  - Compact color + width pickers: chip+chevron → popover panel with grid of options
  - Width preview lines are S-curves with round caps (look like real brushstrokes, not flat bars)
  - Canvas rendering bug fixed: cancel pending rAF before scheduling in annotations effect so new strokes always paint
  - Pencil toggle: 42×42 (enlarged), desktop aligns under zoom cluster (`right-[80px]`), mobile at `top-2`; `isMobile` is now reactive
  - Eraser disables both color and width pickers (greyed out, same as width-only was before)
  - Removed Clear all / Trash button entirely
  - Write-mode background: warm manila `#faf3e0` (low-saturation cream, reads as "paper on table")
  - Dropped backdrop-blur (was causing headless screenshot timeout; unnecessary anyway since toolbar is in-flow)
- **Toolbar stacking context fix:** Lifted entire toolbar with `relative z-40` so popovers paint above the PDF/canvas/ContextBar
- **Cursor icons:** Exact lucide `Pencil`, `Highlighter`, `Eraser` paths as SVG data-URIs (not generic or separate designs)
- **All toolbar items centered** via `justify-center` (no spacer)
- **Committed changes** to `feature/annotations`, pushed to origin
- **PR created and merged** to main via GitHub web form

**Decisions made:**
- Horizontal toolbar over vertical: better UX when it occludes content (can still reach occluded area via scroll)
- Warm manila over other tints (soft teal, sage, amber): strongest "paper/draft mode" association per visual brainstorm
- Popover pickers over inline lists: reclaims vertical space in compact scenarios, cleaner toolbar appearance
- Cursor icons exact to toolbar icons: pixel-perfect consistency, user knows what each cursor does

**What's next:**
- C4 & B6 remain (loop rename + LoopDetail removal, legacy sheetLinkDraft cleanup)
- D3 mobile: audio settings bottom sheet
- Feature-capture iteration on loop lane, audio controls polish

**Handoff state:**
✅ App loads and renders correctly. Annotation feature is live and merged to main.
✅ All 8 test suites pass; production build succeeds.
✅ Feature verified in-browser: draw/erase, gestures, persistence, dropdowns, mobile/desktop toggle placement.
⚠️ Two-finger gesture detection on touch works; `endPointer` has belt-and-suspenders reset to catch edge cases.
ℹ️ Highlight strokes use `source-over` at 0.35 alpha (not multiply, which blacks-out on transparent canvas).

---

## [Previous sessions — reconstructed from memory]

### 2026-06 (multi-session) — Score Sync pipeline (Phases 1–7)

Built the complete score sync pipeline from scratch:
- Phase 1: `detectSystems` (staff-first barline connectivity, system bands)
- Phase 2: `lyricsExtract` (font-independent, digit/colon/multi-word filters, corpus-wide tested)
- Phases 3–5: `alignSyncMap` (many-to-one DP + monotonic chain), `generateSyncMap` orchestrator, sidecar scaffolding
- Phase 6: loop auto-link wired in PlayerDock (uses anchors when available, falls back to getSheetPosition)
- Phase 7: auto-scroll via `startPlayheadFollow` rAF loop + `scrollMotion.ts` pure helpers
- Iterative fixes: monotonic ratchet (jitter), linear glide (speed rush), resize sync, tempo-aware gap traversal (stall-then-lurch), per-staff barline scan (barbershop measures), `pageSpanRatio` filter (page-spanning rules), staff over-extension trim
- Beat tracker: librosa onset + beat_track in sidecar; `pulseClarity`/`clarityWindows` feed `tempoStability` blend
- Scan gate: `isScannedPdf()` image+path-count heuristic

### 2026-06 (multi-session) — Library refactor (Phases 1–6)

Converted single-song app to multi-song library:
- Phase 1: `audioStore.ts` v2 (songs/tracks stores)
- Phase 2: `library.ts` Song/Track CRUD, `tests/library.test.ts` with fake-indexeddb
- Phase 3: `PracticeStore` pluggable KV, hash router in App.tsx, SongView.tsx, Library.tsx
- Phase 4: `analysisManager.tsx` (AnalysisProvider), `AddSongModal.tsx` (drop, analyze, create-immediately)
- Phase 5: TrackSelector, SongCard actions (rename, duplicate, delete), TrackManager modal
- Phase 6: one-time migration via `practice:migrated` flag; lead-in offset via cross-correlation

### 2026-06 — UI overhaul (Groups A–E)

- A1–A5: Loop button descenders, flat glyph, waveform veil, handle overflow, PDF page-gap divider
- B1: Collapse toggle on container bottom edge
- B3: Transpose extended to ±7 (perfect fifth)
- B4: Track selector moved under back/title
- B5: PDF scroll paddingBottom stops at play-pill top
- C1: Paused + loop-select scrolls PDF without playing
- C2: Add/Exit loop button outside pill, 3-zone grid TransportBar
- C3: Repeat button (repeatSong + repeatLoop)
- C5: Library cards show PDF page-1 thumbnails
- D2: Connector bracket in LoopLaneStrip
- D3: AudioLines button + stacked panel (replaces 3 in-pill buttons)
- D4: Nav button (auto-scroll with sync-gating + why-hint)
- E1/E2 + LG: Edge scrubber rail, margin loop bars, blurred-peek collapse
- Refinement passes 1–3: rail sizing, bar continuity, chip z-order, pointer-events fix, scrubber reachability
