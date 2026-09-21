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
//     elle veut ; dès qu'elle EST SUR UNE PISTE, tout le reste doit suivre
//     une piste ou une route ; dès qu'elle EST SUR UNE ROUTE, tout le reste
//     doit suivre une route. La contrainte ne se relâche donc jamais — d'où
//     les "étages" du parcours ci-dessous (cf. `stageOfEdge`), qui ne peuvent
//     que monter à mesure qu'on s'éloigne de l'unité et se rapproche de
//     l'arrière.
//
//     L'hex de l'unité EST le premier hex de la ligne : une unité postée sur
//     une piste a donc déjà sa ligne "sur la piste" et ne peut plus couper à
//     travers champs, même au premier pas (cf. `stageOfHex`). Une unité
//     postée sur une route ne trace, elle, que par la route — c'est la même
//     règle, prise à son étage le plus haut ;
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

  /** Tout ce qu'un parcours a besoin de savoir de la carte, préparé UNE fois
   *  pour toutes : la ZOC ennemie et l'occupation des hex ne dépendent que du
   *  CAMP, jamais de l'unité qui trace. Les relire pion par pion à chaque hex
   *  visité — ce que faisait la première version — revenait à parcourir la
   *  centaine de pions des dizaines de milliers de fois.
   *
   *  `edges` mémorise en plus le verdict de chaque hexside déjà examiné : un
   *  même hexside est regardé depuis ses deux hex, et souvent par plusieurs
   *  parcours. */
  function contextFor(side, sample) {
    const friendly = new Set()
    const enemy = new Set()
    for (const other of counters()) {
      if (!isFighter(other)) continue
      const key = keyOf(other.col, other.row)
      if (sideOf(other) === side) friendly.add(key)
      else enemy.add(key)
    }
    return { zoc: enemyZocSet(sample), friendly, enemy, edges: new Map() }
  }

  /** L'étage auquel l'HEX `hex` tient la ligne qui s'y trouve : celui de la
   *  meilleure voie qui le dessert. Sert au premier hex de la ligne — celui
   *  de l'unité —, car une unité postée sur une piste y est déjà "sur la
   *  piste" et n'a pas à l'emprunter pour y être tenue.
   *
   *  Les hex suivants n'en ont pas besoin : on y entre forcément PAR une
   *  arête, dont l'étage dit déjà tout (cf. `stageOfEdge`). */
  function stageOfHex(hex) {
    let best = STAGE_FREE
    for (const neighbor of neighborsOf(hex.col, hex.row)) {
      const stage = stageOfEdge(edgeKinds({ c: hex.col, r: hex.row }, { c: neighbor.col, r: neighbor.row }))
      if (stage > best) best = stage
    }
    return best
  }

  /** L'hexside `from` -> `to` (`{ col, row }`) laisse-t-il passer une ligne ?
   *  Non s'il porte un cours d'eau (`blockingKinds`) que ne franchit aucun
   *  pont (`bridgeKinds`) — cf. l'en-tête pour les bacs et les ponts démolis. */
  function edgeAllows(context, from, to) {
    const key = keyOf(from.col, from.row) + '>' + keyOf(to.col, to.row)
    const known = context.edges.get(key)
    if (known !== undefined) return known
    const kinds = edgeKinds({ c: from.col, r: from.row }, { c: to.col, r: to.row })
    const allowed = (supply.bridgeKinds ?? []).some((kind) => kinds.includes(kind))
      || !(supply.blockingKinds ?? []).some((kind) => kinds.includes(kind))
    context.edges.set(key, allowed)
    return allowed
  }

  /** L'hex `hex` peut-il porter la ligne ? Il doit être sur la carte, libre
   *  d'unité ennemie, et hors ZOC ennemie — à moins qu'une unité AMIE ne s'y
   *  trouve, auquel cas la ZOC y est annulée. */
  function hexAllows(context, hex) {
    if (!hexOnMap(hex.col, hex.row)) return false
    const key = keyOf(hex.col, hex.row)
    if (context.enemy.has(key)) return false
    return context.friendly.has(key) || !context.zoc.has(key)
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
    const context = contextFor(sideOf(unit), unit)
    const limit = rangeFor(unit)
    // Les étages (piste, puis route) ne valent QUE pour les lignes
    // terrestres : c'est un avion qui ravitaille un aéroporté, et la route
    // qu'il survole ne l'engage à rien.
    const staged = !isAirborneEntry(unit)
    // L'hex de l'unité elle-même ne se discute pas : elle y est.
    if (goal.has(keyOf(start.col, start.row))) return { hexes: [start], source: start }

    // …mais il compte comme premier hex de la ligne : posée sur une piste,
    // l'unité y est déjà tenue (cf. `stageOfHex`).
    const first = staged ? stageOfHex(start) : STAGE_FREE
    const seen = new Set([keyOf(start.col, start.row) + '@' + first])
    let frontier = [{ hex: start, stage: first, path: [start] }]
    for (let step = 0; step < limit && frontier.length; step += 1) {
      const next = []
      for (const state of frontier) {
        for (const neighbor of neighborsOf(state.hex.col, state.hex.row)) {
          if (!edgeAllows(context, state.hex, neighbor)) continue
          if (!hexAllows(context, neighbor)) continue
          // L'étage ne peut que monter : une ligne déjà tenue à la route ne
          // repart pas à travers champs (cf. l'en-tête).
          let stage = STAGE_FREE
          if (staged) {
            stage = stageOfEdge(edgeKinds({ c: state.hex.col, r: state.hex.row }, { c: neighbor.col, r: neighbor.row }))
            if (stage < state.stage) continue
          }
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

  /** `unit` est-elle reliée à ses arrières ? Pour UNE unité : `unsuppliedIds`
   *  est bien plus rapide dès qu'il faut le savoir pour toute une armée. */
  function hasSupply(unit) {
    return pathFor(unit) != null
  }

  /** Tous les hex qu'une ligne peut atteindre EN PARTANT des `starts`, pour
   *  le camp `side`.
   *
   *  C'est le parcours de `pathFor` pris À L'ENVERS — depuis les arrières
   *  vers les unités, et non l'inverse —, ce qui permet de le faire UNE FOIS
   *  pour tout un camp au lieu d'une fois par unité. L'étage s'y lit donc en
   *  miroir : là où une ligne tracée depuis l'unité ne peut que se durcir
   *  (libre, puis piste, puis route), le même chemin remonté depuis la source
   *  ne peut que s'assouplir, d'où un état qui ne fait que DÉCROÎTRE. Sans
   *  étages (`staged` faux — le ravitaillement aérien), seule la distance
   *  compte.
   *
   *  @returns un Set de clés "col,row". */
  function reachFrom(starts, { context, staged, limit = Infinity }) {
    // Le parcours remonte depuis les arrières : il retient, pour chaque hex,
    // le plus HAUT étage par lequel une ligne peut en repartir vers la
    // source. Une unité qui s'y trouve est ravitaillée si l'étage de SON hex
    // (cf. `stageOfHex`) ne dépasse pas celui-là : c'est exactement la
    // condition du premier pas à l'aller — l'arête empruntée doit valoir au
    // moins ce que vaut l'hex de départ —, lue en miroir.
    const best = new Map()
    const reached = new Set()
    const seen = new Set()
    let frontier = []
    for (const start of starts) {
      if (!hexAllows(context, start)) continue
      const stage = staged ? Infinity : 0
      const key = keyOf(start.col, start.row)
      reached.add(key)
      // L'unité posée SUR la source est ravitaillée sans avoir à en partir.
      best.set(key, Infinity)
      seen.add(key + '@' + stage)
      frontier.push({ hex: start, stage })
    }
    for (let step = 0; step < limit && frontier.length; step += 1) {
      const next = []
      for (const state of frontier) {
        for (const neighbor of neighborsOf(state.hex.col, state.hex.row)) {
          if (!edgeAllows(context, state.hex, neighbor)) continue
          if (!hexAllows(context, neighbor)) continue
          let stage = 0
          if (staged) {
            stage = stageOfEdge(edgeKinds({ c: state.hex.col, r: state.hex.row }, { c: neighbor.col, r: neighbor.row }))
            if (stage > state.stage) continue   // la contrainte ne se relâche qu'en s'éloignant de la source
          }
          const key = keyOf(neighbor.col, neighbor.row)
          const mark = key + '@' + stage
          if (seen.has(mark)) continue
          seen.add(mark)
          reached.add(key)
          // L'étage offert à celui qui part d'ici : celui de l'arête par
          // laquelle la ligne le quittera. On garde le plus permissif.
          if (stage > (best.get(key) ?? -1)) best.set(key, stage)
          next.push({ hex: neighbor, stage })
        }
      }
      frontier = next
    }
    return { reached, best }
  }

  /** Les unités de `units` qui N'ONT PAS de ligne — ids en chaînes.
   *
   *  Une seule passe pour toute l'armée : un parcours depuis les arrières
   *  terrestres, un par zone de largage utile, et la ZOC ennemie calculée une
   *  fois (elle ne dépend que du camp). Là où interroger chaque unité
   *  séparément refait la carte autant de fois qu'il y a d'unités, ceci la
   *  parcourt quatre fois pour Arnhem, quel que soit le nombre de pions. */
  function unsuppliedIds(units) {
    const out = new Set()
    if (!active.value) return out
    const concerned = (units ?? []).filter(concerns)
    if (!concerned.length) return out
    const context = contextFor(supply.side, concerned[0])
    const ground = concerned.filter((unit) => !isAirborneEntry(unit))
    const airborne = concerned.filter(isAirborneEntry)

    if (ground.length) {
      const sources = (supply.ground?.sources ?? []).map(parseHexId)
      const { reached, best } = reachFrom(sources, { context, staged: true })
      for (const unit of ground) {
        const key = keyOf(unit.col, unit.row)
        // Ravitaillée si la ligne l'atteint ET si l'étage de son propre hex
        // ne lui interdit pas le premier pas : une unité sur une piste ne
        // peut pas partir à travers champs (cf. `stageOfHex`).
        if (!reached.has(key) || stageOfHex(unit) > (best.get(key) ?? -1)) out.add(String(unit.id))
      }
    }

    // Un parcours par division représentée sur la carte, pas par unité.
    const byDivision = new Map()
    for (const unit of airborne) {
      const division = String(unit.division ?? '')
      if (!byDivision.has(division)) byDivision.set(division, [])
      byDivision.get(division).push(unit)
    }
    for (const [division, members] of byDivision) {
      const zones = counters().filter((marker) => !isFighter(marker) && String(marker.code) === division)
        .map((marker) => ({ col: marker.col, row: marker.row }))
      const reached = zones.length
        ? reachFrom(zones, { context, staged: false, limit: supply.airborne?.range ?? Infinity }).reached
        : new Set()
      for (const unit of members) {
        if (!reached.has(keyOf(unit.col, unit.row))) out.add(String(unit.id))
      }
    }
    return out
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

  return { active, concerns, pathFor, hasSupply, unsuppliedIds, pathKeys, pathLabels }
}
