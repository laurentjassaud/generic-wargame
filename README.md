# Generic Wargame

Un moteur générique de wargame hexagonal (Vue 3 + Vite) : la carte, la grille
d'hex, le zoom/pan et les pions sont gérés par un seul composant réutilisable
(`HexMap.vue`), et chaque **jeu** (carte, pions, coûts de terrain...) est une
**boîte de jeu** — un module JSON servi statiquement, interchangeable sans
toucher au code du moteur.

## Premier module : Arnhem

`public/modules/arnhem/` implémente *A Bridge Too Far: Arnhem* (Opération
Market-Garden, septembre 1944) :

- la carte hexagonale (39×26 hex, image haute résolution) ;
- 38 pions allemands (infanterie/reco + artillerie), avec leurs stats
  attaque/défense/mouvement (ou barrage/fpf/portée pour l'artillerie) ;
- une grille de coût de mouvement par hex (Mixed/Woods/Broken/Rough/City/Town),
  classée automatiquement par couleur puis corrigée à la main ;
- une favicon et un titre de page propres au module.

D'autres modules (autre carte, autre camp, autre jeu) peuvent être ajoutés en
suivant la même structure, sans modifier `HexMap.vue`.

## Comment ça marche

Un module est un dossier sous `public/modules/<nom>/` contenant :

```
public/modules/<nom>/
├── <nom>.json          # nom, carte, pions, terrain, favicon...
├── favicon.ico
└── images/
    ├── <carte>.jpg
    └── counters/<camp>/*.png
```

`App.vue` charge le module par son URL (`MODULE_URL`), puis :

- passe son `map` (image + dimensions + cols/rows) à `HexMap.vue` ;
- applique `module.name` au titre de la page et `module.favicon` à l'icône
  d'onglet — chaque module contrôle ces deux éléments sans toucher au code.

`HexMap.vue` lit `module.counters` : seuls les pions qui déclarent un `setup`
(hex de départ, ex. `"setup": "0604"`) sont placés sur la carte au chargement
— pas de placement aléatoire.

## Fonctionnalités de la carte

- **Zoom** à la molette, **pan** au clic droit maintenu.
- Grille d'hex cliquable, avec panneau de calibration (`CalibrationPanel.vue`)
  pour ajuster l'alignement grille/image en direct.
- **Pions (`Counter.vue`)** : clic pour sélectionner (contour vert) / clic à
  nouveau pour désélectionner ; glisser-déposer libre sur un hex (il se centre
  dessus) ; une fois sélectionné, ses 6 hex voisins sont surlignés en vert et
  un clic dessus le déplace d'un pas.

## Scripts

Le dossier `scripts/` contient les générateurs utilisés pour construire le
module Arnhem (relançables si les données source changent) :

- `apply-german-counters.mjs` — installe les images de pions dans
  `images/counters/german/` et regénère `counters.german` dans le JSON.
- `gen-terrain-grid.py` — classe le terrain de chaque hex par échantillonnage
  de couleur sur l'image de carte, écrit `module.terrain` et un CSV
  (`movement-grid-arnhem.csv`) pour correction manuelle.
- `gen-terrain-artifact.mjs` — génère une page HTML autonome (carte + grille
  colorée + coûts affichés) pour vérifier visuellement le classement.

## Limites connues

- Seul le coût **de zone** par hex est modélisé (Mixed/Woods/Broken/Rough/
  City/Town). Les éléments de **bordure** (route, sentier, rivière, ruisseau,
  bac, frontière, ponts) ne sont pas encore encodés — colonne `edges` du CSV
  laissée vide.
- Aucun pion allemand n'a de `setup` renseigné pour l'instant : la carte
  s'affiche donc vide au chargement tant que les positions de départ du
  scénario n'ont pas été ajoutées dans `arnhem.json`.

## Développement

```sh
npm install
npm run dev       # serveur de développement
npm run build     # build de production
npm run preview   # prévisualiser le build
```

Prérequis : Node `^22.18.0` ou `>=24.12.0` (voir `engines` dans
`package.json`). Les scripts de génération de données (`scripts/*.mjs`,
`scripts/*.py`) nécessitent respectivement Node et Python 3 + Pillow.
