// Vidéos des moments clés (replay) : tests sans League of Legends, avec un faux client et un faux jeu.
const assert = require('assert');
const R = require('../src/replay');
const M = require('../src/moments');
const partie = require('./fixtures/partie-moments');

// ---- choix des moments et fenêtres filmées
const { match, timeline } = partie('P-DARIUS');
const m = M.buildMoments(match, timeline, 'P-DARIUS');
const picked = R.pickMoments(m);
assert.deepStrictEqual(picked.map(x => M.mmss(x.t) + ' ' + x.type), ['6:30 mort', '7:10 objectif', '9:00 kill', '14:00 objectif', '16:00 mort', '16:40 objectif'],
  'morts, objectifs perdus, kills et objectifs où il était ; pas les retours ni le dragon pris loin');
const w = R.clipWindows(picked, 1200);
assert.deepStrictEqual(w.map(x => [x.start, x.end, x.times.length]), [[355, 440, 2], [505, 550, 1], [805, 850, 1], [925, 1010, 2]], 'mort 6:30 + larves 7:10 dans le même extrait, 35 s avant chaque moment');
assert.deepStrictEqual(R.clipWindows([{ t: 5000 }], 1200)[0], { start: 0, end: 15, times: [5000] }, 'pas avant 0:00');
assert.strictEqual(R.clipWindows([{ t: 0 }, { t: 30000 }, { t: 60000 }, { t: 90000 }]).length, 2, 'extraits de 75 s au plus');

// ---- client LoL et game.cfg
assert.deepStrictEqual(R.lockfileInfo('LeagueClient:4242:51234:s3cr3t-Mot:https'), { port: 51234, password: 's3cr3t-Mot', protocol: 'https' });
assert.strictEqual(R.lockfileInfo(''), null);
assert.deepStrictEqual(R.lcuFromArgs('"/Applications/.../LeagueClientUx" --riotclient-app-port=1 --app-port=60123 --remoting-auth-token=AbC_12-x --foo'), { port: 60123, password: 'AbC_12-x', protocol: 'https' });
let c = R.enableReplayApi('[General]\nWindowMode=2\n[HUD]\nScale=1\n');
assert.deepStrictEqual(c, { text: '[General]\nEnableReplayApi=1\nWindowMode=2\n[HUD]\nScale=1\n', changed: true });
assert.strictEqual(R.enableReplayApi(c.text).changed, false, 'déjà activée');
assert.strictEqual(R.enableReplayApi('[General]\r\nEnableReplayApi=0\r\n').text, '[General]\r\nEnableReplayApi=1\r\n');
assert.strictEqual(R.enableReplayApi('[HUD]\nScale=1').text, '[HUD]\nScale=1\n[General]\nEnableReplayApi=1\n');
assert.strictEqual(R.enableReplayApi('').text, '[General]\nEnableReplayApi=1\n');

// ---- enregistrement complet avec un faux client et un faux jeu (le temps du replay avance avec l'horloge)
function fakeWorld(opts = {}) {
  const w = { clock: 0, log: [], states: opts.states || ['download', 'downloading', 'downloading', 'watch'], loadPolls: opts.loadPolls || 2, playback: { time: 0, seeking: false, length: 1200, paused: true, speed: 1 }, base: 0, at: 0, render: Object.assign({ selectionName: '' }, opts.render || { interfaceReplay: true, interfaceTimeline: true, interfaceChat: true, outlineHover: true }), renderPosts: [], recorded: [], recs: [], keys: [], selected: null, killed: 0, sleeps: 0 };
  let si = 0, loaded = 0;
  const advance = () => {
    if (w.playback.paused || opts.stall) return;
    w.playback.time = Math.min(w.playback.length, w.base + (w.clock - w.at) / 1000);
    if (opts.pauseAt && w.playback.time >= opts.pauseAt && !w.pausedOnce) { w.pausedOnce = true; w.playback.paused = true; w.base = w.playback.time; }
  };
  const io = {
    now: () => w.clock,
    sleep: async ms => { w.sleeps++; if (opts.cancelAfter && w.sleeps > opts.cancelAfter) throw Object.assign(new Error('Enregistrement annulé.'), { cancelled: true }); w.clock += ms; },
    status: t => w.log.push(t),
    log: (what, data) => w.log.push('journal ' + what + (data === undefined ? '' : ' ' + JSON.stringify(data))),
    lcu: async (method, p, body) => {
      if (opts.noClient) throw new Error('ECONNREFUSED');
      w.log.push(method + ' ' + p + (body ? ' ' + JSON.stringify(body) : ''));
      if (p === '/lol-replays/v1/configuration') return { isReplaysEnabled: opts.disabled ? false : true, isPatching: false };
      if (p.startsWith('/lol-replays/v1/metadata/')) { const st = w.states[Math.min(si++, w.states.length - 1)]; return { gameId: 7300000099, state: st, downloadProgress: 0.5 }; }
      return {};
    },
    replay: async (method, p, body) => {
      if (!w.watching || loaded++ < w.loadPolls) throw new Error('ECONNREFUSED');
      if (p === '/replay/playback') {
        advance();
        if (method === 'POST') { Object.assign(w.playback, body, { seeking: 'time' in body }); w.base = w.playback.time; w.at = w.clock; return w.playback; }
        const r = Object.assign({}, w.playback); w.playback.seeking = false; return r;
      }
      if (p === '/replay/render') {
        if (method === 'POST') { w.renderPosts.push(Object.assign({ killedBefore: w.killed }, body)); Object.assign(w.render, body); }
        return w.render;
      }
      if (p === '/liveclientdata/playerlist') {
        if (opts.noPlayerlist) throw new Error('404');
        return opts.playerlist || [{ team: 'ORDER', championName: 'LeeSin' }, { team: 'ORDER', championName: 'Ahri' }, { team: 'CHAOS', championName: 'Garen', riotIdGameName: 'Demacia' },
          { team: 'ORDER', championName: 'Darius', riotIdGameName: 'UCE Uawawa', rawChampionName: 'game_character_displayname_Darius' }];
      }
      return {};
    },
    // capture : comme main.js, tenue une fois la capture lancée ; health() d'après opts.image(rec, monde)
    startRecording: async (file, o) => {
      const rec = { file, source: o.source, seconds: o.seconds, startClock: w.clock, time: w.playback.time, paused: w.playback.paused, selected: w.selected };
      w.recs.push(rec);
      return {
        health: () => (opts.image ? opts.image(rec, w) : { samples: 4, black: false, frozenSec: 0, live: true, bytes: 1000 }),
        stop: async () => { rec.stopClock = w.clock; rec.stopTime = w.playback.time; w.recorded.push([(w.clock - rec.startClock) / 1000, file, rec.time, rec.paused, rec.selected]); return { bytes: 1000 }; },
        cancel: async () => { rec.cancelled = true; }
      };
    },
    selectPlayer: async key => { if (opts.keyError) throw new Error(opts.keyError); w.keys.push([key, w.playback.time, w.playback.paused]); w.selected = key; },
    killGame: async () => { w.killed++; }
  };
  const lcu = io.lcu;
  io.lcu = async (method, p, body) => { if (p.endsWith('/watch')) w.watching = true; return lcu(method, p, body); };
  return { w, io };
}
const job = { gameId: 7300000099, duration: 1200, champion: 'Darius', championName: 'Darius', gameName: 'UCE Uawawa', moments: picked, file: (i, x) => `/videos/${i}_${x.start}.webm` };
(async () => {
  let { w, io } = fakeWorld();
  let r = await R.recordGame(io, job, { poll: 1000 });
  assert.deepStrictEqual(r.clips.map(x => [x.start, x.end, x.file]), [[355, 440, '/videos/0_355.webm'], [505, 550, '/videos/1_505.webm'], [805, 850, '/videos/2_805.webm'], [925, 1010, '/videos/3_925.webm']]);
  assert.deepStrictEqual(w.recorded.map(x => [x[0], x[2], x[3]]), [[85, 355, true], [45, 505, true], [45, 805, true], [85, 925, true]],
    'capture lancée replay en pause au début de l\'extrait, arrêtée quand le temps de jeu atteint la fin');
  assert.ok(w.recs.every(x => Math.abs(x.stopTime - Number(x.file.split('_')[1].split('.')[0]) - x.seconds) < 0.01), 'chaque extrait s\'arrête pile à sa fin en temps de jeu');
  assert.deepStrictEqual(r.clips.map(x => [x.lead, x.sync]), [[0, [[0, 355], [85, 440]]], [0, [[0, 505], [45, 550]]], [0, [[0, 805], [45, 850]]], [0, [[0, 925], [85, 1010]]]], 'lecture sans à-coups : début et fin');
  assert.deepStrictEqual(w.keys, [['3', 355, true], ['3', 505, true], ['3', 805, true], ['3', 925, true]], 'touche du joueur (3e de l\'équipe bleue dans le replay) avant chaque moment, replay en pause');
  assert.ok(w.recorded.every(x => x[4] === '3'), 'joueur sélectionné pendant chaque extrait');
  const HUD_JOUEUR = { interfaceReplay: true, interfaceTimeline: true, interfaceChat: true, outlineHover: true };
  assert.deepStrictEqual(w.renderPosts, [Object.assign({ killedBefore: 0 }, R.CLEAN_HUD), Object.assign({ killedBefore: 0 }, HUD_JOUEUR)],
    'interface épurée pendant le tournage, puis remise comme celle du joueur AVANT de fermer le replay ; pas de sélection par l\'API');
  assert.ok(w.log.some(x => x.startsWith('journal interface du replay remise comme avant')));
  assert.deepStrictEqual(R.CLEAN_HUD, { interfaceReplay: false, interfaceTimeline: false, interfaceChat: false, outlineHover: false });
  assert.ok(w.recs.every(x => x.source === 'fenetre'), 'fenêtre du jeu filmée');
  assert.ok(w.log.some(x => x.startsWith('POST /lol-replays/v1/rofls/')) && !w.log.some(x => x.includes('/create')), 'pas de création de fiche quand le replay est déjà proposé');
  assert.strictEqual(r.camera, '3');
  assert.strictEqual(w.killed, 1, 'jeu fermé à la fin');
  assert.ok(w.log.includes('POST /lol-replays/v1/rofls/7300000099/download {"componentType":"replay-button_match-history"}'), 'téléchargement demandé une fois');
  assert.strictEqual(w.log.filter(x => x.includes('/download')).length, 1);
  assert.ok(w.log.includes('Téléchargement du replay… 50 %'));
  assert.ok(w.log.some(x => x.endsWith('/watch {"componentType":"replay-button_match-history"}')));
  assert.ok(w.log.includes('Enregistrement 4/4…'));
  assert.ok(w.log.some(x => x.startsWith('journal extrait 4 filmé') && /"arret":"fin de l'extrait"/.test(x)), 'journal : chaque extrait, sa fin, son image');
  // replay mis en pause pendant un extrait (clic dans le jeu) : lecture relancée, synchronisation corrigée
  ({ w, io } = fakeWorld({ states: ['watch'], pauseAt: 370 }));
  r = await R.recordGame(io, job, { poll: 1000 });
  assert.ok(w.log.some(x => /journal replay en pause pendant l'enregistrement/.test(x)), 'lecture relancée');
  const c0 = r.clips[0];
  assert.ok(c0.sync.length >= 3, JSON.stringify(c0.sync));
  assert.strictEqual(w.recorded[0][0] > 85, true, 'extrait plus long en vidéo, mais complet en temps de jeu');
  assert.ok(Math.abs(R.videoAt(c0, 360) - 5) < 0.6 && Math.abs(R.videoAt(c0, 400) - (45 + (w.recorded[0][0] - 85))) < 1.2, 'seconde de la vidéo après la pause : ' + JSON.stringify(c0.sync) + ' ' + R.videoAt(c0, 400));
  // réglages d'interface du joueur différents : on remet les siens
  ({ w, io } = fakeWorld({ states: ['watch'], render: { interfaceReplay: true, interfaceTimeline: false, interfaceChat: false, outlineHover: true } }));
  await R.recordGame(io, job, { poll: 1000 });
  assert.deepStrictEqual(w.renderPosts.map(({ killedBefore, ...b }) => b)[1], { interfaceReplay: true, interfaceTimeline: false, interfaceChat: false, outlineHover: true });
  // interface du joueur illisible : on n'y touche pas du tout
  ({ w, io } = fakeWorld({ states: ['watch'], render: { cameraMode: 'top' } }));
  r = await R.recordGame(io, job, { poll: 1000 });
  assert.ok(r.clips.length === 4 && w.renderPosts.length === 0, 'interface laissée telle quelle');
  // conversion temps de jeu → seconde de la vidéo
  assert.strictEqual(R.videoAt({ start: 355, end: 440 }, 380), 25, 'ancienne vidéo : début de l\'extrait');
  assert.strictEqual(R.videoAt({ start: 355, lead: 0.4 }, 380), 25.4);
  assert.strictEqual(R.videoAt({ start: 355, sync: [[0.3, 355], [10.3, 365], [13.3, 365], [20.3, 372]] }, 370), 18.3, 'pause de 3 s du replay');
  assert.strictEqual(R.videoAt({ start: 355, sync: [[0.3, 355], [10.3, 365]] }, 300), 0, 'avant l\'extrait : 0');
  // replay bloqué : erreur claire, replay fermé, capture abandonnée
  ({ w, io } = fakeWorld({ states: ['watch'], stall: true }));
  await assert.rejects(R.recordGame(io, job, { poll: 1000 }), /n'avance plus depuis 15 s/);
  assert.ok(w.killed === 1 && w.recs[0].cancelled, 'replay fermé, capture abandonnée');
  assert.ok(w.renderPosts.length === 2 && w.renderPosts[1].killedBefore === 0 && w.renderPosts[1].interfaceChat === true, 'erreur : interface du joueur remise avant de fermer');
  // annulation par le joueur pendant un extrait
  ({ w, io } = fakeWorld({ states: ['watch'], cancelAfter: 30 }));
  await assert.rejects(R.recordGame(io, job, { poll: 1000 }), e => e.cancelled === true);
  assert.ok(w.killed === 1 && w.recs.length === 1 && w.recs[0].cancelled && !w.recorded.length, 'annulation : replay fermé, extrait en cours abandonné');
  assert.ok(w.renderPosts.length === 2 && w.renderPosts[1].interfaceReplay === true && w.renderPosts[1].killedBefore === 0, 'annulation : interface du joueur remise avant de fermer');
  // annulation pendant le téléchargement : rien à fermer
  ({ w, io } = fakeWorld({ states: ['download', 'downloading'], cancelAfter: 2 }));
  await assert.rejects(R.recordGame(io, job, { poll: 1000 }), e => e.cancelled === true);
  assert.strictEqual(w.killed, 0, 'pas de replay ouvert : rien à fermer');
  // image noire (fenêtre du jeu en plein écran exclusif sous Windows) : on filme l'écran à la place
  const blackWindow = rec => ({ samples: 6, black: rec.source === 'fenetre', frozenSec: 0, live: true, bytes: 100 });
  ({ w, io } = fakeWorld({ states: ['watch'], image: blackWindow }));
  r = await R.recordGame(io, job, { poll: 1000, screenFallback: true });
  assert.deepStrictEqual(w.recs.map(x => x.source), ['fenetre', 'ecran', 'ecran', 'ecran', 'ecran'], 'écran entier après une fenêtre noire');
  assert.ok(w.recs[0].cancelled && r.clips.length === 4 && r.clips.every(c => c.source === 'ecran'));
  assert.ok(w.log.some(x => /La fenêtre du jeu apparaît noire/.test(x)));
  // sans solution de repli (Mac) : erreur claire
  ({ w, io } = fakeWorld({ states: ['watch'], image: blackWindow }));
  await assert.rejects(R.recordGame(io, job, { poll: 1000 }), /vidéo du jeu est noire.*Sans bordure/);
  assert.strictEqual(w.killed, 1);
  // image figée alors que le jeu avance
  ({ w, io } = fakeWorld({ states: ['watch'], image: (rec, ww) => ({ samples: 20, black: false, frozenSec: (ww.clock - rec.startClock) / 1000 > 10 ? 6 : 0, live: true, bytes: 100 }) }));
  await assert.rejects(R.recordGame(io, job, { poll: 1000 }), /image du jeu s'est figée/);
  // analyse de l'image pas encore « vivante » (aucun changement vu) : on ne conclut rien
  ({ w, io } = fakeWorld({ states: ['watch'], image: () => ({ samples: 20, black: false, frozenSec: 30, live: false, bytes: 100 }) }));
  r = await R.recordGame(io, job, { poll: 1000 });
  assert.strictEqual(r.clips.length, 4);
  // vidéo trop lourde : arrêt avant la limite du stockage
  ({ w, io } = fakeWorld({ states: ['watch'], image: (rec, ww) => ({ samples: 4, black: false, frozenSec: 0, live: true, bytes: (ww.clock - rec.startClock) * 400 }) }));
  r = await R.recordGame(io, job, { poll: 1000 });
  assert.ok(w.recorded[0][0] < 85 && w.log.some(x => /"arret":"taille maximale"/.test(x)), 'arrêt à 28 Mo');
  // tests rapides : durée fixe
  ({ w, io } = fakeWorld({ states: ['watch'] }));
  r = await R.recordGame(io, job, { poll: 250, tick: 250, clipWall: 1500 });
  assert.deepStrictEqual(w.recorded.map(x => x[0]), [1.5, 1.5, 1.5, 1.5]);
  // ordre du replay indisponible : touche calculée par l'app (job.playerKey) ; équipe rouge
  ({ w, io } = fakeWorld({ noPlayerlist: true, states: ['watch'] }));
  r = await R.recordGame(io, Object.assign({}, job, { playerKey: 'w' }), { poll: 1000 });
  assert.deepStrictEqual(w.keys.map(x => x[0]), ['w', 'w', 'w', 'w']);
  // équipe rouge d'après le replay
  ({ w, io } = fakeWorld({ states: ['watch'], playerlist: [{ team: 'ORDER', championName: 'Garen' }, { team: 'CHAOS', championName: 'Ahri' }, { team: 'CHAOS', championName: 'Darius' }] }));
  r = await R.recordGame(io, job, { poll: 1000 });
  assert.strictEqual(w.keys[0][0], 'w', '2e joueur de l\'équipe rouge : touche W (Z en AZERTY)');
  // touche impossible à envoyer : arrêt clair, replay fermé
  ({ w, io } = fakeWorld({ states: ['watch'], keyError: 'La fenêtre du replay est introuvable.' }));
  await assert.rejects(R.recordGame(io, job, { poll: 1000 }), /fenêtre du replay est introuvable/);
  assert.strictEqual(w.killed, 1, 'replay fermé');
  // joueur introuvable (ni dans le replay ni dans la partie)
  ({ w, io } = fakeWorld({ states: ['watch'], noPlayerlist: true }));
  await assert.rejects(R.recordGame(io, Object.assign({}, job, { playerKey: null }), { poll: 1000 }), /Impossible de trouver Darius/);
  // fiche replay absente : créée par l'app ; si rien ne vient, on demande d'ouvrir l'historique
  ({ w, io } = fakeWorld({ states: ['checking', 'checking', 'checking', 'checking', 'checking', 'download', 'downloading', 'watch'] }));
  r = await R.recordGame(io, Object.assign({}, job, { label: 'Darius contre Garen' }), { poll: 10000, askAfter: 20000 });
  assert.ok(w.log.some(x => x.startsWith('POST /lol-replays/v2/metadata/7300000099/create')), 'fiche créée');
  assert.ok(w.log.some(x => /Ouvre l'historique des parties.*Darius contre Garen/.test(x)), 'consigne historique');
  assert.strictEqual(r.clips.length, 4);
  // erreurs claires
  ({ io } = fakeWorld({ states: ['checking'] }));
  await assert.rejects(R.recordGame(io, job, { poll: 10000, checkTimeout: 60000 }), /ne propose pas le replay de cette partie.*Historique/);
  for (const [st, re] of [['incompatible', /ancien patch/], ['missingOrExpired', /ne propose plus/], ['error', /10 replays par heure/]]) {
    ({ io } = fakeWorld({ states: [st] }));
    await assert.rejects(R.recordGame(io, job, { poll: 1000 }), re, st);
  }
  ({ io } = fakeWorld({ noClient: true }));
  await assert.rejects(R.recordGame(io, job), /client League of Legends ne répond pas/);
  ({ io } = fakeWorld({ disabled: true }));
  await assert.rejects(R.recordGame(io, job), /replays sont désactivés/);
  ({ io } = fakeWorld({ states: ['downloading'] }));
  await assert.rejects(R.recordGame(io, job, { poll: 1000, downloadTimeout: 20000 }), /trop de temps/);
  ({ io } = fakeWorld({ states: ['watch'], loadPolls: 1e9 }));
  await assert.rejects(R.recordGame(io, job, { poll: 1000, loadTimeout: 20000 }), /EnableReplayApi=1/);
  console.log('✅ Vidéos des moments (replay) : OK');
})().catch(e => { console.error(e); process.exit(1); });
