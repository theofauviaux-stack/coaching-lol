// Test de bout en bout des exercices et fiches de séance : faux serveur Supabase + app du coach + app d'un joueur
// (lancées en même temps). Usage : node tests/e2e-fiches.js <dossier de données de départ (coaching-data.json)>
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { startFake } = require('./fake-supabase');

const DIR = '/tmp/e2e-fiches';
const wait = ms => new Promise(r => setTimeout(r, ms));
const waitFile = async (name, ms = 120000) => { const t = Date.now(); while (!fs.existsSync(path.join(DIR, name))) { if (Date.now() - t > ms) throw new Error('attente ' + name); await wait(200); } };

function launch(phase, dataDir, url) {
  return new Promise(resolve => {
    const p = spawn('xvfb-run', ['-a', '-s', '-screen 0 1440x900x24', path.join(__dirname, '..', 'node_modules/.bin/electron'), path.join(__dirname, '..'), '--no-sandbox'], {
      env: Object.assign({}, process.env, { PHASE: phase, SYNC_DIR: DIR, COACHING_LOL_DATA: dataDir, COACHING_LOL_FAST: '1', COACHING_LOL_TEST: path.join(__dirname, 'ui-fiches.js'), COACHING_LOL_CLOUD: JSON.stringify({ url, publicKey: 'cle-publique-test' }) }),
      stdio: 'ignore'
    });
    p.on('exit', resolve);
  });
}

(async () => {
  fs.rmSync(DIR, { recursive: true, force: true });
  fs.mkdirSync(path.join(DIR, 'coach'), { recursive: true });
  fs.mkdirSync(path.join(DIR, 'joueur'), { recursive: true });
  const fake = await startFake();
  const TOKEN = crypto.randomBytes(32).toString('hex');
  const d = JSON.parse(fs.readFileSync(path.join(process.argv[2], 'coaching-data.json'), 'utf8'));
  d.players = d.players.filter(p => p.riotId === 'secretalmasty#EUW');
  d.players[0].code = '7391';
  d.sessions = [];
  d.reports = [];
  for (const k of ['coachCodeEnc', 'pushTokenEnc', 'apiKey', 'apiKeyEnc', 'lastPush', 'pushError']) delete d.settings[k];
  d.settings.coachCode = '4821';
  d.settings.pushToken = TOKEN;
  fs.writeFileSync(path.join(DIR, 'coach', 'coaching-data.json'), JSON.stringify(d));
  await fake.db.query(`insert into push_keys (hash) values ($1)`, [crypto.createHash('sha256').update(TOKEN).digest('hex')]);

  const coachDone = launch('coach', path.join(DIR, 'coach'), fake.url);
  await waitFile('seance-prete');
  // la séance doit être arrivée sur le serveur (envoi 8 s après l'enregistrement)
  const t0 = Date.now();
  while (!(await fake.db.query(`select 1 from sessions where jsonb_array_length(coalesce(data->'exercises', '[]'::jsonb)) = 3`)).rows.length) {
    if (Date.now() - t0 > 60000) throw new Error('séance jamais envoyée au serveur');
    await wait(500);
  }
  await launch('joueur', path.join(DIR, 'joueur'), fake.url);
  await coachDone;
  const rc = JSON.parse(fs.readFileSync(path.join(DIR, 'resultat-coach.json'), 'utf8'));
  const rj = JSON.parse(fs.readFileSync(path.join(DIR, 'resultat-joueur.json'), 'utf8'));
  assert.ok(!rc.exception, rc.exception);
  assert.ok(!rj.exception, rj.exception);
  assert.ok(rc.banque >= 15, 'banque filtrée sur le rôle Jungle');
  assert.ok(rc.choixRole.includes('jungle-clear') && !rc.choixRole.includes('cs10-perso'), 'exercices adaptés au rôle');
  const ex = JSON.parse(rc.seance);
  assert.deepStrictEqual(ex.map(e => e.id), ['jungle-clear', 'dodging', 'jungler-255']);
  assert.strictEqual(ex[0].target, '3:20');
  assert.strictEqual(ex[1].note, '5 essais avant chaque session de classées');
  assert.strictEqual(rj.rappel, true, 'rappel « fiche à remplir » sur l\'accueil du joueur');
  assert.strictEqual(rj.exercicesVus, 3);
  assert.strictEqual(rj.schemas, 3);
  assert.strictEqual(rj.peutModifier, false);
  const rep = (await fake.db.query(`select data from reports`)).rows[0].data;
  assert.strictEqual(rep.ex['jungle-clear'].temps, '3:12');
  assert.strictEqual(rep.ex['dodging'].score, 48);
  assert.strictEqual(rep.ressenti, 4);
  assert.ok(/Fiche de séance remplie/.test(rc.notification), 'le coach est prévenu : ' + rc.notification);
  assert.ok(/3:12/.test(rc.ficheCoach) && /48/.test(rc.ficheCoach), 'le coach voit la fiche');
  assert.ok(rc.chip.some(c => /Fiche remplie/.test(c)));
  fake.close();
  console.log(JSON.stringify({ coach: rc, joueur: rj }, null, 1));
  console.log('✅ Exercices et fiches de séance de bout en bout (coach + joueur) : OK');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
