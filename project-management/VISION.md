# Vision — Shed Session

## What It Is

Shed Session is a music practice tool for singers and musicians who learn from recordings and printed sheet music. The name comes from "shedding" — musician slang for deep solo practice in the woodshed.

## Target User

A choral or barbershop singer who:
- Has a PDF of their part and an MP3 of a reference recording
- Wants to loop difficult passages and drill them slowly
- Wants the score to follow the music automatically so they can look up and sing
- Practices alone, on a laptop or tablet, often with headphones

Secondary: any instrumentalist learning from lead sheets, fake books, or printed arrangements.

## Core Workflow

1. **Open the library** — drop in a PDF and one or more MP3s to create a song
2. **Analysis runs in the background** — Whisper transcribes the audio; lyrics are extracted from the PDF; the two are aligned to produce a time → score anchor map
3. **Play and loop** — create loop regions on the waveform; they auto-link to the right spot in the score
4. **Practice** — the score auto-scrolls to the playing system; the user can transpose, slow down, balance left/right for stereo arrangements, and record their own voice over the loop
5. **Repeat** — all state persists; come back the next day and pick up where you left off

## Design Principles

**Score is primary.** The PDF fills the entire viewport. Controls float over it and collapse when not needed. Nothing competes with the notation.

**Zero setup for the happy path.** Drop a PDF + MP3 and within seconds there are working loops auto-linked to the score. No manual timestamping or calibration required.

**Smart, not magical.** Automation (auto-scroll, auto-link) is always gated. If the sync map isn't ready or the PDF is a scan, the app falls back gracefully to manual linking — nothing breaks.

**Per-song state.** Every loop, setting, take, and sync anchor is stored per-song. Opening a different song is a clean slate; returning to a song is exactly where you left off.

**Works offline.** All storage is local (IndexedDB + localStorage). The sidecar (Whisper) requires a local server on first sync, but once synced the anchor map is cached.

## What It Is Not

- Not a full DAW or multi-track recorder
- Not a sheet music reader / notation editor
- Not a streaming or collaboration service
- Not a mobile-first app (mobile support is a secondary concern; desktop-first)

## Long-term Direction

As the library grows, the app should feel like a personal music learning center — a collection of everything you're working on, each song with its own history of practice takes and loop sets. The sync pipeline should eventually handle scanned PDFs (OMR), repeats, D.C./D.S. navigation, and multi-verse strophic forms.
