// Parties personnalisées : conversion du format du client LoL (v4) vers le format match-v5 de l'app
const assert = require('assert');
const C = require('../src/custom');
const { gameFromMatch } = require('../src/sync');
const { buildMoments } = require('../src/moments');
const lcu = require('./fixtures/lcu-v4');

const keys = { 122: 'Darius', 64: 'LeeSin', 103: 'Ahri', 222: 'Jinx', 412: 'Thresh', 86: 'Garen', 121: 'Khazix', 7: 'Leblanc', 51: 'Caitlyn', 53: 'Blitzcrank' };
const f = lcu('P-DARIUS', 7300000777);

// liste : seulement les personnalisées, la plus récente d'abord
const list = C.listCustoms(f.list, keys);
assert.deepStrictEqual(list.map(x => [x.gameId, x.champion, x.sr, x.win, x.duration]), [[7300000777, 'Darius', true, false, 1200], [7300000775, 'Ahri', false, true, 900]]);
assert.deepStrictEqual(C.listCustoms(null), []);
assert.deepStrictEqual(C.listCustoms({ games: [] }), []);

// conversion v4 → v5
const { match, tl } = C.toV5(f.game, f.timeline, keys);
assert.strictEqual(match.metadata.matchId, 'EUW1_7300000777');
assert.strictEqual(match.info.gameDuration, 1200);
assert.strictEqual(match.info.gameEndTimestamp, match.info.gameStartTimestamp + 1200000);
const me = match.info.participants.find(p => p.puuid === 'P-DARIUS');
assert.deepStrictEqual([me.championName, me.teamPosition, me.riotIdGameName, me.riotIdTagline, me.kills, me.deaths], ['Darius', 'TOP', 'UCE Uawawa', '000', 1, 2]);
assert.deepStrictEqual(match.info.participants.filter(p => p.teamId === 100).map(p => p.teamPosition), ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY']);
const ev = tl.info.frames.flatMap(x => x.events);
assert.strictEqual(ev.find(e => e.type === 'ELITE_MONSTER_KILL' && e.monsterType === 'DRAGON').killerTeamId, 100, 'équipe du tueur retrouvée');
assert.strictEqual(ev.find(e => e.type === 'LEVEL_UP' && e.participantId === 1 && e.level === 6).timestamp, 360000, 'niveau 6 déduit des points de compétence');

// sans postes dans le client : devinés (champions + sorts)
const noLanes = C.toV5(lcu('P-DARIUS', 7300000777, false).game, null, keys).match;
assert.deepStrictEqual(noLanes.info.participants.filter(p => p.teamId === 100).map(p => p.teamPosition), ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY']);
assert.throws(() => C.toV5({}, null, keys), /illisible/);

// même résultat que pour une classée : partie et moments clés
const g = gameFromMatch(match, tl, me, 'p1');
const ref = gameFromMatch(f.v5.match, f.v5.timeline, f.v5.match.info.participants[0], 'p1');
for (const k of ['champion', 'opponent', 'win', 'duration', 'kills', 'deaths', 'cs10', 'goldDiff10', 'xpDiff10', 'goldDiff15', 'deaths15', 'role', 'side']) assert.deepStrictEqual(g[k], ref[k], k);
const m = buildMoments(match, tl, 'P-DARIUS');
const mref = buildMoments(f.v5.match, f.v5.timeline, 'P-DARIUS');
assert.deepStrictEqual(m.moments.map(x => [x.t, x.type, x.title]), mref.moments.map(x => [x.t, x.type, x.title]), 'mêmes moments clés');
assert.strictEqual(m.matchId, 'EUW1_7300000777');

// partie gardée telle quelle : seulement les champs connus, marquée « perso », jamais de LP
const cg = C.cleanGame(Object.assign({}, g, { matchId: 'EUW1_7300000777', lpDelta: 25, comment: 'pirate', extra: 'x', kills: 'beaucoup' }));
assert.deepStrictEqual([cg.custom, cg.lpDelta, cg.comment, cg.extra, cg.kills, cg.champion], [true, null, '', undefined, null, 'Darius']);
assert.strictEqual(C.cleanGame({ matchId: 'pas un id', playerId: 'p1' }), null);
assert.strictEqual(C.cleanGame(null), null);

console.log('✅ Parties personnalisées (conversion depuis le client LoL) : OK');
