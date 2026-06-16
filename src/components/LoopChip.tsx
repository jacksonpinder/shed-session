import { useState } from 'react'
import type { SavedLoop, SheetPosition } from '../lib/types'

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function pageLabel(pos: SheetPosition | undefined): string | null {
  if (!pos) return null
  const { page, yWithinPageRatio } = pos
  if (yWithinPageRatio === undefined) return `pg ${page}`
  if (yWithinPageRatio < 0.33) return `Top of pg ${page}`
  if (yWithinPageRatio < 0.66) return `Mid pg ${page}`
  return `Btm pg ${page}`
}

export type LoopChipProps = {
  loop: SavedLoop
  isActive: boolean
  isNearViewport: boolean
  onSelect: () => void
  onRename: (name: string) => void
  onToggleRepeat: () => void
  onToggleScrollOnRepeat: () => void
  scrollOnRepeat: boolean
  onMarkPosition: () => void
  onConfirmDraft: () => void
  onRemarkPosition: () => void
  onDelete: () => void
}

export default function LoopChip({
  loop,
  isActive,
  isNearViewport,
  onSelect,
  onRename,
  onToggleRepeat,
  onToggleScrollOnRepeat,
  scrollOnRepeat,
  onMarkPosition,
  onConfirmDraft,
  onRemarkPosition,
  onDelete,
}: LoopChipProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const savedPos = loop.sheetLink
  const draftPos = loop.sheetLinkDraft
  const pg = pageLabel(savedPos ?? draftPos)

  const rowClass = `flex w-full items-center gap-2 px-2 py-1.5 text-left transition-colors ${
    isActive
      ? 'bg-slate-100'
      : isNearViewport
      ? 'bg-[#4F7F7A]/[0.07] border-l-2 border-[#4F7F7A]'
      : 'hover:bg-slate-50'
  }`

  return (
    <div className={`rounded-lg mb-0.5 ${isActive ? 'bg-slate-100' : ''}`}>
      {/* Name row */}
      <button type="button" onClick={onSelect} className={rowClass}>
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-black/20"
          style={{ backgroundColor: loop.color }}
        />
        {isActive ? (
          <input
            className="min-w-0 flex-1 bg-transparent text-[13px] font-medium text-slate-900 outline-none"
            defaultValue={loop.name}
            onBlur={(e) => {
              const v = e.target.value.trim()
              if (v && v !== loop.name) onRename(v)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="min-w-0 flex-1 truncate text-[13px] text-slate-800">
            {loop.name}
          </span>
        )}
        <span className="shrink-0 text-[11px] text-slate-400">
          {pg ? `${pg} · ` : ''}{formatTime(loop.start)}
        </span>
      </button>

      {/* Expanded controls — only when active */}
      {isActive && (
        <div className="px-2 pb-2 space-y-1.5">
          {/* Repeat + Scroll on repeat */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onToggleRepeat}
              className={`flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium transition-colors ${
                loop.loopOn
                  ? 'bg-[#4F7F7A]/20 text-[#4F7F7A]'
                  : 'bg-slate-200 text-slate-500 hover:bg-slate-300'
              }`}
            >
              ↺ Repeat
            </button>
            {loop.loopOn && (
              <button
                type="button"
                onClick={onToggleScrollOnRepeat}
                className={`flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium transition-colors ${
                  scrollOnRepeat
                    ? 'bg-[#4F7F7A]/20 text-[#4F7F7A]'
                    : 'bg-slate-200 text-slate-500 hover:bg-slate-300'
                }`}
              >
                ↕ Scroll
              </button>
            )}
          </div>

          {/* Sheet position */}
          <div className="text-[12px]">
            {draftPos && (
              <div className="flex items-center gap-1.5 rounded-md border border-dashed border-slate-300 px-2 py-1.5 text-slate-400">
                <span className="flex-1 truncate">
                  📍 {pageLabel(draftPos)}
                  <span className="ml-1 text-[10px] uppercase tracking-wide text-slate-300">draft</span>
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
              <div className="flex items-center gap-1.5 px-2 py-1 text-slate-500">
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
                className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
              >
                📍 Mark position
              </button>
            )}
          </div>

          {/* Delete */}
          {confirmingDelete ? (
            <div className="flex items-center gap-2 px-2">
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
              className="w-full rounded-md px-2 py-1 text-left text-[12px] text-red-400 hover:bg-red-50 hover:text-red-600"
            >
              Delete loop
            </button>
          )}
        </div>
      )}
    </div>
  )
}
