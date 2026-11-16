/* global Stats, Charts */
const ROLES = ['Top', 'Jungle', 'Mid', 'ADC', 'Support'];
const REGIONS = ['euw', 'eune', 'na', 'kr', 'br', 'jp', 'lan', 'las', 'oce', 'tr', 'ru', 'me', 'sg', 'tw', 'vn'];
const RANGS = ['Fer', 'Bronze', 'Argent', 'Or', 'Platine', 'Émeraude', 'Diamant', 'Maître', 'Grand Maître', 'Challenger'];
const STATUTS = ['À faire', 'En cours', 'Acquis', 'Abandonné'];
// Objectifs proposés sur la fiche joueur, regroupés par thème
const OBJ_GROUPS = [
  ['📈 Résultats', ['Taux de victoire', 'KDA', 'KP', 'Morts moyennes']],
  ['🌾 Farm & laning', ['CS/min', 'CS à 10 min', 'Or/min', 'Morts avant 15 min', 'Écart or à 10 min', 'Écart XP à 10 min', 'Écart or à 15 min']],
  ['👁️ Vision', ['Vision/min', 'Wards posées', 'Wards détruites', 'Pinks achetées']],
  ['⚔️ Combat & mental', ['Dégâts/min', 'Note mentale', '% objectifs de partie atteints', 'LP net']]
];
const OBJ_PERSO = OBJ_GROUPS.flatMap(g => g[1]);
const STATUS_CLASS = { 'Acquis': 'st-ok', 'En cours': 'st-run', 'À faire': 'st-todo', 'Abandonné': 'st-off' };
function fmtDelta(v, f) {
  if (v === null || v === undefined) return '—';
  if (f === 'pct') return (v > 0 ? '+' : '') + Math.round(v * 100) + ' pts';
  if (f === 'diff' || f === 'int') return (v > 0 ? '+' : '') + Math.round(v);
  return (v > 0 ? '+' : '') + v.toFixed(2).replace('.', ',');
}
const PCT_KEYS = new Set(['Taux de victoire', 'KP', '% objectifs de partie atteints']);

const state = { data: null, page: 'joueurs', playerId: localStorage.getItem('playerId') || null, since: '', sessionId: null, progress: null };
const $ = s => document.querySelector(s);
const esc = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const opt = (v, cur, label) => `<option value="${esc(v)}" ${String(v) === String(cur) ? 'selected' : ''}>${esc(label === undefined ? v : label)}</option>`;
const dateFr = t => (t ? new Date(t).toLocaleDateString('fr-FR') : '—');
const dateTimeFr = t => (t ? new Date(t).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const isoDay = t => (t ? new Date(t).toISOString().slice(0, 10) : '');
const icon = champ => {
  const v = state.data && state.data.settings.ddVersion;
  if (!v || !champ) return '';
  const key = String(champ).replace(/[ '.]/g, '').replace('FiddleSticks', 'Fiddlesticks');
  return `https://ddragon.leagueoflegends.com/cdn/${v}/img/champion/${key}.png`;
};
const player = () => state.data.players.find(p => p.id === state.playerId) || null;

function toast(msg, ms = 3500) {
  const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add('hidden'), ms);
}
function openModal(html) { $('#modal-box').innerHTML = html; $('#modal').classList.remove('hidden'); }
function closeModal() { $('#modal').classList.add('hidden'); $('#modal-box').innerHTML = ''; }

// ======================================================================== rendu général
function render() {
  if (!state.data) return;
  if (state.playerId && !player()) state.playerId = null;
  if (!state.playerId && state.data.players.length) state.playerId = state.data.players[0].id;
  document.querySelectorAll('.nav').forEach(b => b.classList.toggle('active', b.dataset.page === state.page));
  $('#app-version').textContent = 'Version ' + state.data.appVersion;
  const s = state.data.settings;
  $('#sync-status').textContent = state.progress ? state.progress.text : (s.lastSync ? 'Dernière synchro : ' + dateTimeFr(s.lastSync) : 'Jamais synchronisé');
  $('#btn-sync').disabled = !!state.progress;
  const pages = { joueurs: pageJoueurs, dashboard: pageDashboard, parties: pageParties, sessions: pageSessions, parametres: pageParametres };
  $('#page').innerHTML = pages[state.page]();
  document.querySelectorAll('img.ico, .form img').forEach(i => i.addEventListener('error', () => { i.style.visibility = 'hidden'; }, { once: true }));
}

function playerSelect() {
  if (!state.data.players.length) return '';
  return `<select data-change="player" style="min-width:220px;font-weight:700">${state.data.players.map(p => opt(p.id, state.playerId, p.riotId)).join('')}</select>`;
}

function keyBanner() {
  if (state.data.settings.hasKey) return '';
  return `<div class="banner">🔑 Pour récupérer les parties automatiquement, entre ta clé API Riot. <span class="spacer"></span><button class="btn" data-action="goto" data-page="parametres">Ajouter ma clé</button></div>`;
}

// ======================================================================== JOUEURS
function pageJoueurs() {
  const d = state.data;
  const cards = d.players.map(p => {
    const gs = Stats.playerGames(d, p);
    const rk = d.ranks.filter(r => r.playerId === p.id).sort((a, b) => b.date - a.date)[0];
    const ign = d.ignored.filter(g => g.playerId === p.id).length;
    return `<div class="pcard">
      <div class="row"><div class="name">${esc(p.riotId)}</div><span class="spacer"></span><span class="badge">${esc(p.role || '?')}</span><span class="badge">${esc((p.region || '').toUpperCase())}</span></div>
      <div class="rank">${rk ? esc(rk.label) : 'Rang non relevé'}</div>
      <div class="muted small">Départ : ${esc(p.rankStart || '?')} → visé : ${esc(p.rankTarget || '?')} · début ${dateFr(p.startDate)}</div>
      ${p.goal ? `<div class="small">🎯 ${esc(p.goal)}</div>` : ''}
      <div class="small">${gs.length} partie(s) SoloQ au rôle${ign ? ` · <span class="muted">${ign} ignorée(s)</span>` : ''}</div>
      <div class="small ${p.status === 'error' ? 'red' : 'muted'}">${p.lastSync ? 'Synchro ' + dateTimeFr(p.lastSync) + ' · ' : ''}${esc(p.statusText || 'Pas encore synchronisé')}</div>
      <div class="row" style="margin-top:6px">
        <button class="btn gold" data-action="open-dashboard" data-id="${p.id}">📊 Tableau de bord</button>
        <button class="btn" data-action="sync-one" data-id="${p.id}">🔄</button>
        <button class="btn" data-action="edit-player" data-id="${p.id}">✏️ Modifier</button>
        <a class="link small" data-action="ext" data-url="https://www.op.gg/lol/summoners/${esc(p.region)}/${esc(encodeURIComponent(String(p.riotId).replace('#', '-')))}">op.gg ↗</a>
        <a class="link small" data-action="ext" data-url="https://dpm.lol/${esc(encodeURIComponent(String(p.riotId).replace('#', '-')))}">DPM ↗</a>
      </div>
    </div>`;
  }).join('');
  return `<h1>👥 Joueurs coachés</h1>
    <div class="sub">Ajoute un joueur avec son pseudo Riot : ses parties SoloQ jouées au rôle coaché sont récupérées automatiquement.</div>
    ${keyBanner()}
    <div class="players">${cards}<div class="pcard add-card" data-action="new-player">＋ Ajouter un joueur</div></div>`;
}

// --- objectifs de la fiche joueur ---
function roleDefault(k, role) {
  const d = state.data.settings.objectives[k];
  return d && role && d[role] !== null && d[role] !== undefined ? d[role] : null;
}
function objToInput(k, v) {
  if (v === null || v === undefined || v === '') return '';
  return PCT_KEYS.has(k) ? Math.round(Number(v) * 1000) / 10 : Number(v);
}
function objFromInput(k, raw) {
  if (raw === null || raw === undefined || String(raw).trim() === '') return null;
  const n = Number(String(raw).replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  return PCT_KEYS.has(k) ? n / 100 : n;
}
const sameNum = (a, b) => a !== null && b !== null && Math.abs(a - b) < 1e-6;
function objField(k, p, o) {
  const d = state.data.settings.objectives[k];
  const sens = d ? d.sens : '≥';
  const custom = o[k] !== undefined && o[k] !== null && o[k] !== '';
  const def = roleDefault(k, p.role);
  const value = custom ? objToInput(k, o[k]) : objToInput(k, def);
  const ph = p.role ? (def === null ? 'aucun' : '') : 'rôle ?';
  return `<div class="field"><label>${esc(k)}${PCT_KEYS.has(k) ? ' (%)' : ''} <span class="sens">${sens === '≤' ? 'maxi' : 'mini'}</span></label>
    <input type="number" step="any" name="obj:${esc(k)}" data-obj-key="${esc(k)}" class="${custom ? 'custom' : ''}" value="${esc(value)}" placeholder="${ph}"></div>`;
}
function refreshObjectiveDefaults(form) {
  const role = form.querySelector('[name=role]').value;
  form.querySelectorAll('input[data-obj-key]').forEach(i => {
    if (i.classList.contains('custom')) return; // on garde ce que le coach a personnalisé
    const def = roleDefault(i.dataset.objKey, role);
    i.value = objToInput(i.dataset.objKey, def);
    i.placeholder = role ? (def === null ? 'aucun' : '') : 'rôle ?';
  });
  const hint = $('#obj-hint');
  if (hint) hint.textContent = role ? `Pré-remplis avec les objectifs du rôle ${role}. Change ceux que tu veux adapter à ce joueur (en doré = personnalisé).` : 'Choisis le rôle coaché : les objectifs du rôle se rempliront automatiquement.';
}
function markObjectiveInput(i) {
  const form = i.closest('form');
  const role = form.querySelector('[name=role]').value;
  const v = objFromInput(i.dataset.objKey, i.value);
  i.classList.toggle('custom', v !== null && !sameNum(v, roleDefault(i.dataset.objKey, role)));
}

function playerForm(p) {
  p = p || { region: 'euw', role: '', objectives: {} };
  const o = p.objectives || {};
  return `<h1>${p.id ? '✏️ Modifier le joueur' : '＋ Nouveau joueur'}</h1>
  <form id="player-form">
    <input type="hidden" name="id" value="${esc(p.id || '')}">
    <div class="grid2">
      <div class="field"><label>Pseudo Riot (Nom#TAG) *</label><input name="riotId" required placeholder="ex. Faker#KR1" value="${esc(p.riotId || '')}"></div>
      <div class="grid2">
        <div class="field"><label>Région *</label><select name="region">${REGIONS.map(r => opt(r, p.region, r.toUpperCase())).join('')}</select></div>
        <div class="field"><label>Rôle coaché *</label><select name="role" required><option value="">—</option>${ROLES.map(r => opt(r, p.role)).join('')}</select></div>
      </div>
    </div>
    <div class="grid3">
      <div class="field"><label>Date de début</label><input type="date" name="startDate" value="${esc(p.startDate || '')}"></div>
      <div class="field"><label>Rang de départ</label><select name="rankStart"><option value="">—</option>${RANGS.map(r => opt(r, p.rankStart)).join('')}</select></div>
      <div class="field"><label>Rang visé</label><select name="rankTarget"><option value="">—</option>${RANGS.map(r => opt(r, p.rankTarget)).join('')}</select></div>
    </div>
    <div class="field"><label>Objectif du coaching</label><input name="goal" value="${esc(p.goal || '')}" placeholder="ex. Stabiliser le laning et passer Diamant"></div>
    <h2>🎯 Objectifs du joueur</h2>
    <div class="muted small" id="obj-hint">${p.role ? `Pré-remplis avec les objectifs du rôle ${esc(p.role)}. Change ceux que tu veux adapter à ce joueur (en doré = personnalisé).` : 'Choisis le rôle coaché : les objectifs du rôle se rempliront automatiquement, tu pourras ensuite les adapter.'}</div>
    ${OBJ_GROUPS.map(([title, keys]) => `<div class="obj-group"><div class="obj-title">${title}</div><div class="grid4">${keys.map(k => objField(k, p, o)).join('')}</div></div>`).join('')}
    <div class="actions">
      ${p.id ? `<button type="button" class="btn danger" data-action="delete-player" data-id="${p.id}">Supprimer</button><span class="spacer"></span>` : ''}
      <button type="button" class="btn" data-action="close-modal">Annuler</button>
      <button type="submit" class="btn gold">Enregistrer${p.id ? '' : ' et synchroniser'}</button>
    </div>
  </form>`;
}

async function submitPlayer(form) {
  const f = new FormData(form);
  const riotId = String(f.get('riotId')).trim();
  if (!/^[^#]+#[^#]+$/.test(riotId)) { toast('Le pseudo doit être au format Nom#TAG'); return; }
  if (!f.get('role')) { toast('Choisis le rôle coaché'); return; }
  // on n'enregistre que les objectifs différents de ceux du rôle (les autres suivent les réglages du rôle)
  const objectives = {};
  for (const k of OBJ_PERSO) {
    const v = objFromInput(k, f.get('obj:' + k));
    if (v !== null && !sameNum(v, roleDefault(k, f.get('role')))) objectives[k] = v;
  }
  const p = { id: f.get('id') || undefined, riotId, region: f.get('region'), role: f.get('role'), startDate: f.get('startDate'),
    rankStart: f.get('rankStart'), rankTarget: f.get('rankTarget'), goal: f.get('goal'), objectives };
  const isNew = !p.id;
  state.data = await window.api.savePlayer(p);
  closeModal();
  if (isNew) {
    const np = state.data.players[state.data.players.length - 1];
    state.playerId = np.id;
    render();
    if (state.data.settings.hasKey) runSync([np.id]);
  } else render();
}

// ======================================================================== TABLEAU DE BORD
function pageDashboard() {
  const d = state.data, p = player();
  if (!p) return `<h1>📊 Tableau de bord</h1><div class="empty">Ajoute d'abord un joueur dans l'onglet Joueurs.</div>`;
  const rows = Stats.kpiTable(d, p, state.since);
  const byLabel = Object.fromEntries(rows.map(r => [r.label, r]));
  const gs = Stats.playerGames(d, p, state.since);
  const allRole = Stats.playerGames(d, p, '1970-01-01');
  const ranks = d.ranks.filter(r => r.playerId === p.id).sort((a, b) => a.date - b.date);
  const rk = ranks[ranks.length - 1];
  const ign = d.ignored.filter(g => g.playerId === p.id).length;

  const bar = r => (r.progress === null ? '' : `<span class="bar ${r.ok === false ? 'warn' : ''}">${'█'.repeat(r.progress)}${'░'.repeat(10 - r.progress)}</span>`);
  const cards = d.settings.cards.map((lab, i) => {
    const r = byLabel[lab] || rows[1];
    return `<div class="kcard">
      <select data-change="card" data-i="${i}">${rows.map(x => opt(x.label, r.label)).join('')}</select>
      <div class="val ${r.ok === false ? 'warn' : ''}">${Stats.fmt(r.value, r.format)}</div>
      <div class="obj">${r.obj.value === null ? 'Pas d\'objectif fixé' : `Objectif ${r.obj.sens} ${Stats.fmt(r.obj.value, r.format)}${r.obj.custom ? ' (perso)' : ''} ${r.ok ? '✅' : '⚠️'}`}</div>
      <div>${bar(r)}</div></div>`;
  }).join('');

  const last10 = allRole.slice(-10);
  const form = last10.length ? `<div class="form">${last10.map(g => `<div class="g"><img src="${icon(g.champion)}" alt=""><div class="r ${g.win ? 'V' : 'D'}">${g.win ? 'V' : 'D'}</div><div class="c">${esc(g.champion)}</div></div>`).join('')}</div>` : '<div class="muted">Aucune partie au rôle pour l\'instant.</div>';

  const table = rows.map(r => `<tr>
      <td class="l"><b>${esc(r.label)}</b></td><td><b>${Stats.fmt(r.value, r.format)}</b></td>
      <td class="${r.obj.custom ? 'custom' : 'muted'}">${r.obj.value === null ? '' : Stats.fmt(r.obj.value, r.format)}</td>
      <td class="muted">${r.obj.value === null ? '' : r.obj.sens}</td>
      <td class="${r.ok === null ? '' : r.ok ? 'ok' : 'ko'}">${r.ok === null ? '' : r.ok ? '✅ Atteint' : '⚠️ À travailler'}</td>
      <td class="l">${bar(r)}</td><td>${r.label === 'Parties jouées' ? r.v10 : Stats.fmt(r.v10, r.format)}</td>
      <td class="${r.trend === 1 ? 'ok' : r.trend === -1 ? 'red' : 'muted'}">${r.trend === 1 ? '▲' : r.trend === -1 ? '▼' : r.trend === 0 ? '■' : ''}</td>
      <td>${Charts.sparkline(r.series)}</td></tr>`).join('');

  const pool = Stats.groupBy(gs, 'champion').slice(0, 10);
  const mu = Stats.groupBy(gs, 'opponent').slice(0, 8);
  const groupTable = (list, title) => list.length ? `<table><tr><th class="l">${title}</th><th>Parties</th><th>Bilan</th><th>Victoire %</th><th>KDA</th><th>CS/min</th><th>KP</th><th>Écart or 15</th><th>Morts &lt;15</th></tr>
      ${list.map(c => `<tr><td class="l"><img class="ico" src="${icon(c.name)}" alt="">${esc(c.name)}</td><td>${c.games}</td><td class="muted">${c.wins}V - ${c.games - c.wins}D</td>
      <td class="${c.winrate >= 0.55 ? 'ok' : c.winrate < 0.45 ? 'red' : ''}">${Stats.fmt(c.winrate, 'pct')}</td><td>${Stats.fmt(c.kda, 'dec2')}</td><td>${Stats.fmt(c.csmin, 'dec2')}</td>
      <td>${Stats.fmt(c.kp, 'pct')}</td><td>${Stats.fmt(c.gd15, 'diff')}</td><td>${Stats.fmt(c.d15, 'dec1')}</td></tr>`).join('')}</table>` : '<div class="muted">—</div>';

  const last20 = allRole.slice(-20);
  const labels = last20.map((g, i) => String(allRole.length - last20.length + i + 1));
  const ch = (title, metric, color, fmtF, objLabel) => {
    const o = objLabel ? Stats.objectiveFor(d, p, objLabel).value : null;
    return `<div class="chart"><h3>${title}</h3>${Charts.lineChart({ series: [{ values: last20.map(Stats.METRICS[metric]), color }], labels, target: o, fmt: fmtF })}</div>`;
  };
  const f2 = v => v.toFixed(2).replace('.', ','), fp = v => Math.round(v * 100) + '%', fi = v => Math.round(v).toString();
  const rankChart = ranks.length ? `<div class="chart"><h3>Progression du rang (score classé)</h3>${Charts.lineChart({ series: [{ values: ranks.slice(-15).map(r => r.score), color: '#C8AA6E' }], labels: ranks.slice(-15).map(r => dateFr(r.date).slice(0, 5)), fmt: fi })}<div class="muted tiny">Score = palier × 400 + division × 100 + LP (Maître = 2 800 + LP)</div></div>` : '';

  const games20 = [...last20].reverse().map(g => `<tr><td>${dateFr(g.date)}</td><td class="l"><img class="ico" src="${icon(g.champion)}" alt="">${esc(g.champion)}</td><td class="muted">${esc(g.opponent)}</td>
      <td class="${g.win ? 'ok' : 'red'}">${g.win ? 'V' : 'D'}</td><td>${g.kills}/${g.deaths}/${g.assists}</td><td>${Stats.fmt(Stats.METRICS.KP(g), 'pct')}</td>
      <td>${Stats.fmt(Stats.METRICS['CS/min'](g), 'dec2')}</td><td>${Stats.fmt(Stats.METRICS['Vision/min'](g), 'dec2')}</td><td>${Stats.fmt(g.goldDiff15, 'diff')}</td>
      <td>${g.deaths15 === null ? '—' : g.deaths15}</td><td class="${g.lpDelta > 0 ? 'ok' : g.lpDelta < 0 ? 'red' : 'muted'}">${Stats.fmt(g.lpDelta, 'diff')}</td><td>${g.duration}</td></tr>`).join('');

  return `<div class="row"><h1>⚔️ ${esc(p.riotId.toUpperCase())}</h1><span class="spacer"></span>${playerSelect()}
      <label style="margin:0 0 0 8px">Depuis le</label><input type="date" data-change="since" value="${esc(state.since)}">
      <button class="btn" data-action="sync-one" data-id="${p.id}">🔄 Synchroniser</button></div>
    <div class="sub">${esc(p.role)} · SoloQ uniquement · Rang actuel : <b class="gold">${rk ? esc(rk.label) : 'non relevé'}</b> · Départ ${esc(p.rankStart || '?')} → visé ${esc(p.rankTarget || '?')} · ${gs.length} partie(s) prise(s) en compte${ign ? ` · ${ign} hors rôle ignorée(s)` : ''}${p.goal ? ` · 🎯 ${esc(p.goal)}` : ''}</div>
    ${keyBanner()}
    <div class="cards">${cards}</div>
    <div class="muted tiny" style="margin-top:4px">Clique sur le titre d'une carte pour choisir l'indicateur affiché.</div>
    <h2>Forme récente · 10 dernières parties au rôle</h2>${form}
    <h2>Objectifs & indicateurs</h2>
    <table><tr><th class="l">Indicateur</th><th>Valeur</th><th>Objectif</th><th>Sens</th><th>Statut</th><th class="l">Progression</th><th>10 dern.</th><th>Tendance</th><th>Évolution</th></tr>${table}</table>
    <div class="muted tiny">Objectif en doré = objectif personnalisé du joueur.</div>
    <h2>Graphiques · 20 dernières parties</h2>
    <div class="charts">
      ${ch('CS/min', 'CS/min', '#C8AA6E', f2, 'CS/min')}
      ${ch('KDA', 'KDA', '#0AC8B9', f2, 'KDA')}
      ${ch('Kill participation', 'KP', '#C8AA6E', fp, 'KP')}
      ${ch('Vision/min', 'Vision/min', '#0AC8B9', f2, 'Vision/min')}
      ${ch('Écart d\'or à 15 min', 'Écart or à 15 min', '#C8AA6E', fi, 'Écart or à 15 min')}
      ${ch('Morts avant 15 min', 'Morts avant 15 min', '#E84057', fi, 'Morts avant 15 min')}
      ${rankChart}
    </div>
    <div class="two"><div><h2>Champion pool</h2>${groupTable(pool, 'Champion')}</div><div><h2>Matchups (adversaires directs)</h2>${groupTable(mu, 'Adversaire')}</div></div>
    <h2>20 dernières parties au rôle</h2>
    ${games20 ? `<table><tr><th>Date</th><th class="l">Champion</th><th>Contre</th><th>Rés.</th><th>K/D/A</th><th>KP</th><th>CS/min</th><th>Vision/min</th><th>Écart or 15</th><th>Morts&lt;15</th><th>LP</th><th>Durée</th></tr>${games20}</table>` : '<div class="empty">Aucune partie pour l\'instant. Lance une synchronisation.</div>'}`;
}

// ======================================================================== PARTIES
function pageParties() {
  const d = state.data, p = player();
  if (!p) return `<h1>🎮 Parties</h1><div class="empty">Ajoute d'abord un joueur.</div>`;
  const gs = d.games.filter(g => g.playerId === p.id).sort((a, b) => b.date - a.date);
  const rows = gs.map(g => {
    const counted = g.role === p.role;
    return `<tr class="editable"><td>${dateTimeFr(g.date)}</td><td class="l"><img class="ico" src="${icon(g.champion)}" alt="">${esc(g.champion)}</td><td class="muted">${esc(g.opponent)}</td>
      <td>${esc(g.role)}</td><td class="${g.win ? 'ok' : 'red'}">${g.win ? 'V' : 'D'}</td><td>${g.kills}/${g.deaths}/${g.assists}</td><td>${g.cs}</td><td>${g.vision}</td><td>${Stats.fmt(g.goldDiff15, 'diff')}</td>
      <td><input type="number" style="width:60px" data-game="${esc(g.matchId)}" data-field="lpDelta" value="${g.lpDelta === null || g.lpDelta === undefined ? '' : g.lpDelta}"></td>
      <td><select data-game="${esc(g.matchId)}" data-field="mental"><option value="">—</option>${[1, 2, 3, 4, 5].map(n => opt(n, g.mental)).join('')}</select></td>
      <td><select data-game="${esc(g.matchId)}" data-field="objectiveMet">${opt('', g.objectiveMet === null || g.objectiveMet === undefined ? '' : 'x', '—')}${opt('1', g.objectiveMet === true ? '1' : '', 'Oui')}${opt('0', g.objectiveMet === false ? '0' : '', 'Non')}</select></td>
      <td style="min-width:200px"><input class="cm" data-game="${esc(g.matchId)}" data-field="comment" value="${esc(g.comment)}" placeholder="Commentaire…"></td>
      <td>${counted ? '<span class="ok">✅</span>' : '<span class="muted">hors rôle</span>'}</td>
      <td><button class="btn danger" style="padding:3px 7px" data-action="delete-game" data-id="${esc(g.matchId)}">✕</button></td></tr>`;
  }).join('');
  return `<div class="row"><h1>🎮 Parties</h1><span class="spacer"></span>${playerSelect()}<button class="btn" data-action="sync-one" data-id="${p.id}">🔄 Synchroniser</button></div>
    <div class="sub">Parties SoloQ récupérées automatiquement. Tu peux ajouter la note mentale, l'objectif de la partie, un commentaire et les LP (enregistrés automatiquement).</div>
    ${keyBanner()}
    ${rows ? `<table><tr><th>Date</th><th class="l">Champion</th><th>Contre</th><th>Rôle</th><th>Rés.</th><th>K/D/A</th><th>CS</th><th>Vision</th><th>Écart or 15</th><th>LP</th><th>Mental</th><th>Objectif</th><th class="l">Commentaire</th><th>Comptée</th><th></th></tr>${rows}</table>` : '<div class="empty">Aucune partie pour l\'instant.</div>'}`;
}

// ======================================================================== SESSIONS
function pageSessions() {
  const d = state.data, p = player();
  if (!p) return `<h1>📝 Sessions</h1><div class="empty">Ajoute d'abord un joueur.</div>`;
  const list = d.sessions.filter(s => s.playerId === p.id).sort((a, b) => new Date(a.date) - new Date(b.date));
  const cards = list.map((s, i) => {
    const r = Stats.sessionResult(d, s, p);
    const f = Stats.METRIC_FMT[s.kpi] || 'dec2';
    const open = state.sessionId === s.id;
    let detail = '';
    if (open) {
      const gs = Stats.playerGames(d, p, '1970-01-01').slice(-30);
      const t = new Date(s.date).getTime();
      const mk = gs.findIndex(g => g.date >= t);
      const fmtF = f === 'pct' ? (v => Math.round(v * 100) + '%') : f === 'diff' || f === 'int' ? (v => Math.round(v).toString()) : (v => v.toFixed(2).replace('.', ','));
      detail = `<div class="grid3" style="margin-top:10px">
        <div><label>Points abordés</label><div>${esc(s.points) || '—'}</div></div>
        <div><label>Constats</label><div>${esc(s.findings) || '—'}</div></div>
        <div><label>Devoirs / exercices</label><div>${esc(s.homework) || '—'}</div></div></div>
        <div class="chart" style="margin-top:12px"><h3>${esc(s.kpi || 'KPI')} partie par partie (30 dernières)</h3>${s.kpi ? Charts.lineChart({ series: [{ values: gs.map(Stats.METRICS[s.kpi]), color: '#0AC8B9' }], labels: gs.map(g => dateFr(g.date).slice(0, 5)), target: s.target === '' ? null : Number(s.target), marker: mk, fmt: fmtF }) : ''}</div>
        <div class="actions"><button class="btn danger" data-action="delete-session" data-id="${s.id}">Supprimer</button><button class="btn" data-action="edit-session" data-id="${s.id}">✏️ Modifier</button></div>`;
    }
    return `<div class="scard" data-action="toggle-session" data-id="${s.id}">
      <div class="head"><span class="num">#${i + 1}</span><b>${dateFr(s.date)}</b><span>${esc(s.axis)}</span><span class="spacer"></span><span class="pill ${STATUS_CLASS[s.status] || ''}">${esc(s.status || '')}</span></div>
      ${s.axis2 ? `<div class="muted small">+ ${esc(s.axis2)}</div>` : ''}
      <div class="metrics">
        <div class="metric"><span>KPI suivi</span><b>${esc(s.kpi || '—')}</b></div>
        <div class="metric"><span>Cible</span><b>${s.target === '' || s.target === undefined ? '—' : Stats.fmt(Number(s.target), f)}</b></div>
        <div class="metric"><span>Avant → depuis</span><b>${Stats.fmt(r.before, f)} → ${Stats.fmt(r.after, f)}</b></div>
        <div class="metric"><span>Évolution</span><b class="${r.delta === null ? '' : (r.delta > 0) === (r.sens !== '≤') ? 'ok' : 'red'}">${fmtDelta(r.delta, f)} ${r.ok === null ? '' : r.ok ? '✅' : '❌'}</b></div>
      </div>${detail}</div>`;
  }).join('');
  return `<div class="row"><h1>📝 Sessions</h1><span class="spacer"></span>${playerSelect()}<button class="btn gold" data-action="new-session">＋ Nouvelle session</button></div>
    <div class="sub">Pour chaque session, choisis un KPI suivi et une cible : l'appli compare automatiquement la moyenne avant et depuis la session. Clique sur une session pour voir le détail et la courbe.</div>
    ${cards || '<div class="empty">Aucune session pour ce joueur.</div>'}`;
}

function sessionForm(s) {
  const d = state.data;
  s = s || { date: isoDay(Date.now()), status: 'En cours' };
  const kpis = Object.keys(Stats.METRICS);
  return `<h1>${s.id ? '✏️ Modifier la session' : '＋ Nouvelle session'}</h1>
  <form id="session-form"><input type="hidden" name="id" value="${esc(s.id || '')}">
    <div class="grid3">
      <div class="field"><label>Date *</label><input type="date" name="date" required value="${esc(s.date)}"></div>
      <div class="field"><label>Statut</label><select name="status">${STATUTS.map(x => opt(x, s.status)).join('')}</select></div>
      <div class="field"><label>Prochaine session</label><input type="date" name="next" value="${esc(s.next || '')}"></div>
    </div>
    <div class="grid2">
      <div class="field"><label>Axe principal</label><select name="axis">${d.settings.axes.map(a => opt(a, s.axis)).join('')}</select></div>
      <div class="field"><label>Axe secondaire</label><select name="axis2"><option value="">—</option>${d.settings.axes.map(a => opt(a, s.axis2)).join('')}</select></div>
    </div>
    <div class="field"><label>Points abordés</label><textarea name="points" rows="2">${esc(s.points || '')}</textarea></div>
    <div class="field"><label>Constats</label><textarea name="findings" rows="2">${esc(s.findings || '')}</textarea></div>
    <div class="field"><label>Devoirs / exercices</label><textarea name="homework" rows="2">${esc(s.homework || '')}</textarea></div>
    <div class="grid2">
      <div class="field"><label>KPI suivi</label><select name="kpi"><option value="">—</option>${kpis.map(k => opt(k, s.kpi)).join('')}</select></div>
      <div class="field"><label>Valeur cible (pourcentages en décimal : 0,55 = 55 %)</label><input name="target" type="number" step="any" value="${esc(s.target === undefined ? '' : s.target)}"></div>
    </div>
    <div class="actions"><button type="button" class="btn" data-action="close-modal">Annuler</button><button type="submit" class="btn gold">Enregistrer</button></div>
  </form>`;
}

// ======================================================================== PARAMÈTRES
function pageParametres() {
  const s = state.data.settings;
  const objRows = Object.entries(s.objectives).map(([k, o]) => `<tr><td class="l">${esc(k)}</td><td>${esc(o.sens)}</td>${ROLES.map(r => `<td><input type="number" step="any" style="width:80px" data-obj="${esc(k)}" data-role="${r}" value="${o[r] === null || o[r] === undefined ? '' : o[r]}"></td>`).join('')}</tr>`).join('');
  return `<h1>⚙️ Paramètres</h1>
    <h2>Clé API Riot</h2>
    <div class="help">La clé permet à l'appli de récupérer les parties toute seule. Elle reste sur ton ordinateur (chiffrée).
      <ol class="steps"><li>Va sur <a class="link" data-action="ext" data-url="https://developer.riotgames.com">developer.riotgames.com</a> et connecte-toi avec ton compte Riot.</li>
      <li>Copie la <b>Development API Key</b> (RGAPI-…) et colle-la ci-dessous. Elle expire toutes les 24 h.</li>
      <li>Pour ne plus la changer : « Register Product » › <b>Personal API Key</b> (usage privé, validée par Riot en quelques jours).</li></ol></div>
    <div class="row" style="margin-top:10px"><input id="key" style="width:420px" placeholder="RGAPI-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"><button class="btn gold" data-action="save-key">Tester et enregistrer</button>
      <span class="${s.hasKey ? 'ok' : 'muted'}">${s.hasKey ? '✅ Clé enregistrée : ' + esc(s.keyPreview) : 'Aucune clé'}</span></div>
    <h2>Synchronisation</h2>
    <div class="row"><label style="margin:0">Synchro automatique</label>
      <select data-setting="autoSyncMinutes">${[[0, 'Désactivée'], [15, 'Toutes les 15 min'], [30, 'Toutes les 30 min'], [60, 'Toutes les heures'], [180, 'Toutes les 3 h']].map(([v, l]) => opt(v, s.autoSyncMinutes, l)).join('')}</select>
      <label style="margin:0 0 0 16px">Parties max par joueur et par synchro</label>
      <select data-setting="maxGamesPerSync">${[10, 20, 30, 50, 100].map(v => opt(v, s.maxGamesPerSync)).join('')}</select></div>
    <div class="muted small" style="margin-top:6px">La synchro tourne tant que l'appli est ouverte, et au démarrage. Seules les parties SoloQ jouées au rôle coaché sont gardées.</div>
    <h2>Objectifs par défaut selon le rôle</h2>
    <div class="muted small">Pourcentages en décimal (0,55 = 55 %). Un objectif personnalisé sur la fiche d'un joueur remplace ces valeurs.</div>
    <table><tr><th class="l">Indicateur</th><th>Sens</th>${ROLES.map(r => `<th>${r}</th>`).join('')}</tr>${objRows}</table>
    <div class="actions"><button class="btn gold" data-action="save-objectives">Enregistrer les objectifs</button></div>
    <h2>Axes de travail (sessions)</h2>
    <textarea id="axes" rows="8" style="width:100%">${esc(s.axes.join('\n'))}</textarea>
    <div class="actions"><button class="btn gold" data-action="save-axes">Enregistrer les axes</button></div>
    <h2>Sauvegarde</h2>
    <div class="row"><button class="btn" data-action="export">💾 Exporter une sauvegarde</button><button class="btn" data-action="import">📂 Restaurer une sauvegarde</button></div>
    <h2>Application</h2>
    <div class="row"><span>Version ${esc(state.data.appVersion)}</span><button class="btn" data-action="check-updates">Rechercher une mise à jour</button></div>`;
}

// ======================================================================== actions
async function runSync(ids) {
  if (!state.data.settings.hasKey) { toast('Ajoute ta clé API Riot dans Paramètres.'); state.page = 'parametres'; render(); return; }
  state.progress = { text: 'Synchronisation…' }; render();
  const r = await window.api.sync(ids);
  state.progress = null;
  state.data = await window.api.getData();
  render();
  toast(r.message);
}

document.addEventListener('click', async e => {
  const nav = e.target.closest('.nav');
  if (nav) { state.page = nav.dataset.page; state.sessionId = null; render(); return; }
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const a = el.dataset.action, id = el.dataset.id;
  if (a !== 'toggle-session' && el.tagName !== 'SELECT' && el.tagName !== 'INPUT') e.preventDefault();
  switch (a) {
    case 'goto': state.page = el.dataset.page; render(); break;
    case 'ext': window.api.openExternal(el.dataset.url); break;
    case 'new-player': openModal(playerForm()); break;
    case 'edit-player': openModal(playerForm(state.data.players.find(p => p.id === id))); break;
    case 'delete-player':
      if (confirm('Supprimer ce joueur et toutes ses parties et sessions ?')) { state.data = await window.api.deletePlayer(id); closeModal(); render(); }
      break;
    case 'close-modal': closeModal(); break;
    case 'open-dashboard': state.playerId = id; localStorage.setItem('playerId', id); state.page = 'dashboard'; render(); break;
    case 'sync-one': runSync([id]); break;
    case 'delete-game':
      if (confirm('Retirer cette partie ? Elle ne sera plus réimportée.')) { state.data = await window.api.deleteGame(id, state.playerId); render(); }
      break;
    case 'new-session': openModal(sessionForm()); break;
    case 'edit-session': e.stopPropagation(); openModal(sessionForm(state.data.sessions.find(s => s.id === id))); break;
    case 'delete-session':
      e.stopPropagation();
      if (confirm('Supprimer cette session ?')) { state.data = await window.api.deleteSession(id); render(); }
      break;
    case 'toggle-session':
      if (e.target.closest('button')) return;
      state.sessionId = state.sessionId === id ? null : id; render(); break;
    case 'save-key': {
      const r = await window.api.saveKey($('#key').value);
      toast(r.message);
      if (r.ok) { state.data = r.data; render(); if (state.data.players.length) runSync(); }
      break;
    }
    case 'save-objectives': {
      const objectives = JSON.parse(JSON.stringify(state.data.settings.objectives));
      document.querySelectorAll('[data-obj]').forEach(i => { objectives[i.dataset.obj][i.dataset.role] = i.value === '' ? null : Number(i.value); });
      state.data = await window.api.saveSettings({ objectives }); toast('Objectifs enregistrés.'); render(); break;
    }
    case 'save-axes': {
      const axes = $('#axes').value.split('\n').map(x => x.trim()).filter(Boolean);
      state.data = await window.api.saveSettings({ axes }); toast('Axes enregistrés.'); render(); break;
    }
    case 'export': { const r = await window.api.exportBackup(); if (r.message) toast(r.message); break; }
    case 'import': { const r = await window.api.importBackup(); if (r.message) toast(r.message); if (r.data) { state.data = r.data; render(); } break; }
    case 'check-updates': { const r = await window.api.checkUpdates(); toast(r.message, 5000); break; }
    case 'install-update': window.api.installUpdate(); break;
  }
});

document.addEventListener('input', e => {
  if (e.target.dataset && e.target.dataset.objKey) markObjectiveInput(e.target);
});

document.addEventListener('change', async e => {
  const el = e.target;
  if (el.name === 'role' && el.closest('#player-form')) { refreshObjectiveDefaults(el.closest('#player-form')); return; }
  if (el.dataset.change === 'player') { state.playerId = el.value; localStorage.setItem('playerId', el.value); state.sessionId = null; render(); }
  else if (el.dataset.change === 'since') { state.since = el.value; render(); }
  else if (el.dataset.change === 'card') {
    const cards = state.data.settings.cards.slice(); cards[Number(el.dataset.i)] = el.value;
    state.data = await window.api.saveSettings({ cards }); render();
  } else if (el.dataset.setting) {
    state.data = await window.api.saveSettings({ [el.dataset.setting]: Number(el.value) }); toast('Réglage enregistré.');
  } else if (el.dataset.game) {
    const f = el.dataset.field;
    let v = el.value;
    if (f === 'mental' || f === 'lpDelta') v = v === '' ? null : Number(v);
    if (f === 'objectiveMet') v = v === '' ? null : v === '1';
    state.data = await window.api.updateGame(el.dataset.game, state.playerId, { [f]: v });
  }
});

document.addEventListener('submit', async e => {
  e.preventDefault();
  // getAttribute : un champ nommé « id » dans le formulaire masquerait form.id
  const formId = e.target.getAttribute('id');
  if (formId === 'player-form') submitPlayer(e.target);
  if (formId === 'session-form') {
    const f = new FormData(e.target);
    const s = Object.fromEntries(f.entries());
    if (!s.id) delete s.id;
    s.playerId = state.playerId;
    s.target = s.target === '' ? '' : Number(s.target);
    state.data = await window.api.saveSession(s);
    closeModal(); render();
  }
});

$('#btn-sync').addEventListener('click', () => runSync());
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });

window.api.onProgress(v => { state.progress = v; $('#sync-status').textContent = v ? v.text : ''; $('#btn-sync').disabled = !!v; });
window.api.onData(d => {
  state.data = d;
  // ne pas re-rendre pendant une saisie dans la page
  const typing = document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) && $('#modal').classList.contains('hidden');
  if (!typing && $('#modal').classList.contains('hidden')) render();
});
window.api.onUpdate(u => {
  const b = $('#update-banner');
  if (u.status === 'ready') b.innerHTML = `🎉 La version ${esc(u.version)} est prête. <span class="spacer"></span><button class="btn" data-action="install-update">Redémarrer pour l'installer</button>`;
  else if (u.status === 'manual') b.innerHTML = `⬆️ La version ${esc(u.version)} est disponible. <span class="spacer"></span><button class="btn" data-action="ext" data-url="${esc(u.url)}">Télécharger</button>`;
  else return;
  b.classList.remove('hidden');
});

(async function init() {
  state.data = await window.api.getData();
  if (state.data.players.length) state.page = 'joueurs';
  render();
})();
