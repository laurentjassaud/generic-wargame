// ═══════════════════════════════════════════════════════════════════════════
// edges — nature des HEXSIDES (arêtes entre deux hex), déclarée par le module
// ═══════════════════════════════════════════════════════════════════════════
//
// Une carte porte, en plus du terrain de chaque hex, des éléments posés SUR
// les côtés d'hex : routes, pistes, rivières, ponts, bacs, ruisseaux... Le
// module les liste en COUCHES (`terrain.roads`, `terrain.rivers`... — des
// paires "AAAA-BBBB" d'hex adjacents) et DÉCLARE ce que chaque couche veut
// dire dans `terrain.edges` ; le moteur (lib/useAssisted.js pour le
// mouvement et la ZOC, lib/useCombat.js pour le combat) n'interprète que
// cette déclaration :
//
//   "edges": {
//     "layers": { "roads": "road", "highwayBridges": "bridge", ... },
//     "kinds": {
//       "road":   { "mp": 0.5, "vehicles": true },
//       "ferry":  { "extraMp": 3, "vehicles": false },
//       "river":  { "impassable": true, "blocksZoc": true, "blocksAttack": true },
//       ...
//     },
//     "movementPriority": ["road", "trail", "bridge", "ferry", "river", "stream"],
//     "combatPriority": ["bridge", "river", "road", "trail", "stream"]
//   }
//
//   - `layers` : couche du JSON → NATURE d'arête (plusieurs couches peuvent
//     partager une nature : les trois sortes de pont d'Arnhem) ;
//   - `kinds` : propriétés de chaque nature, toutes facultatives —
//       • `mp` : coût FIXE pour entrer dans l'hex par cette arête (route,
//         piste), à la place du coût du terrain ; un hex touché par une telle
//         arête se paie aussi à ce coût à l'ENTRÉE EN JEU d'un renfort ;
//       • `extraMp` : surcoût AJOUTÉ au coût du terrain (gué, bac) ;
//       • `impassable` : arête infranchissable pour tout le monde ;
//       • `vehicles` : `false` = interdite aux véhicules (cf. `rules.
//         vehicleTypes`) ; `true` = ouvre aux véhicules un terrain qui leur
//         est autrement interdit (cf. `rules.impassableForVehicles`) ;
//       • `blocksZoc` : la zone de contrôle ne s'étend pas à travers ;
//       • `blocksAttack` : on ne peut pas attaquer à travers ;
//   - `movementPriority` : quand une arête porte PLUSIEURS natures, celle qui
//     fait foi pour le MOUVEMENT (coût, franchissement) est la première de
//     cette liste présente sur l'arête (une route qui franchit un ruisseau :
//     on suit la route, pas le gué) ;
//   - `combatPriority` : même principe pour tout ce qui "traverse" l'arête
//     sans s'y déplacer — COMBAT (attaque interdite, ligne de la table de
//     combat substituée, cf. `module.combat.edgeRows`) et ZOC. L'ordre peut
//     différer du mouvement (un pont d'Arnhem, souvent aussi route, doit
//     primer sur elle au combat).
//
// Sans `terrain.edges`, aucune arête n'a d'effet (les couches sont ignorées).

/** `module.terrain` → interprète des arêtes (cf. l'en-tête). */
export function resolveEdges(terrain) {
  const declaration = terrain?.edges ?? {}
  const kinds = declaration.kinds && typeof declaration.kinds === 'object' ? declaration.kinds : {}

  // Nature → ensemble des arêtes "AAAA-BBBB", stockées dans les DEUX sens (le
  // JSON ne liste chaque arête qu'une fois, dans un ordre arbitraire).
  const edgesByKind = new Map()
  for (const [layer, kind] of Object.entries(declaration.layers ?? {})) {
    if (!kinds[kind]) continue
    const set = edgesByKind.get(kind) ?? new Set()
    for (const edge of terrain?.[layer] ?? []) {
      const [hexA, hexB] = String(edge).split('-')
      set.add(hexA + '-' + hexB)
      set.add(hexB + '-' + hexA)
    }
    edgesByKind.set(kind, set)
  }

  const known = (list) => (Array.isArray(list) ? list : Object.keys(kinds)).filter((kind) => kinds[kind])
  const movementPriority = known(declaration.movementPriority)
  const combatPriority = known(declaration.combatPriority ?? declaration.movementPriority)
  const firstPresent = (priority, edgeKey) => priority.find((kind) => edgesByKind.get(kind)?.has(edgeKey)) ?? null

  // Hex ("CCRR") touchés par au moins une arête de chaque nature à coût fixe
  // (`mp`) — pour le coût d'ENTRÉE EN JEU, qui n'a pas d'arête de provenance.
  const touchedByKind = new Map()
  for (const kind of movementPriority) {
    if (kinds[kind].mp == null) continue
    touchedByKind.set(kind, new Set([...(edgesByKind.get(kind) ?? [])].map((edgeKey) => edgeKey.split('-')[0])))
  }

  return {
    /** Propriétés d'une nature (cf. l'en-tête), `null` pour `null`/inconnue. */
    kindOf: (kind) => (kind ? kinds[kind] ?? null : null),
    /** Nature qui fait foi pour le MOUVEMENT sur l'arête `edgeKey`, ou `null`. */
    movementKind: (edgeKey) => firstPresent(movementPriority, edgeKey),
    /** Nature qui fait foi pour le COMBAT et la ZOC sur l'arête `edgeKey`, ou `null`. */
    combatKind: (edgeKey) => firstPresent(combatPriority, edgeKey),
    /** Nature à coût fixe qui dessert l'hex `hexKey` ("CCRR") pour une entrée en jeu, ou `null`. */
    entryKind: (hexKey) => movementPriority.find((kind) => touchedByKind.get(kind)?.has(hexKey)) ?? null,
  }
}
