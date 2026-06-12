/**
 * Serveur GVA24 — backend local sans dépendance externe.
 *
 * - Persistance : un fichier JSON par course (DATA_DIR/race-<PIN>.json),
 *   écrit de façon atomique (tmp + rename) après chaque mutation.
 * - Temps réel : Server-Sent Events (EventSource côté client, reconnexion
 *   automatique native) — l'état complet est rediffusé à chaque changement.
 * - Concurrence : Node est mono-thread, les mutations sont appliquées en
 *   série sur le dernier état — pas d'écrasement possible entre téléphones.
 * - Sert aussi le build Vite (dist/) avec fallback SPA.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import {
  applyBasePace,
  applyEdit,
  applyFinish,
  applyLapRunner,
  applyOrder,
  applyRaceTimes,
  applyReset,
  applyRestore,
  applyStart,
} from '../src/lib/race';
import { createInitialRace } from '../src/lib/seedData';
import type { RaceState } from '../src/lib/types';

const PORT = Number(process.env.PORT ?? 8787);
const DATA_DIR = process.env.DATA_DIR ?? './data';
const STATIC_DIR = resolve(process.env.STATIC_DIR ?? './dist');
const DEFAULT_PIN = process.env.RACE_PIN ?? '2424';

const races = new Map<string, RaceState>();
const clients = new Map<string, Set<ServerResponse>>();

const dataFile = (pin: string) => join(DATA_DIR, `race-${pin}.json`);

function loadRace(pin: string): RaceState | null {
  const cached = races.get(pin);
  if (cached) return cached;
  const file = dataFile(pin);
  if (!existsSync(file)) return null;
  const state = JSON.parse(readFileSync(file, 'utf8')) as RaceState;
  races.set(pin, state);
  return state;
}

function saveRace(pin: string, state: RaceState): void {
  races.set(pin, state);
  const file = dataFile(pin);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(state));
  renameSync(tmp, file);
}

function broadcast(pin: string, state: RaceState): void {
  const payload = `data: ${JSON.stringify(state)}\n\n`;
  for (const res of clients.get(pin) ?? []) res.write(payload);
}

/* ------------------------------- Actions ------------------------------- */

class BadRequest extends Error {}

function num(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new BadRequest('nombre attendu');
  return v;
}

function isoOrNow(v: unknown): string {
  if (v === undefined || v === null) return new Date().toISOString();
  if (typeof v !== 'string' || Number.isNaN(Date.parse(v))) throw new BadRequest('timestamp ISO invalide');
  return v;
}

function isoOrNull(v: unknown): string | null {
  if (v === null) return null;
  if (typeof v !== 'string' || Number.isNaN(Date.parse(v))) throw new BadRequest('timestamp ISO invalide');
  return v;
}

function applyAction(state: RaceState, body: Record<string, unknown>): RaceState {
  switch (body.type) {
    case 'start':
      return applyStart(state, num(body.lapNumber), isoOrNow(body.tsIso));
    case 'finish':
      return applyFinish(
        state,
        num(body.lapNumber),
        isoOrNow(body.tsIso),
        body.loops === undefined || body.loops === null ? 1 : num(body.loops),
      );
    case 'edit': {
      const raw = (body.patch ?? {}) as Record<string, unknown>;
      const patch: { startIso?: string | null; endIso?: string | null } = {};
      if ('startIso' in raw) patch.startIso = isoOrNull(raw.startIso);
      if ('endIso' in raw) patch.endIso = isoOrNull(raw.endIso);
      return applyEdit(state, num(body.lapNumber), patch);
    }
    case 'basePace':
      return applyBasePace(state, String(body.runnerId), num(body.pace));
    case 'order': {
      const order = body.order;
      if (!Array.isArray(order) || !order.every((id) => typeof id === 'string'))
        throw new BadRequest('order invalide');
      return applyOrder(state, order);
    }
    case 'lapRunner':
      return applyLapRunner(state, num(body.lapNumber), String(body.runnerId), body.insert === true);
    case 'raceTimes': {
      const startIso = body.startIso;
      const endIso = body.endIso;
      if (typeof startIso !== 'string' || Number.isNaN(Date.parse(startIso)))
        throw new BadRequest('startIso invalide');
      if (typeof endIso !== 'string' || Number.isNaN(Date.parse(endIso)))
        throw new BadRequest('endIso invalide');
      return applyRaceTimes(state, startIso, endIso);
    }
    case 'reset':
      return applyReset(state, new Date().toISOString());
    case 'restore':
      return applyRestore(state);
    default:
      throw new BadRequest(`type d'action inconnu : ${String(body.type)}`);
  }
}

/* --------------------------------- HTTP --------------------------------- */

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolveBody, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new BadRequest('corps trop volumineux'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolveBody(body ? JSON.parse(body) : {});
      } catch {
        reject(new BadRequest('JSON invalide'));
      }
    });
    req.on('error', reject);
  });
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.map': 'application/json',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

function serveStatic(pathname: string, res: ServerResponse): void {
  let filePath = resolve(join(STATIC_DIR, normalize(pathname)));
  if (!filePath.startsWith(STATIC_DIR)) {
    res.writeHead(403).end();
    return;
  }
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(STATIC_DIR, 'index.html'); // fallback SPA
  }
  if (!existsSync(filePath)) {
    res.writeHead(404).end('Build manquant : lancez `npm run build`.');
    return;
  }
  res.writeHead(200, {
    'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream',
    // Les assets Vite sont fingerprintés → cache long ; le reste non.
    'Cache-Control': pathname.startsWith('/assets/')
      ? 'public, max-age=31536000, immutable'
      : 'no-cache',
  });
  createReadStream(filePath).pipe(res);
}

function handleEvents(pin: string, req: IncomingMessage, res: ServerResponse): void {
  const state = loadRace(pin);
  if (!state) return json(res, 404, { error: 'course introuvable' });
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // désactive le buffering du reverse proxy nginx
  });
  res.write('retry: 2000\n\n');
  res.write(`data: ${JSON.stringify(state)}\n\n`);
  let set = clients.get(pin);
  if (!set) {
    set = new Set();
    clients.set(pin, set);
  }
  set.add(res);
  req.on('close', () => set.delete(res));
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const match = url.pathname.match(/^\/api\/race\/(\d{4})(?:\/(events|action|seed))?$/);

    if (match) {
      const [, pin, sub] = match;
      if (!sub && req.method === 'GET') {
        const state = loadRace(pin);
        return state ? json(res, 200, state) : json(res, 404, { error: 'course introuvable' });
      }
      if (sub === 'events' && req.method === 'GET') return handleEvents(pin, req, res);
      if (sub === 'action' && req.method === 'POST') {
        const state = loadRace(pin);
        if (!state) return json(res, 404, { error: 'course introuvable' });
        const next = applyAction(state, await readBody(req));
        saveRace(pin, next);
        broadcast(pin, next);
        return json(res, 200, { ok: true });
      }
      if (sub === 'seed' && req.method === 'POST') {
        const state = createInitialRace();
        saveRace(pin, state);
        broadcast(pin, state);
        return json(res, 201, { ok: true, laps: Object.keys(state.laps).length });
      }
      return json(res, 405, { error: 'méthode non autorisée' });
    }

    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(url.pathname, res);
    res.writeHead(405).end();
  } catch (err) {
    if (err instanceof BadRequest) return json(res, 400, { error: err.message });
    console.error(err);
    if (!res.headersSent) json(res, 500, { error: 'erreur serveur' });
  }
});

/* ------------------------------- Démarrage ------------------------------ */

mkdirSync(DATA_DIR, { recursive: true });
if (!existsSync(dataFile(DEFAULT_PIN))) {
  const state = createInitialRace();
  saveRace(DEFAULT_PIN, state);
  console.log(
    `Course initialisée : code ${DEFAULT_PIN}, ${Object.keys(state.laps).length} tours planifiés`,
  );
}

// Heartbeat SSE : garde les connexions ouvertes à travers le reverse proxy.
setInterval(() => {
  for (const set of clients.values()) for (const res of set) res.write(':ka\n\n');
}, 25_000);

server.listen(PORT, () => {
  console.log(`GVA24 prêt sur http://0.0.0.0:${PORT} (données : ${resolve(DATA_DIR)})`);
});
