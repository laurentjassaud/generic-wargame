// ═══════════════════════════════════════════════════════════════════════════
// useSupplyLine — LIGNES DE COMMUNICATION du mode "Assisté"
// ═══════════════════════════════════════════════════════════════════════════
//
// Une unité est reliée à ses arrières par une LIGNE DE COMMUNICATION : une
// suite continue d'hex qui part de son propre hex et rejoint une source. Le
// module déclare tout ce qui la définit (`rules.supplyLine`, cf.
// lib/rules.js::resolveSupplyLine) ; sans cette déclaration, ce fichier reste
// INERTE et ne trace jamais rien.
//
// ─── LA RÈGLE (Arnhem) ───────────────────────────────────────────────────────
// Elle ne concerne que les unités ALLIÉES, Polonais exceptés, et se calcule
// de deux façons selon l'unité :
//
//   - unité NON AÉROPORTÉE : elle trace une ligne continue jusqu'à 0105 ou
//     0106. Tant que la ligne n'a rencontré ni piste ni route, elle passe où
//     elle veut ; dès qu'elle EMPRUNTE UNE PISTE, tout le reste doit suivre
//     une piste ou une route ; dès qu'elle EMPRUNTE UNE ROUTE, tout le reste
//     doit suivre une route. La contrainte ne se relâche donc jamais — d'où
//     les "étages" du parcours ci-dessous (cf. `stageOfEdge`), qui ne peuvent
//     que monter à mesure qu'on s'éloigne de l'unité et se rapproche de
//     l'arrière ;
//
//   - unité AÉROPORTÉE : elle trace une ligne continue jusqu'à la ZONE DE
//     LARGAGE DE SA DIVISION, en sept hex au plus. Ni piste ni route n'y
//     changent quoi que ce soit : ce sont les avions qui ravitaillent, la
//     seule question est la distance à la DZ.
//
// Dans les deux cas, la ligne :
//   - ne traverse jamais un hex occupé par une unité ENNEMIE ;
//   - ne traverse jamais un hex sous ZOC ennemie — SAUF si une unité amie s'y
//     trouve : elle y annule la ZOC (une unité amie "tient" son hex) ;
//   - ne franchit jamais un hexside de rivière, de canal ou de ruisseau
//     SANS PONT. Un bac ne compte pas (il transporte des hommes, pas du
//     ravitaillement), et un pont DÉMOLI non plus — l'arête ne porte alors
//     plus que l'obstacle qu'il franchissait (cf. lib/useAssisted.js::
//     edgeKinds). Une route qui passe à gué ne suffit pas davantage : c'est
//     bien un PONT qu'il faut, d'où la lecture de TOUTES les natures de
//     l'arête et non de la seule qui fait foi ailleurs (une route masquerait
//     le ruisseau qu'elle traverse).
//
// ─── CE QU'ON EN FAIT ────────────────────────────────────────────────────────
// Pour l'instant, RIEN au sens des règles : aucune unité n'est pénalisée
// d'être hors ligne. Le calcul ne sert qu'à MONTRER la ligne (cf.
// HexMap.vue, surlignage vert en mode debug). Le jour où le ravitaillement
// aura des effets, ils s'appuieront sur `pathFor` / `hasSupply` sans rien
// changer ici.
//
// Paramètres reçus :
//   - `assisted` : ref/computed booléen — hors mode Assisté, aucune règle.
//   - `supply` : `rules.supplyLine` résolu, ou `null`.
//   - `counters` : FONCTION `() => pions posés sur la carte`.
//   - `sideOf` : `(counter) => clé de camp | null` (cf. HexMap.vue::
//     sideOfCounter).
//   - `isFighter`, `isAirborneEntry` : cf. lib/units.js et lib/setup.js —
//     qui occupe un hex, et qui est arrivé par les airs.
//   - `enemyZocSet` : `(counter) => Set("col,row")` (cf. lib/useAssisted.js).
//   - `edgeKinds` : `({ c, r }, { c, r }) => [natures]` (cf.
//     lib/useAssisted.js::edgeKinds) — TOUTES les natures de l'hexside.
//   - `hexOnMap` : `(col, row) => bool`.
import { computed } from 'vue'
import { hexId, parseHexId } from './calibration.js'
import { neighborsOf } from './hex.js'

// Étage de départ d'une ligne terrestre : elle n'a encore rien emprunté et
// passe donc où elle veut. Les étages suivants sont ceux que le module
// déclare (`ground.stages`, cf. `stageOfEdge`) — pour Arnhem, la piste puis
// la route —, et un parcours ne peut que monter, jamais redescendre.
const STAGE_FREE = 0

const keyOf = (col, row) => `${col},${row}`

export function useSupplyLine({
  assisted, supply = null, counters = () => [], sideOf = () => null,
  isFighter = () => true, isAirborneEntry = () => false,
  enemyZocSet = () => new Set(), edgeKinds = () => [], hexOnMap = () => true,
}) {
  /** La règle s'applique-t-elle dans ce module ? */
  const active = computed(() => !!assisted.value && !!supply)

  /** L'unité `unit` a-t-elle une ligne de communication à tracer ? Il lui
   *  faut être une vraie unité du camp concerné, et d'une faction que le
   *  module n'a pas mise à part (les Polonais d'Arnhem, qui n'ont pas
   *  d'arrières à eux). */
  function concerns(unit) {
    if (!active.value || !isFighter(unit)) return false
    if (sideOf(unit) !== supply.side) return false
    return !(supply.excludeFactions ?? []).includes(unit.faction)
  }

  /** L'étage auquel l'arête `kinds` fait passer la ligne. Les étages sont
   *  ceux du module, du moins contraignant au plus contraignant
   *  (`ground.stages` — pour Arnhem : piste, puis route) : on retient le plus
   *  élevé que l'arête porte. Une arête à la fois route et piste compte donc
   *  comme une route — la ligne y est bel et bien « connectée à une route ».
   *  Tout le reste (terrain nu, ruisseau, pont sans route) n'engage à rien. */
  function stageOfEdge(kinds) {
    const stages = supply.ground?.stages ?? []
    for (let index = stages.length - 1; index >= 0; index -= 1) {
      if (kinds.includes(stages[index])) return index + 1
    }
    return STAGE_FREE
  }

  /** L'hexside `from` -> `to` (`{ col, row }`) laisse-t-il passer une ligne ?
   *  Non s'il porte un cours d'eau (`blockingKinds`) que ne franchit aucun
   *  pont (`bridgeKinds`) — cf. l'en-tête pour les bacs et les ponts démolis. */
  function edgeAllows(from, to) {
    const kinds = edgeKinds({ c: from.col, r: from.row }, { c: to.col, r: to.row })
    if ((supply.bridgeKinds ?? []).some((kind) => kinds.includes(kind))) return true
    return !(supply.blockingKinds ?? []).some((kind) => kinds.includes(kind))
  }

  /** L'hex `hex` peut-il porter la ligne de `unit` ? Il doit être sur la
   *  carte, libre d'unité ennemie, et hors ZOC ennemie — à moins qu'une unité
   *  AMIE ne s'y trouve, auquel cas la ZOC y est annulée. */
  function hexAllows(unit, hex, zoc) {
    if (!hexOnMap(hex.col, hex.row)) return false
    let friendly = false
    for (const other of counters()) {
      if (!isFighter(other) || other.col !== hex.col || other.row !== hex.row) continue
      if (sideOf(other) === sideOf(unit)) friendly = true
      else return false                      // une unité ennemie coupe la ligne
    }
    return friendly || !zoc.has(keyOf(hex.col, hex.row))
  }

  /** Les hex SOURCES de `unit` : la zone de largage de sa division si elle
   *  est aéroportée (le marqueur qui porte son `division`, cf. arnhem.json),
   *  les hex déclarés par le module sinon. Liste vide quand il n'y en a
   *  aucune — une DZ retirée de la carte, par exemple. */
  function sourcesFor(unit) {
    if (isAirborneEntry(unit)) {
      // La DZ d'une division est le MARQUEUR posé sur la carte dont le `code`
      // est celui de la division de l'unité (cf. arnhem.json : "DZ 101" porte
      // le code "101", et chaque aéroporté porte sa `division`).
      if (unit.division == null) return []
      return counters()
        .filter((marker) => !isFighter(marker) && String(marker.code) === String(unit.division))
        .map((marker) => ({ col: marker.col, row: marker.row }))
    }
    return (supply.ground?.sources ?? []).map(parseHexId)
  }

  /** Portée maximale de la ligne, en nombre de pas : celle des aéroportés
   *  (7 à Arnhem), ou aucune limite pour les autres. */
  function rangeFor(unit) {
    return isAirborneEntry(unit) ? (supply.airborne?.range ?? Infinity) : Infinity
  }

  /** LA LIGNE DE COMMUNICATION de `unit` : la suite d'hex qui la relie à sa
   *  source, de son propre hex jusqu'à celle-ci, ou `null` si aucune ne peut
   *  être tracée.
   *
   *  Parcours en largeur sur des états `(hex, étage)` — deux dimensions, car
   *  un même hex peut être atteint libre (donc riche en possibilités) ou déjà
   *  tenu à la route (donc pauvre), et ces deux façons d'y être ne mènent pas
   *  aux mêmes suites. La largeur d'abord donne la ligne la PLUS COURTE, qui
   *  est aussi la plus lisible sur la carte.
   *
   *  @returns `{ hexes: [{ col, row }], source }` ou `null`. */
  function pathFor(unit) {
    if (!concerns(unit)) return null
    const sources = sourcesFor(unit)
    if (!sources.length) return null
    const goal = new Set(sources.map((source) => keyOf(source.col, source.row)))
    const start = { col: unit.col, row: unit.row }
    const zoc = enemyZocSet(unit)
    const limit = rangeFor(unit)
    // L'hex de l'unité elle-même ne se discute pas : elle y est.
    if (goal.has(keyOf(start.col, start.row))) return { hexes: [start], source: start }

    const seen = new Set([keyOf(start.col, start.row) + '@' + STAGE_FREE])
    let frontier = [{ hex: start, stage: STAGE_FREE, path: [start] }]
    for (let step = 0; step < limit && frontier.length; step += 1) {
      const next = []
      for (const state of frontier) {
        for (const neighbor of neighborsOf(state.hex.col, state.hex.row)) {
          if (!edgeAllows(state.hex, neighbor)) continue
          if (!hexAllows(unit, neighbor, zoc)) continue
          // L'étage ne peut que monter : une ligne déjà tenue à la route ne
          // repart pas à travers champs (cf. l'en-tête).
          const stage = stageOfEdge(edgeKinds({ c: state.hex.col, r: state.hex.row }, { c: neighbor.col, r: neighbor.row }))
          if (stage < state.stage) continue
          const path = [...state.path, neighbor]
          if (goal.has(keyOf(neighbor.col, neighbor.row))) return { hexes: path, source: neighbor }
          const mark = keyOf(neighbor.col, neighbor.row) + '@' + stage
          if (seen.has(mark)) continue
          seen.add(mark)
          next.push({ hex: neighbor, stage, path })
        }
      }
      frontier = next
    }
    return null
  }

  /** `unit` est-elle reliée à ses arrières ? */
  function hasSupply(unit) {
    return pathFor(unit) != null
  }

  /** Les hex de la ligne de `unit`, en clés "col,row" — pour le surlignage
   *  de la carte (cf. HexMap.vue). Ensemble vide s'il n'y a pas de ligne. */
  function pathKeys(unit) {
    const path = pathFor(unit)
    if (!path) return new Set()
    return new Set(path.hexes.map((hex) => keyOf(hex.col, hex.row)))
  }

  /** Les hex de la ligne, tels qu'imprimés ("0105"...) — pour le journal et
   *  les infobulles. */
  function pathLabels(unit) {
    const path = pathFor(unit)
    return path ? path.hexes.map((hex) => hexId(hex.col + 1, hex.row)) : []
  }

  return { active, concerns, pathFor, hasSupply, pathKeys, pathLabels }
}
