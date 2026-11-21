// Tests de la progression des joueurs dans les cours, dans un vrai PostgreSQL (PGlite)
const assert = require('assert');
const fs = require('fs');
const path = require('path');

(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
                 grant usage on schema public to anon, authenticated, service_role;`);
  for (const f of ['schema.sql', 'cours.sql']) {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', f), 'utf8');
    await db.exec(sql);
    await db.exec(sql); // relançable
  }
  const one = async (q, params) => (await db.query(q, params)).rows[0];
  const KEY = 'k'.repeat(64);
  await db.query(`insert into push_keys (hash) values (encode(sha256($1::text::bytea), 'hex'))`, [KEY]);
  const snapshot = {
    coachCode: '9999',
    players: [{ id: 'p1', riotId: 'A#EUW', code: '1234', courses: { support: { assigned: 1 } } }, { id: 'p2', riotId: 'B#EUW', code: '5678' }],
    games: [], ranks: [], sessions: []
  };
  const push = async () => (await one(`select coach_push($1, $2) as r`, [KEY, JSON.stringify(snapshot)])).r;
  await push();
  const t1 = (await one(`select login('1234') as r`)).r.token;
  const t2 = (await one(`select login('5678') as r`)).r.token;
  const tc = (await one(`select login('9999') as r`)).r.token;
  const save = async (tok, cid, data) => (await one(`select course_save($1, $2, $3) as r`, [tok, cid, JSON.stringify(data)])).r;
  const mine = async tok => (await one(`select courses_mine($1) as r`, [tok])).r;
  const pr = { seen: ['lire', 'freeze'], quiz: { best: 0.83, last: 0.83, at: 1 }, w: { 'mt-note': 4 } };

  // le joueur enregistre sa progression, puis la met à jour (une ligne par cours)
  const r1 = await save(t1, 'vagues', pr);
  assert.ok(r1.ok && r1.updatedAt, 'progression enregistrée');
  await save(t1, 'vagues', Object.assign({}, pr, { seen: ['lire', 'freeze', 'quiz'] }));
  await save(t1, 'mental', { seen: ['routine'] });
  const m = (await mine(t1)).courses;
  assert.deepStrictEqual(m.map(c => c.courseId).sort(), ['mental', 'vagues']);
  assert.deepStrictEqual(m.find(c => c.courseId === 'vagues').data.seen, ['lire', 'freeze', 'quiz']);

  // chacun ne voit que sa progression ; jetons faux ou du coach refusés
  assert.strictEqual((await mine(t2)).courses.length, 0);
  assert.strictEqual((await save(tc, 'vagues', pr)).error, 'session_expiree', 'le jeton coach n\'est pas un jeton joueur');
  assert.strictEqual((await save('faux', 'vagues', pr)).error, 'session_expiree');
  assert.strictEqual((await mine('faux')).error, 'session_expiree');
  // identifiant de cours ou contenu invalides
  for (const bad of ['', 'Vagues', 'a b', '../x', 'x'.repeat(41)]) assert.strictEqual((await save(t1, bad, pr)).error, 'progression_invalide', bad);
  assert.strictEqual((await one(`select course_save($1, 'vagues', '[1]'::jsonb) as r`, [t1])).r.error, 'progression_invalide');
  assert.strictEqual((await save(t1, 'vagues', { w: { x: 'y'.repeat(9000) } })).error, 'progression_invalide');
  // 100 cours au plus par joueur
  for (let i = 0; i < 98; i++) assert.ok((await save(t2, 'c' + i, { seen: [] })).ok);
  assert.ok((await save(t2, 'c98', { seen: [] })).ok, '99e');
  assert.ok((await save(t2, 'c99', { seen: [] })).ok, '100e');
  assert.strictEqual((await save(t2, 'c100', { seen: [] })).error, 'progression_invalide', '101e refusé');
  assert.ok((await save(t2, 'c5', { seen: ['a'] })).ok, 'mise à jour d\'un cours existant toujours possible');
  await db.query(`delete from course_progress where player_id = 'p2'`);

  // l'app du coach relit la progression de tous ses joueurs
  const all = (await one(`select coach_courses($1) as r`, [KEY])).r.courses;
  assert.deepStrictEqual(all.map(c => [c.playerId, c.courseId]).sort(), [['p1', 'mental'], ['p1', 'vagues']]);
  assert.strictEqual((await one(`select coach_courses('faux') as r`)).r.error, 'jeton_inconnu');
  // le cours assigné voyage avec les données du coach
  const data = (await one(`select get_data($1) as r`, [t1])).r;
  assert.ok(data.players.find(p => p.id === 'p1').courses.support.assigned, 'cours assigné visible chez le joueur');

  // la progression survit à un nouvel envoi du coach, et part avec un joueur supprimé
  await push();
  assert.strictEqual((await mine(t1)).courses.length, 2, 'progression gardée après un envoi');
  snapshot.players = snapshot.players.filter(p => p.id !== 'p1');
  await push();
  assert.strictEqual((await one(`select count(*)::int as n from course_progress where player_id = 'p1'`)).n, 0);

  // droits : fonction interne et table fermées au public
  const anonCan = async fn => (await one(`select has_function_privilege('anon', $1, 'execute') as ok`, [fn])).ok;
  assert.strictEqual(await anonCan('public._course_save(text, text, jsonb)'), false);
  for (const fn of ['public.course_save(text, text, jsonb)', 'public.courses_mine(text)', 'public.coach_courses(text)']) assert.strictEqual(await anonCan(fn), true, fn);
  assert.strictEqual((await one(`select has_table_privilege('anon', 'public.course_progress', 'select') as ok`)).ok, false);

  console.log('✅ Cours (base) : tests OK');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
