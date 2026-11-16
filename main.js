const { app, BrowserWindow, ipcMain, shell, dialog, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Store } = require('./src/store');
const { RiotClient } = require('./src/riot');
const { syncPlayer } = require('./src/sync');
const mu = require('./src/macupdate');

let win = null;
let store = null;
let syncing = false;
let timer = null;
const REPO = 'theofauviaux-stack/coaching-lol';

// ---------------------------------------------------------------- clé API (chiffrée si possible)
function getKey() {
  const s = store.data.settings;
  if (s.apiKeyEnc && safeStorage.isEncryptionAvailable()) {
    try { return safeStorage.decryptString(Buffer.from(s.apiKeyEnc, 'base64')); } catch (e) { return ''; }
  }
  return s.apiKey || '';
}
function setKey(key) {
  const s = store.data.settings;
  if (safeStorage.isEncryptionAvailable()) {
    s.apiKeyEnc = safeStorage.encryptString(key).toString('base64');
    s.apiKey = '';
  } else {
    s.apiKey = key;
  }
  store.save();
}

function publicData() {
  const d = JSON.parse(JSON.stringify(store.data));
  const k = getKey();
  d.settings.apiKey = '';
  delete d.settings.apiKeyEnc;
  d.settings.hasKey = !!k;
  d.settings.keyPreview = k ? k.slice(0, 11) + '…' + k.slice(-4) : '';
  d.appVersion = app.getVersion();
  return d;
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// ---------------------------------------------------------------- synchro
async function runSync(playerIds) {
  if (syncing) return { ok: false, message: 'Une synchronisation est déjà en cours.' };
  const key = getKey();
  if (!key) return { ok: false, message: 'Renseigne ta clé API Riot dans Paramètres.' };
  syncing = true;
  const client = new RiotClient(key);
  const players = store.data.players.filter(p => !playerIds || playerIds.includes(p.id));
  let total = 0;
  let errors = 0;
  try {
    for (const p of players) {
      send('sync:progress', { playerId: p.id, text: p.riotId + ' : démarrage…' });
      try {
        const r = await syncPlayer(store.data, client, p, {
          maxGames: store.data.settings.maxGamesPerSync || 30,
          onProgress: t => send('sync:progress', { playerId: p.id, text: p.riotId + ' : ' + t })
        });
        total += r.added;
        if (r.remaining) p.statusText += ' · ' + r.remaining + ' plus ancienne(s) à la prochaine synchro';
      } catch (e) {
        errors++;
        p.status = 'error';
        p.statusText = e.message;
        if (e.code === 'KEY' || e.code === 'NO_KEY') { store.save(); send('data:changed', publicData()); break; }
      }
      store.save();
      send('data:changed', publicData());
    }
    store.data.settings.lastSync = Date.now();
    store.save();
  } finally {
    syncing = false;
    send('sync:progress', null);
    send('data:changed', publicData());
  }
  return { ok: errors === 0, message: total + ' nouvelle(s) partie(s)' + (errors ? ' · ' + errors + ' erreur(s)' : '') };
}

function scheduleAutoSync() {
  if (timer) clearInterval(timer);
  const min = Number(store.data.settings.autoSyncMinutes) || 0;
  if (min > 0) timer = setInterval(() => { if (getKey()) runSync(); }, min * 60 * 1000);
}

async function refreshDDragon() {
  try {
    const res = await fetch('https://ddragon.leagueoflegends.com/api/versions.json');
    const v = (await res.json())[0];
    if (v && v !== store.data.settings.ddVersion) { store.data.settings.ddVersion = v; store.save(); send('data:changed', publicData()); }
  } catch (e) { /* hors ligne : on garde la version connue */ }
}

// ---------------------------------------------------------------- mises à jour
// Windows : electron-updater (téléchargement en arrière-plan, installation à la fermeture).
// Mac : module maison (src/macupdate.js), car electron-updater exige un certificat Apple payant.
const macUpdate = { state: 'idle', version: null, newApp: null, error: null };
const macWorkDir = () => path.join(app.getPath('temp'), 'coaching-lol-maj');
const pendingFile = () => path.join(app.getPath('userData'), 'maj-en-cours.json');

async function checkUpdates(manual) {
  if (!app.isPackaged) return manual ? { status: 'dev', message: 'Mode développement : pas de mise à jour.' } : null;
  if (process.platform === 'darwin') return checkMacUpdate();
  try {
    const { autoUpdater } = require('electron-updater');
    if (!checkUpdates.ready) {
      checkUpdates.ready = true;
      autoUpdater.autoDownload = true;
      autoUpdater.on('download-progress', p => send('update:status', { status: 'progress', percent: Math.floor(p.percent || 0) }));
      autoUpdater.on('update-downloaded', info => send('update:status', { status: 'ready', version: info.version }));
      autoUpdater.on('error', async () => {
        const latest = await latestRelease();
        if (latest && mu.compareVersions(latest.version, app.getVersion()) > 0) send('update:status', { status: 'manual', version: latest.version, url: latest.url });
      });
    }
    const r = await autoUpdater.checkForUpdates();
    if (r && r.updateInfo && mu.compareVersions(r.updateInfo.version, app.getVersion()) > 0) return { status: 'downloading', message: 'Version ' + r.updateInfo.version + ' en cours de téléchargement…' };
    return { status: 'uptodate', message: 'Tu as la dernière version (' + app.getVersion() + ').' };
  } catch (e) {
    const latest = await latestRelease();
    if (latest && mu.compareVersions(latest.version, app.getVersion()) > 0) {
      send('update:status', { status: 'manual', version: latest.version, url: latest.url });
      return { status: 'manual', message: 'Version ' + latest.version + ' disponible.' };
    }
    return { status: 'error', message: 'Vérification impossible : ' + e.message };
  }
}

async function checkMacUpdate() {
  if (macUpdate.state === 'ready') { send('update:status', { status: 'ready', version: macUpdate.version }); return { status: 'ready', message: 'Version ' + macUpdate.version + ' prête.' }; }
  if (macUpdate.state === 'downloading') return { status: 'downloading', message: 'Version ' + macUpdate.version + ' en cours de téléchargement…' };
  let info;
  try {
    const res = await fetch(`https://github.com/${REPO}/releases/latest/download/latest-mac.yml`, { headers: { 'User-Agent': 'coaching-lol' } });
    if (!res.ok) throw new Error('réponse ' + res.status);
    info = mu.parseLatestMacYml(await res.text());
  } catch (e) { return { status: 'error', message: 'Vérification impossible : ' + e.message }; }
  if (!info.version || mu.compareVersions(info.version, app.getVersion()) <= 0) return { status: 'uptodate', message: 'Tu as la dernière version (' + app.getVersion() + ').' };
  const releaseUrl = `https://github.com/${REPO}/releases/latest`;
  if (macUpdate.blocked && macUpdate.blocked.version === info.version) {
    send('update:status', { status: 'manual', version: info.version, url: releaseUrl, reason: macUpdate.blocked.reason });
    return { status: 'manual', message: 'Mise à jour bloquée : ' + macUpdate.blocked.reason + '.' };
  }
  const appPath = mu.appBundlePath(process.execPath);
  const can = mu.canSelfUpdate(appPath);
  if (!can.ok) {
    send('update:status', { status: 'manual', version: info.version, url: releaseUrl, reason: can.reason });
    return { status: 'manual', message: 'Version ' + info.version + ' disponible, mise à jour automatique impossible : ' + can.reason + '.' };
  }
  macUpdate.state = 'downloading'; macUpdate.version = info.version;
  mu.prepareUpdate({ repo: REPO, info, workDir: macWorkDir(), onProgress: pct => send('update:status', { status: 'progress', version: info.version, percent: pct }) })
    .then(newApp => {
      macUpdate.state = 'ready'; macUpdate.newApp = newApp;
      send('update:status', { status: 'ready', version: info.version });
    })
    .catch(e => {
      macUpdate.state = 'idle'; macUpdate.error = e.message;
      send('update:status', { status: 'manual', version: info.version, url: releaseUrl, reason: 'téléchargement impossible (' + e.message + ')' });
    });
  return { status: 'downloading', message: 'Version ' + info.version + ' en cours de téléchargement…' };
}

// Remplace l'app par la nouvelle version une fois fermée (relaunch = la rouvrir ensuite)
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

// Au démarrage : la mise à jour précédente a-t-elle réussi ?
function reportPreviousUpdate() {
  let p;
  try { p = JSON.parse(fs.readFileSync(pendingFile(), 'utf8')); } catch (e) { return; }
  try { fs.rmSync(pendingFile(), { force: true }); } catch (e) { /* rien */ }
  if (app.getVersion() === p.to) { send('update:status', { status: 'installed', version: p.to }); return; }
  let log = '';
  try { log = fs.readFileSync(path.join(app.getPath('userData'), 'maj.log'), 'utf8'); } catch (e) { /* rien */ }
  const blocked = /not permitted|non autoris/i.test(log);
  const reason = blocked ? "macOS a bloqué le remplacement de l'app : ouvre Réglages Système › Confidentialité et sécurité › Gestion des apps, active Coaching LoL, puis redémarre l'app" : "l'installation n'a pas abouti";
  macUpdate.blocked = { version: p.to, reason }; // pas de nouvel essai avant le prochain lancement
  send('update:status', { status: 'manual', version: p.to, url: `https://github.com/${REPO}/releases/latest`, reason });
}

async function latestRelease() {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { 'User-Agent': 'coaching-lol' } });
    if (!res.ok) return null;
    const j = await res.json();
    return { version: String(j.tag_name || '').replace(/^v/, ''), url: j.html_url };
  } catch (e) { return null; }
}

// ---------------------------------------------------------------- IPC
function registerIpc() {
  ipcMain.handle('data:get', () => publicData());

  ipcMain.handle('player:save', (e, p) => {
    const list = store.data.players;
    if (!p.id) {
      p.id = crypto.randomUUID();
      p.createdAt = Date.now();
      p.objectives = p.objectives || {};
      list.push(p);
    } else {
      const cur = list.find(x => x.id === p.id);
      if (!cur) return publicData();
      const riotChanged = cur.riotId !== p.riotId || cur.region !== p.region;
      Object.assign(cur, p);
      if (riotChanged) cur.puuid = '';
    }
    store.save();
    return publicData();
  });

  ipcMain.handle('player:delete', (e, id) => {
    const d = store.data;
    d.players = d.players.filter(p => p.id !== id);
    d.games = d.games.filter(g => g.playerId !== id);
    d.ignored = d.ignored.filter(g => g.playerId !== id);
    d.ranks = d.ranks.filter(r => r.playerId !== id);
    d.sessions = d.sessions.filter(s => s.playerId !== id);
    store.save();
    return publicData();
  });

  ipcMain.handle('game:update', (e, { matchId, playerId, fields }) => {
    const g = store.data.games.find(x => x.matchId === matchId && x.playerId === playerId);
    if (g) {
      for (const k of ['mental', 'objectiveMet', 'comment', 'lpDelta']) if (k in fields) g[k] = fields[k];
      store.save();
    }
    return publicData();
  });

  ipcMain.handle('game:delete', (e, { matchId, playerId }) => {
    store.data.games = store.data.games.filter(x => !(x.matchId === matchId && x.playerId === playerId));
    store.data.ignored.push({ matchId, playerId, role: 'supprimée', date: Date.now() });
    store.save();
    return publicData();
  });

  ipcMain.handle('session:save', (e, s) => {
    if (!s.id) { s.id = crypto.randomUUID(); store.data.sessions.push(s); }
    else { const cur = store.data.sessions.find(x => x.id === s.id); if (cur) Object.assign(cur, s); }
    store.save();
    return publicData();
  });
  ipcMain.handle('session:delete', (e, id) => {
    store.data.sessions = store.data.sessions.filter(s => s.id !== id);
    store.save();
    return publicData();
  });

  ipcMain.handle('settings:save', (e, patch) => {
    const s = store.data.settings;
    for (const k of ['autoSyncMinutes', 'maxGamesPerSync', 'cards', 'objectives', 'axes']) if (k in patch) s[k] = patch[k];
    store.save();
    scheduleAutoSync();
    return publicData();
  });

  ipcMain.handle('key:save', async (e, key) => {
    key = String(key || '').trim();
    if (!/^RGAPI-[0-9a-f-]{20,}$/i.test(key)) return { ok: false, message: 'La clé doit commencer par RGAPI-.' };
    try {
      await new RiotClient(key, { delayMs: 0 }).status('euw');
    } catch (err) {
      return { ok: false, message: err.message };
    }
    setKey(key);
    return { ok: true, message: 'Clé valide et enregistrée.', data: publicData() };
  });

  ipcMain.handle('sync:run', (e, ids) => runSync(ids));
  ipcMain.handle('sync:busy', () => syncing);

  ipcMain.handle('backup:export', async () => {
    const r = await dialog.showSaveDialog(win, { defaultPath: 'coaching-lol-sauvegarde.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (r.canceled) return { ok: false };
    const d = JSON.parse(JSON.stringify(store.data));
    d.settings.apiKey = ''; delete d.settings.apiKeyEnc;
    fs.writeFileSync(r.filePath, JSON.stringify(d, null, 1));
    return { ok: true, message: 'Sauvegarde enregistrée.' };
  });
  ipcMain.handle('backup:import', async () => {
    const r = await dialog.showOpenDialog(win, { filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openFile'] });
    if (r.canceled) return { ok: false };
    try {
      const d = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
      const keyEnc = store.data.settings.apiKeyEnc, key = store.data.settings.apiKey;
      store.replaceAll(d);
      store.data.settings.apiKeyEnc = keyEnc; store.data.settings.apiKey = key; store.save();
      return { ok: true, message: 'Sauvegarde restaurée.', data: publicData() };
    } catch (e) { return { ok: false, message: 'Fichier illisible : ' + e.message }; }
  });

  ipcMain.handle('open:external', (e, url) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
  });
  ipcMain.handle('update:check', () => checkUpdates(true));
  ipcMain.handle('update:install', () => {
    if (process.platform === 'darwin') { if (installMacUpdate(true)) app.quit(); return; }
    try { require('electron-updater').autoUpdater.quitAndInstall(); } catch (e) { /* rien */ }
  });
}

// ---------------------------------------------------------------- fenêtre
function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 1100, minHeight: 700,
    backgroundColor: '#0A1428',
    title: 'Coaching LoL',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
}

app.whenReady().then(() => {
  store = new Store(process.env.COACHING_LOL_DATA || app.getPath('userData'));
  registerIpc();
  createWindow();
  refreshDDragon();
  scheduleAutoSync();
  win.webContents.once('did-finish-load', () => {
    if (process.env.COACHING_LOL_SHOT) return captureForTests(process.env.COACHING_LOL_SHOT);
    if (getKey() && store.data.players.length) setTimeout(() => runSync(), 3000);
    reportPreviousUpdate();
    setTimeout(() => checkUpdates(false), 5000);
    setInterval(() => checkUpdates(false), 4 * 3600 * 1000); // l'app peut rester ouverte longtemps
  });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

// Captures d'écran automatiques (tests uniquement, jamais utilisées par l'utilisateur)
async function captureForTests(dir) {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  await wait(1500);
  for (const page of ['joueurs', 'dashboard', 'parties', 'sessions', 'parametres']) {
    await win.webContents.executeJavaScript(`document.querySelector('[data-page="${page}"]').click(); document.querySelector('main').scrollTop = 0;`);
    await wait(700);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(dir, page + '.png'), img.toPNG());
    if (page === 'dashboard') {
      await win.webContents.executeJavaScript(`document.querySelector('main').scrollTop = 1250;`);
      await wait(500);
      fs.writeFileSync(path.join(dir, 'dashboard2.png'), (await win.webContents.capturePage()).toPNG());
    }
  }
  await win.webContents.executeJavaScript(`document.querySelector('[data-page="joueurs"]').click();`);
  await wait(400);
  await win.webContents.executeJavaScript(`document.querySelector('[data-action="new-player"]').click(); const r = document.querySelector('#player-form [name=role]'); if (r) { r.value = 'Jungle'; r.dispatchEvent(new Event('change', { bubbles: true })); }`);
  await wait(500);
  fs.writeFileSync(path.join(dir, 'modal-joueur.png'), (await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`document.querySelector('#modal-box').scrollTop = 10000;`);
  await wait(300);
  fs.writeFileSync(path.join(dir, 'modal-joueur2.png'), (await win.webContents.capturePage()).toPNG());
  // parcours réel au clic : création d'un joueur, modification, puis création d'une session
  const result = await win.webContents.executeJavaScript(`(async () => {
    const pause = ms => new Promise(r => setTimeout(r, ms));
    const out = {};
    let f = document.querySelector('#player-form');
    f.querySelector('[name=riotId]').value = 'Test#EUW';
    const cs = f.querySelector('[data-obj-key="CS/min"]'); cs.value = '7'; cs.dispatchEvent(new Event('input', { bubbles: true }));
    out.dore = cs.classList.contains('custom');
    f.querySelector('button[type=submit]').click(); await pause(1500);
    let p = state.data.players.find(x => x.riotId === 'Test#EUW');
    out.creation = { cree: !!p, objectifs: p && p.objectives, modaleFermee: document.querySelector('#modal').classList.contains('hidden') };
    document.querySelector('[data-page="joueurs"]').click(); await pause(300);
    document.querySelector('[data-action="edit-player"][data-id="' + p.id + '"]').click(); await pause(300);
    f = document.querySelector('#player-form');
    out.edition = { csAffiche: f.querySelector('[data-obj-key="CS/min"]').value, kpAffiche: f.querySelector('[data-obj-key="KP"]').value };
    f.querySelector('[name=goal]').value = 'Passer Diamant'; f.querySelector('button[type=submit]').click(); await pause(800);
    p = state.data.players.find(x => x.riotId === 'Test#EUW');
    out.apresEdition = { goal: p.goal, objectifs: p.objectives, nbJoueurs: state.data.players.length };
    state.playerId = p.id; document.querySelector('[data-page="sessions"]').click(); await pause(300);
    document.querySelector('[data-action="new-session"]').click(); await pause(300);
    const sf = document.querySelector('#session-form');
    const t = sf.querySelector('[name=theme]') || sf.querySelector('input[type=text]'); if (t) t.value = 'Test session';
    sf.querySelector('button[type=submit]').click(); await pause(800);
    out.session = { nb: state.data.sessions.filter(s => s.playerId === p.id).length, modaleFermee: document.querySelector('#modal').classList.contains('hidden') };
    return JSON.stringify(out, null, 1);
  })()`);
  fs.writeFileSync(path.join(dir, 'parcours.json'), result);
  app.quit();
}

// Mac : si une mise à jour est prête, elle s'installe quand on quitte l'app (comme sur Windows)
app.on('will-quit', () => { if (process.platform === 'darwin' && macUpdate.state === 'ready') installMacUpdate(false); });

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
