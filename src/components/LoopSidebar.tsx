import { useState, useEffect, useMemo } from 'react'
import { Plus, Repeat } from 'lucide-react'
import type { SavedLoop } from '../lib/types'
import LoopChip from './LoopChip'

export type LoopSidebarProps = {
  loops: SavedLoop[]
  activeLoopId: string | null
  onCreateLoop: () => void
  currentPage: number
  onSelect?: (id: string) => void
  onRename?: (id: string) => void
  onToggleRepeat?: (id: string) => void
  onToggleScrollOnRepeat?: (id: string) => void
  onMarkPosition?: (id: string) => void
  onConfirmDraft?: (id: string) => void
  onRemarkPosition?: (id: string) => void
  onDelete?: (id: string) => void
}

export default function LoopSidebar({
  loops,
  activeLoopId,
  onCreateLoop,
  currentPage,
  onSelect,
  onRename,
  onToggleRepeat,
  onToggleScrollOnRepeat,
  onMarkPosition,
  onConfirmDraft,
  onRemarkPosition,
  onDelete,
}: LoopSidebarProps) {
  const isNearViewport = (loop: SavedLoop) => {
    const pg = loop.sheetLink?.page ?? loop.sheetLinkDraft?.page
    return pg !== undefined && Math.abs(pg - currentPage) <= 1
  }
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(activeLoopId)

  useEffect(() => setActiveId(activeLoopId), [activeLoopId])

  const sortedLoops = useMemo(() => [...loops].sort((a, b) => a.start - b.start), [loops])

  const panel = (
    <div className="flex h-full w-[220px] shrink-0 flex-col border-r border-slate-200 bg-white">
      {/* + New Loop button */}
      <div className="shrink-0 border-b border-slate-100 p-2">
        <button
          type="button"
          onClick={onCreateLoop}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 py-1.5 text-[12px] text-slate-400 transition hover:border-slate-400 hover:text-slate-600"
        >
          <Plus size={13} />
          New loop
        </button>
      </div>
      {/* Loop list */}
      <div className="flex-1 overflow-y-auto p-2">
        {loops.length === 0 && (
          <p className="px-3 py-4 text-center text-[12px] text-slate-400">
            Hit + to create your first loop
          </p>
        )}
        {sortedLoops.map((loop) => (
          <LoopChip
            key={loop.id}
            loop={loop}
            isActive={activeId === loop.id}
            isNearViewport={isNearViewport(loop)}
            onSelect={() => {
              setActiveId(activeId === loop.id ? null : loop.id)
              onSelect?.(loop.id)
            }}
            onRename={() => onRename?.(loop.id)}
            onToggleRepeat={() => onToggleRepeat?.(loop.id)}
            onToggleScrollOnRepeat={() => onToggleScrollOnRepeat?.(loop.id)}
            scrollOnRepeat={loop.scrollOnRepeat ?? false}
            onMarkPosition={() => onMarkPosition?.(loop.id)}
            onConfirmDraft={() => onConfirmDraft?.(loop.id)}
            onRemarkPosition={() => onRemarkPosition?.(loop.id)}
            onDelete={() => onDelete?.(loop.id)}
          />
        ))}
      </div>
    </div>
  )

  return (
    <>
      {/* Desktop: always visible, pushes PDF content right */}
      <div className="hidden lg:flex h-full">
        {panel}
      </div>

      {/* Mobile: tab + overlay drawer */}
      <div className="lg:hidden">
        {/* Tab on left edge */}
        <button
          className="fixed left-0 top-1/2 z-[300] flex h-14 w-7 -translate-y-1/2 items-center justify-center rounded-r-lg border border-l-0 border-slate-200 bg-white shadow-md"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open loops panel"
          type="button"
        >
          <Repeat size={14} className="text-slate-500" />
        </button>

        {/* Backdrop */}
        {drawerOpen && (
          <div
            className="fixed inset-0 z-[310] bg-black/20"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* Drawer */}
        <div
          className={`fixed inset-y-0 left-0 z-[320] flex flex-col bg-white shadow-xl transition-transform duration-300 ease-in-out ${
            drawerOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
          style={{ width: 'min(75vw, 320px)' }}
        >
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <span className="text-[13px] font-semibold text-slate-700">Loops</span>
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              className="text-slate-400 hover:text-slate-600"
              aria-label="Close loops panel"
            >
              ✕
            </button>
          </div>
          {panel}
        </div>
      </div>
    </>
  )
}
