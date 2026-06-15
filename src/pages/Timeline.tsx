import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, Play, Square } from 'lucide-react';
import { useRaceStore } from '../store/raceStore';
import { sortedLaps } from '../lib/race';
import {
  fmtDayTime,
  fmtDuration,
  fmtSignedDuration,
  fmtTimeHM,
  paceToStr,
  secondsBetween,
} from '../lib/time';
import { TimeEdit } from '../components/TimeEdit';
import { RankMedal } from '../components/RankMedal';
import type { Lap } from '../lib/types';

/** Écart de durée (réel − prévu) ; null tant que le tour n'est pas terminé. */
function lapDelta(lap: Lap): number | null {
  if (lap.status !== 'done' || lap.actualDuration_sec == null) return null;
  const predicted = secondsBetween(lap.predictedEnd_ts, lap.predictedStart_ts);
  return lap.actualDuration_sec - predicted;
}

/**
 * Couleurs : gris à venir, bleu en course ; terminé → vert si dans les temps
 * ou plus rapide que prévu (c'est bien !), orange si plus lent (> 1 min).
 */
function accent(lap: Lap): string {
  if (lap.status === 'pending') return 'border-slate-600';
  if (lap.status === 'running') return 'border-blue-500';
  return (lapDelta(lap) ?? 0) > 60 ? 'border-orange-500' : 'border-emerald-500';
}

function deltaColor(delta: number): string {
  return delta > 60 ? 'text-orange-400' : 'text-emerald-400';
}

export default function Timeline() {
  const race = useRaceStore((s) => s.race)!;
  const startLap = useRaceStore((s) => s.startLap);
  const finishLap = useRaceStore((s) => s.finishLap);
  const editLap = useRaceStore((s) => s.editLap);

  const swapLaps = useRaceStore((s) => s.swapLaps);
  const [filter, setFilter] = useState<string>('all');
  const [expanded, setExpanded] = useState<string | null>(null);

  // Affichage du plus récent au plus ancien (derniers passages en haut).
  const laps = useMemo(() => {
    const all = sortedLaps(race).reverse();
    return filter === 'all' ? all : all.filter((l) => l.runnerId === filter);
  }, [race, filter]);

  // Séquence globale des tours à venir, pour les flèches de réordonnancement.
  const pendingNumbers = useMemo(
    () =>
      sortedLaps(race)
        .filter((l) => l.status === 'pending')
        .map((l) => l.lapNumber),
    [race],
  );

  // 3 meilleurs runs : tours terminés les plus rapides (distance constante →
  // la durée suffit à classer). Top 3 → médailles.
  const runRank = useMemo(() => {
    const ranked = sortedLaps(race)
      .filter((l) => l.status === 'done' && l.actualDuration_sec != null)
      .sort((a, b) => a.actualDuration_sec! - b.actualDuration_sec!);
    const map: Record<number, 1 | 2 | 3> = {};
    ranked.slice(0, 3).forEach((l, i) => (map[l.lapNumber] = (i + 1) as 1 | 2 | 3));
    return map;
  }, [race]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">Timeline</h1>

      {/* Filtre par coureur */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        <FilterChip active={filter === 'all'} onClick={() => setFilter('all')} label="Tous" />
        {race.config.runnerOrder.map((id) => (
          <FilterChip
            key={id}
            active={filter === id}
            onClick={() => setFilter(id)}
            label={race.runners[id]?.name ?? id}
          />
        ))}
      </div>

      <ul className="flex flex-col gap-2">
        {laps.map((lap) => {
          const runner = race.runners[lap.runnerId];
          const delta = lapDelta(lap);
          const isOpen = expanded === lap.id;
          const predictedDur = secondsBetween(lap.predictedEnd_ts, lap.predictedStart_ts);
          return (
            <li
              key={lap.id}
              className={`rounded-xl border-l-4 bg-slate-900 ${accent(lap)}`}
            >
              <div className="flex items-stretch">
                <button
                  className="flex min-w-0 flex-1 items-center justify-between gap-2 px-3 py-3 text-left"
                  onClick={() => setExpanded(isOpen ? null : lap.id)}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 font-semibold">
                      <span className="truncate">
                        #{lap.lapNumber} · {runner?.name}
                        <span className="ml-2 text-xs font-normal text-slate-400">
                          {lap.runnerLapNumber === 1 ? '1er' : `${lap.runnerLapNumber}e`} tour
                        </span>
                      </span>
                      {runRank[lap.lapNumber] && <RankMedal rank={runRank[lap.lapNumber]} compact />}
                    </div>
                    <div className="text-sm text-slate-400 tnum">
                      prévu {fmtTimeHM(lap.predictedStart_ts)} → {fmtTimeHM(lap.predictedEnd_ts)} (
                      {fmtDuration(predictedDur)})
                    </div>
                    {(lap.actualStart_ts || lap.actualEnd_ts) && (
                      <div className="text-sm text-slate-200 tnum">
                        réel {lap.actualStart_ts ? fmtTimeHM(lap.actualStart_ts) : '—'} →{' '}
                        {lap.actualEnd_ts ? fmtTimeHM(lap.actualEnd_ts) : '…'}
                        {lap.actualDuration_sec != null &&
                          ` (${fmtDuration(lap.actualDuration_sec)})`}
                        {lap.actualDuration_sec != null && (
                          <span className="ml-2 font-semibold text-sky-300">
                            {paceToStr(lap.actualDuration_sec / race.config.loopDistance_km)}/km
                          </span>
                        )}
                        {delta != null && (
                          <span className={`ml-2 font-semibold ${deltaColor(delta)}`}>
                            {fmtSignedDuration(delta)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge lap={lap} />
                    {isOpen ? (
                      <ChevronUp className="h-4 w-4 text-slate-500" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-slate-500" />
                    )}
                  </div>
                </button>

                {/* Réordonner les tours à venir : permute avec le tour
                    pending adjacent (masqué quand un filtre est actif). */}
                {lap.status === 'pending' && filter === 'all' && (
                  <div className="flex flex-col justify-center gap-1 py-2 pr-3">
                    {(() => {
                      const idx = pendingNumbers.indexOf(lap.lapNumber);
                      const prev = idx > 0 ? pendingNumbers[idx - 1] : null;
                      const next =
                        idx >= 0 && idx < pendingNumbers.length - 1
                          ? pendingNumbers[idx + 1]
                          : null;
                      // Liste affichée du plus récent au plus ancien : la ligne
                      // au-dessus est le tour chronologiquement suivant (next).
                      return (
                        <>
                          <button
                            onClick={() => next !== null && swapLaps(lap.lapNumber, next)}
                            disabled={next === null}
                            aria-label="déplacer ce coureur vers le haut"
                            className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-800 disabled:opacity-30"
                          >
                            <ArrowUp className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => prev !== null && swapLaps(prev, lap.lapNumber)}
                            disabled={prev === null}
                            aria-label="déplacer ce coureur vers le bas"
                            className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-800 disabled:opacity-30"
                          >
                            <ArrowDown className="h-4 w-4" />
                          </button>
                        </>
                      );
                    })()}
                  </div>
                )}
              </div>

              {isOpen && (
                /* Référence de date pour la saisie : un temps réel déjà connu
                   du tour, sinon "maintenant" (tour démarré), sinon le prévu.
                   Évite qu'un test avant le jour J atterrisse sur le jour J. */
                <div className="flex flex-col gap-3 border-t border-slate-800 px-3 py-3">
                  <div className="flex gap-2">
                    {lap.status === 'pending' && (
                      <button
                        onClick={() => startLap(lap.lapNumber)}
                        className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-500 py-2 font-bold text-slate-950"
                      >
                        <Play className="h-4 w-4" /> Démarrer maintenant
                      </button>
                    )}
                    {lap.status === 'running' && (
                      <button
                        onClick={() => finishLap(lap.lapNumber)}
                        className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-blue-500 py-2 font-bold text-slate-950"
                      >
                        <Square className="h-4 w-4" /> Terminer maintenant
                      </button>
                    )}
                  </div>
                  <LapRunnerPicker key={`r-${lap.id}-${lap.runnerId}`} lap={lap} />
                  <TimeEdit
                    key={`s-${lap.id}-${lap.actualStart_ts ?? ''}`}
                    label="Départ réel (heure de Paris)"
                    valueIso={lap.actualStart_ts}
                    refIso={
                      lap.actualEnd_ts ??
                      (lap.status === 'pending' ? lap.predictedStart_ts : new Date().toISOString())
                    }
                    allowClear
                    onSave={(iso) => editLap(lap.lapNumber, { startIso: iso })}
                  />
                  <TimeEdit
                    key={`e-${lap.id}-${lap.actualEnd_ts ?? ''}`}
                    label="Arrivée réelle (heure de Paris)"
                    valueIso={lap.actualEnd_ts}
                    refIso={
                      lap.actualStart_ts ??
                      (lap.status === 'pending' ? lap.predictedEnd_ts : new Date().toISOString())
                    }
                    allowClear
                    onSave={(iso) => editLap(lap.lapNumber, { endIso: iso })}
                  />
                  <div className="text-xs text-slate-500">
                    Départ prévu {fmtDayTime(lap.predictedStart_ts)} — laisser vide + OK pour
                    effacer un temps saisi par erreur.
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Changer le coureur d'un tour : « Remplacer » (lui seul change) ou, pour un
 * tour à venir, « S'insérer » (les coureurs suivants glissent d'un cran —
 * permet à un coureur de prendre un tour de plus sans que personne ne saute).
 */
function LapRunnerPicker({ lap }: { lap: Lap }) {
  const race = useRaceStore((s) => s.race)!;
  const setLapRunner = useRaceStore((s) => s.setLapRunner);
  const [sel, setSel] = useState(lap.runnerId);

  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1 text-xs text-slate-400">
        Coureur du tour
        <select
          value={sel}
          onChange={(e) => setSel(e.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-base text-slate-100 outline-none focus:border-emerald-400"
        >
          {race.config.runnerOrder.map((id) => (
            <option key={id} value={id}>
              {race.runners[id]?.name ?? id}
            </option>
          ))}
        </select>
      </label>
      {sel !== lap.runnerId && (
        <div className="flex gap-2">
          <button
            onClick={() => setLapRunner(lap.lapNumber, sel, false)}
            className="flex-1 rounded-lg bg-slate-700 py-2 text-sm font-semibold"
          >
            Remplacer sur ce tour
          </button>
          {lap.status === 'pending' && (
            <button
              onClick={() => setLapRunner(lap.lapNumber, sel, true)}
              className="flex-1 rounded-lg bg-emerald-600 py-2 text-sm font-semibold"
            >
              S'insérer (les suivants glissent)
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function FilterChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-semibold ${
        active ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-300'
      }`}
    >
      {label}
    </button>
  );
}

function StatusBadge({ lap }: { lap: Lap }) {
  if (lap.status === 'pending')
    return <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-400">à venir</span>;
  if (lap.status === 'running')
    return <span className="rounded-full bg-blue-500/20 px-2 py-0.5 text-xs font-semibold text-blue-400">en course</span>;
  return <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-semibold text-emerald-400">terminé</span>;
}
