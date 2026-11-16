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
    return head + `<button class="nav ${state.page === x.id ? 'active' : ''}" data-action="go" data-page="${x.id}" title="${esc(x.label)}">${icon(x.ico, 18)}<span>${esc(x.label)}</span></button>`;
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
  const ro = !canEdit() ? `<span class="chip">${icon('eye', 14)} Lecture seule</span>` : '';
  $('#topbar').innerHTML = `<div class="crumbs">Coaching LoL ${icon('chevron', 14)} <b>${esc(pg ? pg.label : '')}</b>${perPlayer && p && isCoach() ? ` ${icon('chevron', 14)} ${esc(p.riotId)}` : ''}</div>
    <span class="spacer"></span>${ro}${sw}`;
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
    ${dots(gs.slice(-8))}
    <div class="go">${icon('arrow', 18)}</div></div>`;
}

function accueilCoach() {
  const d = D();
  const n = d.players.length;
  const rows = d.players.map(playerRow).join('');
  const add = canEdit() ? `<div class="row-link" data-action="new-player"><div class="tile">${icon('plus', 20)}</div><div class="t"><b>Ajouter un joueur</b><span>Son pseudo Riot, son rôle : ses parties arrivent toutes seules.</span></div><div class="go">${icon('arrow', 18)}</div></div>` : '';
  const shortcut = (pg, ico, t, s) => `<div class="row-link" data-action="go" data-page="${pg}"><div class="tile">${icon(ico, 20)}</div><div class="t"><b>${t}</b><span>${s}</span></div><div class="go">${icon('arrow', 18)}</div></div>`;
  return `<h1>Bonjour coach</h1>
    <div class="sub">${n ? n + ' joueur' + (n > 1 ? 's' : '') + ' suivi' + (n > 1 ? 's' : '') + '. Les parties arrivent automatiquement.' : 'Ajoute ton premier joueur pour commencer.'}</div>
    <div class="rows">${rows}${add}</div>
    <h2>Raccourcis</h2>
    <div class="rows">
      ${shortcut('dashboard', 'dashboard', 'Tableau de bord', 'Stats, objectifs et évolution du joueur sélectionné.')}
      ${shortcut('seances', 'sessions', 'Séances', 'Comptes rendus, axes de travail et devoirs.')}
      ${canEdit() ? shortcut('parametres', 'settings', 'Paramètres', 'Objectifs, cartes et codes d\'accès de chaque joueur.') : ''}
    </div>`;
}

function accueilJoueur() {
  const p = player();
  if (!p) return '<div class="empty">Ton coach n\'a pas encore préparé ton espace.</div>';
  const gs = roleGames(p);
  const last20 = gs.slice(-20);
  const rk = lastRank(p);
  const wr = winrate(last20);
  const next = (D().sessions || []).filter(s => s.playerId === p.id && s.next).map(s => s.next).sort().filter(x => x >= isoDay(Date.now()))[0];
  const row = (pg, ico, t, s) => `<div class="row-link" data-action="go" data-page="${pg}"><div class="tile">${icon(ico, 20)}</div><div class="t"><b>${t}</b><span>${s}</span></div><div class="go">${icon('arrow', 18)}</div></div>`;
  return `<h1>Salut ${esc(gameName(p))}</h1>
    <div class="sub">Ton espace de progression · ${esc(p.role)}${p.goal ? ' · objectif : ' + esc(p.goal) : ''}</div>
    <div class="stats-strip">
      <div class="stat"><div class="tile">${icon('trophy', 22)}</div><div><div class="k">Rang actuel</div><div class="v">${rk ? esc(rk.label.split(' · ')[0]) : '—'}</div><div class="muted small">${rk ? esc(rk.label.split(' · ')[1] || '') : ''}</div></div></div>
      <div class="stat">${Charts.ring(wr)}<div><div class="k">Victoires (20 dernières)</div><div class="v">${wr === null ? '—' : Math.round(wr * 100) + '%'}</div></div></div>
      <div class="stat"><div><div class="k">Forme récente</div>${dots(gs.slice(-10))}<div class="muted small" style="margin-top:6px">${gs.slice(-10).filter(g => g.win).length} V · ${gs.slice(-10).filter(g => !g.win).length} D</div></div></div>
      <div class="stat"><div class="tile">${icon('calendar', 22)}</div><div><div class="k">Prochaine séance</div><div class="v" style="font-size:18px">${next ? esc(dateLong(next)) : '—'}</div></div></div>
    </div>
    <div class="rows">
      ${row('dashboard', 'dashboard', 'Tableau de bord', 'Tes stats, tes objectifs et ton évolution partie après partie.')}
      ${row('parties', 'games', 'Parties', 'Tes dernières parties classées, en détail.')}
      ${row('seances', 'sessions', 'Séances', 'Les comptes rendus de tes séances et tes devoirs.')}
      ${row('objectifs', 'target', 'Mes objectifs', 'Ce que ton coach attend de toi, et où tu en es.')}
    </div>`;
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
  const by = Object.fromEntries(rows.map(r => [r.label, r]));
  const rk = lastRank(p);
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
          ${p.rankTarget ? `<span class="chip">${icon('target', 13)} ${esc(p.rankTarget)}</span>` : ''}<span class="muted small">${gs.length} partie${gs.length > 1 ? 's' : ''} prise${gs.length > 1 ? 's' : ''} en compte</span></div></div>
      <span class="spacer"></span>${periodSeg(p)}</div>
    <div class="kpis">${kpis}</div>
    <h2>Évolution partie par partie</h2>
    <div class="chart-card"><div class="head"><div class="chips">${cards.filter(metricOf).map(l => `<button class="${state.metric === l ? 'on' : ''}" data-action="metric" data-metric="${esc(l)}">${esc(l)}</button>`).join('')}</div></div>
      ${chart}
      <div class="legend"><span><i style="background:var(--accent)"></i>Victoire</span><span><i style="background:var(--red)"></i>Défaite</span>${obj === null ? '' : '<span><i style="background:var(--red);border-radius:2px;height:2px;width:12px"></i>Objectif</span>'}${mk > 0 ? '<span><i style="background:var(--violet)"></i>Début du coaching</span>' : ''}</div></div>
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
      <td class="${g.lpDelta > 0 ? 'ok' : g.lpDelta < 0 ? 'red' : 'muted'}">${Stats.fmt(g.lpDelta, 'diff')}</td>
      <td>${g.role !== p.role ? '<span class="chip">hors rôle</span>' : g.comment || g.mental ? icon('book', 15, 'muted') : ''}</td></tr>`).join('');
  return `<h1>Parties</h1>
    <div class="sub">${total} partie${total > 1 ? 's' : ''} classée${total > 1 ? 's' : ''} en solo. Clique sur une partie pour voir le détail${canEdit() ? ' et ajouter ton suivi' : ''}.</div>
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
      <label>LP gagnés ou perdus</label><input id="lp" type="number" data-gfield="lpDelta" value="${g.lpDelta === null || g.lpDelta === undefined ? '' : g.lpDelta}" style="width:120px">
      <label>Commentaire</label><textarea id="cm" data-gfield="comment" rows="4" style="width:100%" placeholder="Ce qui a marché, ce qui est à revoir…">${esc(g.comment || '')}</textarea>
      <div class="actions"><button class="btn danger" data-action="delete-game" data-id="${esc(g.matchId)}">${icon('trash', 15)} Retirer la partie</button></div>`
    : `${g.mental ? `<label>Note mentale</label><div>${g.mental} / 5</div>` : ''}
       ${g.objectiveMet === true || g.objectiveMet === false ? `<label>Objectif de la partie</label><div>${g.objectiveMet ? 'Atteint' : 'Pas atteint'}</div>` : ''}
       ${g.comment ? `<label>Commentaire du coach</label><div class="note">${esc(g.comment)}</div>` : ''}
       ${!g.mental && !g.comment && g.objectiveMet !== true && g.objectiveMet !== false ? '<div class="muted small">Pas encore de commentaire du coach sur cette partie.</div>' : ''}`;
  $('#drawer').innerHTML = `<div class="row"><span class="chip ${g.win ? 'accent' : 'red'}">${g.win ? 'Victoire' : 'Défaite'}</span><span class="muted small">${dateTimeFr(g.date)} · ${g.duration} min</span><span class="spacer"></span><button class="icon-btn" data-action="close-drawer">${icon('close', 18)}</button></div>
    <div class="game-head">${img(g.champion, '')}<div><h2 style="margin:0">${champ(g.champion)}</h2><div class="muted small">${esc(g.role)} · côté ${esc(g.side || '?')} · niveau ${g.level || '?'}</div></div><span class="spacer"></span>
      ${g.opponent ? `<div class="vs" style="text-align:center"><div class="faint tiny">contre</div>${img(g.opponent, '')}<div class="small">${champ(g.opponent)}</div></div>` : ''}</div>
    <div class="statgrid">
      ${cell('K / D / A', `${g.kills} / ${g.deaths} / ${g.assists}`)}${cell('KDA', Stats.fmt(M.KDA(g), 'dec2'))}${cell('Kill participation', Stats.fmt(M.KP(g), 'pct'))}
      ${cell('CS', `${g.cs} <span class="muted small">(${Stats.fmt(M['CS/min'](g), 'dec2')}/min)</span>`)}${cell('CS à 10 min', Stats.fmt(g.cs10, 'int'))}${cell('Morts avant 15 min', g.deaths15 === null || g.deaths15 === undefined ? '—' : g.deaths15)}
      ${cell('Écart or à 10 min', Stats.fmt(g.goldDiff10, 'diff'))}${cell('Écart XP à 10 min', Stats.fmt(g.xpDiff10, 'diff'))}${cell('Écart or à 15 min', Stats.fmt(g.goldDiff15, 'diff'))}
      ${cell('Vision', `${g.vision} <span class="muted small">(${Stats.fmt(M['Vision/min'](g), 'dec2')}/min)</span>`)}${cell('Wards posées / détruites', `${g.wardsPlaced ?? '—'} / ${g.wardsKilled ?? '—'}`)}${cell('Pinks', g.pinks ?? '—')}
      ${cell('Dégâts/min', Stats.fmt(M['Dégâts/min'](g), 'int'))}${cell('Or/min', Stats.fmt(M['Or/min'](g), 'int'))}${cell('LP', Stats.fmt(g.lpDelta, 'diff'))}
    </div>
    <h2>Suivi</h2>${suivi}`;
  $('#drawer').classList.remove('hidden');
  $('#drawer-back').classList.remove('hidden');
  hookImages();
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
  if (!p) return `<h1>Séances</h1><div class="empty">Aucune donnée pour l'instant.</div>`;
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
          <div><label>Devoirs et exercices</label><div class="note">${esc(s.homework) || '—'}</div></div></div>
        ${s.kpi ? `<label>${esc(s.kpi)}, partie par partie</label>${Charts.lineChart({ points: pts, target: s.target === '' || s.target === undefined ? null : Number(s.target), fmt: axisFmt(f), marker: gs.findIndex(g => g.date >= t), markerLabel: 'séance', targetLabel: 'cible' })}` : ''}
        ${canEdit() ? `<div class="actions"><button class="btn danger" data-action="delete-session" data-id="${s.id}">${icon('trash', 15)} Supprimer</button><button class="btn" data-action="edit-session" data-id="${s.id}">${icon('edit', 15)} Modifier</button></div>` : ''}</div>`;
    }
    const better = r.delta === null ? '' : (r.delta > 0) === (r.sens !== '≤') ? 'ok' : 'red';
    return `<div class="scard" data-action="toggle-session" data-id="${s.id}">
      <div class="head"><span class="num">#${n - i}</span><b>${esc(dateLong(s.date))}</b><span class="muted">${esc(s.axis || '')}${s.axis2 ? ' · ' + esc(s.axis2) : ''}</span><span class="spacer"></span>
        ${s.status ? `<span class="chip ${STATUT_CHIP[s.status] || ''}">${esc(s.status)}</span>` : ''}${icon(open ? 'chevronDown' : 'chevron', 16, 'faint')}</div>
      <div class="metrics">
        <div class="metric"><span>Indicateur suivi</span><b>${esc(s.kpi || '—')}</b></div>
        <div class="metric"><span>Cible</span><b>${s.target === '' || s.target === undefined ? '—' : Stats.fmt(Number(s.target), f)}</b></div>
        <div class="metric"><span>Avant → depuis</span><b>${Stats.fmt(r.before, f)} → ${Stats.fmt(r.after, f)}</b></div>
        <div class="metric"><span>Évolution</span><b class="${better}">${fmtDelta(r.delta, f)}</b></div>
      </div>${detail}</div>`;
  }).join('');
  return `<div class="row"><h1>Séances</h1><span class="spacer"></span>${canEdit() ? `<button class="btn primary" data-action="new-session">${icon('plus', 16)} Nouvelle séance</button>` : ''}</div>
    <div class="sub">Pour chaque séance : l'axe travaillé, un indicateur à suivre et une cible. L'app compare la moyenne avant et depuis la séance.</div>
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
    <div class="field"><label>Devoirs et exercices</label><textarea name="homework" rows="2">${esc(s.homework || '')}</textarea></div>
    <div class="grid2">
      <div class="field"><label>Indicateur suivi</label><select name="kpi"><option value="">—</option>${kpis.map(k => opt(k, s.kpi)).join('')}</select></div>
      <div class="field"><label>Cible (pourcentages en décimal : 0,55 = 55 %)</label><input name="target" type="number" step="any" value="${esc(s.target === undefined ? '' : s.target)}"></div>
    </div>
    <div class="actions"><button type="button" class="btn ghost" data-action="close-modal">Annuler</button><button type="submit" class="btn primary">Enregistrer</button></div>
  </form>`;
}

// ======================================================================== MES OBJECTIFS (joueur)
function pageObjectifs() {
  const d = D(), p = player();
  if (!p) return '<h1>Mes objectifs</h1><div class="empty">Aucune donnée.</div>';
  const gs = roleGames(p).slice(-20);
  const rows = Stats.kpiTable(d, p, '', gs);
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
      <div class="row small"><span class="muted">Code d'accès</span><span class="code">${shown ? esc(p.code || '—') : '••••'}</span>
        <button class="icon-btn" data-action="toggle-code" data-id="${p.id}" title="${shown ? 'Masquer' : 'Afficher'}">${icon(shown ? 'eyeOff' : 'eye', 15)}</button></div>
      ${p.status === 'error' ? `<div class="small red">${icon('alert', 13)} ${esc(p.statusText)}</div>` : ''}
      <div class="row" style="margin-top:auto">
        <button class="btn primary" data-action="open-player" data-id="${p.id}">${icon('dashboard', 15)} Tableau de bord</button>
        <button class="btn" data-action="player-settings" data-id="${p.id}">${icon('settings', 15)}</button>
        <button class="btn" data-action="edit-player" data-id="${p.id}">${icon('edit', 15)}</button>
      </div></div>`;
  }).join('');
  return `<h1>Joueurs</h1><div class="sub">Chaque joueur a son code à 4 chiffres pour ouvrir son espace dans l'app, sur son ordinateur.</div>
    <div class="players">${cards}<div class="pcard add" data-action="new-player">${icon('plus', 26)}<b>Ajouter un joueur</b></div></div>`;
}

function playerForm(p) {
  const isNew = !p;
  p = p || { region: 'euw', role: '' };
  return `<h1>${isNew ? 'Nouveau joueur' : 'Modifier le joueur'}</h1>
  <div class="muted">${isNew ? 'Ses parties classées au rôle choisi arrivent toutes seules. Ses objectifs se règlent ensuite dans Paramètres.' : esc(p.riotId)}</div>
  <form id="player-form"><input type="hidden" name="pid" value="${esc(p.id || '')}">
    <div class="grid2">
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
    <div class="section"><h3>${icon('key', 17)} Code d'accès</h3><div class="muted small">À donner au joueur : il ouvre uniquement son espace, en lecture seule, dans l'app installée chez lui.</div>
      <div class="row" style="margin-top:12px"><input id="pcode" inputmode="numeric" maxlength="4" value="${esc(p.code || '')}" style="width:150px;letter-spacing:.3em;font:800 18px Manrope">
        <button class="btn" data-action="gen-pcode">${icon('dice', 15)} Générer</button><button class="btn primary" data-action="save-pcode">Enregistrer le code</button></div></div>
    <div class="section"><h3>${icon('target', 17)} Objectifs</h3><div class="muted small">Pré-remplis avec les objectifs du rôle ${esc(p.role)}. Ceux que tu changes passent en vert : ils deviennent propres à ce joueur. Enregistré automatiquement.</div>
      ${groups}<div class="actions"><button class="btn ghost" data-action="reset-objectives">Revenir aux objectifs du rôle</button></div></div>
    <div class="section"><h3>${icon('dashboard', 17)} Cartes du tableau de bord</h3><div class="muted small">Les 8 indicateurs affichés en haut de son tableau de bord.</div>
      <div class="grid4">${[0, 1, 2, 3, 4, 5, 6, 7].map(i => `<div class="field"><label>Carte ${i + 1}</label><select data-change="card" data-i="${i}">${labels.map(l => opt(l, cards[i])).join('')}</select></div>`).join('')}</div></div>
    <div class="section"><h3>${icon('sessions', 17)} Axes de travail des séances</h3><div class="muted small">Un axe par ligne. Proposés dans ses séances.</div>
      <textarea id="paxes" rows="7" style="width:100%;margin-top:10px">${esc(settingsOf(p).axes.join('\n'))}</textarea>
      <div class="actions"><button class="btn primary" data-action="save-paxes">Enregistrer les axes</button></div></div>`;
}

function settingsGeneral() {
  const d = D(), s = d.settings, c = d.coach || {};
  const cl = c.cloud || {};
  const up = c.update || {};
  const upTxt = up.state === 'ready' ? `La version ${esc(up.version)} est prête : elle s'installera à la fermeture de l'app.`
    : up.state === 'downloading' ? `Téléchargement de la version ${esc(up.version)} en arrière-plan.`
      : up.state === 'error' ? `Dernière vérification impossible : ${esc(up.error)}`
        : up.state === 'uptodate' ? 'À jour.' : 'Vérification automatique au démarrage puis toutes les 4 heures.';
  const objRows = Object.entries(s.objectives).map(([k, o]) => `<tr><td class="l">${esc(k)}</td><td class="muted">${esc(o.sens)}</td>${ROLES.map(r => `<td><input type="number" step="any" style="width:84px" data-tobj="${esc(k)}" data-role="${r}" value="${o[r] === null || o[r] === undefined ? '' : o[r]}"></td>`).join('')}</tr>`).join('');
  return `
    <div class="section"><h3>${icon('crown', 17)} Code coach</h3><div class="muted small">Il ouvre tous les joueurs, ici et sur n'importe quel ordinateur où l'app est installée (en lecture seule ailleurs).</div>
      <div class="row" style="margin-top:12px"><span class="code">${state.showCodes.coach ? esc(c.coachCode) : '••••'}</span><button class="icon-btn" data-action="toggle-code" data-id="coach">${icon(state.showCodes.coach ? 'eyeOff' : 'eye', 15)}</button>
        <span class="spacer"></span><input id="ccode" class="codein" inputmode="numeric" maxlength="4" placeholder="Nouveau code" style="width:150px"><button class="btn" data-action="save-ccode">Changer</button></div></div>
    <div class="section"><h3>${icon('key', 17)} Clé API Riot</h3>
      <div class="status-line"><span class="dot ${c.hasKey ? 'on' : 'err'}"></span>${c.hasKey ? 'Clé enregistrée (' + esc(c.keyPreview) + '). Les parties arrivent automatiquement.' : 'Aucune clé : les parties ne peuvent pas être récupérées.'}</div>
      <div class="row" style="margin-top:12px"><input id="key" style="width:420px" placeholder="Remplacer la clé : RGAPI-…"><button class="btn" data-action="save-key">Tester et enregistrer</button></div></div>
    <div class="section"><h3>${icon('cloud', 17)} Serveur en ligne (espaces joueurs)</h3>
      ${cl.hasSecret
        ? `<div class="status-line"><span class="dot ${cl.lastError ? 'err' : 'on'}"></span>${cl.lastError ? 'Dernier envoi en échec : ' + esc(cl.lastError) : 'Relié. Dernier envoi ' + esc(ago(cl.lastPush)) + '.'}</div>`
        : `<div class="status-line"><span class="dot"></span>Pas encore relié : les joueurs ne peuvent pas encore ouvrir leur espace chez eux.</div>
           <ol class="steps"><li>Ouvre ton projet sur supabase.com › <b>Project Settings</b> › <b>API Keys</b>.</li><li>Dans « Secret keys », clique sur l'œil puis copie la clé (elle commence par <b>sb_secret_</b>).</li><li>Colle-la ci-dessous. Elle reste chiffrée sur cet ordinateur.</li></ol>`}
      <div class="row" style="margin-top:12px"><input id="csecret" type="password" style="width:420px" placeholder="${cl.hasSecret ? 'Remplacer la clé secrète' : 'sb_secret_…'}"><button class="btn ${cl.hasSecret ? '' : 'primary'}" data-action="save-secret">Relier</button></div></div>
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
    <div class="section"><h3>${icon('info', 17)} À propos</h3><div class="muted small">Version ${esc(d.appVersion)}. ${upTxt}</div></div>`;
}

const PAGES = { accueil: pageAccueil, dashboard: pageDashboard, parties: pageParties, seances: pageSeances, objectifs: pageObjectifs, joueurs: pageJoueurs, parametres: pageParametres };

// ======================================================================== modale
function openModal(html) { $('#modal-box').innerHTML = html; $('#modal').classList.remove('hidden'); hookImages(); }
function closeModal() { $('#modal').classList.add('hidden'); $('#modal-box').innerHTML = ''; }

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
    case 'new-session': openModal(sessionForm()); break;
    case 'edit-session': openModal(sessionForm(D().sessions.find(s => s.id === id))); break;
    case 'delete-session': if (confirm('Supprimer cette séance ?')) apply(await window.api.deleteSession(id), 'Séance supprimée.'); break;
    case 'new-player': openModal(playerForm()); break;
    case 'edit-player': openModal(playerForm(D().players.find(x => x.id === id))); break;
    case 'delete-player': if (confirm('Supprimer ce joueur, ses parties et ses séances ?')) { closeModal(); apply(await window.api.deletePlayer(id), 'Joueur supprimé.'); } break;
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
    case 'save-tobj': {
      const objectives = JSON.parse(JSON.stringify(D().settings.objectives));
      document.querySelectorAll('[data-tobj]').forEach(i => { objectives[i.dataset.tobj][i.dataset.role] = i.value === '' ? null : Number(i.value); });
      apply(await window.api.saveSettings({ objectives }), 'Objectifs par défaut enregistrés.');
      break;
    }
    case 'save-axes': apply(await window.api.saveSettings({ axes: $('#axes').value.split('\n').map(x => x.trim()).filter(Boolean) }), 'Axes par défaut enregistrés.'); break;
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
  if (formId === 'player-form') {
    const riotId = String(f.riotId || '').trim();
    if (!/^[^#]+#[^#]+$/.test(riotId)) return toast('Le pseudo doit être au format Nom#TAG.', 'err');
    if (f.code && !/^\d{4}$/.test(f.code)) return toast('Le code doit faire 4 chiffres.', 'err');
    const isNew = !f.pid;
    const p = { riotId, region: f.region, role: f.role, startDate: f.startDate, rankStart: f.rankStart, rankTarget: f.rankTarget, goal: f.goal };
    if (f.code) p.code = f.code;
    if (!isNew) p.id = f.pid;
    const r = await window.api.savePlayer(p);
    if (r && r.ok) {
      closeModal();
      state.playerId = r.id;
      if (isNew) { state.page = 'dashboard'; state.metric = null; }
      apply(r, isNew ? 'Joueur ajouté : ses parties arrivent dans un instant.' : 'Joueur enregistré.');
    } else toast(r ? r.message : 'Erreur', 'err', 5000);
  }
  if (formId === 'session-form') {
    const s = Object.assign({}, f, { playerId: state.playerId });
    s.id = f.sid || undefined;
    delete s.sid;
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
window.api.onData(d => {
  state.data = d;
  if (isTyping() || !$('#modal').classList.contains('hidden')) { state.pending = true; return; }
  render();
});

(async function init() {
  state.data = await window.api.getData();
  render();
  // décompte quand l'écran de code est bloqué après trop d'essais
  setInterval(async () => { if (D() && D().locked && D().blockedMs) { state.data = await window.api.getData(); renderLogin(); } }, 1000);
})();
