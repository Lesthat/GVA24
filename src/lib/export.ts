import { sortedLaps } from './race';
import { fmtDuration, fmtKm, fmtSignedDuration, paceToStr, secondsBetween } from './time';
import type { RaceState } from './types';

const STATUS_LABEL: Record<string, string> = {
  pending: 'à venir',
  running: 'en course',
  done: 'terminé',
};

/** Date+heure de Paris "dim. 15/06 14:32:05" (la course passe minuit). */
function fmtFull(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(iso));
}

/** Échappe une valeur pour un CSV séparé par ";" (compatible Excel FR). */
function csvCell(value: string | number | null | undefined): string {
  const s = value == null ? '' : String(value);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Timeline complète au format CSV (séparateur ";", BOM UTF-8 pour Excel FR).
 * Une ligne par tour, toutes les données saisies + dérivées. Lisible et
 * réimportable dans Excel / Google Sheets.
 */
export function buildTimelineCsv(race: RaceState): string {
  const laps = sortedLaps(race);
  const distKm = race.config.loopDistance_km;
  const elevM = race.config.elevationGain_m ?? 0;

  const header = [
    'Tour #',
    'Coureur',
    'Tour du coureur',
    'Statut',
    'Départ prévu',
    'Arrivée prévue',
    'Durée prévue',
    'Départ réel',
    'Arrivée réelle',
    'Durée réelle',
    'Allure réelle (min/km)',
    'Écart',
    'Distance cumulée (km)',
    'D+ cumulé (m)',
    'Départ prévu (ISO)',
    'Arrivée prévue (ISO)',
    'Départ réel (ISO)',
    'Arrivée réelle (ISO)',
  ];

  let cumulativeDone = 0;
  const rows = laps.map((lap) => {
    const predDur = secondsBetween(lap.predictedEnd_ts, lap.predictedStart_ts);
    const isDone = lap.status === 'done' && lap.actualDuration_sec != null;
    if (isDone) cumulativeDone += 1;
    const delta = isDone ? lap.actualDuration_sec! - predDur : null;
    const pace = isDone ? paceToStr(lap.actualDuration_sec! / distKm) : '';

    return [
      lap.lapNumber,
      race.runners[lap.runnerId]?.name ?? lap.runnerId,
      lap.runnerLapNumber,
      STATUS_LABEL[lap.status] ?? lap.status,
      fmtFull(lap.predictedStart_ts),
      fmtFull(lap.predictedEnd_ts),
      fmtDuration(predDur),
      lap.actualStart_ts ? fmtFull(lap.actualStart_ts) : '',
      lap.actualEnd_ts ? fmtFull(lap.actualEnd_ts) : '',
      lap.actualDuration_sec != null ? fmtDuration(lap.actualDuration_sec) : '',
      pace,
      delta != null ? fmtSignedDuration(delta) : '',
      isDone ? fmtKm(cumulativeDone * distKm) : '',
      isDone ? Math.round(cumulativeDone * elevM) : '',
      lap.predictedStart_ts,
      lap.predictedEnd_ts,
      lap.actualStart_ts ?? '',
      lap.actualEnd_ts ?? '',
    ];
  });

  const lines = [header, ...rows].map((cols) => cols.map(csvCell).join(';'));
  return '﻿' + lines.join('\r\n'); // BOM : accents corrects dans Excel
}

/** Sauvegarde complète et fidèle de l'état (rien n'est perdu). */
export function buildFullJson(race: RaceState): string {
  return JSON.stringify({ exportedAt: new Date().toISOString(), race }, null, 2);
}

/** Déclenche le téléchargement d'un fichier texte dans le navigateur. */
export function downloadFile(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Suffixe horodaté pour les noms de fichiers : "2026-06-15_0721". */
export function exportStamp(): string {
  const p: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat('fr-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date()))
    p[part.type] = part.value;
  return `${p.year}-${p.month}-${p.day}_${p.hour}${p.minute}`;
}
