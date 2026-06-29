import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import type { SavedLoop } from '../lib/types'
import { assignLanes, laneCount } from '../lib/assignLanes'
import { placeChips, type ChipInput } from '../lib/placeChips'

export type LoopLaneStripProps = {
  loops: SavedLoop[]
  duration: number
  activeLoopId: string | null
  onSelect: (id: string) => void
  /** Open the rename flow for a loop (parent owns the name modal). */
  onRename: (id: string) => void
  onDelete: (id: string) => void
  /** Horizontal inset (px) so bars + chips line up with an inset waveform. */
  chipInset?: number
}

// Compact rail-style geometry. Bars are stacked directly (lane 0 on top, lane 1
// below, etc.) with no gap between them. Each loop's name chip floats CHIP_OFFSET
// px below the bottom edge of its own bar, overlapping the bar(s) below it.
// Chips render at higher z-index than bars so they always paint on top.
const TOP_PAD = 2 // gap below the waveform
const BAR_H = 4
const BAR_RADIUS = 2
const CHIP_OFFSET = 3 // chip top = bar bottom + CHIP_OFFSET (floats over next bar)
const CHIP_H = 16
const BOTTOM_PAD = 2
const MIN_BAR_WIDTH_PX = 10
const CHIP_GAP = 4 // min px between chips in the same lane

// Natural chip width = measured text + paddings + the ⋯ icon.
const CHIP_FONT = '600 10px'
const CHIP_TEXT_PAD = 12 // px-1.5 left + right
const CHIP_ICON_GAP = 3
const CHIP_ICON_W = 14

export default function LoopLaneStrip({
  loops,
  duration,
  activeLoopId,
  onSelect,
  onRename,
  onDelete,
  chipInset = 0,
}: LoopLaneStripProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const [fontFamily, setFontFamily] = useState('system-ui, sans-serif')
  const [menuId, setMenuId] = useState<string | null>(null)
  const measureCanvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = (w: number) => setContainerWidth(Math.round(w))
    update(el.getBoundingClientRect().width)
    const ff = getComputedStyle(el).fontFamily
    if (ff) setFontFamily(ff)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (w) update(w)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Dismiss the ⋯ menu on outside click / Escape.
  useEffect(() => {
    if (!menuId) return
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node | null
      if (target && containerRef.current?.contains(target)) {
        const within = (target as HTMLElement).closest?.('[data-loop-menu]')
        if (within) return
      }
      setMenuId(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuId(null)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuId])

  const lanes = assignLanes(loops)
  const numLanes = laneCount(lanes)
  // All bars stacked (numLanes * BAR_H), then the last chip floating below.
  const totalHeight =
    numLanes > 0 ? TOP_PAD + numLanes * BAR_H + CHIP_OFFSET + CHIP_H + BOTTOM_PAD : 0

  const innerWidth = Math.max(0, containerWidth - chipInset * 2)

  const timeToPct = useCallback(
    (t: number) => (duration > 0 ? (t / duration) * 100 : 0),
    [duration]
  )

  const barWidthPct = useCallback(
    (start: number, end: number) => {
      if (duration <= 0 || innerWidth <= 0) return 0
      const pct = ((end - start) / duration) * 100
      const minPct = (MIN_BAR_WIDTH_PX / innerWidth) * 100
      return Math.max(pct, minPct)
    },
    [duration, innerWidth]
  )

  const measureChipWidth = useCallback(
    (name: string) => {
      if (typeof document === 'undefined') return name.length * 6 + 28
      let canvas = measureCanvasRef.current
      if (!canvas) {
        canvas = document.createElement('canvas')
        measureCanvasRef.current = canvas
      }
      const ctx = canvas.getContext('2d')
      if (!ctx) return name.length * 6 + 28
      ctx.font = `${CHIP_FONT} ${fontFamily}`
      const textW = ctx.measureText(name || ' ').width
      return Math.ceil(textW) + CHIP_TEXT_PAD + CHIP_ICON_GAP + CHIP_ICON_W
    },
    [fontFamily]
  )

  // Per-row chip placement: centre each chip on its bar, offset apart on
  // collision, truncate only when offsetting can't prevent overlap.
  const chipPlacement = useMemo(() => {
    const out = new Map<string, { leftPx: number; widthPx: number }>()
    if (innerWidth <= 0 || duration <= 0) return out
    for (let lane = 0; lane < numLanes; lane++) {
      const rowChips: ChipInput[] = loops
        .filter((l) => (lanes[l.id] ?? 0) === lane)
        .map((l) => ({
          id: l.id,
          centerPx: ((l.start + l.end) / 2 / duration) * innerWidth,
          widthPx: measureChipWidth(l.name),
        }))
      for (const p of placeChips(rowChips, innerWidth, CHIP_GAP)) {
        out.set(p.id, { leftPx: p.leftPx, widthPx: p.widthPx })
      }
    }
    return out
  }, [loops, lanes, numLanes, innerWidth, duration, measureChipWidth])

  if (numLanes === 0) return null

  return (
    <div className="relative" ref={containerRef} style={{ height: totalHeight }}>
      <div className="absolute inset-y-0" style={{ left: chipInset, right: chipInset }}>
        {/* Bars layer */}
        {loops.map((loop) => {
          const lane = lanes[loop.id] ?? 0
          const top = TOP_PAD + lane * BAR_H
          const isActive = loop.id === activeLoopId
          return (
            <button
              key={`bar-${loop.id}`}
              type="button"
              onClick={() => onSelect(loop.id)}
              aria-label={loop.name}
              aria-pressed={isActive}
              className="absolute transition-[box-shadow,opacity] hover:brightness-105"
              style={{
                left: `${timeToPct(loop.start)}%`,
                width: `${barWidthPct(loop.start, loop.end)}%`,
                top,
                height: BAR_H,
                borderRadius: BAR_RADIUS,
                backgroundColor: loop.color,
                opacity: isActive ? 1 : loop.loopOn ? 0.9 : 0.55,
                zIndex: isActive ? 2 : 1,
                boxShadow: isActive
                  ? '0 0 0 1.5px rgba(255,255,255,0.95), 0 1px 3px rgba(15,23,42,0.25)'
                  : undefined,
              }}
            />
          )
        })}

        {/* Chip layer — above all bars, like the margin's chipZ band. */}
        {loops.map((loop) => {
          const lane = lanes[loop.id] ?? 0
          const top = TOP_PAD + lane * BAR_H + BAR_H + CHIP_OFFSET
          const place = chipPlacement.get(loop.id)
          if (!place) return null
          const isActive = loop.id === activeLoopId
          const isMenuOpen = menuId === loop.id
          return (
            <div
              key={`chip-${loop.id}`}
              className="absolute flex items-center rounded-md"
              style={{
                left: place.leftPx,
                top,
                maxWidth: place.widthPx,
                height: CHIP_H,
                backgroundColor: loop.color,
                zIndex: isActive || isMenuOpen ? 41 : 40,
                boxShadow: isActive
                  ? '0 0 0 1.5px rgba(255,255,255,0.95), 0 1px 3px rgba(15,23,42,0.25)'
                  : '0 1px 3px rgba(15,23,42,0.18)',
              }}
            >
              <button
                type="button"
                onClick={() => onSelect(loop.id)}
                onDoubleClick={(e) => {
                  e.preventDefault()
                  onRename(loop.id)
                }}
                title={loop.name}
                aria-label={loop.name}
                aria-pressed={isActive}
                className="min-w-0 flex-1 truncate pl-1.5 pr-0.5 text-left text-[10px] font-semibold leading-none text-white"
                style={{ textShadow: '0 1px 2px rgba(0,0,0,0.3)' }}
              >
                {loop.name}
              </button>
              <button
                type="button"
                data-loop-menu
                onClick={(e) => {
                  e.stopPropagation()
                  setMenuId((cur) => (cur === loop.id ? null : loop.id))
                }}
                aria-label={`Loop options for ${loop.name}`}
                aria-haspopup="menu"
                aria-expanded={isMenuOpen}
                className="flex h-full shrink-0 items-center rounded-r-md pl-0.5 pr-1 text-white/85 transition hover:text-white"
              >
                <MoreHorizontal size={12} strokeWidth={2.25} />
              </button>

              {isMenuOpen && (
                <div
                  data-loop-menu
                  role="menu"
                  className="absolute bottom-full right-0 z-50 mb-1 min-w-[120px] overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg shadow-black/15"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuId(null)
                      onRename(loop.id)
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-slate-700 hover:bg-slate-100"
                  >
                    <Pencil size={13} strokeWidth={2} />
                    Rename
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuId(null)
                      onDelete(loop.id)
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-red-600 hover:bg-red-50"
                  >
                    <Trash2 size={13} strokeWidth={2} />
                    Delete
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
