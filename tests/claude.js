// Analyses par Claude : nom des dossiers, fiche à analyser, lecture de la réponse
const assert = require('assert');
const C = require('../src/claude');

const a = {
  id: 'a1b2c3d4-0000-4000-8000-000000000001', matchId: 'EUW1_1', createdAt: '2026-11-20T20:30:00Z', note: 'Mes wards',
  clips: [{ file: '01_5m55.webm', start: 355, end: 400 }, { file: '02_9m00.webm', start: 540, end: 585 }],
  comments: [{ id: 1, t: 390000, author: 'joueur', text: 'Je pensais que le jungler était bot.' }, { id: 2, t: null, author: 'coach', text: 'Je regarde.' }]
};
const m = {
  me: 1, participants: [{ id: 1, champion: 'Darius' }],
  moments: [
    { t: 390000, type: 'mort', title: 'Mort : tué par Khazix' },
    { t: 570000, type: 'kill', title: 'Kill sur Garen' },
    { t: 1200000, type: 'objectif', title: 'Dragon perdu' }
  ]
};
const champName = c => ({ Khazix: 'Kha\'Zix', Darius: 'Darius', Garen: 'Garen' }[c] || c);

// dossier
const name = C.folderName(a, { playerName: 'UCE Uawawa', label: 'Darius contre Garen' });
assert.strictEqual(name, '2026-11-20 UCE Uawawa Darius contre Garen [a1b2c3d4]');
assert.strictEqual(C.idFromFolder(name), 'a1b2c3d4');
assert.strictEqual(C.idFromFolder('.prep-a1b2c3d4'), null);
assert.ok(!/[/:]/.test(C.folderName(a, { playerName: 'A/B:C', label: 'x' })));

// fiche
const man = C.manifest(a, m, { playerName: 'UCE Uawawa', label: 'Darius contre Garen', champName });
assert.strictEqual(man.analysisId, a.id);
assert.strictEqual(man.champion, 'Darius');
assert.deepStrictEqual(man.videos.map(v => [v.fichier, v.moments]), [['videos/01_5m55.webm', [390000]], ['videos/02_9m00.webm', [570000]]]);
assert.deepStrictEqual(man.moments.map(x => [x.temps, x.titre, x.video, x.secondeDansLaVideo]), [
  ['6:30', 'Mort : tué par Kha\'Zix', 'videos/01_5m55.webm', 35],
  ['9:30', 'Kill sur Garen', 'videos/02_9m00.webm', 30],
  ['20:00', 'Dragon perdu', null, null]
]);
assert.deepStrictEqual(man.moments[0].discussion, [{ auteur: 'joueur', texte: 'Je pensais que le jungler était bot.' }]);
assert.deepStrictEqual(man.discussionGenerale, [{ auteur: 'coach', texte: 'Je regarde.' }]);
assert.strictEqual(man.aRendre.fichier, 'analyse-claude.json');

// réponse de Claude
let r = C.parseResult({ analysisId: a.id, general: 'Bonne lane.', priorites: ['Ward la rivière', 'Back avec la wave'], moments: [{ t: 390000, texte: 'Mort évitable.' }, { t: 571000, texte: 'Bon trade.' }] }, man);
assert.ok(r.ok, JSON.stringify(r));
assert.strictEqual(r.draft.general, 'Bonne lane.\n\nPriorités de travail :\n1. Ward la rivière\n2. Back avec la wave');
assert.deepStrictEqual(r.draft.moments, { 390000: 'Mort évitable.', 570000: 'Bon trade.' }, 't à 1 s près rattaché au moment');
r = C.parseResult({ analysisId: a.id, moments: [{ t: 999999, texte: 'Inconnu' }, { t: 1200000, texte: 'x'.repeat(2500) }] }, man);
assert.ok(r.ok && r.errors.length === 1 && /Moment inconnu/.test(r.errors[0]));
assert.strictEqual(r.draft.moments[1200000].length, 2000, 'texte coupé à la taille d\'un message');
assert.strictEqual(C.parseResult({ analysisId: 'autre', general: 'x' }, man).ok, false, 'mauvaise analyse refusée');
assert.strictEqual(C.parseResult({ analysisId: a.id }, man).ok, false, 'réponse vide refusée');
assert.strictEqual(C.parseResult(null, man).ok, false);
assert.ok(/analyse les nouvelles parties/.test(C.README) && /# Méthode d'analyse du coach/.test(C.METHOD));

console.log('✅ Analyses par Claude (dossiers et brouillons) : tests OK');
