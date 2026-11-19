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
    // espion des messages affichés (certains passent vite)
    await js(`window.__toasts = []; { const t0 = toast; toast = function (m) { window.__toasts.push(String(m)); return t0.apply(this, arguments); }; } 0`);
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
      postes: [...c.querySelectorAll('.lv-pos')].map(x => x.textContent.trim()),
      allies: [...c.querySelectorAll('.lv-face .lv-row:not(.mirror) .lv-cname')].map(x => x.childNodes[0].textContent.trim()),
      adversaires: [...c.querySelectorAll('.lv-face .lv-row.mirror .lv-cname')].map(x => x.childNodes[0].textContent.trim()),
      texte: c.textContent.replace(/\\s+/g, ' ').trim() }))`);
    await shot('l2-en-direct');
    await js(`document.querySelectorAll('.lv-card')[1].scrollIntoView({ block: 'start' }); 0`);
    await shot('l3-en-direct-2e-partie');
    await js(`document.querySelector('#page').scrollTop = 0; 0`);
    // Regarder
    await js(`document.querySelector('.lv-card [data-action="live-watch"]').click(); 0`);
    await until(`window.__toasts.some(t => /s'ouvre en mode spectateur/.test(t))`, 15000);
    out.toastRegarder = await js(`window.__toasts.find(t => /s'ouvre en mode spectateur/.test(t))`);
    out.spectateur = JSON.parse(fs.readFileSync(path.join(data, 'spectateur.json'), 'utf8'));
    await shot('l4-regarder');
    await hideToast();
    // le faux jeu se ferme tout de suite : l'app le relance d'elle-même
    await until(`window.__toasts.some(t => /nouvelle tentative/.test(t))`, 15000);
    out.toastRelance = await js(`window.__toasts.find(t => /nouvelle tentative/.test(t))`);
    await wait(1500);
    out.lancements = Number(fs.readFileSync(path.join(dir, 'lancements'), 'utf8'));
    out.journalLancement = fs.readFileSync(path.join(dir, 'lancements.log'), 'utf8').split('\n')[0];
    await shot('l4b-relance');
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
    // smurf de Questinou : pseudo inconnu refusé, puis le bon
    const editSmurf = async v => {
      await js(`state.page = 'joueurs'; render(); document.querySelector('[data-action="edit-player"][data-id="p4"]').click(); 0`);
      await wait(500);
      await js(`document.querySelector('#player-form [name="smurfs"]').value = ${JSON.stringify(v)}; document.querySelector('#player-form').requestSubmit(); 0`);
    };
    await editSmurf('Inconnu#XXX');
    out.toastSmurfInconnu = await toastText();
    await hideToast();
    await js(`closeModal(); 0`);
    await editSmurf('Quest Smurf#EUW');
    await until(`(state.data.players.find(p => p.id === 'p4').smurfs || []).length === 1`);
    out.smurfsEnregistres = await js(`state.data.players.find(p => p.id === 'p4').smurfs`);
    await hideToast();
    await js(`state.page = 'joueurs'; render(); 0`);
    out.ficheJoueur = await js(`[...document.querySelectorAll('.pcard')].find(c => c.textContent.includes('UCE Questinou')).textContent.replace(/\\s+/g, ' ')`);
    await shot('l6b-joueurs-smurf');
    await until(`state.data.live.games.length === 3`, 20000);
    out.partiesAvecSmurf = 3;
    await js(`state.page = 'direct'; render(); 0`);
    await wait(500);
    out.carteSmurf = await js(`(() => { const c = [...document.querySelectorAll('.lv-card')].find(x => x.textContent.includes('smurf')); return { titre: c.querySelector('.lv-title').textContent.replace(/\\s+/g, ' ').trim(), texte: c.textContent.replace(/\\s+/g, ' ') }; })()`);
    await js(`[...document.querySelectorAll('.lv-card')].find(x => x.textContent.includes('smurf')).scrollIntoView({ block: 'start' }); 0`);
    await shot('l6c-en-direct-smurf');
    await js(`document.querySelector('#page').scrollTop = 0; 0`);
    // la partie de Kioga et HaveHope se termine ; Uawawa lance une partie (notification)
    await js(`state.page = 'direct'; render(); 0`);
    await riot('/__fin');
    await until(`state.data.live.games.length === 2`, 20000);
    out.apresFin = await js(`state.data.live.games.length`);
    await riot('/__nouvelle');
    await until(`window.__toasts.some(t => /Partie classée en cours/.test(t) && /UCE Uawawa/.test(t))`, 20000);
    out.notification = await js(`window.__toasts.find(t => /Partie classée en cours/.test(t) && /UCE Uawawa/.test(t))`);
    out.notificationSmurf = await js(`window.__toasts.find(t => /sur son smurf/.test(t)) || ''`);
    await shot('l7-notification');
    // plus personne en partie
    await riot('/__plus-rien');
    await until(`state.data.live.games.length === 0`, 20000);
    await wait(500);
    out.vide = await js(`document.querySelector('.lv-empty') ? document.querySelector('.lv-empty').textContent.replace(/\\s+/g, ' ').trim() : ''`);
    out.badgeVide = await js(`document.querySelector('.nav-badge') ? document.querySelector('.nav-badge').textContent : null`);
    await shot('l8-personne');
    // moments clés d'une partie (fenêtre ouverte depuis le détail de la partie)
    await js(`state.playerId = 'p1'; state.page = 'parties'; render(); document.querySelector('[data-action="game"]').click(); 0`);
    await wait(500);
    await js(`document.querySelector('[data-action="moments"]').click(); 0`);
    await until(`document.querySelectorAll('.mo-row').length > 0`, 20000);
    await wait(800);
    const mo = {};
    mo.lignes = await js(`document.querySelectorAll('.mo-row').length`);
    mo.titres = await js(`[...document.querySelectorAll('.mo-row b')].map(b => b.textContent.trim())`);
    mo.premier = await js(`document.querySelector('.mo-row.on .mo-t').textContent.trim()`);
    mo.pins = await js(`document.querySelectorAll('.mo-pin').length`);
    await shot('l9-moments');
    await js(`[...document.querySelectorAll('.mo-row')].find(r => r.querySelector('.mo-t').textContent.trim() === '12:00').click(); 0`);
    await wait(700);
    mo.carteApresClic = await js(`document.querySelector('.mo-maptime b').textContent.trim()`);
    await shot('l10-moments-dragon');
    await js(`document.querySelector('[data-action="mo-copy"]').click(); 0`);
    await wait(600);
    mo.copie = require('electron').clipboard.readText();
    // deuxième ouverture : lue sur le disque
    await js(`closeModal(); document.querySelector('[data-action="moments"]').click(); 0`);
    await until(`document.querySelectorAll('.mo-row').length > 0`, 20000);
    mo.fichier = fs.existsSync(path.join(data, 'moments', 'p1_EUW1_7300000099.json'));
    out.moments = mo;
    // vidéos : le faux client télécharge le replay, le faux jeu répond à la Replay API, l'app filme l'écran
    const vd = { etapes: [] };
    try {
      await js(`window.__vs = []; window.api.onVideoStatus(v => window.__vs.push(v)); 0`);
      await js(`document.querySelector('[data-action="mo-film"]').click(); 0`);
      await until(`window.__vs.some(v => v.done || v.error)`, 90000);
      const vs = await js(`window.__vs`);
      vd.etapes = vs.map(v => v.text || v.error || '');
      const err = vs.find(v => v.error);
      if (err) vd.erreur = err.error;
      vd.fin = (vs.find(v => v.done) || {}).text;
      await until(`!!document.querySelector('.mo-video video')`, 15000);
      vd.video = await js(`document.querySelector('.mo-video video').src`);
      await wait(2500);
      vd.lecture = await js(`(() => { const v = document.querySelector('.mo-video video'); return v.readyState >= 1 ? (v.videoWidth || 0) : 0; })()`);
      await shot('l11-video');
      const mf = JSON.parse(fs.readFileSync(path.join(data, 'moments', 'p1_EUW1_7300000099.json'), 'utf8'));
      vd.extraits = mf.clips;
      vd.camera = mf.camera;
      const vdir = path.join(data, 'videos', 'p1_EUW1_7300000099');
      vd.fichiers = fs.readdirSync(vdir).map(f => ({ f, taille: fs.statSync(path.join(vdir, f)).size }));
      vd.gameCfg = fs.readFileSync(path.join(dir, 'Jeux', 'League of Legends.app', 'Contents', 'LoL', 'Config', 'game.cfg'), 'utf8');
      // suppression
      await js(`window.confirm = () => true; document.querySelector('[data-action="mo-unfilm"]').click(); 0`);
      await until(`!document.querySelector('.mo-video')`, 10000);
      vd.apresSuppression = fs.existsSync(vdir) ? fs.readdirSync(vdir).length : 0;
    } catch (e) { vd.erreur = vd.erreur || String(e.stack || e); }
    out.videos = vd;
  } catch (e) {
    out.exception = e.stack || String(e);
    try { await shot('erreur'); } catch (x) { /* rien */ }
  }
  fs.writeFileSync(path.join(dir, 'resultat.json'), JSON.stringify(out, null, 1));
  app.quit();
};
