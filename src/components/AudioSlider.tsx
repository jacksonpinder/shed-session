import {
  useCallback,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'

const ACCENT = '#4F7F7A'

type AudioSliderProps = {
  value: number
  min: number
  max: number
  step: number
  /** The neutral value the fill emanates from and the detent snaps to. */
  center?: number
  /** Magnetic detent radius (in value units) around center. 0 disables it. */
  snapThreshold?: number
  /**
   * When true (default), onChange fires continuously as the user drags.
   * When false, the thumb tracks the drag visually but onChange only fires on
   * release (pointer up / keyboard) — used by transpose to avoid the audible
   * worklet "catch" on every intermediate value.
   */
  live?: boolean
  onChange: (value: number) => void
  leftLabel?: ReactNode
  rightLabel?: ReactNode
  /**
   * Rendered centered on the min/max label row. Receives the live display
   * value and whether a drag is in progress, so callers can show a value
   * preview while dragging and a Reset affordance otherwise.
   */
  centerSlot?: (value: number, dragging: boolean) => ReactNode
  ariaLabel?: string
  formatValue?: (value: number) => string
}

const decimalsForStep = (step: number) => {
  if (Number.isInteger(step)) return 0
  const text = step.toString()
  const dot = text.indexOf('.')
  return dot === -1 ? 0 : text.length - dot - 1
}

export function AudioSlider({
  value,
  min,
  max,
  step,
  center = 0,
  snapThreshold = 0,
  live = true,
  onChange,
  leftLabel,
  rightLabel,
  centerSlot,
  ariaLabel,
  formatValue,
}: AudioSliderProps) {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const draggingRef = useRef(false)
  const [dragValue, setDragValue] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)
  const decimals = decimalsForStep(step)

  const display = dragValue ?? value
  const toFrac = (v: number) => (max === min ? 0 : (v - min) / (max - min))
  const centerFrac = toFrac(center)
  const thumbFrac = Math.min(1, Math.max(0, toFrac(display)))
  const fillLeft = Math.min(centerFrac, thumbFrac) * 100
  const fillWidth = Math.abs(thumbFrac - centerFrac) * 100

  // Snap a raw value to the step grid, with a magnetic detent around center.
  const quantize = useCallback(
    (raw: number) => {
      if (Math.abs(raw - center) <= snapThreshold) return center
      let v = Math.round((raw - min) / step) * step + min
      v = Math.min(max, Math.max(min, v))
      if (decimals > 0) v = Number(v.toFixed(decimals))
      if (Math.abs(v - center) <= snapThreshold) return center
      return v
    },
    [center, snapThreshold, min, max, step, decimals]
  )

  const valueFromClientX = useCallback(
    (clientX: number) => {
      const rect = trackRef.current?.getBoundingClientRect()
      if (!rect || rect.width === 0) return value
      const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
      return quantize(min + frac * (max - min))
    },
    [quantize, min, max, value]
  )

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.currentTarget.focus()
      try {
        trackRef.current?.setPointerCapture?.(event.pointerId)
      } catch {
        // Ignore — capture is a nicety; drag still works via the element handlers.
      }
      draggingRef.current = true
      setDragging(true)
      const next = valueFromClientX(event.clientX)
      setDragValue(next)
      if (live) onChange(next)
    },
    [valueFromClientX, live, onChange]
  )

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return
      const next = valueFromClientX(event.clientX)
      setDragValue(next)
      if (live) onChange(next)
    },
    [valueFromClientX, live, onChange]
  )

  const handlePointerUp = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return
      draggingRef.current = false
      setDragging(false)
      const next = valueFromClientX(event.clientX)
      onChange(next)
      // Keep dragValue until the next frame so the thumb does not flicker
      // back to the old position before the parent's value lands. We clear
      // it unconditionally (not by waiting for value to match dragValue) —
      // if a later external change (e.g. a Reset button) sets a different
      // value while dragValue is still set, waiting for a match would never
      // happen and the thumb would stay stuck at the drag position forever.
      setDragValue(next)
      requestAnimationFrame(() => {
        if (!draggingRef.current) setDragValue(null)
      })
    },
    [valueFromClientX, onChange]
  )

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      let next: number | null = null
      if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = quantize(value - step)
      else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = quantize(value + step)
      else if (event.key === 'Home') next = min
      else if (event.key === 'End') next = max
      if (next !== null) {
        event.preventDefault()
        onChange(next)
      }
    },
    [quantize, value, step, min, max, onChange]
  )

  const uncommitted = dragging && !live

  return (
    <div className="select-none">
      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label={ariaLabel}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={display}
        aria-valuetext={formatValue?.(display)}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onKeyDown={handleKeyDown}
        className="relative h-6 cursor-pointer touch-none rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4F7F7A]/40 focus-visible:ring-offset-2"
      >
        {/* track */}
        <div className="pointer-events-none absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-slate-200" />
        {/* center tick */}
        <div
          className="pointer-events-none absolute top-1/2 h-3 w-px -translate-x-1/2 -translate-y-1/2 rounded-full bg-slate-300"
          style={{ left: `${centerFrac * 100}%` }}
        />
        {/* center-out fill */}
        <div
          className="pointer-events-none absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full"
          style={{
            left: `${fillLeft}%`,
            width: `${fillWidth}%`,
            backgroundColor: ACCENT,
            opacity: uncommitted ? 0.45 : 1,
          }}
        />
        {/* thumb */}
        <div
          className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-white shadow-sm"
          style={{
            left: `${thumbFrac * 100}%`,
            borderColor: ACCENT,
            opacity: uncommitted ? 0.7 : 1,
          }}
        />
      </div>
      {(leftLabel || rightLabel || centerSlot) && (
        <div className="mt-0 flex items-center justify-between gap-2">
          <span className="text-[10px] font-medium text-slate-400">
            {leftLabel}
          </span>
          <span className="flex min-h-[18px] items-center">
            {centerSlot?.(display, dragging)}
          </span>
          <span className="text-[10px] font-medium text-slate-400">
            {rightLabel}
          </span>
        </div>
      )}
    </div>
  )
}
