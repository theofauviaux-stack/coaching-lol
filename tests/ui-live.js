// Scénario « parties en direct » vu de l'app du coach (lancé par tests/e2e-live.js).
module.exports = async function ({ app, win, fs, path }) {
  const dir = process.env.SYNC_DIR;
  const data = process.env.COACHING_LOL_DATA;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const js = code => win.webContents.executeJavaScript(code);
  const shot = async name => { await wait(700); fs.writeFileSync(path.join(dir, name + '.png'), (await win.webContents.capturePage()).toPNG()); };
  const until = async (code, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await js(code)) return true; await wait(300); } throw new Error('délai dépassé : ' + code); };
  const type = async code => { for (const k of code) { await js(`document.querySelector('[data-key="${k}"]').click()`); await wait(80); } await wait(900); };
  const riot = p => new Promise((resolve, reject) => require('http').get(process.env.COACHING_LOL_RIOT + p, r => { r.resume(); r.on('end', resolve); }).on('error', reject));
  const toastText = async () => { await until(`!document.querySelector('#toast').classList.contains('hidden')`, 15000); return js(`document.querySelector('#toast').textContent.trim()`); };
  const hideToast = () => js(`document.querySelector('#toast').classList.add('hidden'); 0`);
  const out = {};
  try {
    win.setSize(1440, 900);
    await wait(1200);
    await type('4821');
    await until(`state.data.live && state.data.live.games && state.data.live.games.length === 2`, 40000);
    out.parties = await js(`state.data.live.games.length`);
    await wait(500);
    // accueil : pastille « En partie » à côté des joueurs en classée
    out.pastilles = await js(`[...document.querySelectorAll('.row-link')].filter(r => r.querySelector('.live-chip')).map(r => r.querySelector('.t b').textContent)`);
    out.badge = await js(`document.querySelector('.nav-badge') ? document.querySelector('.nav-badge').textContent : null`);
    await shot('l1-accueil');
    // page « En direct »
    await js(`document.querySelector('.live-chip').click(); 0`);
    await wait(600);
    out.page = await js(`state.page`);
    out.cartes = await js(`[...document.querySelectorAll('.lv-card')].map(c => ({
      titre: c.querySelector('.lv-title').textContent.replace(/\\s+/g, ' ').trim(),
      lignes: c.querySelectorAll('.lv-row').length, nous: c.querySelectorAll('.lv-row.me').length,
      bans: c.querySelectorAll('.lv-ban').length, chrono: c.querySelector('.lv-clock').textContent.trim(),
      texte: c.textContent.replace(/\\s+/g, ' ').trim() }))`);
    await shot('l2-en-direct');
    await js(`document.querySelectorAll('.lv-card')[1].scrollIntoView({ block: 'start' }); 0`);
    await shot('l3-en-direct-2e-partie');
    await js(`document.querySelector('#page').scrollTop = 0; 0`);
    // Regarder
    await js(`document.querySelector('.lv-card [data-action="live-watch"]').click(); 0`);
    out.toastRegarder = await toastText();
    out.spectateur = JSON.parse(fs.readFileSync(path.join(data, 'spectateur.json'), 'utf8'));
    await shot('l4-regarder');
    await hideToast();
    // jeu introuvable : message clair
    fs.rmSync(path.join(data, 'spectateur.json'));
    await js(`window.api.saveSettings({ lolPath: '/nulle/part' }).then(r => { state.data = r.data; render(); }); 0`);
    await wait(800);
    await js(`document.querySelector('.lv-card [data-action="live-watch"]').click(); 0`);
    out.toastIntrouvable = await toastText();
    out.alerteIntrouvable = await js(`!!document.querySelector('.lv-card .bk-alert')`);
    await shot('l5-introuvable');
    await hideToast();
    await js(`window.api.saveSettings({ lolPath: ${JSON.stringify(path.join(dir, 'Jeux'))} }).then(r => { state.data = r.data; render(); }); 0`);
    await wait(800);
    // réglage dans Paramètres
    await js(`state.page = 'parametres'; state.settingsTab = 'general'; render(); document.getElementById('spectateur').scrollIntoView({ block: 'start' }); 0`);
    out.reglage = await js(`document.getElementById('spectateur').textContent.replace(/\\s+/g, ' ').trim()`);
    await shot('l6-parametres');
    // la partie de Kioga et HaveHope se termine ; Uawawa lance une partie (notification)
    await js(`state.page = 'direct'; render(); 0`);
    await riot('/__fin');
    await until(`state.data.live.games.length === 1`, 20000);
    out.apresFin = await js(`state.data.live.games.length`);
    await riot('/__nouvelle');
    out.notification = await toastText();
    await shot('l7-notification');
    // plus personne en partie
    await riot('/__plus-rien');
    await until(`state.data.live.games.length === 0`, 20000);
    await wait(500);
    out.vide = await js(`document.querySelector('.lv-empty') ? document.querySelector('.lv-empty').textContent.replace(/\\s+/g, ' ').trim() : ''`);
    out.badgeVide = await js(`document.querySelector('.nav-badge') ? document.querySelector('.nav-badge').textContent : null`);
    await shot('l8-personne');
  } catch (e) {
    out.exception = e.stack || String(e);
    try { await shot('erreur'); } catch (x) { /* rien */ }
  }
  fs.writeFileSync(path.join(dir, 'resultat.json'), JSON.stringify(out, null, 1));
  app.quit();
};
