# Feature: Library System

## Purpose

The library system lets the user maintain a collection of songs, each with its own PDF, one or more MP3 tracks, named loops, sync anchor map, audio settings, and practice history. Songs are stored entirely in the browser (IndexedDB for blobs and metadata, localStorage for per-song settings) and persist across sessions with no account required.

## User value

- Organize all practice material in one place — drop in a new PDF and MP3 to add a song, switch between songs without losing any state.
- Return to any song exactly where you left off: same loops, same speed, same transpose, same scroll position.
- Per-song state is isolated — changing settings for one song doesn't affect any other.

## Current implementation

IndexedDB schema v2 (`practice-audio`): `blobs` (file blobs keyed by hash), `songs` (Song metadata), `tracks` (Track metadata + leadInOffset), `audio-blobs` (legacy, kept for migration). CRUD operations in `library.ts`. One-time migration runs on app start via the `practice:migrated` localStorage flag.

Per-song settings (`practice:loops`, `practice:speed`, `practice:transpose`, etc.) are managed via the `PracticeStore` pluggable KV interface injected into `PlayerDock` by `SongView`. This lets `PlayerDock` use the same `practice:*` key names it used in the single-song era while `SongView` maps them to the correct Song/Track fields in IndexedDB.

`App.tsx` is a hash router: `#/` = `Library` (song grid), `#/song/:id` = `SongView`. `AnalysisProvider` (above the router) owns the Whisper/sync pipeline and notifies `SongView` when anchors arrive.

Adding a song: `AddSongModal` accepts a PDF drop + one or more MP3 drops, creates the Song/Track records immediately, then triggers analysis in the background.

→ See [docs/architecture/persistence.md](../docs/architecture/persistence.md) for the full schema and PracticeStore details, and [docs/architecture/app-shell.md](../docs/architecture/app-shell.md) for routing and AnalysisProvider.

## Architecture dependencies

**Depends on:**
- Nothing upstream — the library is the root of all data.

**Depended on by:**
- Every other feature — all data (blobs, loops, anchors, settings, takes) flows through the library store.

## Known issues

- **Demo song** — A second bundled song (distinct from `public/sample.mp3` + `public/sheetmusic.pdf`) is planned as the "welcome" example for new users. Assets not yet available.

## Planned improvements

- **Loop count on library card** — Show the loop count next to the track number on the song card (e.g., a loop icon + `3`).
- **Track title editing** — Make track title fields editable in the Add Song modal; prompt the user to edit (placeholder or focus cue).
- **"Shorten" suggestion** — Auto-suggest shortening a track title when it begins with the song title or contains common voice-part suffixes ("full mix", "bass", "baritone", "tenor"). "Shorten all" when ≥2 tracks qualify.
- **Demo song** — Bundle a second PDF + MP3 as the welcome example. Separate from the dev fixture.
- **Folders and tags (Later)** — Organize songs beyond a flat list. → features/library-system.md

## Acceptance criteria

- Given a PDF and MP3 are dropped into the Add Song modal, a new song card appears in the library and analysis begins.
- Given a song card is clicked, `SongView` loads with the correct PDF, tracks, loops, and settings for that song.
- Given settings are changed in SongView (e.g., speed), navigating back to the library and returning to the song restores those settings.
- Given the page is reloaded, all songs, loops, and settings are restored from IndexedDB/localStorage.
- Given a song is deleted, its blobs are removed from IndexedDB and the card disappears from the library.
- Given a one-time migration has not yet run (legacy single-song data present), it runs once on app start and creates a Song record from the existing localStorage keys.

## Related decisions

- **Pluggable KV store (`PracticeStore`) instead of rewriting PlayerDock** — PlayerDock is the heaviest file; a full rewrite would risk regressions. The injection approach lets it keep existing `practice:*` key names while SongView maps them to the correct IndexedDB fields.

## Status

Stable — core CRUD, routing, and migration all complete.
