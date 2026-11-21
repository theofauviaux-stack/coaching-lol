// Reprise de session après un redémarrage de mise à jour (deux lancements successifs d'Electron)
module.exports = async function ({ app, win, fs, path }) {
  const dir = process.env.COACHING_LOL_SHOT || '/tmp';
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const js = code => win.webContents.executeJavaScript(code);
  const out = {};
  await wait(1200);
  if (process.env.PHASE === '1') {
    await js(`document.querySelector('.wl-eye').click()`); await wait(450);
    for (const code of ['4821', '4821']) {
      for (const k of code) { await js(`document.querySelector('[data-key="${k}"]').click()`); await wait(80); }
      await wait(900);
    }
    await js(`document.querySelector('[data-action="open-player"]').click()`);
    await wait(400);
    await js(`document.querySelector('[data-action="period"][data-v="10"]').click()`);
    await wait(400);
    out.avant = await js(`({ page: state.page, period: state.period, verrou: state.data.locked })`);
    app.emit('coaching-lol:test-resume');
    out.fichier = fs.existsSync(path.join(app.getPath('userData'), 'reprise.json'));
  } else {
    out.apres = await js(`({ page: state.page, period: state.period, verrou: state.data.locked, role: state.data.session && state.data.session.role })`);
    out.fichierEfface = !fs.existsSync(path.join(app.getPath('userData'), 'reprise.json'));
    fs.writeFileSync(path.join(dir, 'reprise-capture.png'), (await win.webContents.capturePage()).toPNG());
  }
  fs.writeFileSync(path.join(dir, 'reprise-' + process.env.PHASE + '.json'), JSON.stringify(out));
  app.quit();
};
