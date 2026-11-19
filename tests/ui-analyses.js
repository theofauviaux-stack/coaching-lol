// Scénario « analyse d'une partie » vu des deux apps (lancé par tests/e2e-analyses.js). PHASE=coach ou joueur.
// Le joueur filme ses moments chez lui et envoie 2 vidéos commentées ; le coach regarde, répond ; le joueur répond ;
// le coach termine l'analyse (vidéos effacées du serveur).
module.exports = async function ({ app, win, fs, path }) {
  const dir = process.env.SYNC_DIR;
  const data = process.env.COACHING_LOL_DATA;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const js = code => win.webContents.executeJavaScript(code);
  const shot = async name => { await wait(700); fs.writeFileSync(path.join(dir, name + '.png'), (await win.webContents.capturePage()).toPNG()); };
  const until = async (code, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await js(code)) return true; await wait(300); } throw new Error('délai dépassé : ' + code); };
  const waitFile = async (name, ms = 180000) => { const t = Date.now(); while (!fs.existsSync(path.join(dir, name))) { if (Date.now() - t > ms) throw new Error('attente ' + name); await wait(250); } };
  const mark = name => fs.writeFileSync(path.join(dir, name), '1');
  const type = async code => { for (const k of code) { await js(`document.querySelector('[data-key="${k}"]').click()`); await wait(80); } await wait(900); };
  const fill = (sel, text) => js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.value = ${JSON.stringify(text)}; e.dispatchEvent(new Event('input', { bubbles: true })); return 0; })()`);
  const toasts = () => js(`window.__toasts`);
  const videoOk = async () => {
    await until(`!!document.querySelector('.mo-video video')`, 20000);
    await wait(2500);
    return js(`(() => { const v = document.querySelector('.mo-video video'); return { src: v.src, largeur: v.readyState >= 1 ? v.videoWidth : 0, erreur: v.error ? v.error.code : null }; })()`);
  };
  const out = { phase: process.env.PHASE };
  try {
    win.setSize(1440, 900);
    await wait(1200);
    await js(`window.confirm = () => true; window.__toasts = []; { const t0 = toast; toast = function (m) { window.__toasts.push(String(m)); return t0.apply(this, arguments); }; } 0`);
    if (process.env.PHASE === 'joueur') {
      await type('7391');
      await until(`state.data.session && state.data.session.role === 'joueur' && state.data.games.length > 0`, 30000);
      out.menu = await js(`[...document.querySelectorAll('.nav span')].map(s => s.textContent)`);
      // Parties › la partie › Moments clés (lus sur le serveur)
      await js(`state.page = 'parties'; render(); document.querySelector('[data-action="game"]').click(); 0`);
      await until(`!!document.querySelector('[data-action="moments"]')`);
      await js(`document.querySelector('[data-action="moments"]').click(); 0`);
      await until(`document.querySelectorAll('.mo-row').length > 0`, 20000);
      out.boutons = await js(`[...document.querySelectorAll('.mo-head .btn')].map(b => b.textContent.replace(/\\s+/g, ' ').trim())`);
      await shot('a1-moments-joueur');
      // filmer depuis le replay (faux client LoL + faux jeu)
      await js(`document.querySelector('[data-action="mo-film"]').click(); 0`);
      await until(`window.__toasts.some(t => /Vidéos :/.test(t))`, 90000);
      out.finTournage = (await toasts()).find(t => /Vidéos :/.test(t));
      out.videoLocale = await videoOk();
      out.fichiers = fs.readdirSync(path.join(data, 'videos', 'p1_EUW1_7300000099')).sort();
      // choisir 2 vidéos sur 4, les commenter, envoyer
      await js(`document.querySelector('[data-action="mo-send"]').click(); 0`);
      await until(`document.querySelectorAll('.sd-card').length > 0`);
      out.cartes = await js(`document.querySelectorAll('.sd-card').length`);
      await js(`(() => { const c = document.querySelectorAll('.sd-card input[type=checkbox]'); c[1].click(); c[2].click(); return 0; })()`);
      await fill('.sd-card textarea', 'Je pensais que leur jungler était bot, je n\'avais pas de ward.');
      await fill('.sd-card:nth-child(4) textarea', 'Combat au mid : je suis arrivé trop tard ?');
      await fill('#sd-note', 'Je veux travailler mes placements de wards en lane.');
      out.total = await js(`document.querySelector('#sd-total').textContent`);
      await shot('a2-envoi-joueur');
      await js(`document.querySelector('[data-action="send-go"]').click(); 0`);
      await until(`state.moments && state.moments.mode === 'analysis' && !!state.moments.analysis && !!document.querySelector('.an-thread')`, 60000);
      out.messageEnvoi = (await toasts()).find(t => /envoyée au coach/.test(t));
      out.filGeneral = await js(`document.querySelector('.an-thread').textContent.replace(/\\s+/g, ' ').trim()`);
      out.boutonsApres = await js(`[...document.querySelectorAll('.mo-head .btn')].map(b => b.textContent.trim())`);
      await shot('a3-analyse-joueur');
      mark('envoye');
      // réponse du coach (notification, puis message dans le fil du moment)
      await until(`state.data.analyses.list[0].comments.some(c => c.author === 'coach')`, 120000);
      await until(`window.__toasts.some(t => /Réponse du coach/.test(t))`, 15000);
      out.notification = (await toasts()).find(t => /Réponse du coach/.test(t));
      await until(`document.querySelectorAll('.mo-cnt').length >= 2`, 15000); // compteur mis à jour sans fermer la fenêtre
      await js(`document.querySelector('.mo-row[data-v="' + state.moments.data.moments.findIndex(x => x.t === 390000) + '"]').click(); 0`);
      await until(`!!document.querySelector('.an-msg.coach')`);
      out.filMoment = await js(`[...document.querySelectorAll('.an-msg')].map(m => m.querySelector('.an-who').firstChild.textContent.trim() + ' : ' + m.querySelector('.an-txt').textContent)`);
      out.videoEnLigne = await videoOk();
      await fill('#an-text', 'Compris, je pose une ward tri-brush à 5:30.');
      await js(`document.querySelector('[data-action="an-send"]').click(); 0`);
      await until(`document.querySelectorAll('.an-msg').length === 3`);
      await shot('a6-discussion-joueur');
      mark('joueur-a-repondu');
      // fin de l'analyse par le coach
      await until(`state.data.analyses.list[0].status === 'terminee'`, 120000);
      await until(`/Analyse terminée/.test(document.querySelector('.an-thread') ? document.querySelector('.an-thread').textContent : '')`, 15000);
      out.fin = await js(`document.querySelector('.an-thread').textContent.replace(/\\s+/g, ' ').trim()`);
      out.notifFin = (await toasts()).find(t => /Analyse terminée/.test(t));
      await js(`closeModal(); state.page = 'analyses'; render(); 0`);
      await wait(500);
      out.liste = await js(`[...document.querySelectorAll('.table tr.click')].map(r => r.textContent.replace(/\\s+/g, ' ').trim())`);
      await shot('a8-liste-joueur');
    } else {
      await type('4821');
      await until(`state.data.coach && state.data.coach.cloud.linked`);
      // la partie arrive : notification, pastille, page Analyses
      await until(`state.data.analyses && state.data.analyses.list.length === 1`, 240000);
      await until(`window.__toasts.some(t => /Partie à analyser/.test(t))`, 15000);
      out.notification = (await toasts()).find(t => /Partie à analyser/.test(t));
      await wait(300);
      out.pastille = await js(`(() => { const b = document.querySelector('[data-page="analyses"] .nav-badge'); return b ? b.textContent : null; })()`);
      await js(`document.querySelector('[data-page="analyses"]').click(); 0`);
      await wait(600);
      out.liste = await js(`[...document.querySelectorAll('.table tr.click')].map(r => r.textContent.replace(/\\s+/g, ' ').trim())`);
      await shot('a4-liste-coach');
      await js(`document.querySelector('[data-action="analysis-open"]').click(); 0`);
      await until(`!!document.querySelector('.an-thread')`, 20000);
      out.filGeneral = await js(`document.querySelector('.an-thread').textContent.replace(/\\s+/g, ' ').trim()`);
      out.pastilleApres = await js(`(() => { const b = document.querySelector('[data-page="analyses"] .nav-badge'); return b ? b.textContent : null; })()`);
      await js(`document.querySelector('.mo-row[data-v="' + state.moments.data.moments.findIndex(x => x.t === 390000) + '"]').click(); 0`);
      await until(`!!document.querySelector('.an-msg.joueur')`);
      out.filMoment = await js(`[...document.querySelectorAll('.an-msg')].map(m => m.querySelector('.an-txt').textContent)`);
      out.video = await videoOk();
      out.filmes = await js(`document.querySelectorAll('.mo-has').length`);
      await shot('a5-analyse-coach');
      await fill('#an-text', 'Regarde la mini-carte à 6:10 : Kha\'Zix était top. Ward la rivière avant 6:00.');
      await js(`document.querySelector('[data-action="an-send"]').click(); 0`);
      await until(`document.querySelectorAll('.an-msg.coach').length === 1`);
      mark('coach-a-repondu');
      // réponse du joueur : affichée sans fermer la fenêtre, la vidéo continue
      await js(`document.querySelector('.mo-video video').dataset.marque = '1'; 0`);
      await until(`document.querySelectorAll('.an-msg').length === 3`, 120000);
      out.videoGardee = await js(`!!document.querySelector('.mo-video video[data-marque="1"]')`);
      out.filApres = await js(`[...document.querySelectorAll('.an-msg')].map(m => m.querySelector('.an-who').firstChild.textContent.trim())`);
      await shot('a7-discussion-coach');
      // fin de l'analyse
      await js(`document.querySelector('[data-action="an-close"]').click(); 0`);
      await until(`state.moments.analysis.status === 'terminee'`);
      await until(`state.data.analyses.list[0].clipsState === 'effacees'`, 30000);
      out.fin = await js(`document.querySelector('.an-thread').textContent.replace(/\\s+/g, ' ').trim()`);
      await shot('a9-terminee-coach');
      await wait(1500); // laisse le temps au joueur de voir la fin
      // le même joueur sur l'ordinateur du coach (code joueur) : mêmes outils (tournage, envoi, Analyses)
      await js(`closeModal(); document.querySelector('[data-action="logout"]').click(); 0`);
      await until(`state.data.locked`, 10000);
      await type('7391');
      await until(`state.data.session && state.data.session.role === 'joueur' && !!state.data.analyses`, 20000);
      const lo = {};
      lo.menu = await js(`[...document.querySelectorAll('.nav span')].map(s => s.textContent)`);
      await js(`state.page = 'analyses'; render(); 0`);
      await wait(400);
      lo.liste = await js(`[...document.querySelectorAll('.table tr.click')].map(r => r.textContent.replace(/\\s+/g, ' ').trim())`);
      await js(`state.page = 'parties'; render(); document.querySelector('[data-action="game"]').click(); 0`);
      await until(`!!document.querySelector('[data-action="moments"]')`);
      await js(`document.querySelector('[data-action="moments"]').click(); 0`);
      await until(`document.querySelectorAll('.mo-row').length > 0`, 20000);
      lo.boutons = await js(`[...document.querySelectorAll('.mo-head .btn')].map(b => b.textContent.replace(/\\s+/g, ' ').trim())`);
      await js(`document.querySelector('[data-action="mo-film"]').click(); 0`);
      await until(`window.__toasts.some(t => /Vidéos :/.test(t))`, 90000);
      lo.tournage = (await toasts()).find(t => /Vidéos :/.test(t));
      await js(`document.querySelector('[data-action="mo-send"]').click(); 0`);
      await until(`document.querySelectorAll('.sd-card').length > 0`);
      await fill('#sd-note', 'Envoyée depuis l\'ordinateur du coach.');
      await js(`document.querySelector('[data-action="send-go"]').click(); 0`);
      await until(`state.moments && state.moments.mode === 'analysis' && !!document.querySelector('.an-thread')`, 60000);
      lo.envoi = (await toasts()).find(t => /envoyée au coach/.test(t));
      await shot('a10-joueur-sur-ordi-coach');
      out.local = lo;
    }
  } catch (e) {
    out.exception = e.stack || String(e);
    try { await shot('erreur-' + process.env.PHASE); } catch (x) { /* rien */ }
  }
  fs.writeFileSync(path.join(dir, 'resultat-' + process.env.PHASE + '.json'), JSON.stringify(out, null, 1));
  app.quit();
};
