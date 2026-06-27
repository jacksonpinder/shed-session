import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, Trash2 } from 'lucide-react'
import type { SavedLoop } from '../lib/types'
import { assignLanes, laneCount } from '../lib/assignLanes'

export type LoopLaneStripProps = {
  loops: SavedLoop[]
  duration: number
  activeLoopId: string | null
  lanesVisible: boolean
  onSelect: (id: string) => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
  /** Tapping the blurred collapsed peek zone expands the lane. */
  onExpand: () => void
  /** Tapping the expanded lane's bottom bumper collapses it. */
  onCollapse: () => void
  /** Horizontal inset (px) for the expanded chips, so they line up with the
   * inset waveform while the peek + bumper still run full-bleed to the edges. */
  chipInset?: number
}

const LANE_H = 20
const LANE_GAP = 8
const LANE_PAD = 8
const MIN_BAR_WIDTH_PX = 10

// Collapsed "whisper layer" (LG design): each lane persists as a micro-row whose
// height + opacity recede with depth, the whole zone blurred to read as texture.
const PEEK_ROW_HEIGHTS = [5, 4, 3] // lane 0, 1, 2+ (clamped to last)
const PEEK_ROW_OPACITIES = [1, 0.7, 0.45]
const PEEK_ROW_GAP = 2
const peekRowHeight = (lane: number) =>
  PEEK_ROW_HEIGHTS[Math.min(lane, PEEK_ROW_HEIGHTS.length - 1)]
const peekRowOpacity = (lane: number) =>
  PEEK_ROW_OPACITIES[Math.min(lane, PEEK_ROW_OPACITIES.length - 1)]

// Gap above the first loop (below the waveform): lets the blur fade out before
// it meets the waveform and widens the tap-to-expand target.
const LANE_TOP_PAD = 4
// Reserved strip at the lane bottom for the centered "Loops" pill, so the pill
// never overlaps a loop. Loops draw above it; the strip stays click-to-collapse.
const LANE_BOTTOM_CLEARANCE = 4
// Matches `--waveform-edge-pad` in tailwind.css so lane bars line up with the
// waveform peaks above them. The waveform fills its host edge-to-edge (no
// internal scroll padding), so bars span the full width too.
const EDGE_PAD = 0

export default function LoopLaneStrip({
  loops,
  duration,
  activeLoopId,
  lanesVisible,
  onSelect,
  onRename,
  onDelete,
  onExpand,
  onCollapse,
  chipInset = 0,
}: LoopLaneStripProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const editInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = (w: number) => setContainerWidth(Math.round(w))
    update(el.getBoundingClientRect().width)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (w) update(w)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const lanes = assignLanes(loops)
  const numLanes = laneCount(lanes)
  const laneAreaH =
    numLanes > 0
      ? LANE_PAD + numLanes * (LANE_H + LANE_GAP) - LANE_GAP + LANE_BOTTOM_CLEARANCE
      : 0

  // Collapsed peek: a 4px top gap (blur fade + tap area), the micro-rows, then a
  // bottom clearance strip for the centered pill.
  let peekRowsH = 0
  for (let lane = 0; lane < numLanes; lane++) {
    peekRowsH += peekRowHeight(lane) + (lane > 0 ? PEEK_ROW_GAP : 0)
  }
  const peekH = numLanes > 0 ? LANE_TOP_PAD + peekRowsH + LANE_BOTTOM_CLEARANCE : 0

  // Bars are positioned within an inset layer that matches the waveform's
  // edge padding, so a loop's bar sits directly under its waveform region.
  const innerWidth = Math.max(0, containerWidth - EDGE_PAD * 2)

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

  const startEdit = (loop: SavedLoop) => {
    setEditingId(loop.id)
    setEditValue(loop.name)
    setTimeout(() => {
      editInputRef.current?.select()
    }, 0)
  }

  const commitEdit = (loop: SavedLoop) => {
    const v = editValue.trim()
    if (v && v !== loop.name) onRename(loop.id, v)
    setEditingId(null)
  }

  return (
    <div className="relative" ref={containerRef}>
      {/* Lane area — animates between the full lane height and the collapsed peek. */}
      <div
        className="relative w-full overflow-hidden transition-[height] duration-200 ease-out motion-reduce:transition-none"
        style={{ height: lanesVisible ? laneAreaH : peekH }}
        aria-hidden={!lanesVisible && numLanes === 0}
      >
        {/* Collapsed "whisper layer": blurred micro-rows preserving chip proportions.
            The whole zone is a single tap target that expands the lane. */}
        {!lanesVisible && numLanes > 0 && (
          <button
            type="button"
            onClick={onExpand}
            aria-label="Show loop lanes"
            className="absolute inset-0 flex flex-col justify-start"
            style={{
              left: EDGE_PAD,
              right: EDGE_PAD,
              paddingTop: LANE_TOP_PAD,
              gap: PEEK_ROW_GAP,
              filter: 'blur(2px)',
              opacity: 0.45,
              cursor: 'pointer',
            }}
          >
            {Array.from({ length: numLanes }, (_, lane) => (
              <div
                key={lane}
                className="relative w-full"
                style={{ height: peekRowHeight(lane), opacity: peekRowOpacity(lane) }}
              >
                {loops
                  .filter((loop) => (lanes[loop.id] ?? 0) === lane)
                  .map((loop) => (
                    <div
                      key={loop.id}
                      className="absolute top-0 h-full rounded-[3px]"
                      style={{
                        left: `${timeToPct(loop.start)}%`,
                        width: `${barWidthPct(loop.start, loop.end)}%`,
                        backgroundColor: loop.color,
                        pointerEvents: 'none',
                      }}
                    />
                  ))}
              </div>
            ))}
          </button>
        )}

        {/* Full-height collapse target: the whole expanded lane background collapses
            on click, with a hover wash + chevron across the full height. Sits BEHIND
            the chip layer (which is click-through except the chips themselves). */}
        {lanesVisible && numLanes > 0 && (
          <button
            type="button"
            onClick={onCollapse}
            aria-label="Hide loop lanes"
            className="group absolute inset-0 flex items-end justify-center"
            style={{ cursor: 'pointer' }}
          >
            <span className="absolute inset-0 bg-gradient-to-t from-black/[0.05] via-black/[0.02] to-transparent opacity-0 transition-opacity duration-150 group-hover:opacity-100" />
            <ChevronDown
              size={10}
              strokeWidth={2.5}
              className="relative mb-1 text-slate-400 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
            />
          </button>
        )}

        {/* Inset positioning layer aligned to the waveform peaks. Click-through so the
            collapse target behind it receives taps on empty space; the chips opt back
            in to pointer events. Hidden while collapsed. */}
        <div
          className="absolute inset-y-0"
          style={{
            left: EDGE_PAD + chipInset,
            right: EDGE_PAD + chipInset,
            opacity: lanesVisible ? 1 : 0,
            pointerEvents: 'none',
          }}
        >
          {loops.map((loop) => {
            const lane = lanes[loop.id] ?? 0
            const top = LANE_PAD + lane * (LANE_H + LANE_GAP)
            const leftPct = timeToPct(loop.start)
            const widthPct = barWidthPct(loop.start, loop.end)
            const isActive = loop.id === activeLoopId
            const isEditing = loop.id === editingId
            const showLabel =
              innerWidth > 0 && (widthPct / 100) * innerWidth > 44

            return (
              <div
                key={loop.id}
                className="group absolute"
                style={{ left: `${leftPct}%`, width: `${widthPct}%`, top, height: LANE_H, pointerEvents: 'auto' }}
              >
                <button
                  type="button"
                  title={isEditing ? undefined : loop.name}
                  onClick={() => {
                    if (!isEditing) onSelect(loop.id)
                  }}
                  onDoubleClick={(e) => {
                    e.preventDefault()
                    startEdit(loop)
                  }}
                  className="absolute inset-0 flex items-center overflow-hidden rounded transition-[opacity] hover:brightness-105"
                  style={{
                    backgroundColor: loop.color,
                    opacity: isActive ? 1 : loop.loopOn ? 0.9 : 0.55,
                    zIndex: isActive ? 2 : 1,
                    boxShadow: isActive
                      ? '0 0 0 2px rgba(255,255,255,0.9), 0 0 0 3.5px rgba(0,0,0,0.18)'
                      : undefined,
                  }}
                  aria-pressed={isActive}
                  aria-label={loop.name}
                >
                  {isEditing ? (
                    <input
                      ref={editInputRef}
                      className="absolute inset-0 w-full bg-transparent px-1.5 text-[10px] font-medium text-white outline-none"
                      style={{ textShadow: '0 1px 2px rgba(0,0,0,0.3)' }}
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={() => commitEdit(loop)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur()
                        if (e.key === 'Escape') setEditingId(null)
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    showLabel && (
                      <span
                        className="truncate px-1.5 text-[10px] font-medium leading-tight text-white"
                        style={{ textShadow: '0 1px 2px rgba(0,0,0,0.3)' }}
                      >
                        {loop.name}
                      </span>
                    )
                  )}
                </button>

                {/* Delete button — visible on hover or when active */}
                {!isEditing && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onDelete(loop.id)
                    }}
                    className={`pointer-events-auto absolute right-0.5 top-0.5 z-10 flex h-3.5 w-3.5 items-center justify-center rounded text-white/80 transition hover:bg-black/20 hover:text-white ${
                      isActive
                        ? 'opacity-100'
                        : 'opacity-0 group-hover:opacity-100'
                    }`}
                    style={{ zIndex: 10 }}
                    aria-label={`Delete ${loop.name}`}
                  >
                    <Trash2 size={9} strokeWidth={2} />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
