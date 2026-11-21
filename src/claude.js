// Analyses par Claude, sans API : l'app du coach prépare chaque partie envoyée par un joueur dans un dossier
// (vidéos, dossier de partie, consignes) ; Claude, dans une conversation reliée à l'ordinateur du coach, y écrit
// « analyse-claude.json » ; l'app le reprend comme brouillons de réponses que le coach relit avant d'envoyer.
const { mmss } = require('./moments');
const { videoAt } = require('./replay');

const RESULT = 'analyse-claude.json';
const MANIFEST = 'a-analyser.json';
const MAX_TEXT = 2000; // longueur maximale d'un message dans la discussion

const clean = s => String(s || '').replace(/[\\/:*?"<>|\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim();

// « 2026-11-20 Uawawa Darius contre Garen [a1b2c3d4] » : l'identifiant entre crochets relie le dossier à l'analyse
function folderName(a, { playerName, label }) {
  const day = new Date(a.createdAt || Date.now()).toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
  return clean(`${day} ${playerName || 'Joueur'} ${label || ''}`).slice(0, 90) + ` [${String(a.id).slice(0, 8)}]`;
}
function idFromFolder(name) {
  const m = /\[([0-9a-f]{8})\]$/.exec(String(name || ''));
  return m ? m[1] : null;
}

// Titre lisible d'un moment, avec les noms français des champions
function momentTitle(x, champName = c => c) {
  return String(x.title || '').replace(/(tué par|Kill sur) (\w+)/, (a, b, c) => b + ' ' + champName(c));
}

// Fiche « a-analyser.json » : tout ce que Claude doit savoir, moment par moment
function manifest(a, m, { playerName, label, champName = c => c }) {
  const clips = Array.isArray(a.clips) ? a.clips : [];
  const clipOf = t => clips.find(c => t / 1000 >= c.start - 1 && t / 1000 <= c.end + 1) || null;
  const comments = Array.isArray(a.comments) ? a.comments : [];
  const said = t => comments.filter(c => c.t === t).map(c => ({ auteur: c.author === 'coach' ? 'coach' : 'joueur', texte: c.text }));
  const me = (m.participants || []).find(p => p.id === m.me) || {};
  return {
    version: 1,
    analysisId: a.id,
    joueur: playerName || 'Joueur',
    partie: label || '',
    champion: champName(me.champion),
    matchId: a.matchId,
    envoyeeLe: a.createdAt || null,
    noteDuJoueur: a.note || '',
    discussionGenerale: said(null),
    videos: clips.map(c => ({
      fichier: 'videos/' + c.file, debut: c.start, fin: c.end,
      // seconde 0 de la vidéo = « debut » en temps de jeu, décalée de « lead » ; « sync » : [seconde de la vidéo, temps de jeu]
      // mesurés pendant le tournage (pauses du replay comprises). Ancienne vidéo sans sync : ±1 s.
      lead: typeof c.lead === 'number' ? c.lead : null,
      sync: Array.isArray(c.sync) ? c.sync : null,
      moments: (m.moments || []).filter(x => clipOf(x.t) === c).map(x => x.t)
    })),
    moments: (m.moments || []).map(x => {
      const c = clipOf(x.t);
      return {
        t: x.t, temps: mmss(x.t), type: x.type, titre: momentTitle(x, champName),
        video: c ? 'videos/' + c.file : null,
        secondeDansLaVideo: c ? Math.round(videoAt(c, x.t / 1000) * 10) / 10 : null,
        discussion: said(x.t)
      };
    }),
    aRendre: {
      fichier: RESULT,
      format: {
        version: 1, analysisId: a.id,
        general: 'Résumé de la partie pour le joueur (moins de 1200 caractères).',
        priorites: ['Priorité 1', 'Priorité 2', 'Priorité 3'],
        moments: [{ t: 'le « t » exact du moment, en millisecondes', texte: 'Ce qui s\'est passé, l\'erreur probable, le meilleur move, ta confiance (moins de 1200 caractères).' }]
      }
    }
  };
}

const cut = s => { const t = String(s || '').trim(); return t.length > MAX_TEXT ? t.slice(0, MAX_TEXT - 1).trimEnd() + '…' : t; };

// Lit la réponse de Claude et en fait des brouillons : { general, moments: { [t]: texte } }
function parseResult(json, man) {
  const errors = [];
  if (!json || typeof json !== 'object') return { ok: false, errors: ['Le fichier n\'est pas un objet JSON.'] };
  if (json.analysisId !== man.analysisId) errors.push('analysisId différent de celui de a-analyser.json.');
  const ts = (man.moments || []).map(x => x.t);
  const moments = {};
  for (const x of Array.isArray(json.moments) ? json.moments : []) {
    const t = Number(x && x.t);
    const text = cut(x && x.texte);
    if (!text) continue;
    // t exact, sinon le moment le plus proche à 2 s près
    const near = ts.reduce((b, v) => (Math.abs(v - t) < Math.abs(b - t) ? v : b), Infinity);
    if (!Number.isFinite(t) || !Number.isFinite(near) || Math.abs(near - t) > 2000) { errors.push('Moment inconnu : ' + (x && x.t)); continue; }
    moments[near] = text;
  }
  const prio = (Array.isArray(json.priorites) ? json.priorites : []).map(p => String(p || '').trim()).filter(Boolean).slice(0, 5);
  let general = String(json.general || '').trim();
  if (prio.length) general += (general ? '\n\n' : '') + 'Priorités de travail :\n' + prio.map((p, i) => (i + 1) + '. ' + p).join('\n');
  general = cut(general);
  if (!general && !Object.keys(moments).length) errors.push('Aucun texte : ni « general » ni « moments ».');
  if (errors.length && (json.analysisId !== man.analysisId || (!general && !Object.keys(moments).length))) return { ok: false, errors };
  return { ok: true, errors, draft: { general, moments } };
}

const README = `Dossier « Analyses pour Claude » de Coaching LoL
=================================================

L'app Coaching LoL dépose ici chaque partie qu'un joueur envoie au coach :
  - a-analyser.json : la fiche (moments, vidéos, commentaires du joueur)
  - dossier.txt     : le dossier de la partie (lanes, vision, chaque moment)
  - partie.json     : toutes les données de la partie (positions, participants)
  - videos/         : les extraits filmés par le joueur (35 s avant chaque moment, 10 s après),
                      caméra sur le joueur, interface du replay épurée (sans panneau de lecture ni chat) :
                      tableau des scores, mini-carte et barres de vie visibles. « secondeDansLaVideo »
                      (a-analyser.json) donne la seconde exacte de chaque moment dans sa vidéo.

Pour lancer l'analyse : dans une conversation Claude reliée à cet ordinateur, demander
« analyse les nouvelles parties ». Claude lit chaque dossier sans « ${RESULT} »,
suit la méthode du coach (methode-coach.md, modifiable) et écrit « ${RESULT} ».

L'app reprend ce fichier toute seule : dans « Analyses », les réponses proposées par Claude
apparaissent en brouillon sur chaque moment. Le coach les relit, les corrige et les envoie.

Quand l'analyse est terminée, l'app retire les vidéos de ce dossier (le reste est gardé).
Pour redemander une analyse : supprimer « ${RESULT} » du dossier de la partie.
`;

const METHOD = `# Méthode d'analyse du coach

Ce texte guide Claude quand il analyse une partie. Modifie-le librement : Claude le relit à chaque analyse.

## Ton et format
- Tutoiement, phrases courtes, vocabulaire de LoL en français (wave, trade, back, reset, gank, vision, tempo).
- Pour chaque moment : 1) ce qui s'est passé, 2) l'erreur probable (ou ce qui était bien), 3) le meilleur move,
  4) la confiance (haute, moyenne, basse) et pourquoi.
- Rester factuel : ne parler que de ce qui se voit sur les images ou dans les données. Si un doute existe
  (sorts d'invocateur, timers), le dire.
- Pas plus de 3 priorités de travail pour la partie, concrètes et vérifiables à la prochaine partie.

## Ce que je regarde en priorité
1. Les morts : position sur la carte, vision avant la mort, jungler adverse visible ou non, état de la wave.
2. Les objectifs perdus : où était le joueur, aurait-il pu arriver avant, prio de lane avant l'objectif.
3. Les retours (back) : timing avec la wave, or dépensé, objectif qui arrive.
4. La phase de lane : écart de CS et d'or à 10 et 15 min, trades.

## Ce que je ne veux pas
- Juger le joueur. On parle du move, pas de la personne.
- Des conseils génériques (« ward plus ») sans dire où et quand.
`;

module.exports = { RESULT, MANIFEST, MAX_TEXT, folderName, idFromFolder, manifest, parseResult, momentTitle, README, METHOD };
