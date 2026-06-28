const DB_NAME = 'practice-audio'
/** Legacy store for recorded mic-take blobs. Kept so pre-library takes still load
 * during migration; new blobs (PDFs, uploaded MP3s, takes) go in `blobs`. */
const STORE_NAME = 'audio-blobs'

/** Object stores added for the multi-song library (DB v2). */
export const BLOBS_STORE = 'blobs'
export const SONGS_STORE = 'songs'
export const TRACKS_STORE = 'tracks'

/** Per-song annotation strokes (DB v3). Kept separate from the songs record so
 * potentially large stroke JSON doesn't bloat every song read. Keyed by songId. */
export const ANNOTATIONS_STORE = 'annotations'

const DB_VERSION = 3

/**
 * Open (and migrate) the shared practice IndexedDB. All library stores live in
 * this one database so a single `openDb()` serves both takes and song/track data.
 */
export const openDb = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
      if (!db.objectStoreNames.contains(BLOBS_STORE)) {
        db.createObjectStore(BLOBS_STORE)
      }
      if (!db.objectStoreNames.contains(SONGS_STORE)) {
        // Songs and tracks store their id inside the record (keyPath).
        db.createObjectStore(SONGS_STORE, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(TRACKS_STORE)) {
        const tracks = db.createObjectStore(TRACKS_STORE, { keyPath: 'id' })
        tracks.createIndex('bySong', 'songId', { unique: false })
      }
      if (!db.objectStoreNames.contains(ANNOTATIONS_STORE)) {
        // Keyed by songId (the put/get key), like BLOBS_STORE.
        db.createObjectStore(ANNOTATIONS_STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

export const putAudioBlob = async (id: string, blob: Blob) => {
  const db = await openDb()
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.oncomplete = () => {
      db.close()
      resolve()
    }
    tx.onerror = () => {
      db.close()
      reject(tx.error)
    }
    tx.objectStore(STORE_NAME).put(blob, id)
  })
}

export const getAudioBlob = async (id: string) => {
  const db = await openDb()
  return new Promise<Blob | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const request = tx.objectStore(STORE_NAME).get(id)
    request.onsuccess = () => resolve((request.result as Blob) ?? null)
    request.onerror = () => reject(request.error)
    tx.oncomplete = () => db.close()
    tx.onerror = () => {
      db.close()
      reject(tx.error)
    }
  })
}

export const deleteAudioBlob = async (id: string) => {
  const db = await openDb()
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.oncomplete = () => {
      db.close()
      resolve()
    }
    tx.onerror = () => {
      db.close()
      reject(tx.error)
    }
    tx.objectStore(STORE_NAME).delete(id)
  })
}
