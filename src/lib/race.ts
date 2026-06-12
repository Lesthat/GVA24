import type { Lap, RaceState, Runner } from './types';

/** Clé stable et triable d'un tour dans la base ("lap007"). */
export const lapKey = (n: number) => `lap${String(n).padStart(3, '0')}`;

/** Garde-fou contre une boucle infinie si la config est incohérente. */
const MAX_LAPS = 500;

export function lapDurationSec(paceSecPerKm: number, distKm: number): number {
  return Math.round(paceSecPerKm * distKm);
}

/**
 * Allure réelle d'un coureur : moyenne pondérée de ses tours terminés,
 * les tours récents pesant plus lourd (poids 1, 2, 3, …) pour suivre la
 * fatigue au fil des 24h. Sans tour terminé, on garde l'allure de base.
 */
export function computeCurrentPace(
  runnerId: string,
  laps: Record<string, Lap>,
  distKm: number,
  basePace: number,
): number {
  const done = Object.values(laps)
    .filter((l) => l.runnerId === runnerId && l.status === 'done' && l.actualDuration_sec != null)
    .sort((a, b) => a.lapNumber - b.lapNumber);
  if (done.length === 0) return basePace;
  let acc = 0;
  let weightSum = 0;
  done.forEach((l, i) => {
    const pace = l.actualDuration_sec! / distKm;
    const weight = i + 1;
    acc += pace * weight;
    weightSum += weight;
  });
  return Math.round(acc / weightSum);
}

/**
 * RECALCUL EN CASCADE — cœur de l'application.
 *
 * Reconstruit déterministiquement tout le planning à partir de :
 *   – la config (départ, fin, distance, transition, ordre de rotation),
 *   – les temps réels des tours démarrés/terminés (jamais modifiés),
 *   – l'allure actuelle de chaque coureur (recalculée ici).
 *
 * Parcours chronologique avec un curseur temporel :
 *   – tour TERMINÉ  : prédictions figées, le curseur saute à actualEnd ;
 *   – tour EN COURS : prédictions figées, le curseur saute à la projection
 *                     actualStart + durée(allure actuelle), jamais avant `now`
 *                     (un coureur en retard repousse la suite en temps réel) ;
 *   – tour À VENIR  : predictedStart = curseur, predictedEnd = start + durée,
 *                     entièrement recalculé à chaque cascade.
 * Après chaque tour le curseur avance de transitionTime_sec (20 s).
 * On génère des tours tant que predictedStart < endTime : le dernier tour
 * démarré avant 12h00 est inclus même s'il se termine après.
 */
export function recalcSchedule(state: RaceState, nowMs?: number): RaceState {
  const { config } = state;
  const order = config.runnerOrder;
  const distKm = config.loopDistance_km;
  const transMs = config.transitionTime_sec * 1000;
  const endMs = Date.parse(config.endTime);
  const oldLaps = state.laps ?? {};

  const runners: Record<string, Runner> = {};
  for (const [id, r] of Object.entries(state.runners)) {
    runners[id] = {
      ...r,
      currentPace_secPerKm: computeCurrentPace(id, oldLaps, distKm, r.basePace_secPerKm),
    };
  }

  const laps: Record<string, Lap> = {};
  const perRunnerCount: Record<string, number> = {};
  let cursorMs = Date.parse(config.startTime);

  for (let n = 1; n <= MAX_LAPS; n++) {
    const key = lapKey(n);
    const existing = oldLaps[key];
    const runnerId = order[(n - 1) % order.length];
    const runner = runners[runnerId];
    perRunnerCount[runnerId] = (perRunnerCount[runnerId] ?? 0) + 1;

    if (existing && existing.status !== 'pending') {
      // Tour démarré ou terminé : on le conserve tel quel (prédictions figées
      // pour que la colonne "écart" reste comparable).
      laps[key] = existing;
      let lapEndMs: number;
      if (existing.status === 'done' && existing.actualEnd_ts) {
        lapEndMs = Date.parse(existing.actualEnd_ts);
      } else {
        const startMs = existing.actualStart_ts ? Date.parse(existing.actualStart_ts) : cursorMs;
        lapEndMs = startMs + lapDurationSec(runner.currentPace_secPerKm, distKm) * 1000;
        if (nowMs !== undefined) lapEndMs = Math.max(lapEndMs, nowMs);
      }
      cursorMs = lapEndMs + transMs;
      continue;
    }

    // Tour à venir : recalculé depuis le curseur.
    if (cursorMs >= endMs) break; // la course se termine avant ce départ
    const durMs = lapDurationSec(runner.currentPace_secPerKm, distKm) * 1000;
    laps[key] = {
      id: key,
      runnerId,
      lapNumber: n,
      runnerLapNumber: perRunnerCount[runnerId],
      status: 'pending',
      predictedStart_ts: new Date(cursorMs).toISOString(),
      predictedEnd_ts: new Date(cursorMs + durMs).toISOString(),
      actualStart_ts: null,
      actualEnd_ts: null,
      actualDuration_sec: null,
    };
    cursorMs = cursorMs + durMs + transMs;
  }

  // Spread pour préserver les champs hors planning (ex: backup de session).
  return { ...state, runners, laps };
}

/* ------------------------------------------------------------------ */
/* Actions pures, appliquées à l'intérieur d'une transaction Firebase. */
/* ------------------------------------------------------------------ */

/**
 * Démarre un tour. S'il restait un tour "running" plus ancien (le coureur
 * précédent a oublié de pointer son arrivée), il est clôturé automatiquement
 * à départ − transition.
 */
export function applyStart(state: RaceState, lapNumber: number, tsIso: string): RaceState {
  const key = lapKey(lapNumber);
  const target = state.laps[key];
  if (!target || target.status === 'done') return state;

  const laps = { ...state.laps };
  const tsMs = Date.parse(tsIso);

  for (const lap of Object.values(state.laps)) {
    if (lap.status === 'running' && lap.lapNumber < lapNumber && lap.actualStart_ts) {
      const startMs = Date.parse(lap.actualStart_ts);
      const endMs = Math.max(startMs + 1000, tsMs - state.config.transitionTime_sec * 1000);
      laps[lap.id] = {
        ...lap,
        status: 'done',
        actualEnd_ts: new Date(endMs).toISOString(),
        actualDuration_sec: Math.round((endMs - startMs) / 1000),
      };
    }
  }

  laps[key] = { ...target, status: 'running', actualStart_ts: tsIso };
  return recalcSchedule({ ...state, laps }, tsMs);
}

/**
 * Enchaînement automatique : quand un tour se termine, le suivant démarre
 * tout seul après la transition de 20 s (passage de la balise). Son départ
 * réel est donc daté arrivée + 20 s ; l'UI affiche le compte à rebours tant
 * que ce départ est dans le futur.
 */
function autoStartNext(state: RaceState, afterLapNumber: number, endIso: string): RaceState {
  if (runningLap(state)) return state;
  const next = sortedLaps(state).find(
    (l) => l.status === 'pending' && l.lapNumber > afterLapNumber,
  );
  if (!next) return state;
  const startMs = Date.parse(endIso) + state.config.transitionTime_sec * 1000;
  const laps = {
    ...state.laps,
    [next.id]: {
      ...next,
      status: 'running' as const,
      actualStart_ts: new Date(startMs).toISOString(),
    },
  };
  return recalcSchedule({ ...state, laps }, Date.parse(endIso));
}

/** Termine un tour : durée réelle, statut "done", cascade, puis le tour suivant démarre automatiquement (transition 20 s). */
export function applyFinish(state: RaceState, lapNumber: number, tsIso: string): RaceState {
  const key = lapKey(lapNumber);
  const target = state.laps[key];
  if (!target) return state;

  // "J'ARRIVE" sans "JE PARS" : on retombe sur le départ prévu.
  const startIso = target.actualStart_ts ?? target.predictedStart_ts;
  const duration = Math.round((Date.parse(tsIso) - Date.parse(startIso)) / 1000);
  if (duration <= 0) return state;

  const laps = {
    ...state.laps,
    [key]: {
      ...target,
      status: 'done' as const,
      actualStart_ts: startIso,
      actualEnd_ts: tsIso,
      actualDuration_sec: duration,
    },
  };
  const closed = recalcSchedule({ ...state, laps }, Date.parse(tsIso));
  return autoStartNext(closed, lapNumber, tsIso);
}

/**
 * Correction manuelle des temps réels d'un tour (saisie inline / oubli).
 * `null` efface un champ ; le statut est déduit des champs présents.
 */
export function applyEdit(
  state: RaceState,
  lapNumber: number,
  patch: { startIso?: string | null; endIso?: string | null },
): RaceState {
  const key = lapKey(lapNumber);
  const target = state.laps[key];
  if (!target) return state;

  const startIso = patch.startIso !== undefined ? patch.startIso : (target.actualStart_ts ?? null);
  const endIso = patch.endIso !== undefined ? patch.endIso : (target.actualEnd_ts ?? null);
  const effectiveStart = endIso ? (startIso ?? target.predictedStart_ts) : startIso;

  const duration =
    effectiveStart && endIso
      ? Math.round((Date.parse(endIso) - Date.parse(effectiveStart)) / 1000)
      : null;
  if (duration !== null && duration <= 0) return state;

  const laps = {
    ...state.laps,
    [key]: {
      ...target,
      status: endIso ? ('done' as const) : effectiveStart ? ('running' as const) : ('pending' as const),
      actualStart_ts: effectiveStart,
      actualEnd_ts: endIso,
      actualDuration_sec: duration,
    },
  };

  // Le départ réel du tour suivant est dérivé du passage de balise
  // (arrivée + 20 s) : corriger une arrivée corrige donc aussi le départ
  // réel du tour suivant déjà démarré — et sa durée s'il est terminé.
  if (endIso) {
    const nextKey = lapKey(lapNumber + 1);
    const next = laps[nextKey];
    if (next && next.status !== 'pending' && next.actualStart_ts) {
      const newStartMs = Date.parse(endIso) + state.config.transitionTime_sec * 1000;
      const validVsEnd = !next.actualEnd_ts || newStartMs < Date.parse(next.actualEnd_ts);
      if (validVsEnd) {
        laps[nextKey] = {
          ...next,
          actualStart_ts: new Date(newStartMs).toISOString(),
          actualDuration_sec: next.actualEnd_ts
            ? Math.round((Date.parse(next.actualEnd_ts) - newStartMs) / 1000)
            : null,
        };
      }
    }
  }

  const result = recalcSchedule({ ...state, laps }, Date.now());
  // Saisie manuelle de l'arrivée du tour en cours : on relance la boucle
  // comme le ferait le bouton "Terminer".
  if (target.status === 'running' && endIso) return autoStartNext(result, lapNumber, endIso);
  return result;
}

/** Modifie l'allure de base d'un coureur, puis cascade. */
export function applyBasePace(state: RaceState, runnerId: string, paceSecPerKm: number): RaceState {
  const runner = state.runners[runnerId];
  if (!runner || paceSecPerKm < 120 || paceSecPerKm > 1200) return state;
  const runners = {
    ...state.runners,
    [runnerId]: { ...runner, basePace_secPerKm: paceSecPerKm },
  };
  return recalcSchedule({ ...state, runners }, Date.now());
}

/**
 * Modifie le départ et/ou la fin de la course, puis régénère le planning.
 * Les tours déjà démarrés/terminés sont conservés tels quels.
 */
export function applyRaceTimes(state: RaceState, startIso: string, endIso: string): RaceState {
  const startMs = Date.parse(startIso);
  const endMs = Date.parse(endIso);
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) return state;
  return recalcSchedule(
    {
      ...state,
      config: {
        ...state.config,
        startTime: new Date(startMs).toISOString(),
        endTime: new Date(endMs).toISOString(),
      },
    },
    Date.now(),
  );
}

/**
 * Réinitialise la course : tous les temps réels effacés, allures remises à la
 * base, planning régénéré. L'état courant est sauvegardé dans `backup` pour
 * pouvoir être restauré.
 */
export function applyReset(state: RaceState, nowIso: string): RaceState {
  const runners: Record<string, Runner> = {};
  for (const [id, r] of Object.entries(state.runners)) {
    runners[id] = { ...r, currentPace_secPerKm: r.basePace_secPerKm };
  }
  const backup = { savedAt: nowIso, runners: state.runners, laps: state.laps ?? {} };
  return recalcSchedule({ ...state, backup, runners, laps: {} });
}

/** Restaure la dernière session sauvegardée par un reset. */
export function applyRestore(state: RaceState): RaceState {
  if (!state.backup) return state;
  return recalcSchedule(
    { ...state, runners: state.backup.runners, laps: state.backup.laps ?? {} },
    Date.now(),
  );
}

/* ------------------------------ Sélecteurs ------------------------------ */

export function sortedLaps(state: RaceState): Lap[] {
  return Object.values(state.laps ?? {}).sort((a, b) => a.lapNumber - b.lapNumber);
}

export function runningLap(state: RaceState): Lap | null {
  return Object.values(state.laps ?? {}).find((l) => l.status === 'running') ?? null;
}

export function nextPendingLap(state: RaceState): Lap | null {
  return sortedLaps(state).find((l) => l.status === 'pending') ?? null;
}

export function doneLapsCount(state: RaceState): number {
  return Object.values(state.laps ?? {}).filter((l) => l.status === 'done').length;
}

/** Prochain tour (pending, ou running si déjà parti) d'un coureur donné. */
export function nextLapForRunner(state: RaceState, runnerId: string): Lap | null {
  const own = sortedLaps(state).filter((l) => l.runnerId === runnerId);
  return own.find((l) => l.status === 'running') ?? own.find((l) => l.status === 'pending') ?? null;
}
