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
