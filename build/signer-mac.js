// Signature de l'app Mac, juste après l'assemblage de l'app universelle (Intel + Apple Silicon) et avant
// la création du .dmg et du .zip.
//
// Pourquoi : macOS rattache l'autorisation « Enregistrement de l'écran » (vidéos des moments) à la signature de
// l'app. Sans signature valide, la case peut être cochée sans effet, et une signature « ad hoc » ordinaire
// change à chaque version (l'autorisation serait perdue à chaque mise à jour). On signe donc « ad hoc » avec
// une exigence désignée fixe : « c'est l'app com.theofauviaux.coachinglol ». L'autorisation donnée une fois
// reste valable pour les versions suivantes. Pas de certificat ni de compte Apple nécessaires.
const { execFileSync } = require('child_process');
const path = require('path');

const UNIVERSAL = 4; // Arch.universal d'electron-builder

exports.default = async function signerMac(context) {
  if (context.electronPlatformName !== 'darwin') return;
  if (context.arch !== UNIVERSAL) return; // les moitiés x64 et arm64 sont réunies puis signées ensemble
  const appId = context.packager.appInfo.id;
  const app = path.join(context.appOutDir, context.packager.appInfo.productFilename + '.app');
  const run = args => execFileSync('/usr/bin/codesign', args, { stdio: 'inherit' });
  // 1) tout le contenu (frameworks, assistants) avec une signature ad hoc ordinaire
  run(['--force', '--deep', '--sign', '-', '--timestamp=none', app]);
  // 2) l'app elle-même, avec l'exigence désignée fixe
  run(['--force', '--sign', '-', '--timestamp=none', '-r=designated => identifier "' + appId + '"', app]);
  // 3) contrôle (échoue si la signature est invalide) et journal de l'exigence
  run(['--verify', '--deep', '--strict', '--verbose=2', app]);
  run(['-d', '-r-', app]);
};
