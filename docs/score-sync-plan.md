# Score Sync — Implementation Plan

An automatic sync-map generator that takes an MP3 + PDF score and produces a
time→position anchor map that feeds the existing scroll engine. Primary payoff
(P1): **auto-link loops to the score**. Secondary (P2): **auto-scroll on playback**.

## Product goal

A user uploads **any** PDF + MP3 and the sync map is computed on the fly. The
current hardcoded `public/sheetmusic.pdf` + `public/sample.mp3` are only the dev
fixture; the upload UI is a later phase but the architecture targets arbitrary input.

## Approach

Align on **lyrics**, not audio-to-score feature matching:

1. **Audio side:** MP3 → Whisper sidecar → word-level timestamps.
2. **PDF side:** pdfjs `getTextContent()` → lyric syllables + y-positions (client-side).
3. **Alignment:** monotonic fuzzy sequence alignment (NW/DTW) between the two
   syllable/word sequences. Does not need to be note-perfect — a few solid
   anchors per system is enough.
4. **System-top detection:** an **independent** detector maps an anchor's y to
   the top of its enclosing system, so scrolling reveals the whole system.
5. **Output:** `SyncMap` whose anchors are `SheetPosition`-shaped — no engine change.

## Key design decisions

### The scroll-engine contract (verified)
- Canonical unit is `SheetPosition = { page, yWithinPageRatio }` (`src/lib/types.ts`),
  resolution-independent. `scrollToSheetPosition()` already exists and already
  subtracts padding (`SCROLL_PADDING_RATIO = 0.05`). The anchor map emits exactly
  this shape.
- **Gap:** there is no continuous time-driven scroll consumer today. Scrolling
  happens only on loop repeat (`PlayerDock.tsx:910`) and marker click. The
  time→position driver (P2) is net-new. P1 (loop auto-link) reuses the existing
  `sheetLinkDraft` flow (`PlayerDock.tsx:2640`) and needs no driver.

### Font-independent lyric detection (NOT Dorico-specific)
Many engravers (Dorico, MuseScore/Emmentaler, Sibelius, Finale, LilyPond) use
different fonts. Detect lyrics by convention, not font name:
- **Drop music glyphs by Unicode Private Use Area** (SMuFL U+E000–U+F8FF, plus
  legacy PUA fonts). Lyrics are normal alphabetic text.
- **PUA is NOT sufficient on its own.** A second fixture (a Bernstein/barbershop
  arrangement) encodes noteheads as ordinary characters — `œ` (U+0153), `V`, `?`,
  `#` — in a Maestro/Finale-style music font, not the PUA. So also filter by
  **font name** (drop the dominant music font; lyrics use the text font) and by
  position (lyric rows sit just below/above a staff).
- **Cluster remaining text into y-rows**; a lyric row = many short alphabetic
  tokens spread across the page width, often hyphen-joined. Filters title /
  composer / tempo / dynamics without knowing the font.

### System-top is decoupled from lyrics
A lyric's y says where the *words* are, not where the system's top staff line is.
Lyrics can sit **above** the staff (barbershop) or below. So:
- **Lyrics answer which/when** (the time→y anchor).
- **An independent system-band detector answers where to stop.**

`detectSystems(canvas)` (implemented) works **staff-first**: it detects staff
lines by their longest *continuous* dark run (so short, indented final-system
staves count and note-dense rows don't), groups lines into staves (5-line
groups, lone runs like melisma extenders/ties filtered out), then groups staves
into **systems** by **barline connectivity**: within a system a barline spans the
gap between staves (a near-full-height vertical dark run, ≈1.0 of gap height);
between systems nothing crosses (<0.35). This is the *defining* feature of a
system, and it's size-independent, so it's robust where gutter heights vary
widely, where annotation text bridges a gutter, and for any number of staves per
system. A system's top/bottom come from the nearest blank gutter above/below it.

Stress-tested on **twelve** scores — all handled. Eleven vector arrangements detect
perfectly (monster, "Something's Coming", "Little Pal", "Steppin Out", "A Little
Patch of Heaven", "Fly Me to the Moon", "It's a Pity", "very_thought_of_you",
"RedHot", "Ain't Nobody's Business", "this_is_the_moment" — systems/page vary 2–5,
every band the right staves). Robustness details: per-page **Otsu** dark/paper
threshold (PDFs render ink at different darkness; thin lines anti-alias to gray at
large scales); the barline scan checks **every column** (a connecting bracket can be
a 1–2px vertical line); and band top/bottom fall back to the **midpoint between
systems** where a gap has no blank gutter (tightly-engraved scores).

**Scan detection — gate on the PDF TEXT LAYER (authoritative).** Scanned scores
have ~0 text items from pdfjs `getTextContent()`; vector scores have hundreds
(Jeepers/Peg/All-the-Things scans = 0; Brahms = 368, Ya Got Trouble = 250). This
catches every scan, including "cleaned" ones (HP "Digital Sending Device" output,
white background + dark ink, which look vector by pixels). It's also the natural
gate because a no-text score can't feed lyric alignment anyway — so the lyric
extractor's "no text" path IS the scan gate; the pipeline should skip detection /
fall back to manual linking there. Neither the PDF image-count grep (decorative
logos: "It's a Pity" 5 imgs, "very_thought" 6 imgs are vector) nor the pixel
heuristic `isLikelyScanned` (misses cleaned scans) is reliable alone — keep the
pixel check only as a cheap secondary signal. Real OMR-grade scan handling
(deskew/binarize) is out of scope.

Stress test extended to **19 scores** total. New non-barbershop structures all
detect correctly — Brahms Lullaby and Black is the colour / Like Someone In Love
(Puerling) are **4-staff (and 5-staff divisi) systems**, grouped correctly by
barline connectivity (strong validation that the approach isn't barbershop-specific).
Two new HP scans (Jeepers Creepers, Peg O My Heart) detect poorly (wavy scanned
staff lines) but are caught by the zero-text gate. Earlier approaches were
abandoned: a global blank-gutter-height threshold (page margins are outliers) and
per-gap blank-height clustering (a small real gutter on the same page as large
ones gets misclassified — gutter size simply isn't reliable; barline presence is).
Two bugs found and fixed during the stress test: fractional staff y-coords used as
pixel indices (misaligned reads), and using the *tallest* gutter anywhere above a
system instead of the *nearest* one.

**Build, not buy:** prebuilt OMR engines (oemer, Audiveris, Orchestra) are heavy
Python + deep-learning systems that transcribe to MusicXML — overkill for "find
the system top." Classical projection/run-length staff detection is the standard
technique for this sub-problem and runs in-browser on the canvas.

Each anchor is assigned to its system band via `bandForY`; the monotonicity
constraint in alignment (y must increase with time) prunes anchors that snap to
the wrong band — which makes above-staff lyrics safe without special-casing.

## Module list

- `sidecar/` — FastAPI `POST /transcribe`, WhisperX + faster-whisper, hash-cached.
- `src/lib/syncMap.ts` — `Anchor` / `SyncMap` types + `generateSyncMap()` orchestrator.
- `src/lib/detectSystems.ts` — canvas ink-profile system bands (where to stop).
- `src/lib/lyricsExtract.ts` — PUA-filtered, y-row-clustered lyric tokens (which/when).
- `src/lib/transcribe.ts` — fetch client for the sidecar.
- `src/lib/alignSyncMap.ts` — monotonic fuzzy alignment + band assignment + pruning.
- `src/components/PlayerDock.tsx` — loop auto-link wiring (P1).

## Phases, sequencing, and model recommendation

Models: **Opus 4.8** for the two hard algorithms, **Sonnet 4.6** for integration
against a known API/pattern, **Haiku 4.5** for scaffolding. Toggle fast mode for
the visual-tuning loops. Switch with `/model` between phases.

| Phase | Work | Files | Model |
|---|---|---|---|
| 0 | Types/contracts | `syncMap.ts` | **Haiku 4.5** |
| 1 | System-band detector (do first; riskiest) | `detectSystems.ts` + debug overlay | **Opus 4.8** (fast mode) |
| 2 | Lyric extractor | `lyricsExtract.ts` | **Sonnet 4.6** |
| 3 | Whisper sidecar | `sidecar/`, `transcribe.ts` | **Sonnet 4.6** |
| 4 | Alignment | `alignSyncMap.ts` | **Opus 4.8** |
| 5 | Orchestrator | `generateSyncMap.ts` | **Sonnet 4.6** |
| 6 | Loop auto-link (P1 payoff) | `PlayerDock.tsx` | **Sonnet 4.6** (Opus if tangled) |
| 7 | Upload UI + auto-scroll (P2) | new + `PlayerDock.tsx` | **Sonnet 4.6** / **Haiku 4.5** |

**Why these models:** Opus for Phases 1 & 4 — the algorithms that decide whether
the feature works at all (signal processing; constrained sequence alignment).
Sonnet for integration against documented APIs (pdfjs, FastAPI/WhisperX) and the
existing draft-link pattern. Haiku for types and dropzone scaffolding.

**Sequencing:** Phases 1–3 are independent and could parallelize, but **Phase 1
is the riskiest** — if `detectSystems` can't reliably bracket systems on the
fixture, that reshapes the rest before investing in the sidecar. Keep the dev
fixture wired throughout; the upload UI (Phase 7) is the product goal but adds
nothing to validating the pipeline.

## Robustness / graceful degradation

- Arbitrary PDFs may be **scans** (no text layer) or **instrumental** (no lyrics):
  detect low/no extracted text and disable auto-link, keep manual linking.
- **Latin** lyrics (common in choral music): Whisper is uneven, but alignment is
  string-matching two transcriptions, so internal consistency carries it.
- **Repeats / strophic / D.C.**: ambiguous; deferred. Monotonicity salvages most.
- **Latency:** WhisperX on a song is tens of seconds (GPU) to minutes (CPU). Need
  progress UI and a **content-hash cache** so re-opens are instant.
