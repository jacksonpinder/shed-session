import { useCallback, useEffect, useState } from 'react'
import { Toaster } from 'sonner'
import Library from './components/Library'
import SongView from './components/SongView'
import AddSongModal from './components/AddSongModal'
import { AnalysisProvider } from './lib/analysisManager'
import { ensureLibrary, upgradeScrollOnRepeatDefault } from './lib/migrate'

/** Parse the song id out of a `#/song/:id` hash, or null for the library route. */
function songIdFromHash(): string | null {
  const m = window.location.hash.match(/^#\/song\/(.+)$/)
  return m ? decodeURIComponent(m[1]) : null
}

export default function App() {
  const [route, setRoute] = useState<string | null>(() => songIdFromHash())
  const [ready, setReady] = useState(false)
  const [refreshToken, setRefreshToken] = useState(0)
  const [addOpen, setAddOpen] = useState(false)

  // First-run migration: import the legacy single-song assets + state, then route.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        await ensureLibrary()
        await upgradeScrollOnRepeatDefault()
      } catch {
        // Non-fatal: fall through to a ready app even if migration hiccups.
      }
      if (!cancelled) setReady(true)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const onHashChange = () => setRoute(songIdFromHash())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  const navigate = useCallback((hash: string) => {
    if (window.location.hash === hash) {
      setRoute(songIdFromHash())
    } else {
      window.location.hash = hash
    }
  }, [])

  const openSong = useCallback((id: string) => navigate(`#/song/${encodeURIComponent(id)}`), [navigate])
  const goLibrary = useCallback(() => {
    navigate('#/')
    setRefreshToken((t) => t + 1)
  }, [navigate])
  const handleCreated = useCallback(
    (songId: string) => {
      setAddOpen(false)
      setRefreshToken((t) => t + 1)
      openSong(songId)
    },
    [openSong]
  )

  return (
    <AnalysisProvider>
      {ready &&
        (route ? (
          <SongView songId={route} onBack={goLibrary} />
        ) : (
          <Library onOpenSong={openSong} onAddSong={() => setAddOpen(true)} refreshToken={refreshToken} />
        ))}
      {addOpen && <AddSongModal onCreated={handleCreated} onClose={() => setAddOpen(false)} />}
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
    </AnalysisProvider>
  )
}
