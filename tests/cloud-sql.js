// Tests du schéma Supabase dans un vrai PostgreSQL (PGlite, PostgreSQL compilé en WebAssembly)
const assert = require('assert');
const fs = require('fs');
const path = require('path');

(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  // rôles présents dans Supabase
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
                 grant usage on schema public to anon, authenticated, service_role;`);
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'schema.sql'), 'utf8');
  await db.exec(sql);
  await db.exec(sql); // relançable sans erreur

  const one = async (q, params) => (await db.query(q, params)).rows[0];
  const call = async (fn, arg) => (await one(`select public.${fn}($1) as r`, [arg])).r;

  // envoi par le coach
  const snapshot = {
    coachCode: '9999',
    settings: { objectives: { 'CS/min': { sens: '≥', Jungle: 6 } }, cards: ['KDA'], axes: ['Vision'] },
    players: [
      { id: 'p1', riotId: 'secretalmasty#EUW', role: 'Jungle', code: '1234', objectives: { 'CS/min': 7 } },
      { id: 'p2', riotId: 'Autre#EUW', role: 'ADC', code: '5678' }
    ],
    games: [
      { matchId: 'EUW1_1', playerId: 'p1', date: 1000, champion: 'Hecarim', win: true },
      { matchId: 'EUW1_2', playerId: 'p1', date: 2000, champion: 'Viego', win: false },
      { matchId: 'EUW1_3', playerId: 'p2', date: 1500, champion: 'Jinx', win: true },
      { matchId: 'EUW1_4', playerId: 'fantome', date: 1500, champion: 'Teemo', win: true }
    ],
    ranks: [{ playerId: 'p1', date: 3000, label: 'Maître · 528 LP' }],
    sessions: [{ id: 's1', playerId: 'p1', axis: 'Vision' }, { id: 's2', playerId: 'p2', axis: 'Laning' }]
  };
  const pushed = await call('admin_push', JSON.stringify(snapshot));
  assert.deepStrictEqual(pushed, { ok: true, players: 2, games: 3 });
  const stored = await one(`select code_hash, data from players where id = 'p1'`);
  assert.ok(/^[0-9a-f]{64}$/.test(stored.code_hash), 'code stocké en empreinte');
  assert.ok(!('code' in stored.data), 'le code en clair ne reste pas dans les données');

  // connexion joueur → seulement ses données
  const lj = await call('login', '1234');
  assert.strictEqual(lj.role, 'joueur');
  assert.strictEqual(lj.playerId, 'p1');
  const dj = await call('get_data', lj.token);
  assert.strictEqual(dj.players.length, 1);
  assert.strictEqual(dj.players[0].riotId, 'secretalmasty#EUW');
  assert.strictEqual(dj.players[0].objectives['CS/min'], 7);
  assert.deepStrictEqual(dj.games.map(g => g.matchId), ['EUW1_1', 'EUW1_2']);
  assert.strictEqual(dj.sessions.length, 1);
  assert.strictEqual(dj.ranks[0].label, 'Maître · 528 LP');
  assert.strictEqual(dj.settings.objectives['CS/min'].Jungle, 6, 'modèles d\'objectifs transmis');
  assert.ok(!JSON.stringify(dj).includes('5678') && !JSON.stringify(dj).includes('code_hash'), 'aucune donnée des autres ni code');

  // connexion coach → tout
  const lc = await call('login', '9999');
  assert.strictEqual(lc.role, 'coach');
  const dc = await call('get_data', lc.token);
  assert.strictEqual(dc.players.length, 2);
  assert.strictEqual(dc.games.length, 3);

  // mauvais jeton, mauvais code
  assert.strictEqual((await call('get_data', 'faux')).error, 'session_expiree');
  assert.strictEqual((await call('login', '0000')).error, 'code_inconnu');
  assert.strictEqual((await call('login', 'abcd')).error, 'code_inconnu');

  // blocage après 8 essais faux (même IP) : même le bon code est refusé ensuite
  for (let i = 0; i < 6; i++) await call('login', String(1000 + i));
  assert.strictEqual((await call('login', '1234')).error, 'trop_essais');

  // déconnexion
  await db.exec(`delete from login_attempts where true`);
  const l2 = await call('login', '1234');
  await db.query('select public.logout($1)', [l2.token]);
  assert.strictEqual((await call('get_data', l2.token)).error, 'session_expiree');

  // nouvel envoi : un joueur supprimé disparaît, ses jetons ne voient plus rien
  const l3 = await call('login', '5678');
  await call('admin_push', JSON.stringify({ ...snapshot, players: [snapshot.players[0]] }));
  const d3 = await call('get_data', l3.token);
  assert.strictEqual(d3.players.length, 0);
  assert.strictEqual(d3.games.length, 0);

  // envoi par jeton : refusé tant que l'empreinte n'est pas enregistrée, accepté ensuite
  const jeton = 'a'.repeat(64);
  assert.strictEqual((await one(`select public.coach_push($1, $2) as r`, [jeton, JSON.stringify(snapshot)])).r.error, 'jeton_inconnu');
  await db.query(`insert into push_keys (hash, label) values (encode(sha256($1::text::bytea), 'hex'), 'test')`, [jeton]);
  assert.strictEqual((await one(`select public.coach_push($1, $2) as r`, [jeton, JSON.stringify(snapshot)])).r.players, 2);
  assert.strictEqual((await one(`select public.coach_push($1, $2) as r`, ['b'.repeat(64), '{}'])).r.error, 'jeton_inconnu');

  // droits : le public ne peut pas appeler admin_push ni lire les tables
  const can = async (role, what) => (await one(`select has_function_privilege('${role}', '${what}', 'execute') as ok`)).ok;
  assert.strictEqual(await can('anon', 'public.admin_push(jsonb)'), false);
  assert.strictEqual(await can('anon', 'public.hash_code(text)'), false);
  assert.strictEqual(await can('anon', 'public.login(text)'), true);
  assert.strictEqual(await can('service_role', 'public.admin_push(jsonb)'), true);
  assert.strictEqual(await can('anon', 'public.coach_push(text,jsonb)'), true);
  const rls = await db.query(`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity`);
  assert.deepStrictEqual(rls.rows, [], 'RLS active sur toutes les tables');

  console.log('✅ Base en ligne : tests OK');
})().catch(e => { console.error(e); process.exit(1); });
