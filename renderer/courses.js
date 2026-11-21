'use strict';
// Cours du parcours « Jeu individuel » : contenu tiré du programme du coach (Google Doc « Jeu individuel »),
// mis à jour pour la saison 2026 (timers officiels de Riot), plus un cours Support complet.
// Vocabulaire : les termes de jeu sont ceux de la communauté LoL, en anglais (wave, tower, minions, back, item…).
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
    { id: 'indiv', t: "Jeu individuel", sub: "Les bases qui rapportent le plus de LP, dans l'ordre de ton programme : farm, laning phase, survie, macro, mental, et le rôle support." }
  ];

  // ------------------------------------------------------------------ waves (simulateur du cours 2)
  // pos : point de rencontre des waves, de 0 (ta tower) à 1 (sa tower) ; ally / enemy : minions de chaque camp
  const WAVES = {
    lecture: { t: "Lire la wave", frames: [
      { pos: 0.5, ally: 6, enemy: 6, note: "Level 1 : les deux waves se rencontrent au milieu de la lane." },
      { pos: 0.5, ally: 6, enemy: 4, note: "Tu last hit 2 minions adverses : ta wave a maintenant plus de minions." },
      { pos: 0.63, ally: 5, enemy: 2, push: 'right', note: "Le camp qui a le plus de minions push : ta wave avance vers sa tower." },
      { pos: 0.74, ally: 9, enemy: 5, push: 'right', note: "La wave suivante arrive et s'ajoute : le push continue tant que ton camp a l'avantage." }
    ] },
    freeze: { t: "Freeze", frames: [
      { pos: 0.5, ally: 6, enemy: 6, note: "Les waves se rencontrent au milieu." },
      { pos: 0.33, ally: 4, enemy: 6, push: 'left', note: "Tu laisses l'adversaire push : tu ne last hit que les minions qui vont mourir." },
      { pos: 0.2, ally: 3, enemy: 7, note: "La wave s'arrête juste devant ta tower, hors de sa range. Garde 3 ou 4 minions adverses de plus que les tiens." },
      { pos: 0.2, ally: 3, enemy: 7, danger: true, note: "Pour farm, l'adversaire doit venir loin de sa tower, près de toi et de ton jungler." }
    ] },
    slow: { t: "Slow push", frames: [
      { pos: 0.5, ally: 6, enemy: 6, note: "Tu tues d'abord les casters adverses (les minions de derrière)." },
      { pos: 0.57, ally: 6, enemy: 3, push: 'right', note: "Ta wave a un petit avantage : elle avance doucement." },
      { pos: 0.67, ally: 10, enemy: 4, push: 'right', note: "La wave suivante s'ajoute à la tienne : elle grossit sans aller trop vite." },
      { pos: 0.8, ally: 14, enemy: 5, push: 'right', note: "Après 2 ou 3 waves : une très grosse wave, prête à crash sous sa tower." }
    ] },
    crash: { t: "Crash", frames: [
      { pos: 0.82, ally: 14, enemy: 3, push: 'right', note: "Ta grosse wave arrive sur sa tower." },
      { pos: 0.95, ally: 12, enemy: 0, tower: true, note: "Elle crash : l'adversaire doit la clear sous sa tower et perd des minions." },
      { pos: 0.95, ally: 6, enemy: 0, tower: true, free: true, note: "Pendant qu'il clear, tu es libre : back, roam, objectif. C'est du temps gagné." },
      { pos: 0.95, ally: 1, enemy: 0, tower: true, note: "La tower finit ta wave : la suivante va revenir vers toi (le bounce)." }
    ] },
    bounce: { t: "Bounce", frames: [
      { pos: 0.95, ally: 0, enemy: 0, note: "Ta wave est morte sous sa tower." },
      { pos: 0.72, ally: 6, enemy: 7, push: 'left', note: "Les waves suivantes se rencontrent près de sa tower, mais la sienne a l'avantage." },
      { pos: 0.45, ally: 5, enemy: 9, push: 'left', note: "Elle revient vers toi : c'est le bounce." },
      { pos: 0.2, ally: 3, enemy: 7, note: "Elle s'arrête devant ta tower : le moment idéal pour démarrer un freeze." }
    ] }
  };

  // ------------------------------------------------------------------ ADC (cours Support)
  // profil : fort (fort en early), scale (weak early, doit farm), n3 (attend le level 3), mage (mage botlane)
  // roam : facilité à le laisser seul pour roam (1 facile, 2 moyen, 3 difficile, 4 déconseillé)
  const ADC_PROFILES = {
    fort: { t: "Fort en early", k: 'accent', plan: [
      "Joue la prio dès le level 1 : prends le bush control et le level 2 en premier.",
      "Support ranged : fais grossir la wave et poke les adversaires quand ils sont sous leur tower.",
      "Support melee : crash, puis freeze sur le bounce, ou prépare un gank ou un roam pendant que la wave crash.",
      "Une fois le contrôle pris, n'overcommit pas : garde l'avantage avec la wave."
    ] },
    scale: { t: "Weak early, il doit farm", k: 'blue', plan: [
      "Évite les gros fights level 1 : ton travail, c'est que ton ADC farm.",
      "Short trades ; prends les dégâts à sa place si l'adversaire le poke.",
      "Joue pour les ganks de ton jungler et ses power spikes (level 6, premier item)."
    ] },
    n3: { t: "Attend le level 3", k: 'amber', plan: [
      "Weak level 1 : attends le level 3 avant de chercher le fight.",
      "Fort quand la wave bounce vers vous ou grossit de votre côté.",
      "Les all-in sont bons dès que ton ADC peut taper ; avec la prio, rotate vers les objectifs plutôt que de jouer la tower."
    ] },
    mage: { t: "Mage botlane", k: 'violet', plan: [
      "Weak jusqu'au level 3 et incapable de tenir un long trade : all-in court, puis on recule.",
      "Laisse souvent la prio en tout early.",
      "Dès son Chapitre perdu, il clear les waves seul : roam dès que tu peux, et cherche le kill si vous avez le damage."
    ] }
  };
  const ADCS = [
    ['Aphelios', 'scale', 3, "Joue pour son farm. Il fight bien avec son arme bleue ou rouge/blanche ; la violette sert à setup un gank."],
    ['Ashe', 'fort', 3, "Fight tôt pour la prio. Très facile à laisser seule si elle build Poignard de Statikk."],
    ['Caitlyn', 'fort', 4, "Jouez les plates et la tower ; une fois la tower bot tombée, rotate vers la suivante. Roam seulement si elle est behind. Prends Démolition si tu peux."],
    ['Cassiopeia', 'mage', 2, "Elle a besoin de mana : survis jusqu'à son premier back. All-in possible level 2 avec un support à CC, en surveillant son mana."],
    ['Corki', 'fort', 1, "Prends le bush control et joue autour de ses Q et W. Roam facile après son level 6 ; avant, roam après une cannon wave."],
    ['Draven', 'fort', 3, "Gagnez les premières waves. Ne perma push jamais : crash, laisse la wave bounce, puis freeze. Bush control total, pression depuis le fog."],
    ['Ezreal', 'fort', 1, "Regarde s'il stack son passif level 1. Il Q la wave pour la prio et le level 2. Facile à laisser seul : bon wave clear et un dash."],
    ['Hwei', 'mage', 1, "Laisse la prio en early. All-in dès le level 3, jamais de long trade. Roam libre dès son Chapitre perdu."],
    ['Jhin', 'fort', 1, "Mauvais sur les towers : les plates ne sont pas ton objectif. Short trade quand il lui reste une balle, long trade quand il vient de reload."],
    ['Jinx', 'scale', 3, "Prio avec son Q, sinon farm. Si ta jungle ne vient pas, back sur un crash : perdre une wave pour un bon back, c'est acceptable."],
    ["Kai'Sa", 'n3', 2, "Son Q est faible avec des minions autour et très fort sur une cible isolée : CC sur une cible seule, et le fight est gagné."],
    ['Kalista', 'fort', 3, "Comme Draven : gagnez les premières waves, jamais de perma push, freeze sur le bounce, pression depuis le fog."],
    ['Karthus', 'mage', 1, "Peut fight tôt, surtout avec Fatigue. All-in avec ton CC puis recule. Roam libre dès son Chapitre perdu."],
    ["Kog'Maw", 'scale', 3, "Trade seulement quand son W est up. W en cooldown : pas de trade."],
    ['Lucian', 'n3', 3, "Weak level 1, attends le level 3. Avec Nami ou Milio, buff-le et il joue. Inutile de jouer la tower : rotate avec la prio."],
    ['Lux', 'mage', 1, "Weak jusqu'au level 3, jamais de long trade. Roam libre dès son Chapitre perdu."],
    ['Mel', 'mage', 1, "Weak jusqu'au level 3, jamais de long trade. Roam libre dès son Chapitre perdu."],
    ['Miss Fortune', 'fort', 1, "Mauvaise sur les towers. Fight tôt pour la prio, puis crash et freeze sur le bounce, ou roam. Roam facile dès son level 6."],
    ['Nilah', 'n3', 3, "Évite les trades en early ; all-in quand la wave vient vers vous. Long trade si elle peut taper."],
    ['Samira', 'n3', 3, "Évite les trades en early ; all-in quand la wave vient vers vous. Long trade si elle peut taper."],
    ['Senna', 'scale', 3, "Short trades pour qu'elle stack ses âmes. Prends les dégâts à sa place pour qu'elle farm sans être low."],
    ['Seraphine', 'mage', 1, "Jamais de long trade, attends que ses spells soient up. Roam quand tu veux."],
    ['Sivir', 'scale', 1, "Weak en early : laisse la prio à une lane plus forte. Crash et bouge. Dès son premier item AD (BF Glaive), elle clear les waves seule."],
    ['Smolder', 'scale', 1, "Short trades pour qu'il stack. Roam plus tard, une fois ses stacks et son ult up."],
    ['Swain', 'mage', 2, "All-in si son E touche. Au level 6, il tient le dive et clear bien : roam s'il y a mieux à faire."],
    ['Syndra', 'mage', 1, "Weak jusqu'au level 3, jamais de long trade (attends son E). Roam libre dès son Chapitre perdu."],
    ['Tristana', 'n3', 2, "Forte level 2, joue les plates. Joue autour de son E : si la bomb explose en entier, le fight est souvent gagné. Pas d'all-in si la wave est mauvaise."],
    ['Twitch', 'scale', 3, "Weak en early : attends les ganks ou ouvre le mid avec son Q. Au level 6, il clear même une cannon wave."],
    ['Varus', 'fort', 2, "Peut fight tôt et jouer les plates. Gros kill pressure au level 6 avec son ult. Pas d'escape : difficile à dive s'il a son ult."],
    ['Vayne', 'scale', 3, "Évite les gros fights level 1, joue son farm. Bon trade auto + Q + auto, mais range très courte."],
    ['Veigar', 'mage', 1, "Attends sa cage pour trade, jamais de long trade. Une fois quelques items, difficile à dive."],
    ["Vel'Koz", 'mage', 1, "Laisse-le poke et joue le contrôle de la wave ; jamais de long trade."],
    ['Viktor', 'mage', 1, "Weak jusqu'au level 3, jamais de long trade. Roam libre dès son Chapitre perdu."],
    ['Xayah', 'n3', 1, "Forte si tu peux CC et jouer autour de ses plumes ; avec Rakan, prenez Démolition. Très safe avec son ult."],
    ['Yasuo', 'n3', 3, "Weak level 1, attends le level 3. Fort quand la wave bounce vers vous. Long trade s'il peut taper."],
    ['Yunara', 'n3', 1, "Trade quand son Q est up, comme Kog'Maw avec son W. All-in level 6 intéressant. Attention aux cannon waves."],
    ['Zeri', 'scale', 2, "Weak en early : attends les ganks ou l'all-in level 6. Surveille son E (dash)."],
    ['Ziggs', 'mage', 1, "Prends Démolition si tu peux. Laisse-le poke, all-in possible, jamais de long trade."],
    ['Zyra', 'mage', 1, "Weak jusqu'au level 3, jamais de long trade. Roam libre dès qu'elle a de l'AP."]
  ].map(([name, profile, roam, note]) => ({ name, profile, roam, note }));
  const ROAM_LABEL = { 1: "Roam facile", 2: "Roam moyen", 3: "Roam difficile", 4: "Roam déconseillé" };

  const SRC = {
    doc: { t: "Ton programme « Jeu individuel »" },
    riot26: { t: "Riot : Season 2026 (aperçu officiel)", url: 'https://www.leagueoflegends.com/news/dev/dev-2026-season-one-gameplay-preview/' },
    riot269: { t: "Riot : patch notes 26.9 (quêtes de rôle)", url: 'https://www.leagueoflegends.com/en-au/news/game-updates/league-of-legends-patch-26-9-notes/' },
    wiki: { t: "Wiki LoL : timers des larves du Néant et du Héraut", url: 'https://wiki.leagueoflegends.com/en-us/Voidgrub_camp' },
    dodge: { t: "dodge.gg : guide jungle 2026 (tracking)", url: 'https://www.dodge.gg/lol/news/jungle-guide-2026' },
    nerfplz: { t: "nerfplz : wave management", url: 'https://www.nerfplz.com/2026/08/wave-management-explained-freezing-slow.html' },
    moba: { t: "Mobalytics : wave management", url: 'https://mobalytics.gg/blog/wave-management/' }
  };

  const LIST = [
    // ================================================================== 1. FARM ET FONDAMENTAUX
    {
      id: 'farm', n: 1, parcours: 'indiv', icon: 'wheat', t: "Farm et fondamentaux", minutes: 20, level: "Tous elos",
      roles: ['Top', 'Jungle', 'Mid', 'ADC'],
      summary: "Le farm est ta première source de gold. Tu apprends à ne plus perdre de minions, en lane comme sous ta tower, et à réduire ton champion pool.",
      outcomes: ["70 CS à 10 min en ranked", "Plus aucun minion perdu sous ta tower", "Jouer 2 ou 3 champions, pas 8"],
      sources: [SRC.doc],
      lessons: [
        { id: 'pourquoi', t: "Pourquoi le farm d'abord", blocks: [
          { p: "Ton programme corrige d'abord ce qui coûte le plus de LP. Pour la plupart des joueurs, ce sont les **morts évitables**, le **farm** et la **gestion de la lane**, bien avant la macro avancée." },
          { p: "Chaque minion raté, c'est du gold en moins. Une wave compte environ 6 minions : rater 10 CS à 10 minutes, c'est presque 2 waves entières, donc un item en retard sur ton adversaire." },
          { schema: { type: 'curve', target: 70, caption: "Repères pour 70 CS à 10 min. Si tu es en dessous à 4 min, tu as raté trop de minions en early." } },
          { w: 'cs', id: 'farm-calc' },
          { key: "Les repères de ton programme : **7 CS/min ou plus**, puis **8 ou plus** selon le rang, et **70 CS à 10 min**. En practice tool, sans adversaire : 80 CS à 10 min." }
        ] },
        { id: 'lasthit', t: "Le last hit en lane", blocks: [
          { p: "Le last hit, c'est donner le dernier coup au minion pour prendre le gold. Les casters (les minions ranged, derrière) ont moins de HP que les melee minions : ils tombent plus vite." },
          { list: [
            "**Attends** que le minion soit assez low : une auto trop tôt le laisse en vie et fait push ta wave.",
            "**Anticipe** le temps de ton auto : l'animation et le projectile mettent un instant à arriver.",
            "**Garde un spell** pour le minion que tu allais rater, pas pour clear la wave sans raison.",
            "**Regarde la minimap** après chaque last hit (cours Survie)."
          ] },
          { w: 'choice', id: 'farm-lh', q: "Deux minions sont presque morts en même temps : un melee et un caster. Ton auto ne peut en finir qu'un. Lequel ?", opts: [
            { t: "Le caster, puis le melee avec un spell si besoin", ok: true, fb: "Oui : le caster a moins de HP et meurt vite, il passe en premier. Garde ton spell pour le second." },
            { t: "Le melee, il donne plus de gold", ok: false, fb: "Le melee a plus de HP : il tient un peu plus longtemps. Le caster serait perdu." },
            { t: "Aucun, j'attends la wave suivante", ok: false, fb: "Tu perds les deux. Prends celui qui va mourir en premier (le caster), puis l'autre avec un spell." }
          ] }
        ] },
        { id: 'tour', t: "Farm sous ta tower", blocks: [
          { p: "Après un back ou un gank, la wave arrive sous ta tower. La tower tape fort : il faut placer ton auto au bon moment." },
          { schema: { type: 'rows', caption: "Rythme de base en early : la tower fait l'essentiel, ton auto finit le minion. Avec plus de dégâts (items), adapte le rythme.", rows: [
            { label: "Melee minion", chips: [{ t: "Tower", k: 'stop' }, { t: "Tower", k: 'stop' }, { t: "Ton auto : last hit", k: 'ok' }] },
            { label: "Caster minion", chips: [{ t: "Ton auto", k: 'info' }, { t: "Tower", k: 'stop' }, { t: "Ton auto : last hit", k: 'ok' }] }
          ] } },
          { w: 'order', id: 'farm-ordre', q: "Remets dans l'ordre le last hit d'un caster qui arrive full HP sous ta tower.", items: ["Tu le frappes une fois", "La tower le frappe", "Ton auto le finit"], fb: "Un caster full HP mourrait directement sous un coup de tower : ton auto d'abord le met à la bonne vie." },
          { key: "Ton objectif de partie : « aucun minion perdu sous la tower ». Compte-les en review." }
        ] },
        { id: 'pool', t: "Champion pool, combos et settings", blocks: [
          { p: "Pendant la phase de fondamentaux, tu joues **2 ou 3 champions dans un seul rôle principal**, plus un rôle secondaire. Avec 8 champions, tu réapprends les bases à chaque partie au lieu de progresser." },
          { list: [
            "**Combos** de tes 2 ou 3 champions : ordre des spells, animation cancel, ranges exactes.",
            "**Settings** : caméra, keybinds, quick cast, attack move.",
            "**10 minutes de practice tool** avant ta première partie du jour."
          ] },
          { w: 'check', id: 'farm-reglages', q: "Coche ce qui est déjà en place chez toi :", items: [
            "Je joue 3 champions maximum dans mon rôle principal",
            "Je connais mon combo principal par cœur",
            "Le quick cast est activé sur mes spells",
            "J'ai une touche d'attack move",
            "Je fais 10 min de practice tool avant ma première partie"
          ] }
        ] }
      ],
      quiz: [
        { q: "Quel repère de CS à 10 min vise ton programme en ranked ?", opts: ["50", "70", "100", "Peu importe"], a: 1, why: "70 CS à 10 min en ranked, 80 en practice tool sans adversaire." },
        { q: "Rater 12 CS à 10 min, c'est environ…", opts: ["Un minion", "2 waves", "5 waves", "Rien de grave"], a: 1, why: "Une wave compte environ 6 minions : 12 CS, c'est 2 waves entières." },
        { q: "Sous ta tower, un melee minion full HP arrive. Que fais-tu ?", opts: ["Je le frappe tout de suite", "J'attends 2 coups de tower, puis mon auto le finit", "Je le laisse à la tower", "J'utilise mon ult"], a: 1, why: "Melee : tower, tower, puis ton auto." },
        { q: "Combien de champions jouer pendant la phase de fondamentaux ?", opts: ["1", "2 ou 3 dans un rôle", "5 ou 6", "Le plus possible"], a: 1, why: "2 ou 3 champions dans un rôle principal, plus un rôle secondaire." },
        { q: "Quel minion tombe le plus vite ?", opts: ["Le melee", "Le caster", "Le cannon", "Ils ont tous les mêmes HP"], a: 1, why: "Le caster a moins de HP." },
        { q: "À quoi sert ton spell pendant le farm ?", opts: ["À clear la wave le plus vite possible", "À finir le minion que tu allais rater", "À rien", "À poke uniquement"], a: 1, why: "Garde-le pour le minion que tu allais perdre ; clear sans raison fait push ta wave." }
      ],
      practice: { exercises: ['cs10-perso', 'cs-tour', 'combo'], goal: { text: "70 CS à 10 min en moyenne", kpi: 'CS à 10 min', target: 70 } }
    },

    // ================================================================== 2. WAVE MANAGEMENT
    {
      id: 'vagues', n: 2, parcours: 'indiv', icon: 'waves', t: "Wave management", minutes: 30, level: "Tous elos",
      roles: ['Top', 'Mid', 'ADC', 'Support'],
      summary: "Où est la wave, et où tu veux qu'elle soit. Freeze, slow push, crash et bounce : quand utiliser chacun, avant un back, un roam ou un dragon.",
      outcomes: ["Lire où va la wave", "Réussir un freeze par partie", "Crash avant chaque back"],
      sources: [SRC.doc, SRC.nerfplz, SRC.moba],
      lessons: [
        { id: 'lire', t: "Lire la wave", blocks: [
          { p: "Une règle simple : **le camp qui a le plus de minions push**. Si ta wave a plus de minions que la sienne, elle avance vers sa tower. Sinon, elle recule vers la tienne." },
          { w: 'wave', id: 'v-lecture', mode: 'lecture' },
          { p: "Avant chaque décision, pose-toi une seule question : est-ce que je veux cette wave près de ma tower, près de la sienne, ou en train de crash sous sa tower ?" },
          { key: "Ton exercice : annoncer à voix haute l'état de la wave toutes les 30 secondes (en review)." }
        ] },
        { id: 'freeze', t: "Le freeze", blocks: [
          { p: "Le freeze bloque la wave **juste devant ta tower, hors de sa range**. Tu ne last hit que le minion qui va mourir, et tu gardes 3 ou 4 minions adverses de plus que les tiens pour qu'elle ne bouge pas." },
          { w: 'wave', id: 'v-freeze', mode: 'freeze' },
          { list: [
            "**Quand ?** Quand tu as peur d'un gank, ou pour forcer l'adversaire à venir farm près de toi et de ton jungler.",
            "**Le meilleur moment pour le démarrer :** quand la wave revient vers toi après un crash (bounce).",
            "**Ce qui le casse :** tuer trop de minions adverses. Ta wave reprend l'avantage et repart."
          ] }
        ] },
        { id: 'push', t: "Slow push et crash", blocks: [
          { p: "Le **slow push** fait grossir ta wave sur 2 ou 3 waves : tu tues d'abord les casters adverses, sans tout clear. Puis cette grosse wave **crash** sous sa tower." },
          { w: 'wave', id: 'v-slow', mode: 'slow' },
          { w: 'wave', id: 'v-crash', mode: 'crash' },
          { p: "Le crash ne sert pas surtout à tuer des minions : il te fait **gagner du temps**. Pendant que l'adversaire clear sous sa tower, tu peux back, roam ou aller sur un objectif sans rien perdre." },
          { p: "Le **fast push**, c'est clear la wave le plus vite possible : quand tu as besoin de ce temps tout de suite (un back avant un dragon, par exemple)." }
        ] },
        { id: 'bounce', t: "Bounce et back", blocks: [
          { p: "Après un crash, la tower tue ta wave. Les waves suivantes se rencontrent près de sa tower, mais la sienne a l'avantage : elle **revient vers toi**. C'est le bounce." },
          { w: 'wave', id: 'v-bounce', mode: 'bounce' },
          { schema: { type: 'flow', caption: "Le cycle à reproduire : un back sans perte, puis une wave bien placée à ton retour en lane.", nodes: [{ t: "Slow push" }, { t: "Crash sous sa tower", k: 'info' }, { t: "Back pendant qu'il clear", k: 'ok' }, { t: "La wave bounce : freeze", k: 'ok' }] } },
          { key: "Back **après un crash**, jamais quand ta wave est sur le point d'arriver sous ta tower : tu perdrais toute une wave, voire des plates." }
        ] },
        { id: 'choisir', t: "Choisir le bon état", blocks: [
          { p: "Ton programme résume les cas où la wave décide de la suite : avant un back, avant un dragon, contre un jungler adverse proche." },
          { w: 'match', id: 'v-match', q: "Pour chaque situation, choisis ce que tu fais de ta wave.", choices: ["Freeze", "Slow push", "Crash / fast push"], items: [
            { s: "Tu veux back dans 30 secondes.", a: 2, why: "Crash d'abord : tu back pendant qu'il clear, sans perdre de minions." },
            { s: "Le jungler adverse vient d'être vu près de ta lane.", a: 0, why: "Reste près de ta tower : un freeze te met hors de portée du gank." },
            { s: "Le dragon spawn dans 1 minute et tu es mid.", a: 2, why: "Push ta wave pour arriver le premier à la river." },
            { s: "Tu as l'avantage, tu veux dive avec ton jungler dans 2 waves.", a: 1, why: "Une grosse wave protège le dive : elle prend l'aggro de la tower." },
            { s: "Ton adversaire est behind et doit farm pour revenir.", a: 0, why: "Freeze : il doit venir farm près de toi, ou perdre ses minions." },
            { s: "Tu veux roam mid, mais ta wave va arriver sous ta tower.", a: 2, why: "Crash d'abord, sinon tu perds la wave sous ta tower pendant ton roam." },
            { s: "La wave revient vers toi après ton crash.", a: 0, why: "Le bounce est le meilleur moment pour démarrer un freeze." },
            { s: "Tu veux une grosse wave qui crash quand tu iras sur les larves du Néant à 8:00.", a: 1, why: "Démarre un slow push 2 ou 3 waves avant : elle crashera au bon moment." }
          ] }
        ] }
      ],
      quiz: [
        { q: "Quel camp push la wave ?", opts: ["Celui du joueur le plus fort", "Celui qui a le plus de minions", "Toujours le side bleu", "Celui qui a le last hit"], a: 1, why: "Le camp avec le plus de minions push vers l'autre tower." },
        { q: "Pour freeze, tu gardes…", opts: ["Plus de minions à toi que les siens", "3 ou 4 minions adverses de plus que les tiens", "Autant des deux côtés", "Aucun minion"], a: 1, why: "Avec 3 ou 4 minions adverses de plus, la wave reste devant ta tower." },
        { q: "Slow push : tu tues d'abord…", opts: ["Les melee minions adverses", "Les casters adverses", "Tes propres minions", "Le cannon seulement"], a: 1, why: "Les casters adverses en premier, sans tout clear : ta wave grossit doucement." },
        { q: "À quoi sert surtout un crash ?", opts: ["À tuer le plus de minions", "À gagner du temps pour back, roam ou objectif", "À faire tomber la tower seul", "À rien"], a: 1, why: "Pendant qu'il clear sous sa tower, tu as du temps libre sans rien perdre." },
        { q: "Quel est le meilleur moment pour démarrer un freeze ?", opts: ["Juste après le crash de ta wave, quand elle revient vers toi", "Au level 1", "Quand ta wave est sous sa tower", "Jamais"], a: 0, why: "Le bounce ramène la wave devant ta tower : parfait pour freeze." },
        { q: "Tu veux back : ta wave arrive sous ta tower dans 10 s. Que fais-tu ?", opts: ["Je back tout de suite", "Je push d'abord (ou j'attends la wave suivante)", "Je freeze", "Je fight"], a: 1, why: "Back maintenant fait perdre toute la wave sous ta tower." }
      ],
      practice: { exercises: ['freeze', 'vague-annonce', 'reset'], goal: { text: "Un freeze réussi par partie et un gold diff positif à 10 min", kpi: 'Écart or à 10 min', target: 0 } }
    },

    // ================================================================== 3. LANING PHASE ET TRADES
    {
      id: 'trades', n: 3, parcours: 'indiv', icon: 'sword', t: "Laning phase et trades", minutes: 25, level: "Tous elos",
      roles: ['Top', 'Mid', 'ADC', 'Support'],
      summary: "Quand frapper et quand reculer : les fenêtres de trade, les level spikes 2, 3 et 6, et comment la wave change chaque trade.",
      outcomes: ["Trade quand l'adversaire est pris", "Prendre le level 2 en premier", "Ne plus trade dans sa wave"],
      sources: [SRC.doc],
      lessons: [
        { id: 'fenetres', t: "Les fenêtres de trade", blocks: [
          { p: "Un bon trade, c'est frapper quand l'adversaire **ne peut pas répondre**. Ton programme en retient trois moments :" },
          { list: [
            "**Son spell clé est en cooldown** : il vient de le lancer sur la wave ou sur toi.",
            "**Il last hit** : il s'avance vers le minion et son auto part sur le minion, pas sur toi.",
            "**Tu as un avantage de level** : tu as un spell de plus ou un rang de plus."
          ] },
          { schema: { type: 'flow', caption: "Avant chaque trade, deux questions suffisent.", nodes: [{ t: "Son spell clé est en cooldown ?", k: 'q', no: { t: "Attends" } }, { t: "Ma wave est au moins égale ?", k: 'q', no: { t: "Pas de trade" } }, { t: "Short trade, puis recule", k: 'ok' }] } },
          { w: 'choice', id: 'tr-fen', q: "Ton adversaire mid lance son spell principal sur la wave pour la clear. Que fais-tu ?", opts: [
            { t: "Je m'avance et je trade pendant son cooldown", ok: true, fb: "Oui : c'est la fenêtre. Il ne peut plus répondre avec son meilleur spell." },
            { t: "Je recule, il a l'avantage", ok: false, fb: "Au contraire : son spell est en cooldown, c'est toi qui as l'avantage pendant quelques secondes." },
            { t: "Je clear aussi la wave", ok: false, fb: "Tu rates la fenêtre : il va récupérer son spell et le trade redevient égal." }
          ] }
        ] },
        { id: 'paliers', t: "Les level spikes 2, 3 et 6", blocks: [
          { p: "Le premier à passer **level 2** a un spell de plus : c'est le meilleur moment pour trade. Le level 3 complète souvent le combo, et le **level 6** ajoute l'ult : beaucoup de champions deviennent dangereux d'un coup." },
          { schema: { type: 'flow', caption: "Le moment exact dépend de ta lane : vérifie une fois en custom game sur quel minion de la 2e wave tu passes level 2.", nodes: [{ t: "1re wave : farm propre" }, { t: "2e wave : prends l'XP en premier", k: 'info' }, { t: "Level 2 : nouveau spell", k: 'ok' }, { t: "Trade tout de suite", k: 'ok' }] } },
          { list: [
            "Regarde le level de ton adversaire sur le scoreboard, ou au-dessus de sa tête.",
            "Juste avant son level 6, recule un peu : il peut avoir un all-in que tu n'as pas encore vu.",
            "Au moment où **tu** passes un level spike avant lui, frappe tout de suite : la fenêtre dure quelques secondes."
          ] }
        ] },
        { id: 'vague', t: "Trade avec la wave", blocks: [
          { p: "Les minions tapent aussi. Trade **dans sa wave**, c'est prendre l'aggro de tous ses minions en plus de lui. Trade quand **ta wave est plus grosse**, c'est l'inverse." },
          { schema: { type: 'lane', labels: { ally: "ta tower", enemy: "sa tower", river: "river" }, caption: "Tes minions en bleu, les siens en rouge.", rows: [
            { t: "Bon trade", k: 'ok', pos: 0.58, ally: 7, enemy: 3, note: "Ta wave est plus grosse : ses minions tapent peu, les tiens le touchent pendant le fight." },
            { t: "Mauvais trade", k: 'stop', pos: 0.42, ally: 3, enemy: 7, note: "Tu vas trade au milieu de sa wave : ses minions te prennent pour cible dès que tu le touches." }
          ] } },
          { key: "Un slow push te donne des trades protégés : ta wave grossit, et chaque trade se fait de ton côté." }
        ] },
        { id: 'scenario', t: "Scénario : tes 4 premières minutes", blocks: [
          { p: "Mets tout ensemble. Tu es mid, en ranked, ton adversaire joue un mage." },
          { w: 'scenario', id: 'tr-scen', steps: [
            { s: "Level 1. Les waves se rencontrent. Ton adversaire lance son spell de poke sur la wave.", opts: [
              { t: "Je l'auto et je recule", ok: true, fb: "Bon réflexe : un short trade pendant son cooldown." },
              { t: "Je reste derrière mes minions", ok: false, fb: "Pas grave, mais tu laisses passer une fenêtre gratuite." }
            ] },
            { s: "La 2e wave arrive. Tu es à 2 minions du level 2, lui aussi.", opts: [
              { t: "Je m'avance pour prendre l'XP en premier, spell prêt à monter", ok: true, fb: "Oui : le premier level 2 gagne le trade suivant." },
              { t: "Je farm normalement", ok: false, fb: "Tu risques de passer level 2 après lui et de subir son trade." }
            ] },
            { s: "Tu passes level 2 en premier. Sa wave est plus grosse que la tienne.", opts: [
              { t: "Je short trade, en restant hors de sa wave", ok: true, fb: "Exact : tu profites du level sans prendre l'aggro de ses minions." },
              { t: "J'all-in au milieu de ses minions", ok: false, fb: "Ses minions vont te cibler : le level d'avance ne compense pas une wave entière." }
            ] },
            { s: "3:00. Ton jungler a commencé botside. Le jungler adverse n'a pas été vu.", opts: [
              { t: "Je reste prudent : pas de trade loin de ma tower sans info", ok: true, fb: "Oui : sans info, considère qu'il peut arriver (cours Jungle tracking)." },
              { t: "Je push jusqu'à sa tower pour la plate", ok: false, fb: "Risqué : un jungler non tracké à ce moment-là peut très bien venir mid." }
            ] }
          ] }
        ] }
      ],
      quiz: [
        { q: "Quand trade ?", opts: ["Quand son spell clé est en cooldown", "Quand il a tous ses spells", "Quand sa wave est plus grosse", "Au hasard"], a: 0, why: "Son spell en cooldown = il ne peut pas répondre." },
        { q: "Pourquoi le level 2 en premier compte-t-il ?", opts: ["Il donne du gold", "Tu as un spell de plus pour trade", "Il fait push la wave", "Il ne compte pas"], a: 1, why: "Un spell de plus pendant quelques secondes : le trade est pour toi." },
        { q: "Trade au milieu de sa wave, c'est…", opts: ["Une bonne idée", "Prendre l'aggro de ses minions en plus", "Neutre", "Obligatoire"], a: 1, why: "Ses minions te ciblent dès que tu le touches." },
        { q: "Juste avant son level 6, tu…", opts: ["Restes au contact", "Recules un peu", "Back", "Freeze"], a: 1, why: "Son ult peut changer l'all-in d'un coup." },
        { q: "Un moment où l'adversaire ne peut pas bien répondre :", opts: ["Quand il last hit un minion", "Quand il est sous sa tower full HP", "Quand il est level 6", "Jamais"], a: 0, why: "Pendant son last hit, son auto part sur le minion." },
        { q: "Un slow push t'aide pour trade parce que…", opts: ["Ta wave est plus grosse, les trades se font de ton côté", "Il ralentit l'adversaire", "Il donne de l'XP", "Il n'aide pas"], a: 0, why: "Tes minions tapent avec toi, les siens sont moins nombreux." }
      ],
      practice: { exercises: ['niveau2', 'vague-annonce'], goal: { text: "XP diff positif à 10 min", kpi: 'Écart XP à 10 min', target: 0 } }
    },

    // ================================================================== 4. JUNGLE TRACKING
    {
      id: 'tracking', n: 4, parcours: 'indiv', icon: 'radio', t: "Jungle tracking", minutes: 25, level: "Tous elos",
      roles: ['Top', 'Mid', 'ADC', 'Support', 'Jungle'],
      summary: "La plupart des morts en early viennent d'un jungler qu'on n'a pas tracké. Les timers 2026, les indices de son start, et la ward au bon moment.",
      outcomes: ["Connaître les timers 2026 par cœur", "Prédire sa position à 2:55", "Poser la ward défensive au bon moment"],
      sources: [SRC.doc, SRC.riot26, SRC.wiki, SRC.dodge],
      lessons: [
        { id: 'timers', t: "Les timers de la Season 2026", blocks: [
          { p: "Depuis la Season 2026, tout démarre plus tôt : les minions spawn à **0:30** et les premiers camps de jungle **35 secondes plus tôt** qu'avant. Le Carapateur spawn donc à **2:55**." },
          { schema: { type: 'timeline', from: 0, to: 8, unit: 'min', caption: "Early game en 2026. Larves du Néant à 8:00 (une seule fois), Héraut de la Faille à 15:00, Baron Nashor à 20:00. Atakhan n'existe plus.", segs: [{ a: 0, b: 0.92, t: "Début" }, { a: 0.92, b: 2.92, t: "Full clear (camps à 0:55)", k: 'info' }, { a: 2.92, b: 5, t: "Carapateurs, ganks", k: 'stop' }, { a: 5, b: 8, t: "Dragon, puis larves", k: 'ok' }], marks: [{ at: 0.5, t: "Minions 0:30" }, { at: 2.92, t: "Carapateur 2:55", k: 'stop' }, { at: 5, t: "Dragon 5:00", k: 'ok' }, { at: 8, t: "Larves 8:00", k: 'ok' }] } },
          { w: 'quick', id: 'tk-timers', q: "Vrai ou faux ? Réponds avant la fin de la barre.", secs: 7, yes: "Vrai", no: "Faux", items: [
            { s: "Le Carapateur spawn à 2:55.", a: true, why: "35 s plus tôt qu'en 2025 (3:30)." },
            { s: "Les larves du Néant spawn deux fois par partie.", a: false, why: "Une seule fois, à 8:00 ; elles despawn à 14:45." },
            { s: "Le Baron spawn à 20:00.", a: true, why: "Atakhan a été retiré : le Baron revient à 20:00." },
            { s: "Les premiers camps de jungle spawn à 1:30.", a: false, why: "À 0:55 depuis 2026 (Krugs et Gromp à 1:07)." },
            { s: "Le Héraut de la Faille spawn à 15:00, à la place des larves.", a: true, why: "Les larves despawn à 14:45, le Héraut arrive à 15:00." }
          ] }
        ] },
        { id: 'depart', t: "Trouver son start", blocks: [
          { p: "Le jungler adverse finit en général son full clear **du côté opposé à celui où il a commencé**, vers le spawn du Carapateur. Le savoir te dit où il sera vers 2:55." },
          { list: [
            "**Le leash** : un laner adverse arrive en retard en lane, il a leash son jungler de ce côté.",
            "**Un buff vu** par une ward, ou le jungler aperçu au début.",
            "**Son nombre de CS** sur le scoreboard : il te dit combien de camps il a déjà faits.",
            "**L'absence** : il n'apparaît nulle part sur un côté où il aurait dû se montrer."
          ] },
          { w: 'map', id: 'tk-map1', q: "Ton équipe a vu le jungler adverse start à son Red buff (topside de sa jungle). Il fait un full clear. Où est-il vers 2:55 ?", context: { paths: [{ pts: ['rRouge', 'rKrugs', 'rRaptors', 'rLoups', 'rBleu', 'rGromp'], k: 'stop', dash: true }], markers: [{ at: 'rRouge', t: "Start vu", k: 'stop' }] }, showPathAfter: true, zones: [
            { at: [24, 38], r: 9, t: "Carapateur top", ok: false, fb: "C'est le côté où il a commencé : il en est parti depuis longtemps." },
            { at: [72, 62], r: 9, t: "Carapateur bot", ok: true, fb: "Oui : parti topside, il finit son clear botside, au moment où le Carapateur spawn. Danger pour la botlane et le mid." },
            { at: [47, 23], r: 8, t: "Son Red buff", ok: false, fb: "Le Red buff ne respawn pas avant un bon moment : il n'a aucune raison d'y être." },
            { at: [50, 50], r: 8, t: "Mid lane", ok: false, fb: "Possible plus tard, mais vers 2:55 il termine d'abord son clear, botside." }
          ] }
        ] },
        { id: 'ward', t: "La ward défensive au bon moment", blocks: [
          { p: "Ton programme est clair : on ward **selon le tracking, pas par habitude**. Une ward posée à 1:30 dans un coin où il n'ira pas avant 4:00 ne sert à rien." },
          { w: 'map', id: 'tk-map2', q: "Tu es mid. Le jungler adverse a start botside de sa jungle : il finira topside vers 2:55. Où poses-tu ta ward vers 2:40 ?", context: { markers: [{ at: 'rBleu', t: "Start vu (botside)", k: 'stop' }] }, zones: [
            { at: [36, 40], r: 8, t: "River topside, près du mid", ok: true, fb: "Oui : c'est son chemin vers toi et vers le Carapateur top, juste au bon moment." },
            { at: [64, 60], r: 8, t: "River botside, près du mid", ok: false, fb: "Il a commencé de ce côté : à 2:55, il sera de l'autre côté de la map." },
            { at: [47, 66], r: 7, t: "Tes Raptors", ok: false, fb: "Dans ta propre jungle, botside : pas sur son chemin à ce moment-là." },
            { at: [53, 34], r: 7, t: "Ses Raptors", ok: false, fb: "Trop deep et risqué seul ; et il est déjà passé par là." }
          ] },
          { key: "Le bon réflexe : je sais d'où il vient, je ward sur son chemin **juste avant** qu'il y passe." }
        ] },
        { id: 'jouer', t: "Jouer avec l'info", blocks: [
          { p: "Le tracking ne sert que s'il change ta façon de jouer :" },
          { list: [
            "**Il est de ton côté** : pas de trade loin de ta tower, pas de push au-delà de la river sans vision, garde ton escape.",
            "**Il est de l'autre côté** : c'est ta fenêtre. Trade, push, prends une plate.",
            "**Tu ne sais pas** : joue comme s'il était de ton côté."
          ] },
          { w: 'quick', id: 'tk-quick', q: "Danger ou pas ? Décide vite, comme en partie.", secs: 6, yes: "Danger", no: "Pas de danger", items: [
            { s: "3:00, le jungler adverse vient d'apparaître sur le Carapateur bot. Tu es top et tu push.", a: false, why: "Il est à l'autre bout de la map : tu as le temps." },
            { s: "Tu es bot. Le jungler adverse a start topside et n'a pas été revu. Il est 2:50.", a: true, why: "Full clear depuis le topside : il arrive botside vers 2:55." },
            { s: "Le mid adverse et le jungler sont MIA. Tu es top, au milieu de la lane.", a: true, why: "Deux adversaires MIA vers toi : recule." },
            { s: "Le jungler adverse vient de mourir botlane. Tu es mid.", a: false, why: "Il est mort : profite de la fenêtre." },
            { s: "5:30, tu ne l'as pas vu depuis 1 min 30 et ta wave est près de sa tower.", a: true, why: "Sans info, joue comme s'il était de ton côté." }
          ] }
        ] }
      ],
      quiz: [
        { q: "À quelle heure spawn le Carapateur en 2026 ?", opts: ["2:00", "2:55", "3:15", "3:30"], a: 1, why: "35 s plus tôt qu'en 2025 : 2:55." },
        { q: "Un jungler qui start topside finit en général son clear…", opts: ["Topside", "Botside", "Au mid", "À sa base"], a: 1, why: "Il termine du côté opposé à son start." },
        { q: "Quand poser ta ward défensive ?", opts: ["Le plus tôt possible", "Juste avant qu'il passe, sur son chemin", "Jamais", "Après sa mort"], a: 1, why: "Selon le tracking, pas par habitude." },
        { q: "Un indice que le jungler a start de ton côté :", opts: ["Ton laner adverse arrive en retard (leash)", "Ton adversaire est déjà en lane", "La wave arrive", "Aucun"], a: 0, why: "Un laner en retard a leash son jungler de ce côté." },
        { q: "Tu ne sais pas où est le jungler adverse. Tu joues…", opts: ["Comme s'il était de ton côté", "Comme s'il était mort", "Agressif", "Normalement"], a: 0, why: "Sans info, on suppose le pire." },
        { q: "Quand spawn les larves du Néant ?", opts: ["5:00", "6:00", "8:00", "15:00"], a: 2, why: "8:00, une seule fois ; elles despawn à 14:45." }
      ],
      practice: { exercises: ['jungler-255'], goal: { text: "2 morts maximum avant 15 min", kpi: 'Morts avant 15 min', target: 2 } }
    },

    // ================================================================== 5. SURVIE ET MAP AWARENESS
    {
      id: 'survie', n: 5, parcours: 'indiv', icon: 'eye', t: "Survie et map awareness", minutes: 25, level: "Tous elos",
      roles: ['Top', 'Jungle', 'Mid', 'ADC', 'Support'],
      summary: "L'axe le plus rentable en LP : arrêter les morts évitables. Le regard sur la minimap, les adversaires MIA, les bons backs, et tes propres morts sur la map.",
      outcomes: ["2 morts maximum avant 15 min", "Regarder la minimap toutes les 3 à 5 s", "Savoir où tu meurs le plus"],
      sources: [SRC.doc],
      lessons: [
        { id: 'minimap', t: "Le regard sur la minimap", blocks: [
          { p: "Le but : jeter un œil à la minimap **toutes les 3 à 5 secondes**. Le plus simple est de l'accrocher à une action que tu fais déjà : **après chaque last hit**." },
          { schema: { type: 'cycle', caption: "La boucle à répéter pendant toute la laning phase.", steps: [{ t: "Last hit" }, { t: "Coup d'œil à la minimap", k: 'ok' }, { t: "Qui est MIA ?", k: 'q' }, { t: "Je joue selon l'info", k: 'ok' }] } },
          { key: "Au début, c'est artificiel. Au bout d'une semaine, ça devient un réflexe : c'est exactement le but de l'exercice « minimap après chaque last hit »." }
        ] },
        { id: 'evitables', t: "Les morts évitables", blocks: [
          { p: "Ton programme en retient trois causes. Ce sont elles qui coûtent le plus de LP :" },
          { list: [
            "**Le facecheck** : entrer dans un bush ou une zone sans vision, seul.",
            "**L'overextend sans vision** : push loin de ta tower alors que la jungle adverse n'est pas trackée.",
            "**Le mauvais timing de back** : rester trop longtemps low HP, ou back en laissant la wave sous ta tower."
          ] },
          { w: 'match', id: 'sv-causes', q: "Pour chaque mort, retrouve la cause principale.", choices: ["Facecheck", "Overextend", "Mauvais back"], items: [
            { s: "Je suis allé ward le bush de la river, seul, sans vision : le jungler y était.", a: 0, why: "Entrer seul dans une zone sans vision : facecheck. Mieux : une ward ou le Brouilleur oraculaire avant d'entrer, ou y aller avec un allié." },
            { s: "Je push ma lane jusqu'à sa tower, le jungler adverse n'avait pas été vu depuis 2 minutes.", a: 1, why: "Loin de ta tower sans info : overextend." },
            { s: "J'étais à 30 % de HP, j'ai voulu farm une wave de plus, je me suis fait engage.", a: 2, why: "Le back devait avoir lieu avant : la wave ne valait pas le risque." },
            { s: "J'ai chase un adversaire low dans sa jungle et deux autres sont sortis du fog.", a: 1, why: "Trop loin, sans vision, avec des adversaires MIA." }
          ] },
          { key: "Ton devoir : « moins de 3 morts avant 15 minutes » sur 10 parties, et une review dédiée à chaque mort : était-elle évitable ? Quelle info était disponible ?" }
        ] },
        { id: 'manquante', t: "Les adversaires MIA", blocks: [
          { p: "Règle de ton programme : **si 3 adversaires ne sont pas visibles, considère qu'ils arrivent**. Un adversaire MIA, c'est déjà une info." },
          { w: 'quick', id: 'sv-quick', q: "Danger ou pas ? Tu as quelques secondes.", secs: 6, yes: "Danger", no: "Pas de danger", items: [
            { s: "18 min. Tu es en side lane top. Sur la minimap, seuls l'ADC et le support adverses sont visibles, botlane.", a: true, why: "3 adversaires MIA : ils peuvent venir sur toi." },
            { s: "12 min. Les 5 adversaires sont visibles au dragon, de l'autre côté de la map.", a: false, why: "Tout le monde est visible et loin : tu peux push." },
            { s: "Le mid adverse a disparu de sa lane il y a 10 s. Tu es bot, avancé.", a: true, why: "Un mid MIA vient souvent botlane ou à la river." },
            { s: "Le jungler adverse vient d'apparaître toplane. Tu es bot, à ta place.", a: false, why: "Il est loin : pas de danger immédiat de sa part." },
            { s: "25 min, Baron up, aucun adversaire visible. Tu veux ward près du Baron, seul.", a: true, why: "5 adversaires MIA près d'un objectif : n'y va pas seul." }
          ] }
        ] },
        { id: 'carte', t: "Tes morts sur la map", blocks: [
          { p: "L'app repère tes morts sur tes dernières parties ranked. Regarde où et quand elles reviennent : c'est là que ce cours doit changer quelque chose." },
          { w: 'deaths', id: 'sv-deaths' },
          { p: "En review, pour chaque mort de cette map : était-elle évitable, et quelle info était disponible à ce moment-là ?" }
        ] },
        { id: 'reset', t: "Back au bon moment", blocks: [
          { p: "Un bon back, c'est **après avoir crash la wave**, avec **assez de gold pour un composant clé**. Un mauvais back fait perdre une wave entière, voire la tower." },
          { schema: { type: 'flow', caption: "Les deux questions à se poser avant de back.", nodes: [{ t: "Ta wave va vers lui ou crash ?", k: 'q', no: { t: "Push-la d'abord" } }, { t: "Assez de gold pour un composant ?", k: 'q', no: { t: "Farm encore une wave" } }, { t: "Back", k: 'ok' }] } },
          { w: 'choice', id: 'sv-reset', q: "Tu as 40 % de HP et assez de gold pour ton composant. Ta wave va arriver sous ta tower. L'adversaire est full HP.", opts: [
            { t: "Je clear ou je push la wave, puis je back", ok: true, fb: "Oui, si tu peux le faire sans risque : tu ne perds rien. Si l'adversaire peut t'engage, back quand même : une mort coûte plus qu'une wave." },
            { t: "Je back tout de suite", ok: false, fb: "Tu perds toute la wave sous ta tower. Push-la d'abord si c'est sans risque." },
            { t: "Je reste farm jusqu'à la prochaine wave", ok: false, fb: "À 40 % de HP face à un adversaire full HP, tu prends le risque d'une mort pour quelques minions." }
          ] }
        ] }
      ],
      quiz: [
        { q: "Combien de morts au maximum avant 15 min vise ton programme ?", opts: ["0", "2", "5", "Peu importe"], a: 1, why: "2 morts ou moins avant 15 min." },
        { q: "Quand regarder la minimap ?", opts: ["Toutes les 3 à 5 s, par exemple après chaque last hit", "Une fois par minute", "Quand je meurs", "Seulement en teamfight"], a: 0, why: "Accroche-le au last hit pour en faire un réflexe." },
        { q: "3 adversaires sont MIA. Tu…", opts: ["Push plus fort", "Considères qu'ils arrivent", "Les ignores", "Vas les chercher"], a: 1, why: "Un adversaire MIA, c'est déjà une info." },
        { q: "Entrer seul dans un bush sans vision, c'est…", opts: ["Un facecheck", "Un freeze", "Un bon back", "Un roam"], a: 0, why: "La première cause de mort évitable." },
        { q: "Un bon back se fait…", opts: ["N'importe quand", "Après avoir crash la wave, avec du gold pour un composant", "Quand la wave arrive sous ta tower", "Seulement à 0 HP"], a: 1, why: "Tu back sans rien perdre et tu reviens plus fort." },
        { q: "En review d'une mort, quelles questions poser ?", opts: ["Qui a mal joué dans mon équipe ?", "Était-elle évitable, et quelle info était disponible ?", "Quel skin avait l'adversaire ?", "Aucune"], a: 1, why: "On cherche ce que tu pouvais contrôler." }
      ],
      practice: { exercises: ['morts15', 'minimap', 'review-morts', 'reset'], goal: { text: "2 morts maximum avant 15 min", kpi: 'Morts avant 15 min', target: 2 } }
    },

    // ================================================================== 6. MACRO INDIVIDUELLE
    {
      id: 'macro', n: 6, parcours: 'indiv', icon: 'dashboard', t: "Macro individuelle", minutes: 25, level: "À partir de Silver",
      roles: ['Top', 'Jungle', 'Mid', 'ADC', 'Support'],
      summary: "Savoir comment ton champion gagne la partie, et bouger au bon moment : side lane ou group, timing des roams, arriver le premier sur les objectifs.",
      outcomes: ["Écrire ta win condition avant chaque partie", "Roam seulement après un crash", "Arriver le premier sur 2 objectifs par partie"],
      sources: [SRC.doc, SRC.riot26, SRC.riot269],
      lessons: [
        { id: 'wincon', t: "Ta win condition", blocks: [
          { p: "La win condition, c'est **comment ton champion gagne la partie, et à quel moment il power spike**. Ton programme te demande de l'écrire avant chaque partie : dans le chat ou dans un carnet." },
          { w: 'wincon', id: 'mc-wincon' },
          { key: "Une phrase suffit. Ce qui compte, c'est de l'avoir décidée avant la partie, pas pendant un teamfight." }
        ] },
        { id: 'side', t: "Side lane ou group", blocks: [
          { p: "Après la laning phase, tu as deux options : tenir une **side lane** (split push) ou **group** avec ton équipe. Ça dépend de ton champion, de tes items et de la position des adversaires." },
          { p: "En 2026, Riot a voulu rendre le split push et le siege plus rentables : les **plates restent sur les towers** toute la partie (aussi sur les inner et inhibitor towers), les champions melee font **20 % de dégâts en plus** aux towers, et les waves arrivent plus vite après la laning phase (toutes les 25 s, puis 20 s)." },
          { schema: { type: 'flow', caption: "Une grille rapide pour décider.", nodes: [{ t: "Je gagne mon 1v1 ?", k: 'q', no: { t: "Group avec l'équipe" } }, { t: "Je sais où sont les adversaires ?", k: 'q', no: { t: "Recule ou ward d'abord" } }, { t: "Split push : force-les à répondre", k: 'ok' }] } },
          { w: 'scenario', id: 'mc-side', steps: [
            { s: "22 min. Tu joues un champion fort en 1v1, avec un item d'avance. Ton équipe tient le mid à 4. Le Baron spawn dans 1 minute.", opts: [
              { t: "Je push la side lane bot, puis je rejoins pour le Baron", ok: true, fb: "Oui : tu forces un adversaire à venir te répondre, puis tu rejoins à temps pour l'objectif." },
              { t: "Je reste en side jusqu'à prendre l'inhibitor", ok: false, fb: "Trop tard pour le Baron : ton équipe fight en 4v5." }
            ] },
            { s: "Tu as push. Deux adversaires sont MIA et viennent vers toi.", opts: [
              { t: "Je recule et je ping : ils sont à 3 au Baron", ok: true, fb: "Exact : tu en attires 2, ton équipe joue le Baron en 4v3." },
              { t: "Je reste pour prendre la tower", ok: false, fb: "Tu vas mourir en 1v2, et ton équipe perd son avantage." }
            ] }
          ] }
        ] },
        { id: 'roams', t: "Le timing des roams", blocks: [
          { p: "Un roam, c'est quitter ta lane pour aider ailleurs. Ton programme pose deux conditions : **après avoir crash la wave**, et **quand le roam mène à un objectif** (un kill qui donne un dragon, une tower, une plate)." },
          { p: "Depuis le patch 26.9, les quêtes de rôle (top, mid, ADC) sont plus tolérantes : après le level 3, chaque **2 minutes passées dans ta lane** te donnent **1 minute de roam** sans perdre de progression de quête. Attention : juste après un back, le gain passif de quête est coupé pendant 12 secondes." },
          { w: 'choice', id: 'mc-roam', q: "Tu es mid, 6:40. Ta wave va arriver sous ta tower. Ta botlane a la prio et le dragon est up.", opts: [
            { t: "Je crash ma wave, puis je roam vers le dragon avec mon jungler", ok: true, fb: "Oui : le crash couvre ton absence, et le roam mène à un objectif." },
            { t: "Je roam tout de suite vers la botlane", ok: false, fb: "Ta wave meurt sous ta tower pendant ton absence : tu perds du gold et de l'XP." },
            { t: "Je reste mid jusqu'à 10 min", ok: false, fb: "Tu rates une occasion : ta lane peut être couverte par un crash." }
          ] }
        ] },
        { id: 'premier', t: "Move first", blocks: [
          { p: "Quand ta lane a la **prio** (ta wave push, l'adversaire doit la clear), tu peux **bouger le premier** vers un objectif. Celui qui arrive en premier choisit le fight." },
          { schema: { type: 'timeline', from: -60, to: 0, unit: 's', ticks: 15, caption: "Le setup d'objectif de ton programme d'équipe, vu depuis ta lane : push ta wave, puis va à la river.", segs: [{ a: -60, b: -45, t: "Back, achats" }, { a: -45, b: -30, t: "Push ta wave", k: 'info' }, { a: -30, b: -15, t: "Vision", k: 'ok' }, { a: -15, b: 0, t: "Placement", k: 'ok' }], marks: [{ at: 0, t: "Objectif", k: 'stop' }] } },
          { list: [
            "**La participation utile** : être présent aux fights décisifs sans abandonner tes waves.",
            "**La review « 5 décisions »** : en revoyant le mid game, note 5 décisions importantes et juge-les, pas le résultat."
          ] }
        ] }
      ],
      quiz: [
        { q: "Une win condition, c'est…", opts: ["Le score de la partie", "Comment ton champion gagne la partie, et à quel moment il power spike", "La meilleure compo", "Le premier item"], a: 1, why: "À écrire avant chaque partie." },
        { q: "Quand roam ?", opts: ["N'importe quand", "Après avoir crash ta wave, quand le roam mène à un objectif", "Quand ta wave arrive sous ta tower", "Jamais"], a: 1, why: "Le crash couvre ton absence ; l'objectif rend le roam rentable." },
        { q: "Depuis le patch 26.9, combien de roam sans perte de quête ?", opts: ["Aucun", "1 min de roam pour 2 min en lane (après le level 3)", "Illimité", "30 s par partie"], a: 1, why: "La banque de roam des quêtes de rôle." },
        { q: "Qui choisit le fight autour d'un objectif ?", opts: ["Celui qui arrive le premier", "Celui qui a le plus de kills", "Le jungler adverse", "Personne"], a: 0, why: "Arriver le premier = vision et placement." },
        { q: "En 2026, les plates des towers…", opts: ["Disparaissent à 14:00", "Restent toute la partie, aussi sur les inner towers", "N'existent plus", "Ne donnent plus de gold"], a: 1, why: "Riot a voulu rendre le siege et le split push rentables." },
        { q: "Tu es en side lane, 2 adversaires MIA viennent vers toi. Tu…", opts: ["Restes pour la tower", "Recules et ping ton équipe", "Vas dans leur jungle", "Back sans rien dire"], a: 1, why: "Tu en attires 2 : ton équipe peut jouer l'objectif en surnombre." }
      ],
      practice: { exercises: ['wincon', 'objectifs', '5-decisions'], goal: { text: "55 % de kill participation", kpi: 'KP', target: 0.55 } }
    },

    // ================================================================== 7. MENTAL ET ROUTINE
    {
      id: 'mental', n: 7, parcours: 'indiv', icon: 'brain', t: "Mental et routine", minutes: 15, level: "Tous elos",
      roles: ['Top', 'Jungle', 'Mid', 'ADC', 'Support'],
      summary: "Le fil rouge de ton programme : un joueur tilt ne progresse pas. Ta routine avant la partie, la règle de stop, le chat, et la note mentale après chaque partie.",
      outcomes: ["Une routine de 10 min avant de jouer", "Stop après 2 lose d'affilée", "Une note mentale de 3,5/5 ou plus"],
      sources: [SRC.doc],
      lessons: [
        { id: 'routine', t: "La routine avant la partie", blocks: [
          { p: "Avant ta première ranked : **10 minutes d'échauffement**, et **l'objectif de la partie écrit**. Un seul objectif, chiffré et vérifiable." },
          { w: 'check', id: 'mt-routine', q: "Ta routine du jour :", daily: true, items: [
            "10 min de practice tool (last hit et combos)",
            "Mon objectif de partie est écrit (un seul, chiffré)",
            "Ma win condition est écrite",
            "Chat coupé si je suis sensible au tilt (/mute all)",
            "Je sais à quelle heure je m'arrête ce soir"
          ] }
        ] },
        { id: 'stop', t: "La règle de stop", blocks: [
          { p: "Ton programme fixe une règle simple : **stop après 2 lose d'affilée**, ou dès que tu te sens tilt. Et **pas de ranked après une heure fixée**." },
          { w: 'choice', id: 'mt-stop', q: "Il est 23 h 40. Tu viens de perdre 2 parties, la 2e très frustrante. Tu es sûr de gagner la prochaine.", opts: [
            { t: "J'arrête pour ce soir", ok: true, fb: "Oui. Le sentiment « je vais forcément gagner la suivante » est justement un signe de tilt." },
            { t: "Une dernière, pour finir sur une win", ok: false, fb: "C'est exactement la partie que la règle de stop évite : fatigue + frustration = mauvaises décisions." },
            { t: "Je lance une normal game pour me détendre", ok: false, fb: "Mieux qu'une ranked, mais l'heure est passée : le sommeil compte aussi dans ta progression." }
          ] }
        ] },
        { id: 'discours', t: "Le chat et le discours intérieur", blocks: [
          { p: "On cherche **ce qu'on peut contrôler**, pas la faute des mates. Si le chat te fait tilt, coupe-le dès le loading screen : /mute all." },
          { w: 'match', id: 'mt-pensees', q: "Pour chaque pensée, choisis la version qui t'aide à progresser.", choices: ["Je la garde", "Je la reformule"], items: [
            { s: "« Mon jungler ne vient jamais bot. »", a: 1, why: "Reformule : « Est-ce que ma wave et ma vision lui permettaient de venir ? »" },
            { s: "« Ma première mort : je n'avais pas regardé la minimap. »", a: 0, why: "C'est une cause que tu contrôles : garde-la, c'est ton point de travail." },
            { s: "« Cette partie était perdue d'avance avec cette draft. »", a: 1, why: "Reformule : « Quelle était ma win condition dans cette draft ? »" },
            { s: "« Je juge mes décisions, pas le résultat de la partie. »", a: 0, why: "C'est une des trois règles d'or de ton programme." }
          ] }
        ] },
        { id: 'note', t: "La note mentale", blocks: [
          { p: "Après chaque partie, tu donnes une **note mentale de 1 à 5** dans l'app (dans le détail de la partie). Ton objectif : **3,5/5 ou plus** en moyenne." },
          { w: 'scale', id: 'mt-note', q: "Comment te sens-tu après ta dernière partie ?", max: 5, tips: [
            "1 : arrête-toi pour aujourd'hui, la règle de stop s'applique.",
            "2 : fais une vraie pause avant de relancer, et relis ton objectif.",
            "3 : correct. Vérifie ta routine avant la suivante.",
            "4 : bon état : garde le même rythme.",
            "5 : excellent. Note ce qui t'a mis dans cet état, pour le refaire."
          ] },
          { key: "L'app suit aussi le nombre de parties jouées en série après 2 lose : c'est ton indicateur pour la règle de stop." }
        ] }
      ],
      quiz: [
        { q: "Après combien de lose d'affilée t'arrêtes-tu ?", opts: ["1", "2", "4", "Jamais"], a: 1, why: "2 lose d'affilée, ou dès que tu te sens tilt." },
        { q: "Combien d'objectifs par partie ?", opts: ["Un seul, chiffré et vérifiable", "Trois", "Aucun", "Autant que possible"], a: 0, why: "Règle d'or de ton programme." },
        { q: "On juge…", opts: ["Le résultat de la partie", "Ses décisions", "Les mates", "La draft"], a: 1, why: "Une bonne décision peut perdre, une mauvaise peut gagner." },
        { q: "Quel objectif pour la note mentale ?", opts: ["2/5", "3,5/5 ou plus", "5/5 toujours", "Aucun"], a: 1, why: "3,5/5 ou plus en moyenne." },
        { q: "Combien de temps d'échauffement avant la première ranked ?", opts: ["Aucun", "10 min", "1 h", "2 normal games"], a: 1, why: "10 min : last hit, combos, objectif écrit." },
        { q: "« Mon jungler ne vient jamais » devient…", opts: ["« Il est nul »", "« Ma wave et ma vision lui permettaient-elles de venir ? »", "« Je le report »", "Rien"], a: 1, why: "On cherche ce qu'on contrôle." }
      ],
      practice: { exercises: ['routine', 'stop'], goal: { text: "Note mentale moyenne de 3,5/5 ou plus", kpi: 'Note mentale', target: 3.5 } }
    },

    // ================================================================== 8. SUPPORT, SEASON 16
    {
      id: 'support', n: 8, parcours: 'indiv', icon: 'shield', t: "Support, Season 16", minutes: 45, level: "Tous elos",
      roles: ['Support'],
      summary: "Le cours le plus complet du parcours. Lire ton ADC, trades et bush control, savoir quand roam, ta vision, tes achats, et comment jouer contre chaque type de support et avec ton jungler.",
      outcomes: ["Adapter ton gameplan à ton ADC", "Roam seulement quand ta lane tient", "2 de score de vision par minute"],
      sources: [SRC.doc, SRC.riot26],
      lessons: [
        { id: 'role', t: "Ton rôle en 2026", blocks: [
          { p: "En 2026, chaque rôle a une quête de rôle. Celle du support débloque un **emplacement réservé aux pinks**, une **réduction sur leur prix** et plus de gold passif. Tes trois missions ne changent pas : **protéger ton ADC**, **contrôler la vision**, **impacter la map** au bon moment." },
          { list: [
            "**Score de vision par minute** : 2 ou plus (ton programme).",
            "**Kill participation** : 65 % ou plus pour un support.",
            "**Wards posées, wards détruites, pinks achetées** : suivies dans l'app à chaque partie."
          ] },
          { p: "En Season 16, les waves arrivent plus vite et la botlane est plus dure à dive : les fenêtres de roam sont plus courtes, il faut mieux les choisir. C'est l'objet de la leçon 4." }
        ] },
        { id: 'adc', t: "Lire ton ADC", blocks: [
          { p: "Ton gameplan en lane dépend d'abord de **ton** ADC. Chaque ADC est classé selon sa force en early. Choisis le tien pour voir le plan." },
          { w: 'adc', id: 'sp-adc' },
          { key: "Le même support ne joue pas la même lane avec Draven et avec Kog'Maw. Décide du plan pendant le loading screen." }
        ] },
        { id: 'trades', t: "Trades et bush control", blocks: [
          { p: "Avec un ADC fort en early, la première bataille est celle des **bushes** : celui qui les contrôle voit sans être vu, et peut mettre la pression depuis le fog." },
          { list: [
            "**Support melee** : crash la wave, puis freeze sur le bounce, ou prépare un gank ou un roam pendant que la wave crash.",
            "**Support ranged** : fais grossir la wave et poke les adversaires quand ils sont sous leur tower.",
            "**Joue autour du spell clé de ton ADC** : W de Kog'Maw, Q de Yunara, reload de Jhin, E de Tristana.",
            "**Contre un mage botlane** : jamais de long trade, all-in court puis on recule."
          ] },
          { w: 'scenario', id: 'sp-scen', steps: [
            { s: "Level 1, tu joues un engage support avec Draven. En face : un ADC qui scale et un enchanter.", opts: [
              { t: "On prend le bush control et on fight pour le level 2", ok: true, fb: "Oui : Draven gagne les premières waves. Bush control total." },
              { t: "On farm tranquillement jusqu'au level 6", ok: false, fb: "Tu gâches la force de Draven : c'est maintenant qu'il est le plus fort par rapport à eux." }
            ] },
            { s: "Vous avez crash la wave sous leur tower. Elle bounce vers vous.", opts: [
              { t: "On la laisse revenir et on freeze devant notre tower", ok: true, fb: "Exact : jamais de perma push avec Draven. Freeze sur le bounce, ils doivent venir farm chez vous." },
              { t: "On la repush tout de suite", ok: false, fb: "Perma push = vous êtes toujours avancés et exposés aux ganks. À éviter avec Draven et Kalista." }
            ] },
            { s: "Leur enchanter utilise son shield sur la wave pour la clear.", opts: [
              { t: "J'engage : son spell défensif est en cooldown", ok: true, fb: "Oui : c'est ta fenêtre de trade (cours Laning phase et trades)." },
              { t: "J'attends qu'il récupère ses spells", ok: false, fb: "Tu laisses passer la meilleure fenêtre du trade." }
            ] }
          ] }
        ] },
        { id: 'roam', t: "Quand roam", blocks: [
          { p: "Le roam du support peut décider la partie, mais il coûte cher si ton ADC meurt seul. Avant de partir, vérifie ces conditions :" },
          { w: 'roam', id: 'sp-roam' },
          { p: "Deux timings précis, testés en Season 16 :" },
          { list: [
            "**Roam mid en early** : possible après le crash de la 3e wave, si ton jungler start topside. Ton ADC peut en profiter pour faire un cheater recall, toi aussi.",
            "**Larves du Néant (8:00) + level 6** : back vers 7:20, puis passe par le mid sur la cannon wave : tu arrives level 6 pour le fight des larves."
          ] },
          { p: "Les supports très rapides (Janna, par exemple) profitent aussi du bonus de vitesse en quittant la base, qui dure en 2026 jusqu'à ta outer tower." }
        ] },
        { id: 'vision', t: "Ta vision", blocks: [
          { p: "**Quel trinket au level 1 ?** Ça dépend de ton jungler et de ta lane :" },
          { w: 'match', id: 'sp-trinket', q: "Pour chaque situation, choisis ton trinket de départ.", choices: ["Balise camouflée (jaune)", "Brouilleur oraculaire (rouge)", "Altération divinatoire (bleue)"], items: [
            { s: "Ton jungler farm et a besoin d'un full clear tranquille.", a: 0, why: "Une ward pour couvrir son entrée de jungle ou son clear." },
            { s: "Ton jungler veut gank bot tôt, ou ta lane gagne et veut le bush control.", a: 1, why: "Brouilleur oraculaire : tu clear leurs wards et tu caches le gank." },
            { s: "L'équipe adverse a des champions à hook et peut invade level 1.", a: 0, why: "Une ward pour couvrir l'invade." },
            { s: "Mid game, tu joues un enchanter et personne dans ton équipe ne peut facecheck.", a: 2, why: "L'Altération divinatoire révèle de loin, sans risquer ta vie." }
          ] },
          { p: "**Les pinks** : toujours une à chaque back. Une fois ta quête terminée, au moins une, et deux avant un objectif. Après 18 minutes, deux quand le contrôle des objectifs devient décisif. Seule exception : tu joues enchanter et tu es tout près d'un item important." },
          { p: "**Les Faelights** : ce sont des emplacements fixes qui donnent une vision élargie à la ward posée dessus. Surveille quand l'adversaire en utilise une, et clear sa ward avec ton Brouilleur oraculaire ou une pink : c'est souvent sa meilleure vision." }
        ] },
        { id: 'achats', t: "Tes achats", blocks: [
          { p: "Les règles d'achat du support en Season 16 (les prix peuvent bouger d'un patch à l'autre) :" },
          { list: [
            "**Potions de soin** : 2 au départ. Au premier back contre un engage support, 1 seule suffit. **Plus de potions après le premier back.**",
            "**Potion rechargeable** : au premier back contre une lane de poke, si tu peux te la payer après tes composants et ta pink. Jamais achetée ni vendue après 14 minutes.",
            "**Bottes tôt** : quand tu joues engage et veux roam, contre une botlane ranged, ou contre beaucoup de skillshots. Sinon, prends plutôt des HP (Cristal de rubis).",
            "**Ordre** : bottes de base, puis premier item, puis bottes améliorées (en priorité si tu roam beaucoup).",
            "**Anti-soin** : après ton premier item support (parfois avant), rarement terminé. Contre un champion qui vit de ses heals, contre 2 champions qui se heal beaucoup, ou contre 1 seul très fed."
          ] },
          { w: 'choice', id: 'sp-achat', q: "Premier back avec 550 gold, contre Leona et Nautilus (deux engage supports). Que prends-tu ?", opts: [
            { t: "Cristal de rubis, 1 pink, 1 potion", ok: true, fb: "Des HP contre l'all-in, une pink, et une seule potion suffit contre un engage." },
            { t: "Bottes, Potion rechargeable, 2 potions", ok: false, fb: "La Potion rechargeable sert contre une lane de poke ; contre un all-in, les HP comptent plus." },
            { t: "Rien, j'économise pour l'item complet", ok: false, fb: "Tu restes faible face à leur all-in. Un composant de HP et une pink valent plus qu'un item plus tard." }
          ] },
          { w: 'choice', id: 'sp-antiheal', q: "L'équipe adverse joue Soraka, et le reste ne se heal pas beaucoup. Anti-soin ?", opts: [
            { t: "Oui, après mon premier item support", ok: true, fb: "Soraka vit de ses heals : un seul champion de ce type suffit pour acheter l'anti-soin." },
            { t: "Non, il en faut au moins 3", ok: false, fb: "Un champion qui vit de ses heals suffit. Les « 2 ou plus », c'est pour les champions qui se heal beaucoup sans en dépendre." }
          ] }
        ] },
        { id: 'contre', t: "Contre quel support ?", blocks: [
          { p: "Quelques règles selon le type de support adverse :" },
          { list: [
            "**Engage (Alistar, Leona, Nautilus, Rell)** : Alistar est très faible level 1. Suis ses roams, ou dive en 2v1 quand il part. Coupe son engage avec tes spells. Force-le à rester en lane avec du poke ou un freeze.",
            "**Hook (Blitzcrank, Thresh, Pyke)** : le hook a un long cooldown. Force-le, puis punis pendant le cooldown. Avec de la vision sur lui, il devient simple à jouer. Blitzcrank souffre beaucoup contre les ADC à dash (Ezreal, Lucian, Vayne).",
            "**Braum** : ne te fais pas toucher par son Q, punis quand il est en cooldown. Il roam mal et n'a pas d'engage : poke-le.",
            "**Janna** : faible en lane, elle doit roam pour exister. Nami et Sona la dominent en trades ; les supports à hook gagnent la lane et peuvent suivre ses roams."
          ] },
          { w: 'choice', id: 'sp-blitz', q: "Blitzcrank vient de rater son hook sur ton ADC.", opts: [
            { t: "On engage tout de suite : son hook est en cooldown", ok: true, fb: "Oui : le long cooldown du hook est sa grande faiblesse." },
            { t: "On recule, il va recommencer", ok: false, fb: "Pas avant plusieurs secondes : c'est votre fenêtre." }
          ] }
        ] },
        { id: 'jungler', t: "Jouer avec ton jungler", blocks: [
          { p: "Ton premier move dépend du style de ton jungler :" },
          { list: [
            "**Il doit sécuriser son full clear** (junglers farm) : contre un jungler adverse fort, ward pour défendre un invade de son côté.",
            "**Il veut invade** (Bel'Veth, par exemple) : ward la jungle adverse pour l'info, puis couvre ses camps, et sois prêt à bouger avec lui.",
            "**Il veut gank tôt** (Briar, par exemple) : start Brouilleur oraculaire, et couvre l'entrée de votre jungle pour cacher son start."
          ] },
          { p: "Ensuite, joue autour de ses **power spikes** : beaucoup de junglers deviennent dangereux avec un item, et très dangereux avec deux. C'est là que tu joues plus agressif avec lui." },
          { key: "Les larves du Néant (8:00) se préparent dès 7:20 : back, puis passage par le mid pour arriver level 6 avec ton jungler." }
        ] }
      ],
      quiz: [
        { q: "Avec Draven, après un crash, tu…", opts: ["Repush tout de suite", "Laisses la wave bounce et tu freeze", "Back", "Roam top"], a: 1, why: "Jamais de perma push avec Draven ou Kalista." },
        { q: "Quand peux-tu roam en sécurité ?", opts: ["Dès que tu veux", "Quand la wave a crash ou que les 2 prochaines n'ont pas de cannon, et que ton ADC peut tenir", "Seulement au level 1", "Jamais"], a: 1, why: "Ta lane doit pouvoir tenir sans toi." },
        { q: "Combien de pinks à chaque back ?", opts: ["Aucune", "Au moins une", "Cinq", "Seulement après 20 min"], a: 1, why: "Toujours une ; deux avant un objectif une fois ta quête terminée." },
        { q: "Contre Leona et Nautilus, avec 550 gold au premier back :", opts: ["Potion rechargeable", "Cristal de rubis, pink, 1 potion", "Rien", "3 potions"], a: 1, why: "Des HP contre l'all-in." },
        { q: "Un mage botlane (Lux, Syndra…) est faible…", opts: ["Toute la partie", "Jusqu'au level 3 et en long trade", "Au level 6", "Jamais"], a: 1, why: "All-in court, jamais de long trade ; roam libre dès son Chapitre perdu." },
        { q: "Quel score de vision par minute vise un support ?", opts: ["0,5", "1", "2 ou plus", "5"], a: 2, why: "2 ou plus pour un support, d'après ton programme." }
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
