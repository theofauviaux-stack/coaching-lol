// Suivi des joueurs (1.6.17) : objectifs de travail suivis partie par partie, erreurs récurrentes, bilans pour Claude,
// temps cliquables et dessins dans le débrief exporté.
const assert = require('assert');
const Stats = require('../renderer/stats');
const T = require('../src/trends');
const M = require('../src/moments');
const C = require('../src/claude');
const D = require('../src/debrief');
const { DEFAULT_OBJECTIVES } = require('../src/store');
const partie = require('./fixtures/partie-moments');

// ---- objectifs de travail
assert.strictEqual(Stats.suggestKpi('Moins de morts avant 15 min : recule quand ta lane est poussée'), 'Morts avant 15 min');
assert.strictEqual(Stats.suggestKpi('Pose une pink dans la rivière avant 6:00'), 'Pinks achetées');
assert.strictEqual(Stats.suggestKpi('Ward le tri-brush avant de push'), 'Vision/min');
assert.strictEqual(Stats.suggestKpi('Mieux last hit sous la tour'), 'CS à 10 min');
assert.strictEqual(Stats.suggestKpi('Parle plus à ton équipe'), null);
const data = { settings: { objectives: JSON.parse(JSON.stringify(DEFAULT_OBJECTIVES)) }, games: [] };
const p = { id: 'p1', role: 'Top', objectives: { 'CS à 10 min': 72 } };
const t0 = Date.UTC(2026, 10, 1);
const day = 86400e3;
for (let i = 0; i < 20; i++) {
  data.games.push({ matchId: 'M' + i, playerId: 'p1', role: 'Top', date: t0 + i * day, deaths15: i < 10 ? 3 : (i % 3 ? 1 : 3), cs10: 60 + i, win: i % 2 === 0, kills: 2, deaths: 4, assists: 3, duration: 30, vision: 20, pinks: i < 10 ? 0 : 2 });
}
data.games.push({ matchId: 'X', playerId: 'p1', role: 'Mid', date: t0 + 12 * day, deaths15: 9, cs10: 1, kills: 0, deaths: 9, assists: 0, duration: 30 }); // autre rôle : ignorée
data.games.push({ matchId: 'S', playerId: 'p1', role: 'Top', date: t0 + 13 * day, deaths15: 9, cs10: 1, kills: 0, deaths: 9, assists: 0, duration: 30, custom: true }); // perso : ignorée
assert.strictEqual(Stats.goalTarget(data, p, 'Morts avant 15 min'), 2, 'cible : objectif du rôle');
assert.strictEqual(Stats.goalTarget(data, p, 'CS à 10 min'), 72, 'cible : objectif propre au joueur');
assert.strictEqual(Stats.goalTarget(data, p, 'Morts'), 5, 'indicateur par partie : objectif de la moyenne');
assert.strictEqual(Stats.goalTarget(data, p, null), null);
const since = t0 + 10 * day;
let g = Stats.goalProgress(data, p, { kpi: 'Morts avant 15 min', target: 2, since, status: 'actif' });
assert.deepStrictEqual([g.games, g.measured, g.sens, g.before, g.hits], [10, 10, '≤', 3, 7], 'avant / depuis, réussite partie par partie (≤ 2)');
assert.ok(Math.abs(g.now - 1.6) < 1e-9, String(g.now));
assert.strictEqual(g.state, 'atteint', 'réussi 7 fois sur 10 et les 5 dernières sous la cible');
assert.strictEqual(g.series.length, 10);
assert.deepStrictEqual(g.series.map(x => x.ok), [true, true, false, true, true, false, true, true, false, true]);
g = Stats.goalProgress(data, p, { kpi: 'Morts avant 15 min', target: 0, since, status: 'actif' });
assert.strictEqual(g.state, 'progres', 'mieux qu\'avant sans atteindre la cible');
g = Stats.goalProgress(data, p, { kpi: 'Pinks achetées', target: 3, since: t0 + 2 * day, status: 'actif' });
assert.strictEqual(g.state, 'progres');
g = Stats.goalProgress(data, p, { kpi: 'CS à 10 min', target: 90, since: t0 + 18 * day, status: 'actif' });
assert.strictEqual(g.state, 'attente', 'moins de 3 parties depuis');
g = Stats.goalProgress(data, p, { kpi: null, target: null, since, status: 'actif' });
assert.deepStrictEqual([g.kpi, g.state, g.games], [null, 'libre', 10], 'objectif sans indicateur');
assert.strictEqual(Stats.goalProgress(data, p, { kpi: null, since, status: 'atteint' }).state, 'atteint', 'coché par le coach');
g = Stats.goalProgress(data, p, { kpi: 'CS à 10 min', target: 50, since: t0 + 30 * day, status: 'actif' });
assert.deepStrictEqual([g.games, g.state], [0, 'attente'], 'pas encore de partie');
g = Stats.goalProgress(data, p, { kpi: 'Morts avant 15 min', target: 2, since: t0 + 30 * day, status: 'actif' });
assert.ok(Math.abs(g.before - 2.3) < 1e-9, 'avant : les 20 dernières parties au rôle (pas les perso ni l\'autre rôle) : ' + g.before);

// ---- erreurs récurrentes
const { match, timeline } = partie('P-DARIUS');
const m = M.buildMoments(match, timeline, 'P-DARIUS');
assert.strictEqual(T.compute([]), null);
const few = T.compute([{ matchId: 'A', date: 1, m }, { matchId: 'B', date: 2, m }]);
assert.ok(few.games === 2 && few.sentences.length === 0, 'trop peu de parties : pas de conclusion');
const red = JSON.parse(JSON.stringify(m));
red.teamId = 200; // même partie vue du côté rouge : les morts sont ramenées côté bleu
const entries = [];
for (let i = 0; i < 6; i++) entries.push({ matchId: 'B' + i, date: 1000 + i, m });
for (let i = 0; i < 2; i++) entries.push({ matchId: 'R' + i, date: 2000 + i, m: red });
const tr = T.compute(entries);
assert.deepStrictEqual([tr.games, tr.deaths, tr.early, tr.from, tr.to], [8, 16, 8, 1000, 2001]);
assert.deepStrictEqual(tr.zones.map(z => [z.label, z.n]), [['top lane', 8], ['mid lane', 8]]);
const d1 = tr.points.find(x => x.matchId === 'B0' && x.zone === 'top lane'), d2 = tr.points.find(x => x.matchId === 'R0' && x.zone === 'top lane');
assert.deepStrictEqual([d1.x, d1.y], [1700, 11200]);
assert.deepStrictEqual([d2.x, d2.y], [14870 - 11200, 14870 - 1700], 'côté rouge : symétrie sur la diagonale, la top lane reste en haut');
assert.ok(M.zone(d2.x, d2.y, 100).label === 'top lane', 'toujours en top lane après la symétrie');
assert.strictEqual(tr.sentences[0], '50 % de tes morts arrivent en top lane (8 sur 16), surtout entre 5 et 10 min.');
assert.ok(tr.sentences.includes('8 morts sur 16 sans allié à côté : tu étais seul.'), tr.sentences.join(' | '));
assert.ok(tr.sentences.some(x => /^Tu étais absent sur 16 des 24 objectifs perdus/.test(x)), tr.sentences.join(' | '));
assert.ok(tr.sentences.length <= 5);
assert.strictEqual(T.compute(entries, { limit: 3 }).games, 3, '3 parties les plus récentes');
assert.ok(/16 morts \(2\.0 par partie, 1\.0 avant 15 min\)/.test(T.toText(tr)));

// ---- priorités et bilans pour Claude
assert.deepStrictEqual(C.readGoals(['Moins de morts avant 15 min', { texte: '2 pinks par partie', indicateur: 'Pinks achetées', cible: '2' }, { texte: 'Inventé', indicateur: 'Pentakills' }, '', null]), [
  { text: 'Moins de morts avant 15 min', kpi: 'Morts avant 15 min', target: null },
  { text: '2 pinks par partie', kpi: 'Pinks achetées', target: 2 },
  { text: 'Inventé', kpi: null, target: null }
]);
const man = { analysisId: 'a1', moments: [{ t: 390000 }] };
const r = C.parseResult({ analysisId: 'a1', general: 'Bien.', priorites: [{ texte: 'Ward avant 6:00', indicateur: 'Vision/min', cible: 1.2 }, 'Reculer quand la lane est poussée'] }, man);
assert.deepStrictEqual(r.draft.priorities, [{ text: 'Ward avant 6:00', kpi: 'Vision/min', target: 1.2 }, { text: 'Reculer quand la lane est poussée', kpi: 'Morts avant 15 min', target: null }]);
assert.ok(/Priorités de travail :\n1\. Ward avant 6:00\n2\. Reculer/.test(r.draft.general), 'priorités aussi dans le texte général');
const bid = C.bilanId('p1', '2026-11');
assert.strictEqual(C.bilanFolderName('p1', '2026-11', 'UC: akirielle/#EUW'), '2026-11 UC akirielle EUW [bilan-p1-2026-11]');
assert.strictEqual(C.idFromFolder(C.bilanFolderName('p1', '2026-11', 'X')), null, 'un bilan n\'est pas pris pour une analyse');
let b = C.parseBilan({ bilanId: bid, general: 'Bon mois.', pointsForts: ['Farm à 10 min : 78 CS'], axes: ['Morts avant 15 min'], objectifs: [{ texte: '2 pinks', indicateur: 'Pinks achetées', cible: 2 }] }, { bilanId: bid });
assert.ok(b.ok);
assert.strictEqual(C.bilanText(b.draft), 'Bon mois.\n\nPoints forts :\n• Farm à 10 min : 78 CS\n\nÀ travailler :\n• Morts avant 15 min');
assert.deepStrictEqual(b.draft.objectifs, [{ text: '2 pinks', kpi: 'Pinks achetées', target: 2 }]);
assert.strictEqual(C.parseBilan({ bilanId: 'autre' }, { bilanId: bid }).ok, false);
assert.strictEqual(C.parseBilan({ bilanId: bid }, { bilanId: bid }).ok, false, 'vide');
assert.ok(/Bilans du mois/.test(C.README) && /indicateurs/.test(C.README));
const mf = C.manifest({ id: 'a1', clips: [], comments: [{ t: 390000, author: 'coach', text: 'Regarde', drawing: { g: 383, shapes: [{}] } }, { t: 390000, author: 'coach', text: '', drawing: { g: 384, shapes: [{}] } }] }, { me: 1, participants: [], moments: [{ t: 390000, type: 'mort', title: 'Mort' }] }, {});
assert.deepStrictEqual(mf.moments[0].discussion.map(x => x.texte), ['Regarde [dessin sur la vidéo à 6:23]', '[dessin sur la vidéo à 6:24]']);
assert.ok(mf.aRendre.indicateurs.includes('Morts avant 15 min'));

// ---- débrief exporté : temps cliquables et dessins
const html = D.buildDebrief({
  analysis: { createdAt: '2026-11-21', note: 'Regarde 6:20', clips: [{ file: '01_5m55.webm', start: 355, end: 440, lead: 0.3, sync: [[0.3, 355], [85.3, 440]] }],
    comments: [{ t: 390000, author: 'coach', text: 'À 6:10 tu étais seul ; à 99:00 rien', at: '2026-11-21' },
      { t: 390000, author: 'coach', text: '', at: '2026-11-21', drawing: { file: '01_5m55.webm', v: 35, g: 390, w: 1600, h: 900, shapes: [{ k: 'fleche', c: '#ff5c5c', p: [0.1, 0.1, 0.5, 0.5] }] } },
      { t: 390000, author: 'coach', text: 'autre vidéo', at: '2026-11-21', drawing: { file: '09_absente.webm', v: 1, g: 2, shapes: [{ k: 'cercle', c: '#ff5c5c', p: [0, 0, 1, 1] }] } }],
    moments: { duration: 1200, moments: [{ t: 390000, type: 'mort', title: 'Mort', zone: 'top lane' }], participants: [] } },
  label: 'Darius contre Garen', playerName: 'UCE', files: ['01_5m55.webm']
});
assert.deepStrictEqual(html.match(/data-t="\d+"/g), ['data-t="380"', 'data-t="370"'], '6:20 et 6:10, pas 99:00 (après la fin de la partie)');
assert.strictEqual((html.match(/class="dr"/g) || []).length, 1, 'dessin seulement si sa vidéo est exportée');
assert.ok(/#t=5\.3"/.test(html), 'vidéo positionnée avec la synchronisation');
new Function(html.split('<script>')[1].split('</script>')[0]); // le script de la page se lit sans erreur
console.log('✅ Suivi des joueurs (objectifs, erreurs récurrentes, bilans, débrief) : OK');
