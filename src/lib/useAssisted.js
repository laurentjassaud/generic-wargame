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
//           de cet hex (cf. section "Points de mouvement" plus bas).
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
//   - `terrain` : `module.terrain` (JSON du module, ex. arnhem.json) —
//     `{ types: { [clé]: { label, mp } }, grid: { [id d'hex "CCRR"]: clé },
//     roads: ["AAAA-BBBB", ...], trails: [...] }`. `roads`/`trails` sont des
//     listes d'ARÊTES (paires d'hex adjacents précises, pas juste "cet hex
//     est une route") : cf. section "Points de mouvement" plus bas pour leur
//     usage. Peut être absent (modules pas encore enrichis en terrain) : dans
//     ce cas, tout hex coûte 1 MP par défaut, sans bonus route/piste.
import { computed, ref, watch } from 'vue'
import { hexId } from './calibration.js'

/** Construit, une seule fois, l'ensemble des arêtes route/piste d'un module
 *  sous forme de clés "hexIdA-hexIdB" ET "hexIdB-hexIdA" (les deux sens : le
 *  JSON ne liste chaque arête qu'une fois, dans un ordre arbitraire, alors
 *  qu'on doit pouvoir la retrouver en avançant comme en reculant dessus).
 *  `list` : `terrain.roads` ou `terrain.trails` (tableau de "AAAA-BBBB"). */
function buildEdgeSet(list) {
  const set = new Set()
  for (const edge of list ?? []) {
    const [a, b] = edge.split('-')
    set.add(a + '-' + b)
    set.add(b + '-' + a)
  }
  return set
}

export function useAssisted(assisted, turnTrackerRef, terrain) {
  // Arêtes route/piste du module, construites une seule fois (cf.
  // buildEdgeSet ci-dessus) — `terrain` ne change pas en cours de partie,
  // inutile de les reconstruire à chaque appel de `terrainCost`.
  const roadEdges = buildEdgeSet(terrain?.roads)
  const trailEdges = buildEdgeSet(terrain?.trails)

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
    set: (v) => { if (assisted.value) showGridPref.value = v },
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
  function canControl(c) {
    // Hors mode Assisté (mode Libre), aucune restriction : tout pion est
    // contrôlable par n'importe qui, à tout moment.
    if (!assisted.value) return true

    // En mode Assisté, on délègue la décision à TurnTracker.vue, qui
    // connaît le camp actif du tour en cours et les factions qui lui sont
    // rattachées. Le `?? true` couvre le cas où `turnTrackerRef.value`
    // n'est pas encore monté (ex. tout premier rendu) : par défaut, on
    // n'empêche rien plutôt que de bloquer l'interface sur une ref pas
    // encore prête.
    return turnTrackerRef.value?.canControl(c) ?? true
  }

  // --- Phases Mouvement / Combat ---------------------------------------------
  // En mode Assisté, chaque camp actif (déterminé par TurnTracker.vue) joue
  // son tour en 2 PHASES successives et obligatoires : d'abord Mouvement,
  // puis Combat. Concrètement, ça se traduit par 2 marqueurs affichés sous
  // la piste de tour (cf. TurnTracker.vue), et par UN SEUL bouton "suivant"
  // qui, selon où on en est, déclenche l'une de ces 3 actions :
  //
  //   1. Mouvement → Combat        (même camp, même tour)  — "Nouvelle phase"
  //   2. Combat → Mouvement        (camp SUIVANT, même tour) — "Autre joueur"
  //   3. Combat → Mouvement        (camp suivant = 1er de l'ordre → tour+1) — "Nouveau tour"
  //
  // Exemple concret (2 camps, ordre [allies, german]) :
  //   Tour 1 Alliés Mouvement → Tour 1 Alliés Combat → Tour 1 Allemands
  //   Mouvement → Tour 1 Allemands Combat → Tour 2 Alliés Mouvement → ...
  //
  // Cas 2 et 3 ci-dessus correspondent tous les deux à un changement de
  // camp actif — la SEULE différence est que le cas 3 boucle en même temps
  // sur l'ordre des camps (retour au 1er camp), ce qui fait mécaniquement
  // avancer le numéro de tour (cf. TurnTracker.vue::currentTurn, dérivé du
  // pas courant). Le camp actif et le tour sont donc TOUJOURS gérés par
  // TurnTracker.vue (son `nextTurn()`, appelé ci-dessous) — ce composable
  // ne fait QUE superposer une phase locale (0 ou 1) par-dessus ce pas.

  // 0 = Mouvement (phase de départ), 1 = Combat.
  const phaseStep = ref(0)

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
  watch(() => turnTrackerRef.value?.currentStep, () => {
    phaseStep.value = 0
    spentMp.value = new Map()
  })

  // Libellé affiché SUR le bouton "suivant" de la ligne "phases", pour que
  // l'utilisateur sache toujours à l'avance ce que le prochain clic va
  // déclencher (cf. les 3 cas listés plus haut). `null` hors mode Assisté :
  // TurnTracker.vue retombe alors sur son titre par défaut ("Tour suivant").
  const nextLabel = computed(() => {
    if (!assisted.value) return null
    if (phaseStep.value === 0) return 'Nouvelle phase'
    return turnTrackerRef.value?.isLastSideOfTurn ? 'Nouveau tour' : 'Autre joueur'
  })

  // Gestionnaire de clic pour le bouton "suivant" de la ligne "phases"
  // (branché sur l'évènement `phase-next` émis par TurnTracker.vue — cf.
  // ce fichier, qui n'implémente pas lui-même cette décision).
  function advance() {
    if (phaseStep.value === 0) {
      // Cas 1 : on ne fait QUE passer à la phase Combat du même camp — le
      // pas courant de TurnTracker.vue ne bouge pas.
      phaseStep.value = 1
      return
    }
    // Cas 2 ou 3 : la phase Combat du camp actif est terminée, on
    // redemande à TurnTracker.vue d'avancer au camp (et éventuellement au
    // tour) suivant. Le watcher ci-dessus se chargera de remettre
    // `phaseStep` à 0 en réaction à ce changement de pas — inutile de le
    // faire nous-mêmes ici, ce qui évite un double travail si jamais
    // `nextTurn()` ne fait rien (ex. dernier pas de la partie : il
    // s'arrête alors silencieusement, cf. TurnTracker.vue::nextTurn).
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

  /** Coût (en MP) pour ENTRER dans l'hex `h` ({ c, r }, 0-based/1-based comme
   *  partout dans HexMap.vue) en VENANT de l'hex `from` (même forme, optionnel).
   *
   *  Règle route/piste (cf. terrain.roads/terrain.trails, des listes
   *  d'ARÊTES "hexIdA-hexIdB" — une connexion PRÉCISE entre deux hex donnés,
   *  pas juste "cet hex est une route") : si `from` est fourni ET que
   *  l'arête `from`-`h` est une route, le coût est celui de la route
   *  (`terrain.types.road.mp`, ex. 0.5) ; sinon, si c'est une piste, celui de
   *  la piste (`terrain.types.trail.mp`, ex. 1) ; sinon coût normal du
   *  terrain de `h`. Concrètement : suivre une route ne coûte QUE si on
   *  entre dans `h` EN VENANT d'un hex relié à lui par cette route
   *  précisément — pas juste parce que `h` (ou `from`) touche une route
   *  ailleurs sur ses autres côtés. Sans `from` (ex. appel générique sans
   *  connaître la provenance), toujours le coût normal du terrain.
   *
   *  Coût normal (sans route/piste) : lu dans `terrain.grid[hexId]` (le type
   *  de terrain de `h`) puis `terrain.types[type].mp`. 1 par défaut si le
   *  module ne déclare pas de `terrain` (pas encore enrichi) ou si cet hex
   *  précis n'a pas de type déclaré.
   *
   *  Exportée (cf. `return` plus bas) pour être réutilisée telle quelle par
   *  lib/useDebug.js (affichage du COT des hex adjacents et calcul de la
   *  portée de déplacement en mode debug) — seule source de vérité pour un
   *  coût de terrain, à ne jamais dupliquer ailleurs. */
  function terrainCost(h, from) {
    if (from) {
      const edgeKey = hexId(from.c + 1, from.r) + '-' + hexId(h.c + 1, h.r)
      if (roadEdges.has(edgeKey)) return terrain?.types?.road?.mp ?? terrainAreaCost(h)
      if (trailEdges.has(edgeKey)) return terrain?.types?.trail?.mp ?? terrainAreaCost(h)
    }
    return terrainAreaCost(h)
  }

  /** Coût "de zone" de `h`, sans tenir compte d'une éventuelle route/piste
   *  empruntée pour y entrer — cf. `terrainCost` ci-dessus, qui applique
   *  cette valeur par défaut et en cas de fallback (route/piste sans coût
   *  déclaré dans `terrain.types`). */
  function terrainAreaCost(h) {
    const type = terrain?.grid?.[hexId(h.c + 1, h.r)]
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
  function remainingMp(c) {
    if (c?.mov == null) return null
    return c.mov - (spentMp.value.get(String(c.id)) ?? 0)
  }

  /** `c`, actuellement en `from` ({ c, r }, optionnel — cf. `terrainCost`
   *  pour la règle route/piste que ce paramètre active), peut-il entrer dans
   *  l'hex `h` ? Hors mode Assisté : toujours vrai (mode Libre = bac à
   *  sable, aucune règle de MP). En mode Assisté : vrai si `c` ne déclare
   *  pas de MP (cf. `remainingMp`), sinon seulement s'il lui en reste au
   *  moins autant que le COT de `h` (route/piste comprise). */
  function canEnterHex(c, h, from) {
    if (!assisted.value) return true
    const remaining = remainingMp(c)
    if (remaining == null) return true
    return remaining >= terrainCost(h, from)
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
  function spendMp(c, h, from) {
    if (!assisted.value || c?.mov == null) return
    const spent = (spentMp.value.get(String(c.id)) ?? 0) + terrainCost(h, from)
    spentMp.value = new Map(spentMp.value).set(String(c.id), spent)
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
  function refundMp(c, h, from) {
    if (!assisted.value || c?.mov == null) return
    const spent = Math.max(0, (spentMp.value.get(String(c.id)) ?? 0) - terrainCost(h, from))
    spentMp.value = new Map(spentMp.value).set(String(c.id), spent)
  }

  /** Redonne à `c` la TOTALITÉ de ses MP pour ce tour-ci (par opposition à
   *  `refundMp`, qui ne recrédite qu'UN SEUL hex) — à appeler quand TOUS les
   *  déplacements du tour de `c` sont annulés d'un coup (cf. HexMap.vue,
   *  "Annuler le mouvement" du menu contextuel, qui ramène directement `c` à
   *  sa position de tout début de tour, sans repasser hex par hex). Même
   *  garde-fous que `spendMp`/`refundMp`. */
  function resetMp(c) {
    if (!assisted.value || c?.mov == null) return
    const next = new Map(spentMp.value)
    next.delete(String(c.id))
    spentMp.value = next
  }

  return { showGrid, selectable, draggable, canControl, phase, nextLabel, advance, canEnterHex, spendMp, refundMp, resetMp, terrainCost, remainingMp }
}
