# Mettre à jour la production

Le front (`dist/`) et le serveur (`server/`) se mettent à jour séparément.
Quand une modification touche les deux (nouveaux messages en ligne, nouvelles
données de partie…), **mettre à jour le serveur d'abord, puis le front**, et
toujours garder les deux au même niveau : un front récent avec un vieux serveur
crée les parties mais casse le jeu en ligne.

> ⚠️ Redémarrer le serveur **efface les parties en cours** (stockage en
> mémoire). Choisir un moment où personne ne joue.

## 1. Mettre à jour le serveur

### Sur le PC

Récupérer le code à jour (`git pull`) si besoin. Rien à construire : le
serveur tourne directement depuis ses sources.

### Copier les fichiers (client SFTP)

En écrasant les fichiers existants :

| Fichier local (dépôt) | Destination sur le VPS |
|---|---|
| `server/src/index.js` | `/home/prod/WWW/rooms/src/index.js` |
| `server/src/rooms.js` | `/home/prod/WWW/rooms/src/rooms.js` |
| `server/src/socket.js` | `/home/prod/WWW/rooms/src/socket.js` |
| `server/src/routes/games.js` | `/home/prod/WWW/rooms/src/routes/games.js` |
| `server/package.json` | `/home/prod/WWW/rooms/package.json` |
| `server/package-lock.json` | `/home/prod/WWW/rooms/package-lock.json` |

Si de nouveaux fichiers sont apparus dans `server/src/`, les copier aussi.
Ne **pas** copier `server/node_modules/` : il est réinstallé sur le VPS.

### Sur le VPS (SSH)

```bash
cd ~/WWW/rooms
npm install --omit=dev
CLIENT_ORIGIN=https://rooms.gameboxheroes.fr pm2 restart rooms --update-env
pm2 save
```

Vérifier :

```bash
pm2 list                                     # « rooms » doit être online
pm2 env 0 | grep -E "PORT|CLIENT_ORIGIN"     # PORT: 8080 et la bonne origine
pm2 logs rooms --lines 20 --nostream         # « listening on http://localhost:8080 », pas d'erreur
curl http://127.0.0.1:8080/api/health        # {"ok":true}
```

## 2. Mettre à jour le front

### Sur le PC

1. Vérifier `.env.production` (voir [README.md](README.md#réglages-de-production)) :
   `VITE_API_URL=https://rooms.gameboxheroes.fr`, **sans `:8080`**.
2. Construire :

   ```bash
   npm run build
   ```

3. Contrôler que le build vise la bonne adresse (Git Bash) :

   ```bash
   grep -o "https://rooms.gameboxheroes.fr[:0-9]*" dist/assets/*.js | sort -u
   ```

   Doit afficher `https://rooms.gameboxheroes.fr`, sans port.

### Copier les fichiers (client SFTP)

Copier **tout le contenu** de `dist/` dans le dossier web du front sur le VPS
(celui qui contient déjà `index.html` et `assets/`) :

- `index.html`
- `assets/` (les fichiers ont un nom avec empreinte, ex. `index-L79C0C1u.js` :
  les anciens peuvent être supprimés)
- `modules/`
- `favicon.ico`
- **`.htaccess`** — fichier caché : activer l'affichage des fichiers cachés
  dans le client SFTP. Sans lui, `/api` et `/socket.io` ne sont plus relayés
  vers le serveur et la navigation directe sur une page renvoie une 404.

### Vérifier (navigateur du PC)

1. Recharger le site en vidant le cache : **Ctrl+F5**.
2. Ouvrir https://rooms.gameboxheroes.fr/api/health → `{"ok":true}`.
3. Créer une partie en ligne, la rejoindre depuis un second onglet.

En cas de problème : [depannage.md](depannage.md).

## Version

Le numéro de version est dans `package.json` (racine) et s'affiche dans
l'interface. Le changer avant le build si la mise en production correspond à
une nouvelle version.
