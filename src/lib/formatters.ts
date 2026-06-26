import type { SheetPosition } from './types'

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
