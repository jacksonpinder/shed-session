# Persistence

Covers: `src/lib/audioStore.ts`, `src/lib/library.ts`, `src/lib/storage.ts`, `src/components/SongView.tsx` (store injection), `src/lib/migrate.ts`

**Related docs:** [app-shell](./app-shell.md) · [audio-engine](./audio-engine.md)

---

## Responsibilities

All durable data (songs, tracks, blobs, settings, loops, anchors, recordings) lives in IndexedDB. A thin KV abstraction (`PracticeStore`) lets `PlayerDock` read and write state without knowing about IndexedDB — `SongView` injects the right implementation at runtime.

---

## Three-layer stack

```
PlayerDock / PDFViewer / AnalysisManager
         │
         ▼
    PracticeStore (interface)         ← src/lib/storage.ts
         │
    SongView injects a custom implementation
         │
         ▼
    library.ts  (typed CRUD)          ← src/lib/library.ts
         │
         ▼
    audioStore.ts  (raw IndexedDB)    ← src/lib/audioStore.ts
```

---

## Raw IndexedDB (`src/lib/audioStore.ts`)

Database name: `'practice-audio'`, version 2.

| Object store | Key | Purpose |
|---|---|---|
| `blobs` (v2) | UUID string | PDFs, MP3s, take recordings |
| `songs` (v2) | `id` string | `Song` records |
| `tracks` (v2) | `id` string, index `bySong` on `songId` | `Track` records |
| `audio-blobs` (v1, legacy) | string | Old recorded takes; kept for migration |

**`tx()` helper:** Generic transaction wrapper — opens DB, runs callback inside a `readwrite` (or `readonly`) transaction, resolves with the result. All operations open a fresh connection and close it on completion. No long-lived connections.

---

## Typed CRUD (`src/lib/library.ts`)

### Core types

```ts
type SongSettings = {
  transpose: number        // ±7 semitones
  speed: number            // playback rate (1 = normal)
  balance: number          // −1 (L) … +1 (R)
  mono: boolean
  scrollOnRepeat: boolean
  lanesVisible: boolean
}

type Song = {
  id: string
  title: string
  createdAt: number        // ms
  updatedAt: number        // ms
  pdfBlobKey?: string
  pdf?: SongPdfMeta        // lyric tokens, page count, scan flag
  systemBands?: Record<number, SystemBand[]>
  trackIds: string[]       // ordered; first = reference track
  selectedTrackId?: string
  referenceTrackId?: string
  loops: SavedLoop[]       // song-time; shared across all tracks
  anchors?: Anchor[]       // song-time sync map
  settings: SongSettings
}

type Track = {
  id: string
  songId: string
  name: string
  audioBlobKey: string
  sourceHash?: string      // SHA-256 of audio; gates re-transcription
  duration?: number
  channelCount?: number
  leadInOffset: number     // song-time = track-time − leadInOffset
  analysis: { status: TrackAnalysisStatus; error?: string }
  transcription?: Transcription
  beat?: BeatAnalysis
  takeMeta?: TakeMeta
}

type TakeMeta = {
  id: string               // blob key
  offsetSec: number
  duration: number
  volume: number
}
```

### Atomic read-merge-write

`updateSong(id, patch)` and `updateTrack(id, patch)` run the entire get → merge → put sequence inside a **single `readwrite` transaction**:

```
tx('readwrite', async (store) => {
  const current = await store.get(id)   // read
  const merged = { ...current, ...patch, updatedAt: now }
  await store.put(merged)               // write
  return merged
})
```

This is the critical invariant. Three concurrent writes can happen to a Song record: PDF analysis (lyrics), track transcription (anchors), and UI edits (loops, settings). IndexedDB serializes concurrent `readwrite` transactions on the same object store, so the last writer always wins on the merged value — no clobber.

### Blob operations

```ts
putBlob(blob: Blob, key?: string): Promise<string>   // store → return UUID key
getBlob(key: string): Promise<Blob | null>
deleteBlob(key: string): Promise<void>
```

### Cascade delete

`deleteSong(id)` deletes the Song record + all its Track records + all associated Blob keys in one atomic transaction. No orphaned blobs.

### Last-opened song

```ts
saveLastSongId(id: string): void     // localStorage
loadLastSongId(): string | null
```

Used by `App.tsx` to offer quick re-open on reload.

---

## KV Abstraction (`src/lib/storage.ts`)

```ts
type PracticeStore = {
  load: <T>(key: string) => T | null
  save: <T>(key: string, value: T | null) => void
}

const localStorageStore: PracticeStore   // default: global localStorage (single-song mode)
```

`loadJson` / `saveJson` are thin wrappers around `JSON.parse` / `JSON.stringify` over `localStorage`.

---

## PracticeStore Injection (SongView)

SongView creates a custom `PracticeStore` object that maps `practice:*` keys to Song/Track fields in IndexedDB. This is injected into PlayerDock via the `store` prop.

**Key mapping:**

| `practice:*` key | Maps to |
|---|---|
| `practice:loops` | `song.loops` (SavedLoop[]) |
| `practice:settings.transpose` | `song.settings.transpose` |
| `practice:settings.speed` | `song.settings.speed` |
| `practice:settings.balance` | `song.settings.balance` |
| `practice:settings.mono` | `song.settings.mono` |
| `practice:settings.scrollOnRepeat` | `song.settings.scrollOnRepeat` |
| `practice:settings.lanesVisible` | `song.settings.lanesVisible` |
| `practice:take` | `track.takeMeta` |
| `practice:repeat-song` | namespaced localStorage |
| `practice:repeat-loop` | namespaced localStorage |
| `practice:autoscroll-song` | namespaced localStorage |
| `practice:autoscroll-loop` | namespaced localStorage |

Keys that fall through to namespaced localStorage (not per-song-in-IndexedDB) are global-ish UI preferences that don't need song isolation.

### Debounced flush

SongView mutates `songRef` synchronously on every loop/settings change, then calls `flushSong()` on a 400ms debounce:

```
user edits loop → songRef.current.loops = newLoops (sync)
                → scheduleFlush()                (debounce 400ms)

background analysis arrives → songRef.current.anchors = newAnchors (sync, via subscription)
                             → scheduleFlush()                       (debounce 400ms)

400ms later: updateSong(id, songRef.current) → atomic read-merge-write
```

Both the UI edit and the background analysis write go through the same debounced flush + atomic `updateSong`. Neither can clobber the other.

---

## Migration (`src/lib/migrate.ts`)

`ensureLibrary()` runs once on app boot. If the library is empty and legacy single-song localStorage state is found, it creates a new Song record importing:
- PDF and MP3 blob keys from the legacy `practice:*` keys
- Loops, anchors, settings from localStorage

Idempotent: a `'practice:migrated'` localStorage flag prevents re-seeding. Does not delete the old keys (non-destructive).

---

## When modifying this system

- **Adding a new `SongSettings` field:** Update `SongSettings` type, `DEFAULT_SETTINGS`, the `updateSong` patch type, SongView's injected store mapping, PlayerDock's hydration `load()` call, and PlayerDock's persistence `save()` call.
- **Adding a new `practice:*` key to PlayerDock:** Map it in SongView's injected store or it falls through to global `localStorage`, breaking multi-song isolation. This failure is silent — the setting appears to work but is shared across all songs.
- **Never hold long-lived IndexedDB connections.** Open via `openDb()` inside `tx()`, let it close on completion. Long-lived connections block `onupgradeneeded` on version change.
- **Never write directly to the `songs` or `tracks` store.** Always go through `updateSong`/`updateTrack`. Direct writes bypass the atomic read-merge-write and can clobber concurrent changes.
- **Blob keys are UUIDs, not content-addressable.** Two uploads of the same file get different keys. `sourceHash` on Track/Song fields is the content hash used for cache gating — it's separate from the blob key.

---

## Common failure modes

- **Setting is shared across all songs:** A `practice:*` key was added to PlayerDock but not mapped in SongView's injected store, so it falls through to `localStorageStore` (global). Fix: add the key to SongView's custom store.
- **Setting is lost on page unload:** The 400ms debounce hasn't fired when the tab is closed. Add a synchronous flush in a `beforeunload` handler if this setting is critical (e.g., loop positions).
- **Background analysis clobbered UI edits:** Something wrote directly to `audioStore.ts` outside of `updateSong`. All mutations must go through `updateSong`/`updateTrack`.
- **`deleteSong` leaves orphaned blobs:** The cascade delete runs in one transaction on `songs` + `tracks` + `blobs` stores. If the transaction aborts mid-way (quota exceeded, browser crash), blobs may be orphaned. A periodic blob-key audit can detect this.
- **DB schema mismatch after version bump:** `onupgradeneeded` in `audioStore.ts` handles migration from v1 to v2 (see lines 17–39). Adding a v3 store requires adding a new migration branch — never re-use version numbers.
