// Test de bout en bout des parties en direct : faux serveur Riot (spectator-v5 + league-v4) + app du coach.
// Usage : node tests/e2e-live.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { emptyData } = require('../src/store');

const DIR = '/tmp/e2e-live';
const NOW = Date.now();

// ---------------------------------------------------------------- faux serveur Riot
const part = (puuid, teamId, championId, riotId, spells = [4, 11], perks = [8112, 8139]) => ({
  puuid, teamId, championId, riotId, spell1Id: spells[0], spell2Id: spells[1], bot: false, profileIconId: 1,
  perks: { perkIds: perks, perkStyle: 8100, perkSubStyle: perks[0] === 8010 ? 8400 : 8300 }
});
const GAMES = {
  partie1: { gameId: 7300000001, platformId: 'EUW1', gameQueueConfigId: 420, gameMode: 'CLASSIC', gameType: 'MATCHED', mapId: 11, gameStartTime: NOW - 14 * 60000 - 23000, gameLength: 860,
    observers: { encryptionKey: 'k8Jd2+PqZ0aB/cDeF1gHiJ2kLmN3oPq4' },
    bannedChampions: [{ championId: 157, teamId: 100, pickTurn: 1 }, { championId: 238, teamId: 100, pickTurn: 2 }, { championId: 555, teamId: 100, pickTurn: 3 }, { championId: 11, teamId: 100, pickTurn: 4 }, { championId: 84, teamId: 100, pickTurn: 5 },
      { championId: 145, teamId: 200, pickTurn: 6 }, { championId: 117, teamId: 200, pickTurn: 7 }, { championId: 350, teamId: 200, pickTurn: 8 }, { championId: -1, teamId: 200, pickTurn: 9 }, { championId: 875, teamId: 200, pickTurn: 10 }],
    participants: [
      part('A-ADC', 100, 222, 'Get Excited#JINX', [4, 7], [8008, 9101]), part('P-HAVEHOPE', 100, 412, 'HaveHope#305', [4, 14], [8439, 8446]), part('A-MID', 100, 103, 'Foxfire#EUW', [4, 14], [8112, 8139]),
      part('A-TOP', 100, 122, 'Noxus Hand#EUW', [12, 4], [8010, 9111]), part('P-KIOGA', 100, 64, 'UCE Kioga#EUWWW', [11, 4], [8010, 9111]),
      part('E-SUP', 200, 53, 'Steam Golem#EUW', [4, 14], [8439, 8446]), part('E-JGL', 200, 121, 'Void Bug#EUW', [11, 4], [8112, 8139]), part('E-ADC', 200, 51, 'Piltover Sniper#EUW', [4, 7], [8008, 9101]),
      part(null, 200, 7, '', [4, 12], [8112, 8139]), part('E-TOP', 200, 86, 'Demacia#FR1', [12, 4], [8010, 9111])
    ] },
  partie2: { gameId: 7300000002, platformId: 'EUW1', gameQueueConfigId: 420, gameStartTime: 0, gameLength: 40,
    observers: { encryptionKey: 'Zx9+YwVu8/TsRq7PoNm6LkJi5HgFe4Dc' },
    bannedChampions: [],
    participants: [
      part('B-1', 100, 266, 'Darkin Blade#EUW'), part('B-2', 100, 254, 'Enforcer#EUW'), part('B-3', 100, 99, 'Lady Light#EUW'), part('B-4', 100, 145, 'Void Hunter#EUW'), part('B-5', 100, 89, 'Leona#SUN'),
      part('C-1', 200, 24, 'Weapon Master#EUW'), part('C-2', 200, 59, 'Exemplar#EUW'), part('P-KASKET', 200, 4, 'UCE KasKet#BOMBA'), part('C-4', 200, 236, 'Purifier#EUW'), part('C-5', 200, 432, 'Wanderer#EUW')
    ] },
  aram: { gameId: 7300000003, platformId: 'EUW1', gameQueueConfigId: 450, gameStartTime: NOW - 5 * 60000, gameLength: 300, observers: { encryptionKey: 'aramKEYaramKEYaramKEY' }, bannedChampions: [],
    participants: [part('P-QUEST', 100, 22, 'UCE Questinou#000')] },
  smurf: { gameId: 7300000005, platformId: 'EUW1', gameQueueConfigId: 420, gameStartTime: NOW - 6 * 60000, gameLength: 360, observers: { encryptionKey: 'SmUrFkEySmUrFkEySmUrFk' }, bannedChampions: [],
    participants: [part('F-1', 100, 39, 'Blade Dancer#EUW'), part('F-2', 100, 113, 'Snow Rider#EUW'), part('F-3', 100, 38, 'Void Walker#EUW'), part('S-QUEST', 100, 202, 'Quest Smurf#EUW', [4, 7], [8008, 9101]), part('F-5', 100, 497, 'Charmer#EUW'),
      part('G-1', 200, 98, 'Twilight#EUW'), part('G-2', 200, 427, 'Treant#EUW'), part('G-3', 200, 134, 'Dark Sovereign#EUW'), part('G-4', 200, 110, 'Arrow Rain#EUW'), part('G-5', 200, 111, 'Tidal#EUW')] },
  partie3: { gameId: 7300000004, platformId: 'EUW1', gameQueueConfigId: 420, gameStartTime: NOW, gameLength: 0, observers: { encryptionKey: 'NeWkEyNeWkEyNeWkEyNeWk' }, bannedChampions: [],
    participants: [part('P-UAWAWA', 100, 17, 'UCE Uawawa#000'), part('D-2', 200, 1, 'Annie Bot#EUW')] }
};
const where = { 'P-KIOGA': 'partie1', 'P-HAVEHOPE': 'partie1', 'P-KASKET': 'partie2', 'P-QUEST': 'aram', 'S-QUEST': 'smurf' };
const TIERS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER'];
const calls = { spectator: {}, league: {}, match: 0, lcu: [], replay: [], resultat: 0 };
// faux client LoL (replays) et faux jeu (Replay API)
const rp = { state: 'download', polls: 0, watching: false, loading: 3, time: 0, selection: '' };
const partieMoments = require('./fixtures/partie-moments')('P-UAWAWA');
function rankFor(puuid) {
  if (puuid === 'E-JGL') return []; // non classé
  if (puuid === 'P-KIOGA') return [{ queueType: 'RANKED_SOLO_5x5', tier: 'EMERALD', rank: 'II', leaguePoints: 47, wins: 61, losses: 52 }];
  const h = [...puuid].reduce((a, c) => a + c.charCodeAt(0), 0);
  const tier = TIERS[3 + (h % 4)];
  return [{ queueType: 'RANKED_SOLO_5x5', tier, rank: ['I', 'II', 'III', 'IV'][h % 4], leaguePoints: h % 100, wins: 40 + (h % 30), losses: 38 + (h % 25) },
    { queueType: 'RANKED_FLEX_SR', tier: 'IRON', rank: 'IV', leaguePoints: 0, wins: 1, losses: 9 }];
}
function startRiot() {
  const srv = http.createServer((req, res) => {
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => handle(req, res, raw ? JSON.parse(raw) : null));
  });
  function handle(req, res, body) {
    const send = (code, b) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(b === undefined ? '' : JSON.stringify(b)); };
    let m;
    if (req.url.startsWith('/lol-replays/')) {
      calls.lcu.push(req.method + ' ' + req.url + (body ? ' ' + JSON.stringify(body) : '') + ' ' + (req.headers.authorization || ''));
      if (req.url === '/lol-replays/v1/configuration') return send(200, { isReplaysEnabled: true, isPatching: false });
      if (req.url === '/lol-replays/v1/metadata/7300000099') {
        if (rp.state === 'downloading' && ++rp.polls > 2) rp.state = 'watch';
        return send(200, { gameId: 7300000099, state: rp.state, downloadProgress: rp.polls / 3 });
      }
      if (req.url === '/lol-replays/v1/rofls/7300000099/download') { rp.state = 'downloading'; return send(204); }
      if (req.url === '/lol-replays/v1/rofls/7300000099/watch') { rp.watching = true; return send(204); }
      return send(404, {});
    }
    if (req.url.startsWith('/replay/')) {
      calls.replay.push(req.method + ' ' + req.url + (body ? ' ' + JSON.stringify(body) : ''));
      if (!rp.watching || rp.loading-- > 0) return send(503, {});
      if (req.url === '/replay/playback') {
        if (req.method === 'POST' && body && typeof body.time === 'number') rp.time = body.time;
        return send(200, { time: rp.time, seeking: false, paused: false, speed: 1, length: 1200 });
      }
      if (req.url === '/replay/render') {
        if (req.method === 'POST' && body && body.selectionName === 'Darius') rp.selection = 'Darius';
        return send(200, { selectionName: rp.selection, cameraAttached: !!rp.selection });
      }
      return send(404, {});
    }
    if (req.url === '/__fin') { delete where['P-KIOGA']; delete where['P-HAVEHOPE']; return send(200, {}); }
    if (req.url === '/__nouvelle') { where['P-UAWAWA'] = 'partie3'; return send(200, {}); }
    if (req.url === '/__plus-rien') { for (const k of Object.keys(where)) delete where[k]; return send(200, {}); }
    if ((m = req.url.match(/\/riot\/account\/v1\/accounts\/by-riot-id\/([^/]+)\/([^/?]+)/))) {
      const id = decodeURIComponent(m[1]) + '#' + decodeURIComponent(m[2]);
      return id === 'Quest Smurf#EUW' ? send(200, { puuid: 'S-QUEST', gameName: 'Quest Smurf', tagLine: 'EUW' }) : send(404, { status: { message: 'Data not found', status_code: 404 } });
    }
    if (req.url.startsWith('/lol/match/v5/matches/EUW1_7300000001')) {
      calls.resultat++;
      if (calls.resultat === 1) return send(404, { status: { message: 'Data not found', status_code: 404 } }); // pas encore publiée
      return send(200, { metadata: { matchId: 'EUW1_7300000001' }, info: { gameId: 7300000001, gameDuration: 1712, participants: [
        { puuid: 'P-KIOGA', championName: 'LeeSin', win: true, kills: 7, deaths: 2, assists: 9, totalMinionsKilled: 150, neutralMinionsKilled: 40 },
        { puuid: 'P-HAVEHOPE', championName: 'Thresh', win: true, kills: 1, deaths: 0, assists: 14, totalMinionsKilled: 30, neutralMinionsKilled: 0 },
        { puuid: 'E-ADC', championName: 'Caitlyn', win: false, kills: 3, deaths: 6, assists: 2 }] } });
    }
    if (req.url.startsWith('/lol/match/v5/matches/EUW1_7300000099')) {
      calls.match++;
      return send(200, req.url.endsWith('/timeline') ? partieMoments.timeline : partieMoments.match);
    }
    if ((m = req.url.match(/\/lol\/spectator\/v5\/active-games\/by-summoner\/([^/?]+)/))) {
      calls.spectator[m[1]] = (calls.spectator[m[1]] || 0) + 1;
      return where[m[1]] ? send(200, GAMES[where[m[1]]]) : send(404, { status: { message: 'Data not found', status_code: 404 } });
    }
    if ((m = req.url.match(/\/lol\/league\/v4\/entries\/by-puuid\/([^/?]+)/))) {
      calls.league[m[1]] = (calls.league[m[1]] || 0) + 1;
      return send(200, rankFor(m[1]));
    }
    return send(404, {});
  }
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ url: 'http://127.0.0.1:' + srv.address().port, close: () => srv.close() })));
}

(async () => {
  fs.rmSync(DIR, { recursive: true, force: true });
  fs.mkdirSync(path.join(DIR, 'coach'), { recursive: true });
  // fausse installation de League of Legends (organisation Mac)
  const app = path.join(DIR, 'Jeux', 'League of Legends.app');
  fs.mkdirSync(path.join(app, 'Contents/LoL/Game/LeagueofLegends.app/Contents/MacOS'), { recursive: true });
  fs.mkdirSync(path.join(app, 'Contents/LoL/Config'), { recursive: true });
  const exe = path.join(app, 'Contents/LoL/Game/LeagueofLegends.app/Contents/MacOS/LeagueofLegends');
  fs.writeFileSync(exe, '#!/bin/sh\nexit 0\n'); // jamais lancé : sert seulement à trouver l'installation
  fs.chmodSync(exe, 0o755);
  fs.writeFileSync(path.join(app, 'Contents/LoL/Config/LeagueClientSettings.yaml'), 'install:\n    globals:\n        locale: "fr_FR"\n        region: "EUW"\n');

  const d = emptyData();
  const roles = { 'UCE Uawawa#000': 'Top', 'UCE Kioga#EUWWW': 'Jungle', 'UCE KasKet#BOMBA': 'Mid', 'UCE Questinou#000': 'ADC', 'HaveHope#305': 'Support' };
  const puuids = { 'UCE Uawawa#000': 'P-UAWAWA', 'UCE Kioga#EUWWW': 'P-KIOGA', 'UCE KasKet#BOMBA': 'P-KASKET', 'UCE Questinou#000': 'P-QUEST', 'HaveHope#305': 'P-HAVEHOPE' };
  let n = 0;
  for (const [riotId, role] of Object.entries(roles)) d.players.push({ id: 'p' + (++n), riotId, region: 'euw', role, puuid: puuids[riotId], code: String(5100 + n), objectives: {}, createdAt: NOW });
  Object.assign(d.settings, JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'ddragon.json'), 'utf8')));
  d.settings.coachCode = '4821';
  d.settings.items = { 1055: ['Lame de Doran', 450], 2003: ['Potion de soin', 50], 3133: ['Marteau de guerre de Caulfield', 1100], 3071: ['Couperet noir', 3000] };
  d.games.push({ matchId: 'EUW1_7300000099', playerId: 'p1', date: NOW - 3600000, role: 'Top', champion: 'Darius', opponent: 'Garen', win: false, duration: 20, kills: 1, deaths: 2, assists: 0, teamKills: 3,
    cs: 140, gold: 7400, damage: 9000, vision: 12, wardsPlaced: 4, wardsKilled: 1, pinks: 1, level: 13, side: 'Bleu', cs10: 70, goldDiff10: -200, xpDiff10: 0, goldDiff15: -300, deaths15: 1, lpDelta: null, mental: null, objectiveMet: null, comment: '' });
  d.settings.apiKey = 'RGAPI-test-en-direct';
  d.settings.lolPath = path.join(DIR, 'Jeux');
  fs.writeFileSync(path.join(DIR, 'coach', 'coaching-data.json'), JSON.stringify(d));

  const riot = await startRiot();
  await new Promise(resolve => {
    const p = spawn('xvfb-run', ['-a', '-s', '-screen 0 1440x900x24', path.join(__dirname, '..', 'node_modules/.bin/electron'), path.join(__dirname, '..'), '--no-sandbox'], {
      env: Object.assign({}, process.env, { SYNC_DIR: DIR, COACHING_LOL_DATA: path.join(DIR, 'coach'), COACHING_LOL_FAST: '1', COACHING_LOL_TEST: path.join(__dirname, 'ui-live.js'),
        COACHING_LOL_RIOT: riot.url, COACHING_LOL_LCU: riot.url, COACHING_LOL_REPLAY: riot.url, COACHING_LOL_CLOUD: JSON.stringify({ url: riot.url, publicKey: 'cle-publique-test' }) }),
      stdio: 'ignore'
    });
    p.on('exit', resolve);
  });
  riot.close();
  spawn('pkill', ['-f', 'e2e-live/Jeux']);
  const r = JSON.parse(fs.readFileSync(path.join(DIR, 'resultat.json'), 'utf8'));
  assert.ok(!r.exception, r.exception);
  assert.strictEqual(r.parties, 2, 'deux parties classées : l\'ARAM de Questinou est ignorée');
  assert.deepStrictEqual(r.stable, { wrap: true, img: true, logo: true, nav: true, lignes: true, nom: true }, 'mise à jour sans recréer la page : ' + JSON.stringify(r.stable));
  assert.deepStrictEqual(r.stableRetour, { wrap: true, nom: true });
  assert.deepStrictEqual(r.pastilles.sort(), ['HaveHope#305', 'UCE KasKet#BOMBA', 'UCE Kioga#EUWWW'], 'pastille « En partie » sur l\'accueil');
  assert.strictEqual(r.badge, '2');
  assert.strictEqual(r.cartes.length, 2);
  assert.ok(/UCE Kioga et HaveHope/.test(r.cartes[0].titre), r.cartes[0].titre);
  assert.strictEqual(r.cartes[0].lignes, 10);
  assert.strictEqual(r.cartes[0].nous, 2, 'Kioga et HaveHope surlignés');
  assert.ok(r.cartes[0].texte.includes('Émeraude II 47 LP'), 'rang Solo/Duo de Kioga');
  assert.ok(r.cartes[0].texte.includes('Non classé'));
  assert.ok(r.cartes[0].texte.includes('Joueur masqué'));
  assert.ok(r.cartes[0].texte.includes('Lee Sin') && r.cartes[0].texte.includes("Kha'Zix"), 'noms français des champions');
  assert.strictEqual(r.cartes[0].bans, 9, 'bans affichés (le « pas de ban » est ignoré)');
  assert.ok(/^1[45]:\d\d$/.test(r.cartes[0].chrono), 'chrono de la partie : ' + r.cartes[0].chrono);
  // face à face, poste par poste (l'API les donne dans le désordre)
  assert.deepStrictEqual(r.cartes[0].postes, ['Top', 'Jungle', 'Mid', 'ADC', 'Support']);
  assert.deepStrictEqual(r.cartes[0].allies, ['Darius', 'Lee Sin', 'Ahri', 'Jinx', 'Thresh']);
  assert.deepStrictEqual(r.cartes[0].adversaires, ['Garen', "Kha'Zix", 'LeBlanc', 'Caitlyn', 'Blitzcrank']);
  assert.ok(/Postes devinés/.test(r.cartes[0].texte));
  assert.ok(/écran de chargement/.test(r.cartes[1].texte), 'partie encore au chargement');
  assert.ok(/Adversaires/.test(r.cartes[1].texte));
  // plus de bouton « Regarder »
  assert.strictEqual(r.boutonsRegarder, 0, 'pas de bouton Regarder');
  assert.ok(/le résultat \(victoire ou défaite, K\/D\/A\) s'affiche en pop-up/.test(r.cartes[0].texte), r.cartes[0].texte);
  // smurfs
  assert.ok(/Smurf introuvable chez Riot : Inconnu#XXX/.test(r.toastSmurfInconnu), r.toastSmurfInconnu);
  assert.deepStrictEqual(r.smurfsEnregistres, [{ riotId: 'Quest Smurf#EUW', puuid: 'S-QUEST' }]);
  assert.strictEqual(r.partiesAvecSmurf, 3);
  assert.ok(/UCE Questinou sur son smurf Quest Smurf/.test(r.carteSmurf.titre), r.carteSmurf.titre);
  assert.ok(/smurf de UCE Questinou/.test(r.carteSmurf.texte));
  assert.ok(/Smurfs : Quest Smurf#EUW/.test(r.ficheJoueur), r.ficheJoueur);
  assert.ok(/Emplacement de League of Legends/.test(r.reglage) && /League of Legends trouvé/.test(r.reglage) && !/Regarder/.test(r.reglage), r.reglage);
  // fin de partie, nouvelle partie, plus rien
  assert.strictEqual(r.apresFin, 2, 'restent KasKet et le smurf de Questinou');
  // fin de partie : pop-up avec le résultat de Kioga et HaveHope, une fois la partie publiée par Riot (2e essai)
  assert.ok(calls.resultat >= 2, 'partie cherchée jusqu\'à sa publication');
  assert.strictEqual(r.popup.classe, 'res-card win');
  assert.ok(/Partie terminée/.test(r.popup.texte) && /Victoire · UCE Kioga/.test(r.popup.texte) && /Victoire · HaveHope/.test(r.popup.texte), r.popup.texte);
  assert.ok(/7 \/ 2 \/ 9/.test(r.popup.texte) && /KDA 8 · 190 CS · 29 min/.test(r.popup.texte), r.popup.texte);
  assert.ok(/1 \/ 0 \/ 14/.test(r.popup.texte) && /KDA parfait/.test(r.popup.texte), r.popup.texte);
  assert.strictEqual(r.popupApresFermeture, 0, 'pop-up fermée');
  assert.strictEqual(r.voirSesParties, 'parties', '« Voir ses parties » ouvre les parties du joueur');
  assert.ok(/Partie classée en cours/.test(r.notification) && /UCE Uawawa/.test(r.notification), r.notification);
  assert.ok(/UCE Questinou sur son smurf Quest Smurf#EUW \(Jhin\)/.test(r.notificationSmurf), r.notificationSmurf);
  assert.ok(/Aucun de tes joueurs/.test(r.vide), r.vide);
  // moments clés d'une partie
  assert.ok(r.moments.lignes >= 10, JSON.stringify(r.moments));
  assert.ok(r.moments.titres.includes('Mort : tué par Kha\'Zix') && r.moments.titres.includes('Larves du Néant perdues'), r.moments.titres.join(' | '));
  assert.strictEqual(r.moments.premier, '6:30', 'la première mort est sélectionnée');
  assert.strictEqual(r.moments.carteApresClic, '12:00');
  assert.strictEqual(r.moments.pins, 10);
  assert.ok(r.moments.copie.startsWith('DOSSIER DE PARTIE') && r.moments.copie.includes('6:30 — Mort : tué par Kha\'Zix — top lane'), r.moments.copie.slice(0, 400));
  assert.strictEqual(calls.match, 2, 'partie et timeline demandées une seule fois (ensuite lues sur le disque)');
  assert.ok(r.moments.fichier, 'moments enregistrés sur l\'ordinateur du coach');
  assert.strictEqual(r.boutonFilmer, false, 'pas de tournage côté coach');
  // rangs gardés en mémoire : une seule demande par joueur malgré les vérifications toutes les 2 s
  assert.ok(Object.keys(calls.league).filter(k => !k.startsWith('P-')).every(k => calls.league[k] === 1), JSON.stringify(calls.league));
  assert.ok(calls.spectator['P-UAWAWA'] >= 3, 'vérification régulière');
  console.log(JSON.stringify(r, null, 1));
  console.log('✅ Parties en direct de bout en bout : OK');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
