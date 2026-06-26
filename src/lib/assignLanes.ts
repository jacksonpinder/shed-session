import type { SavedLoop } from './types'

export type Interval = { id: string; start: number; end: number }

/**
 * Greedy interval scheduling: sort by start, place each in the lowest lane
 * whose last occupant has already ended. Returns a map of id → zero-based lane
 * index. The total number of lanes needed = max(values) + 1. No epsilon, no
 * containment logic — strict non-overlap only.
 *
 * Used for three coordinate spaces: loop time (the dock lane strip), document
 * scroll-Y (the edge rail bands), and within-page Y (the page-margin bars) —
 * so overlapping loops never occlude each other in any of them.
 */
export function packIntervals(intervals: Interval[]): Record<string, number> {
  const sorted = [...intervals].sort((a, b) => a.start - b.start)
  const laneEnds: number[] = []
  const result: Record<string, number> = {}

  for (const item of sorted) {
    let placed = false
    for (let lane = 0; lane < laneEnds.length; lane++) {
      if (laneEnds[lane] <= item.start) {
        result[item.id] = lane
        laneEnds[lane] = item.end
        placed = true
        break
      }
    }
    if (!placed) {
      result[item.id] = laneEnds.length
      laneEnds.push(item.end)
    }
  }

  return result
}

/** Pack loops by their time interval (the dock lane strip). */
export function assignLanes(loops: SavedLoop[]): Record<string, number> {
  return packIntervals(loops)
}

export function laneCount(lanes: Record<string, number>): number {
  const values = Object.values(lanes)
  return values.length === 0 ? 0 : Math.max(...values) + 1
}
