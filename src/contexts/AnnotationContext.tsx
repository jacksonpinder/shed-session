/**
 * Single source of truth for the pen/highlighter annotation feature.
 *
 * `SongView` wraps the PDF viewer with `<AnnotationProvider songId={songId}>`;
 * all annotation UI (toolbar, canvas layer) reads/writes through `useAnnotations()`.
 *
 * - `annotations` + the undo/redo command stacks live in a single `useReducer` so
 *   stroke mutations and their inverse commands stay in lockstep.
 * - Mode and per-tool settings (color, width) are plain `useState`.
 * - Persistence is a debounced (500ms) `saveAnnotations(songId, annotations)` that
 *   fires after the reducer state settles; the initial load runs once per song.
 *
 * Undo/redo is session-only — the command stacks are not persisted. Only the
 * resulting `annotations` snapshot is written to IndexedDB.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react'
import type { AnnotationStroke, SongAnnotations } from '../lib/annotations'
import { loadAnnotations, saveAnnotations } from '../lib/library'

// ── Public types ──────────────────────────────────────────────────────────────

export type AnnotationTool = 'pen' | 'highlight' | 'eraser'

export type AnnotationContextValue = {
  // Mode
  writeMode: boolean
  setWriteMode: (v: boolean) => void

  // Active tool (pen draws opaque strokes; highlight draws semi-transparent; eraser deletes strokes)
  activeTool: AnnotationTool
  setActiveTool: (t: AnnotationTool) => void

  // Per-tool color (each tool remembers its own last color)
  penColor: string
  setPenColor: (c: string) => void
  highlightColor: string
  setHighlightColor: (c: string) => void

  // Per-tool width (logical px, pre-scale)
  penWidth: number
  setPenWidth: (w: number) => void
  highlightWidth: number
  setHighlightWidth: (w: number) => void

  // Persisted annotation data (all pages for this song)
  annotations: SongAnnotations

  // Stroke management
  addStroke: (page: number, stroke: AnnotationStroke) => void
  removeStroke: (page: number, strokeId: string) => void

  // Undo / Redo (session-only, not persisted)
  canUndo: boolean
  canRedo: boolean
  undo: () => void
  redo: () => void

  // Clear all annotations for the song (undoable)
  clearAll: () => void
}

// ── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULT_PEN_COLOR = '#ef4444' // red
const DEFAULT_HIGHLIGHT_COLOR = '#facc15' // yellow
const DEFAULT_PEN_WIDTH = 4
const DEFAULT_HIGHLIGHT_WIDTH = 24
const SAVE_DEBOUNCE_MS = 500

// ── Reducer ───────────────────────────────────────────────────────────────────

/** Inverse-able commands recorded on the undo/redo stacks. */
type AnnotationCommand =
  | { type: 'add'; page: number; stroke: AnnotationStroke }
  | { type: 'remove'; page: number; stroke: AnnotationStroke }
  | { type: 'clearAll'; snapshot: SongAnnotations }

type ReducerState = {
  annotations: SongAnnotations
  undoStack: AnnotationCommand[]
  redoStack: AnnotationCommand[]
}

type ReducerAction =
  | { type: 'load'; annotations: SongAnnotations }
  | { type: 'addStroke'; page: number; stroke: AnnotationStroke }
  | { type: 'removeStroke'; page: number; strokeId: string }
  | { type: 'clearAll' }
  | { type: 'undo' }
  | { type: 'redo' }

/** Append a stroke to a page, returning a new annotations object (no mutation). */
function withStroke(
  annotations: SongAnnotations,
  page: number,
  stroke: AnnotationStroke
): SongAnnotations {
  const existing = annotations[page] ?? []
  return { ...annotations, [page]: [...existing, stroke] }
}

/** Remove a stroke from a page by id, returning a new annotations object. */
function withoutStroke(
  annotations: SongAnnotations,
  page: number,
  strokeId: string
): SongAnnotations {
  const existing = annotations[page]
  if (!existing) return annotations
  return { ...annotations, [page]: existing.filter((s) => s.id !== strokeId) }
}

function annotationsReducer(state: ReducerState, action: ReducerAction): ReducerState {
  switch (action.type) {
    case 'load':
      // Fresh data from IndexedDB — reset the session command history.
      return { annotations: action.annotations, undoStack: [], redoStack: [] }

    case 'addStroke': {
      const annotations = withStroke(state.annotations, action.page, action.stroke)
      const cmd: AnnotationCommand = { type: 'add', page: action.page, stroke: action.stroke }
      return { annotations, undoStack: [...state.undoStack, cmd], redoStack: [] }
    }

    case 'removeStroke': {
      const stroke = state.annotations[action.page]?.find((s) => s.id === action.strokeId)
      if (!stroke) return state // nothing to remove — leave state untouched
      const annotations = withoutStroke(state.annotations, action.page, action.strokeId)
      const cmd: AnnotationCommand = { type: 'remove', page: action.page, stroke }
      return { annotations, undoStack: [...state.undoStack, cmd], redoStack: [] }
    }

    case 'clearAll': {
      const cmd: AnnotationCommand = { type: 'clearAll', snapshot: state.annotations }
      return { annotations: {}, undoStack: [...state.undoStack, cmd], redoStack: [] }
    }

    case 'undo': {
      if (state.undoStack.length === 0) return state
      const cmd = state.undoStack[state.undoStack.length - 1]
      const undoStack = state.undoStack.slice(0, -1)
      let annotations = state.annotations
      switch (cmd.type) {
        case 'add':
          annotations = withoutStroke(state.annotations, cmd.page, cmd.stroke.id)
          break
        case 'remove':
          annotations = withStroke(state.annotations, cmd.page, cmd.stroke)
          break
        case 'clearAll':
          annotations = cmd.snapshot
          break
      }
      return { annotations, undoStack, redoStack: [...state.redoStack, cmd] }
    }

    case 'redo': {
      if (state.redoStack.length === 0) return state
      const cmd = state.redoStack[state.redoStack.length - 1]
      const redoStack = state.redoStack.slice(0, -1)
      let annotations = state.annotations
      switch (cmd.type) {
        case 'add':
          annotations = withStroke(state.annotations, cmd.page, cmd.stroke)
          break
        case 'remove':
          annotations = withoutStroke(state.annotations, cmd.page, cmd.stroke.id)
          break
        case 'clearAll':
          annotations = {}
          break
      }
      return { annotations, undoStack: [...state.undoStack, cmd], redoStack }
    }

    default:
      return state
  }
}

// ── Context ───────────────────────────────────────────────────────────────────

export const AnnotationContext = createContext<AnnotationContextValue | null>(null)

export function AnnotationProvider({
  songId,
  children,
}: {
  songId: string
  children: React.ReactNode
}) {
  const [writeMode, setWriteMode] = useState(false)
  const [activeTool, setActiveTool] = useState<AnnotationTool>('pen')
  const [penColor, setPenColor] = useState(DEFAULT_PEN_COLOR)
  const [highlightColor, setHighlightColor] = useState(DEFAULT_HIGHLIGHT_COLOR)
  const [penWidth, setPenWidth] = useState(DEFAULT_PEN_WIDTH)
  const [highlightWidth, setHighlightWidth] = useState(DEFAULT_HIGHLIGHT_WIDTH)

  const [state, dispatch] = useReducer(annotationsReducer, {
    annotations: {},
    undoStack: [],
    redoStack: [],
  })

  // ── Initial load (per song) ───────────────────────────────────────────────────
  // Guard against a stale async result clobbering a newer song's data when
  // `songId` changes before the previous load resolves.
  useEffect(() => {
    let cancelled = false
    loadAnnotations(songId)
      .then((loaded) => {
        if (cancelled) return
        dispatch({ type: 'load', annotations: loaded ?? {} })
      })
      .catch((err) => {
        if (cancelled) return
        console.warn('[Annotations] failed to load', err)
        dispatch({ type: 'load', annotations: {} })
      })
    return () => {
      cancelled = true
    }
  }, [songId])

  // ── Debounced persistence ─────────────────────────────────────────────────────
  // Skip the first annotations value for each song (the post-`load` settle) so we
  // don't write the freshly-loaded data straight back. Every subsequent change
  // schedules a save 500ms later, cancelling any pending one.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const skipNextSave = useRef(true)

  // The next annotations value after a song change is its loaded snapshot — never
  // re-save it. Re-arm the skip guard whenever the song changes.
  useEffect(() => {
    skipNextSave.current = true
  }, [songId])

  useEffect(() => {
    if (skipNextSave.current) {
      skipNextSave.current = false
      return
    }
    if (saveTimer.current) clearTimeout(saveTimer.current)
    const id = songId
    const data = state.annotations
    saveTimer.current = setTimeout(() => {
      saveAnnotations(id, data).catch((err) => {
        console.warn('[Annotations] failed to save', err)
      })
    }, SAVE_DEBOUNCE_MS)
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [state.annotations, songId])

  // ── Stable callbacks ──────────────────────────────────────────────────────────
  const addStroke = useCallback((page: number, stroke: AnnotationStroke) => {
    dispatch({ type: 'addStroke', page, stroke })
  }, [])

  const removeStroke = useCallback((page: number, strokeId: string) => {
    dispatch({ type: 'removeStroke', page, strokeId })
  }, [])

  const undo = useCallback(() => dispatch({ type: 'undo' }), [])
  const redo = useCallback(() => dispatch({ type: 'redo' }), [])
  const clearAll = useCallback(() => dispatch({ type: 'clearAll' }), [])

  const value = useMemo<AnnotationContextValue>(
    () => ({
      writeMode,
      setWriteMode,
      activeTool,
      setActiveTool,
      penColor,
      setPenColor,
      highlightColor,
      setHighlightColor,
      penWidth,
      setPenWidth,
      highlightWidth,
      setHighlightWidth,
      annotations: state.annotations,
      addStroke,
      removeStroke,
      canUndo: state.undoStack.length > 0,
      canRedo: state.redoStack.length > 0,
      undo,
      redo,
      clearAll,
    }),
    [
      writeMode,
      activeTool,
      penColor,
      highlightColor,
      penWidth,
      highlightWidth,
      state.annotations,
      state.undoStack.length,
      state.redoStack.length,
      addStroke,
      removeStroke,
      undo,
      redo,
      clearAll,
    ]
  )

  return <AnnotationContext.Provider value={value}>{children}</AnnotationContext.Provider>
}

export function useAnnotations(): AnnotationContextValue {
  const ctx = useContext(AnnotationContext)
  if (ctx === null) {
    throw new Error('useAnnotations must be used within an <AnnotationProvider>')
  }
  return ctx
}
