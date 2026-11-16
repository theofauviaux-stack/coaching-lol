// Accès par code à 4 chiffres : le code coach ouvre tout, le code d'un joueur n'ouvre que ses données.
const CODE_RE = /^\d{4}$/;

function checkLocalCode(data, code, coachCode) {
  code = String(code || '');
  if (!CODE_RE.test(code)) return null;
  if (coachCode && code === coachCode) return { role: 'coach', playerId: null };
  const p = (data.players || []).find(x => x.code === code);
  return p ? { role: 'joueur', playerId: p.id } : null;
}

// Code déjà pris par le coach ou un autre joueur ? Renvoie un message d'erreur ou null.
function codeConflict(data, code, coachCode, exceptPlayerId) {
  if (!CODE_RE.test(String(code || ''))) return 'Le code doit faire exactement 4 chiffres.';
  if (coachCode && code === coachCode) return 'Ce code est déjà ton code coach.';
  const other = (data.players || []).find(p => p.code === code && p.id !== exceptPlayerId);
  return other ? 'Ce code est déjà celui de ' + other.riotId + '.' : null;
}

function randomCode(data, coachCode, rnd = Math.random) {
  for (let i = 0; i < 1000; i++) {
    const c = String(Math.floor(rnd() * 10000)).padStart(4, '0');
    if (!codeConflict(data, c, coachCode) && !/^(\d)\1{3}$/.test(c) && c !== '1234') return c;
  }
  return null;
}

// Données visibles pour une session (copie : l'original n'est jamais modifié)
function filterForSession(data, session) {
  const d = JSON.parse(JSON.stringify(data));
  if (!session) return null;
  if (session.role === 'coach') return d;
  const id = session.playerId;
  d.players = d.players.filter(p => p.id === id).map(p => { delete p.code; return p; });
  d.games = d.games.filter(g => g.playerId === id);
  d.ignored = d.ignored.filter(g => g.playerId === id);
  d.ranks = d.ranks.filter(r => r.playerId === id);
  d.sessions = d.sessions.filter(s => s.playerId === id);
  return d;
}

// Limite locale : 5 codes faux → 30 s d'attente (puis doublée à chaque nouvel échec, max 15 min)
class Limiter {
  constructor(now = Date.now) { this.now = now; this.fails = 0; this.until = 0; }
  blockedFor() { return Math.max(0, this.until - this.now()); }
  fail() {
    this.fails++;
    if (this.fails >= 5) this.until = this.now() + Math.min(15 * 60e3, 30e3 * Math.pow(2, this.fails - 5));
  }
  ok() { this.fails = 0; this.until = 0; }
}

module.exports = { checkLocalCode, codeConflict, randomCode, filterForSession, Limiter, CODE_RE };
