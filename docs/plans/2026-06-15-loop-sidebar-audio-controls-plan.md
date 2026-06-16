# Loop Sidebar & Audio Controls — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the transport-bar loop dropdown with a persistent left sidebar of loop chips, and add Balance L/R, Stereo/Mono, and Transpose audio controls.

**Architecture:** New `LoopSidebar` component sits in a two-column layout (sidebar + PDF) inside `App`. Audio engine changes live in `PlayerDock` (new nodes inserted into the existing Web Audio chain). All new UI is presentational props-down — `PlayerDock` owns all state as it does today.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, WaveSurfer.js, Web Audio API, `@soundtouchjs/audio-worklet`

**Design reference:** `docs/plans/2026-06-15-loop-sidebar-and-audio-controls-design.md`

---

## Phase 1 — App Layout Restructuring

### Task 1: Two-column layout in App.tsx

The PDF viewer must share horizontal space with the new sidebar on desktop. On mobile the sidebar overlays, so the PDF stays full-width.

**Files:**
- Modify: `src/App.tsx`

**Step 1: Replace the `<main>` wrapper**

Current `<main>` is `flex min-h-0 flex-1 overflow-hidden`. Change it to hold two columns:

```tsx
<main className="flex min-h-0 flex-1 overflow-hidden">
  {/* LoopSidebar goes here — Task 3 */}
  <PDFViewer
    ref={pdfViewerRef}
    scrollContainerRef={scrollContainerRef}
    sheetMarkers={loopMarkers}
    onMarkerClick={handleMarkerClick}
    onPageChange={handlePageChange}
    onZoomStateChange={handleZoomStateChange}
  />
</main>
```

The PDF viewer already fills available width via `flex-1` — adding the sidebar as a fixed-width sibling is all that's needed. No PDF viewer changes required yet.

**Step 2: Add placeholder sidebar div to verify layout**

Temporarily add:
```tsx
<div className="hidden lg:flex w-[220px] shrink-0 border-r border-slate-200 bg-white" />
```
before `<PDFViewer>`. Run `npm run dev` and confirm the PDF shifts right on desktop, full-width on mobile.

**Step 3: Remove placeholder once Task 3 is done**

---

## Phase 2 — LoopSidebar Component (Shell)

### Task 2: Define shared loop types

The sidebar needs loop data that currently lives inside `PlayerDock`. Extract the type so it can be shared.

**Files:**
- Create: `src/lib/types.ts`

```ts
export type SheetPosition = {
  page: number
  yWithinPagePx?: number
  yWithinPageRatio?: number
}

export type SavedLoop = {
  id: string
  name: string
  start: number
  end: number
  color: string
  loopOn: boolean
  sheetLink?: SheetPosition & { scrollTop?: number }
  sheetLinkDraft?: SheetPosition   // auto-captured on creation, unconfirmed
}
```

Then in `PlayerDock.tsx`, import `SavedLoop` from `../lib/types` and remove the local definition. In `PDFViewer.tsx`, `SheetPosition` is already defined locally — leave it (the two are slightly different shapes and used independently).

**Step 1: Create `src/lib/types.ts` with the content above**

**Step 2: In `PlayerDock.tsx`, replace the local `SavedLoop` type with the import**

Search for `type SavedLoop = {` and replace with `import type { SavedLoop } from '../lib/types'`. Verify `npm run build` passes with no type errors.

---

### Task 3: LoopSidebar shell — desktop always-open, mobile drawer

**Files:**
- Create: `src/components/LoopSidebar.tsx`
- Modify: `src/App.tsx`

**Step 1: Create the shell component**

```tsx
// src/components/LoopSidebar.tsx
import { useState } from 'react'
import { Repeat } from 'lucide-react'
import type { SavedLoop } from '../lib/types'

type LoopSidebarProps = {
  loops: SavedLoop[]
  activeLoopId: string | null
}

export default function LoopSidebar({ loops, activeLoopId }: LoopSidebarProps) {
  const [drawerOpen, setDrawerOpen] = useState(false)

  const panel = (
    <div className="flex h-full w-[220px] shrink-0 flex-col border-r border-slate-200 bg-white">
      {/* Content — Tasks 4–8 fill this */}
      <div className="flex-1 overflow-y-auto p-2">
        <p className="text-xs text-slate-400">Loops go here</p>
      </div>
    </div>
  )

  return (
    <>
      {/* Desktop: always visible, pushes content */}
      <div className="hidden lg:flex h-full">
        {panel}
      </div>

      {/* Mobile: tab + overlay drawer */}
      <div className="lg:hidden">
        {/* Tab on left edge */}
        <button
          className="fixed left-0 top-1/2 z-[300] flex h-14 w-7 -translate-y-1/2 items-center justify-center rounded-r-lg bg-white border border-l-0 border-slate-200 shadow-md"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open loops"
          type="button"
        >
          <Repeat size={14} className="text-slate-500" />
        </button>

        {/* Backdrop */}
        {drawerOpen && (
          <div
            className="fixed inset-0 z-[310] bg-black/20"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* Drawer */}
        <div
          className={`fixed inset-y-0 left-0 z-[320] flex w-[75vw] max-w-[320px] transform flex-col bg-white shadow-xl transition-transform duration-300 ease-in-out ${
            drawerOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          {panel}
        </div>
      </div>
    </>
  )
}
```

**Step 2: Wire into App.tsx**

Add state and pass it down. `App` already has `loopMarkers` (the `SheetMarker[]` shape from PDFViewer). The sidebar needs the richer `SavedLoop[]` — this means `PlayerDock` must also push `savedLoops` up. Do that in Task 9.

For now, pass empty data to unblock layout work:
```tsx
import LoopSidebar from './components/LoopSidebar'

// inside App, in <main>:
<LoopSidebar loops={[]} activeLoopId={null} />
<PDFViewer ... />
```

**Step 3: Verify in browser** — sidebar tab visible on mobile, panel visible and pushing PDF right on desktop (≥1024px). Open/close drawer on mobile.

---

## Phase 3 — Loop Chips

### Task 4: Inactive chip component

**Files:**
- Create: `src/components/LoopChip.tsx`

The inactive chip is a single row: colored dot + name + optional page label + start time.

```tsx
// src/components/LoopChip.tsx
import type { SavedLoop } from '../lib/types'

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function pageLabel(loop: SavedLoop): string | null {
  if (!loop.sheetLink) return null
  const ratio = loop.sheetLink.yWithinPageRatio
  const pg = loop.sheetLink.page
  if (ratio === undefined) return `pg ${pg}`
  if (ratio < 0.33) return `Top of pg ${pg}`
  if (ratio < 0.66) return `Mid pg ${pg}`
  return `Btm pg ${pg}`
}

type LoopChipProps = {
  loop: SavedLoop
  isActive: boolean
  isNearViewport: boolean   // scroll-linked highlight
  onClick: () => void
}

export function InactiveChip({ loop, isActive, isNearViewport, onClick }: LoopChipProps) {
  const pg = pageLabel(loop)
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
        isActive
          ? 'bg-slate-100 font-medium'
          : isNearViewport
          ? 'bg-[#4F7F7A]/8 border-l-2 border-[#4F7F7A]'
          : 'hover:bg-slate-50'
      }`}
    >
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-black/20"
        style={{ backgroundColor: loop.color }}
      />
      <span className="min-w-0 flex-1 truncate text-[13px] text-slate-800">
        {loop.name}
      </span>
      <span className="shrink-0 text-[11px] text-slate-400">
        {pg && <>{pg} · </>}{formatTime(loop.start)}
      </span>
    </button>
  )
}
```

**Step 1: Create `src/components/LoopChip.tsx` with the above**

**Step 2: Import and render in `LoopSidebar`**

Replace the placeholder `<p>` with:
```tsx
{loops.map((loop) => (
  <InactiveChip
    key={loop.id}
    loop={loop}
    isActive={loop.id === activeLoopId}
    isNearViewport={false}  // wired in Task 7
    onClick={() => {/* Task 9 */}}
  />
))}
```

**Step 3: Verify in browser** — add a few mock loops to `App.tsx` temporarily to see chips render correctly. Remove mocks after verification.

---

### Task 5: Expanded chip — controls

The active chip expands below the name row to show Repeat, Scroll on repeat, sheet position, and Delete.

**Files:**
- Modify: `src/components/LoopChip.tsx`

**Step 1: Add expanded section to `LoopChip.tsx`**

Add these prop types:
```tsx
type ExpandedChipProps = LoopChipProps & {
  onRename: (name: string) => void
  onToggleRepeat: () => void
  onToggleScrollOnRepeat: () => void
  onMarkPosition: () => void
  onConfirmMark: () => void
  onRemarkPosition: () => void
  onDelete: () => void
}
```

Render the expanded section beneath the name row when `isActive`:

```tsx
export function LoopChip(props: ExpandedChipProps) {
  const { loop, isActive, isNearViewport, onClick,
    onRename, onToggleRepeat, onToggleScrollOnRepeat,
    onMarkPosition, onConfirmMark, onRemarkPosition, onDelete } = props

  const pg = pageLabel(loop)
  const hasDraft = Boolean(loop.sheetLinkDraft)
  const hasSaved = Boolean(loop.sheetLink)

  return (
    <div className={`rounded-lg transition-colors ${isActive ? 'bg-slate-100' : isNearViewport ? 'border-l-2 border-[#4F7F7A]' : ''}`}>
      {/* Name row — always shown */}
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left"
      >
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-black/20"
          style={{ backgroundColor: loop.color }}
        />
        {isActive ? (
          <input
            className="min-w-0 flex-1 bg-transparent text-[13px] font-medium text-slate-900 outline-none"
            defaultValue={loop.name}
            onBlur={(e) => onRename(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
            onClick={(e) => e.stopPropagation()}
            autoFocus
          />
        ) : (
          <span className="min-w-0 flex-1 truncate text-[13px] text-slate-800">{loop.name}</span>
        )}
        <span className="shrink-0 text-[11px] text-slate-400">
          {pg && <>{pg} · </>}{formatTime(loop.start)}
        </span>
      </button>

      {/* Expanded controls */}
      {isActive && (
        <div className="px-2 pb-2 space-y-2">
          {/* Repeat + Scroll on repeat */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onToggleRepeat}
              className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium transition-colors ${
                loop.loopOn
                  ? 'bg-[#4F7F7A]/20 text-[#4F7F7A]'
                  : 'bg-slate-200 text-slate-500 hover:bg-slate-300'
              }`}
            >
              ↺ Repeat
            </button>
            {loop.loopOn && (
              <button
                type="button"
                onClick={onToggleScrollOnRepeat}
                className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium transition-colors ${
                  /* scrollOnRepeat is a global setting — needs threading through; see Task 9 */
                  'bg-slate-200 text-slate-500 hover:bg-slate-300'
                }`}
              >
                ↕ Scroll
              </button>
            )}
          </div>

          {/* Sheet position */}
          <div className="text-[12px]">
            {hasDraft && (
              <div className="flex items-center gap-2 rounded-md border border-dashed border-slate-300 px-2 py-1.5 text-slate-400">
                <span className="flex-1">📍 {pageLabel({ ...loop, sheetLink: loop.sheetLinkDraft })} <span className="text-[10px] uppercase tracking-wide">draft</span></span>
                <button type="button" onClick={onRemarkPosition} className="text-slate-400 hover:text-slate-600">Re-mark</button>
                <button type="button" onClick={onConfirmMark} className="font-semibold text-[#4F7F7A] hover:text-[#3d6460]">Confirm</button>
              </div>
            )}
            {!hasDraft && hasSaved && (
              <div className="flex items-center gap-2 px-2 py-1 text-slate-500">
                <span className="flex-1">📍 {pg}</span>
                <button type="button" onClick={onRemarkPosition} className="text-slate-400 hover:text-slate-600 text-[11px]">Re-mark</button>
              </div>
            )}
            {!hasDraft && !hasSaved && (
              <button type="button" onClick={onMarkPosition} className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-600">
                📍 Mark position
              </button>
            )}
          </div>

          {/* Delete */}
          <button
            type="button"
            onClick={onDelete}
            className="w-full rounded-md px-2 py-1 text-left text-[12px] text-red-500 hover:bg-red-50"
          >
            Delete loop
          </button>
        </div>
      )}
    </div>
  )
}
```

**Step 2: Replace `InactiveChip` usage in `LoopSidebar` with `LoopChip`**

**Step 3: Verify** — click a chip, it expands. Click another, previous collapses. Name field is focused on expansion.

---

### Task 6: + New Loop button and empty state

**Files:**
- Modify: `src/components/LoopSidebar.tsx`

**Step 1: Add the button at the top of the panel**

```tsx
<div className="shrink-0 border-b border-slate-100 p-2">
  <button
    type="button"
    onClick={onCreateLoop}
    className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 py-1.5 text-[12px] text-slate-400 transition hover:border-slate-400 hover:text-slate-600"
  >
    <Plus size={13} />
    New loop
  </button>
</div>
```

Add `onCreateLoop: () => void` to `LoopSidebarProps`.

**Step 2: Empty state inside the list**

```tsx
{loops.length === 0 && (
  <p className="px-3 py-4 text-center text-[12px] text-slate-400">
    Hit + to create your first loop
  </p>
)}
```

**Step 3: Verify** — empty state shows with no loops. Button is clickable (handler wired in Task 9).

---

## Phase 4 — Scroll-Linked Highlighting

### Task 7: Highlight chips near current PDF viewport

The sidebar needs to know which page(s) are currently in the PDF viewport.

**Files:**
- Modify: `src/components/PDFViewer.tsx`
- Modify: `src/components/LoopSidebar.tsx`
- Modify: `src/App.tsx`

**Step 1: Expose `currentPage` from PDFViewer to App**

`PDFViewer` already calls `onPageChange(page, total)` via the existing `IntersectionObserver`. `App` already tracks `currentPage` in state. Nothing new needed here.

**Step 2: Pass `currentPage` down to `LoopSidebar`**

```tsx
// App.tsx
<LoopSidebar
  loops={savedLoops}
  activeLoopId={activeLoopId}
  currentPage={currentPage}
  onCreateLoop={handleCreateLoop}
  ...
/>
```

**Step 3: Use `currentPage` in `LoopSidebar` to compute `isNearViewport`**

```tsx
// LoopSidebar.tsx
function isNearViewport(loop: SavedLoop, currentPage: number): boolean {
  if (!loop.sheetLink) return false
  return Math.abs(loop.sheetLink.page - currentPage) <= 1
}
```

Pass `isNearViewport(loop, currentPage)` into each `<LoopChip>`.

**Step 4: Verify** — scroll the PDF; chips whose `sheetLink.page` is within 1 of the visible page get the teal left-border accent.

---

## Phase 5 — Sheet Position Draft Flow

### Task 8: Auto-draft on loop creation + Confirm/Re-mark

When a loop is created, the current PDF scroll position is captured as `sheetLinkDraft` (not `sheetLink`). The chip shows it in draft state until the user explicitly confirms or re-marks.

**Files:**
- Modify: `src/components/PlayerDock.tsx`
- Modify: `src/components/LoopSidebar.tsx`
- Modify: `src/lib/types.ts`

**Step 1: Capture draft position at creation time**

In `PlayerDock.tsx`, find `createRegion` (the function that creates a new WaveSurfer region). After creating the region, capture the current sheet position:

```tsx
const draftPosition = pdfViewerRef.current?.getSheetPosition()
// attach to the new SavedLoop as sheetLinkDraft
```

When building the `SavedLoop` object for localStorage, include `sheetLinkDraft` if present.

**Step 2: Add `confirmSheetDraft` and `remarkSheetPosition` handlers in `PlayerDock`**

```tsx
const confirmSheetDraft = useCallback((loopId: string) => {
  setSavedLoops((prev) =>
    prev.map((l) =>
      l.id === loopId && l.sheetLinkDraft
        ? { ...l, sheetLink: l.sheetLinkDraft, sheetLinkDraft: undefined }
        : l
    )
  )
}, [])

const remarkSheetPosition = useCallback((loopId: string) => {
  // Toast: "Scroll to the right spot, then tap Confirm"
  toast('Scroll to the right measure, then tap Confirm', { duration: 3000 })
  // Store which loop is pending a re-mark
  pendingRemarkLoopIdRef.current = loopId
}, [])
```

The "Confirm" button in the chip calls a handler that checks `pendingRemarkLoopIdRef` — if set, captures current position as draft for that loop.

**Step 3: Add `markSheetPosition` for loops with no position**

```tsx
const markSheetPosition = useCallback((loopId: string) => {
  const pos = pdfViewerRef.current?.getSheetPosition()
  if (!pos) return
  setSavedLoops((prev) =>
    prev.map((l) => l.id === loopId ? { ...l, sheetLinkDraft: pos } : l)
  )
}, [pdfViewerRef])
```

**Step 4: Update PDF marker to show draft state**

In `PDFViewer.tsx`, the `SheetMarker` type has a `sheetLink` (saved position). Add an `isDraft` boolean to `SheetMarker`:

```ts
// PDFViewer.tsx SheetMarker type
export type SheetMarker = {
  id: string
  name: string
  color: string
  sheetLink: SheetPosition
  isDraft?: boolean
}
```

In the marker pill render, when `isDraft`:
```tsx
className={`sheet-marker ... ${marker.isDraft ? 'opacity-60 border-dashed' : ''}`}
```

In `PlayerDock.tsx`, when building `loopMarkers` from `savedLoops`, use `sheetLinkDraft` if no `sheetLink`:
```tsx
const position = loop.sheetLink ?? loop.sheetLinkDraft
if (!position) return null
return { id: loop.id, name: loop.name, color: loop.color, sheetLink: position, isDraft: !loop.sheetLink }
```

**Step 5: Mobile — tap draft marker on PDF → bottom sheet**

In `PDFViewer.tsx`, when a marker is tapped on mobile (`isTouch`) and `marker.isDraft`, call a new `onDraftMarkerTap` prop instead of `onMarkerClick`. In `App.tsx`, handle this by showing a mobile bottom sheet (a simple fixed overlay) with Confirm / Re-mark buttons. This bottom sheet can be a local state in App.

**Step 6: Verify full draft flow** — create a loop, see draft chip state, confirm it, see it become saved. Re-mark: tap Re-mark, see toast, scroll, tap Confirm, see updated position.

---

## Phase 6 — Data Plumbing (PlayerDock → App → LoopSidebar)

### Task 9: Lift savedLoops and loop actions to App

Currently `savedLoops`, `activeRegionId`, loop CRUD, and `scrollOnRepeat` all live inside `PlayerDock`. The sidebar needs them. The cleanest approach: `PlayerDock` continues to own all audio state, but surfaces the loop list and mutator callbacks upward via new props/callbacks — mirroring the existing `onLoopMarkersChange` pattern.

**Files:**
- Modify: `src/components/PlayerDock.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/LoopSidebar.tsx`

**Step 1: Add new callbacks to `PlayerDock` props**

```tsx
type PlayerDockProps = {
  // existing...
  onSavedLoopsChange: (loops: SavedLoop[]) => void
  onActiveLoopIdChange: (id: string | null) => void
}
```

Call these whenever `savedLoops` or `activeRegionId` changes (in the existing `useEffect`s that sync them).

**Step 2: Add state in `App.tsx`**

```tsx
const [savedLoops, setSavedLoops] = useState<SavedLoop[]>([])
const [activeLoopId, setActiveLoopId] = useState<string | null>(null)
```

Pass `onSavedLoopsChange={setSavedLoops}` and `onActiveLoopIdChange={setActiveLoopId}` to `PlayerDock`.

**Step 3: Pass loop actions from `PlayerDock` up through callback refs (same pattern as `markerActivateRef`)**

Add to `App`:
```tsx
const createLoopRef = useRef<(() => void) | null>(null)
const deleteLoopRef = useRef<((id: string) => void) | null>(null)
const renameLoopRef = useRef<((id: string, name: string) => void) | null>(null)
const selectLoopRef = useRef<((id: string) => void) | null>(null)
const confirmDraftRef = useRef<((id: string) => void) | null>(null)
const remarkPositionRef = useRef<((id: string) => void) | null>(null)
const markPositionRef = useRef<((id: string) => void) | null>(null)
const toggleLoopRepeatRef = useRef<((id: string) => void) | null>(null)
```

`PlayerDock` populates these refs (like `markerActivateRef`). `App` passes them as callbacks into `LoopSidebar`.

**Step 4: Wire `scrollOnRepeat` per-loop**

Currently `scrollOnRepeat` is a single global boolean. It should become per-loop (stored on the `SavedLoop` object). Add `scrollOnRepeat?: boolean` to the `SavedLoop` type. In `PlayerDock`, when a loop becomes active, read its `scrollOnRepeat` value to determine whether to scroll on repeat.

**Step 5: Verify** — create a loop via sidebar `+` button, see it appear in both sidebar and waveform. Select it, rename it, delete it. All operations work.

---

## Phase 7 — Live Chip Reordering

### Task 10: Sort chips by start time, reorder on drag

**Files:**
- Modify: `src/components/LoopSidebar.tsx`

The `savedLoops` array passed to the sidebar is already updated by `PlayerDock` whenever regions move. Sort before rendering:

```tsx
const sortedLoops = useMemo(
  () => [...loops].sort((a, b) => a.start - b.start),
  [loops]
)
```

`PlayerDock` already calls `onSavedLoopsChange` on region update events — so the sorted list re-renders automatically as the user drags waveform handles.

**Step 1: Add the `useMemo` sort above and use `sortedLoops` in the chip list**

**Step 2: Verify** — drag a waveform handle past another loop's start; the chips swap positions in the sidebar instantly.

---

## Phase 8 — Remove Loop Controls from TransportBar

### Task 11: Strip loop-related items from TransportBar

With the sidebar owning all loop UI, the transport bar no longer needs the loop icon button, the loops dropdown, or "Scroll on repeat."

**Files:**
- Modify: `src/components/TransportBar.tsx`
- Modify: `src/components/PlayerDock.tsx`

**Step 1: Remove from `TransportBar.tsx`**
- Delete the `regionButtonRef`, `menuOpen`, `loopActionsOpenId`, `sortedSavedLoops` state and all related handlers
- Remove the entire left-extras `<div>` containing the loop-icon button and the repeat button
- Remove props: `savedLoops`, `activeSavedLoop`, `activeRegionId`, `selectSavedLoop`, `deleteSavedLoop`, `beginRenameLoop`, `linkLoopToSheet`, `scrollToLoopMarker`, `scrollOnRepeat`, `toggleScrollOnRepeat`, `scrollRepeatOffToastToken`, `beginSaveRegion`, `createRegion`, `exitLoop`
- Keep: loop toggle (`loopOn` / `toggleLoop`) — move it into the right-side extras or remove entirely (loop is now controlled from the sidebar)

> **Note:** The repeat button (↺ Repeat) that toggles looping on/off for the active region moves to the expanded chip in the sidebar. Remove from TransportBar entirely.

**Step 2: Update `PlayerDock.tsx`** — remove the now-unused props passed to `<TransportBar>`.

**Step 3: Verify** — transport bar is cleaner. No loops dropdown. No repeat button. Loop operations work only through the sidebar.

---

## Phase 9 — Simplify Context Bar

### Task 12: Simplify or remove the page x/x pill

The sidebar chips now show page numbers, providing equivalent navigation context.

**Files:**
- Modify: `src/components/ContextBar.tsx`

**Option A (recommended): Remove the page pill entirely.** The `JumpPanel` quick-jump behavior is now replaced by clicking chips in the sidebar. Delete the `pageButtonRef`, `jumpOpen` state, `JumpPanel`, and the page button.

**Option B: Keep as minimal text only.** If you want to keep the page indicator, strip it to a plain non-interactive `<span>` showing `${currentPage} / ${numPages}` with no dropdown.

**Step 1: Remove the page pill button and `JumpPanel` component from `ContextBar.tsx`**

**Step 2: Remove `currentPage`, `numPages`, `pdfViewerRef` props from `ContextBarProps`** (these were only needed for the pill and jump panel)

**Step 3: Remove those props from `App.tsx`**

**Step 4: Verify** — context bar shows only song name + track selector + zoom buttons. No page indicator.

---

## Phase 10 — Balance L/R + Stereo/Mono

### Task 13: StereoPannerNode in the audio chain

**Files:**
- Modify: `src/components/PlayerDock.tsx`
- Create: `src/lib/useStereoPanner.ts`

**Step 1: Create `useStereoPanner.ts`**

```ts
import { useRef, useCallback } from 'react'

export function useStereoPanner(audioContextRef: React.MutableRefObject<AudioContext | null>) {
  const pannerRef = useRef<StereoPannerNode | null>(null)

  const ensurePanner = useCallback((context: AudioContext) => {
    if (pannerRef.current) return pannerRef.current
    const panner = context.createStereoPanner()
    panner.pan.value = 0
    pannerRef.current = panner
    return panner
  }, [])

  const setBalance = useCallback((value: number) => {
    if (pannerRef.current) pannerRef.current.pan.value = value
  }, [])

  const setMono = useCallback((mono: boolean) => {
    if (!pannerRef.current) return
    // Mono: force pan to 0 and set channelCount to 1 on the panner output
    const panner = pannerRef.current
    if (mono) {
      panner.channelCount = 1
      panner.channelCountMode = 'explicit'
    } else {
      panner.channelCount = 2
      panner.channelCountMode = 'max'
    }
  }, [])

  return { pannerRef, ensurePanner, setBalance, setMono }
}
```

**Step 2: Insert panner into audio chain in `PlayerDock.tsx`**

Find `ensureMasterGain`. After creating the `GainNode`, insert the panner:

```tsx
// Before: gain.connect(context.destination)
// After:
const panner = ensurePanner(context)
gain.connect(panner)
panner.connect(context.destination)
```

**Step 3: Add `balance` and `mono` state to PlayerDock**

```tsx
const [balance, setBalance] = useState(0)
const [mono, setMono] = useState(false)
```

When `balance` changes: `stereoPanner.setBalance(value)`. When `mono` changes: `stereoPanner.setMono(value)`.

**Step 4: Verify** — open DevTools, drag balance slider (stubbed for now), confirm audio shifts left/right. Test mono.

---

### Task 14: Balance + Mono UI (headphones popover)

**Files:**
- Create: `src/components/AudioControlsPopover.tsx`
- Modify: `src/components/TransportBar.tsx`

**Step 1: Create `AudioControlsPopover.tsx`**

```tsx
type AudioControlsPopoverProps = {
  balance: number           // -1 to 1
  mono: boolean
  onBalanceChange: (v: number) => void
  onMonoToggle: () => void
  onClose: () => void
}

export default function AudioControlsPopover({
  balance, mono, onBalanceChange, onMonoToggle, onClose
}: AudioControlsPopoverProps) {
  return (
    <div className="absolute bottom-14 right-0 z-[10010] w-52 rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Balance</p>
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-slate-400">L</span>
        <input
          type="range"
          min={-1}
          max={1}
          step={0.01}
          value={balance}
          onChange={(e) => onBalanceChange(parseFloat(e.target.value))}
          className="flex-1 accent-[#4F7F7A]"
        />
        <span className="text-[11px] text-slate-400">R</span>
      </div>
      <div className="mt-3 border-t border-slate-100 pt-2">
        <button
          type="button"
          onClick={onMonoToggle}
          className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] transition-colors ${
            mono ? 'bg-[#4F7F7A]/15 text-[#4F7F7A] font-medium' : 'text-slate-600 hover:bg-slate-50'
          }`}
        >
          <span className={`flex h-4 w-4 items-center justify-center rounded border ${mono ? 'border-[#4F7F7A] bg-[#4F7F7A]' : 'border-slate-300'}`}>
            {mono && <span className="text-[9px] text-white">✓</span>}
          </span>
          Mono
        </button>
      </div>
    </div>
  )
}
```

**Step 2: Headphones button gradient background**

In `TransportBar.tsx`, compute the gradient from `balance` prop:

```tsx
// balance: -1 (full left) to 1 (full right)
// When balance < 0: right side is muted. When balance > 0: left side is muted.
const getBalanceGradient = (balance: number) => {
  if (Math.abs(balance) < 0.02) return undefined // centered, no gradient
  const muted = 'rgba(100,116,139,0.3)'
  const normal = 'transparent'
  if (balance < 0) {
    // Fading right: right portion becomes muted
    const pct = 50 + (Math.abs(balance) * 50)
    return `linear-gradient(to right, ${normal} ${50}%, ${muted} ${pct}%)`
  } else {
    const pct = 50 - (balance * 50)
    return `linear-gradient(to right, ${muted} ${pct}%, ${normal} ${50}%)`
  }
}
```

Apply as `style={{ background: getBalanceGradient(balance) }}` on the headphones button.

**Step 3: Wire popover open/close** — `audioControlsOpen` state, click outside to close (same pattern as speed menu).

**Step 4: Add `balance` and `mono` props to `TransportBarProps`; pass from `PlayerDock`**

**Step 5: Verify** — open popover, drag slider, hear balance shift, see button gradient update smoothly. Toggle mono.

---

## Phase 11 — Transpose

### Task 15: Install and wire @soundtouchjs/audio-worklet

**Files:**
- Modify: `package.json` (install)
- Create: `src/lib/useTranspose.ts`
- Modify: `src/components/PlayerDock.tsx`

**Step 1: Install the package**
```bash
npm install @soundtouchjs/audio-worklet
```

**Step 2: Register the AudioWorklet module**

In `PlayerDock.tsx`, when the `AudioContext` is first created:
```tsx
await audioContext.audioWorklet.addModule(
  new URL('@soundtouchjs/audio-worklet/dist/soundtouch-worklet.js', import.meta.url)
)
```

This must happen before creating any `SoundTouchNode`. Do it once in a `useEffect` or inside `ensureAudioContext`.

**Step 3: Create `src/lib/useTranspose.ts`**

```ts
import { useRef, useCallback, useEffect } from 'react'
// @soundtouchjs/audio-worklet exports a SoundTouchNode class
import { SoundTouchNode } from '@soundtouchjs/audio-worklet'

export function useTranspose() {
  const nodeRef = useRef<SoundTouchNode | null>(null)
  const latencyRef = useRef(0)  // ms, measured at init

  const createNode = useCallback(async (context: AudioContext) => {
    if (nodeRef.current) return nodeRef.current
    const node = new SoundTouchNode(context, { bufferSize: 4096 })
    // Measure latency from buffer size
    latencyRef.current = (4096 / context.sampleRate) * 1000
    nodeRef.current = node
    return node
  }, [])

  const setPitch = useCallback((semitones: number) => {
    if (!nodeRef.current) return
    nodeRef.current.pitch = Math.pow(2, semitones / 12)
  }, [])

  const destroy = useCallback(() => {
    nodeRef.current?.disconnect()
    nodeRef.current = null
  }, [])

  return { nodeRef, latencyRef, createNode, setPitch, destroy }
}
```

**Step 4: Insert SoundTouchNode between GainNode and StereoPannerNode**

Audio chain becomes:
```
MediaElementSource → GainNode → SoundTouchNode → StereoPannerNode → destination
```

When transpose = 0, `pitch = 1.0` (no processing overhead is negligible).

**Step 5: Compensate fade envelope timing**

In `PlayerDock.tsx`, wherever GainNode ramps are scheduled (look for `rampGainTo` calls in the loop playback section), offset the scheduled time by `latencyRef.current / 1000` seconds:

```tsx
// Before:
rampGainTo(targetGain, startTime, duration)
// After:
rampGainTo(targetGain, startTime + latencyRef.current / 1000, duration)
```

**Step 6: Set `preservesPitch` based on transpose value**

```tsx
useEffect(() => {
  const media = waveSurferRef.current?.getMediaElement()
  if (!media) return
  media.preservesPitch = transpose === 0
}, [transpose])
```

**Step 7: Add `transpose` state (`number`, default `0`) to `PlayerDock`**

When `transpose` changes, call `transposeHook.setPitch(transpose)`.

**Step 8: Verify** — set transpose to +2, play audio, confirm pitch shifts up without speed change.

---

### Task 16: Transpose button UI

**Files:**
- Create: `src/components/TransposeButton.tsx`
- Modify: `src/components/TransportBar.tsx`

**Step 1: Create `TransposeButton.tsx`**

```tsx
const SEMITONE_LABELS: Record<number, string> = {
  [-5]: '−P4', [-4]: '−M3', [-3]: '−b3', [-2]: '−M2', [-1]: '−b2',
  [0]: '♭♯',
  [1]: '+b2', [2]: '+M2', [3]: '+b3', [4]: '+M3', [5]: '+P4',
}

type TransposeButtonProps = {
  value: number   // -5 to 5
  onChange: (v: number) => void
  buttonClassName: string  // pass in controlButtonBase + iconButtonSize from TransportBar
}

export default function TransposeButton({ value, onChange, buttonClassName }: TransposeButtonProps) {
  const [open, setOpen] = useState(false)
  const label = SEMITONE_LABELS[value] ?? '♭♯'
  const isActive = value !== 0

  return (
    <div className="relative">
      <button
        type="button"
        className={`${buttonClassName} ${isActive ? '!border-[#4F7F7A] !bg-[#4F7F7A]/25' : ''} text-xs font-semibold`}
        onClick={() => setOpen((v) => !v)}
        title="Transpose"
      >
        {label}
      </button>
      {open && (
        <div className="absolute bottom-14 right-0 z-[10010] w-44 rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Transpose</p>
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              disabled={value <= -5}
              onClick={() => onChange(Math.max(-5, value - 1))}
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-30"
            >−</button>
            <button
              type="button"
              className="flex-1 text-center text-[15px] font-semibold text-slate-800"
              onClick={() => onChange(0)}
              title="Reset to 0"
            >
              {label}
            </button>
            <button
              type="button"
              disabled={value >= 5}
              onClick={() => onChange(Math.min(5, value + 1))}
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-30"
            >+</button>
          </div>
        </div>
      )}
    </div>
  )
}
```

**Step 2: Add `TransposeButton` to `TransportBar` right-side extras, next to the speed button**

Pass `transpose` and `setTranspose` as new props to `TransportBar`.

**Step 3: Verify** — stepper opens, increments/decrements, resets on label click, active state shows when ≠ 0.

---

## Phase 12 — Mobile Audio Settings Sheet

### Task 17: AudioLines button + bottom sheet on mobile

**Files:**
- Create: `src/components/AudioSettingsSheet.tsx`
- Modify: `src/components/TransportBar.tsx`

**Step 1: Create `AudioSettingsSheet.tsx`**

```tsx
import { AudioLines } from 'lucide-react'

type AudioSettingsSheetProps = {
  balance: number
  mono: boolean
  transpose: number
  onBalanceChange: (v: number) => void
  onMonoToggle: () => void
  onTransposeChange: (v: number) => void
}

export default function AudioSettingsSheet(props: AudioSettingsSheetProps) {
  const [open, setOpen] = useState(false)
  const { balance, mono, transpose, onBalanceChange, onMonoToggle, onTransposeChange } = props
  const hasActiveSettings = Math.abs(balance) > 0.02 || mono || transpose !== 0

  return (
    <>
      <button
        type="button"
        className={`... ${hasActiveSettings ? 'ring-1 ring-[#4F7F7A]' : ''}`}
        onClick={() => setOpen(true)}
        title="Audio settings"
      >
        <AudioLines size={18} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-[400] bg-black/20" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="fixed inset-x-0 bottom-0 z-[410] rounded-t-2xl bg-white p-4 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <p className="font-semibold text-slate-800">Audio Settings</p>
              <button type="button" onClick={() => setOpen(false)} className="text-slate-400">✕</button>
            </div>
            {/* Balance */}
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Balance</p>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[11px] text-slate-400">L</span>
              <input type="range" min={-1} max={1} step={0.01} value={balance}
                onChange={(e) => onBalanceChange(parseFloat(e.target.value))}
                className="flex-1 accent-[#4F7F7A]" />
              <span className="text-[11px] text-slate-400">R</span>
            </div>
            {/* Mono */}
            <button type="button" onClick={onMonoToggle}
              className={`mb-3 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-[13px] ${mono ? 'bg-[#4F7F7A]/15 text-[#4F7F7A]' : 'bg-slate-50 text-slate-600'}`}>
              Mono {mono && '✓'}
            </button>
            {/* Transpose */}
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Transpose</p>
            <div className="flex items-center justify-between gap-2">
              <button disabled={transpose <= -5} onClick={() => onTransposeChange(transpose - 1)}
                className="h-10 w-10 rounded-lg bg-slate-100 text-slate-600 disabled:opacity-30">−</button>
              <button onClick={() => onTransposeChange(0)} className="flex-1 text-center text-[15px] font-semibold">
                {SEMITONE_LABELS[transpose] ?? '♭♯'}
              </button>
              <button disabled={transpose >= 5} onClick={() => onTransposeChange(transpose + 1)}
                className="h-10 w-10 rounded-lg bg-slate-100 text-slate-600 disabled:opacity-30">+</button>
            </div>
            <div className="h-[env(safe-area-inset-bottom,0px)]" />
          </div>
        </>
      )}
    </>
  )
}
```

Import `SEMITONE_LABELS` from `TransposeButton.tsx` (extract it to a shared constant).

**Step 2: Show `AudioSettingsSheet` only on mobile in `TransportBar`**

```tsx
{/* Mobile only */}
<div className="lg:hidden">
  <AudioSettingsSheet ... />
</div>
{/* Desktop only */}
<div className="hidden lg:flex items-center gap-3">
  {/* headphones button + TransposeButton */}
</div>
```

**Step 3: Verify on mobile viewport** — AudioLines button visible, bottom sheet opens with all three controls.

---

## Phase 13 — Polish & Cleanup

### Task 18: Final cleanup checklist

**Files:** Various

- [ ] Remove the loop icon button from `TransportBar` entirely (Task 11 may have left stubs)
- [ ] Remove `scrollRepeatOffToastToken` and related state from `PlayerDock` / `TransportBar` (now handled per-chip in sidebar)
- [ ] Persist `sheetLinkDraft` in localStorage (add to the existing loop serialization in `PlayerDock`)
- [ ] Persist `scrollOnRepeat` per-loop in localStorage
- [ ] Ensure the sidebar swipe gesture works on mobile (add `touchstart`/`touchmove` listeners to the tab for swipe-open)
- [ ] Verify the PDF viewer `ResizeObserver` responds correctly when the sidebar opens/closes on mobile (layout shift may affect `containerWidth`)
- [ ] Set `SEMITONE_LABELS` as a named export from a shared `src/lib/constants.ts` so both `TransposeButton` and `AudioSettingsSheet` import from one place
- [ ] Remove debug `console.log` statements added during `TransportBar` mount/unmount (lines ~322–342 in current `TransportBar.tsx`)

---

## Notes on No Test Suite

There is no test suite. For each task, manually verify the feature in the browser using `npm run dev`. Key manual checks at each phase:

- **Phase 2–3:** Sidebar renders on desktop (pushes PDF), drawer opens/closes on mobile
- **Phase 5:** Loop chips render, expand, collapse, reorder as waveform handles move
- **Phase 6:** Draft mark flow — create loop, see draft, confirm, re-mark
- **Phase 10:** Balance shifts audio L/R, mono collapses to center, gradient on button is smooth
- **Phase 11:** Transpose shifts pitch without changing tempo, loop fade timing is unaffected
- **Phase 12:** Mobile sheet opens all three controls

---
