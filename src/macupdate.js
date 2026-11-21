// Mise à jour automatique sur Mac sans certificat Apple.
// electron-updater refuse d'installer une app non signée par un développeur Apple : on fait donc nous-mêmes
// ce qu'il ferait : télécharger le zip de la nouvelle version, vérifier son empreinte, le décompresser,
// puis remplacer l'app une fois qu'elle est fermée et la relancer.
// Dans Electron, « fs » ouvre les archives .asar comme des dossiers : effacer une app déjà décompressée
// (…/Contents/Resources/app.asar, reste d'une mise à jour pas installée) échouait alors (ENOTDIR) et bloquait
// toutes les mises à jour suivantes. « original-fs » voit les vrais fichiers ; hors Electron (tests), « fs ».
const fs = (() => { try { return require('original-fs'); } catch (e) { return require('fs'); } })();
const path = require('path');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');

function compareVersions(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

// latest-mac.yml produit par electron-builder (format simple, pas besoin d'un parseur YAML complet)
function parseLatestMacYml(text) {
  const version = (text.match(/^version:\s*['"]?([^'"\s]+)/m) || [])[1] || null;
  const files = [];
  const re = /-\s*url:\s*['"]?([^'"\n]+?)['"]?\s*\n\s*sha512:\s*['"]?([^'"\n]+?)['"]?\s*\n\s*size:\s*(\d+)/g;
  let m;
  while ((m = re.exec(text))) files.push({ url: m[1].trim(), sha512: m[2].trim(), size: Number(m[3]) });
  const zip = files.find(f => /\.zip$/i.test(f.url)) || null;
  return { version, files, zip };
}

// /Applications/Coaching LoL.app/Contents/MacOS/Coaching LoL → /Applications/Coaching LoL.app
function appBundlePath(execPath) {
  const p = path.resolve(execPath, '..', '..', '..');
  return /\.app$/i.test(p) ? p : null;
}

function canSelfUpdate(appPath, access = fs.accessSync) {
  if (!appPath) return { ok: false, reason: "l'application n'est pas dans un dossier .app" };
  if (appPath.includes('/AppTranslocation/')) return { ok: false, reason: "macOS fait tourner l'app depuis un dossier temporaire : glisse-la dans Applications puis rouvre-la" };
  if (appPath.startsWith('/Volumes/')) return { ok: false, reason: "l'app est lancée depuis le disque d'installation : glisse-la d'abord dans Applications" };
  try { access(path.dirname(appPath), fs.constants.W_OK); access(appPath, fs.constants.W_OK); } catch (e) {
    return { ok: false, reason: "pas le droit d'écrire dans le dossier de l'app (" + path.dirname(appPath) + ')' };
  }
  return { ok: true };
}

async function download(url, dest, { fetchImpl = fetch, onProgress, expectedSize } = {}) {
  const res = await fetchImpl(url, { headers: { 'User-Agent': 'coaching-lol' }, redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error('téléchargement refusé (' + res.status + ')');
  const total = Number(res.headers.get('content-length')) || expectedSize || 0;
  const out = fs.createWriteStream(dest);
  const hash = crypto.createHash('sha512');
  let done = 0, lastPct = -1;
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { value, done: end } = await reader.read();
      if (end) break;
      const chunk = Buffer.from(value);
      hash.update(chunk);
      done += chunk.length;
      if (!out.write(chunk)) await new Promise(r => out.once('drain', r));
      const pct = total ? Math.floor((done / total) * 100) : -1;
      if (onProgress && pct !== lastPct) { lastPct = pct; onProgress(pct); }
    }
  } finally {
    await new Promise(r => out.end(r));
  }
  return hash.digest('base64');
}

function dittoUnzip(zip, dir) {
  return new Promise((resolve, reject) => execFile('/usr/bin/ditto', ['-x', '-k', zip, dir], err => (err ? reject(err) : resolve())));
}
function removeQuarantine(appPath) {
  return new Promise(resolve => execFile('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', appPath], () => resolve()));
}

// Télécharge et prépare la nouvelle version. Renvoie le chemin de la nouvelle app, prête à remplacer l'ancienne.
async function prepareUpdate({ repo, info, workDir, fetchImpl = fetch, unzip = dittoUnzip, onProgress }) {
  if (!info.zip) throw new Error('pas de zip Mac dans la version ' + info.version);
  fs.rmSync(workDir, { recursive: true, force: true });
  fs.mkdirSync(workDir, { recursive: true });
  const zipPath = path.join(workDir, 'mise-a-jour.zip');
  const url = `https://github.com/${repo}/releases/download/v${info.version}/${encodeURIComponent(info.zip.url)}`;
  const sha = await download(url, zipPath, { fetchImpl, onProgress, expectedSize: info.zip.size });
  if (sha !== info.zip.sha512) throw new Error('fichier téléchargé abîmé (empreinte différente)');
  const extractDir = path.join(workDir, 'nouvelle');
  fs.mkdirSync(extractDir);
  await unzip(zipPath, extractDir);
  const appName = fs.readdirSync(extractDir).find(n => /\.app$/i.test(n));
  if (!appName) throw new Error("aucune app dans le zip");
  const newApp = path.join(extractDir, appName);
  await removeQuarantine(newApp);
  fs.rmSync(zipPath, { force: true });
  return newApp;
}

// Script lancé à part : attend que l'app soit fermée, échange les dossiers, relance si demandé.
// En cas d'échec (droits, protection macOS), l'ancienne app est remise en place.
const SWAP_SCRIPT = `#!/bin/sh
PID="$1"; OLD="$2"; NEW="$3"; BAK="$4"; RELAUNCH="$5"; LOG="$6"
i=0
while kill -0 "$PID" 2>/dev/null; do sleep 0.3; i=$((i+1)); [ $i -gt 300 ] && echo "app toujours ouverte" >> "$LOG" && exit 1; done
rm -rf "$BAK"
if mv "$OLD" "$BAK" 2>>"$LOG"; then
  if mv "$NEW" "$OLD" 2>>"$LOG"; then
    rm -rf "$BAK"
    echo "ok" >> "$LOG"
  else
    mv "$BAK" "$OLD" 2>>"$LOG"
  fi
fi
if [ "$RELAUNCH" = "1" ] && [ -x /usr/bin/open ]; then /usr/bin/open "$OLD"; fi
exit 0
`;

function launchSwap({ pid, oldApp, newApp, workDir, relaunch, logPath, spawnImpl = spawn }) {
  const script = path.join(workDir, 'installer.sh');
  fs.writeFileSync(script, SWAP_SCRIPT, { mode: 0o755 });
  const child = spawnImpl('/bin/sh', [script, String(pid), oldApp, newApp, path.join(workDir, 'ancienne.app'), relaunch ? '1' : '0', logPath], { detached: true, stdio: 'ignore' });
  child.unref();
  return child;
}

module.exports = { compareVersions, parseLatestMacYml, appBundlePath, canSelfUpdate, download, prepareUpdate, launchSwap, SWAP_SCRIPT };
