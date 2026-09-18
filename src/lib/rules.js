// ═══════════════════════════════════════════════════════════════════════════
// rules — paramètres des règles GÉNÉRIQUES, déclarés par le module
// ═══════════════════════════════════════════════════════════════════════════
//
// Le moteur applique les mêmes règles à tous les modules (véhicules et
// terrains interdits, empilement...), mais LEURS VALEURS sont celles de la
// boîte de jeu : elles viennent de `module.rules` (cf. public/modules/*.json,
// README "Anatomie d'un module"). Ce fichier les lit, les assainit et
// complète ce qui manque par des défauts raisonnables — un module sans
// `rules` joue donc exactement comme avant leur introduction.
//
// Les clés que le moteur ne connaît pas sont conservées telles quelles : ce
// sont celles des RÈGLES PARTICULIÈRES d'un module (cf. lib/moduleRules.js —
// ex. `airborneArrivalSpentMp` lue par lib/useArnhem.js), qui n'ont pas
// besoin d'être listées ici pour être déclarées dans le JSON.

export const DEFAULT_RULES = Object.freeze({
  // Types d'unité (`counter.type`) motorisées/blindées, auxquelles le terrain
  // accidenté est interdit et qui ne franchissent ni ruisseau à gué ni
  // rivière par bac (cf. lib/useAssisted.js::canEnterTerrain).
  vehicleTypes: ['armor', 'reconnaissance', 'mechanized', 'self-propelled arty'],
  // Types de terrain (clés de `terrain.grid`) fermés à ces véhicules, sauf
  // par une route, une piste ou un pont.
  impassableForVehicles: ['rough', 'broken', 'woods'],
  // Nombre maximal d'unités AMIES par hex à la fin d'un mouvement (cf.
  // lib/useAssisted.js, section "Empilement").
  stackingLimit: 1,
  // Zones de contrôle (cf. lib/useAssisted.js, section "ZOC") :
  //   - `lockIfStarting` : une unité qui COMMENCE son mouvement en ZOC
  //     ennemie ne peut pas bouger ;
  //   - `stopOnEntry` : une unité qui ENTRE en ZOC ennemie doit s'y arrêter ;
  //   - `blocksRetreat` : une retraite ne peut pas entrer en ZOC ennemie.
  zoc: Object.freeze({ lockIfStarting: true, stopOnEntry: true, blocksRetreat: true }),
  // Congestion des hex d'entrée de renfort (cf. lib/useAssisted.js, section
  // "Congestion") : 'multiply' — la N-ième entrée par un même hex, le même
  // tour, coûte N fois le coût de base ; 'none' — toujours le coût de base.
  entryCongestion: 'multiply',
})

export const ENTRY_CONGESTION_MODES = ['multiply', 'none']

// Structure du tour d'un camp (`module.turnStructure`, cf. lib/useAssisted.js,
// section "Phases") : quelles phases, en plus du Mouvement, il comporte.
export const DEFAULT_TURN_STRUCTURE = Object.freeze({
  // Phase Airborne AVANT le Mouvement, pour un camp qui a des aéroportés à
  // poser ; sans elle, les aéroportés se posent comme les autres renforts.
  airbornePhase: true,
  // Phase Combat APRÈS le Mouvement ; sans elle, aucun combat.
  combatPhase: true,
  // Phase "Fin de tour" après le dernier camp de l'ordre, avant le tour suivant.
  endOfTurnPhase: true,
})

/** `module.turnStructure` → structure complète (booléens, défauts appliqués). */
export function resolveTurnStructure(raw) {
  const structure = raw && typeof raw === 'object' ? raw : {}
  const flag = (key) => (typeof structure[key] === 'boolean' ? structure[key] : DEFAULT_TURN_STRUCTURE[key])
  return { airbornePhase: flag('airbornePhase'), combatPhase: flag('combatPhase'), endOfTurnPhase: flag('endOfTurnPhase') }
}

/** `module.rules` (objet libre, éventuellement absent) → règles prêtes à
 *  l'emploi : listes converties en `Set`, entiers vérifiés, défauts
 *  appliqués, clés inconnues conservées. */
export function resolveRules(raw) {
  const rules = raw && typeof raw === 'object' ? raw : {}
  const stringList = (value, fallback) =>
    (Array.isArray(value) ? value.filter((item) => typeof item === 'string') : fallback)
  const positiveInt = (value, fallback) => (Number.isInteger(value) && value >= 1 ? value : fallback)
  const zoc = rules.zoc && typeof rules.zoc === 'object' ? rules.zoc : {}
  const zocFlag = (key) => (typeof zoc[key] === 'boolean' ? zoc[key] : DEFAULT_RULES.zoc[key])
  return {
    ...rules,
    vehicleTypes: new Set(stringList(rules.vehicleTypes, DEFAULT_RULES.vehicleTypes)),
    impassableForVehicles: new Set(stringList(rules.impassableForVehicles, DEFAULT_RULES.impassableForVehicles)),
    stackingLimit: positiveInt(rules.stackingLimit, DEFAULT_RULES.stackingLimit),
    zoc: { lockIfStarting: zocFlag('lockIfStarting'), stopOnEntry: zocFlag('stopOnEntry'), blocksRetreat: zocFlag('blocksRetreat') },
    entryCongestion: ENTRY_CONGESTION_MODES.includes(rules.entryCongestion) ? rules.entryCongestion : DEFAULT_RULES.entryCongestion,
  }
}
