// Partie de test (match-v5 + timeline) pour les moments clés. Le joueur suivi est le top Darius (id 1).
// 6:30 gank top (Kha'Zix + Garen), larves perdues 40 s après · 9:00 solo kill sur Garen · 12:00 dragon pris
// pendant qu'il est au top · 14:00 1re tour top perdue · 16:00 combat d'équipe au mid.
module.exports = function partie(puuidMe = 'P-DARIUS') {
  const P = [
    [1, puuidMe, 'Darius', 100, 'TOP', 'UCE Uawawa', '000'], [2, 'B-JGL', 'LeeSin', 100, 'JUNGLE', 'Blind Monk', 'EUW'], [3, 'B-MID', 'Ahri', 100, 'MIDDLE', 'Foxfire', 'EUW'],
    [4, 'B-ADC', 'Jinx', 100, 'BOTTOM', 'Get Excited', 'JINX'], [5, 'B-SUP', 'Thresh', 100, 'UTILITY', 'Lantern', 'EUW'],
    [6, 'R-TOP', 'Garen', 200, 'TOP', 'Demacia', 'FR1'], [7, 'R-JGL', 'Khazix', 200, 'JUNGLE', 'Void Bug', 'EUW'], [8, 'R-MID', 'Leblanc', 200, 'MIDDLE', 'Deceiver', 'EUW'],
    [9, 'R-ADC', 'Caitlyn', 200, 'BOTTOM', 'Piltover', 'EUW'], [10, 'R-SUP', 'Blitzcrank', 200, 'UTILITY', 'Steam Golem', 'EUW']
  ];
  const lanePos = { TOP: [1500, 10500], JUNGLE: [3800, 7800], MIDDLE: [6800, 7000], BOTTOM: [10500, 1300], UTILITY: [10200, 1500] };
  const enemyLanePos = { TOP: [1900, 11500], JUNGLE: [10800, 7200], MIDDLE: [7800, 8000], BOTTOM: [12500, 2000], UTILITY: [12300, 2200] };
  const frames = [];
  for (let m = 0; m <= 20; m++) {
    const pf = {};
    for (const [id, , , team, pos] of P) {
      let [x, y] = (team === 100 ? lanePos : enemyLanePos)[pos];
      if (id === 7 && m >= 6 && m <= 7) [x, y] = [1800, 11300]; // Kha'Zix monte au top
      if (m >= 16) [x, y] = team === 100 ? [7000, 7200] : [7700, 7800]; // tout le monde au mid
      if (id === 1 && m >= 11 && m <= 13) [x, y] = [1400, 12000]; // Darius reste top pendant le dragon
      pf[id] = { participantId: id, position: { x, y }, totalGold: 500 + m * (id === 1 ? 380 : 400), xp: m * 450, level: Math.min(18, 1 + Math.floor(m / 1.2)), minionsKilled: m * (id === 1 ? 7 : 6), jungleMinionsKilled: pos === 'JUNGLE' ? m * 5 : 0 };
    }
    frames.push({ timestamp: m * 60000, participantFrames: pf, events: [] });
  }
  const ev = (t, e) => frames[Math.floor(t / 60000)].events.push(Object.assign({ timestamp: t }, e));
  ev(10000, { type: 'ITEM_PURCHASED', participantId: 1, itemId: 1055 });
  ev(11000, { type: 'ITEM_PURCHASED', participantId: 1, itemId: 2003 });
  ev(340000, { type: 'LEVEL_UP', participantId: 6, level: 6 });
  ev(360000, { type: 'LEVEL_UP', participantId: 1, level: 6 });
  ev(390000, { type: 'CHAMPION_KILL', killerId: 7, victimId: 1, assistingParticipantIds: [6], position: { x: 1700, y: 11200 }, shutdownBounty: 0 });
  ev(420000, { type: 'ITEM_PURCHASED', participantId: 1, itemId: 3133 });
  ev(425000, { type: 'ITEM_PURCHASED', participantId: 1, itemId: 2003 });
  ev(430000, { type: 'ELITE_MONSTER_KILL', monsterType: 'HORDE', killerId: 7, killerTeamId: 200, position: { x: 4950, y: 10450 } });
  ev(540000, { type: 'CHAMPION_KILL', killerId: 1, victimId: 6, assistingParticipantIds: [], position: { x: 1600, y: 12500 } });
  ev(600000, { type: 'ITEM_PURCHASED', participantId: 1, itemId: 3071 });
  ev(720000, { type: 'ELITE_MONSTER_KILL', monsterType: 'DRAGON', monsterSubType: 'FIRE_DRAGON', killerId: 2, killerTeamId: 100, position: { x: 9866, y: 4414 } });
  ev(840000, { type: 'BUILDING_KILL', buildingType: 'TOWER_BUILDING', towerType: 'OUTER_TURRET', laneType: 'TOP_LANE', teamId: 100, killerId: 6, assistingParticipantIds: [7], position: { x: 981, y: 10441 } });
  ev(960000, { type: 'CHAMPION_KILL', killerId: 8, victimId: 1, assistingParticipantIds: [9, 10], position: { x: 7300, y: 7500 } });
  ev(962000, { type: 'CHAMPION_KILL', killerId: 7, victimId: 3, assistingParticipantIds: [8], position: { x: 7100, y: 7300 } });
  ev(965000, { type: 'CHAMPION_KILL', killerId: 6, victimId: 2, assistingParticipantIds: [], position: { x: 7500, y: 7600 } });
  ev(1000000, { type: 'ELITE_MONSTER_KILL', monsterType: 'BARON_NASHOR', killerId: 7, killerTeamId: 200, position: { x: 5007, y: 10471 } });
  ev(1010000, { type: 'BUILDING_KILL', buildingType: 'TOWER_BUILDING', towerType: 'OUTER_TURRET', laneType: 'BOT_LANE', teamId: 100, killerId: 9, position: { x: 10504, y: 1029 } });
  for (const t of [100000, 200000, 500000]) ev(t, { type: 'WARD_PLACED', creatorId: 1, wardType: 'YELLOW_TRINKET' });
  ev(700000, { type: 'WARD_PLACED', creatorId: 1, wardType: 'CONTROL_WARD' });
  ev(1100000, { type: 'WARD_PLACED', creatorId: 1, wardType: 'UNDEFINED' });
  ev(800000, { type: 'WARD_KILL', killerId: 1, wardType: 'YELLOW_TRINKET' });
  const kda = { 1: [1, 2, 0], 6: [1, 1, 1], 7: [2, 0, 1] };
  const match = {
    metadata: { matchId: 'EUW1_7300000099' },
    info: {
      gameId: 7300000099, platformId: 'EUW1', gameVersion: '16.3.701.2033', gameDuration: 1200, gameEndTimestamp: 1, gameStartTimestamp: 1763560000000,
      participants: P.map(([id, puuid, championName, teamId, teamPosition, riotIdGameName, riotIdTagline]) => ({
        participantId: id, puuid, championName, teamId, teamPosition, riotIdGameName, riotIdTagline, win: teamId === 200,
        kills: (kda[id] || [0])[0], deaths: (kda[id] || [0, 0])[1], assists: (kda[id] || [0, 0, 0])[2]
      }))
    }
  };
  return { match, timeline: { metadata: { matchId: 'EUW1_7300000099' }, info: { frameInterval: 60000, frames } } };
};
