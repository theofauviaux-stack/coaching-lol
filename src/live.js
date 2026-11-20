// Parties en direct (API Riot spectator-v5) et lancement du mode spectateur de League of Legends.
// Tout ce qui est ici est pur (sans Electron) pour être testé sans réseau : voir tests/live.js.
const path = require('path');
const lp = require('./lp');

const QUEUE_SOLO = 420; // classée Solo/Duo
const QUEUE_CUSTOM = 0; // partie personnalisée (Riot : gameType « CUSTOM_GAME », file 0)
const isCustom = raw => !!raw && (raw.gameType === 'CUSTOM_GAME' || raw.gameQueueConfigId === QUEUE_CUSTOM);
// parties suivies en direct : classées Solo/Duo et personnalisées (pas les normales, ARAM, Flex…)
const isWatched = raw => !!raw && (raw.gameQueueConfigId === QUEUE_SOLO || isCustom(raw));
const BUNDLED_RATES = require('./role-rates.json');

// ---------------------------------------------------------------- postes (Riot ne les donne pas en direct)
// Devinés comme le font les sites de stats : part de chaque poste pour le champion (table Meraki, mise à
// jour chaque jour), Châtiment = jungle, petits indices tirés des sorts, rôle coaché de nos joueurs.
const POSITIONS = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];
const ROLE_POS = { Top: 'TOP', Jungle: 'JUNGLE', Mid: 'MIDDLE', ADC: 'BOTTOM', Support: 'UTILITY' };
const SMITE = 11;
const SPELL_HINTS = { 7: { BOTTOM: 0.8 }, 3: { UTILITY: 0.8 }, 12: { TOP: 0.6, MIDDLE: 0.2 }, 21: { MIDDLE: 0.3, BOTTOM: 0.2 } };
const PERMS = (function perms(a) { return a.length <= 1 ? [a] : a.flatMap((x, i) => perms(a.slice(0, i).concat(a.slice(i + 1))).map(p => [x].concat(p))); })([0, 1, 2, 3, 4]);

// team : 5 participants ({ championId, spells, role? }) → poste de chacun (même ordre), ou null si l'équipe n'est pas complète
function assignPositions(team, rates) {
  if (!team || team.length !== 5) return null;
  const table = (rates && rates.data) || BUNDLED_RATES.data;
  const smiteCount = team.filter(x => (x.spells || []).includes(SMITE)).length;
  const score = team.map(x => POSITIONS.map((pos, j) => {
    const r = table[String(x.championId)];
    let v = Math.log((r ? r[j] : 0.2) + 0.02);
    const smite = (x.spells || []).includes(SMITE);
    if (smiteCount) v += pos === 'JUNGLE' ? (smite ? 6 : -6) : (smite ? -6 : 0);
    for (const sp of x.spells || []) v += (SPELL_HINTS[sp] && SPELL_HINTS[sp][pos]) || 0;
    if (x.role && ROLE_POS[x.role] === pos) v += 4;
    return v;
  }));
  let best = null, bestV = -Infinity;
  for (const p of PERMS) {
    let v = 0;
    for (let i = 0; i < 5; i++) v += score[i][p[i]];
    if (v > bestV) { bestV = v; best = p; }
  }
  return best.map(j => POSITIONS[j]);
}
const byPosition = list => list.slice().sort((a, b) => POSITIONS.indexOf(a.position) - POSITIONS.indexOf(b.position));

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
    if (p.puuid) out.push({ puuid: p.puuid, playerId: p.id, region: p.region, riotId: p.riotId, role: p.role, smurf: null });
    for (const sm of p.smurfs || []) if (sm && sm.puuid) out.push({ puuid: sm.puuid, playerId: p.id, region: p.region, riotId: sm.riotId, role: p.role, smurf: sm.riotId });
  }
  return out;
}

// Partie brute de l'API → partie affichable, vue depuis l'équipe du (premier) joueur suivi.
// players : joueurs suivis ({ id, puuid, riotId, smurfs }) ; ranks : { puuid: rang } ; champKeys : { "103": "Ahri" }
function buildGame(raw, players, ranks = {}, champKeys = {}, now = Date.now(), rates = null) {
  const ours = new Map(trackedAccounts(players).map(a => [a.puuid, a]));
  const parts = (raw.participants || []).map(x => {
    const me = x.puuid ? ours.get(x.puuid) : null;
    const rid = splitRiotId(x.riotId || (me && me.riotId) || '');
    return {
      puuid: x.puuid || null, gameName: rid.gameName, tagLine: rid.tagLine, hidden: !rid.gameName,
      teamId: x.teamId, championId: x.championId, champion: champKeys[String(x.championId)] || null,
      spells: [x.spell1Id, x.spell2Id], keystone: x.perks && x.perks.perkIds ? x.perks.perkIds[0] : null,
      subStyle: x.perks ? x.perks.perkSubStyle : null, bot: !!x.bot,
      playerId: me ? me.playerId : null, smurf: me ? me.smurf : null, role: me ? me.role : null, position: null, rank: x.puuid && ranks[x.puuid] !== undefined ? ranks[x.puuid] : null
    };
  });
  const mine = parts.filter(x => x.playerId);
  const teamId = mine.length ? mine[0].teamId : 100;
  const bans = (raw.bannedChampions || []).filter(b => b.championId > 0).sort((a, b) => a.pickTurn - b.pickTurn);
  // chaque équipe dans l'ordre des postes : top, jungle, mid, ADC, support (en face l'un de l'autre)
  const team = id => {
    const list = parts.filter(x => x.teamId === id);
    const pos = assignPositions(list, rates);
    if (!pos) return list;
    list.forEach((x, i) => { x.position = pos[i]; });
    return byPosition(list);
  };
  const banList = side => bans.filter(b => (b.teamId === teamId) === side).map(b => champKeys[String(b.championId)] || null).filter(Boolean);
  return {
    gameId: raw.gameId, platformId: raw.platformId, queueId: raw.gameQueueConfigId, custom: isCustom(raw), mode: raw.gameMode || '',
    startTime: raw.gameStartTime > 0 ? raw.gameStartTime : null, length: raw.gameLength || 0, fetchedAt: now,
    key: raw.observers ? raw.observers.encryptionKey : '',
    playerIds: mine.map(x => x.playerId), teamId,
    allies: team(teamId), enemies: team(teamId === 100 ? 200 : 100),
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
  if (!/^[A-Za-z0-9+/=]{8,}$/.test(String(game.key || ''))) return 'Riot n\'a pas donné de clé d\'observation pour cette partie.' + (game.custom ? ' Pour une partie personnalisée, les spectateurs doivent être autorisés dans le salon.' : '');
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

// Table Meraki (championrates.json) → { patch, data: { idChampion: [part top, jungle, mid, bot, support] } }
function compactRates(json) {
  const data = {};
  for (const [k, v] of Object.entries((json && json.data) || {})) {
    const vals = POSITIONS.map(p => Number((v[p] || {}).playRate) || 0);
    const t = vals.reduce((a, b) => a + b, 0);
    if (t > 0) data[k] = vals.map(x => Math.round(x / t * 1000) / 1000);
  }
  return Object.keys(data).length > 100 ? { patch: json.patch || '', data } : null;
}

module.exports = { POSITIONS, assignPositions, compactRates, BUNDLED_RATES, parseSmurfs, trackedAccounts, launchWatch, MAX_SMURFS, QUEUE_SOLO, QUEUE_CUSTOM, isCustom, isWatched, soloRank, buildGame, elapsed, spectatorHost, checkGame, spectateArgs, readLocale, findInstall, splitRiotId };
