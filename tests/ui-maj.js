// Accueil (avant le code) et recherche manuelle des mises à jour, vus de l'app (lancé par tests/e2e-maj.js).
// La mise à jour est simulée (COACHING_LOL_FAKE_UPDATE) : recherche, téléchargement, prête, puis « Redémarrer et installer ».
module.exports = async function ({ app, win, fs, path }) {
  const dir = process.env.SYNC_DIR;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const js = code => win.webContents.executeJavaScript(code);
  const shot = async name => { await wait(500); fs.writeFileSync(path.join(dir, name + '.png'), (await win.webContents.capturePage()).toPNG()); };
  const until = async (code, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await js(code)) return true; await wait(200); } throw new Error('délai dépassé : ' + code); };
  const click = async sel => { const ok = await js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.click(); return true; })()`); if (!ok) throw new Error('absent : ' + sel); await wait(250); };
  const key = k => js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true })); 0`);
  const type = async code => { for (const k of code) { await click(`[data-key="${k}"]`); await wait(80); } await wait(900); };
  const view = () => js(`({ accueil: !!document.querySelector('.welcome .wl-eye'), pave: !!document.querySelector('.login-card .keypad'), code: state.code })`);
  const out = { erreurs: [] };
  win.webContents.on('console-message', (e, level, msg) => { if (level >= 3) out.erreurs.push(msg); });
  try {
    await wait(1200);
    // accueil
    out.depart = await view();
    out.texte = await js(`document.querySelector('.welcome').innerText.replace(/\\s+/g, ' ').trim()`);
    // l'œil suit la souris
    await js(`document.dispatchEvent(new MouseEvent('mousemove', { clientX: 1300, clientY: 120, bubbles: true })); 0`);
    out.pupille = await js(`document.getElementById('wl-pupil').getAttribute('transform')`);
    await shot('m0-accueil');
    // un chiffre tapé au clavier ouvre le pavé avec ce chiffre ; Échap revient à l'accueil (code effacé)
    await key('4'); await wait(300);
    out.apresChiffre = await view();
    await key('Escape'); await wait(300);
    out.apresEchap = await view();
    // clic sur l'œil, puis clic à côté du pavé : retour à l'accueil
    await click('.wl-eye'); await wait(500);
    out.apresClicOeil = await view();
    await shot('m1-code');
    await js(`document.querySelector('#login').dispatchEvent(new MouseEvent('click', { bubbles: true })); 0`); await wait(300);
    out.apresClicDehors = await view();
    // Entrée ouvre aussi le pavé ; bouton « Accueil » pour revenir
    await key('Enter'); await wait(500);
    out.apresEntree = await view();
    await click('[data-login="back"]'); await wait(300);
    out.apresRetour = await view();
    // connexion coach
    await click('.wl-eye'); await wait(500);
    await type('4821');
    await until(`!document.querySelector('#app').classList.contains('hidden')`);
    // fenêtre des mises à jour depuis la version en bas du menu
    out.version = await js(`document.querySelector('.version[data-action="upd-open"]').textContent.trim()`);
    await click('[data-action="upd-open"]');
    out.fenetre = await js(`document.querySelector('#modal-box .upd-box').innerText.replace(/\\s+/g, ' ').trim()`);
    await click('#modal-box [data-action="upd-check"]');
    await until(`/téléchargement/.test(document.querySelector('#modal-box .upd-box').innerText)`, 5000);
    out.pendant = await js(`document.querySelector('#modal-box .upd-box').innerText.replace(/\\s+/g, ' ').trim()`);
    await shot('m2-telechargement');
    await until(`!!document.querySelector('#modal-box [data-action="upd-install"]')`, 15000);
    out.prete = await js(`document.querySelector('#modal-box .upd-box').innerText.replace(/\\s+/g, ' ').trim()`);
    await shot('m3-prete');
    await click('[data-action="close-modal"]');
    out.versionPrete = await js(`document.querySelector('.version').textContent.trim()`);
    // Paramètres › Général › À propos
    await click('[data-action="go"][data-page="parametres"]');
    await click('[data-action="stab"][data-v="general"]');
    await js(`document.querySelector('#page .upd-box').scrollIntoView({ block: 'center' }); 0`);
    out.parametres = await js(`document.querySelector('#page .upd-box').innerText.replace(/\\s+/g, ' ').trim()`);
    await shot('m4-parametres');
    await click('#page [data-action="upd-install"]');
    await wait(500);
    out.installation = fs.existsSync(path.join(process.env.COACHING_LOL_DATA, 'installation-demandee'));
    // côté joueur : déconnexion → retour à l'accueil, puis la même fenêtre est accessible
    await click('[data-action="logout"]');
    await wait(600);
    out.apresDeconnexion = await view();
    await click('.wl-eye'); await wait(500);
    await type('7391');
    await until(`state.data.session && state.data.session.role === 'joueur'`);
    await click('[data-action="upd-open"]');
    out.joueur = await js(`document.querySelector('#modal-box .upd-box').innerText.replace(/\\s+/g, ' ').trim()`);
    await shot('m5-joueur');
  } catch (e) {
    out.exception = e.stack || String(e);
    try { await shot('erreur-maj'); } catch (x) { /* rien */ }
  }
  fs.writeFileSync(path.join(dir, 'resultat-maj.json'), JSON.stringify(out, null, 1));
  app.quit();
};
