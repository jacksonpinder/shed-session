import { useCallback, useRef, useState } from 'react'
import { Toaster } from 'sonner'
import PDFViewer from './components/PDFViewer'
import type { PDFViewerHandle, SheetMarker } from './components/PDFViewer'
import PlayerDock from './components/PlayerDock'
import ContextBar from './components/ContextBar'
import LoopSidebar from './components/LoopSidebar'
import type { SavedLoop } from './lib/types'

export default function App() {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const pdfViewerRef = useRef<PDFViewerHandle | null>(null)
  const markerActivateRef = useRef<((loopId: string) => void) | null>(null)
  const createLoopRef = useRef<(() => void) | null>(null)
  const deleteLoopRef = useRef<((id: string) => void) | null>(null)
  const renameLoopRef = useRef<((id: string) => void) | null>(null)
  const selectLoopRef = useRef<((id: string) => void) | null>(null)
  const confirmDraftRef = useRef<((id: string) => void) | null>(null)
  const remarkPositionRef = useRef<((id: string) => void) | null>(null)
  const markPositionRef = useRef<((id: string) => void) | null>(null)
  const toggleLoopRepeatRef = useRef<((id: string) => void) | null>(null)
  const toggleScrollOnRepeatRef = useRef<((id: string) => void) | null>(null)
  const [loopMarkers, setLoopMarkers] = useState<SheetMarker[]>([])
  const [savedLoops, setSavedLoops] = useState<SavedLoop[]>([])
  const [activeLoopId, setActiveLoopId] = useState<string | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [numPages, setNumPages] = useState(0)
  const [zoomOutDisabled, setZoomOutDisabled] = useState(true)
  const [zoomInDisabled, setZoomInDisabled] = useState(false)
  const handleLoopMarkersChange = useCallback((markers: SheetMarker[]) => {
    setLoopMarkers(markers)
  }, [])
  const handleMarkerClick = useCallback((loopId: string) => {
    markerActivateRef.current?.(loopId)
  }, [])
  const handlePageChange = useCallback((page: number, total: number) => {
    setCurrentPage(page)
    setNumPages(total)
  }, [])
  const handleZoomStateChange = useCallback((out: boolean, inn: boolean) => {
    setZoomOutDisabled(out)
    setZoomInDisabled(inn)
  }, [])

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-[#f8fafc] text-slate-900">
      <main className="flex min-h-0 flex-1 overflow-hidden">
        <LoopSidebar
          loops={savedLoops}
          activeLoopId={activeLoopId}
          onCreateLoop={() => createLoopRef.current?.()}
          currentPage={currentPage}
          onSelect={(id) => selectLoopRef.current?.(id)}
          onRename={(id) => renameLoopRef.current?.(id)}
          onToggleRepeat={(id) => toggleLoopRepeatRef.current?.(id)}
          onToggleScrollOnRepeat={(id) => toggleScrollOnRepeatRef.current?.(id)}
          onMarkPosition={(id) => markPositionRef.current?.(id)}
          onConfirmDraft={(id) => confirmDraftRef.current?.(id)}
          onRemarkPosition={(id) => remarkPositionRef.current?.(id)}
          onDelete={(id) => deleteLoopRef.current?.(id)}
        />
        <div className="relative flex-1 min-w-0">
          <PDFViewer
            ref={pdfViewerRef}
            scrollContainerRef={scrollContainerRef}
            sheetMarkers={loopMarkers}
            onMarkerClick={handleMarkerClick}
            onPageChange={handlePageChange}
            onZoomStateChange={handleZoomStateChange}
          />
          <ContextBar
            pdfViewerRef={pdfViewerRef}
            zoomOutDisabled={zoomOutDisabled}
            zoomInDisabled={zoomInDisabled}
          />
        </div>
      </main>
      <PlayerDock
        scrollContainerRef={scrollContainerRef}
        pdfViewerRef={pdfViewerRef}
        onLoopMarkersChange={handleLoopMarkersChange}
        markerActivateRef={markerActivateRef}
        onSavedLoopsChange={setSavedLoops}
        onActiveLoopIdChange={setActiveLoopId}
        createLoopRef={createLoopRef}
        deleteLoopRef={deleteLoopRef}
        renameLoopRef={renameLoopRef}
        selectLoopRef={selectLoopRef}
        confirmDraftRef={confirmDraftRef}
        remarkPositionRef={remarkPositionRef}
        markPositionRef={markPositionRef}
        toggleLoopRepeatRef={toggleLoopRepeatRef}
        toggleScrollOnRepeatRef={toggleScrollOnRepeatRef}
      />
      <Toaster
        richColors
        theme="light"
        toastOptions={{
          classNames: {
            toast: 'bg-white text-slate-900 border border-slate-200',
            title: 'text-slate-900',
          },
        }}
      />
    </div>
  )
}
