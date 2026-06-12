import { useState } from 'react';
import { Flag } from 'lucide-react';
import { useRaceStore } from '../store/raceStore';

/** Écran d'entrée : rejoindre la course avec le code PIN partagé. */
export function JoinGate() {
  const join = useRaceStore((s) => s.join);
  const joining = useRaceStore((s) => s.joining);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const err = await join(pin);
    if (err) setError(err);
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8 px-6">
      <div className="flex flex-col items-center gap-2">
        <Flag className="h-12 w-12 text-emerald-400" />
        <h1 className="text-3xl font-bold">GVA24</h1>
        <p className="text-slate-400">Course relais 24h — 14/15 juin 2026</p>
      </div>

      <form onSubmit={submit} className="flex w-full max-w-xs flex-col gap-4">
        <label className="text-center text-sm text-slate-400" htmlFor="pin">
          Code de course (4 chiffres)
        </label>
        <input
          id="pin"
          inputMode="numeric"
          pattern="\d{4}"
          maxLength={4}
          autoFocus
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          className="rounded-xl border border-slate-700 bg-slate-900 py-4 text-center text-4xl tracking-[0.5em] tnum outline-none focus:border-emerald-400"
          placeholder="••••"
        />
        {error && <p className="text-center text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={joining || pin.length !== 4}
          className="rounded-xl bg-emerald-500 py-4 text-lg font-bold text-slate-950 disabled:opacity-40"
        >
          {joining ? 'Connexion…' : 'Rejoindre la course'}
        </button>
      </form>
    </div>
  );
}
