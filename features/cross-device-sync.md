# Feature: Cross-device Sync

## Purpose

Sign in with an account and have all songs, loops, settings, and sync anchors available on any device. Currently all data is local-only (IndexedDB + localStorage). Cross-device sync would make the app usable across a home computer and a tablet, or recoverable after a browser data clear.

## User value

- Start a practice session on a laptop and continue on a tablet without losing loops or settings.
- Recover from a browser data clear or new device setup without re-uploading everything.
- Eventually enables sharing and collaboration (shared loop sets, coach notes) when layered on top of the auth system.

## Current implementation

Not yet implemented. All persistence is local: IndexedDB for blobs and song/track metadata, localStorage for per-song settings.

→ See [docs/architecture/persistence.md](../docs/architecture/persistence.md) for the full local storage model that would need to be synced.

## Architecture dependencies

**Depends on:**
- `library-system` — the local IndexedDB schema would become the source of truth with sync layered on top
- All features indirectly — any feature that persists state would benefit from sync

**Depended on by:**
- `sharing` — a sharing layer requires user identity, which auth provides

## Known issues

N/A — not yet built.

## Planned improvements

N/A — this spec is the planning artifact. Could be delivered in waves: auth first, then incremental sync (settings → loops → anchors → blobs).

## Acceptance criteria

*(Draft — design intent, not verified behavior)*

- Given a user signs in, their library (songs, tracks, loops, settings) is accessible on any signed-in device.
- Given a new loop is created on device A, it appears on device B after sync.
- Given a user is offline, the app continues to work fully from the local cache; sync resumes on reconnect.
- Given the user signs out, local data is retained but sync is paused.

## Related decisions

No decisions in `DECISIONS.md` are specific to this feature yet.

## Status

Planned — speculative, no implementation started. Auth is a prerequisite.
