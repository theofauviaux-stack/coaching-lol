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
    return js(`(() => { const v = document.querySelector('.mo-video video'); return { src: v.src, largeur: v.readyState >= 1 ? v.videoWidth : 0, erreur: v.error ? v.error.code : null, duree: String(v.duration) }; })()`);
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
      // encadré « macOS bloque l'enregistrement de l'écran » (affiché sur Mac quand l'autorisation manque)
      await js(`state.moments.perm = 'ecran'; showMoments(); 0`);
      out.encadre = await js(`document.querySelector('.mo-perm') ? document.querySelector('.mo-perm').textContent.replace(/\\s+/g, ' ').trim() : null`);
      await shot('a1b-autorisation-ecran');
      await js(`state.moments.perm = null; showMoments(); 0`);
      // filmer depuis le replay (faux client LoL + faux jeu)
      await js(`window.__vp = []; window.api.onVideoStatus(v => { if (v.text && !v.done && !v.error) window.__vp.push([v.text, v.progress]); }); 0`);
      await js(`document.querySelector('[data-action="mo-film"]').click(); 0`);
      await until(`window.__vp.some(x => /^Enregistrement 2/.test(x[0]))`, 90000);
      out.barre = await js(`(() => { const b = document.querySelector('.mo-bar i'); return b ? { largeur: parseFloat(b.style.width), texte: document.querySelector('.mo-vstatus').textContent.replace(/\\s+/g, ' ').trim() } : null; })()`);
      await shot('a1c-tournage-en-cours');
      await until(`window.__toasts.some(t => /Vidéos :/.test(t))`, 90000);
      out.finTournage = (await toasts()).find(t => /Vidéos :/.test(t));
      out.progression = await js(`window.__vp`);
      out.videoLocale = await videoOk();
      out.fichiers = fs.readdirSync(path.join(data, 'videos', 'p1_EUW1_7300000099')).sort();
      out.navigables = out.fichiers.map(f => require(path.join(__dirname, '..', 'src', 'webm')).isSeekable(fs.readFileSync(path.join(data, 'videos', 'p1_EUW1_7300000099', f))));
      out.journal = fs.readFileSync(path.join(data, 'videos', 'journal.txt'), 'utf8');
      out.touches = fs.readFileSync(path.join(data, 'videos', 'touches.txt'), 'utf8').trim().split('\n');
      // « Refilmer » puis « Annuler l'enregistrement » : tout s'arrête, les 4 vidéos d'avant restent, on peut relancer
      {
        const an = {};
        await js(`window.__vp = []; 0`);
        await js(`document.querySelector('[data-action="mo-film"]').click(); 0`);
        await until(`window.__vp.some(x => /^Enregistrement 1/.test(x[0])) && !!document.querySelector('[data-action="mo-film-cancel"]')`, 60000);
        an.bouton = await js(`document.querySelector('[data-action="mo-film-cancel"]').textContent.replace(/\\s+/g, ' ').trim()`);
        await shot('a1d-annuler-enregistrement');
        await js(`document.querySelector('[data-action="mo-film-cancel"]').click(); 0`);
        an.pendant = await js(`(() => { const b = document.querySelector('[data-action="mo-film-cancel"]'); return b ? [b.disabled, b.textContent.trim()] : null; })()`);
        await until(`window.__toasts.some(t => /Enregistrement annulé/.test(t))`, 30000);
        await wait(300);
        an.toast = (await toasts()).find(t => /Enregistrement annulé/.test(t));
        an.barre = await js(`!!document.querySelector('.mo-vstatus')`);
        an.filmer = await js(`[...document.querySelectorAll('[data-action="mo-film"]')].map(b => b.textContent.replace(/\\s+/g, ' ').trim())`);
        an.fichiers = fs.readdirSync(path.join(data, 'videos', 'p1_EUW1_7300000099')).sort();
        an.temporaire = fs.existsSync(path.join(data, 'videos', 'p1_EUW1_7300000099.nouveau'));
        an.journal = fs.readFileSync(path.join(data, 'videos', 'journal.txt'), 'utf8');
        an.clips = await js(`state.moments.data.clips.length`);
        out.annulation = an;
      }
      // tournage en échec (replays désactivés dans le client LoL) : le journal part chez le coach
      {
        const ech = {};
        fs.writeFileSync(path.join(dir, 'replays-off'), '1');
        await js(`document.querySelector('[data-action="mo-film"]').click(); 0`);
        await until(`window.__toasts.some(t => /replays sont désactivés/.test(t))`, 30000);
        fs.unlinkSync(path.join(dir, 'replays-off'));
        ech.toast = (await toasts()).find(t => /replays sont désactivés/.test(t));
        await wait(300);
        ech.encadre = await js(`document.querySelector('.mo-err') ? document.querySelector('.mo-err').textContent.replace(/\\s+/g, ' ').trim() : ''`);
        out.echec = ech;
      }
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
      // export sur l'ordinateur (vidéos + débrief), puis l'analyse quitte l'app et le serveur
      await js(`document.querySelector('[data-action="analysis-open"]').click(); 0`);
      await until(`!!document.querySelector('[data-action="an-export"]')`, 20000);
      await shot('a8b-avant-export');
      await js(`document.querySelector('[data-action="an-export"]').click(); 0`);
      await until(`window.__toasts.some(t => /Analyse exportée/.test(t))`, 60000);
      out.export = (await toasts()).find(t => /Analyse exportée/.test(t));
      await wait(600);
      out.listeApres = await js(`document.querySelectorAll('.table tr.click').length`);
      out.videosLocales = fs.existsSync(path.join(data, 'videos', 'p1_EUW1_7300000099'));
      await shot('a8c-apres-export');
      // partie personnalisée (scrim) importée depuis l'historique du client LoL
      await js(`closeModal(); state.page = 'parties'; render(); 0`);
      await wait(400);
      out.boutonPerso = await js(`!!document.querySelector('[data-action="custom-open"]')`);
      await js(`document.querySelector('[data-action="custom-open"]').click(); 0`);
      await until(`!!document.querySelector('.cu-table') || !!document.querySelector('#modal-box .mo-err')`, 20000);
      out.persoListe = await js(`[...document.querySelectorAll('.cu-table tr')].slice(1).map(r => r.textContent.replace(/\\s+/g, ' ').trim())`);
      await shot('a9-perso-liste');
      await js(`document.querySelector('[data-action="custom-add"]').click(); 0`);
      await until(`window.__toasts.some(t => /Partie ajoutée/.test(t))`, 20000);
      out.persoAjout = (await toasts()).find(t => /Partie ajoutée/.test(t));
      out.persoApres = await js(`[...document.querySelectorAll('.cu-table .cu-act')].map(c => c.textContent.trim())`);
      await js(`closeModal(); 0`);
      await wait(500);
      out.persoPartie = await js(`(() => { const g = state.data.games.find(x => x.custom); const tr = [...document.querySelectorAll('.table tr.click')].find(r => r.textContent.includes('Perso')); return { g: g && { matchId: g.matchId, champion: g.champion, opponent: g.opponent, kills: g.kills, deaths: g.deaths, cs10: g.cs10, pending: !!g.pending }, ligne: tr ? tr.textContent.replace(/\\s+/g, ' ').trim() : '', sous: document.querySelector('.sub').textContent.replace(/\\s+/g, ' ').trim() }; })()`);
      out.persoMoments = fs.existsSync(path.join(data, 'moments', 'p1_EUW1_7300000777.json'));
      await shot('a9b-perso-parties');
      await js(`[...document.querySelectorAll('.table tr.click')].find(r => r.textContent.includes('Perso')).click(); 0`);
      await until(`!!document.querySelector('[data-action="moments"]')`);
      await js(`document.querySelector('[data-action="moments"]').click(); 0`);
      await until(`document.querySelectorAll('.mo-row').length > 0`, 20000);
      out.persoMomentsLignes = await js(`document.querySelectorAll('.mo-row').length`);
      await shot('a9c-perso-moments');
      await js(`closeModal(); 0`);
      mark('perso-ajoutee');
    } else {
      await type('4821');
      await until(`state.data.coach && state.data.coach.cloud.linked`);
      // la partie arrive : notification, pastille, page Analyses
      await until(`state.data.analyses && state.data.analyses.list.length === 1`, 240000);
      await until(`window.__toasts.some(t => /Partie à analyser/.test(t))`, 15000);
      out.notification = (await toasts()).find(t => /Partie à analyser/.test(t));
      // tournage en échec chez le joueur : notification, journal lisible, puis effacé
      {
        const jr = {};
        await until(`state.data.analyses.filmReports && state.data.analyses.filmReports.length === 1`, 30000);
        await until(`window.__toasts.some(t => /Tournage en échec/.test(t))`, 10000);
        jr.notif = (await toasts()).find(t => /Tournage en échec/.test(t));
        await js(`state.page = 'analyses'; render(); 0`);
        await wait(300);
        jr.ligne = await js(`document.querySelector('.fr-row').textContent.replace(/\\s+/g, ' ').trim()`);
        jr.jauge = await js(`document.querySelector('.st-gauge') ? document.querySelector('.st-gauge').textContent.replace(/\\s+/g, ' ').trim() : ''`);
        await js(`document.querySelector('[data-action="fr-open"]').click(); 0`);
        await until(`!!document.querySelector('.fr-journal')`);
        jr.journal = await js(`document.querySelector('.fr-journal').textContent`);
        await shot('a4c-journal-tournage');
        await js(`closeModal(); document.querySelector('[data-action="fr-done"]').click(); 0`);
        await until(`state.data.analyses.filmReports.length === 0`, 15000);
        out.journalEchec = jr;
      }
      // dossier pour Claude : préparé tout seul sur l'ordinateur du coach (vidéos, dossier de partie, fiche)
      const cdir = process.env.COACHING_LOL_CLAUDE_DIR;
      let fd = null;
      for (const t0 = Date.now(); !fd && Date.now() - t0 < 60000; await wait(300)) {
        const d = fs.existsSync(cdir) ? fs.readdirSync(cdir).filter(n => /\[[0-9a-f]{8}\]$/.test(n)) : [];
        if (d.length) fd = path.join(cdir, d[0]);
      }
      if (!fd) throw new Error('dossier pour Claude absent');
      const man = JSON.parse(fs.readFileSync(path.join(fd, 'a-analyser.json'), 'utf8'));
      out.claudeDossier = { nom: path.basename(fd), racine: fs.readdirSync(cdir).filter(n => !n.startsWith('.')).sort(), fichiers: fs.readdirSync(fd).sort(), videos: fs.readdirSync(path.join(fd, 'videos')).sort(),
        tailles: fs.readdirSync(path.join(fd, 'videos')).map(f => fs.statSync(path.join(fd, 'videos', f)).size), dossier: fs.readFileSync(path.join(fd, 'dossier.txt'), 'utf8').split('\n')[0],
        filmes: man.moments.filter(x => x.video).length, moment: man.moments.find(x => x.t === 390000) };
      await until(`state.data.claude && state.data.claude.waiting === 1`, 20000);
      // Claude écrit sa réponse dans le dossier : l'app la reprend en brouillons
      fs.writeFileSync(path.join(fd, 'analyse-claude.json'), JSON.stringify({ version: 1, analysisId: man.analysisId, general: 'Résumé de Claude : bonne lane, une mort évitable à 6:30.', priorites: ['Ward la rivière avant 6:00', 'Back avec la wave poussée'],
        moments: [{ t: 390000, texte: 'Proposition de Claude pour 6:30 : pas de vision de la rivière, Kha\'Zix arrive par le haut.' }, { t: 123, texte: 'moment inconnu' }] }));
      await until(`window.__toasts.some(t => /Analyse de Claude prête/.test(t))`, 20000);
      out.claudeNotif = (await toasts()).find(t => /Analyse de Claude prête/.test(t));
      out.claudeErreurs = fs.existsSync(path.join(fd, 'erreurs-import.txt')) ? fs.readFileSync(path.join(fd, 'erreurs-import.txt'), 'utf8').trim() : '';
      await wait(300);
      out.pastille = await js(`(() => { const b = document.querySelector('[data-page="analyses"] .nav-badge'); return b ? b.textContent : null; })()`);
      await js(`document.querySelector('[data-page="analyses"]').click(); 0`);
      await wait(600);
      out.liste = await js(`[...document.querySelectorAll('.table tr.click')].map(r => r.textContent.replace(/\\s+/g, ' ').trim())`);
      out.claudeEncadre = await js(`document.querySelector('.an-claude') ? document.querySelector('.an-claude').textContent.replace(/\\s+/g, ' ').trim() : ''`);
      await shot('a4-liste-coach');
      await js(`document.querySelector('[data-action="analysis-open"]').click(); 0`);
      await until(`!!document.querySelector('.an-thread')`, 20000);
      out.filGeneral = await js(`document.querySelector('.an-thread').textContent.replace(/\\s+/g, ' ').trim()`);
      out.claudeGeneral = await js(`({ bandeau: !!document.querySelector('.an-ai'), texte: document.querySelector('#an-text').value, pastilles: document.querySelectorAll('.mo-ai').length })`);
      await shot('a4b-proposition-claude');
      out.pastilleApres = await js(`(() => { const b = document.querySelector('[data-page="analyses"] .nav-badge'); return b ? b.textContent : null; })()`);
      await js(`document.querySelector('.mo-row[data-v="' + state.moments.data.moments.findIndex(x => x.t === 390000) + '"]').click(); 0`);
      await until(`!!document.querySelector('.an-msg.joueur')`);
      out.filMoment = await js(`[...document.querySelectorAll('.an-msg')].map(m => m.querySelector('.an-txt').textContent)`);
      out.claudeMoment = await js(`({ bandeau: !!document.querySelector('.an-ai'), texte: document.querySelector('#an-text').value })`);
      out.video = await videoOk();
      out.videosGardees = (() => { try { return fs.readdirSync(path.join(data, 'videos-serveur')).map(d => fs.readdirSync(path.join(data, 'videos-serveur', d))).flat(); } catch (e) { return []; } })();
      out.filmes = await js(`document.querySelectorAll('.mo-has').length`);
      await shot('a5-analyse-coach');
      await fill('#an-text', 'Regarde la mini-carte à 6:10 : Kha\'Zix était top. Ward la rivière avant 6:00.');
      await js(`document.querySelector('[data-action="an-send"]').click(); 0`);
      await until(`document.querySelectorAll('.an-msg.coach').length === 1`);
      out.claudeApresEnvoi = await js(`({ bandeau: !!document.querySelector('.an-ai'), pastilles: document.querySelectorAll('.mo-ai').length })`);
      mark('coach-a-repondu');
      // réponse du joueur : affichée sans fermer la fenêtre, la vidéo continue
      await js(`document.querySelector('.mo-video video').dataset.marque = '1'; 0`);
      await until(`document.querySelectorAll('.an-msg').length === 3`, 120000);
      out.videoGardee = await js(`!!document.querySelector('.mo-video video[data-marque="1"]')`);
      out.filApres = await js(`[...document.querySelectorAll('.an-msg')].map(m => m.querySelector('.an-who').firstChild.textContent.trim())`);
      await shot('a7-discussion-coach');
      // dessin sur la vidéo, joint à un message ; lien « 15:30 » vers l'autre extrait
      {
        const ds = {};
        ds.liens = await js(`[...document.querySelectorAll('.an-msg.coach a.an-time')].map(a => a.textContent)`);
        await until(`document.querySelector('.mo-video video') && document.querySelector('.mo-video video').videoWidth > 0`, 15000);
        await js(`document.querySelector('[data-action="an-draw"]').click(); 0`);
        await until(`!!document.querySelector('.mo-video .an-ov.edit')`, 10000);
        const trace = (a, b) => js(`(() => { const ov = document.querySelector('.an-ov.edit'); const r = ov.getBoundingClientRect(); const ev = (t, x, y) => ov.dispatchEvent(new PointerEvent(t, { clientX: r.left + r.width * x, clientY: r.top + r.height * y, pointerId: 1, bubbles: true })); ev('pointerdown', ${a[0]}, ${a[1]}); ev('pointermove', ${(a[0] + b[0]) / 2}, ${(a[1] + b[1]) / 2}); ev('pointermove', ${b[0]}, ${b[1]}); ev('pointerup', ${b[0]}, ${b[1]}); return 0; })()`);
        await trace([0.2, 0.3], [0.6, 0.6]);
        await js(`document.querySelector('[data-action="draw-tool"][data-v="cercle"]').click(); 0`);
        await trace([0.55, 0.5], [0.8, 0.85]);
        ds.formes = await js(`Draw.d.shapes.map(x => x.k)`);
        await shot('a7b-dessin');
        await js(`document.querySelector('[data-action="draw-attach"]').click(); 0`);
        await until(`!!document.querySelector('.an-attach')`);
        await fill('#an-text', 'Ici tu aurais dû reculer, comme à 15:30.');
        await js(`document.querySelector('[data-action="an-send"]').click(); 0`);
        await until(`!!document.querySelector('.an-msg.coach .an-draw-chip')`, 15000);
        ds.envoye = await js(`(() => { const c = state.moments.analysis.comments[state.moments.analysis.comments.length - 1]; return { texte: c.text, dessin: c.drawing && { file: c.drawing.file, formes: c.drawing.shapes.map(x => x.k), w: c.drawing.w } }; })()`);
        await js(`document.querySelector('.an-msg.coach .an-draw-chip').click(); 0`);
        await until(`!!document.querySelector('.an-ov.view svg line')`, 10000);
        ds.vu = await js(`document.querySelectorAll('.an-ov.view svg ellipse').length`);
        await shot('a7c-dessin-vu');
        await js(`[...document.querySelectorAll('.an-msg.coach a.an-time')].find(a => a.textContent === '15:30').click(); 0`);
        await until(`document.querySelector('.mo-video video') && document.querySelector('.mo-video video').dataset.file === '04_15m25.webm'`, 10000);
        ds.lien = await js(`document.querySelector('.mo-video .mo-maptime').textContent.replace(/\\s+/g, ' ').trim()`);
        out.dessin = ds;
      }
      // priorités de l'analyse → objectifs suivis sur le tableau de bord du joueur
      {
        const ob = {};
        await js(`document.querySelector('[data-action="an-goals"]').click(); 0`);
        await until(`!!document.querySelector('.an-goals')`);
        ob.lignes = await js(`state.moments.goalRows.map(r => [r.on, r.text, r.kpi, r.target])`);
        await shot('a7d-objectifs');
        await js(`document.querySelector('[data-action="an-goals-save"]').click(); 0`);
        await until(`window.__toasts.some(t => /ajoutés? au tableau de bord/.test(t))`, 10000);
        ob.toast = (await toasts()).find(t => /ajoutés? au tableau de bord/.test(t));
        ob.objectifs = await js(`state.data.players.find(p => p.id === 'p1').goals.map(g => [g.text, g.kpi, g.source, !!g.analysisId])`);
        out.objectifs = ob;
      }
      // fin de l'analyse
      await js(`document.querySelector('[data-action="an-close"]').click(); 0`);
      await until(`state.moments.analysis.status === 'terminee'`);
      await wait(400);
      out.fin = await js(`document.querySelector('.an-thread').textContent.replace(/\\s+/g, ' ').trim()`);
      out.videosApresFin = await js(`state.data.analyses.list[0].clipsState`);
      for (const t0 = Date.now(); fs.existsSync(path.join(fd, 'videos')) && Date.now() - t0 < 20000;) await wait(300);
      out.claudeApresFin = { videos: fs.existsSync(path.join(fd, 'videos')), fichiers: fs.readdirSync(fd).sort(), brouillons: Object.keys(JSON.parse(fs.readFileSync(path.join(data, 'claude-brouillons.json'), 'utf8'))).length };
      await shot('a9-terminee-coach');
      // le joueur exporte : l'analyse disparaît chez le coach
      await until(`state.data.analyses.list.length === 0`, 120000);
      await until(`window.__toasts.some(t => /a exporté cette analyse/.test(t))`, 15000);
      out.apresExport = (await toasts()).find(t => /a exporté cette analyse/.test(t));
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
      // le coach supprime cette 2e analyse : elle disparaît, messages et vidéos effacés, dossier pour Claude retiré
      await js(`closeModal(); document.querySelector('[data-action="logout"]').click(); 0`);
      await until(`state.data.locked`, 10000);
      await type('4821');
      await until(`state.data.coach && state.data.analyses && state.data.analyses.list.length === 1 && state.data.analyses.list[0].status === 'ouverte'`, 60000);
      const sup = { note: await js(`state.data.analyses.list[0].note`) };
      const id8 = (await js(`state.data.analyses.list[0].id`)).slice(0, 8);
      for (const t0 = Date.now(); !fs.readdirSync(cdir).some(n => n.endsWith('[' + id8 + ']')) && Date.now() - t0 < 30000;) await wait(300);
      sup.dossierAvant = fs.readdirSync(cdir).some(n => n.endsWith('[' + id8 + ']'));
      await js(`state.page = 'analyses'; render(); 0`);
      await wait(500);
      sup.boutons = await js(`document.querySelectorAll('.table [data-action="an-delete"]').length`);
      await js(`document.querySelector('.table [data-action="an-delete"]').click(); 0`);
      try { await until(`state.data.analyses.list.length === 0`, 20000); } catch (e) { throw new Error(e.message + ' ; messages : ' + JSON.stringify((await toasts()).slice(-3))); }
      await until(`window.__toasts.some(t => /Analyse supprimée/.test(t))`, 10000);
      sup.message = (await toasts()).find(t => /Analyse supprimée/.test(t));
      sup.dossierApres = fs.readdirSync(cdir).some(n => n.endsWith('[' + id8 + ']'));
      sup.vide = await js(`document.querySelector('.empty') ? document.querySelector('.empty').textContent.trim() : ''`);
      await shot('a11-apres-suppression');
      await wait(4000); // purge des vidéos sur le serveur
      out.suppression = sup;
      // partie personnalisée importée par le joueur : reprise dans les parties du coach
      await waitFile('perso-ajoutee');
      await until(`state.data.games.some(g => g.custom)`, 60000);
      out.persoCoach = await js(`(() => { const g = state.data.games.find(x => x.custom); return { matchId: g.matchId, playerId: g.playerId, custom: g.custom, lpDelta: g.lpDelta }; })()`);
      out.persoMomentsCoach = fs.existsSync(path.join(data, 'moments', 'p1_EUW1_7300000777.json'));
      out.persoStats = await js(`Stats.playerGames(state.data, state.data.players.find(p => p.id === 'p1'), '').some(g => g.custom)`);
      out.persoNotif = await js(`window.__toasts.find(t => /Partie personnalisée ajoutée/.test(t)) || ''`);
      await wait(2500); // la partie part aussi dans le serveur (espace du joueur)
      // tableau de bord du joueur : objectifs suivis, erreurs récurrentes, bilan du mois avec Claude
      {
        const tb = {};
        await js(`closeModal(); state.page = 'dashboard'; state.playerId = 'p1'; render(); 0`);
        await until(`!!document.querySelector('.gl-card')`, 10000);
        tb.objectifs = await js(`[...document.querySelectorAll('.gl-card')].map(c => c.textContent.replace(/\\s+/g, ' ').trim())`);
        await until(`!!document.querySelector('.tr-box')`, 30000);
        tb.tendances = await js(`({ points: document.querySelectorAll('.tr-map > .tr-dot').length, phrases: [...document.querySelectorAll('.tr-said li')].map(l => l.textContent) })`);
        await fill('#gl-text', 'Pas plus de 2 morts avant 15 min');
        await js(`(() => { const x = document.querySelector('#gl-kpi'); x.value = 'Morts avant 15 min'; x.dispatchEvent(new Event('change', { bubbles: true })); return 0; })()`);
        tb.cibleProposee = await js(`document.querySelector('#gl-target').value`);
        await js(`document.querySelector('[data-action="goal-add"]').click(); 0`);
        await until(`state.data.players.find(p => p.id === 'p1').goals.length === 3`, 10000);
        await js(`document.querySelector('[data-action="bilan-prepare"]').click(); 0`);
        const bdir = path.join(cdir, 'Bilans');
        let bf = null;
        for (const t0 = Date.now(); !bf && Date.now() - t0 < 20000; await wait(200)) { const d = fs.existsSync(bdir) ? fs.readdirSync(bdir) : []; if (d.length) bf = path.join(bdir, d[0]); }
        if (!bf) throw new Error('dossier du bilan absent : ' + JSON.stringify((await toasts()).slice(-3)));
        const bm = JSON.parse(fs.readFileSync(path.join(bf, 'a-analyser.json'), 'utf8'));
        tb.bilanDossier = { nom: path.basename(bf), fichiers: fs.readdirSync(bf).sort(), type: bm.type, parties: bm.parties.length, objectifs: bm.objectifsDeTravail.length, erreurs: !!(bm.erreursRecurrentes && bm.erreursRecurrentes.phrases.length) };
        await until(`!!document.querySelector('.bl-card [data-action="bilan-open"]')`, 10000);
        fs.writeFileSync(path.join(bf, 'bilan-claude.json'), JSON.stringify({ bilanId: bm.bilanId, general: 'Bon mois : ta lane progresse.', pointsForts: ['78 CS à 10 min en moyenne'], axes: ['Morts en top lane entre 5 et 10 min'], objectifs: [{ texte: 'Ward la rivière à 2:30', indicateur: 'Vision/min', cible: 1.2 }] }));
        await until(`!!document.querySelector('.bl-draft')`, 20000);
        await until(`window.__toasts.some(t => /Bilan de Claude prêt/.test(t))`, 10000);
        tb.brouillon = await js(`document.querySelector('#bl-text').value`);
        await js(`document.querySelector('.gl-grid').scrollIntoView(); document.querySelector('#page').scrollTop -= 60; 0`);
        await wait(300);
        await shot('a12-tableau-de-bord');
        await js(`document.querySelector('.bl-draft').scrollIntoView(); 0`);
        await wait(300);
        await shot('a12b-bilan-brouillon');
        await js(`document.querySelector('[data-action="bilan-send"]').click(); 0`);
        await until(`window.__toasts.some(t => /Bilan envoyé/.test(t))`, 10000);
        tb.envoi = (await toasts()).find(t => /Bilan envoyé/.test(t));
        tb.envoyes = await js(`document.querySelectorAll('.bl-sent').length`);
        tb.objectifsApres = await js(`state.data.players.find(p => p.id === 'p1').goals.length`);
        await js(`document.querySelector('.bl-sent').scrollIntoView(); document.querySelector('#page').scrollTop -= 300; 0`);
        await wait(300);
        await shot('a13-bilan-envoye');
        await wait(3000); // envoi au serveur (espace du joueur)
        out.tableau = tb;
      }
    }
  } catch (e) {
    out.exception = e.stack || String(e);
    try { await shot('erreur-' + process.env.PHASE); } catch (x) { /* rien */ }
  }
  fs.writeFileSync(path.join(dir, 'resultat-' + process.env.PHASE + '.json'), JSON.stringify(out, null, 1));
  app.quit();
};
