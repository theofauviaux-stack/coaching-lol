// Test de bout en bout des analyses de parties : faux serveur Supabase (base + stockage des vidéos), faux Riot,
// faux client LoL et faux jeu (replays), app du coach + app d'un joueur lancées en même temps.
// Usage : node tests/e2e-analyses.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { emptyData } = require('../src/store');
const { startFake } = require('./fake-supabase');

const DIR = '/tmp/e2e-analyses';
const NOW = Date.now();
const wait = ms => new Promise(r => setTimeout(r, ms));
const partie = require('./fixtures/partie-moments')('P-UAWAWA');

// ---------------------------------------------------------------- faux Riot (partie + timeline), client LoL et jeu
const calls = { match: 0, lcu: [], replay: [] };
// comme le vrai client : pas de fiche replay tant qu'on ne l'a pas créée, puis « checking », puis « download »
const rp = { state: null, polls: 0, checks: 0, watching: false, loading: 3, time: 0, paused: true, at: 0, selection: '', hud: { interfaceReplay: true, interfaceTimeline: true, interfaceChat: true, outlineHover: true } };
// réglages de jeu du joueur dans son client LoL (le faux jeu en change pendant le replay, comme s'il gardait l'interface épurée)
const REGLAGES = { General: { WindowMode: 2, Height: 900 }, HUD: { ShowTimestamps: true, MinimapScale: 1.2, ChatScale: 100 }, Replay: { HideInterface: false } };
const gs = { settings: JSON.parse(JSON.stringify(REGLAGES)), patches: [], saves: 0 };
const perso = require('./fixtures/lcu-v4')('P-UAWAWA', 7300000777);
function startLol() {
  const srv = http.createServer((req, res) => {
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : null;
      const send = (code, b) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(b === undefined ? '' : JSON.stringify(b)); };
      if (req.url.startsWith('/lol/match/v5/matches/EUW1_7300000099')) { calls.match++; return send(200, req.url.endsWith('/timeline') ? partie.timeline : partie.match); }
      // client LoL du joueur : compte connecté et historique (une partie personnalisée)
      if (req.url === '/lol-summoner/v1/current-summoner') return send(200, { gameName: 'UCE Uawawa', tagLine: '000', puuid: 'P-UAWAWA' });
      if (req.url.startsWith('/lol-match-history/v1/products/lol/current-summoner/matches')) return send(200, perso.list);
      if (req.url === '/lol-match-history/v1/games/7300000777') return send(200, perso.game);
      if (req.url === '/lol-match-history/v1/game-timelines/7300000777') return send(200, perso.timeline);
      if (req.url === '/lol-game-settings/v1/game-settings') {
        if (req.method === 'PATCH' && body) { gs.patches.push(Object.keys(body)); Object.assign(gs.settings, JSON.parse(JSON.stringify(body))); }
        return send(200, gs.settings);
      }
      if (req.url === '/lol-game-settings/v1/save' && req.method === 'POST') { gs.saves++; return send(204); }
      if (req.url.startsWith('/lol-replays/')) {
        calls.lcu.push(req.method + ' ' + req.url);
        if (req.url === '/lol-replays/v1/configuration') return send(200, { isReplaysEnabled: true, isPatching: false });
        if (req.url === '/lol-replays/v2/metadata/7300000099/create' && req.method === 'POST') { if (!rp.state) rp.state = 'checking'; return send(204); }
        if (req.url === '/lol-replays/v1/metadata/7300000099') {
          if (!rp.state) return send(404, { message: 'pas de fiche' });
          if (rp.state === 'checking' && ++rp.checks > 2) rp.state = 'download';
          if (rp.state === 'downloading' && ++rp.polls > 2) rp.state = 'watch';
          return send(200, { gameId: 7300000099, state: rp.state, downloadProgress: rp.polls / 3 });
        }
        if (req.url === '/lol-replays/v1/rofls/7300000099/download') { rp.state = 'downloading'; return send(204); }
        if (req.url === '/lol-replays/v1/rofls/7300000099/watch') {
          rp.watching = true;
          gs.settings.Replay = { HideInterface: true }; gs.settings.HUD = Object.assign({}, gs.settings.HUD, { ChatScale: 0 }); // le jeu garde ses changements
          return send(204);
        }
        return send(404, {});
      }
      if (req.url === '/liveclientdata/playerlist') return rp.watching ? send(200, [{ team: 'ORDER', championName: 'Darius', riotIdGameName: 'UCE Uawawa' }, { team: 'ORDER', championName: 'LeeSin' }, { team: 'CHAOS', championName: 'Garen', riotIdGameName: 'Demacia' }]) : send(503, {});
      if (req.url.startsWith('/replay/')) {
        calls.replay.push(req.method + ' ' + req.url + (body ? ' ' + JSON.stringify(body) : ''));
        if (!rp.watching || rp.loading-- > 0) return send(503, {});
        if (req.url === '/replay/playback') {
          // comme le jeu : le temps avance pendant la lecture
          const now = () => (rp.paused ? rp.time : rp.time + (Date.now() - rp.at) / 1000);
          if (req.method === 'POST' && body) {
            const t = typeof body.time === 'number' ? body.time : now();
            rp.time = t; rp.at = Date.now();
            if ('paused' in body) rp.paused = !!body.paused;
          }
          return send(200, { time: now(), seeking: false, paused: !!rp.paused, speed: 1, length: 1200 });
        }
        if (req.url === '/replay/render') {
          // comme le jeu : sélection puis attache de la caméra (l'attache vaut pour la sélection en cours)
          if (req.method === 'POST' && body && 'selectionName' in body) { rp.selection = body.selectionName === 'UCE Uawawa' ? 'UCE Uawawa' : ''; rp.attached = false; }
          if (req.method === 'POST' && body && 'cameraAttached' in body && !('selectionName' in body)) rp.attached = !!body.cameraAttached && !!rp.selection;
          if (req.method === 'POST' && body) for (const k of Object.keys(rp.hud)) if (k in body) rp.hud[k] = body[k];
          return send(200, Object.assign({ selectionName: rp.selection, cameraAttached: !!rp.attached, cameraMode: 'top' }, rp.hud));
        }
      }
      return send(404, { status: { message: 'Data not found', status_code: 404 } });
    });
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ url: 'http://127.0.0.1:' + srv.address().port, close: () => srv.close() })));
}

function launch(phase, dataDir, env) {
  return new Promise(resolve => {
    const p = spawn('xvfb-run', ['-a', '-s', '-screen 0 1440x900x24', path.join(__dirname, '..', 'node_modules/.bin/electron'), path.join(__dirname, '..'), '--no-sandbox'], {
      env: Object.assign({}, process.env, { PHASE: phase, SYNC_DIR: DIR, COACHING_LOL_DATA: dataDir, COACHING_LOL_FAST: '1', COACHING_LOL_TEST: path.join(__dirname, 'ui-analyses.js') }, env),
      stdio: 'ignore'
    });
    p.on('exit', resolve);
  });
}

(async () => {
  fs.rmSync(DIR, { recursive: true, force: true });
  for (const d of ['coach', 'joueur']) fs.mkdirSync(path.join(DIR, d), { recursive: true });
  const fake = await startFake();
  const lol = await startLol();
  const cloudEnv = { COACHING_LOL_CLOUD: JSON.stringify({ url: fake.url, publicKey: 'cle-publique-test' }) };

  // ordinateur du coach : un joueur, une partie récente, clé Riot, jeton d'envoi enregistré
  const TOKEN = crypto.randomBytes(32).toString('hex');
  await fake.db.query(`insert into push_keys (hash) values ($1)`, [crypto.createHash('sha256').update(TOKEN).digest('hex')]);
  const dd = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'ddragon.json'), 'utf8'));
  const c = emptyData();
  Object.assign(c.settings, dd, { coachCode: '4821', pushToken: TOKEN, apiKey: 'RGAPI-test-analyses', lolPath: path.join(DIR, 'Jeux') });
  c.settings.items = { 1055: ['Lame de Doran', 450], 2003: ['Potion de soin', 50], 3133: ['Marteau de guerre de Caulfield', 1100], 3071: ['Couperet noir', 3000] };
  c.players.push({ id: 'p1', riotId: 'UCE Uawawa#000', region: 'euw', role: 'Top', puuid: 'P-UAWAWA', code: '7391', objectives: {}, createdAt: NOW - 86400e3 });
  c.games.push({ matchId: 'EUW1_7300000099', playerId: 'p1', date: NOW - 3600000, role: 'Top', champion: 'Darius', opponent: 'Garen', win: false, duration: 20, kills: 1, deaths: 2, assists: 0, teamKills: 3,
    cs: 140, gold: 7400, damage: 9000, vision: 12, wardsPlaced: 4, wardsKilled: 1, pinks: 1, level: 13, side: 'Bleu', cs10: 70, goldDiff10: -200, xpDiff10: 0, goldDiff15: -300, deaths15: 1, lpDelta: null, mental: null, objectiveMet: null, comment: '' });
  // vieille partie (plus de 30 jours) : ses moments ne partent pas
  c.games.push(Object.assign({}, c.games[0], { matchId: 'EUW1_7200000001', date: NOW - 40 * 86400e3 }));
  fs.writeFileSync(path.join(DIR, 'coach', 'coaching-data.json'), JSON.stringify(c));

  // ordinateur du joueur : fausse installation de League of Legends (organisation Mac)
  const game = path.join(DIR, 'Jeux', 'League of Legends.app');
  fs.mkdirSync(path.join(game, 'Contents/LoL/Game/LeagueofLegends.app/Contents/MacOS'), { recursive: true });
  fs.mkdirSync(path.join(game, 'Contents/LoL/Config'), { recursive: true });
  fs.writeFileSync(path.join(game, 'Contents/LoL/Game/LeagueofLegends.app/Contents/MacOS/LeagueofLegends'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  fs.writeFileSync(path.join(game, 'Contents/LoL/Config/LeagueClientSettings.yaml'), 'install:\n    globals:\n        locale: "fr_FR"\n');
  const j = emptyData();
  Object.assign(j.settings, dd, { lolPath: path.join(DIR, 'Jeux') });
  fs.writeFileSync(path.join(DIR, 'joueur', 'coaching-data.json'), JSON.stringify(j));

  // vidéo envoyée avant la 1.6.16 (ni durée ni index) : dès l'envoi du joueur, la 1re vidéo du serveur est remplacée par
  // une vidéo brute de l'enregistreur ; l'app doit la réparer à la lecture
  const RAW = fs.readFileSync(path.join(__dirname, 'fixtures', 'mediarecorder.webm'));
  const swap = setInterval(() => {
    if (!fs.existsSync(path.join(DIR, 'envoye'))) return;
    const k = [...fake.files.keys()].find(x => x.endsWith('/01_5m55.webm'));
    if (k) { fake.files.set(k, RAW); clearInterval(swap); }
  }, 50);
  const coachDone = launch('coach', path.join(DIR, 'coach'), Object.assign({ COACHING_LOL_RIOT: lol.url, COACHING_LOL_LCU: lol.url, COACHING_LOL_REPLAY: lol.url, COACHING_LOL_CLAUDE_DIR: path.join(DIR, 'claude') }, cloudEnv));
  // moments envoyés au serveur par l'app du coach (calculés chez « Riot »), puis le joueur ouvre son app
  const t0 = Date.now();
  while (!(await fake.db.query(`select 1 from moments where match_id = 'EUW1_7300000099'`)).rows.length) {
    if (Date.now() - t0 > 90000) throw new Error('moments jamais envoyés au serveur');
    await wait(500);
  }
  fs.mkdirSync(path.join(DIR, 'export'), { recursive: true });
  const joueurDone = launch('joueur', path.join(DIR, 'joueur'), Object.assign({ COACHING_LOL_LCU: lol.url, COACHING_LOL_REPLAY: lol.url, COACHING_LOL_EXPORT_DIR: path.join(DIR, 'export') }, cloudEnv));
  await Promise.all([coachDone, joueurDone]);
  lol.close();
  const rc = JSON.parse(fs.readFileSync(path.join(DIR, 'resultat-coach.json'), 'utf8'));
  const rj = JSON.parse(fs.readFileSync(path.join(DIR, 'resultat-joueur.json'), 'utf8'));
  assert.ok(!rc.exception, 'coach : ' + rc.exception);
  assert.ok(!rj.exception, 'joueur : ' + rj.exception);

  // moments sur le serveur : seulement les parties récentes, sans les vidéos locales
  const mom = (await fake.db.query(`select match_id, data from moments`)).rows;
  assert.deepStrictEqual(mom.map(x => x.match_id).sort(), ['EUW1_7300000099', 'EUW1_7300000777'], 'la classée (envoyée par le coach) et la partie perso (envoyée par le joueur)');
  const m99 = mom.find(x => x.match_id === 'EUW1_7300000099');
  assert.ok(!('clips' in m99.data) && m99.data.moments.length > 5);
  assert.strictEqual(mom.find(x => x.match_id === 'EUW1_7300000777').data.custom, true);
  // joueur : menu, tournage, choix, envoi
  assert.ok(rj.menu.includes('Analyses'), rj.menu.join(','));
  assert.ok(rj.boutons.some(b => /Filmer les moments/.test(b)) && !rj.boutons.some(b => /Copier/.test(b)), rj.boutons.join(' | '));
  assert.ok(/4 extraits filmés/.test(rj.finTournage), rj.finTournage);
  assert.ok(calls.lcu.some(x => x.startsWith('POST /lol-replays/v2/metadata/7300000099/create')), 'fiche replay créée dans le client');
  const pr = rj.progression.map(x => x[1]);
  assert.ok(pr.every((x, i) => i === 0 || x >= pr[i - 1] - 1e-9) && pr[pr.length - 1] >= 0.95, 'barre de progression croissante : ' + JSON.stringify(rj.progression));
  assert.ok(rj.progression.some(x => /vérifie le replay/.test(x[0])) && rj.progression.some(x => /^Enregistrement 2\/4/.test(x[0])), JSON.stringify(rj.progression.map(x => x[0])));
  assert.ok(rj.barre && rj.barre.largeur > 0, JSON.stringify(rj.barre));
  assert.ok(/macOS bloque l'enregistrement de l'écran.*Ouvrir les réglages.*Relancer l'app/.test(rj.encadre), rj.encadre);
  assert.deepStrictEqual(rj.fichiers, ['01_5m55.webm', '02_8m25.webm', '03_13m25.webm', '04_15m25.webm'], 'extraits commencés 35 s avant chaque moment');
  assert.deepStrictEqual(rj.touches, ['1', '1', '1', '1'], 'touche du joueur (1er de l\'équipe bleue) avant chaque moment');
  assert.ok(calls.replay.includes('POST /replay/render {"interfaceReplay":true,"interfaceTimeline":true,"interfaceChat":true,"outlineHover":true}'), 'interface du replay du joueur remise à la fin');
  assert.deepStrictEqual(rp.hud, { interfaceReplay: true, interfaceTimeline: true, interfaceChat: true, outlineHover: true }, 'interface du replay comme avant le tournage');
  assert.deepStrictEqual(gs.settings, REGLAGES, 'réglages de jeu du joueur remis à l\'identique : ' + JSON.stringify(gs.settings));
  assert.ok(gs.patches.length >= 1 && gs.patches.every(k => k.sort().join() === 'HUD,Replay') && gs.saves >= 1, 'seules les parties changées sont renvoyées, puis enregistrées : ' + JSON.stringify(gs.patches));
  assert.ok(/réglages du joueur remis comme avant \{"changes":\{"HUD":\["ChatScale"\],"Replay":\["HideInterface"\]\},"restent":null\}/.test(rj.journal), rj.journal);
  assert.ok(/ANNULÉ par le joueur[\s\S]*réglages du joueur remis comme avant/.test(rj.annulation.journal), 'réglages remis aussi après une annulation : ' + rj.annulation.journal);
  assert.ok(calls.replay.includes('POST /replay/render {"interfaceReplay":false,"interfaceTimeline":false,"interfaceChat":false,"outlineHover":false}')
    && !calls.replay.some(x => x.startsWith('POST /replay/render') && /selectionName|cameraAttached/.test(x)), 'interface du replay épurée, pas de sélection par l\'API');
  assert.ok(calls.replay.includes('POST /replay/playback {"time":355,"paused":true,"speed":1}') && calls.replay.includes('POST /replay/playback {"paused":false,"speed":1}'), 'pause au début de l\'extrait puis lecture');
  assert.ok(/touche du joueur "1"/.test(rj.journal) && /caméra après la touche 1/.test(rj.journal) && /» Enregistrement 4\/4/.test(rj.journal), rj.journal);
  assert.ok(/vidéo \{"w":1600,"h":900,"fps":30,"bps":2200000\}/.test(rj.journal) && /capture \{"source":"écran","largeur":\d+/.test(rj.journal), rj.journal);
  assert.ok(/extrait 4 filmé \{"de":925,"a":1010,"arret":"durée fixe \(test\)","lead":[\d.]+,"sync":\[\[/.test(rj.journal) && /terminé \{"extraits":4/.test(rj.journal), rj.journal);
  assert.ok(/"image":\{"samples":[1-9]/.test(rj.journal), 'image de la capture analysée (noire ? figée ?) : ' + rj.journal);
  // annulation pendant « Refilmer »
  const an = rj.annulation;
  assert.ok(an, 'scénario d\'annulation');
  assert.ok(/Annuler l'enregistrement/.test(an.bouton), an.bouton);
  assert.ok(!an.pendant || (an.pendant[0] === true && /Annulation/.test(an.pendant[1])), JSON.stringify(an.pendant));
  assert.ok(/Enregistrement annulé : tu peux relancer « Filmer les moments »/.test(an.toast), an.toast);
  assert.strictEqual(an.barre, false, 'barre d\'avancement retirée');
  assert.ok(an.filmer.some(b => /Refilmer/.test(b)), 'bouton pour relancer : ' + an.filmer.join(' | '));
  assert.deepStrictEqual(an.fichiers, ['01_5m55.webm', '02_8m25.webm', '03_13m25.webm', '04_15m25.webm'], 'les vidéos d\'avant restent');
  assert.strictEqual(an.temporaire, false, 'extraits partiels effacés');
  assert.strictEqual(an.clips, 4);
  assert.ok(/ANNULÉ par le joueur/.test(an.journal), an.journal);
  assert.ok(rj.videoLocale.largeur > 0 && rj.videoLocale.src.startsWith('clip://v/'), JSON.stringify(rj.videoLocale));
  assert.deepStrictEqual(rj.navigables, [true, true, true, true], 'vidéos filmées navigables (durée + index)');
  assert.ok(rj.videoLocale.duree !== 'Infinity' && Number(rj.videoLocale.duree) > 0, 'durée connue : ' + rj.videoLocale.duree);
  assert.ok(Math.abs(Number(rc.video.duree) - 7.19) < 0.2 && rc.video.largeur === 160, 'ancienne vidéo du serveur réparée à la lecture : ' + JSON.stringify(rc.video));
  assert.deepStrictEqual(rc.videosGardees, ['01_5m55.webm'], 'seule l\'ancienne vidéo est gardée sur l\'ordinateur du coach');
  assert.ok(Math.abs(Number(rj.videoEnLigne.duree) - 7.19) < 0.2, 'joueur : même vidéo réparée : ' + JSON.stringify(rj.videoEnLigne));
  assert.strictEqual(rj.cartes, 4);
  assert.ok(/^2 vidéos choisies · [\d,]+ Mo$/.test(rj.total), rj.total);
  assert.ok(/envoyée au coach/.test(rj.messageEnvoi), rj.messageEnvoi);
  assert.ok(/Je veux travailler mes placements de wards/.test(rj.filGeneral), rj.filGeneral);
  assert.strictEqual(rj.total.startsWith('2 vidéos'), true, 'seules les 2 vidéos choisies sont envoyées');
  // coach : notification, liste, vidéo en ligne, réponse
  assert.ok(/Partie à analyser — UCE Uawawa t'envoie Darius contre Garen \(2 vidéos\)/.test(rc.notification), rc.notification);
  assert.strictEqual(rc.pastille, '1');
  assert.ok(/UCE Uawawa.*Darius contre Garen.*2.*Nouvelle/.test(rc.liste[0]), rc.liste[0]);
  assert.ok(/Je veux travailler mes placements de wards/.test(rc.filGeneral), rc.filGeneral);
  assert.deepStrictEqual(rc.filMoment, ['Je pensais que leur jungler était bot, je n\'avais pas de ward.']);
  assert.ok(rc.video.largeur > 0 && /^clip:\/\/r\/[0-9a-f-]{36}\/01_5m55\.webm$/.test(rc.video.src), JSON.stringify(rc.video));
  assert.strictEqual(rc.filmes, 6, 'moments couverts par les 2 vidéos envoyées');
  // discussion dans les deux sens, sans recharger la vidéo
  assert.ok(/Réponse du coach — Regarde la mini-carte/.test(rj.notification), rj.notification);
  assert.deepStrictEqual(rj.filMoment, ['Toi : Je pensais que leur jungler était bot, je n\'avais pas de ward.', 'Coach : Regarde la mini-carte à 6:10 : Kha\'Zix était top. Ward la rivière avant 6:00.']);
  assert.ok(rj.videoEnLigne.largeur > 0 && rj.videoEnLigne.src.startsWith('clip://r/'), JSON.stringify(rj.videoEnLigne));
  assert.deepStrictEqual(rc.filApres, ['UCE Uawawa', 'Toi (coach)', 'UCE Uawawa']);
  assert.strictEqual(rc.videoGardee, true, 'la vidéo n\'est pas rechargée quand un message arrive');
  // fin : discussion gardée, vidéos effacées du serveur
  assert.ok(/Analyse terminée/.test(rc.fin), rc.fin);
  assert.ok(/Analyse terminée/.test(rj.fin), rj.fin);
  assert.ok(/Le coach a terminé l'analyse de Darius contre Garen/.test(rj.notifFin), rj.notifFin);
  assert.ok(/Darius contre Garen.*2.*5.*À exporter/.test(rj.liste[0]), rj.liste[0]);
  assert.strictEqual(rc.videosApresFin, 'en_ligne', 'vidéos gardées à la fin pour l\'export');
  assert.ok(/le joueur peut l'exporter/i.test(rc.fin), rc.fin);
  // analyses par Claude : dossier préparé, réponse reprise en brouillons, vidéos retirées à la fin
  assert.ok(/^\d{4}-\d\d-\d\d UCE Uawawa Darius contre Garen \[[0-9a-f]{8}\]$/.test(rc.claudeDossier.nom), rc.claudeDossier.nom);
  assert.deepStrictEqual(rc.claudeDossier.racine, ['LISEZ-MOI.txt', rc.claudeDossier.nom, 'methode-coach.md'].sort());
  assert.deepStrictEqual(rc.claudeDossier.fichiers, ['a-analyser.json', 'dossier.txt', 'partie.json', 'videos']);
  assert.deepStrictEqual(rc.claudeDossier.videos, ['01_5m55.webm', '04_15m25.webm']);
  assert.ok(rc.claudeDossier.tailles.every(n => n > 1000), JSON.stringify(rc.claudeDossier.tailles));
  assert.strictEqual(rc.claudeDossier.dossier, 'DOSSIER DE PARTIE (Coaching LoL) — à analyser');
  assert.strictEqual(rc.claudeDossier.filmes, 6);
  assert.deepStrictEqual([rc.claudeDossier.moment.temps, rc.claudeDossier.moment.video], ['6:30', 'videos/01_5m55.webm']);
  assert.ok(Math.abs(rc.claudeDossier.moment.secondeDansLaVideo - 35) <= 0.3, 'seconde du moment dans la vidéo (synchronisation mesurée) : ' + rc.claudeDossier.moment.secondeDansLaVideo);
  assert.deepStrictEqual(rc.claudeDossier.moment.discussion, [{ auteur: 'joueur', texte: 'Je pensais que leur jungler était bot, je n\'avais pas de ward.' }]);
  assert.ok(/Analyse de Claude prête — Darius contre Garen de UCE Uawawa/.test(rc.claudeNotif), rc.claudeNotif);
  assert.strictEqual(rc.claudeErreurs, 'Moment inconnu : 123');
  assert.ok(/UCE Uawawa.*Claude/.test(rc.liste[0]), 'pastille « Claude » dans la liste : ' + rc.liste[0]);
  assert.ok(/Analyse par Claude/.test(rc.claudeEncadre) && /Ouvrir le dossier/.test(rc.claudeEncadre), rc.claudeEncadre);
  assert.deepStrictEqual(rc.claudeGeneral, { bandeau: true, pastilles: 2, texte: 'Résumé de Claude : bonne lane, une mort évitable à 6:30.\n\nPriorités de travail :\n1. Ward la rivière avant 6:00\n2. Back avec la wave poussée' });
  assert.deepStrictEqual(rc.claudeMoment, { bandeau: true, texte: 'Proposition de Claude pour 6:30 : pas de vision de la rivière, Kha\'Zix arrive par le haut.' });
  assert.deepStrictEqual(rc.claudeApresEnvoi, { bandeau: false, pastilles: 1 }, 'proposition utilisée après l\'envoi ; reste celle de la discussion générale');
  assert.deepStrictEqual(rc.claudeApresFin, { videos: false, fichiers: ['a-analyser.json', 'analyse-claude.json', 'dossier.txt', 'erreurs-import.txt', 'partie.json'], brouillons: 0 });
  // export : dossier sur l'ordinateur du joueur, puis suppression de l'app et du serveur
  assert.ok(/Analyse exportée \(2 vidéos \+ débrief\)/.test(rj.export), rj.export);
  const dirs = fs.readdirSync(path.join(DIR, 'export'));
  assert.strictEqual(dirs.length, 1);
  assert.ok(/^Analyse Darius contre Garen \d\d-\d\d-\d{4}$/.test(dirs[0]), dirs[0]);
  const ex = path.join(DIR, 'export', dirs[0]);
  assert.deepStrictEqual(fs.readdirSync(ex).sort(), ['01_5m55.webm', '04_15m25.webm', 'debrief.html']);
  assert.ok(fs.statSync(path.join(ex, '01_5m55.webm')).size > 1000);
  const html = fs.readFileSync(path.join(ex, 'debrief.html'), 'utf8');
  for (const t of ['Je veux travailler mes placements de wards', 'Regarde la mini-carte', 'Compris, je pose une ward', 'Combat au mid', 'src="01_5m55.webm#t=5"', 'Discussion générale']) assert.ok(html.includes(t) || html.includes(t.replace(/'/g, '&#39;')), 'débrief : ' + t);
  assert.strictEqual(rj.listeApres, 0, 'analyse supprimée de l\'app');
  assert.strictEqual(rj.videosLocales, false, 'vidéos locales supprimées');
  assert.ok(/a exporté cette analyse/.test(rc.apresExport), rc.apresExport);
  const a = (await fake.db.query(`select id, status, clips_state, note, (select count(*) from analysis_comments c where c.analysis_id = analyses.id) as n from analyses order by created_at`)).rows;
  assert.deepStrictEqual(a, [], '1re analyse supprimée après l\'export, 2e supprimée par le coach');
  // partie personnalisée : importée par le joueur depuis son client LoL, reprise par le coach
  assert.strictEqual(rj.boutonPerso, true);
  assert.strictEqual(rj.persoListe.length, 2, 'seulement les personnalisées (pas la classée) : ' + JSON.stringify(rj.persoListe));
  assert.ok(/ Darius D 1\/2\/0\s?20 min Ajouter$/.test(rj.persoListe[0]), rj.persoListe[0]);
  assert.ok(/ARAM.*non prise en charge/.test(rj.persoListe[1]), rj.persoListe[1]);
  assert.ok(/Partie ajoutée avec ses moments clés/.test(rj.persoAjout), rj.persoAjout);
  assert.deepStrictEqual(rj.persoApres, ['Ajoutée', 'non prise en charge']);
  assert.deepStrictEqual(rj.persoPartie.g, { matchId: 'EUW1_7300000777', champion: 'Darius', opponent: 'Garen', kills: 1, deaths: 2, cs10: 70, pending: true });
  assert.ok(/Darius contre Garen.*Perso/.test(rj.persoPartie.ligne), rj.persoPartie.ligne);
  assert.ok(/et 1 personnalisée \(pas comptée dans les statistiques\)/.test(rj.persoPartie.sous), rj.persoPartie.sous);
  assert.strictEqual(rj.persoMoments, true, 'moments clés enregistrés chez le joueur');
  assert.ok(rj.persoMomentsLignes >= 10, 'moments clés de la partie perso : ' + rj.persoMomentsLignes);
  assert.deepStrictEqual(rc.persoCoach, { matchId: 'EUW1_7300000777', playerId: 'p1', custom: true, lpDelta: null });
  assert.strictEqual(rc.persoMomentsCoach, true, 'moments clés reçus par le coach');
  assert.strictEqual(rc.persoStats, false, 'pas comptée dans les statistiques');
  assert.ok(/Partie personnalisée ajoutée/.test(rc.persoNotif || ''), 'notification coach : ' + rc.persoNotif);
  assert.strictEqual(Number((await fake.db.query(`select count(*) as n from custom_games`)).rows[0].n), 0, 'reprise par le coach : effacée du serveur');
  assert.strictEqual(fake.files.size, 0, 'toutes les vidéos effacées du stockage');
  const gardees = (() => { try { return fs.readdirSync(path.join(DIR, 'coach', 'videos-serveur')); } catch (e) { return []; } })();
  assert.deepStrictEqual(gardees, [], 'vidéos gardées effacées avec leurs analyses');
  // le joueur sur l'ordinateur du coach : moments, tournage, envoi, page Analyses
  assert.ok(rc.local.menu.includes('Analyses'), rc.local.menu.join(','));
  assert.deepStrictEqual(rc.local.liste, [], 'analyse exportée : plus dans la liste');
  assert.ok(rc.local.boutons.some(b => /Filmer les moments/.test(b)), rc.local.boutons.join(' | '));
  assert.ok(/4 extraits filmés/.test(rc.local.tournage), rc.local.tournage);
  assert.ok(/envoyée au coach/.test(rc.local.envoi), rc.local.envoi);
  assert.strictEqual(rc.suppression.note, 'Envoyée depuis l\'ordinateur du coach.');
  // suppression par le coach
  assert.deepStrictEqual([rc.suppression.boutons, rc.suppression.dossierAvant, rc.suppression.dossierApres], [1, true, false]);
  assert.ok(/Analyse supprimée : elle disparaît aussi chez le joueur/.test(rc.suppression.message), rc.suppression.message);
  assert.ok(/Aucune partie envoyée/.test(rc.suppression.vide), rc.suppression.vide);
  assert.strictEqual(fake.hits.uploads, 6);
  assert.ok(calls.match >= 2, 'moments calculés par l\'app du coach');
  fake.close();
  console.log(JSON.stringify({ coach: rc, joueur: rj }, null, 1));
  console.log('✅ Analyses de parties de bout en bout (joueur filme et envoie, coach répond et termine) : OK');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
