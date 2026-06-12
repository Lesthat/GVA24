export interface Runner {
  id: string;
  name: string;
  basePace_secPerKm: number;
  currentPace_secPerKm: number;
}

export type LapStatus = 'pending' | 'running' | 'done';

export interface Lap {
  id: string;
  runnerId: string;
  lapNumber: number; // numéro de tour global dans la course (1, 2, 3, …)
  runnerLapNumber: number; // ex: 3 = "3e tour de Gil"
  status: LapStatus;
  predictedStart_ts: string; // ISO 8601 UTC
  predictedEnd_ts: string; // ISO 8601 UTC
  actualStart_ts?: string | null;
  actualEnd_ts?: string | null;
  actualDuration_sec?: number | null;
}

export interface RaceConfig {
  startTime: string; // ISO 8601 UTC
  endTime: string; // ISO 8601 UTC
  loopDistance_km: number;
  transitionTime_sec: number;
  runnerOrder: string[]; // ids des coureurs dans l'ordre de rotation
}

export interface RaceState {
  config: RaceConfig;
  runners: Record<string, Runner>;
  laps: Record<string, Lap>;
}
