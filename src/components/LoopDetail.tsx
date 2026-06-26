import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import type { SavedLoop } from '../lib/types'
import { formatTime, pageLabel } from '../lib/formatters'

export type LoopDetailProps = {
  loop: SavedLoop
  onClose: () => void
  onRename: (name: string) => void
  onToggleRepeat: () => void
  onToggleScrollOnRepeat: () => void
  onMarkPosition: () => void
  onConfirmDraft: () => void
  onRemarkPosition: () => void
  onDelete: () => void
}

type EmptyProps = { loop: null; onClose: () => void }

function useIsMobile() {
  const [mobile, setMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches
  )
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mql = window.matchMedia('(max-width: 1023px)')
    const handler = (e: MediaQueryListEvent) => setMobile(e.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [])
  return mobile
}

const tealActive = 'bg-[#4F7F7A]/15 text-[#4F7F7A]'
const mutedBtn = 'bg-slate-100 text-slate-500 hover:bg-slate-200'

/** Shared body used by both the desktop card and mobile drawer. */
function LoopDetailBody({
  loop,
  onClose,
  onCollapse,
  onRename,
  onToggleRepeat,
  onToggleScrollOnRepeat,
  onMarkPosition,
  onConfirmDraft,
  onRemarkPosition,
  onDelete,
}: LoopDetailProps & { onCollapse?: () => void }) {
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const savedPos = loop.sheetLink
  const draftPos = loop.sheetLinkDraft

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-start gap-2">
        <span
          className="mt-0.5 h-3 w-3 shrink-0 rounded-full ring-1 ring-black/10"
          style={{ backgroundColor: loop.color }}
        />
        <input
          key={loop.id}
          className="min-w-0 flex-1 bg-transparent text-[14px] font-medium text-slate-900 outline-none placeholder:text-slate-400"
          defaultValue={loop.name}
          onBlur={(e) => {
            const v = e.target.value.trim()
            if (v && v !== loop.name) onRename(v)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
        />
        {onCollapse ? (
          <button
            type="button"
            onClick={onCollapse}
            className="shrink-0 rounded p-0.5 text-slate-400 transition hover:text-slate-600"
            aria-label="Collapse"
            title="Collapse"
          >
            <ChevronLeft size={15} strokeWidth={2} />
          </button>
        ) : (
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded p-0.5 text-slate-400 transition hover:text-slate-600"
            aria-label="Close"
          >
            <X size={14} strokeWidth={2} />
          </button>
        )}
      </div>

      {/* Time */}
      <div className="flex items-center gap-2 text-[12px] text-slate-500">
        <span>{formatTime(loop.start)}</span>
        <span className="text-slate-300">→</span>
        <span>{formatTime(loop.end)}</span>
        <span className="ml-auto text-[11px]">
          {formatTime(loop.end - loop.start)} long
        </span>
      </div>

      {/* Repeat controls */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onToggleRepeat}
          className={`flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
            loop.loopOn ? tealActive : mutedBtn
          }`}
        >
          ↺ Repeat
        </button>
        {loop.loopOn && (
          <button
            type="button"
            onClick={onToggleScrollOnRepeat}
            className={`flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
              loop.scrollOnRepeat ? tealActive : mutedBtn
            }`}
          >
            ↕ Scroll
          </button>
        )}
      </div>

      {/* Sheet position */}
      <div className="text-[12px]">
        {draftPos && (
          <div className="flex items-center gap-2 rounded-lg border border-dashed border-slate-200 px-2.5 py-2 text-slate-400">
            <span className="flex-1 truncate">
              📍 {pageLabel(draftPos)}
              <span className="ml-1.5 text-[10px] uppercase tracking-wide text-slate-300">
                draft
              </span>
            </span>
            <button
              type="button"
              onClick={onRemarkPosition}
              className="shrink-0 hover:text-slate-600"
            >
              Re-mark
            </button>
            <button
              type="button"
              onClick={onConfirmDraft}
              className="shrink-0 font-semibold text-[#4F7F7A] hover:text-[#3d6460]"
            >
              Confirm
            </button>
          </div>
        )}
        {!draftPos && savedPos && (
          <div className="flex items-center gap-2 px-1 text-slate-500">
            <span className="flex-1 truncate">📍 {pageLabel(savedPos)}</span>
            <button
              type="button"
              onClick={onRemarkPosition}
              className="shrink-0 text-[11px] text-slate-400 hover:text-slate-600"
            >
              Re-mark
            </button>
          </div>
        )}
        {!draftPos && !savedPos && (
          <button
            type="button"
            onClick={onMarkPosition}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            📍 Mark score position
          </button>
        )}
      </div>

      {/* Delete */}
      <div className="border-t border-slate-100 pt-2">
        {confirmingDelete ? (
          <div className="flex items-center gap-3 px-1">
            <span className="flex-1 text-[12px] text-slate-500">Delete this loop?</span>
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              className="text-[12px] text-slate-400 hover:text-slate-600"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="text-[12px] font-medium text-red-500 hover:text-red-700"
            >
              Delete
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            className="w-full rounded-lg px-2.5 py-1.5 text-left text-[12px] text-red-400 transition hover:bg-red-50 hover:text-red-600"
          >
            Delete loop
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * The loop detail panel. On desktop it's a compact floating card pinned just
 * below the context bar; on mobile it's a left-side drawer. Either way it
 * overlays the score (never a sidebar), only exists while a loop is selected,
 * and collapses to a thin left-edge tab without deselecting the loop. On mobile
 * it starts collapsed so selecting a loop doesn't cover the score.
 */
export function LoopDetailCard(props: LoopDetailProps | EmptyProps) {
  const isMobile = useIsMobile()
  const [collapsed, setCollapsed] = useState(false)
  const loopId = props.loop?.id ?? null

  // On (re)selection, expand on desktop but stay collapsed on mobile.
  useEffect(() => {
    if (loopId) setCollapsed(isMobile)
  }, [loopId, isMobile])

  if (!props.loop) return null
  const loop = props.loop

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        className="absolute left-0 top-16 z-30 flex flex-col items-center gap-1.5 rounded-r-xl border border-l-0 border-slate-200 bg-white py-2.5 pl-1.5 pr-1 shadow-md"
        aria-label="Expand loop details"
        title={loop.name}
      >
        <span
          className="h-3 w-3 rounded-full ring-1 ring-black/10"
          style={{ backgroundColor: loop.color }}
        />
        <ChevronRight size={14} strokeWidth={2} className="text-slate-400" />
      </button>
    )
  }

  const containerClass = isMobile
    ? 'absolute left-0 top-12 bottom-0 z-30 w-[284px] max-w-[85vw] overflow-y-auto rounded-r-2xl border border-l-0 border-slate-200 bg-white p-4 shadow-xl'
    : 'absolute left-3 top-14 z-30 w-[244px] rounded-xl border border-slate-200 bg-white p-3 shadow-lg'

  return (
    <div className={containerClass}>
      <LoopDetailBody {...(props as LoopDetailProps)} onCollapse={() => setCollapsed(true)} />
    </div>
  )
}
