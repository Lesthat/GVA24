import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, TrendingDown, TrendingUp } from 'lucide-react';
import { useRaceStore } from '../store/raceStore';
import { nextLapForRunner } from '../lib/race';
import { RankMedal } from '../components/RankMedal';
import { fmtDayTime, fmtKm, paceToStr } from '../lib/time';

export default function Runners() {
  const race = useRaceStore((s) => s.race)!;

  // Classement par allure réelle (moyenne pondérée), parmi les coureurs ayant
  // terminé au moins un tour. Top 3 → médailles or / argent / bronze.
  const rank = useMemo(() => {
    const ranked = race.config.runnerOrder
      .map((id) => race.runners[id])
      .filter(
        (r) =>
          r && Object.values(race.laps).some((l) => l.runnerId === r.id && l.status === 'done'),
      )
      .sort((a, b) => a!.currentPace_secPerKm - b!.currentPace_secPerKm);
    const map: Record<string, 1 | 2 | 3> = {};
    ranked.slice(0, 3).forEach((r, i) => (map[r!.id] = (i + 1) as 1 | 2 | 3));
    return map;
  }, [race]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">Coureurs</h1>
      <ul className="flex flex-col gap-2">
        {race.config.runnerOrder.map((id, idx) => {
          const runner = race.runners[id];
          if (!runner) return null;
          const doneLaps = Object.values(race.laps).filter(
            (l) => l.runnerId === id && l.status === 'done',
          ).length;
          const next = nextLapForRunner(race, id);
          const paceDiff = runner.currentPace_secPerKm - runner.basePace_secPerKm;
          const medal = rank[id];
          return (
            <li key={id}>
              <Link
                to={`/runners/${id}`}
                className={`flex items-center justify-between gap-3 rounded-xl border bg-slate-900 px-4 py-3 ${
                  medal ? 'border-amber-500/40' : 'border-slate-800'
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-bold">
                    <span className="text-slate-500">{idx + 1}.</span>
                    <span className="truncate">{runner.name}</span>
                    {medal && <RankMedal rank={medal} compact />}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-sm text-slate-400">
                    <span className="tnum">{paceToStr(runner.currentPace_secPerKm)}/km</span>
                    {doneLaps > 0 && paceDiff !== 0 && (
                      <span
                        className={`flex items-center gap-0.5 text-xs ${
                          paceDiff > 0 ? 'text-orange-400' : 'text-emerald-400'
                        }`}
                      >
                        {paceDiff > 0 ? (
                          <TrendingDown className="h-3 w-3" />
                        ) : (
                          <TrendingUp className="h-3 w-3" />
                        )}
                        base {paceToStr(runner.basePace_secPerKm)}
                      </span>
                    )}
                    <span className="tnum">
                      · {doneLaps} tours · {fmtKm(doneLaps * race.config.loopDistance_km)} km
                    </span>
                  </div>
                  {next && (
                    <div className="text-xs text-slate-500">
                      prochain départ {fmtDayTime(next.actualStart_ts ?? next.predictedStart_ts)}
                    </div>
                  )}
                </div>
                <ChevronRight className="h-5 w-5 shrink-0 text-slate-500" />
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
