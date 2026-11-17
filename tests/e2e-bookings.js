// Test de bout en bout des réservations : faux serveur Supabase + app du coach + app d'un joueur.
// Usage : node tests/e2e-bookings.js <dossier de données de départ (coaching-data.json)>  (nécessite xvfb-run)
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { startFake } = require('./fake-supabase');
const { CloudClient } = require('../src/cloud');

const DIR = '/tmp/e2e';
const wait = ms => new Promise(r => setTimeout(r, ms));
const waitFile = async (name, ms = 90000) => { const t = Date.now(); while (!fs.existsSync(path.join(DIR, name))) { if (Date.now() - t > ms) throw new Error('attente ' + name); await wait(200); } };
const mark = name => fs.writeFileSync(path.join(DIR, name), '1');

function launch(phase, dataDir, url) {
  return new Promise(resolve => {
    const p = spawn('xvfb-run', ['-a', '-s', '-screen 0 1440x900x24', path.join(__dirname, '..', 'node_modules/.bin/electron'), path.join(__dirname, '..'), '--no-sandbox'], {
      env: Object.assign({}, process.env, { PHASE: phase, SYNC_DIR: DIR, COACHING_LOL_DATA: dataDir, COACHING_LOL_FAST: '1', COACHING_LOL_TEST: path.join(__dirname, 'ui-bookings.js'), COACHING_LOL_CLOUD: JSON.stringify({ url, publicKey: 'cle-publique-test' }) }),
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
  const one = async (q, p) => (await fake.db.query(q, p)).rows[0];
  // ordinateur du coach : code coach 4821, code joueur 7391, jeton d'envoi enregistré sur le « serveur »
  const TOKEN = crypto.randomBytes(32).toString('hex');
  const d = JSON.parse(fs.readFileSync(path.join(process.argv[2], 'coaching-data.json'), 'utf8'));
  d.players = d.players.filter(p => p.riotId === 'secretalmasty#EUW');
  d.players[0].code = '7391';
  for (const k of ['coachCodeEnc', 'pushTokenEnc', 'apiKey', 'apiKeyEnc', 'lastPush', 'pushError']) delete d.settings[k];
  d.settings.coachCode = '4821';
  d.settings.pushToken = TOKEN;
  fs.writeFileSync(path.join(DIR, 'coach', 'coaching-data.json'), JSON.stringify(d));
  await fake.db.query(`insert into push_keys (hash) values ($1)`, [crypto.createHash('sha256').update(TOKEN).digest('hex')]);
  const slot = async (days, h) => (await one(`select ((date_trunc('day', now() at time zone 'Europe/Paris') + make_interval(days => $1::int, hours => $2::int)) at time zone 'Europe/Paris') as t`, [days, h])).t;
  const status = async () => (await fake.db.query(`select status, start_at from bookings order by created_at`)).rows.map(r => r.status);

  const coachDone = launch('coach', path.join(DIR, 'coach'), fake.url);
  await waitFile('pret');
  // le joueur, depuis chez lui, demande deux créneaux demain
  const client = new CloudClient({ url: fake.url, publicKey: 'cle-publique-test' });
  const { token } = await client.login('7391');
  const b1 = await client.book(token, 'demander', null, (await slot(1, 19)).toISOString());
  const b2 = await client.book(token, 'demander', null, (await slot(1, 20)).toISOString());
  mark('demandes');
  await waitFile('decide');
  assert.deepStrictEqual(await status(), ['acceptee', 'proposee'], 'le coach accepte la 1re et propose un autre horaire pour la 2e');
  const prop = await one(`select proposed_start from bookings where id = $1`, [b2.id]);
  assert.strictEqual(new Date(prop.proposed_start).getTime(), (await slot(1, 22)).getTime(), 'horaire proposé : demain 22 h');
  const ok = await client.book(token, 'accepter_proposition', b2.id);
  assert.strictEqual(ok.status, 'acceptee');
  // on avance la 1re séance à « maintenant » pour pouvoir la démarrer
  await fake.db.query(`update bookings set start_at = now() - interval '10 minutes' where id = $1`, [b1.id]);
  mark('pret-demarrer');
  await waitFile('demarre');
  assert.strictEqual((await one(`select status from bookings where id = $1`, [b1.id])).status, 'en_cours');
  // 4 minutes avant la fin
  await fake.db.query(`update bookings set started_at = now() - interval '56 minutes' where status = 'en_cours'`);
  mark('presque-fini');
  await coachDone;
  const rc = JSON.parse(fs.readFileSync(path.join(DIR, 'resultat-coach.json'), 'utf8'));
  assert.ok(!rc.exception, rc.exception);
  assert.strictEqual((await one(`select status from bookings where id = $1`, [b1.id])).status, 'terminee');

  // l'app du joueur, sur son ordinateur : une séance en cours, puis une nouvelle demande
  await fake.db.query(`update bookings set status = 'en_cours', started_at = now(), start_at = now() - interval '2 minutes' where id = $1`, [b2.id]);
  await launch('joueur', path.join(DIR, 'joueur'), fake.url);
  const rj = JSON.parse(fs.readFileSync(path.join(DIR, 'resultat-joueur.json'), 'utf8'));
  assert.ok(!rj.exception, rj.exception);
  assert.strictEqual(rj.enCoaching, 'En coaching');
  assert.strictEqual(rj.joueurVoitTimer, false, 'le joueur ne voit pas le timer');
  const last = await one(`select status, start_at from bookings order by created_at desc limit 1`);
  assert.strictEqual(last.status, 'en_attente');
  assert.strictEqual(new Date(last.start_at).getTime(), rj.slotDemande);
  fake.close();
  console.log(JSON.stringify({ coach: rc, joueur: rj }, null, 1));
  console.log('✅ Réservations de bout en bout (coach + joueur) : OK');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
