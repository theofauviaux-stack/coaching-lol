// Scénario « cours » vu de l'app (lancé par tests/e2e-cours.js). PHASE=coach ou joueur.
module.exports = async function ({ app, win, fs, path }) {
  const dir = process.env.SYNC_DIR;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const js = code => win.webContents.executeJavaScript(code);
  const shot = async name => { await wait(500); fs.writeFileSync(path.join(dir, name + '.png'), (await win.webContents.capturePage()).toPNG()); };
  const until = async (code, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await js(code)) return true; await wait(300); } throw new Error('délai dépassé : ' + code); };
  const mark = name => fs.writeFileSync(path.join(dir, name), '1');
  const type = async code => { for (const k of code) { await js(`document.querySelector('[data-key="${k}"]').click()`); await wait(80); } await wait(900); };
  const click = async sel => { const ok = await js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.click(); return true; })()`); if (!ok) throw new Error('absent : ' + sel); await wait(250); };
  const out = { phase: process.env.PHASE };
  try {
    await wait(1200);
    if (process.env.PHASE === 'coach') {
      await type('4821');
      await until(`state.data.coach && state.data.coach.cloud.linked`);
      await click('[data-action="go"][data-page="cours"]');
      out.cartes = await js(`document.querySelectorAll('.cs-card').length`);
      await click('[data-action="c-open"][data-id="vagues"]');
      await click('[data-action="c-assign"]');
      await until(`!!(player().courses && player().courses.vagues && player().courses.vagues.assigned)`);
      out.assigne = true;
      // objectif conseillé, depuis la mise en pratique
      await js(`state.cours.step = Courses.steps(Courses.byId('vagues')) - 1; render(); 0`);
      await click('[data-action="c-goal"]');
      await until(`(player().goals || []).some(g => g.kpi === 'Écart or à 10 min')`);
      out.objectif = await js(`(() => { const g = player().goals.find(x => x.kpi === 'Écart or à 10 min'); return { kpi: g.kpi, target: g.target, source: g.source }; })()`);
      await shot('c1-coach-pratique');
      mark('cours-assigne');
      // le joueur valide le cours chez lui : le coach le voit
      await click('[data-action="c-back"]');
      await until(`!!(player().courses.vagues.quiz && player().courses.vagues.quiz.best >= 0.8)`, 120000);
      await until(`/Cours validé/.test(document.querySelector('#toast').textContent)`, 10000).catch(() => {});
      out.notification = await js(`document.querySelector('#toast').textContent.trim()`);
      await wait(400);
      out.carteVagues = await js(`document.querySelector('.cs-card[data-id="vagues"]').textContent.replace(/\\s+/g, ' ').trim()`);
      await shot('c4-coach-valide');
    } else {
      await type('7391');
      await until(`state.data.session && state.data.session.role === 'joueur'`);
      await until(`!!(player() && player().courses && player().courses.vagues && player().courses.vagues.assigned)`);
      out.badge = await js(`(document.querySelector('.nav[data-page="cours"] .nav-badge') || {}).textContent || null`);
      await click('[data-action="go"][data-page="cours"]');
      out.annonce = await js(`(document.querySelector('.cs-alert') || {}).textContent || ''`);
      await shot('c2-joueur-liste');
      // une réponse gardée dans un autre cours (case cochée)
      await click('[data-action="c-open"][data-id="farm"]');
      await js(`state.cours.step = 3; render(); 0`);
      await wait(300);
      await click('[data-action="c-check"][data-v="0"]');
      await until(`!!((player().courses.farm || {}).w || {})['farm-reglages']`);
      out.coche = true;
      await click('[data-action="c-back"]');
      // le cours assigné, leçon par leçon, puis le quiz
      await click('.bk-alert [data-action="c-open"]');
      const n = await js(`Courses.byId('vagues').lessons.length`);
      for (let i = 0; i < n; i++) await click('.cs-foot [data-action="c-next"]');
      for (let q = 0; q < 6; q++) {
        await js(`(() => { const x = Courses.byId('vagues').quiz[state.cq.i]; document.querySelector('[data-action="c-quiz"][data-v="' + x.a + '"]').click(); })()`);
        await wait(200);
        await click('[data-action="c-quiz-next"]');
      }
      await until(`!!(player().courses.vagues.quiz && player().courses.vagues.quiz.best === 1)`);
      out.score = await js(`document.querySelector('.cs-result .cs-big b').textContent`);
      await shot('c3-joueur-quiz');
      await click('.cs-foot [data-action="c-next"]');
      await until(`(player().courses.vagues.seen || []).includes('pratique')`);
      out.badgeApres = await js(`(document.querySelector('.nav[data-page="cours"] .nav-badge') || {}).textContent || null`);
    }
  } catch (e) {
    out.exception = e.stack || String(e);
    try { await shot('erreur-' + process.env.PHASE); } catch (x) { /* rien */ }
  }
  fs.writeFileSync(path.join(dir, 'resultat-' + process.env.PHASE + '.json'), JSON.stringify(out, null, 1));
  app.quit();
};
