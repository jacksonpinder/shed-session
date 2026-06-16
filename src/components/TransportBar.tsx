import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  forwardRef,
  type PointerEventHandler,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from 'react'
import {
  ArrowDown,
  ArrowUp,
  Headphones,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
} from 'lucide-react'
import { AudioSlider } from './AudioSlider'

const SEEK_SECONDS = 15
const SEEK_HOLD_DELAY_MS_MOUSE = 260
const SEEK_HOLD_DELAY_MS_TOUCH = 320
const SEEK_HOLD_SLOP_PX_MOUSE = 6
const SEEK_HOLD_SLOP_PX_TOUCH = 12
const SEEK_HOLD_BUTTON_SIZE_PX = 48
const SEEK_HOLD_HIT_PADDING_PX = 10
const SEEK_HOLD_HIT_PADDING_TOUCH_PX = 18
const SEEK_HOLD_ORIGIN_PADDING_PX = 12
const SEEK_HOLD_ORIGIN_PADDING_TOUCH_PX = 20
const SEEK_HOLD_OFFSETS_BY_DIRECTION = {
  back: [
    { x: -65, y: 10 },
    { x: -40, y: -40 },
    { x: 10, y: -65 },
  ],
  forward: [
    { x: -10, y: -65 },
    { x: 40, y: -40 },
    { x: 65, y: 10 },
  ],
} as const
const SEEK_HOLD_DELTAS = {
  back: [-30, -10, -5],
  forward: [5, 10, 30],
} as const
const SEEK_TOAST_DURATION_MS = 650
const TRANSPOSE_MIN = -5
const TRANSPOSE_MAX = 5
const TRANSPOSE_GLYPH = '♭♯'
const SPEED_MIN = 0.5
const SPEED_MAX = 1.5
// Musical interval by semitone distance: quality (flat / Major / Perfect) +
// scale degree. The flat glyph renders as superscript; the M/P quality letters
// render smaller and lighter than the degree number.
const TRANSPOSE_INTERVALS: Record<number, { quality: 'flat' | 'M' | 'P'; degree: string }> = {
  1: { quality: 'flat', degree: '2' },
  2: { quality: 'M', degree: '2' },
  3: { quality: 'flat', degree: '3' },
  4: { quality: 'M', degree: '3' },
  5: { quality: 'P', degree: '4' },
}
const renderTransposeLabel = (semitones: number): ReactNode => {
  if (semitones === 0) {
    // Neutral glyph on the button — sized up so the flat/sharp pair reads clearly.
    return <span className="text-[1.4em] leading-none">{TRANSPOSE_GLYPH}</span>
  }
  const part = TRANSPOSE_INTERVALS[Math.abs(semitones)] ?? {
    quality: 'M' as const,
    degree: String(Math.abs(semitones)),
  }
  return (
    <span className="inline-flex items-baseline leading-none">
      {semitones > 0 ? (
        <ArrowUp size={12} strokeWidth={2.5} className="shrink-0" />
      ) : (
        <ArrowDown size={12} strokeWidth={2.5} className="shrink-0" />
      )}
      {part.quality === 'flat' ? (
        // Flat at the same baseline and size as the degree — not superscript.
        <span className="font-normal">♭</span>
      ) : (
        // M / P render at the same size and weight as the degree number.
        <span>{part.quality}</span>
      )}
      <span>{part.degree}</span>
    </span>
  )
}
// Always keep at least one decimal (1.0x, 1.5x, 0.95x) — never a bare "1x".
const formatSpeedLabel = (rate: number) => `${rate.toFixed(2).replace(/0$/, '')}x`
const formatSeekLabel = (delta: number) => `${delta > 0 ? '+' : ''}${delta}`
const getHoldDelayMs = (pointerType: string) =>
  pointerType === 'mouse' ? SEEK_HOLD_DELAY_MS_MOUSE : SEEK_HOLD_DELAY_MS_TOUCH
const getHoldSlopPx = (pointerType: string) =>
  pointerType === 'mouse' ? SEEK_HOLD_SLOP_PX_MOUSE : SEEK_HOLD_SLOP_PX_TOUCH

export type TransportBarMode = 'expanded' | 'collapsed'
type SeekHoldDirection = keyof typeof SEEK_HOLD_DELTAS

type TransportBarProps = {
  mode?: TransportBarMode
  containerRef?: Ref<HTMLDivElement>
  onPointerEnter?: PointerEventHandler<HTMLDivElement>
  onPointerLeave?: PointerEventHandler<HTMLDivElement>
  onPointerDown?: PointerEventHandler<HTMLDivElement>
  onPointerUp?: PointerEventHandler<HTMLDivElement>
  onPointerCancel?: PointerEventHandler<HTMLDivElement>
  onSeekExtensionChange?: (isOpen: boolean) => void
  isPlaying: boolean
  playbackRate: number
  balance: number
  mono: boolean
  isStereoSource: boolean
  transpose: number
  seekBy: (delta: number) => void
  togglePlay: () => void
  setPlaybackRate: (rate: number) => void
  setBalance: (value: number) => void
  setMono: (value: boolean) => void
  setTranspose: (semitones: number) => void
}

const TransportBarShell = ({
  mode,
  children,
  style,
}: {
  mode: TransportBarMode
  children: ReactNode
  style?: CSSProperties
}) => (
  <div
    className={`inline-flex items-center justify-center rounded-full motion-reduce:transition-none motion-reduce:transform-none ${
      mode === 'collapsed'
        ? 'border border-transparent bg-transparent shadow-none px-0'
        : 'border border-white/70 bg-white/60 shadow-lg shadow-black/10 backdrop-blur-md dark:border-slate-700/60 dark:bg-slate-900/60 dark:shadow-black/40'
    } transition-[background-color,border-color,box-shadow,opacity,transform,width] duration-[260ms] ease-in-out ${
      mode === 'collapsed'
        ? 'py-2 opacity-100 origin-bottom scale-[0.8] sm:scale-100'
        : 'py-2 opacity-100'
    }`}
    style={style}
    data-mode={mode}
    data-dock-shell="true"
  >
    {children}
  </div>
)

const TransportControls = forwardRef<
  HTMLDivElement,
  { children: ReactNode; className?: string }
>(({ children, className }, ref) => (
  <div ref={ref} className={`flex items-center ${className ?? 'gap-3'}`}>
    {children}
  </div>
))

TransportControls.displayName = 'TransportControls'

const ExpandedControls = forwardRef<
  HTMLDivElement,
  { children: ReactNode; className?: string }
>(({ children, className }, ref) => (
  <TransportControls ref={ref} className={className}>
    {children}
  </TransportControls>
))

ExpandedControls.displayName = 'ExpandedControls'

const CollapsedControls = forwardRef<
  HTMLDivElement,
  { children: ReactNode; className?: string }
>(({ children, className }, ref) => (
  <TransportControls ref={ref} className={className}>
    {children}
  </TransportControls>
))

CollapsedControls.displayName = 'CollapsedControls'

export default function TransportBar({
  mode = 'expanded',
  containerRef,
  onPointerEnter,
  onPointerLeave,
  onPointerDown,
  onPointerUp,
  onPointerCancel,
  onSeekExtensionChange,
  isPlaying,
  playbackRate,
  balance,
  mono,
  isStereoSource,
  transpose,
  seekBy,
  togglePlay,
  setPlaybackRate,
  setBalance,
  setMono,
  setTranspose,
}: TransportBarProps) {
  const speedButtonRef = useRef<HTMLButtonElement | null>(null)
  const backButtonRef = useRef<HTMLButtonElement | null>(null)
  const forwardButtonRef = useRef<HTMLButtonElement | null>(null)
  const backHoldRootRef = useRef<HTMLDivElement | null>(null)
  const forwardHoldRootRef = useRef<HTMLDivElement | null>(null)
  const expandedControlsRef = useRef<HTMLDivElement | null>(null)
  const collapsedControlsRef = useRef<HTMLDivElement | null>(null)
  const seekToastCounterRef = useRef(0)
  const holdTimerRef = useRef<number | null>(null)
  const holdPointerRef = useRef<{
    id: number
    direction: SeekHoldDirection
    pointerType: string
    startX: number
    startY: number
  } | null>(null)
  const holdActiveRef = useRef(false)
  const suppressSeekClickRef = useRef({ back: false, forward: false })
  const backToastTimeoutRef = useRef<number | null>(null)
  const forwardToastTimeoutRef = useRef<number | null>(null)
  const [shellWidth, setShellWidth] = useState<number | null>(null)
  const [expandedScale, setExpandedScale] = useState(1)
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false)
  const [seekHoldOpen, setSeekHoldOpen] = useState<SeekHoldDirection | null>(null)
  const [seekHoldHoverIndex, setSeekHoldHoverIndex] = useState<number | null>(null)
  const seekHoldOpenRef = useRef<SeekHoldDirection | null>(null)
  const [backToastToken, setBackToastToken] = useState<number | null>(null)
  const [forwardToastToken, setForwardToastToken] = useState<number | null>(null)
  const [backToastLabel, setBackToastLabel] = useState(formatSeekLabel(-SEEK_SECONDS))
  const [forwardToastLabel, setForwardToastLabel] = useState(formatSeekLabel(SEEK_SECONDS))
  const [backToastOffset, setBackToastOffset] = useState(20)
  const [forwardToastOffset, setForwardToastOffset] = useState(20)
  const speedPopoverRef = useRef<HTMLDivElement | null>(null)
  const [balanceOpen, setBalanceOpen] = useState(false)
  const headphonesRef = useRef<HTMLButtonElement | null>(null)
  const balancePopoverRef = useRef<HTMLDivElement | null>(null)
  const [transposeOpen, setTransposeOpen] = useState(false)
  const transposeButtonRef = useRef<HTMLButtonElement | null>(null)
  const transposePopoverRef = useRef<HTMLDivElement | null>(null)

  const setSeekHoldOpenState = useCallback(
    (next: SeekHoldDirection | null) => {
      if (seekHoldOpenRef.current === next) {
        return
      }
      seekHoldOpenRef.current = next
      setSeekHoldOpen(next)
      if (next === null) {
        setSeekHoldHoverIndex(null)
      }
      onSeekExtensionChange?.(next !== null)
    },
    [onSeekExtensionChange]
  )

  useEffect(() => {
    if (!speedMenuOpen) {
      return
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (
        speedButtonRef.current?.contains(target) ||
        speedPopoverRef.current?.contains(target)
      ) {
        return
      }
      setSpeedMenuOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [speedMenuOpen])

  useEffect(() => {
    if (!balanceOpen) {
      return
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (
        headphonesRef.current?.contains(target) ||
        balancePopoverRef.current?.contains(target)
      ) {
        return
      }
      setBalanceOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [balanceOpen])

  useEffect(() => {
    if (!transposeOpen) {
      return
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (
        transposeButtonRef.current?.contains(target) ||
        transposePopoverRef.current?.contains(target)
      ) {
        return
      }
      setTransposeOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [transposeOpen])

  useEffect(() => {
    if (!seekHoldOpen) {
      return
    }
    const root =
      seekHoldOpen === 'back' ? backHoldRootRef.current : forwardHoldRootRef.current
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (root && target && root.contains(target)) {
        return
      }
      setSeekHoldOpenState(null)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [seekHoldOpen, setSeekHoldOpenState])

  useEffect(() => {
    return () => {
      if (backToastTimeoutRef.current !== null) {
        window.clearTimeout(backToastTimeoutRef.current)
      }
      if (forwardToastTimeoutRef.current !== null) {
        window.clearTimeout(forwardToastTimeoutRef.current)
      }
      if (holdTimerRef.current !== null) {
        window.clearTimeout(holdTimerRef.current)
        holdTimerRef.current = null
      }
    }
  }, [])

  const speedLabel = useMemo(() => formatSpeedLabel(playbackRate), [playbackRate])

  const getSeekToastOffset = useCallback((button: HTMLButtonElement | null) => {
    if (!button) {
      return 20
    }
    const height = button.getBoundingClientRect().height
    return Math.round(height * 0.7 + 14)
  }, [])

  const triggerSeekToast = useCallback(
    (direction: 'back' | 'forward', button: HTMLButtonElement | null, label: string) => {
      const nextToken = (seekToastCounterRef.current += 1)
      if (direction === 'back') {
        setBackToastLabel(label)
        setBackToastOffset(getSeekToastOffset(button))
        setBackToastToken(nextToken)
        if (backToastTimeoutRef.current !== null) {
          window.clearTimeout(backToastTimeoutRef.current)
        }
        backToastTimeoutRef.current = window.setTimeout(() => {
          setBackToastToken(null)
          backToastTimeoutRef.current = null
        }, SEEK_TOAST_DURATION_MS)
        return
      }
      setForwardToastLabel(label)
      setForwardToastOffset(getSeekToastOffset(button))
      setForwardToastToken(nextToken)
      if (forwardToastTimeoutRef.current !== null) {
        window.clearTimeout(forwardToastTimeoutRef.current)
      }
      forwardToastTimeoutRef.current = window.setTimeout(() => {
        setForwardToastToken(null)
        forwardToastTimeoutRef.current = null
      }, SEEK_TOAST_DURATION_MS)
    },
    [getSeekToastOffset]
  )

  const clearHoldTimer = useCallback(() => {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
    }
  }, [])

  const closeSeekHold = useCallback(() => {
    setSeekHoldOpenState(null)
  }, [setSeekHoldOpenState])

  const getHoldOptionAtPoint = useCallback(
    (
      direction: SeekHoldDirection,
      clientX: number,
      clientY: number,
      pointerType: string,
      anchorButton: HTMLButtonElement | null
    ) => {
      if (!anchorButton) {
        return null
      }
      const rect = anchorButton.getBoundingClientRect()
      if (!rect.width || !rect.height) {
        return null
      }
      const centerX = rect.left + rect.width / 2
      const centerY = rect.top + rect.height / 2
      const hitPadding =
        pointerType === 'mouse' ? SEEK_HOLD_HIT_PADDING_PX : SEEK_HOLD_HIT_PADDING_TOUCH_PX
      const radius = SEEK_HOLD_BUTTON_SIZE_PX / 2 + hitPadding
      const radiusSq = radius * radius
      const deltas = SEEK_HOLD_DELTAS[direction]
      for (let index = 0; index < deltas.length; index += 1) {
        const offset = SEEK_HOLD_OFFSETS_BY_DIRECTION[direction][index]
        const dx = clientX - (centerX + offset.x)
        const dy = clientY - (centerY + offset.y)
        if (dx * dx + dy * dy <= radiusSq) {
          return { delta: deltas[index], index }
        }
      }
      return null
    },
    []
  )

  const isPointOnButton = useCallback(
    (button: HTMLButtonElement | null, clientX: number, clientY: number, pointerType: string) => {
      if (!button) {
        return false
      }
      const rect = button.getBoundingClientRect()
      if (!rect.width || !rect.height) {
        return false
      }
      const padding =
        pointerType === 'mouse'
          ? SEEK_HOLD_ORIGIN_PADDING_PX
          : SEEK_HOLD_ORIGIN_PADDING_TOUCH_PX
      return (
        clientX >= rect.left - padding &&
        clientX <= rect.right + padding &&
        clientY >= rect.top - padding &&
        clientY <= rect.bottom + padding
      )
    },
    []
  )

  const applySeekDelta = useCallback(
    (direction: SeekHoldDirection, delta: number) => {
      seekBy(delta)
      triggerSeekToast(
        direction,
        direction === 'back' ? backButtonRef.current : forwardButtonRef.current,
        formatSeekLabel(delta)
      )
    },
    [seekBy, triggerSeekToast]
  )

  const handleSeekClick = useCallback(
    (direction: SeekHoldDirection) => () => {
      if (suppressSeekClickRef.current[direction]) {
        suppressSeekClickRef.current[direction] = false
        return
      }
      if (seekHoldOpen) {
        setSeekHoldOpenState(null)
      }
      const delta = direction === 'back' ? -SEEK_SECONDS : SEEK_SECONDS
      applySeekDelta(direction, delta)
    },
    [applySeekDelta, seekHoldOpen, setSeekHoldOpenState]
  )

  const handleSeekPointerDown = useCallback(
    (direction: SeekHoldDirection) => (event: React.PointerEvent<HTMLButtonElement>) => {
      if (event.pointerType === 'mouse' && event.button !== 0) {
        return
      }
      if (seekHoldOpen && seekHoldOpen !== direction) {
        setSeekHoldOpenState(null)
      }
      suppressSeekClickRef.current[direction] = false
      holdActiveRef.current = false
      holdPointerRef.current = {
        id: event.pointerId,
        direction,
        pointerType: event.pointerType,
        startX: event.clientX,
        startY: event.clientY,
      }
      clearHoldTimer()
      event.currentTarget.setPointerCapture(event.pointerId)
      holdTimerRef.current = window.setTimeout(() => {
        holdActiveRef.current = true
        suppressSeekClickRef.current[direction] = true
        setSeekHoldOpenState(direction)
        setSeekHoldHoverIndex(null)
      }, getHoldDelayMs(event.pointerType))
    },
    [clearHoldTimer, seekHoldOpen, setSeekHoldOpenState]
  )

  const handleSeekPointerMove = useCallback(
    (direction: SeekHoldDirection) => (event: React.PointerEvent<HTMLButtonElement>) => {
      const pointer = holdPointerRef.current
      if (!pointer || pointer.direction !== direction) {
        return
      }
      if (!holdActiveRef.current) {
        if (holdTimerRef.current === null) {
          return
        }
        const slop = getHoldSlopPx(pointer.pointerType)
        const dx = event.clientX - pointer.startX
        const dy = event.clientY - pointer.startY
        if (dx * dx + dy * dy > slop * slop) {
          clearHoldTimer()
        }
        return
      }
      const match = getHoldOptionAtPoint(
        direction,
        event.clientX,
        event.clientY,
        pointer.pointerType,
        event.currentTarget
      )
      setSeekHoldHoverIndex(match ? match.index : null)
    },
    [clearHoldTimer, getHoldOptionAtPoint]
  )

  const handleSeekPointerUp = useCallback(
    (direction: SeekHoldDirection) => (event: React.PointerEvent<HTMLButtonElement>) => {
      const pointer = holdPointerRef.current
      if (!pointer || pointer.direction !== direction || pointer.id !== event.pointerId) {
        clearHoldTimer()
        return
      }
      clearHoldTimer()
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      const wasHoldActive = holdActiveRef.current
      holdActiveRef.current = false
      holdPointerRef.current = null

      if (!wasHoldActive) {
        return
      }
      suppressSeekClickRef.current[direction] = true
      const match = getHoldOptionAtPoint(
        direction,
        event.clientX,
        event.clientY,
        pointer.pointerType,
        event.currentTarget
      )
      if (match) {
        applySeekDelta(direction, match.delta)
        closeSeekHold()
        return
      }
      if (isPointOnButton(event.currentTarget, event.clientX, event.clientY, pointer.pointerType)) {
        setSeekHoldHoverIndex(null)
        setSeekHoldOpenState(direction)
        return
      }
      closeSeekHold()
    },
    [
      applySeekDelta,
      clearHoldTimer,
      closeSeekHold,
      getHoldOptionAtPoint,
      isPointOnButton,
      setSeekHoldOpenState,
    ]
  )

  const handleSeekPointerCancel = useCallback(
    (direction: SeekHoldDirection) => (event: React.PointerEvent<HTMLButtonElement>) => {
      const pointer = holdPointerRef.current
      if (!pointer || pointer.direction !== direction) {
        return
      }
      clearHoldTimer()
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      holdActiveRef.current = false
      holdPointerRef.current = null
      closeSeekHold()
    },
    [clearHoldTimer, closeSeekHold]
  )


  const isCollapsed = mode === 'collapsed'
  const controlsClassName = isCollapsed ? 'gap-4 px-14' : 'gap-3 px-2'
  const controlsTransitionClassName =
    'transition-[opacity,transform] duration-200 motion-reduce:transition-none ease-in-out'
  const expandedControlsClassName = `${controlsTransitionClassName} ${
    isCollapsed
      ? 'pointer-events-none absolute inset-0 justify-center opacity-0 translate-y-0.5'
      : 'pointer-events-auto relative opacity-100 translate-y-0 delay-[50ms]'
  }`
  const collapsedControlsClassName = `${controlsTransitionClassName} ${
    isCollapsed
      ? 'pointer-events-auto relative opacity-100 translate-y-0'
      : 'pointer-events-none absolute inset-0 justify-center opacity-0 -translate-y-0.5'
  }`
  const expandedExtrasTransition =
    'transition-[opacity,transform] motion-reduce:transition-none duration-200 ease-in-out'
  const expandedExtrasRightClassName = `${expandedExtrasTransition} ${
    isCollapsed
      ? 'pointer-events-none opacity-0 -translate-x-1.5 scale-[0.98]'
      : 'pointer-events-auto opacity-100 translate-x-0 scale-100 delay-[30ms]'
  }`
  const measureWidth = useCallback((element: HTMLDivElement | null) => {
    if (!element) {
      return null
    }
    const scrollWidth = element.scrollWidth
    if (scrollWidth > 0) {
      return scrollWidth
    }
    const width = element.getBoundingClientRect().width
    return width > 0 ? width : null
  }, [])
  const collapsedPlayGlowClass = isCollapsed
    ? 'shadow-[0_0_18px_6px_rgba(255,255,255,0.5)]'
    : ''
  const collapsedSideGlowClass = isCollapsed
    ? 'shadow-[0_0_26px_10px_rgba(255,255,255,0.75)] drop-shadow-[0_0_10px_rgba(255,255,255,0.65)]'
    : ''
  const playbackButtonClass =
    '!bg-[#f1f1f1] !text-[#0b1220] hover:!bg-[#e7e7e7] active:!bg-[#dedede] dark:!bg-[#f1f1f1] dark:!text-slate-900 dark:hover:!bg-[#e7e7e7] dark:active:!bg-[#dedede]'
  const controlButtonBase =
    'flex shrink-0 items-center justify-center rounded-full border border-[#4F7F7A]/55 bg-black/5 text-[#0b1220] shadow-sm shadow-black/10 backdrop-blur-sm transition hover:bg-black/10 active:bg-black/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4F7F7A]/40 focus-visible:ring-offset-2 focus-visible:ring-offset-white/80 dark:border-[#4F7F7A]/45 dark:bg-white/10 dark:text-slate-100 dark:shadow-black/30 dark:ring-offset-slate-900/70'
  const toggleActiveClass =
    '!border-[#4F7F7A] !bg-[#4F7F7A]/25 hover:!bg-[#4F7F7A]/30 active:!bg-[#4F7F7A]/35'
  const iconButtonSize = 'h-10 w-10'
  const primaryButtonClassName =
    'flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#4F7F7A] text-[#0b1220] shadow-lg shadow-[#4F7F7A]/30 transition hover:scale-[1.02] hover:bg-[#4F7F7A] active:bg-[#4F7F7A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4F7F7A]/40 focus-visible:ring-offset-2 focus-visible:ring-offset-white/80 dark:shadow-black/40 dark:ring-offset-slate-900/70'
  const seekHoldButtonBase =
    'absolute left-0 top-0 flex h-12 w-12 items-center justify-center rounded-full border border-[#7EA9A3] bg-[#8FB7B2] text-[13px] font-semibold text-[#0b1220] shadow-lg shadow-black/10 backdrop-blur-sm transition-[transform,background-color,border-color,color] duration-[240ms] ease-in-out hover:scale-[1.02] hover:bg-[#4F7F7A] hover:text-white hover:border-[#4F7F7A] active:scale-[0.98] active:bg-[#4F7F7A] active:text-white active:border-[#4F7F7A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4F7F7A]/40 focus-visible:ring-offset-2 focus-visible:ring-offset-white/80'
  const seekHoldButtonActive =
    'scale-[1.06] border-[#4F7F7A] bg-[#4F7F7A] text-white'
  const renderSeekToast = (token: number | null, label: string, offset: number) => {
    if (token === null) {
      return null
    }
    return [
      <span
        key={token}
        className="pointer-events-none absolute left-1/2 -translate-x-1/2"
        style={{ top: `-${offset}px` }}
        aria-hidden="true"
      >
        <span className="inline-flex items-center justify-center rounded-full bg-[#4F7F7A] px-2 py-0.5 text-[10px] font-semibold text-white shadow-md animate-[seek-toast_650ms_ease-out_forwards]">
          {label}
        </span>
      </span>,
    ]
  }

  const renderSeekIcon = (direction: 'back' | 'forward') => (
    <span className="relative flex h-7 w-7 items-center justify-center">
      {direction === 'back' ? (
        <RotateCcw size={26} strokeWidth={1.3} />
      ) : (
        <RotateCw size={26} strokeWidth={1.3} />
      )}
      <span className="absolute text-[10px] font-semibold leading-none tracking-tight text-current">
        {SEEK_SECONDS}
      </span>
    </span>
  )

  const renderSeekHoldMenu = (direction: SeekHoldDirection) => {
    const isOpen = seekHoldOpen === direction
    const menuClassName = `absolute left-1/2 top-1/2 z-[10050] origin-top-left transition-[opacity,transform] duration-[240ms] ease-in-out ${
      isOpen
        ? 'pointer-events-auto opacity-100 translate-y-0 scale-100'
        : 'pointer-events-none opacity-0 translate-y-1 scale-95'
    }`
    return (
      <div className={menuClassName} aria-hidden={!isOpen}>
        {SEEK_HOLD_DELTAS[direction].map((delta, index) => {
          const offset = SEEK_HOLD_OFFSETS_BY_DIRECTION[direction][index]
          const label = formatSeekLabel(delta)
          const isActive = isOpen && holdActiveRef.current && seekHoldHoverIndex === index
          return (
            <button
              key={`${direction}-${delta}`}
              className={`${seekHoldButtonBase} ${isActive ? seekHoldButtonActive : ''}`}
              style={{
                transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px)`,
              }}
              type="button"
              tabIndex={isOpen ? 0 : -1}
              onClick={() => {
                applySeekDelta(direction, delta)
                closeSeekHold()
              }}
              aria-label={`Seek ${direction === 'back' ? 'back' : 'forward'} ${Math.abs(
                delta
              )} seconds`}
            >
              {label}
            </button>
          )
        })}
      </div>
    )
  }

  const backButton = (
    <div ref={backHoldRootRef} className="relative">
      <button
        ref={backButtonRef}
        className={`${controlButtonBase} ${iconButtonSize} ${playbackButtonClass} ${collapsedSideGlowClass} relative`}
        onClick={handleSeekClick('back')}
        // hold-to-seek disabled — handlers kept for future re-enable:
        // onPointerDown={handleSeekPointerDown('back')}
        // onPointerMove={handleSeekPointerMove('back')}
        // onPointerUp={handleSeekPointerUp('back')}
        // onPointerCancel={handleSeekPointerCancel('back')}
        type="button"
        title="Back 15 seconds"
      >
        {renderSeekToast(backToastToken, backToastLabel, backToastOffset)}
        {renderSeekIcon('back')}
      </button>
      {/* hold-to-seek radial menu disabled: {renderSeekHoldMenu('back')} */}
    </div>
  )
  const playButton = (
    <button
      className={`${primaryButtonClassName} ${collapsedPlayGlowClass}`}
      onClick={togglePlay}
      type="button"
      title={isPlaying ? 'Pause' : 'Play'}
    >
      {isPlaying ? (
        <Pause size={18} className="text-white" />
      ) : (
        <Play size={18} className="text-white" />
      )}
    </button>
  )
  const forwardButton = (
    <div ref={forwardHoldRootRef} className="relative">
      <button
        ref={forwardButtonRef}
        className={`${controlButtonBase} ${iconButtonSize} ${playbackButtonClass} ${collapsedSideGlowClass} relative`}
        onClick={handleSeekClick('forward')}
        // hold-to-seek disabled — handlers kept for future re-enable:
        // onPointerDown={handleSeekPointerDown('forward')}
        // onPointerMove={handleSeekPointerMove('forward')}
        // onPointerUp={handleSeekPointerUp('forward')}
        // onPointerCancel={handleSeekPointerCancel('forward')}
        type="button"
        title="Forward 15 seconds"
      >
        {renderSeekToast(forwardToastToken, forwardToastLabel, forwardToastOffset)}
        {renderSeekIcon('forward')}
      </button>
      {/* hold-to-seek radial menu disabled: {renderSeekHoldMenu('forward')} */}
    </div>
  )

  // Popovers center on their button; max-width keeps them inside the viewport.
  const popoverPositionClass =
    'absolute bottom-12 left-1/2 z-[9999] w-52 max-w-[calc(100vw-16px)] -translate-x-1/2 rounded-2xl border border-slate-200 bg-white p-4 shadow-xl'
  // Reset chip shown on the slider's label row when the control is off-center.
  const popoverResetClass =
    'rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 transition hover:bg-slate-200 active:bg-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4F7F7A]/40'

  useEffect(() => {
    const activeRef = isCollapsed ? collapsedControlsRef : expandedControlsRef
    const width = measureWidth(activeRef.current)
    if (width) {
      setShellWidth(width)
    }
  }, [isCollapsed, measureWidth])

  useEffect(() => {
    if (isCollapsed) {
      setExpandedScale(1)
      return
    }
    let rafId: number | null = null
    const updateScale = () => {
      const isDesktop = window.matchMedia('(min-width: 640px)').matches
      if (isDesktop) {
        setExpandedScale(1)
        return
      }
      const width = measureWidth(expandedControlsRef.current)
      if (!width) {
        setExpandedScale(1)
        return
      }
      const maxWidth = Math.max(0, window.innerWidth - 36)
      const nextScale = maxWidth > 0 ? Math.min(1, maxWidth / width) : 1
      setExpandedScale(nextScale)
    }
    rafId = window.requestAnimationFrame(updateScale)
    const handleResize = () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId)
      }
      rafId = window.requestAnimationFrame(updateScale)
    }
    window.addEventListener('resize', handleResize)
    return () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId)
      }
      window.removeEventListener('resize', handleResize)
    }
  }, [isCollapsed, measureWidth])

  return (
    <div
      ref={containerRef}
      className="absolute left-1/2 top-0 flex -translate-x-1/2 -translate-y-[calc(50%+20px)] items-center justify-center"
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <div
        className="flex items-center justify-center"
        style={
          !isCollapsed && expandedScale < 1
            ? { transform: `scale(${expandedScale})`, transformOrigin: 'center bottom' }
            : undefined
        }
      >
        <TransportBarShell
          mode={mode}
          style={
            shellWidth !== null ? { width: `${shellWidth}px` } : undefined
          }
        >
          <div className="relative flex items-center justify-center">
            <ExpandedControls
              className={`${controlsClassName} ${expandedControlsClassName}`}
              ref={expandedControlsRef}
            >
            {backButton}
            {playButton}
            {forwardButton}
            <div className={`flex items-center gap-3 ${expandedExtrasRightClassName}`}>
            <div className="relative">
              <button
                ref={speedButtonRef}
                className={`${controlButtonBase} ${iconButtonSize} text-xs font-semibold leading-none sm:text-sm ${
                  playbackRate !== 1 ? toggleActiveClass : ''
                }`}
                onClick={() => setSpeedMenuOpen((v) => !v)}
                type="button"
                aria-expanded={speedMenuOpen}
                title="Playback speed"
              >
                {speedLabel}
              </button>
              {speedMenuOpen && (
                <div ref={speedPopoverRef} className={popoverPositionClass}>
                  <AudioSlider
                    value={playbackRate}
                    min={SPEED_MIN}
                    max={SPEED_MAX}
                    step={0.05}
                    center={1}
                    snapThreshold={0.03}
                    onChange={setPlaybackRate}
                    leftLabel={`${SPEED_MIN}`}
                    rightLabel={`${SPEED_MAX}`}
                    ariaLabel="Playback speed"
                    formatValue={formatSpeedLabel}
                    centerSlot={(display) =>
                      Math.abs(display - 1) > 0.001 ? (
                        <button
                          type="button"
                          className={popoverResetClass}
                          onClick={() => setPlaybackRate(1)}
                        >
                          Reset
                        </button>
                      ) : null
                    }
                  />
                </div>
              )}
            </div>
            <div className="relative">
              {/* Transpose button — ♭♯ glyph at 0, interval label when shifted */}
              <button
                ref={transposeButtonRef}
                className={`${controlButtonBase} ${iconButtonSize} text-xs font-semibold leading-none sm:text-sm ${
                  transpose !== 0 ? toggleActiveClass : ''
                }`}
                onClick={() => setTransposeOpen((v) => !v)}
                type="button"
                aria-expanded={transposeOpen}
                aria-label="Transpose"
                title="Transpose (semitones)"
              >
                {renderTransposeLabel(transpose)}
              </button>
              {transposeOpen && (
                <div ref={transposePopoverRef} className={popoverPositionClass}>
                  {/* Commits on release (live={false}) — avoids the worklet
                      "catch" firing on every intermediate semitone. While
                      dragging, the center slot previews the interval; on
                      release it commits to the button and the center shows Reset. */}
                  <AudioSlider
                    value={transpose}
                    min={TRANSPOSE_MIN}
                    max={TRANSPOSE_MAX}
                    step={1}
                    center={0}
                    snapThreshold={0.6}
                    live={false}
                    onChange={setTranspose}
                    leftLabel={renderTransposeLabel(TRANSPOSE_MIN)}
                    rightLabel={renderTransposeLabel(TRANSPOSE_MAX)}
                    ariaLabel="Transpose"
                    centerSlot={(display, dragging) =>
                      dragging ? (
                        <span className="text-[12px] font-semibold leading-none text-slate-700">
                          {display === 0 ? 'Original' : renderTransposeLabel(display)}
                        </span>
                      ) : display !== 0 ? (
                        <button
                          type="button"
                          className={popoverResetClass}
                          onClick={() => setTranspose(0)}
                        >
                          Reset
                        </button>
                      ) : null
                    }
                  />
                </div>
              )}
            </div>
            <div className="relative">
              {/* Headphones button — gradient tints toward the dominant side */}
              <button
                ref={headphonesRef}
                className={`${controlButtonBase} ${iconButtonSize} overflow-hidden`}
                style={{
                  // Aggressive overlay: strong accent on the dominant side,
                  // spilling past center (fade starts ~30% from the quiet edge
                  // at full pan) for a snappy, obvious tint.
                  background: (() => {
                    const m = Math.abs(balance)
                    if (m < 0.005) return undefined
                    // Subtle onset (long transparent ramp) that spills to ~80%
                    // coverage at full pan.
                    const strong = (0.5 + m * 0.4).toFixed(3)
                    const fadeStart = (50 - m * 30).toFixed(1)
                    const dir = balance > 0 ? 'to right' : 'to left'
                    return `linear-gradient(${dir}, rgba(79,127,122,0) ${fadeStart}%, rgba(79,127,122,${strong}) 100%)`
                  })(),
                }}
                type="button"
                aria-label="Balance and mono"
                aria-expanded={balanceOpen}
                title="Balance L/R"
                onClick={() => setBalanceOpen((v) => !v)}
              >
                <Headphones size={18} />
              </button>

              {/* Balance popover — mono on top, slider on the bottom (nearest the button) */}
              {balanceOpen && (
                <div ref={balancePopoverRef} className={popoverPositionClass}>
                  {/* Mono toggle — only for stereo sources (a mono track can't
                      be made stereo, so there's nothing to collapse). */}
                  {isStereoSource && (
                    <>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[13px] text-slate-700">Mono</span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={mono}
                          aria-label="Mono"
                          onClick={() => setMono(!mono)}
                          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4F7F7A]/40 ${
                            mono ? 'bg-[#4F7F7A]' : 'bg-slate-200'
                          }`}
                        >
                          <span
                            className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                              mono ? 'translate-x-4' : 'translate-x-0'
                            }`}
                          />
                        </button>
                      </div>

                      <div className="my-3 border-t border-slate-100" />
                    </>
                  )}

                  <AudioSlider
                    value={balance}
                    min={-1}
                    max={1}
                    step={0.01}
                    center={0}
                    snapThreshold={0.05}
                    onChange={setBalance}
                    leftLabel="L"
                    rightLabel="R"
                    ariaLabel="Balance"
                    centerSlot={(display) =>
                      Math.abs(display) > 0.005 ? (
                        <button
                          type="button"
                          className={popoverResetClass}
                          onClick={() => setBalance(0)}
                        >
                          Reset
                        </button>
                      ) : null
                    }
                  />
                </div>
              )}
            </div>
            </div>
            </ExpandedControls>

            <CollapsedControls
              className={`${controlsClassName} ${collapsedControlsClassName}`}
              ref={collapsedControlsRef}
            >
              {backButton}
              {playButton}
              {forwardButton}
            </CollapsedControls>
          </div>
        </TransportBarShell>
      </div>
    </div>
  )
}
