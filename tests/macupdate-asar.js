// Mise à jour Mac, dans Electron : un reste de mise à jour (app décompressée avec son app.asar) dans le dossier de
// travail ne doit pas bloquer la suivante. Dans Electron, « fs » prend les .asar pour des dossiers : l'effacement
// échouait avec ENOTDIR à chaque vérification. Lancé avec node, ce fichier se relance dans Electron.
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

if (!process.versions.electron) {
  if (process.platform === 'win32') { console.log('(test asar de la mise à jour Mac ignoré sous Windows)'); process.exit(0); }
  const r = spawnSync(path.join(__dirname, '..', 'node_modules', '.bin', 'electron'), [__filename], { env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1' }), stdio: 'inherit' });
  process.exit(r.status === null ? 1 : r.status);
}

const assert = require('assert');
const fs = require('original-fs');
const os = require('os');
const crypto = require('crypto');
const asar = require('@electron/asar');
const mu = require('../src/macupdate');

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'maj-asar-'));
  // une app comme celles publiées : Contents/Resources/app.asar
  const appSrc = path.join(tmp, 'src');
  fs.mkdirSync(path.join(appSrc, 'app'), { recursive: true });
  fs.writeFileSync(path.join(appSrc, 'app', 'package.json'), '{"name":"coaching-lol","version":"9.9.9"}');
  const res = path.join(appSrc, 'zip', 'Coaching LoL.app', 'Contents', 'Resources');
  fs.mkdirSync(res, { recursive: true });
  await asar.createPackage(path.join(appSrc, 'app'), path.join(res, 'app.asar'));
  const zip = path.join(tmp, 'app.zip');
  execFileSync('python3', ['-c', `import shutil; shutil.make_archive(${JSON.stringify(zip.replace(/\.zip$/, ''))}, 'zip', ${JSON.stringify(path.join(appSrc, 'zip'))})`]);
  const buf = fs.readFileSync(zip);
  const info = { version: '9.9.9', zip: { url: 'Coaching-LoL-9.9.9-universal-mac.zip', sha512: crypto.createHash('sha512').update(buf).digest('base64'), size: buf.length } };
  const fetchImpl = async () => new Response(buf, { headers: { 'content-length': String(buf.length) } });
  const unzip = async (z, d) => execFileSync('python3', ['-c', `import zipfile; zipfile.ZipFile(${JSON.stringify(z)}).extractall(${JSON.stringify(d)})`]);

  // la preuve que le piège existe bien : le « fs » d'Electron n'arrive pas à effacer une telle app
  const piege = path.join(tmp, 'piege');
  fs.mkdirSync(path.join(piege, 'Contents', 'Resources'), { recursive: true });
  fs.copyFileSync(path.join(res, 'app.asar'), path.join(piege, 'Contents', 'Resources', 'app.asar'));
  assert.throws(() => require('fs').rmSync(piege, { recursive: true, force: true }), /ENOTDIR/);

  // 1re préparation, puis une 2e alors que la 1re app décompressée est encore là (mise à jour jamais installée)
  const work = path.join(tmp, 'coaching-lol-maj');
  const a = await mu.prepareUpdate({ repo: 'moi/depot', info, workDir: work, fetchImpl, unzip });
  assert.ok(fs.statSync(path.join(a, 'Contents', 'Resources', 'app.asar')).isFile());
  const b = await mu.prepareUpdate({ repo: 'moi/depot', info, workDir: work, fetchImpl, unzip });
  assert.strictEqual(b, a);
  assert.ok(fs.statSync(path.join(b, 'Contents', 'Resources', 'app.asar')).isFile(), 'nouvelle app prête malgré le reste');

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('✅ Mise à jour Mac : un reste de mise à jour ne bloque plus (app.asar) : OK');
})().catch(e => { console.error(e); process.exit(1); });
