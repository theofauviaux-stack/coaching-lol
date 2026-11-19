// Vidéos des moments clés, filmées sur l'ordinateur du coach à partir du replay de la partie :
//   1. client LoL (API locale « LCU ») : téléchargement du replay puis lancement ;
//   2. Replay API du jeu (https://127.0.0.1:2999, EnableReplayApi=1 dans game.cfg) : aller à chaque moment,
//      caméra sur le joueur suivi ;
//   3. enregistrement de la fenêtre du jeu (fait par main.js), 30 s environ par moment ;
//   4. fermeture du jeu.
// Ce fichier ne touche ni au réseau ni à l'écran : tout passe par les fonctions données dans `io`
// (voir tests/replay.js et main.js).
const BEFORE = 20; // secondes filmées avant le moment
const AFTER = 10; // et après
const MAX_CLIP = 75; // deux moments proches partagent un extrait, sans dépasser 75 s
const GAP = 15; // moins de 15 s entre deux extraits : on filme d'un seul tenant

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
 *   record(seconds, file) → Promise (enregistre la fenêtre du jeu)
 *   killGame() → Promise ; sleep(ms) ; now() ; status(texte)
 * }
 * job : { gameId, duration, champion, championName, gameName, moments: [...], file(i, w) → chemin }
 * Renvoie [{ start, end, times, file }].
 */
async function recordGame(io, job, opt = {}) {
  const o = Object.assign({ downloadTimeout: 6 * 60000, loadTimeout: 5 * 60000, seekTimeout: 25000, poll: 1500 }, opt);
  const status = io.status || (() => {});
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
  // 2. téléchargement du replay
  const meta = () => io.lcu('GET', `/lol-replays/v1/metadata/${job.gameId}`).catch(() => null);
  let m = await meta();
  let asked = false;
  const t0 = io.now();
  while (!m || m.state !== 'watch') {
    const st = m ? m.state : 'checking';
    if (REPLAY_ERRORS[st]) throw new Error(REPLAY_ERRORS[st]);
    if (st === 'download' && !asked) {
      status('Téléchargement du replay…');
      await io.lcu('POST', `/lol-replays/v1/rofls/${job.gameId}/download`, { componentType: 'replay-button_match-history' });
      asked = true;
    } else if (st === 'downloading') status('Téléchargement du replay… ' + Math.round((m.downloadProgress || 0) * (m.downloadProgress > 1 ? 1 : 100)) + ' %');
    if (io.now() - t0 > o.downloadTimeout) throw new Error('Le replay met trop de temps à se télécharger.');
    await io.sleep(o.poll);
    m = await meta();
  }
  // 3. lancement et attente de la Replay API
  status('Ouverture du replay dans League of Legends…');
  await io.lcu('POST', `/lol-replays/v1/rofls/${job.gameId}/watch`, { componentType: 'replay-button_match-history' });
  await wait(async () => { const p = await io.replay('GET', '/replay/playback'); return p && p.length > 0 ? p : null; }, o.loadTimeout,
    'Le replay ne s\'est pas ouvert, ou la Replay API ne répond pas (EnableReplayApi=1 dans game.cfg).');
  // caméra sur le joueur : on essaie le nom du champion, son nom affiché, puis le pseudo
  const names = [...new Set([job.champion, job.championName, job.gameName].filter(Boolean))];
  let attached = null;
  const attach = async () => {
    for (const n of attached ? [attached] : names) {
      try {
        await io.replay('POST', '/replay/render', { cameraAttached: true, selectionName: n, cameraMode: 'top' });
        const r = await io.replay('GET', '/replay/render');
        if (r && String(r.selectionName || '').toLowerCase() === n.toLowerCase()) { attached = n; return true; }
      } catch (e) { /* nom suivant */ }
    }
    return false;
  };
  await attach();
  // 4. un extrait par fenêtre
  const windows = clipWindows(job.moments, job.duration || Infinity);
  const clips = [];
  for (let i = 0; i < windows.length; i++) {
    const w = windows[i];
    status(`Enregistrement ${i + 1}/${windows.length}…`);
    await io.replay('POST', '/replay/playback', { time: w.start, paused: false, speed: 1 });
    await wait(async () => { const p = await io.replay('GET', '/replay/playback'); return p && !p.seeking && Math.abs(p.time - w.start) < 4 ? p : null; }, o.seekTimeout, 'Le replay ne répond plus.');
    await attach();
    const file = job.file(i, w);
    await io.record(w.end - w.start, file);
    clips.push(Object.assign({ file }, w));
  }
  status('Fermeture du replay…');
  await io.killGame().catch(() => {});
  return { clips, camera: attached };
}

module.exports = { pickMoments, clipWindows, lockfileInfo, lcuFromArgs, enableReplayApi, recordGame, BEFORE, AFTER, REPLAY_ERRORS };
