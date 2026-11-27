# Coaching LoL

Application privée (Mac et Windows) de suivi de coaching League of Legends.

- **Écran de code à 4 chiffres** au démarrage : le code coach ouvre tous les joueurs ; le code d'un joueur n'ouvre que son espace, en lecture seule.
- Le coach ajoute un joueur avec son pseudo Riot (Nom#TAG), sa région et son rôle. L'app récupère toute seule, en arrière-plan, ses parties **SoloQ jouées à ce rôle** (CS à 10 min, écarts d'or et d'XP à 10 et 15 min, morts avant 15 min…) et son rang, grâce à la clé API Riot personnelle du coach.
- **Paramètres par joueur** : objectifs, cartes du tableau de bord, axes de travail des séances, code d'accès.
- Tableau de bord interactif (survol des points = détail de la partie, clic = panneau de détail), forme récente, objectifs, champions, adversaires.
- Séances de coaching avec indicateur suivi : moyenne avant et depuis la séance, cible, courbe partie par partie.

## Fonctionnement en ligne (espaces joueurs)

- L'ordinateur du coach est le seul à parler à l'API Riot. Il envoie automatiquement les données vers une base Supabase (plan gratuit) avec la clé secrète du projet, collée une fois dans *Paramètres › Général › Serveur en ligne* et gardée chiffrée sur cet ordinateur.
- L'app installée chez un joueur se connecte avec son code : elle ne reçoit que ses données, en lecture seule.
- Le schéma de la base est dans `supabase/schema.sql` (tables fermées, accès uniquement par fonctions ; codes stockés en empreinte ; blocage après 8 codes faux par adresse IP et 60 au total en 15 minutes).
- `src/cloud-config.json` contient l'adresse du projet et sa clé **publique** (publiques par conception). La clé secrète n'est jamais dans ce dépôt.
- Le plan gratuit de Supabase met la base en pause après 7 jours sans activité : l'app du coach la réveille à chaque envoi (au démarrage et toutes les 6 heures).

## Réservations de coaching

- Le joueur réserve depuis son accueil : créneaux d'1 h, de 17 h à minuit (heure de Paris), 2 h maximum par jour, jusqu'à 30 jours à l'avance.
- Le coach voit la demande sous la ligne du joueur (et reçoit une notification) : il accepte, ou propose un autre horaire que le joueur accepte ou refuse.
- Le jour J, le bouton « Démarrer le coaching » s'active 30 min avant : un minuteur de 1 h (2 h si deux créneaux se suivent) s'affiche en haut pour le coach, qui est prévenu 5 min avant la fin. Le joueur voit seulement « En coaching ».
- Les réservations passent par la base en ligne : l'ordinateur du coach doit y être relié (Paramètres › Général › Serveur en ligne).

## Exercices et fiches de séance

- Séances › Banque d'exercices (coach) : 23 exercices tirés du programme « Jeu individuel » (farm, mécanique, laning, survie, macro, mental, review), chacun avec ses étapes, un schéma, et une cible adaptée au rôle (ex. Mid : 110 CS à 10 min en partie personnalisée). Les modules de LoL Dodge Game (loldodgegame.com) sont inclus.
- Nouvelle séance : le coach coche les exercices, ajuste la cible et ajoute une consigne.
- Le joueur retrouve la séance chez lui (rappel « Fiche à remplir » sur son accueil), fait les exercices puis remplit sa fiche : scores, ressenti, ce qu'il retient. Le coach la voit dans la séance et reçoit une notification.
- Les fiches passent par la base en ligne (table `reports`) : un joueur ne peut écrire que dans ses propres fiches.

## En direct (parties classées en cours)

- Page « En direct » (coach, sur son ordinateur) : chaque minute, l'app demande à l'API Riot (spectator-v5) si un joueur suivi est en partie. Seules les classées Solo/Duo (file 420) sont affichées, avec les deux équipes : champions, pseudos, rang Solo/Duo (gardé 30 min), sorts, runes, bans et chrono.
- Les deux équipes sont face à face, poste par poste (top contre top, jungle contre jungle…). Riot ne donne pas les postes pendant la partie : ils sont devinés d'après la part de chaque poste pour le champion (table Meraki Analytics, relue chaque jour, copie dans `src/role-rates.json`), le Châtiment (jungle), les autres sorts et le rôle coaché de nos joueurs.
- Pastille « En partie » sur l'accueil, compteur dans le menu, notification quand une partie commence. Quand elle se termine, le rang est relevé 2 min plus tard (LP de la partie au plus juste).
- Smurfs : dans la fiche d'un joueur (Joueurs › Modifier), un pseudo par ligne. Ils sont surveillés comme le compte principal sur la page En direct (étiquette « smurf de … »), mais leurs parties n'entrent pas dans les stats. Ils ne partent pas sur le serveur en ligne.
- Pas de bouton « Regarder » : la page montre seulement les parties. Fin de partie : quand une partie suivie disparaît de la liste, l'app la cherche chez Riot (match-v5) chaque minute pendant 30 min au plus (publiée en général 1 à 5 min après la fin). Victoire ou défaite, K/D/A, KDA, CS et durée de chaque joueur suivi s'affichent en pop-up en haut à droite (« Voir ses parties », fermeture) et en notification de l'ordinateur, puis la partie est ajoutée à « Parties ». Seulement quand l'app est ouverte sur l'ordinateur du coach.
- Les joueurs ne voient pas cette page : la clé API Riot reste sur l'ordinateur du coach.

## Moments clés d'une partie

- Parties › une partie › « Moments clés de la partie » (coach) : morts (zone, ennemis impliqués, alliés à côté, objectif perdu ensuite, étiquettes gank / seul / combat d'équipe / jungle ennemie), kills, objectifs (présent ou absent), retours à la base avec les achats, niveau 6 comparé au vis-à-vis, lane à 10 et 15 min, vision. Mini-carte avec la position des 10 joueurs au moment choisi (Riot donne une position par minute : positions interpolées).
- Calculés à la synchro à partir de la timeline déjà téléchargée (aucune requête en plus) ; pour les parties plus anciennes, à la première ouverture (2 requêtes). Un fichier par partie dans le dossier `moments/` des données du coach (src/moments.js).
- « Copier pour l'analyse » : dossier texte de la partie à coller dans Claude (calibration de l'analyse avec le coach).

### Analyses de parties : vidéos filmées par le joueur, discussion avec le coach (bêta)

- L'app du coach envoie au serveur les moments clés des parties des 30 derniers jours (table `moments`, gardés 45 jours), calculés au fil des synchros (src/moments.js).
- **Joueur, sur son ordinateur ou sur celui du coach avec son code** (l'app ouvre aussi sa session sur le serveur) : Parties › une partie › « Moments clés de la partie » › « Filmer les moments ». L'app demande à son client LoL de télécharger le replay (API locale `/lol-replays/v1/…`), l'ouvre, active la Replay API du jeu (`EnableReplayApi=1` dans `Config/game.cfg`), place la caméra sur le joueur, va à chaque moment et filme la fenêtre du jeu (35 s avant, 10 s après ; la lecture commence 30 s avant le moment ; moments proches regroupés jusqu'à 90 s, 10 extraits au plus ; WebM VP9 jusqu'à 1600×900, 30 images/s, ~2,2 Mb/s : ≈ 12 Mo pour 45 s, arrêt de sécurité à 28 Mo). Pendant le tournage, l'interface du replay est épurée (`/replay/render` : sans panneau de lecture, frise ni chat ; tableau des scores, mini-carte et barres de vie gardés). Chaque extrait démarre la capture replay en pause, relance la lecture et s'arrête quand le **temps de jeu** atteint la fin de l'extrait (lecture relancée si le replay se met en pause, erreur claire s'il n'avance plus) ; la correspondance seconde de vidéo ↔ temps de jeu est mesurée (`lead`, `sync` dans les extraits) et sert à placer chaque moment dans sa vidéo (app, dossier pour Claude). L'image est contrôlée toutes les 0,5 s (vignette 64×36) : noire ou figée → sous Windows l'app filme l'écran entier à la place, sinon message pour passer le jeu en « Sans bordure ». Bouton **« Annuler l'enregistrement »** dans la barre d'avancement : arrête la capture, ferme le replay ouvert par l'app ; les nouvelles vidéos sont filmées dans `<dossier>.nouveau` et ne remplacent les anciennes qu'à la fin, donc une annulation ou une erreur garde les vidéos d'avant. Un replay resté ouvert (phase LCU `WatchInProgress`) est refermé avant un nouveau tournage ; une vraie partie n'est jamais fermée. **Vidéos navigables** (1.6.16) : l'enregistreur du navigateur écrit des WebM sans durée ni index (`Cues`) — barre de lecture « infinie » et, depuis le serveur, chaque saut oblige à tout télécharger depuis le début. `src/webm.js` réécrit le fichier sans réencoder (Segment et Clusters de taille connue, `Duration`, `SeekHead`, `Cues` sur chaque image clé) : à l'enregistrement, à la lecture locale et avant l'envoi pour les vidéos plus anciennes, à l'export et dans le dossier pour Claude. Côté serveur, une vidéo envoyée avant la 1.6.16 est téléchargée une fois, réparée et gardée dans `videos-serveur/<analyse>/` (préparée dès l'ouverture de l'analyse, effacée avec l'analyse). Les vidéos locales sont servies avec les demandes de plage. **Réglages du joueur gardés** (1.6.15) : l'interface du replay du joueur est lue (`GET /replay/render`) avant d'être épurée et remise telle quelle avant de fermer le replay (aussi après une erreur ou une annulation ; illisible → on n'y touche pas) ; les réglages de jeu du client (`/lol-game-settings/v1/game-settings`) sont photographiés avant le tournage et, une fois le jeu fermé, les parties changées sont renvoyées (`PATCH`, puis `POST /lol-game-settings/v1/save`) ; le journal liste ce qui a été remis. Caméra sur le champion du joueur : la Replay API ne sait pas choisir le joueur suivi, donc avant chaque moment l'app fait un double appui sur la touche du joueur dans le replay (1 à 5 : équipe bleue ; Q W E R T, soit A Z E R T en AZERTY : équipe rouge ; ordre tiré de `/liveclientdata/playerlist`), comme dans le jeu. Windows : PowerShell (keybd_event, codes physiques) ; Mac : AppleScript (autorisation « Accessibilité »). Journal du dernier tournage : `videos/journal.txt` (bouton « Voir le journal » en cas d'erreur). Si le client ne propose pas le replay tout de suite, l'app crée sa fiche (`/lol-replays/v2/metadata/{id}/create`) puis demande d'ouvrir la partie dans l'historique du client, puis ferme le replay. Vidéos dans `videos/<joueur>_<partie>/` de ses données.
- « Envoyer au coach » : il coche les vidéos dont il veut parler, écrit un commentaire par vidéo et ce qu'il veut travailler. Les vidéos partent dans le dossier public `clips` du stockage Supabase (adresse impossible à deviner, dossier non listable, envoi permis 3 h seulement pour les fichiers annoncés).
- **Page « Analyses »** (coach et joueur) : liste, pastille des réponses non lues, notifications. Fenêtre d'analyse : vidéo (lue via `clip://r/…`), carte, discussion générale et un fil par moment ; les nouveaux messages arrivent sans recharger la vidéo.
- Le coach « Termine l'analyse » : la discussion est fermée, les vidéos restent pour l'export. **Export** par le joueur (« Exporter sur mon ordinateur ») : dossier « Analyse <partie> <date> » avec les vidéos et `debrief.html` (src/debrief.js : discussion générale, chaque moment avec sa vidéo et ses messages), puis l'analyse est supprimée du serveur (vidéos et messages, `analysis_export_done` / `analysis_forget`) et ses vidéos locales. Sans export : vidéos effacées 7 jours après la fin (30 jours après l'envoi au plus). Limites : 3 analyses en cours par joueur, 900 Mo de vidéos en tout (plan gratuit : 1 Go).
- Conditions côté joueur : client LoL ouvert et connecté, aucune partie en cours, replay disponible (patch en cours seulement, 10 téléchargements par heure chez Riot). Sur Mac, autoriser Coaching LoL dans Réglages Système › Confidentialité et sécurité › Enregistrement de l'écran (une fois : depuis la 1.6.2, l'app est signée avec une exigence d'identité fixe, `build/signer-mac.js`, et l'autorisation reste valable après les mises à jour).
- Base : `supabase/analyses.sql` (à exécuter une fois dans le SQL Editor, relançable). Uniquement des API locales officielles de Riot (client et Replay API) : pas de lecture de la mémoire du jeu. Code : src/replay.js, renderer/recorder.*.

Le coach peut **supprimer** une analyse (corbeille dans la liste « Analyses » ou dans la fenêtre de l'analyse) : elle disparaît chez lui et chez le joueur (prévenu), les messages sont effacés aussitôt et les vidéos par la purge (`coach_analysis_delete`, depuis la 1.6.10 : relancer `supabase/analyses.sql`).

### Parties personnalisées (scrims)

Riot ne donne pas les parties personnalisées par son API. Depuis la 1.6.13, le joueur les importe lui-même : Parties › « Partie perso » liste les personnalisées de l'historique de son client LoL (ouvert et connecté sur son compte, vérifié par `/lol-summoner/v1/current-summoner`). « Ajouter » lit la partie et sa chronologie dans le client (`/lol-match-history/v1/games/{id}` et `/game-timelines/{id}`, format v4), les convertit au format match-v5 (`src/custom.js` : postes, équipe du tueur des monstres, niveaux déduits des points de compétence) puis calcule la partie et ses moments clés comme pour une classée. Elle part sur le serveur (`custom_game_add`, `supabase/personnalisees.sql`) et reste affichée chez le joueur en attendant ; l'app du coach la reprend (`coach_custom_games`, toutes les 2 min), l'ajoute à ses parties avec ses moments clés, puis l'efface du serveur. Seules les parties sur la Faille de l'invocateur sont prises en charge. Elles sont marquées « Perso » et ne comptent ni dans les statistiques ni dans les LP ; on peut les filmer (replay de type CUSTOM_GAME) et les envoyer en analyse.

### Analyses par Claude (sans API)

Sur l'ordinateur du coach, chaque partie envoyée par un joueur est préparée dans `~/Coaching LoL/Analyses pour Claude/` (dossier personnel, hors iCloud) : un dossier par partie avec `a-analyser.json` (moments, vidéos, commentaires du joueur), `dossier.txt`, `partie.json` et `videos/`. À la racine : `methode-coach.md` (la méthode du coach, modifiable) et `LISEZ-MOI.txt`.

Dans une conversation Claude reliée à cet ordinateur, le coach demande « analyse les nouvelles parties » : Claude lit les dossiers sans `analyse-claude.json`, en extrait des images, suit la méthode et écrit `analyse-claude.json` (`general`, `priorites`, `moments: [{ t, texte }]`). L'app le reprend toute seule (`src/claude.js`) : les propositions apparaissent en **brouillon** dans la fenêtre d'analyse (bandeau « Proposition de Claude », pastille dans la liste des moments). Le coach relit, corrige et envoie : rien ne part au joueur sans lui. Quand l'analyse est terminée, l'app retire les vidéos du dossier. Pour redemander une analyse : supprimer `analyse-claude.json`.

## Installer

Télécharge la dernière version dans l'onglet **Releases** de ce dépôt :

- **Windows** : `Coaching-LoL-Setup-x.y.z.exe`. Au premier lancement, Windows peut afficher « Windows a protégé votre ordinateur » : clique sur *Informations complémentaires* › *Exécuter quand même* (l'application n'est pas signée).
- **Mac** : `Coaching-LoL-x.y.z-universal.dmg` (Mac Intel et Apple Silicon). Ouvre le dmg, glisse l'app dans Applications. L'application n'est pas signée par Apple, donc au premier lancement :
  1. Ouvre l'app une fois (macOS la bloque), puis va dans *Réglages Système* › *Confidentialité et sécurité*, descends et clique sur *Ouvrir quand même*.
  2. Si macOS dit que l'app « est endommagée », ouvre le Terminal et tape : `xattr -cr "/Applications/Coaching LoL.app"`, puis relance l'app.

## Clé API Riot

1. Va sur https://developer.riotgames.com et connecte-toi avec ton compte Riot.
2. Copie la *Development API Key* (elle expire toutes les 24 h) et colle-la dans **Paramètres** de l'application.
3. Pour ne plus avoir à la changer : *Register Product* › **Personal API Key** (usage privé, validation par Riot en quelques jours).

La clé reste sur ton ordinateur, chiffrée par le système. Elle n'est jamais envoyée ailleurs que chez Riot.

## Mises à jour

L'application vérifie toutes les 30 secondes s'il existe une nouvelle version sur GitHub (petit fichier `latest.yml` / `latest-mac.yml`). Elle la télécharge en arrière-plan sans rien afficher, puis l'installe quand on la quitte (fermer la fenêtre quitte l'app, sur Mac aussi). L'état est visible dans *Paramètres › Général › À propos*.

- **Windows** : via electron-updater.
- **Mac** (sans certificat Apple) : l'app télécharge le zip de la nouvelle version, vérifie son empreinte SHA-512, puis remplace `Coaching LoL.app` une fois fermée et la relance. Il faut que l'app soit dans Applications (pas lancée depuis le dmg). Si macOS bloque le remplacement, l'app l'indique : il suffit d'activer Coaching LoL dans *Réglages Système* › *Confidentialité et sécurité* › *Gestion des apps*.
- Les versions 1.0.0 et 1.0.1 sur Mac n'ont pas encore ce système : il faut installer la 1.0.2 à la main une fois.

### Publier une nouvelle version

1. Modifie `"version"` dans `package.json` (ex. `1.0.1`) et envoie la modification sur `main`.
2. GitHub Actions crée la release `v1.0.1`, compile Mac et Windows et y dépose les installateurs (environ 10 minutes).

## Développement

```bash
npm install
npm start        # lance l'application
npm test         # tests (API Riot simulée)
npm run dist     # crée l'installateur pour ton système dans dist/
```

### Logo et icône de l'application

Le logo (l'œil « Vision », depuis la 1.6.7) est dessiné une seule fois dans `build/icon.svg`. Après une modification, lance `python3 tools/icones.py` (demande `rsvg-convert` et Pillow) : il refait l'icône Mac (`build/icon.icns`, à la grille des icônes Mac), l'icône Windows (`build/icon.ico`, 16 à 256 px, aussi utilisée par l'installateur) et le logo de l'interface (`renderer/logo.js`, menu et écran du code). Les quatre fichiers sont à envoyer avec la modification.

Les données sont dans le dossier de l'application :
- Mac : `~/Library/Application Support/Coaching LoL/coaching-data.json`
- Windows : `%APPDATA%\Coaching LoL\coaching-data.json`

Une copie de sauvegarde (`.bak`) est faite à chaque enregistrement. Paramètres › *Exporter une sauvegarde* permet aussi d'en garder une copie ailleurs.

Coaching LoL n'est ni approuvé ni soutenu par Riot Games.

## Suivi des joueurs (1.6.17)

- **Objectifs de travail** : les priorités d'une analyse (« Suivre des objectifs » dans la fenêtre d'analyse, préremplies avec les priorités proposées par Claude) ou d'un bilan deviennent des objectifs du joueur (`player.goals`), avec un indicateur par partie (`Stats.GOAL_KPIS`) et une cible (objectif du joueur ou du rôle par défaut). Le tableau de bord montre, pour chacun, la moyenne avant / depuis, la réussite partie par partie et un état (atteint, en progrès, à travailler) ; le coach les coche, les rouvre ou les supprime. Envoyés au serveur avec le joueur, qui les voit sur son tableau de bord.
- **Discussion sur la vidéo** : « 6:10 » dans un message devient un lien qui montre ce moment dans la vidéo (autre extrait si besoin). « Dessiner » met la vidéo en pause : flèches, cercles, traits libres (4 couleurs) en coordonnées 0..1 de l'image, joints au message (colonne `drawing` d'`analysis_comments`, 30 formes et 8 000 caractères au plus) ; « Dessin à 6:02 » les remet sur l'image. Le débrief exporté garde liens et dessins.
- **Erreurs récurrentes** (`src/trends.js`) : sur les 20 dernières parties au rôle (moments clés), carte des morts ramenée au côté bleu par symétrie sur la diagonale (les lanes restent les mêmes), zones, minutes, circonstances (seul, gank, 3 ennemis…), objectifs perdus en son absence, et phrases quand quelque chose revient vraiment (5 parties et 5 morts au moins). Calculées sur l'ordinateur du coach, envoyées avec le joueur.
- **Bilan du mois avec Claude** : « Préparer le bilan » (tableau de bord, ordinateur du coach) écrit `Analyses pour Claude/Bilans/<mois> <joueur> [bilan-…]` : indicateurs des 30 derniers jours, erreurs récurrentes, objectifs et leur suivi, analyses et séances du mois, parties (`a-analyser.json`, `parties.txt`). Claude écrit `bilan-claude.json` ; l'app le montre en brouillon, le coach le corrige et l'envoie (avec les objectifs proposés cochés). Le joueur est prévenu et le lit sur son tableau de bord.
- **Journaux de tournage** : si « Filmer les moments » échoue chez un joueur, son app envoie le journal au serveur (`supabase/journaux.sql`) ; le coach est prévenu, le lit dans « Analyses » (« Tournages en échec ») puis l'efface.
- **Stockage des vidéos** : jauge dans « Analyses » (900 Mo), alerte à 80 %.
- Serveur : `supabase/analyses.sql` (dessins) et `supabase/journaux.sql`, exécutés dans Supabase le 21/11/2026.
