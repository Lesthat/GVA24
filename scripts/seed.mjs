/**
 * (Re)crée la course sur le serveur local — écrase l'existant.
 *
 * Usage :  npm run seed            → course sous le code 2424
 *          npm run seed -- 7351    → course sous le code 7351
 *          SERVER_URL=http://gva24.mondomaine.tld npm run seed
 */
const base = process.env.SERVER_URL ?? 'http://localhost:8787';
const pin = (process.argv[2] ?? '2424').trim();

if (!/^\d{4}$/.test(pin)) {
  console.error('Le code de course doit comporter exactement 4 chiffres.');
  process.exit(1);
}

try {
  const res = await fetch(`${base}/api/race/${pin}/seed`, { method: 'POST' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  console.log(`✅ Course créée : code ${pin} (${body.laps} tours planifiés) sur ${base}`);
} catch (err) {
  console.error(`❌ Échec : ${err.message} — le serveur tourne-t-il sur ${base} ?`);
  process.exit(1);
}
