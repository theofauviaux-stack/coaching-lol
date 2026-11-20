const { app, BrowserWindow, ipcMain, shell, dialog, safeStorage, powerMonitor, Notification, protocol, net, desktopCapturer, systemPreferences } = require('electron');
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
const momentsMod = require('./src/moments');
const replayMod = require('./src/replay');
const debriefMod = require('./src/debrief');
const claudeMod = require('./src/claude');
const { pathToFileURL } = require('url');
// vidéos des moments : lues dans l'app par l'adresse clip://v/<joueur_partie>/<fichier>.webm
protocol.registerSchemesAsPrivileged([{ scheme: 'clip', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }]);
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
  d.analyses = analysesView();
  d.claude = claudeView();
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
    // joueur sur l'ordinateur du coach : on ouvre aussi sa session sur le serveur (analyses, envoi de vidéos)
    if (session.role === 'joueur' && cloud) {
      try {
        const r = await cloud.login(code);
        if (r.role === 'joueur' && r.playerId === session.playerId) session.cloudToken = r.token;
      } catch (e) { /* serveur injoignable : analyses indisponibles pour cette session */ }
    }
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
    await refreshAnalyses();
    return { ok: true, data: viewData() };
  } catch (e) {
    if (e.code === 'code_inconnu') limiter.fail();
    return { ok: false, message: e.message };
  }
}

function logout() {
  if (session && session.token && cloud) cloud.logout(session.token);
  if (session && session.cloudToken && cloud) cloud.logout(session.cloudToken);
  session = null;
  remoteData = null;
  bookings.mine = []; bookings.busy = [];
  reports.mine = [];
  if (!isCoachMachine()) Object.assign(analyses, { list: [], loaded: false, error: '' });
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
          r = await syncPlayer(store.data, client, p, { maxGames: store.data.settings.maxGamesPerSync || 30, onTimeline: saveMomentsFrom });
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
    setTimeout(pushMoments, 3000); // moments des nouvelles parties, pour les joueurs
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
    // smurfs ajoutés sans clé API : on cherche leur puuid maintenant
    for (const p of store.data.players) {
      for (const sm of p.smurfs || []) {
        if (sm.puuid || sm.missing) continue;
        try {
          const [gameName, tagLine] = sm.riotId.split('#');
          const acc = await client.account(gameName, tagLine, p.region);
          if (acc && acc.puuid) sm.puuid = acc.puuid; else sm.missing = true;
          store.save();
        } catch (e) { if (e.code === 'KEY') break; }
      }
    }
    const seen = new Set();
    for (const a of liveMod.trackedAccounts(store.data.players)) {
      if (seen.has(a.puuid)) continue;
      seen.add(a.puuid);
      // déjà vu dans une partie trouvée (deux comptes suivis dans la même partie) : inutile de redemander
      if ([...found.values()].some(f => (f.raw.participants || []).some(x => x.puuid === a.puuid))) continue;
      try {
        const raw = await client.activeGame(a.puuid, a.region);
        if (liveMod.isWatched(raw) && !found.has(raw.gameId)) found.set(raw.gameId, { raw, region: a.region });
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
      games.push(liveMod.buildGame(f.raw, store.data.players, ranks, store.data.settings.champKeys || {}, Date.now(), store.data.settings.roleRates || null));
    }
    const before = new Set(live.games.map(g => g.gameId));
    const after = new Set(games.map(g => g.gameId));
    if (!live.first && isCoach()) {
      for (const g of games.filter(x => !before.has(x.gameId))) {
        const who = g.allies.concat(g.enemies).filter(x => x.playerId).map(x => (x.smurf ? playerName(x.playerId) + ' sur son smurf ' + x.smurf : x.gameName || playerName(x.playerId)) + ' (' + champName(x.champion) + ')');
        notifyCoach(g.custom ? 'Partie personnalisée en cours' : 'Partie classée en cours', who.join(', ') + ' · ouvre « En direct » pour la regarder');
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

// Smurfs d'un joueur (page En direct seulement) : pseudos saisis → { riotId, puuid }. Sans clé API, le puuid
// est cherché plus tard (pollLive). Un pseudo inconnu chez Riot est refusé tout de suite.
async function resolveSmurfs(text, region, previous, mainRiotId) {
  const { list, bad, tooMany } = liveMod.parseSmurfs(text);
  if (bad.length) throw new Error('Smurf au mauvais format : ' + bad.join(', ') + ' (il faut Nom#TAG).');
  if (tooMany) throw new Error(liveMod.MAX_SMURFS + ' smurfs au maximum par joueur.');
  const key = getSecret('apiKey');
  const client = key ? new RiotClient(key, { delayMs: 200, base: RIOT_BASE }) : null;
  const out = [];
  for (const riotId of list) {
    if (mainRiotId && riotId.toLowerCase() === String(mainRiotId).toLowerCase()) continue;
    const old = previous.find(x => x.riotId.toLowerCase() === riotId.toLowerCase());
    if (old && old.puuid) { out.push({ riotId, puuid: old.puuid }); continue; }
    let puuid = '';
    if (client) {
      const [gameName, tagLine] = riotId.split('#');
      const acc = await client.account(gameName, tagLine, region);
      if (!acc || !acc.puuid) throw new Error('Smurf introuvable chez Riot : ' + riotId + ' (vérifie le pseudo et la région).');
      puuid = acc.puuid;
    }
    out.push({ riotId, puuid });
  }
  return out;
}

// ---------------------------------------------------------------- moments clés d'une partie
// Un fichier par partie et par joueur (moments/<joueur>_<partie>.json) : calculé à la synchro (la timeline est
// déjà téléchargée), sinon à la demande (2 requêtes Riot). Reste sur l'ordinateur du coach.
const momentsDir = () => path.join(process.env.COACHING_LOL_DATA || app.getPath('userData'), 'moments');
const momentsFile = (playerId, matchId) => path.join(momentsDir(), String(playerId).replace(/[^\w-]/g, '') + '_' + String(matchId).replace(/[^\w-]/g, '') + '.json');
function saveMomentsFrom(match, tl, player) {
  const m = momentsMod.buildMoments(match, tl, player.puuid, store.data.settings.items || {});
  if (!m) return null;
  fs.mkdirSync(momentsDir(), { recursive: true });
  fs.writeFileSync(momentsFile(player.id, m.matchId), JSON.stringify(m));
  return m;
}
// joueur connecté sur son propre ordinateur (données lues sur le serveur) : il voit, filme et envoie ses parties
const isPlayerCloud = () => !!(session && session.role === 'joueur' && session.source === 'cloud');
const isPlayer = () => !!(session && session.role === 'joueur');
const playerToken = () => (isPlayer() ? (session.source === 'cloud' ? session.token : session.cloudToken) || null : null);
const isPlayerOnline = () => !!(cloud && playerToken());
function readMoments(playerId, matchId) {
  try { return JSON.parse(fs.readFileSync(momentsFile(playerId, matchId), 'utf8')); } catch (e) { return null; }
}
function writeMoments(playerId, m) {
  fs.mkdirSync(momentsDir(), { recursive: true });
  fs.writeFileSync(momentsFile(playerId, m.matchId), JSON.stringify(m));
}
// ordinateur du coach : 2 requêtes Riot (partie + timeline)
async function computeMoments(player, matchId) {
  const key = getSecret('apiKey');
  if (!key) throw new Error('Ajoute ta clé API Riot dans Paramètres pour calculer les moments clés.');
  if (!player.puuid) throw new Error('Compte Riot du joueur pas encore trouvé : lance une synchronisation.');
  const client = new RiotClient(key, { delayMs: 200, base: RIOT_BASE });
  const match = await client.match(matchId, player.region);
  const tl = match ? await client.timeline(matchId, player.region) : null;
  if (!match || !tl) throw new Error('Riot ne donne plus le détail de cette partie (trop ancienne ?).');
  const m = saveMomentsFrom(match, tl, player);
  if (!m) throw new Error('Le joueur n\'apparaît pas dans cette partie.');
  return m;
}
async function getMoments({ playerId, matchId }) {
  if (isPlayer()) {
    if (playerId !== session.playerId) throw new Error('Partie introuvable.');
    let m = readMoments(playerId, matchId);
    if (!m && session.source === 'local') { // ordinateur du coach : calcul avec sa clé Riot
      const player = store.data.players.find(p => p.id === playerId);
      if (!player) throw new Error('Joueur introuvable.');
      m = await computeMoments(player, matchId);
    }
    if (!m) {
      if (!cloud) throw new Error('Pas de serveur configuré.');
      m = (await cloud.momentsGet(session.token, matchId)).moments;
      writeMoments(playerId, m);
    }
    const an = analyses.list.find(a => a.matchId === matchId && a.playerId === playerId);
    return {
      ok: true, moments: m, videoKey: videoKey(playerId, matchId), canFilm: true,
      filming: !!(videoJob && videoJob.matchId === matchId) && videoJob.status, filmingProgress: videoJob ? videoJob.progress : 0,
      sending: !!(sendJob && sendJob.matchId === matchId) && sendJob.status,
      analysisId: an ? an.id : null, analysisClosed: !!(an && an.status === 'terminee'), lol: lolInstallView()
    };
  }
  requireEdit();
  const player = store.data.players.find(p => p.id === playerId);
  if (!player) throw new Error('Joueur introuvable.');
  const m = readMoments(playerId, matchId) || await computeMoments(player, matchId);
  const text = momentsMod.toText(m, { player: player.riotId, champName });
  const an = analyses.list.find(a => a.matchId === matchId && a.playerId === playerId);
  return { ok: true, moments: m, text, analysisId: an ? an.id : null };
}

// ---------------------------------------------------------------- moments envoyés au serveur (ordinateur du coach)
// Parties des 30 derniers jours : le joueur peut les voir et les filmer chez lui. Moments manquants calculés
// au fil de l'eau (10 parties au plus par passage, 2 requêtes Riot chacune).
let momentsPushing = false;
async function pushMoments() {
  if (!cloud || !isCoachMachine() || momentsPushing) return;
  momentsPushing = true;
  try {
    const key = getPushToken();
    const sentFile = path.join(momentsDir(), 'envoyes.json');
    let sent = {};
    try { sent = JSON.parse(fs.readFileSync(sentFile, 'utf8')); } catch (e) { /* premier envoi */ }
    const have = new Set((await cloud.coachMomentsPush(key, [])).have || []);
    for (const k of Object.keys(sent)) if (!have.has(k)) delete sent[k]; // serveur vidé ou parties retirées
    const since = Date.now() - 30 * 86400e3;
    const items = [];
    let computed = 0;
    for (const g of store.data.games.filter(x => x.date >= since).sort((a, b) => b.date - a.date)) {
      const player = store.data.players.find(p => p.id === g.playerId);
      if (!player) continue;
      const k = g.playerId + '/' + g.matchId;
      let m = readMoments(g.playerId, g.matchId);
      if (!m && getSecret('apiKey') && player.puuid && computed < 10) {
        computed++;
        try { m = await computeMoments(player, g.matchId); } catch (e) { /* partie indisponible chez Riot */ }
      }
      if (!m) continue;
      const mt = Math.round(fs.statSync(momentsFile(g.playerId, g.matchId)).mtimeMs);
      if (sent[k] === mt) continue;
      const { clips, camera, sent: _s, pending: _p, ...data } = m; // eslint-disable-line no-unused-vars
      items.push({ k, mt, item: { playerId: g.playerId, matchId: g.matchId, date: g.date, data } });
    }
    for (let i = 0; i < items.length; i += 10) {
      const batch = items.slice(i, i + 10);
      await cloud.coachMomentsPush(key, batch.map(x => x.item));
      for (const x of batch) sent[x.k] = x.mt;
      fs.mkdirSync(momentsDir(), { recursive: true });
      fs.writeFileSync(sentFile, JSON.stringify(sent));
    }
  } catch (e) {
    /* serveur injoignable ou pas encore à jour : nouvel essai au prochain passage */
  } finally {
    momentsPushing = false;
  }
}

// ---------------------------------------------------------------- analyses de parties (joueur ↔ coach)
// Le joueur filme ses moments chez lui, choisit les extraits, les commente et envoie la partie ; le coach et le
// joueur en discutent moment par moment ; le coach termine l'analyse (les vidéos sont alors effacées du serveur).
const analyses = { list: [], loaded: false, error: '' };
let sendJob = null;
const analysisRole = () => (canEdit() ? 'coach' : isPlayerOnline() ? 'joueur' : null);
// messages lus : un registre pour le coach, un par joueur (plusieurs profils peuvent servir sur le même ordinateur)
function seenMap(me = analysisRole()) {
  const all = store.data.settings.analysesLus || (store.data.settings.analysesLus = {});
  const k = me === 'coach' ? 'coach' : 'joueur:' + (session && session.playerId);
  return all[k] || (all[k] = {});
}
const lastId = (a, who) => a.comments.filter(c => !who || c.author === who).reduce((n, c) => Math.max(n, c.id), 0);
function unreadOf(a, me) {
  const seen = seenMap(me);
  if (me === 'coach' && !(a.id in seen)) return true;
  return lastId(a, me === 'coach' ? 'joueur' : 'coach') > (seen[a.id] || 0);
}
function gameLabel(a) {
  const games = session && session.source === 'cloud' && remoteData ? remoteData.games : store.data.games;
  const g = (games || []).find(x => x.matchId === a.matchId && x.playerId === a.playerId);
  return g ? champName(g.champion) + (g.opponent ? ' contre ' + champName(g.opponent) : '') : 'une partie';
}
const excerpt = t => (t.length > 120 ? t.slice(0, 117) + '…' : t);
async function refreshAnalyses() {
  if (!cloud) return;
  const me = isCoachMachine() ? 'coach' : isPlayerCloud() ? 'joueur' : null;
  if (!me) return;
  const before = JSON.stringify([analyses.list, analyses.error]);
  try {
    const r = me === 'coach' ? await cloud.coachAnalyses(getPushToken()) : await cloud.analysesMine(session.token);
    const list = r.analyses || [];
    if (analyses.loaded) {
      for (const a of list) {
        const old = analyses.list.find(x => x.id === a.id);
        const fresh = a.comments.filter(c => c.author !== me && (!old || c.id > lastId(old)));
        if (!old && me === 'coach') notifyCoach('Partie à analyser', playerName(a.playerId) + ' t\'envoie ' + gameLabel(a) + (a.clips.length ? ' (' + a.clips.length + ' vidéo' + (a.clips.length > 1 ? 's' : '') + ').' : '.'));
        else if (old && fresh.length) notifyCoach(me === 'coach' ? 'Réponse de ' + playerName(a.playerId) : 'Réponse du coach', excerpt(fresh[fresh.length - 1].text));
        else if (old && me === 'joueur' && old.status !== 'terminee' && a.status === 'terminee') notifyCoach('Analyse terminée', 'Le coach a terminé l\'analyse de ' + gameLabel(a) + '.');
      }
      if (me === 'joueur') for (const old of analyses.list) if (!list.some(a => a.id === old.id)) notifyCoach('Analyse supprimée', 'Le coach a supprimé l\'analyse de ' + gameLabel(old) + '.');
    }
    analyses.list = list;
    analyses.loaded = true;
    analyses.error = '';
  } catch (e) {
    analyses.error = e.message;
  }
  if (session && JSON.stringify([analyses.list, analyses.error]) !== before) refreshView();
  if (me === 'coach') syncClaudeFolder();
}
function analysesView() {
  const me = analysisRole();
  if (!me) return null;
  const list = analyses.list.filter(a => me === 'coach' || a.playerId === session.playerId).map(a => Object.assign({}, a, { unread: unreadOf(a, me), label: gameLabel(a) }));
  return { me, list, unread: list.filter(a => a.unread).length, error: analyses.error || (me === 'coach' && analyses.purgeError) || '', loaded: analyses.loaded };
}
function keepAnalysis(a, seen) {
  const i = analyses.list.findIndex(x => x.id === a.id);
  const light = Object.assign({}, a);
  delete light.moments;
  if (i >= 0) analyses.list[i] = light; else analyses.list.unshift(light);
  if (seen) { seenMap()[a.id] = lastId(a); store.save(); }
}
async function getAnalysis({ id }) {
  const me = analysisRole();
  if (!me || !cloud) throw new Error('Analyses indisponibles ici.');
  const r = me === 'coach' ? await cloud.coachAnalysisGet(getPushToken(), id) : await cloud.analysisGet(playerToken(), id);
  keepAnalysis(r.analysis, true);
  setTimeout(refreshView, 0);
  const cd = me === 'coach' ? readClaudeDrafts()[id] : null;
  return { ok: true, analysis: r.analysis, me, label: gameLabel(r.analysis), playerName: playerName(r.analysis.playerId), claude: cd ? { general: cd.general, moments: cd.moments, used: cd.used || {} } : null };
}
async function commentAnalysis({ id, t, text }) {
  const me = analysisRole();
  if (!me || !cloud) throw new Error('Analyses indisponibles ici.');
  const msg = String(text || '').trim();
  if (!msg) throw new Error('Message vide.');
  const tt = t === null || t === undefined || t === '' ? null : Math.round(Number(t));
  const r = me === 'coach' ? await cloud.coachAnalysisComment(getPushToken(), id, tt, msg) : await cloud.analysisComment(playerToken(), id, tt, msg);
  keepAnalysis(r.analysis, true);
  if (me === 'coach') claudeDraftUsed(id, tt);
  refreshView();
  return { ok: true, analysis: r.analysis };
}
async function closeAnalysis({ id }) {
  requireEdit();
  const r = await cloud.coachAnalysisClose(getPushToken(), id);
  keepAnalysis(r.analysis, true);
  refreshView();
  purgeClips();
  return { ok: true, analysis: r.analysis };
}
// suppression par le coach : l'analyse disparaît chez lui et chez le joueur ; messages effacés aussitôt,
// vidéos effacées par la purge (lancée tout de suite), dossier pour Claude retiré
async function deleteAnalysis({ id }) {
  requireEdit();
  if (!cloud || !isCoachMachine()) throw new Error('La suppression se fait depuis l\'ordinateur du coach.');
  const key = String(id || '');
  try {
    await cloud.coachAnalysisDelete(getPushToken(), key);
  } catch (e) {
    if (e.code === 'MISSING') throw new Error('Le serveur n\'est pas encore à jour pour la suppression : relance supabase/analyses.sql dans Supabase.');
    if (!/n'existe plus/.test(e.message)) throw e;
  }
  analyses.list = analyses.list.filter(a => a.id !== key);
  const all = readClaudeDrafts();
  if (all[key]) { delete all[key]; writeClaudeDrafts(all); }
  try {
    const base = claudeDir();
    const name = fs.existsSync(base) ? claudeFolders(base).get(key.slice(0, 8)) : null;
    if (name) fs.rmSync(path.join(base, name), { recursive: true, force: true });
  } catch (e) { /* dossier occupé : la prochaine passe retirera les vidéos */ }
  delete claudeState.ready[key];
  refreshView();
  purgeClips();
  return { ok: true, data: viewData() };
}
// vidéos à effacer du serveur (analyses terminées, plus de 30 jours, envois abandonnés)
async function purgeClips() {
  if (!cloud || !isCoachMachine()) return;
  try {
    const key = getPushToken();
    const r = await cloud.coachClipsPurge(key);
    let left = 0;
    for (const x of r.purge || []) {
      const deleted = x.files.length ? await cloud.deleteClips(x.files.map(f => x.id + '/' + f)) : [];
      const done = new Set((Array.isArray(deleted) ? deleted : []).map(o => String(o.name || '').split('/').pop()));
      let still = 0;
      for (const f of x.files) if (!done.has(f) && await cloud.clipExists(x.id, f)) still++; // jamais envoyée : rien à effacer
      if (still) { left += still; continue; } // nouvel essai au prochain passage
      await cloud.coachClipsGone(key, x.id);
    }
    const err = left ? left + ' vidéo' + (left > 1 ? 's' : '') + ' n\'a pas pu être effacée du serveur (nouvel essai dans une heure).' : '';
    if (err !== analyses.purgeError) { analyses.purgeError = err; if (canEdit()) refreshView(); }
  } catch (e) { /* nouvel essai au prochain passage */ }
}
// Export par le joueur d'une analyse terminée : vidéos + debrief.html dans un dossier de son ordinateur, puis
// l'analyse est supprimée du serveur (vidéos et messages) et ses vidéos locales de l'app, pour ne pas encombrer.
let exportJob = null;
const playerNameFor = id => String((((session && session.source === 'cloud' && remoteData ? remoteData.players : store.data.players) || []).find(p => p.id === id) || {}).riotId || 'Joueur').split('#')[0];
// ---------------------------------------------------------------- analyses par Claude (ordinateur du coach, sans API)
// Chaque partie envoyée par un joueur est préparée dans un dossier (vidéos, dossier de partie, fiche). Claude, dans une
// conversation reliée à cet ordinateur, y écrit « analyse-claude.json » ; l'app le reprend comme brouillons de réponses.
// dans le dossier personnel, pas dans Documents : pas d'autorisation macOS à demander, pas de copie des vidéos vers iCloud
const claudeDir = () => process.env.COACHING_LOL_CLAUDE_DIR || path.join(app.getPath('home'), 'Coaching LoL', 'Analyses pour Claude');
const claudeDraftsFile = () => path.join(process.env.COACHING_LOL_DATA || app.getPath('userData'), 'claude-brouillons.json');
const claudeState = { busy: false, error: '', waiting: 0, ready: {} };
function readClaudeDrafts() {
  try { return JSON.parse(fs.readFileSync(claudeDraftsFile(), 'utf8')) || {}; } catch (e) { return {}; }
}
function writeClaudeDrafts(d) {
  fs.mkdirSync(path.dirname(claudeDraftsFile()), { recursive: true });
  fs.writeFileSync(claudeDraftsFile() + '.tmp', JSON.stringify(d));
  fs.renameSync(claudeDraftsFile() + '.tmp', claudeDraftsFile());
}
function claudeDraftUsed(id, t) {
  const all = readClaudeDrafts();
  if (!all[id]) return;
  (all[id].used || (all[id].used = {}))[t === null ? 'g' : t] = true;
  writeClaudeDrafts(all);
}
const claudeUnused = d => !!d && ((d.general && !(d.used || {}).g) || Object.keys(d.moments || {}).some(t => !(d.used || {})[t]));
function claudeView() {
  if (!isCoachMachine() || !canEdit() || !cloud) return null;
  return { dir: claudeDir(), waiting: claudeState.waiting, ready: claudeState.ready, error: claudeState.error };
}
function claudeFolders(base) {
  const map = new Map();
  for (const e of fs.readdirSync(base, { withFileTypes: true })) {
    const id8 = e.isDirectory() && !e.name.startsWith('.') ? claudeMod.idFromFolder(e.name) : null;
    if (id8) map.set(id8, e.name);
  }
  return map;
}
async function prepareClaudeFolder(base, a) {
  const full = (await cloud.coachAnalysisGet(getPushToken(), a.id)).analysis;
  if (!full.moments || !full.moments.moments) return null;
  const label = gameLabel(full);
  const name = claudeMod.folderName(full, { playerName: playerName(full.playerId), label });
  const tmp = path.join(base, '.prep-' + full.id.slice(0, 8));
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(path.join(tmp, 'videos'), { recursive: true });
  const localDir = path.join(videosDir(), videoKey(full.playerId, full.matchId));
  for (const c of full.clips || []) {
    if (!/^[\w-]+\.webm$/.test(c.file)) continue;
    const out = path.join(tmp, 'videos', c.file);
    const local = path.join(localDir, c.file);
    if (fs.existsSync(local) && fs.statSync(local).size > 0) fs.copyFileSync(local, out);
    else {
      const res = await fetch(cloud.clipUrl(full.id, c.file));
      if (!res.ok) throw new Error('vidéo ' + c.file + ' introuvable (' + res.status + ')');
      fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
    }
  }
  const m = full.moments;
  fs.writeFileSync(path.join(tmp, 'dossier.txt'), momentsMod.toText(m, { player: playerName(full.playerId), champName }));
  fs.writeFileSync(path.join(tmp, 'partie.json'), JSON.stringify(m, null, 1));
  fs.writeFileSync(path.join(tmp, claudeMod.MANIFEST), JSON.stringify(claudeMod.manifest(full, m, { playerName: playerName(full.playerId), label, champName }), null, 2));
  if (!analyses.list.some(x => x.id === full.id && x.status === 'ouverte')) { fs.rmSync(tmp, { recursive: true, force: true }); return null; } // supprimée entre-temps
  fs.renameSync(tmp, path.join(base, name)); // le dossier n'apparaît qu'une fois complet
  return name;
}
async function syncClaudeFolder() {
  if (!cloud || !isCoachMachine() || !canEdit() || !analyses.loaded || analyses.error || claudeState.busy) return;
  claudeState.busy = true;
  const before = JSON.stringify([claudeState.waiting, claudeState.ready, claudeState.error]);
  let err = '';
  try {
    const base = claudeDir();
    fs.mkdirSync(base, { recursive: true });
    if (!fs.existsSync(path.join(base, 'LISEZ-MOI.txt'))) fs.writeFileSync(path.join(base, 'LISEZ-MOI.txt'), claudeMod.README);
    if (!fs.existsSync(path.join(base, 'methode-coach.md'))) fs.writeFileSync(path.join(base, 'methode-coach.md'), claudeMod.METHOD);
    const folders = claudeFolders(base);
    const drafts = readClaudeDrafts();
    let changed = false, waiting = 0;
    const ready = {};
    for (const a of analyses.list) {
      const id8 = a.id.slice(0, 8);
      const open = a.status === 'ouverte';
      let name = folders.get(id8);
      if (!name && open && a.clipsState === 'en_ligne') {
        try { name = await prepareClaudeFolder(base, a); } catch (e) { err = 'Préparation pour Claude de ' + gameLabel(a) + ' : ' + e.message; }
      }
      if (!name) continue;
      const dir = path.join(base, name);
      const rf = path.join(dir, claudeMod.RESULT);
      if (open) {
        if (!fs.existsSync(rf)) waiting++;
        else {
          const mtime = fs.statSync(rf).mtimeMs;
          if (!drafts[a.id] || drafts[a.id].mtime !== mtime) {
            let r;
            try { r = claudeMod.parseResult(JSON.parse(fs.readFileSync(rf, 'utf8')), JSON.parse(fs.readFileSync(path.join(dir, claudeMod.MANIFEST), 'utf8'))); } catch (e) { r = { ok: false, errors: ['Fichier illisible : ' + e.message] }; }
            if (r.ok) {
              drafts[a.id] = Object.assign({ mtime, at: Date.now(), used: {} }, r.draft);
              changed = true;
              notifyCoach('Analyse de Claude prête', gameLabel(a) + ' de ' + playerName(a.playerId) + ' : ses propositions t\'attendent en brouillon dans « Analyses ».');
            } else drafts[a.id] = { mtime, error: r.errors.join(' ') };
            if (r.errors && r.errors.length) fs.writeFileSync(path.join(dir, 'erreurs-import.txt'), r.errors.join('\n') + '\n');
            changed = true;
          }
          if (claudeUnused(drafts[a.id])) ready[a.id] = true;
          if (drafts[a.id] && drafts[a.id].error) err = 'La réponse de Claude pour ' + gameLabel(a) + ' n\'a pas pu être lue : ' + drafts[a.id].error;
        }
      } else {
        // analyse terminée : les vidéos (copies) quittent le dossier, le texte reste ; plus de brouillon
        fs.rmSync(path.join(dir, 'videos'), { recursive: true, force: true });
        if (drafts[a.id]) { delete drafts[a.id]; changed = true; }
      }
    }
    // analyses exportées par le joueur (disparues de la liste) : idem
    for (const [id8, name] of folders) {
      if (analyses.list.some(a => a.id.startsWith(id8))) continue;
      fs.rmSync(path.join(base, name, 'videos'), { recursive: true, force: true });
      for (const id of Object.keys(drafts)) if (id.startsWith(id8)) { delete drafts[id]; changed = true; }
    }
    if (changed) writeClaudeDrafts(drafts);
    Object.assign(claudeState, { waiting, ready });
  } catch (e) {
    err = 'Dossier pour Claude : ' + e.message;
  } finally {
    claudeState.busy = false;
    claudeState.error = err;
  }
  if (session && JSON.stringify([claudeState.waiting, claudeState.ready, claudeState.error]) !== before) refreshView();
}

async function exportAnalysis({ id }) {
  if (!isPlayerOnline()) throw new Error('L\'export se fait depuis l\'espace du joueur, connecté au serveur du coach.');
  if (exportJob) throw new Error('Un export est déjà en cours.');
  const a = (await cloud.analysisGet(playerToken(), id)).analysis;
  if (a.status !== 'terminee') throw new Error('Tu pourras exporter l\'analyse quand le coach l\'aura terminée.');
  let base = process.env.COACHING_LOL_TEST ? process.env.COACHING_LOL_EXPORT_DIR : null;
  if (!base) {
    const res = await dialog.showOpenDialog(win, { title: 'Où enregistrer l\'analyse (vidéos + débrief) ?', buttonLabel: 'Exporter ici', properties: ['openDirectory', 'createDirectory'] });
    if (res.canceled || !res.filePaths || !res.filePaths[0]) return { ok: false, canceled: true };
    base = res.filePaths[0];
  }
  exportJob = { id };
  const say = (text, progress) => send('analysis:export', { id, text, progress });
  try {
    const label = gameLabel(a);
    const day = new Date(a.createdAt).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' }).replace(/\//g, '-');
    const name = ('Analyse ' + label + ' ' + day).replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();
    let dir = path.join(base, name);
    for (let k = 2; fs.existsSync(dir); k++) dir = path.join(base, name + ' (' + k + ')');
    fs.mkdirSync(dir, { recursive: true });
    const clips = a.clipsState === 'en_ligne' ? a.clips : [];
    const localDir = path.join(videosDir(), videoKey(a.playerId, a.matchId));
    const files = [];
    for (let i = 0; i < clips.length; i++) {
      const f = clips[i].file;
      if (!/^[\w-]+\.webm$/.test(f)) continue;
      say('Enregistrement de la vidéo ' + (i + 1) + '/' + clips.length + ' sur ton ordinateur…', 0.05 + 0.75 * i / clips.length);
      const out = path.join(dir, f);
      const local = path.join(localDir, f);
      if (fs.existsSync(local) && fs.statSync(local).size > 0) fs.copyFileSync(local, out);
      else {
        const res = await fetch(cloud.clipUrl(id, f));
        if (!res.ok) throw new Error('La vidéo ' + f + ' est introuvable sur le serveur (' + res.status + ') : rien n\'a été supprimé.');
        fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
      }
      if (!(fs.statSync(out).size > 0)) throw new Error('La vidéo ' + f + ' est vide : rien n\'a été supprimé.');
      files.push(f);
    }
    say('Écriture du débrief…', 0.84);
    const html = debriefMod.buildDebrief({ analysis: a, label, playerName: playerNameFor(a.playerId), champName, files });
    fs.writeFileSync(path.join(dir, 'debrief.html'), html);
    if (fs.readFileSync(path.join(dir, 'debrief.html'), 'utf8').length !== html.length) throw new Error('Le débrief n\'a pas pu être écrit : rien n\'a été supprimé.');
    // tout est sur l'ordinateur : l'analyse quitte le serveur et l'app
    say('Suppression de l\'analyse sur le serveur…', 0.9);
    const ex = await cloud.analysisExportDone(playerToken(), id);
    let left = 0;
    if (ex.files && ex.files.length) {
      await cloud.deleteClips(ex.files.map(f => id + '/' + f)).catch(() => null);
      for (const f of ex.files) if (await cloud.clipExists(id, f)) left++;
    }
    if (!left) await cloud.analysisForget(playerToken(), id).catch(() => null); // sinon la purge du coach finira
    fs.rmSync(localDir, { recursive: true, force: true });
    const mm = readMoments(a.playerId, a.matchId);
    if (mm) { delete mm.clips; delete mm.camera; delete mm.sent; delete mm.pending; writeMoments(a.playerId, mm); }
    analyses.list = analyses.list.filter(x => x.id !== id);
    refreshView();
    if (!process.env.COACHING_LOL_TEST) shell.showItemInFolder(path.join(dir, 'debrief.html'));
    return { ok: true, dir, files: files.length };
  } finally {
    exportJob = null;
  }
}

// Envoi d'une partie par le joueur : analyse créée, vidéos envoyées une à une, puis analyse ouverte au coach
async function sendAnalysis({ matchId, picks, note }) {
  if (!isPlayerOnline()) throw new Error(isPlayer() ? 'Pas de connexion au serveur du coach : réessaie dans un moment.' : 'L\'envoi se fait depuis l\'espace du joueur.');
  if (sendJob) throw new Error('Un envoi est déjà en cours.');
  if (videoJob) throw new Error('Attends la fin de l\'enregistrement.');
  const playerId = session.playerId;
  const m = readMoments(playerId, matchId);
  if (!m || !m.clips || !m.clips.length) throw new Error('Filme d\'abord les moments de la partie.');
  const dir = path.join(videosDir(), videoKey(playerId, matchId));
  const chosen = (Array.isArray(picks) ? picks : []).map(p => ({ c: m.clips.find(c => c.file === p.file), comment: String(p.comment || '').trim().slice(0, 2000) })).filter(x => x.c);
  if (!chosen.length) throw new Error('Choisis au moins une vidéo à envoyer.');
  const clips = chosen.map(({ c }) => {
    let bytes = 0;
    try { bytes = fs.statSync(path.join(dir, c.file)).size; } catch (e) { /* vidéo supprimée */ }
    if (!bytes) throw new Error('Vidéo introuvable : refilme les moments.');
    return { file: c.file, start: c.start, end: c.end, times: c.times, bytes };
  });
  const files = clips.map(c => c.file).join(',');
  const comments = chosen.filter(x => x.comment).map(x => ({ t: x.c.times[0], text: x.comment }));
  sendJob = { matchId, status: 'Préparation de l\'envoi…' };
  let id;
  try {
    // envoi interrompu il y a peu avec les mêmes vidéos : on reprend la même analyse
    if (m.pending && m.pending.files === files && Date.now() - m.pending.at < 2.5 * 3600e3) id = m.pending.id;
    else {
      if (session.source === 'local' && isCoachMachine()) { // ordinateur du coach : les moments de cette partie partent tout de suite
        const g = store.data.games.find(x => x.matchId === matchId && x.playerId === playerId);
        const { clips: _c, camera: _k, sent: _s, pending: _p, ...data } = m; // eslint-disable-line no-unused-vars
        await cloud.coachMomentsPush(getPushToken(), [{ playerId, matchId, date: g ? g.date : Date.now(), data }]);
      }
      id = (await cloud.analysisCreate(playerToken(), { matchId, clips, note: String(note || '').trim().slice(0, 2000), comments })).id;
      m.pending = { id, at: Date.now(), files };
      writeMoments(playerId, m);
    }
  } catch (e) {
    sendJob = null;
    throw e;
  }
  const status = (text, progress) => { sendJob.status = text; sendJob.progress = progress; send('analysis:status', { matchId, text, progress }); };
  (async () => {
    try {
      for (let i = 0; i < clips.length; i++) {
        status('Envoi de la vidéo ' + (i + 1) + '/' + clips.length + '…', 0.05 + 0.9 * i / clips.length);
        await cloud.uploadClip(id, clips[i].file, fs.readFileSync(path.join(dir, clips[i].file)));
        if (!session) throw new Error('Session fermée pendant l\'envoi.');
      }
      status('Envoi au coach…', 0.97);
      const r = await cloud.analysisReady(playerToken(), id);
      delete m.pending;
      m.sent = { id, at: Date.now() };
      writeMoments(playerId, m);
      keepAnalysis(r.analysis, true);
      sendJob = null;
      refreshView();
      send('analysis:status', { matchId, done: true, id, text: 'Partie envoyée au coach : il est prévenu.' });
    } catch (e) {
      sendJob = null;
      send('analysis:status', { matchId, error: e.message + ' Réessaie : les vidéos déjà envoyées ne repartent pas.' });
    }
  })();
  return { ok: true };
}

// ---------------------------------------------------------------- vidéos des moments (replay, ordinateur du coach)
// Le client LoL télécharge puis ouvre le replay ; la Replay API du jeu va à chaque moment avec la caméra sur
// le joueur ; l'app filme la fenêtre du jeu (fenêtre cachée « recorder ») ; voir src/replay.js.
const videosDir = () => path.join(process.env.COACHING_LOL_DATA || app.getPath('userData'), 'videos');
const videoKey = (playerId, matchId) => String(playerId).replace(/[^\w-]/g, '') + '_' + String(matchId).replace(/[^\w-]/g, '');
const REPLAY_BASE = (process.env.COACHING_LOL_TEST && process.env.COACHING_LOL_REPLAY) || 'https://127.0.0.1:2999';
let videoJob = null;

// Requête vers un service local de Riot (client LoL ou jeu). Leurs certificats sont auto-signés par Riot :
// on ne les vérifie pas, mais on n'accepte que 127.0.0.1.
function localJson(base, method, p, body, password) {
  return new Promise((resolve, reject) => {
    const u = new URL(p, base);
    if (!['127.0.0.1', 'localhost'].includes(u.hostname)) return reject(new Error('Adresse locale attendue.'));
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const headers = { Accept: 'application/json' };
    if (data) Object.assign(headers, { 'Content-Type': 'application/json', 'Content-Length': data.length });
    if (password) headers.Authorization = 'Basic ' + Buffer.from('riot:' + password).toString('base64');
    const req = (u.protocol === 'https:' ? require('https') : require('http')).request(u, { method, headers, rejectUnauthorized: false, timeout: 10000 }, res => {
      let txt = '';
      res.setEncoding('utf8');
      res.on('data', c => { txt += c; });
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(Object.assign(new Error('HTTP ' + res.statusCode), { status: res.statusCode }));
        try { resolve(txt ? JSON.parse(txt) : {}); } catch (e) { resolve({}); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('délai dépassé')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
// Port et mot de passe du client LoL : fichier « lockfile », sinon arguments du processus LeagueClientUx
async function lcuCreds() {
  if (process.env.COACHING_LOL_TEST && process.env.COACHING_LOL_LCU) return { base: process.env.COACHING_LOL_LCU, password: 'test' };
  const ins = lolInstall();
  if (ins) {
    const f = LOL_OS === 'win32' ? path.join(ins.base, 'lockfile') : path.join(ins.base, 'Contents', 'LoL', 'lockfile');
    try { const i = replayMod.lockfileInfo(fs.readFileSync(f, 'utf8')); if (i) return { base: 'https://127.0.0.1:' + i.port, password: i.password }; } catch (e) { /* client fermé */ }
  }
  const out = await new Promise(resolve => {
    const { execFile } = require('child_process');
    if (process.platform === 'win32') execFile('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from("Get-CimInstance Win32_Process -Filter \"name='LeagueClientUx.exe'\" | Select-Object -ExpandProperty CommandLine", 'utf16le').toString('base64')], { windowsHide: true }, (e, o) => resolve(String(o || '')));
    else execFile('ps', ['-A', '-o', 'args'], { maxBuffer: 16 * 1024 * 1024 }, (e, o) => resolve(String(o || '').split('\n').filter(l => l.includes('LeagueClientUx')).join('\n')));
  });
  const i = replayMod.lcuFromArgs(out);
  return i ? { base: 'https://127.0.0.1:' + i.port, password: i.password } : null;
}
function killGame() {
  return new Promise(resolve => {
    if (process.env.COACHING_LOL_TEST) return resolve();
    const { execFile } = require('child_process');
    if (process.platform === 'win32') execFile('taskkill', ['/IM', 'League of Legends.exe', '/F'], () => resolve());
    else execFile('pkill', ['-x', 'LeagueofLegends'], () => resolve());
  });
}
// Fenêtre cachée qui filme (MediaRecorder) ; une seule, créée à la demande
let recWin = null;
function recorderWindow() {
  if (recWin && !recWin.isDestroyed()) return Promise.resolve(recWin);
  recWin = new BrowserWindow({ show: false, width: 320, height: 200, webPreferences: { preload: path.join(__dirname, 'recorder-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
  return recWin.loadFile(path.join(__dirname, 'renderer', 'recorder.html')).then(() => recWin);
}
async function recordWindow(seconds, file, onTick) {
  const sources = await desktopCapturer.getSources({ types: ['window', 'screen'], thumbnailSize: { width: 0, height: 0 } });
  const game = process.env.COACHING_LOL_TEST ? null : sources.find(x => x.id.startsWith('window') && /League of Legends \(TM\)/i.test(x.name));
  const src = game || sources.find(x => x.id.startsWith('screen'));
  if (!src) throw new Error('Aucune fenêtre à filmer.');
  const rw = await recorderWindow();
  const id = crypto.randomUUID();
  const done = new Promise((resolve, reject) => {
    const h = (e, r) => {
      if (!r || r.id !== id) return;
      ipcMain.removeListener('rec:done', h);
      if (r.error) reject(new Error('Enregistrement impossible : ' + r.error)); else resolve(r.data);
    };
    ipcMain.on('rec:done', h);
  });
  const ms = FAST ? 1500 : Math.round(seconds * 1000);
  rw.webContents.send('rec:start', { id, sourceId: src.id, ms, w: 1280, h: 720, fps: 30, bps: 1200000 });
  const t0 = Date.now();
  const tick = onTick ? setInterval(() => onTick(Math.min(1, (Date.now() - t0) / ms)), 1000) : null;
  let data;
  try { data = await done; } finally { if (tick) clearInterval(tick); }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(data));
}
function sendVideo(v) { if (win && !win.isDestroyed()) win.webContents.send('video:status', v); }
// Sélection du joueur dans le replay : double appui sur sa touche de joueur (touches physiques : 1-5 pour l'équipe
// bleue, Q W E R T en QWERTY = A Z E R T en AZERTY pour la rouge). Le jeu le sélectionne et centre la caméra sur lui.
const SCAN_WIN = { 1: 0x02, 2: 0x03, 3: 0x04, 4: 0x05, 5: 0x06, q: 0x10, w: 0x11, e: 0x12, r: 0x13, t: 0x14 };
const KEYCODE_MAC = { 1: 18, 2: 19, 3: 20, 4: 21, 5: 23, q: 12, w: 13, e: 14, r: 15, t: 17 };
function selectPlayerInReplay(key) {
  return new Promise((resolve, reject) => {
    if (process.env.COACHING_LOL_TEST) {
      try { fs.appendFileSync(path.join(videosDir(), 'touches.txt'), key + '\n'); } catch (e) { /* test */ }
      return resolve();
    }
    const { execFile } = require('child_process');
    if (process.platform === 'win32') {
      const sc = SCAN_WIN[key];
      const ps = [
        "$sig = '[DllImport(\"user32.dll\")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo); [DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr hWnd);'",
        '$u = Add-Type -MemberDefinition $sig -Name Clavier -Namespace CoachingLoL -PassThru',
        "$p = Get-Process -Name 'League of Legends' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1",
        "if (-not $p) { Write-Output 'PAS_DE_JEU'; exit 2 }",
        '$u::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); $u::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)', // Alt : autorise le passage au premier plan
        '$u::SetForegroundWindow($p.MainWindowHandle) | Out-Null',
        'Start-Sleep -Milliseconds 350',
        'foreach ($i in 1..2) { $u::keybd_event(0, ' + sc + ', 8, [UIntPtr]::Zero); Start-Sleep -Milliseconds 40; $u::keybd_event(0, ' + sc + ', 10, [UIntPtr]::Zero); Start-Sleep -Milliseconds 110 }',
        "Write-Output 'OK'"
      ].join('; ');
      execFile('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')], { timeout: 20000, windowsHide: true }, (e, out, err) => {
        const o = String(out || '');
        if (/OK/.test(o)) return resolve();
        reject(new Error(/PAS_DE_JEU/.test(o) ? 'La fenêtre du replay est introuvable.' : 'Impossible d\'envoyer la touche au replay (' + String(err || (e && e.message) || o).trim().slice(0, 200) + ').'));
      });
    } else if (process.platform === 'darwin') {
      const code = KEYCODE_MAC[key];
      execFile('pgrep', ['-x', 'LeagueofLegends'], (e1, out1) => {
        const pid = parseInt(String(out1 || '').trim().split('\n')[0], 10);
        const target = pid ? 'first process whose unix id is ' + pid : 'first process whose name is "LeagueofLegends"';
        const script = 'tell application "System Events"\nset frontmost of (' + target + ') to true\ndelay 0.35\nkey code ' + code + '\ndelay 0.11\nkey code ' + code + '\nend tell';
        execFile('osascript', ['-e', script], { timeout: 20000 }, (e, out, err) => {
          if (!e) return resolve();
          const msg = String(err || e.message);
          if (/not allowed|1002|-1719|-1743|assistive|accessibilit|autoris/i.test(msg)) return reject(new Error('ACCES: macOS n\'autorise pas encore Coaching LoL à utiliser le clavier dans le replay.'));
          reject(new Error('Impossible d\'envoyer la touche au replay (' + msg.trim().slice(0, 200) + ').'));
        });
      });
    } else resolve();
  });
}
async function checkScreenPermission() {
  if (process.platform !== 'darwin') return;
  if (systemPreferences.getMediaAccessStatus('screen') === 'granted') return;
  try { await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } }); } catch (e) { /* ouvre la demande de macOS */ }
  throw new Error('ECRAN: macOS n\'autorise pas encore Coaching LoL à enregistrer l\'écran.');
}
async function recordVideos({ playerId, matchId }) {
  if (!isPlayer() || playerId !== session.playerId) throw new Error('Les moments se filment depuis l\'espace du joueur (code joueur), avec le client League of Legends de cet ordinateur.');
  if (sendJob) throw new Error('Attends la fin de l\'envoi.');
  if (videoJob) throw new Error('Un enregistrement est déjà en cours (' + videoJob.status + ').');
  const { moments: m } = await getMoments({ playerId, matchId });
  const picked = replayMod.pickMoments(m);
  if (!picked.length) throw new Error('Rien à filmer dans cette partie.');
  const ins = lolInstall();
  if (!ins) throw new Error('League of Legends est introuvable sur cet ordinateur : indique son emplacement ci-dessous.');
  if (!process.env.COACHING_LOL_TEST && await gameRunning()) throw new Error('Une partie ou un replay est déjà ouvert : ferme-le puis réessaie.');
  await checkScreenPermission();
  // Mac : le choix du joueur dans le replay passe par le clavier (autorisation « Accessibilité »)
  if (process.platform === 'darwin' && !process.env.COACHING_LOL_TEST && !systemPreferences.isTrustedAccessibilityClient(true)) {
    throw new Error('ACCES: macOS n\'autorise pas encore Coaching LoL à utiliser le clavier dans le replay.');
  }
  // Replay API : EnableReplayApi=1 dans game.cfg (lu au lancement du jeu)
  const cfgFile = path.join(path.dirname(ins.config), 'game.cfg');
  let cfg = '';
  try { cfg = fs.readFileSync(cfgFile, 'utf8'); } catch (e) { /* fichier créé ci-dessous */ }
  const en = replayMod.enableReplayApi(cfg);
  if (en.changed) { fs.mkdirSync(path.dirname(cfgFile), { recursive: true }); fs.writeFileSync(cfgFile, en.text); }
  const creds = await lcuCreds();
  if (!creds) throw new Error('Le client League of Legends ne répond pas : ouvre-le (connecté à ton compte) puis réessaie.');
  const dir = path.join(videosDir(), videoKey(playerId, matchId));
  fs.rmSync(dir, { recursive: true, force: true });
  const me = m.participants.find(p => p.id === m.me);
  videoJob = { playerId, matchId, status: 'Préparation…', progress: 0 };
  // journal du dernier tournage (diagnostic à envoyer au coach si ça bloque) : étapes, états du client, caméra
  const journal = path.join(videosDir(), 'journal.txt');
  const note = line => { try { fs.appendFileSync(journal, new Date().toISOString().slice(11, 19) + ' ' + line + '\n'); } catch (e) { /* facultatif */ } };
  try { fs.mkdirSync(videosDir(), { recursive: true }); fs.writeFileSync(journal, 'Coaching LoL ' + app.getVersion() + ' · ' + process.platform + ' · partie ' + matchId + ' · ' + new Date().toISOString() + '\n'); } catch (e) { /* facultatif */ }
  let lastText = '';
  const status = (text, progress) => {
    videoJob.status = text;
    if (typeof progress === 'number') videoJob.progress = progress;
    if (text !== lastText) { note('» ' + text); lastText = text; }
    sendVideo({ playerId, matchId, text, progress: videoJob.progress });
  };
  status('Préparation…', 0.01);
  const gm = ((session && session.source === 'cloud' && remoteData ? remoteData.games : store.data.games) || []).find(x => x.matchId === matchId && x.playerId === playerId);
  (async () => {
    try {
      const r = await replayMod.recordGame({
        lcu: (method, p, body) => localJson(creds.base, method, p, body, creds.password),
        replay: (method, p, body) => localJson(REPLAY_BASE, method, p, body),
        record: (sec, file, onTick) => recordWindow(sec, file, onTick),
        selectPlayer: key => selectPlayerInReplay(key),
        killGame, sleep: ms => new Promise(res => setTimeout(res, ms)), now: Date.now, status,
        log: (what, data) => { try { fs.appendFileSync(journal, new Date().toISOString().slice(11, 19) + ' ' + what + (data === undefined ? '' : ' ' + JSON.stringify(data)) + '\n'); } catch (e) { /* journal facultatif */ } }
      }, {
        gameId: m.gameId, duration: m.duration, gameVersion: m.version || '', queueId: 420, gameEnd: gm && gm.date ? gm.date + m.duration * 1000 : 0, champion: me.champion,
        playerKey: (me.teamId === 200 || (!me.teamId && me.id > 5) ? 'qwert' : '12345')[m.participants.filter(p => p.teamId === me.teamId).sort((a, b) => a.id - b.id).findIndex(p => p.id === me.id)] || null,
        label: champName(me.champion) + (m.opp ? ' contre ' + champName((m.participants.find(p => p.id === m.opp) || {}).champion) : '') + (gm && gm.date ? ' du ' + new Date(gm.date).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(' ', ' à ') : ''), championName: champName(me.champion), gameName: String(me.name || '').split('#')[0], moments: picked,
        file: (i, w) => path.join(dir, String(i + 1).padStart(2, '0') + '_' + Math.floor(w.start / 60) + 'm' + String(w.start % 60).padStart(2, '0') + '.webm')
      }, FAST ? { poll: 250 } : {});
      m.clips = r.clips.map(c => ({ start: c.start, end: c.end, times: c.times, file: path.basename(c.file), bytes: fs.statSync(c.file).size }));
      m.camera = r.camera;
      delete m.pending;
      writeMoments(playerId, m);
      sendVideo({ playerId, matchId, done: true, text: r.clips.length + ' extrait' + (r.clips.length > 1 ? 's' : '') + ' filmé' + (r.clips.length > 1 ? 's' : '') + '.' });
    } catch (e) {
      note('ERREUR ' + e.message);
      sendVideo({ playerId, matchId, error: e.message, journal: true });
    } finally {
      videoJob = null;
    }
  })();
  return { ok: true };
}
function deleteVideos({ playerId, matchId }) {
  if (!isPlayer() || playerId !== session.playerId) throw new Error('Action réservée au joueur.');
  if (videoJob || sendJob) throw new Error('Attends la fin de l\'enregistrement ou de l\'envoi.');
  fs.rmSync(path.join(videosDir(), videoKey(playerId, matchId)), { recursive: true, force: true });
  try {
    const f = momentsFile(playerId, matchId);
    const m = JSON.parse(fs.readFileSync(f, 'utf8'));
    delete m.clips; delete m.camera; delete m.pending;
    fs.writeFileSync(f, JSON.stringify(m));
  } catch (e) { /* pas de moments */ }
  return { ok: true };
}

// Postes des champions (pour mettre les lanes face à face) : table Meraki relue une fois par jour,
// sinon celle livrée avec l'app (src/role-rates.json)
async function refreshRoleRates() {
  const s = store.data.settings;
  if (s.roleRates && Date.now() - (s.roleRates.at || 0) < 24 * 3600 * 1000) return;
  try {
    const r = await fetch('https://cdn.merakianalytics.com/riot/lol/resources/latest/en-US/championrates.json');
    const c = r.ok ? liveMod.compactRates(await r.json()) : null;
    if (c) { s.roleRates = Object.assign(c, { at: Date.now() }); store.save(); }
  } catch (e) { /* on garde la table livrée avec l'app */ }
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

// Une fenêtre de jeu League of Legends est-elle déjà ouverte ?
function gameRunning() {
  return new Promise(resolve => {
    const { execFile } = require('child_process');
    if (process.platform === 'win32') execFile('tasklist', ['/FI', 'IMAGENAME eq League of Legends.exe', '/NH'], (e, out) => resolve(!e && /League of Legends\.exe/i.test(String(out))));
    else execFile('pgrep', ['-x', 'LeagueofLegends'], e => resolve(!e));
  });
}
// Message dans l'app du coach (sans notification système)
function tellCoach(title, body) { if (win && !win.isDestroyed()) win.webContents.send('coach:alert', { title, body }); }

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
  if (process.env.COACHING_LOL_TEST) fs.writeFileSync(path.join(process.env.COACHING_LOL_DATA, 'spectateur.json'), JSON.stringify({ exe: ins.exe, cwd: ins.gameDir, args }));
  if (LOL_OS === 'darwin') { try { fs.chmodSync(ins.exe, 0o755); } catch (e) { /* déjà exécutable */ } }
  // le jeu se ferme souvent au premier lancement : relance automatique (3 essais), jamais deux fenêtres
  await liveMod.launchWatch({
    spawn, exe: ins.exe, args, cwd: ins.gameDir, env: Object.assign({}, process.env, { riot_launched: 'true' }),
    tries: 3, minRunMs: 30000, gapMs: FAST ? 500 : 4000,
    isRunning: gameRunning, stillLive: () => live.games.some(x => String(x.gameId) === String(gameId)),
    onRetry: (n, total) => tellCoach('Mode spectateur', 'Le jeu s\'est fermé tout de suite : nouvelle tentative (' + n + '/' + total + ')…'),
    onGiveUp: () => tellCoach('Mode spectateur', 'Le jeu ne s\'est pas ouvert après 3 essais. Ouvre le client League of Legends une fois (pour qu\'il se mette à jour), puis réessaie.')
  }).catch(e => { throw new Error('Impossible de lancer League of Legends (' + e.message + ').'); });
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
    if (v && (v !== s.ddVersion || !s.champs || !s.champKeys || !s.spellKeys || !s.perkIcons || !s.items)) {
      // noms français des champions (l'API Riot donne « MonkeyKing », « JarvanIV »… : on affiche « Wukong », « Jarvan IV »)
      try {
        const cj = await (await fetch(`https://ddragon.leagueoflegends.com/cdn/${v}/data/fr_FR/champion.json`)).json();
        const champs = {};
        const keys = {};
        for (const c of Object.values(cj.data || {})) { champs[c.id.toLowerCase()] = [c.id, c.name]; keys[c.key] = c.id; }
        if (Object.keys(champs).length) { s.champs = champs; s.champKeys = keys; }
      } catch (e) { /* on garde les noms bruts */ }
      // moments clés : nom et prix des objets (retours à la base)
      try {
        const ij = await (await fetch(`https://ddragon.leagueoflegends.com/cdn/${v}/data/fr_FR/item.json`)).json();
        const it = {};
        for (const [id, x] of Object.entries(ij.data || {})) if (x.gold && x.gold.purchasable) it[id] = [x.name, x.gold.total];
        if (Object.keys(it).length) s.items = it;
      } catch (e) { /* retours sans le détail des achats */ }
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

// Réseau des mises à jour : d'abord la pile de Chromium (proxy, certificats et DNS du système, comme le navigateur),
// sinon celle de Node. La cause précise d'un échec est gardée : « fetch failed » seul n'aide personne.
const netReason = e => { const c = e && e.cause; return String((e && e.message) || 'erreur réseau') + (c && (c.code || c.message) ? ' (' + (c.code || c.message) + ')' : ''); };
async function webFetch(url, opts = {}) {
  try {
    return await net.fetch(url, opts);
  } catch (e1) {
    try { return await fetch(url, opts); } catch (e2) { throw new Error('GitHub injoignable : ' + netReason(e1) + ' / ' + netReason(e2)); }
  }
}
async function checkMacUpdate() {
  if (macUpdate.state === 'ready' || macUpdate.state === 'downloading') return;
  let info;
  try {
    const res = await webFetch(`https://github.com/${REPO}/releases/latest/download/latest-mac.yml`, { headers: { 'User-Agent': 'coaching-lol' } });
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
    macUpdate.newApp = await mu.prepareUpdate({ repo: REPO, info, workDir: macWorkDir(), fetchImpl: webFetch });
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

  handle('player:save', async p => {
    requireEdit();
    const list = store.data.players;
    if ('smurfs' in p) p.smurfs = await resolveSmurfs(p.smurfs, p.region || 'euw', (list.find(x => x.id === p.id) || {}).smurfs || [], p.riotId);
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
    try { for (const f of fs.readdirSync(momentsDir())) if (f.startsWith(String(id).replace(/[^\w-]/g, '') + '_')) fs.unlinkSync(path.join(momentsDir(), f)); } catch (e) { /* pas de moments */ }
    try { for (const f of fs.readdirSync(videosDir())) if (f.startsWith(String(id).replace(/[^\w-]/g, '') + '_')) fs.rmSync(path.join(videosDir(), f), { recursive: true, force: true }); } catch (e) { /* pas de vidéos */ }
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
  handle('moments:get', q => getMoments(q || {}));
  handle('videos:record', q => recordVideos(q || {}));
  handle('videos:delete', q => deleteVideos(q || {}));
  handle('analyses:refresh', async () => { await refreshAnalyses(); return { ok: true, data: viewData() }; });
  handle('analysis:get', q => getAnalysis(q || {}));
  handle('analysis:send', q => sendAnalysis(q || {}));
  handle('analysis:comment', q => commentAnalysis(q || {}));
  handle('analysis:close', q => closeAnalysis(q || {}));
  handle('analysis:delete', q => deleteAnalysis(q || {}));
  handle('analysis:export', q => exportAnalysis(q || {}));
  handle('claude:open', async () => { requireEdit(); fs.mkdirSync(claudeDir(), { recursive: true }); const e = await shell.openPath(claudeDir()); if (e) throw new Error(e); return { ok: true }; });
  handle('claude:dismiss', async q => { requireEdit(); claudeDraftUsed(String((q || {}).id || ''), (q || {}).t === null || (q || {}).t === undefined ? null : Number(q.t)); await syncClaudeFolder(); return { ok: true }; });
  // autorisation « Enregistrement de l'écran » (Mac) : ouvrir le bon panneau des réglages, relancer l'app
  handle('videos:journal', async () => {
    const f = path.join(videosDir(), 'journal.txt');
    if (!fs.existsSync(f)) throw new Error('Pas encore de journal.');
    shell.showItemInFolder(f);
    return { ok: true };
  });
  handle('mac:screen-settings', async q => {
    await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?' + (q && q.panel === 'acces' ? 'Privacy_Accessibility' : 'Privacy_ScreenCapture'));
    return { ok: true };
  });
  handle('app:relaunch', () => {
    try { writeResume(); } catch (e) { /* le code sera redemandé */ }
    setTimeout(() => { app.relaunch(); app.exit(0); }, 200);
    return { ok: true };
  });
  handle('lol:path', q => {
    if (!canEdit() && !isPlayer()) throw new Error('Action impossible ici.');
    store.data.settings.lolPath = String((q && q.path) || '').trim().slice(0, 400);
    store.save();
    lolCache = null;
    return { ok: true, lol: lolInstallView() };
  });

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
    if (ok) session = { role: s.role, playerId: s.playerId, source: 'local', cloudToken: s.cloudToken || undefined };
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
  protocol.handle('clip', req => {
    const u = new URL(req.url);
    const parts = decodeURIComponent(u.pathname).split('/').filter(Boolean);
    if (parts.length !== 2 || !/^[\w-]+$/.test(parts[0]) || !/^[\w-]+\.webm$/.test(parts[1])) return new Response('', { status: 404 });
    if (u.host === 'r') { // vidéo envoyée par un joueur (serveur), avec les demandes de plage pour avancer dans la vidéo
      if (!cloud || !/^[0-9a-f-]{36}$/.test(parts[0])) return new Response('', { status: 404 });
      const range = req.headers.get('range');
      return net.fetch(cloud.clipUrl(parts[0], parts[1]), { headers: range ? { Range: range } : {} });
    }
    return net.fetch(pathToFileURL(path.join(videosDir(), parts[0], parts[1])).toString());
  });
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
        setInterval(refreshAnalyses, 1500);
        setTimeout(pushMoments, 1500);
        setInterval(pushMoments, 4000);
        setInterval(purgeClips, 3000);
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
    setTimeout(refreshAnalyses, FAST ? 800 : 7000);
    setInterval(refreshAnalyses, FAST ? 2000 : 45 * 1000);
    setTimeout(pushMoments, FAST ? 1500 : 60 * 1000);
    setInterval(pushMoments, 30 * 60 * 1000);
    setTimeout(purgeClips, 2 * 60 * 1000);
    setInterval(purgeClips, 3600 * 1000);
    setTimeout(refreshRoleRates, 30 * 1000);
    setInterval(refreshRoleRates, 6 * 3600 * 1000);
  });
  if (process.env.COACHING_LOL_TEST) app.on('coaching-lol:test-resume', writeResume); // tests uniquement
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

// Mac : une mise à jour prête s'installe quand on quitte l'app (comme sur Windows)
app.on('will-quit', () => { if (process.platform === 'darwin' && macUpdate.state === 'ready') installMacUpdate(false); });
// Fermer la fenêtre quitte l'app, sur Mac aussi : c'est ce qui déclenche l'installation des mises à jour
app.on('window-all-closed', () => app.quit());
