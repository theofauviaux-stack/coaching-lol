// Tests sans réseau : API Riot simulée, synchro, statistiques, stockage.
const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { RiotClient } = require('../src/riot');
const { syncPlayer } = require('../src/sync');
const { Store, emptyData } = require('../src/store');
const Stats = require('../renderer/stats');

const POS = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];
function participants(myPos, n) {
  const ps = [];
  for (let t = 0; t < 2; t++) for (let i = 0; i < 5; i++) {
    const id = t * 5 + i + 1, me = t === 0 && POS[i] === myPos;
    ps.push({ participantId: id, puuid: me ? 'PUUID-1' : 'X' + id, teamId: t ? 200 : 100, teamPosition: POS[i], championName: me ? (n % 2 ? 'LeeSin' : 'Vi') : 'Champ' + id,
      win: t === 0 ? n % 3 !== 0 : n % 3 === 0, kills: 3 + (me ? n % 4 : 0), deaths: 2, assists: 5, totalMinionsKilled: 150, neutralMinionsKilled: 40,
      goldEarned: 11000, totalDamageDealtToChampions: 18000, visionScore: 35, wardsPlaced: 12, wardsKilled: 4, visionWardsBoughtInGame: 3, champLevel: 15 });
  }
  return ps;
}
function frames() {
  const fr = [];
  for (let m = 0; m < 20; m++) {
    const pf = {};
    for (let id = 1; id <= 10; id++) pf[String(id)] = { minionsKilled: m * 2, jungleMinionsKilled: m * 4, totalGold: 500 + m * 400 + (id === 2 ? 250 : 0), xp: m * 450 + (id === 2 ? 80 : 0) };
    fr.push({ participantFrames: pf, events: m === 6 ? [{ type: 'CHAMPION_KILL', victimId: 2, timestamp: 361000 }] : [] });
  }
  return fr;
}
let calls = [];
function mockFetch(rankWins) {
  return async url => {
    calls.push(url);
    const ok = body => ({ status: 200, json: async () => body, headers: { get: () => null } });
    if (url.includes('/accounts/by-riot-id/secretalmasty/EUW')) return ok({ puuid: 'PUUID-1', gameName: 'secretalmasty', tagLine: 'EUW' });
    if (url.includes('/ids?queue=420')) return ok(['EUW1_105', 'EUW1_104', 'EUW1_103', 'EUW1_102', 'EUW1_101']);
    if (url.endsWith('/timeline')) return ok({ info: { frames: frames() } });
    const m = url.match(/matches\/EUW1_(\d+)$/);
    if (m) {
      const n = Number(m[1]);
      const pos = n === 103 ? 'TOP' : 'JUNGLE'; // la 103 est jouée hors rôle
      return ok({ metadata: { matchId: 'EUW1_' + n }, info: { gameCreation: 1, gameStartTimestamp: 1763000000000 + n * 3600000, gameEndTimestamp: 1, gameDuration: 1800, queueId: 420, participants: participants(pos, n) } });
    }
    if (url.includes('/entries/by-puuid/')) return ok([{ queueType: 'RANKED_SOLO_5x5', tier: 'GRANDMASTER', rank: 'I', leaguePoints: 412, wins: rankWins, losses: 80 }]);
    if (url.includes('/status/')) return ok({});
    return { status: 404, json: async () => null, headers: { get: () => null } };
  };
}

(async () => {
  // ---------------- synchro
  const data = emptyData();
  const p = { id: 'p1', riotId: 'secretalmasty#EUW', region: 'euw', role: 'Jungle', objectives: { 'CS/min': 7 } };
  data.players.push(p);
  const client = new RiotClient('RGAPI-test', { fetch: mockFetch(100), delayMs: 0, sleep: async () => {} });
  // dates des relevés de rang : juste avant la fin de la partie 106, puis juste après
  const start = n => 1763000000000 + n * 3600000;
  const T1 = start(106) - 10 * 60000, T3 = start(106) + 31 * 60000;
  const r1 = await syncPlayer(data, client, p, { maxGames: 30, now: () => T1 });
  assert.strictEqual(r1.added, 4, 'parties au rôle ajoutées');
  assert.strictEqual(r1.ignored, 1, 'partie hors rôle ignorée');
  assert.strictEqual(p.puuid, 'PUUID-1');
  const g = data.games.find(x => x.matchId === 'EUW1_101');
  assert.strictEqual(g.role, 'Jungle');
  assert.strictEqual(g.cs, 190);
  assert.strictEqual(g.cs10, 60);
  assert.strictEqual(g.goldDiff10, 250);
  assert.strictEqual(g.goldDiff15, 250);
  assert.strictEqual(g.deaths15, 1);
  assert.strictEqual(g.opponent, 'Champ7');
  assert.strictEqual(data.ranks.length, 1);
  assert.strictEqual(data.ranks[0].label, 'Grand Maître · 412 LP');
  assert.strictEqual(data.ranks[0].score, 3212);

  // deuxième synchro : aucune nouvelle partie, aucun doublon
  calls = [];
  const r2 = await syncPlayer(data, client, p, { maxGames: 30, now: () => T1 });
  assert.strictEqual(r2.added, 0);
  assert.strictEqual(data.games.length, 4);
  assert.ok(!calls.some(u => /matches\/EUW1_\d+$/.test(u)), 'pas de re-téléchargement');

  // LP : une seule nouvelle partie classée depuis le dernier relevé
  const mf = mockFetch(101);
  const c3 = new RiotClient('RGAPI-test', { fetch: async u => (u.includes('/ids?') ? { status: 200, json: async () => ['EUW1_106', 'EUW1_105'], headers: { get: () => null } } : mf(u)), delayMs: 0, sleep: async () => {} });
  data.ranks[0].lp = 392; data.ranks[0].score = 3192;
  const r3 = await syncPlayer(data, c3, p, { now: () => T3 });
  assert.strictEqual(r3.added, 1);
  assert.strictEqual(data.games.find(x => x.matchId === 'EUW1_106').lpDelta, 20);

  // ---------------- statistiques
  const rows = Stats.kpiTable(data, p, '');
  const by = Object.fromEntries(rows.map(r => [r.label, r]));
  assert.strictEqual(by['Parties jouées'].value, 5);
  assert.ok(Math.abs(by['CS/min'].value - 190 / 30) < 1e-9);
  assert.strictEqual(by['CS/min'].obj.value, 7);
  assert.strictEqual(by['CS/min'].obj.custom, true);
  assert.strictEqual(by['KP'].obj.value, 0.65);
  assert.strictEqual(by['LP net'].value, 20);
  const pool = Stats.groupBy(Stats.playerGames(data, p), 'champion');
  assert.strictEqual(pool.reduce((s, c) => s + c.games, 0), 5);

  // sessions
  const ses = { playerId: 'p1', date: new Date(1763000000000 + 103.5 * 3600000).toISOString().slice(0, 10), kpi: 'Morts avant 15 min', target: 2 };
  const sr = Stats.sessionResult(data, ses, p);
  assert.ok(sr.after !== null);

  // ---------------- clé refusée
  const bad = new RiotClient('RGAPI-x', { fetch: async () => ({ status: 403, json: async () => ({}), headers: { get: () => null } }), delayMs: 0, sleep: async () => {} });
  await assert.rejects(() => bad.status('euw'), e => e.code === 'KEY');

  // ---------------- stockage
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clol-'));
  const st = new Store(dir);
  st.data.players.push(p); st.save();
  const st2 = new Store(dir);
  assert.strictEqual(st2.data.players[0].riotId, 'secretalmasty#EUW');
  fs.writeFileSync(path.join(dir, 'coaching-data.json'), '{corrompu');
  const st3 = new Store(dir);
  assert.strictEqual(st3.data.players.length, 0);
  assert.ok(fs.readdirSync(dir).some(f => f.includes('illisible')), 'fichier corrompu mis de côté');

  console.log('✅ Tous les tests passent');
})().catch(e => { console.error('❌', e); process.exit(1); });
