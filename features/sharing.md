# Feature: Sharing

## Purpose

Share a song's loop set (and optionally its annotation layer) with another user — for example, a choral director sending prepared loops to a section, or a coach sending marked-up music to a student. The recipient gets the loops in their own library, ready to practice with.

## User value

- A director or coach can prepare loops for a rehearsal passage once, then distribute them to everyone in the group.
- Students receive a fully configured practice session without having to create loops or find positions manually.
- Encourages a social / collaborative practice workflow on top of the existing solo tool.

## Current implementation

Not yet implemented.

→ See [docs/architecture/persistence.md](../docs/architecture/persistence.md) for the data model that would need to be exported/imported. See `features/cross-device-sync.md` for the auth prerequisite.

## Architecture dependencies

**Depends on:**
- `cross-device-sync` — sharing requires user identity (auth) and a server-side store to host the shared package
- `loop-regions` — the primary shareable artifact is the loop set
- `annotations` — a second layer that could optionally be included in a share
- `library-system` — recipients import shared content into their local library

**Depended on by:**
- Nothing currently.

## Known issues

N/A — not yet built.

## Planned improvements

N/A — this spec is the planning artifact. Requires cross-device-sync (and therefore auth) to land first.

## Acceptance criteria

*(Draft — design intent, not verified behavior)*

- Given a user shares a song's loop set, a shareable link or export package is generated.
- Given a recipient opens the link, the loops are imported into their library and attached to a matching song (by title or PDF hash).
- Given the recipient does not yet have the song, they are prompted to upload their own copy of the PDF and audio.
- Given the sender updates a loop after sharing, the recipient can choose to pull the update or keep their own version.

## Related decisions

No decisions in `DECISIONS.md` are specific to this feature yet.

## Status

Planned — speculative, no implementation started. Blocked on cross-device-sync.
