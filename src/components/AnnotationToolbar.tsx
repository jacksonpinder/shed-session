/**
 * AnnotationToolbar — vertical tool palette that slides in from the left edge
 * while write mode is active. Pure UI: every action reads from / writes to
 * `AnnotationContext` via `useAnnotations()`. No props, no local annotation
 * state beyond the inline "clear all" confirmation toggle.
 *
 * Layout (top → bottom): tool selector · color swatches · width swatches ·
 * undo/redo · clear · Done. Two CSS tiers — full on tall viewports, compact
 * under `max-height: 500px` — so everything fits without the toolbar scrolling.
 */

import { useState } from 'react'
import {
  Pencil,
  Highlighter,
  Eraser,
  Undo2,
  Redo2,
  Trash2,
  Check,
} from 'lucide-react'
import { useAnnotations, type AnnotationTool } from '../contexts/AnnotationContext'

// ── Palette ───────────────────────────────────────────────────────────────────

const ACCENT = '#4F7F7A'

const COLORS: { name: string; value: string }[] = [
  { name: 'Red', value: '#ef4444' },
  { name: 'Black', value: '#1a1a1a' },
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Yellow', value: '#facc15' },
  { name: 'Green', value: '#22c55e' },
]

const PEN_WIDTHS = [1, 2, 4, 8, 16]
const HIGHLIGHT_WIDTHS = [8, 16, 24, 36, 56]

const TOOLS: { tool: AnnotationTool; label: string; Icon: typeof Pencil }[] = [
  { tool: 'pen', label: 'Pen', Icon: Pencil },
  { tool: 'highlight', label: 'Highlighter', Icon: Highlighter },
  { tool: 'eraser', label: 'Eraser', Icon: Eraser },
]

// Largest pen/highlight width, used to scale the width-swatch preview lines so
// the thickest sample fills the swatch without clipping.
const MAX_WIDTH = Math.max(...HIGHLIGHT_WIDTHS)

export default function AnnotationToolbar() {
  const {
    writeMode,
    setWriteMode,
    activeTool,
    setActiveTool,
    penColor,
    setPenColor,
    highlightColor,
    setHighlightColor,
    penWidth,
    setPenWidth,
    highlightWidth,
    setHighlightWidth,
    canUndo,
    canRedo,
    undo,
    redo,
    clearAll,
  } = useAnnotations()

  const [confirmingClear, setConfirmingClear] = useState(false)

  const isEraser = activeTool === 'eraser'
  const isHighlight = activeTool === 'highlight'

  // Active color/width for the tool currently selected (eraser has neither).
  const activeColor = isHighlight ? highlightColor : penColor
  const activeWidth = isHighlight ? highlightWidth : penWidth
  const widths = isHighlight ? HIGHLIGHT_WIDTHS : PEN_WIDTHS

  // Picking a color while erasing implies "I want to draw" — switch to pen first.
  const handleColor = (value: string) => {
    if (isEraser) {
      setActiveTool('pen')
      setPenColor(value)
      return
    }
    if (isHighlight) setHighlightColor(value)
    else setPenColor(value)
  }

  const handleWidth = (w: number) => {
    if (isHighlight) setHighlightWidth(w)
    else setPenWidth(w)
  }

  // ── Shared button styles ──────────────────────────────────────────────────────
  const baseButton =
    'flex items-center justify-center rounded-full bg-white text-[#0b1220] shadow border border-slate-200 transition hover:bg-slate-50 hover:shadow-md hover:border-slate-300 active:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4F7F7A]/40'

  return (
    <div
      // The fixed/translate transition lives here; the inner card carries the
      // visual chrome. `aria-hidden` + `pointer-events` keep it inert offscreen.
      aria-hidden={!writeMode}
      className={`fixed left-0 top-1/2 z-50 -translate-y-1/2 transition-transform duration-300 ease-out ${
        writeMode ? 'translate-x-0' : '-translate-x-[120%]'
      } ${writeMode ? 'pointer-events-auto' : 'pointer-events-none'}`}
    >
      <div
        // Compact tier (`max-height: 500px`) tightens every gap/padding via the
        // arbitrary-variant utilities below. overflow-hidden guarantees the
        // toolbar compresses rather than scrolls.
        role="toolbar"
        aria-label="Annotation tools"
        aria-orientation="vertical"
        className="flex max-h-[96vh] flex-col items-center gap-3 overflow-hidden rounded-r-2xl border border-l-0 border-slate-200 bg-white px-2 py-3 shadow-xl [@media(max-height:500px)]:gap-1.5 [@media(max-height:500px)]:py-1.5"
      >
        {/* 1 ── Tool selector ─────────────────────────────────────────────── */}
        <div className="flex flex-col items-center gap-1.5 [@media(max-height:500px)]:gap-1">
          {TOOLS.map(({ tool, label, Icon }) => {
            const active = activeTool === tool
            return (
              <button
                key={tool}
                type="button"
                onClick={() => setActiveTool(tool)}
                aria-label={label}
                aria-pressed={active}
                title={label}
                className={`${baseButton} h-11 w-11 [@media(max-height:500px)]:h-10 [@media(max-height:500px)]:w-10 ${
                  active ? 'border-transparent text-white shadow-md' : ''
                }`}
                style={active ? { backgroundColor: ACCENT } : undefined}
              >
                <Icon size={18} />
              </button>
            )
          })}
        </div>

        <div className="h-px w-7 shrink-0 bg-slate-200" />

        {/* 2 ── Color swatches ────────────────────────────────────────────── */}
        <div className="flex flex-col items-center gap-1 [@media(max-height:500px)]:gap-0.5">
          {COLORS.map(({ name, value }) => {
            const selected = !isEraser && activeColor.toLowerCase() === value.toLowerCase()
            return (
              <button
                key={value}
                type="button"
                onClick={() => handleColor(value)}
                aria-label={`${name} color`}
                aria-pressed={selected}
                title={name}
                // 44px tap target wrapping a smaller visible circle.
                className="flex h-11 w-11 items-center justify-center rounded-full transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4F7F7A]/40 [@media(max-height:500px)]:h-8 [@media(max-height:500px)]:w-8"
              >
                <span
                  className={`block h-6 w-6 rounded-full border border-slate-300 transition [@media(max-height:500px)]:h-5 [@media(max-height:500px)]:w-5 ${
                    selected ? 'ring-2 ring-offset-2' : ''
                  }`}
                  style={{
                    backgroundColor: value,
                    boxShadow: selected ? `0 0 0 2px ${ACCENT}` : undefined,
                  }}
                />
              </button>
            )
          })}
        </div>

        <div className="h-px w-7 shrink-0 bg-slate-200" />

        {/* 3 ── Width swatches (greyed + inert when erasing) ───────────────── */}
        <div
          className={`flex flex-col items-center gap-1 transition-opacity [@media(max-height:500px)]:gap-0.5 ${
            isEraser ? 'pointer-events-none opacity-30' : ''
          }`}
          aria-hidden={isEraser}
        >
          {widths.map((w) => {
            const selected = !isEraser && activeWidth === w
            // Preview stroke height scaled to the swatch; clamped to a visible min.
            const lineH = Math.max(1, Math.round((w / MAX_WIDTH) * 18))
            return (
              <button
                key={w}
                type="button"
                onClick={() => handleWidth(w)}
                aria-label={`Stroke width ${w}`}
                aria-pressed={selected}
                disabled={isEraser}
                className={`flex h-11 w-11 items-center justify-center rounded-lg border transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4F7F7A]/40 [@media(max-height:500px)]:h-8 [@media(max-height:500px)]:w-11 ${
                  selected ? 'border-transparent' : 'border-slate-200'
                }`}
                style={selected ? { boxShadow: `0 0 0 2px ${ACCENT}` } : undefined}
              >
                <span
                  className="block w-7 rounded-full bg-[#0b1220]"
                  style={{ height: `${lineH}px` }}
                />
              </button>
            )
          })}
        </div>

        <div className="h-px w-7 shrink-0 bg-slate-200" />

        {/* 4 ── Undo / Redo ───────────────────────────────────────────────── */}
        <div className="flex flex-col items-center gap-1.5 [@media(max-height:500px)]:gap-1">
          <button
            type="button"
            onClick={undo}
            disabled={!canUndo}
            aria-label="Undo"
            title="Undo"
            className={`${baseButton} h-11 w-11 [@media(max-height:500px)]:h-9 [@media(max-height:500px)]:w-11`}
          >
            <Undo2 size={18} />
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={!canRedo}
            aria-label="Redo"
            title="Redo"
            className={`${baseButton} h-11 w-11 [@media(max-height:500px)]:h-9 [@media(max-height:500px)]:w-11`}
          >
            <Redo2 size={18} />
          </button>
        </div>

        <div className="h-px w-7 shrink-0 bg-slate-200" />

        {/* 5 ── Clear all (inline confirmation, no browser dialog) ─────────── */}
        {confirmingClear ? (
          <div className="flex flex-col items-center gap-1">
            <span className="px-1 text-center text-[10px] font-medium leading-tight text-[#0b1220]">
              Clear all?
            </span>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => {
                  clearAll()
                  setConfirmingClear(false)
                }}
                aria-label="Confirm clear all"
                className="flex h-11 w-11 items-center justify-center rounded-full border border-transparent text-white shadow transition hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4F7F7A]/40 [@media(max-height:500px)]:h-9 [@media(max-height:500px)]:w-9"
                style={{ backgroundColor: '#ef4444' }}
              >
                <Check size={18} />
              </button>
              <button
                type="button"
                onClick={() => setConfirmingClear(false)}
                aria-label="Cancel clear all"
                className={`${baseButton} h-11 w-11 [@media(max-height:500px)]:h-9 [@media(max-height:500px)]:w-9`}
              >
                <span className="text-sm font-medium">No</span>
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingClear(true)}
            aria-label="Clear all annotations"
            title="Clear all"
            className={`${baseButton} h-11 w-11 [@media(max-height:500px)]:h-9 [@media(max-height:500px)]:w-11`}
          >
            <Trash2 size={18} />
          </button>
        )}

        <div className="h-px w-7 shrink-0 bg-slate-200" />

        {/* 6 ── Done — primary exit from write mode ───────────────────────── */}
        <button
          type="button"
          onClick={() => setWriteMode(false)}
          aria-label="Done annotating"
          title="Done"
          className="flex h-12 w-11 flex-col items-center justify-center gap-0.5 rounded-2xl border border-transparent text-white shadow-md transition hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4F7F7A]/60 [@media(max-height:500px)]:h-10 [@media(max-height:500px)]:w-11"
          style={{ backgroundColor: ACCENT }}
        >
          <Check size={20} />
          <span className="text-[10px] font-semibold leading-none [@media(max-height:500px)]:hidden">
            Done
          </span>
        </button>
      </div>
    </div>
  )
}
