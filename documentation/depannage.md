# Dépannage — « je ne peux pas créer / rejoindre de partie »

Suivre les étapes dans l'ordre : chacune isole un maillon de la chaîne
navigateur → Apache → serveur Node.

## 1. Le serveur Node tourne-t-il ? (VPS)

```bash
pm2 list                                  # « rooms » doit être online
curl http://127.0.0.1:8080/api/health     # attendu : {"ok":true}
```

- Connexion refusée → le serveur est arrêté ou n'écoute pas sur 8080 :
  `pm2 logs rooms --lines 30 --nostream` pour voir l'erreur, et
  `pm2 env 0 | grep PORT`.
- `pm2 list` vide (souvent avec « Spawning PM2 daemon ») → le VPS a redémarré
  sans que PM2 relance `rooms`. Vérifier d'être connecté en `prod` (en `root`,
  la liste est toujours vide), puis `pm2 resurrect` ; si `rooms` manque
  encore, suivre le premier lancement de [pm2.md](pm2.md#premier-lancement-vps-neuf-ou-processus-supprimé).
  Terminer par `pm2 save` et, si ce n'est pas déjà fait, `pm2 startup`.

## 2. Apache relaie-t-il vers le serveur ? (navigateur du PC)

Ouvrir https://rooms.gameboxheroes.fr/api/health.

- `{"ok":true}` → relais OK.
- La page du jeu s'affiche → le relais `/api` ne fonctionne pas : vérifier que
  `.htaccess` est bien présent dans le dossier web du front, et que les
  modules `mod_proxy`, `mod_proxy_http`, `mod_proxy_wstunnel` sont actifs.
- Erreur 502 / 503 → Apache ne joint pas le port 8080 : revenir à l'étape 1.

> Ne pas faire ce test avec `curl` depuis le VPS : il reste bloqué sur
> `Trying <IP>:443...` car le VPS ne se joint pas par son IP publique. Ce
> n'est pas une panne.

## 3. Que dit le navigateur ?

Sur le site, **F12** puis tenter de créer une partie :

- Onglet **Réseau** (Network) → ligne `games` : regarder le statut et l'**URL
  appelée** (onglet Headers de la requête).
- Onglet **Console** → messages en rouge.

| Symptôme | Cause | Remède |
|---|---|---|
| `ERR_CONNECTION_TIMED_OUT`, URL en `:8080` | Le front a été construit avec un mauvais `VITE_API_URL` | Corriger `.env.production`, `npm run build`, recopier `dist/` ([mise-a-jour.md](mise-a-jour.md#2-mettre-à-jour-le-front)) |
| URL en `http://localhost:3001` | Front construit sans `.env.production` | Idem |
| `blocked by CORS policy` | `CLIENT_ORIGIN` du serveur ≠ adresse du site | `pm2 env 0 \| grep CLIENT_ORIGIN`, puis le corriger ([pm2.md](pm2.md#changer-un-réglage-port-client_origin)) |
| Statut `503`, `too-many-games` | 200 parties en mémoire | Attendre la purge automatique ou `pm2 restart rooms` (efface les parties) |
| La partie se crée mais le jeu en ligne se comporte mal (tour, journal, FPF, ponts…) | Serveur plus ancien que le front | Mettre le serveur à jour ([mise-a-jour.md](mise-a-jour.md#1-mettre-à-jour-le-serveur)) |

Pour savoir quelle adresse est figée dans un build local (Git Bash, à la
racine du dépôt) :

```bash
grep -o "https\?://[a-z0-9.:-]*gameboxheroes[a-z0-9.:]*\|localhost:3001" dist/assets/*.js | sort -u
```

## Historique des incidents

- **15/10/2026** — Création de partie impossible (`ERR_CONNECTION_TIMED_OUT`).
  Deux causes : `CLIENT_ORIGIN` lancé avec une valeur d'exemple
  (`https://ton-domaine`), et front en ligne construit le 09/10 avec
  `VITE_API_URL=https://rooms.gameboxheroes.fr:8080` (port fermé depuis
  Internet). Corrigé par `pm2 restart rooms --update-env` avec la bonne
  origine, puis rebuild et recopie de `dist/`.
- **16/10/2026** — Erreur 503 d'Apache sur `/api` et `/socket.io` (le front
  s'affichait). Le VPS avait redémarré et PM2 ne relançait pas `rooms` :
  `pm2 startup` n'avait jamais été exécuté, et `pm2 list` était vide. Corrigé
  par la relance de `rooms`, `pm2 startup` (service systemd `pm2-prod`), puis
  `pm2 save`.
