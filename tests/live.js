// Parties en direct et mode spectateur : tests sans réseau ni Electron.
const assert = require('assert');
const live = require('../src/live');
const { RiotClient } = require('../src/riot');

const P = (puuid, teamId, championId, riotId, extra = {}) => Object.assign({ puuid, teamId, championId, riotId, spell1Id: 4, spell2Id: championId === 64 ? 11 : 14, perks: { perkIds: [8112, 8126], perkStyle: 8100, perkSubStyle: 8300 } }, extra);
const raw = {
  gameId: 7123456789, platformId: 'EUW1', gameQueueConfigId: 420, gameStartTime: 1763500000000, gameLength: 312,
  observers: { encryptionKey: 'aB3+/xyzKEY0123456789abcd' },
  bannedChampions: [{ championId: 157, teamId: 200, pickTurn: 6 }, { championId: 238, teamId: 100, pickTurn: 1 }, { championId: -1, teamId: 100, pickTurn: 2 }],
  participants: [
    P('A1', 100, 64, 'UCE Kioga#EUWWW'), P('A2', 100, 103, 'Allie#EUW'), P('A3', 100, 222, 'X#1'), P('A4', 100, 412, 'Y#2'), P(null, 100, 86, ''),
    P('E1', 200, 121, 'Ennemi Jungle#EUW'), P('E2', 200, 7, 'Mid#KR1'), P('E3', 200, 51, 'Adc#EUW'), P('E4', 200, 53, 'Sup#EUW'), P('E5', 200, 122, 'Top#EUW')
  ]
};
const players = [{ id: 'p-kioga', puuid: 'A1', riotId: 'UCE Kioga#EUWWW' }, { id: 'p-autre', puuid: 'ZZ', riotId: 'Autre#EUW' }];
const keys = { 64: 'LeeSin', 103: 'Ahri', 121: 'Khazix', 157: 'Yasuo', 238: 'Zed', 86: 'Garen' };

// ---------------- rang Solo/Duo
assert.strictEqual(live.soloRank([{ queueType: 'RANKED_FLEX_SR', tier: 'GOLD', rank: 'I', leaguePoints: 3 }]), null);
const r = live.soloRank([{ queueType: 'RANKED_SOLO_5x5', tier: 'EMERALD', rank: 'II', leaguePoints: 47, wins: 60, losses: 52 }]);
assert.strictEqual(r.label, 'Émeraude II');
assert.strictEqual(r.lp, 47);
assert.strictEqual(live.soloRank([{ queueType: 'RANKED_SOLO_5x5', tier: 'MASTER', rank: 'I', leaguePoints: 120, wins: 1, losses: 1 }]).label, 'Maître');

// ---------------- partie vue depuis l'équipe du joueur suivi
const g = live.buildGame(raw, players, { A1: r, E1: null }, keys, 1763500100000);
const byP = (list, id) => list.find(x => x.puuid === id);
assert.strictEqual(g.gameId, 7123456789);
assert.deepStrictEqual(g.playerIds, ['p-kioga']);
assert.strictEqual(g.allies.length, 5);
assert.strictEqual(g.enemies.length, 5);
const kio = byP(g.allies, 'A1');
assert.strictEqual(kio.champion, 'LeeSin');
assert.strictEqual(kio.gameName, 'UCE Kioga');
assert.strictEqual(kio.tagLine, 'EUWWW');
assert.strictEqual(kio.rank.label, 'Émeraude II');
assert.strictEqual(g.allies.find(x => !x.puuid).hidden, true, 'joueur anonyme');
assert.strictEqual(byP(g.enemies, 'E1').gameName, 'Ennemi Jungle');
assert.strictEqual(byP(g.enemies, 'E1').rank, null, 'non classé');
assert.deepStrictEqual(kio.spells, [4, 11]);
assert.strictEqual(kio.keystone, 8112);
// postes : chaque équipe rangée top, jungle, mid, ADC, support
assert.deepStrictEqual(g.allies.map(x => x.championId), [86, 64, 103, 222, 412], 'Garen, Lee Sin, Ahri, Jinx, Thresh');
assert.deepStrictEqual(g.allies.map(x => x.position), live.POSITIONS);
assert.deepStrictEqual(g.enemies.map(x => x.championId), [122, 121, 7, 51, 53], 'Darius, Kha\'Zix, LeBlanc, Caitlyn, Blitzcrank');
assert.deepStrictEqual(g.bans, { allies: ['Zed'], enemies: ['Yasuo'] }, 'bans par équipe, sans les « pas de ban »');
assert.strictEqual(g.key, 'aB3+/xyzKEY0123456789abcd');
// le joueur suivi est dans l'équipe rouge : les « alliés » sont l'équipe rouge
const g2 = live.buildGame(raw, [{ id: 'p-e2', puuid: 'E2', riotId: 'Mid#KR1' }], {}, keys);
assert.strictEqual(g2.teamId, 200);
assert.strictEqual(byP(g2.allies, 'E2').playerId, 'p-e2');
assert.strictEqual(g2.enemies[1].champion, 'LeeSin', 'en face : jungle contre jungle');
// chronomètre : depuis le début réel, sinon depuis la durée donnée par Riot
assert.strictEqual(live.elapsed(g, 1763500000000 + 125000), 125);
assert.strictEqual(live.elapsed({ startTime: null, length: 30, fetchedAt: 1000 }, 11000), 40);


// ---------------- emplacement de League of Legends
const io = files => ({ exists: f => files.includes(f), read: f => { if (f in (io.texts || {})) return io.texts[f]; throw new Error('absent'); } });
const MAC_EXE = '/Applications/League of Legends.app/Contents/LoL/Game/LeagueofLegends.app/Contents/MacOS/LeagueofLegends';
let ins = live.findInstall('darwin', io([MAC_EXE]), '');
assert.strictEqual(ins.gameDir, '/Applications/League of Legends.app/Contents/LoL/Game');
assert.strictEqual(ins.config, '/Applications/League of Legends.app/Contents/LoL/Config/LeagueClientSettings.yaml');
assert.strictEqual(live.findInstall('darwin', io([]), ''), null);
// chemin personnalisé : le dossier qui contient l'app, l'app elle-même ou un chemin à l'intérieur
const OTHER = '/Volumes/Jeux/League of Legends.app/Contents/LoL/Game/LeagueofLegends.app/Contents/MacOS/LeagueofLegends';
for (const c of ['/Volumes/Jeux', '/Volumes/Jeux/', '/Volumes/Jeux/League of Legends.app', '/Volumes/Jeux/League of Legends.app/Contents/LoL']) {
  assert.strictEqual(live.findInstall('darwin', io([OTHER]), c).exe, OTHER, c);
}
const WIN_EXE = 'C:\\Riot Games\\League of Legends\\Game\\League of Legends.exe';
ins = live.findInstall('win32', io([WIN_EXE]), '');
assert.strictEqual(ins.gameDir, 'C:\\Riot Games\\League of Legends\\Game');
const D_EXE = 'E:\\Jeux\\LoL\\Game\\League of Legends.exe';
const wio = io([D_EXE]);
io.texts = { 'C:\\ProgramData\\Riot Games\\Metadata\\league_of_legends.live\\league_of_legends.live.product_settings.yaml': 'product_install_full_path: "E:/Jeux/LoL"\nproduct_install_root: "E:/Jeux"\n' };
assert.strictEqual(live.findInstall('win32', wio, '').exe, D_EXE, 'emplacement lu dans les réglages du Riot Client');
io.texts = {};
for (const c of ['E:\\Jeux\\LoL', 'E:\\Jeux\\LoL\\Game', 'E:\\Jeux\\LoL\\Game\\League of Legends.exe']) assert.strictEqual(live.findInstall('win32', wio, c).exe, D_EXE, c);

// ---------------- smurfs
let sm = live.parseSmurfs('Smurf Kio#EUW, autre # 123\nmauvais\nsmurf kio#euw\n\n');
assert.deepStrictEqual(sm.list, ['Smurf Kio#EUW', 'autre#123'], 'doublons et espaces autour du # retirés');
assert.deepStrictEqual(sm.bad, ['mauvais']);
assert.strictEqual(live.parseSmurfs('A#EUW,B#EUW,C#EUW,D#EUW,E#EUW,F#EUW,G#EUW').tooMany, true);
const withSmurf = [{ id: 'p-kioga', puuid: 'A1', riotId: 'UCE Kioga#EUWWW', region: 'euw', smurfs: [{ riotId: 'Ennemi Jungle#EUW', puuid: 'E1' }, { riotId: 'Pas encore#EUW', puuid: '' }] }];
assert.deepStrictEqual(live.trackedAccounts(withSmurf).map(a => [a.puuid, a.playerId, a.smurf]), [['A1', 'p-kioga', null], ['E1', 'p-kioga', 'Ennemi Jungle#EUW']], 'smurf sans puuid ignoré');
// joueur suivi seulement par son smurf (compte principal pas dans la partie)
const g3 = live.buildGame(raw, [{ id: 'p-x', puuid: 'ZZ', riotId: 'Main#EUW', smurfs: [{ riotId: 'Mid#KR1', puuid: 'E2' }] }], {}, keys);
assert.deepStrictEqual(g3.playerIds, ['p-x']);
assert.strictEqual(g3.teamId, 200);
assert.strictEqual(byP(g3.allies, 'E2').smurf, 'Mid#KR1');
assert.strictEqual(byP(g3.allies, 'E2').playerId, 'p-x');
assert.strictEqual(kio.smurf, null);

// ---------------- postes devinés
const T = (c, s1, s2, role) => ({ championId: c, spells: [s1, s2], role });
assert.deepStrictEqual(live.assignPositions([T(412, 4, 14), T(222, 4, 7), T(64, 11, 4), T(122, 12, 4), T(103, 4, 14)]), ['UTILITY', 'BOTTOM', 'JUNGLE', 'TOP', 'MIDDLE'], 'équipe classique mélangée');
assert.deepStrictEqual(live.assignPositions([T(103, 11, 4), T(64, 4, 14), T(222, 4, 7), T(412, 4, 3), T(122, 12, 4)]), ['JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY', 'TOP'], 'Châtiment = jungle, même sur Ahri');
assert.deepStrictEqual(live.assignPositions([T(99999, 12, 4), T(64, 11, 4), T(103, 4, 14), T(222, 4, 7), T(412, 4, 3)]), ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'], 'champion inconnu : le poste qui reste');
// deux mids possibles : le rôle coaché du joueur départage
assert.deepStrictEqual(live.assignPositions([T(103, 4, 14, 'Support'), T(1, 4, 14), T(64, 11, 4), T(122, 12, 4), T(222, 4, 7)]), ['UTILITY', 'MIDDLE', 'JUNGLE', 'TOP', 'BOTTOM']);
assert.strictEqual(live.assignPositions([T(103, 4, 14)]), null, 'équipe incomplète : pas de postes');
assert.strictEqual(live.compactRates({ data: { 1: {} } }), null, 'table vide refusée');
const cr = live.compactRates({ patch: '16.3', data: Object.fromEntries(Array.from({ length: 120 }, (_, i) => [String(i + 1), { TOP: { playRate: 3 }, JUNGLE: { playRate: 1 }, MIDDLE: { playRate: 0 }, BOTTOM: { playRate: 0 }, UTILITY: { playRate: 0 } }])) });
assert.deepStrictEqual(cr.data['1'], [0.75, 0.25, 0, 0, 0]);

// ---------------- relance automatique du mode spectateur
Promise.resolve().then(() => {
// ---------------- client Riot : partie en cours et adresse de test
return (async () => {
  const urls = [];
  const fetch = async url => { urls.push(url); return url.includes('/active-games/by-summoner/A1') ? { status: 200, json: async () => raw } : { status: 404, json: async () => null }; };
  const c = new RiotClient('RGAPI-test', { fetch, delayMs: 0 });
  assert.strictEqual((await c.activeGame('A1', 'euw')).gameId, 7123456789);
  assert.strictEqual(await c.activeGame('ZZ', 'euw'), null, 'pas en partie : null');
  assert.strictEqual(urls[0], 'https://euw1.api.riotgames.com/lol/spectator/v5/active-games/by-summoner/A1');
  const t = new RiotClient('RGAPI-test', { fetch, delayMs: 0, base: 'http://127.0.0.1:9' });
  await t.activeGame('A1', 'kr');
  assert.strictEqual(urls[2], 'http://127.0.0.1:9/lol/spectator/v5/active-games/by-summoner/A1');
  console.log('✅ Parties en direct, smurfs et mode spectateur : OK');
})();
}).catch(e => { console.error(e); process.exit(1); });
