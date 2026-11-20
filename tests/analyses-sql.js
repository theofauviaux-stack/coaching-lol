// Tests des analyses de parties (joueur ↔ coach) et des règles du stockage des vidéos, dans un vrai PostgreSQL (PGlite)
const assert = require('assert');
const { prepareDb, storageOp } = require('./fake-supabase');

(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  await prepareDb(db, { twice: true });
  const one = async (q, params) => (await db.query(q, params)).rows[0];
  const r = async (q, params) => (await one(q.replace(/^/, 'select ') + ' as r', params)).r;
  const KEY = 'k'.repeat(64);
  await db.query(`insert into push_keys (hash) values (encode(sha256($1::text::bytea), 'hex'))`, [KEY]);
  await one(`select coach_push($1, $2) as r`, [KEY, JSON.stringify({
    coachCode: '9999', players: [{ id: 'p1', riotId: 'A#EUW', code: '1234' }, { id: 'p2', riotId: 'B#EUW', code: '5678' }],
    games: [], ranks: [], sessions: []
  })]);
  const t1 = (await r(`login('1234')`)).token;
  const t2 = (await r(`login('5678')`)).token;
  const files = new Map();
  const upload = (name, n = 1000) => storageOp(db, files, 'upload', 'clips', name, Buffer.alloc(n, 1), 'video/webm');
  const del = names => storageOp(db, files, 'delete', 'clips', null, names);

  // --- moments envoyés par le coach, lus par le joueur
  const mo = id => ({ matchId: id, gameId: 7, duration: 1200, moments: [{ t: 390000, type: 'mort' }] });
  const now = Date.now();
  let p = await r(`coach_moments_push($1, $2)`, [KEY, JSON.stringify([
    { playerId: 'p1', matchId: 'EUW1_1', date: now - 3600e3, data: mo('EUW1_1') },
    { playerId: 'p1', matchId: 'EUW1_OLD', date: now - 50 * 86400e3, data: mo('EUW1_OLD') },
    { playerId: 'p2', matchId: 'EUW1_2', date: now, data: mo('EUW1_2') },
    { playerId: 'inconnu', matchId: 'EUW1_3', date: now, data: mo('EUW1_3') }])]);
  assert.strictEqual(p.saved, 3, 'joueur inconnu ignoré');
  assert.deepStrictEqual(p.have.sort(), ['p1/EUW1_1', 'p2/EUW1_2'], 'parties de plus de 45 jours retirées');
  assert.strictEqual((await r(`coach_moments_push('mauvais', '[]')`)).error, 'jeton_inconnu');
  assert.strictEqual((await r(`moments_get($1, 'EUW1_1')`, [t1])).moments.matchId, 'EUW1_1');
  assert.strictEqual((await r(`moments_get($1, 'EUW1_2')`, [t1])).error, 'moments_absents', 'pas les parties d\'un autre joueur');
  assert.strictEqual((await r(`moments_get('faux', 'EUW1_1')`)).error, 'session_expiree');

  // --- création d'une analyse
  const clips = [{ file: '01_6m10.webm', start: 370, end: 440, times: [390000], bytes: 1000 }, { file: '02_8m40.webm', start: 520, end: 550, times: [540000], bytes: 1000 }];
  const create = (tok, extra) => r(`analysis_create($1, $2)`, [tok, JSON.stringify(Object.assign({ matchId: 'EUW1_1', clips, note: 'Ma lane', comments: [{ t: 390000, text: 'Je pensais que le jungler était bot' }, { t: null, text: '  ' }] }, extra))]);
  assert.strictEqual((await create(t2)).error, 'moments_absents', 'partie d\'un autre joueur refusée');
  assert.strictEqual((await create(t1, { clips: [{ file: '../x.webm', bytes: 10 }] })).error, 'analyse_invalide');
  assert.strictEqual((await create(t1, { clips: [] })).error, 'analyse_invalide');
  assert.strictEqual((await create(t1, { clips: [clips[0], clips[0]] })).error, 'analyse_invalide', 'fichiers en double');
  assert.strictEqual((await create(t1, { clips: [Object.assign({}, clips[0], { bytes: 40e6 })] })).error, 'analyse_invalide', 'vidéo trop lourde');
  const a = await create(t1);
  assert.ok(a.ok && /^[0-9a-f-]{36}$/.test(a.id), JSON.stringify(a));
  // pas encore visible (envoi en cours)
  assert.deepStrictEqual((await r(`analyses_mine($1)`, [t1])).analyses, []);
  assert.deepStrictEqual((await r(`coach_analyses($1)`, [KEY])).analyses, []);

  // --- règles du stockage
  let u = await upload(a.id + '/01_6m10.webm');
  assert.strictEqual(u[0], 200, JSON.stringify(u));
  assert.strictEqual((await upload(a.id + '/01_6m10.webm'))[1].error, 'Duplicate');
  assert.strictEqual((await upload(a.id + '/03_9m00.webm'))[1].error, 'Unauthorized', 'fichier non annoncé refusé');
  assert.strictEqual((await upload('00000000-0000-4000-8000-000000000000/01_6m10.webm'))[1].error, 'Unauthorized', 'analyse inconnue refusée');
  assert.strictEqual((await upload('autre/01_6m10.webm'))[1].error, 'Unauthorized');
  assert.strictEqual((await storageOp(db, files, 'upload', 'clips', a.id + '/02_8m40.webm', Buffer.alloc(10), 'text/html'))[1].error, 'invalid_mime_type');
  assert.strictEqual((await upload(a.id + '/02_8m40.webm', 32 * 1048576))[1].error, 'Payload too large');
  // personne ne peut effacer ni lister les vidéos d'une analyse en cours
  assert.deepStrictEqual((await del([a.id + '/01_6m10.webm']))[1], []);
  const visible = await db.transaction(async tx => { await tx.query('set local role anon'); return (await tx.query(`select name from storage.objects where bucket_id = 'clips'`)).rows; });
  assert.deepStrictEqual(visible.map(x => x.name), [a.id + '/01_6m10.webm'], 'seulement pendant l\'envoi (analyse en cours d\'envoi)');
  assert.strictEqual((await upload(a.id + '/02_8m40.webm'))[0], 200);

  // --- prête : visible chez le coach et le joueur
  assert.strictEqual((await r(`analysis_ready($1, $2)`, [t2, a.id])).error, 'analyse_inconnue', 'pas l\'analyse d\'un autre');
  const ready = await r(`analysis_ready($1, $2)`, [t1, a.id]);
  assert.strictEqual(ready.analysis.status, 'ouverte');
  assert.strictEqual(ready.analysis.clipsState, 'en_ligne');
  assert.strictEqual((await upload(a.id + '/02_8m40.webm'))[1].error, 'Duplicate');
  const del2 = await db.transaction(async tx => { await tx.query('set local role anon'); return (await tx.query(`select name from storage.objects where bucket_id = 'clips'`)).rows; });
  assert.deepStrictEqual(del2, [], 'plus rien de listable une fois l\'envoi fini');
  const ca = (await r(`coach_analyses($1)`, [KEY])).analyses;
  assert.strictEqual(ca.length, 1);
  assert.deepStrictEqual(ca[0].comments.map(c => [c.t, c.author, c.text]), [[390000, 'joueur', 'Je pensais que le jungler était bot']], 'commentaire vide ignoré');
  assert.strictEqual(ca[0].note, 'Ma lane');
  assert.ok(!ca[0].moments, 'liste sans les moments');
  assert.strictEqual((await r(`coach_analysis_get($1, $2)`, [KEY, a.id])).analysis.moments.matchId, 'EUW1_1');
  assert.strictEqual((await r(`analysis_get($1, $2)`, [t2, a.id])).error, 'analyse_inconnue');
  assert.strictEqual((await r(`analysis_get($1, $2)`, [t1, a.id])).analysis.moments.matchId, 'EUW1_1');
  assert.deepStrictEqual((await r(`analyses_mine($1)`, [t2])).analyses, []);

  // --- discussion
  let c = await r(`coach_analysis_comment($1, $2, 390000, 'Regarde la mini-carte : il était top')`, [KEY, a.id]);
  assert.ok(c.ok);
  c = await r(`analysis_comment($1, $2, 390000, 'Vu, je ward plus tôt')`, [t1, a.id]);
  c = await r(`analysis_comment($1, $2, null, 'Merci !')`, [t1, a.id]);
  assert.deepStrictEqual(c.analysis.comments.map(x => x.author), ['joueur', 'coach', 'joueur', 'joueur']);
  assert.strictEqual((await r(`analysis_comment($1, $2, null, '   ')`, [t1, a.id])).error, 'commentaire_invalide');
  assert.strictEqual((await r(`analysis_comment($1, $2, null, 'x')`, [t2, a.id])).error, 'analyse_fermee', 'pas dans l\'analyse d\'un autre');
  assert.strictEqual((await r(`analysis_comment($1, $2, null, $3)`, [t1, a.id, 'x'.repeat(2001)])).error, 'commentaire_invalide');

  // --- limites : 3 analyses ouvertes par joueur
  for (let i = 0; i < 2; i++) assert.ok((await create(t1)).ok);
  assert.strictEqual((await create(t1)).error, 'trop_d_analyses');
  // espace total
  await db.query(`update analyses set bytes = 899 * 1048576 where id = $1`, [a.id]);
  assert.strictEqual((await r(`analysis_create($1, $2)`, [t2, JSON.stringify({ matchId: 'EUW1_2', clips: [Object.assign({}, clips[0], { bytes: 2 * 1048576 })] })])).error, 'stockage_plein');
  await db.query(`update analyses set bytes = 2000 where id = $1`, [a.id]);

  // --- fin de l'analyse : discussion fermée, vidéos gardées pour l'export du joueur
  assert.strictEqual((await r(`coach_analysis_close('mauvais', $1)`, [a.id])).error, 'jeton_inconnu');
  const closed = await r(`coach_analysis_close($1, $2)`, [KEY, a.id]);
  assert.strictEqual(closed.analysis.status, 'terminee');
  assert.strictEqual(closed.analysis.clipsState, 'en_ligne', 'vidéos gardées pour l\'export');
  assert.strictEqual((await r(`analysis_comment($1, $2, null, 'encore')`, [t1, a.id])).error, 'analyse_fermee');
  assert.strictEqual((await r(`coach_analysis_comment($1, $2, null, 'encore')`, [KEY, a.id])).error, 'analyse_fermee');
  assert.deepStrictEqual((await del([a.id + '/01_6m10.webm']))[1], [], 'pas effaçables par n\'importe qui');
  // la purge : envois abandonnés (plus d'un jour) seulement ; l'analyse terminée hier garde ses vidéos
  await db.query(`update analyses set created_at = now() - interval '2 days' where status = 'envoi'`);
  let pg = (await r(`coach_clips_purge($1)`, [KEY])).purge;
  assert.strictEqual(pg.length, 2);
  assert.ok(!pg.some(x => x.id === a.id));
  for (const x of pg) await r(`coach_clips_gone($1, $2)`, [KEY, x.id]);
  // export par le joueur : seulement le sien, seulement une fois terminé
  assert.strictEqual((await r(`analysis_export_done($1, $2)`, [t2, a.id])).error, 'export_impossible');
  const ex = await r(`analysis_export_done($1, $2)`, [t1, a.id]);
  assert.ok(ex.ok && ex.clipsState === 'a_effacer', JSON.stringify(ex));
  assert.deepStrictEqual(ex.files, ['01_6m10.webm', '02_8m40.webm']);
  assert.strictEqual((await r(`analysis_export_done($1, $2)`, [t1, a.id])).error, 'export_impossible', 'une seule fois');
  assert.deepStrictEqual((await r(`analyses_mine($1)`, [t1])).analyses, [], 'n\'apparaît plus');
  assert.deepStrictEqual((await r(`coach_analyses($1)`, [KEY])).analyses, [], 'ni chez le coach');
  // tant que les vidéos sont là, l'analyse reste (pour que la purge puisse les effacer)
  assert.strictEqual((await r(`analysis_forget($1, $2)`, [t1, a.id])).error, 'videos_restantes');
  const gone = await del(ex.files.map(f => a.id + '/' + f));
  assert.strictEqual(gone[1].length, 2, 'le joueur efface ses vidéos avec la clé publique');
  assert.strictEqual(files.size, 0);
  assert.strictEqual((await r(`analysis_forget($1, $2)`, [t2, a.id])).ok, true);
  assert.strictEqual(Number((await one(`select count(*) as n from analyses where id = $1`, [a.id])).n), 1, 'pas l\'analyse d\'un autre');
  assert.strictEqual((await r(`analysis_forget($1, $2)`, [t1, a.id])).ok, true);
  assert.strictEqual(Number((await one(`select count(*) as n from analyses where id = $1`, [a.id])).n), 0, 'analyse supprimée');
  assert.strictEqual(Number((await one(`select count(*) as n from analysis_comments where analysis_id = $1`, [a.id])).n), 0, 'messages supprimés');
  // analyse terminée depuis plus de 7 jours sans export : vidéos effacées, discussion gardée
  const b = await create(t1);
  for (const f of clips) await upload(b.id + '/' + f.file);
  await r(`analysis_ready($1, $2)`, [t1, b.id]);
  await r(`coach_analysis_close($1, $2)`, [KEY, b.id]);
  await db.query(`update analyses set closed_at = now() - interval '8 days' where id = $1`, [b.id]);
  pg = (await r(`coach_clips_purge($1)`, [KEY])).purge;
  assert.deepStrictEqual(pg.map(x => x.id), [b.id]);
  await del(pg[0].files.map(f => b.id + '/' + f));
  await r(`coach_clips_gone($1, $2)`, [KEY, b.id]);
  assert.deepStrictEqual((await r(`analyses_mine($1)`, [t1])).analyses.map(x => [x.status, x.clipsState]), [['terminee', 'effacees']]);
  // export après effacement : débrief seul, puis suppression
  const ex2 = await r(`analysis_export_done($1, $2)`, [t1, b.id]);
  assert.deepStrictEqual([ex2.clipsState, ex2.files], ['effacees', []]);
  assert.strictEqual((await r(`analysis_forget($1, $2)`, [t1, b.id])).ok, true);
  assert.strictEqual(Number((await one(`select count(*) as n from analyses where id = $1`, [b.id])).n), 0);
  // exportée mais vidéos pas effacées (app fermée trop tôt) : la purge du coach finit le travail
  const e3 = await create(t1);
  for (const f of clips) await upload(e3.id + '/' + f.file);
  await r(`analysis_ready($1, $2)`, [t1, e3.id]);
  await r(`coach_analysis_close($1, $2)`, [KEY, e3.id]);
  await r(`analysis_export_done($1, $2)`, [t1, e3.id]);
  pg = (await r(`coach_clips_purge($1)`, [KEY])).purge;
  assert.deepStrictEqual(pg.map(x => x.id), [e3.id]);
  await del(pg[0].files.map(f => e3.id + '/' + f));
  await r(`coach_clips_gone($1, $2)`, [KEY, e3.id]);
  assert.strictEqual(Number((await one(`select count(*) as n from analyses where id = $1`, [e3.id])).n), 0, 'analyse exportée supprimée par la purge');
  // analyse ouverte de plus de 30 jours : vidéos effacées, discussion toujours ouverte
  const d = await create(t1);
  for (const f of clips) await upload(d.id + '/' + f.file);
  await r(`analysis_ready($1, $2)`, [t1, d.id]);
  await db.query(`update analyses set created_at = now() - interval '31 days' where id = $1`, [d.id]);
  assert.deepStrictEqual((await r(`coach_clips_purge($1)`, [KEY])).purge.map(x => x.id), [d.id]);
  assert.strictEqual((await r(`analysis_comment($1, $2, null, 'toujours ouverte')`, [t1, d.id])).ok, true);

  // --- suppression par le coach : l'analyse disparaît des deux côtés, messages tout de suite, vidéos puis ligne par la purge
  const s1 = await create(t1);
  for (const f of clips) await upload(s1.id + '/' + f.file);
  await r(`analysis_ready($1, $2)`, [t1, s1.id]);
  await r(`coach_analysis_comment($1, $2, null, 'à supprimer')`, [KEY, s1.id]);
  assert.strictEqual((await r(`coach_analysis_delete('mauvais', $1)`, [s1.id])).error, 'jeton_inconnu');
  const sd = await r(`coach_analysis_delete($1, $2)`, [KEY, s1.id]);
  assert.deepStrictEqual([sd.ok, sd.clipsState, sd.files], [true, 'a_effacer', ['01_6m10.webm', '02_8m40.webm']]);
  assert.ok(!(await r(`coach_analyses($1)`, [KEY])).analyses.some(x => x.id === s1.id), 'plus dans la liste du coach');
  assert.ok(!(await r(`analyses_mine($1)`, [t1])).analyses.some(x => x.id === s1.id), 'plus dans la liste du joueur');
  assert.strictEqual(Number((await one(`select count(*) as n from analysis_comments where analysis_id = $1`, [s1.id])).n), 0, 'messages effacés');
  assert.strictEqual((await r(`analysis_comment($1, $2, null, 'encore ?')`, [t1, s1.id])).error, 'analyse_fermee');
  pg = (await r(`coach_clips_purge($1)`, [KEY])).purge;
  const ps = pg.find(x => x.id === s1.id);
  await del(ps.files.map(f => s1.id + '/' + f));
  assert.ok(![...files.keys()].some(k => k.includes(s1.id)), 'vidéos effacées du stockage');
  await r(`coach_clips_gone($1, $2)`, [KEY, s1.id]);
  assert.strictEqual(Number((await one(`select count(*) as n from analyses where id = $1`, [s1.id])).n), 0, 'analyse supprimée');
  // vidéos déjà effacées : suppression immédiate ; analyse inconnue : erreur
  await db.query(`update analyses set clips_state = 'effacees' where id = $1`, [d.id]);
  assert.deepStrictEqual((await r(`coach_analysis_delete($1, $2)`, [KEY, d.id])).files, []);
  assert.strictEqual(Number((await one(`select count(*) as n from analyses where id = $1`, [d.id])).n), 0);
  assert.strictEqual((await r(`coach_analysis_delete($1, $2)`, [KEY, d.id])).error, 'analyse_inconnue');

  // --- fonctions internes fermées au public
  for (const f of ['_analysis_json', '_comment_add']) {
    const g = await one(`select has_function_privilege('anon', p.oid, 'execute') as ok from pg_proc p where proname = $1`, [f]);
    assert.strictEqual(g.ok, false, f + ' ne doit pas être appelable');
  }
  console.log('✅ Analyses de parties et vidéos (base) : OK');
})().catch(e => { console.error(e); process.exit(1); });
