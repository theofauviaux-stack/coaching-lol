// Tests du module de mise à jour Mac (exécutables sous Linux : on simule le téléchargement et le zip)
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawn } = require('child_process');
const mu = require('../src/macupdate');

(async () => {
  if (process.platform === 'win32') { console.log('(tests de mise à jour Mac ignorés sous Windows)'); return; }
  // versions
  assert.strictEqual(mu.compareVersions('1.0.10', '1.0.9'), 1);
  assert.strictEqual(mu.compareVersions('v1.0.1', '1.0.1'), 0);
  assert.strictEqual(mu.compareVersions('1.0.0', '1.0.1'), -1);

  // vrai fichier latest-mac.yml publié par GitHub Actions
  const info = mu.parseLatestMacYml(fs.readFileSync(path.join(__dirname, 'fixtures', 'latest-mac.yml'), 'utf8'));
  assert.strictEqual(info.version, '1.0.1');
  assert.ok(info.zip && /universal-mac\.zip$/.test(info.zip.url), 'zip trouvé');
  assert.ok(info.zip.sha512.length > 80 && info.zip.size > 1e7);

  // chemins
  assert.strictEqual(mu.appBundlePath('/Applications/Coaching LoL.app/Contents/MacOS/Coaching LoL'), '/Applications/Coaching LoL.app');
  assert.strictEqual(mu.appBundlePath('/usr/bin/node'), null);
  assert.strictEqual(mu.canSelfUpdate('/private/var/folders/x/AppTranslocation/ABC/d/Coaching LoL.app').ok, false);
  assert.strictEqual(mu.canSelfUpdate('/Volumes/Coaching LoL 1.0.1/Coaching LoL.app').ok, false);
  assert.strictEqual(mu.canSelfUpdate('/Applications/Coaching LoL.app', () => {}).ok, true);
  assert.strictEqual(mu.canSelfUpdate('/Applications/Coaching LoL.app', () => { throw new Error('EACCES'); }).ok, false);

  // préparation complète : faux zip servi par un faux GitHub
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'maj-'));
  const src = path.join(tmp, 'src');
  fs.mkdirSync(path.join(src, 'Coaching LoL.app', 'Contents', 'MacOS'), { recursive: true });
  fs.writeFileSync(path.join(src, 'Coaching LoL.app', 'Contents', 'version.txt'), 'v2');
  const zip = path.join(tmp, 'app.zip');
  execFileSync('python3', ['-c', `import shutil; shutil.make_archive(${JSON.stringify(zip.replace(/\.zip$/, ''))}, 'zip', ${JSON.stringify(src)})`]);
  const buf = fs.readFileSync(zip);
  const sha = crypto.createHash('sha512').update(buf).digest('base64');
  let askedUrl = null;
  const fetchImpl = async url => { askedUrl = url; return new Response(buf, { headers: { 'content-length': String(buf.length) } }); };
  const unzip = async (z, d) => execFileSync('python3', ['-c', `import zipfile; zipfile.ZipFile(${JSON.stringify(z)}).extractall(${JSON.stringify(d)})`]);
  const progress = [];
  const work = path.join(tmp, 'work');
  const newApp = await mu.prepareUpdate({ repo: 'moi/depot', info: { version: '1.0.2', zip: { url: 'Coaching-LoL-1.0.2-universal-mac.zip', sha512: sha, size: buf.length } }, workDir: work, fetchImpl, unzip, onProgress: p => progress.push(p) });
  assert.strictEqual(askedUrl, 'https://github.com/moi/depot/releases/download/v1.0.2/Coaching-LoL-1.0.2-universal-mac.zip');
  assert.strictEqual(fs.readFileSync(path.join(newApp, 'Contents', 'version.txt'), 'utf8'), 'v2');
  assert.strictEqual(progress[progress.length - 1], 100);

  // fichier abîmé → refus
  await assert.rejects(mu.prepareUpdate({ repo: 'moi/depot', info: { version: '1.0.2', zip: { url: 'x.zip', sha512: 'faux', size: buf.length } }, workDir: path.join(tmp, 'w2'), fetchImpl, unzip }), /abîmé/);

  // échange des dossiers par le script, après la fermeture de l'app (simulée par un process « sleep »)
  const apps = path.join(tmp, 'Applications');
  const oldApp = path.join(apps, 'Coaching LoL.app');
  fs.mkdirSync(path.join(oldApp, 'Contents'), { recursive: true });
  fs.writeFileSync(path.join(oldApp, 'Contents', 'version.txt'), 'v1');
  const fakeApp = spawn('sleep', ['1']);
  const log = path.join(tmp, 'maj.log');
  const t0 = Date.now();
  const child = mu.launchSwap({ pid: fakeApp.pid, oldApp, newApp, workDir: work, relaunch: false, logPath: log, spawnImpl: (c, a, o) => spawn(c, a, { ...o, detached: false }) });
  child.ref(); await new Promise(r => child.on('exit', r));
  assert.ok(Date.now() - t0 >= 900, "le script attend la fermeture de l'app");
  assert.strictEqual(fs.readFileSync(path.join(oldApp, 'Contents', 'version.txt'), 'utf8'), 'v2', 'nouvelle version en place');
  assert.ok(!fs.existsSync(path.join(work, 'ancienne.app')), 'ancienne version supprimée');
  assert.ok(/ok/.test(fs.readFileSync(log, 'utf8')));

  // échec simulé (nouvelle version absente) → l'ancienne app reste en place
  fs.writeFileSync(path.join(oldApp, 'Contents', 'version.txt'), 'v2');
  const child2 = mu.launchSwap({ pid: 999999, oldApp, newApp: path.join(tmp, 'inexistante.app'), workDir: work, relaunch: false, logPath: log, spawnImpl: (c, a, o) => spawn(c, a, { ...o, detached: false }) });
  child2.ref(); await new Promise(r => child2.on('exit', r));
  assert.strictEqual(fs.readFileSync(path.join(oldApp, 'Contents', 'version.txt'), 'utf8'), 'v2', "l'app est remise en place");

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('✅ Mise à jour Mac : tests OK');
})().catch(e => { console.error(e); process.exit(1); });
