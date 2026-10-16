# Connexion unique site + jeu (projet)

> **Statut : plan décidé, pas encore appliqué** (15/10/2026). Rien n'a été
> modifié dans le code ni sur le VPS.
Pour relancer claude desssus => "on met en pratique la connexion unique"

## Objectif

Pour créer une partie en ligne, il faut être connecté avec son **compte
GameBoxHeroes** (Firebase, projet `gameboxheroes`), et **une seule connexion**
doit valoir pour le site et le jeu.

## Décision

Le jeu quitte `rooms.gameboxheroes.fr` et passe à
**`https://www.gameboxheroes.fr/rooms/`**. Le sous-domaine est abandonné.

Pourquoi : le navigateur range la session Firebase par **origine** (protocole +
domaine + port, celle affichée dans la barre d'adresse). `www.` et `rooms.` sont
deux origines, donc deux sessions. Sur la même origine, le site et le jeu lisent
la même entrée (IndexedDB `firebaseLocalStorageDb`, clé
`firebase:authUser:<apiKey>:[DEFAULT]`), et une déconnexion dans un onglet vaut
pour tous.

Solutions écartées :

| Solution | Pourquoi non |
|---|---|
| Garder `rooms.` en servant les fichiers depuis `base/rooms/` | L'origine reste `rooms.` : session séparée |
| Afficher `www…/rooms/` dans un cadre sous `rooms.` (masquage d'URL) | Barre d'adresse figée, liens `/room/ABC` non partageables, rafraîchissement et retour cassés |
| Cookie de session sur `.gameboxheroes.fr` | Clé de service Firebase et serveur de cookies : lourd |
| Jeton passé dans l'URL ou iframe | Fragile (stockage des iframes isolé) et peu sûr (jeton dans les historiques) |

Garder deux dépôts séparés (site et jeu) **n'est pas un problème** : ils ne
partagent pas de code, seulement un contrat (le projet Firebase et le schéma
`users/{uid}` des `firestore.rules` du site).

## Architecture cible

```
Navigateur ──HTTPS──► Apache (www.gameboxheroes.fr)
                        ├── /            site      (/home/prod/WWW/base)
                        ├── /rooms/      jeu       (/home/prod/WWW/base/rooms = contenu de dist/)
                        ├── /rooms/api        ──► serveur Node 127.0.0.1:8080 (préfixe /rooms retiré)
                        └── /rooms/socket.io  ──► idem (WebSocket)

Site : inscription, connexion, gestion du compte ─┐
                                                  ├─► Firebase « gameboxheroes » (Auth + Firestore)
Jeu : lit la même session, envoie le jeton ───────┘
Serveur Node : vérifie le jeton (firebase-admin) avant de créer une partie
```

## Étapes

### 0. Une seule adresse pour le site

`gameboxheroes.fr` et `www.gameboxheroes.fr` sont aussi deux origines. Rediriger
en 301 `http://…` et `https://gameboxheroes.fr/…` vers
`https://www.gameboxheroes.fr/…` (vérifier si c'est déjà fait dans le vhost : il
n'y a pas de `.htaccess` dans le dépôt du site).

### 1. Emplacement sur le VPS

```
/home/prod/WWW/base/          ← site (inchangé)
/home/prod/WWW/base/rooms/    ← contenu de dist/ du jeu (nouveau)
/home/prod/WWW/rooms/         ← serveur Node (pm2 « rooms », port 8080)
```

- Deux dossiers `rooms` aux contenus différents : renommer le dossier du serveur
  (ex. `/home/prod/WWW/rooms-server/`, en mettant à jour pm2) ou au moins le
  signaler clairement dans [mise-a-jour.md](mise-a-jour.md).
- En mettant à jour le site, **ne pas supprimer `base/rooms/`**.

### 2. Relais Apache

`public/.htaccess` (copié dans `dist/`, donc dans `base/rooms/.htaccess`) :

- `RewriteBase /` → `RewriteBase /rooms/` ;
- repli SPA : `RewriteRule . /index.html` → `RewriteRule . /rooms/index.html`.

Les règles de proxy sont relatives au dossier : `/rooms/api/games` arrive sur
Node en `/api/games`. **Le serveur Node ne connaît pas `/rooms`.**
Vérifier que le vhost `www` autorise les `.htaccess` (`AllowOverride All` ou
`FileInfo`). `mod_proxy`, `mod_proxy_http`, `mod_proxy_wstunnel` sont déjà actifs.

### 3. Construire le jeu pour `/rooms/`

1. `vite.config.js` : `base: '/rooms/'` (même base en dev et en prod).
2. `src/router/index.js` : `createWebHistory()` →
   `createWebHistory(import.meta.env.BASE_URL)`. Les routes, `router-link` et
   `router.push` ne changent pas.
3. Les 4 `fetch('/modules/index.json')` →
   `` fetch(`${import.meta.env.BASE_URL}modules/index.json`) `` :
   `src/views/CreateGame.vue`, `src/views/DemoPlay.vue`,
   `src/views/RoomLobby.vue`, `src/components/GameSetupSteps.vue`.
4. **Piège** : les JSON de `public/modules/` contiennent des chemins absolus
   (`"/modules/arnhem/arnhem.json"`, `"/modules/arnhem/images/arnhem-map.jpg"`…)
   que Vite ne réécrit pas. Préférer : préfixer ces chemins par `BASE_URL` dans
   la fonction qui les charge (les JSON ne bougent pas).

### 4. Adresse du serveur : même origine

1. `src/lib/api.js` : adresse par défaut = `import.meta.env.BASE_URL` sans la
   barre finale (→ `/rooms/api/games`). `VITE_API_URL` et `.env.production`
   deviennent inutiles.
2. `src/lib/socket.js` : **piège Socket.IO**, `io('https://…/rooms')` prend
   `/rooms` comme *namespace*, pas comme chemin. Écrire :
   ```js
   io({ path: `${import.meta.env.BASE_URL}socket.io` })   // → /rooms/socket.io/
   ```
3. Serveur : `CLIENT_ORIGIN=https://www.gameboxheroes.fr`.

### 5. Firebase dans le jeu

1. `npm i firebase`, **même version** que le site (le site charge la 10.12.2
   depuis gstatic dans `firebase.js` : monter le site à la version npm du jeu).
2. **Configuration identique** à `firebase-config.js` du site,
   `initializeApp(config)` **sans nom d'application**, `getAuth(app)` **sans
   persistance personnalisée**. Sinon la clé de stockage change et la session
   n'est plus partagée.
3. `src/lib/auth.js` sur le modèle du `firebase.js` du site : `watchUser`,
   `getIdToken`, `signOut`. **Pas de formulaire de connexion dans le jeu** :
   connexion et inscription restent sur le site.
4. Console Firebase : rien à ajouter (`www.gameboxheroes.fr` déjà autorisé).

### 6. Retour dans le jeu après connexion

Sur « Créer une partie », un joueur non connecté est envoyé vers :
```
/compte.html?retour=/rooms/create#connexion     (ou /en/compte.html… selon la langue)
```
Dans le site, `compte.js` (calcul de `back`) n'accepte aujourd'hui que
`page.html` : **ajouter** les chemins commençant par `/rooms/`, avec une
validation stricte (pas de `//`, pas de `://`) pour éviter les redirections vers
un site externe. Même adaptation dans `account.js` s'il est réutilisé.

### 7. Vérification côté serveur (indispensable)

Masquer le bouton ne protège rien : `POST /api/games` accepte aujourd'hui
n'importe qui.

- Front : `createGame` envoie `Authorization: Bearer <jeton>`.
- Serveur : `npm i firebase-admin`,
  `initializeApp({ projectId: 'gameboxheroes' })` (pas de clé de service
  nécessaire pour vérifier un jeton), middleware `requireUser` sur
  `gamesRouter.post('/')` avec `getAuth().verifyIdToken(token)` → 401 sinon.
- Enregistrer `creatorUid` et `creatorName` (claim `name` = pseudo) dans la
  partie. Option : exiger `email_verified`.
- Option : même vérification à la connexion Socket.IO
  (`io({ path, auth: { token } })`) pour lier les joueurs qui rejoignent.

### 8. Abandon de `rooms.gameboxheroes.fr`

Aucun lien du site ne pointe vers le sous-domaine, et les parties sont en
mémoire (effacées à chaque redémarrage) : pas de liens durables à préserver.
Redirection 301 `rooms.` → `www…/rooms/` facultative (quelques semaines par
politesse), puis supprimer le vhost. Ce que `RoomLobby.vue` a mémorisé dans le
`localStorage` de l'ancienne origine est perdu : basculer quand personne ne joue.

Mettre à jour ensuite [README.md](README.md), [mise-a-jour.md](mise-a-jour.md),
[pm2.md](pm2.md) et [depannage.md](depannage.md), qui citent `rooms.gameboxheroes.fr`.

## Développement local

Même architecture qu'en prod : **une seule origine** `http://localhost:5173`,
Vite joue le rôle d'Apache.

```
http://localhost:5173/                 → site  (relayé vers un serveur statique, ex. localhost:5500)
http://localhost:5173/rooms/           → jeu   (Vite, rechargement à chaud)
http://localhost:5173/rooms/api        → Node  (localhost:3001, préfixe /rooms retiré)
http://localhost:5173/rooms/socket.io  → Node  (idem, ws: true)
```

1. Site servi sur le port 5500 (Live Server, `npx serve`, ou
   `python -m http.server 5500`).
2. `vite.config.js`, `server.proxy` : `/rooms/api` et `/rooms/socket.io` vers
   `http://localhost:3001` (réécriture qui retire `/rooms`, `ws: true` pour
   Socket.IO) ; tout ce qui ne commence pas par `/rooms` vers
   `http://localhost:5500`.
3. Serveur Node : `npm run dev` dans `server/`, `CLIENT_ORIGIN=http://localhost:5173`.
4. **Firebase : ne pas développer contre la prod.** Émulateurs Firebase (Auth +
   Firestore), `firebase.json` et `firestore.rules` dans le dépôt du site. Le
   site et le jeu se branchent sur l'émulateur sur `localhost` ; le serveur via
   `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099`. Nécessite Java et
   `firebase-tools` (sinon : un second projet `gameboxheroes-dev`).
5. Tâche VS Code « Tout lancer » : émulateurs, site, Vite, Node.

Organisation des dossiers proposée (pas encore faite), calquée sur le VPS :
```
developpement/gameboxheroes/
  gameboxheroes.code-workspace
  site/   (dépôt site-gameboxheroes, actuellement home/modules-wargame)
  game/   (dépôt generic-wargame)
```

Dans le site, `firebase-config.js` contient la vraie configuration mais n'est
pas commité : ces valeurs sont publiques, le commiter. Choisir dev/prod selon
le nom d'hôte plutôt qu'en modifiant ce fichier.

## Ordre et contrôles

| # | Étape | Contrôle |
|---|---|---|
| 1 | Base `/rooms/`, routeur, chemins des modules (3), proxy Vite local | `localhost:5173/rooms/` affiche le jeu, carte et pions chargés, rafraîchir sur `/rooms/room/X` fonctionne |
| 2 | API et Socket.IO en même origine (4) | Une partie en ligne se crée et se joue à deux onglets en local |
| 3 | Firebase dans le jeu (5) + retour après connexion (6) | Connexion sur `localhost:5173/compte.html`, retour sur `/rooms/create` déjà connecté |
| 4 | Vérification serveur (7) | `curl -X POST …/api/games` sans jeton → 401 |
| 5 | Mise en ligne : `www` unique (0), `base/rooms/` (1-2), `CLIENT_ORIGIN` (4) | `https://www.gameboxheroes.fr/rooms/api/health` → `{"ok":true}` |
| 6 | Abandon de `rooms.` (8) + mise à jour de la documentation | L'ancienne adresse redirige ou n'existe plus |
