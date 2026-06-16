import { useCallback, useMemo, type MutableRefObject } from 'react'

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

export type GainEnvelope = {
  setGainImmediate: (value: number) => void
  rampGainTo: (value: number, seconds: number) => void
  cancelRamps: () => void
}

export const useGainEnvelope = (
  gainRef: MutableRefObject<GainNode | null>,
  valueRef?: MutableRefObject<number>
): GainEnvelope => {
  const setGainImmediate = useCallback(
    (value: number) => {
      const next = clamp01(value)
      if (valueRef) {
        valueRef.current = next
      }
      const gain = gainRef.current
      if (!gain) {
        return
      }
      const now = gain.context.currentTime
      const current = gain.gain.value
      gain.gain.cancelScheduledValues(now)
      gain.gain.setValueAtTime(current, now)
      gain.gain.setValueAtTime(next, now)
    },
    [gainRef, valueRef]
  )

  const rampGainTo = useCallback(
    (value: number, seconds: number) => {
      const next = clamp01(value)
      if (valueRef) {
        valueRef.current = next
      }
      const gain = gainRef.current
      if (!gain) {
        return
      }
      const now = gain.context.currentTime
      const current = gain.gain.value
      gain.gain.cancelScheduledValues(now)
      gain.gain.setValueAtTime(current, now)
      gain.gain.linearRampToValueAtTime(next, now + Math.max(0, seconds))
    },
    [gainRef, valueRef]
  )

  const cancelRamps = useCallback(() => {
    const gain = gainRef.current
    if (!gain) {
      return
    }
    const now = gain.context.currentTime
    const current = gain.gain.value
    gain.gain.cancelScheduledValues(now)
    gain.gain.setValueAtTime(current, now)
    if (valueRef) {
      valueRef.current = current
    }
  }, [gainRef, valueRef])

  return useMemo(
    () => ({ setGainImmediate, rampGainTo, cancelRamps }),
    [cancelRamps, rampGainTo, setGainImmediate]
  )
}
