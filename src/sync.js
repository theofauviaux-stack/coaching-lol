// Synchronisation : récupère les parties SoloQ (file 420) jouées au rôle coaché et le rang Solo/Duo.
const POSTES = { TOP: 'Top', JUNGLE: 'Jungle', MIDDLE: 'Mid', MID: 'Mid', BOTTOM: 'ADC', BOT: 'ADC', UTILITY: 'Support', SUPPORT: 'Support' };
const lp = require('./lp');
const { rankScore, rankLabel, TIERS_FR } = lp;

function gameFromMatch(match, tl, p, playerId) {
  const info = match.info;
  const team = info.participants.filter(x => x.teamId === p.teamId);
  const opp = info.participants.find(x => x.teamId !== p.teamId && x.teamPosition && x.teamPosition === p.teamPosition);
  const durS = info.gameEndTimestamp ? info.gameDuration : info.gameDuration / 1000;
  const g = {
    matchId: match.metadata.matchId,
    playerId,
    date: info.gameStartTimestamp || info.gameCreation,
    role: POSTES[p.teamPosition] || POSTES[p.individualPosition] || '',
    champion: p.championName,
    opponent: opp ? opp.championName : '',
    win: !!p.win,
    duration: Math.round(durS / 6) / 10,
    kills: p.kills, deaths: p.deaths, assists: p.assists,
    teamKills: team.reduce((s, x) => s + x.kills, 0),
    cs: (p.totalMinionsKilled || 0) + (p.neutralMinionsKilled || 0),
    gold: p.goldEarned,
    damage: p.totalDamageDealtToChampions,
    vision: p.visionScore,
    wardsPlaced: p.wardsPlaced,
    wardsKilled: p.wardsKilled,
    pinks: p.visionWardsBoughtInGame,
    level: p.champLevel,
    side: p.teamId === 100 ? 'Bleu' : 'Rouge',
    cs10: null, goldDiff10: null, xpDiff10: null, goldDiff15: null, deaths15: null,
    lpDelta: null, mental: null, objectiveMet: null, comment: ''
  };
  if (tl && tl.info && Array.isArray(tl.info.frames)) {
    const fr = tl.info.frames;
    const pid = String(p.participantId);
    const aid = opp ? String(opp.participantId) : null;
    const f10 = fr[10] && fr[10].participantFrames;
    const f15 = fr[15] && fr[15].participantFrames;
    if (f10 && f10[pid]) {
      g.cs10 = (f10[pid].minionsKilled || 0) + (f10[pid].jungleMinionsKilled || 0);
      if (aid && f10[aid]) {
        g.goldDiff10 = f10[pid].totalGold - f10[aid].totalGold;
        g.xpDiff10 = f10[pid].xp - f10[aid].xp;
      }
    }
    if (f15 && f15[pid] && aid && f15[aid]) g.goldDiff15 = f15[pid].totalGold - f15[aid].totalGold;
    let d15 = 0;
    for (const f of fr) for (const ev of (f.events || [])) {
      if (ev.type === 'CHAMPION_KILL' && String(ev.victimId) === pid && ev.timestamp < 15 * 60 * 1000) d15++;
    }
    g.deaths15 = d15;
  }
  return g;
}

/**
 * Synchronise un joueur. Renvoie { added, ignored, remaining }.
 * onProgress(texte) est appelé pendant le travail.
 */
async function syncPlayer(data, client, player, opts = {}) {
  const onProgress = opts.onProgress || (() => {});
  const maxGames = opts.maxGames || 30;
  if (!player.role) throw new Error('Rôle coaché non renseigné.');
  const [gameName, tagLine] = String(player.riotId || '').split('#').map(s => (s || '').trim());
  if (!gameName || !tagLine) throw new Error('Pseudo attendu au format Nom#TAG.');

  if (!player.puuid) {
    onProgress('Recherche du compte ' + player.riotId + '…');
    const acc = await client.account(gameName, tagLine, player.region);
    if (!acc) throw new Error('Joueur introuvable chez Riot : vérifie le pseudo et la région.');
    player.puuid = acc.puuid;
  }

  onProgress('Liste des parties SoloQ…');
  // On récupère aussi les parties d'avant le début du coaching : elles servent de point de comparaison.
  // historique : jusqu'aux 300 dernières parties classées solo (3 pages de 100)
  const historyMax = opts.historyMax || 300;
  let ids = [];
  for (let start = 0; start < historyMax; start += 100) {
    const page = await client.matchIds(player.puuid, player.region, { queue: 420, count: 100, start });
    ids = ids.concat(page);
    if (page.length < 100) break;
  }
  const known = new Set(data.games.filter(g => g.playerId === player.id).map(g => g.matchId)
    .concat(data.ignored.filter(g => g.playerId === player.id).map(g => g.matchId)));
  const num = id => Number(String(id).split('_')[1] || 0);
  const todo = ids.filter(id => !known.has(id)).sort((a, b) => num(a) - num(b));
  const batch = todo.slice(Math.max(0, todo.length - maxGames)); // les plus récentes en priorité

  const added = [];
  let ignored = 0;
  for (let i = 0; i < batch.length; i++) {
    const id = batch[i];
    onProgress(`Partie ${i + 1}/${batch.length}…`);
    const match = await client.match(id, player.region);
    if (!match) continue;
    const p = match.info.participants.find(x => x.puuid === player.puuid);
    if (!p) continue;
    const role = POSTES[p.teamPosition] || POSTES[p.individualPosition] || '';
    if (role !== player.role) {
      data.ignored.push({ matchId: id, playerId: player.id, role: role || '?', date: match.info.gameStartTimestamp || match.info.gameCreation });
      ignored++;
      continue;
    }
    let tl = null;
    try { tl = await client.timeline(id, player.region); } catch (e) { if (e.code === 'KEY') throw e; }
    const g = gameFromMatch(match, tl, p, player.id);
    data.games.push(g);
    added.push(g);
  }

  // Rang Solo/Duo, puis LP de chaque partie déduits des relevés de rang (voir src/lp.js)
  onProgress('Rang Solo/Duo…');
  const entries = await client.leagues(player.puuid, player.region);
  lp.recordRank(data, player, entries, opts.now ? opts.now() : Date.now());
  lp.attributeLp(data, player.id);
  player.lastSync = Date.now();
  player.status = 'ok';
  const remaining = Math.max(0, todo.length - batch.length);
  player.statusText = remaining ? 'Récupération de l\'historique : encore ' + remaining + ' partie(s) à vérifier' : 'À jour';
  return { added: added.length, ignored, remaining };
}

module.exports = { syncPlayer, gameFromMatch, rankScore, rankLabel, POSTES, TIERS_FR };
