import { differenceInSeconds, parseISO } from 'date-fns';

export const PARIS_TZ = 'Europe/Paris';

/** Décalage (ms) entre UTC et Europe/Paris à un instant donné (gère été/hiver). */
export function parisOffsetMs(date: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: PARIS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(date)) p[part.type] = part.value;
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    p.hour === '24' ? 0 : Number(p.hour),
    Number(p.minute),
    Number(p.second),
  );
  return asUtc - date.getTime();
}

function fmtParis(iso: string, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('fr-FR', { timeZone: PARIS_TZ, ...opts }).format(parseISO(iso));
}

/** "14:32" en heure de Paris. */
export function fmtTimeHM(iso: string): string {
  return fmtParis(iso, { hour: '2-digit', minute: '2-digit' });
}

/** "14:32:05" en heure de Paris. */
export function fmtTimeHMS(iso: string): string {
  return fmtParis(iso, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** "sam. 14:32" — utile car la course passe minuit. */
export function fmtDayTime(iso: string): string {
  return fmtParis(iso, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
}

/** Durée en secondes → "36:45" ou "1h02:45". Gère le signe. */
export function fmtDuration(totalSec: number): string {
  const sign = totalSec < 0 ? '-' : '';
  const s = Math.abs(Math.round(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${sign}${h}h${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${sign}${m}:${String(sec).padStart(2, '0')}`;
}

/** Écart signé : "+1:23" / "−0:45". */
export function fmtSignedDuration(totalSec: number): string {
  const prefix = totalSec >= 0 ? '+' : '−';
  return prefix + fmtDuration(Math.abs(totalSec));
}

/** Chrono long "12:34:56". */
export function fmtChrono(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/** 315 → "5:15" (min/km). */
export function paceToStr(secPerKm: number): string {
  const s = Math.round(secPerKm);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** "5:15" → 315 secondes/km, ou null si invalide. */
export function strToPace(str: string): number | null {
  const m = str.trim().match(/^(\d{1,2})[:'h](\d{1,2})$/);
  if (!m) return null;
  const min = Number(m[1]);
  const sec = Number(m[2]);
  if (sec >= 60) return null;
  return min * 60 + sec;
}

export function secondsBetween(laterIso: string, earlierIso: string): number {
  return differenceInSeconds(parseISO(laterIso), parseISO(earlierIso));
}

/** ISO UTC → valeur pour <input type="datetime-local"> en heure de Paris. */
export function isoToParisLocalInput(iso: string): string {
  const d = parseISO(iso);
  return new Date(d.getTime() + parisOffsetMs(d)).toISOString().slice(0, 16);
}

/** Valeur de <input type="datetime-local"> (heure de Paris) → ISO UTC. */
export function parisLocalInputToIso(value: string): string | null {
  const naive = Date.parse(`${value}:00.000Z`);
  if (Number.isNaN(naive)) return null;
  // Heure murale interprétée comme UTC puis corrigée du décalage Paris
  // (deux passes pour rester exact autour d'un changement d'heure).
  let utc = naive - parisOffsetMs(new Date(naive));
  utc = naive - parisOffsetMs(new Date(utc));
  return new Date(utc).toISOString();
}

/**
 * Convertit une heure murale Paris ("14:32" ou "14:32:10") en ISO UTC.
 * La course chevauche deux jours : on choisit la date (J−1, J, J+1 autour de
 * `refIso`) qui donne l'instant le plus proche de la référence.
 */
export function parisWallToUtcIso(wall: string, refIso: string): string | null {
  const m = wall.trim().match(/^(\d{1,2})[:h](\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  const s = Number(m[3] ?? 0);
  if (h > 23 || mi > 59 || s > 59) return null;

  const refMs = Date.parse(refIso);
  const dayMs = 24 * 3600 * 1000;
  let best: number | null = null;

  for (const shift of [-1, 0, 1]) {
    const dayRef = new Date(refMs + shift * dayMs);
    const p: Record<string, string> = {};
    for (const part of new Intl.DateTimeFormat('en-US', {
      timeZone: PARIS_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(dayRef))
      p[part.type] = part.value;
    // Heure murale interprétée comme UTC, puis corrigée du décalage Paris
    // (deux passes pour être exact même autour d'un changement d'heure).
    const naive = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), h, mi, s);
    let candidate = naive - parisOffsetMs(new Date(naive));
    candidate = naive - parisOffsetMs(new Date(candidate));
    if (best === null || Math.abs(candidate - refMs) < Math.abs(best - refMs)) {
      best = candidate;
    }
  }
  return best === null ? null : new Date(best).toISOString();
}
