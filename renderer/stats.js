// Calculs statistiques (utilisé par l'interface et par les tests Node).
(function (root) {
  const mean = a => { const v = a.filter(x => x !== null && x !== undefined && !Number.isNaN(x)); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
  const sum = a => a.reduce((s, x) => s + (x || 0), 0);
  const per = (g, f) => (g.duration ? f / g.duration : null);

  // Valeur par partie (sert aux courbes et au KPI suivi des sessions)
  const METRICS = {
    'Victoire': g => (g.win ? 1 : 0),
    'KDA': g => (g.kills + g.assists) / Math.max(1, g.deaths),
    'KP': g => (g.teamKills ? (g.kills + g.assists) / g.teamKills : null),
    'Kills': g => g.kills, 'Morts': g => g.deaths, 'Assists': g => g.assists,
    'CS/min': g => per(g, g.cs), 'CS à 10 min': g => g.cs10,
    'Or/min': g => per(g, g.gold), 'Dégâts/min': g => per(g, g.damage),
    'Vision/min': g => per(g, g.vision), 'Score de vision': g => g.vision,
    'Wards posées': g => g.wardsPlaced, 'Wards détruites': g => g.wardsKilled, 'Pinks achetées': g => g.pinks,
    'Écart or à 10 min': g => g.goldDiff10, 'Écart XP à 10 min': g => g.xpDiff10, 'Écart or à 15 min': g => g.goldDiff15,
    'Morts avant 15 min': g => g.deaths15, 'LP gagnés/perdus': g => g.lpDelta,
    'Note mentale': g => g.mental, 'Objectif de partie atteint': g => (g.objectiveMet === null || g.objectiveMet === undefined ? null : (g.objectiveMet ? 1 : 0)),
    'Durée (min)': g => g.duration
  };
  const METRIC_SENS = { 'Morts': '≤', 'Morts avant 15 min': '≤' };
  const METRIC_FMT = { 'Victoire': 'pct', 'KP': 'pct', 'KDA': 'dec2', 'CS/min': 'dec2', 'Vision/min': 'dec2', 'Objectif de partie atteint': 'pct',
    'Écart or à 10 min': 'diff', 'Écart XP à 10 min': 'diff', 'Écart or à 15 min': 'diff', 'LP gagnés/perdus': 'diff', 'Or/min': 'int', 'Dégâts/min': 'int' };

  // Indicateurs agrégés du tableau de bord : [libellé, calcul, format, métrique par partie pour la courbe]
  const KPIS = [
    ['Parties jouées', gs => gs.length, 'int', null],
    ['Taux de victoire', gs => mean(gs.map(METRICS['Victoire'])), 'pct', 'Victoire'],
    ['KDA', gs => (gs.length ? (sum(gs.map(g => g.kills)) + sum(gs.map(g => g.assists))) / Math.max(1, sum(gs.map(g => g.deaths))) : null), 'dec2', 'KDA'],
    ['KP', gs => mean(gs.map(METRICS['KP'])), 'pct', 'KP'],
    ['Kills moyens', gs => mean(gs.map(g => g.kills)), 'dec1', 'Kills'],
    ['Morts moyennes', gs => mean(gs.map(g => g.deaths)), 'dec1', 'Morts'],
    ['Assists moyens', gs => mean(gs.map(g => g.assists)), 'dec1', 'Assists'],
    ['CS/min', gs => mean(gs.map(METRICS['CS/min'])), 'dec2', 'CS/min'],
    ['CS à 10 min', gs => mean(gs.map(g => g.cs10)), 'dec1', 'CS à 10 min'],
    ['Or/min', gs => mean(gs.map(METRICS['Or/min'])), 'int', 'Or/min'],
    ['Dégâts/min', gs => mean(gs.map(METRICS['Dégâts/min'])), 'int', 'Dégâts/min'],
    ['Vision/min', gs => mean(gs.map(METRICS['Vision/min'])), 'dec2', 'Vision/min'],
    ['Score de vision', gs => mean(gs.map(g => g.vision)), 'dec1', 'Score de vision'],
    ['Wards posées', gs => mean(gs.map(g => g.wardsPlaced)), 'dec1', 'Wards posées'],
    ['Wards détruites', gs => mean(gs.map(g => g.wardsKilled)), 'dec1', 'Wards détruites'],
    ['Pinks achetées', gs => mean(gs.map(g => g.pinks)), 'dec1', 'Pinks achetées'],
    ['Écart or à 10 min', gs => mean(gs.map(g => g.goldDiff10)), 'diff', 'Écart or à 10 min'],
    ['Écart XP à 10 min', gs => mean(gs.map(g => g.xpDiff10)), 'diff', 'Écart XP à 10 min'],
    ['Écart or à 15 min', gs => mean(gs.map(g => g.goldDiff15)), 'diff', 'Écart or à 15 min'],
    ['Morts avant 15 min', gs => mean(gs.map(g => g.deaths15)), 'dec1', 'Morts avant 15 min'],
    ['LP net', gs => (gs.some(g => g.lpDelta !== null && g.lpDelta !== undefined) ? sum(gs.map(g => g.lpDelta)) : null), 'diff', 'LP gagnés/perdus'],
    ['Note mentale', gs => mean(gs.map(g => g.mental)), 'dec1', 'Note mentale'],
    ['% objectifs de partie atteints', gs => mean(gs.map(METRICS['Objectif de partie atteint'])), 'pct', 'Objectif de partie atteint'],
    ['Durée moyenne (min)', gs => mean(gs.map(g => g.duration)), 'dec1', 'Durée (min)']
  ];

  function fmt(v, f) {
    if (v === null || v === undefined || Number.isNaN(v)) return '—';
    switch (f) {
      case 'pct': return Math.round(v * 100) + '%';
      case 'dec2': return v.toFixed(2).replace('.', ',');
      case 'dec1': return v.toFixed(1).replace('.', ',');
      case 'diff': return (v > 0 ? '+' : '') + Math.round(v).toLocaleString('fr-FR');
      default: return Math.round(v).toLocaleString('fr-FR');
    }
  }

  // Parties qui comptent : celles du joueur, au rôle coaché, depuis la date choisie, triées de la plus ancienne à la plus récente
  function playerGames(data, player, since) {
    const from = since ? new Date(since).getTime() : 0;
    return data.games.filter(g => g.playerId === player.id && g.role === player.role && g.date >= from).sort((a, b) => a.date - b.date);
  }

  function objectiveFor(data, player, label) {
    const perso = player.objectives && player.objectives[label];
    const def = data.settings.objectives[label];
    const sens = def ? def.sens : (METRIC_SENS[label] || '≥');
    if (perso !== undefined && perso !== null && perso !== '') return { value: Number(perso), sens, custom: true };
    if (def && def[player.role] !== null && def[player.role] !== undefined) return { value: def[player.role], sens, custom: false };
    return { value: null, sens, custom: false };
  }

  function status(value, obj) {
    if (value === null || obj.value === null) return null;
    return obj.sens === '≤' ? value <= obj.value : value >= obj.value;
  }

  function progress(value, obj) {
    if (value === null || obj.value === null) return null;
    if (obj.value === 0) return value >= 0 ? 10 : Math.max(0, Math.round(10 + value / 100));
    const r = obj.sens === '≤' ? obj.value / Math.max(value, 0.01) : value / obj.value;
    return Math.max(0, Math.min(10, Math.floor(10 * r)));
  }

  function kpiTable(data, player, since, games) {
    const gs = games || playerGames(data, player, since);
    const last10 = gs.slice(-10);
    return KPIS.map(([label, f, format, metric]) => {
      const value = gs.length || label === 'Parties jouées' ? f(gs) : null;
      const v10 = last10.length ? f(last10) : null;
      const obj = objectiveFor(data, player, label);
      const ok = status(value, obj);
      let trend = null;
      if (v10 !== null && value !== null && label !== 'Parties jouées') {
        const d = v10 - value;
        trend = Math.abs(d) < 1e-9 ? 0 : ((d > 0) === (obj.sens !== '≤') ? 1 : -1);
      }
      let series = metric ? gs.slice(-20).map(METRICS[metric]) : [];
      if (label === 'Taux de victoire' || label === '% objectifs de partie atteints') {
        // moyenne cumulée : plus lisible qu'une suite de 0 et de 1
        let n = 0, t = 0; series = series.map(v => { if (v === null) return null; n++; t += v; return t / n; });
      } else if (label === 'LP net') {
        let t = 0; series = value === null ? [] : series.map(v => (t += v || 0));
      }
      return { label, value, v10, format, obj, ok, progress: progress(value, obj), trend, series };
    });
  }

  function groupBy(gs, key) {
    const m = new Map();
    for (const g of gs) { const k = g[key]; if (!k) continue; if (!m.has(k)) m.set(k, []); m.get(k).push(g); }
    return [...m.entries()].map(([name, list]) => ({
      name, games: list.length, wins: list.filter(g => g.win).length,
      winrate: list.filter(g => g.win).length / list.length,
      kda: (sum(list.map(g => g.kills)) + sum(list.map(g => g.assists))) / Math.max(1, sum(list.map(g => g.deaths))),
      csmin: mean(list.map(METRICS['CS/min'])), kp: mean(list.map(METRICS['KP'])),
      gd15: mean(list.map(g => g.goldDiff15)), d15: mean(list.map(g => g.deaths15)), vision: mean(list.map(METRICS['Vision/min']))
    })).sort((a, b) => b.games - a.games || b.winrate - a.winrate);
  }

  function sessionResult(data, session, player) {
    const metric = METRICS[session.kpi];
    if (!metric || !player) return { before: null, after: null, delta: null, ok: null };
    const t = new Date(session.date).getTime();
    const gs = data.games.filter(g => g.playerId === player.id && g.role === player.role);
    const before = mean(gs.filter(g => g.date < t).map(metric));
    const after = mean(gs.filter(g => g.date >= t).map(metric));
    const delta = before !== null && after !== null ? after - before : null;
    const sens = METRIC_SENS[session.kpi] || '≥';
    const target = session.target === '' || session.target === null || session.target === undefined ? null : Number(session.target);
    const ok = after === null || target === null ? null : (sens === '≤' ? after <= target : after >= target);
    return { before, after, delta, ok, sens };
  }

  const api = { METRICS, METRIC_SENS, METRIC_FMT, KPIS, fmt, mean, playerGames, objectiveFor, status, progress, kpiTable, groupBy, sessionResult };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Stats = api;
})(typeof window !== 'undefined' ? window : globalThis);
