// Partie de test au format du client LoL (« match-v4 ») : la partie v5 de partie-moments, retournée comme le
// client la donne pour une partie personnalisée (stats imbriquées, identités à part, pas de LEVEL_UP ni killerTeamId).
const partie = require('./partie-moments');
const KEYS = { Darius: 122, LeeSin: 64, Ahri: 103, Jinx: 222, Thresh: 412, Garen: 86, Khazix: 121, Leblanc: 7, Caitlyn: 51, Blitzcrank: 53 };
const LANES = { TOP: ['TOP', 'SOLO'], JUNGLE: ['JUNGLE', 'NONE'], MIDDLE: ['MIDDLE', 'SOLO'], BOTTOM: ['BOTTOM', 'DUO_CARRY'], UTILITY: ['BOTTOM', 'DUO_SUPPORT'] };
// start : début de la partie (par défaut il y a 2 h : le client ne garde que les parties récentes)
module.exports = function lcuGame(puuidMe = 'P-DARIUS', gameId = 7300000777, lanes = true, start = Date.now() - 2 * 3600e3) {
  const { match, timeline } = partie(puuidMe);
  const info = Object.assign({}, match.info, { gameStartTimestamp: start });
  const game = {
    gameId, platformId: 'EUW1', gameCreation: info.gameStartTimestamp, gameDuration: info.gameDuration, gameMode: 'CLASSIC', gameType: 'CUSTOM_GAME',
    gameVersion: info.gameVersion, mapId: 11, queueId: 0,
    participantIdentities: info.participants.map(p => ({ participantId: p.participantId, player: { puuid: p.puuid, gameName: p.riotIdGameName, tagLine: p.riotIdTagline, summonerName: p.riotIdGameName } })),
    participants: info.participants.map(p => ({
      participantId: p.participantId, championId: KEYS[p.championName], teamId: p.teamId, spell1Id: p.teamPosition === 'JUNGLE' ? 11 : 4, spell2Id: p.teamPosition === 'JUNGLE' ? 4 : 14,
      timeline: lanes ? { lane: LANES[p.teamPosition][0], role: LANES[p.teamPosition][1] } : { lane: 'NONE', role: 'NONE' },
      stats: { win: p.win, kills: p.kills, deaths: p.deaths, assists: p.assists, totalMinionsKilled: 150, neutralMinionsKilled: 4, goldEarned: 9000, totalDamageDealtToChampions: 12000, visionScore: 20, wardsPlaced: 6, wardsKilled: 1, visionWardsBoughtInGame: 1, champLevel: 14 }
    }))
  };
  const frames = timeline.info.frames.map(f => ({
    timestamp: f.timestamp, participantFrames: f.participantFrames,
    events: f.events.flatMap(e => {
      if (e.type === 'LEVEL_UP') return Array.from({ length: e.level }, (_, i) => ({ type: 'SKILL_LEVEL_UP', participantId: e.participantId, levelUpType: 'NORMAL', skillSlot: 1 + (i % 3), timestamp: e.timestamp - (e.level - 1 - i) * 1000 }));
      const x = Object.assign({}, e);
      delete x.killerTeamId;
      return [x];
    })
  }));
  const list = { games: { games: [
    { gameId, platformId: 'EUW1', gameCreation: info.gameStartTimestamp, gameDuration: info.gameDuration, gameMode: 'CLASSIC', gameType: 'CUSTOM_GAME', mapId: 11, queueId: 0, participants: [{ championId: 122, stats: { win: false, kills: 1, deaths: 2, assists: 0 } }] },
    { gameId: gameId - 1, platformId: 'EUW1', gameCreation: info.gameStartTimestamp - 3600e3, gameDuration: 1500, gameMode: 'CLASSIC', gameType: 'MATCHED_GAME', mapId: 11, queueId: 420, participants: [{ championId: 122, stats: { win: true } }] },
    { gameId: gameId - 2, platformId: 'EUW1', gameCreation: info.gameStartTimestamp - 7200e3, gameDuration: 900, gameMode: 'ARAM', gameType: 'CUSTOM_GAME', mapId: 12, queueId: 0, participants: [{ championId: 103, stats: { win: true, kills: 9 } }] }
  ] } };
  return { game, timeline: { frames }, list, v5: { match, timeline } };
};
