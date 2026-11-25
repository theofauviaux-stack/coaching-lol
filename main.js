const { app, BrowserWindow, ipcMain, shell, dialog, safeStorage, powerMonitor, Notification, protocol, net, desktopCapturer, systemPreferences } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Store } = require('./src/store');
const { RiotClient } = require('./src/riot');
const { syncPlayer, gameFromMatch } = require('./src/sync');
const customMod = require('./src/custom');
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
const trendsMod = require('./src/trends');
const Stats = require('./renderer/stats');
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
  const base = { appVersion: app.getVersion(), cloudConfigured: !!cloud, update: updateView() };
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
  d.bilanDrafts = bilansView();
  if (session.role === 'joueur') mergePendingCustoms(d);
  if (session.role === 'joueur' && session.source === 'cloud') mergeMyCourses(d);
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
    await refreshCourses();
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
  coursesState.mine = {};
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
      const seen = new Set(((((remoteData && remoteData.players) || []).find(p => p.id === session.playerId) || {}).bilans || []).map(b => b.id));
      const before = new Set(Object.entries(((((remoteData && remoteData.players) || []).find(p => p.id === session.playerId) || {}).courses) || {}).filter(([, c]) => c && c.assigned).map(([id]) => id));
      remoteData = cloudMod.dataFromCloud(await cloud.getData(session.token), store.data);
      const me = ((remoteData.players || []).find(p => p.id === session.playerId) || {});
      for (const b of me.bilans || []) if (!seen.has(b.id) && session.role === 'joueur') notifyCoach('Nouveau bilan de ton coach', 'Bilan de ' + (b.label || 'ce mois') + ' : il est sur ton tableau de bord.');
      for (const [id, c] of Object.entries(me.courses || {})) if (c && c.assigned && !before.has(id) && session.role === 'joueur') notifyCoach('Nouveau cours de ton coach', '« ' + courseTitle(id) + ' » t\'attend dans Cours.');
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

// ---------------------------------------------------------------- cours : progression des joueurs, cours assignés
// Ordinateur d'un joueur : sa progression (leçons vues, quiz, réponses gardées) part au serveur (course_progress).
// Ordinateur du coach : cette progression est recopiée dans la fiche du joueur (players[].courses), à côté des
// cours que le coach lui assigne ; tout repart chez le joueur avec les données du coach.
const coursesData = require('./renderer/courses');
const coursMod = require('./src/cours-progress');
const coursesState = { mine: {}, loaded: false };
const courseTitle = id => { const c = coursesData.byId(id); return c ? c.t : id; };
async function courseProgress({ playerId, courseId, patch }) {
  if (!session) throw new Error('Session expirée : entre à nouveau ton code.');
  if (!coursMod.validId(String(courseId || '')) || !coursesData.byId(courseId)) throw new Error('Cours inconnu.');
  const raw = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
  if ('assigned' in raw) { // le coach assigne (ou retire) un cours
    requireEdit();
    const p = playerOf(playerId);
    p.courses = p.courses || {};
    const cur = Object.assign({}, p.courses[courseId] || {});
    if (raw.assigned) cur.assigned = Date.now(); else delete cur.assigned;
    p.courses[courseId] = cur;
    return { ok: true, data: changed(1500) };
  }
  if (session.role !== 'joueur' || session.playerId !== playerId) throw new Error('La progression se garde depuis l\'espace du joueur.');
  const clean = coursMod.cleanPatch(raw);
  if (session.source === 'cloud') {
    const next = coursMod.apply(coursesState.mine[courseId], clean);
    const res = await cloud.courseSave(session.token, courseId, coursMod.playerPart(next));
    coursesState.mine[courseId] = Object.assign(next, { updatedAt: res.updatedAt || null });
    return { ok: true, data: viewData() };
  }
  const p = playerOf(playerId); // joueur connecté sur l'ordinateur du coach
  p.courses = p.courses || {};
  p.courses[courseId] = coursMod.apply(p.courses[courseId], clean);
  return { ok: true, data: changed(4000) };
}
// vue du joueur relié au serveur : sa progression récente, réunie avec celle que le coach a renvoyée
function mergeMyCourses(d) {
  const me = (d.players || []).find(p => p.id === session.playerId);
  if (!me) return;
  const all = Object.assign({}, me.courses || {});
  for (const [id, pr] of Object.entries(coursesState.mine)) all[id] = coursMod.combine(all[id], coursMod.playerPart(pr));
  me.courses = all;
}
async function refreshCourses() {
  if (!cloud || !session) return;
  let dirty = false;
  try {
    if (isCoachMachine()) {
      const res = await cloud.coachCourses(getPushToken());
      for (const r of res.courses || []) {
        const p = store.data.players.find(x => x.id === r.playerId);
        if (!p || !coursMod.validId(String(r.courseId || ''))) continue;
        p.courses = p.courses || {};
        const cur = p.courses[r.courseId] || {};
        if (cur.syncedAt === r.updatedAt) continue;
        const next = Object.assign(coursMod.combine(cur, r.data), { syncedAt: r.updatedAt });
        if (coursesState.loaded && !coursMod.passed(cur) && coursMod.passed(next)) notifyCoach('Cours validé', playerName(p.id) + ' a validé « ' + courseTitle(r.courseId) + ' ».');
        p.courses[r.courseId] = next;
        dirty = true;
      }
      coursesState.loaded = true;
      if (dirty) store.save();
    } else if (session.source === 'cloud' && session.role === 'joueur') {
      const res = await cloud.coursesMine(session.token);
      const next = {};
      for (const r of res.courses || []) if (coursMod.validId(String(r.courseId || ''))) next[r.courseId] = Object.assign({}, r.data, { updatedAt: r.updatedAt });
      dirty = JSON.stringify(next) !== JSON.stringify(coursesState.mine);
      coursesState.mine = next;
    }
  } catch (e) { /* serveur injoignable : on réessaie au prochain passage */ }
  if (dirty) refreshView();
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
    setTimeout(() => { try { refreshTrends(); } catch (e) { /* au prochain passage */ } }, 1500);
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
        if (raw && raw.gameQueueConfigId === liveMod.QUEUE_SOLO && !found.has(raw.gameId)) found.set(raw.gameId, { raw, region: a.region });
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
      filming: !!(videoJob && videoJob.matchId === matchId) && (videoJob.cancelled ? 'Annulation…' : videoJob.status), filmingProgress: videoJob ? videoJob.progress : 0, filmingCancelling: !!(videoJob && videoJob.cancelled),
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
      if (!m && !g.custom && getSecret('apiKey') && player.puuid && computed < 10) {
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
    try { refreshTrends(); } catch (e) { /* tendances : au prochain passage */ }
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
  if (me === 'coach') { syncClaudeFolder(); syncBilans(); checkStorage(); refreshFilmReports(); }
  cleanServerClips();
}
function analysesView() {
  const me = analysisRole();
  if (!me) return null;
  const list = analyses.list.filter(a => me === 'coach' || a.playerId === session.playerId).map(a => Object.assign({}, a, { unread: unreadOf(a, me), label: gameLabel(a) }));
  const extra = me === 'coach' && isCoachMachine() ? { storage: { used: storageUsed(), limit: STORAGE_LIMIT }, filmReports: filmReportsView() } : {};
  return Object.assign({ me, list, unread: list.filter(a => a.unread).length, error: analyses.error || (me === 'coach' && analyses.purgeError) || '', loaded: analyses.loaded }, extra);
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
  prefetchServerClips(r.analysis); // vidéos téléchargées sur l'ordinateur pendant qu'on lit
  const cd = me === 'coach' ? readClaudeDrafts()[id] : null;
  return { ok: true, analysis: r.analysis, me, label: gameLabel(r.analysis), playerName: playerName(r.analysis.playerId), claude: cd ? { general: cd.general, moments: cd.moments, used: cd.used || {}, priorities: cd.priorities || [] } : null, goals: me === 'coach' ? goalsOfAnalysis(r.analysis) : [] };
}
// Dessin joint à un message : formes ramenées à des coordonnées 0..1 de l'image, couleurs connues, taille bornée
const DRAW_COLORS = ['#ff5c5c', '#f5d547', '#c3ec7f', '#69c3d8', '#ffffff'];
function cleanDrawing(d) {
  if (!d || typeof d !== 'object') return null;
  const n = v => Math.round(Math.max(0, Math.min(1, Number(v) || 0)) * 1000) / 1000;
  let shapes = (Array.isArray(d.shapes) ? d.shapes : []).slice(0, 20).map(x => {
    const c = DRAW_COLORS.includes(x && x.c) ? x.c : DRAW_COLORS[0];
    if (x && x.k === 'trait') { const pts = (Array.isArray(x.pts) ? x.pts : []).filter(q => Array.isArray(q)).slice(0, 60).map(q => [n(q[0]), n(q[1])]); return pts.length >= 2 ? { k: 'trait', c, pts } : null; }
    if (x && (x.k === 'fleche' || x.k === 'cercle')) { const q = (Array.isArray(x.p) ? x.p : []).slice(0, 4).map(n); return q.length === 4 ? { k: x.k, c, p: q } : null; }
    return null;
  }).filter(Boolean);
  const out = () => ({ file: /^[\w-]+\.webm$/.test(d.file) ? d.file : null, v: Math.round(Math.max(0, Number(d.v) || 0) * 10) / 10, g: Math.round(Math.max(0, Number(d.g) || 0) * 10) / 10,
    w: Math.max(0, Math.round(Number(d.w) || 0)), h: Math.max(0, Math.round(Number(d.h) || 0)), shapes });
  while (shapes.length && JSON.stringify(out()).length > 7500) shapes = shapes.slice(0, -1); // limite du serveur
  return shapes.length ? out() : null;
}
async function commentAnalysis({ id, t, text, drawing }) {
  const me = analysisRole();
  if (!me || !cloud) throw new Error('Analyses indisponibles ici.');
  const msg = String(text || '').trim();
  const dr = cleanDrawing(drawing);
  if (!msg && !dr) throw new Error('Message vide.');
  const tt = t === null || t === undefined || t === '' ? null : Math.round(Number(t));
  const r = me === 'coach' ? await cloud.coachAnalysisComment(getPushToken(), id, tt, msg, dr) : await cloud.analysisComment(playerToken(), id, tt, msg, dr);
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
// ---------------------------------------------------------------- parties personnalisées (scrims)
// Riot ne les donne pas par son API : le joueur les importe depuis l'historique de son client LoL. Elles partent sur
// le serveur (résumé + moments clés) ; l'app du coach les reprend dans ses parties. En attendant, l'app du joueur
// les garde dans « perso-en-attente.json » pour les montrer tout de suite.
const pendingCustomFile = () => path.join(process.env.COACHING_LOL_DATA || app.getPath('userData'), 'perso-en-attente.json');
function readPendingCustoms() {
  try { const a = JSON.parse(fs.readFileSync(pendingCustomFile(), 'utf8')); return Array.isArray(a) ? a : []; } catch (e) { return []; }
}
function writePendingCustoms(a) {
  fs.mkdirSync(path.dirname(pendingCustomFile()), { recursive: true });
  fs.writeFileSync(pendingCustomFile(), JSON.stringify(a));
}
function mergePendingCustoms(d) {
  const pend = readPendingCustoms();
  if (!pend.length) return;
  const left = pend.filter(g => !d.games.some(x => x.matchId === g.matchId && x.playerId === g.playerId));
  for (const g of left) if (g.playerId === session.playerId) d.games.push(Object.assign({}, g, { pending: true }));
  if (left.length !== pend.length) writePendingCustoms(left); // reprise par le coach : elle arrive par le serveur
}
function sessionPlayer() {
  const list = session && session.source === 'cloud' ? (remoteData && remoteData.players) || [] : store.data.players;
  return (list || []).find(p => p.id === (session && session.playerId)) || null;
}
// client LoL du joueur, connecté sur son compte
async function playerLcu() {
  if (!isPlayer()) throw new Error('Réservé à l\'espace joueur.');
  if (!isPlayerOnline()) throw new Error('Connexion au serveur nécessaire : reconnecte-toi avec ton code.');
  const creds = await lcuCreds();
  if (!creds) throw new Error('Ouvre le client League of Legends (connecté à ton compte), puis réessaie.');
  const lcu = p => localJson(creds.base, 'GET', p, undefined, creds.password);
  const me = await lcu('/lol-summoner/v1/current-summoner').catch(() => null);
  if (!me || !me.puuid) throw new Error('Le client League of Legends ne répond pas encore : attends qu\'il soit complètement ouvert, puis réessaie.');
  const pl = sessionPlayer();
  const norm = s => String(s || '').toLowerCase().replace(/\s+/g, '');
  if (pl && pl.riotId && norm(me.gameName + '#' + me.tagLine) !== norm(pl.riotId)) {
    throw new Error(`Ton client LoL est connecté sur ${me.gameName}#${me.tagLine} : connecte-toi avec ${pl.riotId} pour importer tes parties.`);
  }
  return { lcu, me, player: pl || { id: session.playerId } };
}
async function listCustomGames() {
  const { lcu, player } = await playerLcu();
  const resp = await lcu('/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex=49');
  const mine = (session.source === 'cloud' ? (remoteData && remoteData.games) || [] : store.data.games).concat(readPendingCustoms()).filter(g => g.playerId === player.id);
  const games = customMod.listCustoms(resp, store.data.settings.champKeys || {}).map(g => Object.assign(g, { added: mine.some(x => String(x.matchId).endsWith('_' + g.gameId)) }));
  return { ok: true, games };
}
async function addCustomGame({ gameId }) {
  const { lcu, me, player } = await playerLcu();
  const id = String(gameId || '');
  if (!/^\d{5,15}$/.test(id)) throw new Error('Partie inconnue.');
  const game = await lcu('/lol-match-history/v1/games/' + id).catch(() => null);
  if (!game) throw new Error('Le client LoL ne donne pas cette partie (trop ancienne ?).');
  const head = game.info || game;
  if (!customMod.isCustom(head)) throw new Error('Ce n\'est pas une partie personnalisée : les classées arrivent toutes seules.');
  if (head.mapId !== customMod.SR) throw new Error('Seules les parties sur la Faille de l\'invocateur peuvent être ajoutées.');
  const rawTl = await lcu('/lol-match-history/v1/game-timelines/' + id).catch(() => null);
  const { match, tl } = customMod.toV5(game, rawTl, store.data.settings.champKeys || {}, store.data.settings.roleRates || null);
  const meP = match.info.participants.find(p => p.puuid === me.puuid);
  if (!meP) throw new Error('Tu n\'apparais pas dans cette partie.');
  const g = customMod.cleanGame(gameFromMatch(match, tl, meP, player.id));
  if (!g) throw new Error('Partie illisible dans le client LoL.');
  const m = tl ? momentsMod.buildMoments(match, tl, me.puuid, store.data.settings.items || {}) : null;
  if (m) m.custom = true;
  try {
    await cloud.customGameAdd(playerToken(), g.matchId, g, m);
  } catch (e) {
    if (e.code === 'MISSING') throw new Error('Le serveur n\'est pas encore prêt pour les parties perso : préviens ton coach.');
    throw e;
  }
  if (m) writeMoments(player.id, m);
  writePendingCustoms(readPendingCustoms().filter(x => !(x.matchId === g.matchId && x.playerId === g.playerId)).concat([g]));
  refreshView();
  return { ok: true, data: viewData(), matchId: g.matchId, moments: !!m };
}
// ordinateur du coach : reprend les parties envoyées par les joueurs, puis les efface du serveur
let customPulling = false;
async function pullCustomGames() {
  if (!cloud || !isCoachMachine() || customPulling) return;
  const key = getPushToken();
  if (!key) return;
  customPulling = true;
  try {
    const r = await cloud.coachCustomGames(key);
    const done = [], added = [];
    for (const x of r.games || []) {
      const g = customMod.cleanGame(x && x.game);
      if (!g) continue;
      done.push({ playerId: g.playerId, matchId: g.matchId });
      if (!store.data.players.some(p => p.id === g.playerId)) continue;
      if (x.moments && typeof x.moments === 'object' && x.moments.matchId === g.matchId) writeMoments(g.playerId, Object.assign({}, x.moments, { custom: true }));
      if (store.data.games.some(y => y.matchId === g.matchId && y.playerId === g.playerId)) continue;
      store.data.ignored = (store.data.ignored || []).filter(y => !(y.matchId === g.matchId && y.playerId === g.playerId));
      store.data.games.push(g);
      added.push(g);
    }
    if (added.length) {
      store.save();
      schedulePush(1500);
      for (const g of added) notifyCoach('Partie personnalisée ajoutée', playerName(g.playerId) + ' : ' + champName(g.champion) + (g.opponent ? ' contre ' + champName(g.opponent) : '') + ' (' + (g.win ? 'victoire' : 'défaite') + ')');
      if (session) refreshView();
    }
    if (done.length) await cloud.coachCustomGamesDone(key, done);
  } catch (e) {
    /* serveur pas encore à jour ou injoignable : nouvel essai au prochain passage */
  } finally {
    customPulling = false;
  }
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
    const kept = path.join(serverClipsDir(), full.id, c.file);
    if (fs.existsSync(local) && fs.statSync(local).size > 0) { ensureSeekableFile(local); fs.copyFileSync(local, out); } else if (fs.existsSync(kept)) fs.copyFileSync(kept, out);
    else {
      const res = await fetch(cloud.clipUrl(full.id, c.file));
      if (!res.ok) throw new Error('vidéo ' + c.file + ' introuvable (' + res.status + ')');
      fs.writeFileSync(out, seekableBuffer(Buffer.from(await res.arrayBuffer())));
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
    { const f = path.join(base, 'LISEZ-MOI.txt'); let cur = null; try { cur = fs.readFileSync(f, 'utf8'); } catch (e) { /* absent */ } if (cur !== claudeMod.README) fs.writeFileSync(f, claudeMod.README); } // tenu à jour par l'app
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

// ---------------------------------------------------------------- objectifs de travail (priorités suivies)
// player.goals : [{ id, text, kpi, target, since, status, source: 'analyse'|'bilan'|'coach', analysisId, createdAt }]
// Envoyés au serveur avec le joueur : il les voit (et leur suivi) sur son tableau de bord.
function cleanGoal(g, base) {
  const text = String((g && g.text) || '').trim().slice(0, 300);
  if (!text) throw new Error('Objectif vide.');
  const kpi = g.kpi && Stats.GOAL_KPIS.includes(g.kpi) ? g.kpi : null;
  const n = g.target === '' || g.target === null || g.target === undefined ? null : Number(String(g.target).replace(',', '.'));
  return Object.assign({}, base, { text, kpi, target: kpi && Number.isFinite(n) ? n : null });
}
function playerOf(playerId) {
  const p = store.data.players.find(x => x.id === playerId);
  if (!p) throw new Error('Joueur introuvable.');
  return p;
}
function addGoals({ playerId, goals, source, analysisId }) {
  requireEdit();
  const p = playerOf(playerId);
  const now = Date.now();
  const list = (Array.isArray(goals) ? goals : []).filter(g => g && String(g.text || '').trim()).map(g => cleanGoal(g, {
    id: crypto.randomUUID(), since: now, status: 'actif', source: ['analyse', 'bilan'].includes(source) ? source : 'coach', analysisId: analysisId || null, createdAt: now }));
  if (!list.length) throw new Error('Écris au moins un objectif.');
  const active = (p.goals || []).filter(g => g.status === 'actif').length;
  if (active + list.length > 8) throw new Error('8 objectifs actifs au plus : marque d\'abord des objectifs comme atteints ou abandonnés.');
  p.goals = (p.goals || []).concat(list);
  return { ok: true, added: list.length, data: changed(1500) };
}
function updateGoal({ playerId, id, patch }) {
  requireEdit();
  const p = playerOf(playerId);
  const i = (p.goals || []).findIndex(g => g.id === id);
  if (i < 0) throw new Error('Objectif introuvable.');
  const g = p.goals[i];
  const q = patch || {};
  let next = g;
  if ('text' in q || 'kpi' in q || 'target' in q) next = cleanGoal(Object.assign({}, g, q), g);
  if (q.status && ['actif', 'atteint', 'abandonne'].includes(q.status)) next = Object.assign({}, next, { status: q.status, doneAt: q.status === 'actif' ? null : Date.now() });
  p.goals[i] = next;
  return { ok: true, data: changed(1500) };
}
function deleteGoal({ playerId, id }) {
  requireEdit();
  const p = playerOf(playerId);
  p.goals = (p.goals || []).filter(g => g.id !== id);
  return { ok: true, data: changed(1500) };
}
function goalsOfAnalysis(a) {
  const p = a && store.data.players.find(x => x.id === a.playerId);
  return p ? (p.goals || []).filter(g => g.analysisId === a.id) : [];
}

// ---------------------------------------------------------------- erreurs récurrentes (ordinateur du coach)
// Calculées à partir des moments clés des 20 dernières parties au rôle ; envoyées au serveur avec le joueur.
function refreshTrends() {
  if (!isCoachMachine()) return false;
  let dirty = false;
  const strip = t => (t ? JSON.stringify(Object.assign({}, t, { at: 0 })) : null);
  for (const p of store.data.players) {
    const gs = store.data.games.filter(g => g.playerId === p.id && g.role === p.role && !g.custom).sort((a, b) => b.date - a.date);
    const entries = [];
    for (const g of gs) {
      if (entries.length >= 20) break;
      const m = readMoments(p.id, g.matchId);
      if (m) entries.push({ matchId: g.matchId, date: g.date, m });
    }
    const tr = trendsMod.compute(entries);
    if (strip(tr) === strip(p.trends)) continue;
    if (tr) p.trends = tr; else delete p.trends;
    dirty = true;
  }
  if (dirty) { changed(5000); if (session) refreshView(); }
  return dirty;
}

// ---------------------------------------------------------------- bilan du mois (préparé pour Claude)
const bilansFile = () => path.join(process.env.COACHING_LOL_DATA || app.getPath('userData'), 'claude-bilans.json');
function readBilans() { try { return JSON.parse(fs.readFileSync(bilansFile(), 'utf8')) || {}; } catch (e) { return {}; } }
function writeBilans(b) { fs.writeFileSync(bilansFile() + '.tmp', JSON.stringify(b)); fs.renameSync(bilansFile() + '.tmp', bilansFile()); }
const monthKey = (t = Date.now()) => new Date(t).toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit' }).slice(0, 7);
const monthLabel = k => { const [y, m] = k.split('-').map(Number); return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' }); };
function prepareBilan({ playerId }) {
  requireEdit();
  if (!isCoachMachine()) throw new Error('Le bilan se prépare sur l\'ordinateur du coach.');
  const p = playerOf(playerId);
  const now = Date.now(), from = now - 30 * 86400e3, month = monthKey(now);
  const gs = store.data.games.filter(g => g.playerId === p.id && g.role === p.role && !g.custom && g.date >= from).sort((a, b) => a.date - b.date);
  if (gs.length < 3) throw new Error('Pas assez de parties ce mois-ci (3 au moins) pour un bilan.');
  const base = path.join(claudeDir(), claudeMod.BILAN_DIR);
  const name = claudeMod.bilanFolderName(p.id, month, String(p.riotId || '').split('#')[0]);
  const dir = path.join(base, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.rmSync(path.join(dir, claudeMod.BILAN_RESULT), { force: true }); // nouveau bilan : l'ancienne réponse ne vaut plus
  const kpis = Stats.kpiTable(store.data, p, '', gs).filter(r => r.label !== 'Parties jouées').map(r => ({
    indicateur: r.label, valeur: r.value === null ? null : Stats.fmt(r.value, r.format), objectif: r.obj.value === null ? null : r.obj.sens + ' ' + Stats.fmt(r.obj.value, r.format),
    atteint: r.ok, dixDernieres: r.v10 === null ? null : Stats.fmt(r.v10, r.format), tendance: r.trend === 1 ? 'mieux' : r.trend === -1 ? 'moins bien' : r.trend === 0 ? 'stable' : null }));
  const entries = gs.slice().reverse().map(g => ({ matchId: g.matchId, date: g.date, m: readMoments(p.id, g.matchId) })).filter(e => e.m);
  const tr = trendsMod.compute(entries, { limit: 40 });
  const goals = (p.goals || []).map(g => { const pr = Stats.goalProgress(store.data, p, g); return {
    texte: g.text, indicateur: g.kpi, cible: g.target, depuis: new Date(g.since).toISOString().slice(0, 10), statut: g.status,
    suivi: { parties: pr.games, avant: pr.before === undefined || pr.before === null ? null : Stats.fmt(pr.before, pr.format), maintenant: pr.now === undefined || pr.now === null ? null : Stats.fmt(pr.now, pr.format),
      reussite: pr.rate === undefined || pr.rate === null ? null : Math.round(pr.rate * 100) + ' %', etat: pr.state } }; });
  const ans = analyses.list.filter(a => a.playerId === p.id && new Date(a.createdAt).getTime() >= from).map(a => ({
    partie: gameLabel(a), envoyeeLe: a.createdAt, statut: a.status, noteDuJoueur: a.note || '',
    messagesDuCoach: (a.comments || []).filter(c => c.author === 'coach').map(c => (c.t === null ? '' : momentsMod.mmss(c.t) + ' : ') + c.text).slice(0, 20) }));
  const sess = store.data.sessions.filter(x => x.playerId === p.id && new Date(x.date).getTime() >= from).map(x => {
    const r = Stats.sessionResult(store.data, x, p);
    const cut = v => String(v || '').slice(0, 600);
    return { date: x.date, axe: x.axis || '', indicateur: x.kpi || null, cible: x.target || null, avant: r.before, apres: r.after,
      constats: cut(x.findings), points: cut(x.points), devoirs: cut(x.homework), suite: cut(x.next) };
  });
  const parties = gs.map(g => ({ date: new Date(g.date).toISOString().slice(0, 10), champion: champName(g.champion), contre: g.opponent ? champName(g.opponent) : null, resultat: g.win ? 'victoire' : 'défaite',
    kda: g.kills + '/' + g.deaths + '/' + g.assists, csA10: g.cs10, ecartOrA15: g.goldDiff15, mortsAvant15: g.deaths15, vision: g.vision, lp: g.lpDelta }));
  const man = {
    version: 1, type: 'bilan', bilanId: claudeMod.bilanId(p.id, month), mois: monthLabel(month), joueur: p.riotId, role: p.role,
    periode: { du: new Date(from).toISOString().slice(0, 10), au: new Date(now).toISOString().slice(0, 10) }, rangActuel: (lastRankOf(p) || {}).label || null,
    indicateurs: kpis, erreursRecurrentes: tr ? { phrases: tr.sentences, zones: tr.zones, minutes: tr.windows, circonstances: tr.tags, objectifsPerdus: tr.objectives, mortsParPartie: Math.round(tr.perGame * 10) / 10 } : null,
    objectifsDeTravail: goals, analysesDuMois: ans, seancesDuMois: sess, parties,
    aRendre: {
      fichier: claudeMod.BILAN_RESULT,
      format: { bilanId: claudeMod.bilanId(p.id, month), general: 'Bilan du mois pour le joueur, en le tutoyant (moins de 1500 caractères).', pointsForts: ['2 ou 3 points forts, chiffrés'],
        axes: ['2 ou 3 axes de travail, concrets'], objectifs: [{ texte: 'Objectif pour le mois prochain', indicateur: 'un de « indicateurs » (ou null)', cible: 'nombre (ou null)' }] },
      indicateurs: Stats.GOAL_KPIS
    }
  };
  fs.writeFileSync(path.join(dir, claudeMod.MANIFEST), JSON.stringify(man, null, 1));
  const txt = ['BILAN DU MOIS (Coaching LoL) — ' + p.riotId + ' — ' + monthLabel(month), '', 'Erreurs récurrentes :', trendsMod.toText(tr), ''];
  for (const e of entries.slice(0, 10)) txt.push(momentsMod.toText(e.m, { player: p.riotId, champName }), '');
  fs.writeFileSync(path.join(dir, 'parties.txt'), txt.join('\n'));
  const all = readBilans();
  all[p.id] = { bilanId: man.bilanId, month, folder: path.join(claudeMod.BILAN_DIR, name), at: now };
  writeBilans(all);
  refreshView();
  return { ok: true, folder: dir, data: viewData() };
}
function lastRankOf(p) { const r = store.data.ranks.filter(x => x.playerId === p.id).sort((a, b) => a.date - b.date); return r[r.length - 1] || null; }
// réponses de Claude (bilan-claude.json) → brouillons
function syncBilans() {
  if (!isCoachMachine() || !canEdit()) return;
  const all = readBilans();
  let dirty = false;
  for (const [pid, b] of Object.entries(all)) {
    const p = store.data.players.find(x => x.id === pid);
    if (!p) { delete all[pid]; dirty = true; continue; }
    const dir = path.join(claudeDir(), b.folder || '');
    const rf = path.join(dir, claudeMod.BILAN_RESULT);
    if (!fs.existsSync(rf)) { if (b.draft || b.error) { delete b.draft; delete b.error; delete b.mtime; dirty = true; } continue; }
    const mtime = fs.statSync(rf).mtimeMs;
    if (b.mtime === mtime) continue;
    let r;
    try { r = claudeMod.parseBilan(JSON.parse(fs.readFileSync(rf, 'utf8')), JSON.parse(fs.readFileSync(path.join(dir, claudeMod.MANIFEST), 'utf8'))); } catch (e) { r = { ok: false, errors: ['Fichier illisible : ' + e.message] }; }
    b.mtime = mtime;
    if (r.ok) { b.draft = r.draft; delete b.error; notifyCoach('Bilan de Claude prêt', p.riotId + ' : relis-le sur son tableau de bord, puis envoie-le.'); } else { b.error = r.errors.join(' '); delete b.draft; }
    dirty = true;
  }
  if (dirty) { writeBilans(all); if (session) refreshView(); }
}
function bilansView() {
  if (!isCoachMachine() || !canEdit()) return null;
  const out = {};
  for (const [pid, b] of Object.entries(readBilans())) out[pid] = { month: b.month, monthLabel: monthLabel(b.month), state: b.draft ? 'pret' : b.error ? 'erreur' : 'attente', draft: b.draft || null, error: b.error || '', text: b.draft ? claudeMod.bilanText(b.draft) : '' };
  return out;
}
function sendBilan({ playerId, text, goals }) {
  requireEdit();
  const p = playerOf(playerId);
  const body = String(text || '').trim().slice(0, 4000);
  if (!body) throw new Error('Le bilan est vide.');
  const all = readBilans();
  const month = (all[p.id] && all[p.id].month) || monthKey();
  const list = (Array.isArray(goals) ? goals : []).filter(g => g && String(g.text || '').trim());
  if (list.length) addGoals({ playerId, goals: list, source: 'bilan' });
  p.bilans = [{ id: crypto.randomUUID(), month, label: monthLabel(month), text: body, at: Date.now() }].concat(p.bilans || []).slice(0, 12);
  delete all[p.id];
  writeBilans(all);
  return { ok: true, data: changed(1000) };
}
function dismissBilan({ playerId }) { requireEdit(); const all = readBilans(); delete all[playerId]; writeBilans(all); return { ok: true, data: viewData() }; }
function deleteBilan({ playerId, id }) { requireEdit(); const p = playerOf(playerId); p.bilans = (p.bilans || []).filter(b => b.id !== id); return { ok: true, data: changed(1000) }; }

// ---------------------------------------------------------------- journaux des tournages en échec (coach)
const filmReports = { list: [], loaded: false };
async function refreshFilmReports() {
  if (!cloud || !isCoachMachine()) return;
  try {
    const list = (await cloud.coachFilmReports(getPushToken())).reports || [];
    if (filmReports.loaded) for (const r of list) if (!filmReports.list.some(x => x.id === r.id)) notifyCoach('Tournage en échec — ' + playerName(r.playerId), excerpt(r.error));
    const before = JSON.stringify(filmReports.list.map(x => x.id));
    Object.assign(filmReports, { list, loaded: true });
    if (session && JSON.stringify(list.map(x => x.id)) !== before) refreshView();
  } catch (e) { /* serveur pas encore à jour (journaux.sql) : rien à montrer */ }
}
async function filmReportsDone({ ids }) {
  requireEdit();
  const list = (Array.isArray(ids) ? ids : [ids]).map(Number).filter(Number.isFinite);
  await cloud.coachFilmReportsDone(getPushToken(), list);
  filmReports.list = filmReports.list.filter(r => !list.includes(Number(r.id)));
  refreshView();
  return { ok: true };
}
function filmReportsView() {
  if (!filmReports.loaded) return [];
  return filmReports.list.map(r => {
    const g = store.data.games.find(x => x.matchId === r.matchId && x.playerId === r.playerId);
    return Object.assign({}, r, { playerName: playerName(r.playerId), label: g ? champName(g.champion) + (g.opponent ? ' contre ' + champName(g.opponent) : '') : r.matchId });
  });
}
// place des vidéos sur le serveur (900 Mo sur le plan gratuit) ; alerte à 80 %
const STORAGE_LIMIT = 900 * 1048576;
function storageUsed() { return analyses.list.filter(a => ['envoi', 'en_ligne', 'a_effacer'].includes(a.clipsState)).reduce((n, a) => n + (Number(a.bytes) || 0), 0); }
function checkStorage() {
  const used = storageUsed(), s = store.data.settings;
  if (used >= 0.8 * STORAGE_LIMIT && !s.storageAlerted) {
    s.storageAlerted = Date.now();
    store.save();
    notifyCoach('Stockage des vidéos presque plein', Math.round(used / 1048576) + ' Mo sur 900 Mo : termine des analyses (le joueur les exporte) ou supprimes-en, sinon les prochains envois seront refusés.');
  } else if (used < 0.7 * STORAGE_LIMIT && s.storageAlerted) { delete s.storageAlerted; store.save(); }
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
      const kept = path.join(serverClipsDir(), id, f);
      if (fs.existsSync(local) && fs.statSync(local).size > 0) { ensureSeekableFile(local); fs.copyFileSync(local, out); } else if (fs.existsSync(kept)) fs.copyFileSync(kept, out);
      else {
        const res = await fetch(cloud.clipUrl(id, f));
        if (!res.ok) throw new Error('La vidéo ' + f + ' est introuvable sur le serveur (' + res.status + ') : rien n\'a été supprimé.');
        fs.writeFileSync(out, seekableBuffer(Buffer.from(await res.arrayBuffer())));
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
    ensureSeekableFile(path.join(dir, c.file));
    try { bytes = fs.statSync(path.join(dir, c.file)).size; } catch (e) { /* vidéo supprimée */ }
    if (!bytes) throw new Error('Vidéo introuvable : refilme les moments.');
    return Object.assign({ file: c.file, start: c.start, end: c.end, times: c.times, bytes }, typeof c.lead === 'number' ? { lead: c.lead } : {}, Array.isArray(c.sync) ? { sync: c.sync.slice(0, 40) } : {});
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
// Vidéos navigables (durée + index, voir src/webm.js) : l'enregistreur du navigateur n'en écrit pas ; sans elles la
// barre de lecture ne marche pas et chaque saut dans une vidéo du serveur oblige à tout télécharger depuis le début.
const webmMod = require('./src/webm');
const seekableBuffer = buf => (webmMod.isSeekable(buf.subarray(0, 16384)) ? buf : webmMod.makeSeekable(buf) || buf);
const seekableChecked = new Set();
function ensureSeekableFile(f) { // vidéos filmées avant la 1.6.16 : réparées sur place, une fois
  if (seekableChecked.has(f)) return;
  try {
    const fd = fs.openSync(f, 'r');
    const head = Buffer.alloc(16384);
    const n = fs.readSync(fd, head, 0, head.length, 0);
    fs.closeSync(fd);
    if (!webmMod.isSeekable(head.subarray(0, n))) {
      const fixed = webmMod.makeSeekable(fs.readFileSync(f));
      if (fixed) { fs.writeFileSync(f + '.tmp', fixed); fs.renameSync(f + '.tmp', f); }
    }
    seekableChecked.add(f);
  } catch (e) { /* laissée telle quelle */ }
}
// Réponse vidéo depuis un fichier, avec les demandes de plage (pour avancer dans la vidéo)
function fileResponse(f, range) {
  const { Readable } = require('stream');
  const size = fs.statSync(f).size;
  const m = range && /bytes=(\d*)-(\d*)/.exec(range);
  const headers = { 'Content-Type': 'video/webm', 'Accept-Ranges': 'bytes' };
  if (m && (m[1] || m[2])) {
    const s0 = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
    const e0 = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (s0 >= size || s0 > e0) return new Response('', { status: 416, headers: { 'Content-Range': 'bytes */' + size } });
    return new Response(Readable.toWeb(fs.createReadStream(f, { start: s0, end: e0 })), { status: 206, headers: Object.assign(headers, { 'Content-Range': `bytes ${s0}-${e0}/${size}`, 'Content-Length': String(e0 - s0 + 1) }) });
  }
  return new Response(Readable.toWeb(fs.createReadStream(f)), { status: 200, headers: Object.assign(headers, { 'Content-Length': String(size) }) });
}
// Vidéos du serveur : téléchargées en entier sur cet ordinateur dès l'ouverture de l'analyse (une seconde par vidéo
// avec une connexion normale), réparées si besoin (envoyées avant la 1.6.16), puis lues depuis le disque et gardées
// tant que l'analyse existe. Les lire en flux à travers l'app (clip:// → serveur) pouvait se bloquer sur Mac :
// données au compte-gouttes, vidéo figée au bout de quelques secondes. Connexion lente : lecture directe en attendant.
const serverClipsDir = () => path.join(process.env.COACHING_LOL_DATA || app.getPath('userData'), 'videos-serveur');
const caching = new Map();
function cacheServerClip(id, file) {
  const f = path.join(serverClipsDir(), id, file);
  if (fs.existsSync(f)) return Promise.resolve(f);
  const key = id + '/' + file;
  if (!caching.has(key)) {
    caching.set(key, (async () => {
      const res = await net.fetch(cloud.clipUrl(id, file));
      if (!res.ok) throw new Error('vidéo ' + file + ' introuvable (' + res.status + ')');
      const buf = seekableBuffer(Buffer.from(await res.arrayBuffer()));
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f + '.tmp', buf);
      fs.renameSync(f + '.tmp', f);
      return f;
    })().finally(() => caching.delete(key)));
  }
  return caching.get(key);
}
const CLIP_WAIT_MS = 10000; // au-delà, on lit en flux pendant que le téléchargement continue
async function serverClip(id, file, range) {
  const f = path.join(serverClipsDir(), id, file);
  if (fs.existsSync(f)) return fileResponse(f, range);
  try {
    const got = await Promise.race([cacheServerClip(id, file), new Promise(r => setTimeout(() => r(null), CLIP_WAIT_MS))]);
    if (got) return fileResponse(got, range);
  } catch (e) { /* téléchargement impossible : lecture directe ci-dessous */ }
  return net.fetch(cloud.clipUrl(id, file), { headers: range ? { Range: range } : {} });
}
// analyse ouverte : toutes ses vidéos sont téléchargées d'avance, en arrière-plan, la première d'abord
function prefetchServerClips(a) {
  if (!cloud || !a || a.clipsState !== 'en_ligne') return;
  (async () => {
    for (const c of a.clips || []) {
      if (!/^[\w-]+\.webm$/.test(c.file)) continue;
      try { await cacheServerClip(a.id, c.file); } catch (e) { /* réessayé à la lecture */ }
    }
  })();
}
function cleanServerClips() { // vidéos gardées des analyses qui n'existent plus
  try {
    if (!analyses.loaded) return;
    const ids = new Set(analyses.list.map(a => a.id));
    for (const d of fs.readdirSync(serverClipsDir())) if (!ids.has(d)) fs.rmSync(path.join(serverClipsDir(), d), { recursive: true, force: true });
  } catch (e) { /* pas encore de dossier */ }
}
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
function dropRecorder() { try { if (recWin && !recWin.isDestroyed()) recWin.destroy(); } catch (e) { /* déjà fermée */ } recWin = null; }
// Qualité des vidéos : 1600 × 900 au plus (texte du jeu lisible), 30 images/s, VP9 à 2,2 Mbit/s
// (≈ 12 Mo pour un extrait de 45 s, 25 Mo pour 90 s : sous la limite de 30 Mo du stockage).
const REC = { w: 1600, h: 900, fps: 30, bps: 2200000 };
const recordings = new Map(); // id → suivi d'un enregistrement (messages de la fenêtre cachée)
ipcMain.on('rec:event', (e, ev) => { const r = ev && recordings.get(ev.id); if (r) r.onEvent(ev); });
ipcMain.on('rec:done', (e, ev) => { const r = ev && recordings.get(ev.id); if (r) r.onDone(ev); });
// Démarre la capture du jeu ; la promesse est tenue quand la capture tourne vraiment (image reçue, enregistreur lancé).
async function startRecording(file, { source = 'fenetre', log = () => {} } = {}) {
  const sources = await desktopCapturer.getSources({ types: ['window', 'screen'], thumbnailSize: { width: 0, height: 0 } });
  const game = process.env.COACHING_LOL_TEST ? null : sources.find(x => x.id.startsWith('window') && /League of Legends \(TM\)/i.test(x.name));
  const screen = sources.find(x => x.id.startsWith('screen'));
  const src = source === 'ecran' ? screen : (game || screen);
  if (!src) throw new Error('Aucune fenêtre à filmer.');
  if (source !== 'ecran' && !game && !process.env.COACHING_LOL_TEST) log('fenêtre du jeu introuvable, écran entier filmé', sources.filter(x => x.id.startsWith('window')).map(x => x.name).slice(0, 15));
  const rw = await recorderWindow();
  const id = crypto.randomUUID();
  const st = { n: 0, blackRun: 0, seenLight: false, frozenRun: 0, frozenMax: 0, changed: false, meanSum: 0, bytes: 0, info: null };
  let onStarted, onFinished;
  const started = new Promise((res, rej) => { onStarted = { res, rej }; });
  const finished = new Promise((res, rej) => { onFinished = { res, rej }; });
  finished.catch(() => {});
  recordings.set(id, {
    onEvent(ev) {
      if (ev.type === 'started') { st.info = { source: game && source !== 'ecran' ? 'fenêtre du jeu' : 'écran', largeur: ev.width, hauteur: ev.height, images: ev.frameRate, format: ev.mime, debit: ev.bps }; onStarted.res(); }
      if (ev.type === 'health') {
        st.bytes = ev.bytes || st.bytes;
        if (typeof ev.max !== 'number') return; // image pas encore lisible
        st.n++;
        st.meanSum += ev.mean;
        if (ev.max < 16) st.blackRun++; else { st.blackRun = 0; st.seenLight = true; }
        if (typeof ev.diff === 'number') {
          if (ev.diff > 2) { st.changed = true; st.frozenRun = 0; } else { st.frozenRun++; st.frozenMax = Math.max(st.frozenMax, st.frozenRun); }
        }
      }
    },
    onDone(ev) {
      recordings.delete(id);
      if (ev.error) { const err = new Error('Enregistrement impossible : ' + ev.error); onStarted.rej(err); onFinished.rej(err); } else { onStarted.res(); onFinished.res(ev); }
    }
  });
  rw.webContents.send('rec:start', Object.assign({ id, sourceId: src.id }, REC));
  const timeout = (p, ms, msg) => Promise.race([p, new Promise((res, rej) => setTimeout(() => rej(new Error(msg)), ms))]);
  try {
    await timeout(started, 20000, 'L\'enregistreur ne démarre pas (capture de l\'écran refusée ou bloquée).');
  } catch (e) {
    recordings.delete(id);
    dropRecorder();
    throw e;
  }
  const stop = async discard => {
    if (!recWin || recWin.isDestroyed()) throw new Error('L\'enregistreur a été fermé.');
    recWin.webContents.send('rec:stop', { id, discard: !!discard });
    try { return await timeout(finished, 20000, 'L\'enregistreur ne répond plus.'); } catch (e) { recordings.delete(id); dropRecorder(); throw e; }
  };
  return {
    source: game && source !== 'ecran' ? 'fenetre' : 'ecran',
    info: () => st.info,
    // noire : aucune image claire depuis le début (2 s) ; figée : aucune différence entre les images depuis frozenSec
    // (seulement si l'analyse de l'image a déjà vu bouger quelque chose : « live »)
    health: () => ({ samples: st.n, black: !st.seenLight && st.blackRun >= 4, frozenSec: st.frozenRun / 2, frozenMaxSec: st.frozenMax / 2, live: st.changed, mean: st.n ? Math.round(st.meanSum / st.n) : null, bytes: st.bytes }),
    async stop() {
      const r = await stop(false);
      if (!r || r.cancelled || !r.data) throw new Error('Enregistrement vide.');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const raw = Buffer.from(r.data);
      const out = webmMod.makeSeekable(raw) || raw; // durée + index : barre de lecture et sauts rapides
      fs.writeFileSync(file, out);
      seekableChecked.add(file);
      return { bytes: out.length, info: st.info, seekable: out !== raw };
    },
    cancel: () => stop(true).catch(() => null)
  };
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
// Replay laissé ouvert (tournage interrompu, app fermée…) : le client LoL le signale par la phase « WatchInProgress ».
// On ne ferme jamais une vraie partie (phase « InProgress »).
async function closeLeftoverReplay(creds) {
  if (process.env.COACHING_LOL_TEST || !await gameRunning()) return;
  const phase = creds ? await localJson(creds.base, 'GET', '/lol-gameflow/v1/gameflow-phase', undefined, creds.password).catch(() => null) : null;
  if (phase !== 'WatchInProgress') throw new Error('Une partie ou un replay est déjà ouvert : ferme-le puis réessaie.');
  await killGame();
  if (!await gameGone(10000)) throw new Error('Un replay est déjà ouvert et ne se ferme pas : ferme-le puis réessaie.');
}
async function gameGone(ms) {
  if (process.env.COACHING_LOL_TEST) return true;
  for (const t0 = Date.now(); Date.now() - t0 < ms; await new Promise(r => setTimeout(r, 500))) if (!await gameRunning()) return true;
  return false;
}
// Réglages de jeu du joueur (ceux du client LoL, synchronisés avec son compte) : photographiés avant le tournage, remis
// à l'identique après si le replay en a changé (interface, etc.). On ne renvoie que les parties qui ont changé.
async function readGameSettings(creds) {
  const s = await localJson(creds.base, 'GET', '/lol-game-settings/v1/game-settings', undefined, creds.password);
  return s && typeof s === 'object' && !Array.isArray(s) && Object.keys(s).length ? s : null;
}
function settingsDiff(before, after) {
  const out = {};
  for (const k of Object.keys(before)) {
    if (JSON.stringify(before[k]) === JSON.stringify(after ? after[k] : undefined)) continue;
    const b = before[k], a = (after && after[k]) || {};
    out[k] = b && typeof b === 'object' ? Object.keys(Object.assign({}, b, a)).filter(x => JSON.stringify(b[x]) !== JSON.stringify(a[x])) : [];
  }
  return out;
}
async function restoreGameSettings(creds, before, note) {
  if (!before) return null;
  const after = await readGameSettings(creds).catch(() => null);
  if (!after) { note('réglages du joueur', 'illisibles après le tournage'); return null; }
  const diff = settingsDiff(before, after);
  if (!Object.keys(diff).length) { note('réglages du joueur', 'inchangés'); return diff; }
  const patch = {};
  for (const k of Object.keys(diff)) patch[k] = before[k];
  await localJson(creds.base, 'PATCH', '/lol-game-settings/v1/game-settings', patch, creds.password);
  await localJson(creds.base, 'POST', '/lol-game-settings/v1/save', {}, creds.password).catch(() => null);
  const check = await readGameSettings(creds).catch(() => null);
  const left = check ? settingsDiff(before, check) : null;
  note('réglages du joueur remis comme avant', { changes: diff, restent: left && Object.keys(left).length ? left : null });
  return diff;
}
async function recordVideos({ playerId, matchId }) {
  if (!isPlayer() || playerId !== session.playerId) throw new Error('Les moments se filment depuis l\'espace du joueur (code joueur), avec le client League of Legends de cet ordinateur.');
  if (sendJob) throw new Error('Attends la fin de l\'envoi.');
  if (videoJob) throw new Error(videoJob.cancelled ? 'Annulation en cours : réessaie dans quelques secondes.' : 'Un enregistrement est déjà en cours (' + videoJob.status + ').');
  const { moments: m } = await getMoments({ playerId, matchId });
  const picked = replayMod.pickMoments(m);
  if (!picked.length) throw new Error('Rien à filmer dans cette partie.');
  const ins = lolInstall();
  if (!ins) throw new Error('League of Legends est introuvable sur cet ordinateur : indique son emplacement ci-dessous.');
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
  await closeLeftoverReplay(creds);
  // les nouvelles vidéos sont filmées à côté des anciennes, qui ne sont remplacées qu'à la fin (annulation ou erreur :
  // on garde les anciennes)
  const dir = path.join(videosDir(), videoKey(playerId, matchId));
  const tmp = dir + '.nouveau';
  fs.rmSync(tmp, { recursive: true, force: true });
  const me = m.participants.find(p => p.id === m.me);
  const job = { playerId, matchId, status: 'Préparation…', progress: 0, cancelled: false, wake: new Set() };
  videoJob = job;
  // journal du dernier tournage (diagnostic à envoyer au coach si ça bloque) : étapes, états du client, caméra, image
  const journal = path.join(videosDir(), 'journal.txt');
  const write = line => { try { fs.appendFileSync(journal, new Date().toISOString().slice(11, 19) + ' ' + line + '\n'); } catch (e) { /* facultatif */ } };
  const note = (what, data) => write(what + (data === undefined ? '' : ' ' + JSON.stringify(data)));
  try { fs.mkdirSync(videosDir(), { recursive: true }); fs.writeFileSync(journal, 'Coaching LoL ' + app.getVersion() + ' · ' + process.platform + ' ' + require('os').release() + ' · partie ' + matchId + ' · ' + new Date().toISOString() + '\n'); } catch (e) { /* facultatif */ }
  note('vidéo', REC);
  let lastText = '';
  const status = (text, progress) => {
    if (job.cancelled) return;
    job.status = text;
    if (typeof progress === 'number') job.progress = progress;
    if (text !== lastText) { write('» ' + text); lastText = text; }
    sendVideo({ playerId, matchId, text, progress: job.progress });
  };
  status('Préparation…', 0.01);
  // annulation : chaque appel vérifie le drapeau ; les attentes se réveillent tout de suite
  const cancelled = () => Object.assign(new Error('Enregistrement annulé.'), { cancelled: true });
  const guard = fn => async (...a) => { if (job.cancelled) throw cancelled(); const r = await fn(...a); if (job.cancelled) throw cancelled(); return r; };
  const sleep = ms => new Promise(res => { const t = setTimeout(() => { job.wake.delete(w); res(); }, ms); const w = () => { clearTimeout(t); res(); }; job.wake.add(w); });
  const gm = ((session && session.source === 'cloud' && remoteData ? remoteData.games : store.data.games) || []).find(x => x.matchId === matchId && x.playerId === playerId);
  (async () => {
    let settingsBefore = null;
    try { settingsBefore = await readGameSettings(creds); note('réglages du joueur notés', Object.keys(settingsBefore || {})); } catch (e) { note('réglages du joueur', 'illisibles : ' + e.message); }
    const giveBack = async () => {
      if (!job.launched || !settingsBefore) return;
      try {
        await gameGone(10000);
        if (!FAST) await new Promise(r => setTimeout(r, 2500)); // le client relit les réglages laissés par le jeu
        await restoreGameSettings(creds, settingsBefore, note);
      } catch (e) { note('réglages du joueur', 'non remis : ' + e.message); }
    };
    try {
      const r = await replayMod.recordGame({
        lcu: guard((method, p, body) => { if (p.endsWith('/watch')) job.launched = true; return localJson(creds.base, method, p, body, creds.password); }),
        replay: guard((method, p, body) => localJson(REPLAY_BASE, method, p, body)),
        startRecording: async (file, o) => {
          if (job.cancelled) throw cancelled();
          const rec = await startRecording(file, Object.assign({ log: note }, o));
          note('capture', rec.info());
          if (job.cancelled) { await rec.cancel(); throw cancelled(); } // annulé pendant le démarrage de la capture
          job.rec = rec;
          return rec;
        },
        selectPlayer: guard(key => selectPlayerInReplay(key)),
        killGame, sleep: guard(sleep), now: Date.now, status, log: note,
        raw: { replay: (method, p, body) => localJson(REPLAY_BASE, method, p, body), sleep: ms => new Promise(res => setTimeout(res, ms)) }
      }, {
        gameId: m.gameId, duration: m.duration, gameVersion: m.version || '', queueId: m.custom ? 0 : 420, gameType: m.custom ? 'CUSTOM_GAME' : 'MATCHED_GAME', gameEnd: gm && gm.date ? gm.date + m.duration * 1000 : 0, champion: me.champion,
        playerKey: (me.teamId === 200 || (!me.teamId && me.id > 5) ? 'qwert' : '12345')[m.participants.filter(p => p.teamId === me.teamId).sort((a, b) => a.id - b.id).findIndex(p => p.id === me.id)] || null,
        label: champName(me.champion) + (m.opp ? ' contre ' + champName((m.participants.find(p => p.id === m.opp) || {}).champion) : '') + (gm && gm.date ? ' du ' + new Date(gm.date).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(' ', ' à ') : ''), championName: champName(me.champion), gameName: String(me.name || '').split('#')[0], moments: picked,
        file: (i, w) => path.join(tmp, String(i + 1).padStart(2, '0') + '_' + Math.floor(w.start / 60) + 'm' + String(w.start % 60).padStart(2, '0') + '.webm')
      }, Object.assign({ screenFallback: process.platform === 'win32' }, FAST ? { poll: 250, tick: 250, clipWall: 1500 } : {}));
      if (job.cancelled) throw cancelled();
      status('Remise de tes réglages League of Legends…', 0.995);
      await giveBack();
      const clips = r.clips.map(c => ({ start: c.start, end: c.end, times: c.times, file: path.basename(c.file), bytes: fs.statSync(c.file).size, lead: c.lead, sync: c.sync }));
      fs.rmSync(dir, { recursive: true, force: true });
      fs.renameSync(tmp, dir);
      m.clips = clips;
      m.camera = r.camera;
      delete m.pending;
      writeMoments(playerId, m);
      note('terminé', { extraits: clips.length, octets: clips.reduce((n, c) => n + c.bytes, 0) });
      sendVideo({ playerId, matchId, done: true, text: clips.length + ' extrait' + (clips.length > 1 ? 's' : '') + ' filmé' + (clips.length > 1 ? 's' : '') + '.' });
    } catch (e) {
      fs.rmSync(tmp, { recursive: true, force: true });
      if (job.cancelled || e.cancelled) {
        write('ANNULÉ par le joueur');
        if (job.launched) { await killGame().catch(() => {}); await gameGone(10000); } // seulement le replay ouvert par l'app
        await giveBack();
        if (videoJob === job) sendVideo({ playerId, matchId, cancelled: true, text: 'Enregistrement annulé.' });
      } else {
        write('ERREUR ' + e.message);
        await giveBack();
        let reported = false;
        if (isPlayerOnline()) { // le coach reçoit le journal : il voit ce qui a bloqué sans rien demander au joueur
          try {
            let j = fs.readFileSync(journal, 'utf8');
            if (j.length > 59000) j = j.slice(0, 3000) + '\n[…]\n' + j.slice(-55000);
            await cloud.filmReport(playerToken(), { matchId, error: String(e.message).slice(0, 1000), journal: j, version: app.getVersion() });
            reported = true;
            write('journal envoyé au coach');
          } catch (err) { write('journal non envoyé au coach : ' + err.message); }
        }
        sendVideo({ playerId, matchId, error: e.message, journal: true, reported });
      }
    } finally {
      if (videoJob === job) videoJob = null;
    }
  })();
  return { ok: true };
}
// Bouton « Annuler l'enregistrement » : arrête tout (capture, replay) ; les anciennes vidéos restent.
function cancelVideos({ playerId, matchId } = {}) {
  const job = videoJob;
  if (!job || (playerId && job.playerId !== playerId) || (matchId && job.matchId !== matchId)) return { none: true };
  if (job.cancelled) return { already: true };
  job.cancelled = true;
  for (const w of job.wake) w();
  job.wake.clear();
  sendVideo({ playerId: job.playerId, matchId: job.matchId, text: 'Annulation…', progress: job.progress, cancelling: true });
  // filet de sécurité : si un appel ne rend pas la main (client LoL figé), on libère quand même l'app après 15 s
  setTimeout(() => {
    if (videoJob !== job) return;
    videoJob = null;
    if (job.rec) job.rec.cancel();
    if (job.launched) killGame().catch(() => {});
    fs.rmSync(path.join(videosDir(), videoKey(job.playerId, job.matchId)) + '.nouveau', { recursive: true, force: true });
    sendVideo({ playerId: job.playerId, matchId: job.matchId, cancelled: true, text: 'Enregistrement annulé.' });
  }, FAST ? 4000 : 15000);
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

// Bouton « Regarder » : demande au client League of Legends d'ouvrir la partie en mode spectateur, comme quand on
// regarde un joueur depuis son profil dans le client. Le jeu lancé directement par l'app (ancienne méthode) reste
// désormais sur un écran noir puis se ferme : il attend des informations de connexion que seul le client lui donne
// (constaté dans les journaux du jeu, novembre 2026). Le client gère aussi le retard de 3 minutes des classées.
const watching = { busy: false };
async function lcuReady() {
  const creds = await lcuCreds();
  if (!creds) return null;
  const me = await localJson(creds.base, 'GET', '/lol-summoner/v1/current-summoner', undefined, creds.password).catch(() => null);
  return me && me.puuid ? creds : null;
}
// Ouvre le client League of Legends (le joueur doit être connecté à son compte Riot)
function openLolClient() {
  const ins = lolInstall();
  if (!ins) return false;
  if (process.env.COACHING_LOL_TEST) { fs.writeFileSync(path.join(process.env.COACHING_LOL_DATA, 'client-ouvert'), '1'); return true; }
  const { spawn: sp } = require('child_process');
  try {
    if (LOL_OS === 'darwin') sp('open', [ins.base], { detached: true, stdio: 'ignore' }).unref();
    else {
      const exe = path.join(ins.base, 'LeagueClient.exe');
      if (!fs.existsSync(exe)) return false;
      sp(exe, [], { cwd: ins.base, detached: true, stdio: 'ignore' }).unref();
    }
    return true;
  } catch (e) { return false; }
}
// Le client ne laisse regarder que ses amis : la clé de spectateur de la partie est dans la présence de l'ami
// (chat du client). Les identifiants du client ne sont pas ceux de l'API Riot : on retrouve l'ami par son Riot ID.
// Demande identique à celle du client quand on regarde un ami (vérifié dans ses journaux, novembre 2026).
const riotKey = (name, tag) => String(name || '').toLowerCase().replace(/\s+/g, '') + '#' + String(tag || '').toLowerCase().replace(/\s+/g, '');
function pickFriend(friends, ours) {
  const list = Array.isArray(friends) ? friends : [];
  let found = null;
  for (const x of ours) {
    const f = list.find(fr => riotKey(fr.gameName, fr.gameTag) === riotKey(x.gameName, x.tagLine));
    if (f && f.lol && f.lol.spectatorKey) return { f, x };
    if (f && !found) found = { f, x, noKey: true };
  }
  return found;
}
async function spectate(creds, g) {
  const lcu = (method, p, body) => localJson(creds.base, method, p, body, creds.password);
  const ours = g.allies.concat(g.enemies).filter(x => x.playerId && x.gameName);
  const friends = await lcu('GET', '/lol-chat/v1/friends').catch(() => []);
  const pick = pickFriend(friends, ours);
  const names = ours.map(x => x.gameName + '#' + x.tagLine).join(' ou ');
  if (!pick) throw new Error('Ajoute ' + names + ' en ami dans League of Legends : le client ne permet de regarder que ses amis.');
  if (pick.noKey) throw new Error(pick.x.gameName + ' est dans tes amis, mais le client n\'a pas encore la clé de sa partie : réessaie dans un instant.');
  const key = pick.f.lol.spectatorKey;
  await lcu('GET', '/lol-spectator/v3/buddy/can-spectate/' + encodeURIComponent(pick.f.puuid) + '/' + encodeURIComponent(key)).catch(() => null);
  try {
    await lcu('POST', '/lol-spectator/v1/spectate/launch', { allowObserveMode: pick.f.lol.isObservable || 'ALL', dropInSpectateGameId: '', gameQueueType: pick.f.lol.gameQueueType || 'RANKED_SOLO_5x5', puuid: pick.f.puuid, spectatorKey: key });
  } catch (e) {
    throw new Error(e.status === 404 ? 'Riot ne trouve pas la partie (elle vient peut-être de se terminer).' : 'Le client League of Legends a refusé d\'ouvrir la partie (' + e.message + ').');
  }
}
const watchMsg = g => {
  const wait = Math.max(0, 180 - liveMod.elapsed(g));
  return 'La partie s\'ouvre dans League of Legends' + (wait > 30 ? ' dans environ ' + Math.ceil(wait / 60) + ' min (3 min de retard en classée).' : ' (3 min de retard en classée).');
};
async function watchGame(gameId) {
  requireEdit();
  const g = live.games.find(x => String(x.gameId) === String(gameId));
  if (!g) throw new Error('Cette partie est terminée.');
  if (!g.allies.concat(g.enemies).some(x => x.playerId && x.gameName)) throw new Error('Aucun de tes joueurs n\'est identifiable dans cette partie.');
  if (watching.busy) return { ok: true, message: 'Le client League of Legends s\'ouvre : la partie se lancera dès qu\'il sera prêt.' };
  const creds = await lcuReady();
  if (creds) {
    await spectate(creds, g);
    return { ok: true, message: watchMsg(g) };
  }
  // client fermé (ou pas encore connecté) : on l'ouvre, puis on lance la partie dès qu'il répond
  if (!openLolClient()) throw new Error('Ouvre le client League of Legends (connecté à ton compte), puis clique à nouveau sur « Regarder ».');
  watching.busy = true;
  (async () => {
    try {
      let c = null;
      for (const t0 = Date.now(); !c && Date.now() - t0 < (FAST ? 15000 : 120000); ) {
        await new Promise(r => setTimeout(r, FAST ? 500 : 3000));
        c = await lcuReady();
      }
      if (!c) return tellCoach('Mode spectateur', 'Le client League of Legends ne répond pas : connecte-toi à ton compte dans le client, puis clique à nouveau sur « Regarder ».');
      if (!live.games.some(x => String(x.gameId) === String(gameId))) return tellCoach('Mode spectateur', 'La partie s\'est terminée entre-temps.');
      await spectate(c, g);
      tellCoach('Mode spectateur', watchMsg(g));
    } catch (e) {
      tellCoach('Mode spectateur', e.message);
    } finally {
      watching.busy = false;
    }
  })();
  return { ok: true, message: 'J\'ouvre le client League of Legends : la partie se lancera toute seule dès qu\'il sera prêt.' };
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
const updateInfo = { checkedAt: null, state: 'idle', version: null, error: '', progress: -1 };
const updateView = () => ({ state: updateInfo.state, version: updateInfo.version, error: updateInfo.error, checkedAt: updateInfo.checkedAt, progress: updateInfo.progress, installed: updateInfo.installed || null, packaged: app.isPackaged });
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
      autoUpdater.on('update-downloaded', info => { Object.assign(updateInfo, { state: 'ready', version: info.version, progress: 100 }); refreshView(); });
      autoUpdater.on('download-progress', p => { updateInfo.progress = Math.floor((p && p.percent) || 0); });
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
    updateInfo.progress = 0;
    macUpdate.newApp = await mu.prepareUpdate({ repo: REPO, info, workDir: macWorkDir(), fetchImpl: webFetch, onProgress: pct => { updateInfo.progress = pct; } });
    macUpdate.state = 'ready';
    updateInfo.state = 'ready';
    refreshView();
  } catch (e) {
    macUpdate.state = 'idle';
    Object.assign(updateInfo, { state: 'error', error: 'téléchargement impossible (' + e.message + ')' });
  }
}

// Recherche demandée depuis l'interface (bouton « Rechercher une mise à jour ») : on attend la réponse de GitHub,
// pas le téléchargement, qui continue en arrière-plan.
const waitUntil = (test, ms) => new Promise(resolve => { const t0 = Date.now(); const tick = () => (test() || Date.now() - t0 > ms ? resolve() : setTimeout(tick, 200)); tick(); });
// tests de l'interface : fausse mise à jour (recherche, téléchargement, prête), sans réseau
const FAKE_UPDATE = process.env.COACHING_LOL_TEST && process.env.COACHING_LOL_FAKE_UPDATE;
async function fakeUpdateCheck() {
  Object.assign(updateInfo, { state: 'checking', error: '', checkedAt: Date.now() });
  await new Promise(r => setTimeout(r, 500));
  Object.assign(updateInfo, { state: 'downloading', version: FAKE_UPDATE, progress: 0 });
  const t = setInterval(() => {
    updateInfo.progress = Math.min(100, updateInfo.progress + 25);
    if (updateInfo.progress >= 100) { clearInterval(t); updateInfo.state = 'ready'; refreshView(); }
  }, 400);
  return { ok: true, data: viewData() };
}
async function checkUpdatesManual() {
  if (FAKE_UPDATE) return updateInfo.state === 'ready' || updateInfo.state === 'downloading' ? { ok: true, data: viewData() } : fakeUpdateCheck();
  if (!app.isPackaged) return { ok: false, message: "Recherche impossible ici : cette copie de l'app n'est pas une version installée.", data: viewData() };
  if (updateInfo.state === 'downloading' || updateInfo.state === 'ready') return { ok: true, data: viewData() };
  if (checkingUpdates) { await waitUntil(() => !checkingUpdates || updateInfo.state === 'downloading', 20000); return { ok: true, data: viewData() }; }
  checkingUpdates = true;
  Object.assign(updateInfo, { state: 'checking', error: '' });
  const run = checkUpdatesNow().catch(e => Object.assign(updateInfo, { state: 'error', error: e.message })).finally(() => { checkingUpdates = false; if (updateInfo.state === 'checking') updateInfo.state = 'idle'; refreshView(); });
  await Promise.race([run, waitUntil(() => updateInfo.state !== 'checking', 20000)]);
  return { ok: true, data: viewData() };
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
  handle('videos:cancel', q => cancelVideos(q || {}));
  handle('analyses:refresh', async () => { await refreshAnalyses(); return { ok: true, data: viewData() }; });
  handle('analysis:get', q => getAnalysis(q || {}));
  handle('analysis:send', q => sendAnalysis(q || {}));
  handle('analysis:comment', q => commentAnalysis(q || {}));
  handle('analysis:close', q => closeAnalysis(q || {}));
  handle('analysis:delete', q => deleteAnalysis(q || {}));
  handle('custom:list', () => listCustomGames());
  handle('custom:add', q => addCustomGame(q || {}));
  handle('analysis:export', q => exportAnalysis(q || {}));
  handle('goals:add', q => addGoals(q || {}));
  handle('goal:update', q => updateGoal(q || {}));
  handle('goal:delete', q => deleteGoal(q || {}));
  handle('bilan:prepare', q => prepareBilan(q || {}));
  handle('bilan:send', q => sendBilan(q || {}));
  handle('bilan:dismiss', q => dismissBilan(q || {}));
  handle('bilan:delete', q => deleteBilan(q || {}));
  handle('bilan:open', async q => { requireEdit(); const b = readBilans()[(q || {}).playerId]; const d = b ? path.join(claudeDir(), b.folder) : path.join(claudeDir(), claudeMod.BILAN_DIR); fs.mkdirSync(d, { recursive: true }); const e = await shell.openPath(d); if (e) throw new Error(e); return { ok: true }; });
  handle('filmreport:done', q => filmReportsDone(q || {}));
  handle('course:progress', q => courseProgress(q || {}));
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
  handle('update:check', () => checkUpdatesManual());
  handle('update:install', () => {
    if (FAKE_UPDATE && updateInfo.state === 'ready') { fs.writeFileSync(path.join(process.env.COACHING_LOL_DATA, 'installation-demandee'), FAKE_UPDATE); return { ok: true }; }
    if (!app.isPackaged || !updateReady()) throw new Error("Aucune mise à jour prête à installer pour l'instant.");
    setTimeout(restartForUpdate, 150);
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
  win.on('closed', () => { if (videoJob) cancelVideos({}); dropRecorder(); }); // sinon la fenêtre cachée garde l'app ouverte sans fenêtre
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
    const range = req.headers.get('range');
    if (u.host === 'r') { // vidéo envoyée par un joueur (serveur), avec les demandes de plage pour avancer dans la vidéo
      if (!cloud || !/^[0-9a-f-]{36}$/.test(parts[0])) return new Response('', { status: 404 });
      return serverClip(parts[0], parts[1], range).catch(() => new Response('', { status: 502 }));
    }
    const f = path.join(videosDir(), parts[0], parts[1]);
    if (!fs.existsSync(f)) return new Response('', { status: 404 });
    ensureSeekableFile(f);
    return fileResponse(f, range);
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
        setInterval(refreshCourses, 1500);
        setInterval(watchCoaching, 1000);
        setInterval(refreshAnalyses, 1500);
        setTimeout(pushMoments, 1500);
        setInterval(pushMoments, 4000);
        setInterval(pullCustomGames, 2000);
        setInterval(purgeClips, 3000);
        setTimeout(refreshTrends, 1200);
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
    setTimeout(refreshCourses, FAST ? 900 : 8000);
    setInterval(refreshCourses, FAST ? 2000 : 60 * 1000);
    setInterval(watchCoaching, FAST ? 1000 : 5 * 1000);
    setInterval(pollLive, FAST ? 2000 : 60 * 1000);
    setTimeout(refreshAnalyses, FAST ? 800 : 7000);
    setInterval(refreshAnalyses, FAST ? 2000 : 45 * 1000);
    setTimeout(pushMoments, FAST ? 1500 : 60 * 1000);
    setInterval(pushMoments, 30 * 60 * 1000);
    setTimeout(pullCustomGames, FAST ? 1000 : 20 * 1000);
    setInterval(pullCustomGames, FAST ? 2000 : 2 * 60 * 1000);
    setTimeout(purgeClips, 2 * 60 * 1000);
    setInterval(purgeClips, 3600 * 1000);
    setTimeout(refreshRoleRates, 30 * 1000);
    setTimeout(() => { try { refreshTrends(); } catch (e) { /* au prochain passage */ } }, 25 * 1000);
    setInterval(refreshRoleRates, 6 * 3600 * 1000);
  });
  if (process.env.COACHING_LOL_TEST) app.on('coaching-lol:test-resume', writeResume); // tests uniquement
  app.on('activate', () => { if (!win || win.isDestroyed()) createWindow(); else { if (win.isMinimized()) win.restore(); win.show(); } }); // la fenêtre cachée de l'enregistreur ne compte pas
});

// Mac : une mise à jour prête s'installe quand on quitte l'app (comme sur Windows)
app.on('will-quit', () => { if (process.platform === 'darwin' && macUpdate.state === 'ready') installMacUpdate(false); });
// Fermer la fenêtre quitte l'app, sur Mac aussi : c'est ce qui déclenche l'installation des mises à jour
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { if (videoJob && videoJob.launched) { videoJob.cancelled = true; killGame().catch(() => {}); } });
