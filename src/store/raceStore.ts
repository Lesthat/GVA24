import { create } from 'zustand';
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
  finishLap: (lapNumber: number, tsIso?: string, loops?: number) => Promise<void>;
  editLap: (lapNumber: number, patch: { startIso?: string | null; endIso?: string | null }) => Promise<void>;
  setBasePace: (runnerId: string, paceSecPerKm: number) => Promise<void>;
  setOrder: (order: string[]) => Promise<void>;
  setLapRunner: (lapNumber: number, runnerId: string, insert: boolean) => Promise<void>;
  setRaceTimes: (startIso: string, endIso: string) => Promise<void>;
  setLoop: (distKm: number, elevM: number) => Promise<void>;
  resetRace: () => Promise<void>;
  restoreBackup: () => Promise<void>;
  clearError: () => void;
}

let eventSource: EventSource | null = null;

export const useRaceStore = create<RaceStore>((set, get) => {
  /**
   * Toute mutation est envoyée au serveur, qui l'applique en série sur le
   * dernier état (logique pure + recalcul en cascade), persiste dans le
   * fichier JSON et rediffuse l'état à tous les téléphones via SSE.
   */
  async function mutate(body: Record<string, unknown>): Promise<void> {
    const pin = get().pin;
    if (!pin) return;
    try {
      const res = await fetch(`/api/race/${pin}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(String(res.status));
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
      let race: RaceState;
      try {
        const res = await fetch(`/api/race/${pin}`);
        if (res.status === 404) {
          set({ joining: false });
          return 'Aucune course trouvée avec ce code.';
        }
        if (!res.ok) throw new Error(String(res.status));
        race = (await res.json()) as RaceState;
      } catch {
        set({ joining: false });
        return 'Connexion au serveur impossible. Vérifiez le réseau.';
      }

      localStorage.setItem(PIN_STORAGE_KEY, pin);
      eventSource?.close();
      // EventSource se reconnecte tout seul après une coupure réseau.
      eventSource = new EventSource(`/api/race/${pin}/events`);
      eventSource.onmessage = (e) => {
        set({ race: JSON.parse(e.data) as RaceState, connected: true });
      };
      eventSource.onopen = () => set({ connected: true });
      eventSource.onerror = () => set({ connected: false });

      set({ pin, race, joining: false, connected: true });
      return null;
    },

    leave() {
      eventSource?.close();
      eventSource = null;
      localStorage.removeItem(PIN_STORAGE_KEY);
      set({ pin: null, race: null });
    },

    startLap: (lapNumber, tsIso) => mutate({ type: 'start', lapNumber, tsIso: tsIso ?? null }),

    finishLap: (lapNumber, tsIso, loops = 1) =>
      mutate({ type: 'finish', lapNumber, tsIso: tsIso ?? null, loops }),

    editLap: (lapNumber, patch) => mutate({ type: 'edit', lapNumber, patch }),

    setBasePace: (runnerId, paceSecPerKm) =>
      mutate({ type: 'basePace', runnerId, pace: paceSecPerKm }),

    setOrder: (order) => mutate({ type: 'order', order }),

    setLapRunner: (lapNumber, runnerId, insert) =>
      mutate({ type: 'lapRunner', lapNumber, runnerId, insert }),

    setRaceTimes: (startIso, endIso) => mutate({ type: 'raceTimes', startIso, endIso }),

    setLoop: (distKm, elevM) => mutate({ type: 'loop', distKm, elevM }),

    resetRace: () => mutate({ type: 'reset' }),

    restoreBackup: () => mutate({ type: 'restore' }),

    clearError: () => set({ error: null }),
  };
});

/** Reconnexion automatique avec le code mémorisé sur ce téléphone. */
export function savedPin(): string | null {
  return localStorage.getItem(PIN_STORAGE_KEY);
}
