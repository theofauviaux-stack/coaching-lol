// Tests des fiches de séance remplies par les joueurs, dans un vrai PostgreSQL (PGlite)
const assert = require('assert');
const fs = require('fs');
const path = require('path');

(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
                 grant usage on schema public to anon, authenticated, service_role;`);
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'schema.sql'), 'utf8');
  await db.exec(sql);
  await db.exec(sql); // relançable
  const one = async (q, params) => (await db.query(q, params)).rows[0];
  const KEY = 'k'.repeat(64);
  await db.query(`insert into push_keys (hash) values (encode(sha256($1::text::bytea), 'hex'))`, [KEY]);
  const snapshot = {
    coachCode: '9999',
    players: [{ id: 'p1', riotId: 'A#EUW', code: '1234' }, { id: 'p2', riotId: 'B#EUW', code: '5678' }],
    games: [], ranks: [],
    sessions: [{ id: 's1', playerId: 'p1', exercises: [{ id: 'cs10-perso', target: 110 }] }, { id: 's2', playerId: 'p2' }]
  };
  const push = async () => (await one(`select coach_push($1, $2) as r`, [KEY, JSON.stringify(snapshot)])).r;
  await push();
  const t1 = (await one(`select login('1234') as r`)).r.token;
  const t2 = (await one(`select login('5678') as r`)).r.token;
  const tc = (await one(`select login('9999') as r`)).r.token;
  const save = async (tok, sid, data) => (await one(`select report_save($1, $2, $3) as r`, [tok, sid, JSON.stringify(data)])).r;
  const mine = async tok => (await one(`select reports_mine($1) as r`, [tok])).r;
  const fiche = { ex: { 'cs10-perso': { cs: 104, essais: 3 } }, ressenti: 4, retiens: 'Regarder la vague' };

  // le joueur remplit sa fiche
  const r1 = await save(t1, 's1', fiche);
  assert.ok(r1.ok && r1.updatedAt, 'fiche enregistrée');
  assert.deepStrictEqual((await mine(t1)).reports.map(r => [r.sessionId, r.data.ex['cs10-perso'].cs]), [['s1', 104]]);
  // modification : une seule fiche par séance
  await save(t1, 's1', Object.assign({}, fiche, { ressenti: 5 }));
  const m = (await mine(t1)).reports;
  assert.strictEqual(m.length, 1);
  assert.strictEqual(m[0].data.ressenti, 5);

  // un joueur ne peut ni écrire ni lire la fiche d'un autre
  assert.strictEqual((await save(t2, 's1', fiche)).error, 'seance_inconnue', 'séance d\'un autre joueur');
  assert.strictEqual((await mine(t2)).reports.length, 0);
  assert.strictEqual((await save(t1, 's-inconnue', fiche)).error, 'seance_inconnue');
  // code coach (lecture seule hors de son ordinateur) et jeton faux : refusés
  assert.strictEqual((await save(tc, 's1', fiche)).error, 'session_expiree', 'le jeton coach n\'est pas un jeton joueur');
  assert.strictEqual((await save('faux', 's1', fiche)).error, 'session_expiree');
  assert.strictEqual((await mine('faux')).error, 'session_expiree');
  // contenu invalide ou trop long
  assert.strictEqual((await one(`select report_save($1, 's1', '[1,2]'::jsonb) as r`, [t1])).r.error, 'fiche_invalide');
  assert.strictEqual((await save(t1, 's1', { texte: 'x'.repeat(21000) })).error, 'fiche_invalide');

  // l'app du coach relit toutes les fiches
  const all = (await one(`select coach_reports($1) as r`, [KEY])).r.reports;
  assert.deepStrictEqual(all.map(r => [r.playerId, r.sessionId, r.data.ressenti]), [['p1', 's1', 5]]);
  assert.strictEqual((await one(`select coach_reports('faux') as r`)).r.error, 'jeton_inconnu');
  // fiche remplie par un joueur connecté sur l'ordinateur du coach
  assert.ok((await one(`select coach_report_save($1, 'p2', 's2', $2) as r`, [KEY, JSON.stringify(fiche)])).r.ok);
  assert.strictEqual((await one(`select coach_report_save($1, 'p2', 's1', $2) as r`, [KEY, JSON.stringify(fiche)])).r.error, 'seance_inconnue');
  assert.strictEqual((await one(`select coach_report_save('faux', 'p2', 's2', $1) as r`, [JSON.stringify(fiche)])).r.error, 'jeton_inconnu');

  // les fiches survivent à un nouvel envoi des données du coach
  await push();
  assert.strictEqual((await mine(t1)).reports.length, 1, 'fiche gardée après un envoi');
  // joueur supprimé par le coach : ses fiches partent avec lui
  snapshot.players = snapshot.players.filter(p => p.id !== 'p2');
  snapshot.sessions = snapshot.sessions.filter(s => s.playerId !== 'p2');
  await push();
  assert.strictEqual((await one(`select count(*)::int as n from reports where player_id = 'p2'`)).n, 0);

  // droits : fonctions internes et table fermées au public
  const anonCan = async fn => (await one(`select has_function_privilege('anon', $1, 'execute') as ok`, [fn])).ok;
  assert.strictEqual(await anonCan('public._report_save(text, text, jsonb)'), false);
  for (const fn of ['public.report_save(text, text, jsonb)', 'public.reports_mine(text)', 'public.coach_reports(text)', 'public.coach_report_save(text, text, text, jsonb)']) assert.strictEqual(await anonCan(fn), true, fn);
  assert.strictEqual((await one(`select has_table_privilege('anon', 'public.reports', 'select') as ok`)).ok, false);

  console.log('✅ Fiches de séance (base) : tests OK');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
