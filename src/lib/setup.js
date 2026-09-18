// ═══════════════════════════════════════════════════════════════════════════
// setup — notation `setup` des pions (hex d'entrée en jeu)
// ═══════════════════════════════════════════════════════════════════════════
//
// Chaque pion d'un module déclare où il entre en jeu (cf. README, "Anatomie
// d'un module") sous l'une de trois formes :
//   - "CCRR"       : cet hex précis (col/ligne imprimées, 1-based) ;
//   - "CCRR-CCRR"  : une plage de bord de carte — tous les hex "sur ou entre"
//                    les deux bornes, alignées sur une même ligne ou une même
//                    colonne (ex. renforts allemands d'Arnhem) ;
//   - "CCRR+adj"   : un LARGAGE — l'hex de référence ou l'un de ses 6 voisins
//                    (ex. chaque unité alliée d'Arnhem près de sa zone de
//                    largage). C'est ce suffixe, et lui seul, qui fait d'un
//                    pion un AÉROPORTÉ pour tout le moteur (phase Airborne,
//                    coût d'entrée, règles particulières du module...).
//
// Avant ce fichier, cette notation était reniflée en six endroits
// (`endsWith('+adj')`, `includes('-')`, `parseHexId` sur les 4 premiers
// caractères...) ; elle n'est plus analysée qu'ici. Coordonnées renvoyées au
// format interne (`col` 0-based, `row` 1-based — cf. lib/calibration.js).
import { parseHexId } from './calibration.js'
import { neighborsOf } from './hex.js'

const SETUP_RE = /^(\d{4})(?:-(\d{4})|(\+adj))?$/

/** `{ kind: 'hex', ref }`, `{ kind: 'range', ref, to }` ou `{ kind:
 *  'adjacent', ref }` — `null` si `setup` est absent ou mal formé. */
export function parseSetup(setup) {
  if (typeof setup !== 'string') return null
  const match = SETUP_RE.exec(setup.trim())
  if (!match) return null
  const ref = parseHexId(match[1])
  if (match[2]) return { kind: 'range', ref, to: parseHexId(match[2]) }
  if (match[3]) return { kind: 'adjacent', ref }
  return { kind: 'hex', ref }
}

/** Ce pion entre-t-il en jeu par LARGAGE (`setup` "+adj") ? */
export function isAirborneEntry(counter) {
  return parseSetup(counter?.setup)?.kind === 'adjacent'
}

/** Hex d'une plage "CCRR-CCRR" (`parsed.kind === 'range'`), sur la carte
 *  (`hexOnMap(col, row)`), dans l'ordre ; à défaut d'hex valide, la borne
 *  de départ seule. Pour toute autre forme : l'hex de référence. */
export function rangeCells(parsed, hexOnMap) {
  if (!parsed) return []
  if (parsed.kind !== 'range') return [parsed.ref]
  const { ref: from, to } = parsed
  const cells = []
  if (from.row === to.row) {
    const [lo, hi] = from.col <= to.col ? [from.col, to.col] : [to.col, from.col]
    for (let col = lo; col <= hi; col++) cells.push({ col, row: from.row })
  } else {
    const [lo, hi] = from.row <= to.row ? [from.row, to.row] : [to.row, from.row]
    for (let row = lo; row <= hi; row++) cells.push({ col: from.col, row })
  }
  const valid = cells.filter((cell) => hexOnMap(cell.col, cell.row))
  return valid.length ? valid : [from]
}

/** Hex candidats au PLACEMENT AUTOMATIQUE de départ (cf. HexMap.vue::
 *  buildInitialCounters) : toute la plage pour un "range", sinon l'hex de
 *  référence (un largage automatique se pose sur sa zone de largage). */
export function deploymentCells(parsed, hexOnMap) {
  return rangeCells(parsed, hexOnMap)
}

/** Hex d'atterrissage d'un largage (`parsed.kind === 'adjacent'`) : l'hex
 *  de référence puis ses 6 voisins, sur la carte. Vide pour une autre forme. */
export function landingCells(parsed, hexOnMap) {
  if (parsed?.kind !== 'adjacent') return []
  const { ref } = parsed
  return [ref, ...neighborsOf(ref.col, ref.row).filter((neighbor) => hexOnMap(neighbor.col, neighbor.row))]
}
