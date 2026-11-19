// Moments clés d'une partie, tirés de match-v5 + timeline (les mêmes données que la synchro télécharge déjà) :
// morts (avec le contexte), kills, objectifs, retours à la base, niveau 6, lane à 10/15 min, vision, et les
// positions des 10 joueurs minute par minute pour la mini-carte. Tout est pur : voir tests/moments.js.
const POSTES = { TOP: 'Top', JUNGLE: 'Jungle', MIDDLE: 'Mid', BOTTOM: 'ADC', UTILITY: 'Support' };
const LANE_OF = { TOP: 'TOP_LANE', MIDDLE: 'MID_LANE', BOTTOM: 'BOT_LANE', UTILITY: 'BOT_LANE' };
const MONSTERS = { DRAGON: 'Dragon', BARON_NASHOR: 'Nashor', RIFTHERALD: 'Héraut', HORDE: 'Larves du Néant', ATAKHAN: 'Atakhan' };
const DRAKES = { FIRE_DRAGON: 'infernal', WATER_DRAGON: 'océan', EARTH_DRAGON: 'montagne', AIR_DRAGON: 'nuage', HEXTECH_DRAGON: 'hextech', CHEMTECH_DRAGON: 'chemtech', ELDER_DRAGON: 'ancestral' };
const NEAR = 2200; // distance « à côté » (unités de la carte, ≈ une portée de Téléportation courte)

const mmss = ms => { const s = Math.max(0, Math.round(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

// Zone de la carte (Faille de l'invocateur, 0..15000), vue depuis l'équipe teamId
function zone(x, y, teamId) {
  const blueSide = x + y < 14900;
  const mine = (teamId === 100) === blueSide;
  if (x < 4600 && y < 4600 && x + y < 6300) return { key: 'base', label: teamId === 100 ? 'ta base' : 'base ennemie', base: true, mine: teamId === 100 };
  if (x > 10500 && y > 10500 && x + y > 23500) return { key: 'base', label: teamId === 200 ? 'ta base' : 'base ennemie', base: true, mine: teamId === 200 };
  if ((x < 2300 && y > 4500) || (y > 12600 && x < 10300)) return { key: 'top', label: 'top lane', lane: 'TOP_LANE' };
  if ((y < 2300 && x > 4500) || (x > 12600 && y < 10300)) return { key: 'bot', label: 'bot lane', lane: 'BOT_LANE' };
  if (Math.abs(x - y) < 1300) return { key: 'mid', label: 'mid lane', lane: 'MID_LANE' };
  if (Math.abs(x + y - 14900) < 1500) return { key: 'river', label: 'rivière ' + (y > x ? '(côté top)' : '(côté bot)') };
  return { key: 'jungle', label: mine ? 'ta jungle' : 'jungle ennemie', jungle: true, mine };
}

// Position (interpolée entre deux images minute) d'un joueur à l'instant t (ms)
function posAt(frames, id, t) {
  const i = Math.max(0, Math.min(frames.length - 1, Math.floor(t / 60000)));
  const a = frames[i], b = frames[i + 1];
  const pa = a && a.participantFrames && a.participantFrames[id] && a.participantFrames[id].position;
  const pb = b && b.participantFrames && b.participantFrames[id] && b.participantFrames[id].position;
  if (pa && pb && b.timestamp > a.timestamp) {
    const k = Math.max(0, Math.min(1, (t - a.timestamp) / (b.timestamp - a.timestamp)));
    return { x: pa.x + (pb.x - pa.x) * k, y: pa.y + (pb.y - pa.y) * k };
  }
  return pa || pb || null;
}

function objLabel(o) {
  if (o.type === 'ELITE_MONSTER_KILL') {
    const base = MONSTERS[o.monsterType] || o.monsterType;
    return o.monsterType === 'DRAGON' && DRAKES[o.monsterSubType] ? base + ' ' + DRAKES[o.monsterSubType] : base;
  }
  const lane = { TOP_LANE: 'top', MID_LANE: 'mid', BOT_LANE: 'bot' }[o.laneType] || '';
  if (o.buildingType === 'INHIBITOR_BUILDING') return 'Inhibiteur ' + lane;
  const kind = { OUTER_TURRET: '1re tour', INNER_TURRET: '2e tour', BASE_TURRET: 'tour d\'inhibiteur', NEXUS_TURRET: 'tour du Nexus' }[o.towerType] || 'Tour';
  return kind.charAt(0).toUpperCase() + kind.slice(1) + (lane && o.towerType !== 'NEXUS_TURRET' ? ' ' + lane : '');
}
// accord : « tour perdue », « larves perdues », « dragon perdu »
function objVerb(o, taken) {
  const g = o.type === 'BUILDING_KILL' ? (o.buildingType === 'INHIBITOR_BUILDING' ? '' : 'e') : o.monsterType === 'HORDE' ? 'es' : '';
  return (taken ? 'pris' : 'perdu') + g;
}
// équipe qui prend l'objectif (pour un bâtiment, teamId = l'équipe qui le perd)
const takerTeam = o => (o.type === 'ELITE_MONSTER_KILL' ? o.killerTeamId : o.teamId === 100 ? 200 : 100);

/**
 * match, timeline : réponses match-v5 ; puuid : le joueur suivi ; items : { id: [nom, prix] } (Data Dragon).
 * Renvoie null si le joueur n'est pas dans la partie ou si la timeline manque.
 */
function buildMoments(match, tl, puuid, items = {}) {
  const info = match && match.info;
  const frames = (tl && tl.info && tl.info.frames) || [];
  if (!info || !frames.length) return null;
  const parts = info.participants.map(p => ({
    id: p.participantId, puuid: p.puuid, champion: p.championName, teamId: p.teamId,
    position: p.teamPosition || p.individualPosition || '',
    name: p.riotIdGameName ? p.riotIdGameName + (p.riotIdTagline ? '#' + p.riotIdTagline : '') : p.summonerName || ''
  }));
  const me = parts.find(p => p.puuid === puuid);
  if (!me) return null;
  const byId = Object.fromEntries(parts.map(p => [p.id, p]));
  const opp = parts.find(p => p.teamId !== me.teamId && p.position && p.position === me.position) || null;
  const allyIds = parts.filter(p => p.teamId === me.teamId).map(p => p.id);
  const enemyIds = parts.filter(p => p.teamId !== me.teamId).map(p => p.id);
  const enemyJgl = parts.find(p => p.teamId !== me.teamId && p.position === 'JUNGLE');
  const events = frames.flatMap(f => f.events || []);
  const kills = events.filter(e => e.type === 'CHAMPION_KILL' && e.position);
  const objs = events.filter(e => (e.type === 'ELITE_MONSTER_KILL' || e.type === 'BUILDING_KILL') && e.position);
  const champ = id => (byId[id] ? byId[id].champion : id === 0 ? 'tour ou sbires' : '?');
  const near = (ids, x, y, t, exclude = []) => ids.filter(id => !exclude.includes(id)).filter(id => {
    const p = posAt(frames, id, t);
    return p && Math.hypot(p.x - x, p.y - y) <= NEAR;
  });
  const goldDiff = t => {
    const f = frames[Math.min(frames.length - 1, Math.floor(t / 60000))];
    if (!f || !f.participantFrames) return null;
    const sum = ids => ids.reduce((s, id) => s + ((f.participantFrames[id] || {}).totalGold || 0), 0);
    return sum(allyIds) - sum(enemyIds);
  };
  const moments = [];

  // ---- morts
  for (const e of kills.filter(k => k.victimId === me.id)) {
    const { x, y } = e.position;
    const z = zone(x, y, me.teamId);
    const involved = [e.killerId].concat(e.assistingParticipantIds || []).filter(id => enemyIds.includes(id));
    const allies = near(allyIds, x, y, e.timestamp, [me.id]);
    const fight = kills.filter(k => Math.abs(k.timestamp - e.timestamp) <= 12000 && Math.hypot(k.position.x - x, k.position.y - y) < 3500).length;
    const after = objs.filter(o => o.timestamp > e.timestamp && o.timestamp - e.timestamp <= 90000 && takerTeam(o) !== me.teamId);
    const tags = [];
    if (involved.length === 1 && !(e.assistingParticipantIds || []).length) tags.push('1 contre 1');
    if (involved.length >= 3) tags.push(involved.length + ' ennemis');
    if (e.timestamp < 15 * 60000 && enemyJgl && involved.includes(enemyJgl.id) && z.lane && me.position !== 'JUNGLE') tags.push('gank');
    if (fight >= 3) tags.push('combat d\'équipe');
    if (!allies.length && !z.base) tags.push('seul');
    if (z.jungle && !z.mine) tags.push('jungle ennemie');
    if (after.length) tags.push('objectif perdu ensuite');
    moments.push({
      t: e.timestamp, type: 'mort', tone: 'bad', x, y, zone: z.label,
      title: 'Mort' + (e.killerId ? ' : tué par ' + champ(e.killerId) : ' (tour ou sbires)'),
      involved: involved.map(champ), allies: allies.map(champ), tags,
      after: after.map(o => ({ what: objLabel(o) + ' ' + objVerb(o, false), s: Math.round((o.timestamp - e.timestamp) / 1000) })),
      shutdown: e.shutdownBounty || 0, goldDiff: goldDiff(e.timestamp)
    });
  }
  // ---- kills
  for (const e of kills.filter(k => k.killerId === me.id)) {
    const { x, y } = e.position;
    const assists = (e.assistingParticipantIds || []).filter(id => allyIds.includes(id));
    moments.push({
      t: e.timestamp, type: 'kill', tone: 'good', x, y, zone: zone(x, y, me.teamId).label,
      title: 'Kill sur ' + champ(e.victimId) + (assists.length ? '' : ' (seul)'),
      tags: assists.length ? [] : ['solo kill'], allies: assists.map(champ), goldDiff: goldDiff(e.timestamp)
    });
  }
  // ---- objectifs : monstres, tours de sa lane, inhibiteurs, et bâtiments où il a participé
  const myLane = LANE_OF[me.position];
  for (const o of objs) {
    const isMonster = o.type === 'ELITE_MONSTER_KILL';
    const mineInvolved = o.killerId === me.id || (o.assistingParticipantIds || []).includes(me.id);
    if (!isMonster && !(o.laneType === myLane || o.buildingType === 'INHIBITOR_BUILDING' || mineInvolved)) continue;
    const taker = takerTeam(o);
    const p = posAt(frames, me.id, o.timestamp);
    const dist = p ? Math.hypot(p.x - o.position.x, p.y - o.position.y) : null;
    const present = mineInvolved || (dist !== null && dist <= 3000);
    moments.push({
      t: o.timestamp, type: 'objectif', tone: taker === me.teamId ? 'good' : 'bad', x: o.position.x, y: o.position.y,
      title: objLabel(o) + ' ' + objVerb(o, taker === me.teamId),
      tags: [present ? 'présent' : 'absent'],
      where: present ? '' : p ? zone(p.x, p.y, me.teamId).label : ''
    });
  }
  // ---- retours à la base (achats groupés), sans les objets de départ
  const buys = events.filter(e => e.type === 'ITEM_PURCHASED' && e.participantId === me.id).sort((a, b) => a.timestamp - b.timestamp);
  const groups = [];
  for (const b of buys) {
    const g = groups[groups.length - 1];
    if (g && b.timestamp - g.last <= 30000) { g.items.push(b.itemId); g.last = b.timestamp; } else groups.push({ t: b.timestamp, last: b.timestamp, items: [b.itemId] });
  }
  for (const g of groups.filter(x => x.t > 90000)) {
    const spent = g.items.reduce((s, id) => s + ((items[id] || [])[1] || 0), 0);
    const names = g.items.map(id => (items[id] || [])[0]).filter(Boolean);
    const p = posAt(frames, me.id, g.t);
    moments.push({
      t: g.t, type: 'retour', tone: 'info', x: p ? p.x : null, y: p ? p.y : null,
      title: 'Retour à la base' + (spent ? ' : ' + spent + ' or dépensés' : ''), items: names, spent
    });
  }
  // ---- niveau 6 (comparé au vis-à-vis)
  const lvl6 = id => { const e = events.find(x => x.type === 'LEVEL_UP' && x.participantId === id && x.level === 6); return e ? e.timestamp : null; };
  const my6 = lvl6(me.id), opp6 = opp ? lvl6(opp.id) : null;
  if (my6) {
    const p = posAt(frames, me.id, my6);
    moments.push({ t: my6, type: 'niveau', tone: opp6 && opp6 < my6 ? 'bad' : 'info', x: p ? p.x : null, y: p ? p.y : null, title: 'Niveau 6', vs: opp6 ? mmss(opp6) : null });
  }
  moments.sort((a, b) => a.t - b.t);

  // ---- lane à 10 et 15 min
  const laneAt = m => {
    const f = frames[m] && frames[m].participantFrames;
    if (!f || !f[me.id]) return null;
    const s = pf => ({ cs: (pf.minionsKilled || 0) + (pf.jungleMinionsKilled || 0), gold: pf.totalGold || 0, xp: pf.xp || 0, level: pf.level || 0 });
    return { me: s(f[me.id]), opp: opp && f[opp.id] ? s(f[opp.id]) : null };
  };
  // ---- vision
  const wards = events.filter(e => e.type === 'WARD_PLACED' && e.creatorId === me.id && e.wardType !== 'UNDEFINED');
  const vision = {
    placed: wards.length, control: wards.filter(e => e.wardType === 'CONTROL_WARD').length,
    killed: events.filter(e => e.type === 'WARD_KILL' && e.killerId === me.id).length,
    before15: wards.filter(e => e.timestamp < 15 * 60000).length
  };
  // ---- positions minute par minute (mini-carte) : [x, y] arrondis à 10 unités
  const track = frames.map(f => ({
    t: f.timestamp,
    p: Object.fromEntries(parts.map(pp => { const q = f.participantFrames && f.participantFrames[pp.id] && f.participantFrames[pp.id].position; return [pp.id, q ? [Math.round(q.x / 10) * 10, Math.round(q.y / 10) * 10] : null]; }))
  }));
  const me2 = info.participants.find(p => p.participantId === me.id);
  return {
    v: 1, matchId: match.metadata.matchId, gameId: info.gameId, platformId: info.platformId, version: info.gameVersion,
    duration: info.gameEndTimestamp ? info.gameDuration : Math.round(info.gameDuration / 1000),
    win: !!me2.win, kda: [me2.kills, me2.deaths, me2.assists],
    me: me.id, opp: opp ? opp.id : null, teamId: me.teamId, role: POSTES[me.position] || me.position,
    participants: parts.map(({ puuid: _p, ...rest }) => rest), // eslint-disable-line no-unused-vars
    moments, lane: { at10: laneAt(10), at15: laneAt(15) }, vision, track
  };
}

// ---------------------------------------------------------------- texte pour l'analyse (à coller dans Claude)
function toText(m, opts = {}) {
  const name = id => { const p = m.participants.find(x => x.id === id); return p ? (opts.champName ? opts.champName(p.champion) : p.champion) : '?'; };
  const cn = c => (opts.champName ? opts.champName(c) : c);
  const me = m.participants.find(p => p.id === m.me);
  const opp = m.opp ? m.participants.find(p => p.id === m.opp) : null;
  const team = t => m.participants.filter(p => p.teamId === t).map(p => (POSTES[p.position] || p.position || '?') + ' ' + cn(p.champion) + (p.id === m.me ? ' (le joueur)' : '')).join(', ');
  const L = [];
  L.push('DOSSIER DE PARTIE (Coaching LoL) — à analyser');
  L.push(`Joueur : ${opts.player || me.name} — ${m.role} ${cn(me.champion)}${opp ? ' contre ' + cn(opp.champion) : ''} — ${m.win ? 'Victoire' : 'Défaite'} en ${mmss(m.duration * 1000)} — ${m.kda.join('/')} — partie ${m.matchId} (patch ${String(m.version || '').split('.').slice(0, 2).join('.')})`);
  L.push(`Son équipe (côté ${m.teamId === 100 ? 'bleu' : 'rouge'}) : ${team(m.teamId)}`);
  L.push(`Adversaires : ${team(m.teamId === 100 ? 200 : 100)}`);
  const lane = (k, l) => {
    const a = m.lane[k];
    if (!a) return;
    L.push(`À ${l} min : ${a.me.cs} CS, ${a.me.gold} or, niveau ${a.me.level}` + (a.opp ? ` — vis-à-vis : ${a.opp.cs} CS, ${a.opp.gold} or, niveau ${a.opp.level} (écart ${a.me.gold - a.opp.gold >= 0 ? '+' : ''}${a.me.gold - a.opp.gold} or)` : ''));
  };
  lane('at10', 10); lane('at15', 15);
  const pl = (n, w) => n + ' ' + w + (n > 1 ? 's' : '');
  L.push(`Vision : ${pl(m.vision.placed, 'ward')} posée${m.vision.placed > 1 ? 's' : ''} (dont ${pl(m.vision.control, 'pink')}, ${m.vision.before15} avant 15 min), ${m.vision.killed} détruite${m.vision.killed > 1 ? 's' : ''}`);
  L.push('');
  L.push('MOMENTS (minute:seconde)');
  for (const x of m.moments) {
    let s = `${mmss(x.t)} — ${x.title.replace(/(tué par|Kill sur) (\w+)/, (a, b, c) => b + ' ' + cn(c))}`;
    if (x.zone) s += ` — ${x.zone}`;
    if (x.type === 'mort') {
      if (x.involved && x.involved.length) s += ` — ennemis impliqués : ${x.involved.map(cn).join(', ')}`;
      s += ` — alliés à côté : ${x.allies && x.allies.length ? x.allies.map(cn).join(', ') : 'aucun'}`;
      if (x.goldDiff !== null && x.goldDiff !== undefined) s += ` — écart d'or de l'équipe : ${x.goldDiff >= 0 ? '+' : ''}${x.goldDiff}`;
      if (x.after && x.after.length) s += ` — ensuite : ${x.after.map(a => a.what + ' ' + a.s + ' s après').join(', ')}`;
    }
    if (x.type === 'objectif') s += x.tags.includes('présent') ? ' — le joueur était là' : ` — le joueur était absent${x.where ? ' (' + x.where + ')' : ''}`;
    if (x.type === 'retour' && x.items && x.items.length) s += ` — achats : ${x.items.join(', ')}`;
    if (x.type === 'niveau' && x.vs) s += ` — vis-à-vis niveau 6 à ${x.vs}`;
    if (x.tags && x.tags.length && x.type !== 'objectif') s += ` [${x.tags.join(', ')}]`;
    L.push(s);
  }
  L.push('');
  L.push('Pour chaque mort et chaque objectif perdu : ce qui s\'est passé, l\'erreur probable, le meilleur move, et ton niveau de confiance. Termine par les 3 priorités de travail.');
  return L.join('\n');
}

module.exports = { buildMoments, toText, zone, posAt, mmss, objLabel };
