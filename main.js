const { app, BrowserWindow, ipcMain, shell, dialog, safeStorage, powerMonitor, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Store } = require('./src/store');
const { RiotClient } = require('./src/riot');
const { syncPlayer } = require('./src/sync');
const mu = require('./src/macupdate');
const cloudMod = require('./src/cloud');
const access = require('./src/access');
const playersMod = require('./src/players');
const lpMod = require('./src/lp');
const liveMod = require('./src/live');
const { spawn } = require('child_process');

const REPO = 'theofauviaux-stack/coaching-lol';
let win = null;
let store = null;
let syncing = false;
let syncTimer = null;
let pushTimer = null;
let remoteTimer = null;

// Session ouverte avec un code : { role: 'coach' | 'joueur', playerId, source: 'local' | 'cloud', token }
let session = null;
let remoteData = null; // données lues sur le serveur (ordinateur d'un joueur)
const limiter = new access.Limiter();
const cloudConfig = process.env.COACHING_LOL_CLOUD ? JSON.parse(process.env.COACHING_LOL_CLOUD) : cloudMod.loadConfig(path.join(__dirname, 'src'));
const cloud = cloudConfig ? new cloudMod.CloudClient(cloudConfig) : null;

// ---------------------------------------------------------------- secrets (chiffrés par le système si possible)
// apiKey : clé Riot · coachCode : code coach · cloudSecret : clé secrète du projet Supabase
function getSecret(name) {
  const s = store.data.settings;
  if (s[name + 'Enc'] && safeStorage.isEncryptionAvailable()) {
    try { return safeStorage.decryptString(Buffer.from(s[name + 'Enc'], 'base64')); } catch (e) { return ''; }
  }
  return s[name] || '';
}
function setSecret(name, value) {
  const s = store.data.settings;
  if (value && safeStorage.isEncryptionAvailable()) {
    s[name + 'Enc'] = safeStorage.encryptString(value).toString('base64');
    s[name] = '';
  } else {
    delete s[name + 'Enc'];
    s[name] = value || '';
  }
  store.save();
}
const SECRET_FIELDS = ['apiKey', 'apiKeyEnc', 'coachCode', 'coachCodeEnc', 'cloudSecret', 'cloudSecretEnc', 'pushToken', 'pushTokenEnc'];

// Jeton d'envoi propre à l'ordinateur du coach : généré ici, jamais affiché ; seule son empreinte
// (SHA-256) est enregistrée dans la base (table push_keys). Remplace la clé secrète du projet.
function getPushToken() {
  let t = getSecret('pushToken');
  if (!t) { t = crypto.randomBytes(32).toString('hex'); setSecret('pushToken', t); }
  return t;
}
const pushKeyHash = () => crypto.createHash('sha256').update(getPushToken()).digest('hex');

const isCoachMachine = () => !!getSecret('coachCode');
function ensurePlayerCodes() {
  let n = 0;
  for (const p of store.data.players) if (!p.code) { p.code = access.randomCode(store.data, getSecret('coachCode')); n++; }
  if (n) store.save();
}
// Ordinateur déjà utilisé par le coach (versions 1.0.x) mais sans code coach : on le fait créer
const needsCoachSetup = () => !isCoachMachine() && (store.data.players.length > 0 || !!getSecret('apiKey'));
const isCoach = () => session && session.role === 'coach';
const canEdit = () => isCoach() && session.source === 'local';

// ---------------------------------------------------------------- données envoyées à l'interface
function viewData() {
  const base = { appVersion: app.getVersion(), cloudConfigured: !!cloud };
  if (!session) {
    return Object.assign(base, { locked: true, setup: needsCoachSetup(), coachMachine: isCoachMachine(), blockedMs: limiter.blockedFor() });
  }
  let d;
  if (session.source === 'cloud') {
    d = JSON.parse(JSON.stringify(remoteData));
    d.settings.ddVersion = store.data.settings.ddVersion;
    d.settings.champs = store.data.settings.champs;
  } else {
    d = access.filterForSession(store.data, session);
  }
  for (const k of SECRET_FIELDS) delete d.settings[k];
  d.session = { role: session.role, playerId: session.playerId, source: session.source, readOnly: !canEdit() };
  d.bookings = bookingsView();
  if (session.source === 'cloud') d.reports = session.role === 'joueur' ? reports.mine.map(r => Object.assign({ playerId: session.playerId }, r)) : [];
  if (canEdit()) {
    const k = getSecret('apiKey');
    d.coach = {
      hasKey: !!k, keyPreview: k ? k.slice(0, 11) + '…' + k.slice(-4) : '',
      coachCode: getSecret('coachCode'),
      cloud: {
        configured: !!cloud, hasSecret: !!getSecret('cloudSecret'),
        lastPush: store.data.settings.lastPush || null, lastError: store.data.settings.pushError || '',
        linked: !!store.data.settings.lastPush && !store.data.settings.pushError,
        keyHash: pushKeyHash()
      },
      update: updateInfo,
      lol: lolInstallView()
    };
    d.live = { enabled: !!k, games: live.games, checkedAt: live.checkedAt, error: live.error, checking: live.checking };
  }
  return Object.assign(base, d, { locked: false });
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}
const refreshView = () => send('data:changed', viewData());

function requireEdit() {
  if (!canEdit()) throw new Error('Action réservée au coach.');
}
// chaque modification : enregistrer, rafraîchir l'écran, envoyer au serveur un peu plus tard
function changed(pushDelay = 8000) {
  store.save();
  schedulePush(pushDelay);
  return viewData();
}

// ---------------------------------------------------------------- connexion par code
async function login(code) {
  code = String(code || '');
  const wait = limiter.blockedFor();
  if (wait) return { ok: false, message: 'Trop d\'essais. Réessaie dans ' + Math.ceil(wait / 1000) + ' s.' };

  const local = access.checkLocalCode(store.data, code, getSecret('coachCode'));
  if (local) {
    limiter.ok();
    session = Object.assign(local, { source: 'local' });
    if (canEdit()) setTimeout(pollLive, 1500);
    return { ok: true, data: viewData() };
  }
  // Ordinateur du coach : tous les codes sont connus ici, inutile d'interroger le serveur
  if (isCoachMachine() || !cloud) {
    limiter.fail();
    return { ok: false, message: cloud || isCoachMachine() ? 'Code inconnu.' : 'Cet ordinateur n\'est pas encore relié au serveur du coach.' };
  }
  try {
    const r = await cloud.login(code);
    const remote = await cloud.getData(r.token);
    limiter.ok();
    session = { role: r.role, playerId: r.playerId, source: 'cloud', token: r.token };
    remoteData = cloudMod.dataFromCloud(remote, store.data);
    startRemoteRefresh();
    await refreshBookings();
    await refreshReports();
    return { ok: true, data: viewData() };
  } catch (e) {
    if (e.code === 'code_inconnu') limiter.fail();
    return { ok: false, message: e.message };
  }
}

function logout() {
  if (session && session.token && cloud) cloud.logout(session.token);
  session = null;
  remoteData = null;
  bookings.mine = []; bookings.busy = [];
  reports.mine = [];
  if (remoteTimer) clearInterval(remoteTimer);
  Object.assign(live, { games: [], checkedAt: null, error: '', first: true });
  return viewData();
}

// Ordinateur d'un joueur : on relit le serveur toutes les 5 minutes, sans rien afficher
function startRemoteRefresh() {
  if (remoteTimer) clearInterval(remoteTimer);
  remoteTimer = setInterval(async () => {
    if (!session || session.source !== 'cloud') return clearInterval(remoteTimer);
    try {
      remoteData = cloudMod.dataFromCloud(await cloud.getData(session.token), store.data);
      refreshView();
    } catch (e) {
      if (e.code === 'session_expiree') { logout(); refreshView(); }
    }
  }, 5 * 60 * 1000);
}

// ---------------------------------------------------------------- envoi vers le serveur (ordinateur du coach)
function schedulePush(delay = 8000) {
  if (!cloud || !isCoachMachine()) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushNow, delay);
}
async function pushNow() {
  if (!cloud || !isCoachMachine()) return { ok: false, message: 'Serveur non configuré.' };
  const secret = getSecret('cloudSecret');
  const snapshot = cloudMod.buildSnapshot(store.data, getSecret('coachCode'));
  try {
    if (secret) await cloud.push(snapshot, secret);
    else await cloud.pushWithToken(snapshot, getPushToken());
    store.data.settings.lastPush = Date.now();
    store.data.settings.pushError = '';
    store.save();
    return { ok: true };
  } catch (e) {
    store.data.settings.pushError = e.message;
    store.save();
    clearTimeout(pushTimer);
    pushTimer = setTimeout(pushNow, 10 * 60 * 1000); // nouvel essai plus tard
    return { ok: false, message: e.message };
  } finally {
    if (canEdit()) refreshView();
  }
}

// ---------------------------------------------------------------- réservations de coaching
// Elles vivent sur le serveur (les joueurs réservent depuis leur ordinateur). L'app du coach les lit avec
// le jeton d'envoi de son ordinateur ; l'app d'un joueur avec son jeton de session.
const FAST = !!process.env.COACHING_LOL_FAST; // tests : rafraîchissements rapides
const ACTIVE = ['en_attente', 'proposee', 'acceptee', 'en_cours'];
const bookings = { all: [], mine: [], busy: [], loaded: false, error: '' };
const notifiedRequests = new Set();
const warnedEnds = new Set();
let bookingsKey = '';
const slotOf = b => (b.status === 'proposee' ? b.proposed : b.start);
const playerName = id => ((store.data.players.find(p => p.id === id) || {}).riotId || 'Un joueur').split('#')[0];
const fmtSlot = iso => {
  const d = new Date(iso);
  const day = d.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long' });
  const h = parseInt(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', hourCycle: 'h23' }).format(d), 10);
  return day + ', ' + h + ' h – ' + ((h + 1) % 24) + ' h';
};

function notifyCoach(title, body) {
  try {
    if (Notification.isSupported()) {
      const n = new Notification({ title, body });
      n.on('click', () => { if (win) { win.show(); win.focus(); } });
      n.show();
    }
  } catch (e) { /* notifications indisponibles */ }
  send('coach:alert', { title, body });
}

async function refreshBookings() {
  if (!cloud) return;
  const before = JSON.stringify([bookings.all, bookings.mine, bookings.busy, bookings.error]);
  try {
    if (isCoachMachine()) {
      const r = await cloud.coachBookings(getPushToken());
      bookings.all = r.all || [];
      for (const b of bookings.all) {
        if (b.status === 'en_attente' && !notifiedRequests.has(b.id)) {
          notifiedRequests.add(b.id);
          if (bookings.loaded) notifyCoach('Nouvelle demande de coaching', playerName(b.playerId) + ' : ' + fmtSlot(b.start));
        }
      }
      bookings.loaded = true;
    } else if (session && session.source === 'cloud' && session.role === 'joueur') {
      const r = await cloud.bookingsMine(session.token);
      bookings.mine = r.mine || [];
      bookings.busy = r.busy || [];
    }
    bookings.error = '';
  } catch (e) {
    bookings.error = e.message;
  }
  if (session && JSON.stringify([bookings.all, bookings.mine, bookings.busy, bookings.error]) !== before) refreshView();
}

// ---------------------------------------------------------------- fiches de séance remplies par les joueurs
// Ordinateur d'un joueur : il remplit sa fiche, envoyée au serveur. Ordinateur du coach : les fiches du serveur
// sont recopiées ici (store.data.reports) ; une fiche remplie sur cet ordinateur part au serveur dès que possible.
const reports = { mine: [], loaded: false };
const sameReport = (a, b) => a.playerId === b.playerId && a.sessionId === b.sessionId;
function cleanReport(data) {
  const d = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  const json = JSON.stringify(d);
  if (json.length > 20000) throw new Error('Fiche trop longue.');
  return JSON.parse(json);
}
async function refreshReports() {
  if (!cloud || !session) return;
  let dirty = false;
  try {
    if (isCoachMachine()) {
      const key = getPushToken();
      for (const r of store.data.reports.filter(x => x.pending)) {
        const res = await cloud.coachReportSave(key, r.playerId, r.sessionId, r.data);
        r.updatedAt = res.updatedAt || r.updatedAt;
        delete r.pending;
        dirty = true;
      }
      const res = await cloud.coachReports(key);
      for (const r of res.reports || []) {
        const cur = store.data.reports.find(x => sameReport(x, r));
        if (cur && (cur.pending || new Date(r.updatedAt) <= new Date(cur.updatedAt))) continue;
        if (cur) Object.assign(cur, r); else store.data.reports.push(r);
        dirty = true;
        const s = store.data.sessions.find(x => x.id === r.sessionId);
        if (reports.loaded) notifyCoach('Fiche de séance remplie', playerName(r.playerId) + (cur ? ' a modifié sa fiche' : ' a rempli sa fiche') + (s && s.date ? ' (séance du ' + new Date(s.date).toLocaleDateString('fr-FR') + ').' : '.'));
      }
      reports.loaded = true;
      if (dirty) store.save();
    } else if (session.source === 'cloud' && session.role === 'joueur') {
      const res = await cloud.reportsMine(session.token);
      const next = res.reports || [];
      dirty = JSON.stringify(next) !== JSON.stringify(reports.mine);
      reports.mine = next;
    }
  } catch (e) { /* serveur injoignable : on réessaie au prochain passage */ }
  if (dirty) refreshView();
}
async function saveReport({ sessionId, data }) {
  if (!session || session.role !== 'joueur') throw new Error('La fiche se remplit depuis l\'espace du joueur.');
  const clean = cleanReport(data);
  if (session.source === 'cloud') {
    if (!(remoteData.sessions || []).some(s => s.id === sessionId)) throw new Error('Cette séance n\'existe plus.');
    await cloud.reportSave(session.token, sessionId, clean);
    const res = await cloud.reportsMine(session.token);
    reports.mine = res.reports || [];
    return viewData();
  }
  if (!store.data.sessions.some(s => s.id === sessionId && s.playerId === session.playerId)) throw new Error('Cette séance n\'existe plus.');
  const r = { playerId: session.playerId, sessionId, data: clean, updatedAt: new Date().toISOString(), pending: true };
  const cur = store.data.reports.find(x => sameReport(x, r));
  if (cur) Object.assign(cur, r); else store.data.reports.push(r);
  store.save();
  refreshReports(); // envoi au serveur en arrière-plan
  return viewData();
}

// séances en cours, par joueur (un créneau accepté qui suit immédiatement est inclus : 2 h)
function coachingNow() {
  const groups = {};
  for (const b of bookings.all) {
    if (b.status !== 'en_cours' || !b.startedAt) continue;
    const g = groups[b.playerId] || (groups[b.playerId] = { playerId: b.playerId, id: b.id, startedAt: new Date(b.startedAt).getTime(), minutes: 0 });
    g.minutes += b.duration || 60;
  }
  return Object.values(groups).map(g => Object.assign(g, { endsAt: g.startedAt + g.minutes * 60000 }));
}

// timer du coach : prévenir 5 minutes avant la fin, puis terminer la séance à l'heure
async function watchCoaching() {
  if (!isCoachMachine()) return;
  for (const g of coachingNow()) {
    const left = g.endsAt - Date.now();
    const key = g.playerId + ':' + g.startedAt;
    if (left <= 5 * 60000 && left > 0 && !warnedEnds.has(key)) {
      warnedEnds.add(key);
      notifyCoach('Coaching : plus que 5 minutes', 'Séance avec ' + playerName(g.playerId) + ', fin à ' + new Date(g.endsAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) + '.');
    }
    if (left <= 0) {
      try { await cloud.coachBook(getPushToken(), 'terminer', g.id); } catch (e) { /* nouvel essai au prochain passage */ }
      notifyCoach('Coaching terminé', 'Fin de la séance avec ' + playerName(g.playerId) + '.');
      await refreshBookings();
    }
  }
}

function bookingsView() {
  if (!session || !cloud) return null;
  const linked = isCoachMachine() ? !!store.data.settings.lastPush && !store.data.settings.pushError : session.source === 'cloud';
  if (session.role === 'coach') {
    if (session.source !== 'local') return null;
    return { linked, all: bookings.all, coaching: coachingNow(), error: bookings.error };
  }
  if (session.source === 'local') {
    const id = session.playerId;
    return {
      linked, mine: bookings.all.filter(b => b.playerId === id).map(({ playerId, ...b }) => b), // eslint-disable-line no-unused-vars
      busy: bookings.all.filter(b => b.playerId !== id && ACTIVE.includes(b.status)).map(slotOf), error: bookings.error
    };
  }
  return { linked, mine: bookings.mine, busy: bookings.busy, error: bookings.error };
}

async function bookingAction({ action, id, start }) {
  if (!session) throw new Error('Session fermée.');
  if (!cloud) throw new Error('Serveur non configuré.');
  const playerActions = ['demander', 'annuler', 'accepter_proposition', 'refuser_proposition'];
  const coachActions = ['accepter', 'proposer', 'annuler', 'demarrer', 'terminer'];
  if (session.role === 'joueur') {
    if (!playerActions.includes(action)) throw new Error('Action réservée au coach.');
    if (session.source === 'cloud') await cloud.book(session.token, action, id, start);
    else await cloud.coachBook(getPushToken(), action === 'annuler' ? 'annuler_joueur' : action, id, start, session.playerId);
  } else {
    if (!canEdit()) throw new Error('Action réservée au coach, sur son ordinateur.');
    if (!coachActions.includes(action)) throw new Error('Action inconnue.');
    await cloud.coachBook(getPushToken(), action, id, start);
    if (action === 'demarrer') warnedEnds.clear();
  }
  await refreshBookings();
  return { ok: true, data: viewData() };
}

// ---------------------------------------------------------------- synchro Riot (silencieuse, ordinateur du coach)
async function runSync(playerIds) {
  const key = getSecret('apiKey');
  if (syncing || polling || !key) return;
  syncing = true;
  const client = new RiotClient(key, { base: RIOT_BASE });
  const players = store.data.players.filter(p => !playerIds || playerIds.includes(p.id));
  try {
    for (const p of players) {
      try {
        // lots de 30 parties, enregistrés au fur et à mesure, jusqu'à ce que tout l'historique soit vérifié
        let r, guard = 0;
        do {
          r = await syncPlayer(store.data, client, p, { maxGames: store.data.settings.maxGamesPerSync || 30 });
          store.save();
          if (session && session.source === 'local') refreshView();
        } while (r.remaining > 0 && ++guard < 20);
      } catch (e) {
        p.status = 'error';
        p.statusText = e.message;
        if (e.code === 'KEY' || e.code === 'NO_KEY') break;
      }
      store.save();
      if (session && session.source === 'local') refreshView();
    }
    store.data.settings.lastSync = Date.now();
    store.save();
  } finally {
    syncing = false;
    if (session && session.source === 'local') refreshView();
    schedulePush(1000);
  }
}

// Relevé du rang toutes les 5 minutes (une requête par joueur) : c'est ce qui permet de connaître
// les LP de chaque partie. Si de nouvelles parties sont comptées, on les récupère quelques minutes après
// (le temps que Riot les publie).
let polling = false;
async function pollRanks() {
  const key = getSecret('apiKey');
  if (!key || syncing || polling || !store.data.players.length) return;
  polling = true;
  const client = new RiotClient(key, { delayMs: 300, base: RIOT_BASE });
  const newGames = [];
  let changedAny = false;
  try {
    for (const p of store.data.players) {
      if (!p.puuid) continue;
      try {
        const r = lpMod.recordRank(store.data, p, await client.leagues(p.puuid, p.region));
        if (r.recorded) { changedAny = true; lpMod.attributeLp(store.data, p.id); }
        if (r.newGames > 0) newGames.push(p.id);
      } catch (e) { if (e.code === 'KEY') break; }
    }
  } finally {
    polling = false;
  }
  if (changedAny) {
    store.save();
    if (session && session.source === 'local') refreshView();
    schedulePush(2000);
  }
  if (newGames.length) {
    setTimeout(() => runSync(newGames), 3 * 60 * 1000);
    setTimeout(() => runSync(newGames), 8 * 60 * 1000); // seconde chance si Riot tarde à publier la partie
  }
}

// ---------------------------------------------------------------- parties en direct (ordinateur du coach)
// Toutes les minutes : partie en cours de chaque joueur suivi (classée Solo/Duo uniquement), avec les
// 10 participants et leur rang (rangs gardés 30 min). Notification quand une partie commence ; quand elle
// se termine, relevé de rang 2 minutes plus tard (LP de la partie au plus juste).
const live = { games: [], checkedAt: null, error: '', checking: false, first: true };
const rankCache = new Map();
const RIOT_BASE = process.env.COACHING_LOL_TEST ? process.env.COACHING_LOL_RIOT : undefined;
const champName = id => { const c = id && store.data.settings.champs && store.data.settings.champs[id.toLowerCase()]; return c ? c[1] : id || '?'; };

async function pollLive() {
  const key = getSecret('apiKey');
  if (!canEdit() || !key || live.checking) return;
  live.checking = true;
  const client = new RiotClient(key, { delayMs: 250, base: RIOT_BASE });
  const found = new Map();
  let error = '';
  try {
    const seen = new Set();
    for (const p of store.data.players) {
      if (!p.puuid || seen.has(p.puuid)) continue;
      seen.add(p.puuid);
      // déjà vu dans une partie trouvée (deux joueurs suivis dans la même partie) : inutile de redemander
      if ([...found.values()].some(f => (f.raw.participants || []).some(x => x.puuid === p.puuid))) continue;
      try {
        const raw = await client.activeGame(p.puuid, p.region);
        if (raw && raw.gameQueueConfigId === liveMod.QUEUE_SOLO && !found.has(raw.gameId)) found.set(raw.gameId, { raw, region: p.region });
      } catch (e) {
        error = e.message;
        if (e.code === 'KEY' || e.code === 'NO_KEY') break;
      }
    }
    const games = [];
    for (const [, f] of found) {
      const ranks = {};
      for (const x of f.raw.participants || []) {
        if (!x.puuid) continue;
        const c = rankCache.get(x.puuid);
        if (c && Date.now() - c.at < 30 * 60 * 1000) { ranks[x.puuid] = c.rank; continue; }
        try {
          const rk = liveMod.soloRank(await client.leagues(x.puuid, f.region));
          rankCache.set(x.puuid, { at: Date.now(), rank: rk });
          ranks[x.puuid] = rk;
        } catch (e) { if (e.code === 'KEY') break; }
      }
      games.push(liveMod.buildGame(f.raw, store.data.players, ranks, store.data.settings.champKeys || {}));
    }
    const before = new Set(live.games.map(g => g.gameId));
    const after = new Set(games.map(g => g.gameId));
    if (!live.first && isCoach()) {
      for (const g of games.filter(x => !before.has(x.gameId))) {
        const who = g.allies.concat(g.enemies).filter(x => x.playerId).map(x => (x.gameName || playerName(x.playerId)) + ' (' + champName(x.champion) + ')');
        notifyCoach('Partie classée en cours', who.join(', ') + ' · ouvre « En direct » pour la regarder');
      }
    }
    if (live.games.some(g => !after.has(g.gameId))) setTimeout(pollRanks, FAST ? 2000 : 2 * 60 * 1000);
    const sig = JSON.stringify([games.map(g => g.gameId + ':' + g.allies.concat(g.enemies).map(x => x.rank ? x.rank.lp : '').join()), error]);
    const changed = sig !== live.sig || live.first;
    Object.assign(live, { games, checkedAt: Date.now(), error, first: false, sig });
    if (changed && session && session.source === 'local') refreshView();
  } finally {
    live.checking = false;
  }
}

// Emplacement de League of Legends (relu au plus toutes les 20 s)
const LOL_OS = process.platform;
const fsIo = { exists: f => { try { return fs.existsSync(f); } catch (e) { return false; } }, read: f => fs.readFileSync(f, 'utf8') };
let lolCache = null;
function lolInstall() {
  if (lolCache && Date.now() - lolCache.at < 20000 && lolCache.custom === (store.data.settings.lolPath || '')) return lolCache.value;
  const value = liveMod.findInstall(LOL_OS, fsIo, store.data.settings.lolPath || '', { HOME: process.env.HOME });
  lolCache = { at: Date.now(), custom: store.data.settings.lolPath || '', value };
  return value;
}
const lolInstallView = () => { const i = lolInstall(); return { found: !!i, path: i ? i.base : '', custom: store.data.settings.lolPath || '' }; };

// Bouton « Regarder » : lance League of Legends en mode spectateur sur la partie
async function watchGame(gameId) {
  requireEdit();
  const g = live.games.find(x => String(x.gameId) === String(gameId));
  if (!g) throw new Error('Cette partie est terminée.');
  const bad = liveMod.checkGame(g);
  if (bad) throw new Error(bad);
  const ins = lolInstall();
  if (!ins) throw new Error('League of Legends est introuvable sur cet ordinateur. Indique son emplacement dans Paramètres › Général › Mode spectateur.');
  let locale = '';
  try { locale = liveMod.readLocale(fs.readFileSync(ins.config, 'utf8')); } catch (e) { /* langue par défaut du jeu */ }
  const args = liveMod.spectateArgs(g, LOL_OS, locale);
  if (process.env.COACHING_LOL_TEST) {
    fs.writeFileSync(path.join(process.env.COACHING_LOL_DATA, 'spectateur.json'), JSON.stringify({ exe: ins.exe, cwd: ins.gameDir, args }));
  } else {
    if (LOL_OS === 'darwin') { try { fs.chmodSync(ins.exe, 0o755); } catch (e) { /* déjà exécutable */ } }
    await new Promise((resolve, reject) => {
      const child = spawn(ins.exe, args, { cwd: ins.gameDir, detached: true, stdio: 'ignore', env: Object.assign({}, process.env, { riot_launched: 'true' }) });
      child.once('error', e => reject(new Error('Impossible de lancer League of Legends (' + e.message + ').')));
      child.once('spawn', () => { child.unref(); resolve(); });
    });
  }
  const wait = Math.max(0, 180 - liveMod.elapsed(g));
  return { ok: true, message: 'League of Legends s\'ouvre en mode spectateur' + (wait > 30 ? ' : la partie s\'affichera dans environ ' + Math.ceil(wait / 60) + ' min (3 min de retard en classée).' : ' (3 min de retard en classée).') };
}

function scheduleAutoSync() {
  if (syncTimer) clearInterval(syncTimer);
  const min = Number(store.data.settings.autoSyncMinutes) || 30;
  syncTimer = setInterval(() => runSync(), min * 60 * 1000);
}

async function refreshDDragon() {
  try {
    const res = await fetch('https://ddragon.leagueoflegends.com/api/versions.json');
    const v = (await res.json())[0];
    const s = store.data.settings;
    if (v && (v !== s.ddVersion || !s.champs || !s.champKeys || !s.spellKeys || !s.perkIcons)) {
      // noms français des champions (l'API Riot donne « MonkeyKing », « JarvanIV »… : on affiche « Wukong », « Jarvan IV »)
      try {
        const cj = await (await fetch(`https://ddragon.leagueoflegends.com/cdn/${v}/data/fr_FR/champion.json`)).json();
        const champs = {};
        const keys = {};
        for (const c of Object.values(cj.data || {})) { champs[c.id.toLowerCase()] = [c.id, c.name]; keys[c.key] = c.id; }
        if (Object.keys(champs).length) { s.champs = champs; s.champKeys = keys; }
      } catch (e) { /* on garde les noms bruts */ }
      // parties en direct : sorts d'invocateur (numéro → image) et runes (numéro → image)
      try {
        const sj = await (await fetch(`https://ddragon.leagueoflegends.com/cdn/${v}/data/fr_FR/summoner.json`)).json();
        const sp = {};
        for (const x of Object.values(sj.data || {})) sp[x.key] = [x.id, x.name];
        if (Object.keys(sp).length) s.spellKeys = sp;
      } catch (e) { /* sans images de sorts */ }
      try {
        const rj = await (await fetch(`https://ddragon.leagueoflegends.com/cdn/${v}/data/fr_FR/runesReforged.json`)).json();
        const pk = {};
        for (const st of rj || []) { pk[st.id] = [st.icon, st.name]; for (const sl of st.slots || []) for (const ru of sl.runes || []) pk[ru.id] = [ru.icon, ru.name]; }
        if (Object.keys(pk).length) s.perkIcons = pk;
      } catch (e) { /* sans images de runes */ }
      s.ddVersion = v; store.save(); if (session) refreshView();
    }
  } catch (e) { /* hors ligne : on garde la version connue */ }
}

// ---------------------------------------------------------------- mises à jour (silencieuses)
// Windows : electron-updater télécharge en arrière-plan et installe à la fermeture.
// Mac : module maison (src/macupdate.js), car electron-updater exige un certificat Apple payant.
// Rien n'est affiché : l'état est seulement visible dans Paramètres › À propos (coach).
const updateInfo = { checkedAt: null, state: 'idle', version: null, error: '' };
const macUpdate = { state: 'idle', version: null, newApp: null, blocked: null };
const macWorkDir = () => path.join(app.getPath('temp'), 'coaching-lol-maj');
const pendingFile = () => path.join(app.getPath('userData'), 'maj-en-cours.json');

const UPDATE_EVERY_MS = 30 * 1000; // vérification toutes les 30 secondes (petit fichier de version)
let checkingUpdates = false;

async function checkUpdates() {
  if (!app.isPackaged || checkingUpdates) return;
  // déjà en téléchargement ou prête : rien à faire jusqu'à la fermeture de l'app
  if (updateInfo.state === 'downloading' || updateInfo.state === 'ready') return;
  checkingUpdates = true;
  try { await checkUpdatesNow(); } finally { checkingUpdates = false; }
}

async function checkUpdatesNow() {
  updateInfo.checkedAt = Date.now();
  if (process.platform === 'darwin') return checkMacUpdate();
  try {
    const { autoUpdater } = require('electron-updater');
    if (!checkUpdates.ready) {
      checkUpdates.ready = true;
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = true;
      autoUpdater.on('update-downloaded', info => Object.assign(updateInfo, { state: 'ready', version: info.version }));
      autoUpdater.on('error', e => Object.assign(updateInfo, { state: 'error', error: e.message }));
      autoUpdater.logger = null;
    }
    const r = await autoUpdater.checkForUpdates();
    if (r && r.updateInfo && mu.compareVersions(r.updateInfo.version, app.getVersion()) > 0) Object.assign(updateInfo, { state: 'downloading', version: r.updateInfo.version });
    else updateInfo.state = 'uptodate';
  } catch (e) {
    Object.assign(updateInfo, { state: 'error', error: e.message });
  }
}

async function checkMacUpdate() {
  if (macUpdate.state === 'ready' || macUpdate.state === 'downloading') return;
  let info;
  try {
    const res = await fetch(`https://github.com/${REPO}/releases/latest/download/latest-mac.yml`, { headers: { 'User-Agent': 'coaching-lol' } });
    if (!res.ok) throw new Error('réponse ' + res.status);
    info = mu.parseLatestMacYml(await res.text());
  } catch (e) { return Object.assign(updateInfo, { state: 'error', error: e.message }); }
  if (!info.version || mu.compareVersions(info.version, app.getVersion()) <= 0) return Object.assign(updateInfo, { state: 'uptodate' });
  if (macUpdate.blocked && macUpdate.blocked.version === info.version) return Object.assign(updateInfo, { state: 'error', error: macUpdate.blocked.reason });
  const can = mu.canSelfUpdate(mu.appBundlePath(process.execPath));
  if (!can.ok) return Object.assign(updateInfo, { state: 'error', version: info.version, error: can.reason });
  macUpdate.state = 'downloading'; macUpdate.version = info.version;
  Object.assign(updateInfo, { state: 'downloading', version: info.version, error: '' });
  try {
    macUpdate.newApp = await mu.prepareUpdate({ repo: REPO, info, workDir: macWorkDir() });
    macUpdate.state = 'ready';
    updateInfo.state = 'ready';
  } catch (e) {
    macUpdate.state = 'idle';
    Object.assign(updateInfo, { state: 'error', error: 'téléchargement impossible (' + e.message + ')' });
  }
}

// Remplace l'app par la nouvelle version une fois fermée
function installMacUpdate(relaunch) {
  if (macUpdate.state !== 'ready' || !macUpdate.newApp) return false;
  macUpdate.state = 'installing';
  try {
    fs.writeFileSync(pendingFile(), JSON.stringify({ from: app.getVersion(), to: macUpdate.version, at: Date.now() }));
    mu.launchSwap({ pid: process.pid, oldApp: mu.appBundlePath(process.execPath), newApp: macUpdate.newApp, workDir: macWorkDir(), relaunch, logPath: path.join(app.getPath('userData'), 'maj.log') });
    return true;
  } catch (e) {
    macUpdate.state = 'ready';
    return false;
  }
}

// Au démarrage : la mise à jour précédente a-t-elle réussi ? (noté pour Paramètres › À propos)
function checkPreviousUpdate() {
  let p;
  try { p = JSON.parse(fs.readFileSync(pendingFile(), 'utf8')); } catch (e) { return; }
  try { fs.rmSync(pendingFile(), { force: true }); } catch (e) { /* rien */ }
  if (app.getVersion() === p.to) { updateInfo.installed = p.to; return; }
  let log = '';
  try { log = fs.readFileSync(path.join(app.getPath('userData'), 'maj.log'), 'utf8'); } catch (e) { /* rien */ }
  const reason = /not permitted|non autoris/i.test(log)
    ? "macOS a bloqué le remplacement de l'app : active Coaching LoL dans Réglages Système › Confidentialité et sécurité › Gestion des apps"
    : "l'installation n'a pas abouti";
  macUpdate.blocked = { version: p.to, reason };
}

// ---------------------------------------------------------------- IPC
function registerIpc() {
  const handle = (channel, fn) => ipcMain.handle(channel, async (e, arg) => {
    try { return await fn(arg); } catch (err) { return { ok: false, message: err.message }; }
  });

  handle('data:get', () => {
    const v = viewData();
    if (resumeUi && !v.locked) { v.resumeUi = resumeUi; resumeUi = null; }
    return v;
  });
  ipcMain.on('ui:state', (e, ui) => { if (ui && typeof ui === 'object') lastUi = { page: String(ui.page || ''), playerId: ui.playerId || null, settingsTab: ui.settingsTab || 'joueur', period: ui.period || '20' }; });
  handle('auth:login', code => login(code));
  handle('auth:logout', () => logout());
  // Première ouverture sur l'ordinateur du coach : création du code coach
  handle('auth:setup', ({ code }) => {
    if (isCoachMachine()) throw new Error('Le code coach existe déjà.');
    const conflict = access.codeConflict(store.data, code, null);
    if (conflict) throw new Error(conflict);
    setSecret('coachCode', code);
    ensurePlayerCodes();
    session = { role: 'coach', playerId: null, source: 'local' };
    if (getSecret('apiKey') && store.data.players.length) setTimeout(() => runSync(), 2000);
    return { ok: true, data: viewData() };
  });

  handle('player:save', p => {
    requireEdit();
    const list = store.data.players;
    if (p.code) {
      const conflict = access.codeConflict(store.data, p.code, getSecret('coachCode'), p.id);
      if (conflict) throw new Error(conflict);
    }
    let target;
    let resync = false;
    if (!p.id) {
      target = Object.assign({ objectives: {} }, p, { id: crypto.randomUUID(), createdAt: Date.now() });
      if (!target.code) target.code = access.randomCode(store.data, getSecret('coachCode'));
      list.push(target);
      resync = true;
    } else {
      target = list.find(x => x.id === p.id);
      if (!target) throw new Error('Joueur introuvable.');
      resync = playersMod.updatePlayer(store.data, target, p).resync;
    }
    if (resync) setTimeout(() => runSync([target.id]), 500);
    return { ok: true, id: target.id, data: changed() };
  });
  handle('player:newCode', () => { requireEdit(); return { ok: true, code: access.randomCode(store.data, getSecret('coachCode')) }; });
  handle('player:delete', id => {
    requireEdit();
    playersMod.deletePlayer(store.data, id);
    return { ok: true, data: changed(1000) };
  });

  handle('game:update', ({ matchId, playerId, fields }) => {
    requireEdit();
    const g = store.data.games.find(x => x.matchId === matchId && x.playerId === playerId);
    if (g) {
      for (const k of ['mental', 'objectiveMet', 'comment', 'lpDelta']) if (k in fields) g[k] = fields[k];
      // LP corrigés à la main : on ne les recalcule plus ; champ vidé : le calcul automatique reprend
      if ('lpDelta' in fields) {
        g.lpManual = fields.lpDelta !== null && fields.lpDelta !== undefined;
        g.lpEstimated = false;
        if (!g.lpManual) lpMod.attributeLp(store.data, playerId);
      }
    }
    return { ok: true, data: changed() };
  });
  handle('game:delete', ({ matchId, playerId }) => {
    requireEdit();
    store.data.games = store.data.games.filter(x => !(x.matchId === matchId && x.playerId === playerId));
    store.data.ignored.push({ matchId, playerId, role: 'supprimée', date: Date.now() });
    return { ok: true, data: changed() };
  });

  handle('session:save', s => {
    requireEdit();
    if (!s.id) { s.id = crypto.randomUUID(); store.data.sessions.push(s); }
    else { const cur = store.data.sessions.find(x => x.id === s.id); if (cur) Object.assign(cur, s); }
    return { ok: true, data: changed() };
  });
  handle('session:delete', id => {
    requireEdit();
    store.data.sessions = store.data.sessions.filter(s => s.id !== id);
    return { ok: true, data: changed() };
  });

  // Réglages communs (modèles utilisés pour les nouveaux joueurs) et réglages de synchro
  handle('settings:save', patch => {
    requireEdit();
    const s = store.data.settings;
    for (const k of ['autoSyncMinutes', 'maxGamesPerSync', 'cards', 'objectives', 'axes', 'lolPath']) if (k in patch) s[k] = k === 'lolPath' ? String(patch[k] || '').trim().slice(0, 400) : patch[k];
    scheduleAutoSync();
    return { ok: true, data: changed() };
  });

  handle('coach:code', code => {
    requireEdit();
    const conflict = access.codeConflict(store.data, code, null);
    if (conflict) throw new Error(conflict);
    setSecret('coachCode', code);
    return { ok: true, data: changed(1000) };
  });

  handle('key:save', async key => {
    requireEdit();
    key = String(key || '').trim();
    if (!/^RGAPI-[0-9a-f-]{20,}$/i.test(key)) throw new Error('La clé doit commencer par RGAPI-.');
    await new RiotClient(key, { delayMs: 0 }).status('euw');
    setSecret('apiKey', key);
    setTimeout(() => runSync(), 500);
    return { ok: true, message: 'Clé valide et enregistrée.', data: viewData() };
  });

  handle('cloud:check', async () => {
    requireEdit();
    const r = await pushNow();
    return { ok: r.ok, message: r.ok ? 'Serveur relié : les données des joueurs sont en ligne.' : r.message, data: viewData() };
  });

  handle('cloud:secret', async secret => {
    requireEdit();
    secret = String(secret || '').trim();
    if (!cloud) throw new Error('Le serveur n\'est pas encore configuré dans cette version de l\'app.');
    if (secret.length < 20) throw new Error('Clé trop courte : copie la clé « secret » (ou « service_role ») du projet Supabase.');
    await cloud.push(cloudMod.buildSnapshot(store.data, getSecret('coachCode')), secret); // test réel
    setSecret('cloudSecret', secret);
    store.data.settings.lastPush = Date.now();
    store.data.settings.pushError = '';
    store.save();
    return { ok: true, message: 'Serveur relié : les données des joueurs sont en ligne.', data: viewData() };
  });

  handle('backup:export', async () => {
    requireEdit();
    const r = await dialog.showSaveDialog(win, { defaultPath: 'coaching-lol-sauvegarde.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (r.canceled) return { ok: false };
    const d = JSON.parse(JSON.stringify(store.data));
    for (const k of SECRET_FIELDS) delete d.settings[k];
    fs.writeFileSync(r.filePath, JSON.stringify(d, null, 1));
    return { ok: true, message: 'Sauvegarde enregistrée.' };
  });
  handle('backup:import', async () => {
    requireEdit();
    const r = await dialog.showOpenDialog(win, { filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openFile'] });
    if (r.canceled) return { ok: false };
    const d = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
    const keep = {};
    for (const k of SECRET_FIELDS) keep[k] = store.data.settings[k];
    store.replaceAll(d);
    Object.assign(store.data.settings, keep);
    return { ok: true, message: 'Sauvegarde restaurée.', data: changed(1000) };
  });

  handle('booking:action', arg => bookingAction(arg || {}));
  handle('report:save', async r => ({ ok: true, data: await saveReport(r || {}) }));
  handle('booking:refresh', async () => { await refreshBookings(); return { ok: true, data: viewData() }; });

  handle('live:refresh', async () => { requireEdit(); await pollLive(); return { ok: true, data: viewData() }; });
  handle('live:watch', gameId => watchGame(gameId));

  handle('open:external', url => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { ok: true }; });
}

// ---------------------------------------------------------------- redémarrage automatique pour les mises à jour
// Quand une mise à jour est prête, l'app redémarre toute seule à un moment qui ne gêne pas :
// tout de suite sur l'écran de code, sinon après 1 minute sans activité sur l'ordinateur ou 2 minutes
// en arrière-plan, jamais pendant une récupération de parties. La session et la page en cours sont
// reprises au redémarrage (fichier chiffré, valable 5 minutes, effacé dès sa lecture).
let lastUi = null;      // page affichée, envoyée par l'interface
let resumeUi = null;    // page à rouvrir après un redémarrage
let blurredAt = null;
let restarting = false;
const resumeFile = () => path.join(app.getPath('userData'), 'reprise.json');

function writeResume() {
  if (!session) return;
  const payload = JSON.stringify({ session, ui: lastUi, at: Date.now() });
  const enc = safeStorage.isEncryptionAvailable();
  fs.writeFileSync(resumeFile(), JSON.stringify({ enc, data: enc ? safeStorage.encryptString(payload).toString('base64') : payload }));
}

async function restoreSession() {
  let r;
  try {
    const raw = JSON.parse(fs.readFileSync(resumeFile(), 'utf8'));
    r = JSON.parse(raw.enc ? safeStorage.decryptString(Buffer.from(raw.data, 'base64')) : raw.data);
  } catch (e) { r = null; }
  try { fs.rmSync(resumeFile(), { force: true }); } catch (e) { /* rien */ }
  if (!r || !r.session || Date.now() - r.at > 5 * 60 * 1000) return;
  const s = r.session;
  if (s.source === 'local') {
    const ok = s.role === 'coach' ? isCoachMachine() : store.data.players.some(p => p.id === s.playerId);
    if (ok) session = { role: s.role, playerId: s.playerId, source: 'local' };
  } else if (s.source === 'cloud' && cloud && s.token) {
    try {
      remoteData = cloudMod.dataFromCloud(await cloud.getData(s.token), store.data);
      session = { role: s.role, playerId: s.playerId, source: 'cloud', token: s.token };
      startRemoteRefresh();
    } catch (e) { /* session expirée : écran de code */ }
  }
  if (session) resumeUi = r.ui || null;
}

const updateReady = () => (process.platform === 'darwin' ? macUpdate.state === 'ready' : updateInfo.state === 'ready');
function restartForUpdate() {
  if (restarting) return;
  restarting = true;
  try { writeResume(); } catch (e) { /* tant pis : le code sera redemandé */ }
  if (process.platform === 'darwin') {
    if (installMacUpdate(true)) app.quit(); else restarting = false;
  } else {
    try { require('electron-updater').autoUpdater.quitAndInstall(true, true); } catch (e) { restarting = false; }
  }
}
function maybeRestartForUpdate() {
  if (!app.isPackaged || restarting || syncing || polling || !updateReady()) return;
  const idle = powerMonitor.getSystemIdleTime();
  const away = blurredAt && Date.now() - blurredAt > 2 * 60 * 1000;
  if (!session || idle >= 60 || away) restartForUpdate();
}

// ---------------------------------------------------------------- fenêtre
function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 1100, minHeight: 700,
    backgroundColor: '#101316',
    title: 'Coaching LoL',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('blur', () => { blurredAt = Date.now(); });
  win.on('focus', () => { blurredAt = null; });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
}

// tests : chaque instance a son propre dossier Chromium (plusieurs apps lancées en même temps)
if (process.env.COACHING_LOL_TEST && process.env.COACHING_LOL_DATA) app.setPath('userData', path.join(process.env.COACHING_LOL_DATA, 'chromium'));

app.whenReady().then(async () => {
  store = new Store(process.env.COACHING_LOL_DATA || app.getPath('userData'));
  await restoreSession();
  if (isCoachMachine()) ensurePlayerCodes();
  // LP des parties déjà connues, à partir des relevés de rang existants
  if (store.data.players.reduce((n, p) => n + lpMod.attributeLp(store.data, p.id), 0)) store.save();
  registerIpc();
  createWindow();
  refreshDDragon();
  scheduleAutoSync();
  win.webContents.once('did-finish-load', () => {
    if (process.env.COACHING_LOL_TEST) {
      if (FAST) {
        setInterval(pollLive, 2000);
        schedulePush(1000);
        setInterval(refreshBookings, 1500);
        setInterval(refreshReports, 1500);
        setInterval(watchCoaching, 1000);
      }
      return require(process.env.COACHING_LOL_TEST)({ app, win, store, fs, path });
    }
    if (getSecret('apiKey') && store.data.players.length) setTimeout(() => runSync(), 3000);
    setTimeout(pollRanks, 20000);
    setInterval(pollRanks, 5 * 60 * 1000);
    schedulePush(FAST ? 1000 : 15000); // garde aussi le serveur éveillé (le plan gratuit se met en pause après 7 jours sans activité)
    setInterval(() => schedulePush(1000), 6 * 3600 * 1000);
    checkPreviousUpdate();
    setTimeout(checkUpdates, 5000);
    setInterval(checkUpdates, UPDATE_EVERY_MS);
    setInterval(maybeRestartForUpdate, 15 * 1000);
    setTimeout(refreshBookings, FAST ? 500 : 4000);
    setInterval(refreshBookings, FAST ? 2000 : 20 * 1000);
    setTimeout(refreshReports, FAST ? 700 : 6000);
    setInterval(refreshReports, FAST ? 2000 : 30 * 1000);
    setInterval(watchCoaching, FAST ? 1000 : 5 * 1000);
    setInterval(pollLive, FAST ? 2000 : 60 * 1000);
  });
  if (process.env.COACHING_LOL_TEST) app.on('coaching-lol:test-resume', writeResume); // tests uniquement
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

// Mac : une mise à jour prête s'installe quand on quitte l'app (comme sur Windows)
app.on('will-quit', () => { if (process.platform === 'darwin' && macUpdate.state === 'ready') installMacUpdate(false); });
// Fermer la fenêtre quitte l'app, sur Mac aussi : c'est ce qui déclenche l'installation des mises à jour
app.on('window-all-closed', () => app.quit());
