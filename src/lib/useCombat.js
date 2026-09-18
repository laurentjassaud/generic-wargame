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
//      chaque hex cible est bien au contact d'un attaquant — ET si ce
//      combat ne laisse rien d'"orphelin" : ni unité amie adjacente
//      seulement à des ennemis déjà attaqués (elle ne pourrait plus
//      attaquer), ni hex ennemi adjacent seulement à des unités amies ayant
//      déjà combattu (il ne pourrait plus être attaqué) — cf. `strandedUnits`.
//   5. Une fois le dé lancé, le combat est FIGÉ (plus d'ajout/retrait de
//      cible ni d'attaquant) : toutes les unités PARTICIPANTES — attaquants
//      ET défenseurs — ont "combattu" (cf. `foughtIds`). Elles apparaissent
//      désaturées (cf. Counter.vue::spent) et ne peuvent plus être engagées
//      dans un autre combat jusqu'à la PROCHAINE PHASE. Le résultat est
//      alors appliqué (retraites au clic, éliminations, puis avance après
//      combat des vainqueurs — cf. lib/useRetreat.js) ; la modale reste
//      ouverte pendant ce temps et se ferme d'elle-même peu après (cf.
//      CombatModal.vue).
//   6. La croix de la modale annule tout (surlignages et modale
//      disparaissent) — sans rien marquer si le dé n'a pas été lancé.
//
// NOTE IMPORTANTE : ce composable ne fait qu'OBTENIR le résultat (retraite,
// élimination) — aucun pion n'est déplacé ni retiré ici. C'est
// lib/useRetreat.js qui l'APPLIQUE ensuite sur la carte (branché par
// HexMap.vue::onCombatFight).
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
//   - `table` : table de combat du module, vérifiée (cf. lib/combatTable.js
//     ::resolveCombatTable — `module.combat`), ou `null` : pas de table, pas
//     de combat (la phase Combat se déroule sans combat possible).
import { computed, ref, watch } from 'vue'
import { hexId } from './calibration.js'
import { neighborsOf } from './hex.js'
import { isFighter } from './units.js'
import { referenceColumn, rowCells } from './combatTable.js'

// --- Table de combat (CRT) -----------------------------------------------------
//
// La TABLE elle-même est une donnée du module (`module.combat`, cf.
// lib/combatTable.js et, pour Arnhem, images/combat-chart.png, règle
// [7.61]) ; ce fichier ne fait que l'interpréter. Principe : la table croise
// un DIFFÉRENTIEL de combat (force d'attaque − force de défense) avec un
// TERRAIN, pour donner une COLONNE ; le jet de dé donne ensuite la ligne, et
// leur croisement le résultat.
//
// Lecture de la table imprimée : les lignes de terrain sont alignées à
// GAUCHE sur les colonnes de résultats, et sont de plus en plus courtes à
// mesure que le terrain protège le défenseur. Concrètement, chaque ligne de
// terrain est la ligne de référence (la 1re colonne de `columns`, "Clear,
// Mixed" pour Arnhem) DÉCALÉE de N colonnes vers la gauche — c'est ce
// décalage (`shift`) qui modélise l'avantage défensif du terrain : à
// différentiel égal, un défenseur en Rough envoie l'attaquant 3 colonnes
// plus à gauche (résultats bien plus mauvais pour lui) qu'un défenseur en
// terrain dégagé. Pour Arnhem :
//
//   Clear, Mixed                  : —7  —6,5 —4,3  —2  —1   0  +1 +2,3 +4,5 +6-8 +9-11 +12   (shift 0, 12 colonnes)
//   Grove, Bridge                 : —5  —4,3  —2  —1   0  +1 +2,3 +4,5 +6-8 +9-11 +12        (shift 1, 11 colonnes)
//   Broken, Town, Woods, Stream   : —3   —2  —1   0  +1 +2,3 +4,5 +6-8 +9-11 +12             (shift 2, 10 colonnes)
//   Rough                         : —2   —1   0  +1 +2,3 +4,5 +6-8 +9-11 +12                 (shift 3,  9 colonnes)
//
// Les deux règles imprimées sous la table en découlent directement :
//  - "Attacks at less than the lowest differential are resolved at the
//    lowest differential" -> la colonne 1 de CHAQUE ligne absorbe tout ce
//    qui est en dessous d'elle (d'où le `Math.max(1, ...)` de `column`) ;
//  - "Attacks at greater than +12 are resolved as +12 attacks" -> la
//    dernière colonne absorbe tout le reste (cf. combatTable.js::
//    referenceColumn : la dernière colonne n'a pas de borne).
// "city" est rattaché à la ligne "Town" (choix validé : une ville est la
// version dense d'un town) et "grove" n'existe dans aucune carte : sa ligne
// ne sert qu'aux hexsides de PONT (cf. `edgeRows` et `rowForTargetHex`).

/** Clé d'un hex ("col,row", en coordonnées internes 0-based) — sert à
 *  mémoriser les hex cibles et à comparer deux positions sans ambiguïté. */
const keyOf = (col, row) => `${col},${row}`

/** `a` et `b` (tous deux `{ col, row }`) sont-ils voisins immédiats ? */
function isAdjacent(positionA, positionB) {
  return neighborsOf(positionA.col, positionA.row).some((neighbor) => neighbor.col === positionB.col && neighbor.row === positionB.row)
}

export function useCombat(assisted, phase, counters, canControl, terrain, combatEdgeKind, table = null) {
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
  const hasFought = (counter) => !!counter && foughtIds.value.has(counter.id)

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

  // Photo du combat PRISE AU MOMENT DU JET (cf. `resolveCombat`) : copies
  // des attaquants et des défenseurs, ligne de terrain et colonne. Une fois
  // le dé lancé, c'est elle que lisent `attackers`, `defenders`,
  // `terrainRow` et `column` — et non plus la carte. Sans elle, les
  // retraites et éliminations qui suivent (cf. lib/useRetreat.js) videraient
  // les hex cibles et changeraient, dans la modale encore ouverte, les
  // forces, le différentiel et la colonne d'un combat déjà joué. Des COPIES
  // des pions, car les pions eux-mêmes changent de position en retraitant.
  // `null` tant que le dé n'a pas été lancé.
  const frozen = ref(null)

  // Seules les vraies unités combattent — ni les marqueurs (DZ...), ni les
  // pions de soutien : cf. lib/units.js::isFighter (importée plus haut).

  const combatActive = computed(() => targetHexes.value.length > 0)

  const targetKeys = computed(() => new Set(targetHexes.value.map((targetHex) => keyOf(targetHex.col, targetHex.row))))

  /** Numéros imprimés des hex cibles ("0512"...), pour la modale et le
   *  journal — même convention que partout ailleurs (`hexId(col + 1, row)`). */
  const targetHexLabels = computed(() => targetHexes.value.map((targetHex) => hexId(targetHex.col + 1, targetHex.row)))

  /** DÉFENSEURS : toutes les unités ENNEMIES (non contrôlées par le camp
   *  actif) présentes dans l'un des hex cibles. Recalculé à chaque lecture
   *  depuis `counters` : un hex empilé défend avec TOUS ses pions, et leurs
   *  facteurs de défense s'additionnent (cf. `defenseStrength`). */
  const defenders = computed(() => frozen.value?.defenders
    ?? counters.value.filter((counter) => isFighter(counter) && !canControl(counter) && targetKeys.value.has(keyOf(counter.col, counter.row)))
  )

  const attackers = computed(() => frozen.value?.attackers
    ?? counters.value.filter((counter) => attackerIds.value.has(counter.id)))

  /** Le combat est-il possible en ce moment ? Mode Assisté ET phase Combat
   *  (cf. useAssisted.js::phase, 1 = Combat) — en phase Mouvement ou Fin de
   *  tour, un clic sur un pion ennemi ne doit rien déclencher du tout — ET
   *  une table de combat déclarée par le module (cf. `table`). */
  const combatAllowed = computed(() => assisted.value && phase.value === 1 && !!table)

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
  function canAttackHex(counter, targetHex) {
    return !hasFought(counter) && canReachHex(counter, targetHex)
  }

  /** Même règle que `canAttackHex`, SANS la condition "n'a pas déjà
   *  combattu" : "`c` serait-il géographiquement capable d'attaquer `t` ?".
   *  Sert à `strandedUnits`, qui simule un état de combat qui n'existe pas
   *  encore — la vérification "a combattu" s'y fait contre un ensemble
   *  simulé, et non contre `foughtIds`. */
  function canReachHex(counter, targetHex) {
    if (!isFighter(counter) || !canControl(counter)) return false
    if (!isAdjacent(counter, targetHex)) return false
    return combatEdgeKind({ c: counter.col, r: counter.row }, { c: targetHex.col, r: targetHex.row }) !== 'river'
  }

  /** L'unité `c` peut-elle attaquer TOUS les hex de `list` à la fois ?
   *  C'est la RÈGLE STRICTE du combat multi-hex (cf. l'en-tête) : un
   *  attaquant doit être au contact de CHAQUE hex cible, pas d'un seul. */
  function canAttackAll(counter, list) {
    return list.every((targetHex) => canAttackHex(counter, targetHex))
  }

  /** L'ensemble d'hex `list` forme-t-il un groupe de cibles valide ? Oui s'il
   *  existe AU MOINS UNE unité amie capable d'attaquer tous ces hex à la fois
   *  (cf. `canAttackAll`, rivière comprise : une amie séparée d'un des hex
   *  par une rivière sans pont ne compte pas). La règle vaut dès la PREMIÈRE
   *  cible : on n'ouvre pas un combat contre un hex que personne ne peut
   *  atteindre. */
  function canTargetSet(list) {
    return counters.value.some((counter) => canAttackAll(counter, list))
  }

  /** `c` est-il une unité ennemie qu'on peut viser (pour ouvrir un combat ou
   *  ajouter son hex aux cibles) ? Il faut :
   *   - qu'aucune unité ennemie de son hex n'ait déjà combattu pendant cette
   *     phase (un hex déjà attaqué ne peut pas l'être une seconde fois) ;
   *   - que les cibles actuelles PLUS son hex restent un groupe valide (cf.
   *     `canTargetSet`). */
  function canBeTarget(counter) {
    if (!combatAllowed.value || !isFighter(counter) || canControl(counter)) return false
    const alreadyFought = counters.value.some((otherCounter) =>
      otherCounter.col === counter.col && otherCounter.row === counter.row && isFighter(otherCounter) && !canControl(otherCounter) && hasFought(otherCounter))
    if (alreadyFought) return false
    return canTargetSet([...targetHexes.value, { col: counter.col, row: counter.row }])
  }

  /** `c` peut-il être désigné attaquant ? RÈGLE STRICTE : il doit pouvoir
   *  attaquer TOUS les hex cibles (cf. `canAttackAll`). */
  function canBeAttacker(counter) {
    return canAttackAll(counter, targetHexes.value)
  }

  /** Ne garde, parmi les attaquants désignés, que ceux qui respectent encore
   *  la règle stricte après un changement des cibles. */
  function pruneAttackers() {
    attackerIds.value = new Set(attackers.value.filter(canBeAttacker).map((attacker) => attacker.id))
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
  function toggleTarget(counter) {
    if (!combatAllowed.value || !isFighter(counter) || canControl(counter)) return false
    // Combat déjà résolu (dé lancé, modale en train de se fermer) : il est
    // figé, le clic est "consommé" sans rien changer.
    if (result.value) return true
    if (targetKeys.value.has(keyOf(counter.col, counter.row))) return removeTargetHex(counter.col, counter.row)
    if (!canBeTarget(counter)) return false
    targetHexes.value = [...targetHexes.value, { col: counter.col, row: counter.row }]
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
    targetHexes.value = targetHexes.value.filter((targetHex) => targetHex.col !== col || targetHex.row !== row)
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
    frozen.value = null
  }

  /** Ajoute `c` aux attaquants, ou l'en retire s'il y était déjà (recliquer
   *  dessus le désélectionne). Impossible une fois le combat résolu (dé
   *  lancé) : il est figé. */
  function toggleAttacker(counter) {
    if (!combatActive.value || !counter || result.value) return false
    const next = new Set(attackerIds.value)
    if (next.has(counter.id)) next.delete(counter.id)
    else if (canBeAttacker(counter)) next.add(counter.id)
    else return false
    attackerIds.value = next
    result.value = null
    return true
  }

  // Surlignages de la carte (cf. HexMap.vue) : les hex cibles en orange,
  // ceux des attaquants désignés en jaune.
  const isCombatTargetHex = (hex) => targetKeys.value.has(keyOf(hex.c, hex.r))
  const isCombatAttackerHex = (hex) => attackers.value.some((attacker) => attacker.col === hex.c && attacker.row === hex.r)

  // Forces en présence. `atk`/`def` viennent des données du module (cf.
  // arnhem.json) ; le `?? 0` couvre un pion qui n'en déclarerait pas. La
  // défense est la SOMME des facteurs de tous les défenseurs, tous hex cibles
  // confondus (cf. `defenders`).
  const attackStrength = computed(() => attackers.value.reduce((sum, attacker) => sum + (attacker.atk ?? 0), 0))
  const defenseStrength = computed(() => defenders.value.reduce((sum, defender) => sum + (defender.def ?? 0), 0))
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
   *  Liste vide = les DEUX obligations de participation sont tenues (toute
   *  unité amie au contact a attaqué, tout hex ennemi au contact a été
   *  attaqué) : `strandedUnits` interdit en amont tout combat qui laisserait
   *  une unité amie ou un hex ennemi sans plus aucun adversaire frais — ce
   *  qui les ferait sortir de cette liste sans avoir combattu.
   *
   *  Ne comptent pas : une paire séparée par une rivière sans pont (aucune
   *  attaque possible entre elles, cf. `canAttackHex`), les marqueurs et
   *  pions de soutien (cf. `isFighter`). Liste vide hors phase Combat.
   *  Chaque entrée : `{ key, friendly, friendlyHex, enemy, enemyHex }` (noms
   *  et numéros d'hex imprimés), pour la modale d'avertissement. */
  const pendingEngagements = computed(() => {
    if (!combatAllowed.value) return []
    const list = []
    const enemies = counters.value.filter((enemy) => isFighter(enemy) && !canControl(enemy) && !hasFought(enemy))
    for (const enemy of enemies) {
      for (const attacker of counters.value) {
        if (!canAttackHex(attacker, enemy)) continue
        list.push({
          key: `${attacker.id}-${enemy.id}`,
          friendly: attacker.name,
          friendlyHex: hexId(attacker.col + 1, attacker.row),
          enemy: enemy.name,
          enemyHex: hexId(enemy.col + 1, enemy.row),
        })
      }
    }
    return list
  })

  /** UNITÉS ORPHELINES — règle de PARTICIPATION, à DOUBLE obligation :
   *   (A) toute unité du camp actif adjacente à un ennemi DOIT attaquer ;
   *   (B) tout hex ennemi adjacent à une unité du camp actif DOIT être
   *       attaqué ;
   *  … sachant qu'un hex ne peut être attaqué qu'UNE fois et qu'une unité
   *  n'attaque qu'UNE fois. Un combat est donc interdit s'il rend l'une de
   *  ces obligations IMPOSSIBLE à tenir plus tard :
   *   - une unité AMIE qui n'aurait plus aucun hex ennemi frais à son
   *     contact (elle ne pourrait plus attaquer personne) ;
   *   - un hex ENNEMI qui n'aurait plus aucune unité amie fraîche à son
   *     contact (il ne pourrait plus être attaqué par personne).
   *
   *  Exemple (A) (Nijmegen) : 1/508 et 2/508 sont tous deux au contact de
   *  BrDf, et 1/508 ne touche AUCUN autre ennemi. Si 2/508 attaque BrDf
   *  SEUL, BrDf a combattu -> 1/508 n'a plus personne à attaquer. Ce combat
   *  est refusé tant que 1/508 n'est pas ajouté aux attaquants.
   *
   *  Exemple (B) : l'unité amie X touche les hex ennemis E1 et E2, l'unité
   *  amie Y ne touche que E1, et personne d'autre ne touche E2. Si X et Y
   *  attaquent E1 ENSEMBLE, X a combattu -> E2 n'a plus aucun attaquant
   *  possible. Refusé : il faut que Y attaque E1 seule et X attaque E2 (ou
   *  que X attaque E1+E2 à la fois, mais Y ne pourrait alors pas se joindre
   *  à elle — règle stricte — et Y serait alors orpheline côté (A)).
   *
   *  Algorithme — une SIMULATION locale du combat en cours, avant le dé :
   *   1. `after` = unités ayant combattu APRÈS ce combat : celles de
   *      `foughtIds` + les attaquants + les défenseurs désignés.
   *   2. Côté AMI : pour chaque unité amie `f` hors de `after` (elle devra
   *      donc attaquer plus tard), on liste les ennemis qu'elle peut
   *      atteindre (adjacents, pas de rivière sans pont — cf. `canReachHex`).
   *      `f` est ORPHELINE si l'un d'eux est encore frais AUJOURD'HUI (hors
   *      `foughtIds`) — elle a donc bien une obligation — mais AUCUN ne
   *      l'est plus APRÈS ce combat (tous dans `after`).
   *   3. Côté ENNEMI, même raisonnement mais par HEX (on attaque un hex, pas
   *      un pion : tous ses occupants défendent ensemble). Pour chaque hex
   *      ennemi qui reste frais après ce combat (aucun de ses occupants dans
   *      `after`), on liste les unités amies qui peuvent l'atteindre. L'hex
   *      est ORPHELIN si l'une d'elles est fraîche AUJOURD'HUI mais AUCUNE
   *      ne l'est plus APRÈS ce combat.
   *   Dans les deux cas, le "frais aujourd'hui" évite de reprocher à ce
   *   combat-ci une situation qu'il n'a pas créée (unité ou hex sans aucun
   *   voisin adverse, ou déjà orphelin dans une partie rejouée).
   *
   *  Pourquoi ce test LOCAL suffit (il n'est pas qu'une approximation) :
   *  on regarde le graphe "qui peut attaquer qui" restant APRÈS ce combat —
   *  unités amies fraîches d'un côté, hex ennemis frais de l'autre, un lien
   *  entre une unité et un hex qu'elle peut atteindre. Sans orpheline, AUCUN
   *  sommet de ce graphe n'est isolé (chaque unité a au moins un hex, chaque
   *  hex au moins une unité). Or tout graphe sans sommet isolé se découpe en
   *  ÉTOILES disjointes qui couvrent tous ses sommets (prendre un
   *  "recouvrement par arêtes" MINIMAL : il ne contient ni cycle ni chemin de
   *  3 arêtes — l'arête du milieu serait superflue — donc chaque morceau est
   *  une étoile). Et chaque étoile est un combat LÉGAL :
   *   - centre = un hex, branches = des unités -> ces unités attaquent cet
   *     hex ensemble ;
   *   - centre = une unité, branches = des hex -> cette unité attaque seule
   *     tous ces hex à la fois (elle est au contact de chacun : règle
   *     stricte respectée).
   *  Chaque unité amie attaque une fois, chaque hex est attaqué une fois :
   *  les deux obligations sont tenues. Inutile donc d'explorer toutes les
   *  combinaisons de combats futurs : vérifier chaque unité et chaque hex
   *  isolément garantit que la phase pourra toujours être menée à son terme.
   *
   *  Liste vide tant que le combat n'est pas prêt (aucun attaquant) ou déjà
   *  résolu. Chaque entrée : `{ id, side, name, hex }` — `side` vaut
   *  'friendly' (unité amie qui ne pourrait plus attaquer) ou 'enemy' (hex
   *  ennemi qui ne pourrait plus être attaqué ; `name` liste alors ses
   *  occupants), `hex` est le numéro d'hex imprimé — pour la modale. */
  const strandedUnits = computed(() => {
    if (!combatActive.value || attackers.value.length === 0 || result.value) return []
    const now = foughtIds.value
    const after = new Set([
      ...now,
      ...attackers.value.map((attacker) => attacker.id),
      ...defenders.value.map((defender) => defender.id),
    ])
    const friendlies = counters.value.filter((friendly) => isFighter(friendly) && canControl(friendly))
    const enemies = counters.value.filter((enemy) => isFighter(enemy) && !canControl(enemy))
    const list = []

    // (A) Côté AMI : chaque unité qui devra encore attaquer.
    for (const friendly of friendlies) {
      if (after.has(friendly.id)) continue
      const reachable = enemies.filter((enemy) => canReachHex(friendly, enemy))
      const freshNow = reachable.some((enemy) => !now.has(enemy.id))
      const freshAfter = reachable.some((enemy) => !after.has(enemy.id))
      if (freshNow && !freshAfter) list.push({ id: friendly.id, side: 'friendly', name: friendly.name, hex: hexId(friendly.col + 1, friendly.row) })
    }

    // (B) Côté ENNEMI : chaque hex qui devra encore être attaqué. On regroupe
    // d'abord les ennemis par hex, puis on écarte les hex dont un occupant a
    // (ou aura, avec ce combat) déjà combattu : ils sont "soldés".
    const byHex = new Map()
    for (const enemy of enemies) {
      const key = keyOf(enemy.col, enemy.row)
      if (!byHex.has(key)) byHex.set(key, [])
      byHex.get(key).push(enemy)
    }
    for (const [key, units] of byHex) {
      if (units.some((enemy) => after.has(enemy.id))) continue
      const hexRepresentative = units[0] // tous au même hex : n'importe lequel donne sa position
      const reachers = friendlies.filter((friendly) => canReachHex(friendly, hexRepresentative))
      const freshNow = reachers.some((friendly) => !now.has(friendly.id))
      const freshAfter = reachers.some((friendly) => !after.has(friendly.id))
      if (freshNow && !freshAfter) {
        list.push({ id: `hex:${key}`, side: 'enemy', name: units.map((enemy) => enemy.name).join(', '), hex: hexId(hexRepresentative.col + 1, hexRepresentative.row) })
      }
    }
    return list
  })

  /** Le combat peut-il être résolu ? Il faut au moins un attaquant — la
   *  règle stricte (cf. `canBeAttacker`/`pruneAttackers`) garantit que tout
   *  attaquant désigné touche CHAQUE hex cible — et aucune unité orpheline
   *  (cf. `strandedUnits`). */
  const canResolve = computed(() =>
    combatActive.value && attackers.value.length > 0 && strandedUnits.value.length === 0)

  /** Ligne de la table pour UN hex cible `t`, et pourquoi :
   *   - si TOUS les attaquants au contact de cet hex franchissent un hexside
   *     de MÊME nature, et que la table substitue une ligne à cette nature
   *     (`table.edgeRows` — pour Arnhem : "Grove, Bridge" pour un pont,
   *     "Broken, Town, Woods, Stream" pour un ruisseau), c'est cet HEXSIDE qui
   *     fait foi ;
   *   - sinon (ou tant qu'aucun attaquant n'est à son contact), c'est le
   *     TERRAIN DE L'HEX.
   *  Un hexside franchi par une route/piste n'est pas un obstacle et renvoie
   *  `null` (cf. useAssisted.js::combatEdgeKind) : il ne déclenche donc
   *  jamais de substitution, la règle retombe sur le terrain de l'hex. */
  function rowForTargetHex(targetHex) {
    const adjacent = attackers.value.filter((attacker) => isAdjacent(attacker, targetHex))
    if (adjacent.length > 0) {
      const kinds = adjacent.map((attacker) => combatEdgeKind({ c: attacker.col, r: attacker.row }, { c: targetHex.col, r: targetHex.row }))
      const first = kinds[0]
      const substitute = first ? table.edgeRows[first] : null
      if (substitute && kinds.every((kind) => kind === first)) {
        return { row: rowByKey(substitute.row), reason: substitute.reason ?? `hexside (${first})` }
      }
    }
    const type = terrain?.grid?.[hexId(targetHex.col + 1, targetHex.row)]
    const label = terrain?.types?.[type]?.label ?? type ?? 'non déclaré'
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
    if (frozen.value) return frozen.value.terrainRow
    const list = targetHexes.value
    if (list.length === 0) return null
    let best = null
    for (const targetHex of list) {
      const targetRow = rowForTargetHex(targetHex)
      if (!best || targetRow.row.shift > best.row.shift) best = { ...targetRow, hex: hexId(targetHex.col + 1, targetHex.row) }
    }
    if (list.length === 1) return { row: best.row, reason: best.reason }
    return { row: best.row, reason: `${best.hex}, ${best.reason} — la plus favorable au défenseur` }
  })

  function rowByKey(key) {
    return table.rows.find((crtRow) => crtRow.key === key)
  }

  /** Ligne de la table correspondant à un type de terrain de `terrain.grid`
   *  — repli sur la ligne par défaut de la table (`table.defaultRow`, "Clear,
   *  Mixed" pour Arnhem : la moins protectrice, donc la plus neutre) pour un
   *  type inconnu ou un hex sans terrain déclaré. */
  function rowForTerrain(type) {
    return table.rows.find((crtRow) => crtRow.terrains.includes(type)) ?? rowByKey(table.defaultRow)
  }

  /** Colonne finale : celle de la ligne de référence pour ce différentiel
   *  (cf. combatTable.js::referenceColumn), décalée du `shift` du terrain,
   *  et jamais en deçà de la colonne 1 (cf. "Attacks at less than the lowest
   *  differential..." en bas de la table). */
  const column = computed(() => {
    if (frozen.value) return frozen.value.column
    const row = terrainRow.value?.row
    if (!row) return null
    return Math.max(1, referenceColumn(table, differential.value) - row.shift)
  })

  /** Résout le combat : 1 dé (`table.die` faces) croisé avec la colonne calculée.
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
      ...attackers.value.map((attacker) => attacker.id),
      ...defenders.value.map((defender) => defender.id),
    ])
    // Photo du combat (cf. `frozen`), prise AVANT toute conséquence du jet.
    frozen.value = {
      attackers: attackers.value.map((attacker) => ({ ...attacker })),
      defenders: defenders.value.map((defender) => ({ ...defender })),
      terrainRow: terrainRow.value,
      column: column.value,
    }
    const die = Math.floor(Math.random() * table.die) + 1
    const col = column.value
    const code = table.results[die - 1][col - 1]
    result.value = {
      die,
      column: col,
      rowKey: terrainRow.value.row.key,
      rowLabel: terrainRow.value.row.label,
      rowReason: terrainRow.value.reason,
      diff: differential.value,
      result: code,
      resultLabel: table.labels[code] ?? code,
    }
    return result.value
  }

  /** Les lignes de terrain prêtes à afficher dans la mini-table de la
   *  modale : pour chacune, ses cellules d'étiquettes de différentiel (une
   *  par colonne réellement couverte — les colonnes suivantes restent vides,
   *  exactement comme sur la table imprimée, cf. combatTable.js::rowCells). */
  const crtRows = computed(() =>
    (table?.rows ?? []).map((row) => ({ key: row.key, label: row.label, cells: rowCells(table, row) }))
  )

  return {
    combatActive, combatAllowed, targetHexes, targetHexLabels, defenders, attackers, canBeTarget, canBeAttacker,
    toggleTarget, removeTargetHex, cancelCombat, toggleAttacker, hasFought, markFought, pendingEngagements,
    isCombatTargetHex, isCombatAttackerHex,
    attackStrength, defenseStrength, differential, canResolve, strandedUnits, terrainRow, column,
    resolveCombat, combatResult: result,
    crtRows, crtResults: table?.results ?? [],
  }
}
