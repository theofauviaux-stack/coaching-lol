// Tests de la modification et de la suppression d'un profil joueur
const assert = require('assert');
const { updatePlayer, deletePlayer } = require('../src/players');
const base = () => ({
  players: [{ id: 'a', riotId: 'Secret#EUW', region: 'euw', role: 'Jungle', puuid: 'P' }, { id: 'b', riotId: 'B#EUW', region: 'euw', role: 'ADC' }],
  games: [{ playerId: 'a', matchId: 1 }, { playerId: 'b', matchId: 2 }],
  ignored: [{ playerId: 'a', matchId: 3, role: 'Top' }, { playerId: 'a', matchId: 4, role: 'supprimée' }],
  ranks: [{ playerId: 'a', date: 1 }], sessions: [{ id: 's', playerId: 'a' }]
});
// simple modification (objectif) : rien n'est effacé
let d = base();
let r = updatePlayer(d, d.players[0], { goal: 'GM' });
assert.strictEqual(r.resync, false);
assert.strictEqual(d.games.length, 2);
assert.strictEqual(d.players[0].goal, 'GM');
// même compte, casse différente : pas de changement de compte
d = base();
r = updatePlayer(d, d.players[0], { riotId: 'secret#euw' });
assert.strictEqual(r.accountChanged, false);
assert.strictEqual(d.players[0].puuid, 'P');
// autre compte : parties, rangs et parties écartées effacés, séances gardées
d = base();
r = updatePlayer(d, d.players[0], { riotId: 'Autre#EUW' });
assert.ok(r.accountChanged && r.resync);
assert.deepStrictEqual(d.games.map(g => g.playerId), ['b']);
assert.strictEqual(d.ranks.length, 0);
assert.strictEqual(d.ignored.length, 0);
assert.strictEqual(d.sessions.length, 1);
assert.strictEqual(d.players[0].puuid, '');
// nouveau rôle : les parties « hors rôle » sont réexaminées, celles retirées à la main restent retirées
d = base();
r = updatePlayer(d, d.players[0], { role: 'Top' });
assert.ok(r.roleChanged && r.resync);
assert.deepStrictEqual(d.ignored.map(g => g.matchId), [4]);
assert.strictEqual(d.games.length, 2);
// suppression : tout ce qui concerne le joueur disparaît, l'autre joueur reste intact
d = base();
deletePlayer(d, 'a');
assert.deepStrictEqual(d.players.map(p => p.id), ['b']);
assert.deepStrictEqual([d.games.length, d.ignored.length, d.ranks.length, d.sessions.length], [1, 0, 0, 0]);
console.log('✅ Modification et suppression de profils : tests OK');
