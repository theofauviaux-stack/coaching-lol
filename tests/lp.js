// Tests du calcul des LP par partie à partir des relevés de rang
const assert = require('assert');
const { recordRank, attributeLp, lpSince } = require('../src/lp');
const MIN = 60000;
const entry = (lp, wins, losses, tier = 'MASTER') => [{ queueType: 'RANKED_SOLO_5x5', tier, rank: 'I', leaguePoints: lp, wins, losses }];
const game = (id, startMin, win) => ({ playerId: 'p', matchId: id, date: startMin * MIN, duration: 30, win, lpDelta: null });
const p = { id: 'p' };

// une partie entre deux relevés : valeur exacte
let d = { ranks: [], games: [game('A', 100, true)], ignored: [] };
assert.deepStrictEqual(recordRank(d, p, entry(500, 10, 10), 90 * MIN), { recorded: true, newGames: 0 });
assert.deepStrictEqual(recordRank(d, p, entry(500, 10, 10), 95 * MIN), { recorded: false, newGames: 0 }, 'rien de nouveau : pas de relevé');
assert.deepStrictEqual(recordRank(d, p, entry(521, 11, 10), 135 * MIN), { recorded: true, newGames: 1 });
assert.strictEqual(attributeLp(d, 'p'), 1);
assert.strictEqual(d.games[0].lpDelta, 21);
assert.strictEqual(d.games[0].lpEstimated, false);
assert.strictEqual(attributeLp(d, 'p'), 0, 'recalcul sans changement');

// partie récupérée après le relevé (la liste Riot arrive en retard) : attribuée au calcul suivant
d = { ranks: [], games: [], ignored: [] };
recordRank(d, p, entry(500, 10, 10), 90 * MIN);
recordRank(d, p, entry(480, 10, 11), 135 * MIN);
assert.strictEqual(attributeLp(d, 'p'), 0);
d.games.push(game('B', 100, false));
assert.strictEqual(attributeLp(d, 'p'), 1);
assert.strictEqual(d.games[0].lpDelta, -20);

// trois parties entre deux relevés (2 V, 1 D, +20 LP au total) : estimation +20 / -20
d = { ranks: [], games: [game('C', 100, true), game('D', 140, true), game('E', 180, false)], ignored: [] };
recordRank(d, p, entry(500, 10, 10), 90 * MIN);
recordRank(d, p, entry(520, 12, 11), 220 * MIN);
attributeLp(d, 'p');
assert.deepStrictEqual(d.games.map(g => g.lpDelta), [20, 20, -20]);
assert.ok(d.games.every(g => g.lpEstimated));

// que des victoires : partage égal
d = { ranks: [], games: [game('F', 100, true), game('G', 140, true)], ignored: [] };
recordRank(d, p, entry(500, 10, 10), 90 * MIN);
recordRank(d, p, entry(543, 12, 10), 180 * MIN);
attributeLp(d, 'p');
assert.deepStrictEqual(d.games.map(g => g.lpDelta), [22, 22]);

// victoires/défaites incohérentes avec Riot (3 V connues, Riot compte 2 V 1 D) : aucune estimation
d = { ranks: [], games: [game('X1', 100, true), game('X2', 140, true), game('X3', 180, true)], ignored: [] };
recordRank(d, p, entry(500, 10, 10), 90 * MIN);
recordRank(d, p, entry(530, 12, 11), 220 * MIN);
attributeLp(d, 'p');
assert.deepStrictEqual(d.games.map(g => g.lpDelta), [null, null, null]);
assert.deepStrictEqual(lpSince(d, 'p'), { delta: 30, from: 90 * MIN }, 'le total depuis le premier relevé reste exact');

// une partie hors rôle dans l'intervalle : le compte doit correspondre, sinon on n'attribue rien
d = { ranks: [], games: [game('H', 100, true)], ignored: [{ playerId: 'p', matchId: 'I', date: 140 * MIN, role: 'Top' }] };
recordRank(d, p, entry(500, 10, 10), 90 * MIN);
recordRank(d, p, entry(540, 12, 10), 180 * MIN);
attributeLp(d, 'p');
assert.strictEqual(d.games[0].lpDelta, 20, 'deux victoires dont une hors rôle : +20 chacune');
d = { ranks: [], games: [game('J', 100, true)], ignored: [] };
recordRank(d, p, entry(500, 10, 10), 90 * MIN);
recordRank(d, p, entry(540, 12, 10), 180 * MIN); // 2 parties comptées par Riot, 1 seule connue
attributeLp(d, 'p');
assert.strictEqual(d.games[0].lpDelta, null);

// LP saisis à la main : jamais remplacés ; une valeur exacte remplace une estimation
d = { ranks: [], games: [Object.assign(game('K', 100, true), { lpDelta: 15, lpManual: true })], ignored: [] };
recordRank(d, p, entry(500, 10, 10), 90 * MIN);
recordRank(d, p, entry(521, 11, 10), 135 * MIN);
attributeLp(d, 'p');
assert.strictEqual(d.games[0].lpDelta, 15);
d = { ranks: [], games: [Object.assign(game('L', 100, true), { lpDelta: 18, lpEstimated: true })], ignored: [] };
recordRank(d, p, entry(500, 10, 10), 90 * MIN);
recordRank(d, p, entry(521, 11, 10), 135 * MIN);
attributeLp(d, 'p');
assert.deepStrictEqual([d.games[0].lpDelta, d.games[0].lpEstimated], [21, false]);

// passage Diamant I → Maître : le score reste continu
d = { ranks: [], games: [game('M', 100, true)], ignored: [] };
recordRank(d, p, [{ queueType: 'RANKED_SOLO_5x5', tier: 'DIAMOND', rank: 'I', leaguePoints: 85, wins: 10, losses: 10 }], 90 * MIN);
recordRank(d, p, entry(5, 11, 10), 135 * MIN);
attributeLp(d, 'p');
assert.strictEqual(d.games[0].lpDelta, 20);
assert.deepStrictEqual(lpSince(d, 'p'), { delta: 20, from: 90 * MIN });

console.log('✅ LP par partie : tests OK');
