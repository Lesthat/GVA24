import { useEffect } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { Gauge, ListOrdered, LogOut, Settings, Users, Zap, WifiOff, X } from 'lucide-react';
import { useRaceStore } from '../store/raceStore';

const tabs = [
  { to: '/', label: 'Course', icon: Gauge },
  { to: '/timeline', label: 'Timeline', icon: ListOrdered },
  { to: '/runners', label: 'Coureurs', icon: Users },
  { to: '/quick', label: 'Saisie', icon: Zap },
  { to: '/admin', label: 'Admin', icon: Settings },
];

export function Layout() {
  const connected = useRaceStore((s) => s.connected);
  const error = useRaceStore((s) => s.error);
  const clearError = useRaceStore((s) => s.clearError);
  const race = useRaceStore((s) => s.race);
  const pin = useRaceStore((s) => s.pin);
  const leave = useRaceStore((s) => s.leave);

  // Les toasts d'erreur disparaissent seuls après 5 s.
  useEffect(() => {
    if (!error) return;
    const id = setTimeout(clearError, 5000);
    return () => clearTimeout(id);
  }, [error, clearError]);

  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col">
      {/* Le code de course est affiché en permanence : tout le monde doit
          voir le même code pour partager la même session. */}
      <header className="flex items-center justify-between border-b border-slate-800 px-4 py-2 text-sm">
        <span className="font-bold">
          GVA24 <span className="font-normal text-slate-400">· course {pin}</span>
        </span>
        <button
          onClick={() => {
            if (window.confirm(`Quitter la course ${pin} ? (les données restent sur le serveur)`))
              leave();
          }}
          className="flex items-center gap-1 text-slate-400"
        >
          <LogOut className="h-4 w-4" /> Changer
        </button>
      </header>

      {!connected && (
        <div className="flex items-center justify-center gap-2 bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950">
          <WifiOff className="h-4 w-4" />
          Hors ligne — données locales
        </div>
      )}

      {error && (
        <div className="fixed left-1/2 top-4 z-50 flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 items-start justify-between gap-3 rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold shadow-lg">
          <span>{error}</span>
          <button onClick={clearError} aria-label="Fermer">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <main className="flex-1 px-4 pb-24 pt-4">
        {race ? (
          <Outlet />
        ) : (
          <div className="flex h-64 items-center justify-center text-slate-400">
            Chargement de la course…
          </div>
        )}
      </main>

      <nav className="fixed bottom-0 left-1/2 z-40 w-full max-w-3xl -translate-x-1/2 border-t border-slate-800 bg-slate-950/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <div className="grid grid-cols-5">
          {tabs.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex flex-col items-center gap-1 py-3 text-xs font-medium ${
                  isActive ? 'text-emerald-400' : 'text-slate-400'
                }`
              }
            >
              <Icon className="h-6 w-6" />
              {label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
