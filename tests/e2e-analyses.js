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
const rp = { state: null, polls: 0, checks: 0, watching: false, loading: 3, time: 0, selection: '' };
function startLol() {
  const srv = http.createServer((req, res) => {
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : null;
      const send = (code, b) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(b === undefined ? '' : JSON.stringify(b)); };
      if (req.url.startsWith('/lol/match/v5/matches/EUW1_7300000099')) { calls.match++; return send(200, req.url.endsWith('/timeline') ? partie.timeline : partie.match); }
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
        if (req.url === '/lol-replays/v1/rofls/7300000099/watch') { rp.watching = true; return send(204); }
        return send(404, {});
      }
      if (req.url === '/liveclientdata/playerlist') return rp.watching ? send(200, [{ championName: 'Garen', riotIdGameName: 'Demacia' }, { championName: 'Darius', riotIdGameName: 'UCE Uawawa', summonerName: 'UCE Uawawa#000' }]) : send(503, {});
      if (req.url.startsWith('/replay/')) {
        calls.replay.push(req.method + ' ' + req.url + (body ? ' ' + JSON.stringify(body) : ''));
        if (!rp.watching || rp.loading-- > 0) return send(503, {});
        if (req.url === '/replay/playback') {
          if (req.method === 'POST' && body && typeof body.time === 'number') rp.time = body.time;
          return send(200, { time: rp.time, seeking: false, paused: false, speed: 1, length: 1200 });
        }
        if (req.url === '/replay/render') {
          // comme le jeu : sélection puis attache de la caméra (l'attache vaut pour la sélection en cours)
          if (req.method === 'POST' && body && 'selectionName' in body) { rp.selection = body.selectionName === 'UCE Uawawa' ? 'UCE Uawawa' : ''; rp.attached = false; }
          if (req.method === 'POST' && body && 'cameraAttached' in body && !('selectionName' in body)) rp.attached = !!body.cameraAttached && !!rp.selection;
          return send(200, { selectionName: rp.selection, cameraAttached: !!rp.attached, cameraMode: 'top' });
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

  const coachDone = launch('coach', path.join(DIR, 'coach'), Object.assign({ COACHING_LOL_RIOT: lol.url, COACHING_LOL_LCU: lol.url, COACHING_LOL_REPLAY: lol.url }, cloudEnv));
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
  assert.deepStrictEqual(mom.map(x => x.match_id), ['EUW1_7300000099']);
  assert.ok(!('clips' in mom[0].data) && mom[0].data.moments.length > 5);
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
  assert.ok(!calls.replay.some(x => /"selectionName".*"cameraAttached"|"cameraAttached".*"selectionName"/.test(x)), 'sélection et attache séparées');
  assert.ok(calls.replay.includes('POST /replay/render {"selectionName":"UCE Uawawa"}') && calls.replay.includes('POST /replay/render {"cameraMode":"top","cameraAttached":true}'), 'caméra sur le joueur');
  assert.ok(calls.replay.includes('POST /replay/playback {"time":355,"paused":true,"speed":1}') && calls.replay.includes('POST /replay/playback {"paused":false,"speed":1}'), 'pause au début de l\'extrait puis lecture');
  assert.ok(/caméra « UCE Uawawa ».*"ok":true/.test(rj.journal) && /» Enregistrement 4\/4/.test(rj.journal), rj.journal);
  assert.ok(rj.videoLocale.largeur > 0 && rj.videoLocale.src.startsWith('clip://v/'), JSON.stringify(rj.videoLocale));
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
  assert.deepStrictEqual(a.map(x => [x.status, x.clips_state, Number(x.n)]), [['ouverte', 'en_ligne', 0]], '1re analyse supprimée du serveur après l\'export');
  assert.ok([...fake.files.keys()].every(k => k.startsWith('clips/' + a[0].id + '/')), 'vidéos de la 1re analyse effacées du stockage');
  // le joueur sur l'ordinateur du coach : moments, tournage, envoi, page Analyses
  assert.ok(rc.local.menu.includes('Analyses'), rc.local.menu.join(','));
  assert.deepStrictEqual(rc.local.liste, [], 'analyse exportée : plus dans la liste');
  assert.ok(rc.local.boutons.some(b => /Filmer les moments/.test(b)), rc.local.boutons.join(' | '));
  assert.ok(/4 extraits filmés/.test(rc.local.tournage), rc.local.tournage);
  assert.ok(/envoyée au coach/.test(rc.local.envoi), rc.local.envoi);
  assert.strictEqual(a[0].note, 'Envoyée depuis l\'ordinateur du coach.');
  assert.strictEqual(fake.files.size, 4);
  assert.strictEqual(fake.hits.uploads, 6);
  assert.ok(calls.match >= 2, 'moments calculés par l\'app du coach');
  fake.close();
  console.log(JSON.stringify({ coach: rc, joueur: rj }, null, 1));
  console.log('✅ Analyses de parties de bout en bout (joueur filme et envoie, coach répond et termine) : OK');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
