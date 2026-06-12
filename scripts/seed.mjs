/**
 * Initialise la course dans Firebase Realtime Database.
 *
 * Usage :  npm run seed            → crée la course avec le code 2424
 *          npm run seed -- 7351    → crée la course avec le code 7351
 *
 * Lit la configuration Firebase dans .env (variables VITE_FIREBASE_*),
 * chargé automatiquement par `node --env-file=.env` (cf. script npm).
 * ⚠️  Écrase la course existante sous ce code.
 */
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, set, goOffline } from 'firebase/database';

const PIN = (process.argv[2] ?? '2424').trim();
if (!/^\d{4}$/.test(PIN)) {
  console.error('Le code de course doit comporter exactement 4 chiffres.');
  process.exit(1);
}

// ---------------- Données de la course ----------------

// Samedi 14 juin 2026 12:30 → dimanche 15 juin 2026 12:00, heure de Paris (UTC+2 en été)
const START = '2026-06-14T10:30:00.000Z';
const END = '2026-06-15T10:00:00.000Z';
const LOOP_KM = 7;
const TRANSITION_SEC = 20;

const pace = (min, sec) => min * 60 + sec;

const RUNNERS = [
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

// ---------------- Génération du planning initial ----------------
// Même logique que recalcSchedule côté app, sans temps réels :
// chaque tour démarre à la fin du précédent + 20 s de transition,
// tant que le départ prévu est avant la fin de course.

const lapKey = (n) => `lap${String(n).padStart(3, '0')}`;
const laps = {};
let cursorMs = Date.parse(START);
const endMs = Date.parse(END);
const perRunnerCount = {};

for (let n = 1; cursorMs < endMs && n <= 500; n++) {
  const runner = RUNNERS[(n - 1) % RUNNERS.length];
  perRunnerCount[runner.id] = (perRunnerCount[runner.id] ?? 0) + 1;
  const durMs = Math.round(runner.pace * LOOP_KM) * 1000;
  laps[lapKey(n)] = {
    id: lapKey(n),
    runnerId: runner.id,
    lapNumber: n,
    runnerLapNumber: perRunnerCount[runner.id],
    status: 'pending',
    predictedStart_ts: new Date(cursorMs).toISOString(),
    predictedEnd_ts: new Date(cursorMs + durMs).toISOString(),
    actualStart_ts: null,
    actualEnd_ts: null,
    actualDuration_sec: null,
  };
  cursorMs += durMs + TRANSITION_SEC * 1000;
}

const race = {
  config: {
    startTime: START,
    endTime: END,
    loopDistance_km: LOOP_KM,
    transitionTime_sec: TRANSITION_SEC,
    runnerOrder: RUNNERS.map((r) => r.id),
  },
  runners: Object.fromEntries(
    RUNNERS.map((r) => [
      r.id,
      { id: r.id, name: r.name, basePace_secPerKm: r.pace, currentPace_secPerKm: r.pace },
    ]),
  ),
  laps,
};

// ---------------- Écriture dans Firebase ----------------

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.VITE_FIREBASE_DATABASE_URL,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  appId: process.env.VITE_FIREBASE_APP_ID,
};

if (!firebaseConfig.databaseURL) {
  console.error('Variables VITE_FIREBASE_* manquantes. Copiez .env.example en .env et remplissez-le.');
  process.exit(1);
}

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

try {
  await set(ref(db, `races/${PIN}`), race);
  console.log(`✅ Course créée : code ${PIN}`);
  console.log(`   ${RUNNERS.length} coureurs, ${Object.keys(laps).length} tours planifiés`);
  console.log(`   Départ ${START} → fin ${END} (UTC)`);
  console.log(`   Dernier retour estimé : ${laps[lapKey(Object.keys(laps).length)].predictedEnd_ts}`);
} catch (err) {
  console.error('❌ Écriture impossible :', err.message);
  process.exit(1);
} finally {
  goOffline(db);
}
