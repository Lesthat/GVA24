import { create } from 'zustand';
import { get as dbGet, onValue, ref, runTransaction, type Unsubscribe } from 'firebase/database';
import { db } from '../lib/firebase';
import { applyBasePace, applyEdit, applyFinish, applyStart } from '../lib/race';
import type { RaceState } from '../lib/types';

const PIN_STORAGE_KEY = 'gva24_pin';

interface RaceStore {
  pin: string | null;
  race: RaceState | null;
  connected: boolean;
  joining: boolean;
  error: string | null;
  join: (pin: string) => Promise<string | null>;
  leave: () => void;
  startLap: (lapNumber: number, tsIso?: string) => Promise<void>;
  finishLap: (lapNumber: number, tsIso?: string) => Promise<void>;
  editLap: (lapNumber: number, patch: { startIso?: string | null; endIso?: string | null }) => Promise<void>;
  setBasePace: (runnerId: string, paceSecPerKm: number) => Promise<void>;
  clearError: () => void;
}

let unsubRace: Unsubscribe | null = null;
let unsubConn: Unsubscribe | null = null;

/** Firebase supprime les clés à valeur null : on restaure les conteneurs. */
function normalize(raw: RaceState): RaceState {
  return { ...raw, laps: raw.laps ?? {}, runners: raw.runners ?? {} };
}

export const useRaceStore = create<RaceStore>((set, get) => {
  /**
   * Toute mutation passe par une transaction Firebase : l'action pure + le
   * recalcul en cascade sont appliqués sur la dernière valeur connue du
   * serveur, puis écrits atomiquement. Deux téléphones qui pointent en même
   * temps ne peuvent pas s'écraser mutuellement.
   */
  async function mutate(fn: (s: RaceState) => RaceState): Promise<void> {
    const pin = get().pin;
    if (!pin) return;
    try {
      const result = await runTransaction(ref(db, `races/${pin}`), (raw: RaceState | null) => {
        if (!raw) return undefined; // cache pas encore chargé → abandon
        return fn(normalize(raw));
      });
      if (!result.committed) {
        set({ error: 'Écriture impossible — vérifiez la connexion et réessayez.' });
      }
    } catch {
      set({ error: 'Erreur réseau — la modification n’a pas été enregistrée.' });
    }
  }

  return {
    pin: null,
    race: null,
    connected: true,
    joining: false,
    error: null,

    async join(pin: string): Promise<string | null> {
      if (!/^\d{4}$/.test(pin)) return 'Le code de course doit comporter 4 chiffres.';
      set({ joining: true });
      try {
        const snap = await dbGet(ref(db, `races/${pin}/config/startTime`));
        if (!snap.exists()) {
          set({ joining: false });
          return 'Aucune course trouvée avec ce code.';
        }
      } catch {
        set({ joining: false });
        return 'Connexion à Firebase impossible. Vérifiez le réseau.';
      }

      localStorage.setItem(PIN_STORAGE_KEY, pin);
      unsubRace?.();
      unsubRace = onValue(ref(db, `races/${pin}`), (snap) => {
        const raw = snap.val() as RaceState | null;
        set({ race: raw ? normalize(raw) : null });
      });
      unsubConn?.();
      unsubConn = onValue(ref(db, '.info/connected'), (snap) => {
        set({ connected: snap.val() === true });
      });
      set({ pin, joining: false });
      return null;
    },

    leave() {
      unsubRace?.();
      unsubConn?.();
      unsubRace = null;
      unsubConn = null;
      localStorage.removeItem(PIN_STORAGE_KEY);
      set({ pin: null, race: null });
    },

    startLap: (lapNumber, tsIso) =>
      mutate((s) => applyStart(s, lapNumber, tsIso ?? new Date().toISOString())),

    finishLap: (lapNumber, tsIso) =>
      mutate((s) => applyFinish(s, lapNumber, tsIso ?? new Date().toISOString())),

    editLap: (lapNumber, patch) => mutate((s) => applyEdit(s, lapNumber, patch)),

    setBasePace: (runnerId, paceSecPerKm) => mutate((s) => applyBasePace(s, runnerId, paceSecPerKm)),

    clearError: () => set({ error: null }),
  };
});

/** Reconnexion automatique avec le code mémorisé sur ce téléphone. */
export function savedPin(): string | null {
  return localStorage.getItem(PIN_STORAGE_KEY);
}
