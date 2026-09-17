// ═══════════════════════════════════════════════════════════════════════════
// useArnhem — règles PARTICULIÈRES au module "arnhem"
// ═══════════════════════════════════════════════════════════════════════════
//
// POURQUOI CE FICHIER ?
// Le moteur (HexMap.vue + lib/useAssisted.js + lib/useCombat.js +
// lib/useRetreat.js) est GÉNÉRIQUE : il ne connaît que ce que le JSON d'un
// module lui déclare (carte, pions, terrain, camps, pistes de tour...).
// Mais chaque boîte de jeu a en plus des règles qui ne valent QUE pour elle
// et qu'aucun champ du JSON ne sait exprimer (ex. "au coup d'envoi, seules
// les zones de largage alliées sont posées sur la carte"). Ces règles-là
// vivent ICI, dans un fichier par module, et non éparpillées en `if` dans le
// moteur.
//
// QUAND SONT-ELLES APPLIQUÉES ?
// UNIQUEMENT quand la partie en cours utilise le module "arnhem" (cf.
// `ARNHEM_MODULE_ID` ci-dessous, comparé au `moduleId` reçu — celui de
// public/modules/index.json, passé à HexMap.vue par DemoPlay.vue et
// RoomLobby.vue). Sur tout autre module, le composable reste INERTE :
// `active` vaut false et CHAQUE règle renvoie `null`.
//
// LA CONVENTION `null` = "PAS DE RÈGLE PARTICULIÈRE"
// C'est le point clé de ce fichier. Une règle ne renvoie jamais un booléen
// "par défaut" : elle renvoie `null` quand elle n'a rien à dire, et
// l'appelant retombe alors sur le comportement générique du moteur :
//
//     const special = arnhem.autoPlacesAtLoad(c)   // true | false | null
//     if (special !== null) return special         // Arnhem tranche
//     ...suite = règle générique...                // sinon, moteur générique
//
// Un simple `false` ne conviendrait pas : il voudrait dire "Arnhem interdit",
// ce qui est une DÉCISION, alors que `null` veut dire "Arnhem ne se prononce
// pas". Sans ce troisième état, on ne pourrait pas distinguer les deux, et
// le composable inerte (autre module) imposerait ses réponses à tout le
// monde.
//
// AJOUTER UNE RÈGLE
//   1. écrire la fonction dans le `return` ci-dessous, en la faisant sortir
//      `null` dès que `!active.value` (ou dès que le cas ne la concerne pas) ;
//   2. l'appeler depuis le moteur au bon endroit, avec le motif `if (x !==
//      null) return x` ci-dessus ;
//   3. documenter ici D'OÙ vient la règle (livret de règles / carte / chart),
//      pour qu'on puisse la vérifier sans rouvrir la boîte.
// Pour un AUTRE module (hurtgen, bastogne...), on crée un `useHurtgen.js` sur
// ce même patron plutôt que d'élargir celui-ci.
//
// PARAMÈTRES
//   - `moduleId` : ref/computed OU chaîne simple — identifiant court du
//     module joué (ex. "arnhem"). Accepté sous les deux formes (cf. `unref`)
//     parce que HexMap.vue le reçoit en prop (donc `toRef(props,
//     'moduleId')`), mais qu'un appelant hors composant peut n'avoir qu'une
//     chaîne. Réactif : rien n'est figé à l'appel.
//   - `ctx` : ce que le moteur prête au module pour formuler ses règles —
//     volontairement MINIMAL, pour que ce fichier reste lisible et qu'on
//     voie d'un coup d'œil de quoi il dépend :
//       • `sides`  : `module.sides` (ex. { german: ["german"], allies:
//         ["commonwealth","us","pol"] }) — sert à reconnaître les factions
//         alliées SANS les lister en dur ici (le JSON reste la source de
//         vérité sur la composition des camps).
//       • `isUnit` : `(counter) => bool` (cf. HexMap.vue::isUnit) — un vrai
//         pion combattant, par opposition à un MARQUEUR (type "marker", ex.
//         les zones de largage "DZ ..."). La distinction est au cœur de la
//         règle de déploiement ci-dessous.
//       • `assisted` : ref/computed booléen (ex. `toRef(props, 'assisted')`)
//         — la partie tourne-t-elle en mode Assisté ? Nécessaire aux règles
//         qui touchent aux POINTS DE MOUVEMENT : les MP n'existent QUE dans
//         ce mode (cf. lib/useAssisted.js — en mode Libre, `spendMp` et
//         consorts ne font rien). Une règle de MP doit donc rendre `null`
//         hors mode Assisté, sans quoi elle irait écrire un état que le
//         reste du moteur ignore.
//       • `terrain` : `module.terrain` (`grid` hexId → type, `types`) — pour
//         les règles liées au terrain (ex. retraite en ville).
import { computed, unref } from 'vue'
import { hexId } from './calibration.js'

// Identifiant du module concerné, tel qu'il figure dans
// public/modules/index.json. Exporté pour que l'appelant puisse, s'il le
// veut, tester l'appartenance sans instancier le composable.
export const ARNHEM_MODULE_ID = 'arnhem'

// Règle d'ARRIVÉE DES AÉROPORTÉS (cf. `airborneArrivalSpentMp` plus bas) —
// énoncé du livret : « Durant le Tour où des Renforts aéroportés arrivent
// sur la carte, ils disposent d'une Allocation de Mouvement de trois. Ils
// sont considérés comme ayant dépensé quatre Points de Mouvement à leur
// arrivée. Après leur Tour de Jeu initial sur la carte, les unités
// aéroportées peuvent utiliser leur pleine Allocation de Mouvement
// imprimée. »
//
// La règle est écrite en "MP DÉPENSÉS" (4) et non en "MP restants" (3),
// et c'est aussi ainsi qu'on l'implémente — pour deux raisons :
//  1. c'est exactement la façon dont le moteur compte (cf.
//     lib/useAssisted.js::remainingMp = `c.mov - spentMp`) : il suffit
//     d'inscrire 4 dans les MP dépensés du pion, sans toucher à son `mov`
//     imprimé (7 pour TOUS les aéroportés d'Arnhem — 7 - 4 = 3, l'allocation
//     annoncée) ;
//  2. le livret distingue les deux formulations à dessein : "considérés
//     comme ayant dépensé 4" fait de l'atterrissage un mouvement DÉJÀ
//     entamé, ce qui compte pour toutes les règles qui regardent les MP
//     dépensés, pas seulement pour le reste disponible.
const AIRBORNE_ARRIVAL_SPENT_MP = 4

export function useArnhem(moduleId, ctx = {}) {
  // Vrai seulement si la partie en cours EST Arnhem. Toutes les règles
  // ci-dessous commencent par le consulter : c'est lui qui garantit
  // qu'aucune règle particulière ne fuite vers un autre module.
  const active = computed(() => unref(moduleId) === ARNHEM_MODULE_ID)

  // Factions du camp allié pour CE module (cf. `ctx.sides`). Recalculé à la
  // demande plutôt que figé : `sides` vient du JSON et ne change pas en
  // cours de partie, mais le composable peut être appelé avant que le
  // module ne soit chargé.
  const alliedFactions = computed(() => ctx.sides?.allies ?? [])

  /** Règle de DÉPLOIEMENT INITIAL — quels pions sont déjà sur la carte au
   *  chargement de la partie ?
   *
   *  Règle générique du moteur (cf. HexMap.vue::autoPlacesAtLoad) : tout
   *  pion qui a un `setup` (hex de départ) et qui arrive au tour 1 est posé
   *  d'office sur la carte.
   *
   *  Particularité d'Arnhem — le scénario commence AVANT le largage :
   *   - côté ALLIÉ, le déploiement initial EST l'opération aéroportée. Seuls
   *     les MARQUEURS de zone de largage ("DZ ...", cf. `ctx.isUnit`) sont
   *     posés au coup d'envoi ; les unités, elles, attendent dans le panneau
   *     "Renfort alliés" et c'est le joueur qui les largue lui-même sur leur
   *     DZ ou l'un de ses 6 hex voisins (cf. HexMap.vue, `setup` "CCRR+adj"
   *     et phase Airborne de lib/useAssisted.js) ;
   *   - côté ALLEMAND, les renforts du tour 1 arrivent bien PENDANT ce tour,
   *     mais ne sont pas déployés au coup d'envoi : ils restent dans le
   *     panneau "Renfort allemands", comme ceux de n'importe quel autre
   *     tour. Seule la garnison fixe (pions sans `turn`, donc hors du test
   *     `turn === 1` ci-dessous) est déjà en place.
   *
   *  @returns `false` pour les pions qu'Arnhem retient hors carte, `null`
   *    dans tous les autres cas — y compris hors module Arnhem — pour
   *    laisser le moteur appliquer sa règle générique. Ne renvoie jamais
   *    `true` : cette règle ne fait que RETENIR des pions, elle n'en pose
   *    jamais un que le moteur aurait laissé de côté. */
  function autoPlacesAtLoad(counter) {
    if (!active.value) return null
    // Les pions qui n'arrivent pas au tour 1 ne sont pas concernés : c'est le
    // moteur qui tranche.
    if ((counter.turn ?? 1) !== 1) return null
    // `turn === 1` STRICT (et non `turn ?? 1`) : la garnison allemande fixe
    // ne déclare AUCUN tour d'arrivée — elle tient déjà le terrain au coup
    // d'envoi et doit donc rester au placement générique. Seuls les RENFORTS
    // allemands, qui datent explicitement leur arrivée du tour 1, sont
    // retenus hors carte.
    if (counter.faction === 'german' && counter.turn === 1) return false
    if (ctx.isUnit?.(counter) && alliedFactions.value.includes(counter.faction)) return false
    return null
  }

  // --- Arrivée des aéroportés : mémoire du tour en cours ---------------------
  // Identifiants (en chaîne) des unités aéroportées ayant ATTERRI pendant le
  // tour de jeu en cours. Cet ensemble est ce qui distingue « leur Tour de
  // Jeu initial sur la carte » (allocation réduite) de tous les suivants
  // (pleine allocation) : le moteur le vide à chaque changement de camp/tour
  // (cf. `clearTurnState`, appelée depuis HexMap.vue::clearAllMoved), après
  // quoi les mêmes unités ne sont plus concernées par la règle.
  //
  // Un `Set` NU (non réactif) : il n'est jamais lu par un template ni par un
  // `computed`, seulement par les fonctions impératives ci-dessous, appelées
  // au moment précis d'une pose ou d'une annulation.
  const airborneArrivals = new Set()

  /** Ce pion entre-t-il en jeu par LARGAGE/ATTERRISSAGE ? Critère : son
   *  `setup` se termine par "+adj" — la notation du module pour « sur cet hex
   *  de référence (sa DZ) OU l'un de ses 6 voisins », qui n'est utilisée QUE
   *  par l'aéroporté (cf. HexMap.vue, `entryHexSet`, et la phase Airborne de
   *  lib/useAssisted.js). On s'appuie sur elle plutôt que sur `c.type`
   *  ("airborne infantry", "glider", "airborne arty") : c'est le MODE
   *  D'ENTRÉE qui déclenche la règle, et cette notation est justement ce que
   *  le reste du moteur utilise déjà pour le reconnaître. */
  function isAirborneEntry(counter) {
    return typeof counter?.setup === 'string' && counter.setup.endsWith('+adj')
  }

  /** À appeler juste APRÈS qu'une unité aéroportée a été posée sur la carte
   *  — en jeu (cf. HexMap.vue::onHex, branche "entrée d'un renfort") comme
   *  au rejeu d'un journal (cf. applyReplayEntry, entrée `place`, où seule
   *  cette mémoire est à rétablir : les MP dépensés, eux, sont relus du
   *  journal). Sans effet hors module Arnhem ou pour une unité qui n'arrive
   *  pas par largage. */
  function noteAirborneArrival(counter) {
    if (!active.value || !isAirborneEntry(counter)) return
    airborneArrivals.add(String(counter.id))
  }

  /** Combien de MP ce pion doit-il compter comme DÉJÀ DÉPENSÉS du seul fait
   *  de son arrivée ? `AIRBORNE_ARRIVAL_SPENT_MP` (4) s'il a atterri pendant
   *  le tour en cours (cf. `noteAirborneArrival`), `null` sinon — donc aussi
   *  bien pour une unité arrivée à un tour précédent (qui retrouve sa pleine
   *  allocation imprimée) que pour une unité terrestre, un autre module, ou
   *  le mode Libre, où les MP n'existent pas (cf. `ctx.assisted`).
   *
   *  Deux usages côté moteur, tous deux dans HexMap.vue :
   *   1. à la POSE de l'unité, pour inscrire ses 4 MP d'entrée (cf.
   *      lib/useAssisted.js::setSpentMp) ;
   *   2. après un `resetMp` (menu contextuel "Annuler le mouvement"), qui
   *      rend la TOTALITÉ des MP : sans cette seconde inscription, annuler
   *      le mouvement d'un aéroporté fraîchement largué lui rendrait 7 MP au
   *      lieu de 3 et permettrait de contourner la règle. */
  function airborneArrivalSpentMp(counter) {
    if (!active.value || !unref(ctx.assisted)) return null
    if (!airborneArrivals.has(String(counter?.id))) return null
    return AIRBORNE_ARRIVAL_SPENT_MP
  }

  /** Oublie les arrivées aéroportées du tour écoulé — « Après leur Tour de
   *  Jeu initial sur la carte, les unités aéroportées peuvent utiliser leur
   *  pleine Allocation de Mouvement imprimée » : à partir de là, elles ne
   *  sont plus reconnues par `airborneArrivalSpentMp`, qui rend `null`, et
   *  le moteur leur redonne donc leurs MP complets comme à tout le monde.
   *  Appelée par HexMap.vue::clearAllMoved, c'est-à-dire à chaque changement
   *  de camp/tour ET à la remise à zéro du plateau pour un rejeu. */
  function clearTurnState() {
    airborneArrivals.clear()
  }

  /** Type de terrain de l'hex `hex` ({ col, row }, col 0-based comme les
   *  pions) — lu dans `ctx.terrain.grid`, même clé que
   *  lib/useAssisted.js::terrainAreaCost. `undefined` si non déclaré. */
  function terrainTypeAt(hex) {
    return ctx.terrain?.grid?.[hexId(hex.col + 1, hex.row)]
  }

  /** Règle des RETRAITES EN VILLE (City) — énoncé du livret :
   *  « Les unités occupant, entrant ou retraitant dans un hex de Ville
   *  peuvent réduire tous les résultats de retraite restants de deux hex.
   *  Ainsi une retraite restante de D1, D2 ou Br peut, au choix du joueur
   *  propriétaire, devenir un résultat "sans effet" ; A1 ou A2 peuvent aussi
   *  être traités comme "sans effet". Tous les résultats d'"élimination"
   *  sont traités normalement. Un D3 doit donner une retraite d'au moins un
   *  hex, et un D4 d'au moins deux hex. Pour tout le reste, les unités en
   *  hex de Ville sont traitées comme en hex de Town normal. [L'artillerie
   *  aéroportée ne bénéficie d'aucune réduction.] »
   *
   *  (La dernière phrase, "traitées comme en Town", est déjà assurée par le
   *  moteur : cf. lib/useCombat.js, ligne de table "Broken, Town..." qui
   *  inclut "city". De/Ae ne sont pas des retraites : le moteur ne consulte
   *  jamais cette règle pour eux.)
   *
   *  Appelée par lib/useRetreat.js (paramètre générique `retreatReduction`)
   *  chaque fois qu'une unité en retraite se trouve dans un hex — au départ
   *  (« occupant ») comme après chaque pas (« entrant/retraitant ») — et
   *  aussi pendant l'exploration des chemins possibles, pour ne pas déclarer
   *  "impossible" une retraite qu'une ville rendrait faisable.
   *
   *  @param unit  le pion qui retraite
   *  @param hex   { col, row } — l'hex où il se trouve (ou se trouverait)
   *  @param task  { initial, total, done } — nombre d'hex du résultat tiré
   *               (`initial`, ex. 4 pour un D4), à parcourir actuellement
   *               (`total`) et déjà parcourus (`done`)
   *  @returns `{ total, reason }` — le NOUVEAU nombre total d'hex de la
   *    retraite et un libellé pour l'affichage — ou `null` si la règle ne
   *    s'applique pas (autre module, hex non City, artillerie aéroportée,
   *    réduction déjà prise, rien à réduire). La réduction reste
   *    FACULTATIVE : c'est le moteur qui la propose au joueur (bouton de la
   *    modale de combat), et ne l'impose que si, sans elle, l'unité serait
   *    éliminée faute de retraite possible. */
  function cityRetreatReduction(unit, hex, task) {
    if (!active.value || !unref(ctx.assisted)) return null
    if (terrainTypeAt(hex) !== 'city') return null
    // [Airborne artillery receive no reduction.]
    if (unit?.type === 'airborne arty') return null
    // UNE SEULE réduction par retraite : "réduire les retraites RESTANTES
    // de deux hex" s'applique à ce qui reste, une fois. La cumuler (départ
    // en ville PUIS entrée dans une autre ville) violerait les minimums
    // ci-dessous (ex. D4 : 4 → 2 → 0). Une retraite déjà réduite se
    // reconnaît à son total inférieur au résultat tiré.
    if (task.total < task.initial) return null
    // Minimums imposés par le livret : D3 → au moins 1 hex, D4 → au moins 2.
    // Pour D1/D2/A1/A2/Br (résultats de 1 ou 2 hex), aucun minimum : ils
    // peuvent devenir "sans effet". Seuls les D vont jusqu'à 3-4 hex, d'où
    // le test sur `initial` seul.
    const minimum = task.initial === 4 ? 2 : task.initial === 3 ? 1 : 0
    // Les hex déjà parcourus restent acquis (`done`) : on ne retire que du
    // RESTANT, au plus 2 hex.
    const total = Math.max(task.done, minimum, task.total - 2)
    if (total >= task.total) return null // rien à gagner
    return { total, reason: 'hex City (règle Arnhem)' }
  }

  return { active, autoPlacesAtLoad, noteAirborneArrival, airborneArrivalSpentMp, clearTurnState, cityRetreatReduction }
}
