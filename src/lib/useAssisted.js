// ═══════════════════════════════════════════════════════════════════════════
// useAssisted — logique du mode "Assisté" vs mode "Libre"
// ═══════════════════════════════════════════════════════════════════════════
//
// Ce composable centralise TOUTES les règles qui différencient les deux
// modes de partie proposés dans LocalGameSetup.vue (paramètre `party`) :
//
//   • Mode "Libre"   (assisted = false, valeur PAR DÉFAUT)
//       → un vrai bac à sable, sans aucun garde-fou :
//         - la grille hexagonale est toujours masquée,
//         - les pions ne sont sélectionnables qu'au glisser-déposer
//           (un simple clic ne les sélectionne pas),
//         - aucune restriction de tour : n'importe quel camp peut
//           déplacer n'importe quel pion à tout moment.
//       C'est le mode pensé pour rejouer une partie librement, sans que
//       l'appli n'impose les règles du jeu.
//
//   • Mode "Assisté" (assisted = true)
//       → l'appli ajoute des garde-fous, mais ils restent OPT-IN
//         (l'utilisateur peut les activer/désactiver au fil de la partie) :
//         - la grille peut être affichée/masquée via une case à cocher,
//         - les pions deviennent sélectionnables au clic (affichage d'un
//           contour vert autour du pion sélectionné),
//         - le déplacement d'un pion est restreint au camp dont c'est le
//           tour, en s'appuyant sur le composant TurnTracker.vue (le
//           tracker de tour affiché dans HexMap.vue) qui sait quelles
//           factions sont "actives" au pas courant,
//         - CHAQUE camp actif joue en 2 PHASES successives, Mouvement puis
//           Combat (cf. section "Phases" plus bas), matérialisées par 2
//           marqueurs sous la piste de tour dans TurnTracker.vue,
//         - chaque pion ne peut entrer dans un hex que s'il lui reste assez
//           de POINTS DE MOUVEMENT (MP) pour payer le COÛT DE TERRAIN (COT)
//           de cet hex (cf. section "Points de mouvement" plus bas),
//         - une RIVIÈRE est infranchissable pour TOUT LE MONDE sauf par un
//           PONT (canal/chemin de fer/route, sans surcoût) ou, pour les
//           unités NON motorisées/blindées, par un BAC (+3 MP, comme un gué
//           de ruisseau) — cf. `canEnterTerrain`/`terrainCost`, section
//           "Points de mouvement",
//         - les véhicules (blindés, reconnaissance, mécanisés, artillerie
//           automotrice) ne peuvent PAS entrer dans un hex rough/broken/
//           woods ("forest"), quel que soit leur MP restant, SAUF par une
//           route/piste/pont précis ; ils ne peuvent traverser un ruisseau
//           QUE par une route/piste (jamais à gué), ni une rivière QUE par
//           un pont (jamais par bac) — même section,
//         - traverser à gué un ruisseau SANS route/piste, ou une rivière PAR
//           BAC (les unités non motorisées/blindées le peuvent, contrairement
//           aux véhicules ci-dessus) coûte le COT de l'hex d'arrivée + 3 MP
//           (cf. `terrainCost`, même section),
//         - ZONE DE CONTRÔLE (ZOC, cf. section dédiée plus bas) : un pion
//           qui commence son tour dans la ZOC d'un pion ennemi ne peut pas
//           bouger du tout ; un pion qui ENTRE dans une ZOC ennemie doit s'y
//           arrêter (aucun déplacement supplémentaire ce tour-ci),
//         - CONGESTION DES HEX D'ENTRÉE (cf. section dédiée plus bas) : un
//           renfort qui entre sur un hex de bord de carte (`setup` "ref
//           seule" ou "plage", jamais "+adj") paie le coût de cet hex ; si un
//           AUTRE renfort entre par ce MÊME hex ce MÊME tour, le coût
//           double, triple, etc. — cf. `entryCost`/`spendEntryCost`,
//         - PHASE AIRBORNE (cf. section "Phase Airborne" plus bas) : un camp
//           qui a des unités aéroportées à faire entrer en jeu (ce tour-ci
//           ou restées des tours précédents) commence son tour par une
//           phase dédiée à leur placement, AVANT le Mouvement.
//
// Une SEULE famille de règles du mode Assisté ne vit pas dans ce fichier :
// le COMBAT (désignation d'un défenseur et de ses attaquants en phase
// Combat, table de combat, jet de dé), qui forme un bloc autonome et a son
// propre fichier, lib/useCombat.js — il ne partage avec le mouvement que
// `canControl` (à quel camp appartient ce pion) et `combatEdgeKind` (nature
// d'un hexside), que ce fichier lui exporte.
//
// Pourquoi un composable séparé plutôt que de mettre ce code directement
// dans HexMap.vue ? Pour que toute la logique de bascule Libre/Assisté
// reste au même endroit, facile à relire et à faire évoluer, sans polluer
// le composant HexMap (déjà volumineux) avec des `if (assisted.value)`
// éparpillés un peu partout.
//
// Paramètres reçus par le composable :
//   - `assisted` : ref/computed booléen réactif (ex. `toRef(props, 'assisted')`
//     côté HexMap.vue) qui indique si la partie tourne en mode Assisté.
//   - `turnTrackerRef` : ref pointant vers l'INSTANCE du composant enfant
//     TurnTracker.vue. On l'utilise pour appeler ses méthodes/valeurs
//     exposées :
//       • `canControl(counter)` fait autorité sur "quel camp peut jouer ce
//         pion maintenant" (cf. TurnTracker.vue). Si le module de jeu ne
//         définit pas de config de tours, TurnTracker.canControl() autorise
//         tout par défaut — donc même en mode Assisté, l'absence de config
//         de tour ne bloque rien.
//       • `nextTurn()` fait avancer le pas courant (camp suivant, et donc
//         éventuellement tour suivant) — normalement déclenché par un clic
//         dans TurnTracker.vue, mais qu'on doit pouvoir déclencher NOUS
//         MÊMES depuis ce composable (cf. section "Phases" plus bas) quand
//         la phase Combat se termine.
//       • `currentStep` / `isLastSideOfTurn` sont des valeurs exposées en
//         lecture, utilisées respectivement pour détecter un changement de
//         camp/tour (remise à zéro de la phase — et, cf. plus bas, des MP de
//         TOUTES les unités) et pour choisir le libellé du bouton "suivant".
//       • `currentTurn` (numéro de tour) sert à remettre à zéro la
//         congestion des hex d'entrée (cf. section dédiée plus bas) à chaque
//         NOUVEAU TOUR — contrairement à `spentMp`, PAS à chaque changement
//         de camp (`currentStep`) : "le même tour" y couvre les deux camps.
//   - `terrain` : `module.terrain` (JSON du module, ex. arnhem.json) —
//     `{ types: { [clé]: { label, mp } }, grid: { [id d'hex "CCRR"]: clé },
//     roads: ["AAAA-BBBB", ...], trails: [...], streams: [...],
//     rivers: [...], ferries: [...], canalBridges: [...],
//     railroadBridges: [...], highwayBridges: [...] }`. Tous, hormis
//     `types`/`grid`, sont des listes d'ARÊTES (paires d'hex adjacents
//     précises, pas juste "cet hex est une route/un cours d'eau") : cf.
//     section "Points de mouvement" plus bas pour leur usage. Peut être
//     absent (modules pas encore enrichis en terrain) : dans ce cas, tout
//     hex coûte 1 MP par défaut, sans bonus/malus d'aucune sorte.
//   - `counters` : ref/computed du tableau des pions actuellement POSÉS sur
//     la carte (cf. HexMap.vue::counters — pas les renforts pas encore
//     posés, ni les pions éliminés). Sert à la ZOC (section dédiée plus bas)
//     pour savoir où se trouvent les pions ennemis, et à l'empilement
//     (section dédiée aussi) pour savoir où se trouvent les pions AMIS.
//   - `sides` : `module.sides` (ex. { german: ["german"], allies:
//     ["commonwealth","us","pol"] }) — même regroupement camp/factions que
//     celui donné à TurnTracker.vue. Sert à déterminer si deux pions sont
//     ennemis (camps différents) ou amis (même camp), pour la ZOC ET
//     l'empilement. Peut être absent (repli sur une simple comparaison de
//     faction, cf. `isEnemyOf`).
//   - `hexOnMap` : fonction `(col, row) => bool` (cf. HexMap.vue::hexOnMap)
//     — un hex existe-t-il bien sur la carte à cette position ? Sert
//     uniquement à `canLeaveAfterEntering` (section "Empilement" plus bas)
//     pour ignorer les voisins hors carte lors de la recherche d'une case de
//     repli.
//   - `getReinforcements` : fonction `() => [pions]` (cf.
//     HexMap.vue::reinforcements) — renforts PAS ENCORE posés ni éliminés.
//     Une FONCTION (et non la liste elle-même) parce que HexMap.vue la
//     calcule APRÈS avoir appelé ce composable : elle n'est lue qu'au moment
//     où on en a besoin (début du tour d'un camp, cf. `airbornePending`).
//     Sert uniquement à la phase Airborne.
import { computed, ref, watch } from 'vue'
import { hexId } from './calibration.js'
import { neighborsOf } from './hex.js'

/** Construit, une seule fois, l'ensemble des arêtes route/piste/ruisseau
 *  d'un module sous forme de clés "hexIdA-hexIdB" ET "hexIdB-hexIdA" (les
 *  deux sens : le JSON ne liste chaque arête qu'une fois, dans un ordre
 *  arbitraire, alors qu'on doit pouvoir la retrouver en avançant comme en
 *  reculant dessus). `list` : `terrain.roads`, `terrain.trails` ou
 *  `terrain.streams` (tableau de "AAAA-BBBB"). */
function buildEdgeSet(list) {
  const set = new Set()
  for (const edge of list ?? []) {
    const [hexIdA, hexIdB] = edge.split('-')
    set.add(hexIdA + '-' + hexIdB)
    set.add(hexIdB + '-' + hexIdA)
  }
  return set
}

// Unités motorisées/blindées (`c.type`, cf. arnhem.json) auxquelles le
// terrain accidenté est interdit d'accès — cf. `canEnterTerrain` plus bas.
// "self-propelled arty" : l'artillerie automotrice, distincte de l'artillerie
// tractée/à pied ("arty"), qui n'est PAS concernée par cette restriction.
const VEHICLE_TYPES = new Set(['armor', 'reconnaissance', 'mechanized', 'self-propelled arty'])

// Types de terrain (clés de `terrain.grid`/`terrain.types`, cf. arnhem.json)
// fermés aux véhicules ci-dessus, quel que soit leur MP restant — un blocage
// de TERRAIN, pas un simple coût. "woods" est la clé du module pour ce que
// la règle de jeu appelle "forest" — aucun module ne déclare de clé "forest"
// à ce jour.
const IMPASSABLE_FOR_VEHICLES = new Set(['rough', 'broken', 'woods'])

// Surcoût (en MP) pour traverser À GUÉ un hexside de ruisseau
// (`terrain.streams`) SANS route/piste dessus, OU une rivière
// (`terrain.rivers`) SANS pont, PAR BAC (`terrain.ferries`) — cf.
// `terrainCost`/`canEnterTerrain` plus bas. S'AJOUTE au coût normal de l'hex
// d'arrivée (ex. 2 MP de terrain + 3 = 5), il ne le remplace pas. Même
// valeur pour les deux cas (movement-chart.png : "Stream +3 MP", "Ferry +3
// MP").
const WATER_CROSSING_PENALTY = 3

export function useAssisted(assisted, turnTrackerRef, terrain, counters, sides, hexOnMap, getReinforcements) {
  // Arêtes route/piste/ruisseau/rivière/pont/bac du module, construites une
  // seule fois (cf. buildEdgeSet ci-dessus) — `terrain` ne change pas en
  // cours de partie, inutile de les reconstruire à chaque appel de
  // `terrainCost`. 3 SORTES de pont (canal/chemin de fer/route) déclarées
  // séparément dans le JSON (cf. arnhem.json) mais traitées ICI de façon
  // identique (cf. `isBridgeEdge` plus bas) : peu importe LEQUEL, un pont
  // permet toujours de franchir sans surcoût, pour tout le monde.
  const roadEdges = buildEdgeSet(terrain?.roads)
  const trailEdges = buildEdgeSet(terrain?.trails)
  const streamEdges = buildEdgeSet(terrain?.streams)
  const riverEdges = buildEdgeSet(terrain?.rivers)
  const ferryEdges = buildEdgeSet(terrain?.ferries)
  const canalBridgeEdges = buildEdgeSet(terrain?.canalBridges)
  const railroadBridgeEdges = buildEdgeSet(terrain?.railroadBridges)
  const highwayBridgeEdges = buildEdgeSet(terrain?.highwayBridges)

  /** `edgeKey` (déjà au format "hexIdA-hexIdB") correspond-elle à un pont,
   *  quel qu'en soit le type (canal, chemin de fer, route/highway) ? */
  function isBridgeEdge(edgeKey) {
    return canalBridgeEdges.has(edgeKey) || railroadBridgeEdges.has(edgeKey) || highwayBridgeEdges.has(edgeKey)
  }

  // Ensembles ("hexId", ex. "0106") de tous les hex touchés par AU MOINS une
  // route/piste, quel que soit le voisin de l'autre côté — construits une
  // seule fois à partir de `roadEdges`/`trailEdges` (qui stockent déjà
  // chaque arête dans les 2 sens, donc un simple `.split('-')[0]` sur
  // chaque entrée finit par lister les deux extrémités de chaque arête).
  // Sert UNIQUEMENT à `entryBaseCost` plus bas : une unité qui ENTRE EN JEU
  // n'a pas de "from" (elle vient de "hors carte"), on ne peut donc pas
  // demander "quelle est la nature de l'arête from->h" comme le fait
  // `terrainCost` pour un déplacement classique — on demande juste "cet hex
  // est-il DESSERVI par une route/piste, peu importe par où".
  const roadTouchedHexes = new Set([...roadEdges].map((edgeKey) => edgeKey.split('-')[0]))
  const trailTouchedHexes = new Set([...trailEdges].map((edgeKey) => edgeKey.split('-')[0]))

  // --- Affichage de la grille hexagonale -----------------------------------
  // `showGridPref` mémorise la PRÉFÉRENCE de l'utilisateur (case cochée ou
  // non), indépendamment du mode de partie. On la garde séparée de
  // `showGrid` pour ne pas perdre ce choix si jamais le mode passe de
  // Assisté à Libre puis repasse à Assisté (la préférence est conservée,
  // seul son EFFET est neutralisé hors mode Assisté).
  const showGridPref = ref(true)

  // `showGrid` est la valeur réellement utilisée par le template (HexMap.vue
  // l'utilise à la fois pour afficher/masquer la grille et pour piloter la
  // case à cocher correspondante, désactivée hors mode Assisté).
  const showGrid = computed({
    // Lecture : la grille n'est visible que si on est en mode Assisté ET
    // que l'utilisateur a coché la case. En mode Libre, on renvoie
    // toujours `false`, quelle que soit la préférence mémorisée : la
    // grille reste masquée sans exception.
    get: () => assisted.value && showGridPref.value,
    // Écriture : on ignore toute tentative de cocher/décocher la case si
    // on n'est pas en mode Assisté. Concrètement, HexMap.vue désactive déjà
    // la case à cocher (`:disabled="!assisted"`) hors mode Assisté, donc ce
    // garde-fou est une sécurité supplémentaire plutôt qu'un chemin normal.
    set: (visible) => { if (assisted.value) showGridPref.value = visible },
  })

  // --- Sélection des pions au clic ------------------------------------------
  // En mode Assisté, un clic sur un pion le sélectionne (contour vert).
  // En mode Libre, cette interaction est désactivée : seul le
  // glisser-déposer permet de déplacer un pion, pour rester au plus près
  // d'un vrai bac à sable sans "aide" de l'interface.
  const selectable = computed(() => assisted.value)

  // --- Glisser-déposer des UNITÉS (entrée en jeu et déplacement) -------------
  // Miroir exact de `selectable` ci-dessus, pour que les 2 modes restent
  // mutuellement exclusifs sur la façon de jouer un pion — jamais les deux
  // façons de faire disponibles en même temps :
  //   - Mode Libre   : `draggable` vrai, `selectable` faux — seul le
  //     glisser-déposer fonctionne (aucune sélection au clic).
  //   - Mode Assisté : `draggable` faux, `selectable` vrai — un pion (déjà
  //     sur la carte, ou un renfort pas encore posé) ne peut plus être
  //     glissé du tout ; la SEULE façon de le faire entrer en jeu ou de le
  //     déplacer est le clic (sélection au clic, puis clic sur l'hex de
  //     destination — cf. onHex/onCounterSelect/onReinforcementSelect dans
  //     HexMap.vue, déjà en place et inchangés par cette règle).
  //
  // Exemption : les pions de soutien (kind: 'support', cf. SupportTracker.vue)
  // restent glissables dans les DEUX modes — ce sont une ressource commune,
  // pas rattachée à un camp ni à un tour (cf. déjà `canControl` ci-dessus,
  // et le guard `kind !== 'support'` dans HexMap.vue::onCounterDragStart qui
  // applique concrètement cette valeur).
  const draggable = computed(() => !assisted.value)

  // --- Restriction de mouvement par camp actif -------------------------------
  // `canControl(c)` répond à la question : "le camp dont c'est le tour
  // a-t-il le droit de contrôler (sélectionner/déplacer) ce pion `c` ?"
  //
  // Cette fonction est appelée par HexMap.vue à chaque tentative de
  // sélection ou de déplacement (clic, début de glisser-déposer, drop).
  function canControl(counter) {
    // Hors mode Assisté (mode Libre), aucune restriction : tout pion est
    // contrôlable par n'importe qui, à tout moment.
    if (!assisted.value) return true

    // En mode Assisté, on délègue la décision à TurnTracker.vue, qui
    // connaît le camp actif du tour en cours et les factions qui lui sont
    // rattachées. Le `?? true` couvre le cas où `turnTrackerRef.value`
    // n'est pas encore monté (ex. tout premier rendu) : par défaut, on
    // n'empêche rien plutôt que de bloquer l'interface sur une ref pas
    // encore prête.
    return turnTrackerRef.value?.canControl(counter) ?? true
  }

  // --- Phases Mouvement / Combat / Fin de tour --------------------------------
  // En mode Assisté, chaque camp actif (déterminé par TurnTracker.vue) joue
  // son tour en 2 PHASES successives et obligatoires : d'abord Mouvement,
  // puis Combat. Concrètement, ça se traduit par 2 marqueurs affichés sous
  // la piste de tour (cf. TurnTracker.vue), et par UN SEUL bouton "suivant"
  // qui, selon où on en est, déclenche l'une de ces 4 actions :
  //
  //   1. Mouvement → Combat          (même camp, même tour)   — "Nouvelle phase"
  //   2. Combat → Mouvement          (camp SUIVANT, même tour) — "Autre joueur"
  //   3. Combat → Fin de tour        (camp = DERNIER de l'ordre, même tour) — "Fin de tour"
  //   4. Fin de tour → Mouvement     (1er camp de l'ordre → tour+1) — "Nouveau tour"
  //
  // Exemple concret (2 camps, ordre [allies, german], german DERNIER de
  // l'ordre) :
  //   Tour 1 Alliés Mouvement → Tour 1 Alliés Combat → Tour 1 Allemands
  //   Mouvement → Tour 1 Allemands Combat → Tour 1 FIN DE TOUR → Tour 2
  //   Alliés Mouvement → ...
  //
  // "Fin de tour" (cas 3-4 ci-dessus) n'existe donc QUE pour le DERNIER camp
  // de l'ordre (cf. `turnTrackerRef.value?.isLastSideOfTurn`, German dans
  // Arnhem) : c'est une phase du TOUR entier (les deux camps confondus), pas
  // d'un camp en particulier — les camps qui ne sont pas derniers de l'ordre
  // passent directement de Combat au Mouvement du camp suivant (cas 2,
  // inchangé). C'est pour ça que `phaseLabels` ci-dessous n'affiche ce 3e
  // marqueur QUE pendant le tour du dernier camp — pas de marqueur "mort"
  // affiché sans effet pendant le tour des autres camps.
  //
  // Cas 2 et 4 ci-dessus correspondent tous les deux à un changement de
  // camp actif (le 2e boucle en plus sur l'ordre des camps, ce qui fait
  // mécaniquement avancer le numéro de tour, cf. TurnTracker.vue::
  // currentTurn, dérivé du pas courant) — le camp actif et le tour sont donc
  // TOUJOURS gérés par TurnTracker.vue (son `nextTurn()`, appelé ci-dessous)
  // ; ce composable ne fait QUE superposer une phase locale (0, 1 ou 2)
  // par-dessus ce pas.

  // 0 = Mouvement, 1 = Combat, 2 = Fin de tour (dernier camp de l'ordre
  // uniquement, cf. ci-dessus), et PHASE_AIRBORNE (-1) = phase Airborne, qui
  // PRÉCÈDE le Mouvement quand elle existe (cf. section suivante).
  const phaseStep = ref(0)

  // --- Phase Airborne (avant le Mouvement) -----------------------------------
  // Règle : si le camp actif a des unités AÉROPORTÉES à faire entrer en jeu
  // — celles de CE tour, ou celles restées hors carte des tours précédents —
  // son tour commence par une phase "Airborne", AVANT le Mouvement. Elle ne
  // sert qu'à POSER ces unités sur la carte (par clic, sur leur DZ ou un hex
  // voisin — `setup` "+adj", cf. HexMap.vue::entryHexSet) :
  //   - on n'y déplace AUCUNE unité : un pion déjà posé ne peut pas être
  //     sélectionné (cf. HexMap.vue::onCounterSelect) ;
  //   - une unité posée n'est PAS sélectionnée ensuite (contrairement à un
  //     renfort posé en phase Mouvement, qui l'est pour enchaîner sur son
  //     mouvement, cf. HexMap.vue::onHex) ;
  //   - un aéroporté n'atterrit que sur un hex VIDE de toute unité, amie ou
  //     ennemie — 1 unité par hex (cf. HexMap.vue::airborneLandingBlocked) ;
  //   - seuls les aéroportés y sont plaçables ; à l'inverse, un aéroporté ne
  //     peut plus être posé dans les autres phases — ceux qui restent hors
  //     carte attendent la phase Airborne du prochain tour de ce camp (cf.
  //     `canPlaceReinforcementNow`).
  // On passe au Mouvement par le bouton "suivant" (cf. `advance`), jamais
  // automatiquement — même une fois tous les aéroportés posés. Aucun
  // blocage : on peut passer au Mouvement en en laissant hors carte.
  //
  // Valeur NÉGATIVE (-1) plutôt que de décaler les autres phases : 0/1/2
  // gardent ainsi le sens qu'elles ont partout ailleurs (lib/useCombat.js,
  // HexMap.vue, entrées `phase` des journaux déjà enregistrés).
  const PHASE_AIRBORNE = -1

  // Vrai si le tour du camp actif a COMMENCÉ par une phase Airborne. Sert
  // uniquement à l'affichage (cf. `phaseLabels`/`phaseIndex`) : le marqueur
  // "Airborne" reste affiché (éteint) une fois passé au Mouvement.
  const airborneThisStep = ref(false)

  /** `c` est-il une unité AÉROPORTÉE ? Même critère que partout ailleurs
   *  (cf. HexMap.vue::onHex, coût d'entrée) : son `setup` se termine par
   *  "+adj" — il entre en jeu sur sa DZ ou l'un des 6 hex voisins. */
  function isAirborne(counter) {
    return !!counter?.setup?.endsWith('+adj')
  }

  /** Le camp actif a-t-il au moins un aéroporté à poser ? Il faut qu'il ne
   *  soit ni sur la carte ni éliminé (cf. `getReinforcements`), qu'il soit à
   *  ce camp (cf. `canControl`) et que son tour d'arrivée soit atteint (ce
   *  tour-ci ou un tour précédent — `currentTurn` lu sur TurnTracker.vue, à
   *  jour immédiatement, contrairement à HexMap.vue::turnInfo). Toujours
   *  faux hors mode Assisté. */
  function airbornePending() {
    if (!assisted.value) return false
    const turn = turnTrackerRef.value?.currentTurn ?? 1
    return (getReinforcements?.() ?? []).some((counter) => isAirborne(counter) && canControl(counter) && (counter.turn ?? 1) <= turn)
  }

  /** Début du tour d'un camp : phase Airborne s'il a des aéroportés à poser
   *  (cf. `airbornePending`), sinon directement Mouvement. Appelée :
   *   - à chaque changement de camp/tour (watcher de `currentStep` plus bas) ;
   *   - au lancement de la partie (cf. HexMap.vue, `onMounted` -> `initPhase`,
   *     aucun changement de pas n'ayant alors eu lieu) ;
   *   - au début d'un rejeu de journal (cf. `resetTurnState`).
   *  Au rejeu, le résultat est le même qu'en jeu : à l'entrée `turn`, les
   *  aéroportés posés PENDANT ce tour ne sont pas encore rejoués. */
  function startSidePhase() {
    phaseStep.value = airbornePending() ? PHASE_AIRBORNE : 0
    airborneThisStep.value = phaseStep.value === PHASE_AIRBORNE
  }

  /** Le renfort `c` peut-il être posé DANS LA PHASE EN COURS ? En phase
   *  Airborne, uniquement les aéroportés ; dans toute autre phase,
   *  uniquement les NON aéroportés (cf. règle ci-dessus). Le tour d'arrivée
   *  et le camp sont vérifiés à part (cf. HexMap.vue::canEnterThisTurn/
   *  `canControl`). Toujours vrai hors mode Assisté. */
  function canPlaceReinforcementNow(counter) {
    if (!assisted.value) return true
    return phaseStep.value === PHASE_AIRBORNE ? isAirborne(counter) : !isAirborne(counter)
  }

  // MP déjà dépensés ce tour-ci, par unité : Map id -> nombre de MP
  // consommés jusqu'ici. Déclaré ici (avant le watcher juste en dessous) car
  // ce même watcher le remet à zéro en même temps que la phase — cf. section
  // "Points de mouvement" plus bas pour son utilisation complète.
  const spentMp = ref(new Map())

  // `phase` n'existe (au sens de l'UI) qu'en mode Assisté : hors de ce
  // mode, on expose `null` pour que TurnTracker.vue sache qu'il doit
  // revenir à son affichage historique (pas de ligne "phases", bouton
  // "suivant" en bout de piste de tour, cf. TurnTracker.vue::props.phase).
  const phase = computed(() => (assisted.value ? phaseStep.value : null))

  // Libellés des marqueurs de la ligne "phases" (cf. TurnTracker.vue, qui ne
  // fait qu'afficher CETTE liste en surlignant l'entrée d'index `phase`,
  // sans connaître elle-même le sens de "Fin de tour"). 2 marqueurs pour un
  // camp qui n'est pas le dernier de l'ordre (Mouvement/Combat, comme
  // avant) ; 3 pour le DERNIER camp de l'ordre (German dans Arnhem), qui
  // seul voit sa phase Combat suivie d'une "Fin de tour" (cf. section
  // ci-dessus pour le détail des 4 transitions).
  const phaseLabels = computed(() => {
    if (!assisted.value) return []
    const labels = ['Mouvement', 'Combat']
    if (turnTrackerRef.value?.isLastSideOfTurn) labels.push('Fin de tour')
    // Tour commencé par une phase Airborne : son marqueur en tête.
    if (airborneThisStep.value) labels.unshift('Airborne')
    return labels
  })

  // Index du marqueur ALLUMÉ dans `phaseLabels` (cf. TurnTracker.vue, prop
  // `phaseIndex`) : égal à la phase, décalé de 1 quand le marqueur
  // "Airborne" occupe la 1re place (-1 -> 0, 0 -> 1, 1 -> 2...). `null`
  // hors mode Assisté.
  const phaseIndex = computed(() => {
    if (!assisted.value) return null
    return phaseStep.value + (airborneThisStep.value ? 1 : 0)
  })

  // Dès que le camp/tour actif change — que ce soit via NOTRE propre appel
  // à `nextTurn()` plus bas, via une synchronisation multijoueur
  // (`applyRemoteTurn`, piloté par le serveur), ou via un rejeu de journal
  // — on repart forcément en phase Mouvement : une phase Combat n'a de
  // sens que pour le camp qui vient de jouer son Mouvement, jamais pour un
  // camp qui n'a pas encore agi à ce tour. Le même changement de pas remet
  // aussi à zéro les MP dépensés par TOUTES les unités (cf. `spentMp` plus
  // bas) : les points de mouvement ne se reportent jamais d'un tour/camp
  // sur l'autre, chacun reparties avec son plein potentiel de MP.
  //
  // Techniquement, on observe `turnTrackerRef.value?.currentStep` : Vue
  // traque cette dépendance à travers la ref du template ET la valeur
  // exposée par l'instance enfant, donc ce watcher se redéclenche bien à
  // chaque changement de pas, d'où qu'il vienne.
  //
  // `flush: 'sync'` : le watcher s'exécute IMMÉDIATEMENT au changement de
  // pas, et non plus "un peu plus tard" (au prochain cycle de rendu, le
  // comportement par défaut de Vue). Indispensable pour le REJEU du journal
  // (cf. HexMap.vue::fastForwardReplay) : l'avance rapide applique d'une
  // traite "changement de tour" PUIS "passage en phase Combat" PUIS "MP
  // dépensés"... Avec un watcher différé, cette remise à zéro serait arrivée
  // APRÈS coup et aurait écrasé la phase et les MP que le rejeu venait tout
  // juste de rétablir (cf. `setPhase`/`setSpentMp` plus bas).
  watch(() => turnTrackerRef.value?.currentStep, () => {
    // Phase Airborne si le nouveau camp actif a des aéroportés à poser,
    // sinon Mouvement (cf. `startSidePhase`).
    startSidePhase()
    spentMp.value = new Map()
  }, { flush: 'sync' })

  // Nombre d'unités déjà ENTRÉES EN JEU ce TOUR-CI par hex d'entrée ("col,row"
  // -> compteur) — cf. section "Congestion des hex d'entrée" plus bas. Remis
  // à zéro à chaque nouveau NUMÉRO DE TOUR (pas à chaque changement de camp
  // comme `spentMp` ci-dessus : "le même tour" au sens de cette règle couvre
  // les deux camps qui s'y relaient, cf. TurnTracker.vue::currentTurn).
  const entryCounts = ref(new Map())

  // Pour chaque pion actuellement compté dans `entryCounts` : par quel hex
  // il est entré (id du pion -> clé "col,row") — permet à `unspendEntryCost`
  // de décrémenter le BON compteur si ce pion est "replacé" aux renforts
  // avant la fin du tour (cf. HexMap.vue::returnCounterToReinforcements).
  // Remis à zéro EN MÊME TEMPS que `entryCounts` (même watcher juste
  // en-dessous) : un pion replacé un tour PLUS TARD ne doit rien
  // décrémenter, sa propre entrée ne comptait de toute façon plus dans la
  // congestion d'un tour aussi ancien.
  const entryHexByUnit = ref(new Map())

  // `flush: 'sync'` pour la même raison que le watcher de `currentStep`
  // plus haut : au rejeu rapide du journal, les entrées en jeu rejouées
  // juste après un changement de tour rétablissent la congestion (cf.
  // HexMap.vue::applyReplayEntry) — un watcher différé l'effacerait ensuite.
  watch(() => turnTrackerRef.value?.currentTurn, () => {
    entryCounts.value = new Map()
    entryHexByUnit.value = new Map()
  }, { flush: 'sync' })

  // Libellé affiché SUR le bouton "suivant" de la ligne "phases", pour que
  // l'utilisateur sache toujours à l'avance ce que le prochain clic va
  // déclencher (cf. les 3 cas listés plus haut). `null` hors mode Assisté :
  // TurnTracker.vue retombe alors sur son titre par défaut ("Tour suivant").
  const nextLabel = computed(() => {
    if (!assisted.value) return null
    // Airborne -> Mouvement, ou Mouvement -> Combat : même camp, même tour.
    if (phaseStep.value === PHASE_AIRBORNE || phaseStep.value === 0) return 'Nouvelle phase'
    if (phaseStep.value === 1) {
      // Dernier camp de l'ordre (German) : la Combat ne rend plus la main
      // directement au camp suivant, elle ouvre d'abord la Fin de tour
      // (cas 3 ci-dessus) — les autres camps gardent le comportement
      // historique (cas 2).
      return turnTrackerRef.value?.isLastSideOfTurn ? 'Fin de tour' : 'Autre joueur'
    }
    // phaseStep === 2 : Fin de tour, uniquement atteignable pour le dernier
    // camp de l'ordre (cf. `advance` ci-dessous) — le clic suivant boucle
    // forcément sur le 1er camp de l'ordre, donc sur un nouveau tour.
    return 'Nouveau tour'
  })

  // Gestionnaire de clic pour le bouton "suivant" de la ligne "phases"
  // (branché sur l'évènement `phase-next` émis par TurnTracker.vue — cf.
  // ce fichier, qui n'implémente pas lui-même cette décision).
  function advance() {
    if (phaseStep.value === PHASE_AIRBORNE) {
      // Fin de la phase Airborne : on passe au Mouvement du même camp — le
      // pas courant de TurnTracker.vue ne bouge pas.
      phaseStep.value = 0
      return
    }
    if (phaseStep.value === 0) {
      // Cas 1 : on ne fait QUE passer à la phase Combat du même camp — le
      // pas courant de TurnTracker.vue ne bouge pas.
      phaseStep.value = 1
      return
    }
    if (phaseStep.value === 1) {
      if (turnTrackerRef.value?.isLastSideOfTurn) {
        // Cas 3 : la Combat du DERNIER camp de l'ordre vient de se
        // terminer — on ouvre la Fin de tour (phase du TOUR entier, pas
        // d'un camp) avant de rendre la main au camp suivant. Le pas
        // courant de TurnTracker.vue ne bouge PAS encore ici : c'est le
        // clic SUIVANT (phaseStep === 2 ci-dessous) qui le fera avancer.
        phaseStep.value = 2
        return
      }
      // Cas 2 : la Combat d'un camp qui n'est PAS le dernier de l'ordre
      // est terminée — on redemande directement à TurnTracker.vue
      // d'avancer au camp suivant (même tour), comme avant l'ajout de la
      // Fin de tour.
      turnTrackerRef.value?.nextTurn()
      return
    }
    // Cas 4 (phaseStep === 2, Fin de tour) : elle se termine, on redemande
    // à TurnTracker.vue d'avancer au camp suivant — mécaniquement le 1er de
    // l'ordre, donc un nouveau tour. Le watcher ci-dessus se chargera de
    // remettre `phaseStep` à 0 en réaction à ce changement de pas — inutile
    // de le faire nous-mêmes ici, ce qui évite un double travail si jamais
    // `nextTurn()` ne fait rien (ex. dernier pas de la partie : il s'arrête
    // alors silencieusement, cf. TurnTracker.vue::nextTurn).
    turnTrackerRef.value?.nextTurn()
  }

  // --- Points de mouvement (MP) et coût de terrain (COT) ---------------------
  // En mode Assisté, un pion ne peut entrer dans un hex QUE s'il lui reste
  // assez de MP pour en payer le COT — sinon le clic sur cet hex (cf.
  // HexMap.vue::onHex, branche "pion sélectionné + hex adjacent") ne fait
  // rien, comme si l'hex n'était pas une destination valide. Concrètement :
  //   1. avant le déplacement, HexMap.vue appelle `canEnterHex(pion, hex)` —
  //      s'il répond `false`, HexMap.vue n'effectue PAS le déplacement ;
  //   2. si le déplacement a bien lieu, HexMap.vue appelle `spendMp(pion,
  //      hex)` juste après, pour déduire le COT de l'hex des MP du pion.
  // Un pion peut ainsi enchaîner plusieurs hex (cf. onHex, qui le laisse
  // sélectionné après chaque déplacement) tant qu'il lui reste assez de MP à
  // chaque nouvelle entrée — les MP non dépensés ne servent à rien d'autre
  // et sont remis à leur maximum au tour/camp suivant (cf. watcher plus haut,
  // qui vide `spentMp`).
  //
  // Chaque pion a un total de MP fixe déclaré dans le module JSON (`c.mov`,
  // ex. 7 pour l'infanterie allemande d'Arnhem) — cf. arnhem.json. Certains
  // pions (marqueurs, cf. HexMap.vue::isUnit) n'ont pas de `mov` du tout :
  // dans ce cas, `remainingMp` ci-dessous répond systématiquement "illimité"
  // plutôt que "zéro MP", pour ne jamais bloquer un pion que le module ne
  // fait pas participer au système de MP.

  /** "road", "trail", "bridge", "ferry", "river", "stream" ou `null` : nature
   *  de l'ARÊTE précise entre `from` et `h` (cf. terrain.roads/trails/
   *  streams/rivers/ferries/canalBridges/railroadBridges/highwayBridges, des
   *  listes "hexIdA-hexIdB" — une connexion PRÉCISE entre deux hex donnés,
   *  jamais juste "cet hex touche une route/un cours d'eau"). `null` si
   *  `from` est absent ou si cette paire d'hex précise n'est reliée par
   *  AUCUNE des listes ci-dessus (même si l'un des deux, voire les deux,
   *  touche l'une d'elles ailleurs, sur un autre de ses côtés).
   *
   *  Priorité (du plus fort au plus faible) quand PLUSIEURS sont déclarées
   *  sur la même arête :
   *   1. route > piste — cf. arnhem.json : une route/piste qui franchit un
   *      ruisseau, typiquement un pont/gué aménagé -> on suit son coût, PAS
   *      le surcoût de ruisseau (cf. `terrainCost`) ;
   *   2. pont (canal/chemin de fer/route — cf. `isBridgeEdge`, peu importe
   *      lequel) — s'il n'y a ni route ni piste déclarée par-dessus (rare :
   *      la plupart des ponts routiers SONT aussi une route/piste, déjà
   *      couverts par la priorité 1 ci-dessus) ;
   *   3. bac (`terrain.ferries`) — s'il n'y a ni route/piste ni pont ;
   *   4. rivière (`terrain.rivers`) — s'il n'y a ni pont ni bac : signale une
   *      arête infranchissable (cf. `canEnterTerrain`, "River Prohibited" du
   *      module) ;
   *   5. ruisseau (`terrain.streams`) — dernier recours, franchissable à gué
   *      par tout le monde sauf les véhicules (cf. `canEnterTerrain`).
   *
   *  Factorisé ici car utilisé à la fois par `terrainCost` (coût) et par
   *  `canEnterTerrain` plus bas (route/piste/pont = exception au terrain —
   *  et, pour les véhicules, au ruisseau/à la rivière — autrement
   *  infranchissable). */
  function edgeKind(from, hex) {
    if (!from) return null
    const edgeKey = hexId(from.c + 1, from.r) + '-' + hexId(hex.c + 1, hex.r)
    if (roadEdges.has(edgeKey)) return 'road'
    if (trailEdges.has(edgeKey)) return 'trail'
    if (isBridgeEdge(edgeKey)) return 'bridge'
    if (ferryEdges.has(edgeKey)) return 'ferry'
    if (riverEdges.has(edgeKey)) return 'river'
    if (streamEdges.has(edgeKey)) return 'stream'
    return null
  }

  /** Nature de l'hexside `from` -> `h` DU POINT DE VUE DU COMBAT (cf.
   *  lib/useCombat.js) — priorités différentes de `edgeKind` ci-dessus, qui
   *  est pensée pour le COÛT de mouvement :
   *   - 'bridge' : un pont (canal/chemin de fer/route) enjambe l'obstacle.
   *     Testé EN PREMIER, car la plupart des ponts sont AUSSI déclarés comme
   *     route, que `edgeKind` ferait alors passer d'abord ("road") ;
   *   - 'river' : rivière SANS pont — l'attaque à travers cet hexside est
   *     INTERDITE (règle validée avec l'utilisateur, cohérente avec la ZOC
   *     qui ne s'y étend pas non plus, cf. `riverBlocksZoc`). Un BAC n'y
   *     change rien : ce n'est pas un pont ;
   *   - `null` si une route/piste franchit l'hexside : passage aménagé, donc
   *     pas un obstacle — même raisonnement que la priorité route/piste de
   *     `edgeKind` (un ruisseau traversé par une route ne pénalise pas) ;
   *   - 'stream' : ruisseau nu, qui remplace la ligne de terrain sur la
   *     table de combat si TOUS les attaquants le franchissent ;
   *   - `null` sinon (hexside ordinaire, sans particularité).
   *  Exportée (cf. `return` plus bas) pour lib/useCombat.js. */
  function combatEdgeKind(from, hex) {
    if (!from) return null
    const edgeKey = hexId(from.c + 1, from.r) + '-' + hexId(hex.c + 1, hex.r)
    if (isBridgeEdge(edgeKey)) return 'bridge'
    if (riverEdges.has(edgeKey)) return 'river'
    if (roadEdges.has(edgeKey) || trailEdges.has(edgeKey)) return null
    if (streamEdges.has(edgeKey)) return 'stream'
    return null
  }

  /** Coût (en MP) pour ENTRER dans l'hex `h` ({ c, r }, 0-based/1-based comme
   *  partout dans HexMap.vue) en VENANT de l'hex `from` (même forme, optionnel).
   *
   *  Règle route/piste/pont/bac/rivière/ruisseau (cf. `edgeKind` ci-dessus,
   *  qui donne aussi l'ordre de priorité) : route -> coût de la route
   *  (`terrain.types.road.mp`, ex. 0.5) ; piste -> coût de la piste
   *  (`terrain.types.trail.mp`, ex. 1) ; pont -> coût normal de `h`, SANS
   *  surcoût ("No add MP" sur la table de terrain du module, quel que soit
   *  le type de pont) ; bac OU ruisseau -> coût normal de `h` PLUS
   *  `WATER_CROSSING_PENALTY` (ex. 2 MP de terrain + 3 = 5) ; rivière (sans
   *  pont ni bac) -> coût normal de `h`, une valeur purement indicative
   *  (cf. `canEnterTerrain`, qui refuse de toute façon cette arête à TOUT LE
   *  MONDE dans ce cas). Sans `from` (ex. appel générique sans connaître la
   *  provenance), toujours le coût normal du terrain.
   *
   *  Coût normal (sans rien de tout ça) : lu dans `terrain.grid[hexId]` (le
   *  type de terrain de `h`) puis `terrain.types[type].mp`. 1 par défaut si
   *  le module ne déclare pas de `terrain` (pas encore enrichi) ou si cet
   *  hex précis n'a pas de type déclaré.
   *
   *  Exportée (cf. `return` plus bas) pour être réutilisée telle quelle par
   *  lib/useDebug.js (affichage du COT des hex adjacents et calcul de la
   *  portée de déplacement en mode debug) — seule source de vérité pour un
   *  coût de terrain, à ne jamais dupliquer ailleurs. */
  function terrainCost(hex, from) {
    const kind = edgeKind(from, hex)
    if (kind === 'road') return terrain?.types?.road?.mp ?? terrainAreaCost(hex)
    if (kind === 'trail') return terrain?.types?.trail?.mp ?? terrainAreaCost(hex)
    if (kind === 'bridge') return terrainAreaCost(hex)
    if (kind === 'ferry' || kind === 'stream') return terrainAreaCost(hex) + WATER_CROSSING_PENALTY
    return terrainAreaCost(hex)
  }

  /** Coût "de zone" de `h`, sans tenir compte d'une éventuelle route/piste
   *  empruntée pour y entrer — cf. `terrainCost` ci-dessus, qui applique
   *  cette valeur par défaut et en cas de fallback (route/piste sans coût
   *  déclaré dans `terrain.types`). */
  function terrainAreaCost(hex) {
    const type = terrain?.grid?.[hexId(hex.c + 1, hex.r)]
    return terrain?.types?.[type]?.mp ?? 1
  }

  /** MP qu'il reste à `c` pour la suite de son mouvement ce tour-ci. `null`
   *  si le module ne déclare pas de MP pour ce pion (`c.mov` absent) — dans
   *  ce cas précis, `canEnterHex` ci-dessous n'impose AUCUNE restriction
   *  (mouvement illimité, comme avant l'ajout des MP), pour ne pas casser
   *  les modules qui ne modélisent pas encore ce système. Exportée (cf.
   *  `return` plus bas) pour être réutilisée par lib/useDebug.js (portée de
   *  déplacement en mode debug — jusqu'où `c` peut aller avec ce qu'il lui
   *  reste de MP), en plus de son usage interne par `canEnterHex`. */
  function remainingMp(counter) {
    if (counter?.mov == null) return null
    return counter.mov - (spentMp.value.get(String(counter.id)) ?? 0)
  }

  // --- Zone de Contrôle (ZOC) -------------------------------------------------
  // Règle : les 6 hex autour d'un pion constituent sa ZOC — SAUF à travers un
  // hexside de RIVIÈRE sans pont (cf. `riverBlocksZoc` plus bas) : une
  // rivière coupe la ZOC tout comme elle coupe le mouvement (cf.
  // `canEnterTerrain`), un pont (canal/chemin de fer/route, cf.
  // `isBridgeEdge`) la rétablit. Un hexside de RUISSEAU ou de CANAL (pas de
  // barrière propre dans les données du module : seuls ses ponts,
  // `canalBridges`, y sont déclarés) n'interrompt PAS la ZOC, qui s'étend
  // normalement à travers eux — seule une rivière SANS pont bloque. Un pion
  // qui COMMENCE sa phase de Mouvement dans la ZOC d'un pion ennemi ne peut pas
  // bouger DU TOUT ce tour-ci ; un pion qui ENTRE dans une ZOC ennemie (en
  // partant d'un hex hors ZOC) doit s'y arrêter — aucun déplacement
  // supplémentaire ce tour-ci, même s'il lui reste des MP.
  //
  // Ces deux formulations se ramènent en fait à UNE SEULE règle, appliquée
  // dans `canEnterHex` plus bas : "si l'hex QUITTÉ (`from`) est sous ZOC
  // ennemie, aucun déplacement n'est autorisé, quel que soit `h`" :
  //   - en tout DÉBUT de tour, `from` = la position actuelle du pion (il n'a
  //     encore rien parcouru) -> s'il y est déjà en ZOC ennemie, ce test
  //     bloque IMMÉDIATEMENT tout déplacement (1re règle) ;
  //   - un pion qui vient de bouger et se retrouve maintenant dans une ZOC
  //     ennemie (le déplacement qui l'y a fait ENTRER reste autorisé : `from`
  //     de CE déplacement-là n'était pas encore en ZOC) verra son `from`
  //     passer à cette case pour tout nouveau déplacement -> bloqué au
  //     prochain clic (2e règle, "doit s'arrêter").
  //
  // Seules les vraies unités de combat projettent une ZOC (ni les marqueurs,
  // ni les pions de soutien, ressource commune sans "camp" au sens du jeu).

  /** Camp ("side", cf. `sides` — ex. { german: [...], allies: [...] })
   *  auquel appartient la faction `faction`, ou `null` si `sides` n'est pas
   *  déclaré par le module, ou si cette faction n'apparaît dans aucun camp
   *  déclaré (repli, cf. `isEnemyOf`). */
  function sideOfFaction(faction) {
    if (!sides) return null
    for (const key of Object.keys(sides)) {
      if (sides[key]?.includes(faction)) return key
    }
    return null
  }

  /** `a` et `b` (deux pions) sont-ils ennemis ? Basé sur `sides` (même
   *  regroupement camp/factions que TurnTracker.vue pour la restriction de
   *  tour) : ennemis si leurs camps diffèrent. Repli sur une simple
   *  comparaison de faction si `sides` n'est pas déclaré par le module.
   *  Exportée (cf. `return` plus bas) pour être réutilisée telle quelle par
   *  HexMap.vue (repli d'entrée en jeu d'un renfort — cf.
   *  entryHexSet/isEntryHexBlocked : un hex d'entrée occupé par un ennemi,
   *  ou par un ami figé dans une ZOC ennemie, redirige vers un hex voisin). */
  function isEnemyOf(counterA, counterB) {
    const sa = sideOfFaction(counterA?.faction)
    const sb = sideOfFaction(counterB?.faction)
    if (sa != null && sb != null) return sa !== sb
    return counterA?.faction !== counterB?.faction
  }

  /** Le hexside précis entre `a` et `b` ({ col, row } 0-based/1-based, ex.
   *  un pion et l'un de ses voisins) coupe-t-il la ZOC ? Vrai uniquement
   *  pour une arête de RIVIÈRE (`terrain.rivers`) qui n'est PAS un pont (cf.
   *  `isBridgeEdge` — canal/chemin de fer/route, peu importe lequel) : un
   *  BAC (`terrain.ferries`) n'en est pas un, une rivière traversée par bac
   *  coupe donc quand même la ZOC (seul un pont la rétablit). Un hexside de
   *  ruisseau (`terrain.streams`) ou de canal (jamais lui-même dans les
   *  données du module, seuls ses ponts `canalBridges` le sont) n'est PAS
   *  concerné : la ZOC s'étend normalement à travers eux, seule la rivière
   *  est une vraie coupure. */
  function riverBlocksZoc(counterA, counterB) {
    const edgeKey = hexId(counterA.col + 1, counterA.row) + '-' + hexId(counterB.col + 1, counterB.row)
    return riverEdges.has(edgeKey) && !isBridgeEdge(edgeKey)
  }

  /** Ensemble ("col,row") de tous les hex sous ZOC ennemie de `c` — union
   *  des 6 hex VOISINS (jamais l'hex du pion ennemi lui-même) de chaque
   *  pion actuellement posé sur la carte (`counters`) qui est ennemi de `c`
   *  (cf. `isEnemyOf`) et qui projette une ZOC (pas un marqueur, pas un pion
   *  de soutien) — sauf à travers un hexside de rivière sans pont (cf.
   *  `riverBlocksZoc` ci-dessus), qui coupe la ZOC comme il coupe le
   *  mouvement. `c` lui-même et ses propres alliés n'y contribuent
   *  jamais. Set VIDE si `c` est `null`/absent.
   *
   *  Exportée (cf. `return` plus bas) pour être réutilisée telle quelle par
   *  HexMap.vue (surlignage des hex sous ZOC ennemie, visible en mode
   *  Assisté dès qu'un pion est sélectionné) et par lib/useDebug.js (calcul
   *  de portée : un hex sous ZOC ennemie ne laisse plus continuer le
   *  chemin au-delà de lui) — calculée UNE SEULE FOIS par ces appelants
   *  plutôt qu'à chaque hex testé individuellement. */
  function enemyZocSet(counter) {
    const set = new Set()
    if (!counter) return set
    for (const other of counters.value) {
      if (other.type === 'marker' || other.kind === 'support') continue
      if (!isEnemyOf(counter, other)) continue
      for (const neighbor of neighborsOf(other.col, other.row)) {
        if (riverBlocksZoc(other, neighbor)) continue
        set.add(neighbor.col + ',' + neighbor.row)
      }
    }
    return set
  }

  // --- Empilement (stacking) au mouvement normal -----------------------------
  // Une unité ne peut jamais TERMINER sa phase de Mouvement sur un hex occupé
  // par une unité AMIE. Comme on ne sait pas À L'AVANCE si tel hex sera la
  // dernière case du déplacement, la règle se vérifie à CHAQUE pas : entrer
  // dans un hex ami n'est autorisé QUE si l'unité peut ENSUITE en repartir ce
  // même tour (cf. `canLeaveAfterEntering`) — sinon, y entrer la "coincerait"
  // définitivement avec son amie. Ne concerne QUE le mouvement normal d'un
  // pion déjà sur la carte (cf. HexMap.vue::onHex) — pas l'entrée en jeu d'un
  // renfort, qui a ses propres règles de blocage (cf. HexMap.vue::
  // isEntryHexBlocked : ennemi, ou ami figé en ZOC).

  /** `h` est-il occupé par au moins une unité AMIE de `c` (même camp, ni
   *  ennemie ni indifférente, cf. `isEnemyOf`) ? Ignore marqueurs et pions de
   *  soutien, ni amis ni ennemis au sens de cette règle. Exportée (cf.
   *  `return` plus bas) pour être réutilisée par HexMap.vue (surlignage vert
   *  du premier pas et clic de mouvement) et lib/useDebug.js (portée
   *  complète en mode debug) — même définition partout. */
  function hasFriendlyOccupant(counter, hex) {
    return counters.value.some(
      (other) => other.col === hex.c && other.row === hex.r && other.type !== 'marker' && other.kind !== 'support' && !isEnemyOf(counter, other)
    )
  }

  /** `c` peut-il, après être entré dans `h` en venant de `from` (et avoir
   *  payé le coût de terrain de `h`, cf. `terrainCost`), faire AU MOINS UN
   *  déplacement de plus ce tour-ci ? Il lui faut, dans l'ordre :
   *   1. encore des MP après avoir payé pour `h` (`remainingMp` ne suit pas
   *      de MP pour `c` -> jamais concerné par cette contrainte, cf. `null`) ;
   *   2. ne pas se retrouver figé en ZOC ennemie SUR `h` (cf. `enemyZocSet`
   *      — sinon, plus aucun mouvement n'est de toute façon possible, quels
   *      que soient ses MP) ;
   *   3. au moins un hex voisin de `h` qui soit à la fois franchissable (cf.
   *      `canEnterTerrain`) et abordable avec les MP qu'il lui resterait —
   *      peu importe si CE voisin est lui-même libre ou pas (on ne vérifie
   *      qu'UN pas en avant, pas tout un chemin jusqu'à la fin du tour).
   *  Exportée (cf. `return` plus bas), même raison que `hasFriendlyOccupant`. */
  function canLeaveAfterEntering(counter, hex, from) {
    const remaining = remainingMp(counter)
    if (remaining == null) return true
    return canLeaveWithMp(counter, hex, remaining - terrainCost(hex, from))
  }

  /** Même question que `canLeaveAfterEntering`, mais pour un RENFORT qui
   *  ENTRE EN JEU sur `h` (cf. HexMap.vue::entryHexSet) plutôt que pour un
   *  pion qui s'y déplace : ce qu'il paie pour arriver n'est pas le coût de
   *  terrain depuis un hex voisin (il vient de "hors carte"), mais :
   *   - le coût d'ENTRÉE de `h`, congestion comprise (cf. `entryCost`), si
   *     `paysEntry` est vrai (renfort de bord de carte) ;
   *   - rien du tout si `paysEntry` est faux (aéroporté "+adj", qui ne paie
   *     aucun coût d'entrée, cf. HexMap.vue::onHex).
   *  Règle validée : un renfort ne peut PAS entrer sur l'hex d'un ami s'il
   *  ne pourrait pas en repartir ensuite — sinon il y resterait coincé avec
   *  lui, ce que la fin de phase refuserait de toute façon (cf.
   *  `stackedHexes`). Toujours vrai hors mode Assisté. */
  function canLeaveAfterReinforcementEntry(counter, hex, paysEntry) {
    if (!assisted.value) return true
    const remaining = remainingMp(counter)
    if (remaining == null) return true
    return canLeaveWithMp(counter, hex, remaining - (paysEntry ? entryCost(hex) : 0))
  }

  /** Brique commune aux deux fonctions ci-dessus : `c`, posé sur `h` avec
   *  `afterEntry` MP restants, peut-il faire au moins un pas de plus ? Ce
   *  sont les étapes 1 à 3 décrites sur `canLeaveAfterEntering`. */
  function canLeaveWithMp(counter, hex, afterEntry) {
    if (afterEntry <= 0) return false
    if (enemyZocSet(counter).has(hex.c + ',' + hex.r)) return false
    return neighborsOf(hex.c, hex.r).some((neighbor) => {
      if (!hexOnMap(neighbor.col, neighbor.row)) return false
      const nh = { c: neighbor.col, r: neighbor.row }
      return canEnterTerrain(counter, nh, hex) && afterEntry >= terrainCost(nh, hex)
    })
  }

  /** `c` (DÉJÀ posé sur la carte) partage-t-il son hex avec au moins une
   *  AUTRE unité amie ? C'est la question "cette unité est-elle en
   *  SURPLUS D'EMPILEMENT (overstack) là où elle se trouve ?".
   *
   *  Différence avec `hasFriendlyOccupant(c, h)` : celle-ci regarde un hex
   *  `h` où `c` n'est PAS encore (avant un déplacement) et compterait `c`
   *  lui-même s'il y était déjà — d'où cette fonction dédiée, qui exclut `c`.
   *
   *  Sert à HexMap.vue::setSelectedCounter : on ne peut pas TERMINER le
   *  mouvement d'une unité (la désélectionner, ou passer à une autre unité /
   *  un renfort) tant qu'elle est en overstack — le joueur doit d'abord la
   *  déplacer ailleurs (ou annuler son mouvement). Marqueurs et pions de
   *  soutien ne comptent jamais (ni amis ni ennemis, cf.
   *  `hasFriendlyOccupant`). Toujours faux hors mode Assisté. */
  function isOverstacked(counter) {
    if (!assisted.value || !counter || counter.type === 'marker' || counter.kind === 'support') return false
    return counters.value.some((otherCounter) =>
      otherCounter.id !== counter.id && otherCounter.col === counter.col && otherCounter.row === counter.row
      && otherCounter.type !== 'marker' && otherCounter.kind !== 'support' && !isEnemyOf(counter, otherCounter))
  }

  /** EMPILEMENTS EN ATTENTE — filet de sécurité de la même règle, vérifié
   *  cette fois au moment de QUITTER la phase de Mouvement (cf.
   *  HexMap.vue::onPhaseNext, qui refuse alors le changement de phase et
   *  ouvre PhaseBlockedModal.vue).
   *
   *  Pourquoi c'est nécessaire alors que `canLeaveAfterEntering` existe
   *  déjà : ce dernier ne garantit qu'une chose, que l'unité POURRAIT
   *  repartir de l'hex ami — pas qu'elle le fera. Rien n'empêche le joueur
   *  d'entrer sur un hex ami avec des MP de reste, puis de s'arrêter là et de
   *  cliquer "Nouvelle phase". Idem pour un renfort posé sur l'hex d'un ami
   *  (autorisé s'il peut en repartir, cf. `canLeaveAfterReinforcementEntry`)
   *  qui ne bouge plus ensuite. C'est ICI, en fin de phase, que ces cas sont
   *  rattrapés.
   *
   *  Ne comptent que les unités du camp ACTIF (cf. `canControl`) : c'est lui
   *  qui termine sa phase, et lui seul peut encore déplacer ses pions pour
   *  défaire l'empilement. Marqueurs et pions de soutien ignorés (ni amis ni
   *  ennemis, cf. `hasFriendlyOccupant`). Un hex est listé dès qu'il y a au
   *  moins 2 unités AMIES entre elles (cf. `isEnemyOf`).
   *
   *  Liste vide hors mode Assisté ou hors phase Mouvement. Chaque entrée :
   *  `{ key, hex, units }` — numéro d'hex imprimé et noms des unités
   *  empilées, pour la modale d'avertissement. */
  const stackedHexes = computed(() => {
    if (!assisted.value || phaseStep.value !== 0) return []
    // Regroupement des unités du camp actif par hex ("col,row" -> pions).
    const byHex = new Map()
    for (const counter of counters.value) {
      if (counter.type === 'marker' || counter.kind === 'support' || !canControl(counter)) continue
      const key = counter.col + ',' + counter.row
      if (!byHex.has(key)) byHex.set(key, [])
      byHex.get(key).push(counter)
    }
    const list = []
    for (const [key, units] of byHex) {
      if (units.length < 2) continue
      // Au moins une paire AMIE dans l'hex (sans `sides` configurés, deux
      // pions "contrôlables" pourraient en théorie être de camps opposés).
      const friendly = units.some((unitA, unitIndex) => units.slice(unitIndex + 1).some((unitB) => !isEnemyOf(unitA, unitB)))
      if (!friendly) continue
      const [col, row] = key.split(',').map(Number)
      list.push({ key, hex: hexId(col + 1, row), units: units.map((unit) => unit.name) })
    }
    return list
  })

  /** `c`, en venant de `from` ({ c, r }, optionnel), peut-il PHYSIQUEMENT
   *  entrer dans `h` ? Indépendant des MP : même avec des MP à revendre,
   *  l'hex/l'arête reste hors d'atteinte dans les cas ci-dessous.
   *
   *  1. RIVIÈRE (`edgeKind` — "river") SANS pont ni bac (cf. priorité
   *     route/piste/pont/bac > rivière dans `edgeKind` : si l'un des trois
   *     est présent, ce n'est plus une traversée "à la nage", ce blocage ne
   *     s'applique pas) : infranchissable pour TOUT LE MONDE, véhicule ou
   *     pas ("River Prohibited" sur la table de terrain du module).
   *
   *  Les blocages restants ne concernent QUE les véhicules (cf.
   *  `VEHICLE_TYPES`) — toute autre unité (infanterie, artillerie à pied...)
   *  répond toujours vrai au-delà du cas 1 ci-dessus :
   *
   *  2. RUISSEAU OU RIVIÈRE PAR BAC (`edgeKind` — "stream" ou "ferry") SANS
   *     route ni piste dessus : un véhicule ne peut franchir un ruisseau à
   *     gué, ni une rivière par bac, QUE l'infanterie et assimilés peuvent
   *     emprunter (cf. `terrainCost`, surcoût réservé à ce cas précis pour
   *     eux) — un véhicule a besoin d'une route/piste (ruisseau) ou d'un
   *     PONT (rivière, cf. "bridge" dans `edgeKind` — jamais d'un simple bac).
   *  3. `h` est rough/broken/woods ("forest") — sauf s'il y entre par une
   *     route, une piste ou un pont précis (cf. `edgeKind`), qui reste
   *     toujours praticable même à travers un tel terrain.
   *
   *  Exportée (cf. `return` plus bas) pour être réutilisée par
   *  lib/useDebug.js (portée de déplacement en mode debug : un hex/une
   *  arête interdit(e) ne doit pas apparaître comme "traversable", véhicule
   *  ou pas selon le cas, même en passant au travers sans s'y arrêter). */
  function canEnterTerrain(counter, hex, from) {
    const kind = edgeKind(from, hex)
    if (kind === 'river') return false
    if (!VEHICLE_TYPES.has(counter?.type)) return true
    if (kind === 'stream' || kind === 'ferry') return false
    if (IMPASSABLE_FOR_VEHICLES.has(terrain?.grid?.[hexId(hex.c + 1, hex.r)])) return kind != null
    return true
  }

  /** `c`, actuellement en `from` ({ c, r }, optionnel — cf. `terrainCost`
   *  pour la règle route/piste que ce paramètre active), peut-il entrer dans
   *  l'hex `h` ? Hors mode Assisté : toujours vrai (mode Libre = bac à
   *  sable, aucune règle de MP, de terrain ni de ZOC). En mode Assisté,
   *  DANS L'ORDRE :
   *   1. si `from` est fourni et sous ZOC ennemie (cf. `enemyZocSet`),
   *      refusé — QUEL QUE SOIT `h` : ce pion est figé sur place (s'il
   *      commence son tour là) ou vient de s'arrêter dans cette ZOC (s'il y
   *      est entré à l'instant) ;
   *   2. faux si le terrain de `h` est interdit à `c` (cf. `canEnterTerrain`
   *      — sauf exception route/piste, qu'elle gère elle-même) ;
   *   3. sinon vrai si `c` ne déclare pas de MP (cf. `remainingMp`), sinon
   *      seulement s'il lui en reste au moins autant que le COT de `h`
   *      (route/piste/ruisseau compris). */
  function canEnterHex(counter, hex, from) {
    if (!assisted.value) return true
    if (from && enemyZocSet(counter).has(from.c + ',' + from.r)) return false
    if (!canEnterTerrain(counter, hex, from)) return false
    const remaining = remainingMp(counter)
    if (remaining == null) return true
    return remaining >= terrainCost(hex, from)
  }

  /** Déduit de `c` le COT de `h` EN VENANT de `from` (mêmes paramètres et
   *  même règle route/piste que `canEnterHex`/`terrainCost` — toujours
   *  passer le MÊME `from` qu'au `canEnterHex` qui a validé ce déplacement,
   *  sans quoi le coût déduit ne correspondrait pas à celui vérifié) — à
   *  appeler UNE FOIS, juste après que `c` a effectivement été déplacé dans
   *  `h` (jamais avant, et jamais si `canEnterHex` avait répondu `false`).
   *  Ne fait rien hors mode Assisté ni pour un pion sans `mov` déclaré (cf.
   *  `remainingMp`), pour rester cohérent avec ce que `canEnterHex` a
   *  autorisé. */
  function spendMp(counter, hex, from) {
    if (!assisted.value || counter?.mov == null) return
    const spent = (spentMp.value.get(String(counter.id)) ?? 0) + terrainCost(hex, from)
    spentMp.value = new Map(spentMp.value).set(String(counter.id), spent)
  }

  /** Inverse EXACT de `spendMp` : recrédite `c` du COT de `h` en venant de
   *  `from` — à appeler quand on annule le DERNIER déplacement de `c` (cf.
   *  HexMap.vue, "Retour arrière" de la barre d'outils, disponible en mode
   *  Assisté uniquement — ce bouton disparaît en mode Libre, cf. plus haut).
   *  `h`/`from` sont ici l'hex QUITTÉ par l'annulation et celui d'où `c`
   *  venait à l'époque de ce déplacement (`last.to`/`last.from` côté
   *  HexMap.vue) — PAS la position actuelle de `c` : passer le même couple
   *  qu'au `spendMp` d'origine est ce qui garantit un remboursement exact,
   *  route/piste comprise. Ne fait rien hors mode Assisté ni pour un pion
   *  sans `mov` (en miroir de `spendMp`) : ni l'un ni l'autre n'a jamais pu
   *  débiter de MP dans ces cas, il n'y a donc rien à recréditer.
   *  `Math.max(0, …)` par sécurité (ne devrait jamais aller sous zéro en
   *  usage normal, cf. `spendMp` toujours appelée après un `canEnterHex` qui
   *  a validé le coût). */
  function refundMp(counter, hex, from) {
    if (!assisted.value || counter?.mov == null) return
    const spent = Math.max(0, (spentMp.value.get(String(counter.id)) ?? 0) - terrainCost(hex, from))
    spentMp.value = new Map(spentMp.value).set(String(counter.id), spent)
  }

  /** Redonne à `c` la TOTALITÉ de ses MP pour ce tour-ci (par opposition à
   *  `refundMp`, qui ne recrédite qu'UN SEUL hex) — à appeler dans 2 cas :
   *   1. "Annuler le mouvement" (menu contextuel, cf. HexMap.vue), qui ramène
   *      directement `c` à sa position de tout début de tour, sans repasser
   *      hex par hex ;
   *   2. "Replacer le pion" (menu contextuel ou depuis "Unités éliminées",
   *      cf. HexMap.vue::returnCounterToReinforcements) — un pion renvoyé
   *      aux renforts doit repartir avec un plein potentiel de MP la
   *      prochaine fois qu'il entrera en jeu, pas avec ce qu'il lui restait
   *      au moment où il a quitté la carte.
   *  Même garde-fous que `spendMp`/`refundMp`. */
  function resetMp(counter) {
    if (!assisted.value || counter?.mov == null) return
    const next = new Map(spentMp.value)
    next.delete(String(counter.id))
    spentMp.value = next
  }

  // --- Restauration depuis le JOURNAL (rejeu d'une sauvegarde) ---------------
  // Le journal (cf. JournalPanel.vue) enregistre, en plus des positions :
  //   - la PHASE en cours (entrée `phase`, écrite par HexMap.vue::onPhaseNext
  //     à chaque passage en Combat ou en Fin de tour) ;
  //   - les MP DÉPENSÉS par une unité après chacun de ses déplacements
  //     (champ `mp` des entrées `move`/`place`).
  // Sans ça, une partie sauvegardée EN COURS de phase de Mouvement
  // repartirait, une fois rechargée, en phase Mouvement avec toutes les
  // unités à plein potentiel de MP — elles pourraient rejouer un mouvement
  // déjà effectué. Les 3 fonctions ci-dessous servent UNIQUEMENT au rejeu
  // (cf. HexMap.vue::applyReplayEntry/resetBoardForReplay) : elles écrivent
  // directement l'état, sans aucune vérification de règle, parce que l'état
  // rejoué a déjà été validé par les règles au moment où il a été joué.

  /** Rejeu : place la phase en cours (0 Mouvement, 1 Combat, 2 Fin de tour).
   *  Le changement de TOUR, lui, passe par TurnTracker.vue (entrée `turn`)
   *  et remet de lui-même la phase à 0 (cf. watcher de `currentStep`). */
  function setPhase(newPhase) {
    phaseStep.value = newPhase
  }

  /** Rejeu : fixe à `value` le total de MP déjà dépensés par l'unité `id`
   *  pendant ce tour-ci (valeur ABSOLUE lue dans le journal, pas un ajout :
   *  rejouer deux fois la même entrée donne donc toujours le même résultat). */
  function setSpentMp(id, value) {
    if (value == null) return
    spentMp.value = new Map(spentMp.value).set(String(id), value)
  }

  /** Rejeu : repart de zéro (aucun MP dépensé, aucune congestion, phase de
   *  départ du camp actif — Airborne ou Mouvement, cf. `startSidePhase`) —
   *  appelé au chargement d'un journal, avant de rejouer sa première ligne
   *  (pions déjà remis au déploiement initial par HexMap.vue). */
  function resetTurnState() {
    spentMp.value = new Map()
    entryCounts.value = new Map()
    entryHexByUnit.value = new Map()
    startSidePhase()
  }

  // --- Congestion des hex d'entrée de renfort ---------------------------------
  // Un renfort qui entre en jeu sur un hex de bord de carte défini par un
  // `setup` "ref seule" ou "plage" (PAS "+adj", réservé à l'aéroporté qui
  // n'est pas concerné) paie un coût d'entrée — et, si un AUTRE renfort
  // entre par ce MÊME hex précis ce MÊME tour, le coût grimpe : 1er = 1× le
  // coût de base, 2e = 2×, 3e = 3×, etc. (cf. `entryCost`/`spendEntryCost`).
  // `entrySurcharge` expose la valeur à afficher sur l'hex en mode debug
  // (cf. lib/useDebug.js) : le SURCOÛT déjà accumulé, que la PROCHAINE unité
  // entrante devra payer en plus du coût de base (ex. "+0.5" après 1 entrée
  // sur un hex à 0.5 MP de base, "+1" après une 2e).

  /** Coût de BASE pour ENTRER EN JEU sur `h` (arrivée depuis "hors carte" —
   *  contrairement à `terrainCost`, il n'y a pas de "from", donc pas d'arête
   *  from->h précise à tester) : celui de la route si `h` touche une route
   *  par au moins un de ses côtés (cf. `roadTouchedHexes`) ; sinon celui de
   *  la piste si `h` en touche une (cf. `trailTouchedHexes`) ; sinon le coût
   *  de terrain normal de `h`. */
  function entryBaseCost(hex) {
    const hId = hexId(hex.c + 1, hex.r)
    if (roadTouchedHexes.has(hId)) return terrain?.types?.road?.mp ?? terrainAreaCost(hex)
    if (trailTouchedHexes.has(hId)) return terrain?.types?.trail?.mp ?? terrainAreaCost(hex)
    return terrainAreaCost(hex)
  }

  /** Coût RÉEL pour que la PROCHAINE unité entre en jeu sur `h` ce tour-ci :
   *  coût de base (cf. `entryBaseCost`) × (nombre d'unités déjà entrées par
   *  ce hex ce tour-ci, cf. `entryCounts`, + 1 pour celle-ci). */
  function entryCost(hex) {
    const already = entryCounts.value.get(hex.c + ',' + hex.r) ?? 0
    return entryBaseCost(hex) * (already + 1)
  }

  /** Surcoût déjà accumulé sur `h` ce tour-ci (0 si personne n'y est encore
   *  entré) — exactement ce que `entryCost(h)` ajoute au coût de base pour
   *  la prochaine entrée. Exportée (cf. `return` plus bas) pour l'affichage
   *  debug ("+X" sur l'hex, cf. lib/useDebug.js) — ne modifie rien,
   *  contrairement à `spendEntryCost`. */
  function entrySurcharge(hex) {
    const already = entryCounts.value.get(hex.c + ',' + hex.r) ?? 0
    return entryBaseCost(hex) * already
  }

  /** Déduit `entryCost(h)` des MP de `c` ET incrémente le compteur de
   *  congestion de `h` — à appeler UNE FOIS, juste après qu'un renfort vient
   *  d'ENTRER EN JEU sur `h` (cf. HexMap.vue::onHex, branche renfort ; PAS un
   *  déplacement classique, pour ça cf. `spendMp`). Ne fait rien hors mode
   *  Assisté — en mode Libre, aucun garde-fou de MP n'existe. Peut faire
   *  passer les MP restants de `c` sous zéro si le coût (potentiellement
   *  multiplié par la congestion) dépasse ce qu'il lui reste : ce n'est PAS
   *  un blocage d'entrée (un renfort entre toujours, cf. `isEntryHexBlocked`
   *  dans HexMap.vue pour les VRAIS blocages), juste un mouvement ultérieur
   *  ce tour-ci qui devient impossible.
   *
   *  Renvoie ce qui vient d'être payé, pour le JOURNAL (cf. HexMap.vue::onHex,
   *  qui signale une entrée par un hex CONGESTIONNÉ, c.-à-d. `rank` ≥ 2) :
   *  `{ rank, baseCost, cost }` — `rank` = rang de cette entrée sur `h` ce
   *  tour-ci (1 = première), `baseCost` = coût de base de `h` (cf.
   *  `entryBaseCost`), `cost` = coût réellement payé (`baseCost × rank`).
   *  `null` hors mode Assisté (rien n'est payé ni compté). */
  function spendEntryCost(counter, hex) {
    if (!assisted.value) return null
    // Lus AVANT d'incrémenter le compteur : `entryCost` donne le coût de
    // CETTE entrée-ci, pas de la suivante.
    const baseCost = entryBaseCost(hex)
    const cost = entryCost(hex)
    if (counter?.mov != null) {
      const spent = (spentMp.value.get(String(counter.id)) ?? 0) + cost
      spentMp.value = new Map(spentMp.value).set(String(counter.id), spent)
    }
    const key = hex.c + ',' + hex.r
    const count = (entryCounts.value.get(key) ?? 0) + 1
    entryCounts.value = new Map(entryCounts.value).set(key, count)
    entryHexByUnit.value = new Map(entryHexByUnit.value).set(String(counter.id), key)
    return { rank: count, baseCost, cost }
  }

  /** Annule l'effet de `spendEntryCost` sur la CONGESTION (pas sur les MP de
   *  `c` lui-même : cf. `resetMp`, à appeler séparément, cf. HexMap.vue::
   *  returnCounterToReinforcements) — à appeler quand `c` est "replacé" aux
   *  renforts : décrémente d'UN le compteur de congestion du hex par lequel
   *  il était entré, comme si son entrée n'avait jamais eu lieu, pour que le
   *  PROCHAIN pion à entrer par ce même hex ce même tour ne paie pas pour
   *  une place que `c` n'occupe plus. Ne fait rien si `c` n'est plus suivi
   *  (jamais entré via `spendEntryCost` CE TOUR-CI, cf. `entryHexByUnit` —
   *  en particulier, un pion replacé un tour après son entrée ne touche à
   *  rien : sa congestion d'alors a de toute façon déjà été remise à zéro). */
  function unspendEntryCost(counter) {
    const key = entryHexByUnit.value.get(String(counter?.id))
    if (key == null) return
    const nextByUnit = new Map(entryHexByUnit.value)
    nextByUnit.delete(String(counter.id))
    entryHexByUnit.value = nextByUnit
    const count = Math.max(0, (entryCounts.value.get(key) ?? 0) - 1)
    entryCounts.value = new Map(entryCounts.value).set(key, count)
  }

  return { showGrid, selectable, draggable, canControl, phase, phaseLabels, phaseIndex, nextLabel, advance,
    PHASE_AIRBORNE, initPhase: startSidePhase, canPlaceReinforcementNow, canEnterHex, canEnterTerrain, spendMp, refundMp, resetMp, terrainCost, remainingMp, enemyZocSet, isEnemyOf, entrySurcharge, spendEntryCost, unspendEntryCost, hasFriendlyOccupant, canLeaveAfterEntering, canLeaveAfterReinforcementEntry, isOverstacked, stackedHexes, combatEdgeKind, setPhase, setSpentMp, resetTurnState }
}
