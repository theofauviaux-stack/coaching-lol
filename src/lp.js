// LP gagnés ou perdus par partie.
// L'API Riot ne donne pas les LP d'une partie : on relève le rang Solo/Duo régulièrement (toutes les 5 minutes)
// et on attribue l'écart entre deux relevés aux parties terminées entre les deux.
//  - 1 partie entre deux relevés : valeur exacte ;
//  - plusieurs parties : estimation à partir des victoires/défaites (marquée lpEstimated) ;
//  - les LP saisis à la main par le coach (lpManual) ne sont jamais remplacés.
const TIERS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];
const TIERS_FR = { IRON: 'Fer', BRONZE: 'Bronze', SILVER: 'Argent', GOLD: 'Or', PLATINUM: 'Platine', EMERALD: 'Émeraude', DIAMOND: 'Diamant', MASTER: 'Maître', GRANDMASTER: 'Grand Maître', CHALLENGER: 'Challenger' };
const DIVS = { IV: 0, III: 1, II: 2, I: 3 };

function rankScore(tier, division, lp) {
  const ti = TIERS.indexOf(tier);
  if (ti < 0) return null;
  return ti >= 7 ? 2800 + lp : ti * 400 + (DIVS[division] || 0) * 100 + lp;
}
function rankLabel(tier, division, lp) {
  const ti = TIERS.indexOf(tier);
  return (TIERS_FR[tier] || tier) + (ti >= 7 ? '' : ' ' + division) + ' · ' + lp + ' LP';
}

// Enregistre un relevé si le rang ou le nombre de parties a changé. Renvoie { recorded, newGames }.
function recordRank(data, player, entries, now = Date.now()) {
  const e = (entries || []).find(x => x.queueType === 'RANKED_SOLO_5x5');
  if (!e) return { recorded: false, newGames: 0 };
  const score = rankScore(e.tier, e.rank, e.leaguePoints);
  const prev = data.ranks.filter(r => r.playerId === player.id).sort((a, b) => b.date - a.date)[0];
  const games = e.wins + e.losses;
  const prevGames = prev && typeof prev.wins === 'number' ? prev.wins + prev.losses : null;
  if (prev && prev.score === score && prevGames === games) return { recorded: false, newGames: 0 };
  data.ranks.push({
    playerId: player.id, date: now, tier: TIERS_FR[e.tier] || e.tier, division: TIERS.indexOf(e.tier) >= 7 ? '' : e.rank,
    lp: e.leaguePoints, wins: e.wins, losses: e.losses, score, label: rankLabel(e.tier, e.rank, e.leaguePoints)
  });
  return { recorded: true, newGames: prevGames === null ? 0 : Math.max(0, games - prevGames) };
}

const MIN = 60 * 1000;
const gameEnd = g => g.date + Math.round((g.duration || 0) * MIN);

// Répartit les écarts de LP entre relevés sur les parties du joueur. Renvoie le nombre de parties mises à jour.
function attributeLp(data, playerId) {
  const snaps = data.ranks.filter(r => r.playerId === playerId && typeof r.wins === 'number' && r.score !== null && r.score !== undefined)
    .sort((a, b) => a.date - b.date);
  const games = data.games.filter(g => g.playerId === playerId && !g.custom); // pas de LP en partie personnalisée
  const others = data.ignored.filter(g => g.playerId === playerId && g.role !== 'supprimée');
  let n = 0;
  for (let i = 1; i < snaps.length; i++) {
    const a = snaps[i - 1], b = snaps[i];
    const dW = b.wins - a.wins, dL = b.losses - a.losses, count = dW + dL;
    if (count <= 0 || dW < 0 || dL < 0) continue;
    const delta = b.score - a.score;
    // parties terminées entre les deux relevés (une partie hors rôle compte aussi dans le nombre)
    const inside = games.filter(g => gameEnd(g) > a.date && gameEnd(g) <= b.date);
    const hors = others.filter(g => g.date + 15 * MIN > a.date && g.date <= b.date).length;
    if (inside.length + hors !== count || !inside.length) continue;
    // les victoires et défaites connues doivent coller avec celles comptées par Riot
    const w = inside.filter(g => g.win).length, l = inside.length - w;
    if (w > dW || l > dL || (hors === 0 && (w !== dW || l !== dL))) continue;
    const set = (g, v, estimated) => {
      if (g.lpManual || v === null || !Number.isFinite(v)) return;
      if (!estimated && (g.lpDelta !== v || g.lpEstimated)) { g.lpDelta = v; g.lpEstimated = false; n++; }
      if (estimated && (g.lpDelta === null || g.lpDelta === undefined || g.lpEstimated)) {
        const r = Math.round(v);
        if (g.lpDelta !== r) { g.lpDelta = r; g.lpEstimated = true; n++; }
      }
    };
    if (count === 1) { set(inside[0], delta, false); continue; }
    // plusieurs parties : gain moyen d'une victoire et perte moyenne d'une défaite
    let win = null, loss = null;
    if (dL === 0) win = delta / dW;
    else if (dW === 0) loss = delta / dL;
    else if (dW !== dL) {
      const unit = delta / (dW - dL); // hypothèse : une victoire rapporte à peu près ce qu'une défaite coûte
      if (unit >= 5 && unit <= 60) { win = unit; loss = -unit; }
    }
    for (const g of inside) set(g, g.win ? win : loss, true);
  }
  return n;
}

// LP gagnés depuis le premier relevé (ou depuis une date)
function lpSince(data, playerId, since = 0) {
  const snaps = data.ranks.filter(r => r.playerId === playerId && r.score !== null && r.score !== undefined && r.date >= since).sort((a, b) => a.date - b.date);
  if (snaps.length < 2) return null;
  return { delta: snaps[snaps.length - 1].score - snaps[0].score, from: snaps[0].date };
}

module.exports = { recordRank, attributeLp, lpSince, rankScore, rankLabel, TIERS, TIERS_FR };
