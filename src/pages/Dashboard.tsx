import { useMemo, useState } from 'react';
import { History, Play, RotateCcw, Settings, Square, Timer } from 'lucide-react';
import { useRaceStore } from '../store/raceStore';
import { useNow } from '../lib/useNow';
import {
  doneLapsCount,
  lapDurationSec,
  nextPendingLap,
  runningLap,
  sortedLaps,
} from '../lib/race';
import {
  fmtChrono,
  fmtDayTime,
  fmtTimeHM,
  isoToParisLocalInput,
  paceToStr,
  parisLocalInputToIso,
} from '../lib/time';

const ordinal = (n: number) => (n === 1 ? '1er' : `${n}e`);

export default function Dashboard() {
  const race = useRaceStore((s) => s.race)!;
  const startLap = useRaceStore((s) => s.startLap);
  const finishLap = useRaceStore((s) => s.finishLap);
  const resetRace = useRaceStore((s) => s.resetRace);
  const restoreBackup = useRaceStore((s) => s.restoreBackup);
  const now = useNow();
  const [showAdmin, setShowAdmin] = useState(false);

  const startMs = Date.parse(race.config.startTime);
  const endMs = Date.parse(race.config.endTime);
  const current = useMemo(() => runningLap(race), [race]);
  const next = useMemo(() => nextPendingLap(race), [race]);
  const laps = useMemo(() => sortedLaps(race), [race]);
  const done = doneLapsCount(race);

  const upcoming = laps.filter((l) => l.status === 'pending' && l.id !== next?.id).slice(0, 8);
  const progress = Math.min(1, Math.max(0, (now - startMs) / (endMs - startMs)));

  const currentRunner = current ? race.runners[current.runnerId] : null;
  const nextRunner = next ? race.runners[next.runnerId] : null;

  // Le tour suivant démarre automatiquement à arrivée + 20 s : tant que ce
  // départ est dans le futur, on est en transition (passage de la balise).
  const currentStartMs = current?.actualStart_ts ? Date.parse(current.actualStart_ts) : null;
  const inTransition = currentStartMs !== null && now < currentStartMs;

  return (
    <div className="flex flex-col gap-4">
      {/* Horloge + chrono course */}
      <header className="flex items-baseline justify-between">
        <div className="text-4xl font-bold tnum">
          {fmtChronoLocal(now)}
        </div>
        <div className="text-right">
          <div className="text-xs uppercase text-slate-400">
            {now < startMs ? 'Départ dans' : 'Chrono course'}
          </div>
          <div className="text-xl font-semibold text-emerald-400 tnum">
            {now < startMs ? fmtChrono((startMs - now) / 1000) : fmtChrono((now - startMs) / 1000)}
          </div>
        </div>
      </header>

      {/* Barre de progression */}
      <div>
        <div className="h-3 overflow-hidden rounded-full bg-slate-800">
          <div
            className="h-full rounded-full bg-emerald-500 transition-[width]"
            style={{ width: `${(progress * 100).toFixed(2)}%` }}
          />
        </div>
        <div className="mt-1 flex justify-between text-xs text-slate-400">
          <span>{(progress * 100).toFixed(1)} % de la course</span>
          <span>
            {done} tours · {done * race.config.loopDistance_km} km
          </span>
        </div>
      </div>

      {/* Coureur en cours */}
      {current && currentRunner ? (
        <section
          className={`rounded-2xl border p-4 ${
            inTransition
              ? 'border-amber-500/50 bg-amber-500/10'
              : 'border-blue-500/50 bg-blue-500/10'
          }`}
        >
          {inTransition ? (
            <>
              <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase text-amber-400">
                <Timer className="h-4 w-4" /> Transition — passage de la balise
              </div>
              <div className="flex items-end justify-between gap-2">
                <div>
                  <div className="text-3xl font-bold">{currentRunner.name}</div>
                  <div className="text-sm text-slate-300">
                    {ordinal(current.runnerLapNumber)} tour · #{current.lapNumber} · le chrono
                    démarre automatiquement
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-5xl font-bold text-amber-400 tnum">
                    {Math.ceil((currentStartMs! - now) / 1000)}
                  </div>
                  <div className="text-xs text-slate-400">secondes</div>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase text-blue-400">
                <Timer className="h-4 w-4" /> En course — tour #{current.lapNumber}
              </div>
              <div className="flex items-end justify-between gap-2">
                <div>
                  <div className="text-3xl font-bold">{currentRunner.name}</div>
                  <div className="text-sm text-slate-300">
                    {ordinal(current.runnerLapNumber)} tour · allure prévue{' '}
                    {paceToStr(currentRunner.currentPace_secPerKm)}/km
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-3xl font-bold text-blue-300 tnum">
                    {currentStartMs !== null ? fmtChrono((now - currentStartMs) / 1000) : '—'}
                  </div>
                  <div className="text-xs text-slate-400">
                    arrivée ~
                    {currentStartMs !== null
                      ? fmtTimeHM(
                          new Date(
                            currentStartMs +
                              lapDurationSec(
                                currentRunner.currentPace_secPerKm,
                                race.config.loopDistance_km,
                              ) *
                                1000,
                          ).toISOString(),
                        )
                      : fmtTimeHM(current.predictedEnd_ts)}
                  </div>
                </div>
              </div>
              <button
                onClick={() => finishLap(current.lapNumber)}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-blue-500 py-3 text-lg font-bold text-slate-950"
              >
                <Square className="h-5 w-5" /> Terminer le tour
              </button>
            </>
          )}
        </section>
      ) : (
        <section className="rounded-2xl border border-slate-700 bg-slate-900 p-4 text-center text-slate-400">
          Personne en course pour le moment
        </section>
      )}

      {/* Coureur suivant */}
      {next && nextRunner && (
        <section className="rounded-2xl border border-slate-700 bg-slate-900 p-4">
          <div className="mb-1 text-xs font-semibold uppercase text-slate-400">
            Suivant — tour #{next.lapNumber}
          </div>
          <div className="flex items-end justify-between gap-2">
            <div>
              <div className="text-2xl font-bold">{nextRunner.name}</div>
              <div className="text-sm text-slate-300">
                départ prévu {fmtDayTime(next.predictedStart_ts)}
              </div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-emerald-400 tnum">
                {fmtChrono((Date.parse(next.predictedStart_ts) - now) / 1000)}
              </div>
              <div className="text-xs text-slate-400">compte à rebours</div>
            </div>
          </div>
          {/* La boucle s'enchaîne toute seule : ce bouton ne sert qu'au départ
              de la course (ou pour relancer après un trou). */}
          {!current && (
            <button
              onClick={() => startLap(next.lapNumber)}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 py-3 text-lg font-bold text-slate-950"
            >
              <Play className="h-5 w-5" /> Démarrer maintenant
            </button>
          )}
        </section>
      )}

      {/* 5 prochains passages */}
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase text-slate-400">
          Prochains passages
        </h2>
        <ul className="divide-y divide-slate-800 overflow-hidden rounded-2xl border border-slate-800">
          {upcoming.map((lap) => (
            <li key={lap.id} className="flex items-center justify-between bg-slate-900 px-4 py-3">
              <span className="font-semibold">
                {race.runners[lap.runnerId]?.name}
                <span className="ml-2 text-xs text-slate-400">#{lap.lapNumber}</span>
              </span>
              <span className="text-slate-300 tnum">{fmtDayTime(lap.predictedStart_ts)}</span>
            </li>
          ))}
          {upcoming.length === 0 && (
            <li className="bg-slate-900 px-4 py-3 text-slate-400">Fin de course proche !</li>
          )}
        </ul>
      </section>

      <div className="text-center text-xs text-slate-500">
        {laps.length} tours planifiés · fin de course {fmtDayTime(race.config.endTime)} · dernier
        retour estimé{' '}
        {laps.length > 0 ? fmtDayTime(laps[laps.length - 1].predictedEnd_ts) : '—'}
      </div>

      {/* Administration : reset de la course / restauration de la session */}
      <section className="mt-2">
        <button
          onClick={() => setShowAdmin((v) => !v)}
          className="mx-auto flex items-center gap-2 text-xs text-slate-500"
        >
          <Settings className="h-4 w-4" /> Administration
        </button>
        {showAdmin && (
          <div className="mt-3 flex flex-col gap-2 rounded-2xl border border-slate-800 bg-slate-900 p-4">
            <RaceTimesForm
              key={race.config.startTime + race.config.endTime}
              startIso={race.config.startTime}
              endIso={race.config.endTime}
            />
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
                <History className="h-5 w-5" /> Restaurer la session du{' '}
                {fmtDayTime(race.backup.savedAt)}
              </button>
            ) : (
              <p className="text-center text-xs text-slate-500">
                Aucune session sauvegardée (le reset crée une sauvegarde).
              </p>
            )}
          </div>
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
    <div className="mb-2 flex flex-col gap-2 border-b border-slate-800 pb-4">
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
        <button
          onClick={save}
          className="rounded-xl bg-emerald-500 py-2.5 font-bold text-slate-950"
        >
          Enregistrer et recalculer le planning
        </button>
      )}
    </div>
  );
}

/** Heure de Paris courante "14:32:05". */
function fmtChronoLocal(nowMs: number): string {
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(nowMs);
}
