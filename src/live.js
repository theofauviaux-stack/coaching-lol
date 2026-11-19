// Parties en direct (API Riot spectator-v5) et lancement du mode spectateur de League of Legends.
// Tout ce qui est ici est pur (sans Electron) pour être testé sans réseau : voir tests/live.js.
const path = require('path');
const lp = require('./lp');

const QUEUE_SOLO = 420; // classée Solo/Duo

// Rang Solo/Duo à partir des entrées league-v4 (null si non classé)
function soloRank(entries) {
  const e = (entries || []).find(x => x.queueType === 'RANKED_SOLO_5x5');
  if (!e) return null;
  const apex = lp.TIERS.indexOf(e.tier) >= 7;
  return {
    tier: e.tier, label: (lp.TIERS_FR[e.tier] || e.tier) + (apex ? '' : ' ' + e.rank),
    lp: e.leaguePoints, wins: e.wins, losses: e.losses, score: lp.rankScore(e.tier, e.rank, e.leaguePoints)
  };
}

function splitRiotId(id) {
  const s = String(id || '');
  const i = s.lastIndexOf('#');
  return i > 0 ? { gameName: s.slice(0, i), tagLine: s.slice(i + 1) } : { gameName: s, tagLine: '' };
}

// ---------------------------------------------------------------- smurfs (comptes secondaires)
const RIOT_ID = /^[^#]{1,32}#[^#\s]{2,6}$/;
const MAX_SMURFS = 6;
// Texte saisi (un pseudo par ligne, ou séparés par des virgules) → { list, bad }
function parseSmurfs(text) {
  const list = [], bad = [], seen = new Set();
  for (const raw of String(text || '').split(/[\n,;]+/)) {
    const id = raw.trim().replace(/\s*#\s*/, '#');
    if (!id) continue;
    if (!RIOT_ID.test(id)) { bad.push(id); continue; }
    const k = id.toLowerCase();
    if (!seen.has(k)) { seen.add(k); list.push(id); }
  }
  return { list: list.slice(0, MAX_SMURFS), bad, tooMany: list.length > MAX_SMURFS };
}

// Comptes à surveiller : compte principal + smurfs de chaque joueur (ceux dont le puuid est connu)
function trackedAccounts(players) {
  const out = [];
  for (const p of players || []) {
    if (p.puuid) out.push({ puuid: p.puuid, playerId: p.id, region: p.region, riotId: p.riotId, smurf: null });
    for (const sm of p.smurfs || []) if (sm && sm.puuid) out.push({ puuid: sm.puuid, playerId: p.id, region: p.region, riotId: sm.riotId, smurf: sm.riotId });
  }
  return out;
}

// Partie brute de l'API → partie affichable, vue depuis l'équipe du (premier) joueur suivi.
// players : joueurs suivis ({ id, puuid, riotId, smurfs }) ; ranks : { puuid: rang } ; champKeys : { "103": "Ahri" }
function buildGame(raw, players, ranks = {}, champKeys = {}, now = Date.now()) {
  const ours = new Map(trackedAccounts(players).map(a => [a.puuid, a]));
  const parts = (raw.participants || []).map(x => {
    const me = x.puuid ? ours.get(x.puuid) : null;
    const rid = splitRiotId(x.riotId || (me && me.riotId) || '');
    return {
      puuid: x.puuid || null, gameName: rid.gameName, tagLine: rid.tagLine, hidden: !rid.gameName,
      teamId: x.teamId, championId: x.championId, champion: champKeys[String(x.championId)] || null,
      spells: [x.spell1Id, x.spell2Id], keystone: x.perks && x.perks.perkIds ? x.perks.perkIds[0] : null,
      subStyle: x.perks ? x.perks.perkSubStyle : null, bot: !!x.bot,
      playerId: me ? me.playerId : null, smurf: me ? me.smurf : null, rank: x.puuid && ranks[x.puuid] !== undefined ? ranks[x.puuid] : null
    };
  });
  const mine = parts.filter(x => x.playerId);
  const teamId = mine.length ? mine[0].teamId : 100;
  const bans = (raw.bannedChampions || []).filter(b => b.championId > 0).sort((a, b) => a.pickTurn - b.pickTurn);
  const banList = side => bans.filter(b => (b.teamId === teamId) === side).map(b => champKeys[String(b.championId)] || null).filter(Boolean);
  return {
    gameId: raw.gameId, platformId: raw.platformId, queueId: raw.gameQueueConfigId,
    startTime: raw.gameStartTime > 0 ? raw.gameStartTime : null, length: raw.gameLength || 0, fetchedAt: now,
    key: raw.observers ? raw.observers.encryptionKey : '',
    playerIds: mine.map(x => x.playerId), teamId,
    allies: parts.filter(x => x.teamId === teamId), enemies: parts.filter(x => x.teamId !== teamId),
    bans: { allies: banList(true), enemies: banList(false) }
  };
}

// Secondes écoulées depuis le début de la partie
function elapsed(game, now = Date.now()) {
  if (game.startTime) return Math.max(0, Math.round((now - game.startTime) / 1000));
  return Math.max(0, Math.round(game.length + (now - game.fetchedAt) / 1000));
}

// ---------------------------------------------------------------- mode spectateur
// Serveur d'observation de Riot (depuis le patch 14.1 : spectator.<plateforme>.lol.pvp.net:8080)
const spectatorHost = platformId => `spectator.${String(platformId).toLowerCase()}.lol.pvp.net:8080`;

function checkGame(game) {
  if (!game || !/^\d+$/.test(String(game.gameId))) return 'Partie inconnue.';
  if (!/^[A-Z0-9]{2,5}$/.test(String(game.platformId))) return 'Serveur de jeu inconnu.';
  if (!/^[A-Za-z0-9+/=]{8,}$/.test(String(game.key || ''))) return 'Riot n\'a pas donné de clé d\'observation pour cette partie.';
  return '';
}

// Arguments passés au jeu (sans shell : chaque valeur est un argument distinct)
function spectateArgs(game, os, locale) {
  const args = [`spectator ${spectatorHost(game.platformId)} ${game.key} ${game.gameId} ${game.platformId}`, '-UseRads'];
  if (os === 'win32') args.push('-GameBaseDir=..', '-SkipBuild', '-EnableCrashpad=true', '-EnableLNP');
  if (locale) args.push('-Locale=' + locale);
  return args;
}

const readLocale = text => { const m = String(text || '').match(/locale:\s*"?([a-z]{2}_[A-Z]{2})"?/); return m ? m[1] : ''; };

// Emplacement de League of Legends. io = { exists(p), read(p) } ; custom = chemin saisi par le coach.
// Renvoie { base, gameDir, exe, config } ou null.
function findInstall(os, io, custom, env = {}) {
  const P = os === 'win32' ? path.win32 : path.posix;
  const layout = base => (os === 'win32'
    ? { base, gameDir: P.join(base, 'Game'), exe: P.join(base, 'Game', 'League of Legends.exe'), config: P.join(base, 'Config', 'LeagueClientSettings.yaml') }
    : { base, gameDir: P.join(base, 'Contents', 'LoL', 'Game'), exe: P.join(base, 'Contents', 'LoL', 'Game', 'LeagueofLegends.app', 'Contents', 'MacOS', 'LeagueofLegends'), config: P.join(base, 'Contents', 'LoL', 'Config', 'LeagueClientSettings.yaml') });
  const cands = [];
  const c = String(custom || '').trim().replace(/[\\/]+$/, '');
  if (c) {
    if (os === 'win32') {
      // le coach peut donner le dossier « League of Legends », son sous-dossier « Game » ou le .exe
      const base = /\.exe$/i.test(c) ? P.dirname(P.dirname(c)) : /[\\/]game$/i.test(c) ? P.dirname(c) : c;
      cands.push(base);
    } else {
      const m = c.match(/^(.*?League of Legends\.app)/);
      cands.push(m ? m[1] : /\.app$/.test(c) ? c : P.join(c, 'League of Legends.app'));
    }
  }
  if (os === 'win32') {
    const meta = 'C:\\ProgramData\\Riot Games\\Metadata\\league_of_legends.live\\league_of_legends.live.product_settings.yaml';
    try {
      const m = String(io.read(meta) || '').match(/product_install_full_path:\s*"?([^"\r\n]+)"?/);
      if (m) cands.push(P.normalize(m[1].trim()));
    } catch (e) { /* fichier absent */ }
    cands.push('C:\\Riot Games\\League of Legends', 'D:\\Riot Games\\League of Legends');
  } else if (os === 'darwin') {
    cands.push('/Applications/League of Legends.app');
    if (env.HOME) cands.push(P.join(env.HOME, 'Applications', 'League of Legends.app'));
  }
  for (const b of cands) {
    const l = layout(b);
    if (io.exists(l.exe)) return l;
  }
  return null;
}

// Lance le jeu en mode spectateur et le relance s'il se ferme tout de suite : le premier lancement échoue
// souvent (jeu qui se ferme pendant le chargement). Résout dès que le premier lancement a démarré.
// Pas de relance si une fenêtre de jeu tourne déjà (isRunning), si la partie est finie (stillLive) ou si
// le jeu est resté ouvert plus de minRunMs (le coach a regardé puis fermé).
function launchWatch(o) {
  const opt = Object.assign({ tries: 3, minRunMs: 30000, gapMs: 4000, now: Date.now, wait: ms => new Promise(r => setTimeout(r, ms)),
    isRunning: async () => false, stillLive: () => true, onRetry() {}, onGiveUp() {} }, o);
  let attempt = 0;
  const start = () => new Promise((resolve, reject) => {
    attempt++;
    const t0 = opt.now();
    const child = opt.spawn(opt.exe, opt.args, { cwd: opt.cwd, env: opt.env, detached: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => {
      child.once('exit', async code => {
        if (opt.now() - t0 >= opt.minRunMs) return;
        if (!opt.stillLive()) return;
        if (await opt.isRunning()) return;
        if (attempt >= opt.tries) return opt.onGiveUp(attempt, code);
        opt.onRetry(attempt + 1, opt.tries);
        await opt.wait(opt.gapMs);
        start().catch(e => opt.onGiveUp(attempt, e.message));
      });
      if (child.unref) child.unref();
      resolve(child);
    });
  });
  return start();
}

module.exports = { parseSmurfs, trackedAccounts, launchWatch, MAX_SMURFS, QUEUE_SOLO, soloRank, buildGame, elapsed, spectatorHost, checkGame, spectateArgs, readLocale, findInstall, splitRiotId };
