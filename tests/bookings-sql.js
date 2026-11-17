// Tests des réservations de coaching dans un vrai PostgreSQL (PGlite)
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
  const snapshot = { coachCode: '9999', players: [{ id: 'p1', riotId: 'A#EUW', code: '1234' }, { id: 'p2', riotId: 'B#EUW', code: '5678' }], games: [], ranks: [], sessions: [] };
  await one(`select coach_push($1, $2) as r`, [KEY, JSON.stringify(snapshot)]);
  const t1 = (await one(`select login('1234') as r`)).r.token;
  const t2 = (await one(`select login('5678') as r`)).r.token;
  // créneaux de demain (heure de Paris)
  const slot = async (h, m = 0, days = 1) => (await one(`select ((date_trunc('day', now() at time zone 'Europe/Paris') + make_interval(days => $1::int, hours => $2::int, mins => $3::int)) at time zone 'Europe/Paris') as t`, [days, h, m])).t;
  const book = async (tok, action, id, start) => (await one(`select book($1, $2, $3, $4) as r`, [tok, action, id || null, start || null])).r;
  const coach = async (action, id, start, player) => (await one(`select coach_book($1, $2, $3, $4, $5) as r`, [KEY, action, id || null, start || null, player || null])).r;
  const s19 = await slot(19), s20 = await slot(20), s21 = await slot(21), s22 = await slot(22);

  // demandes et règles
  const b19 = await book(t1, 'demander', null, s19);
  assert.strictEqual(b19.status, 'en_attente');
  assert.strictEqual((await book(t2, 'demander', null, s19)).error, 'creneau_pris', 'un créneau = un joueur');
  const b20 = await book(t1, 'demander', null, s20);
  assert.strictEqual(b20.status, 'en_attente');
  assert.strictEqual((await book(t1, 'demander', null, s21)).error, 'max_jour', '2 h maximum par jour');
  assert.strictEqual((await book(t1, 'demander', null, await slot(16))).error, 'creneau_invalide', 'avant 17 h');
  assert.strictEqual((await book(t1, 'demander', null, await slot(19, 30))).error, 'creneau_invalide', 'heure pile');
  assert.strictEqual((await book(t1, 'demander', null, await slot(19, 0, -1))).error, 'creneau_invalide', 'passé');
  assert.strictEqual((await book(t1, 'demander', null, await slot(19, 0, 40))).error, 'creneau_invalide', 'plus de 30 jours');
  assert.strictEqual((await book(t1, 'demander', null, await slot(23, 0, 2))).status, 'en_attente', '23 h - minuit autorisé');
  assert.strictEqual((await book('faux', 'demander', null, s21)).error, 'session_expiree');

  // ce que voit l'autre joueur : créneaux pris, sans savoir par qui
  const vue2 = (await one(`select bookings_mine($1) as r`, [t2])).r;
  assert.strictEqual(vue2.mine.length, 0);
  assert.strictEqual(vue2.busy.length, 3);
  assert.ok(!JSON.stringify(vue2).includes('p1'));

  // côté coach
  const all = (await one(`select coach_bookings($1) as r`, [KEY])).r.all;
  assert.strictEqual(all.length, 3);
  assert.ok(all.every(b => b.playerId === 'p1'));
  assert.strictEqual((await one(`select coach_bookings('faux') as r`)).r.error, 'jeton_inconnu');
  assert.strictEqual((await coach('accepter', b19.id)).status, 'acceptee');
  // refus = proposition d'un autre horaire
  const prop = await coach('proposer', b20.id, s22);
  assert.strictEqual(prop.status, 'proposee');
  assert.strictEqual((await book(t2, 'demander', null, s20)).status, 'en_attente', 'le créneau refusé se libère');
  assert.strictEqual((await book(t2, 'demander', null, s22)).error, 'creneau_pris', 'le créneau proposé est réservé');
  const ok22 = await book(t1, 'accepter_proposition', b20.id);
  assert.strictEqual(ok22.status, 'acceptee');
  assert.strictEqual(new Date(ok22.start).getTime(), new Date(s22).getTime());

  // démarrage : trop tôt, puis à l'heure (on avance le créneau dans le temps pour le test)
  assert.strictEqual((await coach('demarrer', b19.id)).error, 'trop_tot');
  await db.query(`update bookings set start_at = date_trunc('hour', now()) - interval '1 day' where id = $1`, [b19.id]);
  const t0 = (await one(`select date_trunc('minute', now()) - interval '10 minutes' as t`)).t; // une seule heure de référence
  await db.query(`update bookings set start_at = $2::timestamptz where id = $1`, [b19.id, t0.toISOString()]);
  const suite = (await one(`insert into bookings (player_id, start_at, status) values ('p1', $1::timestamptz + interval '1 hour', 'acceptee') returning id`, [t0.toISOString()])).id;
  const st = await coach('demarrer', b19.id);
  assert.strictEqual(st.status, 'en_cours');
  assert.strictEqual((await one(`select status from bookings where id = $1`, [suite])).status, 'en_cours', 'créneau suivant inclus : séance de 2 h');
  const vue1 = (await one(`select bookings_mine($1) as r`, [t1])).r;
  assert.ok(vue1.mine.some(b => b.status === 'en_cours'), 'le joueur voit « en coaching »');
  await coach('terminer', b19.id);
  assert.strictEqual((await one(`select count(*)::int as n from bookings where status = 'en_cours'`)).n, 0);

  // nouvel envoi de données par le coach : les réservations restent ; joueur supprimé → ses réservations aussi
  const avant = (await one(`select count(*)::int as n from bookings`)).n;
  await one(`select coach_push($1, $2) as r`, [KEY, JSON.stringify(snapshot)]);
  assert.strictEqual((await one(`select count(*)::int as n from bookings`)).n, avant, 'réservations conservées');
  assert.strictEqual((await one(`select login('1234') as r`)).r.role, 'joueur', 'codes toujours valides');
  await one(`select coach_push($1, $2) as r`, [KEY, JSON.stringify({ ...snapshot, players: [snapshot.players[0]] })]);
  assert.strictEqual((await one(`select count(*)::int as n from bookings where player_id = 'p2'`)).n, 0);

  // droits
  const can = async (role, fn) => (await one(`select has_function_privilege('${role}', '${fn}', 'execute') as ok`)).ok;
  assert.strictEqual(await can('anon', 'public.book(text,text,uuid,timestamptz)'), true);
  assert.strictEqual(await can('anon', 'public._player_action(text,text,uuid,timestamptz)'), false);
  assert.strictEqual(await can('anon', 'public._slot_free(timestamptz,uuid)'), false);
  assert.strictEqual(await can('anon', 'public._bookings_tidy()'), false);
  const rls = await db.query(`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity`);
  assert.deepStrictEqual(rls.rows, []);
  console.log('✅ Réservations de coaching (base) : tests OK');
})().catch(e => { console.error(e); process.exit(1); });
