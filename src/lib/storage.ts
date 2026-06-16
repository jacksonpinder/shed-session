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
