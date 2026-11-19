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

// ---- enregistrement complet avec un faux client et un faux jeu
function fakeWorld(opts = {}) {
  const w = { clock: 0, log: [], states: opts.states || ['download', 'downloading', 'downloading', 'watch'], loadPolls: opts.loadPolls || 2, playback: { time: 0, seeking: false, length: 1200, paused: true }, render: { selectionName: '' }, renderPosts: [], recorded: [], killed: 0 };
  let si = 0, loaded = 0;
  const io = {
    now: () => w.clock, sleep: async ms => { w.clock += ms; }, status: t => w.log.push(t),
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
        if (method === 'POST') { Object.assign(w.playback, body, { seeking: true }); return w.playback; }
        const r = Object.assign({}, w.playback); w.playback.seeking = false; return r;
      }
      if (p === '/replay/render') {
        // comme le jeu : la sélection et l'attache de la caméra sont deux réglages ; l'attache vaut pour la sélection en cours
        if (method === 'POST') {
          w.renderPosts.push(body);
          if ('selectionName' in body) w.render.selectionName = body.selectionName === (opts.selectable || 'UCE Uawawa') ? body.selectionName : '';
          if ('cameraAttached' in body) w.render.cameraAttached = !!body.cameraAttached && !!w.render.selectionName && !('selectionName' in body);
          return w.render;
        }
        return w.render;
      }
      if (p === '/liveclientdata/playerlist') return opts.playerlist || [{ championName: 'Garen', riotIdGameName: 'Demacia', summonerName: 'Demacia#FR1' }, { championName: 'Darius', riotIdGameName: 'UCE Uawawa', summonerName: 'UCE Uawawa#000', rawChampionName: 'game_character_displayname_Darius' }];
      return {};
    },
    record: async (s, file) => { w.recorded.push([s, file, w.playback.time, w.playback.paused]); w.clock += s * 1000; },
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
  assert.deepStrictEqual(w.recorded.map(x => [x[0], x[2], x[3]]), [[85, 355, false], [45, 505, false], [45, 805, false], [85, 925, false]], 'chaque extrait filmé depuis le bon moment, replay relancé après la pause');
  assert.ok(!w.renderPosts.some(b => 'selectionName' in b && 'cameraAttached' in b), 'sélection et attache de la caméra envoyées séparément');
  assert.ok(w.renderPosts.every(b => !('selectionName' in b) || b.selectionName === 'UCE Uawawa' || r.camera === 'UCE Uawawa'), 'caméra sur le joueur');
  assert.ok(w.log.some(x => x.startsWith('POST /lol-replays/v1/rofls/')) && !w.log.some(x => x.includes('/create')), 'pas de création de fiche quand le replay est déjà proposé');
  assert.strictEqual(r.camera, 'UCE Uawawa', 'caméra accrochée au champion du joueur');
  assert.strictEqual(w.killed, 1, 'jeu fermé à la fin');
  assert.ok(w.log.includes('POST /lol-replays/v1/rofls/7300000099/download {"componentType":"replay-button_match-history"}'), 'téléchargement demandé une fois');
  assert.strictEqual(w.log.filter(x => x.includes('/download')).length, 1);
  assert.ok(w.log.includes('Téléchargement du replay… 50 %'));
  assert.ok(w.log.some(x => x.endsWith('/watch {"componentType":"replay-button_match-history"}')));
  assert.ok(w.log.includes('Enregistrement 4/4…'));
  // caméra : le jeu attend le nom du champion
  ({ w, io } = fakeWorld({ selectable: 'Darius', states: ['watch'] }));
  r = await R.recordGame(io, job, { poll: 1000 });
  assert.strictEqual(r.camera, 'Darius');
  // caméra : le jeu attend le pseudo (trouvé dans la liste des joueurs du replay, même sans le connaître)
  ({ w, io } = fakeWorld({ selectable: 'UCE Uawawa', states: ['watch'] }));
  r = await R.recordGame(io, Object.assign({}, job, { gameName: '' }), { poll: 1000 });
  assert.strictEqual(r.camera, 'UCE Uawawa');
  // caméra impossible à placer sur le champion : arrêt (pas de vidéo en caméra libre)
  ({ w, io } = fakeWorld({ selectable: 'personne', states: ['watch'] }));
  await assert.rejects(R.recordGame(io, job, { poll: 1000, attachTimeout: 5000 }), /caméra n'a pas pu suivre Darius/);
  assert.strictEqual(w.killed, 1, 'replay fermé');
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
