// Scénario de réservation vu de l'app (lancé par tests/e2e-bookings.js). PHASE=coach ou joueur.
module.exports = async function ({ app, win, fs, path }) {
  const dir = process.env.SYNC_DIR;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const js = code => win.webContents.executeJavaScript(code);
  const shot = async name => { await wait(500); fs.writeFileSync(path.join(dir, name + '.png'), (await win.webContents.capturePage()).toPNG()); };
  const until = async (code, ms = 25000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await js(code)) return true; await wait(300); } throw new Error('délai dépassé : ' + code); };
  const waitFile = async (name, ms = 60000) => { const t = Date.now(); while (!fs.existsSync(path.join(dir, name))) { if (Date.now() - t > ms) throw new Error('attente ' + name); await wait(200); } };
  const mark = name => fs.writeFileSync(path.join(dir, name), '1');
  const type = async code => { for (const k of code) { await js(`document.querySelector('[data-key="${k}"]').click()`); await wait(80); } await wait(900); };
  const out = { phase: process.env.PHASE };
  try {
    await wait(1200);
    await js(`window.confirm = () => true; 0`);
    if (process.env.PHASE === 'coach') {
      await type('4821');
      await until(`state.data.coach && state.data.coach.cloud.linked`);
      mark('pret');
      await waitFile('demandes');
      await until(`document.querySelectorAll('.bk-alert [data-act="accepter"]').length === 2`);
      out.alertes = await js(`[...document.querySelectorAll('.bk-alert')].map(a => a.textContent.replace(/\\s+/g, ' ').trim())`);
      await shot('b1-alertes-coach');
      await js(`document.querySelector('.bk-alert [data-act="accepter"]').click()`);
      await until(`document.querySelectorAll('.bk-alert [data-act="accepter"]').length === 1`);
      await js(`document.querySelector('.bk-alert [data-act="accepter"]').parentElement.querySelector('[data-action="bk-propose"]').click()`);
      await wait(500);
      await shot('b2-proposition');
      await js(`document.querySelector('[data-action="slot-propose"][data-t="' + slotTime(1, 22) + '"]').click()`);
      await until(`!!document.querySelector('.bk-alert.muted-alert')`);
      out.apresProposition = await js(`[...document.querySelectorAll('.bk-alert')].map(a => a.textContent.replace(/\\s+/g, ' ').trim())`);
      mark('decide');
      await waitFile('pret-demarrer');
      await until(`!!document.querySelector('[data-act="demarrer"]')`);
      await shot('b3-demarrer');
      await js(`document.querySelector('[data-act="demarrer"]').click()`);
      await until(`!!document.getElementById('live-clock')`);
      out.timer = await js(`document.getElementById('live').textContent.replace(/\\s+/g, ' ').trim()`);
      await shot('b4-timer');
      mark('demarre');
      await waitFile('presque-fini');
      await until(`document.getElementById('live') && document.getElementById('live').classList.contains('warn') && !document.querySelector('#toast').classList.contains('hidden')`);
      out.alerte5 = await js(`document.querySelector('#toast').textContent.trim()`);
      out.timerFin = await js(`document.getElementById('live-clock').textContent`);
      await shot('b5-alerte-5-min');
      await js(`document.querySelector('#live [data-act="terminer"]').click()`);
      await until(`!document.getElementById('live')`);
      out.termine = true;
    } else {
      await type('7391');
      await until(`state.data.session && state.data.session.role === 'joueur' && !!state.data.bookings`);
      await until(`!!document.querySelector('.live-banner')`);
      out.enCoaching = await js(`document.querySelector('.live-banner').textContent.trim()`);
      out.joueurVoitTimer = await js(`!!document.getElementById('live-clock')`);
      await shot('b6-joueur-en-coaching');
      await js(`document.querySelector('.live-banner').scrollIntoView(); document.querySelector('.slots').scrollIntoView()`);
      await shot('b7-joueur-grille');
      const t = await js(`slotTime(2, 18)`);
      await js(`document.querySelector('[data-action="slot-free"][data-t="${t}"]').click()`);
      await wait(400);
      await shot('b8-joueur-confirmation');
      await js(`document.querySelector('[data-act="demander"]').click()`);
      await until(`!!document.querySelector('.slot.mine')`);
      out.demande = await js(`document.querySelector('.slot.mine').textContent`);
      out.slotDemande = t;
    }
  } catch (e) {
    out.exception = e.stack || String(e);
    try { await shot('erreur-' + process.env.PHASE); } catch (x) { /* rien */ }
  }
  fs.writeFileSync(path.join(dir, 'resultat-' + process.env.PHASE + '.json'), JSON.stringify(out, null, 1));
  app.quit();
};
