import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useRaceStore } from '../store/raceStore';
import { sortedLaps } from '../lib/race';
import {
  fmtDayTime,
  fmtDuration,
  fmtKm,
  fmtSignedDuration,
  fmtTimeHM,
  paceToStr,
  secondsBetween,
  strToPace,
} from '../lib/time';

export default function RunnerDetail() {
  const { runnerId } = useParams<{ runnerId: string }>();
  const race = useRaceStore((s) => s.race)!;
  const setBasePace = useRaceStore((s) => s.setBasePace);

  const runner = runnerId ? race.runners[runnerId] : undefined;
  const [paceText, setPaceText] = useState(runner ? paceToStr(runner.basePace_secPerKm) : '');
  const [paceError, setPaceError] = useState(false);

  const laps = useMemo(
    () => sortedLaps(race).filter((l) => l.runnerId === runnerId),
    [race, runnerId],
  );

  if (!runner) {
    return (
      <div className="text-slate-400">
        Coureur introuvable.{' '}
        <Link to="/runners" className="text-emerald-400 underline">
          Retour
        </Link>
      </div>
    );
  }

  const doneLaps = laps.filter((l) => l.status === 'done' && l.actualDuration_sec != null);

  function savePace() {
    const pace = strToPace(paceText);
    if (!pace) {
      setPaceError(true);
      return;
    }
    setPaceError(false);
    setBasePace(runner!.id, pace);
  }

  return (
    <div className="flex flex-col gap-4">
      <Link to="/runners" className="flex items-center gap-1 text-sm text-slate-400">
        <ArrowLeft className="h-4 w-4" /> Coureurs
      </Link>
      <h1 className="text-2xl font-bold">{runner.name}</h1>

      {/* Allures */}
      <section className="grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
          <div className="text-xs uppercase text-slate-400">Allure réelle</div>
          <div className="text-2xl font-bold text-emerald-400 tnum">
            {paceToStr(runner.currentPace_secPerKm)}/km
          </div>
          <div className="text-xs text-slate-500">
            {doneLaps.length > 0
              ? `moyenne pondérée sur ${doneLaps.length} tour${doneLaps.length > 1 ? 's' : ''}`
              : 'aucun tour terminé — allure de base'}
          </div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
          <div className="text-xs uppercase text-slate-400">Allure de base</div>
          <div className="flex items-center gap-2">
            <input
              value={paceText}
              onChange={(e) => {
                setPaceText(e.target.value);
                setPaceError(false);
              }}
              inputMode="numeric"
              className={`w-20 rounded-lg border bg-slate-950 px-2 py-1 text-xl font-bold tnum outline-none focus:border-emerald-400 ${
                paceError ? 'border-red-500' : 'border-slate-700'
              }`}
            />
            <button
              onClick={savePace}
              className="rounded-lg bg-slate-700 px-3 py-1.5 text-sm font-semibold"
            >
              OK
            </button>
          </div>
          <div className="text-xs text-slate-500">format M:SS — recalcule le planning</div>
        </div>
      </section>

      {/* Distance parcourue */}
      <div className="flex justify-between rounded-xl border border-slate-800 bg-slate-900 px-4 py-3 text-sm tnum">
        <span>
          <span className="font-bold text-slate-100">{doneLaps.length}</span> tours
        </span>
        <span>
          <span className="font-bold text-slate-100">
            {fmtKm(doneLaps.length * race.config.loopDistance_km)}
          </span>{' '}
          km
        </span>
        <span>
          D+{' '}
          <span className="font-bold text-slate-100">
            {Math.round(doneLaps.length * (race.config.elevationGain_m ?? 0))}
          </span>{' '}
          m
        </span>
      </div>

      {/* Historique des performances */}
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase text-slate-400">
          Tours ({doneLaps.length} terminés / {laps.length} planifiés)
        </h2>
        <ul className="flex flex-col gap-2">
          {laps.map((lap) => {
            const predictedDur = secondsBetween(lap.predictedEnd_ts, lap.predictedStart_ts);
            const delta =
              lap.status === 'done' && lap.actualDuration_sec != null
                ? lap.actualDuration_sec - predictedDur
                : null;
            const lapPace =
              lap.actualDuration_sec != null
                ? lap.actualDuration_sec / race.config.loopDistance_km
                : null;
            return (
              <li
                key={lap.id}
                className={`rounded-xl border-l-4 bg-slate-900 px-3 py-2 ${
                  lap.status === 'running'
                    ? 'border-blue-500'
                    : lap.status === 'done'
                      ? 'border-emerald-500'
                      : 'border-slate-600'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold">
                    {lap.runnerLapNumber === 1 ? '1er' : `${lap.runnerLapNumber}e`} tour
                    <span className="ml-2 text-xs font-normal text-slate-500">
                      #{lap.lapNumber}
                    </span>
                  </span>
                  <span className="text-sm text-slate-400 tnum">
                    {fmtDayTime(lap.actualStart_ts ?? lap.predictedStart_ts)}
                  </span>
                </div>
                {lap.status === 'done' && lap.actualDuration_sec != null ? (
                  <div className="mt-1 flex flex-wrap gap-x-4 text-sm tnum">
                    <span>
                      {fmtTimeHM(lap.actualStart_ts!)} → {fmtTimeHM(lap.actualEnd_ts!)}
                    </span>
                    <span className="font-semibold">{fmtDuration(lap.actualDuration_sec)}</span>
                    {lapPace != null && <span>{paceToStr(lapPace)}/km</span>}
                    {delta != null && (
                      <span className={delta > 60 ? 'text-orange-400' : 'text-emerald-400'}>
                        {fmtSignedDuration(delta)}
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="mt-1 text-sm text-slate-400 tnum">
                    prévu {fmtTimeHM(lap.predictedStart_ts)} → {fmtTimeHM(lap.predictedEnd_ts)} (
                    {fmtDuration(predictedDur)})
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
