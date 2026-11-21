// Tests des cours : contenu cohérent (exercices, indicateurs, quiz, interactions), progression des joueurs,
// et rendu de chaque étape de chaque cours (vue joueur et vue coach) sans erreur.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Courses = require('../renderer/courses');
const Stats = require('../renderer/stats');
const P = require('../src/cours-progress');

const R = f => fs.readFileSync(path.join(__dirname, '..', 'renderer', f), 'utf8');

// ------------------------------------------------------------------ contenu
const Exercises = new Function('Schemas', R('exercises.js') + ';return Exercises;')({ render: () => '' });
const ids = new Set();
const WIDGETS = ['wave', 'map', 'choice', 'scenario', 'match', 'quick', 'order', 'check', 'cs', 'wincon', 'deaths', 'adc', 'roam', 'scale'];
assert.ok(Courses.LIST.length >= 8, 'au moins 8 cours');
assert.deepStrictEqual(Courses.forParcours('indiv').map(c => c.n), Courses.LIST.map((_, i) => i + 1), 'cours numérotés dans l\'ordre');
for (const c of Courses.LIST) {
  assert.ok(P.validId(c.id), 'identifiant de cours : ' + c.id);
  assert.ok(c.lessons.length >= 3 && c.quiz.length >= 5, c.id + ' : leçons et quiz');
  assert.ok(new Set(c.lessons.map(l => l.id)).size === c.lessons.length && c.lessons.every(l => P.validId(l.id) && !['quiz', 'pratique'].includes(l.id)), c.id + ' : identifiants des leçons');
  for (const e of c.practice.exercises) assert.ok(Exercises.byId(e), c.id + ' : exercice inconnu ' + e);
  assert.ok(Stats.GOAL_KPIS.includes(c.practice.goal.kpi), c.id + ' : indicateur ' + c.practice.goal.kpi);
  for (const q of c.quiz) assert.ok(Number.isInteger(q.a) && q.a >= 0 && q.a < q.opts.length && q.why, c.id + ' : ' + q.q);
  for (const l of c.lessons) for (const b of l.blocks) {
    if (!b.w) continue;
    assert.ok(WIDGETS.includes(b.w), 'interaction inconnue ' + b.w);
    assert.ok(P.validId(b.id) && !ids.has(b.id), 'identifiant d\'interaction unique : ' + b.id);
    ids.add(b.id);
    if (b.w === 'wave') assert.ok(Courses.WAVES[b.mode], b.id);
    if (b.w === 'map') assert.strictEqual(b.zones.filter(z => z.ok).length, 1, b.id + ' : une seule bonne zone');
    if (b.w === 'choice') assert.strictEqual(b.opts.filter(o => o.ok).length, 1, b.id + ' : une seule bonne réponse');
    if (b.w === 'scenario') for (const s of b.steps) assert.strictEqual(s.opts.filter(o => o.ok).length, 1, b.id);
    if (b.w === 'match') for (const it of b.items) assert.ok(it.a >= 0 && it.a < b.choices.length && it.why, b.id);
    if (b.w === 'quick') for (const it of b.items) assert.ok(typeof it.a === 'boolean' && it.why, b.id);
  }
}
for (const a of Courses.ADCS) assert.ok(Courses.ADC_PROFILES[a.profile] && Courses.ROAM_LABEL[a.roam] && a.note, 'ADC ' + a.name);
// vocabulaire : pas de crédit externe dans le contenu
assert.ok(!/karakal|coach k\b/i.test(JSON.stringify(Courses.LIST)), 'aucun crédit externe');
// or des minions (Season 16 : melee 20, caster 14, cannon 50 avant 11 min) : 2 waves dont une cannon wave = 254
assert.ok(/12 CS à 10 minutes.*254 gold.*204 sans le cannon/.test(JSON.stringify(Courses.byId('farm'))), 'gold exact des CS ratés');
assert.ok(!/item en retard/.test(JSON.stringify(Courses.LIST)), 'pas de « item en retard »');
assert.strictEqual(3 * 20 + 3 * 14, 102);

// ------------------------------------------------------------------ progression
assert.throws(() => P.cleanPatch({ seen: 'x' }));
assert.throws(() => P.cleanPatch({ quiz: 2 }));
assert.throws(() => P.cleanPatch({ w: [] }));
assert.throws(() => P.cleanPatch({ w: { a: 'x'.repeat(5000) } }));
assert.deepStrictEqual(P.cleanPatch({ seen: ['lire', 'Pas bon', 3], quiz: 0.8333333, w: { 'mt-note': 4, 'Mauvais id': 1 }, assigned: 1 }), { seen: ['lire'], quiz: 0.833, w: { 'mt-note': 4 } }, 'patch nettoyé, sans « assigned »');
let pr = P.apply({}, { seen: ['lire'] }, 10);
pr = P.apply(pr, { seen: ['lire', 'freeze'], quiz: 0.5 }, 20);
pr = P.apply(pr, { quiz: 1 }, 30);
pr = P.apply(pr, { quiz: 0.66 }, 40);
assert.deepStrictEqual(pr, { seen: ['lire', 'freeze'], quiz: { best: 1, last: 0.66, at: 40 } });
assert.ok(P.passed(pr) && !P.passed({ quiz: { best: 0.66 } }) && !P.passed({}));
const coach = { assigned: 5, seen: ['lire'], quiz: { best: 0.5, last: 0.5, at: 1 }, w: { a: 1 } };
const server = { seen: ['freeze'], quiz: { best: 0.83, last: 0.83, at: 2 }, w: { b: 2 } };
assert.deepStrictEqual(P.combine(coach, server), { assigned: 5, seen: ['lire', 'freeze'], quiz: { best: 0.83, last: 0.83, at: 2 }, w: { a: 1, b: 2 } }, 'réunion sans perte, cours assigné gardé');
assert.deepStrictEqual(P.playerPart({ assigned: 5, syncedAt: 'x', seen: [] }), { seen: [] });

// ------------------------------------------------------------------ rendu de chaque étape (joueur et coach)
function context(role) {
  const players = [{ id: 'p1', riotId: 'Démo#EUW', role: 'Support', goals: [], courses: { mental: { seen: ['routine'], quiz: { best: 1 } }, support: { assigned: 1 } },
    trends: { games: 5, deaths: 20, perGame: 4, points: [{ x: 12000, y: 2000, t: 300000, zone: 'bot lane', tags: [] }], zones: [{ label: 'bot lane', n: 9 }], windows: [{ label: 'entre 5 et 10 min', from: 5, n: 6 }], sentences: ['Phrase.'] } }];
  const data = { session: { role, playerId: role === 'joueur' ? 'p1' : undefined, readOnly: role === 'joueur' }, players, games: [], settings: { ddVersion: '' } };
  const ctx = {
    console, window: {}, document: { querySelector: () => null, getElementById: () => null },
    esc: s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])),
    state: { page: 'cours', cours: null, playerId: 'p1' }, D: () => data, player: () => players[0], canEdit: () => role !== 'joueur',
    isTyping: () => false, render: () => {}, toast: () => {}, apply: () => {}, copyText: () => {}, gameNameOf: r => String(r).split('#')[0],
    img: () => '', mapPct: (x, y) => [x / 150, 100 - y / 150], mmss: () => '5:00', dateFr: () => '21/11/2026',
    exerciseCard: ex => '<div class="excard">' + ex.title + '</div>', Stats, Exercises, Courses
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(R('icons.js'), ctx);
  ctx.icon = ctx.window.icon;
  vm.runInContext(R('schemas.js') + ';globalThis.Schemas = Schemas;', ctx);
  vm.runInContext(R('cours.js') + ';globalThis.Cours = Cours;', ctx);
  return ctx;
}
for (const role of ['joueur', 'coach']) {
  const ctx = context(role);
  const list = ctx.Cours.page();
  assert.ok(list.includes('Jeu individuel') && (list.match(/class="cs-card /g) || []).length === Courses.LIST.length, role + ' : liste des cours');
  if (role === 'joueur') assert.ok(list.includes('Ton coach t\'a demandé'), 'cours assigné annoncé au joueur');
  for (const c of Courses.LIST) {
    for (let i = 0; i < Courses.steps(c); i++) {
      ctx.state.cours = { id: c.id, step: i };
      ctx.state.cq = null;
      const html = ctx.Cours.page();
      assert.ok(html.includes('cs-main') && !/undefined|NaN|\[object Object\]/.test(html), `${role} : ${c.id} étape ${i}`);
    }
  }
  assert.strictEqual(ctx.Cours.badge(), role === 'joueur' ? 1 : 0, role + ' : badge du menu');
}

console.log('✅ Cours (contenu, progression, rendu) : tests OK');
