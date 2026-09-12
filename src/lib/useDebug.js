// ═══════════════════════════════════════════════════════════════════════════
// useDebug — mode "debug" de l'interface (case à cocher dédiée, cf. HexMap.vue)
// ═══════════════════════════════════════════════════════════════════════════
//
// Ce composable est le SEUL endroit où doit vivre la logique des affichages
// de debug de l'appli — au même titre que lib/useAssisted.js centralise toute
// la logique du mode "Assisté". Chaque nouvel affichage de debug (il y en
// aura d'autres à l'avenir) doit être ajouté ICI, sous la forme d'un
// `computed` de plus dans l'objet retourné, gardé par `debug.value` — jamais
// codé en dur directement dans HexMap.vue.
//
// Contrairement au mode Assisté/Libre (qui change les RÈGLES du jeu), le mode
// debug ne change QUE ce qui est affiché EN PLUS à l'écran, à titre
// d'information pour développer/tester l'appli — jamais le comportement du
// jeu lui-même (aucune des fonctions ci-dessous ne modifie quoi que ce soit,
// elles ne font QUE dériver de l'affichage à partir de l'état existant). En
// particulier, `isInRange` ci-dessous ÉLARGIT l'affichage du surlignage vert
// (portée complète au lieu du seul premier pas), mais ne rend cliquable AUCUN
// hex de plus : le clic reste géré par HexMap.vue::onHex, inchangé, qui ne
// permet toujours de se déplacer QUE vers un hex adjacent à la fois.
//
// Affichages de debug :
//   1. le COÛT DE TERRAIN (COT) de chaque hex adjacent au pion actuellement
//      sélectionné (cf. `adjacentCotLabels`) — utile pour vérifier au coup
//      par coup que la règle de MP de lib/useAssisted.js
//      (`canEnterHex`/`terrainCost`) applique le bon coût.
//   2. la PORTÉE DE DÉPLACEMENT complète du pion sélectionné (cf.
//      `isInRange`) : tous les hex qu'il peut atteindre avec les MP qu'il
//      lui reste, pas seulement ceux immédiatement adjacents (cf.
//      HexMap.vue::reachableSet/isReachable, qui ne couvre que le premier
//      pas et reste actif hors mode debug). Calculée par un plus court
//      chemin (Dijkstra, cf. `reachableHexes` plus bas) où le "poids" pour
//      entrer dans un hex est son COT — exactement la même notion de coût
//      que `canEnterHex`/`spendMp`, juste étendue à plusieurs pas d'un coup.
//
// Paramètres reçus (tous déjà calculés/définis côté HexMap.vue — ce
// composable ne fait QUE les recombiner, il ne récupère ni ne recalcule rien
// par lui-même en dehors de la portée de déplacement ci-dessus) :
//   - `hexes` : ref/computed de TOUS les hex de la grille, sous la forme
//     `{ id, c, r, cx, cy, pts }` (cf. HexMap.vue::hexes) — `cx`/`cy` sont
//     déjà les coordonnées PIXEL du centre de l'hex, prêtes à afficher un
//     texte dessus sans recalcul.
//   - `isAdjacent` : fonction `(h) => bool` (cf. HexMap.vue::isAdjacent) qui
//     répond "cet hex est-il adjacent au pion actuellement sélectionné ?" —
//     déjà `false` partout si aucun pion n'est sélectionné.
//   - `terrainCost` : fonction `(h) => nombre de MP` (cf.
//     lib/useAssisted.js::terrainCost, exportée pour être réutilisée ici SANS
//     dupliquer la logique de lecture de `module.terrain`).
//   - `selectedCounter` : ref/computed du pion actuellement sélectionné (objet
//     complet, avec `col`/`row`/`mov`), ou `null` (cf. HexMap.vue::selectedCounter).
//   - `remainingMp` : fonction `(pion) => nombre de MP restants, ou `null` si
//     ce pion n'a pas de MP déclarés (cf. lib/useAssisted.js::remainingMp).
//   - `neighborsOf`, `hexOnMap` : fonctions de géométrie de grille (cf.
//     lib/hex.js et HexMap.vue::hexOnMap) — nécessaires pour explorer la
//     grille hex par hex lors du calcul de la portée de déplacement.
import { computed, ref } from 'vue'

/** Tous les hex atteignables depuis `{ col, row }` avec au plus `budget` MP à
 *  dépenser, chaque hex traversé coûtant `terrainCost(hex, from)` — plus
 *  court chemin (Dijkstra), PAS un simple calcul "distance × coût moyen",
 *  car le coût pour entrer dans un hex peut varier selon d'où l'on vient
 *  (cf. lib/useAssisted.js::terrainCost, route/piste : moins cher en
 *  suivant une route précise qu'en coupant à travers champs). La grille d'un
 *  module (~1000 hex pour Arnhem) est assez petite pour se passer d'un tas
 *  binaire : une simple recherche linéaire du nœud non visité le plus proche
 *  suffit très largement. Renvoie un Set de clés "col,row", SANS le hex de
 *  départ (`c` n'a pas besoin d'"entrer" dans son propre hex). */
function reachableHexes({ col, row }, budget, neighborsOf, hexOnMap, terrainCost) {
  const startKey = col + ',' + row
  const dist = new Map([[startKey, 0]])
  const visited = new Set()
  for (;;) {
    let currentKey = null
    let currentDist = Infinity
    for (const [key, d] of dist) {
      if (!visited.has(key) && d < currentDist) { currentKey = key; currentDist = d }
    }
    if (currentKey == null) break // plus aucun nœud à traiter : exploration terminée
    visited.add(currentKey)
    const [c, r] = currentKey.split(',').map(Number)
    for (const n of neighborsOf(c, r)) {
      if (!hexOnMap(n.col, n.row)) continue
      // `from: { c, r }` (le nœud qu'on est en train d'étendre) est ce qui
      // permet à `terrainCost` de détecter une arête route/piste PRÉCISE
      // entre ce nœud et son voisin `n` — sans lui, on perdrait cette règle
      // dans le calcul de portée (cf. useAssisted.js::terrainCost).
      const next = currentDist + terrainCost({ c: n.col, r: n.row }, { c, r })
      if (next > budget) continue // trop cher pour arriver jusque-là : hors de portée
      const key = n.col + ',' + n.row
      if (next < (dist.get(key) ?? Infinity)) dist.set(key, next)
    }
  }
  dist.delete(startKey)
  return new Set(dist.keys())
}

export function useDebug(hexes, isAdjacent, terrainCost, selectedCounter, remainingMp, neighborsOf, hexOnMap) {
  // Unique interrupteur du mode debug (case à cocher "debug", cf. HexMap.vue)
  // — tous les affichages de ce composable, présents et futurs, doivent être
  // gardés par lui (`if (!debug.value) return ...`), jamais actifs par défaut.
  const debug = ref(false)

  // Un objet `{ id, cx, cy, cot }` par hex adjacent au pion sélectionné —
  // liste vide si le mode debug est désactivé OU si aucun pion n'est
  // sélectionné (les deux se traduisent par "rien à afficher", cf. HexMap.vue
  // qui n'a donc besoin que d'un `v-for` dessus, sans autre condition). Le
  // COT affiché tient compte d'une éventuelle route/piste PRÉCISE entre la
  // position actuelle du pion (`from`) et chaque hex adjacent (cf.
  // lib/useAssisted.js::terrainCost) — pas juste le coût de zone brut.
  const adjacentCotLabels = computed(() => {
    if (!debug.value) return []
    const c = selectedCounter.value
    if (!c) return []
    const from = { c: c.col, r: c.row }
    return hexes.value
      .filter((h) => isAdjacent(h))
      .map((h) => ({ id: h.id, cx: h.cx, cy: h.cy, cot: terrainCost({ c: h.c, r: h.r }, from) }))
  })

  // Ensemble des hex ("col,row") que le pion sélectionné peut atteindre avec
  // ses MP restants, au-delà du seul premier pas adjacent — vide si le mode
  // debug est désactivé ou si aucun pion n'est sélectionné. Si le pion ne
  // déclare pas de MP (`remainingMp` renvoie `null`, cf. lib/useAssisted.js),
  // budget "illimité" : en cohérence avec `canEnterHex`, qui ne restreint
  // alors rien non plus.
  const inRangeSet = computed(() => {
    if (!debug.value) return new Set()
    const c = selectedCounter.value
    if (!c) return new Set()
    const budget = remainingMp(c)
    return reachableHexes(
      { col: c.col, row: c.row },
      budget == null ? Infinity : budget,
      neighborsOf, hexOnMap, terrainCost,
    )
  })
  const isInRange = (h) => inRangeSet.value.has(h.c + ',' + h.r)

  return { debug, adjacentCotLabels, isInRange }
}
