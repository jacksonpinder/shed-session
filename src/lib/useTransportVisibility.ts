import { useCallback, useEffect, useRef, useState } from 'react'

type TransportMode = 'expanded' | 'collapsed'

type UseTransportVisibilityInput = {
  isPointerDown: boolean
  isInTransport: boolean
  autoHideEnabled?: boolean
}

type UseTransportVisibilityOutput = {
  mode: TransportMode
  reveal: (reason: string) => void
  scheduleCollapse: (reason: string, delayMs?: number) => void
  cancelCollapse: (reason: string) => void
}

const AUTOHIDE_MS = 2500

export const useTransportVisibility = ({
  isPointerDown,
  isInTransport,
  autoHideEnabled = true,
}: UseTransportVisibilityInput): UseTransportVisibilityOutput => {
  // Start in expanded mode.
  const [mode, setMode] = useState<TransportMode>('expanded')
  const timerRef = useRef<number | null>(null)
  const pendingRef = useRef<{ reason: string; delayMs: number } | null>(null)
  const lastReasonRef = useRef('init')
  const isPointerDownRef = useRef(isPointerDown)
  const isInTransportRef = useRef(isInTransport)
  const autoHideEnabledRef = useRef(autoHideEnabled)

  useEffect(() => {
    isPointerDownRef.current = isPointerDown
  }, [isPointerDown])

  useEffect(() => {
    isInTransportRef.current = isInTransport
  }, [isInTransport])

  useEffect(() => {
    autoHideEnabledRef.current = autoHideEnabled
  }, [autoHideEnabled])

  const clearTimer = useCallback(() => {
    if (timerRef.current === null) {
      return
    }
    window.clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  const shouldHoldOpen = useCallback(
    () => isPointerDownRef.current || isInTransportRef.current,
    []
  )

  const startTimer = useCallback(
    (reason: string, delayMs: number) => {
      clearTimer()
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null
        if (!autoHideEnabledRef.current) {
          return
        }
        // Never collapse while scrubbing or interacting with transport.
        if (shouldHoldOpen()) {
          pendingRef.current = { reason, delayMs }
          setMode('expanded')
          return
        }
        pendingRef.current = null
        setMode('collapsed')
      }, delayMs)
    },
    [clearTimer, shouldHoldOpen]
  )

  const scheduleCollapse = useCallback(
    (reason: string, delayMs: number = AUTOHIDE_MS) => {
      lastReasonRef.current = reason
      pendingRef.current = { reason, delayMs }
      // Only schedule when auto-hide is enabled.
      if (!autoHideEnabledRef.current) {
        clearTimer()
        return
      }
      if (shouldHoldOpen()) {
        setMode('expanded')
        return
      }
      // Collapse after the provided delay (default 2500ms).
      startTimer(reason, delayMs)
    },
    [clearTimer, shouldHoldOpen, startTimer]
  )

  const reveal = useCallback(
    (reason: string) => {
      lastReasonRef.current = reason
      // Reveal immediately and cancel any pending collapse.
      pendingRef.current = null
      clearTimer()
      setMode('expanded')
    },
    [clearTimer]
  )

  const cancelCollapse = useCallback(
    (reason: string) => {
      lastReasonRef.current = reason
      pendingRef.current = null
      clearTimer()
    },
    [clearTimer]
  )

  useEffect(() => {
    if (!autoHideEnabled) {
      cancelCollapse('auto-hide-disabled')
      setMode('expanded')
    }
  }, [autoHideEnabled, cancelCollapse])

  useEffect(() => () => clearTimer(), [clearTimer])

  useEffect(() => {
    if (!autoHideEnabledRef.current) {
      return
    }
    if (shouldHoldOpen()) {
      clearTimer()
      setMode('expanded')
      return
    }
    // If interaction ended, delay collapse until after the stored timer.
    if (pendingRef.current && timerRef.current === null) {
      startTimer(pendingRef.current.reason, pendingRef.current.delayMs)
    }
  }, [clearTimer, isInTransport, isPointerDown, shouldHoldOpen, startTimer])

  return { mode, reveal, scheduleCollapse, cancelCollapse }
}
