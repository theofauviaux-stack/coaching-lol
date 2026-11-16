// Tests du client du serveur (faux serveur) et des règles d'accès par code
const assert = require('assert');
const { CloudClient, buildSnapshot, dataFromCloud } = require('../src/cloud');
const access = require('../src/access');

(async () => {
  // ---- règles d'accès
  const data = {
    settings: {},
    players: [{ id: 'a', riotId: 'A#EUW', code: '1111' }, { id: 'b', riotId: 'B#EUW', code: '2222' }],
    games: [{ matchId: 'm1', playerId: 'a' }, { matchId: 'm2', playerId: 'b' }],
    ignored: [{ matchId: 'm3', playerId: 'b' }],
    ranks: [{ playerId: 'a', date: 1 }], sessions: [{ id: 's', playerId: 'b' }]
  };
  assert.deepStrictEqual(access.checkLocalCode(data, '9999', '9999'), { role: 'coach', playerId: null });
  assert.deepStrictEqual(access.checkLocalCode(data, '2222', '9999'), { role: 'joueur', playerId: 'b' });
  assert.strictEqual(access.checkLocalCode(data, '3333', '9999'), null);
  assert.strictEqual(access.checkLocalCode(data, '12a4', '9999'), null);
  const vb = access.filterForSession(data, { role: 'joueur', playerId: 'b' });
  assert.deepStrictEqual(vb.players.map(p => p.id), ['b']);
  assert.ok(!('code' in vb.players[0]), 'le joueur ne reçoit pas les codes');
  assert.deepStrictEqual(vb.games.map(g => g.matchId), ['m2']);
  assert.strictEqual(vb.ranks.length, 0);
  assert.strictEqual(vb.sessions.length, 1);
  assert.strictEqual(data.players[1].code, '2222', 'données d\'origine intactes');
  assert.strictEqual(access.filterForSession(data, { role: 'coach' }).players.length, 2);
  assert.match(access.codeConflict(data, '1111', '9999', 'b'), /A#EUW/);
  assert.strictEqual(access.codeConflict(data, '1111', '9999', 'a'), null, 'son propre code ne gêne pas');
  assert.match(access.codeConflict(data, '9999', '9999'), /coach/);
  assert.match(access.codeConflict(data, '123', '9999'), /4 chiffres/);
  const rc = access.randomCode(data, '9999');
  assert.ok(/^\d{4}$/.test(rc) && !access.codeConflict(data, rc, '9999'));
  let t = 0;
  const lim = new access.Limiter(() => t);
  for (let i = 0; i < 4; i++) lim.fail();
  assert.strictEqual(lim.blockedFor(), 0);
  lim.fail();
  assert.strictEqual(lim.blockedFor(), 30000);
  t = 31000;
  assert.strictEqual(lim.blockedFor(), 0);
  lim.fail();
  assert.strictEqual(lim.blockedFor(), 60000, 'attente doublée');

  // ---- instantané envoyé au serveur
  const snap = buildSnapshot({ ...data, settings: { objectives: { KDA: {} }, cards: ['KDA'], axes: ['x'], apiKeyEnc: 'secret' }, players: [{ id: 'a', riotId: 'A#EUW', code: '1111', puuid: 'P', statusText: 'ok' }] }, '9999');
  assert.strictEqual(snap.coachCode, '9999');
  assert.strictEqual(snap.players[0].code, '1111');
  assert.ok(!('puuid' in snap.players[0]) && !('statusText' in snap.players[0]));
  assert.ok(!JSON.stringify(snap).includes('secret'), 'aucun secret envoyé');
  assert.ok(!('ignored' in snap));

  // ---- client : en-têtes, erreurs, conversion
  const calls = [];
  const fakeFetch = async (url, opts) => {
    calls.push({ url, opts });
    const body = JSON.parse(opts.body);
    const json = (status, obj) => ({ ok: status < 300, status, text: async () => JSON.stringify(obj) });
    if (url.endsWith('/login')) return body.p_code === '2222' ? json(200, { token: 'T', role: 'joueur', playerId: 'b' }) : json(200, { error: 'trop_essais' });
    if (url.endsWith('/get_data')) return json(200, { role: 'joueur', players: [{ id: 'b', riotId: 'B#EUW' }], games: [], ranks: [], sessions: [], settings: { cards: ['KDA'] } });
    if (url.endsWith('/admin_push')) return opts.headers.apikey === 'sb_secret_x' ? json(200, { ok: true }) : json(401, { message: 'permission denied' });
    return json(404, {});
  };
  const c = new CloudClient({ url: 'https://abc.supabase.co', publicKey: 'sb_publishable_y', fetchImpl: fakeFetch });
  const r = await c.login('2222');
  assert.deepStrictEqual(r, { token: 'T', role: 'joueur', playerId: 'b' });
  assert.strictEqual(calls[0].url, 'https://abc.supabase.co/rest/v1/rpc/login');
  assert.strictEqual(calls[0].opts.headers.apikey, 'sb_publishable_y');
  assert.ok(!calls[0].opts.headers.Authorization, 'pas de Bearer pour les nouvelles clés');
  await assert.rejects(c.login('0000'), /Trop d'essais/);
  const remote = dataFromCloud(await c.getData('T'), { settings: { ddVersion: '1' } });
  assert.strictEqual(remote.players[0].riotId, 'B#EUW');
  assert.deepStrictEqual(remote.settings.cards, ['KDA']);
  assert.strictEqual(remote.settings.ddVersion, '1');
  assert.deepStrictEqual(await c.push(snap, 'sb_secret_x'), { ok: true });
  await assert.rejects(c.push(snap, 'mauvaise'), e => e.code === 'AUTH');
  const jwt = new CloudClient({ url: 'https://abc.supabase.co', publicKey: 'eyJhbGciOi', fetchImpl: fakeFetch });
  await jwt.login('2222');
  assert.strictEqual(calls[calls.length - 1].opts.headers.Authorization, 'Bearer eyJhbGciOi', 'anciennes clés JWT');
  const offline = new CloudClient({ url: 'https://x', publicKey: 'k', fetchImpl: async () => { throw new Error('ENOTFOUND'); } });
  await assert.rejects(offline.login('1111'), e => e.code === 'NETWORK');

  console.log('✅ Accès par code et client serveur : tests OK');
})().catch(e => { console.error(e); process.exit(1); });
