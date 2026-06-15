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
  const counts: Record<string, number> = {};
  let lastRunnerId: string | null = null;
  let cursorMs = Date.parse(config.startTime);

  // La rotation ne sert qu'à générer la suite : chaque tour existant garde
  // son coureur (attributions manuelles comprises).
  const nextInRotation = (): string => {
    const idx = lastRunnerId ? order.indexOf(lastRunnerId) : -1;
    return order[(idx + 1) % order.length];
  };

  for (let n = 1; n <= MAX_LAPS; n++) {
    const key = lapKey(n);
    const existing = oldLaps[key];

    if (existing && existing.status !== 'pending') {
      // Tour démarré ou terminé : conservé tel quel (prédictions figées) ;
      // seul runnerLapNumber est retenu à jour si les attributions ont changé.
      const count = (counts[existing.runnerId] ?? 0) + 1;
      counts[existing.runnerId] = count;
      laps[key] =
        existing.runnerLapNumber === count ? existing : { ...existing, runnerLapNumber: count };
      lastRunnerId = existing.runnerId;
      const runner = runners[existing.runnerId];
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
    // Course officiellement terminée → on ne génère plus aucun départ.
    if (config.finished) break;
    if (cursorMs >= endMs) break; // la course se termine avant ce départ
    // Un coureur retiré de l'équipe peut encore figurer sur un pending : on
    // bascule alors sur le suivant de la rotation.
    const runnerId =
      existing && runners[existing.runnerId] ? existing.runnerId : nextInRotation();
    const runner = runners[runnerId];
    const count = (counts[runnerId] ?? 0) + 1;
    counts[runnerId] = count;
    const durMs = lapDurationSec(runner.currentPace_secPerKm, distKm) * 1000;
    laps[key] = {
      id: key,
      runnerId,
      lapNumber: n,
      runnerLapNumber: count,
      status: 'pending',
      predictedStart_ts: new Date(cursorMs).toISOString(),
      predictedEnd_ts: new Date(cursorMs + durMs).toISOString(),
      actualStart_ts: null,
      actualEnd_ts: null,
      actualDuration_sec: null,
    };
    lastRunnerId = runnerId;
    cursorMs = cursorMs + durMs + transMs;
  }

  // Spread pour préserver les champs hors planning (ex: backup de session).
  return { ...state, runners, laps };
}

/* ------------------------------------------------------------------ */
/* Actions pures, appliquées en série par le serveur sur le dernier état. */
/* ------------------------------------------------------------------ */

/**
 * Les 24h découlent du premier départ réel : démarrer (ou corriger) le tour
 * n°1 recale la fenêtre de course — départ = départ réel, fin décalée
 * d'autant (la durée configurée est conservée). Visible dans l'Administration,
 * qui reste modifiable manuellement ensuite.
 */
function alignWindowToFirstStart(state: RaceState): RaceState {
  const first = state.laps[lapKey(1)];
  if (!first?.actualStart_ts) return state;
  const startMs = Date.parse(first.actualStart_ts);
  const oldStartMs = Date.parse(state.config.startTime);
  if (startMs === oldStartMs) return state;
  const durationMs = Date.parse(state.config.endTime) - oldStartMs;
  return {
    ...state,
    config: {
      ...state.config,
      startTime: new Date(startMs).toISOString(),
      endTime: new Date(startMs + durationMs).toISOString(),
    },
  };
}

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
  return recalcSchedule(alignWindowToFirstStart({ ...state, laps }), tsMs);
}

/**
 * Enchaînement automatique : quand un tour se termine, le suivant démarre
 * tout seul après la transition de 20 s (passage de la balise). Son départ
 * réel est donc daté arrivée + 20 s ; l'UI affiche le compte à rebours tant
 * que ce départ est dans le futur.
 */
function autoStartNext(state: RaceState, afterLapNumber: number, endIso: string): RaceState {
  if (state.config.finished) return state; // course terminée : plus de départ
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

/**
 * Termine un run : statut "done", cascade, puis le tour suivant démarre
 * automatiquement (transition 20 s).
 *
 * `loops` = nombre de boucles effectuées dans ce run (déclaré à la
 * validation, défaut 1). Pour N > 1, le run est découpé en N tours de durée
 * égale enchaînés sans transition (le coureur ne s'arrête pas entre ses
 * boucles) : le coureur s'insère sur les tours suivants et les coureurs
 * prévus glissent d'un cran — personne ne saute son tour.
 */
export function applyFinish(
  state: RaceState,
  lapNumber: number,
  tsIso: string,
  loops = 1,
): RaceState {
  if (!Number.isInteger(loops) || loops < 1 || loops > 6) return state;
  const key = lapKey(lapNumber);
  const target = state.laps[key];
  if (!target) return state;

  // "J'ARRIVE" sans "JE PARS" : on retombe sur le départ prévu.
  const startIso = target.actualStart_ts ?? target.predictedStart_ts;
  const startMs = Date.parse(startIso);
  const endMs = Date.parse(tsIso);
  const totalMs = endMs - startMs;
  if (totalMs <= 0) return state;

  // Sécurité : on ne découpe que sur des tours encore à venir.
  let effLoops = loops;
  for (let k = 1; k < loops; k++) {
    const seg = state.laps[lapKey(lapNumber + k)];
    if (seg && seg.status !== 'pending') {
      effLoops = k;
      break;
    }
  }

  // Bornes proportionnelles : N segments de durée (quasi) égale.
  const boundary = (k: number) => startMs + Math.round((totalMs * k) / effLoops);
  const iso = (ms: number) => new Date(ms).toISOString();

  const laps = { ...state.laps };
  laps[key] = {
    ...target,
    status: 'done',
    actualStart_ts: startIso,
    actualEnd_ts: iso(boundary(1)),
    actualDuration_sec: Math.round((boundary(1) - startMs) / 1000),
  };

  if (effLoops > 1) {
    const followers = sortedLaps(state).filter(
      (l) => l.status === 'pending' && l.lapNumber > lapNumber,
    );

    // Prédiction des segments : celle du coureur lui-même (même durée prévue
    // que son 1er tour), pas celle du coureur précédemment prévu sur ce
    // créneau — sinon la colonne « écart » comparerait deux allures.
    const predDurMs =
      Date.parse(target.predictedEnd_ts) - Date.parse(target.predictedStart_ts);
    const predEndMs = Date.parse(target.predictedEnd_ts);

    // Boucles supplémentaires du même coureur (créées si le planning est trop court).
    for (let k = 1; k < effLoops; k++) {
      const segKey = lapKey(lapNumber + k);
      const segStartMs = boundary(k);
      const segEndMs = boundary(k + 1);
      laps[segKey] = {
        id: segKey,
        lapNumber: lapNumber + k,
        runnerLapNumber: 0, // recompté par la cascade
        predictedStart_ts: iso(predEndMs + (k - 1) * predDurMs),
        predictedEnd_ts: iso(predEndMs + k * predDurMs),
        runnerId: target.runnerId,
        status: 'done',
        actualStart_ts: iso(segStartMs),
        actualEnd_ts: iso(segEndMs),
        actualDuration_sec: Math.round((segEndMs - segStartMs) / 1000),
      };
    }

    // Les coureurs prévus glissent de (effLoops − 1) crans.
    const consumed = effLoops - 1;
    followers.slice(consumed).forEach((lap, i) => {
      laps[lap.id] = { ...lap, runnerId: followers[i].runnerId };
    });
  }

  const closed = recalcSchedule({ ...state, laps }, endMs);
  return autoStartNext(closed, lapNumber + effLoops - 1, tsIso);
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

  const result = recalcSchedule(alignWindowToFirstStart({ ...state, laps }), Date.now());
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

/** Échange les coureurs de deux tours à venir (réordonnancement Timeline). */
export function applyLapSwap(state: RaceState, lapA: number, lapB: number): RaceState {
  const a = state.laps[lapKey(lapA)];
  const b = state.laps[lapKey(lapB)];
  if (!a || !b || a.status !== 'pending' || b.status !== 'pending') return state;
  const laps = {
    ...state.laps,
    [a.id]: { ...a, runnerId: b.runnerId },
    [b.id]: { ...b, runnerId: a.runnerId },
  };
  return recalcSchedule({ ...state, laps }, Date.now());
}

/**
 * Annule la dernière arrivée (clic sur « Terminer » par erreur), y compris
 * un run validé en plusieurs tours : toute la chaîne de segments (tours
 * consécutifs du même coureur enchaînés sans transition, créés par le
 * découpage multi-tours) est défaite d'un coup. Le premier segment redevient
 * « en course » avec son départ réel d'origine, les segments insérés sont
 * retirés et les coureurs suivants reprennent leur place initiale.
 */
export function applyUndoFinish(state: RaceState): RaceState {
  const all = sortedLaps(state);
  const lastDone = [...all].reverse().find((l) => l.status === 'done');
  if (!lastDone) return state;

  // Chaîne du run : on remonte tant que le tour précédent est du même
  // coureur et se termine exactement au départ du suivant (0 s d'écart,
  // signature du découpage multi-tours — une vraie passation a +20 s).
  const chain: Lap[] = [lastDone];
  while (true) {
    const prev = state.laps[lapKey(chain[0].lapNumber - 1)];
    if (
      prev &&
      prev.status === 'done' &&
      prev.runnerId === lastDone.runnerId &&
      prev.actualEnd_ts === chain[0].actualStart_ts
    ) {
      chain.unshift(prev);
    } else {
      break;
    }
  }
  const head = chain[0];
  const extraSegments = chain.length - 1;

  const laps = { ...state.laps };
  // Le tour auto-démarré après l'arrivée annulée redevient à venir.
  for (const lap of all) {
    if (lap.status === 'running' && lap.lapNumber > lastDone.lapNumber) {
      laps[lap.id] = {
        ...lap,
        status: 'pending',
        actualStart_ts: null,
        actualEnd_ts: null,
        actualDuration_sec: null,
      };
    }
  }
  // Les segments insérés redeviennent à venir, le premier reprend la course.
  for (const seg of chain.slice(1)) {
    laps[seg.id] = {
      ...seg,
      status: 'pending',
      actualStart_ts: null,
      actualEnd_ts: null,
      actualDuration_sec: null,
    };
  }
  laps[head.id] = {
    ...head,
    status: 'running',
    actualEnd_ts: null,
    actualDuration_sec: null,
  };

  // Dé-décalage : les coureurs suivants remontent d'autant de crans que de
  // segments insérés ; la fin du planning sera régénérée par la rotation.
  if (extraSegments > 0) {
    const pendings = Object.values(laps)
      .filter((l) => l.status === 'pending' && l.lapNumber > head.lapNumber)
      .sort((a, b) => a.lapNumber - b.lapNumber);
    for (let i = 0; i < pendings.length; i++) {
      const source = pendings[i + extraSegments];
      if (source) {
        laps[pendings[i].id] = { ...laps[pendings[i].id], runnerId: source.runnerId };
      } else {
        delete laps[pendings[i].id];
      }
    }
  }

  return recalcSchedule({ ...state, laps }, Date.now());
}

/**
 * Modifie la boucle (distance, D+), puis cascade : les durées prévues et les
 * allures réelles en dépendent.
 */
export function applyLoop(state: RaceState, distKm: number, elevM: number): RaceState {
  if (!Number.isFinite(distKm) || distKm <= 0 || distKm > 100) return state;
  if (!Number.isFinite(elevM) || elevM < 0 || elevM > 10000) return state;
  return recalcSchedule(
    { ...state, config: { ...state.config, loopDistance_km: distKm, elevationGain_m: elevM } },
    Date.now(),
  );
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

/**
 * Réattribue tous les tours à venir selon `order`, en continuant après le
 * coureur du dernier tour démarré. Les tours courus/en cours ne bougent pas.
 * Partagé par le réordonnancement, l'ajout et le retrait d'un coureur.
 */
function reassignPending(laps: Record<string, Lap>, order: string[]): Record<string, Lap> {
  const out = { ...laps };
  let lastRunnerId: string | null = null;
  for (const lap of Object.values(laps).sort((a, b) => a.lapNumber - b.lapNumber)) {
    if (lap.status !== 'pending') {
      lastRunnerId = lap.runnerId;
      continue;
    }
    const idx: number = lastRunnerId ? order.indexOf(lastRunnerId) : -1;
    const runnerId: string = order[(idx + 1) % order.length];
    out[lap.id] = { ...lap, runnerId };
    lastRunnerId = runnerId;
  }
  return out;
}

/**
 * Modifie l'ordre de rotation. Tous les tours à venir sont réattribués selon
 * le nouvel ordre, en continuant après le coureur du dernier tour démarré.
 * Les tours courus/en cours ne changent pas.
 */
export function applyOrder(state: RaceState, newOrder: string[]): RaceState {
  const current = state.config.runnerOrder;
  if (
    newOrder.length !== current.length ||
    [...newOrder].sort().join('|') !== [...current].sort().join('|')
  )
    return state;
  return recalcSchedule(
    {
      ...state,
      config: { ...state.config, runnerOrder: newOrder },
      laps: reassignPending(state.laps, newOrder),
    },
    Date.now(),
  );
}

const slug = (name: string) =>
  name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');

/** Ajoute un coureur à l'équipe (placé en fin de rotation), puis cascade. */
export function applyAddRunner(state: RaceState, name: string, paceSecPerKm: number): RaceState {
  const trimmed = name.trim();
  if (!trimmed || paceSecPerKm < 120 || paceSecPerKm > 1200) return state;
  // id unique à partir du nom (suffixe numérique en cas de doublon).
  const baseId = slug(trimmed) || 'coureur';
  let id = baseId;
  let i = 2;
  while (state.runners[id]) id = `${baseId}${i++}`;

  const runners = {
    ...state.runners,
    [id]: { id, name: trimmed, basePace_secPerKm: paceSecPerKm, currentPace_secPerKm: paceSecPerKm },
  };
  const order = [...state.config.runnerOrder, id];
  // Réattribue les tours à venir pour intégrer le nouveau coureur à la rotation.
  return recalcSchedule(
    { ...state, runners, config: { ...state.config, runnerOrder: order }, laps: reassignPending(state.laps, order) },
    Date.now(),
  );
}

/**
 * Retire un coureur de l'équipe. Refusé s'il est en course ou s'il reste le
 * dernier. S'il a déjà couru, il est seulement sorti de la rotation (son
 * historique reste consultable) ; s'il n'a jamais couru, il est supprimé.
 * Les tours à venir sont réattribués à l'équipe restante.
 */
export function applyRemoveRunner(state: RaceState, runnerId: string): RaceState {
  const order = state.config.runnerOrder;
  if (!order.includes(runnerId) || order.length <= 1) return state;
  const own = sortedLaps(state).filter((l) => l.runnerId === runnerId);
  if (own.some((l) => l.status === 'running')) return state; // en course : interdit
  const hasRun = own.some((l) => l.status === 'done');

  const newOrder = order.filter((id) => id !== runnerId);
  const runners = { ...state.runners };
  if (!hasRun) delete runners[runnerId]; // jamais couru : on l'efface

  // Les tours à venir qui lui étaient attribués sont d'abord neutralisés,
  // puis tout est réattribué selon la rotation restante.
  const laps = { ...state.laps };
  for (const lap of own) if (lap.status === 'pending') laps[lap.id] = { ...lap, runnerId: newOrder[0] };

  return recalcSchedule(
    { ...state, runners, config: { ...state.config, runnerOrder: newOrder }, laps: reassignPending(laps, newOrder) },
    Date.now(),
  );
}

/**
 * Termine officiellement la course (bouton DONE) : plus aucun nouveau départ.
 * Les tours à venir non démarrés sont supprimés ; le tour en cours peut être
 * terminé normalement (le dernier coureur finit sa boucle au-delà des 24h).
 */
export function applyFinishRace(state: RaceState, nowIso: string): RaceState {
  const laps: Record<string, Lap> = {};
  for (const lap of Object.values(state.laps ?? {})) {
    if (lap.status !== 'pending') laps[lap.id] = lap;
  }
  return recalcSchedule({
    ...state,
    config: { ...state.config, finished: true, finishedAt: nowIso },
    laps,
  });
}

/** Annule la fin officielle et régénère le planning à venir. */
export function applyResumeRace(state: RaceState): RaceState {
  return recalcSchedule(
    { ...state, config: { ...state.config, finished: false, finishedAt: null } },
    Date.now(),
  );
}

/** Retire le tout dernier tour de la timeline (course terminée uniquement). */
export function applyRemoveLastLap(state: RaceState): RaceState {
  if (!state.config.finished) return state;
  const all = sortedLaps(state);
  if (all.length <= 1) return state;
  const last = all[all.length - 1];
  const laps = { ...state.laps };
  delete laps[last.id];
  return recalcSchedule({ ...state, laps });
}

/**
 * Change le coureur d'un tour.
 * - insert=false : il remplace simplement le coureur prévu sur ce tour
 *   (fonctionne aussi pour corriger un tour en cours ou terminé) ;
 * - insert=true (tour à venir uniquement) : il s'insère, et les coureurs des
 *   tours suivants glissent tous d'un cran — personne ne saute son tour.
 *   C'est ainsi qu'un coureur peut enchaîner plusieurs tours.
 */
export function applyLapRunner(
  state: RaceState,
  lapNumber: number,
  runnerId: string,
  insert: boolean,
): RaceState {
  if (!state.runners[runnerId]) return state;
  const target = state.laps[lapKey(lapNumber)];
  if (!target) return state;

  const laps = { ...state.laps };
  if (insert && target.status === 'pending') {
    let carry = runnerId;
    for (const lap of sortedLaps(state)) {
      if (lap.status !== 'pending' || lap.lapNumber < lapNumber) continue;
      const previous = lap.runnerId;
      laps[lap.id] = { ...lap, runnerId: carry };
      carry = previous;
    }
  } else {
    laps[target.id] = { ...target, runnerId };
  }
  return recalcSchedule({ ...state, laps }, Date.now());
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
