// Moments clés d'une partie : tests sans réseau.
const assert = require('assert');
const M = require('../src/moments');
const partie = require('./fixtures/partie-moments');

const items = { 1055: ['Lame de Doran', 450], 2003: ['Potion de soin', 50], 3133: ['Marteau de guerre de Caulfield', 1100], 3071: ['Couperet noir', 3000] };
const { match, timeline } = partie('P-DARIUS');
const m = M.buildMoments(match, timeline, 'P-DARIUS', items);
const at = (mmss, type) => m.moments.find(x => M.mmss(x.t) === mmss && (!type || x.type === type));

// ---- zones de la carte
assert.strictEqual(M.zone(1700, 11200, 100).label, 'top lane');
assert.strictEqual(M.zone(12000, 1500, 100).label, 'bot lane');
assert.strictEqual(M.zone(7300, 7500, 100).label, 'mid lane');
assert.strictEqual(M.zone(5007, 10471, 100).label, 'rivière (côté top)');
assert.strictEqual(M.zone(3800, 7800, 100).label, 'ta jungle');
assert.strictEqual(M.zone(3800, 7800, 200).label, 'jungle ennemie');
assert.strictEqual(M.zone(500, 500, 100).label, 'ta base');
assert.strictEqual(M.zone(14300, 14300, 100).label, 'base ennemie');
// ---- positions interpolées entre deux images minute
assert.deepStrictEqual(M.posAt([{ timestamp: 0, participantFrames: { 1: { position: { x: 0, y: 0 } } } }, { timestamp: 60000, participantFrames: { 1: { position: { x: 600, y: 1200 } } } }], 1, 30000), { x: 300, y: 600 });

// ---- partie
assert.strictEqual(m.matchId, 'EUW1_7300000099');
assert.strictEqual(m.gameId, 7300000099);
assert.strictEqual(m.role, 'Top');
assert.strictEqual(m.participants.find(p => p.id === m.opp).champion, 'Garen', 'vis-à-vis = même poste en face');
assert.ok(!m.participants.some(p => p.puuid), 'pas de puuid dans le fichier');
// gank au top, seul, larves perdues 40 s après
const gank = at('6:30', 'mort');
assert.deepStrictEqual(gank.involved, ['Khazix', 'Garen']);
assert.deepStrictEqual(gank.tags, ['gank', 'seul', 'objectif perdu ensuite']);
assert.deepStrictEqual(gank.after, [{ what: 'Larves du Néant perdues', s: 40 }]);
assert.strictEqual(gank.zone, 'top lane');
// solo kill
assert.deepStrictEqual(at('9:00', 'kill').tags, ['solo kill']);
assert.strictEqual(at('9:00', 'kill').title, 'Kill sur Garen (seul)');
// objectifs : présent / absent, accords
assert.strictEqual(at('7:10').title, 'Larves du Néant perdues');
assert.strictEqual(at('12:00').title, 'Dragon infernal pris');
assert.deepStrictEqual([at('12:00').tags, at('12:00').where], [['absent'], 'top lane'], 'au top pendant le dragon');
assert.strictEqual(at('14:00').title, '1re tour top perdue');
assert.deepStrictEqual(at('14:00').tags, ['présent']);
assert.ok(!m.moments.some(x => x.title === '1re tour bot perdue' && x.type === 'objectif'), 'tours des autres lanes ignorées');
// combat d'équipe au mid
const tf = at('16:00', 'mort');
assert.ok(tf.tags.includes('combat d\'équipe') && tf.tags.includes('3 ennemis') && !tf.tags.includes('seul'), tf.tags.join());
assert.deepStrictEqual(tf.after.map(a => a.what), ['Nashor perdu', '1re tour bot perdue']);
// retours (sans les objets de départ) et niveau 6 après le vis-à-vis
const backs = m.moments.filter(x => x.type === 'retour');
assert.deepStrictEqual(backs.map(b => [M.mmss(b.t), b.spent]), [['7:00', 1150], ['10:00', 3000]]);
assert.deepStrictEqual(backs[0].items, ['Marteau de guerre de Caulfield', 'Potion de soin']);
assert.deepStrictEqual([at('6:00').tone, at('6:00').vs], ['bad', '5:40'], 'niveau 6 après le vis-à-vis');
// lane et vision
assert.deepStrictEqual(m.lane.at10.me, { cs: 70, gold: 4300, xp: 4500, level: 9 });
assert.strictEqual(m.lane.at10.opp.cs, 60);
assert.deepStrictEqual(m.vision, { placed: 4, control: 1, killed: 1, before15: 4 });
// mini-carte : 21 images, 10 joueurs
assert.strictEqual(m.track.length, 21);
assert.deepStrictEqual(m.track[6].p[7], [1800, 11300]);
// joueur absent de la partie ou timeline manquante
assert.strictEqual(M.buildMoments(match, timeline, 'INCONNU'), null);
assert.strictEqual(M.buildMoments(match, null, 'P-DARIUS'), null);

// ---- texte pour l'analyse
const txt = M.toText(m, { player: 'UCE Uawawa#000', champName: c => ({ Khazix: 'Kha\'Zix', LeeSin: 'Lee Sin', Leblanc: 'LeBlanc' })[c] || c });
assert.ok(txt.startsWith('DOSSIER DE PARTIE'));
assert.ok(txt.includes('Joueur : UCE Uawawa#000 — Top Darius contre Garen — Défaite en 20:00 — 1/2/0'));
assert.ok(txt.includes('6:30 — Mort : tué par Kha\'Zix — top lane — ennemis impliqués : Kha\'Zix, Garen — alliés à côté : aucun'), txt);
assert.ok(txt.includes('ensuite : Larves du Néant perdues 40 s après [gank, seul, objectif perdu ensuite]'));
assert.ok(txt.includes('12:00 — Dragon infernal pris — le joueur était absent (top lane)'));
assert.ok(txt.includes('Vision : 4 wards posées (dont 1 pink, 4 avant 15 min), 1 détruite'));
assert.ok(txt.includes('Jungle Lee Sin'));
console.log('✅ Moments clés : OK');
