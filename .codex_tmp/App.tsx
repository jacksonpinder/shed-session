import { Toaster } from 'sonner'
import PlayerDock from './components/PlayerDock'

export default function App() {
  return (
    <div className="relative min-h-screen bg-[#f8fafc] text-slate-900">
      <div className="absolute left-0 top-0 z-50 inline-block pl-2 pt-3">
        <div className="relative inline-block">
          <span
            className="pointer-events-none absolute -inset-3 rounded-2xl bg-[radial-gradient(ellipse_at_center,_#ffffff_0%,_rgba(255,255,255,0.85)_45%,_rgba(255,255,255,0)_75%)]"
            aria-hidden="true"
          />
          <img
            src="/Shed%20Session%20icon%20only.png"
            alt="Shed Session logo"
            className="relative z-10 block h-12 w-auto"
          />
        </div>
      </div>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-5 pb-40 pt-8">
        <header>
          <p className="text-xs uppercase tracking-[0.4em] text-[#22d3ee]">Practice space</p>
          <h1 className="mt-3 text-3xl font-semibold">Light, airy practice room</h1>
          <p className="mt-2 max-w-md text-sm text-slate-600">
            Main content will hold the Track Library and Workshop. The player dock stays ready.
          </p>
        </header>
        <section className="grid gap-4 sm:grid-cols-2">
          <div className="h-48 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Track Library placeholder</p>
          </div>
          <div className="h-48 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Workshop placeholder</p>
          </div>
        </section>
      </main>
      <PlayerDock />
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
    </div>
  )
}
