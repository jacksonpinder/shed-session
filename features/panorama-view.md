# Feature: Panorama View

## Purpose

An alternative score layout that displays systems side-by-side or in a horizontal scrolling arrangement, instead of the current single-column vertical stack. Useful for scores where horizontal reading feels more natural (lead sheets, short arrangements) or for wide-screen setups where vertical scrolling wastes space.

## User value

- Read the score in a layout that matches how musicians typically read printed music (left-to-right, line by line).
- Better use of wide-screen desktop monitors.
- Potentially reduces the amount of scrolling needed during auto-scroll follow.

## Current implementation

Not yet implemented.

The current PDF viewer renders all pages in a single vertical scroll container at `fitWidthScale`. A horizontal layout would require a different page-arrangement algorithm and changes to the scroll-position math used by auto-scroll and loop bar positioning.

→ See [docs/architecture/pdf-viewer.md](../docs/architecture/pdf-viewer.md) for the current rendering approach and scroll model.

## Architecture dependencies

**Depends on:**
- `pdf-viewer` — requires a new layout mode in the page-arrangement and scroll model
- `auto-scroll` — `resolveTimedPosition` returns a fractional position; adapting it to horizontal scroll would require a new axis interpretation
- `loop-regions` — margin loop bars (currently vertical, positioned outside the right page edge) would need a redesign for horizontal layout

**Depended on by:**
- Nothing directly.

## Known issues

N/A — not yet built.

## Planned improvements

N/A — this spec is the planning artifact. Design and scoping needed before implementation.

## Acceptance criteria

*(Draft — design intent, not verified behavior)*

- Given panorama view is enabled, PDF pages are arranged horizontally (or in a 2-up / scrollable-row layout) rather than vertically stacked.
- Given auto-scroll is active, the scroll axis switches to horizontal and the playhead follow loop tracks the correct x-position.
- Given a loop exists, its position is indicated in a layout-appropriate way (horizontal bar or equivalent).
- Given the user switches back to vertical layout, the score and all overlays return to the current behavior without data loss.

## Related decisions

No decisions in `DECISIONS.md` are specific to this feature yet.

## Status

Planned — speculative, no implementation started.
