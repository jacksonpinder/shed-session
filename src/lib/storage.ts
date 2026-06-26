export function loadJson<T>(key: string): T | null {
  if (typeof window === 'undefined') {
    return null
  }
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) {
      return null
    }
    return JSON.parse(raw) as T
  } catch (error) {
    return null
  }
}

export function saveJson<T>(key: string, value: T | null) {
  if (typeof window === 'undefined') {
    return
  }
  try {
    if (value === null) {
      window.localStorage.removeItem(key)
      return
    }
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch (error) {
    // Ignore storage failures (quota, privacy mode).
  }
}

/**
 * Pluggable key-value persistence used by PlayerDock. The default is global
 * localStorage (single-song behavior, unchanged). The multi-song library injects
 * a per-song store that maps these keys onto a Song/Track record instead, so the
 * same component persists per song without touching its internal state logic.
 */
export type PracticeStore = {
  load: <T>(key: string) => T | null
  save: <T>(key: string, value: T | null) => void
}

export const localStorageStore: PracticeStore = { load: loadJson, save: saveJson }
