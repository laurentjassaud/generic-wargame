// ═══════════════════════════════════════════════════════════════════════════
// useCombat — résolution des combats du mode "Assisté"
// ═══════════════════════════════════════════════════════════════════════════
//
// Ce composable est le SEUL endroit où doit vivre la logique de COMBAT du
// mode Assisté — au même titre que lib/useAssisted.js centralise le
// mouvement/les tours et lib/useDebug.js les affichages de debug. Il est
// séparé de useAssisted.js (déjà volumineux) parce que le combat forme un
// bloc autonome : il ne partage avec le mouvement que deux notions, qui lui
// sont donc PASSÉES en paramètres (`canControl` pour "à qui est ce pion" et
// `combatEdgeKind` pour la nature d'un hexside) — cf. useAssisted.js, qui
// les exporte pour lui.
//
// Déroulé d'un combat, tel que demandé (cf. HexMap.vue, qui ne fait que
// brancher les clics et les surlignages dessus) :
//
//   1. En PHASE COMBAT (cf. useAssisted.js::phase — 1 = Combat), le joueur
//      dont c'est le tour clique sur une unité ENNEMIE : ça ouvre un combat.
//      L'HEX de cette unité devient un HEX CIBLE, surligné en ORANGE, et la
//      modale de combat s'ouvre (cf. CombatModal.vue).
//   2. Il peut cliquer sur d'AUTRES unités ennemies pour ajouter leur hex
//      aux cibles : un même combat peut viser PLUSIEURS hex. RÈGLE STRICTE
//      (choix validé) : chaque ATTAQUANT doit être adjacent à TOUS les hex
//      cibles. Un hex n'est donc accepté comme cible que s'il reste au moins
//      une unité AMIE au contact de TOUTES les cibles, lui compris (cf.
//      `canTargetSet`). Recliquer sur un hex cible le retire ; en retirer le
//      dernier annule le combat.
//   3. Il clique sur ses PROPRES unités ADJACENTES à TOUS les hex cibles
//      pour les désigner attaquantes : leur hex passe en JAUNE et leur
//      facteur d'attaque s'ajoute au total. Recliquer dessus les retire.
//   4. Le bouton "Combattre" résout : différentiel = somme des facteurs
//      d'ATTAQUE − somme des facteurs de DÉFENSE de TOUTES les unités
//      ennemies des hex cibles (un hex empilé défend avec tous ses pions),
//      croisé avec la ligne de terrain applicable sur la table de combat
//      (CRT, cf. plus bas), puis un dé à 6 faces donne le résultat final.
//      Il n'est actif qu'avec au moins un attaquant désigné (cf.
//      `canResolve`) — la règle stricte garantit alors d'elle-même que
//      chaque hex cible est bien au contact d'un attaquant.
//   5. Une fois le dé lancé, le combat est FIGÉ (plus d'ajout/retrait de
//      cible ni d'attaquant) : toutes les unités PARTICIPANTES — attaquants
//      ET défenseurs — ont "combattu" (cf. `foughtIds`). Elles apparaissent
//      désaturées (cf. Counter.vue::spent) et ne peuvent plus être engagées
//      dans un autre combat jusqu'à la PROCHAINE PHASE. La modale se ferme
//      d'elle-même peu après avoir affiché le résultat (cf. CombatModal.vue).
//   6. La croix de la modale annule tout (surlignages et modale
//      disparaissent) — sans rien marquer si le dé n'a pas été lancé.
//
// NOTE IMPORTANTE sur ce qu'il ne fait PAS (encore) : le résultat obtenu
// (retraite, élimination) est AFFICHÉ, jamais APPLIQUÉ automatiquement —
// aucun pion n'est déplacé ni retiré par ce composable. C'est volontaire :
// la demande s'arrête à "on lance un dé, on affiche le dé et le résultat".
//
// Paramètres reçus :
//   - `assisted` : ref/computed booléen — le combat n'existe qu'en mode
//     Assisté (en mode Libre, tout ce fichier reste inerte).
//   - `phase` : computed de la phase courante (cf. useAssisted.js::phase —
//     0 Mouvement, 1 Combat, 2 Fin de tour, `null` hors mode Assisté). Seule
//     la phase Combat autorise l'ouverture d'un combat.
//   - `counters` : ref/computed du tableau des pions POSÉS sur la carte (cf.
//     HexMap.vue::counters) — sert à retrouver défenseur et attaquants à
//     partir de leur seul `id` (mémorisé ici), pour que ce composable ne
//     garde jamais une COPIE périmée d'un pion qui aurait bougé entre-temps.
//   - `canControl` : fonction `(pion) => bool` (cf. useAssisted.js::canControl)
//     — "le camp dont c'est le tour contrôle-t-il ce pion ?". C'est elle, et
//     elle seule, qui distingue ici un défenseur (pion NON contrôlé, donc
//     ennemi du joueur actif) d'un attaquant possible (pion contrôlé) — ou,
//     pour la règle des cibles multiples, une unité "amie".
//   - `terrain` : `module.terrain` (cf. arnhem.json) — seuls `grid` (type de
//     terrain de chaque hex) et `types` (leur libellé) servent ici, pour
//     choisir la LIGNE de la table de combat.
//   - `combatEdgeKind` : fonction `(from, h) => 'bridge' | 'river' | 'stream'
//     | null` (cf. useAssisted.js::combatEdgeKind) — nature de l'hexside
//     franchi par un attaquant, qui peut soit INTERDIRE l'attaque (rivière
//     sans pont), soit remplacer la ligne de terrain (pont/ruisseau).
import { computed, ref, watch } from 'vue'
import { hexId } from './calibration.js'
import { neighborsOf } from './hex.js'

// --- Table de combat (CRT, cf. images/combat-chart.png, règle [7.61]) -------
//
// La table croise un DIFFÉRENTIEL de combat (force d'attaque − force de
// défense) avec un TERRAIN, pour donner une COLONNE ; le jet de dé (1-6)
// donne ensuite la ligne, et leur croisement le résultat.
//
// Lecture de la table imprimée : les 4 lignes de terrain sont alignées à
// GAUCHE sur les 12 colonnes de résultats, et sont de plus en plus courtes
// à mesure que le terrain protège le défenseur. Concrètement, chaque ligne
// de terrain est la ligne "Clear, Mixed" DÉCALÉE de N colonnes vers la
// gauche — c'est ce décalage (`shift` ci-dessous) qui modélise l'avantage
// défensif du terrain : à différentiel égal, un défenseur en Rough envoie
// l'attaquant 3 colonnes plus à gauche (résultats bien plus mauvais pour
// lui) qu'un défenseur en terrain dégagé.
//
//   Clear, Mixed                  : —7  —6,5 —4,3  —2  —1   0  +1 +2,3 +4,5 +6-8 +9-11 +12   (shift 0, 12 colonnes)
//   Grove, Bridge                 : —5  —4,3  —2  —1   0  +1 +2,3 +4,5 +6-8 +9-11 +12        (shift 1, 11 colonnes)
//   Broken, Town, Woods, Stream   : —3   —2  —1   0  +1 +2,3 +4,5 +6-8 +9-11 +12             (shift 2, 10 colonnes)
//   Rough                         : —2   —1   0  +1 +2,3 +4,5 +6-8 +9-11 +12                 (shift 3,  9 colonnes)
//
// Les deux règles imprimées sous la table en découlent directement :
//  - "Attacks at less than the lowest differential are resolved at the
//    lowest differential" -> la colonne 1 de CHAQUE ligne absorbe tout ce
//    qui est en dessous d'elle (d'où le `Math.max(1, ...)` plus bas) ;
//  - "Attacks at greater than +12 are resolved as +12 attacks" -> la
//    dernière colonne absorbe tout le reste (d'où le plafond à 12 dans
//    `clearColumn`, qui devient 12 − shift après décalage).

/** Colonne de la ligne de référence "Clear, Mixed" (1 à 12) pour un
 *  différentiel donné — les plages sont celles imprimées sur la table. Les
 *  autres lignes de terrain s'en déduisent par simple décalage (cf.
 *  `combatColumn`). */
function clearColumn(diff) {
  if (diff <= -7) return 1
  if (diff <= -5) return 2 // —6,5
  if (diff <= -3) return 3 // —4,3
  if (diff === -2) return 4
  if (diff === -1) return 5
  if (diff === 0) return 6
  if (diff === 1) return 7
  if (diff <= 3) return 8 // +2,3
  if (diff <= 5) return 9 // +4,5
  if (diff <= 8) return 10 // +6-8
  if (diff <= 11) return 11 // +9-11
  return 12
}

// Étiquettes de différentiel des 12 colonnes, telles qu'imprimées sur la
// ligne "Clear, Mixed" — réutilisées pour afficher la mini-table dans la
// modale (cf. `crtRows`).
const COLUMN_LABELS = ['—7', '—6,5', '—4,3', '—2', '—1', '0', '+1', '+2,3', '+4,5', '+6-8', '+9-11', '+12']

// Étiquette de la 1re colonne d'une ligne, par `shift` : cette colonne-là
// absorbant TOUT ce qui est en dessous d'elle, la table n'imprime que sa
// borne HAUTE ("—3" pour Broken, et non "—4,3" comme la colonne équivalente
// de Clear, qui a elle une vraie borne basse).
const FIRST_COLUMN_LABELS = ['—7', '—5', '—3', '—2']

// Les 4 lignes de terrain de la table. `terrains` liste les clés de
// `terrain.grid` (cf. arnhem.json) qui s'y rattachent — "city" est résolu
// comme "Town" (choix validé : une ville est la version dense d'un town, et
// la table n'a pas de ligne City propre), et "grove" n'existe dans aucun
// module à ce jour : sa ligne ne sert donc en pratique qu'aux hexsides de
// PONT (cf. `combatTerrainRow`).
const CRT_ROWS = [
  { key: 'rough', label: 'Rough', shift: 3, terrains: ['rough'] },
  { key: 'broken', label: 'Broken, Town, Woods, Stream', shift: 2, terrains: ['broken', 'town', 'woods', 'city'] },
  { key: 'grove', label: 'Grove, Bridge', shift: 1, terrains: ['grove'] },
  { key: 'clear', label: 'Clear, Mixed', shift: 0, terrains: ['mixed', 'clear', 'road', 'trail'] },
]

// Résultats de la table : `CRT_RESULTS[dé - 1][colonne - 1]`. Les colonnes
// au-delà de la longueur d'une ligne de terrain ne sont jamais atteintes
// (cf. `combatColumn`, qui plafonne à 12 − shift).
const CRT_RESULTS = [
  ['A1', 'A1', 'A1', 'Br', 'D1', 'D2', 'D2', 'D2', 'D2', 'D3', 'D4', 'De'], // dé 1
  ['A1', 'A1', 'A1', 'A1', 'Br', 'D1', 'D2', 'D2', 'D2', 'D2', 'D3', 'D4'], // dé 2
  ['A1', 'A1', 'A1', 'A1', 'A1', 'Br', 'D1', 'D2', 'D2', 'D2', 'D2', 'D3'], // dé 3
  ['A2', 'A1', 'A1', 'A1', 'A1', 'Br', 'Br', 'D1', 'D2', 'D2', 'D2', 'D2'], // dé 4
  ['A2', 'A2', 'A1', 'A1', 'A1', 'A1', 'Br', 'Br', 'D1', 'D2', 'D2', 'D2'], // dé 5
  ['Ae', 'Ae', 'A2', 'A1', 'A1', 'A1', 'A1', 'Br', 'Br', 'Br', 'D2', 'D2'], // dé 6
]

// Signification de chaque résultat (cf. "EXPLANATION OF RESULTS" sous la
// table) — affichée en toutes lettres dans la modale, le code du résultat
// seul ("Br", "D3"...) étant illisible pour qui ne connaît pas la table.
const RESULT_LABELS = {
  Ae: 'Attaquant éliminé',
  A1: "L'attaquant recule d'1 hex",
  A2: "L'attaquant recule de 2 hex",
  Br: "Attaquant et défenseur reculent d'1 hex (défenseur en premier)",
  D1: "Le défenseur recule d'1 hex",
  D2: 'Le défenseur recule de 2 hex',
  D3: 'Le défenseur recule de 3 hex',
  D4: 'Le défenseur recule de 4 hex',
  De: 'Défenseur éliminé',
}

/** Clé d'un hex ("col,row", en coordonnées internes 0-based) — sert à
 *  mémoriser les hex cibles et à comparer deux positions sans ambiguïté. */
const keyOf = (col, row) => `${col},${row}`

/** `a` et `b` (tous deux `{ col, row }`) sont-ils voisins immédiats ? */
function isAdjacent(a, b) {
  return neighborsOf(a.col, a.row).some((n) => n.col === b.col && n.row === b.row)
}

export function useCombat(assisted, phase, counters, canControl, terrain, combatEdgeKind) {
  // Hex CIBLES du combat en cours, dans l'ordre où ils ont été désignés —
  // chacun `{ col, row }`. On mémorise des HEX et non des pions : c'est l'hex
  // qu'on attaque, et TOUTES les unités ennemies qui s'y trouvent défendent
  // ensemble (cf. `defenders`). Tableau vide = aucun combat en cours, c'est
  // LE drapeau qui pilote à la fois la modale et les surlignages orange/jaune
  // de la carte.
  const targetHexes = ref([])

  // Attaquants, mémorisés par leur seul `id` (cf. `counters` dans l'en-tête :
  // on re-résout le pion à chaque lecture plutôt que d'en garder une copie).
  const attackerIds = ref(new Set())

  // Unités qui ont DÉJÀ COMBATTU pendant la phase en cours (attaquants et
  // défenseurs d'un combat dont le dé a été lancé, cf. `resolveCombat`) —
  // leurs `id`. Une telle unité ne peut plus attaquer ni être prise pour
  // cible, et s'affiche désaturée (cf. HexMap.vue -> Counter.vue::spent).
  const foughtIds = ref(new Set())

  /** L'unité `c` a-t-elle déjà combattu pendant cette phase ? */
  const hasFought = (c) => !!c && foughtIds.value.has(c.id)

  // Changement de phase (ou de tour, ou sortie du mode Assisté — `phase`
  // passe alors à `null`) : on repart de zéro. Les unités ayant combattu
  // redeviennent normales, et un combat laissé ouvert est abandonné (il n'a
  // de sens que dans la phase Combat où il a été composé).
  //
  // `flush: 'sync'` (exécution immédiate, pas au prochain rendu) : lors du
  // rejeu d'un journal (cf. HexMap.vue::fastForwardReplay), l'entrée "phase
  // Combat" est suivie, dans le même élan, des entrées "combat" qui marquent
  // les unités ayant combattu (cf. `markFought`). Un watcher différé les
  // aurait effacées juste après coup.
  watch(phase, () => {
    foughtIds.value = new Set()
    cancelCombat()
  }, { flush: 'sync' })

  /** Rejeu du journal : marque comme "ayant combattu" les unités `ids` (lus
   *  dans une entrée `combat`, cf. HexMap.vue::onCombatFight) — pour qu'une
   *  partie rechargée en pleine phase Combat retrouve ses unités désaturées
   *  et ne puisse pas refaire un combat déjà résolu. */
  function markFought(ids) {
    if (!ids?.length) return
    foughtIds.value = new Set([...foughtIds.value, ...ids])
  }

  // Résultat du dernier jet : `{ die, column, rowKey, rowLabel, rowReason,
  // diff, result, resultLabel }`, ou `null` tant que "Combattre" n'a pas été
  // cliqué. Remis à `null` dès que la composition du combat change
  // (attaquant ajouté/retiré), pour ne jamais afficher un résultat qui ne
  // correspondrait plus aux forces affichées juste au-dessus de lui.
  const result = ref(null)

  /** Seules les vraies unités combattent — ni les marqueurs (DZ...), ni les
   *  pions de soutien (ressource commune sans camp, cf. SupportTracker.vue). */
  function isFighter(c) {
    return !!c && c.type !== 'marker' && c.kind !== 'support'
  }

  const combatActive = computed(() => targetHexes.value.length > 0)

  const targetKeys = computed(() => new Set(targetHexes.value.map((t) => keyOf(t.col, t.row))))

  /** Numéros imprimés des hex cibles ("0512"...), pour la modale et le
   *  journal — même convention que partout ailleurs (`hexId(col + 1, row)`). */
  const targetHexLabels = computed(() => targetHexes.value.map((t) => hexId(t.col + 1, t.row)))

  /** DÉFENSEURS : toutes les unités ENNEMIES (non contrôlées par le camp
   *  actif) présentes dans l'un des hex cibles. Recalculé à chaque lecture
   *  depuis `counters` : un hex empilé défend avec TOUS ses pions, et leurs
   *  facteurs de défense s'additionnent (cf. `defenseStrength`). */
  const defenders = computed(() =>
    counters.value.filter((c) => isFighter(c) && !canControl(c) && targetKeys.value.has(keyOf(c.col, c.row)))
  )

  const attackers = computed(() => counters.value.filter((c) => attackerIds.value.has(c.id)))

  /** Le combat est-il possible en ce moment ? Mode Assisté ET phase Combat
   *  (cf. useAssisted.js::phase, 1 = Combat) — en phase Mouvement ou Fin de
   *  tour, un clic sur un pion ennemi ne doit rien déclencher du tout. */
  const combatAllowed = computed(() => assisted.value && phase.value === 1)

  /** L'unité `c` peut-elle attaquer l'hex `t` (`{ col, row }`) ? Il lui faut :
   *   1. être une vraie unité du camp actif (cf. `isFighter`/`canControl`) ;
   *   2. être ADJACENTE à `t` ;
   *   3. ne pas l'attaquer à travers un hexside de RIVIÈRE sans pont —
   *      choix de règle validé : une rivière sans pont coupe l'attaque comme
   *      elle coupe déjà la ZOC et le mouvement (cf.
   *      useAssisted.js::riverBlocksZoc/canEnterTerrain).
   *   4. ne pas avoir déjà combattu pendant cette phase (cf. `hasFought`).
   *  C'est la brique commune aux deux règles d'adjacence du combat : celle
   *  des CIBLES (`canTargetSet`) et celle des ATTAQUANTS (`canBeAttacker`). */
  function canAttackHex(c, t) {
    if (!isFighter(c) || !canControl(c) || hasFought(c)) return false
    if (!isAdjacent(c, t)) return false
    return combatEdgeKind({ c: c.col, r: c.row }, { c: t.col, r: t.row }) !== 'river'
  }

  /** L'unité `c` peut-elle attaquer TOUS les hex de `list` à la fois ?
   *  C'est la RÈGLE STRICTE du combat multi-hex (cf. l'en-tête) : un
   *  attaquant doit être au contact de CHAQUE hex cible, pas d'un seul. */
  function canAttackAll(c, list) {
    return list.every((t) => canAttackHex(c, t))
  }

  /** L'ensemble d'hex `list` forme-t-il un groupe de cibles valide ? Oui s'il
   *  existe AU MOINS UNE unité amie capable d'attaquer tous ces hex à la fois
   *  (cf. `canAttackAll`, rivière comprise : une amie séparée d'un des hex
   *  par une rivière sans pont ne compte pas). La règle vaut dès la PREMIÈRE
   *  cible : on n'ouvre pas un combat contre un hex que personne ne peut
   *  atteindre. */
  function canTargetSet(list) {
    return counters.value.some((c) => canAttackAll(c, list))
  }

  /** `c` est-il une unité ennemie qu'on peut viser (pour ouvrir un combat ou
   *  ajouter son hex aux cibles) ? Il faut :
   *   - qu'aucune unité ennemie de son hex n'ait déjà combattu pendant cette
   *     phase (un hex déjà attaqué ne peut pas l'être une seconde fois) ;
   *   - que les cibles actuelles PLUS son hex restent un groupe valide (cf.
   *     `canTargetSet`). */
  function canBeTarget(c) {
    if (!combatAllowed.value || !isFighter(c) || canControl(c)) return false
    const alreadyFought = counters.value.some((o) =>
      o.col === c.col && o.row === c.row && isFighter(o) && !canControl(o) && hasFought(o))
    if (alreadyFought) return false
    return canTargetSet([...targetHexes.value, { col: c.col, row: c.row }])
  }

  /** `c` peut-il être désigné attaquant ? RÈGLE STRICTE : il doit pouvoir
   *  attaquer TOUS les hex cibles (cf. `canAttackAll`). */
  function canBeAttacker(c) {
    return canAttackAll(c, targetHexes.value)
  }

  /** Ne garde, parmi les attaquants désignés, que ceux qui respectent encore
   *  la règle stricte après un changement des cibles. */
  function pruneAttackers() {
    attackerIds.value = new Set(attackers.value.filter(canBeAttacker).map((a) => a.id))
  }

  /** Clic sur une unité ENNEMIE `c` en phase Combat. Son hex :
   *   - est déjà une cible -> il est RETIRÉ des cibles (et le combat est
   *     annulé si c'était la dernière) ;
   *   - sinon, s'il respecte la règle d'adjacence (cf. `canBeTarget`) -> il
   *     est AJOUTÉ aux cibles (ouvrant le combat si aucun n'était en cours).
   *     Les attaquants déjà désignés qui ne touchent PAS ce nouvel hex sont
   *     alors retirés du combat (règle stricte) — ça reste visible dans la
   *     modale et sur la carte (leur hex n'est plus jaune).
   *  Renvoie `false` si le clic ne concerne pas le combat (unité amie, hex
   *  hors de portée...), pour laisser l'appelant (HexMap.vue) le traiter. */
  function toggleTarget(c) {
    if (!combatAllowed.value || !isFighter(c) || canControl(c)) return false
    // Combat déjà résolu (dé lancé, modale en train de se fermer) : il est
    // figé, le clic est "consommé" sans rien changer.
    if (result.value) return true
    if (targetKeys.value.has(keyOf(c.col, c.row))) return removeTargetHex(c.col, c.row)
    if (!canBeTarget(c)) return false
    targetHexes.value = [...targetHexes.value, { col: c.col, row: c.row }]
    pruneAttackers()
    result.value = null
    return true
  }

  /** Retire l'hex (`col`, `row`) des cibles ; plus aucune cible = combat
   *  annulé. Les attaquants restent tous valides (une contrainte de moins),
   *  mais tout jet affiché est effacé : les forces viennent de changer. */
  function removeTargetHex(col, row) {
    if (!targetKeys.value.has(keyOf(col, row))) return false
    if (result.value) return true // combat résolu : figé (cf. `toggleTarget`)
    targetHexes.value = targetHexes.value.filter((t) => t.col !== col || t.row !== row)
    if (targetHexes.value.length === 0) { cancelCombat(); return true }
    result.value = null
    return true
  }

  /** Ferme le combat en cours (croix de la modale, ou retrait de la dernière
   *  cible) — surlignages et modale disparaissent avec lui, tous dérivés de
   *  `targetHexes`. */
  function cancelCombat() {
    targetHexes.value = []
    attackerIds.value = new Set()
    result.value = null
  }

  /** Ajoute `c` aux attaquants, ou l'en retire s'il y était déjà (recliquer
   *  dessus le désélectionne). Impossible une fois le combat résolu (dé
   *  lancé) : il est figé. */
  function toggleAttacker(c) {
    if (!combatActive.value || !c || result.value) return false
    const next = new Set(attackerIds.value)
    if (next.has(c.id)) next.delete(c.id)
    else if (canBeAttacker(c)) next.add(c.id)
    else return false
    attackerIds.value = next
    result.value = null
    return true
  }

  // Surlignages de la carte (cf. HexMap.vue) : les hex cibles en orange,
  // ceux des attaquants désignés en jaune.
  const isCombatTargetHex = (h) => targetKeys.value.has(keyOf(h.c, h.r))
  const isCombatAttackerHex = (h) => attackers.value.some((a) => a.col === h.c && a.row === h.r)

  // Forces en présence. `atk`/`def` viennent des données du module (cf.
  // arnhem.json) ; le `?? 0` couvre un pion qui n'en déclarerait pas. La
  // défense est la SOMME des facteurs de tous les défenseurs, tous hex cibles
  // confondus (cf. `defenders`).
  const attackStrength = computed(() => attackers.value.reduce((sum, a) => sum + (a.atk ?? 0), 0))
  const defenseStrength = computed(() => defenders.value.reduce((sum, d) => sum + (d.def ?? 0), 0))
  const differential = computed(() => attackStrength.value - defenseStrength.value)

  /** COMBATS OBLIGATOIRES EN ATTENTE — règle demandée : on ne peut pas
   *  quitter la phase Combat (vers "Fin de tour" ou "Autre joueur", cf.
   *  HexMap.vue::onPhaseNext) tant qu'il reste une unité du camp actif et
   *  une unité ennemie ADJACENTES qui n'ont, ni l'une ni l'autre, combattu
   *  pendant cette phase (cf. `hasFought`).
   *
   *  Pourquoi "ni l'une ni l'autre" : c'est la seule lecture qui ne peut
   *  jamais bloquer la partie. Un hex ne pouvant pas être attaqué deux fois,
   *  exiger aussi qu'un défenseur déjà attaqué attaque/soit attaqué à nouveau
   *  rendrait parfois la phase impossible à terminer. Ici, chaque paire
   *  listée peut toujours être soldée : l'unité amie attaque l'hex ennemi.
   *
   *  Ne comptent pas : une paire séparée par une rivière sans pont (aucune
   *  attaque possible entre elles, cf. `canAttackHex`), les marqueurs et
   *  pions de soutien (cf. `isFighter`). Liste vide hors phase Combat.
   *  Chaque entrée : `{ key, friendly, friendlyHex, enemy, enemyHex }` (noms
   *  et numéros d'hex imprimés), pour la modale d'avertissement. */
  const pendingEngagements = computed(() => {
    if (!combatAllowed.value) return []
    const list = []
    const enemies = counters.value.filter((e) => isFighter(e) && !canControl(e) && !hasFought(e))
    for (const e of enemies) {
      for (const a of counters.value) {
        if (!canAttackHex(a, e)) continue
        list.push({
          key: `${a.id}-${e.id}`,
          friendly: a.name,
          friendlyHex: hexId(a.col + 1, a.row),
          enemy: e.name,
          enemyHex: hexId(e.col + 1, e.row),
        })
      }
    }
    return list
  })

  /** Le combat peut-il être résolu ? Il suffit d'au moins un attaquant : la
   *  règle stricte (cf. `canBeAttacker`/`pruneAttackers`) garantit que tout
   *  attaquant désigné touche CHAQUE hex cible. */
  const canResolve = computed(() => combatActive.value && attackers.value.length > 0)

  /** Ligne de la table pour UN hex cible `t`, et pourquoi :
   *   - si TOUS les attaquants au contact de cet hex franchissent un hexside
   *     de MÊME nature (tous par un pont, ou tous par un ruisseau), c'est cet
   *     HEXSIDE qui fait foi — ligne "Grove, Bridge" pour un pont, "Broken,
   *     Town, Woods, Stream" pour un ruisseau ;
   *   - sinon (ou tant qu'aucun attaquant n'est à son contact), c'est le
   *     TERRAIN DE L'HEX.
   *  Un hexside franchi par une route/piste n'est pas un obstacle et renvoie
   *  `null` (cf. useAssisted.js::combatEdgeKind) : il ne déclenche donc
   *  jamais de substitution, la règle retombe sur le terrain de l'hex. */
  function rowForTargetHex(t) {
    const adjacent = attackers.value.filter((a) => isAdjacent(a, t))
    if (adjacent.length > 0) {
      const kinds = adjacent.map((a) => combatEdgeKind({ c: a.col, r: a.row }, { c: t.col, r: t.row }))
      const first = kinds[0]
      if (first && kinds.every((k) => k === first)) {
        if (first === 'bridge') return { row: rowByKey('grove'), reason: 'hexside de pont' }
        if (first === 'stream') return { row: rowByKey('broken'), reason: 'hexside de ruisseau' }
      }
    }
    const type = terrain?.grid?.[hexId(t.col + 1, t.row)]
    const label = terrain?.types?.[type]?.label ?? 'Clear'
    return { row: rowForTerrain(type), reason: `terrain de l'hex (${label})` }
  }

  /** Ligne de la table applicable au combat, et pourquoi (affiché dans la
   *  modale). Avec UN seul hex cible, c'est simplement la sienne (cf.
   *  `rowForTargetHex`). Avec PLUSIEURS, choix de règle : on retient la
   *  ligne la PLUS FAVORABLE AU DÉFENSEUR (le plus grand `shift`) parmi
   *  celles des hex cibles — le défenseur profite du meilleur terrain de sa
   *  position, comme dans la plupart des wargames à hex multiples. À égalité,
   *  le premier hex désigné l'emporte (cf. l'ordre de `targetHexes`). */
  const terrainRow = computed(() => {
    const list = targetHexes.value
    if (list.length === 0) return null
    let best = null
    for (const t of list) {
      const r = rowForTargetHex(t)
      if (!best || r.row.shift > best.row.shift) best = { ...r, hex: hexId(t.col + 1, t.row) }
    }
    if (list.length === 1) return { row: best.row, reason: best.reason }
    return { row: best.row, reason: `${best.hex}, ${best.reason} — la plus favorable au défenseur` }
  })

  function rowByKey(key) {
    return CRT_ROWS.find((r) => r.key === key)
  }

  /** Ligne de la table correspondant à un type de terrain de `terrain.grid`
   *  — repli sur "Clear, Mixed" (la ligne la moins protectrice, donc la plus
   *  neutre) pour un type inconnu ou un hex sans terrain déclaré. */
  function rowForTerrain(type) {
    return CRT_ROWS.find((r) => r.terrains.includes(type)) ?? rowByKey('clear')
  }

  /** Colonne finale : celle de la ligne "Clear" pour ce différentiel,
   *  décalée du `shift` du terrain, et jamais en deçà de la colonne 1 (cf.
   *  "Attacks at less than the lowest differential..." en bas de la table). */
  const column = computed(() => {
    const row = terrainRow.value?.row
    if (!row) return null
    return Math.max(1, clearColumn(differential.value) - row.shift)
  })

  /** Résout le combat : 1 dé à 6 faces croisé avec la colonne calculée.
   *  Ne fait rien tant que le combat n'est pas résoluble (cf. `canResolve` :
   *  aucun attaquant, ou un hex cible sans attaquant à son contact). Le dé
   *  est tiré ICI plutôt que reçu du composant pour que toute la règle — y
   *  compris "on lance 1d6" — reste dans ce fichier ; la modale ne fait
   *  qu'ANIMER un dé par-dessus (cf. CombatModal.vue), puis affiche la valeur
   *  retenue ici. */
  function resolveCombat() {
    if (!canResolve.value || result.value) return null
    // Toutes les unités participantes ont désormais combattu pour cette
    // phase (cf. `foughtIds`) — attaquants ET défenseurs.
    foughtIds.value = new Set([
      ...foughtIds.value,
      ...attackers.value.map((a) => a.id),
      ...defenders.value.map((d) => d.id),
    ])
    const die = Math.floor(Math.random() * 6) + 1
    const col = column.value
    const code = CRT_RESULTS[die - 1][col - 1]
    result.value = {
      die,
      column: col,
      rowKey: terrainRow.value.row.key,
      rowLabel: terrainRow.value.row.label,
      rowReason: terrainRow.value.reason,
      diff: differential.value,
      result: code,
      resultLabel: RESULT_LABELS[code],
    }
    return result.value
  }

  /** Les 4 lignes de terrain prêtes à afficher dans la mini-table de la
   *  modale : pour chacune, ses cellules d'étiquettes de différentiel (une
   *  par colonne réellement couverte — les colonnes suivantes restent vides,
   *  exactement comme sur la table imprimée). */
  const crtRows = computed(() =>
    CRT_ROWS.map((row) => ({
      key: row.key,
      label: row.label,
      cells: Array.from({ length: 12 - row.shift }, (_, i) =>
        i === 0 ? FIRST_COLUMN_LABELS[row.shift] : COLUMN_LABELS[i + row.shift]
      ),
    }))
  )

  return {
    combatActive, combatAllowed, targetHexLabels, defenders, attackers, canBeTarget, canBeAttacker,
    toggleTarget, removeTargetHex, cancelCombat, toggleAttacker, hasFought, markFought, pendingEngagements,
    isCombatTargetHex, isCombatAttackerHex,
    attackStrength, defenseStrength, differential, canResolve, terrainRow, column,
    resolveCombat, combatResult: result,
    crtRows, crtResults: CRT_RESULTS,
  }
}
