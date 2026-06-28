# Feature: Annotations

## Purpose

Let the user mark up the PDF within the app — highlight passages, add text notes, draw breath marks or dynamic reminders directly on the score. Annotations are stored per-song and displayed as an overlay on top of the PDF render.

## User value

- Mark up the score the way you would with a pencil on paper — without printing.
- Annotations persist per-song so they're available the next time you open the song.
- Share a marked-up score with a coach or fellow singer (when sharing is available).

## Current implementation

Not yet implemented.

The PDF viewer renders via `react-pdf` to a canvas per page. Annotations would likely be stored as a separate data layer (SVG overlay or JSON annotation model) on top of the canvas, not embedded in the PDF itself.

→ See [docs/architecture/pdf-viewer.md](../docs/architecture/pdf-viewer.md) for the current page rendering model.

## Architecture dependencies

**Depends on:**
- `pdf-viewer` — annotations render as an overlay on the PDF canvas
- `library-system` — annotation data stored per-song in IndexedDB

**Depended on by:**
- `sharing` — a shared song could include the annotation layer

## Known issues

N/A — not yet built.

## Planned improvements

N/A — this spec is the planning artifact.

- **Chord symbol extraction** — Parse chord symbols from the PDF text layer as a related feature (separate from freehand annotations).

## Acceptance criteria

*(Draft — design intent, not verified behavior)*

- Given the user enters annotation mode, they can draw, highlight, or add text to any position on the score.
- Given an annotation is created, it appears on the correct page and position when the song is reopened.
- Given the PDF is re-rendered at a different zoom level, annotations scale correctly with the page.
- Given the user deletes an annotation, it is removed and the deletion persists.

## Related decisions

No decisions in `DECISIONS.md` are specific to this feature yet.

## Status

Planned — speculative, no implementation started.
