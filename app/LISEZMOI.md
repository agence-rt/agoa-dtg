# AGOA DTG — application Windows (version de test 0.1.7)

Agence Rémi Thollet Architecte. Application de bureau qui reprend l'interface de l'atelier DTG
publiée sur claude.ai, en local sur chaque poste.

## Installation
1. Lancer `AGOA-DTG-Setup-0.1.7.exe` (installation pour l'utilisateur courant, sans droits administrateur).
   Windows SmartScreen peut afficher « éditeur inconnu » : l'application n'est pas encore signée
   (« Informations complémentaires » › « Exécuter quand même »).
2. Au premier lancement, la fenêtre **Paramètres** s'ouvre :
   - **Dossier Dropbox** : le dossier racine synchronisé qui contient « Agence T&K »
     (par défaut `C:\Users\<nom>\T&K Dropbox`) ;
   - **Clé API Anthropic** (rédaction IA, baguette magique, étude thermique) et modèle ;
   - **Clé API Ragic** (import de la fiche immeuble). Serveur `eu2.ragic.com`, espace `agoa`, feuille `/agoa/3`.
   Les clés sont chiffrées par Windows (stockage protégé de l'utilisateur).

## Fichiers .dtg
- Un double-clic sur un fichier `.dtg` ouvre l'application sur le dossier (association créée par l'installateur).
- **Fichier › Enregistrer le dossier (Ctrl+S)** ou le bouton « Enregistrer .dtg » : la première fois, l'application
  propose le dossier `02 - ETUDE` de l'opération dans la Dropbox ; ensuite elle réenregistre au même endroit.
  L'ancienne version est conservée en `.dtg.bak`.
- Format : archive ZIP contenant
  - `dossier.json` : `{ format: "agoa-dtg", version: 1, savedAt, app, ref, dossier, chapitres[], images{}, corbeille[] }`
  - `images/` : photo de l'immeuble, plans et localisations des bâtiments (JPEG)
  - `miniature.jpg`, `LISEZMOI.txt`
- Les photos de visite ne sont pas copiées : elles sont relues dans `RV1` de la Dropbox locale (chemins relatifs).
- Le même format est lu et écrit par l'atelier en ligne (claude.ai) : on peut passer de l'un à l'autre.

## Ce que fait la version de bureau
- Dropbox : lecture directe du dossier synchronisé (pas de limite de 5 Mo, photos de RV1 affichées sans rechargement).
- PDF du BET et documents : lecture locale (pdf-parse, mammoth).
- IA : API Anthropic (`/v1/messages`) avec la clé saisie.
- Ragic : API REST (`https://<serveur>/<espace><feuille>?api&v=3`).
- Stockage de travail : `%APPDATA%\Atelier DTG\atelier-store.json` (menu Aide › Dossier des données).

## Limites connues de cette version de test
- Google Agenda n'est pas relié : saisir la date de visite.
- Pas encore de verrou si deux personnes ouvrent le même `.dtg` (prévu : fichier `.lock`).
- Le texte de l'IA s'affiche d'un bloc (pas en continu).
- Polices Montserrat chargées depuis Google Fonts (sinon police de remplacement).
- Application non signée numériquement.

## Construire l'installateur
Prérequis : Node.js 20+. Sous Windows : `npm install` puis `npm run dist` → `dist\Atelier-DTG-Setup-<version>.exe`.
Mettre à jour l'interface : `python scripts/prepare.py chemin\vers\dtg-redaction.html` (copie la page et remplace
les bibliothèques en ligne par les copies de `renderer/vendor`).
Lancer en développement : `npm start`.

## Démarrage, mise à jour et installation (0.1.5)
- Écran de démarrage AGOA DTG ; pendant ce temps l'application cherche une mise à jour dans les Releases GitHub
  `agence-rt/agoa-dtg`. Si une version plus récente existe, elle est téléchargée (progression affichée),
  installée silencieusement, puis l'application redémarre. Sans réseau, elle démarre normalement après quelques secondes.
- L'installateur propose le choix du dossier d'installation, puis une case « Créer un raccourci sur le Bureau ».
- Publier une version : monter `version` dans `app/package.json`, pousser, puis lancer la procédure « Installateur Windows »
  (onglet Actions) : elle crée la Release `v<version>` avec l'installateur et `latest.yml` (nécessaire à la mise à jour automatique).

## Identification Google (0.1.6)
Au premier démarrage, une fenêtre propose « Se connecter avec Google » : le navigateur s'ouvre, le compte doit être en
`@remithollet.fr` (autre domaine refusé). La session est mémorisée (jeton chiffré par Windows) ; menu **Aide › Changer de compte Google**
pour se déconnecter. Cette connexion donne aussi accès à Google Agenda (lecture seule) pour retrouver la date de visite.

Configuration : comme les autres applications AGOA, l'identifiant client OAuth est dans `package.json` › `agoa.google.clientId`,
et le code secret doit être saisi dans **Paramètres › Google** (ou fourni dans `google-client.json`) ; sans code secret, la connexion reste désactivée.
Il peut aussi être saisi dans **Paramètres › Google** d'un poste. Les portées demandées sont `openid`, `email`, `profile`
et `calendar.readonly` (l'écran de consentement du client doit les autoriser).

## Écran d'accueil (0.1.7)
Sans dossier ouvert : **Créer un DTG** (saisie de la référence), **Ouvrir un DTG** (fichier `.dtg`) et **DTG récents**.
