/* global Stats, Charts, icon */
'use strict';

// ======================================================================== constantes
const ROLES = ['Top', 'Jungle', 'Mid', 'ADC', 'Support'];
const REGIONS = ['euw', 'eune', 'na', 'kr', 'br', 'jp', 'lan', 'las', 'oce', 'tr', 'ru', 'me', 'sg', 'tw', 'vn'];
const RANGS = ['Fer', 'Bronze', 'Argent', 'Or', 'Platine', 'Émeraude', 'Diamant', 'Maître', 'Grand Maître', 'Challenger'];
const STATUTS = ['À faire', 'En cours', 'Acquis', 'Abandonné'];
const STATUT_CHIP = { 'Acquis': 'accent', 'En cours': 'blue', 'À faire': 'amber', 'Abandonné': '' };
const OBJ_GROUPS = [
  ['Résultats', ['Taux de victoire', 'KDA', 'KP', 'Morts moyennes']],
  ['Farm & laning', ['CS/min', 'CS à 10 min', 'Or/min', 'Morts avant 15 min', 'Écart or à 10 min', 'Écart XP à 10 min', 'Écart or à 15 min']],
  ['Vision', ['Vision/min', 'Wards posées', 'Wards détruites', 'Pinks achetées']],
  ['Combat & mental', ['Dégâts/min', 'Note mentale', '% objectifs de partie atteints', 'LP net']]
];
const OBJ_KEYS = OBJ_GROUPS.flatMap(g => g[1]);
const PCT_KEYS = new Set(['Taux de victoire', 'KP', '% objectifs de partie atteints']);
const DL = {
  mac: 'https://github.com/theofauviaux-stack/coaching-lol/releases/latest/download/Coaching-LoL-Mac.dmg',
  win: 'https://github.com/theofauviaux-stack/coaching-lol/releases/latest/download/Coaching-LoL-Windows.exe',
  page: 'https://github.com/theofauviaux-stack/coaching-lol/releases/latest'
};
const linksText = () => `Mac : ${DL.mac}\nWindows : ${DL.win}`;
const inviteText = p => `Salut ${gameName(p)} ! Voici ton espace de coaching LoL.

1. Télécharge l'app :
   Mac : ${DL.mac}
   Windows : ${DL.win}
2. Installe-la et ouvre-la.
   Mac : glisse l'app dans Applications ; si macOS la bloque, va dans Réglages Système › Confidentialité et sécurité › « Ouvrir quand même ».
   Windows : si « Windows a protégé votre ordinateur » s'affiche, clique sur « Informations complémentaires » puis « Exécuter quand même ».
3. Entre ton code à 4 chiffres : ${p.code || '????'}

Tu y retrouves tes stats, tes parties, tes objectifs et nos séances. L'app se met à jour toute seule.`;
async function copyText(text, msg) {
  try { await navigator.clipboard.writeText(text); toast(msg); } catch (e) { toast('Copie impossible : ' + e.message, 'err'); }
}
const PERIODS = [['10', '10 dernières'], ['20', '20 dernières'], ['all', 'Toutes'], ['coach', 'Depuis le coaching']];

const state = {
  data: null, page: 'accueil', playerId: null, period: '20', metric: null, sessionOpen: null, settingsTab: 'joueur',
  code: '', setupFirst: null, busy: false, loginMsg: '', shake: false,
  gameFilter: 'all', q: '', showCodes: {}, drawer: null, pending: false,
  collapsed: (() => { try { return localStorage.getItem('collapsed') === '1'; } catch (e) { return false; } })()
};

// ======================================================================== utilitaires
const $ = s => document.querySelector(s);
const esc = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const opt = (v, cur, label) => `<option value="${esc(v)}" ${String(v) === String(cur) ? 'selected' : ''}>${esc(label === undefined ? v : label)}</option>`;
const dateFr = t => (t ? new Date(t).toLocaleDateString('fr-FR') : '—');
const dateLong = t => (t ? new Date(t).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }) : '—');
const dateTimeFr = t => (t ? new Date(t).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const isoDay = t => (t ? new Date(t).toISOString().slice(0, 10) : '');
const ago = t => {
  if (!t) return 'jamais';
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'à l\'instant';
  if (m < 60) return 'il y a ' + m + ' min';
  if (m < 48 * 60) return 'il y a ' + Math.round(m / 60) + ' h';
  return 'le ' + dateFr(t);
};
const D = () => state.data;
const isCoach = () => D().session && D().session.role === 'coach';
const canEdit = () => D().session && !D().session.readOnly;
const player = () => (D().players || []).find(p => p.id === state.playerId) || null;
const settingsOf = p => ({
  cards: (p && p.cards && p.cards.length ? p.cards : D().settings.cards) || [],
  axes: (p && p.axes && p.axes.length ? p.axes : D().settings.axes) || []
});
const gameName = p => String(p ? p.riotId : '').split('#')[0];
const initials = s => String(s || '?').replace(/[^A-Za-zÀ-ÿ0-9 ]/g, ' ').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';

// champions : noms français et images Data Dragon
const champInfo = c => (D() && D().settings.champs && D().settings.champs[String(c || '').toLowerCase()]) || null;
const champImg = c => {
  const v = D() && D().settings.ddVersion;
  if (!v || !c) return '';
  const ci = champInfo(c);
  const key = ci ? ci[0] : String(c).replace(/[ '.]/g, '').replace('FiddleSticks', 'Fiddlesticks');
  return `https://ddragon.leagueoflegends.com/cdn/${v}/img/champion/${key}.png`;
};
const champ = c => { const ci = champInfo(c); return esc(ci ? ci[1] : c); };
const img = (c, cls = 'ico') => (champImg(c) ? `<img class="${cls}" src="${champImg(c)}" alt="">` : '');

function toast(msg, kind = 'ok', ms = 3200) {
  const t = $('#toast');
  t.innerHTML = icon(kind === 'err' ? 'alert' : 'check', 16, kind === 'err' ? 'red' : 'ok') + `<span>${esc(msg)}</span>`;
  t.classList.remove('hidden');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.add('hidden'), ms);
}

// réponse d'une action : nouvelles données + message
function apply(r, okMsg) {
  if (!r) return false;
  if (r.data) state.data = r.data;
  if (r.ok) { if (okMsg || r.message) toast(okMsg || r.message); render(); return true; }
  if (r.message) toast(r.message, 'err', 5000);
  render();
  return false;
}

// ======================================================================== créneaux de coaching (heure de Paris)
const TZ = 'Europe/Paris';
const HOURS = [17, 18, 19, 20, 21, 22, 23];
const BOOK_DAYS = 14;
function parisParts(date) {
  const o = {};
  for (const p of new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(date)) o[p.type] = Number(p.value);
  return o;
}
function parisOffsetMin(date) {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'longOffset' }).formatToParts(date).find(p => p.type === 'timeZoneName');
  const m = part && part.value.match(/GMT([+-])(\d{2}):?(\d{2})?/);
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0)) : 0;
}
// créneau « jour J (0 = aujourd'hui, à Paris), heure h » → instant exact
function slotTime(dayOffset, h) {
  const t = parisParts(new Date());
  const guess = Date.UTC(t.year, t.month - 1, t.day + dayOffset, h);
  return guess - parisOffsetMin(new Date(guess)) * 60000;
}
const dayLabel = ms => new Date(ms).toLocaleDateString('fr-FR', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' });
const dayLong = ms => new Date(ms).toLocaleDateString('fr-FR', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' });
const hourOf = ms => parisParts(new Date(ms)).hour;
const slotText = ms => `${dayLong(ms)}, ${hourOf(ms)} h – ${(hourOf(ms) + 1) % 24} h`;
const parisDay = ms => { const p = parisParts(new Date(ms)); return p.year + '-' + p.month + '-' + p.day; };
const ACTIVE = ['en_attente', 'proposee', 'acceptee', 'en_cours'];
const bSlot = b => new Date(b.status === 'proposee' ? b.proposed : b.start).getTime();
const BK_LABEL = { en_attente: 'En attente de réponse', proposee: 'Nouvel horaire proposé', acceptee: 'Confirmé', en_cours: 'En coaching', terminee: 'Terminé', annulee: 'Annulé', refusee: 'Refusé', expiree: 'Sans réponse' };
const BK_CHIP = { en_attente: 'amber', proposee: 'blue', acceptee: 'accent', en_cours: 'accent', terminee: '', annulee: '', refusee: 'red', expiree: '' };
const BK = () => D().bookings;
const fmtClock = ms => { const s = Math.max(0, Math.round(ms / 1000)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };

// grille de créneaux. mode « joueur » : ses réservations ; mode « proposer » : le coach choisit un horaire pour une demande
function slotGrid({ mode, playerId, bookingId }) {
  const bk = BK();
  const week = state.bookWeek || 0;
  const days = Array.from({ length: 7 }, (_, i) => i + week * 7);
  let mine = [], busy = [];
  if (mode === 'joueur') { mine = bk.mine || []; busy = (bk.busy || []).map(x => new Date(x).getTime()); }
  else { const all = (bk.all || []).filter(b => b.id !== bookingId && ACTIVE.includes(b.status)); mine = all.filter(b => b.playerId === playerId); busy = all.filter(b => b.playerId !== playerId).map(bSlot); }
  const mineActive = mine.filter(b => ACTIVE.includes(b.status));
  const perDay = {};
  for (const b of mineActive) perDay[parisDay(bSlot(b))] = (perDay[parisDay(bSlot(b))] || 0) + 1;
  const now = Date.now();
  const head = days.map(d => `<th>${esc(dayLabel(slotTime(d, 17)))}</th>`).join('');
  const rows = HOURS.map(h => `<tr><td class="l muted">${h} h</td>${days.map(d => {
    const t = slotTime(d, h);
    const own = mineActive.find(b => bSlot(b) === t);
    if (own) return `<td><button class="slot mine ${own.status}" data-action="slot-mine" data-id="${own.id}">${own.status === 'acceptee' || own.status === 'en_cours' ? 'Confirmé' : own.status === 'proposee' ? 'Proposé' : 'Demandé'}</button></td>`;
    if (t <= now) return '<td><span class="slot past"></span></td>';
    if (busy.includes(t)) return '<td><span class="slot busy">Pris</span></td>';
    if (t > now + 30 * 864e5) return '<td><span class="slot past"></span></td>';
    if ((perDay[parisDay(t)] || 0) >= 2) return '<td><span class="slot full" data-tip="2 h maximum par jour">—</span></td>';
    return `<td><button class="slot free" data-action="${mode === 'joueur' ? 'slot-free' : 'slot-propose'}" data-t="${t}" ${bookingId ? `data-id="${bookingId}"` : ''}>Libre</button></td>`;
  }).join('')}</tr>`).join('');
  return `<div class="row" style="margin:6px 0 10px"><div class="seg">
      <button class="${week === 0 ? 'on' : ''}" data-action="book-week" data-v="0">Cette semaine</button>
      <button class="${week === 1 ? 'on' : ''}" data-action="book-week" data-v="1">Semaine suivante</button></div>
      <span class="muted small">Créneaux d'1 h, de 17 h à minuit (heure de Paris). 2 h maximum par jour.</span></div>
    <table class="table slots"><tr><th class="l"></th>${head}</tr>${rows}</table>`;
}

// ======================================================================== statistiques par période
function roleGames(p) { return Stats.playerGames(D(), p, ''); }
function periodGames(p) {
  const all = roleGames(p);
  if (state.period === '10') return all.slice(-10);
  if (state.period === '20') return all.slice(-20);
  if (state.period === 'coach' && p.startDate) { const t = new Date(p.startDate).getTime(); return all.filter(g => g.date >= t); }
  return all;
}
const metricOf = label => { const k = Stats.KPIS.find(x => x[0] === label); return k ? k[3] : null; };
const fmtOf = label => { const k = Stats.KPIS.find(x => x[0] === label); return k ? k[2] : 'dec2'; };
const axisFmt = f => (f === 'pct' ? (v => Math.round(v * 100) + '%') : f === 'diff' || f === 'int' ? (v => Math.round(v).toLocaleString('fr-FR')) : (v => v.toFixed(1).replace('.', ',')));
const lastRank = p => (D().ranks || []).filter(r => r.playerId === p.id).sort((a, b) => b.date - a.date)[0] || null;
const ranksOf = p => (D().ranks || []).filter(r => r.playerId === p.id && r.score !== null && r.score !== undefined).sort((a, b) => a.date - b.date);
const TIER_SHORT = ['Fer', 'Bronze', 'Argent', 'Or', 'Plat.', 'Émer.', 'Diam.'];
const DIV_TXT = ['IV', 'III', 'II', 'I'];
// score de rang (palier × 400 + division × 100 + LP ; Maître et plus = 2 800 + LP) → texte lisible
const scoreText = v => (v >= 2800 ? Math.round(v - 2800) + ' LP' : `${TIER_SHORT[Math.max(0, Math.floor(v / 400))] || '?'} ${DIV_TXT[Math.floor((v % 400) / 100)] || ''}`);
// LP gagnés sur la période : rang actuel moins le rang au début de la période,
// ou au moment où le profil a été ajouté si la période commence avant (premier relevé).
function lpNet(p, gs) {
  const snaps = ranksOf(p);
  if (!snaps.length) return null;
  const start = gs.length ? gs[0].date : Date.now();
  const before = snaps.filter(s => s.date <= start);
  const base = before.length ? before[before.length - 1] : snaps[0];
  return { value: snaps[snaps.length - 1].score - base.score, from: base.date, sinceAdded: !before.length || base === snaps[0] };
}
function applyLpNet(p, rows, gs) {
  const r = rows.find(x => x.label === 'LP net');
  const n = lpNet(p, gs);
  if (!r || !n) return;
  r.value = n.value;
  r.ok = Stats.status(n.value, r.obj);
  r.progress = Stats.progress(n.value, r.obj);
  r.lpFrom = n;
}

function lpCell(g) {
  if (g.lpDelta === null || g.lpDelta === undefined) return '<span class="faint" data-tip="LP inconnus : partie jouée avant le début du suivi, ou plusieurs parties entre deux relevés de rang.">—</span>';
  const cls = g.lpDelta > 0 ? 'ok' : g.lpDelta < 0 ? 'red' : 'muted';
  const tip = g.lpManual ? 'Saisi à la main' : g.lpEstimated ? 'Estimation : plusieurs parties ont été jouées entre deux relevés de rang' : 'Calculé à partir du rang avant et après la partie';
  return `<span class="${cls}" data-tip="${tip}">${g.lpEstimated ? '≈ ' : ''}${Stats.fmt(g.lpDelta, 'diff')}</span>`;
}
const dots = gs => `<div class="dots">${gs.map(g => `<i class="${g.win ? 'w' : 'l'}"></i>`).join('')}</div>`;
const winrate = gs => (gs.length ? gs.filter(g => g.win).length / gs.length : null);
function gameTip(g, label, value) {
  return `${champInfo(g.champion) ? champInfo(g.champion)[1] : g.champion}${g.opponent ? ' contre ' + (champInfo(g.opponent) ? champInfo(g.opponent)[1] : g.opponent) : ''}\n${g.win ? 'Victoire' : 'Défaite'} · ${g.kills}/${g.deaths}/${g.assists} · ${dateFr(g.date)}${label ? '\n' + label + ' : ' + value : ''}\nClique pour le détail`;
}

// ======================================================================== rendu
function render() {
  const d = D();
  if (!d) return;
  hideTip();
  if (d.locked) {
    $('#app').classList.add('hidden');
    closeDrawer(true); closeModal();
    $('#login').classList.remove('hidden');
    renderLogin();
    return;
  }
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  if (d.session.role === 'joueur') state.playerId = d.session.playerId;
  if (state.playerId && !player()) state.playerId = null;
  if (!state.playerId && d.players.length) state.playerId = d.players[0].id;
  if (!pages().some(x => x.id === state.page)) state.page = 'accueil';
  $('#app').classList.toggle('collapsed', state.collapsed);
  renderSidebar();
  renderTopbar();
  const focus = rememberFocus();
  $('#page').innerHTML = `<div class="wrap">${PAGES[state.page]()}</div>`;
  window.api.uiState({ page: state.page, playerId: state.playerId, settingsTab: state.settingsTab, period: state.period });
  restoreFocus(focus);
  if (state.drawer) renderDrawer();
  hookImages();
}

function rememberFocus() {
  const a = document.activeElement;
  if (!a || !a.id || !$('#page').contains(a)) return null;
  return { id: a.id, start: a.selectionStart, end: a.selectionEnd };
}
function restoreFocus(f) {
  if (!f) return;
  const el = document.getElementById(f.id);
  if (!el) return;
  el.focus();
  try { el.setSelectionRange(f.start, f.end); } catch (e) { /* champ sans curseur */ }
}
function hookImages() {
  document.querySelectorAll('img').forEach(i => i.addEventListener('error', () => { i.style.visibility = 'hidden'; }, { once: true }));
}
const isTyping = () => {
  const a = document.activeElement;
  return a && ['INPUT', 'TEXTAREA', 'SELECT'].includes(a.tagName) && a.id !== 'q';
};

// ======================================================================== écran de code
function renderLogin() {
  const d = D();
  const setup = d.setup;
  const title = setup ? (state.setupFirst ? 'Confirme ton code coach' : 'Crée ton code coach') : 'Entre ton code';
  const sub = setup
    ? (state.setupFirst ? 'Tape-le une deuxième fois.' : 'Il ouvrira tous tes joueurs. 4 chiffres, à garder pour toi.')
    : 'Ton code joueur, ou le code coach.';
  const boxes = [0, 1, 2, 3].map(i => `<div class="${i < state.code.length ? 'full' : ''} ${i === state.code.length && !state.busy ? 'on' : ''}"></div>`).join('');
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'back'].map(k =>
    k === '' ? '<button class="blank" tabindex="-1"></button>'
      : k === 'back' ? `<button data-key="back" aria-label="Effacer">${icon('delete', 22)}</button>`
        : `<button data-key="${k}">${k}</button>`).join('');
  let msg = state.loginMsg;
  if (!msg && d.blockedMs) msg = 'Trop d\'essais. Réessaie dans ' + Math.ceil(d.blockedMs / 1000) + ' s.';
  const foot = !d.coachMachine && !d.cloudConfigured ? 'Cet ordinateur n\'est relié à aucun coach.' : 'Coaching LoL · version ' + esc(d.appVersion);
  $('#login').innerHTML = `<div class="login-card">
    <div class="logo">${icon(setup ? 'shield' : 'lock', 26)}</div>
    <h1>${title}</h1><div class="sub">${sub}</div>
    <div class="boxes ${state.shake ? 'shake' : ''}">${boxes}</div>
    <div class="login-msg ${msg ? '' : 'info'}">${state.busy ? '<span class="spinner"></span>' : esc(msg)}</div>
    <div class="keypad">${keys}</div>
    <div class="login-foot">${foot}</div></div>`;
}

function pressKey(k) {
  if (state.busy) return;
  if (k === 'back') { state.code = state.code.slice(0, -1); state.loginMsg = ''; renderLogin(); return; }
  if (!/^\d$/.test(k) || state.code.length >= 4) return;
  state.code += k;
  state.loginMsg = '';
  renderLogin();
  if (state.code.length === 4) setTimeout(submitCode, 120);
}

async function submitCode() {
  const code = state.code;
  const d = D();
  if (d.setup && !state.setupFirst) { state.setupFirst = code; state.code = ''; renderLogin(); return; }
  if (d.setup && state.setupFirst !== code) { state.setupFirst = null; return loginFail('Les deux codes ne correspondent pas. Recommence.'); }
  state.busy = true;
  renderLogin();
  const r = d.setup ? await window.api.setupCoach(code) : await window.api.login(code);
  state.busy = false;
  if (r && r.ok) {
    state.code = ''; state.setupFirst = null; state.loginMsg = '';
    state.page = 'accueil'; state.period = '20'; state.metric = null; state.playerId = null;
    state.data = r.data;
    render();
    if (d.setup) toast('Code coach créé. Garde-le bien : il ouvre tous tes joueurs.');
    return;
  }
  loginFail(r ? r.message : 'Erreur inconnue.');
}
function loginFail(msg) {
  state.loginMsg = msg;
  state.shake = true;
  renderLogin();
  setTimeout(() => { state.shake = false; state.code = ''; renderLogin(); }, 450);
}

async function logout() {
  closeDrawer(true); closeModal();
  state.data = await window.api.logout();
  state.code = ''; state.loginMsg = '';
  render();
}

// ======================================================================== barre latérale et barre du haut
function pages() {
  const coach = isCoach();
  const list = [
    { id: 'accueil', label: 'Accueil', ico: 'home', sec: 'Espace' },
    { id: 'dashboard', label: 'Tableau de bord', ico: 'dashboard', sec: 'Espace' },
    { id: 'parties', label: 'Parties', ico: 'games', sec: 'Espace' },
    { id: 'seances', label: 'Séances', ico: 'sessions', sec: 'Espace' }
  ];
  if (coach && canEdit()) list.splice(1, 0, { id: 'direct', label: 'En direct', ico: 'radio', sec: 'Espace', badge: liveGames().length });
  if (!coach) list.push({ id: 'objectifs', label: 'Mes objectifs', ico: 'target', sec: 'Espace' });
  if (coach && canEdit()) list.push({ id: 'joueurs', label: 'Joueurs', ico: 'players', sec: 'Coach' }, { id: 'parametres', label: 'Paramètres', ico: 'settings', sec: 'Coach' });
  return list;
}

function renderSidebar() {
  const d = D();
  const coach = isCoach();
  let sec = '';
  const nav = pages().map(x => {
    const head = x.sec !== sec ? `<div class="nav-label">${x.sec}</div>` : '';
    sec = x.sec;
    return head + `<button class="nav ${state.page === x.id ? 'active' : ''}" data-action="go" data-page="${x.id}" title="${esc(x.label)}">${icon(x.ico, 18)}<span>${esc(x.label)}</span>${x.badge ? `<i class="nav-badge">${x.badge}</i>` : ''}</button>`;
  }).join('');
  const me = coach ? null : player();
  const who = coach
    ? `<div class="avatar">${icon('crown', 16)}</div><div class="who"><b>Coach</b><small>${canEdit() ? 'Tous les joueurs' : 'Lecture seule'}</small></div>`
    : `<div class="avatar">${me ? esc(initials(gameName(me))) : '?'}</div><div class="who"><b>${me ? esc(me.riotId) : 'Joueur'}</b><small>${me ? esc(me.role) : ''}</small></div>`;
  $('#sidebar').innerHTML = `
    <div class="brand"><div class="logo">${icon('sword', 18)}</div><div class="txt"><div class="name">Coaching LoL</div><div class="tag">${coach ? 'Espace coach' : 'Espace joueur'}</div></div>
      <button class="collapse" data-action="collapse" title="Réduire le menu">${icon('chevron', 14)}</button></div>
    ${nav}
    <div class="bottom">
      <div class="profile">${who}<button class="icon-btn" data-action="logout" title="Changer de profil">${icon('logout', 17)}</button></div>
      <div class="version">Version ${esc(d.appVersion)}</div>
    </div>`;
}

function renderTopbar() {
  const d = D();
  const pg = pages().find(x => x.id === state.page);
  const perPlayer = ['dashboard', 'parties', 'seances', 'parametres'].includes(state.page);
  const p = player();
  const sw = isCoach() && perPlayer && d.players.length && !(state.page === 'parametres' && state.settingsTab === 'general')
    ? `<select class="select-player" data-change="player">${d.players.map(x => opt(x.id, state.playerId, x.riotId)).join('')}</select>` : '';
  const ro = !canEdit() && d.session.role !== 'joueur' ? `<span class="chip">${icon('eye', 14)} Lecture seule</span>` : '';
  const bk = d.bookings;
  let live = '';
  if (bk && bk.coaching && bk.coaching.length) {
    const g = bk.coaching[0];
    const who = (d.players.find(x => x.id === g.playerId) || {}).riotId || '';
    live = `<div class="live ${g.endsAt - Date.now() <= 5 * 60000 ? 'warn' : ''}" id="live" data-ends="${g.endsAt}"><span class="pulse"></span>En coaching avec <b>${esc(String(who).split('#')[0])}</b>
      <span class="clock" id="live-clock">${fmtClock(g.endsAt - Date.now())}</span><button class="btn" data-action="bk" data-act="terminer" data-id="${g.id}">Terminer</button></div>`;
  } else if (bk && (bk.mine || []).some(b => b.status === 'en_cours')) {
    live = '<div class="live"><span class="pulse"></span>En coaching</div>';
  }
  $('#topbar').innerHTML = `<div class="crumbs">Coaching LoL ${icon('chevron', 14)} <b>${esc(pg ? pg.label : '')}</b>${perPlayer && p && isCoach() ? ` ${icon('chevron', 14)} ${esc(p.riotId)}` : ''}</div>
    <span class="spacer"></span>${live}${ro}${sw}`;
}

// ======================================================================== ACCUEIL
function pageAccueil() {
  return isCoach() ? accueilCoach() : accueilJoueur();
}

function playerRow(p) {
  const gs = roleGames(p);
  const last = gs.slice(-20);
  const rk = lastRank(p);
  const main = Stats.groupBy(last, 'champion')[0];
  const wr = winrate(last);
  return `<div class="row-link" data-action="open-player" data-id="${p.id}">
    <div class="tile">${main && champImg(main.name) ? `<img src="${champImg(main.name)}" alt="">` : `<b>${esc(initials(gameName(p)))}</b>`}</div>
    <div class="t"><b>${esc(p.riotId)}</b><span>${esc(p.role || '?')} · ${rk ? esc(rk.label) : 'rang non relevé'}${wr === null ? '' : ' · ' + Math.round(wr * 100) + '% de victoires sur ' + last.length}</span></div>
    ${liveChip(p)}${dots(gs.slice(-8))}
    <div class="go">${icon('arrow', 18)}</div></div>`;
}

// demandes et coachings d'un joueur, affichés sous sa ligne sur l'accueil du coach
function bookingAlerts(p) {
  const bk = BK();
  if (!bk || !bk.all) return '';
  const now = Date.now();
  const list = bk.all.filter(b => b.playerId === p.id && (ACTIVE.includes(b.status))).sort((a, b) => bSlot(a) - bSlot(b));
  return list.map(b => {
    const t = bSlot(b);
    if (b.status === 'en_attente') return `<div class="bk-alert">${icon('calendar', 16)}<span><b>Demande de coaching</b> · ${esc(slotText(t))}</span><span class="spacer"></span>
      <button class="btn primary" data-action="bk" data-act="accepter" data-id="${b.id}">${icon('check', 15)} Accepter</button>
      <button class="btn" data-action="bk-propose" data-id="${b.id}">Proposer un autre horaire</button></div>`;
    if (b.status === 'proposee') return `<div class="bk-alert muted-alert">${icon('clock', 16)}<span>Tu as proposé ${esc(slotText(t))} · en attente de sa réponse</span><span class="spacer"></span>
      <button class="btn ghost" data-action="bk" data-act="annuler" data-id="${b.id}">Annuler</button></div>`;
    if (b.status === 'acceptee') {
      const canStart = now >= t - 30 * 60000 && now <= t + 60 * 60000;
      return `<div class="bk-alert ok-alert">${icon('calendar', 16)}<span><b>Coaching prévu</b> · ${esc(slotText(t))}</span><span class="spacer"></span>
        ${canStart ? `<button class="btn primary" data-action="bk" data-act="demarrer" data-id="${b.id}">${icon('clock', 15)} Démarrer le coaching</button>` : '<span class="muted small">« Démarrer » s\'active 30 min avant</span>'}
        <button class="btn" data-action="bk-propose" data-id="${b.id}">Déplacer</button><button class="btn ghost" data-action="bk" data-act="annuler" data-id="${b.id}">Annuler</button></div>`;
    }
    return '';
  }).join('');
}

function accueilCoach() {
  const d = D();
  const n = d.players.length;
  const bk = BK();
  const rows = d.players.map(p => playerRow(p) + bookingAlerts(p)).join('');
  const bkNote = !bk ? '' : !bk.linked || bk.error
    ? `<div class="bk-alert muted-alert">${icon('cloud', 16)}<span>Réservations indisponibles : ${esc(bk.error || 'relie d\'abord cet ordinateur au serveur')} (Paramètres › Général › Serveur en ligne).</span></div>` : '';
  const add = canEdit() ? `<div class="row-link" data-action="new-player"><div class="tile">${icon('plus', 20)}</div><div class="t"><b>Ajouter un joueur</b><span>Son pseudo Riot, son rôle : ses parties arrivent toutes seules.</span></div><div class="go">${icon('arrow', 18)}</div></div>` : '';
  return `<h1>Bonjour coach</h1>
    <div class="sub">${n ? n + ' joueur' + (n > 1 ? 's' : '') + ' suivi' + (n > 1 ? 's' : '') + '. Les parties arrivent automatiquement.' : 'Ajoute ton premier joueur pour commencer.'}</div>
    ${bkNote}<div class="rows">${rows}${add}</div>`;
}

function accueilJoueur() {
  const p = player();
  if (!p) return '<div class="empty">Ton coach n\'a pas encore préparé ton espace.</div>';
  const gs = roleGames(p);
  const last20 = gs.slice(-20);
  const rk = lastRank(p);
  const wr = winrate(last20);
  const snapsJ = ranksOf(p);
  const lpJ = snapsJ.length ? snapsJ[snapsJ.length - 1].score - snapsJ[0].score : null;
  const next = (D().sessions || []).filter(s => s.playerId === p.id && s.next).map(s => s.next).sort().filter(x => x >= isoDay(Date.now()))[0];
  const row = (pg, ico, t, s) => `<div class="row-link" data-action="go" data-page="${pg}"><div class="tile">${icon(ico, 20)}</div><div class="t"><b>${t}</b><span>${s}</span></div><div class="go">${icon('arrow', 18)}</div></div>`;
  const bk = BK();
  const live = bk && (bk.mine || []).some(b => b.status === 'en_cours');
  const myList = bk ? (bk.mine || []).filter(b => ['en_attente', 'proposee', 'acceptee'].includes(b.status) || (['annulee', 'refusee'].includes(b.status) && bSlot(b) > Date.now())).sort((a, b) => bSlot(a) - bSlot(b)) : [];
  const nextBk = bk ? (bk.mine || []).filter(b => b.status === 'acceptee' && bSlot(b) + 36e5 > Date.now()).sort((a, b) => bSlot(a) - bSlot(b))[0] : null;
  const booking = !bk ? '' : `<h2>${icon('calendar', 18)} Réserver un coaching</h2>
    ${bk.error ? `<div class="bk-alert muted-alert">${icon('alert', 16)}<span>${esc(bk.error)}</span></div>` : ''}
    ${myList.length ? `<div class="bk-list">${myList.map(b => `<div class="bk-alert ${b.status === 'proposee' ? '' : 'muted-alert'}">${icon('calendar', 16)}
        <span><b>${esc(slotText(bSlot(b)))}</b>${b.status === 'proposee' ? ` · ton coach propose cet horaire à la place de ${esc(hourOf(new Date(b.start).getTime()) + ' h')}` : ''}</span><span class="spacer"></span>
        <span class="chip ${BK_CHIP[b.status] || ''}">${esc(BK_LABEL[b.status] || b.status)}</span>
        ${b.status === 'proposee' ? `<button class="btn primary" data-action="bk" data-act="accepter_proposition" data-id="${b.id}">Accepter</button><button class="btn" data-action="bk" data-act="refuser_proposition" data-id="${b.id}">Refuser</button>` : ''}
        ${b.status === 'en_attente' || b.status === 'acceptee' ? `<button class="btn ghost" data-action="bk" data-act="annuler" data-id="${b.id}">Annuler</button>` : ''}</div>`).join('')}</div>` : ''}
    ${slotGrid({ mode: 'joueur' })}`;
  return `${live ? `<div class="live-banner"><span class="pulse"></span>En coaching</div>` : ''}<h1>Salut ${esc(gameName(p))}</h1>
    <div class="sub">Ton espace de progression · ${esc(p.role)}${p.goal ? ' · objectif : ' + esc(p.goal) : ''}</div>
    <div class="stats-strip">
      <div class="stat"><div class="tile">${icon('trophy', 22)}</div><div><div class="k">Rang actuel</div><div class="v">${rk ? esc(rk.label.split(' · ')[0]) : '—'}</div><div class="muted small">${rk ? esc(rk.label.split(' · ')[1] || '') : ''}${lpJ === null ? '' : ` · <span class="${lpJ > 0 ? 'ok' : lpJ < 0 ? 'red' : ''}">${Stats.fmt(lpJ, 'diff')} LP</span> depuis le début`}</div></div></div>
      <div class="stat">${Charts.ring(wr)}<div><div class="k">Victoires (20 dernières)</div><div class="v">${wr === null ? '—' : Math.round(wr * 100) + '%'}</div></div></div>
      <div class="stat"><div><div class="k">Forme récente</div>${dots(gs.slice(-10))}<div class="muted small" style="margin-top:6px">${gs.slice(-10).filter(g => g.win).length} V · ${gs.slice(-10).filter(g => !g.win).length} D</div></div></div>
      <div class="stat"><div class="tile">${icon('calendar', 22)}</div><div><div class="k">Prochaine séance</div><div class="v" style="font-size:18px">${nextBk ? esc(slotText(bSlot(nextBk))) : next ? esc(dateLong(next)) : '—'}</div></div></div>
    </div>
    <div class="rows">
      ${row('dashboard', 'dashboard', 'Tableau de bord', 'Tes stats, tes objectifs et ton évolution partie après partie.')}
      ${row('parties', 'games', 'Parties', 'Tes dernières parties classées, en détail.')}
      ${row('seances', 'sessions', 'Séances', 'Tes séances, tes exercices et tes fiches à remplir.')}
      ${row('objectifs', 'target', 'Mes objectifs', 'Ce que ton coach attend de toi, et où tu en es.')}
    </div>
    ${ficheReminder(p)}
    ${booking}`;
}

// ======================================================================== TABLEAU DE BORD
function periodSeg(p) {
  return `<div class="seg">${PERIODS.filter(([k]) => k !== 'coach' || p.startDate).map(([k, l]) => `<button class="${state.period === k ? 'on' : ''}" data-action="period" data-v="${k}">${l}</button>`).join('')}</div>`;
}

function pageDashboard() {
  const d = D(), p = player();
  if (!p) return `<h1>Tableau de bord</h1><div class="empty">${isCoach() ? 'Ajoute d\'abord un joueur.' : 'Aucune donnée pour l\'instant.'}</div>`;
  const gs = periodGames(p);
  const rows = Stats.kpiTable(d, p, '', gs);
  applyLpNet(p, rows, gs);
  const by = Object.fromEntries(rows.map(r => [r.label, r]));
  const rk = lastRank(p);
  const snaps = ranksOf(p);
  const lpTotal = snaps.length ? snaps[snaps.length - 1].score - snaps[0].score : null;
  const cards = settingsOf(p).cards.filter(l => by[l]);
  if (!state.metric || !by[state.metric]) state.metric = cards.find(l => metricOf(l) && metricOf(l) !== 'Victoire') || cards.find(l => metricOf(l)) || 'CS/min';

  const kpis = cards.map(l => {
    const r = by[l];
    const pr = r.progress === null ? null : r.progress * 10;
    const tr = r.trend === 1 ? icon('up', 16, 'ok') : r.trend === -1 ? icon('down', 16, 'red') : '';
    return `<div class="kpi ${state.metric === l ? 'sel' : ''}" data-action="metric" data-metric="${esc(l)}" title="Voir l'évolution">
      <div class="lab">${esc(l)}</div><div class="trend">${tr}</div>
      <div class="val ${r.ok === false ? 'bad' : ''}">${Stats.fmt(r.value, r.format)}</div>
      <div class="obj">${r.obj.value === null ? 'Pas d\'objectif' : `Objectif ${r.obj.sens} ${Stats.fmt(r.obj.value, r.format)} ${r.ok ? icon('check', 13, 'ok') : icon('alert', 13, 'warn')}`}</div>
      ${r.lpFrom ? `<div class="tiny faint" style="margin-top:4px">${r.lpFrom.sinceAdded ? 'depuis l\'ajout du profil' : 'depuis le'} (${esc(dateFr(r.lpFrom.from))})</div>` : ''}
      ${pr === null ? '' : `<div class="bar ${r.ok === false ? 'bad' : ''}"><i style="width:${pr}%"></i></div>`}</div>`;
  }).join('');

  // courbe principale, partie par partie
  const metric = metricOf(state.metric);
  const f = fmtOf(state.metric);
  const startT = p.startDate ? new Date(p.startDate).getTime() : null;
  const cumulative = ['Victoire', 'Objectif de partie atteint'].includes(metric);
  let n = 0, tot = 0;
  const pts = gs.map(g => {
    let v = metric ? Stats.METRICS[metric](g) : null;
    if (cumulative && v !== null) { n++; tot += v; v = tot / n; }
    return { v, label: dateFr(g.date).slice(0, 5), tip: gameTip(g, state.metric + (cumulative ? ' (cumulé)' : ''), Stats.fmt(v, f)), id: g.matchId, win: g.win };
  });
  const mk = startT ? gs.findIndex(g => g.date >= startT) : -1;
  const obj = Stats.objectiveFor(d, p, state.metric).value;
  const chart = Charts.lineChart({ points: pts, target: obj, fmt: axisFmt(f), marker: mk, markerLabel: 'début du coaching', bounds: f === 'pct' ? [0, 1] : null });

  const form = roleGames(p).slice(-10);
  const formHtml = form.length ? `<div class="form">${form.map(g => `<div class="g ${g.win ? 'w' : 'l'}" data-action="game" data-id="${esc(g.matchId)}" data-tip="${esc(gameTip(g))}">${img(g.champion, '')}<div class="c">${champ(g.champion)}</div></div>`).join('')}</div>` : '<div class="muted">Aucune partie au rôle pour l\'instant.</div>';

  const table = rows.filter(r => r.label !== 'Parties jouées').map(r => {
    const pr = r.progress === null ? null : r.progress * 10;
    return `<tr class="click" data-action="metric" data-metric="${esc(r.label)}">
      <td class="l"><b>${esc(r.label)}</b></td><td><b>${Stats.fmt(r.value, r.format)}</b></td>
      <td class="${r.obj.custom ? 'ok' : 'muted'}">${r.obj.value === null ? '' : r.obj.sens + ' ' + Stats.fmt(r.obj.value, r.format)}</td>
      <td>${r.ok === null ? '' : r.ok ? '<span class="chip accent">Atteint</span>' : '<span class="chip amber">À travailler</span>'}</td>
      <td>${pr === null ? '' : `<span class="mini ${r.ok === false ? 'bad' : ''}"><i style="width:${pr}%"></i></span>`}</td>
      <td>${Stats.fmt(r.v10, r.format)}</td>
      <td>${r.trend === 1 ? icon('up', 15, 'ok') : r.trend === -1 ? icon('down', 15, 'red') : r.trend === 0 ? icon('flat', 15, 'faint') : ''}</td>
      <td>${Charts.sparkline(r.series)}</td></tr>`;
  }).join('');

  const group = (list, title) => list.length ? `<table class="table"><tr><th class="l">${title}</th><th>Parties</th><th>Victoires</th><th>KDA</th><th>CS/min</th><th>Écart or 15</th></tr>
    ${list.map(c => `<tr><td class="l">${img(c.name)}${champ(c.name)}</td><td>${c.games}</td><td class="${c.winrate >= 0.55 ? 'ok' : c.winrate < 0.45 ? 'red' : ''}">${Stats.fmt(c.winrate, 'pct')}</td>
      <td>${Stats.fmt(c.kda, 'dec2')}</td><td>${Stats.fmt(c.csmin, 'dec2')}</td><td>${Stats.fmt(c.gd15, 'diff')}</td></tr>`).join('')}</table>` : '<div class="muted">—</div>';

  return `<div class="row" style="align-items:flex-start">
      <div><h1>${esc(p.riotId)}</h1>
        <div class="row" style="margin-bottom:24px"><span class="chip">${esc(p.role)}</span>${rk ? `<span class="chip accent">${icon('trophy', 13)} ${esc(rk.label)}</span>` : ''}
          ${lpTotal === null ? '' : `<span class="chip ${lpTotal > 0 ? 'accent' : lpTotal < 0 ? 'red' : ''}" data-tip="Rang actuel comparé au rang relevé à l'ajout du profil (${esc(dateTimeFr(snaps[0].date))})">${icon(lpTotal >= 0 ? 'up' : 'down', 13)} ${Stats.fmt(lpTotal, 'diff')} LP depuis l'ajout du profil</span>`}
          ${p.rankTarget ? `<span class="chip">${icon('target', 13)} ${esc(p.rankTarget)}</span>` : ''}<span class="muted small">${gs.length} partie${gs.length > 1 ? 's' : ''} prise${gs.length > 1 ? 's' : ''} en compte${/^Récupération/.test(p.statusText || '') ? ' · historique en cours de chargement' : ''}</span></div></div>
      <span class="spacer"></span>${periodSeg(p)}</div>
    <div class="kpis">${kpis}</div>
    <h2>Évolution partie par partie</h2>
    <div class="chart-card"><div class="head"><div class="chips">${cards.filter(metricOf).map(l => `<button class="${state.metric === l ? 'on' : ''}" data-action="metric" data-metric="${esc(l)}">${esc(l)}</button>`).join('')}</div></div>
      ${chart}
      <div class="legend"><span><i style="background:var(--accent)"></i>Victoire</span><span><i style="background:var(--red)"></i>Défaite</span>${obj === null ? '' : '<span><i style="background:var(--red);border-radius:2px;height:2px;width:12px"></i>Objectif</span>'}${mk > 0 ? '<span><i style="background:var(--violet)"></i>Début du coaching</span>' : ''}</div></div>
    ${snaps.length >= 2 ? `<h2>Rang et LP</h2><div class="chart-card">${Charts.lineChart({
      points: snaps.slice(-40).map(r => ({ v: r.score, label: dateFr(r.date).slice(0, 5), tip: r.label + '\n' + dateTimeFr(r.date) + (typeof r.wins === 'number' ? '\n' + r.wins + ' V · ' + r.losses + ' D cette saison' : '') })),
      fmt: scoreText, color: '#69c3d8' })}</div>` : ''}
    <h2>Forme récente</h2>${formHtml}
    <h2>Objectifs et indicateurs</h2>
    <table class="table"><tr><th class="l">Indicateur</th><th>Valeur</th><th>Objectif</th><th>Statut</th><th>Progression</th><th>10 dern.</th><th>Tendance</th><th>Évolution</th></tr>${table}</table>
    <div class="two" style="margin-top:6px"><div><h2>Champions</h2>${group(Stats.groupBy(gs, 'champion').slice(0, 8), 'Champion')}</div><div><h2>Adversaires directs</h2>${group(Stats.groupBy(gs, 'opponent').slice(0, 8), 'Adversaire')}</div></div>`;
}

// ======================================================================== PARTIES
function pageParties() {
  const d = D(), p = player();
  if (!p) return `<h1>Parties</h1><div class="empty">Aucune donnée pour l'instant.</div>`;
  let gs = d.games.filter(g => g.playerId === p.id).sort((a, b) => b.date - a.date);
  const total = gs.length;
  if (state.gameFilter === 'w') gs = gs.filter(g => g.win);
  if (state.gameFilter === 'l') gs = gs.filter(g => !g.win);
  const q = state.q.trim().toLowerCase();
  if (q) gs = gs.filter(g => [g.champion, g.opponent, champInfo(g.champion) && champInfo(g.champion)[1], champInfo(g.opponent) && champInfo(g.opponent)[1]].some(x => String(x || '').toLowerCase().includes(q)));
  const rows = gs.map(g => `<tr class="click" data-action="game" data-id="${esc(g.matchId)}">
      <td class="l muted">${dateTimeFr(g.date)}</td>
      <td class="l">${img(g.champion)}${champ(g.champion)} <span class="faint">contre</span> ${champ(g.opponent) || '?'}</td>
      <td><span class="res ${g.win ? 'V' : 'D'}">${g.win ? 'V' : 'D'}</span></td>
      <td>${g.kills}/${g.deaths}/${g.assists}</td><td>${Stats.fmt(Stats.METRICS.KP(g), 'pct')}</td>
      <td>${Stats.fmt(Stats.METRICS['CS/min'](g), 'dec2')}</td><td>${Stats.fmt(Stats.METRICS['Vision/min'](g), 'dec2')}</td>
      <td class="${g.goldDiff15 > 0 ? 'ok' : g.goldDiff15 < 0 ? 'red' : ''}">${Stats.fmt(g.goldDiff15, 'diff')}</td>
      <td>${g.deaths15 === null || g.deaths15 === undefined ? '—' : g.deaths15}</td>
      <td>${lpCell(g)}</td>
      <td>${g.role !== p.role ? '<span class="chip">hors rôle</span>' : g.comment || g.mental ? icon('book', 15, 'muted') : ''}</td></tr>`).join('');
  return `<h1>Parties</h1>
    <div class="sub">${total} partie${total > 1 ? 's' : ''} classée${total > 1 ? 's' : ''} en solo. Clique sur une partie pour voir le détail${canEdit() ? ' et ajouter ton suivi' : ''}.
      <br><span class="small">LP : calculés automatiquement à partir du rang relevé toutes les 5 minutes (≈ = estimation). Inconnus pour les parties jouées avant le début du suivi.</span></div>
    <div class="row" style="margin-bottom:14px">
      <div class="seg">${[['all', 'Toutes'], ['w', 'Victoires'], ['l', 'Défaites']].map(([k, l]) => `<button class="${state.gameFilter === k ? 'on' : ''}" data-action="gfilter" data-v="${k}">${l}</button>`).join('')}</div>
      <span class="spacer"></span><input id="q" data-input="q" placeholder="Chercher un champion…" value="${esc(state.q)}" style="width:240px"></div>
    ${rows ? `<table class="table"><tr><th class="l">Date</th><th class="l">Partie</th><th>Rés.</th><th>K/D/A</th><th>KP</th><th>CS/min</th><th>Vision/min</th><th>Écart or 15</th><th>Morts &lt;15</th><th>LP</th><th></th></tr>${rows}</table>`
      : `<div class="empty">${total ? 'Aucune partie ne correspond.' : 'Les parties arrivent automatiquement après chaque partie classée.'}</div>`}`;
}

// ======================================================================== détail d'une partie (panneau latéral)
function openGame(matchId) { state.drawer = { matchId }; renderDrawer(); }
function closeDrawer(silent) {
  state.drawer = null;
  $('#drawer').classList.add('hidden');
  $('#drawer-back').classList.add('hidden');
  if (!silent) hideTip();
}
function renderDrawer() {
  const p = player();
  const g = p && D().games.find(x => x.matchId === state.drawer.matchId && x.playerId === p.id);
  if (!g) return closeDrawer();
  const M = Stats.METRICS;
  const cell = (k, v) => `<div><span>${k}</span><b>${v}</b></div>`;
  const edit = canEdit();
  const pills = (field, options, cur) => `<div class="pills">${options.map(([v, l]) => `<button class="${String(cur) === String(v) ? 'on' : ''}" data-action="gset" data-field="${field}" data-v="${v}">${l}</button>`).join('')}</div>`;
  const suivi = edit ? `
      <label>Note mentale</label>${pills('mental', [[1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5']], g.mental)}
      <label>Objectif de la partie atteint</label>${pills('objectiveMet', [[true, 'Oui'], [false, 'Non'], ['', '—']], g.objectiveMet === null || g.objectiveMet === undefined ? '' : g.objectiveMet)}
      <label>LP gagnés ou perdus <span class="faint">${g.lpManual ? '(saisi à la main)' : g.lpEstimated ? '(estimation automatique, corrigeable)' : g.lpDelta !== null && g.lpDelta !== undefined ? '(calcul automatique)' : '(vide = calcul automatique)'}</span></label>
      <input id="lp" type="number" data-gfield="lpDelta" value="${g.lpDelta === null || g.lpDelta === undefined ? '' : g.lpDelta}" style="width:120px">
      <label>Commentaire</label><textarea id="cm" data-gfield="comment" rows="4" style="width:100%" placeholder="Ce qui a marché, ce qui est à revoir…">${esc(g.comment || '')}</textarea>
      <div class="actions"><button class="btn danger" data-action="delete-game" data-id="${esc(g.matchId)}">${icon('trash', 15)} Retirer la partie</button></div>`
    : `${g.mental ? `<label>Note mentale</label><div>${g.mental} / 5</div>` : ''}
       ${g.objectiveMet === true || g.objectiveMet === false ? `<label>Objectif de la partie</label><div>${g.objectiveMet ? 'Atteint' : 'Pas atteint'}</div>` : ''}
       ${g.comment ? `<label>Commentaire du coach</label><div class="note">${esc(g.comment)}</div>` : ''}
       ${!g.mental && !g.comment && g.objectiveMet !== true && g.objectiveMet !== false ? '<div class="muted small">Pas encore de commentaire du coach sur cette partie.</div>' : ''}`;
  $('#drawer').innerHTML = `<div class="row"><span class="chip ${g.win ? 'accent' : 'red'}">${g.win ? 'Victoire' : 'Défaite'}</span><span class="muted small">${dateTimeFr(g.date)} · ${g.duration} min</span><span class="spacer"></span><button class="icon-btn" data-action="close-drawer">${icon('close', 18)}</button></div>
    <div class="game-head">${img(g.champion, '')}<div><h2 style="margin:0">${champ(g.champion)}</h2><div class="muted small">${esc(g.role)} · côté ${esc(g.side || '?')} · niveau ${g.level || '?'}</div></div><span class="spacer"></span>
      ${g.opponent ? `<div class="vs" style="text-align:center"><div class="faint tiny">contre</div>${img(g.opponent, '')}<div class="small">${champ(g.opponent)}</div></div>` : ''}</div>
    ${edit && isCoach() ? `<button class="btn primary mo-open" data-action="moments" data-id="${esc(g.matchId)}">${icon('target', 15)} Moments clés de la partie</button>` : ''}
    <div class="statgrid">
      ${cell('K / D / A', `${g.kills} / ${g.deaths} / ${g.assists}`)}${cell('KDA', Stats.fmt(M.KDA(g), 'dec2'))}${cell('Kill participation', Stats.fmt(M.KP(g), 'pct'))}
      ${cell('CS', `${g.cs} <span class="muted small">(${Stats.fmt(M['CS/min'](g), 'dec2')}/min)</span>`)}${cell('CS à 10 min', Stats.fmt(g.cs10, 'int'))}${cell('Morts avant 15 min', g.deaths15 === null || g.deaths15 === undefined ? '—' : g.deaths15)}
      ${cell('Écart or à 10 min', Stats.fmt(g.goldDiff10, 'diff'))}${cell('Écart XP à 10 min', Stats.fmt(g.xpDiff10, 'diff'))}${cell('Écart or à 15 min', Stats.fmt(g.goldDiff15, 'diff'))}
      ${cell('Vision', `${g.vision} <span class="muted small">(${Stats.fmt(M['Vision/min'](g), 'dec2')}/min)</span>`)}${cell('Wards posées / détruites', `${g.wardsPlaced ?? '—'} / ${g.wardsKilled ?? '—'}`)}${cell('Pinks', g.pinks ?? '—')}
      ${cell('Dégâts/min', Stats.fmt(M['Dégâts/min'](g), 'int'))}${cell('Or/min', Stats.fmt(M['Or/min'](g), 'int'))}${cell('LP', lpCell(g))}
    </div>
    <h2>Suivi</h2>${suivi}`;
  $('#drawer').classList.remove('hidden');
  $('#drawer-back').classList.remove('hidden');
  hookImages();
}

// ======================================================================== MOMENTS CLÉS d'une partie (coach)
const MAPB = { min: -120, w: 14990, h: 15100 }; // bornes de la mini-carte de Riot
const mapPct = (x, y) => [(x - MAPB.min) / MAPB.w * 100, 100 - (y - MAPB.min) / MAPB.h * 100];
const mmss = ms => { const s = Math.max(0, Math.round(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const MO_ICON = { mort: 'skull', kill: 'sword', objectif: 'target', retour: 'home', niveau: 'up' };
const moTitle = x => esc(x.title).replace(/(tué par|Kill sur) (\w+)/, (a, b, c) => b + ' ' + champ(c));
function trackAt(m, id, t) {
  const tr = m.track || [];
  const i = Math.max(0, Math.min(tr.length - 1, Math.floor(t / 60000)));
  const a = tr[i] && tr[i].p[id], b = tr[i + 1] && tr[i + 1].p[id];
  if (a && b && tr[i + 1].t > tr[i].t) { const k = Math.max(0, Math.min(1, (t - tr[i].t) / (tr[i + 1].t - tr[i].t))); return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]; }
  return a || b || null;
}
function momentsMap(m, mo) {
  const t = mo ? mo.t : 0;
  const v = D().settings.ddVersion;
  const pins = m.participants.map(pp => {
    const q = trackAt(m, pp.id, t);
    if (!q) return '';
    const [l, tp] = mapPct(q[0], q[1]);
    return `<div class="mo-pin ${pp.teamId === m.teamId ? 'ally' : 'enemy'} ${pp.id === m.me ? 'me' : ''}" style="left:${l}%;top:${tp}%" data-tip="${esc(champInfo(pp.champion) ? champInfo(pp.champion)[1] : pp.champion)}${pp.name ? ' · ' + esc(pp.name) : ''}">${img(pp.champion, '')}</div>`;
  }).join('');
  let ev = '';
  if (mo && mo.x !== null && mo.x !== undefined) { const [l, tp] = mapPct(mo.x, mo.y); ev = `<div class="mo-ev ${mo.tone}" style="left:${l}%;top:${tp}%"></div>`; }
  return `<div class="mo-map" ${v ? `style="background-image:url(https://ddragon.leagueoflegends.com/cdn/${v}/img/map/map11.png)"` : ''}>${pins}${ev}
    <div class="mo-maptime"><b>${mmss(t)}</b> positions approximatives (Riot en donne une par minute)</div></div>`;
}
function momentDetail(x) {
  const cl = list => list.map(c => champ(c)).join(', ');
  if (x.type === 'mort') return [x.zone, x.involved && x.involved.length ? 'Ennemis : ' + cl(x.involved) : '', 'Alliés à côté : ' + (x.allies && x.allies.length ? cl(x.allies) : 'aucun'),
    x.after && x.after.length ? 'Ensuite : ' + x.after.map(a => esc(a.what) + ' ' + a.s + ' s après').join(', ') : ''].filter(Boolean).join(' · ');
  if (x.type === 'objectif') return x.tags.includes('présent') ? 'Il était là' : 'Absent' + (x.where ? ' (' + esc(x.where) + ')' : '');
  if (x.type === 'retour') return x.items && x.items.length ? esc(x.items.join(', ')) : '';
  if (x.type === 'niveau') return x.vs ? 'Son vis-à-vis : niveau 6 à ' + esc(x.vs) : '';
  return x.zone ? esc(x.zone) : '';
}
function momentsHtml() {
  const S = state.moments;
  const head = t => `<div class="mo-head"><h2>Moments clés</h2>${t}<span class="spacer"></span>
    ${S.data ? `<button class="btn" data-action="mo-copy">${icon('copy', 15)} Copier pour l'analyse</button>` : ''}<button class="icon-btn" data-action="close-modal">${icon('close', 18)}</button></div>`;
  if (S.loading) return head('') + '<div class="empty"><span class="spinner"></span> Lecture de la partie chez Riot…</div>';
  if (S.error) return head('') + `<div class="empty">${esc(S.error)}</div>`;
  const m = S.data;
  const me = m.participants.find(p => p.id === m.me), opp = m.participants.find(p => p.id === m.opp);
  const mo = m.moments[S.sel] || null;
  const fmtN = n => Number(n).toLocaleString('fr-FR');
  const lane = (k, l) => { const a = m.lane[k]; if (!a) return ''; const d = a.opp ? a.me.gold - a.opp.gold : null; return `<div><span>À ${l} min</span><b>${a.me.cs} CS · ${fmtN(a.me.gold)} or</b>${d === null ? '' : `<em class="${d >= 0 ? 'ok' : 'red'}">${d >= 0 ? '+' : ''}${fmtN(d)} or</em>`}</div>`; };
  const rows = m.moments.map((x, i) => `<div class="mo-row ${i === S.sel ? 'on' : ''}" data-action="mo-sel" data-v="${i}">
      <span class="mo-t">${mmss(x.t)}</span><span class="mo-ico ${x.tone}">${icon(MO_ICON[x.type] || 'info', 14)}</span>
      <div class="mo-txt"><b>${moTitle(x)}</b><div class="small muted">${momentDetail(x)}</div>${x.tags && x.tags.length && x.type !== 'objectif' ? `<div class="mo-tags">${x.tags.map(t => `<span>${esc(t)}</span>`).join('')}</div>` : ''}</div></div>`).join('');
  return head(`<span class="muted small">${champ(me.champion)}${opp ? ' contre ' + champ(opp.champion) : ''} · ${m.win ? 'Victoire' : 'Défaite'} · ${m.kda.join('/')} · ${mmss(m.duration * 1000)}</span>`) + `
    <div class="mo-body">
      <div>${momentsMap(m, mo)}
        <div class="mo-sum">${lane('at10', 10)}${lane('at15', 15)}<div><span>Vision</span><b>${m.vision.placed} wards · ${m.vision.control} pink${m.vision.control > 1 ? 's' : ''}</b><em class="muted">${m.vision.killed} détruite${m.vision.killed > 1 ? 's' : ''}</em></div></div>
        <div class="faint tiny" style="margin-top:8px">« Copier pour l'analyse » met tout le dossier dans le presse-papiers : colle-le dans ta conversation avec Claude.</div></div>
      <div class="mo-list">${rows || '<div class="empty">Aucun moment notable.</div>'}</div>
    </div>`;
}
async function openMoments(matchId) {
  const p = player();
  if (!p) return;
  state.moments = { matchId, loading: true };
  const show = () => { openModal(momentsHtml()); $('#modal-box').style.width = 'min(1120px, 95vw)'; };
  show();
  const r = await window.api.getMoments(p.id, matchId);
  if (!state.moments || state.moments.matchId !== matchId) return;
  state.moments.loading = false;
  if (!r || !r.ok) state.moments.error = r ? r.message : 'Erreur inconnue.';
  else {
    const first = r.moments.moments.findIndex(x => x.type === 'mort');
    Object.assign(state.moments, { data: r.moments, text: r.text, sel: first >= 0 ? first : 0 });
  }
  show();
}

async function setGameField(field, value) {
  const g = state.drawer && D().games.find(x => x.matchId === state.drawer.matchId);
  if (!g) return;
  const r = await window.api.updateGame(g.matchId, g.playerId, { [field]: value });
  if (r && r.data) state.data = r.data;
  if (r && !r.ok) toast(r.message, 'err');
  renderDrawer();
}

// ======================================================================== SÉANCES
function pageSeances() {
  const d = D(), p = player();
  const tabs = canEdit() ? `<div class="seg"><button class="${state.seancesTab !== 'banque' ? 'on' : ''}" data-action="seances-tab" data-v="seances">Séances du joueur</button><button class="${state.seancesTab === 'banque' ? 'on' : ''}" data-action="seances-tab" data-v="banque">${icon('book', 14)} Banque d'exercices</button></div>` : '';
  if (canEdit() && state.seancesTab === 'banque') return pageBanque(tabs);
  if (!p) return `<div class="row"><h1>Séances</h1><span class="spacer"></span>${tabs}</div><div class="empty">Aucune donnée pour l'instant.</div>`;
  const list = (d.sessions || []).filter(s => s.playerId === p.id).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const n = list.length;
  const cards = list.map((s, i) => {
    const r = Stats.sessionResult(d, s, p);
    const f = Stats.METRIC_FMT[s.kpi] || 'dec2';
    const open = state.sessionOpen === s.id;
    let detail = '';
    if (open) {
      const gs = roleGames(p).slice(-30);
      const t = new Date(s.date).getTime();
      const metric = Stats.METRICS[s.kpi];
      const pts = gs.map(g => ({ v: metric ? metric(g) : null, label: dateFr(g.date).slice(0, 5), tip: gameTip(g, s.kpi, Stats.fmt(metric ? metric(g) : null, f)), id: g.matchId, win: g.win }));
      detail = `<div class="detail" data-stop="1">
        <div class="grid3">
          <div><label>Points abordés</label><div class="note">${esc(s.points) || '—'}</div></div>
          <div><label>Constats</label><div class="note">${esc(s.findings) || '—'}</div></div>
          <div><label>Devoirs</label><div class="note">${esc(s.homework) || '—'}</div></div></div>
        ${sessionExercises(s, p)}
        ${s.kpi ? `<label>${esc(s.kpi)}, partie par partie</label>${Charts.lineChart({ points: pts, target: s.target === '' || s.target === undefined ? null : Number(s.target), fmt: axisFmt(f), marker: gs.findIndex(g => g.date >= t), markerLabel: 'séance', targetLabel: 'cible' })}` : ''}
        ${canEdit() ? `<div class="actions"><button class="btn danger" data-action="delete-session" data-id="${s.id}">${icon('trash', 15)} Supprimer</button><button class="btn" data-action="edit-session" data-id="${s.id}">${icon('edit', 15)} Modifier</button></div>` : ''}</div>`;
    }
    const better = r.delta === null ? '' : (r.delta > 0) === (r.sens !== '≤') ? 'ok' : 'red';
    return `<div class="scard" data-action="toggle-session" data-id="${s.id}">
      <div class="head"><span class="num">#${n - i}</span><b>${esc(dateLong(s.date))}</b><span class="muted">${esc(s.axis || '')}${s.axis2 ? ' · ' + esc(s.axis2) : ''}</span><span class="spacer"></span>
        ${ficheChip(s, p)}${s.status ? `<span class="chip ${STATUT_CHIP[s.status] || ''}">${esc(s.status)}</span>` : ''}${icon(open ? 'chevronDown' : 'chevron', 16, 'faint')}</div>
      <div class="metrics">
        <div class="metric"><span>Indicateur suivi</span><b>${esc(s.kpi || '—')}</b></div>
        <div class="metric"><span>Cible</span><b>${s.target === '' || s.target === undefined ? '—' : Stats.fmt(Number(s.target), f)}</b></div>
        <div class="metric"><span>Avant → depuis</span><b>${Stats.fmt(r.before, f)} → ${Stats.fmt(r.after, f)}</b></div>
        <div class="metric"><span>Évolution</span><b class="${better}">${fmtDelta(r.delta, f)}</b></div>
      </div>${detail}</div>`;
  }).join('');
  return `<div class="row"><h1>Séances</h1><span class="spacer"></span>${tabs}${canEdit() ? `<button class="btn primary" data-action="new-session">${icon('plus', 16)} Nouvelle séance</button>` : ''}</div>
    <div class="sub">${canEdit() ? 'Pour chaque séance : l\'axe travaillé, les exercices, un indicateur à suivre et une cible. Le joueur remplit sa fiche une fois les exercices faits.' : 'Tes séances, les exercices à faire et ta fiche à remplir une fois qu\'ils sont faits.'}</div>
    ${cards || `<div class="empty">${canEdit() ? 'Aucune séance pour ce joueur. Crée la première après votre prochain échange.' : 'Pas encore de séance.'}</div>`}`;
}
function fmtDelta(v, f) {
  if (v === null || v === undefined) return '—';
  if (f === 'pct') return (v > 0 ? '+' : '') + Math.round(v * 100) + ' pts';
  if (f === 'diff' || f === 'int') return (v > 0 ? '+' : '') + Math.round(v);
  return (v > 0 ? '+' : '') + v.toFixed(2).replace('.', ',');
}

function sessionForm(s) {
  const p = player();
  s = s || { date: isoDay(Date.now()), status: 'En cours' };
  const axes = settingsOf(p).axes;
  const kpis = Object.keys(Stats.METRICS);
  return `<h1>${s.id ? 'Modifier la séance' : 'Nouvelle séance'}</h1><div class="muted">${esc(p ? p.riotId : '')}</div>
  <form id="session-form"><input type="hidden" name="sid" value="${esc(s.id || '')}">
    <div class="grid3">
      <div class="field"><label>Date</label><input type="date" name="date" required value="${esc(s.date)}"></div>
      <div class="field"><label>Statut</label><select name="status">${STATUTS.map(x => opt(x, s.status)).join('')}</select></div>
      <div class="field"><label>Prochaine séance</label><input type="date" name="next" value="${esc(s.next || '')}"></div>
    </div>
    <div class="grid2">
      <div class="field"><label>Axe principal</label><select name="axis">${axes.map(a => opt(a, s.axis)).join('')}</select></div>
      <div class="field"><label>Axe secondaire</label><select name="axis2"><option value="">—</option>${axes.map(a => opt(a, s.axis2)).join('')}</select></div>
    </div>
    <div class="field"><label>Points abordés</label><textarea name="points" rows="2">${esc(s.points || '')}</textarea></div>
    <div class="field"><label>Constats</label><textarea name="findings" rows="2">${esc(s.findings || '')}</textarea></div>
    <div class="field"><label>Devoirs (texte libre)</label><textarea name="homework" rows="2">${esc(s.homework || '')}</textarea></div>
    ${exercisePicker(s, p)}
    <div class="grid2">
      <div class="field"><label>Indicateur suivi</label><select name="kpi"><option value="">—</option>${kpis.map(k => opt(k, s.kpi)).join('')}</select></div>
      <div class="field"><label>Cible (pourcentages en décimal : 0,55 = 55 %)</label><input name="target" type="number" step="any" value="${esc(s.target === undefined ? '' : s.target)}"></div>
    </div>
    <div class="actions"><button type="button" class="btn ghost" data-action="close-modal">Annuler</button><button type="submit" class="btn primary">Enregistrer</button></div>
  </form>`;
}

// ======================================================================== EXERCICES ET FICHES DE SÉANCE
const reportOf = (s, p) => (D().reports || []).find(r => r.sessionId === s.id && r.playerId === (p ? p.id : s.playerId)) || null;
const themeOf = ex => Exercises.THEMES.find(t => t.id === ex.theme) || { t: '', icon: 'target' };
const sessionExs = s => (s.exercises || []).map(e => ({ e, ex: Exercises.byId(e.id) })).filter(x => x.ex);
const targetText = (ex, target) => (ex.target && target !== '' && target !== undefined && target !== null ? `${ex.target.label} ${ex.target.sens} ${String(target).replace('.', ',')}` : '');

function ficheChip(s, p) {
  if (!sessionExs(s).length) return '';
  return reportOf(s, p) ? `<span class="chip accent">${icon('check', 13)} Fiche remplie</span>` : `<span class="chip amber">Fiche à remplir</span>`;
}

// moyenne mesurée automatiquement sur les parties classées jouées depuis la séance
function autoMeasure(ex, p, since) {
  if (!ex.kpi || !p || !Stats.METRICS[ex.kpi]) return '';
  const t = new Date(since).getTime();
  const vals = roleGames(p).filter(g => g.date >= t).map(Stats.METRICS[ex.kpi]).filter(v => v !== null && v !== undefined && !isNaN(v));
  if (!vals.length) return `<div class="exauto">${icon('sync', 14)} ${esc(ex.kpi)} : mesuré automatiquement sur les parties classées jouées après la séance.</div>`;
  const f = Stats.METRIC_FMT[ex.kpi] || 'dec2';
  return `<div class="exauto">${icon('sync', 14)} Depuis la séance : <b>${esc(ex.kpi)} ${Stats.fmt(Stats.mean(vals), f)}</b> en moyenne sur ${vals.length} partie${vals.length > 1 ? 's' : ''} classée${vals.length > 1 ? 's' : ''}.</div>`;
}

// un exercice détaillé : consigne du coach, étapes, lien, schéma
function exerciseCard(ex, o = {}) {
  const th = themeOf(ex);
  const target = o.target !== undefined && o.target !== '' ? o.target : Exercises.targetFor(ex, o.role);
  const tt = targetText(ex, target);
  const head = `<div class="exhead" ${o.toggle ? `data-action="ex-toggle" data-id="${ex.id}"` : ''}><div class="tile">${icon(th.icon, 18)}</div>
    <div class="t"><b>${esc(ex.title)}</b><span>${esc(th.t)} · ${esc(ex.where)} · ${esc(ex.duration)}</span></div>
    ${tt ? `<span class="chip accent">${esc(tt)}</span>` : ''}${o.toggle ? icon(o.open ? 'chevronDown' : 'chevron', 16, 'faint') : ''}</div>`;
  if (o.toggle && !o.open) return `<div class="excard">${head}</div>`;
  return `<div class="excard open">${head}
    <div class="exbody">
      <div class="muted">${esc(ex.why)}</div>
      ${o.note ? `<div class="exnote">${icon('send', 14)} <span><b>Consigne du coach :</b> ${esc(o.note)}</span></div>` : ''}
      <ol class="exsteps">${ex.steps.map(x => `<li>${esc(x)}</li>`).join('')}</ol>
      ${ex.link ? `<button class="btn" data-action="ext" data-url="${esc(ex.link.url)}">${icon('external', 15)} ${esc(ex.link.label)}</button>` : ''}
      ${Schemas.render(ex.schema, { target })}
      ${o.since ? autoMeasure(ex, o.player, o.since) : ''}
    </div></div>`;
}

// exercices d'une séance, puis la fiche du joueur
function sessionExercises(s, p) {
  const list = sessionExs(s);
  if (!list.length) return '';
  const rep = reportOf(s, p);
  const isPlayer = D().session.role === 'joueur';
  const cards = list.map(({ e, ex }) => exerciseCard(ex, { target: e.target, note: e.note, role: p && p.role, since: s.date, player: p })).join('');
  let fiche;
  if (rep) fiche = reportView(s, rep) + (isPlayer ? `<div class="actions"><button class="btn" data-action="report-open" data-id="${s.id}">${icon('edit', 15)} Modifier ma fiche</button></div>` : '');
  else if (isPlayer) fiche = `<div class="bk-alert">${icon('edit', 16)}<span><b>Ta fiche est à remplir</b> une fois les exercices faits : tes scores, ton ressenti, ce que tu retiens.</span><span class="spacer"></span><button class="btn primary" data-action="report-open" data-id="${s.id}">Remplir ma fiche</button></div>`;
  else fiche = `<div class="bk-alert muted-alert">${icon('clock', 16)}<span>Le joueur n'a pas encore rempli sa fiche. Tu seras prévenu dès qu'il l'envoie.</span></div>`;
  return `<h3 class="exh">${icon('target', 15)} Exercices (${list.length})</h3>${cards}<h3 class="exh">${icon('edit', 15)} ${isPlayer ? 'Ma fiche' : 'Fiche du joueur'}</h3>${fiche}`;
}

const fmtVal = (fd, v) => (v === undefined || v === null || v === '' ? '—' : fd.type === 'score' ? v + ' / 5' : fd.type === 'yesno' ? (v === 'oui' ? 'Oui' : 'Non') : String(v).replace('.', ','));
function reportView(s, rep) {
  const d = rep.data || {};
  const blocks = sessionExs(s).map(({ e, ex }) => {
    const vals = (d.ex || {})[ex.id] || {};
    const target = e.target !== '' && e.target !== undefined ? e.target : '';
    const rows = ex.fields.map(fd => {
      const v = vals[fd.k];
      const ok = fd.target ? Exercises.meets(ex, v, target) : null;
      return `<div class="rv"><span>${esc(fd.label)}</span><b class="${ok === true ? 'ok' : ok === false ? 'red' : ''}">${fd.type === 'text' ? `<span class="note">${esc(fmtVal(fd, v))}</span>` : esc(fmtVal(fd, v))}${ok === null ? '' : ' ' + icon(ok ? 'check' : 'alert', 13)}</b></div>`;
    }).join('');
    return `<div class="rvblock"><div class="rvt">${esc(ex.title)}${target !== '' ? ` <span class="muted small">· cible ${esc(targetText(ex, target))}</span>` : ''}</div>${rows}</div>`;
  }).join('');
  const general = `<div class="rvblock"><div class="rvt">Bilan</div>
    <div class="rv"><span>Ressenti global</span><b>${d.ressenti ? d.ressenti + ' / 5' : '—'}</b></div>
    <div class="rv"><span>Ce qui a été difficile</span><b><span class="note">${esc(d.difficile || '—')}</span></b></div>
    <div class="rv"><span>Ce que je retiens</span><b><span class="note">${esc(d.retiens || '—')}</span></b></div></div>`;
  return `<div class="report"><div class="muted small">Remplie le ${esc(new Date(rep.updatedAt).toLocaleString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }))}</div>${blocks}${general}</div>`;
}

// champ de fiche selon son type
function ficheInput(name, fd, v) {
  if (fd.type === 'text') return `<textarea name="${name}" rows="2" maxlength="1000">${esc(v || '')}</textarea>`;
  if (fd.type === 'score') return `<div class="pick">${[1, 2, 3, 4, 5].map(n => `<label><input type="radio" name="${name}" value="${n}" ${Number(v) === n ? 'checked' : ''}><span>${n}</span></label>`).join('')}</div>`;
  if (fd.type === 'yesno') return `<div class="pick">${['oui', 'non'].map(n => `<label><input type="radio" name="${name}" value="${n}" ${v === n ? 'checked' : ''}><span>${n === 'oui' ? 'Oui' : 'Non'}</span></label>`).join('')}</div>`;
  if (fd.type === 'time') return `<input name="${name}" placeholder="ex. 3:25" value="${esc(v || '')}" style="max-width:160px">`;
  return `<input name="${name}" type="number" step="any" min="0" value="${esc(v === undefined ? '' : v)}" style="max-width:160px">`;
}
function reportForm(s) {
  const p = player();
  const d = (reportOf(s, p) || {}).data || {};
  const exs = sessionExs(s).map(({ e, ex }) => {
    const vals = (d.ex || {})[ex.id] || {};
    const target = e.target !== '' && e.target !== undefined ? e.target : '';
    return `<div class="rfex"><div class="rvt">${esc(ex.title)}${target !== '' ? ` <span class="chip accent">${esc(targetText(ex, target))}</span>` : ''}</div>
      ${ex.fields.map(fd => `<div class="field"><label>${esc(fd.label)}${fd.target && target !== '' ? ` <span class="sens">(cible ${esc(ex.target.sens)} ${esc(String(target).replace('.', ','))})</span>` : ''}</label>${ficheInput(`f|${ex.id}|${fd.k}`, fd, vals[fd.k])}</div>`).join('')}</div>`;
  }).join('');
  return `<h1>Ma fiche de séance</h1><div class="muted">Séance du ${esc(dateLong(s.date))}${s.axis ? ' · ' + esc(s.axis) : ''}. Remplis-la une fois les exercices faits : ton coach la verra.</div>
  <form id="report-form"><input type="hidden" name="sid" value="${esc(s.id)}">
    ${exs}
    <div class="rfex"><div class="rvt">Bilan</div>
      <div class="field"><label>Ressenti global (1 = difficile, 5 = très bien)</label>${ficheInput('g|ressenti', { type: 'score' }, d.ressenti)}</div>
      <div class="field"><label>Ce qui a été difficile</label>${ficheInput('g|difficile', { type: 'text' }, d.difficile)}</div>
      <div class="field"><label>Ce que je retiens</label>${ficheInput('g|retiens', { type: 'text' }, d.retiens)}</div></div>
    <div class="actions"><button type="button" class="btn ghost" data-action="close-modal">Annuler</button><button type="submit" class="btn primary">${icon('send', 15)} Envoyer ma fiche</button></div>
  </form>`;
}

// choix des exercices dans le formulaire de séance (rôle du joueur)
function exercisePicker(s, p) {
  const role = p && p.role;
  const chosen = Object.fromEntries((s.exercises || []).map(e => [e.id, e]));
  const groups = Exercises.THEMES.map(th => {
    const items = Exercises.LIST.filter(x => x.theme === th.id && (!x.roles || !role || x.roles.includes(role) || chosen[x.id]));
    if (!items.length) return '';
    return `<div class="pkgroup"><div class="pkt">${icon(th.icon, 14)} ${esc(th.t)}</div>${items.map(x => {
      const c = chosen[x.id];
      const target = c ? c.target : Exercises.targetFor(x, role);
      return `<div class="exitem"><label class="exrow"><input type="checkbox" name="ex|${x.id}" ${c ? 'checked' : ''}><span><b>${esc(x.title)}</b><span class="muted small"> · ${esc(x.where)}</span></span></label>
        <div class="exmore">${x.target ? `<div class="field"><label>${esc(x.target.label)} <span class="sens">${esc(x.target.sens)}</span></label><input name="ext|${x.id}" value="${esc(target)}" ${x.target.type === 'time' ? 'placeholder="3:30"' : ''}></div>` : ''}
          <div class="field" style="grid-column: span ${x.target ? 1 : 2}"><label>Consigne pour le joueur (facultatif)</label><input name="exn|${x.id}" value="${esc(c ? c.note : '')}" placeholder="ex. champion, combo, nombre de parties…"></div></div></div>`;
    }).join('')}</div>`;
  }).join('');
  return `<div class="field"><label>Exercices de la séance <span class="sens">${role ? '(adaptés au rôle ' + esc(role) + ')' : ''}</span></label><div class="picker">${groups}</div></div>`;
}

// rappel sur l'accueil du joueur
function ficheReminder(p) {
  const todo = (D().sessions || []).filter(s => s.playerId === p.id && sessionExs(s).length && !reportOf(s, p)).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  if (!todo.length) return '';
  return `<h2>${icon('edit', 18)} Fiches à remplir</h2><div class="bk-list">${todo.map(s => `<div class="bk-alert">${icon('target', 16)}<span><b>Séance du ${esc(dateLong(s.date))}</b> · ${sessionExs(s).length} exercice${sessionExs(s).length > 1 ? 's' : ''}${s.axis ? ' · ' + esc(s.axis) : ''}</span><span class="spacer"></span><button class="btn primary" data-action="open-session" data-id="${s.id}">Voir les exercices</button></div>`).join('')}</div>`;
}

// banque d'exercices (coach)
function pageBanque(tabs) {
  const p = player();
  const role = p && !state.exAllRoles ? p.role : null;
  const theme = state.exTheme || 'all';
  const list = Exercises.LIST.filter(x => (theme === 'all' || x.theme === theme) && (!role || !x.roles || x.roles.includes(role)));
  const chips = [{ id: 'all', t: 'Tous' }].concat(Exercises.THEMES).map(t => `<button class="${theme === t.id ? 'on' : ''}" data-action="ex-theme" data-v="${t.id}">${esc(t.t)}</button>`).join('');
  return `<div class="row"><h1>Séances</h1><span class="spacer"></span>${tabs}</div>
    <div class="sub">${Exercises.LIST.length} exercices tirés de ton programme, avec leur schéma. Choisis-les dans une séance (« Nouvelle séance ») : le joueur les retrouve chez lui et remplit sa fiche.</div>
    <div class="row" style="margin-bottom:14px"><div class="chips">${chips}</div><span class="spacer"></span>
      ${p ? `<button class="btn ghost" data-action="ex-roles">${state.exAllRoles ? 'Tous les rôles' : 'Rôle ' + esc(p.role)} ${icon('filter', 14)}</button>` : ''}</div>
    ${list.map(x => exerciseCard(x, { role: p && p.role, toggle: true, open: state.exOpen === x.id })).join('') || '<div class="empty">Aucun exercice pour ce filtre.</div>'}`;
}

// ======================================================================== MES OBJECTIFS (joueur)
function pageObjectifs() {
  const d = D(), p = player();
  if (!p) return '<h1>Mes objectifs</h1><div class="empty">Aucune donnée.</div>';
  const gs = roleGames(p).slice(-20);
  const rows = Stats.kpiTable(d, p, '', gs);
  applyLpNet(p, rows, gs);
  const by = Object.fromEntries(rows.map(r => [r.label, r]));
  const groups = OBJ_GROUPS.map(([title, keys]) => {
    const items = keys.map(k => by[k]).filter(r => r && r.obj.value !== null).map(r => {
      const pr = r.progress === null ? 0 : r.progress * 10;
      return `<div class="kpi" style="cursor:default"><div class="lab">${esc(r.label)}</div>
        <div class="val ${r.ok === false ? 'bad' : ''}">${Stats.fmt(r.value, r.format)}</div>
        <div class="obj">Objectif ${r.obj.sens === '≤' ? 'maximum' : 'minimum'} : ${Stats.fmt(r.obj.value, r.format)} ${r.ok === null ? '' : r.ok ? icon('check', 13, 'ok') : icon('alert', 13, 'warn')}</div>
        <div class="bar ${r.ok === false ? 'bad' : ''}"><i style="width:${pr}%"></i></div></div>`;
    }).join('');
    return items ? `<h2>${title}</h2><div class="kpis">${items}</div>` : '';
  }).join('');
  return `<h1>Mes objectifs</h1><div class="sub">Fixés par ton coach. Les valeurs sont calculées sur tes 20 dernières parties classées.</div>${groups}`;
}

// ======================================================================== JOUEURS (coach)
function pageJoueurs() {
  const d = D();
  const cards = d.players.map(p => {
    const rk = lastRank(p);
    const gs = roleGames(p);
    const main = Stats.groupBy(gs.slice(-20), 'champion')[0];
    const shown = state.showCodes[p.id];
    return `<div class="pcard">
      <div class="top"><div class="avatar" style="width:46px;height:46px;border-radius:10px">${main && champImg(main.name) ? `<img src="${champImg(main.name)}" alt="">` : esc(initials(gameName(p)))}</div>
        <div style="min-width:0"><b>${esc(p.riotId)}</b><div class="row" style="gap:6px;margin-top:4px"><span class="chip">${esc(p.role || '?')}</span><span class="chip">${esc((p.region || '').toUpperCase())}</span></div></div></div>
      <div class="small">${rk ? `<span class="ok">${esc(rk.label)}</span>` : '<span class="muted">Rang non relevé</span>'} <span class="muted">· ${gs.length} partie${gs.length > 1 ? 's' : ''}</span></div>
      ${p.goal ? `<div class="small muted">${icon('target', 13)} ${esc(p.goal)}</div>` : ''}
      ${(p.smurfs || []).length ? `<div class="small muted">${icon('players', 13)} Smurfs : ${p.smurfs.map(x => `<span class="${x.missing ? 'red' : ''}" ${x.missing ? 'data-tip="Introuvable chez Riot : vérifie le pseudo"' : ''}>${esc(x.riotId)}</span>`).join(', ')}</div>` : ''}
      <div class="row small"><span class="muted">Code d'accès</span><span class="code">${shown ? esc(p.code || '—') : '••••'}</span>
        <button class="icon-btn" data-action="toggle-code" data-id="${p.id}" title="${shown ? 'Masquer' : 'Afficher'}">${icon(shown ? 'eyeOff' : 'eye', 15)}</button></div>
      ${p.status === 'error' ? `<div class="small red">${icon('alert', 13)} ${esc(p.statusText)}</div>` : /^Récupération/.test(p.statusText || '') ? `<div class="small muted"><span class="spinner" style="width:12px;height:12px"></span> ${esc(p.statusText)}</div>` : ''}
      <div class="row" style="margin-top:auto">
        <button class="btn primary" data-action="open-player" data-id="${p.id}">${icon('dashboard', 15)} Tableau de bord</button>
        <button class="btn" data-action="edit-player" data-id="${p.id}">${icon('edit', 15)} Modifier</button>
        <button class="btn danger" data-action="delete-player" data-id="${p.id}">${icon('trash', 15)} Supprimer</button>
        <span class="spacer"></span>
        <button class="icon-btn" data-action="invite" data-id="${p.id}" title="Copier l'invitation (lien de l'app + code)">${icon('send', 16)}</button>
        <button class="icon-btn" data-action="player-settings" data-id="${p.id}" title="Paramètres du joueur">${icon('settings', 16)}</button>
      </div></div>`;
  }).join('');
  return `<h1>Joueurs</h1><div class="sub">Chaque joueur a son code à 4 chiffres pour ouvrir son espace dans l'app, sur son ordinateur.</div>
    ${pinnedLinks()}
    <div class="players">${cards}<div class="pcard add" data-action="new-player">${icon('plus', 26)}<b>Ajouter un joueur</b></div></div>`;
}

function profileFields(p) {
  return `<div class="grid2">
      <div class="field"><label>Pseudo Riot (Nom#TAG)</label><input name="riotId" required placeholder="ex. Faker#KR1" value="${esc(p.riotId || '')}"></div>
      <div class="grid2">
        <div class="field"><label>Région</label><select name="region">${REGIONS.map(r => opt(r, p.region, r.toUpperCase())).join('')}</select></div>
        <div class="field"><label>Rôle coaché</label><select name="role" required><option value="">—</option>${ROLES.map(r => opt(r, p.role)).join('')}</select></div>
      </div>
    </div>
    <div class="grid3">
      <div class="field"><label>Début du coaching</label><input type="date" name="startDate" value="${esc(p.startDate || '')}"></div>
      <div class="field"><label>Rang de départ</label><select name="rankStart"><option value="">—</option>${RANGS.map(r => opt(r, p.rankStart)).join('')}</select></div>
      <div class="field"><label>Rang visé</label><select name="rankTarget"><option value="">—</option>${RANGS.map(r => opt(r, p.rankTarget)).join('')}</select></div>
    </div>
    <div class="field"><label>Objectif du coaching</label><input name="goal" value="${esc(p.goal || '')}" placeholder="ex. Passer Grand Maître"></div>
    <div class="field"><label>Smurfs <span class="faint">(pour la page En direct, pas dans les stats)</span></label>
      <textarea name="smurfs" rows="2" placeholder="Un pseudo par ligne, ex. Mon Smurf#EUW">${esc((p.smurfs || []).map(x => x.riotId).join('\n'))}</textarea></div>`;
}

// Liens de téléchargement épinglés (toujours la dernière version)
function pinnedLinks() {
  return `<div class="section" style="margin-bottom:22px"><h3>${icon('link', 17)} Télécharger l'app</h3>
    <div class="muted small">Liens fixes : ils donnent toujours la dernière version. Le bouton ${icon('send', 13)} d'un joueur copie une invitation complète (liens + son code).</div>
    <div class="row" style="margin-top:12px">
      <button class="btn" data-action="ext" data-url="${DL.mac}">${icon('download', 15)} Mac</button>
      <button class="btn" data-action="ext" data-url="${DL.win}">${icon('download', 15)} Windows</button>
      <button class="btn ghost" data-action="copy-links">${icon('copy', 15)} Copier les liens</button></div></div>`;
}

function playerForm(p) {
  const isNew = !p;
  p = p || { region: 'euw', role: '' };
  return `<h1>${isNew ? 'Nouveau joueur' : 'Modifier le joueur'}</h1>
  <div class="muted">${isNew ? 'Ses parties classées au rôle choisi arrivent toutes seules. Ses objectifs se règlent ensuite dans Paramètres.' : esc(p.riotId)}</div>
  <form id="player-form"><input type="hidden" name="pid" value="${esc(p.id || '')}">
    ${profileFields(p)}
    <div class="field"><label>Code d'accès du joueur (4 chiffres)</label>
      <div class="row"><input name="code" id="code-input" inputmode="numeric" maxlength="4" pattern="\\d{4}" class="codein" placeholder="${isNew ? 'généré automatiquement' : ''}" value="${esc(p.code || '')}" style="width:190px">
      <button type="button" class="btn" data-action="gen-code">${icon('dice', 15)} Générer</button></div></div>
    <div class="actions">${isNew ? '' : `<button type="button" class="btn danger" data-action="delete-player" data-id="${p.id}">${icon('trash', 15)} Supprimer</button><span class="spacer"></span>`}
      <button type="button" class="btn ghost" data-action="close-modal">Annuler</button><button type="submit" class="btn primary">${isNew ? 'Ajouter le joueur' : 'Enregistrer'}</button></div>
  </form>`;
}

// ======================================================================== PARAMÈTRES (coach)
function pageParametres() {
  const tab = state.settingsTab;
  const p = player();
  const tabs = `<div class="tabs"><button class="${tab === 'joueur' ? 'on' : ''}" data-action="stab" data-v="joueur">${icon('user', 16)} ${p ? esc(p.riotId) : 'Joueur'}</button>
    <button class="${tab === 'general' ? 'on' : ''}" data-action="stab" data-v="general">${icon('settings', 16)} Général</button></div>`;
  return `<h1>Paramètres</h1><div class="sub">${tab === 'joueur' ? 'Réglages propres à ce joueur. Ils s\'appliquent aussi à son espace.' : 'Réglages de l\'app et modèles utilisés pour les nouveaux joueurs.'}</div>${tabs}
    ${tab === 'joueur' ? settingsJoueur(p) : settingsGeneral()}`;
}

function roleDefault(k, role) {
  const o = D().settings.objectives[k];
  return o && role && o[role] !== null && o[role] !== undefined ? o[role] : null;
}
const objToInput = (k, v) => (v === null || v === undefined || v === '' ? '' : PCT_KEYS.has(k) ? Math.round(Number(v) * 1000) / 10 : Number(v));
function objFromInput(k, raw) {
  if (raw === null || raw === undefined || String(raw).trim() === '') return null;
  const n = Number(String(raw).replace(',', '.'));
  return Number.isFinite(n) ? (PCT_KEYS.has(k) ? n / 100 : n) : null;
}

function settingsJoueur(p) {
  if (!p) return '<div class="empty">Ajoute d\'abord un joueur.</div>';
  const o = p.objectives || {};
  const groups = OBJ_GROUPS.map(([title, keys]) => `<div class="obj-group"><div class="obj-title">${title}</div><div class="grid4">${keys.map(k => {
    const def = roleDefault(k, p.role);
    const custom = o[k] !== undefined && o[k] !== null && o[k] !== '';
    const sens = (D().settings.objectives[k] || {}).sens === '≤' ? 'maxi' : 'mini';
    return `<div class="field"><label>${esc(k)}${PCT_KEYS.has(k) ? ' (%)' : ''}<span class="sens">${sens}</span></label>
      <input id="obj-${OBJ_KEYS.indexOf(k)}" type="number" step="any" data-obj="${esc(k)}" class="${custom ? 'custom' : ''}" value="${esc(objToInput(k, custom ? o[k] : def))}" placeholder="${def === null ? 'aucun' : ''}" title="${custom ? 'Personnalisé (rôle : ' + esc(objToInput(k, def)) + ')' : 'Valeur du rôle ' + esc(p.role)}"></div>`;
  }).join('')}</div></div>`).join('');
  const cards = settingsOf(p).cards;
  const labels = Stats.KPIS.map(k => k[0]);
  return `
    <div class="section"><h3>${icon('user', 17)} Profil</h3><div class="muted small">Pseudo, rôle et rangs. Changer de compte Riot efface les parties déjà récupérées et les re-télécharge pour le nouveau compte (les séances sont gardées).</div>
      <form id="profile-form"><input type="hidden" name="pid" value="${esc(p.id)}">${profileFields(p)}
        <div class="actions"><button type="submit" class="btn primary">Enregistrer le profil</button></div></form></div>
    <div class="section"><h3>${icon('key', 17)} Code d'accès</h3><div class="muted small">À donner au joueur : il ouvre uniquement son espace, en lecture seule, dans l'app installée chez lui.</div>
      <div class="row" style="margin-top:12px"><input id="pcode" inputmode="numeric" maxlength="4" value="${esc(p.code || '')}" style="width:150px;letter-spacing:.3em;font:800 18px Manrope">
        <button class="btn" data-action="gen-pcode">${icon('dice', 15)} Générer</button><button class="btn primary" data-action="save-pcode">Enregistrer le code</button>
        <span class="spacer"></span><button class="btn" data-action="invite" data-id="${p.id}">${icon('send', 15)} Copier l'invitation</button></div></div>
    <div class="section"><h3>${icon('target', 17)} Objectifs</h3><div class="muted small">Pré-remplis avec les objectifs du rôle ${esc(p.role)}. Ceux que tu changes passent en vert : ils deviennent propres à ce joueur. Enregistré automatiquement.</div>
      ${groups}<div class="actions"><button class="btn ghost" data-action="reset-objectives">Revenir aux objectifs du rôle</button></div></div>
    <div class="section"><h3>${icon('dashboard', 17)} Cartes du tableau de bord</h3><div class="muted small">Les 8 indicateurs affichés en haut de son tableau de bord.</div>
      <div class="grid4">${[0, 1, 2, 3, 4, 5, 6, 7].map(i => `<div class="field"><label>Carte ${i + 1}</label><select data-change="card" data-i="${i}">${labels.map(l => opt(l, cards[i])).join('')}</select></div>`).join('')}</div></div>
    <div class="section"><h3>${icon('sessions', 17)} Axes de travail des séances</h3><div class="muted small">Un axe par ligne. Proposés dans ses séances.</div>
      <textarea id="paxes" rows="7" style="width:100%;margin-top:10px">${esc(settingsOf(p).axes.join('\n'))}</textarea>
      <div class="actions"><button class="btn primary" data-action="save-paxes">Enregistrer les axes</button></div></div>
    <div class="section" style="border-color:rgba(239,141,145,.3)"><h3 class="red">${icon('trash', 17)} Supprimer ce joueur</h3><div class="muted small">Efface son profil, ses parties, ses rangs et ses séances, ici et sur le serveur. Son code ne fonctionnera plus.</div>
      <div class="actions" style="justify-content:flex-start"><button class="btn danger" data-action="delete-player" data-id="${p.id}">${icon('trash', 15)} Supprimer ${esc(p.riotId)}</button></div></div>`;
}

function settingsGeneral() {
  const d = D(), s = d.settings, c = d.coach || {};
  const cl = c.cloud || {};
  const up = c.update || {};
  const upTxt = up.state === 'ready' ? `La version ${esc(up.version)} est prête : elle s'installera à la fermeture de l'app.`
    : up.state === 'downloading' ? `Téléchargement de la version ${esc(up.version)} en arrière-plan.`
      : up.state === 'error' ? `Dernière vérification impossible : ${esc(up.error)}`
                : up.state === 'uptodate' ? 'À jour (vérifié ' + esc(ago(up.checkedAt)) + ').' : 'Vérification automatique toutes les 30 secondes.';
  const objRows = Object.entries(s.objectives).map(([k, o]) => `<tr><td class="l">${esc(k)}</td><td class="muted">${esc(o.sens)}</td>${ROLES.map(r => `<td><input type="number" step="any" style="width:84px" data-tobj="${esc(k)}" data-role="${r}" value="${o[r] === null || o[r] === undefined ? '' : o[r]}"></td>`).join('')}</tr>`).join('');
  return `
    <div class="section"><h3>${icon('crown', 17)} Code coach</h3><div class="muted small">Il ouvre tous les joueurs, ici et sur n'importe quel ordinateur où l'app est installée (en lecture seule ailleurs).</div>
      <div class="row" style="margin-top:12px"><span class="code">${state.showCodes.coach ? esc(c.coachCode) : '••••'}</span><button class="icon-btn" data-action="toggle-code" data-id="coach">${icon(state.showCodes.coach ? 'eyeOff' : 'eye', 15)}</button>
        <span class="spacer"></span><input id="ccode" class="codein" inputmode="numeric" maxlength="4" placeholder="Nouveau code" style="width:150px"><button class="btn" data-action="save-ccode">Changer</button></div></div>
    <div class="section"><h3>${icon('key', 17)} Clé API Riot</h3>
      <div class="status-line"><span class="dot ${c.hasKey ? 'on' : 'err'}"></span>${c.hasKey ? 'Clé enregistrée (' + esc(c.keyPreview) + '). Les parties arrivent automatiquement.' : 'Aucune clé : les parties ne peuvent pas être récupérées.'}</div>
      <div class="row" style="margin-top:12px"><input id="key" style="width:420px" placeholder="Remplacer la clé : RGAPI-…"><button class="btn" data-action="save-key">Tester et enregistrer</button></div></div>
    <div class="section" id="spectateur"><h3>${icon('play', 17)} Mode spectateur (bouton Regarder)</h3>
      <div class="status-line"><span class="dot ${(c.lol || {}).found ? 'on' : 'err'}"></span>${(c.lol || {}).found ? 'League of Legends trouvé : ' + esc(c.lol.path) : 'League of Legends introuvable sur cet ordinateur.'}</div>
      <div class="muted small" style="margin-top:8px">Laisse vide pour le chercher tout seul (dossier Applications sur Mac, C:\\Riot Games sur Windows). S'il est ailleurs, colle ici le dossier où il est installé.</div>
      <div class="row" style="margin-top:10px"><input id="lolpath" style="width:420px" placeholder="/Applications/League of Legends.app" value="${esc((c.lol || {}).custom || '')}"><button class="btn" data-action="save-lolpath">Enregistrer</button></div></div>
    <div class="section"><h3>${icon('cloud', 17)} Serveur en ligne (espaces joueurs)</h3>
      ${cl.linked
        ? `<div class="status-line"><span class="dot on"></span>Relié. Dernier envoi ${esc(ago(cl.lastPush))}. Tes joueurs peuvent ouvrir leur espace chez eux avec leur code.</div>`
        : `<div class="status-line"><span class="dot ${cl.lastError ? 'err' : ''}"></span>Pas encore relié${cl.lastError ? ' (' + esc(cl.lastError) + ')' : ''} : les joueurs ne peuvent pas encore ouvrir leur espace chez eux.</div>
           <div class="muted small" style="margin-top:12px">Empreinte de cet ordinateur, à enregistrer une seule fois dans la base (table <b>push_keys</b> de Supabase). Ce n'est pas un secret : elle sert seulement à reconnaître cet ordinateur.</div>
           <div class="row" style="margin-top:8px"><code id="keyhash" style="font-size:12px;background:var(--panel-2);border:1px solid var(--line-2);border-radius:7px;padding:8px 10px;word-break:break-all;flex:1">${esc(cl.keyHash || '')}</code></div>`}
      <div class="row" style="margin-top:12px"><button class="btn ${cl.linked ? '' : 'primary'}" data-action="check-cloud">${icon('sync', 15)} Vérifier la liaison</button></div></div>
    <div class="section"><h3>${icon('sync', 17)} Récupération des parties</h3>
      <div class="row" style="margin-top:8px"><label style="margin:0">Toutes les</label><select data-setting="autoSyncMinutes">${[[15, '15 minutes'], [30, '30 minutes'], [60, 'heures'], [180, '3 heures']].map(([v, l]) => opt(v, s.autoSyncMinutes, l)).join('')}</select>
        <label style="margin:0 0 0 18px">Parties max par joueur à chaque fois</label><select data-setting="maxGamesPerSync">${[10, 20, 30, 50, 100].map(v => opt(v, s.maxGamesPerSync)).join('')}</select></div>
      <div class="muted small" style="margin-top:8px">Dernière récupération ${esc(ago(s.lastSync))}.</div></div>
    <div class="section"><h3>${icon('target', 17)} Objectifs par défaut selon le rôle</h3><div class="muted small">Pourcentages en décimal (0,55 = 55 %). Servent de base à chaque joueur ; ses objectifs personnalisés les remplacent.</div>
      <table class="table" style="margin-top:8px"><tr><th class="l">Indicateur</th><th>Sens</th>${ROLES.map(r => `<th>${r}</th>`).join('')}</tr>${objRows}</table>
      <div class="actions"><button class="btn primary" data-action="save-tobj">Enregistrer</button></div></div>
    <div class="section"><h3>${icon('sessions', 17)} Axes de travail par défaut</h3><textarea id="axes" rows="6" style="width:100%;margin-top:8px">${esc(s.axes.join('\n'))}</textarea>
      <div class="actions"><button class="btn primary" data-action="save-axes">Enregistrer</button></div></div>
    <div class="section"><h3>${icon('download', 17)} Sauvegarde</h3><div class="row" style="margin-top:8px"><button class="btn" data-action="export">${icon('download', 15)} Exporter</button><button class="btn" data-action="import">${icon('upload', 15)} Restaurer</button></div></div>
    ${pinnedLinks()}
    <div class="section"><h3>${icon('info', 17)} À propos</h3><div class="muted small">Version ${esc(d.appVersion)}. ${upTxt}</div></div>`;
}

// ======================================================================== EN DIRECT (coach, sur son ordinateur)
const LIVE = () => (D() && D().live) || null;
const liveGames = () => (LIVE() && LIVE().games) || [];
const liveOf = pid => liveGames().find(g => g.playerIds.includes(pid)) || null;
const gameSecs = (start, len, at) => (start ? Math.max(0, Math.round((Date.now() - start) / 1000)) : Math.max(0, Math.round(len + (Date.now() - at) / 1000)));
const fmtGame = s => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
const clockAttrs = g => `data-gstart="${g.startTime || ''}" data-glen="${g.length}" data-gat="${g.fetchedAt}"`;
function spellImg(id) {
  const s = D().settings, sp = s.spellKeys && s.spellKeys[id];
  return sp && s.ddVersion ? `<img class="lv-spell" src="https://ddragon.leagueoflegends.com/cdn/${s.ddVersion}/img/spell/${sp[0]}.png" alt="" data-tip="${esc(sp[1])}">` : '<span class="lv-spell"></span>';
}
function perkImg(id, cls) {
  const pk = D().settings.perkIcons && D().settings.perkIcons[id];
  return pk ? `<img class="${cls}" src="https://ddragon.leagueoflegends.com/cdn/img/${pk[0]}" alt="" data-tip="${esc(pk[1])}">` : '';
}
function liveChip(p) {
  const g = isCoach() && canEdit() ? liveOf(p.id) : null;
  return g ? `<span class="live-chip" data-action="go" data-page="direct" data-tip="Partie classée en cours : clique pour la voir"><span class="pulse"></span>En partie <span class="lv-tick" ${clockAttrs(g)}>${fmtGame(gameSecs(g.startTime, g.length, g.fetchedAt))}</span></span>` : '';
}
const ownerName = pid => { const p = D().players.find(y => y.id === pid); return p ? gameName(p) : '?'; };
// mirror : ligne de l'adversaire, dans l'autre sens (champion à droite), pour les voir face à face
function liveRow(x, mirror = false, end = false) {
  const games = x.rank ? x.rank.wins + x.rank.losses : 0;
  const wr = games ? Math.round(x.rank.wins / games * 100) : null;
  const name = x.hidden ? '<span class="faint">Joueur masqué</span>' : `<b>${esc(x.gameName)}</b><span class="faint">#${esc(x.tagLine)}</span>`;
  const cells = [
    `<div class="lv-champ">${x.champion ? img(x.champion, 'lv-cimg') : '<span class="lv-cimg"></span>'}${perkImg(x.keystone, 'lv-key')}</div>`,
    `<div class="lv-spells">${spellImg(x.spells[0])}${spellImg(x.spells[1])}</div>`,
    `<div class="lv-who"><div class="lv-name">${name}</div><div class="lv-cname">${x.champion ? champ(x.champion) : 'Champion inconnu'}${perkImg(x.subStyle, 'lv-sub')}${x.smurf ? `<span class="lv-smurf">smurf de ${esc(ownerName(x.playerId))}</span>` : ''}</div></div>`,
    `<div class="lv-rank">${x.rank ? `<b>${esc(x.rank.label)}</b> <span class="muted">${x.rank.lp} LP</span><div class="small"><span class="${wr >= 50 ? 'ok' : 'red'}">${wr} %</span> <span class="faint">sur ${games} parties</span></div>` : '<span class="faint">Non classé</span>'}</div>`
  ];
  return `<div class="lv-row ${x.playerId ? 'me' : ''} ${mirror ? 'mirror' : ''} ${end ? 'end' : ''}" ${x.playerId ? `data-action="open-player" data-id="${x.playerId}" data-tip="Ouvrir son tableau de bord"` : ''}>
    ${(mirror ? cells.reverse() : cells).join('')}
  </div>`;
}
const LANE = { TOP: 'Top', JUNGLE: 'Jungle', MIDDLE: 'Mid', BOTTOM: 'ADC', UTILITY: 'Support' };
function liveCard(g) {
  const lol = (D().coach && D().coach.lol) || {};
  const who = x => (x.smurf ? `${esc(ownerName(x.playerId))} <span class="muted">sur son smurf</span> ${esc(x.gameName)}` : esc(x.gameName));
  const allyOurs = g.allies.filter(x => x.playerId).map(who);
  const enemyOurs = g.enemies.filter(x => x.playerId).map(who);
  const title = allyOurs.join(' et ') + (enemyOurs.length ? ' <span class="muted">contre</span> ' + enemyOurs.join(' et ') : '');
  const side = t => (t === 100 ? 'bleu' : 'rouge');
  const bans = list => (list.length ? list.map(c => img(c, 'lv-ban')).join('') : '<span class="faint tiny">aucun ban</span>');
  const facing = g.allies.length === 5 && g.enemies.length === 5 && g.allies.concat(g.enemies).every(x => x.position);
  const enemySide = g.teamId === 100 ? 200 : 100;
  const allyTeam = allyOurs.length > 1 ? 'Leur équipe' : 'Son équipe';
  const started = g.startTime ? 'commencée à ' + new Date(g.startTime).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) : 'écran de chargement';
  return `<div class="lv-card">
    <div class="lv-head">
      <span class="pulse"></span>
      <div><div class="lv-title">${title}</div><div class="muted small">Classée Solo/Duo · ${esc(g.platformId)} · ${started}</div></div>
      <span class="spacer"></span>
      <div class="lv-clock" ${clockAttrs(g)}>${fmtGame(gameSecs(g.startTime, g.length, g.fetchedAt))}</div>
      <button class="btn primary lv-watch" data-action="live-watch" data-id="${g.gameId}">${icon('play', 15)} Regarder</button>
    </div>
    ${lol.found ? '' : `<div class="bk-alert muted-alert">${icon('alert', 16)}<span>League of Legends est introuvable sur cet ordinateur : le bouton Regarder ne pourra pas l'ouvrir.</span><span class="spacer"></span><button class="btn" data-action="go-spectator">Indiquer son emplacement</button></div>`}
    ${facing ? `<div class="lv-face">
      <div class="lv-th"><span class="lv-side ${side(g.teamId)}"></span><b>${allyTeam}</b><span class="faint small">côté ${side(g.teamId)}</span><span class="spacer"></span><span class="lv-bans" data-tip="Champions bannis par cette équipe">${bans(g.bans.allies)}</span></div>
      <div class="lv-th lv-mid"></div>
      <div class="lv-th right"><span class="lv-bans" data-tip="Champions bannis par cette équipe">${bans(g.bans.enemies)}</span><span class="spacer"></span><span class="faint small">côté ${side(enemySide)}</span><b>Adversaires</b><span class="lv-side ${side(enemySide)}"></span></div>
      ${g.allies.map((a, i) => liveRow(a, false, i === 4) + `<div class="lv-pos ${i === 4 ? 'end' : ''}">${LANE[a.position] || ''}</div>` + liveRow(g.enemies[i], true, i === 4)).join('')}
    </div>` : `<div class="lv-teams">
      <div class="lv-team"><div class="lv-th"><span class="lv-side ${side(g.teamId)}"></span><b>${allyTeam}</b><span class="faint small">côté ${side(g.teamId)}</span><span class="spacer"></span><span class="lv-bans" data-tip="Champions bannis par cette équipe">${bans(g.bans.allies)}</span></div>${g.allies.map(x => liveRow(x)).join('')}</div>
      <div class="lv-team"><div class="lv-th"><span class="lv-side ${side(enemySide)}"></span><b>Adversaires</b><span class="faint small">côté ${side(enemySide)}</span><span class="spacer"></span><span class="lv-bans" data-tip="Champions bannis par cette équipe">${bans(g.bans.enemies)}</span></div>${g.enemies.map(x => liveRow(x)).join('')}</div>
    </div>`}
    <div class="faint tiny lv-foot">${facing ? 'Postes devinés d\'après les champions et les sorts (Riot ne les donne pas pendant la partie). ' : ''}Regarder ouvre League of Legends en mode spectateur, avec 3 minutes de retard (règle de Riot pour les classées). Le jeu doit être installé et à jour sur cet ordinateur.</div>
  </div>`;
}
function pageDirect() {
  const L = LIVE();
  const head = '<h1>En direct</h1><div class="sub">Les parties classées Solo/Duo en cours de tes joueurs, avec leurs adversaires. Vérification automatique chaque minute.</div>';
  if (!L || !L.enabled) return head + `<div class="empty">Ajoute ta clé API Riot dans Paramètres › Général pour voir les parties en direct.</div>`;
  const games = L.games || [];
  const status = `<div class="lv-status"><span class="dot ${L.error ? 'err' : 'on'}"></span><span>${L.error ? 'Dernière vérification impossible : ' + esc(L.error) : L.checkedAt ? 'Vérifié ' + esc(ago(L.checkedAt)) : 'Première vérification en cours…'}</span><span class="spacer"></span><button class="btn" data-action="live-refresh">${icon('sync', 15)} Vérifier maintenant</button></div>`;
  const playing = new Set(games.flatMap(g => g.playerIds));
  const idle = D().players.filter(p => !playing.has(p.id));
  const idleList = idle.length && games.length ? `<h2>${icon('players', 17)} Pas en partie classée</h2><div class="lv-idle">${idle.map(p => `<span class="chip" data-action="open-player" data-id="${p.id}">${esc(gameName(p))}</span>`).join('')}</div>` : '';
  return head + status + (games.length ? games.map(liveCard).join('')
    : `<div class="empty lv-empty">${icon('radio', 26)}<b>Aucun de tes joueurs n'est en partie classée Solo/Duo.</b><span>Dès que l'un d'eux lance une partie, elle s'affiche ici avec ses adversaires (et tu reçois une notification).</span></div>`) + idleList;
}

const PAGES = { accueil: pageAccueil, direct: pageDirect, dashboard: pageDashboard, parties: pageParties, seances: pageSeances, objectifs: pageObjectifs, joueurs: pageJoueurs, parametres: pageParametres };

// le coach refuse un horaire en en proposant un autre
function openProposeModal(bookingId) {
  const b = (BK().all || []).find(x => x.id === bookingId);
  if (!b) return;
  state.proposing = bookingId;
  const who = (D().players.find(x => x.id === b.playerId) || {}).riotId || '';
  openModal(`<h1>Proposer un autre horaire</h1>
    <div class="muted" style="margin:6px 0 4px">${esc(who)} a demandé ${esc(slotText(bSlot(b)))}. Choisis un créneau libre : il recevra ta proposition et pourra l'accepter.</div>
    ${slotGrid({ mode: 'proposer', playerId: b.playerId, bookingId })}
    <div class="actions"><button class="btn ghost" data-action="close-modal">Fermer</button></div>`);
  $('#modal-box').style.width = '920px';
}

// ======================================================================== modale
function openModal(html) { $('#modal-box').innerHTML = html; $('#modal').classList.remove('hidden'); hookImages(); }
function closeModal() { $('#modal').classList.add('hidden'); $('#modal-box').innerHTML = ''; $('#modal-box').style.width = ''; state.proposing = null; }

// chronos des parties en direct
setInterval(() => {
  document.querySelectorAll('[data-glen]').forEach(el => { el.textContent = fmtGame(gameSecs(Number(el.dataset.gstart) || 0, Number(el.dataset.glen), Number(el.dataset.gat))); });
}, 1000);

// minuteur du coaching : mis à jour chaque seconde sans redessiner la page
setInterval(() => {
  const live = document.getElementById('live');
  if (!live || !live.dataset.ends) return;
  const left = Number(live.dataset.ends) - Date.now();
  const c = document.getElementById('live-clock');
  if (c) c.textContent = fmtClock(left);
  live.classList.toggle('warn', left <= 5 * 60000);
}, 1000);

// ======================================================================== infobulles
function showTip(el, e) {
  const t = $('#tooltip');
  t.textContent = el.dataset.tip;
  t.classList.remove('hidden');
  moveTip(e);
}
function moveTip(e) {
  const t = $('#tooltip');
  const x = Math.min(window.innerWidth - t.offsetWidth - 12, e.clientX + 14);
  const y = e.clientY + 16 + t.offsetHeight > window.innerHeight ? e.clientY - t.offsetHeight - 12 : e.clientY + 16;
  t.style.left = x + 'px'; t.style.top = y + 'px';
}
function hideTip() { const t = $('#tooltip'); if (t) t.classList.add('hidden'); }
document.addEventListener('mouseover', e => { const el = e.target.closest('[data-tip]'); if (el && el.dataset.tip) showTip(el, e); });
document.addEventListener('mousemove', e => { if (!$('#tooltip').classList.contains('hidden')) moveTip(e); });
document.addEventListener('mouseout', e => { const el = e.target.closest('[data-tip]'); if (el && !el.contains(e.relatedTarget)) hideTip(); });

// ======================================================================== actions
let objTimer = null;
async function saveObjectives() {
  const p = player();
  if (!p) return;
  const objectives = {};
  document.querySelectorAll('[data-obj]').forEach(i => {
    const k = i.dataset.obj;
    const v = objFromInput(k, i.value);
    const def = roleDefault(k, p.role);
    if (v !== null && (def === null || Math.abs(v - def) > 1e-6)) objectives[k] = v;
  });
  const r = await window.api.savePlayer({ id: p.id, objectives });
  if (r && r.data) state.data = r.data;
  toast(r && r.ok ? 'Objectifs enregistrés.' : (r && r.message) || 'Erreur', r && r.ok ? 'ok' : 'err', 1600);
}

document.addEventListener('click', async e => {
  const key = e.target.closest('[data-key]');
  if (key && !$('#login').classList.contains('hidden')) { pressKey(key.dataset.key); return; }
  if (e.target.id === 'modal') { closeModal(); return; }
  if (e.target.id === 'drawer-back') { closeDrawer(); return; }
  const el = e.target.closest('[data-action]');
  if (!el) return;
  if (el.closest('[data-stop]') && el.dataset.action === 'toggle-session') return;
  const a = el.dataset.action, id = el.dataset.id;
  const p = player();
  switch (a) {
    case 'go': state.page = el.dataset.page; if (state.page !== 'parametres') state.settingsTab = state.settingsTab || 'joueur'; render(); $('#page').scrollTop = 0; break;
    case 'collapse': state.collapsed = !state.collapsed; try { localStorage.setItem('collapsed', state.collapsed ? '1' : '0'); } catch (err) { /* rien */ } render(); break;
    case 'logout': logout(); break;
    case 'open-player': state.playerId = id; state.page = 'dashboard'; state.metric = null; render(); $('#page').scrollTop = 0; break;
    case 'player-settings': state.playerId = id; state.page = 'parametres'; state.settingsTab = 'joueur'; render(); break;
    case 'period': state.period = el.dataset.v; render(); break;
    case 'metric': state.metric = el.dataset.metric; render(); break;
    case 'gfilter': state.gameFilter = el.dataset.v; render(); break;
    case 'game': openGame(id); break;
    case 'close-drawer': closeDrawer(); break;
    case 'gset': {
      let v = el.dataset.v;
      if (el.dataset.field === 'mental') v = Number(v);
      if (el.dataset.field === 'objectiveMet') v = v === '' ? null : v === 'true';
      setGameField(el.dataset.field, v);
      break;
    }
    case 'delete-game': {
      const g = D().games.find(x => x.matchId === id && x.playerId === state.playerId);
      if (g && confirm('Retirer cette partie des stats ? Elle ne sera plus récupérée.')) { closeDrawer(); apply(await window.api.deleteGame(g.matchId, g.playerId), 'Partie retirée.'); }
      break;
    }
    case 'toggle-session': state.sessionOpen = state.sessionOpen === id ? null : id; render(); break;
    case 'new-session': openModal(sessionForm()); $('#modal-box').style.width = '880px'; break;
    case 'edit-session': openModal(sessionForm(D().sessions.find(s => s.id === id))); $('#modal-box').style.width = '880px'; break;
    case 'seances-tab': state.seancesTab = el.dataset.v; render(); break;
    case 'ex-theme': state.exTheme = el.dataset.v; render(); break;
    case 'ex-roles': state.exAllRoles = !state.exAllRoles; render(); break;
    case 'ex-toggle': state.exOpen = state.exOpen === id ? null : id; render(); break;
    case 'report-open': {
      const s = D().sessions.find(x => x.id === id);
      if (s) { openModal(reportForm(s)); $('#modal-box').style.width = '760px'; }
      break;
    }
    case 'open-session': state.page = 'seances'; state.seancesTab = 'seances'; state.sessionOpen = id; render(); break;
    case 'delete-session': if (confirm('Supprimer cette séance ?')) apply(await window.api.deleteSession(id), 'Séance supprimée.'); break;
    case 'new-player': openModal(playerForm()); break;
    case 'edit-player': openModal(playerForm(D().players.find(x => x.id === id))); break;
    case 'delete-player': {
      const dp = D().players.find(x => x.id === id);
      if (!dp) break;
      openModal(`<h1>Supprimer ${esc(dp.riotId)} ?</h1>
        <div class="muted" style="margin-top:8px">Son profil, ses parties, ses rangs et ses séances seront effacés de l'app et du serveur. Son code d'accès ne fonctionnera plus. C'est définitif.</div>
        <div class="actions"><button class="btn ghost" data-action="close-modal">Annuler</button><button class="btn danger" data-action="confirm-delete" data-id="${dp.id}">${icon('trash', 15)} Supprimer définitivement</button></div>`);
      break;
    }
    case 'confirm-delete': closeModal(); if (state.playerId === id) state.playerId = null; apply(await window.api.deletePlayer(id), 'Joueur supprimé.'); break;
    case 'gen-code': { const r = await window.api.newCode(); if (r.ok) $('#code-input').value = r.code; break; }
    case 'toggle-code': state.showCodes[id] = !state.showCodes[id]; render(); break;
    case 'close-modal': closeModal(); break;
    case 'stab': state.settingsTab = el.dataset.v; render(); break;
    case 'gen-pcode': { const r = await window.api.newCode(); if (r.ok) $('#pcode').value = r.code; break; }
    case 'save-pcode': if (p) apply(await window.api.savePlayer({ id: p.id, code: $('#pcode').value.trim() }), 'Code enregistré. Donne-le à ' + gameName(p) + '.'); break;
    case 'reset-objectives': if (p && confirm('Revenir aux objectifs du rôle pour ce joueur ?')) apply(await window.api.savePlayer({ id: p.id, objectives: {} }), 'Objectifs du rôle rétablis.'); break;
    case 'save-paxes': if (p) apply(await window.api.savePlayer({ id: p.id, axes: $('#paxes').value.split('\n').map(x => x.trim()).filter(Boolean) }), 'Axes enregistrés.'); break;
    case 'save-ccode': apply(await window.api.setCoachCode($('#ccode').value.trim()), 'Code coach changé.'); break;
    case 'save-key': { const r = await window.api.saveKey($('#key').value); apply(r); break; }
    case 'save-secret': { el.disabled = true; el.innerHTML = '<span class="spinner"></span>'; const r = await window.api.saveCloudSecret($('#csecret').value); apply(r); break; }
    case 'check-cloud': { el.disabled = true; el.innerHTML = '<span class="spinner"></span> Vérification…'; apply(await window.api.checkCloud()); break; }
    case 'save-tobj': {
      const objectives = JSON.parse(JSON.stringify(D().settings.objectives));
      document.querySelectorAll('[data-tobj]').forEach(i => { objectives[i.dataset.tobj][i.dataset.role] = i.value === '' ? null : Number(i.value); });
      apply(await window.api.saveSettings({ objectives }), 'Objectifs par défaut enregistrés.');
      break;
    }
    case 'save-axes': apply(await window.api.saveSettings({ axes: $('#axes').value.split('\n').map(x => x.trim()).filter(Boolean) }), 'Axes par défaut enregistrés.'); break;
    case 'invite': { const ip = D().players.find(x => x.id === id); if (ip) copyText(inviteText(ip), 'Invitation copiée : colle-la à ' + gameName(ip) + ' (Discord, SMS…).'); break; }
    case 'copy-links': copyText(linksText(), 'Liens de téléchargement copiés.'); break;
    case 'ext': window.api.openExternal(el.dataset.url); break;
    case 'book-week': state.bookWeek = Number(el.dataset.v); if (!$('#modal').classList.contains('hidden') && state.proposing) openProposeModal(state.proposing); else render(); break;
    case 'slot-free': {
      const t = Number(el.dataset.t);
      openModal(`<h1>Réserver ce créneau ?</h1><div class="sub" style="margin:8px 0 0">${esc(slotText(t))} (1 h, heure de Paris).</div>
        <div class="muted small">Ton coach doit accepter : tu verras sa réponse ici. S'il n'est pas disponible, il te proposera un autre horaire.</div>
        <div class="actions"><button class="btn ghost" data-action="close-modal">Annuler</button><button class="btn primary" data-action="bk" data-act="demander" data-t="${t}">${icon('calendar', 15)} Demander ce créneau</button></div>`);
      break;
    }
    case 'slot-mine': {
      const b = (BK().mine || []).find(x => x.id === id);
      if (!b) break;
      openModal(`<h1>${esc(slotText(bSlot(b)))}</h1><div class="row" style="margin:10px 0"><span class="chip ${BK_CHIP[b.status] || ''}">${esc(BK_LABEL[b.status])}</span></div>
        <div class="actions">${b.status === 'proposee' ? `<button class="btn" data-action="bk" data-act="refuser_proposition" data-id="${b.id}">Refuser</button><button class="btn primary" data-action="bk" data-act="accepter_proposition" data-id="${b.id}">Accepter cet horaire</button>`
          : `<button class="btn ghost" data-action="close-modal">Fermer</button>${b.status === 'en_attente' || b.status === 'acceptee' ? `<button class="btn danger" data-action="bk" data-act="annuler" data-id="${b.id}">Annuler la réservation</button>` : ''}`}</div>`);
      break;
    }
    case 'bk-propose': state.bookWeek = 0; openProposeModal(id); break;
    case 'slot-propose': {
      const t = Number(el.dataset.t);
      state.proposing = null;
      closeModal();
      apply(await window.api.booking('proposer', id, new Date(t).toISOString()), 'Nouvel horaire proposé : ' + slotText(t) + '.');
      break;
    }
    case 'bk': {
      const act = el.dataset.act;
      const start = el.dataset.t ? new Date(Number(el.dataset.t)).toISOString() : undefined;
      if (act === 'annuler' && !confirm('Annuler cette réservation ?')) break;
      if (act === 'terminer' && !confirm('Terminer le coaching maintenant ?')) break;
      el.disabled = true;
      const msg = { demander: 'Demande envoyée à ton coach.', accepter: 'Créneau accepté.', annuler: 'Réservation annulée.', accepter_proposition: 'Horaire accepté.', refuser_proposition: 'Horaire refusé : tu peux choisir un autre créneau.', demarrer: 'Coaching démarré.', terminer: 'Coaching terminé.' }[act];
      closeModal();
      apply(await window.api.booking(act, id, start), msg);
      break;
    }
    case 'moments': openMoments(id); break;
    case 'mo-sel': if (state.moments && state.moments.data) { state.moments.sel = Number(el.dataset.v); const sc = $('.mo-list') ? $('.mo-list').scrollTop : 0; openModal(momentsHtml()); $('#modal-box').style.width = 'min(1120px, 95vw)'; if ($('.mo-list')) $('.mo-list').scrollTop = sc; } break;
    case 'mo-copy': if (state.moments && state.moments.text) copyText(state.moments.text, 'Dossier de la partie copié : colle-le dans ta conversation avec Claude.'); break;
    case 'live-refresh': { el.disabled = true; el.innerHTML = '<span class="spinner"></span> Vérification…'; apply(await window.api.refreshLive()); break; }
    case 'live-watch': {
      const old = el.innerHTML;
      el.disabled = true; el.innerHTML = '<span class="spinner"></span> Ouverture…';
      const r = await window.api.watchLive(id);
      el.disabled = false; el.innerHTML = old;
      if (r && r.ok) toast(r.message, 'ok', 7000); else toast(r ? r.message : 'Erreur inconnue.', 'err', 8000);
      break;
    }
    case 'go-spectator': state.page = 'parametres'; state.settingsTab = 'general'; render(); { const s = document.getElementById('spectateur'); if (s) s.scrollIntoView({ block: 'start' }); } break;
    case 'save-lolpath': apply(await window.api.saveSettings({ lolPath: $('#lolpath').value }), 'Emplacement enregistré.'); break;
    case 'export': { const r = await window.api.exportBackup(); if (r.ok) toast(r.message); break; }
    case 'import': if (confirm('Remplacer toutes les données par la sauvegarde ?')) apply(await window.api.importBackup()); break;
  }
});

document.addEventListener('change', async e => {
  const el = e.target;
  if (el.dataset.change === 'player') { state.playerId = el.value; state.metric = null; state.sessionOpen = null; closeDrawer(true); render(); return; }
  if (el.dataset.change === 'card') {
    const p = player();
    const cards = settingsOf(p).cards.slice();
    cards[Number(el.dataset.i)] = el.value;
    apply(await window.api.savePlayer({ id: p.id, cards }), 'Carte modifiée.');
    return;
  }
  if (el.dataset.setting) { apply(await window.api.saveSettings({ [el.dataset.setting]: Number(el.value) }), 'Réglage enregistré.'); return; }
  if (el.dataset.gfield) {
    const v = el.dataset.gfield === 'lpDelta' ? (el.value === '' ? null : Number(el.value)) : el.value;
    await setGameField(el.dataset.gfield, v);
    toast('Enregistré.', 'ok', 1200);
  }
});

document.addEventListener('input', e => {
  const el = e.target;
  if (el.dataset.input === 'q') { state.q = el.value; render(); return; }
  if (el.dataset.obj) {
    const p = player();
    const v = objFromInput(el.dataset.obj, el.value);
    const def = roleDefault(el.dataset.obj, p && p.role);
    el.classList.toggle('custom', v !== null && (def === null || Math.abs(v - def) > 1e-6));
    clearTimeout(objTimer);
    objTimer = setTimeout(saveObjectives, 700);
  }
});

document.addEventListener('submit', async e => {
  e.preventDefault();
  const formId = e.target.getAttribute('id'); // un champ nommé « id » masquerait form.id
  const f = Object.fromEntries(new FormData(e.target).entries());
  if (formId === 'player-form' || formId === 'profile-form') {
    const riotId = String(f.riotId || '').trim();
    if (!/^[^#]+#[^#]+$/.test(riotId)) return toast('Le pseudo doit être au format Nom#TAG.', 'err');
    if (f.code && !/^\d{4}$/.test(f.code)) return toast('Le code doit faire 4 chiffres.', 'err');
    const isNew = !f.pid;
    const p = { riotId, region: f.region, role: f.role, startDate: f.startDate, rankStart: f.rankStart, rankTarget: f.rankTarget, goal: f.goal };
    if ('smurfs' in f) p.smurfs = f.smurfs;
    if (f.code) p.code = f.code;
    if (!isNew) {
      p.id = f.pid;
      const cur = D().players.find(x => x.id === f.pid);
      const accountChanged = cur && (riotId.toLowerCase() !== String(cur.riotId).toLowerCase() || f.region !== cur.region);
      if (accountChanged && !confirm(`Changer de compte Riot pour ce joueur ?\n\nLes parties déjà récupérées pour ${cur.riotId} seront effacées, puis celles de ${riotId} seront téléchargées. Ses séances sont gardées.`)) return;
    }
    const r = await window.api.savePlayer(p);
    if (r && r.ok) {
      closeModal();
      state.playerId = r.id;
      if (isNew) { state.page = 'dashboard'; state.metric = null; }
      apply(r, isNew ? 'Joueur ajouté : ses parties arrivent dans un instant.' : 'Joueur enregistré.');
    } else toast(r ? r.message : 'Erreur', 'err', 5000);
  }
  if (formId === 'report-form') {
    const data = { ex: {} };
    for (const [k, v] of Object.entries(f)) {
      const [kind, a, b] = k.split('|');
      if (kind === 'g') data[a] = v;
      if (kind === 'f') (data.ex[a] = data.ex[a] || {})[b] = v;
    }
    // nombres et temps
    for (const [exId, vals] of Object.entries(data.ex)) {
      const ex = Exercises.byId(exId);
      for (const fd of (ex ? ex.fields : [])) {
        const v = vals[fd.k];
        if (v === undefined || v === '') { delete vals[fd.k]; continue; }
        if (fd.type === 'number' || fd.type === 'score') vals[fd.k] = Number(String(v).replace(',', '.'));
        if (fd.type === 'time' && Exercises.secs(v) === null) return toast('« ' + fd.label + ' » : écris un temps comme 3:25.', 'err');
      }
    }
    if (data.ressenti !== undefined && data.ressenti !== '') data.ressenti = Number(data.ressenti);
    const r = await window.api.saveReport(f.sid, data);
    if (r && r.ok) { closeModal(); apply(r, 'Fiche enregistrée : ton coach la verra.'); } else toast(r ? r.message : 'Erreur', 'err', 5000);
    return;
  }
  if (formId === 'session-form') {
    const s = { playerId: state.playerId };
    for (const [k, v] of Object.entries(f)) if (!k.includes('|')) s[k] = v;
    s.id = f.sid || undefined;
    delete s.sid;
    s.exercises = Exercises.LIST.filter(x => f['ex|' + x.id]).map(x => {
      let target = String(f['ext|' + x.id] === undefined ? '' : f['ext|' + x.id]).trim().replace(',', '.');
      if (target !== '' && !(x.target && x.target.type === 'time') && !isNaN(Number(target))) target = Number(target);
      return { id: x.id, target, note: String(f['exn|' + x.id] || '').trim() };
    });
    const badTime = s.exercises.find(e => { const x = Exercises.byId(e.id); return x.target && x.target.type === 'time' && e.target !== '' && Exercises.secs(e.target) === null; });
    if (badTime) return toast('Cible de « ' + Exercises.byId(badTime.id).title + ' » : écris un temps comme 3:30.', 'err');
    s.target = s.target === '' ? '' : Number(s.target);
    const r = await window.api.saveSession(s);
    if (r && r.ok) { closeModal(); apply(r, 'Séance enregistrée.'); } else toast(r ? r.message : 'Erreur', 'err');
  }
});

document.addEventListener('keydown', e => {
  if (!$('#login').classList.contains('hidden')) {
    if (/^\d$/.test(e.key)) pressKey(e.key);
    else if (e.key === 'Backspace') pressKey('back');
    return;
  }
  if (e.key === 'Escape') { if (!$('#modal').classList.contains('hidden')) closeModal(); else closeDrawer(); }
});

// nouvelles données venues du processus principal (synchro, serveur) : rafraîchir sans gêner la saisie
document.addEventListener('focusout', () => { if (state.pending) setTimeout(() => { if (!isTyping() && state.pending) { state.pending = false; render(); } }, 50); });
window.api.onAlert(a => toast(a.title + ' — ' + a.body, 'ok', 9000));
window.api.onData(d => {
  state.data = d;
  if (isTyping() || !$('#modal').classList.contains('hidden')) { state.pending = true; return; }
  render();
});

(async function init() {
  state.data = await window.api.getData();
  // redémarrage après une mise à jour : on rouvre la même page
  const ui = state.data && state.data.resumeUi;
  if (ui) Object.assign(state, { page: ui.page || 'accueil', playerId: ui.playerId || null, settingsTab: ui.settingsTab || 'joueur', period: ui.period || '20' });
  render();
  // décompte quand l'écran de code est bloqué après trop d'essais
  setInterval(async () => { if (D() && D().locked && D().blockedMs) { state.data = await window.api.getData(); renderLogin(); } }, 1000);
})();
