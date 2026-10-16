# Documentation d'exploitation

Procédures pour mettre en ligne et maintenir le jeu sur le VPS de production.

| Fiche | Contenu |
|---|---|
| [mise-a-jour.md](mise-a-jour.md) | Mettre à jour le front et/ou le serveur en production |
| [pm2.md](pm2.md) | Garder le serveur Node allumé en permanence (PM2) |
| [depannage.md](depannage.md) | Diagnostiquer « je ne peux pas créer / rejoindre de partie » |
| [connexion-unique.md](connexion-unique.md) | **Projet, pas encore appliqué** : passer à `www.gameboxheroes.fr/rooms/` avec le compte GameBoxHeroes |

## Architecture de la production

```
Navigateur ──HTTPS──► Apache (rooms.gameboxheroes.fr)
                        ├── fichiers du front (contenu de dist/)
                        └── /api et /socket.io ──► serveur Node, 127.0.0.1:8080 (PM2, process « rooms »)
```

- **Domaine** : https://rooms.gameboxheroes.fr. Le front et le serveur sont sur le
  **même domaine** : le navigateur ne parle jamais directement au port 8080.
- **Relais Apache** : `public/.htaccess` (copié dans `dist/` au build) renvoie
  `/api` et `/socket.io` vers `127.0.0.1:8080`. Il exige les modules
  `mod_proxy`, `mod_proxy_http` et `mod_proxy_wstunnel`.
- **Serveur Node** (= dossier `server/` du dépôt) : `/home/prod/WWW/rooms` sur
  le VPS, lancé par **PM2** sous le nom `rooms`.
- **Front** (= dossier `dist/` produit par `npm run build`) : dossier web
  d'Apache pour `rooms.gameboxheroes.fr`.
- Les transferts de fichiers se font avec un client **SFTP**.

## Réglages de production

Le fichier `.env.production` (à la racine, **non versionné** : ignoré par git)
contient :

```ini
VITE_API_URL=https://rooms.gameboxheroes.fr
PORT=8080
CLIENT_ORIGIN=https://rooms.gameboxheroes.fr
```

| Variable | Utilisée par | Rôle |
|---|---|---|
| `VITE_API_URL` | front, **au moment du build** | Adresse du serveur appelée par le navigateur. Sans port : on passe par Apache. |
| `PORT` | serveur (PM2) | Port local d'écoute du serveur Node. Doit correspondre au `.htaccess` (8080). |
| `CLIENT_ORIGIN` | serveur (PM2) | Seule origine autorisée (CORS) : l'adresse où les joueurs ouvrent le jeu. Une seule valeur possible. |

> ⚠️ `VITE_API_URL` est **figée dans le JavaScript au build**. Toute
> modification de `.env.production` impose de refaire `npm run build` et de
> recopier `dist/`.
>
> ⚠️ `PORT` et `CLIENT_ORIGIN` ne sont **pas** lus depuis `.env.production` par
> le serveur : ils sont passés à PM2 sur la ligne de commande (voir
> [pm2.md](pm2.md)).

## Bon à savoir

- Le serveur garde les parties **en mémoire** : chaque redémarrage du serveur
  efface les parties en cours. Les parties abandonnées sont purgées
  automatiquement (6 h pour une room jamais lancée, 72 h pour une partie
  lancée ; 200 parties au maximum).
- Depuis le VPS lui-même, `curl https://rooms.gameboxheroes.fr/...` **reste
  bloqué** (le VPS ne se joint pas par son IP publique). Ce n'est pas une
  panne : faire les tests d'URL publique depuis le navigateur du PC.
