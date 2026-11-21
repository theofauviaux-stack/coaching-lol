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
  fiche_invalide: 'Fiche trop longue ou invalide.',
  moments_absents: 'Les moments de cette partie ne sont pas encore sur le serveur : ils y arrivent à la prochaine synchronisation du coach (parties des 45 derniers jours).',
  moments_invalides: 'Moments invalides.',
  analyse_invalide: 'Envoi invalide (10 vidéos au plus, 30 Mo au plus chacune).',
  trop_d_analyses: 'Tu as déjà 3 parties en cours d\'analyse : attends que le coach en termine une.',
  stockage_plein: 'L\'espace vidéo du serveur est plein : le coach doit d\'abord terminer des analyses.',
  analyse_inconnue: 'Cette analyse n\'existe plus.',
  analyse_fermee: 'Cette analyse est terminée : la discussion est fermée.',
  commentaire_invalide: 'Message vide ou trop long (2 000 caractères au plus).',
  export_impossible: 'Cette analyse ne peut pas être exportée (pas encore terminée par le coach, ou déjà exportée).',
  videos_restantes: 'Les vidéos ne sont pas encore effacées du serveur.',
  partie_invalide: 'Partie illisible : elle n\'a pas pu être envoyée.',
  journal_invalide: 'Journal du tournage illisible.',
  progression_invalide: 'Progression du cours illisible : elle n\'a pas pu être enregistrée.',
  trop_de_parties: 'Trop de parties personnalisées en attente : ton coach doit d\'abord ouvrir son app pour les reprendre.'
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
      if (res.status === 404 && /function|PGRST202/i.test(String(text))) throw new CloudError('Le serveur du coach n\'est pas encore à jour pour cette fonction (' + fn + ').', 'MISSING');
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
  // analyses de parties : moments envoyés par le coach, analyses envoyées par les joueurs, discussion
  coachMomentsPush(key, items) { return this.rpc('coach_moments_push', { p_key: key, p: items }); }
  coachAnalyses(key) { return this.rpc('coach_analyses', { p_key: key }); }
  coachAnalysisGet(key, id) { return this.rpc('coach_analysis_get', { p_key: key, p_id: id }); }
  // dessin : envoyé seulement s'il y en a un (les serveurs pas encore à jour acceptent les messages sans dessin)
  coachAnalysisComment(key, id, t, text, drawing) { return this.rpc('coach_analysis_comment', Object.assign({ p_key: key, p_id: id, p_t: t, p_text: text }, drawing ? { p_drawing: drawing } : {})); }
  coachFilmReports(key) { return this.rpc('coach_film_reports', { p_key: key }); }
  coachFilmReportsDone(key, ids) { return this.rpc('coach_film_reports_done', { p_key: key, p_ids: ids }); }
  coachAnalysisClose(key, id) { return this.rpc('coach_analysis_close', { p_key: key, p_id: id }); }
  coachAnalysisDelete(key, id) { return this.rpc('coach_analysis_delete', { p_key: key, p_id: id }); }
  customGameAdd(token, matchId, game, moments) { return this.rpc('custom_game_add', { p_token: token, p_match: matchId, p_game: game, p_moments: moments || null }); }
  coachCustomGames(key) { return this.rpc('coach_custom_games', { p_key: key }); }
  coachCustomGamesDone(key, list) { return this.rpc('coach_custom_games_done', { p_key: key, p: list }); }
  coachClipsPurge(key) { return this.rpc('coach_clips_purge', { p_key: key }); }
  coachClipsGone(key, id) { return this.rpc('coach_clips_gone', { p_key: key, p_id: id }); }
  momentsGet(token, matchId) { return this.rpc('moments_get', { p_token: token, p_match: matchId }); }
  analysisCreate(token, p) { return this.rpc('analysis_create', { p_token: token, p }); }
  analysisReady(token, id) { return this.rpc('analysis_ready', { p_token: token, p_id: id }); }
  analysesMine(token) { return this.rpc('analyses_mine', { p_token: token }); }
  analysisGet(token, id) { return this.rpc('analysis_get', { p_token: token, p_id: id }); }
  analysisComment(token, id, t, text, drawing) { return this.rpc('analysis_comment', Object.assign({ p_token: token, p_id: id, p_t: t, p_text: text }, drawing ? { p_drawing: drawing } : {})); }
  filmReport(token, report) { return this.rpc('film_report_add', { p_token: token, p: report }); }
  // cours : progression du joueur (le joueur écrit, le coach relit)
  courseSave(token, courseId, data) { return this.rpc('course_save', { p_token: token, p_course: courseId, p: data }); }
  coursesMine(token) { return this.rpc('courses_mine', { p_token: token }); }
  coachCourses(key) { return this.rpc('coach_courses', { p_key: key }); }
  analysisExportDone(token, id) { return this.rpc('analysis_export_done', { p_token: token, p_id: id }); }
  analysisForget(token, id) { return this.rpc('analysis_forget', { p_token: token, p_id: id }); }

  // ---- stockage des vidéos (dossier public « clips ») ; règles d'accès dans supabase/analyses.sql
  clipUrl(id, file) { return `${this.url}/storage/v1/object/public/clips/${id}/${file}`; }
  async storage(method, p, body, type, bearer) {
    const headers = { apikey: this.publicKey };
    if (bearer || /^eyJ/.test(this.publicKey)) headers.Authorization = 'Bearer ' + this.publicKey;
    if (type) headers['Content-Type'] = type;
    let res;
    try {
      res = await this.fetch(`${this.url}/storage/v1/object/${p}`, {
        method, headers, body,
        signal: AbortSignal.timeout ? AbortSignal.timeout(Math.max(this.timeoutMs, 180000)) : undefined
      });
    } catch (e) {
      throw new CloudError('Pas de connexion au serveur (' + e.message + ').', 'NETWORK');
    }
    const text = await res.text();
    let out = null;
    try { out = text ? JSON.parse(text) : null; } catch (e) { out = text; }
    const code = out && out.statusCode ? String(out.statusCode) : String(res.status);
    if (res.ok && !(out && out.error)) return out;
    const msg = (out && (out.message || out.error)) || String(text).slice(0, 200);
    // clé publique d'un nouveau format refusée sans « Authorization » (ou l'inverse) : un second essai
    if (!bearer && !/^eyJ/.test(this.publicKey) && /jwt|jws|token|authoriz/i.test(msg)) return this.storage(method, p, body, type, true);
    throw new CloudError('Stockage des vidéos : ' + msg, code === '409' || /duplicate|already exists/i.test(msg) ? 'DUPLICATE' : 'HTTP');
  }
  uploadClip(id, file, buffer) {
    return this.storage('POST', `clips/${id}/${file}`, buffer, 'video/webm').catch(e => { if (e.code === 'DUPLICATE') return { duplicate: true }; throw e; });
  }
  deleteClips(paths) { return this.storage('DELETE', 'clips', JSON.stringify({ prefixes: paths }), 'application/json'); }
  // la vidéo est-elle encore lisible en ligne ? (vérification après effacement)
  async clipExists(id, file) {
    try {
      const res = await this.fetch(this.clipUrl(id, file), { headers: { Range: 'bytes=0-0' }, signal: AbortSignal.timeout ? AbortSignal.timeout(this.timeoutMs) : undefined });
      try { await res.arrayBuffer(); } catch (e) { /* corps ignoré */ }
      return res.ok;
    } catch (e) {
      return true; // dans le doute (réseau), on considère qu'elle existe encore
    }
  }
}

// Instantané envoyé par l'app du coach : tout sauf la clé Riot, les secrets et les parties écartées.
function buildSnapshot(data, coachCode) {
  const s = data.settings || {};
  return {
    coachCode: coachCode || '',
    settings: { objectives: s.objectives || {}, cards: s.cards || [], axes: s.axes || [] },
    players: (data.players || []).map(p => {
      const { puuid, status, statusText, smurfs, ...rest } = p; // eslint-disable-line no-unused-vars
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
