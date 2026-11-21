// Erreurs récurrentes d'un joueur sur ses dernières parties (à partir des moments clés de chaque partie) :
// carte des morts, zones et minutes les plus fréquentes, circonstances (seul, gank…), objectifs perdus en son absence.
// Les positions sont ramenées au côté bleu (base en bas à gauche) par symétrie sur la diagonale de la carte : une mort
// en top lane reste en top lane, une mort dans « ta jungle » tombe toujours dans la jungle bleue.
const S = 14870; // la Faille de l'invocateur va de 0 à ~14 870 sur les deux axes
const WINDOWS = [[0, 5], [5, 10], [10, 15], [15, 20], [20, 25], [25, 30], [30, Infinity]];
const winLabel = ([a, b]) => (b === Infinity ? 'après ' + a + ' min' : 'entre ' + a + ' et ' + b + ' min');
const WHERE = {
  'ta base': 'dans ta base', 'base ennemie': 'dans la base ennemie', 'top lane': 'en top lane', 'bot lane': 'en bot lane',
  'mid lane': 'en mid lane', 'rivière (côté top)': 'dans la rivière côté top', 'rivière (côté bot)': 'dans la rivière côté bot',
  'ta jungle': 'dans ta jungle', 'jungle ennemie': 'dans la jungle ennemie'
};
const pct = (n, d) => Math.round(100 * n / d);

function count(list, key) {
  const m = new Map();
  for (const x of list) for (const k of [].concat(key(x)).filter(Boolean)) m.set(k, (m.get(k) || 0) + 1);
  return [...m.entries()].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n);
}

// entries : [{ matchId, date, m }] (m : moments d'une partie, voir src/moments.js)
function compute(entries, { limit = 20, now = Date.now() } = {}) {
  const list = (entries || []).filter(e => e && e.m && Array.isArray(e.m.moments)).sort((a, b) => b.date - a.date).slice(0, limit);
  if (!list.length) return null;
  const deaths = [];
  let lost = 0, absent = 0;
  for (const e of list) {
    const red = e.m.teamId === 200;
    for (const x of e.m.moments) {
      if (x.type === 'mort') {
        const ok = typeof x.x === 'number' && typeof x.y === 'number';
        const [px, py] = !ok ? [null, null] : red ? [S - x.y, S - x.x] : [x.x, x.y];
        deaths.push({ x: ok ? Math.round(px) : null, y: ok ? Math.round(py) : null, t: x.t, zone: x.zone || '', tags: (x.tags || []).slice(0, 6), matchId: e.matchId, date: e.date });
      }
      if (x.type === 'objectif' && x.tone === 'bad') { lost++; if ((x.tags || []).includes('absent')) absent++; }
    }
  }
  const n = deaths.length, games = list.length;
  const zones = count(deaths, d => d.zone);
  const windows = WINDOWS.map(w => ({ label: winLabel(w), from: w[0], n: deaths.filter(d => d.t / 60000 >= w[0] && d.t / 60000 < w[1]).length })).filter(w => w.n);
  const tags = count(deaths, d => d.tags.map(t => (/^\d+ ennemis$/.test(t) ? '3 ennemis ou plus' : t)));
  const early = deaths.filter(d => d.t < 15 * 60000).length;
  const tagN = t => (tags.find(x => x.label === t) || { n: 0 }).n;

  // phrases, de la plus parlante à la moins parlante (seulement ce qui revient vraiment)
  const sentences = [];
  if (games >= 5 && n >= 5) {
    const z = zones[0];
    if (z && z.n >= 3 && z.n / n >= 0.3) {
      const inZone = deaths.filter(d => d.zone === z.label);
      const w = WINDOWS.map(x => ({ x, k: inZone.filter(d => d.t / 60000 >= x[0] && d.t / 60000 < x[1]).length })).sort((a, b) => b.k - a.k)[0];
      sentences.push(pct(z.n, n) + ' % de tes morts arrivent ' + (WHERE[z.label] || 'en ' + z.label) + ' (' + z.n + ' sur ' + n + ')'
        + (w && w.k >= 2 && w.k / z.n >= 0.5 ? ', surtout ' + winLabel(w.x) : '') + '.');
    }
    const w = windows.slice().sort((a, b) => b.n - a.n)[0];
    if (w && w.n >= 3 && w.n / n >= 0.35 && !(sentences[0] || '').includes(w.label)) sentences.push(w.n + ' morts sur ' + n + ' arrivent ' + w.label + '.');
    if (early / games >= 2) sentences.push('Tu meurs en moyenne ' + (early / games).toFixed(1).replace('.', ',') + ' fois avant 15 min.');
    if (tagN('seul') >= 3 && tagN('seul') / n >= 0.4) sentences.push(tagN('seul') + ' morts sur ' + n + ' sans allié à côté : tu étais seul.');
    if (tagN('gank') >= 3 && tagN('gank') / n >= 0.25) sentences.push(tagN('gank') + ' morts sur un gank du jungler adverse.');
    if (tagN('objectif perdu ensuite') >= 3 && tagN('objectif perdu ensuite') / n >= 0.25) sentences.push(tagN('objectif perdu ensuite') + ' de tes morts sont suivies d\'un objectif perdu.');
    if (tagN('3 ennemis ou plus') >= 3 && tagN('3 ennemis ou plus') / n >= 0.3) sentences.push(tagN('3 ennemis ou plus') + ' morts face à 3 ennemis ou plus.');
  }
  if (games >= 5 && lost >= 4 && absent / lost >= 0.5) {
    const txt = 'Tu étais absent sur ' + absent + ' des ' + lost + ' objectifs perdus par ton équipe.';
    const i = sentences.findIndex(x => /objectif perdu|3 ennemis/.test(x)); // avant les circonstances moins parlantes
    if (i >= 0) sentences.splice(i, 0, txt); else sentences.push(txt);
  }
  return {
    at: now, games, deaths: n, perGame: games ? n / games : 0, early, earlyPerGame: games ? early / games : 0,
    from: list[list.length - 1].date, to: list[0].date,
    points: deaths.filter(d => d.x !== null).slice(0, 200), zones, windows, tags, objectives: { lost, absent },
    sentences: sentences.slice(0, 5)
  };
}

// Texte pour un dossier (bilan pour Claude)
function toText(tr) {
  if (!tr) return 'Pas assez de parties avec leurs moments clés.';
  const lines = [tr.games + ' parties, ' + tr.deaths + ' morts (' + tr.perGame.toFixed(1) + ' par partie, ' + tr.earlyPerGame.toFixed(1) + ' avant 15 min).'];
  lines.push('Zones : ' + tr.zones.map(z => z.label + ' ' + z.n).join(', ') + '.');
  lines.push('Minutes : ' + tr.windows.map(w => w.label + ' ' + w.n).join(', ') + '.');
  if (tr.tags.length) lines.push('Circonstances : ' + tr.tags.map(t => t.label + ' ' + t.n).join(', ') + '.');
  lines.push('Objectifs perdus : ' + tr.objectives.lost + ', dont ' + tr.objectives.absent + ' en son absence.');
  if (tr.sentences.length) lines.push('À retenir : ' + tr.sentences.join(' '));
  return lines.join('\n');
}

module.exports = { compute, toText, WINDOWS };
