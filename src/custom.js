// Parties personnalisées (scrims) : Riot ne les donne pas par son API, mais le client LoL du joueur les a dans son
// historique. Il les donne au format « match-v4 » (participants[].stats, participantIdentities, timeline en frames) ;
// on les convertit au format match-v5 utilisé partout ailleurs (sync.gameFromMatch, moments.buildMoments).
const { assignPositions, POSITIONS } = require('./live');

const isCustom = g => !!g && (g.gameType === 'CUSTOM_GAME' || g.queueId === 0);
const SR = 11; // Faille de l'invocateur : la seule carte gérée par les moments clés

// Liste « /lol-match-history/v1/products/lol/current-summoner/matches » → parties personnalisées, la plus récente d'abord
function listCustoms(resp, champKeys = {}) {
  const raw = resp && resp.games ? (Array.isArray(resp.games) ? resp.games : resp.games.games) : null;
  return (Array.isArray(raw) ? raw : []).filter(isCustom).map(g => {
    const p = (g.participants || [])[0] || {};
    const st = p.stats || {};
    return {
      gameId: g.gameId, platformId: g.platformId || '', date: g.gameCreation || 0, duration: Math.round(g.gameDuration || 0),
      mode: g.gameMode || '', mapId: g.mapId, sr: g.mapId === SR,
      champion: champKeys[String(p.championId)] || null, win: !!st.win, kda: [st.kills || 0, st.deaths || 0, st.assists || 0]
    };
  }).sort((a, b) => b.date - a.date);
}

// Poste d'après la timeline v4 (lane + role), '' si inconnu
function v4Position(p) {
  const t = p.timeline || {};
  const lane = String(t.lane || '').toUpperCase();
  const role = String(t.role || '').toUpperCase();
  if (lane === 'TOP') return 'TOP';
  if (lane === 'JUNGLE') return 'JUNGLE';
  if (lane === 'MIDDLE' || lane === 'MID') return 'MIDDLE';
  if (lane === 'BOTTOM' || lane === 'BOT') return role === 'DUO_SUPPORT' ? 'UTILITY' : role === 'DUO_CARRY' ? 'BOTTOM' : '';
  return '';
}

// Partie déjà au format v5 (certaines versions du client) : rien à faire
const isV5 = g => !!(g && g.info && Array.isArray(g.info.participants));

function toV5(game, timeline, champKeys = {}, rates = null) {
  if (isV5(game)) return { match: game, tl: timeline && timeline.info ? timeline : timeline ? { info: timeline } : null };
  if (!game || !Array.isArray(game.participants)) throw new Error('Partie illisible dans le client LoL.');
  const ids = new Map((game.participantIdentities || []).map(x => [x.participantId, x.player || {}]));
  const parts = game.participants.map(p => {
    const id = ids.get(p.participantId) || {};
    const st = p.stats || {};
    const out = {
      participantId: p.participantId, puuid: id.puuid || null, championId: p.championId,
      championName: p.championName || champKeys[String(p.championId)] || '', teamId: p.teamId,
      teamPosition: v4Position(p), individualPosition: v4Position(p),
      riotIdGameName: id.gameName || id.summonerName || '', riotIdTagline: id.tagLine || '', summonerName: id.summonerName || '',
      summoner1Id: p.spell1Id, summoner2Id: p.spell2Id, win: !!st.win,
      kills: st.kills || 0, deaths: st.deaths || 0, assists: st.assists || 0,
      totalMinionsKilled: st.totalMinionsKilled || 0, neutralMinionsKilled: st.neutralMinionsKilled || 0,
      goldEarned: st.goldEarned || 0, totalDamageDealtToChampions: st.totalDamageDealtToChampions || 0,
      visionScore: st.visionScore || 0, wardsPlaced: st.wardsPlaced || 0, wardsKilled: st.wardsKilled || 0,
      visionWardsBoughtInGame: st.visionWardsBoughtInGame || 0, champLevel: st.champLevel || 0
    };
    for (let i = 0; i <= 6; i++) out['item' + i] = st['item' + i] || 0;
    return out;
  });
  // postes : ceux du client s'ils sont complets et sans doublon, sinon devinés (champions + sorts)
  for (const team of [100, 200]) {
    const list = parts.filter(p => p.teamId === team);
    const pos = list.map(p => p.teamPosition);
    const ok = list.length === 5 && pos.every(Boolean) && new Set(pos).size === 5;
    if (ok) continue;
    const guess = assignPositions(list.map(p => ({ championId: p.championId, spells: [p.summoner1Id, p.summoner2Id] })), rates);
    list.forEach((p, i) => { p.teamPosition = p.individualPosition = guess ? guess[i] : ''; });
  }
  const dur = Math.round(game.gameDuration > 20000 ? game.gameDuration / 1000 : game.gameDuration || 0); // secondes
  const start = game.gameCreation || 0;
  const match = {
    metadata: { matchId: (game.platformId || 'EUW1') + '_' + game.gameId },
    info: {
      gameId: game.gameId, platformId: game.platformId || 'EUW1', gameVersion: game.gameVersion || '', gameMode: game.gameMode || '',
      gameType: 'CUSTOM_GAME', queueId: 0, mapId: game.mapId, gameCreation: start, gameStartTimestamp: start,
      gameDuration: dur, gameEndTimestamp: start + dur * 1000, participants: parts
    }
  };
  return { match, tl: timeline ? timelineToV5(timeline, parts) : null };
}

// Timeline v4 ({ frames }) → v5 ({ info: { frames } }) : équipe du tueur des monstres, niveaux (LEVEL_UP) déduits
function timelineToV5(tl, parts) {
  const frames = Array.isArray(tl.frames) ? tl.frames : tl.info && Array.isArray(tl.info.frames) ? tl.info.frames : [];
  const teamOf = id => { const p = parts.find(x => x.participantId === id); return p ? p.teamId : undefined; };
  const hasLevel = frames.some(f => (f.events || []).some(e => e.type === 'LEVEL_UP'));
  const skills = {};
  const out = frames.map(f => {
    const pf = {};
    for (const [k, v] of Object.entries(f.participantFrames || {})) pf[String(v && v.participantId ? v.participantId : k)] = v;
    const events = [];
    for (const e of f.events || []) {
      const x = Object.assign({}, e);
      if (x.type === 'ELITE_MONSTER_KILL' && x.killerTeamId === undefined) x.killerTeamId = teamOf(x.killerId);
      events.push(x);
      // pas de LEVEL_UP dans le format v4 : chaque point de compétence « normal » correspond à un niveau
      if (!hasLevel && x.type === 'SKILL_LEVEL_UP' && (x.levelUpType || 'NORMAL') === 'NORMAL') {
        const n = (skills[x.participantId] = (skills[x.participantId] || 0) + 1);
        events.push({ type: 'LEVEL_UP', participantId: x.participantId, level: n, timestamp: x.timestamp });
      }
    }
    return { timestamp: f.timestamp, participantFrames: pf, events };
  });
  return { info: { frameInterval: 60000, frames: out } };
}

// Partie enregistrée pour un joueur : uniquement ces champs (ce qui vient du serveur n'est pas pris tel quel)
const GAME_KEYS = ['matchId', 'playerId', 'date', 'role', 'champion', 'opponent', 'win', 'duration', 'kills', 'deaths', 'assists', 'teamKills',
  'cs', 'gold', 'damage', 'vision', 'wardsPlaced', 'wardsKilled', 'pinks', 'level', 'side', 'cs10', 'goldDiff10', 'xpDiff10', 'goldDiff15', 'deaths15'];
function cleanGame(g) {
  if (!g || typeof g !== 'object' || !/^[A-Z0-9]{2,5}_\d{5,15}$/.test(String(g.matchId)) || !g.playerId) return null;
  const out = {};
  for (const k of GAME_KEYS) {
    const v = g[k];
    if (k === 'matchId' || k === 'playerId' || k === 'role' || k === 'champion' || k === 'opponent' || k === 'side') out[k] = String(v || '').slice(0, 40);
    else if (k === 'win') out[k] = !!v;
    else out[k] = typeof v === 'number' && Number.isFinite(v) ? v : null;
  }
  return Object.assign(out, { lpDelta: null, mental: null, objectiveMet: null, comment: '', custom: true });
}

module.exports = { isCustom, listCustoms, toV5, timelineToV5, cleanGame, v4Position, SR, POSITIONS };
