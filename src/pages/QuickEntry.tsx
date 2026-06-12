import { useMemo, useState } from 'react';
import { Play, Square, UserRound } from 'lucide-react';
import { useRaceStore } from '../store/raceStore';
import { nextLapForRunner, runningLap } from '../lib/race';
import { fmtChrono, fmtDayTime, fmtTimeHM } from '../lib/time';
import { useNow } from '../lib/useNow';
import { TimeEdit } from '../components/TimeEdit';

const ME_STORAGE_KEY = 'gva24_me';

/** Écran 4 — vue minimaliste pour le coureur sur son téléphone. */
export default function QuickEntry() {
  const race = useRaceStore((s) => s.race)!;
  const startLap = useRaceStore((s) => s.startLap);
  const finishLap = useRaceStore((s) => s.finishLap);
  const editLap = useRaceStore((s) => s.editLap);
  const now = useNow();

  const [me, setMe] = useState<string | null>(() => localStorage.getItem(ME_STORAGE_KEY));
  const [showManual, setShowManual] = useState(false);

  const myLap = useMemo(() => (me ? nextLapForRunner(race, me) : null), [race, me]);
  const someoneRunning = useMemo(() => runningLap(race), [race]);

  function choose(id: string) {
    localStorage.setItem(ME_STORAGE_KEY, id);
    setMe(id);
  }

  if (!me || !race.runners[me]) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-center text-xl font-bold">Qui es-tu ?</h1>
        <div className="grid grid-cols-2 gap-3">
          {race.config.runnerOrder.map((id) => (
            <button
              key={id}
              onClick={() => choose(id)}
              className="rounded-2xl border border-slate-700 bg-slate-900 py-6 text-xl font-bold active:bg-slate-800"
            >
              {race.runners[id]?.name}
            </button>
          ))}
        </div>
      </div>
    );
  }

  const runner = race.runners[me];
  const isRunning = myLap?.status === 'running';

  return (
    <div className="flex flex-col items-center gap-6 pt-4">
      <button
        onClick={() => {
          localStorage.removeItem(ME_STORAGE_KEY);
          setMe(null);
        }}
        className="flex items-center gap-2 rounded-full bg-slate-800 px-4 py-1.5 text-sm text-slate-300"
      >
        <UserRound className="h-4 w-4" /> {runner.name} — changer
      </button>

      {!myLap ? (
        <p className="text-center text-lg text-slate-400">
          Plus de tour planifié pour toi. Beau travail ! 🎉
        </p>
      ) : isRunning ? (
        <>
          <div className="text-center">
            <div className="text-sm uppercase text-slate-400">Tu es en course — tour #{myLap.lapNumber}</div>
            <div className="mt-2 text-6xl font-bold text-blue-400 tnum">
              {myLap.actualStart_ts
                ? fmtChrono((now - Date.parse(myLap.actualStart_ts)) / 1000)
                : '—'}
            </div>
            <div className="mt-1 text-slate-400">
              parti à {myLap.actualStart_ts ? fmtTimeHM(myLap.actualStart_ts) : '—'}
            </div>
          </div>
          <button
            onClick={() => finishLap(myLap.lapNumber)}
            className="flex w-full max-w-sm items-center justify-center gap-3 rounded-3xl bg-blue-500 py-8 text-3xl font-black text-slate-950 active:scale-95"
          >
            <Square className="h-8 w-8" /> J'ARRIVE
          </button>
        </>
      ) : (
        <>
          <div className="text-center">
            <div className="text-sm uppercase text-slate-400">Ton prochain tour — #{myLap.lapNumber}</div>
            <div className="mt-2 text-5xl font-bold tnum">{fmtTimeHM(myLap.predictedStart_ts)}</div>
            <div className="mt-1 text-slate-400">{fmtDayTime(myLap.predictedStart_ts)}</div>
            <div className="mt-3 text-2xl font-semibold text-emerald-400 tnum">
              dans {fmtChrono((Date.parse(myLap.predictedStart_ts) - now) / 1000)}
            </div>
          </div>
          <button
            onClick={() => startLap(myLap.lapNumber)}
            className="flex w-full max-w-sm items-center justify-center gap-3 rounded-3xl bg-emerald-500 py-8 text-3xl font-black text-slate-950 active:scale-95"
          >
            <Play className="h-8 w-8" /> JE PARS
          </button>
          {someoneRunning && someoneRunning.runnerId !== me && (
            <p className="text-center text-xs text-slate-500">
              {race.runners[someoneRunning.runnerId]?.name} est en course — "JE PARS" clôturera
              automatiquement son tour (arrivée = ton départ − 20 s).
            </p>
          )}
        </>
      )}

      {/* Saisie manuelle si on a oublié d'appuyer */}
      {myLap && (
        <div className="w-full max-w-sm">
          <button
            onClick={() => setShowManual((v) => !v)}
            className="w-full text-center text-sm text-slate-500 underline"
          >
            {showManual ? 'Masquer la saisie manuelle' : "J'ai oublié d'appuyer — saisir l'heure"}
          </button>
          {showManual && (
            <div className="mt-3 flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
              <TimeEdit
                key={`qs-${myLap.id}-${myLap.actualStart_ts ?? ''}`}
                label="Heure de départ réelle"
                valueIso={myLap.actualStart_ts}
                refIso={myLap.predictedStart_ts}
                onSave={(iso) => editLap(myLap.lapNumber, { startIso: iso })}
              />
              <TimeEdit
                key={`qe-${myLap.id}-${myLap.actualEnd_ts ?? ''}`}
                label="Heure d'arrivée réelle"
                valueIso={myLap.actualEnd_ts}
                refIso={myLap.predictedEnd_ts}
                onSave={(iso) => editLap(myLap.lapNumber, { endIso: iso })}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
