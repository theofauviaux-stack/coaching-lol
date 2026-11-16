# Coaching LoL

Application privée (Mac et Windows) de suivi de coaching League of Legends.

- Tu ajoutes un joueur avec son pseudo Riot (Nom#TAG), sa région et son rôle coaché.
- L'application récupère toute seule ses parties **SoloQ jouées au rôle coaché** (stats complètes, CS à 10 min, écarts d'or et d'XP à 10 et 15 min, morts avant 15 min) et son rang Solo/Duo, grâce à ta clé API Riot personnelle.
- Tout est enregistré sur ton ordinateur : joueurs, parties, rangs, sessions de coaching.
- Tableau de bord par joueur : 8 cartes au choix, forme récente, objectifs (par rôle ou personnalisés), champion pool, matchups, graphiques, progression du rang.
- Sessions de coaching avec KPI suivi : moyenne avant et depuis la session, objectif atteint ou non, courbe partie par partie.

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

L'application vérifie au lancement puis toutes les 4 heures s'il existe une nouvelle version sur GitHub. Elle la télécharge en arrière-plan, puis l'installe quand on la quitte (ou tout de suite avec « Redémarrer maintenant »).

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
