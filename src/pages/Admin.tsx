import { useState } from 'react';
import { History, RotateCcw } from 'lucide-react';
import { useRaceStore } from '../store/raceStore';
import { fmtDayTime, isoToParisLocalInput, parisLocalInputToIso } from '../lib/time';

export default function Admin() {
  const race = useRaceStore((s) => s.race)!;
  const resetRace = useRaceStore((s) => s.resetRace);
  const restoreBackup = useRaceStore((s) => s.restoreBackup);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">Administration</h1>

      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
        <RaceTimesForm
          key={race.config.startTime + race.config.endTime}
          startIso={race.config.startTime}
          endIso={race.config.endTime}
        />
        <p className="mt-3 text-xs text-slate-500">
          Avant le départ, ces horaires servent au compte à rebours. Le départ réel du premier
          coureur les recale automatiquement (la durée de course est conservée). Ils restent
          modifiables ici à tout moment — le planning est recalculé.
        </p>
      </section>

      <section className="flex flex-col gap-2 rounded-2xl border border-slate-800 bg-slate-900 p-4">
        <div className="text-xs font-semibold uppercase text-slate-400">Session</div>
        <button
          onClick={() => {
            if (
              window.confirm(
                'Réinitialiser la course ? Tous les temps réels seront effacés et le planning régénéré. La session actuelle sera sauvegardée et restaurable.',
              )
            )
              resetRace();
          }}
          className="flex items-center justify-center gap-2 rounded-xl border border-red-500/50 py-3 font-semibold text-red-400"
        >
          <RotateCcw className="h-5 w-5" /> Réinitialiser la course
        </button>
        {race.backup ? (
          <button
            onClick={() => {
              if (
                window.confirm(
                  `Restaurer la session sauvegardée le ${fmtDayTime(race.backup!.savedAt)} ? L'état actuel sera remplacé.`,
                )
              )
                restoreBackup();
            }}
            className="flex items-center justify-center gap-2 rounded-xl border border-slate-600 py-3 font-semibold text-slate-200"
          >
            <History className="h-5 w-5" /> Restaurer la session du {fmtDayTime(race.backup.savedAt)}
          </button>
        ) : (
          <p className="text-center text-xs text-slate-500">
            Aucune session sauvegardée (le reset crée une sauvegarde).
          </p>
        )}
      </section>
    </div>
  );
}

/** Modification du départ / de la fin de la course (heure de Paris). */
function RaceTimesForm({ startIso, endIso }: { startIso: string; endIso: string }) {
  const setRaceTimes = useRaceStore((s) => s.setRaceTimes);
  const [start, setStart] = useState(() => isoToParisLocalInput(startIso));
  const [end, setEnd] = useState(() => isoToParisLocalInput(endIso));
  const [error, setError] = useState<string | null>(null);

  const dirty = start !== isoToParisLocalInput(startIso) || end !== isoToParisLocalInput(endIso);

  function save() {
    const s = parisLocalInputToIso(start);
    const e = parisLocalInputToIso(end);
    if (!s || !e || Date.parse(e) <= Date.parse(s)) {
      setError('Dates invalides : la fin doit être après le départ.');
      return;
    }
    setError(null);
    setRaceTimes(s, e);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs font-semibold uppercase text-slate-400">Horaires de la course</div>
      <label className="flex flex-col gap-1 text-xs text-slate-400">
        Départ (heure de Paris)
        <input
          type="datetime-local"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-base text-slate-100 tnum outline-none focus:border-emerald-400"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-400">
        Fin (heure de Paris)
        <input
          type="datetime-local"
          value={end}
          onChange={(e) => setEnd(e.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-base text-slate-100 tnum outline-none focus:border-emerald-400"
        />
      </label>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {dirty && (
        <button onClick={save} className="rounded-xl bg-emerald-500 py-2.5 font-bold text-slate-950">
          Enregistrer et recalculer le planning
        </button>
      )}
    </div>
  );
}
