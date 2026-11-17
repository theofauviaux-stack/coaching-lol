// Base en ligne (Supabase) : l'app du coach y envoie les données, l'app d'un joueur les lit avec son code.
// Tout passe par des fonctions SQL (voir supabase/schema.sql) appelées en HTTPS (« RPC » de Supabase).
const fs = require('fs');
const path = require('path');

const ERREURS = {
  code_inconnu: 'Code inconnu.',
  trop_essais: 'Trop d\'essais. Réessaie dans 15 minutes.',
  session_expiree: 'Session expirée : entre à nouveau ton code.',
  jeton_inconnu: 'Cet ordinateur n\'est pas encore enregistré sur le serveur.',
  creneau_invalide: 'Ce créneau n\'est pas réservable (entre 17 h et minuit, à l\'heure pile, dans les 30 jours).',
  creneau_pris: 'Ce créneau vient d\'être pris.',
  max_jour: '2 h maximum par jour et par joueur.',
  trop_de_reservations: 'Trop de réservations en attente : attends les réponses avant d\'en demander d\'autres.',
  reservation_inconnue: 'Réservation introuvable.',
  action_impossible: 'Action impossible pour cette réservation (elle a peut-être changé entre-temps).',
  trop_tot: 'Le coaching peut démarrer au plus tôt 30 minutes avant le créneau, et jusqu\'à sa fin.',
  seance_inconnue: 'Cette séance n\'existe plus.',
  fiche_invalide: 'Fiche trop longue ou invalide.'
};

// Adresse du projet et clé publique : publiques par conception (les tables sont fermées, seules
// les fonctions login / get_data / logout sont ouvertes). Fichier rempli lors de la configuration.
function loadConfig(dir = __dirname) {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(dir, 'cloud-config.json'), 'utf8'));
    if (c && /^https:\/\//.test(c.url || '') && c.publicKey) return { url: c.url.replace(/\/+$/, ''), publicKey: c.publicKey };
  } catch (e) { /* pas encore configuré */ }
  return null;
}

class CloudError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

class CloudClient {
  constructor({ url, publicKey, fetchImpl = fetch, timeoutMs = 20000 }) {
    this.url = url;
    this.publicKey = publicKey;
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async rpc(fn, args, key = this.publicKey) {
    const headers = { 'Content-Type': 'application/json', apikey: key };
    if (/^eyJ/.test(key)) headers.Authorization = 'Bearer ' + key; // anciennes clés (JWT)
    let res;
    try {
      res = await this.fetch(`${this.url}/rest/v1/rpc/${fn}`, {
        method: 'POST', headers, body: JSON.stringify(args),
        signal: AbortSignal.timeout ? AbortSignal.timeout(this.timeoutMs) : undefined
      });
    } catch (e) {
      throw new CloudError('Pas de connexion au serveur (' + e.message + ').', 'NETWORK');
    }
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch (e) { body = text; }
    if (!res.ok) {
      const msg = body && body.message ? body.message : String(text).slice(0, 200);
      if (res.status === 401 || res.status === 403) throw new CloudError('Accès refusé par le serveur (' + msg + ').', 'AUTH');
      throw new CloudError('Erreur du serveur ' + res.status + ' (' + msg + ').', 'HTTP');
    }
    if (body && body.error) throw new CloudError(ERREURS[body.error] || body.error, body.error);
    return body;
  }

  login(code) { return this.rpc('login', { p_code: String(code) }); }
  getData(token) { return this.rpc('get_data', { p_token: token }); }
  logout(token) { return this.rpc('logout', { p_token: token }).catch(() => null); }
  push(snapshot, secretKey) { return this.rpc('admin_push', { p: snapshot }, secretKey); }
  // réservations de coaching
  book(token, action, id, start) { return this.rpc('book', { p_token: token, p_action: action, p_id: id || null, p_start: start || null }); }
  bookingsMine(token) { return this.rpc('bookings_mine', { p_token: token }); }
  coachBookings(key) { return this.rpc('coach_bookings', { p_key: key }); }
  // fiches de séance remplies par les joueurs
  reportSave(token, sessionId, data) { return this.rpc('report_save', { p_token: token, p_session: sessionId, p: data }); }
  reportsMine(token) { return this.rpc('reports_mine', { p_token: token }); }
  coachReports(key) { return this.rpc('coach_reports', { p_key: key }); }
  coachReportSave(key, playerId, sessionId, data) { return this.rpc('coach_report_save', { p_key: key, p_player: playerId, p_session: sessionId, p: data }); }
  coachBook(key, action, id, start, player) { return this.rpc('coach_book', { p_key: key, p_action: action, p_id: id || null, p_start: start || null, p_player: player || null }); }
  // envoi avec le jeton propre à l'ordinateur du coach (clé publique + jeton enregistré dans la base)
  pushWithToken(snapshot, token) { return this.rpc('coach_push', { p_key: token, p: snapshot }); }
}

// Instantané envoyé par l'app du coach : tout sauf la clé Riot, les secrets et les parties écartées.
function buildSnapshot(data, coachCode) {
  const s = data.settings || {};
  return {
    coachCode: coachCode || '',
    settings: { objectives: s.objectives || {}, cards: s.cards || [], axes: s.axes || [] },
    players: (data.players || []).map(p => {
      const { puuid, status, statusText, ...rest } = p; // eslint-disable-line no-unused-vars
      return rest;
    }),
    games: data.games || [],
    ranks: data.ranks || [],
    sessions: data.sessions || []
  };
}

// Données reçues du serveur → même forme que les données locales, pour réutiliser l'interface.
function dataFromCloud(remote, base = {}) {
  const settings = Object.assign({}, base.settings || {}, remote.settings || {});
  return {
    settings,
    players: (remote.players || []).map(p => Object.assign({}, p, { code: undefined })),
    games: remote.games || [],
    ranks: remote.ranks || [],
    sessions: remote.sessions || [],
    ignored: [],
    pushedAt: remote.pushedAt || null
  };
}

module.exports = { CloudClient, CloudError, loadConfig, buildSnapshot, dataFromCloud, ERREURS };
