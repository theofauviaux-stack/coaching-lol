// Modification du profil d'un joueur : ce qui doit être effacé ou re-téléchargé selon le changement.
const sameAccount = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

function updatePlayer(data, target, patch) {
  const accountChanged = ('riotId' in patch && !sameAccount(patch.riotId, target.riotId)) ||
    ('region' in patch && patch.region !== target.region);
  const roleChanged = 'role' in patch && patch.role !== target.role;
  const id = target.id;
  if (accountChanged) {
    // autre compte Riot : les parties et rangs déjà récupérés ne sont plus les siens
    data.games = data.games.filter(g => g.playerId !== id);
    data.ignored = data.ignored.filter(g => g.playerId !== id);
    data.ranks = data.ranks.filter(r => r.playerId !== id);
    target.puuid = '';
    target.lastSync = null;
  } else if (roleChanged) {
    // nouveau rôle : les parties écartées « hors rôle » sont réexaminées (celles retirées à la main restent retirées)
    data.ignored = data.ignored.filter(g => !(g.playerId === id && g.role !== 'supprimée'));
  }
  Object.assign(target, patch);
  return { resync: accountChanged || roleChanged, accountChanged, roleChanged };
}

function deletePlayer(data, id) {
  data.players = data.players.filter(p => p.id !== id);
  for (const k of ['games', 'ignored', 'ranks', 'sessions', 'reports']) data[k] = (data[k] || []).filter(x => x.playerId !== id);
}

module.exports = { updatePlayer, deletePlayer, sameAccount };
