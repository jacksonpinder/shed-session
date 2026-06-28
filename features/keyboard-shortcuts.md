# Feature: Keyboard Shortcuts

## Purpose

Hotkeys for the most common actions — play/pause, loop navigation, repeat toggle, speed adjustment — so the user can control the app without moving their hands to the mouse or trackpad. Critical for practice workflows where the user is also holding or playing an instrument.

## User value

- Control playback, loop switching, and speed without breaking practice flow.
- Particularly valuable on tablet or when the user's hands are occupied (e.g., playing piano, holding sheet music).
- Faster than navigating the on-screen transport for actions performed repeatedly.

## Current implementation

Not yet implemented. No keyboard event handlers are currently registered for transport control.

→ See [docs/architecture/ui-system.md](../docs/architecture/ui-system.md) for the existing TransportBar and control structure that shortcuts would map to.

## Architecture dependencies

**Depends on:**
- `loop-regions` — "next loop", "previous loop", "activate/deactivate loop" actions
- `audio-controls` — speed up/down increment shortcuts
- `auto-scroll` — Nav toggle shortcut
- `pdf-viewer` — scroll shortcuts (page up/down) should not conflict with PDF scroll behavior

**Depended on by:**
- Nothing directly.

## Known issues

N/A — not yet built.

## Planned improvements

N/A — this spec is the planning artifact. Key mapping design needed.

## Acceptance criteria

*(Draft — design intent, not verified behavior)*

- Given the user presses Space, playback toggles play/pause.
- Given the user presses `[` / `]`, the previous / next loop is selected.
- Given the user presses `R`, the repeat mode cycles between off / loop / song.
- Given a text input is focused, keyboard shortcuts are suppressed so typing works normally.
- Given the user presses `?` or opens a help panel, a shortcut reference is displayed.

## Related decisions

No decisions in `DECISIONS.md` are specific to this feature yet.

## Status

Planned — speculative, no implementation started.
