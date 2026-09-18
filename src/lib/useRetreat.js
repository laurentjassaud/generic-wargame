// ═══════════════════════════════════════════════════════════════════════════
// useRetreat — application des RÉSULTATS de combat du mode "Assisté"
// ═══════════════════════════════════════════════════════════════════════════
//
// lib/useCombat.js tire le dé et lit la table de combat ; CE composable-ci
// applique ensuite le résultat obtenu sur la carte (retraites, éliminations).
// Séparé de useCombat.js pour la même raison que celui-ci l'est de
// useAssisted.js : un bloc de règles autonome, qui ne reçoit du reste que
// les briques dont il a besoin (cf. paramètres plus bas).
//
// Ce que fait chaque résultat de la table est déclaré par le module
// (`module.combat.effects`, cf. lib/combatTable.js et le paramètre
// `resultEffect` ci-dessous) : `{ retreat: { defenders: n, attackers: n } }`
// et/ou `{ eliminate: 'defenders' | 'attackers' }`. Pour Arnhem :
//   - D1..D4 : chaque DÉFENSEUR retraite de 1 à 4 hex ;
//   - A1, A2 : chaque ATTAQUANT retraite de 1 ou 2 hex ;
//   - Br     : défenseurs PUIS attaquants retraitent d'1 hex chacun ;
//   - De     : tous les défenseurs sont éliminés ;
//   - Ae     : tous les attaquants sont éliminés.
//
// Règles d'une retraite, vérifiées à CHAQUE hex parcouru :
//   1. l'hex doit ÉLOIGNER l'unité de l'hex de combat — sa distance à
//      celui-ci doit augmenter d'1 à chaque pas (cf. `refDistance`) ;
//   2. on ne peut pas ENTRER dans une ZOC ennemie (cf.
//      useAssisted.js::enemyZocSet) — ni, a fortiori, dans un hex occupé par
//      un ennemi ;
//   3. on ne peut pas entrer dans un hex INTERDIT à l'unité (rivière sans
//      pont, terrain interdit aux véhicules... cf.
//      useAssisted.js::canEnterTerrain), ni sortir de la carte ;
//   4. SI POSSIBLE, on n'entre pas dans un hex occupé par une unité AMIE —
//      seulement si c'est la seule possibilité.
//
// "L'hex de combat" dont il faut s'éloigner (choix de règle) :
//   - pour un DÉFENSEUR : l'hex qu'il occupait pendant le combat ;
//   - pour un ATTAQUANT : les hex CIBLES du combat (le plus proche d'entre
//     eux, en cas de combat sur plusieurs hex).
//
// Retraite IMPOSSIBLE (choix de règle, classique dans les wargames) :
// l'unité qui ne peut pas effectuer TOUTE sa retraite est ÉLIMINÉE. Pour ne
// jamais piéger une unité par un mauvais choix de chemin, seuls sont
// proposés les hex à partir desquels la retraite peut encore être MENÉE À
// SON TERME (cf. `canComplete`, qui explore les chemins possibles — au plus
// 4 pas, c'est instantané).
//
// Déroulé à l'écran (cf. HexMap.vue et CombatModal.vue) : une fois le
// résultat affiché, la modale de combat reste ouverte ; les unités
// retraitent UNE PAR UNE, UN HEX À LA FOIS. Les hex où l'unité en cours peut
// aller sont surlignés en ROUGE, le joueur clique sur l'un d'eux, et on
// recommence jusqu'à ce que chaque unité ait parcouru son nombre d'hex. Les
// autres actions de jeu sont bloquées pendant ce temps.
//
// ─── AVANCE APRÈS COMBAT ─────────────────────────────────────────────────────
// Chemin de retraite ("path of retreat", POR) : TOUS les hex qu'une unité
// quitte en retraitant (son hex de départ et chaque hex traversé — pas celui
// où elle s'arrête, qu'elle occupe encore), ainsi que l'hex d'une unité
// éliminée par le combat (De/Ae, ou retraite impossible). Il est surligné en
// VERT dès qu'un hex est libéré (cf. `isPorHex`).
//
// Une fois toutes les retraites faites, les unités VICTORIEUSES du combat
// peuvent avancer dans ce POR (cf. `victorIds`) :
//   - vainqueurs (choix de règle) : le camp que le résultat ÉPARGNE — les
//     ATTAQUANTS si seuls les défenseurs retraitent ou sont éliminés
//     (D1..D4/De), les DÉFENSEURS dans le cas inverse (A1/A2/Ae) ; PERSONNE
//     si les deux camps sont touchés (Br) ou si le module désactive l'avance
//     (`advanceAfterCombat`) ;
//   - seules les unités ayant PARTICIPÉ au combat, encore sur la carte ;
//   - UNE unité à la fois : on clique sur elle, puis sur un hex VERT VIF
//     voisin (cf. `advanceCandidates`), et on recommence tant qu'on veut ;
//     cliquer sur une autre unité victorieuse TERMINE l'avance de la
//     précédente (si elle a bougé : elle ne peut plus reprendre ensuite) ;
//   - hex par hex, en restant DANS le POR (chaque pas vers un hex du POR
//     voisin de l'unité, jamais vers un hex déjà visité par elle) ;
//   - PAS DE ZOC : les ZOC ennemies ne gênent pas l'avance ;
//   - PAS D'EMPILEMENT : jamais dans un hex occupé par une unité (amie ou
//     ennemie) — y compris par une unité qui vient d'y avancer.
// L'avance se termine par le bouton "Terminer l'avance" de la modale (cf.
// `endAdvance`), ou d'elle-même dès qu'aucune unité victorieuse ne peut plus
// avancer d'un hex (cf. `settleAdvance`) — y compris quand il n'y a rien à
// faire du tout (pas de POR, pas de vainqueur).
//
// Paramètres reçus :
//   - `phase` : computed de la phase courante (cf. useAssisted.js::phase) —
//     un changement de phase abandonne toute retraite en cours (filet de
//     sécurité : HexMap.vue refuse déjà de changer de phase pendant une
//     retraite).
//   - `counters` : ref du tableau des pions POSÉS sur la carte — on y
//     relit à chaque fois la position À JOUR des unités (une unité qui
//     vient de retraiter a bougé : la ZOC et l'occupation des hex changent).
//   - `hexOnMap` : `(col, row) => bool` — l'hex existe-t-il sur la carte ?
//   - `enemyZocSet`, `canEnterTerrain`, `isEnemyOf` : cf. useAssisted.js.
//   - `moveUnit` : `(unit, { col, row }, { done, total }) => void` — fait
//     effectivement avancer l'unité d'un hex (HexMap.vue : position,
//     synchro réseau, journal).
//   - `eliminateUnit` : `(unit, reason) => void` — retire l'unité de la
//     carte (HexMap.vue::eliminateCounter, qui journalise aussi).
//   - `advanceUnit` : `(unit, { col, row }) => void` — même chose que
//     `moveUnit`, pour un pas d'AVANCE après combat.
//   - `resultEffect` : `(code) => effet | null` — ce que fait le résultat
//     `code` de la table (cf. `module.combat.effects`, en-tête). Un code
//     inconnu ne fait rien.
//   - `advanceAfterCombat` (vrai par défaut) : les vainqueurs peuvent-ils
//     avancer après combat ?
//   - `retreatReduction` (optionnel) : `(unit, { col, row }, { initial,
//     total, done }) => { total, reason } | null` — point d'accroche des
//     règles PARTICULIÈRES d'un module qui permettent de RACCOURCIR une
//     retraite (ex. lib/useArnhem.js::cityRetreatReduction). Le moteur n'en
//     connaît pas le contenu : il demande seulement, pour l'hex où se trouve
//     l'unité, si sa retraite peut passer à un nouveau `total`. `null` = pas
//     de réduction. La réduction est proposée au joueur (cf. `reduce`), et
//     appliquée d'office seulement si, sans elle, l'unité serait éliminée.
import { computed, ref, watch } from 'vue'
import { hexDistance, neighborsOf } from './hex.js'
import { isFighter } from './units.js'

// Seules les vraies unités comptent (occupation d'un hex, ennemis...) — ni
// les marqueurs (DZ...), ni les pions de soutien : cf. lib/units.js::isFighter.

const keyOf = (col, row) => `${col},${row}`

export function useRetreat({ phase, counters, hexOnMap, enemyZocSet, canEnterTerrain, isEnemyOf, moveUnit, eliminateUnit, advanceUnit, resultEffect = () => null, advanceAfterCombat = true, retreatReduction = null }) {
  // File des retraites À FAIRE, dans l'ordre. Chaque entrée :
  //   { id, side, initial, total, done, refHexes }
  //   - `id` : id de l'unité (on relit l'unité elle-même dans `counters`) ;
  //   - `side` : 'defender' | 'attacker' (pour l'affichage) ;
  //   - `total` / `done` : nombre d'hex à parcourir / déjà parcourus ;
  //   - `initial` : nombre d'hex du résultat tiré (= `total` tant qu'aucune
  //     réduction n'a été appliquée, cf. `retreatReduction`) ;
  //   - `refHexes` : l'"hex de combat" dont elle doit s'éloigner (liste de
  //     { col, row }, cf. l'en-tête).
  // La tête de file (`queue[0]`) est l'unité en train de retraiter.
  const queue = ref([])

  // Ce qui s'est passé pendant l'application du résultat (éliminations,
  // retraites terminées...), en phrases — affiché dans la modale de combat.
  const notes = ref([])

  // --- État de l'AVANCE après combat (cf. l'en-tête) ---
  // Chemin de retraite : clés "col,row" des hex libérés par ce combat.
  const por = ref(new Set())
  // Ids des unités victorieuses, qui PEUVENT avancer (cf. `start`).
  const victorIds = ref(new Set())
  // Phase d'avance ouverte (après les retraites, jusqu'à `endAdvance`).
  const advancing = ref(false)
  // Unité en train d'avancer (id), ou `null` tant qu'aucune n'est choisie.
  const advancerId = ref(null)
  // Pour chaque unité victorieuse ayant avancé : les hex (clés) qu'elle a
  // déjà occupés pendant son avance — elle ne revient jamais dessus.
  const visited = ref(new Map())
  // Unités dont l'avance est TERMINÉE (on est passé à une autre après
  // qu'elles ont bougé) : elles ne peuvent plus avancer.
  const doneIds = ref(new Set())

  /** Ajoute l'hex `h` ({ col, row }) au chemin de retraite. */
  function addPor(hex) {
    por.value = new Set(por.value).add(keyOf(hex.col, hex.row))
  }

  const unitOf = (id) => counters.value.find((counter) => String(counter.id) === String(id)) ?? null

  /** Distance de `h` à l'"hex de combat" de la retraite `task` — la plus
   *  courte, s'il y en a plusieurs (attaquant d'un combat multi-hex). */
  function refDistance(task, hex) {
    return Math.min(...task.refHexes.map((refHex) => hexDistance(hex, refHex)))
  }

  /** `h` contient-il au moins une unité ENNEMIE de `unit` ? */
  function hasEnemy(unit, hex) {
    return counters.value.some((otherCounter) => isFighter(otherCounter) && otherCounter.col === hex.col && otherCounter.row === hex.row && isEnemyOf(unit, otherCounter))
  }

  /** `h` contient-il au moins une unité AMIE de `unit` (autre qu'elle) ? */
  function hasFriend(unit, hex) {
    return counters.value.some((otherCounter) =>
      isFighter(otherCounter) && otherCounter.id !== unit.id && otherCounter.col === hex.col && otherCounter.row === hex.row && !isEnemyOf(unit, otherCounter))
  }

  /** Les hex où `unit`, actuellement en `from`, peut faire UN pas de
   *  retraite — règles 1 à 3 de l'en-tête (la règle 4, "pas chez un ami si
   *  possible", est une PRÉFÉRENCE, appliquée plus tard par `candidates`).
   *  `zoc` = `enemyZocSet(unit)`, calculé une seule fois par l'appelant.
   *
   *  IMPORTANT : cette ZOC est recalculée à CHAQUE proposition de retraite,
   *  à partir des positions ACTUELLES des pions (jamais mise en cache d'un
   *  combat à l'autre). Une unité qui vient d'avancer après combat (cf.
   *  `stepAdvance`, qui déplace le pion réel de la carte) projette donc
   *  aussitôt sa ZOC depuis sa NOUVELLE position : elle peut interdire des
   *  retraites dans les combats suivants. Idem pour une unité qui vient de
   *  retraiter (résultat Br : l'attaquant retraite après le défenseur). */
  function legalSteps(task, unit, from, zoc) {
    const currentDistance = refDistance(task, from)
    return neighborsOf(from.col, from.row).filter((neighbor) =>
      hexOnMap(neighbor.col, neighbor.row) // pas de sortie de carte
      && refDistance(task, neighbor) > currentDistance // règle 1 : on s'éloigne
      && !zoc.has(keyOf(neighbor.col, neighbor.row)) // règle 2 : pas d'entrée en ZOC ennemie
      && !hasEnemy(unit, neighbor) // règle 2 (bis) : ni dans un hex ennemi
      && canEnterTerrain(unit, { c: neighbor.col, r: neighbor.row }, { c: from.col, r: from.row })) // règle 3
  }

  /** Réduction de retraite offerte par le module (cf. `retreatReduction`)
   *  à `unit` dans l'hex `h`, pour l'état `task` — ou `null`. */
  function reductionAt(task, unit, hex) {
    return retreatReduction?.(unit, { col: hex.col, row: hex.row }, task) ?? null
  }

  /** Depuis `from`, `unit` peut-elle encore finir la retraite `task` (dont
   *  `done` pas sont faits) ? Exploration de TOUS les chemins possibles
   *  (profondeur ≤ 4, au plus 6 voisins par pas — quelques centaines de cas
   *  au pire). À chaque hex atteint, on essaie AUSSI la variante "réduction
   *  prise" (cf. `retreatReduction`) : une retraite qu'un hex du chemin
   *  permet de raccourcir n'est pas impossible. Les autres unités ne bougent
   *  pas pendant la retraite de celle-ci : ZOC et occupation des hex sont
   *  donc les mêmes à chaque pas du chemin exploré. */
  function canComplete(task, unit, from, zoc) {
    if (task.done >= task.total) return true
    return legalSteps(task, unit, from, zoc).some((neighbor) => canCompleteVia(task, unit, neighbor, zoc))
  }

  /** Après UN pas de `task` vers `n`, la retraite peut-elle être finie ? */
  function canCompleteVia(task, unit, neighbor, zoc) {
    const next = { ...task, done: task.done + 1 }
    if (canComplete(next, unit, neighbor, zoc)) return true
    const red = reductionAt(next, unit, neighbor)
    return !!red && canComplete({ ...next, total: red.total }, unit, neighbor, zoc)
  }

  /** Hex proposés (en rouge) pour le PROCHAIN pas de l'unité en tête de
   *  file : les pas légaux qui permettent de finir la retraite (cf.
   *  `canComplete`), en écartant ceux occupés par un ami SI il en reste
   *  d'autres (règle 4). Liste vide = retraite impossible. */
  function candidatesFor(task) {
    const unit = unitOf(task.id)
    if (!unit) return []
    const zoc = enemyZocSet(unit)
    const from = { col: unit.col, row: unit.row }
    const viable = legalSteps(task, unit, from, zoc).filter((neighbor) => canCompleteVia(task, unit, neighbor, zoc))
    const free = viable.filter((neighbor) => !hasFriend(unit, neighbor))
    return free.length > 0 ? free : viable
  }

  const current = computed(() => queue.value[0] ?? null)
  const candidates = computed(() => (current.value ? candidatesFor(current.value) : []))
  const candidateKeys = computed(() => new Set(candidates.value.map((hex) => keyOf(hex.col, hex.row))))

  /** Une retraite est-elle en cours ? */
  const retreating = computed(() => queue.value.length > 0)

  /** Le résultat d'un combat est-il en cours d'application (retraite OU
   *  avance) ? HexMap.vue bloque alors toute autre action de jeu. */
  const active = computed(() => retreating.value || advancing.value)

  /** Infos de la retraite en cours, pour la modale — `null` s'il n'y en a
   *  pas (ou plus). */
  const info = computed(() => {
    const task = current.value
    if (!task) return null
    const unit = unitOf(task.id)
    return {
      name: unit?.name ?? String(task.id),
      side: task.side,
      step: task.done + 1,
      total: task.total,
      waiting: queue.value.length - 1, // unités qui retraiteront ensuite
      // Réduction proposée DANS l'hex actuel (cf. `reduce`) : `{ total,
      // reason }` ou `null`.
      reduction: unit ? reductionAt(task, unit, unit) : null,
    }
  })

  /** Applique à l'unité en tête de file la réduction de retraite offerte
   *  dans son hex actuel (cf. `retreatReduction`). `auto` : appliquée
   *  d'office faute de retraite possible (cf. `settle`), pour la note.
   *  Renvoie `true` si une réduction a été appliquée. */
  function applyReduction(auto = false) {
    const task = queue.value[0]
    const unit = task && unitOf(task.id)
    const red = unit && reductionAt(task, unit, unit)
    if (!red) return false
    queue.value = [{ ...task, total: red.total }, ...queue.value.slice(1)]
    notes.value = [...notes.value,
      `${unit.name} : retraite réduite de ${task.total} à ${red.total} hex (${red.reason}${auto ? ', faute de retraite possible' : ''})`]
    return true
  }

  /** Bouton de la modale : le joueur propriétaire PREND la réduction de
   *  retraite offerte dans l'hex actuel de l'unité en cours. */
  function reduce() {
    if (!applyReduction()) return false
    settle()
    return true
  }

  /** Fait avancer la file jusqu'à une unité qui a VRAIMENT un pas à faire :
   *  on retire de la tête les retraites terminées, celles d'unités qui ne
   *  sont plus sur la carte, et celles devenues impossibles — l'unité est
   *  alors éliminée. Évalué au moment où vient le tour de chaque unité (et
   *  pas au lancement) : pour un résultat Br, l'attaquant retraite APRÈS le
   *  défenseur, dont la nouvelle position change sa ZOC. */
  function settle() {
    while (queue.value.length > 0) {
      const task = queue.value[0]
      const unit = unitOf(task.id)
      if (unit && task.done < task.total) {
        if (candidatesFor(task).length > 0) return
        // Mieux vaut une retraite raccourcie qu'une élimination : le joueur
        // prendrait forcément la réduction — on l'applique et on réévalue.
        if (applyReduction(true)) continue
        notes.value = [...notes.value, `${unit.name} ne peut pas retraiter : éliminé`]
        addPor(unit) // l'hex qu'elle occupait est libéré
        eliminateUnit(unit, 'retraite impossible')
      } else if (unit) {
        notes.value = [...notes.value, task.total === 0
          ? `${unit.name} reste en place (retraite annulée)`
          : `${unit.name} a retraité de ${task.total} hex`]
      }
      queue.value = queue.value.slice(1)
    }
    // Plus aucune retraite : place à l'avance après combat (s'il y a
    // quelque chose à faire, cf. `settleAdvance`).
    advancing.value = true
    settleAdvance()
  }

  /** Applique le résultat `code` d'un combat qui vient d'être résolu, selon
   *  l'effet que le module lui donne (cf. `resultEffect`). `attackers`/
   *  `defenders` : les pions du combat ; `targetHexes` : ses hex cibles
   *  ({ col, row }). Les éliminations sont immédiates ; les retraites sont
   *  mises en file (défenseurs d'abord) et se jouent ensuite au clic (cf.
   *  `step`). */
  function start(code, attackers, defenders, targetHexes) {
    clear()
    const effect = resultEffect(code) ?? {}
    const defenderHexes = effect.retreat?.defenders ?? 0
    const attackerHexes = effect.retreat?.attackers ?? 0
    const hitsDefenders = effect.eliminate === 'defenders' || defenderHexes > 0
    const hitsAttackers = effect.eliminate === 'attackers' || attackerHexes > 0
    // Vainqueurs (cf. l'en-tête) : le camp épargné, qui pourra avancer ensuite.
    const winners = !advanceAfterCombat ? []
      : hitsDefenders && !hitsAttackers ? attackers
        : hitsAttackers && !hitsDefenders ? defenders
          : []
    victorIds.value = new Set(winners.map((unit) => String(unit.id)))
    const defTasks = (hexCount) => defenders.map((defender) => ({
      id: defender.id, side: 'defender', initial: hexCount, total: hexCount, done: 0, refHexes: [{ col: defender.col, row: defender.row }],
    }))
    const atkTasks = (hexCount) => attackers.map((attacker) => ({
      id: attacker.id, side: 'attacker', initial: hexCount, total: hexCount, done: 0, refHexes: targetHexes.map((targetHex) => ({ col: targetHex.col, row: targetHex.row })),
    }))
    const eliminated = effect.eliminate === 'defenders' ? defenders : effect.eliminate === 'attackers' ? attackers : []
    for (const unit of eliminated) {
      notes.value = [...notes.value, `${unit.name} éliminé`]
      addPor(unit) // l'hex qu'elle occupait est libéré
      eliminateUnit(unit, `résultat ${code}`)
    }
    queue.value = [...(defenderHexes > 0 ? defTasks(defenderHexes) : []), ...(attackerHexes > 0 ? atkTasks(attackerHexes) : [])]
    settle()
  }

  /** Clic sur l'hex `h` ({ col, row }) pendant une retraite : si c'est l'un
   *  des hex proposés, l'unité en cours y avance d'un hex. Renvoie `true` si
   *  le clic a été utilisé. */
  function step(hex) {
    const task = current.value
    if (!task || !candidateKeys.value.has(keyOf(hex.col, hex.row))) return false
    const unit = unitOf(task.id)
    if (!unit) return false
    // Nouvel objet (et nouvelle file) plutôt qu'une mutation en place : les
    // computed qui en dépendent (`candidates`, `info`) sont ainsi recalculés.
    const next = { ...task, done: task.done + 1 }
    queue.value = [next, ...queue.value.slice(1)]
    addPor(unit) // l'hex qu'elle QUITTE entre dans le chemin de retraite
    moveUnit(unit, hex, { done: next.done, total: next.total })
    settle()
    return true
  }

  // --- Avance après combat ----------------------------------------------------

  /** `h` ({ col, row }) contient-il une unité, quelle qu'elle soit ? (Pas
   *  d'empilement pendant l'avance.) */
  const isOccupied = (hex) => counters.value.some((otherCounter) => isFighter(otherCounter) && otherCounter.col === hex.col && otherCounter.row === hex.row)

  /** `unit` peut-elle encore avancer ? Victorieuse, sur la carte, avance
   *  pas encore terminée. */
  function canStillAdvance(unit) {
    return !!unit && victorIds.value.has(String(unit.id)) && !doneIds.value.has(String(unit.id))
  }

  /** Hex où `unit` peut faire un pas d'avance : voisins de sa position, dans
   *  le POR, libres de toute unité, pas déjà visités par elle. Aucune
   *  vérification de ZOC (cf. l'en-tête). */
  function advanceStepsFor(unit) {
    if (!canStillAdvance(unit)) return []
    const seen = visited.value.get(String(unit.id))
    return neighborsOf(unit.col, unit.row).filter((neighbor) => {
      const key = keyOf(neighbor.col, neighbor.row)
      return por.value.has(key) && !seen?.has(key) && !isOccupied(neighbor)
    })
  }

  /** Unités victorieuses qui ont au moins un pas d'avance possible. */
  const advancers = computed(() => (advancing.value ? counters.value.filter((unit) => advanceStepsFor(unit).length > 0) : []))

  const advancer = computed(() => (advancerId.value == null ? null : unitOf(advancerId.value)))

  /** Hex proposés (vert vif) pour le prochain pas de l'unité choisie. */
  const advanceCandidates = computed(() => (advancing.value && advancer.value ? advanceStepsFor(advancer.value) : []))
  const advanceKeys = computed(() => new Set(advanceCandidates.value.map((hex) => keyOf(hex.col, hex.row))))

  /** L'unité choisie a-t-elle déjà avancé d'au moins un hex ? */
  const hasAdvanced = (id) => (visited.value.get(String(id))?.size ?? 0) > 1

  /** Termine l'avance de l'unité choisie (si elle a bougé : elle ne pourra
   *  plus la reprendre) et la désélectionne. */
  function releaseAdvancer() {
    const id = advancerId.value
    if (id != null && hasAdvanced(id)) doneIds.value = new Set(doneIds.value).add(String(id))
    advancerId.value = null
  }

  /** Ferme l'avance dès que plus aucune unité ne peut avancer — sauf si
   *  l'unité choisie peut encore bouger. */
  function settleAdvance() {
    if (!advancing.value) return
    if (advanceCandidates.value.length > 0) return
    releaseAdvancer()
    if (advancers.value.length === 0) endAdvance()
  }

  /** Clic sur l'unité `unit` pendant l'avance : la choisit (ou la
   *  désélectionne si elle l'était déjà). Renvoie `true` si le clic a servi. */
  function selectAdvancer(unit) {
    if (!advancing.value || !unit) return false
    if (String(advancerId.value) === String(unit.id)) { releaseAdvancer(); settleAdvance(); return true }
    if (advanceStepsFor(unit).length === 0) return false
    releaseAdvancer()
    advancerId.value = unit.id
    // Point de départ de son avance : "visité", pour ne jamais y revenir.
    if (!visited.value.has(String(unit.id))) {
      visited.value = new Map(visited.value).set(String(unit.id), new Set([keyOf(unit.col, unit.row)]))
    }
    return true
  }

  /** Clic sur l'hex `h` ({ col, row }) pendant l'avance : l'unité choisie y
   *  avance d'un hex s'il fait partie des hex proposés. */
  function stepAdvance(hex) {
    const unit = advancer.value
    const key = keyOf(hex.col, hex.row)
    if (!unit || !advanceKeys.value.has(key)) return false
    const id = String(unit.id)
    visited.value = new Map(visited.value).set(id, new Set(visited.value.get(id)).add(key))
    advanceUnit(unit, hex)
    settleAdvance()
    return true
  }

  /** Fin de l'avance après combat (bouton de la modale, ou plus rien à
   *  faire). */
  function endAdvance() {
    const moved = [...visited.value.entries()].filter(([, visitedHexes]) => visitedHexes.size > 1)
    for (const [id, visitedHexes] of moved) {
      const unit = unitOf(id)
      if (unit) notes.value = [...notes.value, `${unit.name} a avancé de ${visitedHexes.size - 1} hex`]
    }
    advancing.value = false
    advancerId.value = null
    por.value = new Set()
  }

  /** Abandonne tout (nouveau combat, changement de phase, rechargement d'un
   *  journal). */
  function clear() {
    queue.value = []
    notes.value = []
    por.value = new Set()
    victorIds.value = new Set()
    advancing.value = false
    advancerId.value = null
    visited.value = new Map()
    doneIds.value = new Set()
  }

  watch(phase, clear, { flush: 'sync' })

  /** L'hex `h` ({ c, r }, format des hex de HexMap.vue) est-il proposé comme
   *  destination de retraite ? */
  const isRetreatHex = (hex) => candidateKeys.value.has(keyOf(hex.c, hex.r))

  /** L'hex `h` est-il celui de l'unité en train de retraiter ? */
  const isRetreatingHex = (hex) => {
    const unit = current.value && unitOf(current.value.id)
    return !!unit && unit.col === hex.c && unit.row === hex.r
  }

  /** Surlignages de l'avance (format { c, r } des hex de HexMap.vue) :
   *  chemin de retraite (vert), hex où l'unité choisie peut avancer (vert
   *  vif, cliquables), hex des unités qui peuvent avancer (contour vert). */
  const isPorHex = (hex) => por.value.has(keyOf(hex.c, hex.r))
  const isAdvanceHex = (hex) => advanceKeys.value.has(keyOf(hex.c, hex.r))
  const isAdvancerHex = (hex) => advancers.value.some((unit) => unit.col === hex.c && unit.row === hex.r)
    || (!!advancer.value && advancer.value.col === hex.c && advancer.value.row === hex.r)

  /** Infos de l'avance pour la modale — `null` hors phase d'avance. */
  const advanceInfo = computed(() => (advancing.value
    ? { name: advancer.value?.name ?? null, count: advancers.value.length }
    : null))

  return {
    start, step, reduce, clear, active, retreating, info, notes, isRetreatHex, isRetreatingHex,
    advancing, advanceInfo, selectAdvancer, stepAdvance, endAdvance, isPorHex, isAdvanceHex, isAdvancerHex,
  }
}
