import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Play, Square } from 'lucide-react';
import { useRaceStore } from '../store/raceStore';
import { sortedLaps } from '../lib/race';
import { fmtDayTime, fmtDuration, fmtSignedDuration, fmtTimeHM, secondsBetween } from '../lib/time';
import { TimeEdit } from '../components/TimeEdit';
import type { Lap } from '../lib/types';

/** Écart de durée (réel − prévu) ; null tant que le tour n'est pas terminé. */
function lapDelta(lap: Lap): number | null {
  if (lap.status !== 'done' || lap.actualDuration_sec == null) return null;
  const predicted = secondsBetween(lap.predictedEnd_ts, lap.predictedStart_ts);
  return lap.actualDuration_sec - predicted;
}

/** Couleurs : gris à venir, bleu en course, vert/orange/rouge selon l'écart. */
function accent(lap: Lap): string {
  if (lap.status === 'pending') return 'border-slate-600';
  if (lap.status === 'running') return 'border-blue-500';
  const delta = lapDelta(lap) ?? 0;
  if (delta > 60) return 'border-orange-500';
  if (delta < -60) return 'border-red-500';
  return 'border-emerald-500';
}

function deltaColor(delta: number): string {
  if (delta > 60) return 'text-orange-400';
  if (delta < -60) return 'text-red-400';
  return 'text-emerald-400';
}

export default function Timeline() {
  const race = useRaceStore((s) => s.race)!;
  const startLap = useRaceStore((s) => s.startLap);
  const finishLap = useRaceStore((s) => s.finishLap);
  const editLap = useRaceStore((s) => s.editLap);

  const [filter, setFilter] = useState<string>('all');
  const [expanded, setExpanded] = useState<string | null>(null);

  const laps = useMemo(() => {
    const all = sortedLaps(race);
    return filter === 'all' ? all : all.filter((l) => l.runnerId === filter);
  }, [race, filter]);

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
              <button
                className="flex w-full items-center justify-between gap-2 px-3 py-3 text-left"
                onClick={() => setExpanded(isOpen ? null : lap.id)}
              >
                <div className="min-w-0">
                  <div className="font-semibold">
                    #{lap.lapNumber} · {runner?.name}
                    <span className="ml-2 text-xs font-normal text-slate-400">
                      {lap.runnerLapNumber === 1 ? '1er' : `${lap.runnerLapNumber}e`} tour
                    </span>
                  </div>
                  <div className="text-sm text-slate-400 tnum">
                    prévu {fmtTimeHM(lap.predictedStart_ts)} → {fmtTimeHM(lap.predictedEnd_ts)} (
                    {fmtDuration(predictedDur)})
                  </div>
                  {(lap.actualStart_ts || lap.actualEnd_ts) && (
                    <div className="text-sm text-slate-200 tnum">
                      réel {lap.actualStart_ts ? fmtTimeHM(lap.actualStart_ts) : '—'} →{' '}
                      {lap.actualEnd_ts ? fmtTimeHM(lap.actualEnd_ts) : '…'}
                      {lap.actualDuration_sec != null && ` (${fmtDuration(lap.actualDuration_sec)})`}
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
