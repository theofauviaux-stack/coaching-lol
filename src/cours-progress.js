// Progression d'un joueur dans les cours (page « Cours ») : leçons vues, meilleur score au quiz, réponses
// gardées (cases cochées, note, win condition), et cours assigné par le coach.
//   { seen: ['lire', 'freeze', 'quiz'], quiz: { best: 0.83, last: 0.83, at }, w: { 'mt-routine': {…} }, assigned: ts }
// Le joueur écrit sa progression ; seul le coach écrit « assigned ».
const PASS = 0.8;
const ID = /^[a-z0-9-]{1,40}$/;

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const validId = id => typeof id === 'string' && ID.test(id);

// morceau de progression envoyé par l'interface du joueur → version propre (ou erreur)
function cleanPatch(patch) {
  const p = isObj(patch) ? patch : {};
  const out = {};
  if (p.seen !== undefined) {
    if (!Array.isArray(p.seen)) throw new Error('Progression invalide.');
    out.seen = p.seen.filter(validId).slice(0, 30);
  }
  if (p.quiz !== undefined) {
    const q = Number(p.quiz);
    if (!Number.isFinite(q) || q < 0 || q > 1) throw new Error('Score de quiz invalide.');
    out.quiz = Math.round(q * 1000) / 1000;
  }
  if (p.w !== undefined) {
    if (!isObj(p.w)) throw new Error('Réponses invalides.');
    const w = {};
    for (const [k, v] of Object.entries(p.w)) if (validId(k)) w[k] = v;
    if (JSON.stringify(w).length > 4000) throw new Error('Réponses trop longues.');
    out.w = JSON.parse(JSON.stringify(w));
  }
  return out;
}

// applique un morceau propre à une progression
function apply(cur, patch, now = Date.now()) {
  const c = Object.assign({}, isObj(cur) ? cur : {});
  if (patch.seen && patch.seen.length) c.seen = Array.from(new Set((c.seen || []).concat(patch.seen)));
  if (typeof patch.quiz === 'number') {
    const best = Math.max(patch.quiz, (c.quiz && c.quiz.best) || 0);
    c.quiz = { best, last: patch.quiz, at: now };
  }
  if (patch.w) c.w = Object.assign({}, c.w || {}, patch.w);
  return c;
}

// réunit deux copies de la même progression (ordinateur du joueur, serveur, ordinateur du coach) sans rien perdre
function combine(a, b) {
  const x = isObj(a) ? a : {}, y = isObj(b) ? b : {};
  const out = Object.assign({}, x, y);
  const seen = Array.from(new Set((x.seen || []).concat(y.seen || [])));
  if (seen.length) out.seen = seen; else delete out.seen;
  const qa = x.quiz, qb = y.quiz;
  if (qa || qb) {
    const latest = !qa ? qb : !qb ? qa : (qb.at || 0) >= (qa.at || 0) ? qb : qa;
    out.quiz = { best: Math.max((qa && qa.best) || 0, (qb && qb.best) || 0), last: latest.last, at: latest.at };
  }
  if (x.w || y.w) out.w = Object.assign({}, x.w || {}, y.w || {});
  if (x.assigned || y.assigned) out.assigned = y.assigned || x.assigned; else delete out.assigned;
  return out;
}

// copie envoyée au serveur par le joueur : sans la partie du coach
function playerPart(pr) {
  const { assigned, syncedAt, ...rest } = isObj(pr) ? pr : {}; // eslint-disable-line no-unused-vars
  return rest;
}

const passed = pr => !!(isObj(pr) && pr.quiz && pr.quiz.best >= PASS);

module.exports = { PASS, validId, cleanPatch, apply, combine, playerPart, passed };
