// Test de bout en bout des cours : faux serveur Supabase + app du coach + app d'un joueur (lancées en même temps).
// Le coach assigne un cours et ajoute l'objectif conseillé ; le joueur le suit, réussit le quiz ; le coach voit
// le cours validé. Usage : node tests/e2e-cours.js <dossier de données de départ (coaching-data.json)>
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { startFake } = require('./fake-supabase');

const DIR = '/tmp/e2e-cours';
const wait = ms => new Promise(r => setTimeout(r, ms));
const waitFile = async (name, ms = 120000) => { const t = Date.now(); while (!fs.existsSync(path.join(DIR, name))) { if (Date.now() - t > ms) throw new Error('attente ' + name); await wait(200); } };

function launch(phase, dataDir, url) {
  return new Promise(resolve => {
    const p = spawn('xvfb-run', ['-a', '-s', '-screen 0 1440x900x24', path.join(__dirname, '..', 'node_modules/.bin/electron'), path.join(__dirname, '..'), '--no-sandbox'], {
      env: Object.assign({}, process.env, { PHASE: phase, SYNC_DIR: DIR, COACHING_LOL_DATA: dataDir, COACHING_LOL_FAST: '1', COACHING_LOL_TEST: path.join(__dirname, 'ui-cours.js'), COACHING_LOL_CLOUD: JSON.stringify({ url, publicKey: 'cle-publique-test' }) }),
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
  d.players[0].goals = [];
  delete d.players[0].courses;
  d.sessions = [];
  d.reports = [];
  for (const k of ['coachCodeEnc', 'pushTokenEnc', 'apiKey', 'apiKeyEnc', 'lastPush', 'pushError']) delete d.settings[k];
  d.settings.coachCode = '4821';
  d.settings.pushToken = TOKEN;
  fs.writeFileSync(path.join(DIR, 'coach', 'coaching-data.json'), JSON.stringify(d));
  await fake.db.query(`insert into push_keys (hash) values ($1)`, [crypto.createHash('sha256').update(TOKEN).digest('hex')]);

  const coachDone = launch('coach', path.join(DIR, 'coach'), fake.url);
  await waitFile('cours-assigne');
  // le cours assigné doit être arrivé sur le serveur avec les données du coach
  const t0 = Date.now();
  while (!(await fake.db.query(`select 1 from players where data->'courses'->'vagues'->>'assigned' is not null`)).rows.length) {
    if (Date.now() - t0 > 60000) throw new Error('cours assigné jamais envoyé au serveur');
    await wait(500);
  }
  await launch('joueur', path.join(DIR, 'joueur'), fake.url);
  await coachDone;
  const rc = JSON.parse(fs.readFileSync(path.join(DIR, 'resultat-coach.json'), 'utf8'));
  const rj = JSON.parse(fs.readFileSync(path.join(DIR, 'resultat-joueur.json'), 'utf8'));
  assert.ok(!rc.exception, rc.exception);
  assert.ok(!rj.exception, rj.exception);
  // côté coach : cours assigné, objectif conseillé ajouté
  assert.strictEqual(rc.cartes, 8, '8 cours dans la liste');
  assert.ok(rc.assigne, 'cours assigné');
  assert.deepStrictEqual(rc.objectif, { kpi: 'Écart or à 10 min', target: 0, source: 'coach' });
  // côté joueur : badge, annonce, progression enregistrée sur le serveur
  assert.strictEqual(rj.badge, '1', 'badge du menu « Cours »');
  assert.ok(/Ton coach t'a demandé ce cours/.test(rj.annonce), rj.annonce);
  assert.strictEqual(rj.score, '6/6');
  assert.strictEqual(rj.badgeApres, null, 'plus de badge une fois le cours validé');
  const row = (await fake.db.query(`select data from course_progress where course_id = 'vagues'`)).rows[0];
  assert.ok(row, 'progression sur le serveur');
  assert.strictEqual(row.data.quiz.best, 1);
  assert.deepStrictEqual(row.data.seen.slice().sort(), ['bounce', 'choisir', 'freeze', 'lire', 'pratique', 'push', 'quiz']);
  assert.ok(!('assigned' in row.data), 'le joueur n\'écrit pas la partie du coach');
  assert.ok(rj.coche, 'réponse gardée (case cochée) dans un autre cours');
  // retour chez le coach : cours validé + notification
  assert.ok(/Cours validé/.test(rc.notification), 'le coach est prévenu : ' + rc.notification);
  assert.ok(/Validé/.test(rc.carteVagues), rc.carteVagues);
  fake.close();
  console.log(JSON.stringify({ coach: rc, joueur: rj }, null, 1));
  console.log('✅ Cours de bout en bout (coach + joueur) : OK');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
