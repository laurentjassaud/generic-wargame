# PM2 — garder le serveur allumé

[PM2](https://pm2.keymetrics.io/) est installé en global sur le VPS
(`npm install -g pm2`). Il lance le serveur Node, le relance s'il plante et,
une fois configuré, au redémarrage du VPS.

Le serveur tourne sous le nom **`rooms`** (id `0`), depuis
`/home/prod/WWW/rooms`.

## Commandes courantes

| Commande | Effet |
|---|---|
| `pm2 list` | État des processus (`online` = OK ; colonne ↺ = nombre de redémarrages) |
| `pm2 logs rooms` | Journal en direct (Ctrl+C pour quitter) |
| `pm2 logs rooms --lines 30 --nostream` | 30 dernières lignes du journal |
| `pm2 env 0 \| grep -E "PORT\|CLIENT_ORIGIN"` | Réglages avec lesquels le serveur tourne réellement |
| `pm2 restart rooms --update-env` | Redémarrer en prenant en compte les variables passées dans la commande |
| `pm2 stop rooms` / `pm2 start rooms` | Arrêter / relancer |
| `pm2 save` | Mémoriser la liste et les réglages actuels (pour le redémarrage du VPS) |

## Changer un réglage (PORT, CLIENT_ORIGIN)

PM2 garde les variables d'environnement **du premier lancement**. Pour en
changer, les passer dans la commande avec `--update-env`, puis sauvegarder :

```bash
PORT=8080 CLIENT_ORIGIN=https://rooms.gameboxheroes.fr pm2 restart rooms --update-env
pm2 save
```

Sans `--update-env`, les anciennes valeurs sont conservées. Sans `pm2 save`,
elles reviennent au prochain redémarrage du VPS.

## Premier lancement (VPS neuf ou processus supprimé)

```bash
cd ~/WWW/rooms
npm install --omit=dev
PORT=8080 CLIENT_ORIGIN=https://rooms.gameboxheroes.fr pm2 start src/index.js --name rooms
pm2 save
pm2 startup      # puis exécuter la commande « sudo … » qu'il affiche (une seule fois)
```

> ⚠️ Si `pm2 start` répond `Script already launched`, le serveur tourne déjà :
> utiliser `pm2 restart rooms --update-env`. **Ne pas** ajouter `-f`, qui
> lancerait une deuxième copie en conflit sur le port 8080.

## Repères dans `pm2 list`

- `namespace: default` : normal (aucun espace de noms choisi).
- `version: 0.0.0` : normal, `server/package.json` n'a pas de champ `version`.
- `mode: fork` : normal, une seule instance (les parties sont en mémoire, il
  ne faut **pas** passer en mode cluster).
