import { useState, useRef, useEffect } from 'react'
import {
  Pencil,
  Highlighter,
  Eraser,
  Undo2,
  Redo2,
  Check,
  ChevronDown,
} from 'lucide-react'
import { useAnnotations, type AnnotationTool } from '../contexts/AnnotationContext'

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

// Max preview stroke (px) for each tool's width swatch. Highlights get a larger
// cap so a fat highlighter width reads visibly thicker than a pen width of the
// same swatch — matching how they actually render on the page.
const PEN_PREVIEW_CAP = 7
const HIGHLIGHT_PREVIEW_CAP = 14

const TOOLS: { tool: AnnotationTool; label: string; Icon: typeof Pencil }[] = [
  { tool: 'pen', label: 'Pen', Icon: Pencil },
  { tool: 'highlight', label: 'Highlighter', Icon: Highlighter },
  { tool: 'eraser', label: 'Eraser', Icon: Eraser },
]

// Squiggly S-curve preview — looks like a real brushstroke rather than a flat bar.
function WidthLine({
  width,
  maxWidth,
  cap,
  svgW = 36,
  svgH = 14,
  color = 'currentColor',
}: {
  width: number
  maxWidth: number
  cap: number
  svgW?: number
  svgH?: number
  color?: string
}) {
  const sw = Math.max(0.8, (width / maxWidth) * cap)
  const hw = svgW / 2
  const d = `M2 ${svgH * 0.72} C${svgW * 0.22} ${svgH * 0.18} ${svgW * 0.42} ${svgH * 0.9} ${hw} ${svgH * 0.5} C${svgW * 0.6} ${svgH * 0.1} ${svgW * 0.8} ${svgH * 0.74} ${svgW - 2} ${svgH * 0.38}`
  return (
    <svg width={svgW} height={svgH} viewBox={`0 0 ${svgW} ${svgH}`} fill="none">
      <path d={d} stroke={color} strokeWidth={sw} strokeLinecap="round" fill="none" />
    </svg>
  )
}

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
  } = useAnnotations()

  const [openPanel, setOpenPanel] = useState<null | 'color' | 'width'>(null)

  const colorRef = useRef<HTMLDivElement>(null)
  const widthRef = useRef<HTMLDivElement>(null)

  const isEraser = activeTool === 'eraser'
  const isHighlight = activeTool === 'highlight'
  const activeColor = isHighlight ? highlightColor : penColor
  const activeWidth = isHighlight ? highlightWidth : penWidth
  const widths = isHighlight ? HIGHLIGHT_WIDTHS : PEN_WIDTHS
  const widthMax = widths[widths.length - 1]
  const widthCap = isHighlight ? HIGHLIGHT_PREVIEW_CAP : PEN_PREVIEW_CAP

  // Close an open panel when clicking outside both chips.
  useEffect(() => {
    if (!openPanel) return
    const handler = (e: MouseEvent) => {
      if (
        !colorRef.current?.contains(e.target as Node) &&
        !widthRef.current?.contains(e.target as Node)
      ) {
        setOpenPanel(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [openPanel])

  // Close panels when write mode exits.
  useEffect(() => {
    if (!writeMode) setOpenPanel(null)
  }, [writeMode])

  const handleColor = (value: string) => {
    if (isHighlight) setHighlightColor(value)
    else setPenColor(value)
    setOpenPanel(null)
  }

  const handleWidth = (w: number) => {
    if (isHighlight) setHighlightWidth(w)
    else setPenWidth(w)
    setOpenPanel(null)
  }

  const baseBtn =
    'flex items-center justify-center rounded-full border border-slate-200 bg-white text-[#0b1220] shadow-sm transition hover:bg-slate-50 hover:border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4F7F7A]/40 disabled:cursor-not-allowed disabled:opacity-40'

  return (
    // `relative z-40` lifts the whole bar (and its absolute popovers) above the
    // PDF/canvas/ContextBar, which otherwise paint later in DOM order and would
    // cover the dropdown panels. In-flow (not fixed) so it pushes the PDF down.
    <div
      inert={!writeMode}
      className={`relative z-40 ${writeMode ? 'border-b border-slate-200' : 'hidden'} bg-white`}
    >
      <div
        role="toolbar"
        aria-label="Annotation tools"
        aria-orientation="horizontal"
        className="flex h-11 items-center justify-center gap-1 px-3"
      >
        {/* ── Tools ──────────────────────────────────────────────────────── */}
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
              className={`${baseBtn} h-8 w-8 ${active ? 'border-transparent text-white' : ''}`}
              style={active ? { backgroundColor: ACCENT } : undefined}
            >
              <Icon size={15} />
            </button>
          )
        })}

        <div className="mx-0.5 h-5 w-px shrink-0 bg-slate-200" />

        {/* ── Color chip + popover (inactive while erasing) ──────────────── */}
        <div ref={colorRef} className="relative">
          <button
            type="button"
            onClick={() => !isEraser && setOpenPanel(openPanel === 'color' ? null : 'color')}
            aria-label="Color"
            aria-expanded={!isEraser && openPanel === 'color'}
            disabled={isEraser}
            title="Color"
            className={`flex h-8 items-center gap-1 rounded-full border bg-white px-2 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4F7F7A]/40 disabled:cursor-not-allowed disabled:opacity-40 ${
              openPanel === 'color' ? 'border-[#4F7F7A]' : 'border-slate-200'
            }`}
          >
            <span
              className="block h-4 w-4 rounded-full border border-slate-200/60"
              style={{ backgroundColor: isEraser ? '#94a3b8' : activeColor }}
            />
            <ChevronDown size={11} className="text-slate-400" />
          </button>

          {openPanel === 'color' && !isEraser && (
            <div className="absolute left-1/2 top-full z-[55] mt-1 flex -translate-x-1/2 gap-1 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
              {COLORS.map(({ name, value }) => {
                const selected = activeColor.toLowerCase() === value.toLowerCase()
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => handleColor(value)}
                    aria-label={name}
                    aria-pressed={selected}
                    className="flex h-8 w-8 items-center justify-center rounded-full transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4F7F7A]/40"
                  >
                    <span
                      className="block h-5 w-5 rounded-full border border-slate-300/50 transition"
                      style={{
                        backgroundColor: value,
                        boxShadow: selected
                          ? `0 0 0 2px white, 0 0 0 3.5px ${ACCENT}`
                          : undefined,
                      }}
                    />
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* ── Width chip + popover (inactive while erasing) ──────────────── */}
        <div ref={widthRef} className="relative">
          <button
            type="button"
            onClick={() => !isEraser && setOpenPanel(openPanel === 'width' ? null : 'width')}
            aria-label="Stroke width"
            aria-expanded={!isEraser && openPanel === 'width'}
            disabled={isEraser}
            title="Stroke width"
            className={`flex h-8 items-center gap-1 rounded-full border bg-white px-2 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4F7F7A]/40 disabled:cursor-not-allowed disabled:opacity-40 ${
              openPanel === 'width' ? 'border-[#4F7F7A]' : 'border-slate-200'
            }`}
          >
            <WidthLine
              width={isEraser ? PEN_WIDTHS[2] : activeWidth}
              maxWidth={widthMax}
              cap={widthCap}
              color={isEraser ? '#94a3b8' : '#0b1220'}
            />
            <ChevronDown size={11} className="text-slate-400" />
          </button>

          {openPanel === 'width' && !isEraser && (
            <div className="absolute left-1/2 top-full z-[55] mt-1 flex -translate-x-1/2 flex-col gap-0.5 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
              {widths.map((w) => {
                const selected = activeWidth === w
                return (
                  <button
                    key={w}
                    type="button"
                    onClick={() => handleWidth(w)}
                    aria-label={`Width ${w}`}
                    aria-pressed={selected}
                    className="flex h-9 w-full items-center justify-center rounded-lg px-2 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4F7F7A]/40"
                    style={
                      selected
                        ? { backgroundColor: '#f0f9f8', boxShadow: `inset 0 0 0 1.5px ${ACCENT}` }
                        : undefined
                    }
                  >
                    <WidthLine width={w} maxWidth={widthMax} cap={widthCap} svgW={64} svgH={18} />
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="mx-0.5 h-5 w-px shrink-0 bg-slate-200" />

        {/* ── Undo / Redo ─────────────────────────────────────────────────── */}
        <button
          type="button"
          onClick={undo}
          disabled={!canUndo}
          aria-label="Undo"
          title="Undo"
          className={`${baseBtn} h-8 w-8`}
        >
          <Undo2 size={14} />
        </button>
        <button
          type="button"
          onClick={redo}
          disabled={!canRedo}
          aria-label="Redo"
          title="Redo"
          className={`${baseBtn} h-8 w-8`}
        >
          <Redo2 size={14} />
        </button>

        <div className="mx-0.5 h-5 w-px shrink-0 bg-slate-200" />

        {/* ── Done ────────────────────────────────────────────────────────── */}
        <button
          type="button"
          onClick={() => setWriteMode(false)}
          aria-label="Done annotating"
          title="Done"
          className="flex h-8 items-center gap-1.5 rounded-full border border-transparent px-3 text-sm font-semibold text-white shadow-sm transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4F7F7A]/60"
          style={{ backgroundColor: ACCENT }}
        >
          <Check size={14} />
          Done
        </button>
      </div>
    </div>
  )
}
