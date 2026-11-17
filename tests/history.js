// Récupération de l'historique : pagination des identifiants (jusqu'à 300) et traitement par lots
const assert = require('assert');
const { emptyData } = require('../src/store');
const { syncPlayer } = require('../src/sync');

(async () => {
  const TOTAL = 230; // parties classées solo disponibles chez Riot
  const ids = Array.from({ length: TOTAL }, (_, i) => 'EUW1_' + (1000 + TOTAL - i)); // de la plus récente à la plus ancienne
  const pages = [];
  const client = {
    account: async () => ({ puuid: 'P' }),
    matchIds: async (puuid, region, { start, count }) => { pages.push(start); return ids.slice(start, start + count); },
    match: async id => {
      const n = Number(id.split('_')[1]);
      const pos = n % 3 === 0 ? 'TOP' : 'JUNGLE'; // un tiers hors rôle
      const me = { puuid: 'P', participantId: 1, teamId: 100, teamPosition: pos, championName: 'Viego', win: true, kills: 1, deaths: 1, assists: 1, totalMinionsKilled: 10, neutralMinionsKilled: 100 };
      return { metadata: { matchId: id }, info: { gameStartTimestamp: n * 1000, gameDuration: 1800, gameEndTimestamp: 1, participants: [me] } };
    },
    timeline: async () => null,
    leagues: async () => []
  };
  const data = emptyData();
  const p = { id: 'p', riotId: 'Aki#EUW', region: 'euw', role: 'Jungle' };
  data.players.push(p);
  let r, lots = 0;
  do { r = await syncPlayer(data, client, p, { maxGames: 30 }); lots++; } while (r.remaining > 0 && lots < 20);
  assert.deepStrictEqual(pages.slice(0, 3), [0, 100, 200], 'trois pages de 100');
  assert.strictEqual(data.games.length + data.ignored.length, TOTAL, 'toutes les parties vérifiées');
  assert.strictEqual(lots, Math.ceil(TOTAL / 30));
  assert.ok(data.games.length > 140 && data.ignored.length > 70);
  assert.strictEqual(p.statusText, 'À jour');
  // au lot suivant : rien de nouveau, aucun doublon
  const before = data.games.length;
  r = await syncPlayer(data, client, p, { maxGames: 30 });
  assert.strictEqual(r.added, 0);
  assert.strictEqual(data.games.length, before);
  console.log('✅ Historique complet (300 parties max, par lots) : tests OK');
})().catch(e => { console.error(e); process.exit(1); });
