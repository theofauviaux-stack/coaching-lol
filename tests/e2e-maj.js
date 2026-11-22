// Accueil et recherche manuelle des mises à jour, dans Electron (mise à jour simulée, aucun réseau).
// Usage : node tests/e2e-maj.js <dossier de données de départ (coaching-data.json)>
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DIR = '/tmp/e2e-maj';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(path.join(DIR, 'data'), { recursive: true });
const d = JSON.parse(fs.readFileSync(path.join(process.argv[2], 'coaching-data.json'), 'utf8'));
d.players = d.players.filter(p => p.riotId === 'secretalmasty#EUW');
d.players[0].code = '7391';
for (const k of ['coachCodeEnc', 'pushTokenEnc', 'apiKey', 'apiKeyEnc', 'lastPush', 'pushError', 'pushToken']) delete d.settings[k];
d.settings.coachCode = '4821';
fs.writeFileSync(path.join(DIR, 'data', 'coaching-data.json'), JSON.stringify(d));

spawnSync('xvfb-run', ['-a', '-s', '-screen 0 1440x900x24', path.join(__dirname, '..', 'node_modules/.bin/electron'), path.join(__dirname, '..'), '--no-sandbox'], {
  env: Object.assign({}, process.env, { SYNC_DIR: DIR, COACHING_LOL_DATA: path.join(DIR, 'data'), COACHING_LOL_TEST: path.join(__dirname, 'ui-maj.js'), COACHING_LOL_FAKE_UPDATE: '9.9.9', COACHING_LOL_CLOUD: JSON.stringify({ url: 'http://127.0.0.1:9', publicKey: 'x' }) }),
  stdio: 'ignore', timeout: 180000
});
const r = JSON.parse(fs.readFileSync(path.join(DIR, 'resultat-maj.json'), 'utf8'));
console.log(JSON.stringify(r, null, 1));
assert.ok(!r.exception, r.exception);
assert.deepStrictEqual(r.erreurs, []);
// accueil
assert.deepStrictEqual(r.depart, { accueil: true, pave: false, code: '' });
assert.ok(/Coaching LoL/.test(r.texte) && /Clique sur l'œil/.test(r.texte), r.texte);
assert.ok(/^translate\(/.test(r.pupille || ''), "l'œil suit la souris");
assert.ok(r.pupilleDebut && r.pupilleDebut[0] > 0.3 && r.pupilleDebut[0] < 9, 'mouvement progressif au début : ' + JSON.stringify(r.pupilleDebut));
assert.ok(r.pupilleFin && r.pupilleFin[0] > 10 && Math.abs(r.pupilleFin[1]) < 1, 'regard posé sur la cible : ' + JSON.stringify(r.pupilleFin));
assert.strictEqual(r.boucleArretee, true, "l'animation s'arrête quand l'œil est immobile");
assert.deepStrictEqual(r.apresChiffre, { accueil: false, pave: true, code: '4' }, 'un chiffre ouvre le pavé avec ce chiffre');
assert.deepStrictEqual(r.apresEchap, { accueil: true, pave: false, code: '' }, 'Échap revient à l\'accueil');
assert.deepStrictEqual(r.apresClicOeil, { accueil: false, pave: true, code: '' });
assert.deepStrictEqual(r.apresClicDehors, { accueil: true, pave: false, code: '' }, 'clic à côté : accueil');
assert.strictEqual(r.apresEntree.pave, true, 'Entrée ouvre le pavé');
assert.strictEqual(r.apresRetour.accueil, true, 'bouton Accueil');
assert.strictEqual(r.apresDeconnexion.accueil, true, 'déconnexion : retour à l\'accueil');
// mises à jour
assert.ok(/^Version \d/.test(r.version), r.version);
assert.ok(/Rechercher une mise à jour/.test(r.fenetre), r.fenetre);
assert.ok(/9\.9\.9 trouvée : téléchargement/.test(r.pendant), r.pendant);
assert.ok(/9\.9\.9 est prête/.test(r.prete) && /Redémarrer et installer/.test(r.prete), r.prete);
assert.ok(/mise à jour prête/.test(r.versionPrete), r.versionPrete);
assert.ok(/Redémarrer et installer/.test(r.parametres), r.parametres);
assert.strictEqual(r.installation, true, 'installation demandée');
assert.ok(/9\.9\.9 est prête/.test(r.joueur), 'le joueur voit aussi la fenêtre : ' + r.joueur);
console.log('✅ Accueil et recherche manuelle des mises à jour : OK');
