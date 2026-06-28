
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type PointerEventHandler,
} from 'react'
import { ChevronDown, ChevronUp, Plus } from 'lucide-react'
import WaveSurfer from 'wavesurfer.js'
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js'
import RecordPlugin from 'wavesurfer.js/dist/plugins/record.esm.js'
import { SoundTouchNode } from '@soundtouchjs/audio-worklet'
import soundtouchProcessorUrl from '@soundtouchjs/audio-worklet/processor?url'
import { toast } from 'sonner'
import { deleteAudioBlob, getAudioBlob, putAudioBlob } from '../lib/audioStore'
import { useGainEnvelope } from '../lib/useGainEnvelope'
import { localStorageStore, type PracticeStore } from '../lib/storage'
import { anchorAtTime, type Anchor } from '../lib/syncMap'
import { buildTimingModel, resolveScrollSegment, type TimingModel } from '../lib/timingModel'
import type { BeatAnalysis } from '../lib/transcribe'
import { useTransportVisibility } from '../lib/useTransportVisibility'
import TransportBar from './TransportBar'
import LoopLaneStrip from './LoopLaneStrip'
import type { TrackOption } from './TrackSelector'
import type { PDFViewerHandle } from './PDFViewer'
import type { SavedLoop, SheetPosition } from '../lib/types'

const SAMPLE_URL = '/sample.mp3'
const NEW_LOOP_SECONDS = 30
const REGION_TRANSPARENT_COLOR = 'rgba(17, 24, 39, 0.08)'
const LOOP_COLORS = [
  'rgb(143, 103, 95)',  // Dusty Rose
  'rgb(90, 95, 143)',   // Muted Indigo
  'rgb(91, 109, 138)',  // Slate Blue
  'rgb(108, 123, 104)', // Mossy Green
  'rgb(143, 112, 133)', // Dusty Plum
  'rgb(158, 122, 86)',  // Warm Umber
  'rgb(120, 132, 146)', // Cool Gray-Blue
  'rgb(96, 110, 125)',  // Deep Steel
]

const LOOPS_STORAGE_KEY = 'practice:loops'
const TAKE_STORAGE_KEY = 'practice:take'
const SCROLL_ON_REPEAT_STORAGE_KEY = 'practice:scroll-on-repeat'
const BALANCE_STORAGE_KEY = 'practice:balance'
const MONO_STORAGE_KEY = 'practice:mono'
const TRANSPOSE_STORAGE_KEY = 'practice:transpose'
const SPEED_STORAGE_KEY = 'practice:speed'
// C3: two independent GLOBAL repeat values sharing one button — repeat-the-whole-
// song (when no loop is selected; default off) and repeat-the-loop (when a loop is
// selected; default on). Not per-loop.
const REPEAT_SONG_STORAGE_KEY = 'practice:repeat-song'
const REPEAT_LOOP_STORAGE_KEY = 'practice:repeat-loop'
// D4 → jump-on-event: a single toggle controlling whether structural events (loop
// repeat, loop switch, song restart) jump the score to the matching position.
const JUMP_ON_EVENT_STORAGE_KEY = 'practice:jump-on-event'
const JUMP_ONBOARDING_KEY = 'practice:jump-onboarding-shown'
const TRANSPOSE_MIN_SEMITONES = -7
const TRANSPOSE_MAX_SEMITONES = 7
const SCROLL_THRESHOLD_PX = 10
const LOOP_PAD_SECONDS = 0.5
const LOOP_FADE_SECONDS = 1.0
const LOOP_MIN_VOLUME = 0.0001
const LOOP_FADE_DEBUG = false
const DEBUG_LOOP_BG = false
const SEEK_FADE_SKIP_SECONDS = 0.05
const DRIFT_GUARD_THRESHOLD_SECONDS = 0.08
const DRIFT_GUARD_COOLDOWN_MS = 150
const SHEET_LINK_BUFFER_PX = 24
const SHEET_REPEAT_DEBUG = false
const LOOP_COUNTDOWN_SECONDS = 5
const SCROLL_REPEAT_PROMPT_MS = 3500
const OVERLAY_ANIMATION_MS = 220
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/**
 * DEV diagnostic: dump, at a given song time, where the auto-scroll is vs. where the
 * anchors say the music is. Fired on pause so you can stop ON a word and compare the
 * word you HEAR to the anchor the engine is following. If the heard word isn't the
 * ▶-marked (nearest-by-time) anchor, the scroll offset is a Whisper TIMING error in the
 * anchors — the alignment (word → page/y) is still correct — not a scroll/playback desync.
 */
const logScrollProbe = (model: TimingModel, anchors: Anchor[], t: number): void => {
  if (!anchors.length) return
  const seg = resolveScrollSegment(model, t)
  let nearest = anchors[0]
  for (const a of anchors) if (Math.abs(a.time - t) < Math.abs(nearest.time - t)) nearest = a
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '')
  const near = anchors
    .filter((a) => Math.abs(a.time - t) <= 4)
    .sort((a, b) => a.time - b.time)
    .map((a) => {
      const mark = a === nearest ? '▶' : ' '
      const heard = a.heard && norm(a.heard) !== norm(a.text) ? `  (heard "${a.heard}")` : ''
      return `   ${mark} ${a.time.toFixed(2).padStart(7)}s  "${a.text}"  p${a.page} y${a.yWithinPageRatio.toFixed(3)}${heard}`
    })
  const startPage = model.systems[seg?.startSystem ?? 0]?.page
  console.warn(
    `[ScrollProbe] ⏸ audio=${t.toFixed(2)}s | scroll→ ` +
      (seg ? `system ${seg.startSystem}→${seg.endSystem} (p${startPage}) blend=${seg.blend.toFixed(2)}` : 'idle (manual)') +
      `\n  nearest anchor by playback time: "${nearest.text}" @${nearest.time.toFixed(2)}s → p${nearest.page} y${nearest.yWithinPageRatio.toFixed(3)}` +
      `\n  anchors within ±4s (▶ = nearest to where playback actually is):\n` +
      near.join('\n') +
      `\n  → The scroll follows these anchor TIMES. If the word you hear right now is NOT the ▶ one,` +
      `\n    that word's anchor time is off by (now − its time) — the alignment is right, the timestamp is early/late.`
  )
}

const enablePitchCorrection = (media: HTMLMediaElement | null) => {
  if (!media) {
    return
  }
  const element = media as HTMLMediaElement & {
    preservesPitch?: boolean
    mozPreservesPitch?: boolean
    webkitPreservesPitch?: boolean
  }
  if ('preservesPitch' in element) {
    element.preservesPitch = true
  }
  if ('mozPreservesPitch' in element) {
    element.mozPreservesPitch = true
  }
  if ('webkitPreservesPitch' in element) {
    element.webkitPreservesPitch = true
  }
}

const logLoopBg = (event: string, payload?: Record<string, unknown>) => {
  if (!DEBUG_LOOP_BG) {
    return
  }
  const timestamp = new Date().toISOString()
  const data = payload ? { timestamp, ...payload } : { timestamp }
  console.warn(`[LoopBG] ${event}`, data)
}

const getLoopDelayMs = (currentTime: number, targetTime: number, playbackRate: number) => {
  const remaining = targetTime - currentTime
  const delayMs = (remaining / playbackRate) * 1000
  return Number.isFinite(delayMs) ? Math.max(0, delayMs) : 0
}

const getPageHeight = (page: HTMLElement) => {
  const rect = page.getBoundingClientRect()
  return rect.height || page.offsetHeight || 0
}

const getPageOffsetTop = (page: HTMLElement, container: HTMLElement) => {
  const pageRect = page.getBoundingClientRect()
  const containerRect = container.getBoundingClientRect()
  return pageRect.top - containerRect.top + container.scrollTop
}


type LoopBounds = {
  start: number
  end: number
  extendedStart: number
  extendedEnd: number
}

type LoopSheetMarker = {
  id: string
  name: string
  color: string
  sheetLink: SheetPosition
  /** Score position of the loop's END, when the timing model can resolve it.
   * Lets the rail + page-margin bars draw a proportional extent (start→end). */
  sheetLinkEnd?: SheetPosition
  /** This loop is the active (selected) one — drives the page-bar selected ring. */
  active?: boolean
}

const normalizeSavedLoops = (loops: SavedLoop[]) => {
  let assignedIndex = 0
  let changed = false
  const normalized = loops.map((loop) => {
    let next: SavedLoop & { jumpOnRepeat?: boolean } = loop
    if (Object.prototype.hasOwnProperty.call(next, 'jumpOnRepeat')) {
      const { jumpOnRepeat, ...rest } = next
      next = rest
      changed = true
    }
    if (!next.color) {
      const color = LOOP_COLORS[assignedIndex % LOOP_COLORS.length]
      assignedIndex += 1
      next = { ...next, color }
      changed = true
    }
    if (next.sheetLink) {
      const { page, scrollTop, yWithinPagePx, yWithinPageRatio } = next.sheetLink
      const hasYWithinPagePx = Number.isFinite(yWithinPagePx)
      const hasYWithinPageRatio = Number.isFinite(yWithinPageRatio)
      if (Number.isFinite(scrollTop) && !hasYWithinPagePx && !hasYWithinPageRatio) {
        next = {
          ...next,
          sheetLink: {
            page,
            yWithinPagePx: Math.max(0, scrollTop as number),
          },
        }
        changed = true
      } else if (Number.isFinite(scrollTop)) {
        next = {
          ...next,
          sheetLink: {
            page,
            yWithinPagePx: hasYWithinPagePx ? (yWithinPagePx as number) : undefined,
            yWithinPageRatio: hasYWithinPageRatio ? (yWithinPageRatio as number) : undefined,
          },
        }
        changed = true
      }
    }
    return next
  })
  return changed ? normalized : loops
}

const useReducedMotion = () => {
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const handleChange = () => setReduced(media.matches)
    handleChange()
    if (media.addEventListener) {
      media.addEventListener('change', handleChange)
      return () => media.removeEventListener('change', handleChange)
    }
    media.addListener(handleChange)
    return () => media.removeListener(handleChange)
  }, [])

  return reduced
}

const useOverlayPresence = (visible: boolean, durationMs: number) => {
  const [isMounted, setIsMounted] = useState(visible)
  const [phase, setPhase] = useState<'enter' | 'exit'>(visible ? 'enter' : 'exit')

  useEffect(() => {
    if (visible) {
      setIsMounted(true)
      setPhase('enter')
      return
    }
    if (!isMounted) {
      return
    }
    setPhase('exit')
    const timeout = window.setTimeout(() => {
      setIsMounted(false)
    }, durationMs)
    return () => window.clearTimeout(timeout)
  }, [durationMs, isMounted, visible])

  return { isMounted, phase }
}

type TakeMeta = {
  id: string
  offsetSec: number
  duration: number
  volume: number
}

type PlayerDockProps = {
  scrollContainerRef: MutableRefObject<HTMLDivElement | null>
  pdfViewerRef?: MutableRefObject<PDFViewerHandle | null>
  /** Audio source for the active track. Defaults to the legacy single-song sample. */
  audioUrl?: string
  /** Per-song persistence. Defaults to global localStorage (single-song behavior). */
  store?: PracticeStore
  /** This track's lead-in vs song-time: track-time = song-time + leadInOffset. */
  leadInOffset?: number
  anchors?: Anchor[]
  beat?: BeatAnalysis
  onAnchorsChange?: (anchors: Anchor[]) => void
  onLoopMarkersChange?: (markers: LoopSheetMarker[]) => void
  markerActivateRef?: MutableRefObject<((loopId: string) => void) | null>
  onSavedLoopsChange?: (loops: SavedLoop[]) => void
  onActiveLoopIdChange?: (id: string | null) => void
  onSelectedLoopIdChange?: (id: string | null) => void
  createLoopRef?: MutableRefObject<(() => void) | null>
  deleteLoopRef?: MutableRefObject<((id: string) => void) | null>
  selectLoopRef?: MutableRefObject<((id: string) => void) | null>
  exitLoopRef?: MutableRefObject<(() => void) | null>
  /** Ref to expose a callback that SongView calls when PDF system bands are first ready. */
  onSystemBandsReadyRef?: MutableRefObject<(() => void) | null>
  /** Track selector (docked in the transport bar). Hidden when there are none. */
  tracks?: TrackOption[]
  activeTrackId?: string
  onSelectTrack?: (id: string) => void
  onManageTracks?: () => void
}

export default function PlayerDock(props: PlayerDockProps) {
  const {
    scrollContainerRef,
    pdfViewerRef,
    audioUrl = SAMPLE_URL,
    store = localStorageStore,
    leadInOffset = 0,
    onLoopMarkersChange,
    markerActivateRef,
    onSavedLoopsChange,
    onActiveLoopIdChange,
    onSelectedLoopIdChange,
    createLoopRef,
    deleteLoopRef,
    selectLoopRef,
    exitLoopRef,
    onSystemBandsReadyRef,
    anchors = [],
    beat,
    tracks,
    activeTrackId,
    onSelectTrack,
    onManageTracks,
  } = props
  // Shared loops + sync anchors live in song-time; the audio element plays in
  // track-time. They differ by this track's lead-in. Convert only at the seams
  // (region placement, region write-back, anchor resolution); the loop engine
  // stays entirely in track-time.
  const offsetRef = useRef(leadInOffset)
  offsetRef.current = leadInOffset
  const songToTrackTime = (t: number) => t + offsetRef.current
  const trackToSongTime = (t: number) => t - offsetRef.current

  const containerRef = useRef<HTMLDivElement | null>(null)
  const transportRef = useRef<HTMLDivElement | null>(null)
  const recordContainerRef = useRef<HTMLDivElement | null>(null)
  const takeWaveContainerRef = useRef<HTMLDivElement | null>(null)
  const waveSurferRef = useRef<WaveSurfer | null>(null)
  const regionsRef = useRef<any | null>(null)
  const recordWaveSurferRef = useRef<WaveSurfer | null>(null)
  const recordPluginRef = useRef<any | null>(null)
  const takeWaveSurferRef = useRef<WaveSurfer | null>(null)
  const takeBufferRef = useRef<AudioBuffer | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const masterGainRef = useRef<GainNode | null>(null)
  // Balance / mono chain: masterGain → monoGain → stereoPanner → destination
  const monoGainRef = useRef<GainNode | null>(null)
  const stereoPannerRef = useRef<StereoPannerNode | null>(null)
  const balanceRef = useRef(0)
  const monoRef = useRef(false)
  // Transpose: SoundTouch worklet inserted as mediaSource → soundTouch → masterGain
  // (only when transpose ≠ 0; bypassed to mediaSource → masterGain otherwise).
  const soundTouchNodeRef = useRef<SoundTouchNode | null>(null)
  const soundTouchRegisteredRef = useRef(false)
  const transposeRef = useRef(0)
  const mediaElementRef = useRef<HTMLAudioElement | null>(null)
  const mediaElementSourceRef = useRef<MediaElementAudioSourceNode | null>(null)
  const takeGainRef = useRef<GainNode | null>(null)
  const takePlaybackRef = useRef({
    source: null as AudioBufferSourceNode | null,
    startedAtContextTime: 0,
    takeStartAt: 0,
    rate: 1,
  })
  const regionMapRef = useRef(new Map<string, any>())
  const activeRegionIdRef = useRef<string | null>(null)
  const savedLoopsRef = useRef<SavedLoop[]>([])
  const globalLoopRef = useRef(false)
  const loopRef = useRef(false)
  // C3 global repeat values (see *_STORAGE_KEY above). `loopOn`/`loopRef` stays the
  // current-context flag the playback engine reads; these are the remembered toggles.
  const repeatSongRef = useRef(false)
  const repeatLoopRef = useRef(true)
  // D4 jump-on-event: whether structural events scroll the score.
  const jumpOnEventRef = useRef(true)
  const jumpOnboardingShownRef = useRef(
    typeof localStorage !== 'undefined' && localStorage.getItem(JUMP_ONBOARDING_KEY) === 'true'
  )
  const overlayRefs = useRef<{ left: any | null; right: any | null }>({
    left: null,
    right: null,
  })
  const overlayFrameRef = useRef<number | null>(null)
  const recordingOffsetRef = useRef(0)
  const playbackRateRef = useRef(1)
  const takeVolumeRef = useRef(0.9)
  const takeMetaRef = useRef<TakeMeta | null>(null)
  const takeLoadedRef = useRef<string | null>(null)
  const pendingTakeBlobRef = useRef<Blob | null>(null)
  const nextColorIndexRef = useRef(0)
  const dragSeekRef = useRef(false)
  const resizingRegionRef = useRef(false)
  const resizeClearRef = useRef<number | null>(null)
  const interactionLockRef = useRef(false)
  const isPdfScrollingRef = useRef(false)
  const pdfScrollTimeoutRef = useRef<number | null>(null)
  const timingModelRef = useRef<TimingModel | null>(null)
  const repeatCountdownRef = useRef<number | null>(null)
  const scrollOnRepeatRef = useRef(true)
  const scrollRepeatPromptTimeoutRef = useRef<number | null>(null)
  const scrollRepeatPromptHoverRef = useRef(false)
  const scrollRepeatPromptPendingHideRef = useRef(false)
  const sheetLinkMigrationTimeoutRef = useRef<number | null>(null)
  const sheetLinkMigrationAttemptsRef = useRef(0)
  const fadeOutCompleteTimeoutRef = useRef<number | null>(null)
  const fadeOutTimerRef = useRef<number | null>(null)
  const wrapTimerRef = useRef<number | null>(null)
  const countdownTimerRef = useRef<number | null>(null)
  const driftGuardCooldownRef = useRef(0)
  const driftGuardSourceRef = useRef<'audioprocess' | 'timeupdate' | null>(null)
  const volumeValueRef = useRef(1)
  const timeupdateCountRef = useRef(0)
  const audioprocessCountRef = useRef(0)
  const timeupdateLogCounterRef = useRef(0)
  const sawTimeupdateRef = useRef(false)
  const sawAudioprocessRef = useRef(false)

  const [isReady, setIsReady] = useState(false)
  const [audioReady, setAudioReady] = useState(false)
  // null until the source is decoded; 1 = mono track, 2 = stereo.
  const [sourceChannelCount, setSourceChannelCount] = useState<number | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const [activeRegionId, setActiveRegionId] = useState<string | null>(null)
  const [savedLoops, setSavedLoops] = useState<SavedLoop[]>([])
  const [loopOn, setLoopOn] = useState(false)
  const [repeatSong, setRepeatSong] = useState(false)
  const [repeatLoop, setRepeatLoop] = useState(true)
  const [jumpOnEvent, setJumpOnEvent] = useState(true)
  // Increments whenever the timing model should be rebuilt: anchors/beat updated, or
  // the PDF first rendered system bands. loopMarkers depends on this so it recomputes
  // the moment both anchors AND bands are available, regardless of arrival order.
  const [timingModelVersion, setTimingModelVersion] = useState(0)
  // Expose the version-bump callback so SongView can fire it when the PDF bands arrive.
  useEffect(() => {
    if (onSystemBandsReadyRef) {
      onSystemBandsReadyRef.current = () => {
        // Discard any model built from a partial bands map (e.g. anchors loaded while
        // only some pages were painted) so it rebuilds from the now-complete document.
        timingModelRef.current = null
        setTimingModelVersion(v => v + 1)
      }
    }
    return () => {
      if (onSystemBandsReadyRef) onSystemBandsReadyRef.current = null
    }
  }, [onSystemBandsReadyRef])
  const [playbackRate, setPlaybackRate] = useState(1)
  const [balance, setBalanceState] = useState(0)
  const [mono, setMonoState] = useState(false)
  const [transpose, setTransposeState] = useState(0)
  const [recordPanelOpen] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [takeMeta, setTakeMeta] = useState<TakeMeta | null>(null)
  const [takeVolume, setTakeVolume] = useState(0.9)
  const [hasHydrated, setHasHydrated] = useState(false)
  const [nameModalOpen, setNameModalOpen] = useState(false)
  const [pendingLoopName, setPendingLoopName] = useState('')
  const [selectedLoopId, setSelectedLoopId] = useState<string | null>(null)
  const [lanesVisible, setLanesVisible] = useState<boolean>(
    () => store.load<boolean>('practice:lanesVisible') ?? true
  )
  const [scrollOnRepeat, setScrollOnRepeat] = useState(true)
  const [scrollRepeatPromptVisible, setScrollRepeatPromptVisible] = useState(false)
  const [scrollRepeatOffToastToken, setScrollRepeatOffToastToken] = useState(0)
  const [isPointerDown, setIsPointerDown] = useState(false)
  const [isInTransport, setIsInTransport] = useState(false)
  const [seekExtensionOpen, setSeekExtensionOpen] = useState(false)
  const [repeatCountdown, setRepeatCountdown] = useState<number | null>(null)
  const seekExtensionPrevRef = useRef(false)
  const { mode: autoTransportMode, reveal, scheduleCollapse } = useTransportVisibility({
    isPointerDown,
    isInTransport,
    autoHideEnabled: false, // collapse disabled — re-enable by removing this line
  })
  // Transport collapse is currently disabled; always stay expanded.
  // To re-enable: remove the autoHideEnabled:false above and restore: seekExtensionOpen ? 'collapsed' : autoTransportMode
  const transportMode = 'expanded' as const
  const prefersReducedMotion = useReducedMotion()
  const { setGainImmediate, rampGainTo, cancelRamps } = useGainEnvelope(
    masterGainRef,
    volumeValueRef
  )
  // Builds masterGain → monoGain → stereoPanner → destination and returns the
  // input node of the balance section (monoGain). The chain is created once and
  // persists across WaveSurfer re-inits (only mediaSource is torn down).
  const ensureBalanceChain = useCallback((context: AudioContext) => {
    if (!stereoPannerRef.current) {
      const panner = context.createStereoPanner()
      panner.pan.value = balanceRef.current
      panner.connect(context.destination)
      stereoPannerRef.current = panner
    }
    if (!monoGainRef.current) {
      const monoGain = context.createGain()
      monoGain.gain.value = 1
      // Mono is a channel-count trick: explicit/1 down-mixes stereo to mono
      // (0.5·L + 0.5·R) via the speaker interpretation; the panner re-spreads it.
      if (monoRef.current) {
        monoGain.channelCountMode = 'explicit'
        monoGain.channelCount = 1
      }
      monoGain.connect(stereoPannerRef.current)
      monoGainRef.current = monoGain
    }
    return monoGainRef.current
  }, [])

  const ensureMasterGain = useCallback(
    (context: AudioContext) => {
      if (masterGainRef.current) {
        return masterGainRef.current
      }
      const gain = context.createGain()
      gain.gain.value = volumeValueRef.current
      gain.connect(ensureBalanceChain(context))
      masterGainRef.current = gain
      return gain
    },
    [ensureBalanceChain]
  )

  // Balance: -1 (full left) … 0 (center) … +1 (full right). Ramped to dodge
  // zipper noise when dragged. Consumed by the headphones popover (Task 14).
  const setBalance = useCallback((value: number) => {
    const clamped = Math.max(-1, Math.min(1, value))
    balanceRef.current = clamped
    setBalanceState(clamped)
    const panner = stereoPannerRef.current
    const context = audioContextRef.current
    if (panner) {
      if (context) {
        panner.pan.setTargetAtTime(clamped, context.currentTime, 0.015)
      } else {
        panner.pan.value = clamped
      }
    }
  }, [])

  // Mono: collapse the stereo field by down-mixing monoGain to a single channel.
  const setMono = useCallback((value: boolean) => {
    monoRef.current = value
    setMonoState(value)
    const monoGain = monoGainRef.current
    if (monoGain) {
      if (value) {
        monoGain.channelCountMode = 'explicit'
        monoGain.channelCount = 1
      } else {
        monoGain.channelCountMode = 'max'
        monoGain.channelCount = 2
      }
    }
  }, [])

  // Lazily registers the worklet module (once per context) and creates the
  // SoundTouch node, wiring its output into masterGain. The node is only ever
  // created the first time the user transposes — until then there is zero
  // worklet overhead and the default audio path is byte-identical to before.
  const ensureSoundTouchNode = useCallback(async (context: AudioContext) => {
    if (soundTouchNodeRef.current) {
      return soundTouchNodeRef.current
    }
    if (!soundTouchRegisteredRef.current) {
      await SoundTouchNode.register(context, soundtouchProcessorUrl)
      soundTouchRegisteredRef.current = true
    }
    // A concurrent call may have created the node while we awaited registration.
    if (soundTouchNodeRef.current) {
      return soundTouchNodeRef.current
    }
    // Lanczos resampling + full (non-quick) WSOLA seek = higher pitch-shift
    // quality than the defaults, at a little more CPU. Only ever active while
    // transposing, so it never touches the default playback path.
    const node = new SoundTouchNode({ context, outputChannelCount: 2, interpolationStrategy: 'lanczos' })
    node.pitchSemitones.value = transposeRef.current
    try {
      node.setStretchParameters({ quickSeek: false })
    } catch (error) {
      console.warn('[PlayerDock] SoundTouch quality params unsupported', error)
    }
    if (masterGainRef.current) {
      node.connect(masterGainRef.current)
    }
    soundTouchNodeRef.current = node
    return node
  }, [])

  // Routes mediaSource → soundTouch → masterGain when transposing, else straight
  // to masterGain. Re-run on every WaveSurfer (re)init and on transpose change,
  // since the MediaElementSourceNode is recreated each time WaveSurfer rebuilds.
  const applyTransposeRouting = useCallback(() => {
    const mediaSource = mediaElementSourceRef.current
    const masterGain = masterGainRef.current
    if (!mediaSource || !masterGain) {
      return
    }
    try {
      mediaSource.disconnect()
    } catch (e) {}
    const soundTouch = soundTouchNodeRef.current
    if (transposeRef.current !== 0 && soundTouch) {
      mediaSource.connect(soundTouch)
    } else {
      mediaSource.connect(masterGain)
    }
  }, [])

  // Transpose in semitones (−5…+5). At 0 the worklet is bypassed entirely, so the
  // carefully tuned loop/fade timing on the default path stays untouched. The
  // media element keeps preservesPitch=true (speed control), and SoundTouch only
  // applies an independent pitch shift on top — the two are orthogonal.
  const setTranspose = useCallback(
    async (semitones: number) => {
      const clamped = clamp(
        Math.round(semitones),
        TRANSPOSE_MIN_SEMITONES,
        TRANSPOSE_MAX_SEMITONES
      )
      transposeRef.current = clamped
      setTransposeState(clamped)
      if (clamped !== 0) {
        const context = audioContextRef.current
        if (context) {
          try {
            const node = await ensureSoundTouchNode(context)
            node.pitchSemitones.value = clamped
          } catch (error) {
            console.error('[PlayerDock] SoundTouch init failed', error)
          }
        }
      } else if (soundTouchNodeRef.current) {
        soundTouchNodeRef.current.pitchSemitones.value = 0
      }
      applyTransposeRouting()
    },
    [ensureSoundTouchNode, applyTransposeRouting]
  )

  const fadeOutTriggeredRef = useRef(false)
  const activeBoundsRef = useRef<LoopBounds | null>(null)
  const fadeInEndAtRef = useRef<number | null>(null)
  const skipNextFadeInRef = useRef(false)
  const skipFadeUntilTimeRef = useRef<number | null>(null)
  const pendingFadeInRef = useRef<LoopBounds | null>(null)
  const waveformHeight = transportMode === 'collapsed' ? 30 : 30
  const revealWithReason = useCallback(
    (reason: string) => {
      reveal(reason)
    },
    [reveal]
  )

  const scheduleCollapseWithReason = useCallback(
    (reason: string, delayMs?: number) => {
      scheduleCollapse(reason, delayMs)
    },
    [scheduleCollapse]
  )

  const handleSeekExtensionChange = useCallback((open: boolean) => {
    setSeekExtensionOpen(open)
  }, [])

  useEffect(() => {
    if (seekExtensionPrevRef.current && !seekExtensionOpen) {
      revealWithReason('seek-extension-close')
    }
    seekExtensionPrevRef.current = seekExtensionOpen
  }, [revealWithReason, seekExtensionOpen])

  const resolveSheetLinkFromClick = useCallback(
    (event: MouseEvent, container: HTMLDivElement): SheetPosition | null => {
      const target = event.target as HTMLElement | null
      let pageElement = target?.closest('[data-page-number]') as HTMLElement | null
      if (!pageElement) {
        const pages = Array.from(container.querySelectorAll<HTMLElement>('[data-page-number]'))
        const y = event.clientY
        pageElement =
          pages.find((page) => {
            const rect = page.getBoundingClientRect()
            return y >= rect.top && y <= rect.bottom
          }) ?? null
      }
      if (!pageElement) {
        return null
      }
      const pageNumber = Number(pageElement.dataset.pageNumber)
      if (!Number.isFinite(pageNumber)) {
        return null
      }
      const pageRect = pageElement.getBoundingClientRect()
      const pageHeight = getPageHeight(pageElement)
      const rawOffset = event.clientY - pageRect.top - SHEET_LINK_BUFFER_PX
      const yWithinPagePx = Math.max(0, rawOffset)
      return {
        page: pageNumber,
        yWithinPagePx,
        yWithinPageRatio:
          pageHeight > 0 ? clamp(yWithinPagePx / pageHeight, 0, 1) : undefined,
      }
    },
    []
  )

  const migrateSheetLinks = useCallback(
    (loops: SavedLoop[], container: HTMLDivElement) => {
      let changed = false
      let needsRetry = false
      const nextLoops = loops.map((loop) => {
        const link = loop.sheetLink
        if (!link) {
          return loop
        }
        const pageNumber = link.page
        const page = container.querySelector<HTMLElement>(
          `[data-page-number="${pageNumber}"]`
        )
        const pageHeight = page ? getPageHeight(page) : 0
        const legacyScrollTop = Number.isFinite(link.scrollTop)
          ? (link.scrollTop as number)
          : undefined
        let yWithinPagePx = Number.isFinite(link.yWithinPagePx)
          ? (link.yWithinPagePx as number)
          : undefined
        let yWithinPageRatio = Number.isFinite(link.yWithinPageRatio)
          ? (link.yWithinPageRatio as number)
          : undefined

        if (yWithinPagePx === undefined && legacyScrollTop !== undefined) {
          if (page && pageHeight > 0) {
            const pageTop = getPageOffsetTop(page, container)
            const isContainerRelative = legacyScrollTop >= pageTop - 1
            yWithinPagePx = Math.max(
              0,
              isContainerRelative ? legacyScrollTop - pageTop : legacyScrollTop
            )
          } else {
            yWithinPagePx = Math.max(0, legacyScrollTop)
          }
        }

        if (yWithinPagePx === undefined && yWithinPageRatio !== undefined && pageHeight > 0) {
          yWithinPagePx = clamp(yWithinPageRatio * pageHeight, 0, pageHeight)
        }

        if (yWithinPageRatio === undefined && pageHeight > 0 && yWithinPagePx !== undefined) {
          yWithinPageRatio = clamp(yWithinPagePx / pageHeight, 0, 1)
        } else if (yWithinPageRatio === undefined && yWithinPagePx !== undefined) {
          needsRetry = true
        }

        if (yWithinPagePx === undefined && yWithinPageRatio !== undefined) {
          needsRetry = true
        }

        if (
          yWithinPagePx === link.yWithinPagePx &&
          yWithinPageRatio === link.yWithinPageRatio &&
          legacyScrollTop === undefined
        ) {
          return loop
        }

        changed = true
        return {
          ...loop,
          sheetLink: {
            page: pageNumber,
            yWithinPagePx,
            yWithinPageRatio,
          },
        }
      })

      return { nextLoops: changed ? nextLoops : loops, changed, needsRetry }
    },
    []
  )

  const getExtendedBounds = useCallback(
    (region: { start: number; end: number }, totalDuration: number) => {
      const start = region.start ?? 0
      const end = region.end ?? start
      const durationValue = Number.isFinite(totalDuration) ? totalDuration : duration
      const safeDuration = Number.isFinite(durationValue) ? Math.max(0, durationValue) : 0
      const extendedStart = Math.max(0, start - LOOP_PAD_SECONDS)
      const extendedEnd = Math.min(safeDuration, end + LOOP_PAD_SECONDS)
      return { start, end, extendedStart, extendedEnd }
    },
    [duration]
  )

  const logLoopFade = useCallback((event: string, payload: Record<string, unknown>) => {
    if (!LOOP_FADE_DEBUG) {
      return
    }
    console.log('[LoopFade]', event, payload)
  }, [])

  const logSheetRepeat = useCallback((event: string, payload: Record<string, unknown>) => {
    if (!SHEET_REPEAT_DEBUG) {
      return
    }
    console.log('[SheetRepeat]', event, payload)
  }, [])

  const setActiveBounds = useCallback(
    (region: { start: number; end: number }, totalDuration: number) => {
      const bounds = getExtendedBounds(region, totalDuration)
      activeBoundsRef.current = bounds
      return bounds
    },
    [getExtendedBounds]
  )

  const resetFadeState = useCallback(() => {
    cancelRamps()
    fadeOutTriggeredRef.current = false
    fadeInEndAtRef.current = null
    skipFadeUntilTimeRef.current = null
    if (fadeOutCompleteTimeoutRef.current !== null) {
      window.clearTimeout(fadeOutCompleteTimeoutRef.current)
      fadeOutCompleteTimeoutRef.current = null
    }
  }, [cancelRamps])

  const cancelLoopFades = useCallback(() => {
    resetFadeState()
    setGainImmediate(1)
    if (DEBUG_LOOP_BG) {
      logLoopBg('fadeCancel', { volume: volumeValueRef.current })
    }
  }, [resetFadeState, setGainImmediate])

  const getFadeInDurationMs = useCallback(
    (
      bounds: { start: number; extendedStart: number; extendedEnd: number },
      currentTime: number
    ) => {
      const fadeEnd = Math.min(bounds.extendedEnd, bounds.start + LOOP_PAD_SECONDS)
      const startTime = Math.max(bounds.extendedStart, currentTime)
      const available = Math.max(0, fadeEnd - startTime)
      return Math.min(LOOP_FADE_SECONDS, available) * 1000
    },
    []
  )

  const getFadeOutDurationMs = useCallback(
    (bounds: { extendedStart: number; extendedEnd: number; end: number }, currentTime: number) => {
      const fadeOutStart = Math.max(bounds.end - LOOP_PAD_SECONDS, bounds.extendedStart)
      const startTime = Math.max(currentTime, fadeOutStart)
      const available = Math.max(0, bounds.extendedEnd - startTime)
      return Math.min(LOOP_FADE_SECONDS, available) * 1000
    },
    []
  )

  const startFadeIn = useCallback(
    (bounds: { start: number; extendedStart: number; extendedEnd: number }, currentTime: number) => {
      pendingFadeInRef.current = null
      if (skipNextFadeInRef.current) {
        skipNextFadeInRef.current = false
        fadeInEndAtRef.current = null
        fadeOutTriggeredRef.current = false
        setGainImmediate(1)
        if (DEBUG_LOOP_BG) {
          logLoopBg('fadeInSkip', { volume: volumeValueRef.current })
        }
        return
      }
      setGainImmediate(LOOP_MIN_VOLUME)
      if (DEBUG_LOOP_BG) {
        logLoopBg('fadeInSetFloor', { volume: volumeValueRef.current })
      }
      const startTime = Math.max(bounds.extendedStart, currentTime)
      const fadeInMs = getFadeInDurationMs(bounds, currentTime)
      if (fadeInMs > 0) {
        fadeInEndAtRef.current = startTime + fadeInMs / 1000
        logLoopFade('fadeInStart', {
          currentTime,
          fadeInMs,
          bounds,
        })
        rampGainTo(1, fadeInMs / 1000)
        if (DEBUG_LOOP_BG) {
          logLoopBg('fadeInRamp', { fadeInMs, volume: volumeValueRef.current })
        }
      } else {
        fadeInEndAtRef.current = null
        setGainImmediate(1)
        if (DEBUG_LOOP_BG) {
          logLoopBg('fadeInImmediate', { volume: volumeValueRef.current })
        }
      }
      fadeOutTriggeredRef.current = false
    },
    [getFadeInDurationMs, logLoopFade, rampGainTo, setGainImmediate]
  )

  const startFadeOut = useCallback(
    (bounds: { extendedStart: number; extendedEnd: number; end: number }, currentTime: number) => {
      const fadeOutMs = getFadeOutDurationMs(bounds, currentTime)
      logLoopFade('fadeOutStart', { currentTime, fadeOutMs, bounds })
      if (DEBUG_LOOP_BG) {
        logLoopBg('fadeOutStart', {
          currentTime,
          fadeOutMs,
          volume: volumeValueRef.current,
        })
        if (fadeOutCompleteTimeoutRef.current !== null) {
          window.clearTimeout(fadeOutCompleteTimeoutRef.current)
          fadeOutCompleteTimeoutRef.current = null
        }
        fadeOutCompleteTimeoutRef.current = window.setTimeout(() => {
          fadeOutCompleteTimeoutRef.current = null
          logLoopBg('fadeOutComplete', { volume: volumeValueRef.current })
        }, Math.max(0, fadeOutMs))
      }
      if (fadeOutMs > 0) {
        rampGainTo(LOOP_MIN_VOLUME, fadeOutMs / 1000)
        if (DEBUG_LOOP_BG) {
          logLoopBg('fadeOutRamp', { fadeOutMs, volume: volumeValueRef.current })
        }
      } else {
        setGainImmediate(LOOP_MIN_VOLUME)
        if (DEBUG_LOOP_BG) {
          logLoopBg('fadeOutImmediate', { volume: volumeValueRef.current })
        }
      }
      fadeOutTriggeredRef.current = true
    },
    [getFadeOutDurationMs, logLoopFade, rampGainTo, setGainImmediate]
  )

  const clearLoopTimers = useCallback(() => {
    if (fadeOutTimerRef.current !== null) {
      window.clearTimeout(fadeOutTimerRef.current)
      fadeOutTimerRef.current = null
    }
    if (wrapTimerRef.current !== null) {
      window.clearTimeout(wrapTimerRef.current)
      wrapTimerRef.current = null
    }
  }, [])

  const scheduleLoopTimers = useCallback(
    (options?: { skipFadeIn?: boolean; allowSeek?: boolean }) => {
      clearLoopTimers()
      const ws = waveSurferRef.current
      const activeId = activeRegionIdRef.current
      if (!ws || !activeId || !ws.isPlaying()) {
        return
      }
      const region = regionMapRef.current.get(activeId)
      if (!region) {
        return
      }
      const bounds = setActiveBounds(
        { start: region.start, end: region.end },
        ws.getDuration()
      )
      let currentTime = ws.getCurrentTime()
      if (currentTime < bounds.extendedStart && options?.allowSeek !== false) {
        ws.setTime(bounds.extendedStart)
        syncTakePlayback(bounds.extendedStart, true)
        currentTime = bounds.extendedStart
      }

      const fadeOutStart = Math.max(bounds.end - LOOP_PAD_SECONDS, bounds.extendedStart)
      const skipFade =
        options?.skipFadeIn ||
        (skipFadeUntilTimeRef.current !== null &&
          Math.abs(currentTime - skipFadeUntilTimeRef.current) <= SEEK_FADE_SKIP_SECONDS)
      if (skipFadeUntilTimeRef.current !== null) {
        skipFadeUntilTimeRef.current = null
      }

      if (!skipFade && currentTime <= bounds.extendedStart + 0.02) {
        startFadeIn(bounds, currentTime)
      }
      const scheduledId = activeId
      const doWrap = (ws: WaveSurfer, wrapTime: number, bounds: LoopBounds) => {
        if (loopRef.current) {
          if (DEBUG_LOOP_BG) {
            logLoopBg('wrapAttempt', {
              currentTime: wrapTime,
              extendedEnd: bounds.extendedEnd,
              targetStart: bounds.extendedStart,
              hidden: document.hidden,
              hasFocus: typeof document.hasFocus === 'function' ? document.hasFocus() : null,
            })
          }
          logLoopFade('fadeOutEnd', {
            currentTime: wrapTime,
            bounds,
            armedFadeOut: fadeOutTriggeredRef.current,
          })
          cancelLoopFades()
          ws.setTime(bounds.extendedStart)
          syncTakePlayback(bounds.extendedStart, true)
          if (DEBUG_LOOP_BG) {
            logLoopBg('wrapDidSeek', { targetStart: bounds.extendedStart })
          }
          if (!ws.isPlaying()) {
            const playResult = ws.play()
            if (playResult && typeof (playResult as Promise<void>).catch === 'function') {
              ;(playResult as Promise<void>).catch(() => {
                setIsPlaying(false)
                setGainImmediate(1)
              })
            }
          }
          const activeLoop = savedLoopsRef.current.find((loop) => loop.id === scheduledId)
          const sheetLink = activeLoop?.sheetLink
          const loopScrollOnRepeat = activeLoop?.scrollOnRepeat ?? scrollOnRepeatRef.current
          if (sheetLink && loopScrollOnRepeat && jumpOnEventRef.current) {
            const viewer = pdfViewerRef?.current ?? null
            if (isPdfScrollingRef.current) {
              logSheetRepeat('skip', { reason: 'scrolling', loopId: scheduledId })
            } else if (viewer) {
              viewer.scrollToSheetPosition(sheetLink, { behavior: 'smooth' })
              logSheetRepeat('scroll', { loopId: scheduledId, page: sheetLink.page })
              showScrollRepeatPrompt()
              fireJumpOnboarding()
            } else {
              logSheetRepeat('skip', { reason: 'no-viewer', loopId: scheduledId })
            }
          }
          startFadeIn(bounds, bounds.extendedStart)
          return
        }
        logLoopFade('fadeOutStop', { currentTime: wrapTime, bounds })
        ws.pause()
        ws.setTime(bounds.start)
        stopTakePlayback()
        cancelLoopFades()
      }

      if (currentTime >= bounds.extendedEnd) {
        clearLoopTimers()
        doWrap(ws, currentTime, bounds)
        if (loopRef.current) {
          scheduleLoopTimers({ skipFadeIn: true })
        }
        return
      }

      if (!fadeOutTriggeredRef.current && currentTime >= fadeOutStart) {
        startFadeOut(bounds, currentTime)
      }

      const rate =
        Number.isFinite(playbackRateRef.current) && playbackRateRef.current > 0
          ? Math.max(0.001, playbackRateRef.current)
          : 0.001
      const fadeOutDelayMs = getLoopDelayMs(currentTime, fadeOutStart, rate)
      if (DEBUG_LOOP_BG) {
        logLoopBg('timerArm', {
          timer: 'fadeOut',
          currentTime,
          targetTime: fadeOutStart,
          playbackRate: rate,
          delayMs: fadeOutDelayMs,
        })
      }
      fadeOutTimerRef.current = window.setTimeout(() => {
        fadeOutTimerRef.current = null
        const ws = waveSurferRef.current
        if (!ws || !ws.isPlaying() || activeRegionIdRef.current !== scheduledId) {
          return
        }
        const region = regionMapRef.current.get(scheduledId)
        if (!region || fadeOutTriggeredRef.current) {
          return
        }
        const bounds = setActiveBounds(
          { start: region.start, end: region.end },
          ws.getDuration()
        )
        startFadeOut(bounds, ws.getCurrentTime())
      }, fadeOutDelayMs)

      const wrapDelayMs = getLoopDelayMs(currentTime, bounds.extendedEnd, rate)
      if (DEBUG_LOOP_BG) {
        logLoopBg('timerArm', {
          timer: 'wrap',
          currentTime,
          targetTime: bounds.extendedEnd,
          playbackRate: rate,
          delayMs: wrapDelayMs,
        })
      }
      wrapTimerRef.current = window.setTimeout(() => {
        wrapTimerRef.current = null
        const ws = waveSurferRef.current
        if (!ws || !ws.isPlaying() || activeRegionIdRef.current !== scheduledId) {
          return
        }
        const region = regionMapRef.current.get(scheduledId)
        if (!region) {
          return
        }
        clearLoopTimers()
        const bounds = setActiveBounds(
          { start: region.start, end: region.end },
          ws.getDuration()
        )
        const wrapTime = ws.getCurrentTime()
        doWrap(ws, wrapTime, bounds)
        if (loopRef.current) {
          scheduleLoopTimers({ skipFadeIn: true })
        }
      }, wrapDelayMs)
    },
    [
      cancelLoopFades,
      clearLoopTimers,
      logLoopFade,
      setActiveBounds,
      startFadeIn,
      startFadeOut,
    ]
  )

  useEffect(() => {
    loopRef.current = loopOn
  }, [loopOn])

  useEffect(() => {
    const ws = waveSurferRef.current
    if (!ws || !activeRegionId) {
      clearLoopTimers()
      return
    }
    if (!ws.isPlaying()) {
      clearLoopTimers()
      return
    }
    scheduleLoopTimers()
  }, [activeRegionId, clearLoopTimers, isPlaying, loopOn, scheduleLoopTimers])

  useEffect(() => {
    if (DEBUG_LOOP_BG) {
      console.warn('[LoopBG] diagnostics active')
    }
  }, [])

  useEffect(() => {
    if (!DEBUG_LOOP_BG) {
      return
    }
    const intervalId = window.setInterval(() => {
      const ws = waveSurferRef.current
      if (!ws) {
        console.warn('[LoopBG] wsPoll', {
          timestamp: new Date().toISOString(),
          ws: 'null',
        })
        return
      }
      console.warn('[LoopBG] wsPoll', {
        timestamp: new Date().toISOString(),
        currentTime: ws.getCurrentTime(),
        isPlaying: ws.isPlaying(),
        hidden: typeof document !== 'undefined' ? document.hidden : null,
        hasFocus:
          typeof document !== 'undefined' && typeof document.hasFocus === 'function'
            ? document.hasFocus()
            : null,
      })
    }, 1000)
    return () => window.clearInterval(intervalId)
  }, [])

  useEffect(() => {
    if (!DEBUG_LOOP_BG || typeof document === 'undefined') {
      return
    }
    const handleVisibility = () => {
      const data = {
        hidden: document.hidden,
        hasFocus: typeof document.hasFocus === 'function' ? document.hasFocus() : null,
      }
      logLoopBg('visibilitychange', data)
      console.warn('[LoopBG] visibilitychange', data)
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [])

  useEffect(() => {
    if (!DEBUG_LOOP_BG || typeof document === 'undefined') {
      return
    }
    const logRate = () => {
      const data = {
        hidden: document.hidden,
        hasFocus: typeof document.hasFocus === 'function' ? document.hasFocus() : null,
        timeupdatePerSec: timeupdateCountRef.current,
        audioprocessPerSec: audioprocessCountRef.current,
      }
      logLoopBg('eventRate', data)
      console.warn('[LoopBG] eventRate', data)
      timeupdateCountRef.current = 0
      audioprocessCountRef.current = 0
    }
    logRate()
    const intervalId = window.setInterval(logRate, 1000)
    return () => {
      window.clearInterval(intervalId)
    }
  }, [])

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      const transportNode = transportRef.current
      if (transportNode && target && transportNode.contains(target)) {
        return
      }
      const waveformNode = containerRef.current
      if (waveformNode && target && waveformNode.contains(target)) {
        revealWithReason('tap')
        return
      }
      setIsInTransport(false)
      revealWithReason('tap')
    }

    window.addEventListener('pointerdown', handlePointerDown, { capture: true })
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, { capture: true })
    }
  }, [revealWithReason])

  useEffect(() => {
    const scrollElement = scrollContainerRef.current
    if (!scrollElement) {
      return
    }
    let lastScrollTop = scrollElement.scrollTop
    let rafId: number | null = null

    const handleScroll = () => {
      if (rafId !== null) {
        return
      }
      rafId = window.requestAnimationFrame(() => {
        rafId = null
        const nextScrollTop = scrollElement.scrollTop
        const delta = nextScrollTop - lastScrollTop
        if (Math.abs(delta) < SCROLL_THRESHOLD_PX) {
          return
        }
        if (delta > 0) {
          if (!isPointerDown && !isInTransport) {
            scheduleCollapseWithReason('scrollDown', 0)
          }
        } else {
          revealWithReason('scrollUp')
        }
        lastScrollTop = nextScrollTop
      })
    }

    scrollElement.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      scrollElement.removeEventListener('scroll', handleScroll)
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId)
      }
    }
  }, [isInTransport, isPointerDown, revealWithReason, scheduleCollapseWithReason, scrollContainerRef])

  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) {
      return
    }
    const handleScroll = () => {
      isPdfScrollingRef.current = true
      if (pdfScrollTimeoutRef.current !== null) {
        window.clearTimeout(pdfScrollTimeoutRef.current)
      }
      pdfScrollTimeoutRef.current = window.setTimeout(() => {
        isPdfScrollingRef.current = false
        pdfScrollTimeoutRef.current = null
      }, 160)
    }
    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      container.removeEventListener('scroll', handleScroll)
      if (pdfScrollTimeoutRef.current !== null) {
        window.clearTimeout(pdfScrollTimeoutRef.current)
        pdfScrollTimeoutRef.current = null
      }
    }
  }, [scrollContainerRef])

  useEffect(() => {
    activeRegionIdRef.current = activeRegionId
    if (!activeRegionId) {
      activeBoundsRef.current = null
      fadeInEndAtRef.current = null
      return
    }
    const ws = waveSurferRef.current
    const region = regionMapRef.current.get(activeRegionId)
    if (ws && region) {
      activeBoundsRef.current = setActiveBounds(
        { start: region.start, end: region.end },
        ws.getDuration()
      )
    }
  }, [activeRegionId, setActiveBounds])

  useEffect(() => {
    savedLoopsRef.current = savedLoops
  }, [savedLoops])

  const anchorsRef = useRef<Anchor[]>(anchors)
  const beatRef = useRef<BeatAnalysis | undefined>(beat)
  useEffect(() => {
    anchorsRef.current = anchors
    beatRef.current = beat
    timingModelRef.current = null // rebuild lazily from fresh anchors + bands + beat
    setTimingModelVersion(v => v + 1)
  }, [anchors, beat])

  // Resolve a loop's score position using the SAME engine as the live auto-scroll
  // (resolveScrollSegment), so a loop marker — and clicking it — lands exactly where
  // playback would put the playhead at that time. Using a different resolver here was
  // why a clicked loop could jump to a wildly wrong spot that play then corrected.
  // Before the first anchor the music is on the top system; with no model, the caller
  // falls back to the current view.
  const resolveLoopSheetPosition = useCallback(
    (songTime: number): SheetPosition | null => {
      const bands = pdfViewerRef?.current?.getSystemBands() ?? {}
      if (!timingModelRef.current && anchorsRef.current.length && Object.keys(bands).length) {
        timingModelRef.current = buildTimingModel(anchorsRef.current, bands, beatRef.current)
      }
      const model = timingModelRef.current
      if (!model || !model.systems.length) return null
      const seg = resolveScrollSegment(model, songTime)
      if (!seg) {
        // No segment (before first anchor with unsteady intro).
        return null
      }
      // For times past the last anchor (outro), use the full extent to the final system
      // so loops visualize their complete span, even with low tempo stability.
      const lastSample = model.samples[model.samples.length - 1]
      const sysIndex = songTime > lastSample.time
        ? model.systems.length - 1 // outro: always extend to final system
        : Math.round(seg.startSystem + seg.blend * (seg.endSystem - seg.startSystem))
      const sys = model.systems[Math.min(Math.max(sysIndex, 0), model.systems.length - 1)]
      return { page: sys.page, yWithinPageRatio: sys.band.topRatio }
    },
    [pdfViewerRef]
  )

  const fireJumpOnboarding = () => {
    if (jumpOnboardingShownRef.current) return
    jumpOnboardingShownRef.current = true
    if (typeof localStorage !== 'undefined') localStorage.setItem(JUMP_ONBOARDING_KEY, 'true')
    window.setTimeout(() => {
      toast('Score jumped to follow playback — tap the map pin button to turn this off', { duration: 5000 })
    }, 400)
  }

  // Unified score-follow on user navigation (seek buttons, scrub). Gated on the
  // jump-on-event toggle; resolves the song time to a system via the same engine as
  // the loop markers (resolveLoopSheetPosition) and fast-scrolls the score there.
  const scrollScoreToSongTime = useCallback(
    (songTime: number) => {
      if (!jumpOnEventRef.current) return
      const viewer = pdfViewerRef?.current
      if (!viewer) return
      // Restart to the very top resolves to page 1 even when the intro is too unsteady
      // for the timing model to return a segment.
      const pos =
        resolveLoopSheetPosition(songTime) ??
        (songTime <= 0.05 ? { page: 1, yWithinPageRatio: 0 } : null)
      if (!pos) return
      viewer.scrollToSheetPosition(pos, { behavior: 'smooth' })
      fireJumpOnboarding()
    },
    [pdfViewerRef, resolveLoopSheetPosition]
  )

  useEffect(() => {
    scrollOnRepeatRef.current = scrollOnRepeat
    if (!scrollOnRepeat) {
      setScrollRepeatPromptVisible(false)
    }
  }, [scrollOnRepeat])

  useEffect(() => {
    return () => {
      if (scrollRepeatPromptTimeoutRef.current !== null) {
        window.clearTimeout(scrollRepeatPromptTimeoutRef.current)
        scrollRepeatPromptTimeoutRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!hasHydrated) {
      return
    }
    const container = scrollContainerRef.current
    if (!container) {
      return
    }
    sheetLinkMigrationAttemptsRef.current = 0
    const runMigration = () => {
      const { nextLoops, changed, needsRetry } = migrateSheetLinks(
        savedLoopsRef.current,
        container
      )
      if (changed) {
        setSavedLoops(nextLoops)
      }
      if (needsRetry && sheetLinkMigrationAttemptsRef.current < 12) {
        sheetLinkMigrationAttemptsRef.current += 1
        sheetLinkMigrationTimeoutRef.current = window.setTimeout(runMigration, 250)
      }
    }
    runMigration()
    return () => {
      sheetLinkMigrationAttemptsRef.current = 0
      if (sheetLinkMigrationTimeoutRef.current !== null) {
        window.clearTimeout(sheetLinkMigrationTimeoutRef.current)
        sheetLinkMigrationTimeoutRef.current = null
      }
    }
  }, [hasHydrated, migrateSheetLinks, scrollContainerRef])

  useEffect(() => {
    playbackRateRef.current = playbackRate
  }, [playbackRate])

  useEffect(() => {
    takeVolumeRef.current = takeVolume
    if (takeGainRef.current) {
      takeGainRef.current.gain.value = takeVolume
    }
  }, [takeVolume])

  useEffect(() => {
    takeMetaRef.current = takeMeta
  }, [takeMeta])

  useEffect(() => {
    const storedLoops = store.load<SavedLoop[]>(LOOPS_STORAGE_KEY)
    if (storedLoops && Array.isArray(storedLoops)) {
      setSavedLoops(normalizeSavedLoops(storedLoops))
    }

    const storedScrollOnRepeat = store.load<boolean>(SCROLL_ON_REPEAT_STORAGE_KEY)
    if (typeof storedScrollOnRepeat === 'boolean') {
      setScrollOnRepeat(storedScrollOnRepeat)
      scrollOnRepeatRef.current = storedScrollOnRepeat
    }
    // Restore into refs synchronously so ensureBalanceChain picks them up when
    // the audio graph is first built (this effect runs before WaveSurfer setup).
    const storedBalance = store.load<number>(BALANCE_STORAGE_KEY)
    if (typeof storedBalance === 'number') {
      balanceRef.current = storedBalance
      setBalanceState(storedBalance)
    }
    const storedMono = store.load<boolean>(MONO_STORAGE_KEY)
    if (typeof storedMono === 'boolean') {
      monoRef.current = storedMono
      setMonoState(storedMono)
    }
    const storedTranspose = store.load<number>(TRANSPOSE_STORAGE_KEY)
    if (typeof storedTranspose === 'number') {
      const clampedTranspose = clamp(
        Math.round(storedTranspose),
        TRANSPOSE_MIN_SEMITONES,
        TRANSPOSE_MAX_SEMITONES
      )
      transposeRef.current = clampedTranspose
      setTransposeState(clampedTranspose)
    }
    const storedSpeed = store.load<number>(SPEED_STORAGE_KEY)
    if (typeof storedSpeed === 'number' && storedSpeed > 0) {
      playbackRateRef.current = storedSpeed
      setPlaybackRate(storedSpeed)
    }
    const storedTake = store.load<TakeMeta>(TAKE_STORAGE_KEY)
    if (storedTake?.id) {
      setTakeMeta(storedTake)
      setTakeVolume(storedTake.volume ?? 0.9)
    }
    const storedRepeatSong = store.load<boolean>(REPEAT_SONG_STORAGE_KEY)
    if (typeof storedRepeatSong === 'boolean') {
      repeatSongRef.current = storedRepeatSong
      setRepeatSong(storedRepeatSong)
    }
    const storedRepeatLoop = store.load<boolean>(REPEAT_LOOP_STORAGE_KEY)
    if (typeof storedRepeatLoop === 'boolean') {
      repeatLoopRef.current = storedRepeatLoop
      setRepeatLoop(storedRepeatLoop)
    }
    const storedJumpOnEvent = store.load<boolean>(JUMP_ON_EVENT_STORAGE_KEY)
    if (typeof storedJumpOnEvent === 'boolean') {
      jumpOnEventRef.current = storedJumpOnEvent
      setJumpOnEvent(storedJumpOnEvent)
    }
    // No loop is active at hydration, so the live flag reflects the song value.
    setLoopOn(repeatSongRef.current)
    setHasHydrated(true)
  }, [])

  useEffect(() => {
    if (!hasHydrated) {
      return
    }
    const normalized = normalizeSavedLoops(savedLoops)
    if (normalized !== savedLoops) {
      setSavedLoops(normalized)
      return
    }
    store.save(LOOPS_STORAGE_KEY, normalized)
  }, [savedLoops, hasHydrated])

  useEffect(() => {
    if (savedLoops.length > nextColorIndexRef.current) {
      nextColorIndexRef.current = savedLoops.length
    }
  }, [savedLoops.length])

  useEffect(() => {
    if (!hasHydrated) {
      return
    }
    store.save(TAKE_STORAGE_KEY, takeMeta ? { ...takeMeta, volume: takeVolume } : null)
  }, [takeMeta, takeVolume, hasHydrated])

  useEffect(() => {
    if (!hasHydrated) {
      return
    }
    store.save(SCROLL_ON_REPEAT_STORAGE_KEY, scrollOnRepeat)
  }, [hasHydrated, scrollOnRepeat])

  useEffect(() => {
    if (!hasHydrated) {
      return
    }
    store.save(BALANCE_STORAGE_KEY, balance)
    store.save(MONO_STORAGE_KEY, mono)
    store.save(TRANSPOSE_STORAGE_KEY, transpose)
    store.save(REPEAT_SONG_STORAGE_KEY, repeatSong)
    store.save(REPEAT_LOOP_STORAGE_KEY, repeatLoop)
    store.save(JUMP_ON_EVENT_STORAGE_KEY, jumpOnEvent)
  }, [hasHydrated, balance, mono, transpose, repeatSong, repeatLoop, jumpOnEvent])

  useEffect(() => {
    if (!hasHydrated) {
      return
    }
    store.save(SPEED_STORAGE_KEY, playbackRate)
  }, [hasHydrated, playbackRate])

  // Once the audio graph exists, lazily build the SoundTouch node and reroute if
  // a non-zero transpose was restored from a previous session.
  useEffect(() => {
    if (!audioReady) {
      return
    }
    if (transposeRef.current !== 0) {
      void setTranspose(transposeRef.current)
    }
  }, [audioReady, setTranspose])

  // The AudioContext is created during mount (no user gesture), so Chrome's
  // autoplay policy leaves it suspended. Because the media element is captured
  // by a MediaElementSourceNode, a suspended context = total silence even while
  // "playing". Resume it on the first real user interaction anywhere — this
  // covers every play path (play button, loop chips, waveform seeks), not just
  // togglePlay. Idempotent and cheap: a no-op once the context is running.
  useEffect(() => {
    const resumeOnGesture = () => {
      const context = audioContextRef.current
      if (context && context.state === 'suspended') {
        context.resume().catch(() => undefined)
      }
    }
    document.addEventListener('pointerdown', resumeOnGesture, { capture: true })
    document.addEventListener('keydown', resumeOnGesture, { capture: true })
    return () => {
      document.removeEventListener('pointerdown', resumeOnGesture, { capture: true })
      document.removeEventListener('keydown', resumeOnGesture, { capture: true })
    }
  }, [])

  // Detect the source's true channel count so the mono toggle is only offered
  // for stereo tracks. WaveSurfer's getDecodedData() downmixes to mono for the
  // waveform, so it can't be trusted — decode the file ourselves at a low
  // sample rate (channel count survives resampling; memory stays small).
  useEffect(() => {
    let cancelled = false
    const OfflineCtor =
      window.OfflineAudioContext ||
      (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
        .webkitOfflineAudioContext
    if (!OfflineCtor) return
    ;(async () => {
      try {
        const response = await fetch(audioUrl)
        const arrayBuffer = await response.arrayBuffer()
        const offline = new OfflineCtor(2, 1, 8000)
        const decoded = await offline.decodeAudioData(arrayBuffer)
        if (!cancelled) setSourceChannelCount(decoded.numberOfChannels)
      } catch {
        // Leave null → treated as stereo (toggle shown) on failure.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => () => cancelRamps(), [cancelRamps])

  useEffect(() => {
    if (!takeMeta?.id || takeLoadedRef.current === takeMeta.id) {
      return
    }
    let cancelled = false
    ;(async () => {
      const blob = await getAudioBlob(takeMeta.id)
      if (!blob || cancelled) {
        return
      }
      await loadTakeFromBlob(blob, takeMeta)
    })()
    return () => {
      cancelled = true
    }
  }, [takeMeta?.id])

  useEffect(() => {
    if (!containerRef.current) {
      return
    }

    setIsReady(false)
    setAudioReady(false)

    let destroyed = false
    const audioContext = ensureAudioContext()
    ensureMasterGain(audioContext) // also builds the balance/mono chain + destination
    const mediaEl = new Audio()
    mediaEl.preload = 'auto'
    mediaEl.crossOrigin = 'anonymous'
    enablePitchCorrection(mediaEl)
    const mediaSource = audioContext.createMediaElementSource(mediaEl)
    mediaElementRef.current = mediaEl
    mediaElementSourceRef.current = mediaSource
    // Connect mediaSource → (soundTouch if transposing) → masterGain.
    applyTransposeRouting()
    const waveSurfer = WaveSurfer.create({
      container: containerRef.current,
      waveColor: '#9ca3af',
      progressColor: '#4F7F7A',
      cursorColor: 'rgba(17, 24, 39)',
      cursorWidth: 2,
      height: waveformHeight,
      normalize: true,
      hideScrollbar: true,
      dragToSeek: true,
      responsive: true,
      backend: 'MediaElement',
      media: mediaEl,
    })

    const regions = waveSurfer.registerPlugin(RegionsPlugin.create())
    waveSurferRef.current = waveSurfer
    regionsRef.current = regions
    if (import.meta.env.DEV && typeof window !== 'undefined') {
      ;(window as Record<string, unknown>).__ws = waveSurfer
      ;(window as Record<string, unknown>).__regions = regions
    }
    if (DEBUG_LOOP_BG) {
      logLoopBg('wsCreated', { hasContainer: Boolean(containerRef.current) })
    }
    const loadResult = waveSurfer.load(audioUrl)
    if (loadResult && typeof (loadResult as Promise<void>).catch === 'function') {
      ;(loadResult as Promise<void>).catch((error) => {
        const err = error as { name?: string; message?: string }
        if (err?.name !== 'AbortError') {
          console.error('[PlayerDock] WaveSurfer load failed', error)
        }
      })
    }

    waveSurfer.on('ready', () => {
      if (destroyed || waveSurferRef.current !== waveSurfer) {
        return
      }
      if (DEBUG_LOOP_BG) {
        logLoopBg('wsReady', { duration: waveSurfer.getDuration() })
      }
      setIsReady(true)
      setAudioReady(true)
      setDuration(waveSurfer.getDuration())
      const activeId = activeRegionIdRef.current
      if (activeId) {
        const r = regionMapRef.current.get(activeId)
        if (r) updateGreyOverlays(r)
      }
      enablePitchCorrection(mediaEl)
      waveSurfer.setPlaybackRate(playbackRateRef.current, true)
    })

    waveSurfer.on('play', () => {
      if (destroyed || waveSurferRef.current !== waveSurfer) {
        return
      }
      if (DEBUG_LOOP_BG) {
        logLoopBg('wsPlay', { currentTime: waveSurfer.getCurrentTime() })
      }
      setIsPlaying(true)
      syncTakePlayback(waveSurfer.getCurrentTime(), true)
      const pendingFade = pendingFadeInRef.current
      if (pendingFade) {
        if (activeRegionIdRef.current) {
          startFadeIn(pendingFade, waveSurfer.getCurrentTime())
          pendingFadeInRef.current = null
          scheduleLoopTimers({ skipFadeIn: true })
          return
        } else {
          pendingFadeInRef.current = null
        }
      }
      scheduleLoopTimers()
    })

    waveSurfer.on('pause', () => {
      if (destroyed || waveSurferRef.current !== waveSurfer) {
        return
      }
      if (DEBUG_LOOP_BG) {
        logLoopBg('wsPause', { currentTime: waveSurfer.getCurrentTime() })
      }
      setIsPlaying(false)
      cancelLoopFades()
      clearLoopTimers()
      stopTakePlayback()
      if (import.meta.env.DEV) {
        pdfViewerRef?.current?.setSyncHighlight(null)
        // Pause ON a sung word to compare what you HEAR with what the scroll is following.
        if (timingModelRef.current) {
          logScrollProbe(timingModelRef.current, anchorsRef.current, trackToSongTime(waveSurfer.getCurrentTime()))
        }
      }
    })

    waveSurfer.on('finish', () => {
      if (destroyed || waveSurferRef.current !== waveSurfer) {
        return
      }
      if (DEBUG_LOOP_BG) {
        logLoopBg('wsFinish', { currentTime: waveSurfer.getCurrentTime() })
      }
      clearLoopTimers()
      if (activeRegionIdRef.current) {
        return
      }
      if (loopRef.current) {
        waveSurfer.seekTo(0)
        waveSurfer.play()
        syncTakePlayback(0, true)
        return
      }
      setIsPlaying(false)
      cancelLoopFades()
      stopTakePlayback()
    })

    waveSurfer.on('seeking', () => {
      if (destroyed || waveSurferRef.current !== waveSurfer) return
    })

    waveSurfer.on('interaction', (time: number) => {
      if (destroyed || waveSurferRef.current !== waveSurfer) {
        return
      }
      cancelLoopFades()
      if (dragSeekRef.current) {
        skipFadeUntilTimeRef.current = time
      }
      syncTakePlayback(time, true)
      scheduleLoopTimers()
    })
    // WaveSurfer emits 'interaction' on every drag mousemove, so we can't use it
    // for score-jump (would look like continuous auto-scroll). Instead use 'click'
    // (one-shot click seek) and 'dragend' (scrub release) — each fires exactly once.
    waveSurfer.on('click', (relativeX: number) => {
      if (destroyed || waveSurferRef.current !== waveSurfer) return
      scrollScoreToSongTime(trackToSongTime(relativeX * waveSurfer.getDuration()))
    })
    waveSurfer.on('dragend', (relativeX: number) => {
      if (destroyed || waveSurferRef.current !== waveSurfer) return
      scrollScoreToSongTime(trackToSongTime(relativeX * waveSurfer.getDuration()))
    })

    waveSurfer.on('region-clicked', (region: any, event: MouseEvent) => {
      if (destroyed || waveSurferRef.current !== waveSurfer) {
        return
      }
      if (region.id === activeRegionIdRef.current) {
        return
      }
      event.stopPropagation()
      activateRegion(region.id, { autoplay: true })
    })

    waveSurfer.on('timeupdate', (time: number) => {
      if (destroyed || waveSurferRef.current !== waveSurfer) {
        return
      }
      if (DEBUG_LOOP_BG) {
        timeupdateCountRef.current += 1
        timeupdateLogCounterRef.current += 1
        if (!sawTimeupdateRef.current) {
          sawTimeupdateRef.current = true
          logLoopBg('timeupdateFirst', { currentTime: time })
        }
        if (timeupdateLogCounterRef.current % 120 === 0) {
          console.warn('[LoopBG] timeupdateTick', {
            timestamp: new Date().toISOString(),
            currentTime: time,
            hidden: document.hidden,
            hasFocus: typeof document.hasFocus === 'function' ? document.hasFocus() : null,
          })
        }
      }
      if (waveSurfer.isPlaying()) {
        syncTakePlayback(time, false)
        const currentAnchors = anchorsRef.current
        if (currentAnchors.length) {
          const anchor = anchorAtTime(currentAnchors, time)
          if (import.meta.env.DEV && anchor) {
            pdfViewerRef?.current?.setSyncHighlight({
              page: anchor.page,
              yWithinPageRatio: anchor.yWithinPageRatio,
              text: anchor.text,
              confidence: anchor.confidence,
              time: anchor.time,
            })
          }
        }
      }
      runDriftGuard(time, 'timeupdate')
    })
    waveSurfer.on('audioprocess', (time: number) => {
      if (destroyed || waveSurferRef.current !== waveSurfer) {
        return
      }
      runDriftGuard(time, 'audioprocess')
      if (DEBUG_LOOP_BG) {
        audioprocessCountRef.current += 1
        if (!sawAudioprocessRef.current) {
          sawAudioprocessRef.current = true
          logLoopBg('audioprocessFirst')
        }
      }
    })

    return () => {
      destroyed = true
      clearLoopTimers()
      try {
        mediaSource.disconnect()
      } catch (e) {}
      if (mediaElementSourceRef.current === mediaSource) {
        mediaElementSourceRef.current = null
      }
      mediaEl.pause()
      mediaEl.src = ''
      try {
        mediaEl.load()
      } catch (e) {}
      if (mediaElementRef.current === mediaEl) {
        mediaElementRef.current = null
      }
      const instance = waveSurferRef.current
      if (!instance || instance !== waveSurfer) {
        return
      }
      waveSurferRef.current = null
      try {
        const result = instance.destroy()
        Promise.resolve(result).catch((error) => {
          const err = error as { name?: string; message?: string }
          if (err?.name !== 'AbortError') {
            console.error('[PlayerDock] WaveSurfer destroy failed', error)
          }
        })
      } catch (error) {
        const err = error as { name?: string; message?: string }
        if (err?.name !== 'AbortError') {
          console.error('[PlayerDock] WaveSurfer destroy failed', error)
        }
      }
    }
  }, [])

  useEffect(() => {
    enablePitchCorrection(mediaElementRef.current)
    if (!waveSurferRef.current) {
      return
    }
    waveSurferRef.current.setOptions({
      height: waveformHeight,
      waveColor: '#9ca3af',
      progressColor: '#4F7F7A',
    })
  }, [transportMode, waveformHeight])

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }

    const handlePointerDown = (event: PointerEvent) => {
      setIsPointerDown(true)
      if (!activeRegionIdRef.current) {
        return
      }
      if (resizingRegionRef.current) {
        return
      }
      if (isPointerOnHandle(event.clientX, event.clientY)) {
        return
      }
      dragSeekRef.current = true
      seekToClientX(event.clientX)
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (!dragSeekRef.current) {
        return
      }
      seekToClientX(event.clientX)
    }

    const handlePointerUp = (event: PointerEvent) => {
      if (interactionLockRef.current) {
        interactionLockRef.current = false
        waveSurferRef.current?.toggleInteraction(true)
      }
      if (dragSeekRef.current) {
        skipFadeUntilTimeRef.current = waveSurferRef.current?.getCurrentTime() ?? null
      }
      dragSeekRef.current = false
      setIsPointerDown(false)
    }

    const handlePointerCancel = () => {
      if (dragSeekRef.current) {
        skipFadeUntilTimeRef.current = waveSurferRef.current?.getCurrentTime() ?? null
      }
      dragSeekRef.current = false
      if (interactionLockRef.current) {
        interactionLockRef.current = false
        waveSurferRef.current?.toggleInteraction(true)
      }
      setIsPointerDown(false)
    }

    container.addEventListener('pointerdown', handlePointerDown, { capture: true })
    container.addEventListener('pointermove', handlePointerMove, { capture: true })
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerCancel)

    return () => {
      container.removeEventListener('pointerdown', handlePointerDown, { capture: true })
      container.removeEventListener('pointermove', handlePointerMove, { capture: true })
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerCancel)
    }
  }, [])

  useEffect(() => {
    if (!recordPanelOpen) {
      if (recordPluginRef.current?.isRecording()) {
        recordPluginRef.current.stopRecording()
      }
      recordPluginRef.current?.stopMic()
      setIsRecording(false)
      return
    }

    ensureRecordWaveSurfer()
    ensureTakeWaveSurfer()
    recordPluginRef.current?.startMic().catch(() => {
      toast('Microphone access needed')
    })
  }, [recordPanelOpen])

  useEffect(() => {
    if (!recordPanelOpen || !takeMeta) {
      return
    }
    ensureTakeWaveSurfer()
  }, [recordPanelOpen, takeMeta?.id])

  useEffect(() => {
    if (!waveSurferRef.current) {
      return
    }
    waveSurferRef.current.setPlaybackRate(playbackRate, true)
    if (waveSurferRef.current.isPlaying()) {
      syncTakePlayback(waveSurferRef.current.getCurrentTime(), true)
      scheduleLoopTimers({ allowSeek: false })
    } else {
      clearLoopTimers()
    }
  }, [playbackRate])

  useEffect(() => {
    if (!isPlaying || !activeRegionId || !loopOn) {
      repeatCountdownRef.current = null
      setRepeatCountdown(null)
      if (countdownTimerRef.current !== null) {
        window.clearInterval(countdownTimerRef.current)
        countdownTimerRef.current = null
      }
      return
    }
    const intervalId = window.setInterval(() => {
      const ws = waveSurferRef.current
      const activeId = activeRegionIdRef.current
      const region = activeId ? regionMapRef.current.get(activeId) : null
      if (!ws || !region || !ws.isPlaying() || !loopRef.current) {
        if (repeatCountdownRef.current !== null) {
          repeatCountdownRef.current = null
          setRepeatCountdown(null)
        }
        return
      }
      const bounds = setActiveBounds({ start: region.start, end: region.end }, ws.getDuration())
      const remaining = bounds.extendedEnd - ws.getCurrentTime()
      const next =
        remaining <= LOOP_COUNTDOWN_SECONDS && remaining >= 0 ? remaining : null
      if (repeatCountdownRef.current !== next) {
        repeatCountdownRef.current = next
        setRepeatCountdown(next)
      }
    }, 100)
    countdownTimerRef.current = intervalId
    return () => {
      if (countdownTimerRef.current === intervalId) {
        countdownTimerRef.current = null
      }
      window.clearInterval(intervalId)
    }
  }, [activeRegionId, isPlaying, loopOn, setActiveBounds])

  const activeRegion = activeRegionId
    ? regionMapRef.current.get(activeRegionId) ?? null
    : null
  const activeSavedLoop = useMemo(
    () => savedLoops.find((loop) => loop.id === activeRegionId) ?? null,
    [savedLoops, activeRegionId]
  )
  const activeSavedLoopId = activeSavedLoop?.id ?? null
  const activeSavedLoopHasSheetLink = Boolean(activeSavedLoop?.sheetLink)
  const loopMarkers = useMemo<LoopSheetMarker[]>(() => {
    const out: LoopSheetMarker[] = []
    for (const loop of savedLoops) {
      // Prefer the timing model (same measure axis as auto-scroll) so both the
      // start and end positions track live as the loop is dragged; fall back to
      // the stored start link when the song isn't synced yet (end then unset →
      // the rail/page bars draw a min-height marker).
      const start =
        resolveLoopSheetPosition(loop.start) ?? loop.sheetLink ?? loop.sheetLinkDraft
      if (!start) continue
      out.push({
        id: loop.id,
        name: loop.name,
        color: loop.color ?? '#94a3b8',
        sheetLink: start,
        sheetLinkEnd: resolveLoopSheetPosition(loop.end) ?? undefined,
        active: loop.id === activeRegionId,
      })
    }
    return out
    // `timingModelVersion` increments when anchors/beat change OR when the PDF first
    // renders system bands — whichever arrives last. That's exactly when the timing model
    // can be successfully built, so the memo recomputes at the right moment regardless of
    // arrival order. `savedLoops` tracks live drags; `activeRegionId` updates active state.
  }, [savedLoops, timingModelVersion, resolveLoopSheetPosition, activeRegionId])
  const countdownRemaining = repeatCountdown !== null ? Math.max(0, repeatCountdown) : null
  const showCountdown = countdownRemaining !== null
  const countdownProgress = showCountdown
    ? Math.min(1, Math.max(0, 1 - countdownRemaining / LOOP_COUNTDOWN_SECONDS))
    : 0
  const countdownSeconds = showCountdown ? Math.max(0, Math.ceil(countdownRemaining)) : 0
  const showStayHere =
    showCountdown && Boolean(activeSavedLoop?.sheetLink) && scrollOnRepeat
  const showCountdownOverlay = showCountdown && !scrollRepeatPromptVisible
  const countdownOverlayPresence = useOverlayPresence(showCountdownOverlay, OVERLAY_ANIMATION_MS)
  const scrollRepeatOverlayPresence = useOverlayPresence(
    scrollRepeatPromptVisible,
    OVERLAY_ANIMATION_MS
  )
  const countdownRadius = 14
  const countdownCircumference = 2 * Math.PI * countdownRadius
  const countdownDashOffset = countdownCircumference * (1 - countdownProgress)
  const countdownPositionClass =
    transportMode === 'collapsed'
      ? 'right-4 top-0 -translate-y-[calc(100%+36px)] sm:-translate-y-[calc(100%+12px)]'
      : 'right-4 top-0 -translate-y-[calc(100%+60px)] sm:-translate-y-[calc(100%+20px)]'
  const overlayActionButtonClassName =
    'pointer-events-auto whitespace-nowrap rounded-full border border-[#4F7F7A]/55 bg-[#f1f1f1] px-3 py-1 text-xs font-semibold text-[#0b1220] shadow-sm shadow-black/10 backdrop-blur-sm transition hover:bg-[#e7e7e7] active:bg-[#dedede] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4F7F7A]/40 focus-visible:ring-offset-2 focus-visible:ring-offset-white/80'
  const ensureAudioContext = () => {
    if (!audioContextRef.current) {
      const context = new AudioContext()
      const gain = context.createGain()
      gain.gain.value = takeVolumeRef.current
      gain.connect(context.destination)
      audioContextRef.current = context
      takeGainRef.current = gain
    }
    if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume().catch(() => undefined)
    }
    return audioContextRef.current
  }

  const getHandleColor = (color: string | null | undefined) => {
    if (!color) {
      return 'rgba(71, 85, 105, 1)'
    }
    const match = color.match(
      /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([0-9.]+))?\s*\)/i
    )
    if (!match) {
      return 'rgba(71, 85, 105, 1)'
    }
    const red = Number(match[1])
    const green = Number(match[2])
    const blue = Number(match[3])
    const factor = 0.82
    return `rgba(${Math.round(red * factor)}, ${Math.round(green * factor)}, ${Math.round(
      blue * factor
    )}, 1)`
  }

  const setRegionHandleColor = (region: any, color?: string | null) => {
    const element = region?.element as HTMLElement | undefined
    if (!element) {
      return
    }
    const nextColor =
      color ?? region.loopColor ?? region.color ?? region.options?.color ?? null
    element.style.setProperty('--region-handle-color', getHandleColor(nextColor))
    element.style.setProperty('--region-handle-grip', getGripColor(nextColor))
  }

  const seekToClientX = (clientX: number) => {
    const ws = waveSurferRef.current
    if (!ws) {
      return
    }
    cancelLoopFades()
    const wrapper = ws.getWrapper()
    if (!wrapper) {
      return
    }
    const rect = wrapper.getBoundingClientRect()
    if (!rect.width) {
      return
    }
    const ratio = (clientX - rect.left) / rect.width
    const clamped = Math.min(1, Math.max(0, ratio))
    const time = clamped * ws.getDuration()
    if (activeRegionIdRef.current) {
      const region = regionMapRef.current.get(activeRegionIdRef.current)
      if (region && (time < region.start || time > region.end)) {
        exitLoop()
      }
    }
    const wasPlaying = ws.isPlaying()
    ws.setTime(time)
    syncTakePlayback(time, true)
    if (wasPlaying) {
      ws.play()
    }
    scheduleLoopTimers()
  }

  const getNextLoopColor = () => {
    const index = nextColorIndexRef.current % LOOP_COLORS.length
    const color = LOOP_COLORS[index]
    nextColorIndexRef.current += 1
    return color
  }

  const getGripColor = (color: string | null | undefined) => {
    if (!color) {
      return 'rgba(148, 163, 184, 0.9)'
    }
    const match = color.match(
      /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([0-9.]+))?\s*\)/i
    )
    if (!match) {
      return 'rgba(148, 163, 184, 0.9)'
    }
    const red = Number(match[1])
    const green = Number(match[2])
    const blue = Number(match[3])
    const lighten = 0.35
    const nextRed = Math.round(red + (255 - red) * lighten)
    const nextGreen = Math.round(green + (255 - green) * lighten)
    const nextBlue = Math.round(blue + (255 - blue) * lighten)
    return `rgba(${nextRed}, ${nextGreen}, ${nextBlue}, 0.9)`
  }

  const setRegionVisuals = (region: any, loopColor: string) => {
    region.loopColor = loopColor
    region.setOptions({ color: REGION_TRANSPARENT_COLOR })
    setRegionHandleColor(region, loopColor)
    setRegionHandleAccessibility(region)
    const element = region?.element as HTMLElement | undefined
    if (element?.getAttribute('data-active') === 'true') {
      setRegionActiveState(region, true)
    }
  }

  const setRegionLabel = (region: any, name: string) => {
    if (region) region.loopName = name
  }

  const setRegionHandleAccessibility = (region: any) => {
    const element = region?.element as HTMLElement | undefined
    if (!element) {
      return
    }
    const leftHandle = element.querySelector('[part*="region-handle-left"]')
    const rightHandle = element.querySelector('[part*="region-handle-right"]')
    const stopSeek = (event: Event) => {
      event.stopPropagation()
    }
    const lockInteraction = () => {
      if (!interactionLockRef.current) {
        interactionLockRef.current = true
        waveSurferRef.current?.toggleInteraction(false)
      }
    }
    const unlockInteraction = () => {
      if (interactionLockRef.current) {
        interactionLockRef.current = false
        waveSurferRef.current?.toggleInteraction(true)
      }
    }
    if (leftHandle instanceof HTMLElement) {
      leftHandle.setAttribute('aria-label', 'Resize loop start')
      leftHandle.setAttribute('role', 'slider')
      if (!leftHandle.dataset.bound) {
        leftHandle.dataset.bound = 'true'
        leftHandle.addEventListener('pointerdown', (event) => {
          stopSeek(event)
          lockInteraction()
        })
        leftHandle.addEventListener('pointerup', unlockInteraction)
        leftHandle.addEventListener('pointercancel', unlockInteraction)
        leftHandle.addEventListener('click', stopSeek, { capture: true })
      }
    }
    if (rightHandle instanceof HTMLElement) {
      rightHandle.setAttribute('aria-label', 'Resize loop end')
      rightHandle.setAttribute('role', 'slider')
      if (!rightHandle.dataset.bound) {
        rightHandle.dataset.bound = 'true'
        rightHandle.addEventListener('pointerdown', (event) => {
          stopSeek(event)
          lockInteraction()
        })
        rightHandle.addEventListener('pointerup', unlockInteraction)
        rightHandle.addEventListener('pointercancel', unlockInteraction)
        rightHandle.addEventListener('click', stopSeek, { capture: true })
      }
    }
  }

  const setRegionActiveState = (region: any, isActive: boolean) => {
    const element = region?.element as HTMLElement | undefined
    if (!element) {
      return
    }
    if (isActive) {
      element.setAttribute('data-active', 'true')
      const color =
        region.loopColor ?? region.color ?? region.options?.color ?? null
      const borderColor = getHandleColor(color)
      element.style.borderTop = `3px solid ${borderColor}`
      element.style.borderBottom = `3px solid ${borderColor}`
      element.style.borderRadius = '0'
      element.style.zIndex = '2'
    } else {
      element.removeAttribute('data-active')
      element.style.borderTop = ''
      element.style.borderBottom = ''
      element.style.borderRadius = ''
      element.style.zIndex = ''
    }
  }

  const isPointerOnHandle = (clientX: number, clientY: number) => {
    const activeId = activeRegionIdRef.current
    if (!activeId) {
      return false
    }
    const region = regionMapRef.current.get(activeId)
    const element = region?.element as HTMLElement | undefined
    if (!element) {
      return false
    }
    const handles = element.querySelectorAll('[part*="region-handle"]')
    for (const handle of Array.from(handles)) {
      if (!(handle instanceof HTMLElement)) {
        continue
      }
      const rect = handle.getBoundingClientRect()
      const padding = 6
      if (
        clientX >= rect.left - padding &&
        clientX <= rect.right + padding &&
        clientY >= rect.top - padding &&
        clientY <= rect.bottom + padding
      ) {
        return true
      }
    }
    return false
  }

  const ensureRecordWaveSurfer = () => {
    if (recordWaveSurferRef.current || !recordContainerRef.current) {
      return recordWaveSurferRef.current
    }
    const recordWaveSurfer = WaveSurfer.create({
      container: recordContainerRef.current,
      waveColor: '#ef4444',
      progressColor: '#ef4444',
      cursorColor: '#ef4444',
      cursorWidth: 2,
      height: 64,
      normalize: false,
      interact: false,
    })
    const recordPlugin = recordWaveSurfer.registerPlugin(
      RecordPlugin.create({
        renderRecordedAudio: false,
        scrollingWaveform: true,
        scrollingWaveformWindow: 5,
        continuousWaveform: true,
        continuousWaveformDuration: 10,
      })
    )
    recordPlugin.on('record-start', () => setIsRecording(true))
    recordPlugin.on('record-end', (blob: Blob) => {
      setIsRecording(false)
      handleRecordedBlob(blob)
    })
    recordPlugin.on('record-pause', () => setIsRecording(false))
    recordPlugin.on('record-resume', () => setIsRecording(true))
    recordWaveSurferRef.current = recordWaveSurfer
    recordPluginRef.current = recordPlugin
    return recordWaveSurfer
  }

  const ensureTakeWaveSurfer = () => {
    if (takeWaveSurferRef.current || !takeWaveContainerRef.current) {
      return takeWaveSurferRef.current
    }
    const takeWaveSurfer = WaveSurfer.create({
      container: takeWaveContainerRef.current,
      waveColor: '#f87171',
      progressColor: '#f87171',
      cursorColor: '#f87171',
      cursorWidth: 2,
      height: 64,
      normalize: false,
      hideScrollbar: true,
      interact: false,
    })
    takeWaveSurferRef.current = takeWaveSurfer
    if (pendingTakeBlobRef.current) {
      takeWaveSurfer.loadBlob(pendingTakeBlobRef.current)
      pendingTakeBlobRef.current = null
    }
    return takeWaveSurfer
  }

  const stopTakePlayback = () => {
    const playback = takePlaybackRef.current
    if (playback.source) {
      try {
        playback.source.stop()
      } catch (e) {}
      try {
        playback.source.disconnect()
      } catch (e) {}
      playback.source = null
    }
  }

  const startTakePlayback = (trackTime: number) => {
    const meta = takeMetaRef.current
    const buffer = takeBufferRef.current
    if (!meta || !buffer) {
      return
    }
    const offset = meta.offsetSec
    if (trackTime < offset) {
      stopTakePlayback()
      return
    }
    const takeStart = trackTime - offset
    if (takeStart >= buffer.duration) {
      stopTakePlayback()
      return
    }
    const context = ensureAudioContext()
    stopTakePlayback()
    const source = context.createBufferSource()
    source.buffer = buffer
    source.playbackRate.value = playbackRateRef.current
    const gain = takeGainRef.current ?? context.createGain()
    if (!takeGainRef.current) {
      gain.gain.value = takeVolumeRef.current
      gain.connect(context.destination)
      takeGainRef.current = gain
    }
    source.connect(gain)
    const startAt = context.currentTime + 0.02
    const scheduledTakeStart =
      takeStart + (startAt - context.currentTime) * playbackRateRef.current
    if (scheduledTakeStart >= buffer.duration) {
      return
    }
    source.start(startAt, Math.max(0, scheduledTakeStart))
    takePlaybackRef.current = {
      source,
      startedAtContextTime: startAt,
      takeStartAt: Math.max(0, scheduledTakeStart),
      rate: playbackRateRef.current,
    }
  }

  const syncTakePlayback = (trackTime: number, force: boolean) => {
    const meta = takeMetaRef.current
    const buffer = takeBufferRef.current
    const ws = waveSurferRef.current
    if (!meta || !buffer || !ws) {
      stopTakePlayback()
      return
    }
    if (!ws.isPlaying()) {
      stopTakePlayback()
      return
    }
    const offset = meta.offsetSec
    if (trackTime < offset) {
      stopTakePlayback()
      return
    }
    const takeStart = trackTime - offset
    if (takeStart >= buffer.duration) {
      stopTakePlayback()
      return
    }
    const context = ensureAudioContext()
    const playback = takePlaybackRef.current
    if (!playback.source) {
      startTakePlayback(trackTime)
      return
    }
    const currentTakeTime =
      playback.takeStartAt + (context.currentTime - playback.startedAtContextTime) * playback.rate
    const drift = Math.abs(currentTakeTime - takeStart)
    if (force || drift > 0.05 || playback.rate !== playbackRateRef.current) {
      startTakePlayback(trackTime)
    }
  }

  const runDriftGuard = useCallback(
    (currentTime: number, source: 'audioprocess' | 'timeupdate') => {
      if (source === 'audioprocess') {
        driftGuardSourceRef.current = 'audioprocess'
      } else if (driftGuardSourceRef.current === 'audioprocess') {
        return
      }
      const ws = waveSurferRef.current
      const activeId = activeRegionIdRef.current
      if (!ws || !activeId || !loopRef.current || !ws.isPlaying()) {
        return
      }
      const region = regionMapRef.current.get(activeId)
      if (!region) {
        return
      }
      const bounds = setActiveBounds(
        { start: region.start, end: region.end },
        ws.getDuration()
      )
      if (currentTime <= bounds.extendedEnd + DRIFT_GUARD_THRESHOLD_SECONDS) {
        return
      }
      const nowMs = performance.now()
      if (nowMs - driftGuardCooldownRef.current < DRIFT_GUARD_COOLDOWN_MS) {
        return
      }
      driftGuardCooldownRef.current = nowMs
      if (DEBUG_LOOP_BG) {
        logLoopBg('driftGuardWrap', {
          currentTime,
          targetStart: bounds.extendedStart,
          extendedEnd: bounds.extendedEnd,
          source,
        })
      }
      cancelLoopFades()
      ws.setTime(bounds.extendedStart)
      syncTakePlayback(bounds.extendedStart, true)
      startFadeIn(bounds, bounds.extendedStart)
      clearLoopTimers()
      scheduleLoopTimers({ skipFadeIn: true })
    },
    [
      cancelLoopFades,
      clearLoopTimers,
      scheduleLoopTimers,
      setActiveBounds,
      startFadeIn,
      syncTakePlayback,
    ]
  )

  const loadTakeFromBlob = async (blob: Blob, meta: TakeMeta) => {
    pendingTakeBlobRef.current = blob
    if (recordPanelOpen) {
      const ws = ensureTakeWaveSurfer()
      ws?.loadBlob(blob)
      pendingTakeBlobRef.current = null
    }
    try {
      const context = ensureAudioContext()
      const buffer = await context.decodeAudioData(await blob.arrayBuffer())
      takeBufferRef.current = buffer
      takeLoadedRef.current = meta.id
    } catch (error) {
      toast('Failed to load recording')
    }
  }

  const handleRecordedBlob = async (blob: Blob) => {
    const offset = recordingOffsetRef.current
    const id = `take-${Date.now()}`
    if (takeMetaRef.current?.id) {
      await deleteAudioBlob(takeMetaRef.current.id)
    }
    await putAudioBlob(id, blob)
    await loadTakeFromBlob(blob, {
      id,
      offsetSec: offset,
      duration: 0,
      volume: takeVolumeRef.current,
    })
    const buffer = takeBufferRef.current
    setTakeMeta({
      id,
      offsetSec: offset,
      duration: buffer?.duration ?? 0,
      volume: takeVolumeRef.current,
    })
  }

  const toggleRecording = async () => {
    if (!recordPluginRef.current || !waveSurferRef.current) {
      return
    }
    if (recordPluginRef.current.isRecording()) {
      recordPluginRef.current.stopRecording()
      return
    }
    recordingOffsetRef.current = waveSurferRef.current.getCurrentTime()
    ensureAudioContext()
    try {
      await recordPluginRef.current.startRecording()
    } catch (error) {
      toast('Microphone access needed')
    }
  }

  const deleteTake = async () => {
    stopTakePlayback()
    takeBufferRef.current = null
    takeLoadedRef.current = null
    pendingTakeBlobRef.current = null
    if (takeMetaRef.current?.id) {
      await deleteAudioBlob(takeMetaRef.current.id)
    }
    takeWaveSurferRef.current?.empty()
    setTakeMeta(null)
  }

  const updateGreyOverlays = (region: { start: number; end: number } | null) => {
    const regionsPlugin = regionsRef.current
    const overlays = overlayRefs.current

    if (!region || !regionsPlugin || !waveSurferRef.current) {
      if (overlays.left) {
        try {
          overlays.left.remove()
        } catch (e) {}
        overlays.left = null
      }
      if (overlays.right) {
        try {
          overlays.right.remove()
        } catch (e) {}
        overlays.right = null
      }
      return
    }

    const dur = waveSurferRef.current.getDuration() || duration
    const leftEnd = Math.max(0, region.start)
    const rightStart = Math.min(dur, region.end)

    // A translucent white veil over the out-of-loop area: light enough to stay
    // see-through (matching the waveform's other states — the A3 complaint was the
    // old 0.76 reading as a solid block) yet still lightens the bars beneath, so
    // the already-played portion to the left of the loop keeps its faded look.
    const OVERLAY_COLOR = 'rgba(255, 255, 255, 0.45)'

    if (leftEnd - 0 > 0.01) {
      if (!overlays.left) {
        overlays.left = regionsPlugin.addRegion({
          start: 0,
          end: leftEnd,
          color: OVERLAY_COLOR,
          drag: false,
          resize: false,
        })
        overlays.left.element?.setAttribute('data-overlay', 'true')
        if (overlays.left.element) {
          overlays.left.element.style.zIndex = '1'
        }
      } else {
        overlays.left.setOptions({ start: 0, end: leftEnd, color: OVERLAY_COLOR })
      }
    } else if (overlays.left) {
      try {
        overlays.left.remove()
      } catch (e) {}
      overlays.left = null
    }

    if (dur - rightStart > 0.01) {
      if (!overlays.right) {
        overlays.right = regionsPlugin.addRegion({
          start: rightStart,
          end: dur,
          color: OVERLAY_COLOR,
          drag: false,
          resize: false,
        })
        overlays.right.element?.setAttribute('data-overlay', 'true')
        if (overlays.right.element) {
          overlays.right.element.style.zIndex = '1'
        }
      } else {
        overlays.right.setOptions({ start: rightStart, end: dur, color: OVERLAY_COLOR })
      }
    } else if (overlays.right) {
      try {
        overlays.right.remove()
      } catch (e) {}
      overlays.right = null
    }
  }

  const scheduleOverlayUpdate = (region: { start: number; end: number } | null) => {
    if (overlayFrameRef.current) {
      return
    }
    overlayFrameRef.current = requestAnimationFrame(() => {
      overlayFrameRef.current = null
      updateGreyOverlays(region)
    })
  }

  const applyRegionUpdate = (region: any) => {
    const ws = waveSurferRef.current
    if (!ws) {
      return
    }
    cancelLoopFades()
    if (region?.id && region.id === activeRegionIdRef.current) {
      setActiveBounds({ start: region.start, end: region.end }, ws.getDuration())
      fadeOutTriggeredRef.current = false
      fadeInEndAtRef.current = null
    }
    if (region.loopName) {
      setRegionLabel(region, region.loopName)
    }
    resizingRegionRef.current = true
    if (resizeClearRef.current) {
      window.clearTimeout(resizeClearRef.current)
    }
    resizeClearRef.current = window.setTimeout(() => {
      resizingRegionRef.current = false
      resizeClearRef.current = null
    }, 120)
    if (activeRegionIdRef.current === region.id) {
      const current = ws.getCurrentTime()
      if (current < region.start) {
        ws.setTime(region.start)
      } else if (current > region.end) {
        ws.setTime(region.end)
      }
    }
    setSavedLoops((loops) =>
      loops.map((loop) =>
        loop.id === region.id
          ? { ...loop, start: trackToSongTime(region.start), end: trackToSongTime(region.end) }
          : loop
      )
    )
    scheduleOverlayUpdate(region)
    if (activeRegionIdRef.current === region.id) {
      if (ws.isPlaying()) {
        scheduleLoopTimers()
      } else {
        clearLoopTimers()
      }
    }
  }

  const attachRegionHandlers = (region: any) => {
    regionMapRef.current.set(region.id, region)
    region.setOptions({ drag: false })
    if (region.loopColor) {
      setRegionHandleColor(region, region.loopColor)
    }
    setRegionHandleAccessibility(region)
    region.on('update-end', () => applyRegionUpdate(region))
    region.on('update', () => applyRegionUpdate(region))
  }

  const ensureRegionForSavedLoop = (loop: SavedLoop) => {
    if (!regionsRef.current) {
      return null
    }
    const existing = regionMapRef.current.get(loop.id)
    if (existing) {
      existing.setOptions({
        start: songToTrackTime(loop.start),
        end: songToTrackTime(loop.end),
        color: REGION_TRANSPARENT_COLOR,
        drag: false,
      })
      setRegionVisuals(existing, loop.color)
      setRegionLabel(existing, loop.name)
      return existing
    }
    const region = regionsRef.current.addRegion({
      id: loop.id,
      start: songToTrackTime(loop.start),
      end: songToTrackTime(loop.end),
      color: REGION_TRANSPARENT_COLOR,
      drag: false,
      resize: true,
    })
    setRegionVisuals(region, loop.color)
    setRegionLabel(region, loop.name)
    attachRegionHandlers(region)
    return region
  }

  const closeNameModal = () => {
    setNameModalOpen(false)
  }

  const beginSaveRegion = () => {
    if (!activeRegion || !activeRegionId || activeSavedLoop) {
      return
    }
    setPendingLoopName(`Loop ${savedLoops.length + 1}`)
    setNameModalOpen(true)
  }

  const confirmSaveRegion = () => {
    if (!activeRegion || !activeRegionId || activeSavedLoop) {
      closeNameModal()
      return
    }
    const name = pendingLoopName.trim() || `Loop ${savedLoops.length + 1}`
    const color = activeRegion.loopColor ?? getNextLoopColor()
    setRegionVisuals(activeRegion, color)
    setRegionLabel(activeRegion, name)
    const autoPos = resolveLoopSheetPosition(trackToSongTime(activeRegion.start))
    const draftPos = autoPos ?? pdfViewerRef?.current?.getSheetPosition()
    const nextLoop: SavedLoop = {
      id: activeRegionId,
      name,
      start: trackToSongTime(activeRegion.start),
      end: trackToSongTime(activeRegion.end),
      color,
      loopOn: loopRef.current,
      sheetLinkDraft: draftPos ?? undefined,
    }
    setSavedLoops((loops) => [...loops, nextLoop])
    closeNameModal()
  }

  const setScrollOnRepeatEnabled = useCallback(
    (nextValue: boolean, options?: { notifyOff?: boolean }) => {
      scrollOnRepeatRef.current = nextValue
      setScrollOnRepeat(nextValue)
      if (!nextValue && options?.notifyOff) {
        setScrollRepeatOffToastToken((token) => token + 1)
      }
      if (!nextValue) {
        setScrollRepeatPromptVisible(false)
        scrollRepeatPromptPendingHideRef.current = false
        scrollRepeatPromptHoverRef.current = false
      }
    },
    []
  )

  const toggleScrollOnRepeat = useCallback(() => {
    setScrollOnRepeat((current) => {
      const nextValue = !current
      scrollOnRepeatRef.current = nextValue
      return nextValue
    })
  }, [])

  const showScrollRepeatPrompt = useCallback(() => {
    setScrollRepeatPromptVisible(true)
    scrollRepeatPromptPendingHideRef.current = false
    if (scrollRepeatPromptTimeoutRef.current !== null) {
      window.clearTimeout(scrollRepeatPromptTimeoutRef.current)
    }
    scrollRepeatPromptTimeoutRef.current = window.setTimeout(() => {
      if (scrollRepeatPromptHoverRef.current) {
        scrollRepeatPromptPendingHideRef.current = true
        scrollRepeatPromptTimeoutRef.current = null
        return
      }
      setScrollRepeatPromptVisible(false)
      scrollRepeatPromptTimeoutRef.current = null
    }, SCROLL_REPEAT_PROMPT_MS)
  }, [])

  useEffect(() => {
    if (!onLoopMarkersChange) {
      return
    }
    onLoopMarkersChange(loopMarkers)
  }, [loopMarkers, onLoopMarkersChange])

  const saveLoopName = (id: string, name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    setSavedLoops((prev) => prev.map((l) => (l.id === id ? { ...l, name: trimmed } : l)))
    const region = regionMapRef.current.get(id)
    if (region) setRegionLabel(region, trimmed)
  }

  const deleteSavedLoop = (regionId: string) => {
    const snapshot = savedLoopsRef.current.find((l) => l.id === regionId)
    const wasActive = activeRegionIdRef.current === regionId
    setSavedLoops((loops) => loops.filter((loop) => loop.id !== regionId))
    if (wasActive) {
      exitLoop()
    } else {
      removeRegionById(regionId)
    }
    if (!snapshot) return
    const loopSnapshot = { ...snapshot }
    toast('Loop deleted', {
      duration: 5000,
      action: {
        label: 'Undo',
        onClick: () => {
          setSavedLoops((loops) => {
            const idx = loops.findIndex((l) => l.start > loopSnapshot.start)
            const copy = [...loops]
            if (idx === -1) copy.push(loopSnapshot)
            else copy.splice(idx, 0, loopSnapshot)
            return copy
          })
          ensureRegionForSavedLoop(loopSnapshot)
        },
      },
    })
  }

  const removeRegionById = (regionId: string | null) => {
    if (!regionId) {
      return
    }
    const region = regionMapRef.current.get(regionId)
    if (region) {
      try {
        region.remove()
      } catch (e) {}
      regionMapRef.current.delete(regionId)
    }
  }

  const activateRegion = (regionId: string, options?: { autoplay?: boolean }) => {
    const ws = waveSurferRef.current
    const region = regionMapRef.current.get(regionId)
    if (!ws || !region) {
      return
    }
    cancelLoopFades()
    pendingFadeInRef.current = null
    ws.toggleInteraction(true)

    const previousId = activeRegionIdRef.current
    if (previousId && previousId !== regionId) {
      removeRegionById(previousId)
    }

    if (!previousId) {
      globalLoopRef.current = loopRef.current
    }

    activeRegionIdRef.current = regionId
    setRegionActiveState(region, true)
    setActiveRegionId(regionId)
    const savedLoop = savedLoopsRef.current.find((loop) => loop.id === regionId)
    if (savedLoop) {
      setRegionLabel(region, savedLoop.name)
    }
    // C3: repeat-loop is a single global value, not per-loop.
    const nextLoopState = repeatLoopRef.current
    setLoopOn(nextLoopState)
    const bounds = setActiveBounds(
      { start: region.start, end: region.end },
      ws.getDuration()
    )

    if (options?.autoplay ?? true) {
      const wasPlaying = ws.isPlaying()
      const startTime = nextLoopState ? bounds.extendedStart : region.start
      ws.setTime(startTime)
      if (wasPlaying) {
        // Already playing: keep playing the newly-selected loop.
        startFadeIn(bounds, startTime)
        ensureAudioContext()
        ws.play()
        scheduleLoopTimers({ skipFadeIn: true })
        if (jumpOnEventRef.current) {
          scrollToLoopMarker(regionId)
          fireJumpOnboarding()
        }
      } else {
        // C1: paused + loop selected → don't start playback. Position the cursor at
        // the loop start, prime the fade-in for the next play, and scroll the PDF to
        // the loop's start so the user sees where the loop begins.
        pendingFadeInRef.current = bounds
        setGainImmediate(LOOP_MIN_VOLUME)
        if (jumpOnEventRef.current) {
          scrollToLoopMarker(regionId)
          fireJumpOnboarding()
        }
      }
    }
    updateGreyOverlays(region)
  }

  const exitLoop = () => {
    const activeId = activeRegionIdRef.current
    if (activeId) {
      removeRegionById(activeId)
    }
    activeRegionIdRef.current = null
    setActiveRegionId(null)
    // C3: back to no-loop context → the live flag reflects the song-repeat value.
    setLoopOn(repeatSongRef.current)
    cancelLoopFades()
    clearLoopTimers()
    pendingFadeInRef.current = null
    activeBoundsRef.current = null
    updateGreyOverlays(null)
  }

  const createRegion = () => {
    if (!waveSurferRef.current || !regionsRef.current || !isReady) {
      return
    }
    const ws = waveSurferRef.current
    if (ws.isPlaying()) {
      skipNextFadeInRef.current = true
    }
    const start = ws.getCurrentTime()
    const end = Math.min(start + NEW_LOOP_SECONDS, duration)
    const color = getNextLoopColor()
    const region = regionsRef.current.addRegion({
      start,
      end,
      color: REGION_TRANSPARENT_COLOR,
      drag: false,
      resize: true,
    })
    setRegionVisuals(region, color)
    attachRegionHandlers(region)
    activateRegion(region.id, { autoplay: false })

    // Auto-save immediately with a default name so the chip appears in the sidebar.
    // The user can rename inline in the sidebar chip.
    const name = `Loop ${savedLoopsRef.current.length + 1}`
    setRegionLabel(region, name)
    const autoPos = resolveLoopSheetPosition(trackToSongTime(start))
    const draftPos = autoPos ?? pdfViewerRef?.current?.getSheetPosition()
    const nextLoop: SavedLoop = {
      id: region.id,
      name,
      start: trackToSongTime(start),
      end: trackToSongTime(end),
      color,
      loopOn: true,
      sheetLinkDraft: draftPos ?? undefined,
    }
    setSavedLoops((loops) => [...loops, nextLoop])
  }

  const selectSavedLoop = (loop: SavedLoop) => {
    const region = ensureRegionForSavedLoop(loop)
    if (region) {
      activateRegion(loop.id, { autoplay: true })
    }
  }

  const scrollToLoopMarker = useCallback(
    (loopId: string) => {
      const loop = savedLoopsRef.current.find((entry) => entry.id === loopId)
      if (!loop) return
      // Recompute the position LIVE from the timing model (same as the marker overlay and
      // playback), falling back to any stored link only if the model isn't ready. Trusting
      // a stale stored sheetLink was sending clicks to a wildly wrong spot that play fixed.
      const pos = resolveLoopSheetPosition(loop.start) ?? loop.sheetLink ?? loop.sheetLinkDraft
      if (!pos) {
        return
      }
      const viewer = pdfViewerRef?.current ?? null
      if (!viewer) {
        return
      }
      viewer.scrollToSheetPosition(pos, { behavior: 'smooth' })
    },
    [pdfViewerRef, resolveLoopSheetPosition]
  )

  const activateLoopFromMarker = useCallback(
    (loopId: string) => {
      // Re-clicking the active loop's marker/bar deselects it — same toggle the
      // dock lane chips use, so the page-margin bars and rail behave identically.
      if (activeRegionIdRef.current === loopId) {
        exitLoop()
        return
      }
      const loop = savedLoopsRef.current.find((entry) => entry.id === loopId)
      if (!loop) {
        return
      }
      selectSavedLoop(loop)
    },
    [exitLoop, selectSavedLoop]
  )

  useEffect(() => {
    if (!markerActivateRef) {
      return
    }
    markerActivateRef.current = activateLoopFromMarker
    return () => {
      if (markerActivateRef.current === activateLoopFromMarker) {
        markerActivateRef.current = null
      }
    }
  }, [activateLoopFromMarker, markerActivateRef])

  // Lift savedLoops and activeRegionId up to App
  useEffect(() => {
    onSavedLoopsChange?.(savedLoops)
  }, [savedLoops, onSavedLoopsChange])

  useEffect(() => {
    onActiveLoopIdChange?.(activeRegionId)
  }, [activeRegionId, onActiveLoopIdChange])

  useEffect(() => {
    onSelectedLoopIdChange?.(selectedLoopId)
  }, [selectedLoopId, onSelectedLoopIdChange])

  // Selecting a loop (showing its card) and activating it on the seekbar are
  // the same action — the card always follows the active loop.
  useEffect(() => {
    setSelectedLoopId(activeRegionId)
  }, [activeRegionId])

  useEffect(() => {
    store.save('practice:lanesVisible', lanesVisible)
  }, [lanesVisible])

  // Populate callback refs so SongView can invoke PlayerDock internals
  useEffect(() => {
    if (createLoopRef) createLoopRef.current = createRegion
    if (deleteLoopRef) deleteLoopRef.current = deleteSavedLoop
    if (selectLoopRef) selectLoopRef.current = (id: string) => {
      const loop = savedLoopsRef.current.find((l) => l.id === id)
      if (loop) selectSavedLoop(loop)
    }
    if (exitLoopRef) exitLoopRef.current = () => exitLoop()
  })

  const seekBy = (delta: number) => {
    if (!waveSurferRef.current || !isReady) {
      return
    }
    cancelLoopFades()
    const ws = waveSurferRef.current
    const wasPlaying = ws.isPlaying()
    const current = ws.getCurrentTime()
    const bounds = activeRegion
      ? { min: activeRegion.start, max: activeRegion.end }
      : { min: 0, max: duration }
    const next = Math.min(bounds.max, Math.max(bounds.min, current + delta))
    ws.setTime(next)
    syncTakePlayback(next, true)
    if (wasPlaying && (!activeRegion || loopOn || next < bounds.max - 0.001)) {
      ws.play()
    }
    scheduleLoopTimers()
    // Seek buttons use programmatic setTime (no `interaction` event), so jump the
    // score here. trackToSongTime maps the track-time cursor back to song time.
    scrollScoreToSongTime(trackToSongTime(next))
  }

  const togglePlay = () => {
    if (!waveSurferRef.current || !isReady) {
      return
    }
    ensureAudioContext()
    waveSurferRef.current.playPause()
  }

  // C3: one button toggles whichever global value applies to the current context —
  // repeat-loop when a loop is active, repeat-song otherwise. `loopOn` (the live flag
  // the playback engine reads) mirrors it.
  const toggleRepeat = () => {
    cancelLoopFades()
    clearLoopTimers()
    const next = !loopOn
    setLoopOn(next)
    if (activeRegionIdRef.current) {
      repeatLoopRef.current = next
      setRepeatLoop(next)
    } else {
      repeatSongRef.current = next
      setRepeatSong(next)
      globalLoopRef.current = next
    }
  }

  const toggleJumpOnEvent = () => {
    const next = !jumpOnEventRef.current
    jumpOnEventRef.current = next
    setJumpOnEvent(next)
  }

  const handleTransportPointerEnter: PointerEventHandler<HTMLDivElement> = (event) => {
    if (event.pointerType === 'touch') {
      return
    }
    setIsInTransport(true)
    revealWithReason('controls')
  }

  const handleTransportPointerLeave: PointerEventHandler<HTMLDivElement> = (event) => {
    if (event.pointerType === 'touch') {
      return
    }
    setIsInTransport(false)
  }

  const handleTransportPointerDown: PointerEventHandler<HTMLDivElement> = () => {
    setIsInTransport(true)
    revealWithReason('controls')
  }

  const handleTransportPointerUp: PointerEventHandler<HTMLDivElement> = (event) => {
    if (event.pointerType === 'touch') {
      setIsInTransport(false)
    }
  }

  const handleTransportPointerCancel: PointerEventHandler<HTMLDivElement> = (event) => {
    if (event.pointerType === 'touch') {
      setIsInTransport(false)
    }
  }

  const handleWaveformPointerEnter: PointerEventHandler<HTMLDivElement> = (event) => {
    if (event.pointerType === 'touch') {
      return
    }
    setIsInTransport(true)
    revealWithReason('seekbar-hover')
  }

  const handleWaveformPointerLeave: PointerEventHandler<HTMLDivElement> = (event) => {
    if (event.pointerType === 'touch') {
      return
    }
    setIsInTransport(false)
  }

  const waveformShellClassName = audioReady
    ? 'relative rounded-2xl border border-white/70 bg-white/60 px-3 py-2 shadow-lg shadow-black/10 backdrop-blur-md dark:border-slate-700/60 dark:bg-slate-900/60 dark:shadow-black/40'
    : 'relative rounded-2xl border border-white/70 bg-white/60 px-3 py-2 shadow-lg shadow-black/10 backdrop-blur-md opacity-0 pointer-events-none dark:border-slate-700/60 dark:bg-slate-900/60 dark:shadow-black/40'
  // The outer wrapper spans full width but is click-through, so its empty side
  // areas don't sit "in front of" the edge rail and steal its drags. Only the
  // centered content opts back into pointer events.
  const dockClassName =
    'pointer-events-none fixed inset-x-0 bottom-0 z-50 mb-[10px] bg-transparent'

  return (
    <div className={dockClassName}>
      <div className="pointer-events-auto relative mx-auto w-full max-w-5xl px-4 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-4">
        <div className={waveformShellClassName} aria-hidden={!audioReady}>
          {/* One bar: the control cluster sits left, the waveform fills the rest of
              the row, and the loop lane nests under the waveform column so its chips
              stay aligned with the waveform regions above them. */}
          <div className="flex items-start gap-3">
            {audioReady && (
              <div className="flex min-h-[40px] items-center">
                <TransportBar
                  mode={transportMode}
                  containerRef={transportRef}
                  onPointerEnter={handleTransportPointerEnter}
                  onPointerLeave={handleTransportPointerLeave}
                  onPointerDown={handleTransportPointerDown}
                  onPointerUp={handleTransportPointerUp}
                  onPointerCancel={handleTransportPointerCancel}
                  onSeekExtensionChange={handleSeekExtensionChange}
                  isPlaying={isPlaying}
                  playbackRate={playbackRate}
                  balance={balance}
                  mono={mono}
                  isStereoSource={sourceChannelCount === null || sourceChannelCount > 1}
                  transpose={transpose}
                  seekBy={seekBy}
                  togglePlay={togglePlay}
                  setPlaybackRate={setPlaybackRate}
                  setBalance={setBalance}
                  setMono={setMono}
                  setTranspose={setTranspose}
                  repeatActive={loopOn}
                  onToggleRepeat={toggleRepeat}
                  jumpOnEvent={jumpOnEvent}
                  jumpOnEventAvailable={anchors.length > 0}
                  onToggleJumpOnEvent={toggleJumpOnEvent}
                  tracks={tracks}
                  activeTrackId={activeTrackId}
                  onSelectTrack={onSelectTrack}
                  onManageTracks={onManageTracks}
                />
              </div>
            )}

            {/* Waveform + loop lane share one inner column so the lane chips stay
                aligned with the waveform regions; Add loop sits to the right of
                the waveform, vertically centered on it. */}
            <div className="flex min-w-0 flex-1 items-start gap-2">
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex min-h-[40px] items-center">
                  <div
                    ref={containerRef}
                    id="waveform"
                    className="w-full transition-[height] duration-200 ease-out motion-reduce:transition-none"
                    style={{ height: waveformHeight }}
                    data-mode={transportMode}
                    data-loop-on={loopOn}
                    data-loop-active={activeRegionId ? 'true' : 'false'}
                    data-ready={isReady ? 'true' : 'false'}
                    onPointerEnter={handleWaveformPointerEnter}
                    onPointerLeave={handleWaveformPointerLeave}
                  />
                </div>

                {audioReady && savedLoops.length > 0 && (
                  <div className="relative">
                  <LoopLaneStrip
                    loops={savedLoops}
                    duration={duration}
                    activeLoopId={activeRegionId}
                    lanesVisible={lanesVisible}
                    chipInset={0}
                    onSelect={(id) => {
                      if (activeRegionIdRef.current === id) {
                        exitLoop()
                      } else {
                        const loop = savedLoopsRef.current.find((l) => l.id === id)
                        if (loop) selectSavedLoop(loop)
                      }
                    }}
                    onRename={saveLoopName}
                    onDelete={deleteSavedLoop}
                    onExpand={() => setLanesVisible(true)}
                    onCollapse={() => setLanesVisible(false)}
                  />

                  {/* Expand/collapse — sits at the right end of the lane, even with
                      the collapsed peek. */}
                  <button
                    type="button"
                    onClick={() => setLanesVisible((v) => !v)}
                    className="absolute right-0 top-0 z-10 flex h-5 w-5 items-center justify-center rounded-full text-slate-400 transition hover:bg-black/5 hover:text-slate-600"
                    aria-label={lanesVisible ? 'Hide loop lanes' : 'Show loop lanes'}
                    title={lanesVisible ? 'Hide loops' : 'Show loops'}
                  >
                    {lanesVisible ? (
                      <ChevronUp size={12} strokeWidth={2.5} />
                    ) : (
                      <ChevronDown size={12} strokeWidth={2.5} />
                    )}
                  </button>
                </div>
              )}
              </div>

              {audioReady && (
                <div className="flex min-h-[40px] shrink-0 items-center">
                  <button
                    type="button"
                    onClick={activeRegionId ? exitLoop : () => createLoopRef?.current?.()}
                    aria-label={activeRegionId ? 'Exit loop' : 'Add loop'}
                    title={activeRegionId ? 'Exit loop' : 'Add loop'}
                    className={`flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-[#4F7F7A]/55 bg-black/5 px-3 text-[#0b1220] shadow-sm shadow-black/10 backdrop-blur-sm transition hover:bg-black/10 active:bg-black/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4F7F7A]/40 focus-visible:ring-offset-2 focus-visible:ring-offset-white/80 ${
                      activeRegionId
                        ? '!border-[#4F7F7A] !bg-[#4F7F7A]/25 hover:!bg-[#4F7F7A]/30 active:!bg-[#4F7F7A]/35'
                        : ''
                    }`}
                  >
                    <Plus
                      size={14}
                      strokeWidth={2.5}
                      className={`shrink-0 transition-transform duration-200 ${activeRegionId ? 'rotate-45' : 'rotate-0'}`}
                    />
                    <span className="text-[12px] font-medium leading-none">
                      {activeRegionId ? 'Exit loop' : 'Add loop'}
                    </span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {audioReady && countdownOverlayPresence.isMounted && (
          <div
            className={`pointer-events-none absolute z-40 ${countdownPositionClass}`}
          >
            <div
              className={`flex min-h-9 items-center gap-2 ${
                countdownOverlayPresence.phase === 'enter'
                  ? 'animate-[seek-toast-in_220ms_ease-out_forwards]'
                  : 'animate-[seek-toast-out_220ms_ease-out_forwards]'
              }`}
            >
              {prefersReducedMotion ? (
                <div className="rounded-full border border-white/70 bg-white/70 px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm shadow-black/10 backdrop-blur-md">
                  {countdownSeconds}
                </div>
              ) : (
                <div className="flex h-9 w-9 items-center justify-center rounded-full border border-white/70 bg-white/70 shadow-sm shadow-black/10 backdrop-blur-md">
                  <svg className="h-6 w-6 text-[#4F7F7A]" viewBox="0 0 36 36">
                    <circle
                      cx="18"
                      cy="18"
                      r={countdownRadius}
                      fill="none"
                      stroke="rgba(15, 23, 42, 0.2)"
                      strokeWidth="3"
                    />
                    <circle
                      cx="18"
                      cy="18"
                      r={countdownRadius}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeDasharray={countdownCircumference}
                      strokeDashoffset={countdownDashOffset}
                      transform="rotate(-90 18 18)"
                    />
                  </svg>
                </div>
              )}
              {showStayHere && (
                <button
                  className={overlayActionButtonClassName}
                  type="button"
                  onClick={() => setScrollOnRepeatEnabled(false, { notifyOff: true })}
                >
                  Stay here
                </button>
              )}
            </div>
          </div>
        )}

        {audioReady && scrollRepeatOverlayPresence.isMounted && (
          <div
            className={`pointer-events-none absolute z-40 ${countdownPositionClass}`}
          >
            <div
              className={`flex min-h-9 items-center gap-2 ${
                scrollRepeatOverlayPresence.phase === 'enter'
                  ? 'animate-[seek-toast-in_220ms_ease-out_forwards]'
                  : 'animate-[seek-toast-out_220ms_ease-out_forwards]'
              }`}
            >
              <button
                className={overlayActionButtonClassName}
                type="button"
                onClick={() => setScrollOnRepeatEnabled(false, { notifyOff: true })}
                onMouseEnter={() => {
                  scrollRepeatPromptHoverRef.current = true
                }}
                onMouseLeave={() => {
                  scrollRepeatPromptHoverRef.current = false
                  if (scrollRepeatPromptPendingHideRef.current) {
                    scrollRepeatPromptPendingHideRef.current = false
                    setScrollRepeatPromptVisible(false)
                  }
                }}
              >
                Turn off scroll on repeat
              </button>
            </div>
          </div>
        )}

        {audioReady && recordPanelOpen && (
          <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Workshop</p>
                <h3 className="text-lg font-semibold text-slate-900">Recording</h3>
              </div>
              <button
                className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                  isRecording ? 'bg-red-500 text-white' : 'bg-slate-100 text-slate-700'
                }`}
                type="button"
                onClick={toggleRecording}
              >
                {isRecording ? 'Stop' : 'Record'}
              </button>
            </div>

            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div ref={recordContainerRef} className="w-full" />
            </div>

            {takeMeta && (
              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div ref={takeWaveContainerRef} className="w-full" />
              </div>
            )}

            {takeMeta && (
              <div className="mt-4 flex flex-wrap items-center gap-4">
                <label className="text-sm text-slate-600">
                  Take volume
                  <input
                    className="mt-2 h-2 w-40 cursor-pointer appearance-none rounded-full bg-slate-200 accent-[#4F7F7A]"
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={takeVolume}
                    onChange={(event) => setTakeVolume(Number(event.target.value))}
                  />
                </label>
                <button
                  className="rounded-full border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-100"
                  type="button"
                  onClick={deleteTake}
                >
                  Delete take
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {audioReady && nameModalOpen && (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-slate-950/40 px-4">
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
            <h3 className="text-lg font-semibold text-slate-900">Name this loop</h3>
            <p className="mt-1 text-sm text-slate-500">Give this region a memorable name.</p>
            <input
              className="mt-4 w-full rounded-xl border border-slate-200 px-3 py-2 text-slate-900 shadow-sm focus:border-[#4F7F7A] focus:outline-none"
              value={pendingLoopName}
              onChange={(event) => setPendingLoopName(event.target.value)}
              placeholder="Loop name"
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  confirmSaveRegion()
                }
                if (event.key === 'Escape') {
                  closeNameModal()
                }
              }}
            />
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                className="rounded-full border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-100"
                type="button"
                onClick={closeNameModal}
              >
                Cancel
              </button>
              <button
                className="rounded-full bg-[#4F7F7A] px-4 py-2 text-sm text-[#0b1220] shadow-sm"
                type="button"
                onClick={confirmSaveRegion}
              >
                Save loop
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
