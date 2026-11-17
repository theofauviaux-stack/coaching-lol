// Stockage local : un fichier JSON dans le dossier de données de l'application.
// Écriture atomique (fichier temporaire puis renommage) et une sauvegarde de la version précédente.
const fs = require('fs');
const path = require('path');

const DEFAULT_OBJECTIVES = {
  // indicateur: { sens, Top, Jungle, Mid, ADC, Support }
  'Taux de victoire': { sens: '≥', Top: 0.55, Jungle: 0.55, Mid: 0.55, ADC: 0.55, Support: 0.55 },
  'KDA': { sens: '≥', Top: 3, Jungle: 3, Mid: 3, ADC: 3, Support: 3 },
  'KP': { sens: '≥', Top: 0.5, Jungle: 0.65, Mid: 0.55, ADC: 0.55, Support: 0.65 },
  'Morts moyennes': { sens: '≤', Top: 5, Jungle: 5, Mid: 5, ADC: 5, Support: 6 },
  'CS/min': { sens: '≥', Top: 7, Jungle: 6, Mid: 7.5, ADC: 8, Support: null },
  'CS à 10 min': { sens: '≥', Top: 70, Jungle: 55, Mid: 75, ADC: 80, Support: null },
  'Or/min': { sens: '≥', Top: 400, Jungle: 380, Mid: 420, ADC: 430, Support: 280 },
  'Dégâts/min': { sens: '≥', Top: 600, Jungle: 500, Mid: 700, ADC: 700, Support: 300 },
  'Vision/min': { sens: '≥', Top: 1.0, Jungle: 1.3, Mid: 1.0, ADC: 0.9, Support: 2.2 },
  'Wards posées': { sens: '≥', Top: 8, Jungle: 10, Mid: 8, ADC: 8, Support: 25 },
  'Wards détruites': { sens: '≥', Top: 3, Jungle: 5, Mid: 3, ADC: 2, Support: 6 },
  'Pinks achetées': { sens: '≥', Top: 2, Jungle: 3, Mid: 2, ADC: 2, Support: 4 },
  'Écart or à 10 min': { sens: '≥', Top: 0, Jungle: 0, Mid: 0, ADC: 0, Support: 0 },
  'Écart XP à 10 min': { sens: '≥', Top: 0, Jungle: 0, Mid: 0, ADC: 0, Support: 0 },
  'Écart or à 15 min': { sens: '≥', Top: 0, Jungle: 0, Mid: 0, ADC: 0, Support: 0 },
  'Morts avant 15 min': { sens: '≤', Top: 2, Jungle: 2, Mid: 2, ADC: 2, Support: 2 },
  'LP net': { sens: '≥', Top: 0, Jungle: 0, Mid: 0, ADC: 0, Support: 0 },
  'Note mentale': { sens: '≥', Top: 3.5, Jungle: 3.5, Mid: 3.5, ADC: 3.5, Support: 3.5 },
  '% objectifs de partie atteints': { sens: '≥', Top: 0.7, Jungle: 0.7, Mid: 0.7, ADC: 0.7, Support: 0.7 }
};

const DEFAULT_AXES = [
  'P1 Fondamentaux – last hit et CS', 'P1 Fondamentaux – combos et mécaniques', 'P1 Fondamentaux – champion pool réduit',
  'P2 Laning – gestion des vagues', 'P2 Laning – trades et niveaux', 'P2 Laning – tracking du jungler', 'P2 Laning – vision',
  'P3 Survie – minimap', 'P3 Survie – morts évitables', 'P3 Survie – resets intelligents',
  'P4 Macro – side lane ou groupe', 'P4 Macro – timing des roams', 'P4 Macro – win condition personnelle',
  'P4 Macro – objectifs neutres', 'P5 Mental – règle de stop et tilt', 'P5 Mental – routine et hygiène',
  'Diagnostic initial', 'Bilan de cycle'
];

function emptyData() {
  return {
    version: 1,
    settings: {
      apiKey: '',
      autoSyncMinutes: 30,
      maxGamesPerSync: 30,
      ddVersion: '',
      cards: ['Taux de victoire', 'KDA', 'KP', 'CS/min', 'Écart or à 15 min', 'Morts avant 15 min', 'Vision/min', 'LP net'],
      objectives: JSON.parse(JSON.stringify(DEFAULT_OBJECTIVES)),
      axes: DEFAULT_AXES.slice(),
      lastSync: null
    },
    players: [],
    games: [],
    ignored: [],
    ranks: [],
    sessions: [],
    reports: []
  };
}

class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'coaching-data.json');
    fs.mkdirSync(dir, { recursive: true });
    this.data = this._load();
  }

  _load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const d = JSON.parse(raw);
      const base = emptyData();
      // compléter les champs ajoutés dans une version ultérieure
      d.settings = Object.assign(base.settings, d.settings || {});
      for (const k of ['players', 'games', 'ignored', 'ranks', 'sessions', 'reports']) if (!Array.isArray(d[k])) d[k] = [];
      for (const [k, v] of Object.entries(DEFAULT_OBJECTIVES)) if (!d.settings.objectives[k]) d.settings.objectives[k] = v;
      return d;
    } catch (e) {
      if (fs.existsSync(this.file)) {
        // fichier illisible : on le met de côté au lieu de l'écraser
        fs.copyFileSync(this.file, this.file + '.illisible-' + Date.now());
      }
      return emptyData();
    }
  }

  save() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1), 'utf8');
    if (fs.existsSync(this.file)) fs.copyFileSync(this.file, this.file + '.bak');
    fs.renameSync(tmp, this.file);
  }

  replaceAll(d) {
    const base = emptyData();
    d.settings = Object.assign(base.settings, d.settings || {});
    for (const k of ['players', 'games', 'ignored', 'ranks', 'sessions', 'reports']) if (!Array.isArray(d[k])) d[k] = [];
    this.data = d;
    this.save();
  }
}

module.exports = { Store, emptyData, DEFAULT_OBJECTIVES, DEFAULT_AXES };
