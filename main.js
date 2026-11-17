const { app, BrowserWindow, ipcMain, shell, dialog, safeStorage } = require('electron');
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
      update: updateInfo
    };
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
  if (remoteTimer) clearInterval(remoteTimer);
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

// ---------------------------------------------------------------- synchro Riot (silencieuse, ordinateur du coach)
async function runSync(playerIds) {
  const key = getSecret('apiKey');
  if (syncing || polling || !key) return;
  syncing = true;
  const client = new RiotClient(key);
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
  const client = new RiotClient(key, { delayMs: 300 });
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
    if (v && (v !== s.ddVersion || !s.champs)) {
      // noms français des champions (l'API Riot donne « MonkeyKing », « JarvanIV »… : on affiche « Wukong », « Jarvan IV »)
      try {
        const cj = await (await fetch(`https://ddragon.leagueoflegends.com/cdn/${v}/data/fr_FR/champion.json`)).json();
        const champs = {};
        for (const c of Object.values(cj.data || {})) champs[c.id.toLowerCase()] = [c.id, c.name];
        if (Object.keys(champs).length) s.champs = champs;
      } catch (e) { /* on garde les noms bruts */ }
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

  handle('data:get', () => viewData());
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
    for (const k of ['autoSyncMinutes', 'maxGamesPerSync', 'cards', 'objectives', 'axes']) if (k in patch) s[k] = patch[k];
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

  handle('open:external', url => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { ok: true }; });
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
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
}

app.whenReady().then(() => {
  store = new Store(process.env.COACHING_LOL_DATA || app.getPath('userData'));
  if (isCoachMachine()) ensurePlayerCodes();
  // LP des parties déjà connues, à partir des relevés de rang existants
  if (store.data.players.reduce((n, p) => n + lpMod.attributeLp(store.data, p.id), 0)) store.save();
  registerIpc();
  createWindow();
  refreshDDragon();
  scheduleAutoSync();
  win.webContents.once('did-finish-load', () => {
    if (process.env.COACHING_LOL_TEST) return require(process.env.COACHING_LOL_TEST)({ app, win, store, fs, path });
    if (getSecret('apiKey') && store.data.players.length) setTimeout(() => runSync(), 3000);
    setTimeout(pollRanks, 20000);
    setInterval(pollRanks, 5 * 60 * 1000);
    schedulePush(15000); // garde aussi le serveur éveillé (le plan gratuit se met en pause après 7 jours sans activité)
    setInterval(() => schedulePush(1000), 6 * 3600 * 1000);
    checkPreviousUpdate();
    setTimeout(checkUpdates, 5000);
    setInterval(checkUpdates, UPDATE_EVERY_MS);
  });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

// Mac : une mise à jour prête s'installe quand on quitte l'app (comme sur Windows)
app.on('will-quit', () => { if (process.platform === 'darwin' && macUpdate.state === 'ready') installMacUpdate(false); });
// Fermer la fenêtre quitte l'app, sur Mac aussi : c'est ce qui déclenche l'installation des mises à jour
app.on('window-all-closed', () => app.quit());
