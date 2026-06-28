import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Pencil } from 'lucide-react'
import { getDocument } from 'pdfjs-dist'
import PDFViewer from './PDFViewer'
import type { PDFViewerHandle, SheetMarker } from './PDFViewer'
import PlayerDock from './PlayerDock'
import ContextBar from './ContextBar'
import TrackManager from './TrackManager'
import AnnotationToolbar from './AnnotationToolbar'
import { AnnotationProvider, useAnnotations } from '../contexts/AnnotationContext'
import type { Anchor } from '../lib/syncMap'
import type { BeatAnalysis } from '../lib/transcribe'
import { generateSyncMap } from '../lib/generateSyncMap'
import { formatSyncDebug, type SyncDebugBundle } from '../lib/syncDebug'
import { localStorageStore, type PracticeStore } from '../lib/storage'
import { useAnalysis } from '../lib/analysisManager'
import {
  getSong,
  getTrack,
  getBlob,
  listTracks,
  updateSong,
  updateTrack,
  saveLastSongId,
  type Song,
  type Track,
  type SongSettings,
  type TakeMeta,
} from '../lib/library'

type SongViewProps = {
  songId: string
  onBack: () => void
}

/** Debounce a void thunk; trailing-edge, shared timer. */
function useDebounced(fn: () => void, ms: number) {
  const fnRef = useRef(fn)
  fnRef.current = fn
  const timer = useRef<number | null>(null)
  return useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => fnRef.current(), ms)
  }, [ms])
}

export default function SongView({ songId, onBack }: SongViewProps) {
  const { subscribeSong } = useAnalysis()
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const pdfViewerRef = useRef<PDFViewerHandle | null>(null)
  const markerActivateRef = useRef<((loopId: string) => void) | null>(null)
  const createLoopRef = useRef<(() => void) | null>(null)
  const deleteLoopRef = useRef<((id: string) => void) | null>(null)
  const selectLoopRef = useRef<((id: string) => void) | null>(null)
  const exitLoopRef = useRef<(() => void) | null>(null)
  const onSystemBandsReadyRef = useRef<(() => void) | null>(null)

  // Authoritative song/track snapshots, mutated synchronously by the per-song
  // store and flushed to IndexedDB on a debounce (one whole-record write avoids
  // read-modify-write races between loop and settings saves).
  const songRef = useRef<Song | null>(null)
  const trackRef = useRef<Track | null>(null)

  const [song, setSong] = useState<Song | null>(null)
  const [tracks, setTracks] = useState<Track[]>([])
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null)
  const [track, setTrack] = useState<Track | null>(null)
  const [pdfUrl, setPdfUrl] = useState<string | undefined>(undefined)
  const [audioUrl, setAudioUrl] = useState<string | undefined>(undefined)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [loopMarkers, setLoopMarkers] = useState<SheetMarker[]>([])
  const [zoomOutDisabled, setZoomOutDisabled] = useState(true)
  const [zoomInDisabled, setZoomInDisabled] = useState(false)
  const [anchors, setAnchors] = useState<Anchor[]>([])
  const [beat, setBeat] = useState<BeatAnalysis | undefined>(undefined)
  const [syncGenerating, setSyncGenerating] = useState(false)
  const [overlayEnabled, setOverlayEnabled] = useState(true)
  const [manageOpen, setManageOpen] = useState(false)
  const lastDebugBundleRef = useRef<SyncDebugBundle | null>(null)

  // Re-read song + tracks after the track manager adds / renames / removes a track.
  // If the active track was deleted, fall back to the song's selection or the first.
  const refreshTracks = useCallback(async () => {
    const [s, trackList] = await Promise.all([getSong(songId), listTracks(songId)])
    setTracks(trackList)
    if (s) {
      songRef.current = s
      setSong(s)
      setSelectedTrackId((cur) =>
        cur && trackList.some((t) => t.id === cur)
          ? cur
          : s.selectedTrackId ?? trackList[0]?.id ?? null
      )
    }
  }, [songId])

  // B5: reserve bottom scroll space so the last page can't scroll up past the top
  // of the play-control pill (which floats over the PDF). Padding grows the scroll
  // height, so the natural max-scroll — and the auto-scroll follow loop, which
  // clamps to `scrollHeight - viewport` — both stop with the page bottom at the
  // pill top. Re-measured whenever the dock resizes (loops expand) or the window does.
  useEffect(() => {
    const scroll = scrollContainerRef.current
    if (!scroll) return
    let raf = 0
    const apply = () => {
      const pill = document.querySelector<HTMLElement>('[data-dock-shell="true"]')
      if (!pill) {
        scroll.style.paddingBottom = ''
        return
      }
      const top = pill.getBoundingClientRect().top
      const pad = Math.max(0, Math.round(window.innerHeight - top))
      scroll.style.paddingBottom = `${pad}px`
    }
    const schedule = () => {
      window.cancelAnimationFrame(raf)
      raf = window.requestAnimationFrame(apply)
    }
    const observeDock = (ro: ResizeObserver) => {
      const dock = document
        .querySelector<HTMLElement>('[data-dock-shell="true"]')
        ?.closest('.fixed')
      if (dock) ro.observe(dock)
    }
    schedule()
    window.addEventListener('resize', schedule)
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null
    if (ro) observeDock(ro)
    // The dock mounts a tick after audio readiness; retry briefly until it appears.
    const retry = window.setInterval(() => {
      if (document.querySelector('[data-dock-shell="true"]')) {
        schedule()
        if (ro) observeDock(ro)
        window.clearInterval(retry)
      }
    }, 200)
    const stopRetry = window.setTimeout(() => window.clearInterval(retry), 4000)
    return () => {
      window.cancelAnimationFrame(raf)
      window.removeEventListener('resize', schedule)
      window.clearInterval(retry)
      window.clearTimeout(stopRetry)
      ro?.disconnect()
      scroll.style.paddingBottom = ''
    }
  }, [audioUrl, track])

  // --- Load song + PDF blob; populate track list and the active selection ---
  useEffect(() => {
    let cancelled = false
    let pdfObjUrl: string | undefined
    setLoadError(null)
    ;(async () => {
      try {
        const s = await getSong(songId)
        if (!s) throw new Error('Song not found')
        const trackList = await listTracks(songId)
        const pdfBlob = s.pdfBlobKey ? await getBlob(s.pdfBlobKey) : null
        if (cancelled) return

        pdfObjUrl = pdfBlob ? URL.createObjectURL(pdfBlob) : undefined
        songRef.current = s
        setSong(s)
        setTracks(trackList)
        setSelectedTrackId(s.selectedTrackId ?? s.trackIds[0] ?? null)
        setPdfUrl(pdfObjUrl)
        setAnchors(s.anchors ?? [])
        saveLastSongId(s.id)
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
      if (pdfObjUrl) URL.revokeObjectURL(pdfObjUrl)
    }
  }, [songId])

  // --- Load the active track + its audio blob; reloads on track switch ---
  useEffect(() => {
    if (!selectedTrackId) {
      setTrack(null)
      trackRef.current = null
      setAudioUrl(undefined)
      return
    }
    let cancelled = false
    let audioObjUrl: string | undefined
    ;(async () => {
      const t = await getTrack(selectedTrackId)
      const audioBlob = t ? await getBlob(t.audioBlobKey) : null
      // Beat is identical across tracks (same performance); non-reference tracks
      // aren't transcribed, so fall back to the reference track's beat.
      let trackBeat = t?.beat
      if (!trackBeat) {
        const refId = songRef.current?.referenceTrackId
        if (refId && refId !== selectedTrackId) trackBeat = (await getTrack(refId))?.beat
      }
      if (cancelled) return
      audioObjUrl = audioBlob ? URL.createObjectURL(audioBlob) : undefined
      trackRef.current = t
      setTrack(t)
      setAudioUrl(audioObjUrl)
      setBeat(trackBeat)
    })()
    return () => {
      cancelled = true
      if (audioObjUrl) URL.revokeObjectURL(audioObjUrl)
    }
  }, [selectedTrackId])

  const handleSelectTrack = useCallback(
    (id: string) => {
      if (id === selectedTrackId) return
      setSelectedTrackId(id)
      if (songRef.current) songRef.current.selectedTrackId = id
      void updateSong(songId, { selectedTrackId: id }).catch(() => {})
    },
    [selectedTrackId, songId]
  )

  // --- Per-song persistence: map PlayerDock's practice:* keys onto the records ---
  const flushSong = useDebounced(() => {
    const s = songRef.current
    if (!s) return
    void updateSong(s.id, {
      loops: s.loops,
      anchors: s.anchors,
      settings: s.settings,
      selectedTrackId: s.selectedTrackId,
    }).catch(() => {})
  }, 400)

  const store = useMemo<PracticeStore>(() => {
    const patchSettings = (patch: Partial<SongSettings>) => {
      const s = songRef.current
      if (!s) return
      s.settings = { ...s.settings, ...patch }
      flushSong()
    }
    return {
      load: <T,>(key: string): T | null => {
        const s = songRef.current
        switch (key) {
          case 'practice:loops':
            return (s?.loops ?? []) as unknown as T
          case 'practice:scroll-on-repeat':
            return (s?.settings.scrollOnRepeat ?? null) as unknown as T
          case 'practice:balance':
            return (s?.settings.balance ?? null) as unknown as T
          case 'practice:mono':
            return (s?.settings.mono ?? null) as unknown as T
          case 'practice:transpose':
            return (s?.settings.transpose ?? null) as unknown as T
          case 'practice:speed':
            return (s?.settings.speed ?? null) as unknown as T
          case 'practice:lanesVisible':
            return (s?.settings.lanesVisible ?? null) as unknown as T
          case 'practice:take':
            return (trackRef.current?.takeMeta ?? null) as unknown as T
          default:
            // Cosmetic per-song flags (e.g. sheet-link nudge) → namespaced localStorage.
            return localStorageStore.load<T>(`song:${songId}:${key}`)
        }
      },
      save: <T,>(key: string, value: T | null) => {
        switch (key) {
          case 'practice:loops':
            if (songRef.current) songRef.current.loops = (value as unknown as SavedLoop[]) ?? []
            flushSong()
            break
          case 'practice:scroll-on-repeat':
            patchSettings({ scrollOnRepeat: Boolean(value) })
            break
          case 'practice:balance':
            patchSettings({ balance: (value as unknown as number) ?? 0 })
            break
          case 'practice:mono':
            patchSettings({ mono: Boolean(value) })
            break
          case 'practice:transpose':
            patchSettings({ transpose: (value as unknown as number) ?? 0 })
            break
          case 'practice:speed':
            patchSettings({ speed: (value as unknown as number) ?? 1 })
            break
          case 'practice:lanesVisible':
            patchSettings({ lanesVisible: value !== false })
            break
          case 'practice:take': {
            const t = trackRef.current
            if (t) {
              const meta = (value as unknown as TakeMeta | null) ?? undefined
              t.takeMeta = meta
              void updateTrack(t.id, { takeMeta: meta }).catch(() => {})
            }
            break
          }
          default:
            localStorageStore.save<T>(`song:${songId}:${key}`, value)
        }
      },
    }
  }, [songId, flushSong])

  // Pick up background-analysis results (anchors / pdf meta / beat) for an already-
  // open song without remounting. Patch only those fields so we never clobber the
  // user's pending loop/settings edits held in songRef.
  useEffect(() => {
    const unsub = subscribeSong(songId, () => {
      void (async () => {
        const s = await getSong(songId)
        if (!s) return
        if (songRef.current) {
          songRef.current.anchors = s.anchors
          songRef.current.pdf = s.pdf
        }
        setAnchors(s.anchors ?? [])
        const tid = s.selectedTrackId ?? s.trackIds[0]
        if (tid) {
          const t = await getTrack(tid)
          if (t) {
            trackRef.current = t
            setBeat(t.beat)
          }
        }
      })()
    })
    return unsub
  }, [songId, subscribeSong])

  // Persist anchors (song-time) whenever they change (e.g. after Sync Score).
  useEffect(() => {
    const s = songRef.current
    if (!s) return
    s.anchors = anchors.length ? anchors : undefined
    flushSong()
  }, [anchors, flushSong])

  const handleGenerateSync = useCallback(async () => {
    if (!pdfUrl || !audioUrl) {
      toast.error('Score Sync needs both a PDF and an audio track.')
      return
    }
    setSyncGenerating(true)
    try {
      const pdf = await getDocument(pdfUrl).promise
      const audio = await fetch(audioUrl).then((r) => r.blob())
      const result = await generateSyncMap(pdf, audio, {
        debug: true,
        onProgress: (msg) => toast.info(msg, { duration: 2000 }),
      })
      if ('reason' in result && result.reason === 'scanned') {
        toast.error('Score Sync: PDF is a scanned image — auto-sync unavailable. Manual linking only.')
      } else if ('reason' in result && result.reason === 'no-lyrics') {
        toast.error('Score Sync: PDF has no text layer (instrumental?). Manual linking only.')
      } else if (!result.anchors?.length) {
        toast.error('Score Sync: No anchors generated. Check sidecar logs.')
      } else {
        setAnchors(result.anchors)
        setBeat(result.beat)
        if (result.trace) {
          lastDebugBundleRef.current = {
            source: { pdf: song?.title ?? pdfUrl, audio: track?.name ?? audioUrl },
            sourceHash: result.sourceHash,
            generatedAt: new Date().toISOString(),
            trace: result.trace,
          }
        }
        toast.success(`Score Sync ready — ${result.anchors.length} anchors`)
      }
    } catch (err) {
      toast.error(`Score Sync failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSyncGenerating(false)
    }
  }, [pdfUrl, audioUrl, song, track])

  const handleExportSync = useCallback(() => {
    const bundle = lastDebugBundleRef.current
    if (!bundle) {
      toast.error('No alignment trace — run "Sync Score" first.')
      return
    }
    const text = formatSyncDebug(bundle)
    const blob = new Blob([text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `sync-debug-${bundle.sourceHash.slice(0, 8)}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }, [])

  const handleLoopMarkersChange = useCallback((markers: SheetMarker[]) => {
    setLoopMarkers(markers)
  }, [])
  const handleMarkerClick = useCallback((loopId: string) => {
    markerActivateRef.current?.(loopId)
  }, [])
  const handleZoomStateChange = useCallback((out: boolean, inn: boolean) => {
    setZoomOutDisabled(out)
    setZoomInDisabled(inn)
  }, [])

  useEffect(() => {
    document.title = song ? `${song.title} – Shed Session` : 'Shed Session'
  }, [song])

  if (loadError) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-[#f8fafc] text-slate-600">
        <p>Couldn’t open this song: {loadError}</p>
        <button onClick={onBack} className="rounded-full bg-slate-200 px-4 py-1.5 text-sm font-medium hover:bg-slate-300">
          Back to library
        </button>
      </div>
    )
  }

  if (!song) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#f8fafc] text-slate-400">Loading…</div>
    )
  }

  return (
    <AnnotationProvider songId={songId}>
      <div className="relative flex h-screen flex-col overflow-hidden bg-[#f8fafc] text-slate-900">
        <AnnotationToolbar />
        <WriteModeToggle />
        <main className="flex min-h-0 flex-1 overflow-hidden">
          <div className="relative flex-1 min-w-0">
            {pdfUrl ? (
              <PDFViewer
                ref={pdfViewerRef}
                pdfUrl={pdfUrl}
                scrollContainerRef={scrollContainerRef}
                sheetMarkers={loopMarkers}
                onMarkerClick={handleMarkerClick}
                onZoomStateChange={handleZoomStateChange}
                onSystemBandsReady={() => onSystemBandsReadyRef.current?.()}
                syncAnchors={import.meta.env.DEV && overlayEnabled ? anchors : undefined}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-slate-400">
                No score for this song yet.
              </div>
            )}
            <ContextBar
              pdfViewerRef={pdfViewerRef}
              title={song.title}
              onBack={onBack}
              zoomOutDisabled={zoomOutDisabled}
              zoomInDisabled={zoomInDisabled}
            />
            {import.meta.env.DEV && (
              <div className="absolute bottom-2 left-2 z-[60] flex items-center gap-1.5 rounded bg-white/80 border border-slate-300 px-1.5 py-1 shadow-sm backdrop-blur-sm">
                <button
                  onClick={handleGenerateSync}
                  disabled={syncGenerating}
                  className="rounded px-1.5 py-0.5 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                >
                  {syncGenerating ? 'Syncing…' : anchors.length ? `Sync ✓ ${anchors.length}` : 'Sync Score'}
                </button>
                <button
                  onClick={handleExportSync}
                  className="rounded px-1.5 py-0.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
                  title="Download the alignment trace as text"
                >
                  Export
                </button>
                <label className="flex items-center gap-1 text-xs text-slate-600 select-none">
                  <input type="checkbox" checked={overlayEnabled} onChange={(e) => setOverlayEnabled(e.target.checked)} />
                  overlay
                </label>
              </div>
            )}
          </div>
        </main>
        {audioUrl && track && (
          <PlayerDock
            key={`${song.id}:${track.id}`}
            audioUrl={audioUrl}
            store={store}
            leadInOffset={track.leadInOffset}
            tracks={tracks}
            activeTrackId={selectedTrackId ?? undefined}
            onSelectTrack={handleSelectTrack}
            onManageTracks={() => setManageOpen(true)}
            scrollContainerRef={scrollContainerRef}
            pdfViewerRef={pdfViewerRef}
            anchors={anchors}
            beat={beat}
            onAnchorsChange={setAnchors}
            onLoopMarkersChange={handleLoopMarkersChange}
            markerActivateRef={markerActivateRef}
            createLoopRef={createLoopRef}
            deleteLoopRef={deleteLoopRef}
            selectLoopRef={selectLoopRef}
            exitLoopRef={exitLoopRef}
            onSystemBandsReadyRef={onSystemBandsReadyRef}
          />
        )}
        {manageOpen && (
          <TrackManager
            songId={songId}
            songTitle={song.title}
            onChanged={() => void refreshTracks()}
            onClose={() => setManageOpen(false)}
          />
        )}
      </div>
    </AnnotationProvider>
  )
}

/**
 * Always-visible floating pencil that toggles annotation write mode.
 *
 * Lives below `SongView` so it sits *inside* `<AnnotationProvider>` and can call
 * `useAnnotations()` (SongView itself renders the provider and is therefore above
 * the context). Positioned top-right under ContextBar's zoom cluster at z-40 —
 * above the PDF/ContextBar (z-30), below the slide-in toolbar (z-50) — so it never
 * overlaps the back button, zoom controls, or the open toolbar.
 */
function WriteModeToggle() {
  const { writeMode, setWriteMode } = useAnnotations()

  const handleToggle = () => {
    const next = !writeMode
    // Mode entry must always succeed — toggle before any best-effort hint work.
    setWriteMode(next)
    // First entry into write mode on a touch device: hint that two fingers scroll
    // (one finger now draws). Once per browser session. Storage access can throw
    // in Safari private mode / when storage is disabled — that must not break the
    // toggle, so the whole best-effort block is guarded.
    if (next && typeof window !== 'undefined') {
      try {
        const isTouch = window.matchMedia?.('(pointer: coarse)').matches
        if (isTouch && !sessionStorage.getItem('anno:scrollHintShown')) {
          toast('Two fingers to scroll', { duration: 3000 })
          sessionStorage.setItem('anno:scrollHintShown', '1')
        }
      } catch {
        // storage unavailable (private mode) — skip the hint; mode toggle still works
      }
    }
  }

  return (
    <button
      type="button"
      onClick={handleToggle}
      aria-label={writeMode ? 'Exit annotation mode' : 'Annotate'}
      aria-pressed={writeMode}
      title={writeMode ? 'Exit annotation mode' : 'Annotate'}
      className={`pointer-events-auto fixed right-3 top-14 z-40 flex h-8 w-8 items-center justify-center rounded-full border shadow transition hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4F7F7A]/40 ${
        writeMode
          ? 'border-transparent text-white hover:brightness-105'
          : 'border-slate-200 bg-white text-[#0b1220] hover:bg-slate-50 hover:border-slate-300 active:bg-slate-100'
      }`}
      style={writeMode ? { backgroundColor: '#4F7F7A' } : undefined}
    >
      <Pencil size={16} />
    </button>
  )
}
