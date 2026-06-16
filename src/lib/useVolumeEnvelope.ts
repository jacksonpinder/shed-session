import { useCallback, useEffect, useMemo, useRef } from 'react'

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

const easeInOut = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * t)

export type VolumeEnvelope = {
  rampTo: (target: number, durationMs: number) => void
  setImmediately: (value: number) => void
  cancel: () => void
}

export const useVolumeEnvelope = (setVolume: (value: number) => void): VolumeEnvelope => {
  const rafIdRef = useRef<number | null>(null)
  const startTimeRef = useRef(0)
  const durationRef = useRef(0)
  const fromValueRef = useRef(1)
  const toValueRef = useRef(1)
  const currentValueRef = useRef(1)

  const cancel = useCallback(() => {
    if (rafIdRef.current !== null) {
      window.cancelAnimationFrame(rafIdRef.current)
      rafIdRef.current = null
    }
  }, [])

  const setImmediately = useCallback(
    (value: number) => {
      const next = clamp01(value)
      cancel()
      currentValueRef.current = next
      setVolume(next)
    },
    [cancel, setVolume]
  )

  const rampTo = useCallback(
    (target: number, durationMs: number) => {
      const nextTarget = clamp01(target)
      if (!Number.isFinite(durationMs) || durationMs <= 0) {
        setImmediately(nextTarget)
        return
      }
      cancel()
      fromValueRef.current = currentValueRef.current
      toValueRef.current = nextTarget
      durationRef.current = durationMs
      startTimeRef.current = performance.now()

      const step = (now: number) => {
        const elapsed = now - startTimeRef.current
        const progress = Math.min(1, Math.max(0, elapsed / durationRef.current))
        const eased = easeInOut(progress)
        const nextValue =
          fromValueRef.current + (toValueRef.current - fromValueRef.current) * eased
        currentValueRef.current = nextValue
        setVolume(nextValue)
        if (progress < 1) {
          rafIdRef.current = window.requestAnimationFrame(step)
        } else {
          rafIdRef.current = null
        }
      }

      rafIdRef.current = window.requestAnimationFrame(step)
    },
    [cancel, setImmediately, setVolume]
  )

  useEffect(() => cancel, [cancel])

  return useMemo(
    () => ({ rampTo, setImmediately, cancel }),
    [rampTo, setImmediately, cancel]
  )
}
