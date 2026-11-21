// Vidéos navigables : durée et index ajoutés aux vidéos de l'enregistreur, images intactes
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const W = require('../src/webm');

// vidéo produite par l'enregistreur de Chromium (MediaRecorder, VP9) : ni durée, ni index, tailles inconnues
const raw = fs.readFileSync(path.join(__dirname, 'fixtures', 'mediarecorder.webm'));
assert.strictEqual(W.isSeekable(raw), false);
const d0 = W.describe(raw);
assert.ok(d0 && d0.unknownCluster && d0.duration === null && d0.segmentSize === -1, JSON.stringify(d0));

const fixed = W.makeSeekable(raw);
assert.ok(Buffer.isBuffer(fixed) && fixed.length > raw.length && fixed.length - raw.length < 2000, 'quelques centaines d\'octets en plus');
assert.strictEqual(W.isSeekable(fixed), true);
assert.strictEqual(W.isSeekable(fixed.subarray(0, 16384)), true, 'reconnue sur le début du fichier (lecture partielle du serveur)');
assert.strictEqual(W.makeSeekable(fixed), null, 'déjà navigable : laissée telle quelle');
const d = W.describe(fixed);
assert.ok(d.duration > 7 && d.duration < 7.4, 'durée ' + d.duration);
assert.strictEqual(d.segmentSize, fixed.length - (fixed.length - d.segmentSize), 'Segment de taille connue');
assert.ok(d.segmentSize > 0 && !d.unknownCluster);
assert.deepStrictEqual(d.cues.map(c => Math.round(c.time * 10) / 10), [0, 3.5, 6.9], 'un repère par image clé : ' + JSON.stringify(d.cues));
assert.ok(d.cues.every(c => d.clusters.includes(c.pos)), 'chaque repère pointe sur le début d\'un cluster');
// images identiques, dans le même ordre : une par image filmée (30 par seconde), recopiées telles quelles
assert.ok(Math.abs(d.blocks.length - d.duration * 30) < 4, d.blocks.length + ' images pour ' + d.duration + ' s');
let at = 0;
for (const blk of d.blocks) { const i = raw.indexOf(blk, at); assert.ok(i >= at, 'image recopiée telle quelle, dans l\'ordre'); at = i + blk.length; }

// fichier coupé (fin d'enregistrement brutale) : on garde tout ce qui est complet
const cut = raw.subarray(0, raw.length - 3000);
const fc = W.makeSeekable(cut);
assert.ok(fc && W.isSeekable(fc));
const dc = W.describe(fc);
assert.ok(dc.duration > 5 && dc.duration < d.duration, 'durée du morceau complet : ' + dc.duration);
assert.ok(dc.blocks.length < d.blocks.length && dc.blocks.length > d.blocks.length - 20);

// pas une vidéo : null, sans erreur
assert.strictEqual(W.makeSeekable(Buffer.from('pas une vidéo')), null);
assert.strictEqual(W.makeSeekable(Buffer.alloc(0)), null);
assert.strictEqual(W.isSeekable(Buffer.from('xx')), false);
console.log('✅ Vidéos navigables (durée et index WebM) : OK');
