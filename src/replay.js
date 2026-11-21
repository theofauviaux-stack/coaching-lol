// Vidéos des moments clés, filmées sur l'ordinateur du coach à partir du replay de la partie :
//   1. client LoL (API locale « LCU ») : téléchargement du replay puis lancement ;
//   2. Replay API du jeu (https://127.0.0.1:2999, EnableReplayApi=1 dans game.cfg) : aller à chaque moment,
//      caméra sur le joueur suivi ;
//   3. enregistrement de la fenêtre du jeu (fait par main.js) : l'app démarre la capture, relance la lecture, suit le
//      temps de jeu et arrête l'extrait pile à la bonne seconde ; elle note la correspondance seconde de la vidéo ↔
//      temps de jeu (« sync ») et vérifie que l'image n'est ni noire ni figée ;
//   4. fermeture du jeu (aussi en cas d'erreur ou d'annulation).
// Ce fichier ne touche ni au réseau ni à l'écran : tout passe par les fonctions données dans `io`
// (voir tests/replay.js et main.js).
const BEFORE = 35; // secondes filmées avant le moment (la lecture commence 30 s avant : 5 s de marge)
const AFTER = 10; // et après
const MAX_CLIP = 90; // deux moments proches partagent un extrait, sans dépasser 90 s
const GAP = 15; // moins de 15 s entre deux extraits : on filme d'un seul tenant
const MAX_BYTES = 28 * 1048576; // le stockage refuse les vidéos de plus de 30 Mo : on s'arrête avant
// Interface du replay pendant le tournage : sans le panneau de contrôle du replay, sa frise ni le chat (ils cachent le
// jeu), sans surbrillance au passage de la souris ; on garde tableau des scores, mini-carte, barres de vie et annonces.
const CLEAN_HUD = { interfaceReplay: false, interfaceTimeline: false, interfaceChat: false, outlineHover: false };
const IMAGE_ERRORS = {
  noire: 'La vidéo du jeu est noire. Garde la fenêtre du replay visible (ne la réduis pas), mets League of Legends en mode « Sans bordure » '
    + '(Paramètres › Vidéo › Mode fenêtre), puis relance « Filmer les moments ». Sur Mac, vérifie aussi l\'autorisation « Enregistrement de l\'écran ».',
  figée: 'L\'image du jeu s\'est figée pendant l\'enregistrement. Garde la fenêtre du replay visible (ne la réduis pas, ne change pas de bureau), '
    + 'puis relance « Filmer les moments ».'
};
const r1 = x => Math.round(x * 10) / 10;

// Seconde de la vidéo d'un extrait qui montre l'instant g (secondes de jeu). Avec « sync » (paires [seconde de la vidéo,
// temps de jeu] mesurées pendant le tournage), la correspondance est exacte même si le replay a marqué une pause ;
// sinon : début de la vidéo = début de l'extrait (+ « lead », le temps entre le début de la capture et la lecture).
// (copie dans renderer/app.js)
function videoAt(c, g) {
  const s = Array.isArray(c && c.sync) ? c.sync.filter(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)) : [];
  if (s.length >= 2) {
    const last = s[s.length - 1];
    if (g <= s[0][1]) return Math.max(0, s[0][0] - (s[0][1] - g)); // hors des points mesurés : 1 s de jeu = 1 s de vidéo
    if (g >= last[1]) return Math.max(0, last[0] + (g - last[1]));
    let i = 1;
    while (s[i][1] < g) i++;
    const [v0, g0] = s[i - 1], [v1, g1] = s[i];
    return Math.max(0, v0 + (g - g0) * (v1 - v0) / (g1 - g0));
  }
  return Math.max(0, (Number(c && c.lead) || 0) + (g - ((c && c.start) || 0)));
}

// Moments à filmer : morts, objectifs perdus, kills, objectifs pris où il était (10 au maximum)
function pickMoments(m, max = 10) {
  const rank = x => (x.type === 'mort' ? 0 : x.type === 'objectif' && x.tone === 'bad' ? 1 : x.type === 'kill' ? 2 : x.type === 'objectif' && (x.tags || []).includes('présent') ? 3 : 9);
  return (m.moments || []).filter(x => rank(x) < 9).sort((a, b) => rank(a) - rank(b) || a.t - b.t).slice(0, max).sort((a, b) => a.t - b.t);
}

// Fenêtres à filmer (en secondes de jeu), fusionnées quand deux moments se chevauchent
function clipWindows(moments, duration = Infinity) {
  const out = [];
  for (const x of moments) {
    const s = Math.max(0, Math.round(x.t / 1000) - BEFORE);
    const e = Math.min(duration, Math.round(x.t / 1000) + AFTER);
    const last = out[out.length - 1];
    if (last && s <= last.end + GAP && e - last.start <= MAX_CLIP) { last.end = Math.max(last.end, e); last.times.push(x.t); } else out.push({ start: s, end: e, times: [x.t] });
  }
  return out;
}

// lockfile du client : « LeagueClient:pid:port:motdepasse:https »
function lockfileInfo(text) {
  const p = String(text || '').trim().split(':');
  return p.length >= 5 && /^\d+$/.test(p[2]) ? { port: Number(p[2]), password: p[3], protocol: p[4] } : null;
}
// arguments de LeagueClientUx (autre façon de trouver le port)
function lcuFromArgs(text) {
  const port = String(text || '').match(/--app-port=(\d+)/);
  const pass = String(text || '').match(/--remoting-auth-token=([\w-]+)/);
  return port && pass ? { port: Number(port[1]), password: pass[1], protocol: 'https' } : null;
}

// game.cfg : ajoute EnableReplayApi=1 dans [General] (sans toucher au reste)
function enableReplayApi(cfg) {
  const text = String(cfg || '');
  if (/^[ \t]*EnableReplayApi[ \t]*=[ \t]*1[ \t]*\r?$/m.test(text)) return { text, changed: false };
  if (/^[ \t]*EnableReplayApi[ \t]*=[^\r\n]*/m.test(text)) return { text: text.replace(/^[ \t]*EnableReplayApi[ \t]*=[^\r\n]*/m, 'EnableReplayApi=1'), changed: true };
  const nl = text.includes('\r\n') ? '\r\n' : '\n';
  if (/^\[General\][ \t]*\r?$/m.test(text)) return { text: text.replace(/^\[General\][ \t]*(?=\r?$)/m, m => m + nl + 'EnableReplayApi=1'), changed: true };
  return { text: (text && !text.endsWith(nl) ? text + nl : text) + '[General]' + nl + 'EnableReplayApi=1' + nl, changed: true };
}

const REPLAY_ERRORS = {
  incompatible: 'Ce replay vient d\'un ancien patch : League of Legends ne peut plus l\'ouvrir.',
  missingOrExpired: 'Riot ne propose plus le replay de cette partie (trop ancienne).',
  lost: 'Riot ne propose plus le replay de cette partie.',
  unsupported: 'Riot ne propose pas de replay pour cette partie.',
  error: 'Le client LoL n\'a pas pu télécharger le replay (limite de 10 replays par heure ?). Réessaie un peu plus tard.'
};

/**
 * io : {
 *   lcu(method, path, body) → réponse JSON (lève une erreur si le client ne répond pas)
 *   replay(method, path, body) → réponse JSON de la Replay API (lève une erreur tant que le jeu n'est pas prêt)
 *   startRecording(file, { seconds, source }) → Promise d'un enregistrement en cours, une fois la capture lancée :
 *     { health() → { samples, black, frozenSec, bytes, live }, stop() → Promise ({ bytes }), cancel() → Promise, info }
 *     source : 'fenetre' (fenêtre du jeu) ou 'ecran' (écran entier)
 *   selectPlayer(touche) ; killGame() → Promise ; sleep(ms) ; now() ; status(texte, avancement) ; log(quoi, détail)
 * }
 * Toutes ces fonctions peuvent lever une erreur (annulation par le joueur comprise) : le replay est alors fermé et
 * l'enregistrement en cours abandonné.
 * job : { gameId, duration, champion, championName, gameName, moments: [...], file(i, w) → chemin }
 * opt : délais (tests), screenFallback (Windows : filmer l'écran si la fenêtre du jeu sort noire), clipWall (tests :
 *   durée fixe des extraits en ms)
 * Renvoie { clips: [{ start, end, times, file, lead, sync, source }], camera }.
 */
async function recordGame(io, job, opt = {}) {
  const o = Object.assign({ downloadTimeout: 8 * 60000, askAfter: 20000, checkTimeout: 4 * 60000, loadTimeout: 5 * 60000, seekTimeout: 25000, attachTimeout: 20000, poll: 1500,
    tick: 1000, stallTimeout: 15000, maxBytes: MAX_BYTES, screenFallback: false, clipWall: 0 }, opt);
  const status = io.status || (() => {});
  const log = io.log || (() => {}); // journal local (diagnostic), jamais de mot de passe
  // avancement global (barre de progression) : recherche 0-5 %, téléchargement 5-40 %, ouverture 40-45 %, extraits 45-98 %
  const windows = clipWindows(job.moments, job.duration || Infinity);
  const total = windows.reduce((n, w) => n + (w.end - w.start), 0) || 1;
  const wait = async (fn, ms, label) => {
    const t0 = io.now();
    for (;;) {
      const r = await fn().catch(() => null);
      if (r) return r;
      if (io.now() - t0 > ms) throw new Error(label);
      await io.sleep(o.poll);
    }
  };
  // 1. client LoL
  let conf;
  try { conf = await io.lcu('GET', '/lol-replays/v1/configuration'); } catch (e) {
    throw new Error('Le client League of Legends ne répond pas : ouvre-le (connecté à ton compte) puis réessaie.');
  }
  if (conf && conf.isReplaysEnabled === false) throw new Error('Les replays sont désactivés dans ton client League of Legends (ou un patch est en cours de téléchargement).');
  if (conf && conf.isPatching) throw new Error('Le client League of Legends est en train de se mettre à jour : réessaie quand il a fini.');
  // 2. téléchargement du replay. Le client ne connaît le replay d'une partie qu'une fois sa fiche créée
  // (ce que fait l'historique des parties quand on l'ouvre) : on la crée, puis on suit son état.
  const meta = () => io.lcu('GET', `/lol-replays/v1/metadata/${job.gameId}`).catch(() => null);
  const body = { gameId: job.gameId, gameType: job.gameType || 'MATCHED_GAME', queueId: typeof job.queueId === 'number' ? job.queueId : 420, gameEnd: job.gameEnd || 0, gameVersion: job.gameVersion || '' };
  const create = async () => {
    // ce que fait l'historique des parties du client quand on clique sur une partie
    await io.lcu('GET', `/lol-match-history/v1/games/${job.gameId}`).catch(() => null);
    const r = await io.lcu('POST', `/lol-replays/v2/metadata/${job.gameId}/create`, body).catch(() => null);
    if (r === null) await io.lcu('POST', `/lol-replays/v1/metadata/${job.gameId}/create`, body).catch(() => null);
  };
  status('Recherche du replay dans le client League of Legends…', 0.02);
  let m = await meta();
  log('fiche replay', m);
  let lastCreate = -Infinity;
  let lastState = m ? m.state : null;
  if (!m || !['download', 'downloading', 'watch'].includes(m.state)) { await create(); lastCreate = io.now(); m = await meta(); }
  let askedAt = null;
  const t0 = io.now();
  while (!m || m.state !== 'watch') {
    const st = m ? m.state : 'inconnu';
    if (REPLAY_ERRORS[st]) throw new Error(REPLAY_ERRORS[st]);
    const sec = Math.round((io.now() - t0) / 1000);
    if (st === 'download') {
      if (askedAt === null || io.now() - askedAt > 20000) { // demande (ou nouvelle demande si rien ne bouge)
        status('Téléchargement du replay…', 0.05);
        await io.lcu('POST', `/lol-replays/v1/rofls/${job.gameId}/download`, { componentType: 'replay-button_match-history' }).catch(() => null);
        askedAt = io.now();
      }
    } else if (st === 'downloading') {
      const p = Math.max(0, Math.min(1, (m.downloadProgress || 0) / (m.downloadProgress > 1 ? 100 : 1)));
      status('Téléchargement du replay… ' + Math.round(p * 100) + ' %', 0.05 + 0.35 * p);
    } else {
      // « checking » ou pas encore de fiche : le client interroge Riot. Si ça ne vient pas tout seul, on demande
      // au joueur d'ouvrir la partie dans l'historique du client (ce qui déclenche la vérification) et on attend.
      if (io.now() - t0 < o.askAfter) status('Le client League of Legends vérifie le replay chez Riot… (' + sec + ' s)', 0.03);
      else status('Ouvre l\'historique des parties dans le client League of Legends (Profil › Historique) et clique sur la partie '
        + (job.label || '') + ' : l\'app continue toute seule dès que le replay est disponible. (' + sec + ' s)', 0.03);
      if (io.now() - lastCreate > 15000) { await create(); lastCreate = io.now(); }
      if (io.now() - t0 > o.checkTimeout) {
        throw new Error('Le client League of Legends ne propose pas le replay de cette partie (état « ' + st + ' » au bout de ' + sec + ' s). '
          + 'Dans le client : Profil › Historique, clique sur la partie. S\'il n\'y a pas de bouton pour télécharger le replay, Riot ne le propose pas (partie d\'un autre patch, ou trop ancienne).');
      }
    }
    if (io.now() - t0 > o.downloadTimeout) throw new Error('Le replay met trop de temps à se télécharger.');
    await io.sleep(o.poll);
    m = await meta();
    if ((m ? m.state : null) !== lastState) { lastState = m ? m.state : null; log('état du replay', m); }
  }
  // à partir d'ici le replay est ouvert : en cas d'erreur, on le ferme
  let key = job.playerKey || null;
  const clips = [];
  let rec = null; // enregistrement en cours
  try {
    // 3. lancement et attente de la Replay API
    status('Ouverture du replay dans League of Legends…', 0.41);
    await io.lcu('POST', `/lol-replays/v1/rofls/${job.gameId}/watch`, { componentType: 'replay-button_match-history' });
    await wait(async () => { const p = await io.replay('GET', '/replay/playback'); return p && p.length > 0 ? p : null; }, o.loadTimeout,
      'Le replay ne s\'est pas ouvert, ou la Replay API ne répond pas (EnableReplayApi=1 dans game.cfg).');
    // caméra sur le champion du joueur. L'API du replay ne sait pas choisir le joueur suivi : on fait comme dans le
    // jeu, un double appui sur la touche du joueur (1 à 5 : équipe bleue ; touches Q W E R T : équipe rouge, position
    // physique), qui le sélectionne et centre la caméra sur lui en continu. Ordre des joueurs : celui du replay.
    const norm = x => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const champs = [job.champion, job.championName].map(norm).filter(Boolean);
    try {
      const list = await io.replay('GET', '/liveclientdata/playerlist');
      const arr = Array.isArray(list) ? list : [];
      const me = arr.find(p => champs.includes(norm(p.championName)) || champs.includes(norm(String(p.rawChampionName || '').split('_').pop())));
      if (me && me.team) {
        const idx = arr.filter(p => p.team === me.team).indexOf(me);
        if (idx >= 0 && idx < 5) key = (me.team === 'CHAOS' ? 'qwert' : '12345')[idx];
      }
      log('joueurs du replay', arr.map(p => ({ equipe: p.team, champion: p.championName, nom: p.riotIdGameName || p.summonerName })));
    } catch (e) { log('joueurs du replay', 'indisponible : ' + e.message); }
    if (!key) throw new Error('Impossible de trouver ' + (job.championName || job.champion) + ' parmi les joueurs du replay.');
    log('touche du joueur', key);
    try { await io.replay('POST', '/replay/render', CLEAN_HUD); log('interface du replay épurée', CLEAN_HUD); } catch (e) { log('interface du replay', 'inchangée : ' + e.message); }
    const select = async () => {
      await io.selectPlayer(key); // erreur claire si la touche ne peut pas être envoyée (fenêtre, autorisation)
      const r = await io.replay('GET', '/replay/render').catch(() => null);
      log('caméra après la touche ' + key, r && { selectionName: r.selectionName, cameraAttached: r.cameraAttached, cameraMode: r.cameraMode });
    };

    // 4. un extrait par fenêtre : replay en pause au début de l'extrait, caméra sur le champion, capture lancée, puis
    // lecture. L'extrait s'arrête quand le temps de jeu atteint sa fin (pas au chronomètre : si le replay marque une
    // pause, on ne perd pas la fin du moment).
    let done = 0;
    let source = 'fenetre';
    const at = d => 0.45 + 0.53 * Math.min(1, d / total);
    for (let i = 0; i < windows.length; i++) {
      const w = windows[i];
      const len = w.end - w.start;
      const label = `Enregistrement ${i + 1}/${windows.length}…`;
      status(label, at(done));
      await io.replay('POST', '/replay/playback', { time: w.start, paused: true, speed: 1 });
      await wait(async () => { const p = await io.replay('GET', '/replay/playback'); return p && !p.seeking && Math.abs(p.time - w.start) < 2 ? p : null; }, o.seekTimeout, 'Le replay ne répond plus.');
      await select(); // avant chaque moment : le joueur est sélectionné, la caméra centrée sur lui
      const file = job.file(i, w);
      rec = await io.startRecording(file, { seconds: len, source });
      const t0 = io.now();
      await io.replay('POST', '/replay/playback', { paused: false, speed: 1 });
      const lead = (io.now() - t0) / 1000;
      const sync = [[r1(lead), w.start]];
      let g = w.start, gAt = io.now(), prev = null, kept = lead, relaunched = 0, bad = null, why = 'fin de l\'extrait';
      for (;;) {
        await io.sleep(o.tick);
        const now = io.now();
        const v = (now - t0) / 1000;
        const p = await io.replay('GET', '/replay/playback').catch(() => null);
        if (p && typeof p.time === 'number') {
          if (p.time > g + 0.05) { g = p.time; gAt = now; }
          // on garde un point de synchronisation quand l'écart vidéo / jeu change (pause, ralentissement du replay)
          const cur = [r1(v), r1(p.time)];
          const off = cur[0] - (cur[1] - w.start);
          if (Math.abs(off - kept) > 0.4) { if (prev && sync[sync.length - 1] !== prev) sync.push(prev); sync.push(cur); kept = off; }
          prev = cur;
          if (p.time >= w.end - 0.05) break;
          if (p.length && p.time >= p.length - 1) { why = 'fin du replay'; break; }
          if (p.paused && now - gAt > 1500) { // clic ou touche Espace dans le jeu : on relance la lecture
            if (++relaunched > 3) throw new Error('Le replay se remet en pause tout seul. Ne touche pas au jeu pendant l\'enregistrement, puis relance « Filmer les moments ».');
            log('replay en pause pendant l\'enregistrement : lecture relancée', { temps: r1(p.time) });
            await io.replay('POST', '/replay/playback', { paused: false, speed: 1 }).catch(() => null);
          }
        }
        if (now - gAt > o.stallTimeout) throw new Error('Le replay n\'avance plus depuis ' + Math.round(o.stallTimeout / 1000) + ' s. Annule puis relance « Filmer les moments ».');
        const h = rec.health ? rec.health() : null;
        if (h) {
          if (h.black) bad = 'noire';
          else if (h.live && h.frozenSec >= 5 && now - gAt < 2000) bad = 'figée'; // le jeu avance mais l'image ne bouge plus
          if (bad) break;
          if (h.bytes >= o.maxBytes) { why = 'taille maximale'; break; }
        }
        status(label, at(done + Math.min(len, Math.max(0, g - w.start))));
        if (o.clipWall && now - t0 >= o.clipWall) { why = 'durée fixe (test)'; break; }
        if (now - t0 > (len + 30) * 1000 + o.stallTimeout) { why = 'durée maximale'; break; }
      }
      if (bad) {
        log('image ' + bad, Object.assign({ extrait: i + 1, source }, rec.health()));
        const r = rec; rec = null;
        await r.cancel().catch(() => {});
        if (source === 'fenetre' && o.screenFallback) {
          source = 'ecran';
          status('La fenêtre du jeu apparaît ' + bad + ' : l\'app filme l\'écran à la place…', at(done));
          i--;
          continue;
        }
        throw new Error(IMAGE_ERRORS[bad]);
      }
      if (prev && sync[sync.length - 1] !== prev) sync.push(prev);
      const h = rec.health ? rec.health() : null;
      const r = rec; rec = null;
      const res = await r.stop();
      const filmed = r.source || source; // ce qui a vraiment été filmé (écran entier si la fenêtre du jeu est introuvable)
      log('extrait ' + (i + 1) + ' filmé', { de: w.start, a: w.end, arret: why, lead: r1(lead), sync, octets: res && res.bytes, image: h, source: filmed });
      done += len;
      clips.push(Object.assign({ file, lead: r1(lead), sync, source: filmed }, w));
    }
  } catch (e) {
    if (rec) await rec.cancel().catch(() => {});
    await io.killGame().catch(() => {});
    throw e;
  }
  status('Fermeture du replay…', 0.99);
  await io.killGame().catch(() => {});
  return { clips, camera: key };
}

module.exports = { pickMoments, clipWindows, lockfileInfo, lcuFromArgs, enableReplayApi, recordGame, videoAt, BEFORE, AFTER, MAX_BYTES, CLEAN_HUD, REPLAY_ERRORS, IMAGE_ERRORS };
