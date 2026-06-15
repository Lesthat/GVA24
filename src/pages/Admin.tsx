import { useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Download,
  FileJson,
  FileSpreadsheet,
  Flag,
  History,
  RotateCcw,
  Trash2,
  Upload,
  UserPlus,
} from 'lucide-react';
import { useRaceStore } from '../store/raceStore';
import { sortedLaps } from '../lib/race';
import { fmtDayTime, isoToParisLocalInput, parisLocalInputToIso, strToPace } from '../lib/time';
import { buildFullJson, buildTimelineCsv, downloadFile, exportStamp } from '../lib/export';

export default function Admin() {
  const race = useRaceStore((s) => s.race)!;
  const pin = useRaceStore((s) => s.pin);
  const resetRace = useRaceStore((s) => s.resetRace);
  const restoreBackup = useRaceStore((s) => s.restoreBackup);
  const setOrder = useRaceStore((s) => s.setOrder);
  const removeRunner = useRaceStore((s) => s.removeRunner);
  const finishRace = useRaceStore((s) => s.finishRace);
  const resumeRace = useRaceStore((s) => s.resumeRace);
  const removeLastLap = useRaceStore((s) => s.removeLastLap);
  const importBackup = useRaceStore((s) => s.importBackup);
  const fileRef = useRef<HTMLInputElement>(null);

  const finished = race.config.finished === true;

  function pickImport() {
    fileRef.current?.click();
  }

  async function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // permet de réimporter le même fichier ensuite
    if (!file) return;
    let data: unknown;
    try {
      data = JSON.parse(await file.text());
    } catch {
      window.alert('Fichier illisible : ce n’est pas un JSON valide.');
      return;
    }
    if (
      window.confirm(
        `Importer cette sauvegarde dans la course ${pin} ? L'état actuel sera entièrement remplacé (pensez à l'exporter d'abord si besoin).`,
      )
    )
      importBackup(data);
  }

  function move(index: number, delta: -1 | 1) {
    const order = [...race.config.runnerOrder];
    const j = index + delta;
    if (j < 0 || j >= order.length) return;
    [order[index], order[j]] = [order[j], order[index]];
    setOrder(order);
  }

  function removeMember(id: string) {
    const name = race.runners[id]?.name ?? id;
    const isRunning = sortedLaps(race).some((l) => l.runnerId === id && l.status === 'running');
    if (isRunning) {
      window.alert(`${name} est en course : impossible de le retirer maintenant.`);
      return;
    }
    const hasRun = sortedLaps(race).some((l) => l.runnerId === id && l.status === 'done');
    const msg = hasRun
      ? `Retirer ${name} de la rotation ? Ses tours déjà courus restent dans l'historique, mais il ne prendra plus de tour.`
      : `Retirer ${name} de l'équipe ?`;
    if (window.confirm(msg)) removeRunner(id);
  }

  const lastLap = sortedLaps(race).at(-1);
  const base = `gva24-${pin ?? 'course'}-${exportStamp()}`;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">Administration</h1>

      {/* Export — placé en tête : sauvegarde de la course passée. */}
      <section className="rounded-2xl border border-emerald-500/40 bg-slate-900 p-4">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase text-emerald-400">
          <Download className="h-4 w-4" /> Exporter / sauvegarder
        </div>
        <div className="mt-3 flex flex-col gap-2">
          <button
            onClick={() =>
              downloadFile(`${base}.csv`, buildTimelineCsv(race), 'text/csv')
            }
            className="flex items-center justify-center gap-2 rounded-xl bg-emerald-500 py-3 font-bold text-slate-950"
          >
            <FileSpreadsheet className="h-5 w-5" /> Timeline CSV (Excel)
          </button>
          <button
            onClick={() =>
              downloadFile(`${base}.json`, buildFullJson(race), 'application/json')
            }
            className="flex items-center justify-center gap-2 rounded-xl border border-slate-600 py-3 font-semibold text-slate-200"
          >
            <FileJson className="h-5 w-5" /> Sauvegarde complète JSON
          </button>
          <button
            onClick={pickImport}
            className="flex items-center justify-center gap-2 rounded-xl border border-slate-600 py-3 font-semibold text-slate-200"
          >
            <Upload className="h-5 w-5" /> Importer une sauvegarde JSON
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={onImportFile}
          />
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Le CSV contient tous les tours (heures prévues et réelles, durées, allures, écarts, km et
          D+ cumulés) pour Excel ou Google Sheets. Le JSON est une copie fidèle et complète de la
          course — à conserver précieusement. L'import remplace la course actuelle (code {pin}) par
          le contenu d'une sauvegarde JSON.
        </p>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
        <RaceTimesForm
          key={race.config.startTime + race.config.endTime}
          startIso={race.config.startTime}
          endIso={race.config.endTime}
        />
        <p className="mt-3 text-xs text-slate-500">
          Avant le départ, ces horaires servent au compte à rebours. Le départ réel du premier
          coureur les recale automatiquement (la durée de course est conservée). Ils restent
          modifiables ici à tout moment — le planning est recalculé.
        </p>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
        <LoopForm
          key={`${race.config.loopDistance_km}-${race.config.elevationGain_m ?? 0}`}
          distKm={race.config.loopDistance_km}
          elevM={race.config.elevationGain_m ?? 0}
        />
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
        <div className="text-xs font-semibold uppercase text-slate-400">Équipe & rotation</div>
        <ul className="mt-2 flex flex-col gap-1">
          {race.config.runnerOrder.map((id, i) => (
            <li
              key={id}
              className="flex items-center justify-between gap-2 rounded-lg bg-slate-950 px-3 py-2"
            >
              <span className="min-w-0 truncate font-semibold">
                <span className="mr-2 text-slate-500">{i + 1}.</span>
                {race.runners[id]?.name ?? id}
              </span>
              <span className="flex shrink-0 gap-1">
                <button
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  aria-label="monter"
                  className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-800 disabled:opacity-30"
                >
                  <ChevronUp className="h-5 w-5" />
                </button>
                <button
                  onClick={() => move(i, 1)}
                  disabled={i === race.config.runnerOrder.length - 1}
                  aria-label="descendre"
                  className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-800 disabled:opacity-30"
                >
                  <ChevronDown className="h-5 w-5" />
                </button>
                <button
                  onClick={() => removeMember(id)}
                  disabled={race.config.runnerOrder.length <= 1}
                  aria-label="retirer"
                  className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-800 text-red-400 disabled:opacity-30"
                >
                  <Trash2 className="h-5 w-5" />
                </button>
              </span>
            </li>
          ))}
        </ul>
        <AddRunnerForm />
        <p className="mt-3 text-xs text-slate-500">
          Ajouter, retirer ou réordonner un membre réattribue les tours à venir, en continuant après
          le coureur en piste. Les tours déjà courus ne changent pas.
        </p>
      </section>

      {/* Fin officielle de la course */}
      <section className="flex flex-col gap-2 rounded-2xl border border-red-500/40 bg-slate-900 p-4">
        <div className="text-xs font-semibold uppercase text-slate-400">Fin de course</div>
        {!finished ? (
          <>
            <button
              onClick={() => {
                if (
                  window.confirm(
                    'Terminer officiellement RUN24 ? Plus aucun nouveau coureur ne pourra partir. Le coureur en piste pourra finir sa boucle. (Réversible ici.)',
                  )
                )
                  finishRace();
              }}
              className="flex items-center justify-center gap-2 rounded-xl bg-red-600 py-3 text-lg font-bold text-white"
            >
              <Flag className="h-5 w-5" /> DONE — Terminer RUN24
            </button>
            <p className="text-xs text-slate-500">
              À cliquer une fois les 24 h écoulées : le dernier coureur parti finit sa boucle, mais
              aucun nouveau départ n'est généré.
            </p>
          </>
        ) : (
          <>
            <div className="rounded-xl bg-red-600/20 px-3 py-2 text-center font-semibold text-red-300">
              🏁 Course terminée
              {race.config.finishedAt ? ` — ${fmtDayTime(race.config.finishedAt)}` : ''}
            </div>
            {lastLap && (
              <button
                onClick={() => {
                  if (
                    window.confirm(
                      `Retirer le dernier tour de la timeline (#${lastLap.lapNumber} · ${
                        race.runners[lastLap.runnerId]?.name ?? ''
                      }) ?`,
                    )
                  )
                    removeLastLap();
                }}
                className="flex items-center justify-center gap-2 rounded-xl border border-red-500/50 py-3 font-semibold text-red-400"
              >
                <Trash2 className="h-5 w-5" /> Retirer le dernier tour (#{lastLap.lapNumber})
              </button>
            )}
            <button
              onClick={() => {
                if (window.confirm('Reprendre la course ? Le planning à venir sera régénéré.'))
                  resumeRace();
              }}
              className="flex items-center justify-center gap-2 rounded-xl border border-slate-600 py-3 font-semibold text-slate-200"
            >
              <RotateCcw className="h-5 w-5" /> Reprendre la course
            </button>
          </>
        )}
      </section>

      <section className="flex flex-col gap-2 rounded-2xl border border-slate-800 bg-slate-900 p-4">
        <div className="text-xs font-semibold uppercase text-slate-400">Session</div>
        <button
          onClick={() => {
            if (
              window.confirm(
                'Réinitialiser la course ? Tous les temps réels seront effacés et le planning régénéré. La session actuelle sera sauvegardée et restaurable.',
              )
            )
              resetRace();
          }}
          className="flex items-center justify-center gap-2 rounded-xl border border-red-500/50 py-3 font-semibold text-red-400"
        >
          <RotateCcw className="h-5 w-5" /> Réinitialiser la course
        </button>
        {race.backup ? (
          <button
            onClick={() => {
              if (
                window.confirm(
                  `Restaurer la session sauvegardée le ${fmtDayTime(race.backup!.savedAt)} ? L'état actuel sera remplacé.`,
                )
              )
                restoreBackup();
            }}
            className="flex items-center justify-center gap-2 rounded-xl border border-slate-600 py-3 font-semibold text-slate-200"
          >
            <History className="h-5 w-5" /> Restaurer la session du {fmtDayTime(race.backup.savedAt)}
          </button>
        ) : (
          <p className="text-center text-xs text-slate-500">
            Aucune session sauvegardée (le reset crée une sauvegarde).
          </p>
        )}
      </section>
    </div>
  );
}

/** Ajout d'un membre à l'équipe : nom + allure de base (M:SS /km). */
function AddRunnerForm() {
  const addRunner = useRaceStore((s) => s.addRunner);
  const [name, setName] = useState('');
  const [pace, setPace] = useState('');
  const [error, setError] = useState<string | null>(null);

  function add() {
    const p = strToPace(pace);
    if (!name.trim() || !p) {
      setError('Renseignez un nom et une allure au format M:SS (ex. 5:30).');
      return;
    }
    addRunner(name.trim(), p);
    setName('');
    setPace('');
    setError(null);
  }

  return (
    <div className="mt-3 border-t border-slate-800 pt-3">
      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          placeholder="Nom"
          className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-base text-slate-100 outline-none focus:border-emerald-400"
        />
        <input
          value={pace}
          onChange={(e) => {
            setPace(e.target.value);
            setError(null);
          }}
          inputMode="numeric"
          placeholder="5:30"
          className="w-20 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-base text-slate-100 tnum outline-none focus:border-emerald-400"
        />
        <button
          onClick={add}
          aria-label="ajouter le coureur"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-emerald-500 text-slate-950"
        >
          <UserPlus className="h-5 w-5" />
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  );
}

/** Caractéristiques de la boucle : distance (km) et dénivelé positif (m). */
function LoopForm({ distKm, elevM }: { distKm: number; elevM: number }) {
  const setLoop = useRaceStore((s) => s.setLoop);
  const [dist, setDist] = useState(String(distKm).replace('.', ','));
  const [elev, setElev] = useState(String(elevM));
  const [error, setError] = useState<string | null>(null);

  const dirty = dist !== String(distKm).replace('.', ',') || elev !== String(elevM);

  function save() {
    const d = Number.parseFloat(dist.replace(',', '.'));
    const e = Number.parseInt(elev, 10);
    if (!Number.isFinite(d) || d <= 0 || d > 100 || !Number.isFinite(e) || e < 0) {
      setError('Valeurs invalides (ex. distance 7,02 — D+ 46).');
      return;
    }
    setError(null);
    setLoop(d, e);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs font-semibold uppercase text-slate-400">Boucle</div>
      <div className="flex gap-2">
        <label className="flex flex-1 flex-col gap-1 text-xs text-slate-400">
          Distance (km)
          <input
            inputMode="decimal"
            value={dist}
            onChange={(e) => {
              setDist(e.target.value);
              setError(null);
            }}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-base text-slate-100 tnum outline-none focus:border-emerald-400"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1 text-xs text-slate-400">
          D+ (m)
          <input
            inputMode="numeric"
            value={elev}
            onChange={(e) => {
              setElev(e.target.value);
              setError(null);
            }}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-base text-slate-100 tnum outline-none focus:border-emerald-400"
          />
        </label>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {dirty && (
        <button onClick={save} className="rounded-xl bg-emerald-500 py-2.5 font-bold text-slate-950">
          Enregistrer et recalculer le planning
        </button>
      )}
    </div>
  );
}

/** Modification du départ / de la fin de la course (heure de Paris). */
function RaceTimesForm({ startIso, endIso }: { startIso: string; endIso: string }) {
  const setRaceTimes = useRaceStore((s) => s.setRaceTimes);
  const [start, setStart] = useState(() => isoToParisLocalInput(startIso));
  const [end, setEnd] = useState(() => isoToParisLocalInput(endIso));
  const [error, setError] = useState<string | null>(null);

  const dirty = start !== isoToParisLocalInput(startIso) || end !== isoToParisLocalInput(endIso);

  function save() {
    const s = parisLocalInputToIso(start);
    const e = parisLocalInputToIso(end);
    if (!s || !e || Date.parse(e) <= Date.parse(s)) {
      setError('Dates invalides : la fin doit être après le départ.');
      return;
    }
    setError(null);
    setRaceTimes(s, e);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs font-semibold uppercase text-slate-400">Horaires de la course</div>
      <label className="flex flex-col gap-1 text-xs text-slate-400">
        Départ (heure de Paris)
        <input
          type="datetime-local"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-base text-slate-100 tnum outline-none focus:border-emerald-400"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-400">
        Fin (heure de Paris)
        <input
          type="datetime-local"
          value={end}
          onChange={(e) => setEnd(e.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-base text-slate-100 tnum outline-none focus:border-emerald-400"
        />
      </label>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {dirty && (
        <button onClick={save} className="rounded-xl bg-emerald-500 py-2.5 font-bold text-slate-950">
          Enregistrer et recalculer le planning
        </button>
      )}
    </div>
  );
}
