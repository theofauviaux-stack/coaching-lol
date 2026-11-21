// Scénario « exercices et fiche de séance » vu de l'app (lancé par tests/e2e-fiches.js). PHASE=coach ou joueur.
module.exports = async function ({ app, win, fs, path }) {
  const dir = process.env.SYNC_DIR;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const js = code => win.webContents.executeJavaScript(code);
  const shot = async name => { await wait(500); fs.writeFileSync(path.join(dir, name + '.png'), (await win.webContents.capturePage()).toPNG()); };
  const until = async (code, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await js(code)) return true; await wait(300); } throw new Error('délai dépassé : ' + code); };
  const waitFile = async (name, ms = 90000) => { const t = Date.now(); while (!fs.existsSync(path.join(dir, name))) { if (Date.now() - t > ms) throw new Error('attente ' + name); await wait(200); } };
  const mark = name => fs.writeFileSync(path.join(dir, name), '1');
  const type = async code => { await js(`(() => { const e = document.querySelector('.wl-eye'); if (e) e.click(); return 1; })()`); await wait(450); for (const k of code) { await js(`document.querySelector('[data-key="${k}"]').click()`); await wait(80); } await wait(900); };
  const scrollTo = sel => js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (e) e.scrollIntoView({ block: 'start' }); return !!e; })()`);
  const out = { phase: process.env.PHASE };
  try {
    await wait(1200);
    await js(`window.confirm = () => true; 0`);
    if (process.env.PHASE === 'coach') {
      await type('4821');
      await until(`state.data.coach && state.data.coach.cloud.linked`);
      // banque d'exercices
      await js(`state.page = 'seances'; state.playerId = state.data.players[0].id; state.seancesTab = 'banque'; render(); 0`);
      await wait(400);
      out.banque = await js(`document.querySelectorAll('.excard').length`);
      await js(`document.querySelector('.excard [data-action="ex-toggle"][data-id="jungler-255"]').click()`);
      await wait(300);
      await shot('f1-banque');
      // nouvelle séance avec 3 exercices
      await js(`document.querySelector('[data-action="seances-tab"][data-v="seances"]').click()`);
      await wait(300);
      await js(`document.querySelector('[data-action="new-session"]').click()`);
      await wait(400);
      out.choixRole = await js(`[...document.querySelectorAll('.exitem input[type=checkbox]')].map(i => i.name.slice(3))`);
      await js(`(() => {
        const f = document.getElementById('session-form');
        f.querySelector('[name="axis"]').selectedIndex = 1;
        for (const id of ['jungle-clear', 'dodging', 'jungler-255']) f.querySelector('[name="ex|' + id + '"]').checked = true;
        f.querySelector('[name="ext|jungle-clear"]').value = '3:20';
        f.querySelector('[name="exn|dodging"]').value = '5 essais avant chaque session de classées';
        f.querySelector('[name="points"]').value = 'Tracking du jungler adverse et premier clear';
        return 0; })()`);
      await js(`document.querySelector('.picker').scrollTop = 0; 0`);
      await shot('f2-choix-exercices');
      await js(`document.querySelector('#session-form [type=submit]').click()`);
      await until(`(state.data.sessions || []).some(s => (s.exercises || []).length === 3)`);
      out.seance = await js(`JSON.stringify(state.data.sessions.find(s => (s.exercises || []).length === 3).exercises)`);
      await js(`state.sessionOpen = state.data.sessions.find(s => (s.exercises || []).length === 3).id; render(); 0`);
      await wait(400);
      await scrollTo('.scard .detail');
      await shot('f3-seance-coach');
      mark('seance-prete');
      // le joueur remplit sa fiche chez lui : le coach la reçoit (notification + fiche affichée)
      await until(`(state.data.reports || []).length === 1`, 90000);
      await until(`!document.querySelector('#toast').classList.contains('hidden')`, 10000).catch(() => {});
      out.notification = await js(`document.querySelector('#toast').textContent.trim()`);
      await wait(300);
      await scrollTo('.report');
      out.ficheCoach = await js(`document.querySelector('.report') ? document.querySelector('.report').textContent.replace(/\\s+/g, ' ').trim() : null`);
      out.chip = await js(`[...document.querySelectorAll('.scard .chip')].map(c => c.textContent.trim())`);
      await shot('f6-fiche-cote-coach');
    } else {
      await type('7391');
      await until(`state.data.session && state.data.session.role === 'joueur'`);
      await until(`(state.data.sessions || []).some(s => (s.exercises || []).length === 3)`);
      out.rappel = await js(`!!document.querySelector('[data-action="open-session"]')`);
      await scrollTo('h2');
      await shot('f4-accueil-joueur');
      await js(`document.querySelector('[data-action="open-session"]').click()`);
      await wait(500);
      out.exercicesVus = await js(`document.querySelectorAll('.scard .excard').length`);
      out.schemas = await js(`document.querySelectorAll('.scard .excard svg.sch').length`);
      await scrollTo('.scard .excard');
      await shot('f5-seance-joueur');
      await js(`document.querySelector('[data-action="report-open"]').click()`);
      await wait(400);
      await js(`(() => {
        const f = document.getElementById('report-form');
        f.querySelector('[name="f|jungle-clear|temps"]').value = '3:12';
        f.querySelector('[name="f|jungle-clear|pv"]').value = '62';
        f.querySelector('[name="f|dodging|score"]').value = '48';
        f.querySelector('[name="f|jungler-255|parties"]').value = '8';
        f.querySelector('[name="f|jungler-255|justes"]').value = '5';
        f.querySelector('[name="g|ressenti"][value="4"]').checked = true;
        f.querySelector('[name="g|difficile"]').value = 'Suivre le jungler quand il passe par la rivière';
        f.querySelector('[name="g|retiens"]').value = 'À 2:55 je regarde de quel côté il a fini';
        return 0; })()`);
      await shot('f5b-fiche-joueur');
      await js(`document.querySelector('#report-form [type=submit]').click()`);
      await until(`(state.data.reports || []).length === 1`);
      out.ficheJoueur = await js(`document.querySelector('.report').textContent.replace(/\\s+/g, ' ').trim()`);
      // un joueur ne peut pas modifier la séance elle-même
      out.peutModifier = await js(`!!document.querySelector('[data-action="edit-session"]')`);
    }
  } catch (e) {
    out.exception = e.stack || String(e);
    try { await shot('erreur-' + process.env.PHASE); } catch (x) { /* rien */ }
  }
  fs.writeFileSync(path.join(dir, 'resultat-' + process.env.PHASE + '.json'), JSON.stringify(out, null, 1));
  if (process.env.PHASE === 'coach') mark('coach-fini');
  app.quit();
};
