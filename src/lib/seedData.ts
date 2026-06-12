import { recalcSchedule } from './race';
import type { RaceState, Runner } from './types';

const pace = (min: number, sec: number) => min * 60 + sec;

const RUNNERS: Array<{ id: string; name: string; pace: number }> = [
  { id: 'gil', name: 'Gil', pace: pace(5, 15) },
  { id: 'tristan', name: 'Tristan', pace: pace(6, 0) },
  { id: 'jerome', name: 'Jérôme', pace: pace(4, 45) },
  { id: 'steve', name: 'Steve', pace: pace(6, 0) },
  { id: 'vanessa', name: 'Vanessa', pace: pace(5, 30) },
  { id: 'elena', name: 'Elena', pace: pace(6, 0) },
  { id: 'patrice', name: 'Patrice', pace: pace(5, 15) },
  { id: 'claire', name: 'Claire', pace: pace(5, 20) },
  { id: 'mickael', name: 'Mickaël', pace: pace(4, 45) },
];

/**
 * Course du samedi 13 juin 2026 12h30 → dimanche 14 juin 12h00 (heure de
 * Paris, UTC+2), boucle de 7,02 km / D+ 46 m, transition 20 s, 9 coureurs en
 * rotation. Tout reste modifiable dans l'app (onglet Administration).
 */
export function createInitialRace(): RaceState {
  const runners: Record<string, Runner> = {};
  for (const r of RUNNERS) {
    runners[r.id] = {
      id: r.id,
      name: r.name,
      basePace_secPerKm: r.pace,
      currentPace_secPerKm: r.pace,
    };
  }
  return recalcSchedule({
    config: {
      startTime: '2026-06-13T10:30:00.000Z',
      endTime: '2026-06-14T10:00:00.000Z',
      loopDistance_km: 7.02,
      elevationGain_m: 46,
      transitionTime_sec: 20,
      runnerOrder: RUNNERS.map((r) => r.id),
    },
    runners,
    laps: {},
  });
}
