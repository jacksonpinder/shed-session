# App Shell

Covers: `src/App.tsx`, `src/components/Library.tsx`, `src/components/SongView.tsx`, `src/lib/analysisManager.tsx`, `src/lib/migrate.ts`

**Related docs:** [persistence](./persistence.md) · [audio-engine](./audio-engine.md) · [pdf-viewer](./pdf-viewer.md) · [score-sync](./score-sync.md)

---

## Responsibilities

The app shell handles routing, song library management, per-song state coordination, and background analysis orchestration. It is the glue layer that wires together PlayerDock, PDFViewer, and the persistence + analysis subsystems without those subsystems knowing about each other.

---

## Routing

`App.tsx` implements a hash-based router with no library. Two routes:

- `#/` → `Library` (song grid)
- `#/song/:id` → `SongView` (active song editor)

```
songIdFromHash()  // regex: /#\/song\/(.+)/
```

A `hashchange` listener on `window` drives route state. Song IDs are `encodeURIComponent`-encoded in the URL. `AnalysisProvider` wraps the entire tree so background analysis persists across navigation.

---

## AnalysisProvider (`src/lib/analysisManager.tsx`)

`AnalysisProvider` lives above the router and owns the Whisper/sync pipeline. It exposes two context hooks:

- `useAnalysis()` — current `AnalysisState` (per-track and per-PDF status/error)
- `useAddTracks()` — returns an `addTracks(songId, files[])` callback used by Library

Two analysis legs run in parallel per song:

| Leg | Function | Output |
|---|---|---|
| PDF | `analyzePdf(song, blob)` | `LyricToken[]` → `Song.pdf` |
| Track (reference) | `analyzeTrack(track, blob)` | `Transcription` + `BeatAnalysis` → `Track` |
| Track (additional) | `detectLeadIn(track, blob)` | `leadInOffset` → `Track` |

When both PDF lyrics and track transcription are ready, `tryAlign(songId)` runs `alignSyncMap()` and writes `Anchor[]` to `Song.anchors`. Anchor times are converted from track-time to song-time by subtracting the reference track's `leadInOffset`.

**Subscription mechanism:** `subscribeSong(songId, callback)` lets open SongViews receive analysis results without remounting. Returns an unsubscribe function. Called in `SongView` on mount (see below).

---

## Library (`src/components/Library.tsx`)

Displays all songs as a `SongCard` grid. Loads the full song list on mount and whenever a `refreshToken` prop changes (App bumps this token after add/delete).

Key behaviors:
- Multi-track import: hidden `<input type="file">` → `addTracks(songId, files)` → toast
- `TrackManager` modal for per-song track CRUD (inline, not a separate route)

---

## SongView (`src/components/SongView.tsx`)

The central coordinator for an open song. Renders `PDFViewer` + `PlayerDock` side by side, plus a `ContextBar` toolbar above.

### Load sequence

1. `getSong(songId)` + `getBlob(song.pdfBlobKey)` → Object URL
2. `listTracks(songId)` → set active track (restore `song.selectedTrackId` or fall back to first)
3. `saveLastSongId(songId)` for quick re-open on reload
4. Subscribe to background analysis via `subscribeSong(songId, cb)`

### Mutable ref pattern

`songRef` and `trackRef` are `MutableRefObject`s that hold the authoritative, up-to-date snapshots of the song and active track. React state (`song`, `track`) is derived from these refs and used only for rendering. All edits (loop changes, settings toggles) mutate the refs synchronously.

A 400ms debounced `flushSong()` combines all pending mutations into a single atomic `updateSong()` call in IndexedDB. This prevents background analysis results (arriving via the subscription) from losing UI edits made during a typing burst — the subscription patches `songRef` directly and the next flush picks them up.

### Data flow between child components

```
SongView
  ├── PlayerDock  (pushes loop markers UP via onLoopMarkersChange)
  │     └── pdfViewerRef.current.startPlayheadFollow(getAnchor)  [imperative]
  └── PDFViewer   (receives loopMarkers DOWN as props)
        └── onSystemBandsReady callback → bumps timingModelVersion in PlayerDock
```

Loop markers flow **up** from PlayerDock via `onLoopMarkersChange`; SongView passes them **down** to PDFViewer as `loopMarkers`. PDFViewer is never aware of PlayerDock.

### Imperative handle refs pattern

SongView creates empty `MutableRefObject`s and passes them to PlayerDock. PlayerDock fills them with callback functions:

| Ref | Filled by PlayerDock with |
|---|---|
| `markerActivateRef` | `(loopId: string) => void` — activate a loop |
| `createLoopRef` | `() => void` — create a new loop at playhead |
| `deleteLoopRef` | `(id: string) => void` |
| `selectLoopRef` | `(id: string) => void` |
| `exitLoopRef` | `() => void` |
| `onSystemBandsReadyRef` | Filled by SongView itself; called by PDFViewer |

ContextBar calls into PlayerDock via these refs without any prop threading.

### Scroll-padding hack

The PlayerDock pill is `position: fixed` and floats over the PDF scroll area. A `ResizeObserver` watches the pill's rendered height and sets `paddingBottom` on the PDF scroll container so the last page can always be scrolled past the pill's top edge.

### PracticeStore injection

SongView creates a custom `PracticeStore` object that maps `practice:*` keys to Song/Track fields. This is injected into PlayerDock via the `store` prop. PlayerDock has zero knowledge of IndexedDB.

See [persistence.md](./persistence.md) for the full key mapping.

---

## First-run migration (`src/lib/migrate.ts`)

`ensureLibrary()` is called once on app boot. If the IndexedDB library is empty and legacy localStorage state exists, it imports the old single-song assets (PDF blob key, MP3 blob key, loops, anchors, settings) into a new library Song. This is idempotent — a migration flag prevents re-seeding even if the library is later emptied.

---

## When modifying this system

- **Adding a prop between SongView↔PlayerDock:** PlayerDock pushes data up only via `onLoopMarkersChange`. Everything else flows down. Don't add upward callbacks without a clear reason.
- **Adding a new imperative action:** Create a new ref in SongView, pass it to PlayerDock as a prop, have PlayerDock fill `ref.current = myCallback` in a `useEffect`. ContextBar can then call it via the ref.
- **Adding new per-song state:** If it needs to survive navigation (page refresh), it belongs in the Song or Track record in IndexedDB and must be mapped in SongView's injected `PracticeStore`. See [persistence.md](./persistence.md).
- **Analysis pipeline changes:** `tryAlign()` is called independently by the PDF leg and the track leg — whichever finishes second triggers alignment. Both legs must complete before `Song.anchors` is populated.

---

## Common failure modes

- **Auto-scroll silently does nothing after opening a synced song:** `onSystemBandsReadyRef` didn't fire, so `timingModelVersion` was never bumped in PlayerDock, so the timing model was never built. Usually means PDFViewer pages haven't painted yet when `getSystemBands()` was first called.
- **Edits lost after analysis arrives:** A concurrent `updateSong()` from background analysis clobbered a pending loop edit. Root cause is a mutation going directly to IndexedDB instead of through `songRef` + debounced flush. All UI mutations must go through `songRef`.
- **Song loads with stale settings from a previous session:** The injected `PracticeStore` key fell through to global localStorage instead of IndexedDB. A new `practice:*` key was added to PlayerDock but not mapped in SongView's store. See [persistence.md](./persistence.md#common-failure-modes).
- **Analysis never completes:** Whisper sidecar not running or unreachable at `localhost:8123`. Check `VITE_WHISPER_URL` and sidecar health endpoint.
