# Generic Wargame

Moteur générique de wargame hexagonal, jouable **en local** (un navigateur pour
tous les camps) ou **en ligne** (une room par partie, un joueur par camp).

- **Front** : Vue 3 + Vite (`src/`). Le plateau, la grille d'hex, le zoom/pan,
  les pions et toutes les règles vivent dans un composant réutilisable
  (`HexMap.vue`) et ses composables (`src/lib/`).
- **Serveur** (parties en ligne) : Node + Express + Socket.IO (`server/`). Il
  ne connaît ni les règles ni les pions : il conserve l'état d'une room
  (positions, tour, phase, pendules, journal partagé) et le rediffuse.
- **Modules** : chaque **boîte de jeu** (carte, pions, terrain, camps, tours…)
  est un dossier JSON servi statiquement (`public/modules/<id>/`),
  interchangeable sans toucher au moteur.

## Modules disponibles

`public/modules/index.json` liste les modules ; seul **Arnhem** (*A Bridge Too
Far: Arnhem* — Opération Market-Garden, septembre 1944) est actif, les autres
(Hürtgen, Bastogne, Remagen) sont annoncés « Bientôt disponible ».

## Modes de jeu

Choisis à la création de la partie (assistant en 4 étapes en local, 5 en ligne
avec le nombre de joueurs) — cf. `src/lib/gameSettings.js`.

| Réglage | Valeurs | Effet |
|---|---|---|
| Scénario | Ceux du module — Arnhem : Historique (*Placement libre* : bientôt) | Déploiement |
| Météo | *bientôt disponible* | — (pas encore appliquée par le moteur) |
| Partie | **Libre** / **Assisté** | Voir ci-dessous |
| Timing | Libre / **Limité** / **Blitz** | Chronomètre de la phase de Mouvement — partie Assistée uniquement |

**Partie Libre** : un bac à sable. Glisser-déposer libre de tous les pions,
aucune restriction de tour ni de règle, dé libre.

**Partie Assistée** : l'application applique les règles.
- grille affichable, sélection au clic, contrôle limité au camp dont c'est le
  tour ;
- tour joué en phases : **Airborne** (pose des aéroportés, si le camp en a) →
  **Mouvement** → **Combat** → *Fin de tour* (dernier camp de l'ordre) ;
- points de mouvement et coûts de terrain (routes, pistes, ponts, bacs,
  rivières, ruisseaux), terrains interdits aux véhicules, zones de contrôle,
  empilement (une unité par hex en fin de mouvement), congestion des hex
  d'entrée des renforts, retour arrière et annulation de mouvement ;
- combat : désignation des cibles (plusieurs hex) et des attaquants, table de
  combat (CRT) avec dé, combats obligatoires, retraites hex par hex (avec
  refoulement d'amis), éliminations, avance après combat ; les unités ayant
  combattu pendant la phase portent un rond rouge en haut à gauche ;
- démolition des ponts (cf. `src/lib/useDemolition.js`) : un pont déclaré
  démolissable peut sauter dès qu'une unité du camp adverse borde l'un de ses
  deux hex, à n'importe quelle phase ; le camp qui le tient décide aussitôt
  (jet de dé, une seule tentative), après quoi le pont est détruit — l'arête
  redevient la rivière ou le ruisseau qu'il franchissait — ou définitivement
  sauf. Un rond rouge (détruit) ou vert (sauf) marque l'hexside réglé ;
- artillerie (cf. `src/lib/useArtillery.js`) : barrage au contact ou à
  distance (cible dans la portée et observée par une unité amie, jamais
  affectée par le résultat), terrain de l'hex seul face à l'artillerie,
  « final protective fire » (FPF) du défenseur pendant le tour adverse,
  points rouge (résultat subi) et orange (refoulée) en haut à droite des
  pions ;
- règles particulières au module (cf. `src/lib/useArnhem.js` : déploiement
  initial, allocation réduite des aéroportés à l'arrivée, réduction des
  retraites en ville — refusée à l'artillerie aéroportée et aux unités
  encerclées, aéroportés et planeurs exceptés —, soutien au sol guidé
  seulement à 3 hex d'une unité alliée non aéroportée, au plus deux
  artilleries par camp dans un combat).

**Timings** (partie Assistée) : *Limité* accorde N minutes à **chaque** phase
de Mouvement (compte à rebours, clignote sous 20 s, alerte à zéro) ; *Blitz*
donne à chaque camp un temps total pour toutes ses phases de Mouvement
(pendule d'échecs, une par camp, toujours visible) — à zéro, le camp **perd
la partie**.

## Journal de partie

Onglet « Journal » du panneau latéral (`JournalPanel.vue`) : chaque évènement
(déploiement, tour, phase, déplacement avec MP, entrée en jeu, combat,
retraite, avance, élimination…) y est inscrit avec de quoi le **rejouer**.
- **Local** : sauvegarde automatique (navigateur) proposée en reprise au
  chargement suivant ; export/import JSON ; lecteur de rejeu (pas à pas ou
  avance rapide). Une sauvegarde faite avec d'autres réglages relance la
  partie avec les siens.
- **En ligne** : journal **partagé**, conservé par le serveur et identique
  chez tous les joueurs (déploiement tiré une seule fois, éliminations,
  retours arrière…) ; un joueur qui recharge la page ou se reconnecte est
  réaligné sur le serveur. Export JSON toujours possible.

**Signaler un bug** (bouton de la barre d'outils du plateau,
`BugReportModal.vue`, `src/lib/bugReport.js`) : ouvre la création d'un ticket
GitHub pré-rempli (titre, description, contexte de la partie, 30 derniers
coups en clair). Le joueur le valide avec son propre compte GitHub. Le ticket
joint aussi un **export** compressé : état de la carte et 30 derniers coups
avec leurs données. Pour le lire :
`node scripts/decode-bug-report.mjs <export>`. Le dépôt cible se change avec
`VITE_GITHUB_REPO`.

## Parties en ligne

`/` liste les parties, `/create` en crée une (code d'accès affiché une seule
fois), `/room/:id` la rejoint (pseudo, camp, code). La partie démarre quand
tous les sièges sont pris. Le serveur reçoit l'ordre des camps à la création
et **refuse tout coup du joueur qui n'a pas la main** ; l'interface bloque de
même les actions hors tour. La liste des joueurs indique qui est en ligne.
Deux exceptions, où c'est le joueur SANS la main qui tranche — dans les deux
cas, le joueur actif soumet, l'autre répond, et le résultat est appliqué chez
tout le monde. La **démolition d'un pont** d'abord : l'occasion est soumise au
camp qui le tient (`game:demolition-request`), il lance son dé sur son écran
et publie le sort du pont (`game:demolition`). Le **FPF** de l'artillerie
ensuite, choisi par le défenseur. Quand
un combat peut en recevoir un, l'attaquant le soumet d'abord au défenseur
(`game:fpf-request`). Celui-ci choisit ses artilleries sur son écran et
répond (`game:fpf-reply`), puis l'attaquant lance le dé. L'attaquant peut
renoncer tant que la réponse n'est pas arrivée (`game:fpf-cancel`). Le
serveur garde la négociation en cours (`fpfRequest`) pour qu'une page
rechargée la retrouve.

## Anatomie d'un module

```
public/modules/<id>/
├── <id>.json          # tout ce qui suit
├── favicon.ico
└── images/            # carte, marqueurs, tables, counters/<faction>/*.png
```

Champs du JSON (cf. `arnhem.json`) :

| Champ | Contenu |
|---|---|
| `boardGame`, `name`, `favicon` | Identité (titre de page, icône d'onglet) |
| `movementChart`, `combatChart` | Images des tables, affichables en jeu |
| `map` | `url`, `imageWidth/Height`, `cols`, `rows`, `evenColMinus` (colonnes décalées amputées d'une ligne), `removedHexes`, `calibration` (x0/y0/colStep/a/rowStep, en pixels de l'image) |
| `combat` | Table de combat : `die`, colonnes de différentiel, lignes de terrain (décalage), substitutions par hexside, résultats, libellés et **effets** de chaque résultat (retraite, élimination), avance après combat — cf. `src/lib/combatTable.js` ; sans table, pas de combat |
| `scenarios` | Scénarios proposés : `id`, `label`, `deployment` (`setup` — seul mode appliqué par le moteur ; `free` : bientôt), `weather` (`required` / `optional`) — cf. `src/lib/gameSettings.js` |
| `turnStructure` | Phases du tour d'un camp, en plus du Mouvement : `airbornePhase`, `combatPhase`, `endOfTurnPhase` (booléens) — cf. `src/lib/rules.js` |
| `rules` | Paramètres des règles génériques : `vehicleTypes`, `impassableForVehicles`, `stackingLimit`, `zoc` (`lockIfStarting`, `stopOnEntry`, `blocksRetreat`), `entryCongestion` (`multiply` / `none`), `mapExit` (sortie de carte : `side` autorisé et `zones` de bord `{ id, label, hexes }`, une unité sortie revenant en renfort par la même bande au tour suivant), `bridgeDemolition` (ponts démolissables : `layers` de la carte, camp `trigger` qui ouvre l'occasion, camp `by` qui décide, `destroyOn` du dé, `reveals`/`fallback` — l'obstacle que laisse un pont détruit), et les valeurs des règles particulières du module (ex. `airborneArrivalSpentMp`, `groundSupportSpotterRange`, `maxArtilleryPerCombat`) — cf. `src/lib/rules.js` |
| `sides` | Camps jouables → factions (`{"allies": ["commonwealth","us","pol"], "german": ["german"]}`) |
| `turnTrack` | `turns`, `order` des camps, libellé et marqueur de chaque camp |
| `supportTrack` | Tablette de soutien : pions par tour (`byTurn`), camp propriétaire (`side`) et apport au combat d'un pion (`factor`, défaut 1) — cf. `src/components/SupportTracker.vue` et la section "PIONS DE SOUTIEN" de `src/lib/useCombat.js` |
| `terrain` | `types` (libellé, coût en MP), `grid` (hex → type), les couches d'arêtes (`roads`, `rivers`… : listes `"AAAA-BBBB"`) et `edges`, qui déclare ce que vaut chaque couche : coût fixe ou surcoût, infranchissable, interdite ou ouverte aux véhicules, coupe la ZOC ou l'attaque, et l'ordre de priorité quand plusieurs se superposent (mouvement / combat) — cf. `src/lib/edges.js` |
| `counters` | Par faction : `id`, `name`, `code`, `type`, `atk`/`def`/`mov` (ou `bar`/`fpf`/`range` pour l'artillerie), `src`, `turn` d'arrivée, `setup` |

`setup` (hex d'entrée) : `"0604"` (cet hex), `"0901-2301"` (plage de bord de
carte), `"3719+adj"` (largage : l'hex ou l'un de ses 6 voisins — c'est ce
suffixe qui fait d'un pion un **aéroporté**). Un pion `type: "marker"` (zones
de largage « DZ ») n'est pas une unité (cf. `src/lib/units.js`).

La **calibration** pixel de la grille (`map.calibration`) est ajustable en
direct via le panneau « calibration » ; `src/lib/calibration.js` ne garde
qu'un repli pour un module qui n'en déclarerait pas.

Les **règles particulières** d'un module (ce qu'aucun champ du JSON ne sait
exprimer) vivent dans un composable dédié inscrit dans le registre
`src/lib/moduleRules.js` — `src/lib/useArnhem.js` sert de patron.

## Organisation du code

```
src/
├── views/        GamesList, CreateGame, LocalGameSetup, DemoPlay (plateau local), RoomLobby (plateau en ligne)
├── components/   HexMap (plateau et orchestration), TurnTracker, SupportTracker, Counter,
│                 ReinforcementsPanel, EliminatedPanel, JournalPanel, SidePanel, CombatModal,
│                 DemolitionModal, PhaseBlockedModal, MoveTimer, RollModal, MovementChartModal,
│                 CombatChartModal,
│                 CalibrationPanel, ContextMenu, GameSetupSteps
└── lib/
    ├── useAssisted.js   mode Assisté : phases, MP/terrain, ZOC, empilement, congestion
    ├── useCombat.js     cibles/attaquants, lecture de la table, combats obligatoires, FPF
    ├── useArtillery.js  artillerie : contact, tir à distance, FPF, résultats subis, refoulements
    ├── combatTable.js   table de combat du module (module.combat) : vérification et lecture
    ├── useRetreat.js    retraites, éliminations, avance après combat
    ├── useDemolition.js démolition des ponts : occasions, décision, ponts détruits ou saufs
    ├── moduleRules.js   registre des règles particulières par module
    ├── useArnhem.js     règles particulières du module Arnhem (patron pour d'autres modules)
    ├── rules.js         paramètres des règles génériques (module.rules), structure du tour (module.turnStructure)
    ├── setup.js         notation `setup` des pions (hex, plage, largage)
    ├── edges.js         nature des hexsides (terrain.edges) : mouvement, ZOC, combat
    ├── useDebug.js      affichages de debug (coûts, portée, congestion)
    ├── units.js         qu'est-ce qu'une unité / un marqueur / un pion de soutien
    ├── hex.js, mapShape.js, calibration.js   géométrie de la grille
    ├── gameSettings.js, journalStorage.js    réglages de partie, sauvegarde/reprise
    └── api.js, socket.js                     accès au serveur
server/src/
├── index.js      Express + Socket.IO, purge périodique des parties
├── rooms.js      état des rooms (en mémoire), contrôle de tour, journal partagé
├── socket.js     évènements temps réel (join, move, turn, phase, log, deploy, over)
└── routes/games.js   API REST : créer / lister / lire une partie
```

## Développement

```sh
npm install                 # front
(cd server && npm install)  # serveur

npm run dev                 # front sur http://localhost:5173
(cd server && npm run dev)  # serveur sur http://localhost:3001 (rechargé à chaque modification)

npm run build               # build de production (mode production, cf. .env.production)
npm run preview
```

Variables d'environnement : `VITE_API_URL` (front → URL du serveur, défaut
`http://localhost:3001`) ; `PORT` et `CLIENT_ORIGIN` (serveur, défauts `3001`
et `http://localhost:5173`). Pour un hébergement Apache, `public/.htaccess`
relaie `/api` et `/socket.io` vers le serveur Node (port 8080) et assure le
repli SPA.

Prérequis : Node `^22.18.0` ou `>=24.12.0` (voir `engines`).

Le serveur garde tout **en mémoire** : les parties disparaissent à son
redémarrage, et les rooms abandonnées sont purgées (6 h sans joueur pour une
room jamais lancée, 72 h pour une partie lancée).

## Scripts

`scripts/` contient les générateurs utilisés pour construire le module Arnhem
(relançables si les données source changent) :

- `apply-german-counters.mjs` — installe les images de pions allemands et
  regénère `counters.german` dans le JSON ;
- `gen-terrain-grid.py` — classe le terrain de chaque hex par échantillonnage
  de couleur (Python 3 + Pillow), écrit `terrain.types`/`terrain.grid` (les
  couches d'arêtes sont conservées) et un CSV de correction manuelle ;
- `gen-terrain-artifact.mjs` — page HTML autonome (carte + grille colorée +
  coûts) pour vérifier visuellement le terrain ;
- `build-terrain-transition.mjs` — convertit l'export de cette page (routes,
  pistes, hex retirés, corrections) en fichier de transition à relire avant
  application.

## Limites connues

- « Placement libre » (déploiement `free`) et « Météo » sont proposés grisés :
  le moteur ne les applique pas encore.
- Certaines règles restent propres à un module et vivent donc dans son
  composable de règles particulières (`src/lib/useArnhem.js` : déploiement
  initial, arrivée des aéroportés, retraite en ville, portée du soutien au
  sol, plafond d'artilleries par combat) ; la sémantique des
  résultats de combat se limite à retraite / élimination / avance.
- Pas de suite de tests automatisée dans le dépôt (les vérifications se font
  par scripts ad hoc et navigateur automatisé).
