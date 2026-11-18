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
- Pastille « En partie » sur l'accueil, compteur dans le menu, notification quand une partie commence. Quand elle se termine, le rang est relevé 2 min plus tard (LP de la partie au plus juste).
- « Regarder » lance League of Legends en mode spectateur avec la clé d'observation donnée par Riot (`spectator.<plateforme>.lol.pvp.net:8080`), 3 min de retard comme toujours en classée. Le jeu doit être installé et à jour : il est cherché dans Applications (Mac) ou C:\Riot Games (Windows), sinon à l'emplacement indiqué dans Paramètres › Général › Mode spectateur.
- Les joueurs ne voient pas cette page : la clé API Riot reste sur l'ordinateur du coach.

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

Les données sont dans le dossier de l'application :
- Mac : `~/Library/Application Support/Coaching LoL/coaching-data.json`
- Windows : `%APPDATA%\Coaching LoL\coaching-data.json`

Une copie de sauvegarde (`.bak`) est faite à chaque enregistrement. Paramètres › *Exporter une sauvegarde* permet aussi d'en garder une copie ailleurs.

Coaching LoL n'est ni approuvé ni soutenu par Riot Games.
