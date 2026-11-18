'use strict';
// Banque d'exercices du coach, rangée par thème (programme « Jeu individuel »).
// Le coach en choisit à chaque séance ; le joueur les fait chez lui, puis remplit sa fiche.
//   target : cible chiffrée, adaptée au rôle (le coach peut la changer dans la séance)
//   fields : ce que le joueur note dans sa fiche (number, time « m:ss », text, score 1-5, yesno)
//   kpi    : indicateur mesuré automatiquement sur les parties classées depuis la séance
//   schema : dessin de l'exercice (voir schemas.js)
const Exercises = (() => {
  const DODGE = { label: 'Ouvrir LoL Dodge Game', url: 'https://loldodgegame.com/play/' };

  const THEMES = [
    { id: 'farm', t: 'Farm et last hit', icon: 'wheat' },
    { id: 'meca', t: 'Mécanique', icon: 'target' },
    { id: 'lane', t: 'Phase de laning', icon: 'sword' },
    { id: 'survie', t: 'Survie et carte', icon: 'eye' },
    { id: 'macro', t: 'Macro individuel', icon: 'dashboard' },
    { id: 'mental', t: 'Mental et routine', icon: 'brain' },
    { id: 'review', t: 'Review de partie', icon: 'edit' }
  ];

  const LIST = [
    // ------------------------------------------------------------------ farm
    {
      id: 'cs10-perso', theme: 'farm', title: 'CS à 10 min en partie personnalisée', where: 'Partie personnalisée', duration: '3 × 10 min',
      roles: ['Top', 'Mid', 'ADC'],
      why: 'Le farm est la première source d\'or : chaque vague ratée, c\'est un objet en retard.',
      steps: [
        'Lance une partie personnalisée seul sur la Faille, sur ta lane, avec ton champion principal.',
        'Farm uniquement au last hit pendant 10 minutes. Garde tes sorts pour les sbires que tu allais rater.',
        'Vérifie tes repères à 2, 4, 6 et 8 min (schéma). À 10:00, note ton total.',
        'Fais 3 essais et garde le meilleur.'
      ],
      target: { label: 'CS à 10 min', sens: '≥', byRole: { Mid: 110, Top: 100, ADC: 100 }, def: 100 },
      fields: [
        { k: 'cs', label: 'Meilleur score : CS à 10 min', type: 'number', target: true },
        { k: 'essais', label: 'Nombre d\'essais', type: 'number' }
      ],
      kpi: 'CS à 10 min',
      schema: { type: 'curve', build: c => ({ target: Number(c.target) || 100, caption: 'Repères à suivre pendant l\'essai : si tu es en dessous à 4 min, tu as raté trop de sbires au début.' }) }
    },
    {
      id: 'cs-tour', theme: 'farm', title: 'Last hit sous la tourelle', where: 'Practice tool', duration: '10 min',
      roles: ['Top', 'Mid', 'ADC'],
      why: 'Les sbires perdus sous la tour coûtent cher après un retour à la base ou un gank.',
      steps: [
        'Dans le practice tool, laisse la vague adverse pousser sous ta tourelle.',
        'Sbire mêlée : laisse la tour frapper 2 fois, puis finis-le à l\'auto.',
        'Sbire à distance : une auto d\'abord, puis la tour frappe, puis ton auto pour finir.',
        'Joue 5 vagues et compte les sbires perdus. Avec plus de dégâts (objets), adapte le rythme.'
      ],
      target: { label: 'Sbires perdus sur 5 vagues', sens: '≤', def: 3 },
      fields: [{ k: 'perdus', label: 'Sbires perdus sur 5 vagues', type: 'number', target: true }],
      schema: {
        type: 'rows', caption: 'Rythme de base en début de partie : la tour fait l\'essentiel, ton auto finit le sbire.',
        rows: [
          { label: 'Sbire mêlée', chips: [{ t: 'Tour' , k: 'stop' }, { t: 'Tour', k: 'stop' }, { t: 'Ton auto : last hit', k: 'ok' }] },
          { label: 'Sbire à distance', chips: [{ t: 'Ton auto', k: 'info' }, { t: 'Tour', k: 'stop' }, { t: 'Ton auto : last hit', k: 'ok' }] }
        ]
      }
    },
    {
      id: 'jungle-clear', theme: 'farm', title: 'Full clear chronométré', where: 'Partie personnalisée', duration: '3 essais',
      roles: ['Jungle'],
      why: 'Un clear rapide et propre te donne l\'avance de niveau et le choix de ton premier gank.',
      steps: [
        'Lance une partie personnalisée seul, avec ton jungler principal.',
        'Fais ton chemin complet (6 camps) en partant de ton buff habituel. Exemple côté bleu : Rouge, Krugs, Raptors, Loups, Bleu, Gromp.',
        'Note le temps à la fin du dernier camp et tes PV restants.',
        '3 essais : garde le meilleur temps.'
      ],
      target: { label: 'Temps du full clear', sens: '≤', type: 'time', def: '3:30' },
      fields: [
        { k: 'temps', label: 'Meilleur temps (m:ss)', type: 'time', target: true },
        { k: 'pv', label: 'PV restants à la fin (%)', type: 'number' }
      ],
      schema: {
        type: 'map', caption: 'Exemple de chemin côté bleu, en partant du buff rouge. Ton coach peut t\'en donner un autre.',
        paths: [{ pts: ['bRouge', 'bKrugs', 'bRaptors', 'bLoups', 'bBleu', 'bGromp'] }],
        markers: [
          { at: 'bRouge', t: 'Buff rouge (départ, avec la laisse de ton bot)' },
          { at: 'bKrugs', t: 'Krugs' }, { at: 'bRaptors', t: 'Raptors' }, { at: 'bLoups', t: 'Loups' },
          { at: 'bBleu', t: 'Buff bleu' }, { at: 'bGromp', t: 'Gromp : fin du clear, regarde le chrono' }
        ]
      }
    },
    {
      id: 'farming-practice', theme: 'farm', title: 'Farming Practice (LoL Dodge Game)', where: 'LoL Dodge Game', duration: '10 min',
      why: 'Échauffement du timing de last hit, sans lancer de partie.',
      link: DODGE,
      steps: [
        'Ouvre LoL Dodge Game et choisis le module « Farming Practice ».',
        'Fais 3 parties d\'affilée : un clic au moment exact où le sbire peut mourir, pas avant.',
        'Note ton meilleur score affiché.'
      ],
      fields: [{ k: 'score', label: 'Meilleur score', type: 'number' }],
      schema: { type: 'timeline', from: 0, to: 10, segs: [{ a: 0, b: 3, t: 'Partie 1', k: 'info' }, { a: 3.5, b: 6.5, t: 'Partie 2', k: 'info' }, { a: 7, b: 10, t: 'Partie 3', k: 'ok' }], caption: '3 parties courtes à la suite, puis tu notes ton meilleur score.' }
    },

    // ------------------------------------------------------------------ mécanique
    {
      id: 'dodging', theme: 'meca', title: 'League of Dodging (LoL Dodge Game)', where: 'LoL Dodge Game', duration: '5 à 10 min',
      why: 'Esquiver un sort, c\'est gagner un trade sans dépenser de PV.',
      link: DODGE,
      steps: [
        'Ouvre LoL Dodge Game, module « League of Dodging ».',
        'Esquive par de petits clics sur le côté de la trajectoire, jamais en reculant dans l\'axe du sort.',
        'Fais 5 essais et note ton meilleur score.'
      ],
      fields: [{ k: 'score', label: 'Meilleur score sur 5 essais', type: 'number' }],
      schema: { type: 'arena', mode: 'dodge', caption: 'Sortir de la trajectoire par le côté est plus rapide que reculer.' }
    },
    {
      id: 'skillshots', theme: 'meca', title: 'League of Skillshots (LoL Dodge Game)', where: 'LoL Dodge Game', duration: '5 à 10 min',
      why: 'Toucher ses sorts, c\'est ce qui fait gagner les trades et les combats.',
      link: DODGE,
      steps: [
        'Ouvre LoL Dodge Game, module « League of Skillshots ».',
        'Vise là où la cible va être, pas là où elle est.',
        'Fais 5 essais et note ton meilleur score.'
      ],
      fields: [{ k: 'score', label: 'Meilleur score sur 5 essais', type: 'number' }],
      schema: { type: 'arena', mode: 'aim', caption: 'Anticipe : le sort met du temps à arriver, la cible continue de bouger.' }
    },
    {
      id: 'kiting', theme: 'meca', title: 'Kiting Trainer (LoL Dodge Game)', where: 'LoL Dodge Game', duration: '5 à 10 min',
      roles: ['ADC', 'Mid', 'Top'],
      why: 'Attaquer en se déplaçant permet de faire des dégâts sans se faire toucher.',
      link: DODGE,
      steps: [
        'Dans le jeu, active l\'attaque-déplacement (touche A + clic) si ce n\'est pas fait.',
        'Ouvre LoL Dodge Game, module « Kiting Trainer ».',
        'Rythme : une auto, un pas, une auto. Ne coupe pas l\'animation d\'attaque.',
        'Note ton meilleur score sur 5 essais.'
      ],
      fields: [{ k: 'score', label: 'Meilleur score sur 5 essais', type: 'number' }],
      schema: { type: 'rows', caption: 'Le pas se fait pendant le temps de recharge de l\'attaque.', rows: [{ label: 'Le rythme', chips: [{ t: 'Auto', k: 'ok' }, { t: 'Pas', k: 'info' }, { t: 'Auto', k: 'ok' }, { t: 'Pas', k: 'info' }, { t: 'Auto', k: 'ok' }] }] }
    },
    {
      id: 'combo', theme: 'meca', title: 'Combos du champion', where: 'Practice tool', duration: '10 min',
      why: 'Un combo maîtrisé se fait sans réfléchir : tu peux regarder l\'adversaire plutôt que tes touches.',
      steps: [
        'Practice tool, sur un mannequin.',
        'Répète le combo donné par ton coach 20 fois lentement, puis 20 fois à vitesse de jeu.',
        'Fais-le aussi à la limite de portée : tu dois connaître la distance exacte.',
        'Note combien de combos sont réussis sur les 20 derniers.'
      ],
      target: { label: 'Combos réussis sur 20', sens: '≥', def: 16 },
      fields: [
        { k: 'combo', label: 'Combo travaillé', type: 'text' },
        { k: 'reussis', label: 'Combos réussis sur 20', type: 'number', target: true }
      ],
      schema: { type: 'rows', caption: 'Exemple de structure : ton coach précise les touches de ton champion dans la consigne.', rows: [{ label: 'Combo type', chips: [{ t: 'Engage', k: 'info' }, { t: 'Auto', k: 'ok' }, { t: 'Dégâts', k: 'info' }, { t: 'Auto', k: 'ok' }, { t: 'Sortie', k: 'stop' }] }] }
    },

    // ------------------------------------------------------------------ laning
    {
      id: 'freeze', theme: 'lane', title: 'Un freeze réussi par partie', where: 'Parties classées', duration: 'Toute la semaine',
      roles: ['Top', 'Mid', 'ADC'],
      why: 'Bien placer la vague te protège des ganks et prive l\'adversaire de farm.',
      steps: [
        'Freeze : la vague reste juste devant ta tour, hors de sa portée. Ne tue que le sbire qui va mourir.',
        'Garde 3 ou 4 sbires adverses de plus que les tiens pour qu\'elle ne bouge pas.',
        'Fais-le quand tu as peur d\'un gank, ou pour forcer l\'adversaire à venir farmer près de toi.',
        'Slow push et crash : pour préparer un reset, un roam ou un objectif.'
      ],
      fields: [
        { k: 'parties', label: 'Parties jouées', type: 'number' },
        { k: 'reussis', label: 'Parties avec au moins un freeze réussi', type: 'number' }
      ],
      kpi: 'Écart or à 10 min',
      schema: {
        type: 'lane', caption: 'Tes sbires en bleu, ceux de l\'adversaire en rouge.',
        rows: [
          { t: 'Freeze', k: 'info', pos: 0.2, ally: 2, enemy: 5, note: 'Devant ta tour, hors de portée : l\'adversaire doit s\'avancer vers toi (et ton jungler) pour farmer.' },
          { t: 'Slow push', k: '', pos: 0.56, ally: 8, enemy: 3, push: 'right', note: 'Tu tues les sbires à distance en premier : ta vague grossit doucement.' },
          { t: 'Crash', k: 'ok', pos: 0.87, ally: 9, enemy: 0, push: 'right', note: 'La grosse vague arrive sur sa tour : tu peux reset, roam ou poser une ward.' }
        ]
      }
    },
    {
      id: 'vague-annonce', theme: 'lane', title: 'Annoncer l\'état de la vague', where: 'Review de VOD ou partie perso', duration: '1 partie',
      why: 'Voir où va la vague, c\'est savoir à l\'avance quand trader, reset ou roam.',
      steps: [
        'Sur une VOD de ta partie (ou en partie perso), toutes les 30 s, dis à voix haute ce que fait la vague.',
        'Trois réponses possibles : « elle vient vers moi », « elle va vers lui », « elle est stable ».',
        'Ajoute ce que ça te permet : trader, reset, regarder la carte, roam.'
      ],
      fields: [{ k: 'parties', label: 'VOD ou parties faites', type: 'number' }],
      schema: { type: 'timeline', from: 0, to: 6, unit: 'min', ticks: 1, segs: [{ a: 1, b: 2.5, t: 'Vers moi', k: 'info' }, { a: 2.5, b: 4, t: 'Stable', k: '' }, { a: 4, b: 5.5, t: 'Vers lui : crash', k: 'ok' }], marks: [{ at: 3.25, t: 'Annonce toutes les 30 s', k: 'ok' }, { at: 5.5, t: 'Crash : reset ou roam', k: 'ok' }], caption: 'Exemple de début de partie annoncé à voix haute.' }
    },
    {
      id: 'niveau2', theme: 'lane', title: 'Prendre le niveau 2 en premier', where: 'Partie perso puis classées', duration: 'Toute la semaine',
      roles: ['Top', 'Mid', 'ADC', 'Support'],
      why: 'Le premier à passer niveau 2 a un sort de plus : c\'est le meilleur moment pour trader.',
      steps: [
        'En partie perso, repère à quel sbire de la 2e vague tu passes niveau 2.',
        'En classée, place-toi pour prendre l\'XP de ce sbire avant ton adversaire.',
        'Au passage niveau 2, monte ton sort de trade et attaque tout de suite.',
        'Note combien de fois tu as gagné ce trade.'
      ],
      fields: [
        { k: 'parties', label: 'Parties jouées', type: 'number' },
        { k: 'gagnes', label: 'Trades niveau 2 gagnés', type: 'number' }
      ],
      schema: { type: 'flow', caption: 'Le moment exact dépend de ta lane : vérifie-le une fois en partie perso.', nodes: [{ t: '1re vague : farm propre' }, { t: '2e vague : prends l\'XP en premier', k: 'info' }, { t: 'Niveau 2 : nouveau sort', k: 'ok' }, { t: 'Trade tout de suite', k: 'ok' }] }
    },
    {
      id: 'jungler-255', theme: 'lane', title: 'Où est le jungler adverse à 2:55 ?', where: 'Parties classées + review', duration: 'Toute la semaine',
      why: 'La plupart des morts en début de partie viennent d\'un jungler qu\'on n\'a pas suivi.',
      steps: [
        'Au début de la partie, regarde de quel côté le jungler adverse a commencé (buff vu, laisse, ward).',
        'À 2:55, le carapateur apparaît : écris ou dis où est le jungler adverse (côté top, côté bot, sur un carapateur ou en train de reset).',
        'Joue en conséquence : s\'il arrive de ton côté, pas de trade loin de ta tour.',
        'En review, vérifie si ta prédiction était juste.'
      ],
      fields: [
        { k: 'parties', label: 'Parties jouées', type: 'number' },
        { k: 'justes', label: 'Prédictions justes', type: 'number' }
      ],
      kpi: 'Morts avant 15 min',
      schema: {
        type: 'map', caption: 'Exemple : il commence au buff bleu adverse (côté bot) et finit son premier clear côté top vers 2:55, quand le carapateur apparaît. S\'il commence côté top, inverse.',
        paths: [{ pts: ['rBleu', 'rGromp', 'rLoups', 'rRaptors', 'rRouge', 'rKrugs'], k: 'stop', dash: true }],
        zones: [{ at: [21, 37], r: 12, k: 'stop' }],
        markers: [
          { at: 'rBleu', t: 'Départ vu ici (buff bleu adverse)', k: 'stop' },
          { at: 'rKrugs', t: 'Vers 2:55 : fin de son clear côté top', k: 'stop' },
          { at: [21, 37], t: 'Zone dangereuse : carapateur du haut, top et mid', k: 'stop' }
        ]
      }
    },
    {
      id: 'vision', theme: 'lane', title: 'Une pink à chaque retour', where: 'Parties classées', duration: 'Toute la semaine',
      roles: ['Support', 'Jungle'],
      why: 'La vision permet de prendre les objectifs et d\'éviter les morts gratuites.',
      steps: [
        'Achète une pink (balise de contrôle) à chaque retour à la base.',
        'Avant chaque drake ou nashor, pose-la dans la rivière ou à l\'entrée de la jungle adverse.',
        'Remplace tes wards dès qu\'elles disparaissent.',
        'En fin de partie, regarde ton score de vision par minute.'
      ],
      target: { label: 'Score de vision par minute', sens: '≥', byRole: { Support: 2, Jungle: 1.2 }, def: 1 },
      fields: [
        { k: 'parties', label: 'Parties jouées', type: 'number' },
        { k: 'pinks', label: 'Pinks achetées en moyenne par partie', type: 'number' }
      ],
      kpi: 'Vision/min',
      schema: {
        type: 'map', caption: 'Exemple autour du drake (côté bleu). Même logique côté nashor.',
        markers: [
          { at: [58, 66], t: 'Buisson de la rivière, côté bot', k: 'info' },
          { at: [79, 64], t: 'Entrée de la jungle adverse', k: 'info' },
          { at: 'drake', t: 'Drake : vision posée 1 min avant', k: 'ok' }
        ]
      }
    },

    // ------------------------------------------------------------------ survie et carte
    {
      id: 'minimap', theme: 'survie', title: 'Regarder la minimap après chaque last hit', where: 'Parties normales puis classées', duration: 'Toute la semaine',
      why: 'Un coup d\'œil toutes les 3 à 5 secondes suffit à éviter la plupart des ganks.',
      steps: [
        'Après chaque last hit, un coup d\'œil à la minimap (moins d\'une seconde).',
        'Compte les adversaires visibles. S\'il en manque, considère qu\'ils arrivent vers toi.',
        'Commence par une partie normale, puis applique en classée.'
      ],
      fields: [
        { k: 'parties', label: 'Parties jouées en le faisant', type: 'number' },
        { k: 'facilite', label: 'Facilité à le faire (1 = oublié souvent, 5 = automatique)', type: 'score' }
      ],
      kpi: 'Morts',
      schema: { type: 'cycle', caption: 'La boucle à répéter toute la phase de lane.', steps: [{ t: 'Last hit', k: 'ok' }, { t: 'Coup d\'œil minimap', k: 'info' }, { t: 'Combien d\'adversaires visibles ?' }, { t: 'Je me replace si besoin' }] }
    },
    {
      id: 'morts15', theme: 'survie', title: '2 morts maximum avant 15 min', where: 'Parties classées', duration: '10 parties',
      why: 'C\'est l\'axe le plus rentable en LP : chaque mort donne de l\'or et du temps à l\'adversaire.',
      steps: [
        'Sur tes 10 prochaines parties, objectif : 2 morts ou moins avant 15 minutes.',
        'Avant de t\'avancer, demande-toi : où est le jungler adverse ? ai-je une ward ?',
        'Après chaque partie, note si l\'objectif est atteint.'
      ],
      target: { label: 'Morts avant 15 min (moyenne)', sens: '≤', def: 2 },
      fields: [
        { k: 'parties', label: 'Parties jouées', type: 'number' },
        { k: 'reussies', label: 'Parties avec 2 morts ou moins avant 15 min', type: 'number' },
        { k: 'moyenne', label: 'Morts avant 15 min (moyenne)', type: 'number', target: true }
      ],
      kpi: 'Morts avant 15 min',
      schema: { type: 'rows', plain: true, caption: 'Morts avant 15 minutes, dans une partie.', rows: [{ label: 'Morts avant 15 min', chips: [{ t: '0', k: 'ok' }, { t: '1', k: 'ok' }, { t: '2', k: 'ok' }, { t: '3 : trop', k: 'stop' }, { t: '4 et +', k: 'stop' }] }] }
    },
    {
      id: 'review-morts', theme: 'survie', title: 'Review de chaque mort', where: 'Review de VOD', duration: '20 min',
      why: 'Comprendre pourquoi on meurt, c\'est ne pas refaire la même erreur.',
      steps: [
        'Après une partie, revois chacune de tes morts.',
        'Pour chacune : l\'information était-elle disponible (minimap, ward, timer) ?',
        'Si oui : elle était évitable, note l\'erreur. Si non : pourquoi n\'avais-tu pas l\'info ?',
        'Garde une seule leçon à appliquer la partie suivante.'
      ],
      fields: [
        { k: 'morts', label: 'Morts revues', type: 'number' },
        { k: 'evitables', label: 'Dont évitables', type: 'number' },
        { k: 'lecon', label: 'La leçon à appliquer', type: 'text' }
      ],
      schema: { type: 'flow', caption: 'Pour chaque mort, une question : avais-tu l\'information ?', nodes: [{ t: 'Une mort' }, { t: 'L\'info était disponible ?', k: 'q', no: { t: 'Pas d\'info : ward ou minimap ?', k: 'info' } }, { t: 'Évitable : note l\'erreur', k: 'stop' }, { t: 'Une leçon pour la prochaine partie', k: 'ok' }] }
    },
    {
      id: 'reset', theme: 'survie', title: 'Rentrer au bon moment', where: 'Parties classées', duration: 'Toute la semaine',
      why: 'Un mauvais reset fait perdre une vague entière, voire la tour.',
      steps: [
        'Avant de rentrer, vérifie que ta vague va vers l\'adversaire (ou crash sur sa tour).',
        'Vérifie que tu as assez d\'or pour un composant utile.',
        'Si oui aux deux : reset. Sinon : farm encore cette vague ou attends la suivante.'
      ],
      fields: [
        { k: 'parties', label: 'Parties jouées', type: 'number' },
        { k: 'rates', label: 'Resets ratés (vague perdue sous ta tour)', type: 'number' }
      ],
      schema: { type: 'flow', caption: 'Les deux questions à se poser avant de rentrer.', nodes: [{ t: 'Ta vague va vers lui ou crash ?', k: 'q', no: { t: 'Pousse-la d\'abord' } }, { t: 'Assez d\'or pour un composant ?', k: 'q', no: { t: 'Farm encore une vague' } }, { t: 'Reset', k: 'ok' }] }
    },

    // ------------------------------------------------------------------ macro
    {
      id: 'wincon', theme: 'macro', title: 'Win condition écrite avant chaque partie', where: 'Parties classées', duration: 'Toute la semaine',
      why: 'Savoir comment ton champion gagne t\'aide à prendre les bonnes décisions au mid game.',
      steps: [
        'Pendant l\'écran de chargement, écris en une phrase comment ton champion gagne cette partie.',
        'Exemple : « Je suis fort à 2 objets : je split bot et je force le drake avec mon jungler. »',
        'En fin de partie, note si tu l\'as vraiment jouée.'
      ],
      fields: [
        { k: 'parties', label: 'Parties jouées', type: 'number' },
        { k: 'jouees', label: 'Parties où tu l\'as vraiment jouée', type: 'number' },
        { k: 'exemple', label: 'Ta meilleure win condition de la semaine', type: 'text' }
      ],
      kpi: 'KP',
      schema: { type: 'card', title: 'Ma win condition', caption: 'À remplir en 30 secondes pendant l\'écran de chargement.', lines: ['Mon champion est fort quand…', 'Je gagne en…', 'Je dois éviter…'] }
    },
    {
      id: '5-decisions', theme: 'macro', title: 'Review « 5 décisions » du mid game', where: 'Review de VOD', duration: '30 min',
      why: 'Au mid game, ce sont tes déplacements qui font gagner, plus que tes mécaniques.',
      steps: [
        'Dans une VOD, entre 14 et 25 minutes, choisis 5 moments où tu as décidé où aller.',
        'Pour chacun : ce que tu as fait, ce qu\'il fallait faire, et pourquoi.',
        'Note les minutes : vous les reverrez ensemble à la prochaine séance.'
      ],
      target: { label: 'Bonnes décisions sur 5', sens: '≥', def: 3 },
      fields: [
        { k: 'bonnes', label: 'Bonnes décisions sur 5', type: 'number', target: true },
        { k: 'moments', label: 'Les minutes revues (ex. 15:40, 18:10…)', type: 'text' },
        { k: 'lecon', label: 'La décision à changer', type: 'text' }
      ],
      schema: { type: 'timeline', from: 14, to: 25, unit: 'min', ticks: 1, segs: [{ a: 14, b: 25, t: 'Mid game', k: '' }], marks: [{ at: 15, t: '1', k: 'ok' }, { at: 17.5, t: '2', k: 'ok' }, { at: 19.5, t: '3', k: 'ok' }, { at: 22, t: '4', k: 'ok' }, { at: 24, t: '5', k: 'ok' }], caption: '5 décisions réparties entre 14 et 25 minutes.' }
    },
    {
      id: 'objectifs', theme: 'macro', title: 'Arriver en premier sur les objectifs', where: 'Parties classées', duration: 'Toute la semaine',
      why: 'L\'équipe qui arrive en premier pose la vision et choisit le combat.',
      steps: [
        'Repère l\'heure d\'apparition du prochain drake, héraut ou nashor.',
        '1 minute avant : pousse ta vague.',
        '30 secondes avant : va vers l\'objectif avec ton équipe et pose de la vision.',
        'Objectif : arriver en premier 2 fois par partie.'
      ],
      fields: [
        { k: 'parties', label: 'Parties jouées', type: 'number' },
        { k: 'fois', label: 'Fois où tu es arrivé en premier', type: 'number' }
      ],
      kpi: 'KP',
      schema: { type: 'timeline', from: -90, to: 0, unit: 's', ticks: 30, segs: [{ a: -60, b: -30, t: 'Pousse ta vague', k: 'info' }, { a: -30, b: 0, t: 'Va vers l\'objectif + vision', k: 'ok' }], marks: [{ at: 0, t: 'Apparition', k: 'ok' }], caption: 'Les 90 secondes avant l\'apparition d\'un objectif.' }
    },

    // ------------------------------------------------------------------ mental
    {
      id: 'stop', theme: 'mental', title: 'Règle de stop', where: 'Toute la semaine', duration: 'Toute la semaine',
      why: 'Un joueur tilté ne progresse pas : il perd des LP et prend de mauvaises habitudes.',
      steps: [
        'Après 2 défaites d\'affilée : stop les classées pour aujourd\'hui.',
        'Si tu te sens tilté, même après une seule partie : stop aussi.',
        'Pas de classée après l\'heure fixée avec ton coach.'
      ],
      target: { label: 'Parties jouées après 2 défaites', sens: '≤', def: 0 },
      fields: [
        { k: 'respectee', label: 'Règle respectée toute la semaine', type: 'yesno' },
        { k: 'apres', label: 'Parties jouées après 2 défaites d\'affilée', type: 'number', target: true }
      ],
      schema: { type: 'flow', caption: 'Simple et sans exception.', nodes: [{ t: 'Une défaite' }, { t: '2e défaite d\'affilée ?', k: 'q', no: { t: 'Tilt ressenti ? Stop aussi', k: 'stop' } }, { t: 'STOP pour aujourd\'hui', k: 'stop' }] }
    },
    {
      id: 'routine', theme: 'mental', title: 'Routine d\'avant-partie (10 min)', where: 'Avant la 1re classée', duration: '10 min',
      why: 'Les premières parties de la journée sont souvent les moins bonnes : l\'échauffement corrige ça.',
      link: DODGE,
      steps: [
        '5 min : LoL Dodge Game (League of Dodging ou Kiting Trainer).',
        '3 min : practice tool, last hit et combo de ton champion.',
        '2 min : écris l\'objectif de la partie. Coupe le chat (/mute all) si tu tilts facilement.'
      ],
      fields: [
        { k: 'jours', label: 'Jours où tu as fait la routine', type: 'number' },
        { k: 'mental', label: 'Note mentale moyenne de la semaine', type: 'score' }
      ],
      kpi: 'Note mentale',
      schema: { type: 'timeline', from: 0, to: 10, segs: [{ a: 0, b: 5, t: 'LoL Dodge Game', k: 'info' }, { a: 5, b: 8, t: 'Practice tool', k: '' }, { a: 8, b: 10, t: 'Objectif écrit', k: 'ok' }], caption: '10 minutes avant la première classée de la journée.' }
    },

    // ------------------------------------------------------------------ review
    {
      id: 'grille', theme: 'review', title: 'Grille de review d\'une partie', where: 'Review de VOD', duration: '30 min',
      why: 'C\'est toi qui commentes d\'abord ta VOD : tu apprends à voir tes erreurs seul.',
      steps: [
        'Choisis une partie récente (si possible une défaite frustrante).',
        'Regarde-la et réponds aux 5 questions de la grille.',
        'Ton coach complètera à la prochaine séance.'
      ],
      fields: [
        { k: 'objectif', label: 'Quel était l\'objectif de la partie ? Atteint ?', type: 'text' },
        { k: 'mort', label: 'Première mort : évitable ? Quelle info était disponible ?', type: 'text' },
        { k: 'vague', label: 'État de la vague à chaque reset', type: 'text' },
        { k: 'meilleure', label: 'Meilleure décision de la partie', type: 'text' },
        { k: 'changer', label: 'Décision à changer la prochaine fois', type: 'text' }
      ],
      schema: { type: 'flow', caption: 'Les 5 questions, dans l\'ordre de la partie.', nodes: [{ t: 'Objectif atteint ?', k: 'info' }, { t: '1re mort : évitable ?', k: 'stop' }, { t: 'Vague à chaque reset' }, { t: 'Meilleure décision', k: 'ok' }, { t: 'À changer' }] }
    }
  ];

  const byId = id => LIST.find(e => e.id === id);
  const forRole = role => LIST.filter(e => !e.roles || !role || e.roles.includes(role));
  // cible par défaut pour un rôle (le coach peut la remplacer dans la séance)
  function targetFor(ex, role) {
    if (!ex || !ex.target) return '';
    const v = ex.target.byRole && role && ex.target.byRole[role] !== undefined ? ex.target.byRole[role] : ex.target.def;
    return v === undefined || v === null ? '' : v;
  }
  // « m:ss » → secondes
  const secs = v => { const m = String(v || '').trim().match(/^(\d+):([0-5]\d)$/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
  const num = (v, type) => (type === 'time' ? secs(v) : v === '' || v === null || v === undefined || isNaN(Number(v)) ? null : Number(v));
  // résultat noté par le joueur comparé à la cible : true / false / null (pas de comparaison possible)
  function meets(ex, value, target) {
    if (!ex || !ex.target) return null;
    const a = num(value, ex.target.type), b = num(target, ex.target.type);
    if (a === null || b === null) return null;
    return ex.target.sens === '≤' ? a <= b : a >= b;
  }
  return { THEMES, LIST, byId, forRole, targetFor, meets, secs };
})();
