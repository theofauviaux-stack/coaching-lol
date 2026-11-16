// Parcours complet de l'interface dans Electron (lancé avec COACHING_LOL_TEST=chemin de ce fichier).
// Captures dans COACHING_LOL_SHOT, résultats dans parcours.json. Jamais utilisé par l'app installée.
module.exports = async function ({ app, win, fs, path }) {
  const dir = process.env.COACHING_LOL_SHOT || '/tmp';
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const js = code => win.webContents.executeJavaScript(code);
  const shot = async name => { await wait(450); fs.writeFileSync(path.join(dir, name + '.png'), (await win.webContents.capturePage()).toPNG()); };
  const click = sel => js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.click(); return true; })()`);
  const type = async code => { for (const k of code) { await click(`[data-key="${k}"]`); await wait(60); } await wait(900); };
  const out = { erreurs: [] };
  win.webContents.on('console-message', (e, level, msg) => { if (level >= 3) out.erreurs.push(msg); });
  try {
    await wait(1200);
    out.ecranInitial = await js(`document.querySelector('.login-card h1') && document.querySelector('.login-card h1').textContent`);
    await shot('01-creation-code');
    await type('4821');
    out.confirmation = await js(`document.querySelector('.login-card h1').textContent`);
    await type('4821');
    out.apresCreation = await js(`({ connecte: !document.querySelector('#app').classList.contains('hidden'), titre: document.querySelector('h1').textContent })`);
    await shot('02-accueil-coach');
    await click('[data-action="open-player"]');
    await shot('03-tableau-de-bord');
    out.cartes = await js(`document.querySelectorAll('.kpi').length`);
    out.points = await js(`document.querySelectorAll('.chart-svg .pt').length`);
    await click('[data-action="metric"][data-metric="KDA"]');
    out.metrique = await js(`document.querySelector('.kpi.sel .lab') && document.querySelector('.kpi.sel .lab').textContent`);
    await click('[data-action="period"][data-v="10"]');
    out.points10 = await js(`document.querySelectorAll('.chart-svg .pt').length`);
    await js(`document.querySelector('#page').scrollTop = 900`);
    await shot('04-tableau-de-bord-bas');
    await click('[data-action="go"][data-page="parties"]');
    await shot('05-parties');
    await click('tr.click[data-action="game"]');
    await wait(300);
    out.panneau = await js(`!document.querySelector('#drawer').classList.contains('hidden')`);
    await click('[data-action="gset"][data-field="mental"][data-v="4"]');
    await wait(500);
    out.mental = await js(`document.querySelector('[data-action="gset"][data-field="mental"].on') && document.querySelector('[data-action="gset"][data-field="mental"].on').dataset.v`);
    await shot('06-detail-partie');
    await click('[data-action="close-drawer"]');
    await click('[data-action="go"][data-page="seances"]');
    await click('[data-action="new-session"]');
    await wait(300);
    await js(`(() => { const f = document.querySelector('#session-form'); f.querySelector('[name=points]').value = 'Tracking du jungler adverse'; f.querySelector('[name=kpi]').value = 'Morts avant 15 min'; f.querySelector('[name=target]').value = '2'; f.querySelector('button[type=submit]').click(); })()`);
    await wait(800);
    out.seances = await js(`document.querySelectorAll('.scard').length`);
    await click('.scard');
    await shot('07-seances');
    await click('[data-action="go"][data-page="joueurs"]');
    await shot('08-joueurs');
    await click('[data-action="go"][data-page="parametres"]');
    await js(`(() => { const i = document.querySelector('#pcode'); i.value = '7391'; })()`);
    await click('[data-action="save-pcode"]');
    await wait(600);
    out.codeJoueur = await js(`(document.querySelector('#pcode') || {}).value`);
    await js(`(() => { const i = document.querySelector('[data-obj="CS/min"]'); i.value = '7'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await wait(1400);
    out.objectifPerso = await js(`document.querySelector('[data-obj="CS/min"]').classList.contains('custom')`);
    await shot('09-parametres-joueur');
    // profil modifié depuis Paramètres
    await js(`(() => { const f = document.querySelector('#profile-form'); f.querySelector('[name=goal]').value = 'Passer Grand Maître cette saison'; f.querySelector('button[type=submit]').click(); })()`);
    await wait(700);
    out.profilModifie = await js(`state.data.players[0].goal`);
    // ajout d'un second joueur puis suppression depuis la page Joueurs, avec confirmation
    await click('[data-action="go"][data-page="joueurs"]');
    await click('.pcard.add');
    await wait(300);
    await js(`(() => { const f = document.querySelector('#player-form'); f.querySelector('[name=riotId]').value = 'Doublon#EUW'; f.querySelector('[name=role]').value = 'ADC'; f.querySelector('button[type=submit]').click(); })()`);
    await wait(800);
    out.apresAjout = await js(`state.data.players.map(p => p.riotId + ' (code ' + (p.code ? 'oui' : 'non') + ')')`);
    await click('[data-action="go"][data-page="joueurs"]');
    await shot('08b-joueurs-boutons');
    await js(`(() => { const b = [...document.querySelectorAll('.pcard [data-action="delete-player"]')].pop(); b.click(); })()`);
    await wait(300);
    out.confirmation = await js(`document.querySelector('#modal-box h1').textContent`);
    await shot('08c-confirmation-suppression');
    await click('[data-action="confirm-delete"]');
    await wait(800);
    out.apresSuppression = await js(`state.data.players.map(p => p.riotId)`);
    await click('[data-action="go"][data-page="parametres"]');
    await click('[data-action="stab"][data-v="general"]');
    await shot('10-parametres-general');
    // déconnexion puis connexion avec le code du joueur
    await click('[data-action="logout"]');
    await wait(400);
    await type('0000');
    out.mauvaisCode = await js(`document.querySelector('.login-msg').textContent`);
    await wait(600);
    await shot('11-code-faux');
    await type('7391');
    out.joueur = await js(`({ nav: [...document.querySelectorAll('.nav span')].map(s => s.textContent), titre: document.querySelector('h1').textContent, lecture: !!document.querySelector('.chip .i'), joueurs: state.data.players.length, codes: state.data.players.some(p => 'code' in p), coach: !!state.data.coach })`);
    await shot('12-accueil-joueur');
    await click('[data-action="go"][data-page="dashboard"]');
    await shot('13-tableau-joueur');
    await click('[data-action="go"][data-page="objectifs"]');
    await shot('14-objectifs-joueur');
    await click('[data-action="go"][data-page="parties"]');
    await click('tr.click[data-action="game"]');
    await wait(300);
    out.joueurPeutModifier = await js(`!!document.querySelector('#drawer [data-action="gset"]')`);
    // le joueur ne peut rien modifier, même en appelant directement l'API
    out.refusEcriture = await js(`window.api.deletePlayer(state.data.players[0].id).then(r => r.message)`);
    await shot('15-detail-joueur');
  } catch (e) {
    out.exception = e.stack || String(e);
  }
  fs.writeFileSync(path.join(dir, 'parcours.json'), JSON.stringify(out, null, 1));
  app.quit();
};
