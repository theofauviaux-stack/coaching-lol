// Client de l'API Riot (clé personnelle ou de développement).
// Respecte les limites d'une clé de développement : 20 req/s et 100 req/2 min → une requête toutes les 1,3 s.

const REGIONS = {
  euw: ['euw1', 'europe'], eune: ['eun1', 'europe'], tr: ['tr1', 'europe'], ru: ['ru', 'europe'], me: ['me1', 'europe'],
  na: ['na1', 'americas'], br: ['br1', 'americas'], lan: ['la1', 'americas'], las: ['la2', 'americas'],
  kr: ['kr', 'asia'], jp: ['jp1', 'asia'],
  oce: ['oc1', 'sea'], sg: ['sg2', 'sea'], tw: ['tw2', 'sea'], vn: ['vn2', 'sea']
};

class RiotError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

class RiotClient {
  constructor(apiKey, opts = {}) {
    this.apiKey = apiKey;
    this.fetch = opts.fetch || globalThis.fetch;
    this.delayMs = opts.delayMs !== undefined ? opts.delayMs : 1300;
    this.sleep = opts.sleep || (ms => new Promise(r => setTimeout(r, ms)));
    this.last = 0;
  }

  async get(url) {
    if (!this.apiKey) throw new RiotError('Clé API Riot absente : va dans Paramètres pour la renseigner.', 'NO_KEY');
    for (let attempt = 0; attempt < 5; attempt++) {
      const wait = this.last + this.delayMs - Date.now();
      if (wait > 0) await this.sleep(wait);
      this.last = Date.now();
      let res;
      try {
        res = await this.fetch(url, { headers: { 'X-Riot-Token': this.apiKey } });
      } catch (e) {
        if (attempt === 4) throw new RiotError('Pas de connexion à l\'API Riot (' + e.message + ').', 'NETWORK');
        await this.sleep(2000);
        continue;
      }
      if (res.status === 200) return res.json();
      if (res.status === 404) return null;
      if ((res.status === 401 || res.status === 403) && !this.keyRetried) {
        // un refus isolé arrive parfois juste après la création d'une clé : on réessaie une fois
        this.keyRetried = true;
        await this.sleep(1500);
        continue;
      }
      if (res.status === 401 || res.status === 403) {
        throw new RiotError('Clé API refusée (' + res.status + ') : elle a peut-être expiré. Une clé de développement dure 24 h.', 'KEY');
      }
      if (res.status === 429) {
        const ra = Number((res.headers && res.headers.get && res.headers.get('retry-after')) || 10);
        await this.sleep((ra + 1) * 1000);
        continue;
      }
      if (res.status >= 500) { await this.sleep(3000); continue; }
      throw new RiotError('Erreur API ' + res.status, 'HTTP');
    }
    throw new RiotError('API Riot indisponible après plusieurs essais.', 'UNAVAILABLE');
  }

  routes(region) {
    const r = REGIONS[(region || '').toLowerCase()];
    if (!r) throw new RiotError('Région inconnue : ' + region, 'REGION');
    return { platform: r[0], regional: r[1], account: r[1] === 'sea' ? 'asia' : r[1] };
  }

  async account(gameName, tagLine, region) {
    const { account } = this.routes(region);
    return this.get(`https://${account}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`);
  }

  async matchIds(puuid, region, { queue = 420, count = 100, start = 0, startTime } = {}) {
    const { regional } = this.routes(region);
    let url = `https://${regional}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=${queue}&start=${start}&count=${count}`;
    if (startTime) url += `&startTime=${Math.floor(startTime / 1000)}`;
    return (await this.get(url)) || [];
  }

  async match(id, region) {
    const { regional } = this.routes(region);
    return this.get(`https://${regional}.api.riotgames.com/lol/match/v5/matches/${id}`);
  }

  async timeline(id, region) {
    const { regional } = this.routes(region);
    return this.get(`https://${regional}.api.riotgames.com/lol/match/v5/matches/${id}/timeline`);
  }

  async leagues(puuid, region) {
    const { platform } = this.routes(region);
    return (await this.get(`https://${platform}.api.riotgames.com/lol/league/v4/entries/by-puuid/${puuid}`)) || [];
  }

  async status(region) {
    const { platform } = this.routes(region || 'euw');
    return this.get(`https://${platform}.api.riotgames.com/lol/status/v4/platform-data`);
  }
}

module.exports = { RiotClient, RiotError, REGIONS };
