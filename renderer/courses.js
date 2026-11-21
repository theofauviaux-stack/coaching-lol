'use strict';
// Cours du parcours « Jeu individuel » : contenu tiré du programme du coach (Google Doc « Jeu individuel »),
// mis à jour pour la saison 2026 (timers officiels de Riot), et cours Support d'après le guide de Coach Karakal.
// Chaque cours : des leçons faites de blocs (texte, schéma, interaction), un quiz, puis une mise en pratique
// (exercices de la Banque et objectif conseillé). Les interactions sont dessinées par cours.js.
//
// Blocs d'une leçon :
//   { p: "texte" }                 paragraphe (**gras** permis)
//   { list: ["…", "…"] }           liste à puces
//   { key: "…" }                   encadré « À retenir »
//   { warn: "…" }                  encadré d'alerte
//   { schema: {…} }                schéma statique (voir schemas.js)
//   { w: "type", id, … }           interaction (voir cours.js : wave, map, choice, scenario, match, quick, order,
//                                  check, cs, wincon, deaths, adc, roam, scale)
const Courses = (() => {
  const PARCOURS = [
    { id: 'indiv', t: 'Jeu individuel', sub: 'Les bases qui rapportent le plus de LP, dans l\'ordre de ton programme : farm, lane, survie, macro, mental, et le rôle support.' }
  ];

  // ------------------------------------------------------------------ vagues (simulateur du cours 2)
  // pos : point de rencontre des vagues, de 0 (ta tour) à 1 (sa tour) ; ally / enemy : sbires de chaque camp
  const WAVES = {
    lecture: { t: 'Lire la vague', frames: [
      { pos: 0.5, ally: 6, enemy: 6, note: "Début de partie : les deux vagues se rencontrent au milieu de la lane." },
      { pos: 0.5, ally: 6, enemy: 4, note: "Tu tues 2 sbires adverses : ta vague a maintenant plus de sbires." },
      { pos: 0.63, ally: 5, enemy: 2, push: 'right', note: "Le camp qui a le plus de sbires pousse : ta vague avance vers sa tour." },
      { pos: 0.74, ally: 9, enemy: 5, push: 'right', note: "La vague suivante arrive et s'ajoute : la poussée continue tant que ton camp a l'avantage." }
    ] },
    freeze: { t: 'Freeze', frames: [
      { pos: 0.5, ally: 6, enemy: 6, note: "Les vagues se rencontrent au milieu." },
      { pos: 0.33, ally: 4, enemy: 6, push: 'left', note: "Tu laisses l'adversaire pousser : tu ne tues que les sbires qui vont mourir." },
      { pos: 0.2, ally: 3, enemy: 7, note: "La vague s'arrête juste devant ta tour, hors de sa portée. Garde 3 ou 4 sbires adverses de plus que les tiens." },
      { pos: 0.2, ally: 3, enemy: 7, danger: true, note: "Pour farmer, l'adversaire doit venir loin de sa tour, près de toi et de ton jungler." }
    ] },
    slow: { t: 'Slow push', frames: [
      { pos: 0.5, ally: 6, enemy: 6, note: "Tu tues d'abord les sbires à distance adverses (ceux de derrière)." },
      { pos: 0.57, ally: 6, enemy: 3, push: 'right', note: "Ta vague a un petit avantage : elle avance doucement." },
      { pos: 0.67, ally: 10, enemy: 4, push: 'right', note: "La vague suivante s'ajoute à la tienne : elle grossit sans aller trop vite." },
      { pos: 0.8, ally: 14, enemy: 5, push: 'right', note: "Après 2 ou 3 vagues : une très grosse vague, prête à crasher sur sa tour." }
    ] },
    crash: { t: 'Crash', frames: [
      { pos: 0.82, ally: 14, enemy: 3, push: 'right', note: "Ta grosse vague arrive sur sa tour." },
      { pos: 0.95, ally: 12, enemy: 0, tower: true, note: "Elle crash : l'adversaire doit la nettoyer sous sa tour et perd des sbires." },
      { pos: 0.95, ally: 6, enemy: 0, tower: true, free: true, note: "Pendant qu'il nettoie, tu es libre : reset, roam, objectif. C'est du temps gagné." },
      { pos: 0.95, ally: 1, enemy: 0, tower: true, note: "La tour finit ta vague : la suivante va revenir vers toi (le bounce)." }
    ] },
    bounce: { t: 'Bounce', frames: [
      { pos: 0.95, ally: 0, enemy: 0, note: "Ta vague est morte sous sa tour." },
      { pos: 0.72, ally: 6, enemy: 7, push: 'left', note: "Les vagues suivantes se rencontrent près de sa tour, mais la sienne a l'avantage." },
      { pos: 0.45, ally: 5, enemy: 9, push: 'left', note: "Elle revient vers toi : c'est le bounce." },
      { pos: 0.2, ally: 3, enemy: 7, note: "Elle s'arrête devant ta tour : le moment idéal pour démarrer un freeze." }
    ] }
  };

  // ------------------------------------------------------------------ ADC (cours Support, d'après le guide de Coach Karakal)
  // profil : fort (fort en début de partie), scale (faible, joue le farm), n3 (dépend du niveau 3), mage (mage en bot)
  // roam : facilité à le laisser seul pour roamer (1 facile, 2 moyen, 3 difficile, 4 déconseillé)
  const ADC_PROFILES = {
    fort: { t: 'Fort en début de partie', k: 'accent', plan: [
      "Joue la priorité dès le niveau 1 : prends le contrôle des buissons et le niveau 2 en premier.",
      "Support à distance : fais grossir la vague et punis-les quand ils sont sous leur tour.",
      "Support mêlée : crash, puis freeze sur le bounce, ou prépare un gank ou un roam pendant que la vague crash.",
      "Une fois le contrôle pris, ne surjoue pas : garde l'avantage avec la vague."
    ] },
    scale: { t: 'Faible, il doit farmer', k: 'blue', plan: [
      "Évite les gros combats niveau 1 : ton travail, c'est que ton ADC farm.",
      "Trades courts ; prends les dégâts à sa place si l'adversaire le harcèle.",
      "Joue pour les ganks de ton jungler et ses moments forts (niveau 6, premier objet)."
    ] },
    n3: { t: 'Attend le niveau 3', k: 'amber', plan: [
      "Faible niveau 1 : attends le niveau 3 avant de chercher le combat.",
      "Fort quand la vague revient vers vous ou grossit de votre côté.",
      "Les all-in sont bons dès que ton ADC peut taper ; avec la priorité, tourne vers les objectifs plutôt que de jouer la tour."
    ] },
    mage: { t: 'Mage en bot', k: 'violet', plan: [
      "Faible jusqu'au niveau 3 et incapable de tenir un long trade : all-in court, puis on recule.",
      "Laisse souvent la priorité en tout début de partie.",
      "Dès son premier objet de mana, il nettoie les vagues seul : roam dès que tu peux, et cherche le kill si vous l'avez."
    ] }
  };
  const ADCS = [
    ['Aphelios', 'scale', 3, "Joue pour son farm. Il se bat bien avec son arme bleue ou rouge/blanche ; la violette sert à préparer un gank."],
    ['Ashe', 'fort', 3, "Se bat tôt pour la priorité. Très facile à laisser seule si elle achète Statikk."],
    ['Caitlyn', 'fort', 4, "Jouez les plaques et la tour ; une fois la tour bot tombée, tournez vers la suivante. Roam seulement si elle est en retard. Prends Démolition si tu peux."],
    ['Cassiopeia', 'mage', 2, "Elle a besoin de mana : survis jusqu'à son premier retour. All-in possible niveau 2 avec un support à contrôle, en surveillant son mana."],
    ['Corki', 'fort', 1, "Prends les buissons et joue autour de ses Q et W. Roam facile après son niveau 6 ; avant, après une vague à canon."],
    ['Draven', 'fort', 3, "Gagnez les premières vagues. Ne poussez jamais en continu : crash, laisse revenir la vague, puis freeze. Contrôle total des buissons, pression depuis le brouillard."],
    ['Ezreal', 'fort', 1, "Regarde s'il cumule son passif niveau 1. Il Q la vague pour la priorité et le niveau 2. Facile à laisser seul : bon nettoyage de vague et un dash."],
    ['Hwei', 'mage', 1, "Laisse la priorité au début. All-in dès le niveau 3, jamais de long trade. Roam libre dès son premier objet de mana."],
    ['Jhin', 'fort', 1, "Mauvais sur les tours : les plaques ne sont pas ton objectif. Trade court quand il lui reste une balle, long trade quand il vient de recharger."],
    ['Jinx', 'scale', 3, "Priorité avec son Q, sinon farm. Si ta jungle ne vient pas, rentrez sur un crash : perdre une vague pour un bon retour, c'est acceptable."],
    ["Kai'Sa", 'n3', 2, "Son Q est faible avec des sbires autour et très fort sur une cible isolée : un contrôle sur une cible seule, et le combat est gagné."],
    ['Kalista', 'fort', 3, "Comme Draven : gagnez les premières vagues, jamais de poussée continue, freeze sur le bounce, pression depuis le brouillard."],
    ['Karthus', 'mage', 1, "Peut se battre tôt, surtout avec Fatigue. All-in avec ton contrôle puis recule. Roam libre dès son premier objet de mana."],
    ["Kog'Maw", 'scale', 3, "Trade seulement quand son W est disponible. W en recharge : pas de trade."],
    ['Lucian', 'n3', 3, "Faible niveau 1, attends le niveau 3. Avec Nami ou Milio, renforce-le et il joue. Inutile de jouer la tour : tourne avec la priorité."],
    ['Lux', 'mage', 1, "Faible jusqu'au niveau 3, jamais de long trade. Roam libre dès son premier objet de mana."],
    ['Mel', 'mage', 1, "Faible jusqu'au niveau 3, jamais de long trade. Roam libre dès son premier objet de mana."],
    ['Miss Fortune', 'fort', 1, "Mauvaise sur les tours. Combat tôt pour la priorité, puis crash et freeze sur le bounce, ou roam. Roam facile dès son niveau 6."],
    ['Nilah', 'n3', 3, "Évite les trades tôt ; all-in quand la vague vient vers vous. Long trade si elle peut taper."],
    ['Samira', 'n3', 3, "Évite les trades tôt ; all-in quand la vague vient vers vous. Long trade si elle peut taper."],
    ['Senna', 'scale', 3, "Trades courts pour qu'elle ramasse ses âmes. Prends les dégâts à sa place pour qu'elle farme sans être basse."],
    ['Seraphine', 'mage', 1, "Jamais de long trade, attends que ses sorts soient revenus. Roam quand tu veux."],
    ['Sivir', 'scale', 1, "Faible tôt : laisse la priorité à une lane plus forte. Crash et bouge. Dès son premier objet d'AD, elle nettoie les vagues seule."],
    ['Smolder', 'scale', 1, "Trades courts pour qu'il cumule ses charges. Roam plus tard, une fois ses charges et son ult disponibles."],
    ['Swain', 'mage', 2, "All-in si son E touche. Au niveau 6, il supporte le dive et nettoie bien : roam s'il y a mieux à faire."],
    ['Syndra', 'mage', 1, "Faible jusqu'au niveau 3, jamais de long trade (attends son E). Roam libre dès son premier objet de mana."],
    ['Tristana', 'n3', 2, "Forte niveau 2, joue les plaques. Joue autour de sa bombe (E) : si elle explose en entier, le combat est souvent gagné. Pas d'all-in si la vague est mauvaise."],
    ['Twitch', 'scale', 3, "Faible tôt : attends les ganks ou ouvre le mid avec son Q. Au niveau 6, il nettoie même une vague à canon."],
    ['Varus', 'fort', 2, "Peut se battre tôt et jouer les plaques. Gros potentiel de kill au niveau 6 avec son ult. Pas d'échappatoire : difficile à plonger s'il a son ult."],
    ['Vayne', 'scale', 3, "Évite les gros combats niveau 1, joue son farm. Bon trade auto + Q + auto, mais portée très courte."],
    ['Veigar', 'mage', 1, "Attends sa cage pour trader, jamais de long trade. Une fois quelques objets, difficile à plonger."],
    ["Vel'Koz", 'mage', 1, "Laisse-le harceler et joue le contrôle de la vague ; jamais de long trade."],
    ['Viktor', 'mage', 1, "Faible jusqu'au niveau 3, jamais de long trade. Roam libre dès son premier objet de mana."],
    ['Xayah', 'n3', 1, "Forte si tu peux contrôler et jouer autour de ses plumes ; avec Rakan, prenez Démolition. Très sûre avec son ult."],
    ['Yasuo', 'n3', 3, "Faible niveau 1, attends le niveau 3. Fort quand la vague revient vers vous. Long trade s'il peut taper."],
    ['Yunara', 'n3', 1, "Trade quand son Q est prêt, comme Kog'Maw avec son W. All-in niveau 6 intéressant. Attention aux vagues à canon."],
    ['Zeri', 'scale', 2, "Faible tôt : attends les ganks ou l'all-in niveau 6. Surveille son E (dash)."],
    ['Ziggs', 'mage', 1, "Prends Démolition si tu peux. Laisse-le harceler, all-in possible, jamais de long trade."],
    ['Zyra', 'mage', 1, "Faible jusqu'au niveau 3, jamais de long trade. Roam libre dès qu'elle a de l'AP."]
  ].map(([name, profile, roam, note]) => ({ name, profile, roam, note }));
  const ROAM_LABEL = { 1: 'Roam facile', 2: 'Roam moyen', 3: 'Roam difficile', 4: 'Roam déconseillé' };

  const SRC = {
    doc: { t: 'Ton programme « Jeu individuel »' },
    riot26: { t: 'Riot : saison 2026 (aperçu officiel)', url: 'https://www.leagueoflegends.com/news/dev/dev-2026-season-one-gameplay-preview/' },
    riot269: { t: 'Riot : notes du patch 26.9 (quêtes de rôle)', url: 'https://www.leagueoflegends.com/en-au/news/game-updates/league-of-legends-patch-26-9-notes/' },
    wiki: { t: 'Wiki LoL : timers des larves et du héraut', url: 'https://wiki.leagueoflegends.com/en-us/Voidgrub_camp' },
    dodge: { t: 'dodge.gg : guide jungle 2026 (tracking)', url: 'https://www.dodge.gg/lol/news/jungle-guide-2026' },
    nerfplz: { t: 'nerfplz : gestion des vagues', url: 'https://www.nerfplz.com/2026/08/wave-management-explained-freezing-slow.html' },
    moba: { t: 'Mobalytics : guide des vagues', url: 'https://mobalytics.gg/blog/wave-management/' },
    karakal: { t: 'Coach Karakal : guide Support saison 16 (reformulé)', url: 'https://coachkarakal.com' }
  };

  const LIST = [
    // ================================================================== 1. FARM ET FONDAMENTAUX
    {
      id: 'farm', n: 1, parcours: 'indiv', icon: 'wheat', t: 'Farm et fondamentaux', minutes: 20, level: 'Tous niveaux',
      roles: ['Top', 'Jungle', 'Mid', 'ADC'],
      summary: "Le farm est ta première source d'or. Tu apprends à ne plus perdre de sbires, en lane comme sous ta tour, et à réduire ton champion pool.",
      outcomes: ['Atteindre 70 CS à 10 min en partie', 'Ne plus perdre de sbires sous ta tour', 'Jouer 2 ou 3 champions, pas 8'],
      sources: [SRC.doc],
      lessons: [
        { id: 'pourquoi', t: 'Pourquoi le farm d\'abord', blocks: [
          { p: "Ton programme corrige d'abord ce qui coûte le plus de LP. Pour la plupart des joueurs, ce sont les **morts évitables**, le **farm** et la **gestion de la lane**, bien avant le macro avancé." },
          { p: "Chaque sbire raté, c'est de l'or en moins. Une vague compte environ 6 sbires : rater 10 CS à 10 minutes, c'est presque 2 vagues entières, donc un objet en retard sur ton adversaire." },
          { schema: { type: 'curve', target: 70, caption: "Repères pour 70 CS à 10 min. Si tu es en dessous à 4 min, tu as raté trop de sbires au début." } },
          { w: 'cs', id: 'farm-calc' },
          { key: "Les repères de ton programme : **7 CS/min ou plus**, puis **8 ou plus** selon le rang, et **70 CS à 10 min**. En practice tool, sans adversaire : 80 CS à 10 min." }
        ] },
        { id: 'lasthit', t: 'Le last hit en lane', blocks: [
          { p: "Le last hit, c'est donner le dernier coup au sbire pour toucher l'or. Les sbires à distance (derrière) ont moins de PV que les sbires mêlée : ils tombent plus vite." },
          { list: [
            "**Attends** que le sbire soit assez bas : une auto-attaque trop tôt le laisse en vie et fait avancer ta vague.",
            "**Anticipe** le temps de ton attaque : l'animation et le projectile mettent un instant à arriver.",
            "**Garde un sort** pour le sbire que tu allais rater, pas pour nettoyer la vague sans raison.",
            "**Regarde la minimap** après chaque last hit (cours Survie)."
          ] },
          { w: 'choice', id: 'farm-lh', q: "Deux sbires sont presque morts en même temps : un mêlée et un à distance. Ton auto ne peut en finir qu'un. Lequel ?", opts: [
            { t: "Le sbire à distance, puis le mêlée avec un sort si besoin", ok: true, fb: "Oui : le sbire à distance a moins de PV et meurt vite, il passe en premier. Garde ton sort pour le second." },
            { t: "Le mêlée, il donne plus d'or", ok: false, fb: "Le mêlée a plus de PV : il tient un peu plus longtemps. Le sbire à distance serait perdu." },
            { t: "Aucun, j'attends la vague suivante", ok: false, fb: "Tu perds les deux. Prends celui qui va mourir en premier (à distance), puis l'autre avec un sort." }
          ] }
        ] },
        { id: 'tour', t: 'Farmer sous ta tour', blocks: [
          { p: "Après un retour à la base ou un gank, la vague arrive sous ta tour. La tour tape fort : il faut placer ton auto au bon moment." },
          { schema: { type: 'rows', caption: "Rythme de base en début de partie : la tour fait l'essentiel, ton auto finit le sbire. Avec plus de dégâts (objets), adapte le rythme.", rows: [
            { label: 'Sbire mêlée', chips: [{ t: 'Tour', k: 'stop' }, { t: 'Tour', k: 'stop' }, { t: 'Ton auto : last hit', k: 'ok' }] },
            { label: 'Sbire à distance', chips: [{ t: 'Ton auto', k: 'info' }, { t: 'Tour', k: 'stop' }, { t: 'Ton auto : last hit', k: 'ok' }] }
          ] } },
          { w: 'order', id: 'farm-ordre', q: "Remets dans l'ordre le last hit d'un sbire à distance qui arrive plein PV sous ta tour.", items: ["Tu le frappes une fois", "La tour le frappe", "Ton auto le finit"], fb: "Un sbire à distance plein PV mourrait directement sous un coup de tour : ton auto d'abord le met à la bonne vie." },
          { key: "Ton devoir de partie : « aucun sbire perdu sous tourelle ». Compte-les en review." }
        ] },
        { id: 'pool', t: 'Champion pool, combos et réglages', blocks: [
          { p: "Pendant la phase de fondamentaux, tu joues **2 ou 3 champions dans un seul rôle principal**, plus un rôle secondaire. Avec 8 champions, tu réapprends les bases à chaque partie au lieu de progresser." },
          { list: [
            "**Combos** de tes 2 ou 3 champions : ordre des sorts, animation cancel, portées exactes.",
            "**Réglages** : caméra, raccourcis, quick cast, attaque-déplacement.",
            "**10 minutes de practice tool** avant la première partie du jour."
          ] },
          { w: 'check', id: 'farm-reglages', q: "Coche ce qui est déjà en place chez toi :", items: [
            "Je joue 3 champions maximum dans mon rôle principal",
            "Je connais l'ordre de sorts de mon combo principal par cœur",
            "Le quick cast est activé sur mes sorts",
            "J'ai une touche d'attaque-déplacement",
            "Je fais 10 min de practice tool avant ma première partie"
          ] }
        ] }
      ],
      quiz: [
        { q: "Quel repère de CS à 10 min vise ton programme en partie ?", opts: ['50', '70', '100', 'Peu importe'], a: 1, why: "70 CS à 10 min en partie, 80 en practice tool sans adversaire." },
        { q: "Rater 12 CS à 10 min, c'est environ…", opts: ['Un sbire', '2 vagues', '5 vagues', 'Rien de grave'], a: 1, why: "Une vague compte environ 6 sbires : 12 CS, c'est 2 vagues entières." },
        { q: "Sous ta tour, un sbire mêlée plein PV arrive. Que fais-tu ?", opts: ["Je le frappe tout de suite", "J'attends 2 coups de tour, puis mon auto le finit", "Je le laisse à la tour", "J'utilise mon ult"], a: 1, why: "Mêlée : tour, tour, puis ton auto." },
        { q: "Combien de champions jouer pendant la phase de fondamentaux ?", opts: ['1', '2 ou 3 dans un rôle', '5 ou 6', 'Le plus possible'], a: 1, why: "2 ou 3 champions dans un rôle principal, plus un rôle secondaire." },
        { q: "Quel sbire tombe le plus vite ?", opts: ['Le mêlée', 'Le sbire à distance', 'Le canon', 'Ils ont tous les mêmes PV'], a: 1, why: "Le sbire à distance a moins de PV." },
        { q: "À quoi sert ton sort pendant le farm ?", opts: ["À nettoyer la vague le plus vite possible", "À finir le sbire que tu allais rater", "À rien", "À harceler uniquement"], a: 1, why: "Garde-le pour le sbire que tu allais perdre ; nettoyer sans raison fait pousser ta vague." }
      ],
      practice: { exercises: ['cs10-perso', 'cs-tour', 'combo'], goal: { text: "70 CS à 10 min en moyenne", kpi: 'CS à 10 min', target: 70 } }
    },

    // ================================================================== 2. GESTION DES VAGUES
    {
      id: 'vagues', n: 2, parcours: 'indiv', icon: 'waves', t: 'Gestion des vagues', minutes: 30, level: 'Tous niveaux',
      roles: ['Top', 'Mid', 'ADC', 'Support'],
      summary: "Où est la vague, et où tu veux qu'elle soit. Freeze, slow push, crash et bounce : quand utiliser chacun, avant un reset, un roam ou un drake.",
      outcomes: ['Lire où va la vague', 'Réussir un freeze par partie', 'Crasher avant chaque reset'],
      sources: [SRC.doc, SRC.nerfplz, SRC.moba],
      lessons: [
        { id: 'lire', t: 'Lire la vague', blocks: [
          { p: "Une règle simple : **le camp qui a le plus de sbires pousse**. Si ta vague a plus de sbires que la sienne, elle avance vers sa tour. Sinon, elle recule vers la tienne." },
          { w: 'wave', id: 'v-lecture', mode: 'lecture' },
          { p: "Avant chaque décision, pose-toi une seule question : est-ce que je veux cette vague près de ma tour, près de la sienne, ou en train de crasher sur sa tour ?" },
          { key: "Ton exercice : annoncer à voix haute l'état de la vague toutes les 30 secondes (en review)." }
        ] },
        { id: 'freeze', t: 'Le freeze', blocks: [
          { p: "Le freeze bloque la vague **juste devant ta tour, hors de sa portée**. Tu ne tues que le sbire qui va mourir, et tu gardes 3 ou 4 sbires adverses de plus que les tiens pour qu'elle ne bouge pas." },
          { w: 'wave', id: 'v-freeze', mode: 'freeze' },
          { list: [
            "**Quand ?** Quand tu as peur d'un gank, ou pour forcer l'adversaire à venir farmer près de toi et de ton jungler.",
            "**Le meilleur moment pour le démarrer :** quand la vague revient vers toi après un crash (bounce).",
            "**Ce qui le casse :** tuer trop de sbires adverses. Ta vague reprend l'avantage et repart."
          ] }
        ] },
        { id: 'push', t: 'Slow push et crash', blocks: [
          { p: "Le **slow push** fait grossir ta vague sur 2 ou 3 vagues : tu tues d'abord les sbires à distance adverses, sans tout nettoyer. Puis cette grosse vague **crash** sur sa tour." },
          { w: 'wave', id: 'v-slow', mode: 'slow' },
          { w: 'wave', id: 'v-crash', mode: 'crash' },
          { p: "Le crash ne sert pas surtout à tuer des sbires : il te fait **gagner du temps**. Pendant que l'adversaire nettoie sous sa tour, tu peux rentrer, roamer ou aller sur un objectif sans rien perdre." },
          { p: "Le **fast push**, c'est tout nettoyer le plus vite possible : quand tu as besoin de ce temps tout de suite (un reset avant un drake, par exemple)." }
        ] },
        { id: 'bounce', t: 'Bounce et reset', blocks: [
          { p: "Après un crash, la tour tue ta vague. Les vagues suivantes se rencontrent près de sa tour, mais la sienne a l'avantage : elle **revient vers toi**. C'est le bounce." },
          { w: 'wave', id: 'v-bounce', mode: 'bounce' },
          { schema: { type: 'flow', caption: "Le cycle à reproduire : il te donne un reset sans perte, puis une vague bien placée à ton retour.", nodes: [{ t: 'Slow push' }, { t: 'Crash sur sa tour', k: 'info' }, { t: 'Reset pendant qu\'il nettoie', k: 'ok' }, { t: 'La vague revient : freeze', k: 'ok' }] } },
          { key: "Rentre **après un crash**, jamais quand ta vague est sur le point d'arriver sous ta tour : tu perdrais toute une vague, voire des plaques." }
        ] },
        { id: 'choisir', t: 'Choisir le bon état', blocks: [
          { p: "Ton programme résume les cas où la vague décide de la suite : avant un reset, avant un drake, contre un jungler adverse proche." },
          { w: 'match', id: 'v-match', q: "Pour chaque situation, choisis ce que tu fais de ta vague.", choices: ['Freeze', 'Slow push', 'Crash / fast push'], items: [
            { s: "Tu veux rentrer acheter dans 30 secondes.", a: 2, why: "Crash d'abord : tu rentres pendant qu'il nettoie, sans perdre de sbires." },
            { s: "Le jungler adverse vient d'être vu près de ta lane.", a: 0, why: "Reste près de ta tour : un freeze te met hors de portée du gank." },
            { s: "Le drake apparaît dans 1 minute et tu es mid.", a: 2, why: "Pousse ta vague pour arriver le premier à la rivière." },
            { s: "Tu as l'avantage, tu veux plonger avec ton jungler dans 2 vagues.", a: 1, why: "Une grosse vague protège le dive : elle absorbe les coups de tour." },
            { s: "Ton adversaire est en retard et doit farmer pour revenir.", a: 0, why: "Freeze : il doit venir farmer près de toi, ou perdre ses sbires." },
            { s: "Tu veux roam mid, mais ta vague va arriver sous ta tour.", a: 2, why: "Crash d'abord, sinon tu perds la vague sous ta tour pendant ton roam." },
            { s: "La vague revient vers toi après ton crash.", a: 0, why: "Le bounce est le meilleur moment pour démarrer un freeze." },
            { s: "Tu veux une grosse vague qui crash quand tu iras sur les larves à 8:00.", a: 1, why: "Démarre un slow push 2 ou 3 vagues avant : elle crashera au bon moment." }
          ] }
        ] }
      ],
      quiz: [
        { q: "Quel camp pousse la vague ?", opts: ["Celui du joueur le plus fort", "Celui qui a le plus de sbires", "Toujours le camp bleu", "Celui qui a le dernier coup"], a: 1, why: "Le camp avec le plus de sbires pousse vers l'autre tour." },
        { q: "Pour freeze, tu gardes…", opts: ["Plus de sbires à toi que les siens", "3 ou 4 sbires adverses de plus que les tiens", "Autant des deux côtés", "Aucun sbire"], a: 1, why: "Avec 3 ou 4 sbires adverses de plus, la vague reste devant ta tour." },
        { q: "Slow push : tu tues d'abord…", opts: ["Les sbires mêlée adverses", "Les sbires à distance adverses", "Tes propres sbires", "Le canon seulement"], a: 1, why: "Les sbires à distance adverses en premier, sans tout nettoyer : ta vague grossit doucement." },
        { q: "À quoi sert surtout un crash ?", opts: ["À tuer le plus de sbires", "À gagner du temps pour reset, roam ou objectif", "À faire tomber la tour seul", "À rien"], a: 1, why: "Pendant qu'il nettoie sous sa tour, tu as du temps libre sans rien perdre." },
        { q: "Quel est le meilleur moment pour démarrer un freeze ?", opts: ["Juste après le crash de ta vague, quand elle revient vers toi", "Au niveau 1", "Quand ta vague est sous sa tour", "Jamais"], a: 0, why: "Le bounce ramène la vague devant ta tour : parfait pour freeze." },
        { q: "Tu veux rentrer : ta vague arrive sous ta tour dans 10 s. Que fais-tu ?", opts: ["Je rentre tout de suite", "Je pousse d'abord (ou j'attends la vague suivante)", "Je freeze", "Je me bats"], a: 1, why: "Rentrer maintenant fait perdre toute la vague sous ta tour." }
      ],
      practice: { exercises: ['freeze', 'vague-annonce', 'reset'], goal: { text: "Un freeze réussi par partie et un écart d'or positif à 10 min", kpi: 'Écart or à 10 min', target: 0 } }
    },

    // ================================================================== 3. PHASE DE LANE ET TRADES
    {
      id: 'trades', n: 3, parcours: 'indiv', icon: 'sword', t: 'Phase de lane et trades', minutes: 25, level: 'Tous niveaux',
      roles: ['Top', 'Mid', 'ADC', 'Support'],
      summary: "Quand frapper et quand reculer : les fenêtres de trade, les paliers de niveau 2, 3 et 6, et comment la vague change chaque échange.",
      outcomes: ['Trader quand l\'adversaire est pris', 'Prendre le niveau 2 en premier', 'Ne plus trader dans sa vague'],
      sources: [SRC.doc],
      lessons: [
        { id: 'fenetres', t: 'Les fenêtres de trade', blocks: [
          { p: "Un bon trade, c'est frapper quand l'adversaire **ne peut pas répondre**. Ton programme en retient trois moments :" },
          { list: [
            "**Son sort clé est en recharge** : il vient de le lancer sur la vague ou sur toi.",
            "**Il last hit** : il s'avance vers le sbire et son attaque part sur le sbire, pas sur toi.",
            "**Tu as un avantage de niveau** : tu as un sort de plus ou un rang de plus."
          ] },
          { schema: { type: 'flow', caption: "Avant chaque trade, deux questions suffisent.", nodes: [{ t: 'Son sort clé est-il en recharge ?', k: 'q', no: { t: 'Attends' } }, { t: 'Ma vague est-elle au moins égale ?', k: 'q', no: { t: 'Pas de trade' } }, { t: 'Trade court, puis recule', k: 'ok' }] } },
          { w: 'choice', id: 'tr-fen', q: "Ton adversaire mid lance son sort principal sur la vague pour la nettoyer. Que fais-tu ?", opts: [
            { t: "Je m'avance et je trade pendant que son sort recharge", ok: true, fb: "Oui : c'est la fenêtre. Il ne peut plus répondre avec son meilleur sort." },
            { t: "Je recule, il a l'avantage", ok: false, fb: "Au contraire : son sort est en recharge, c'est toi qui as l'avantage pendant quelques secondes." },
            { t: "Je nettoie aussi la vague", ok: false, fb: "Tu rates la fenêtre : il va récupérer son sort et l'échange redevient égal." }
          ] }
        ] },
        { id: 'paliers', t: 'Les paliers 2, 3 et 6', blocks: [
          { p: "Le premier à passer **niveau 2** a un sort de plus : c'est le meilleur moment pour trader. Le niveau 3 complète souvent le combo, et le **niveau 6** ajoute l'ultime : beaucoup de champions deviennent dangereux d'un coup." },
          { schema: { type: 'flow', caption: "Le moment exact dépend de ta lane : vérifie une fois en partie perso à quel sbire de la 2e vague tu passes niveau 2.", nodes: [{ t: '1re vague : farm propre' }, { t: '2e vague : prends l\'XP en premier', k: 'info' }, { t: 'Niveau 2 : nouveau sort', k: 'ok' }, { t: 'Trade tout de suite', k: 'ok' }] } },
          { list: [
            "Regarde le niveau de ton adversaire sur le tableau des scores, ou au-dessus de sa tête.",
            "Juste avant son niveau 6, recule un peu : il peut avoir un all-in que tu n'as pas encore vu.",
            "Au moment où **tu** passes un palier avant lui, frappe tout de suite : la fenêtre dure quelques secondes."
          ] }
        ] },
        { id: 'vague', t: 'Trader avec la vague', blocks: [
          { p: "Les sbires tapent aussi. Trader **dans sa vague**, c'est prendre les coups de tous ses sbires en plus des siens. Trader quand **ta vague est plus grosse**, c'est l'inverse." },
          { schema: { type: 'lane', caption: "Tes sbires en bleu, les siens en rouge.", rows: [
            { t: 'Bon trade', k: 'ok', pos: 0.58, ally: 7, enemy: 3, note: "Ta vague est plus grosse : ses sbires tapent peu, les tiens le touchent pendant le combat." },
            { t: 'Mauvais trade', k: 'stop', pos: 0.42, ally: 3, enemy: 7, note: "Tu vas trader au milieu de sa vague : ses sbires te prennent pour cible dès que tu le touches." }
          ] } },
          { key: "Un slow push te donne des trades protégés : ta vague grossit, et chaque échange se fait de ton côté." }
        ] },
        { id: 'scenario', t: 'Scénario : tes 4 premières minutes', blocks: [
          { p: "Mets tout ensemble. Tu es mid, partie classée, ton adversaire joue un mage." },
          { w: 'scenario', id: 'tr-scen', steps: [
            { s: "Niveau 1. Les vagues se rencontrent. Ton adversaire lance son sort de poke sur la vague.", opts: [
              { t: "Je l'auto-attaque et je recule", ok: true, fb: "Bon réflexe : un trade court pendant que son sort recharge." },
              { t: "Je reste derrière mes sbires", ok: false, fb: "Pas grave, mais tu laisses passer une fenêtre gratuite." }
            ] },
            { s: "La 2e vague arrive. Tu es à 2 sbires de passer niveau 2, lui aussi.", opts: [
              { t: "Je m'avance pour prendre l'XP en premier, sort prêt à monter", ok: true, fb: "Oui : le premier niveau 2 gagne le trade suivant." },
              { t: "Je farm normalement", ok: false, fb: "Tu risques de passer niveau 2 après lui et de subir son trade." }
            ] },
            { s: "Tu passes niveau 2 en premier. Sa vague est plus grosse que la tienne.", opts: [
              { t: "Je trade court, en restant hors de sa vague", ok: true, fb: "Exact : tu profites du niveau sans prendre les coups de ses sbires." },
              { t: "J'all-in au milieu de ses sbires", ok: false, fb: "Ses sbires vont te cibler : le niveau d'avance ne compense pas une vague entière." }
            ] },
            { s: "3:00. Ton jungler a commencé côté bot. Le jungler adverse n'a pas été vu.", opts: [
              { t: "Je reste prudent : pas de trade loin de ma tour sans info", ok: true, fb: "Oui : sans info, considère qu'il peut arriver (cours Tracking)." },
              { t: "Je pousse jusqu'à sa tour pour la plaque", ok: false, fb: "Risqué : un jungler non vu à ce moment-là peut très bien venir mid." }
            ] }
          ] }
        ] }
      ],
      quiz: [
        { q: "Quand trader ?", opts: ["Quand son sort clé est en recharge", "Quand il a tous ses sorts", "Quand sa vague est plus grosse", "Au hasard"], a: 0, why: "Son sort en recharge = il ne peut pas répondre." },
        { q: "Pourquoi le niveau 2 en premier compte-t-il ?", opts: ["Il donne de l'or", "Tu as un sort de plus pour trader", "Il fait pousser la vague", "Il ne compte pas"], a: 1, why: "Un sort de plus pendant quelques secondes : le trade est pour toi." },
        { q: "Trader au milieu de sa vague, c'est…", opts: ["Une bonne idée", "Prendre les coups de ses sbires en plus", "Neutre", "Obligatoire"], a: 1, why: "Ses sbires te ciblent dès que tu le touches." },
        { q: "Juste avant son niveau 6, tu…", opts: ["Restes au contact", "Recules un peu", "Rentres à la base", "Freeze"], a: 1, why: "Son ultime peut changer l'all-in d'un coup." },
        { q: "Un moment où l'adversaire ne peut pas bien répondre :", opts: ["Quand il last hit un sbire", "Quand il est sous sa tour plein PV", "Quand il est niveau 6", "Jamais"], a: 0, why: "Pendant son last hit, son attaque part sur le sbire." },
        { q: "Un slow push t'aide pour trader parce que…", opts: ["Ta vague est plus grosse, les échanges se font de ton côté", "Il ralentit l'adversaire", "Il donne de l'XP", "Il n'aide pas"], a: 0, why: "Tes sbires tapent avec toi, les siens sont moins nombreux." }
      ],
      practice: { exercises: ['niveau2', 'vague-annonce'], goal: { text: "Écart d'XP positif à 10 min", kpi: 'Écart XP à 10 min', target: 0 } }
    },

    // ================================================================== 4. TRACKING DU JUNGLER
    {
      id: 'tracking', n: 4, parcours: 'indiv', icon: 'radio', t: 'Tracking du jungler adverse', minutes: 25, level: 'Tous niveaux',
      roles: ['Top', 'Mid', 'ADC', 'Support', 'Jungle'],
      summary: "La plupart des morts du début de partie viennent d'un jungler qu'on n'a pas suivi. Les timers 2026, les indices de son départ, et la ward au bon moment.",
      outcomes: ['Connaître les timers 2026 par cœur', 'Prédire sa position à 2:55', 'Poser la ward défensive au bon moment'],
      sources: [SRC.doc, SRC.riot26, SRC.wiki, SRC.dodge],
      lessons: [
        { id: 'timers', t: 'Les timers de la saison 2026', blocks: [
          { p: "Depuis la saison 2026, tout démarre plus tôt : les sbires sortent à **0:30** et les premiers camps de la jungle **35 secondes plus tôt** qu'avant. Le carapateur arrive donc à **2:55**." },
          { schema: { type: 'timeline', from: 0, to: 8, unit: 'min', caption: "Début de partie en 2026. Larves du Néant à 8:00 (une seule fois), héraut à 15:00, Baron à 20:00. Atakhan n'existe plus.", segs: [{ a: 0, b: 0.92, t: 'Début' }, { a: 0.92, b: 2.92, t: 'Premier clear (camps à 0:55)', k: 'info' }, { a: 2.92, b: 5, t: 'Carapateurs, ganks', k: 'stop' }, { a: 5, b: 8, t: 'Drake, puis larves', k: 'ok' }], marks: [{ at: 0.5, t: 'Sbires 0:30' }, { at: 2.92, t: 'Carapateur 2:55', k: 'stop' }, { at: 5, t: 'Drake 5:00', k: 'ok' }, { at: 8, t: 'Larves 8:00', k: 'ok' }] } },
          { w: 'quick', id: 'tk-timers', q: "Vrai ou faux ? Réponds avant la fin de la barre.", secs: 7, yes: 'Vrai', no: 'Faux', items: [
            { s: "Le carapateur apparaît à 2:55.", a: true, why: "35 s plus tôt qu'en 2025 (3:30)." },
            { s: "Les larves du Néant apparaissent deux fois par partie.", a: false, why: "Une seule fois, à 8:00 ; elles partent à 14:45." },
            { s: "Le Baron apparaît à 20:00.", a: true, why: "Atakhan a été retiré : le Baron revient à 20:00." },
            { s: "Les premiers camps de la jungle apparaissent à 1:30.", a: false, why: "À 0:55 depuis 2026 (Krugs et Gromp à 1:07)." },
            { s: "Le héraut arrive à 15:00, à la place des larves.", a: true, why: "Les larves partent à 14:45, le héraut arrive à 15:00." }
          ] }
        ] },
        { id: 'depart', t: 'Trouver son départ', blocks: [
          { p: "Le jungler adverse finit en général son premier tour de jungle **du côté opposé à celui où il a commencé**, vers l'apparition du carapateur. Le savoir te dit où il sera vers 2:55." },
          { list: [
            "**Le leash** : un laner adverse arrive en retard en lane, il a aidé son jungler sur ce côté.",
            "**Un buff vu** par une ward, ou le jungler aperçu au début.",
            "**Son nombre de CS** sur le tableau des scores : il te dit combien de camps il a déjà faits.",
            "**L'absence** : il n'apparaît nulle part sur un côté où il aurait dû se montrer."
          ] },
          { w: 'map', id: 'tk-map1', q: "Ton équipe a vu le jungler adverse commencer à son buff rouge (côté top de sa jungle). Il fait un tour complet. Où est-il vers 2:55 ?", context: { paths: [{ pts: ['rRouge', 'rKrugs', 'rRaptors', 'rLoups', 'rBleu', 'rGromp'], k: 'stop', dash: true }], markers: [{ at: 'rRouge', t: 'Départ vu', k: 'stop' }] }, showPathAfter: true, zones: [
            { at: [24, 38], r: 9, t: 'Carapateur du haut', ok: false, fb: "C'est le côté où il a commencé : il en est parti depuis longtemps." },
            { at: [72, 62], r: 9, t: 'Carapateur du bas', ok: true, fb: "Oui : parti du côté top, il finit son tour côté bot, au moment où le carapateur apparaît. Danger pour le bot et le mid." },
            { at: [47, 23], r: 8, t: 'Son buff rouge', ok: false, fb: "Le buff rouge ne réapparaît pas avant un bon moment : il n'a aucune raison d'y être." },
            { at: [50, 50], r: 8, t: 'Mid lane', ok: false, fb: "Possible plus tard, mais vers 2:55 il termine d'abord son tour, côté bot." }
          ] }
        ] },
        { id: 'ward', t: 'La ward défensive au bon moment', blocks: [
          { p: "Ton programme est clair : on pose la ward **selon le tracking, pas par habitude**. Une ward posée à 1:30 dans un coin où il n'ira pas avant 4:00 ne sert à rien." },
          { w: 'map', id: 'tk-map2', q: "Tu es mid. Le jungler adverse a commencé côté bot de sa jungle : il finira côté top vers 2:55. Où poses-tu ta ward vers 2:40 ?", context: { markers: [{ at: 'rBleu', t: 'Départ vu (côté bot)', k: 'stop' }] }, zones: [
            { at: [36, 40], r: 8, t: 'Rivière côté top, près du mid', ok: true, fb: "Oui : c'est son chemin vers toi et vers le carapateur du haut, juste au bon moment." },
            { at: [64, 60], r: 8, t: 'Rivière côté bot, près du mid', ok: false, fb: "Il a commencé de ce côté : à 2:55, il sera de l'autre côté de la carte." },
            { at: [47, 66], r: 7, t: 'Tes raptors', ok: false, fb: "Dans ta propre jungle, côté bot : pas sur son chemin à ce moment-là." },
            { at: [53, 34], r: 7, t: 'Ses raptors', ok: false, fb: "Trop profond et risqué seul ; et il est déjà passé par là." }
          ] },
          { key: "Le bon réflexe : je sais d'où il vient, je pose la ward sur son chemin **juste avant** qu'il y passe." }
        ] },
        { id: 'jouer', t: 'Jouer avec l\'info', blocks: [
          { p: "Le tracking ne sert que s'il change ta façon de jouer :" },
          { list: [
            "**Il est de ton côté** : pas de trade loin de ta tour, pas de push au-delà de la rivière sans vision, garde ton sort d'échappatoire.",
            "**Il est de l'autre côté** : c'est ta fenêtre. Trade, pousse, prends une plaque.",
            "**Tu ne sais pas** : joue comme s'il était de ton côté."
          ] },
          { w: 'quick', id: 'tk-quick', q: "Danger ou pas ? Décide vite, comme en partie.", secs: 6, yes: 'Danger', no: 'Pas de danger', items: [
            { s: "3:00, le jungler adverse vient d'apparaître sur le carapateur du bas. Tu es top et tu pousses.", a: false, why: "Il est à l'autre bout de la carte : tu as le temps." },
            { s: "Tu es bot. Le jungler adverse a commencé côté top et n'a pas été revu. Il est 2:50.", a: true, why: "Tour complet côté top : il arrive côté bot vers 2:55." },
            { s: "Ton mid adverse et le jungler ne sont plus visibles. Tu es top, au milieu de la lane.", a: true, why: "Deux adversaires disparus vers toi : recule." },
            { s: "Le jungler adverse vient d'être tué en bot. Tu es mid.", a: false, why: "Il est mort : profite de la fenêtre." },
            { s: "5:30, tu ne l'as pas vu depuis 1 min 30 et ta vague est près de sa tour.", a: true, why: "Sans info, joue comme s'il était de ton côté." }
          ] }
        ] }
      ],
      quiz: [
        { q: "À quelle heure apparaît le carapateur en 2026 ?", opts: ['2:00', '2:55', '3:15', '3:30'], a: 1, why: "35 s plus tôt qu'en 2025 : 2:55." },
        { q: "Un jungler qui commence côté top finit en général son tour…", opts: ["Côté top", "Côté bot", "Au mid", "À sa base"], a: 1, why: "Il termine du côté opposé à son départ." },
        { q: "Quand poser ta ward défensive ?", opts: ["Le plus tôt possible", "Juste avant qu'il passe, sur son chemin", "Jamais", "Après sa mort"], a: 1, why: "Selon le tracking, pas par habitude." },
        { q: "Un indice que le jungler a commencé de ton côté :", opts: ["Ton adversaire de lane arrive en retard (leash)", "Ton adversaire est déjà en lane", "La vague arrive", "Aucun"], a: 0, why: "Un laner en retard a aidé son jungler de ce côté." },
        { q: "Tu ne sais pas où est le jungler adverse. Tu joues…", opts: ["Comme s'il était de ton côté", "Comme s'il était mort", "Agressif", "Normalement"], a: 0, why: "Sans info, on suppose le pire." },
        { q: "Quand apparaissent les larves du Néant ?", opts: ['5:00', '6:00', '8:00', '15:00'], a: 2, why: "8:00, une seule fois ; elles partent à 14:45." }
      ],
      practice: { exercises: ['jungler-255'], goal: { text: "2 morts maximum avant 15 min", kpi: 'Morts avant 15 min', target: 2 } }
    },

    // ================================================================== 5. SURVIE ET LECTURE DE LA CARTE
    {
      id: 'survie', n: 5, parcours: 'indiv', icon: 'eye', t: 'Survie et lecture de la carte', minutes: 25, level: 'Tous niveaux',
      roles: ['Top', 'Jungle', 'Mid', 'ADC', 'Support'],
      summary: "L'axe le plus rentable en LP : arrêter les morts évitables. Le regard sur la minimap, l'information manquante, les bons resets, et tes propres morts sur la carte.",
      outcomes: ['2 morts maximum avant 15 min', 'Regarder la minimap toutes les 3 à 5 s', 'Savoir où tu meurs le plus'],
      sources: [SRC.doc],
      lessons: [
        { id: 'minimap', t: 'Le regard sur la minimap', blocks: [
          { p: "Le but : jeter un œil à la minimap **toutes les 3 à 5 secondes**. Le plus simple est de l'accrocher à une action que tu fais déjà : **après chaque last hit**." },
          { schema: { type: 'cycle', caption: "La boucle à répéter pendant toute la phase de lane.", steps: [{ t: 'Last hit' }, { t: 'Coup d\'œil à la minimap', k: 'ok' }, { t: 'Qui manque ?', k: 'q' }, { t: 'Je joue selon l\'info', k: 'ok' }] } },
          { key: "Au début, c'est artificiel. Au bout d'une semaine, ça devient un réflexe : c'est exactement le but de l'exercice « minimap après chaque last hit »." }
        ] },
        { id: 'evitables', t: 'Les morts évitables', blocks: [
          { p: "Ton programme en retient trois causes. Ce sont elles qui coûtent le plus de LP :" },
          { list: [
            "**Le face-check** : entrer dans un buisson ou une zone sans vision, seul.",
            "**L'overextend sans vision** : pousser loin de ta tour alors que la jungle adverse n'est pas suivie.",
            "**Le mauvais timing de reset** : rester trop longtemps avec peu de PV, ou rentrer en laissant la vague sous ta tour."
          ] },
          { w: 'match', id: 'sv-causes', q: "Pour chaque mort, retrouve la cause principale.", choices: ['Face-check', 'Overextend', 'Mauvais reset'], items: [
            { s: "Je suis allé poser une ward dans le buisson de la rivière, seul, sans vision : il y avait le jungler.", a: 0, why: "Entrer seul dans une zone sans vision : face-check. Mieux : ward ou sweeper avant d'entrer, ou y aller avec un allié." },
            { s: "Je poussais ma lane jusqu'à sa tour, le jungler adverse n'avait pas été vu depuis 2 minutes.", a: 1, why: "Loin de ta tour sans info : overextend." },
            { s: "J'étais à 30 % de PV, j'ai voulu farmer une vague de plus, je me suis fait engager.", a: 2, why: "Le reset devait avoir lieu avant : la vague ne valait pas le risque." },
            { s: "J'ai suivi un adversaire bas dans sa jungle et deux autres sont sortis du brouillard.", a: 1, why: "Trop loin, sans vision, avec des adversaires absents de la carte." }
          ] },
          { key: "Ton devoir : « moins de 3 morts avant 15 minutes » sur 10 parties, et une review dédiée à chaque mort : était-elle évitable ? Quelle info était disponible ?" }
        ] },
        { id: 'manquante', t: 'L\'information manquante', blocks: [
          { p: "Règle de ton programme : **si 3 adversaires ne sont pas visibles, considère qu'ils arrivent**. Une absence est une information." },
          { w: 'quick', id: 'sv-quick', q: "Danger ou pas ? Tu as quelques secondes.", secs: 6, yes: 'Danger', no: 'Pas de danger', items: [
            { s: "18 min. Tu es en side lane top. Sur la minimap, seuls l'ADC et le support adverses sont visibles, en bot.", a: true, why: "3 adversaires invisibles : ils peuvent venir sur toi." },
            { s: "12 min. Les 5 adversaires sont visibles au drake, de l'autre côté de la carte.", a: false, why: "Tout le monde est visible et loin : tu peux pousser." },
            { s: "Le mid adverse a disparu de sa lane il y a 10 s. Tu es bot, avancé.", a: true, why: "Un mid qui disparaît vient souvent en bot ou à la rivière." },
            { s: "Le jungler adverse vient d'apparaître en top. Tu es bot, à ta place.", a: false, why: "Il est loin : pas de danger immédiat de sa part." },
            { s: "25 min, Baron vivant, aucun adversaire visible. Tu veux poser une ward près du Baron, seul.", a: true, why: "5 adversaires invisibles près d'un objectif : n'y va pas seul." }
          ] }
        ] },
        { id: 'carte', t: 'Ta carte des morts', blocks: [
          { p: "L'app repère tes morts sur tes dernières parties classées. Regarde où et quand elles reviennent : c'est là que ce cours doit changer quelque chose." },
          { w: 'deaths', id: 'sv-deaths' },
          { p: "En review, pour chaque mort de cette carte : était-elle évitable, et quelle information était disponible à ce moment-là ?" }
        ] },
        { id: 'reset', t: 'Rentrer au bon moment', blocks: [
          { p: "Un bon reset, c'est **après avoir crash la vague**, avec **assez d'or pour un composant clé**. Un mauvais reset fait perdre une vague entière, voire la tour." },
          { schema: { type: 'flow', caption: "Les deux questions à se poser avant de rentrer.", nodes: [{ t: 'Ta vague va vers lui ou crash ?', k: 'q', no: { t: 'Pousse-la d\'abord' } }, { t: 'Assez d\'or pour un composant ?', k: 'q', no: { t: 'Farm encore une vague' } }, { t: 'Reset', k: 'ok' }] } },
          { w: 'choice', id: 'sv-reset', q: "Tu as 40 % de PV et assez d'or pour ton composant. Ta vague va arriver sous ta tour. L'adversaire est plein PV.", opts: [
            { t: "Je nettoie ou je pousse la vague, puis je rentre", ok: true, fb: "Oui, si tu peux le faire sans risque : tu ne perds rien. Si l'adversaire peut t'engager, rentre quand même : une mort coûte plus qu'une vague." },
            { t: "Je rentre tout de suite", ok: false, fb: "Tu perds toute la vague sous ta tour. Pousse-la d'abord si c'est sans risque." },
            { t: "Je reste farmer jusqu'à la prochaine vague", ok: false, fb: "À 40 % de PV face à un adversaire plein PV, tu prends le risque d'une mort pour quelques sbires." }
          ] }
        ] }
      ],
      quiz: [
        { q: "Combien de morts au maximum avant 15 min vise ton programme ?", opts: ['0', '2', '5', 'Peu importe'], a: 1, why: "2 morts ou moins avant 15 min." },
        { q: "Quand regarder la minimap ?", opts: ["Toutes les 3 à 5 s, par exemple après chaque last hit", "Une fois par minute", "Quand je meurs", "Seulement en teamfight"], a: 0, why: "Accroche-le au last hit pour en faire un réflexe." },
        { q: "3 adversaires ne sont pas visibles. Tu…", opts: ["Pousses plus fort", "Considères qu'ils arrivent", "Les ignores", "Vas les chercher"], a: 1, why: "Une absence est une information." },
        { q: "Entrer seul dans un buisson sans vision, c'est…", opts: ["Un face-check", "Un freeze", "Un bon reset", "Un roam"], a: 0, why: "La première cause de mort évitable." },
        { q: "Un bon reset se fait…", opts: ["N'importe quand", "Après avoir crash la vague, avec de l'or pour un composant", "Quand la vague arrive sous ta tour", "Seulement à 0 PV"], a: 1, why: "Tu rentres sans rien perdre et tu reviens plus fort." },
        { q: "En review d'une mort, quelles questions poser ?", opts: ["Qui a mal joué dans mon équipe ?", "Était-elle évitable, et quelle info était disponible ?", "Quel skin avait l'adversaire ?", "Aucune"], a: 1, why: "On cherche ce que tu pouvais contrôler." }
      ],
      practice: { exercises: ['morts15', 'minimap', 'review-morts', 'reset'], goal: { text: "2 morts maximum avant 15 min", kpi: 'Morts avant 15 min', target: 2 } }
    },

    // ================================================================== 6. MACRO INDIVIDUELLE
    {
      id: 'macro', n: 6, parcours: 'indiv', icon: 'dashboard', t: 'Macro individuelle', minutes: 25, level: 'À partir de Silver',
      roles: ['Top', 'Jungle', 'Mid', 'ADC', 'Support'],
      summary: "Savoir comment ton champion gagne la partie, et bouger au bon moment : side lane ou groupe, timing des roams, arriver le premier sur les objectifs.",
      outcomes: ['Écrire ta win condition avant chaque partie', 'Roamer seulement après un crash', 'Arriver le premier sur 2 objectifs par partie'],
      sources: [SRC.doc, SRC.riot26, SRC.riot269],
      lessons: [
        { id: 'wincon', t: 'Ta win condition', blocks: [
          { p: "La win condition, c'est **comment ton champion gagne la partie, et à quel moment il est fort**. Ton programme te demande de l'écrire avant chaque partie : dans le chat de partie ou dans un carnet." },
          { w: 'wincon', id: 'mc-wincon' },
          { key: "Une phrase suffit. Ce qui compte, c'est de l'avoir décidé avant la partie, pas pendant un teamfight." }
        ] },
        { id: 'side', t: 'Side lane ou groupe', blocks: [
          { p: "Après la phase de lane, tu as deux options : tenir une **side lane** (pousser seul une lane sur le côté) ou **grouper** avec ton équipe. Ça dépend de ton champion, de tes objets et de la position des adversaires." },
          { p: "En 2026, Riot a voulu rendre le split push et le siège plus rentables : les **plaques restent sur les tours** pendant toute la partie (aussi sur les tours internes et d'inhibiteur), les champions mêlée font **20 % de dégâts en plus** aux tours, et les vagues arrivent plus vite après la phase de lane (toutes les 25 s, puis 20 s)." },
          { schema: { type: 'flow', caption: "Une grille rapide pour décider.", nodes: [{ t: 'Je gagne mon 1 contre 1 ?', k: 'q', no: { t: 'Groupe avec l\'équipe' } }, { t: 'Je sais où sont les adversaires ?', k: 'q', no: { t: 'Recule ou ward d\'abord' } }, { t: 'Side lane : pousse et force-les à répondre', k: 'ok' }] } },
          { w: 'scenario', id: 'mc-side', steps: [
            { s: "22 min. Tu joues un champion fort en 1 contre 1, avec un objet d'avance. Ton équipe tient le mid à 4. Le Baron est dans 1 minute.", opts: [
              { t: "Je pousse la side lane bot, puis je rejoins pour le Baron", ok: true, fb: "Oui : tu forces un adversaire à venir te répondre, puis tu rejoins à temps pour l'objectif." },
              { t: "Je reste en side jusqu'à faire tomber l'inhibiteur", ok: false, fb: "Trop tard pour le Baron : ton équipe se bat à 4 contre 5." }
            ] },
            { s: "Tu as poussé. Deux adversaires disparaissent de la carte et viennent vers toi.", opts: [
              { t: "Je recule et je préviens : ils sont à 3 au Baron", ok: true, fb: "Exact : tu en attires 2, ton équipe joue le Baron à 4 contre 3." },
              { t: "Je reste pour prendre la tour", ok: false, fb: "Tu vas mourir à 1 contre 2, et ton équipe perd son avantage." }
            ] }
          ] }
        ] },
        { id: 'roams', t: 'Le timing des roams', blocks: [
          { p: "Un roam, c'est quitter ta lane pour aider ailleurs. Ton programme pose deux conditions : **après avoir crash la vague**, et **quand le roam mène à un objectif** (un kill qui donne un drake, une tour, une plaque)." },
          { p: "Depuis le patch 26.9, les quêtes de rôle (top, mid, ADC) sont plus tolérantes : après le niveau 3, chaque **2 minutes passées dans ta lane** te donnent **1 minute de roam** sans perdre de progression de quête. Attention : juste après un retour à la base, le gain passif de quête est coupé pendant 12 secondes." },
          { w: 'choice', id: 'mc-roam', q: "Tu es mid, 6:40. Ta vague va arriver sous ta tour. Ton bot a la priorité et le drake est en vie.", opts: [
            { t: "Je crash ma vague, puis je roam vers le drake avec mon jungler", ok: true, fb: "Oui : le crash couvre ton absence, et le roam mène à un objectif." },
            { t: "Je roam tout de suite vers le bot", ok: false, fb: "Ta vague meurt sous ta tour pendant ton absence : tu perds de l'or et de l'XP." },
            { t: "Je reste mid jusqu'à 10 min", ok: false, fb: "Tu rates une occasion : ta lane peut être couverte par un crash." }
          ] }
        ] },
        { id: 'premier', t: 'Bouger en premier', blocks: [
          { p: "Quand ta lane a la **priorité** (ta vague pousse, l'adversaire doit la nettoyer), tu peux **bouger le premier** vers un objectif. Celui qui arrive en premier choisit le combat." },
          { schema: { type: 'timeline', from: -60, to: 0, unit: 's', ticks: 15, caption: "Le setup d'objectif de ton programme d'équipe, vu depuis ta lane : pousse ta vague, puis va à la rivière.", segs: [{ a: -60, b: -45, t: 'Reset, achats' }, { a: -45, b: -30, t: 'Pousse ta vague', k: 'info' }, { a: -30, b: -15, t: 'Vision', k: 'ok' }, { a: -15, b: 0, t: 'Placement', k: 'ok' }], marks: [{ at: 0, t: 'Objectif', k: 'stop' }] } },
          { list: [
            "**La participation utile** : être présent aux combats décisifs sans abandonner tes vagues.",
            "**La review « 5 décisions »** : en revoyant le mid game, note 5 décisions importantes et juge-les, pas le résultat."
          ] }
        ] }
      ],
      quiz: [
        { q: "Une win condition, c'est…", opts: ["Le score de la partie", "Comment ton champion gagne la partie, et à quel moment il est fort", "La meilleure compo", "Le premier objet"], a: 1, why: "À écrire avant chaque partie." },
        { q: "Quand roamer ?", opts: ["N'importe quand", "Après avoir crash ta vague, quand le roam mène à un objectif", "Quand ta vague arrive sous ta tour", "Jamais"], a: 1, why: "Le crash couvre ton absence ; l'objectif rend le roam rentable." },
        { q: "Depuis le patch 26.9, combien de roam sans perte de quête ?", opts: ["Aucun", "1 min de roam pour 2 min en lane (après le niveau 3)", "Illimité", "30 s par partie"], a: 1, why: "La banque de roam des quêtes de rôle." },
        { q: "Qui choisit le combat autour d'un objectif ?", opts: ["Celui qui arrive le premier", "Celui qui a le plus de kills", "Le jungler adverse", "Personne"], a: 0, why: "Arriver le premier = vision et placement." },
        { q: "En 2026, les plaques des tours…", opts: ["Disparaissent à 14:00", "Restent toute la partie, aussi sur les tours internes", "N'existent plus", "Ne donnent plus d'or"], a: 1, why: "Riot a voulu rendre le siège et le split push rentables." },
        { q: "Tu es en side lane, 2 adversaires disparaissent vers toi. Tu…", opts: ["Restes pour la tour", "Recules et préviens ton équipe", "Vas dans leur jungle", "Rentres à la base sans rien dire"], a: 1, why: "Tu en attires 2 : ton équipe peut jouer l'objectif en surnombre." }
      ],
      practice: { exercises: ['wincon', 'objectifs', '5-decisions'], goal: { text: "55 % de participation aux kills", kpi: 'KP', target: 0.55 } }
    },

    // ================================================================== 7. MENTAL ET ROUTINE
    {
      id: 'mental', n: 7, parcours: 'indiv', icon: 'brain', t: 'Mental et routine', minutes: 15, level: 'Tous niveaux',
      roles: ['Top', 'Jungle', 'Mid', 'ADC', 'Support'],
      summary: "Le fil rouge de ton programme : un joueur tilté ne progresse pas. Ta routine avant la partie, la règle de stop, le chat, et la note mentale après chaque partie.",
      outcomes: ['Une routine de 10 min avant de jouer', 'Arrêter après 2 défaites d\'affilée', 'Une note mentale de 3,5/5 ou plus'],
      sources: [SRC.doc],
      lessons: [
        { id: 'routine', t: 'La routine avant la partie', blocks: [
          { p: "Avant ta première partie classée : **10 minutes d'échauffement**, et **l'objectif de la partie écrit**. Un seul objectif, chiffré et vérifiable." },
          { w: 'check', id: 'mt-routine', q: "Ta routine du jour :", daily: true, items: [
            "10 min de practice tool (last hit et combos)",
            "Mon objectif de partie est écrit (un seul, chiffré)",
            "Ma win condition est écrite",
            "Chat coupé si je suis sensible au tilt (/mute all)",
            "Je sais à quelle heure je m'arrête ce soir"
          ] }
        ] },
        { id: 'stop', t: 'La règle de stop', blocks: [
          { p: "Ton programme fixe une règle simple : **on arrête après 2 défaites d'affilée**, ou dès qu'on se sent tilté. Et **pas de partie classée après une heure fixée**." },
          { w: 'choice', id: 'mt-stop', q: "Il est 23 h 40. Tu viens de perdre 2 parties, la 2e très frustrante. Tu es sûr de gagner la prochaine.", opts: [
            { t: "J'arrête pour ce soir", ok: true, fb: "Oui. Le sentiment « je vais forcément gagner la suivante » est justement un signe de tilt." },
            { t: "Une dernière, pour finir sur une victoire", ok: false, fb: "C'est exactement la partie que la règle de stop évite : fatigue + frustration = mauvaises décisions." },
            { t: "Je passe en normale pour me détendre", ok: false, fb: "Mieux qu'une classée, mais l'heure est passée : le sommeil compte aussi dans ta progression." }
          ] }
        ] },
        { id: 'discours', t: 'Le chat et le discours intérieur', blocks: [
          { p: "On cherche **ce qu'on peut contrôler**, pas la faute des coéquipiers. Si le chat te fait tilter, coupe-le dès le chargement : /mute all." },
          { w: 'match', id: 'mt-pensees', q: "Pour chaque pensée, choisis la version qui t'aide à progresser.", choices: ['Je la garde', 'Je la reformule'], items: [
            { s: "« Mon jungler ne vient jamais bot. »", a: 1, why: "Reformule : « Est-ce que ma vague et ma vision lui permettaient de venir ? »" },
            { s: "« Ma première mort : je n'avais pas regardé la minimap. »", a: 0, why: "C'est une cause que tu contrôles : garde-la, c'est ton point de travail." },
            { s: "« Cette partie était perdue d'avance avec cette compo. »", a: 1, why: "Reformule : « Quelle était ma win condition dans cette compo ? »" },
            { s: "« Je juge mes décisions, pas le résultat de la partie. »", a: 0, why: "C'est une des trois règles d'or de ton programme." }
          ] }
        ] },
        { id: 'note', t: 'La note mentale', blocks: [
          { p: "Après chaque partie, tu donnes une **note mentale de 1 à 5** dans l'app (dans le détail de la partie). Ton objectif : **3,5/5 ou plus** en moyenne." },
          { w: 'scale', id: 'mt-note', q: "Comment te sens-tu après ta dernière partie ?", max: 5, tips: [
            "1 : arrête-toi pour aujourd'hui, la règle de stop s'applique.",
            "2 : fais une vraie pause avant de relancer, et relis ton objectif.",
            "3 : correct. Vérifie ta routine avant la suivante.",
            "4 : bon état : garde le même rythme.",
            "5 : excellent. Note ce qui t'a mis dans cet état, pour le refaire."
          ] },
          { key: "L'app suit aussi le nombre de parties jouées en série après 2 défaites : c'est ton indicateur pour la règle de stop." }
        ] }
      ],
      quiz: [
        { q: "Après combien de défaites d'affilée t'arrêtes-tu ?", opts: ['1', '2', '4', 'Jamais'], a: 1, why: "2 défaites d'affilée, ou dès que tu te sens tilté." },
        { q: "Combien d'objectifs par partie ?", opts: ['Un seul, chiffré et vérifiable', 'Trois', 'Aucun', 'Autant que possible'], a: 0, why: "Règle d'or de ton programme." },
        { q: "On juge…", opts: ["Le résultat de la partie", "Ses décisions", "Les coéquipiers", "La compo"], a: 1, why: "Une bonne décision peut perdre, une mauvaise peut gagner." },
        { q: "Quel objectif pour la note mentale ?", opts: ['2/5', '3,5/5 ou plus', '5/5 toujours', 'Aucun'], a: 1, why: "3,5/5 ou plus en moyenne." },
        { q: "Combien de temps d'échauffement avant la première partie ?", opts: ['Aucun', '10 min', '1 h', '2 parties normales'], a: 1, why: "10 min : last hit, combos, objectif écrit." },
        { q: "« Mon jungler ne vient jamais » devient…", opts: ["« Il est nul »", "« Ma vague et ma vision lui permettaient-elles de venir ? »", "« Je le signale »", "Rien"], a: 1, why: "On cherche ce qu'on contrôle." }
      ],
      practice: { exercises: ['routine', 'stop'], goal: { text: "Note mentale moyenne de 3,5/5 ou plus", kpi: 'Note mentale', target: 3.5 } }
    },

    // ================================================================== 8. SUPPORT, SAISON 16
    {
      id: 'support', n: 8, parcours: 'indiv', icon: 'shield', t: 'Support, saison 16', minutes: 45, level: 'Tous niveaux', credit: "D'après le guide Support saison 16 de Coach Karakal, reformulé et adapté.",
      roles: ['Support'],
      summary: "Le cours le plus complet du parcours. Lire ton ADC, trader et contrôler les buissons, savoir quand roamer, ta vision, tes achats, et comment jouer contre chaque type de support et avec ton jungler.",
      outcomes: ['Adapter ton plan de lane à ton ADC', 'Roamer seulement quand ta lane tient', '2 de score de vision par minute'],
      sources: [SRC.karakal, SRC.doc, SRC.riot26],
      lessons: [
        { id: 'role', t: 'Ton rôle en 2026', blocks: [
          { p: "En 2026, chaque rôle a une quête. Celle du support débloque un **emplacement réservé aux balises de contrôle (pinks)**, une **réduction sur leur prix** et plus d'or passif. Tes trois missions ne changent pas : **protéger ton ADC**, **contrôler la vision**, **impacter la carte** au bon moment." },
          { list: [
            "**Score de vision par minute** : 2 ou plus (ton programme).",
            "**Participation aux kills** : 65 % ou plus pour un support.",
            "**Wards posées, wards détruites, pinks achetées** : suivies dans l'app à chaque partie."
          ] },
          { p: "Coach Karakal note qu'en saison 16 les vagues arrivent plus vite et que la bot lane est plus dure à plonger : les fenêtres de roam sont plus courtes, il faut mieux les choisir. C'est l'objet de la leçon 4." }
        ] },
        { id: 'adc', t: 'Lire ton ADC', blocks: [
          { p: "Ton plan de lane dépend d'abord de **ton** ADC. Coach Karakal classe chaque ADC selon sa force en début de partie. Choisis le tien pour voir le plan." },
          { w: 'adc', id: 'sp-adc' },
          { key: "Le même support ne joue pas la même lane avec Draven et avec Kog'Maw. Décide du plan pendant le chargement de la partie." }
        ] },
        { id: 'trades', t: 'Trades et buissons', blocks: [
          { p: "Avec un ADC fort en début de partie, la première bataille est celle des **buissons** : celui qui les contrôle voit sans être vu, et peut menacer depuis le brouillard." },
          { list: [
            "**Support mêlée** : crash la vague, puis freeze sur le bounce, ou prépare un gank ou un roam pendant que la vague crash.",
            "**Support à distance** : fais grossir la vague et harcèle les adversaires quand ils sont sous leur tour.",
            "**Joue autour du sort clé de ton ADC** : W de Kog'Maw, Q de Yunara, recharge de Jhin, bombe de Tristana.",
            "**Contre un mage en bot** : jamais de long trade, all-in court puis on recule."
          ] },
          { w: 'scenario', id: 'sp-scen', steps: [
            { s: "Niveau 1, tu joues un support engage avec Draven. Les adversaires sont un ADC qui scale et un enchanteur.", opts: [
              { t: "On prend les buissons et on se bat pour le niveau 2", ok: true, fb: "Oui : Draven gagne les premières vagues. Contrôle total des buissons." },
              { t: "On farm tranquillement jusqu'au niveau 6", ok: false, fb: "Tu gâches la force de Draven : c'est maintenant qu'il est le plus fort par rapport à eux." }
            ] },
            { s: "Vous avez crash la vague sur leur tour. Elle revient vers vous.", opts: [
              { t: "On la laisse revenir et on freeze devant notre tour", ok: true, fb: "Exact : jamais de poussée continue avec Draven. Freeze sur le bounce, ils doivent venir farmer chez vous." },
              { t: "On la repousse tout de suite", ok: false, fb: "Poussée continue = vous êtes toujours avancés et exposés aux ganks. Coach Karakal le déconseille avec Draven et Kalista." }
            ] },
            { s: "Leur enchanteur utilise son bouclier sur la vague pour la nettoyer.", opts: [
              { t: "J'engage : son sort défensif est en recharge", ok: true, fb: "Oui : c'est ta fenêtre de trade (cours Phase de lane)." },
              { t: "J'attends qu'il récupère ses sorts", ok: false, fb: "Tu laisses passer la meilleure fenêtre de l'échange." }
            ] }
          ] }
        ] },
        { id: 'roam', t: 'Quand roamer', blocks: [
          { p: "Le roam du support peut décider la partie, mais il coûte cher si ton ADC meurt seul. Avant de partir, vérifie ces conditions (d'après Coach Karakal) :" },
          { w: 'roam', id: 'sp-roam' },
          { p: "Deux timings précis, issus des tests de Coach Karakal en saison 16 :" },
          { list: [
            "**Roam mid tôt** : possible après le crash de la 3e vague, si ton jungler commence côté top. Ton ADC peut en profiter pour rentrer tôt (« cheater recall »), toi aussi.",
            "**Larves (8:00) + niveau 6** : rentre vers 7:20, puis passe par le mid sur la vague à canon : tu arrives niveau 6 pour le combat des larves."
          ] },
          { p: "Les supports très rapides (Janna, par exemple) profitent aussi de la vitesse de retour en lane de 2026, qui dure jusqu'à ta tour extérieure." }
        ] },
        { id: 'vision', t: 'Ta vision', blocks: [
          { p: "**Quel trinket au niveau 1 ?** Coach Karakal le décide selon ton jungler et ta lane :" },
          { w: 'match', id: 'sp-trinket', q: "Pour chaque situation, choisis le trinket de départ.", choices: ['Ward (jaune)', 'Sweeper (rouge)', 'Longue-vue (bleu)'], items: [
            { s: "Ton jungler farme et a besoin d'un premier tour de jungle tranquille.", a: 0, why: "Ward pour couvrir son entrée de jungle ou son clear." },
            { s: "Ton jungler veut ganker bot tôt, ou ta lane gagne et veut contrôler les buissons.", a: 1, why: "Sweeper : tu nettoies leurs wards et tu caches le gank." },
            { s: "L'équipe adverse a des champions à grappin et peut envahir niveau 1.", a: 0, why: "Une ward pour couvrir l'invasion." },
            { s: "Milieu de partie, tu joues un enchanteur et personne dans ton équipe ne peut entrer sans vision.", a: 2, why: "La longue-vue révèle de loin, sans risquer ta vie." }
          ] },
          { p: "**Les pinks (balises de contrôle)** : toujours une à chaque retour à la base. Une fois ta quête terminée, au moins une, et deux avant un objectif. Après 18 minutes, deux quand le contrôle des objectifs devient décisif. Seule exception : tu joues enchanteur et tu es tout près d'un objet important." },
          { p: "**Les Faelights** : ce sont des emplacements fixes qui donnent une vision élargie à la ward posée dessus. Surveille quand l'adversaire en utilise un, et nettoie-le avec ton sweeper ou une pink : c'est souvent sa meilleure vision." }
        ] },
        { id: 'achats', t: 'Tes achats', blocks: [
          { p: "Les règles d'achat de Coach Karakal, au moment de son guide (les prix peuvent bouger d'un patch à l'autre) :" },
          { list: [
            "**Potions** : 2 au départ. Au premier retour contre un support engage, 1 seule suffit. **Plus de potions après le premier retour.**",
            "**Potion réutilisable** : au premier retour contre une lane de poke, si tu peux te la payer après tes composants et ta pink. Jamais achetée ni vendue après 14 minutes.",
            "**Bottes tôt** : quand tu joues engage et veux roamer, contre un bot à distance, ou contre beaucoup de skillshots. Sinon, prends plutôt des PV (cristal de rubis).",
            "**Ordre** : bottes niveau 1, puis premier objet, puis bottes niveau 2 (bottes niveau 2 en priorité si tu roames beaucoup).",
            "**Anti-soin** : après ton premier objet de support (parfois avant), rarement terminé. Contre un champion qui vit de ses soins, ou contre 2 champions qui se soignent beaucoup, ou 1 seul très avancé."
          ] },
          { w: 'choice', id: 'sp-achat', q: "Premier retour avec 550 po, contre Leona et Nautilus (deux supports engage). Que prends-tu ?", opts: [
            { t: "Cristal de rubis, 1 pink, 1 potion", ok: true, fb: "C'est l'exemple de Coach Karakal : des PV contre l'all-in, une pink, et une seule potion suffit contre un engage." },
            { t: "Bottes, potion réutilisable, 2 potions", ok: false, fb: "La réutilisable sert contre une lane de poke ; contre un all-in, les PV comptent plus." },
            { t: "Rien, j'économise pour l'objet complet", ok: false, fb: "Tu restes faible face à leur all-in. Un composant de PV et une pink valent plus qu'un objet plus tard." }
          ] },
          { w: 'choice', id: 'sp-antiheal', q: "L'équipe adverse joue Soraka, et le reste ne se soigne pas beaucoup. Anti-soin ?", opts: [
            { t: "Oui, après mon premier objet de support", ok: true, fb: "Soraka vit de ses soins : un seul champion de ce type suffit pour acheter l'anti-soin." },
            { t: "Non, il en faut au moins 3", ok: false, fb: "Un champion qui vit de ses soins suffit. Les « 2 ou plus », c'est pour les champions qui se soignent beaucoup sans en dépendre." }
          ] }
        ] },
        { id: 'contre', t: 'Contre quel support ?', blocks: [
          { p: "Quelques règles par type de support adverse, d'après la fiche des contres de Coach Karakal :" },
          { list: [
            "**Engage (Alistar, Leona, Nautilus, Rell)** : Alistar est très faible niveau 1. Suis ses roams ou plonge à 2 contre 1 quand il part. Coupe son engage avec tes sorts. Force-le à rester en lane avec du poke ou un freeze.",
            "**Grappin (Blitzcrank, Thresh, Pyke)** : le grappin a une longue recharge. Force-le, puis punis pendant qu'il recharge. Avec de la vision sur lui, il devient simple à jouer. Blitzcrank souffre beaucoup contre les ADC à dash (Ezreal, Lucian, Vayne).",
            "**Braum** : ne te fais pas toucher par son Q, punis quand il est en recharge. Il roame mal et n'a pas d'engage : harcèle-le à distance.",
            "**Janna** : faible en lane, elle doit roamer pour exister. Nami et Sona la dominent en échanges ; les supports à grappin gagnent la lane et peuvent suivre ses roams."
          ] },
          { w: 'choice', id: 'sp-blitz', q: "Blitzcrank vient de rater son grappin sur ton ADC.", opts: [
            { t: "On engage tout de suite : il n'a plus son sort principal", ok: true, fb: "Oui : la longue recharge du grappin est sa grande faiblesse." },
            { t: "On recule, il va recommencer", ok: false, fb: "Pas avant plusieurs secondes : c'est votre fenêtre." }
          ] }
        ] },
        { id: 'jungler', t: 'Jouer avec ton jungler', blocks: [
          { p: "Ton premier mouvement dépend du style de ton jungler :" },
          { list: [
            "**Il doit sécuriser son premier tour** (champions qui farment) : contre un jungler adverse fort, pose une ward pour défendre une invasion de son côté.",
            "**Il veut envahir** (Bel'Veth, par exemple) : ward la jungle adverse pour l'info, puis couvre ses camps, et sois prêt à bouger avec lui.",
            "**Il veut ganker tôt** (Briar, par exemple) : départ au sweeper, et couvre l'entrée de votre jungle pour cacher son point de départ."
          ] },
          { p: "Ensuite, joue autour de ses **moments forts** : beaucoup de junglers deviennent dangereux avec un objet, et très dangereux avec deux. C'est là que tu joues plus agressif avec lui." },
          { key: "Les larves (8:00) se préparent dès 7:20 : retour à la base, puis passage par le mid pour arriver niveau 6 avec ton jungler." }
        ] }
      ],
      quiz: [
        { q: "Avec Draven, après un crash, tu…", opts: ["Repousses tout de suite", "Laisses revenir la vague et tu freeze", "Rentres à la base", "Roames top"], a: 1, why: "Jamais de poussée continue avec Draven ou Kalista." },
        { q: "Quand peux-tu roamer en sécurité ?", opts: ["Dès que tu veux", "Quand la vague a crash ou que les 2 prochaines sont sans canon, et que ton ADC peut tenir", "Seulement au niveau 1", "Jamais"], a: 1, why: "Ta lane doit pouvoir tenir sans toi." },
        { q: "Combien de pinks à chaque retour ?", opts: ['Aucune', 'Au moins une', 'Cinq', 'Seulement après 20 min'], a: 1, why: "Toujours une ; deux avant un objectif une fois ta quête terminée." },
        { q: "Contre Leona et Nautilus, avec 550 po au premier retour :", opts: ["Potion réutilisable", "Cristal de rubis, pink, 1 potion", "Rien", "3 potions"], a: 1, why: "Des PV contre l'all-in." },
        { q: "Un mage en bot (Lux, Syndra…) est faible…", opts: ["Toute la partie", "Jusqu'au niveau 3 et en long trade", "Au niveau 6", "Jamais"], a: 1, why: "All-in court, jamais de long trade ; roam libre dès son premier objet de mana." },
        { q: "Quel score de vision par minute vise un support ?", opts: ['0,5', '1', '2 ou plus', '5'], a: 2, why: "2 ou plus pour un support, d'après ton programme." }
      ],
      practice: { exercises: ['vision', 'niveau2', 'jungler-255'], goal: { text: "2 de score de vision par minute", kpi: 'Vision/min', target: 2 } }
    }
  ];

  const byId = id => LIST.find(c => c.id === id) || null;
  const forParcours = id => LIST.filter(c => c.parcours === id).sort((a, b) => a.n - b.n);
  // nombre d'étapes d'un cours : ses leçons, le quiz, la mise en pratique
  const steps = c => c.lessons.length + 2;
  const api = { PARCOURS, LIST, WAVES, ADCS, ADC_PROFILES, ROAM_LABEL, byId, forParcours, steps };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  return api;
})();
