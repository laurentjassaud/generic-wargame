// ═══════════════════════════════════════════════════════════════════════════
// useDemolition — DÉMOLITION DES PONTS du mode "Assisté"
// ═══════════════════════════════════════════════════════════════════════════
//
// Certains ponts d'une carte peuvent SAUTER en cours de partie. Le module
// déclare lesquels et à quelles conditions (`rules.bridgeDemolition`, cf.
// lib/rules.js::resolveBridgeDemolition) ; ce fichier porte la règle, et
// lib/edges.js le versant "nature d'arête" (ce que laisse un pont démoli).
// Sans cette déclaration, tout ici reste INERTE : aucune occasion ne s'ouvre
// et `isDemolished` répond toujours faux — un module qui n'en a pas joue donc
// exactement comme avant.
//
// ─── LA RÈGLE (Arnhem) ───────────────────────────────────────────────────────
// « Tous les ponts de canal et de chemin de fer de la carte peuvent être
// détruits dès qu'une unité alliée occupe un hex que borde l'un d'eux, quelle
// que soit la phase et quel que soit le tour. C'est le joueur allemand qui
// décide, en validant une modale ; cela se fait IMMÉDIATEMENT, par un jet de
// dé : sur 1 ou 2 le pont est détruit. S'il ne souhaite pas tenter la
// destruction, ou si le jet ne détruit pas le pont, il ne pourra plus le
// faire : le pont restera intact pour tout le reste de la partie. »
//
// Trois états, donc, pour chaque pont démolissable :
//   - EN SURSIS : rien ne s'est encore passé. Tant qu'aucune unité du camp
//     `trigger` ne borde le pont, il n'y a pas d'occasion ; dès qu'il y en a
//     une, l'occasion s'ouvre et doit être tranchée (cf. `opportunities`) ;
//   - DÉTRUIT (`demolishedKeys`) : l'arête ne vaut plus que par l'obstacle
//     que le pont franchissait (cf. lib/edges.js::revealedKind) — rond ROUGE ;
//   - SCELLÉ (`sealedKeys`) : l'occasion a été tranchée sans destruction (dé
//     raté ou renoncement) ; le pont tient pour le reste de la partie et ne
//     sera plus jamais proposé — rond VERT.
// Les ponts en sursis ne portent aucune marque : la carte n'a pas à se
// couvrir de ronds pour quinze ponts dont rien n'est encore joué.
//
// ─── POURQUOI UN COMPUTED, ET PAS UN CROCHET SUR CHAQUE DÉPLACEMENT ─────────
// L'occasion naît « dès qu'une unité alliée DEVIENT ou EST dans un hex » que
// borde un pont : un mouvement, mais aussi une entrée en jeu, un largage, une
// retraite, un refoulement, une avance après combat, le déploiement initial,
// ou le déplacement d'un adversaire reçu par le réseau. Plutôt que
// d'instrumenter ces huit points d'appel (et d'en oublier un),
// `opportunities` DÉDUIT la liste des occasions ouvertes de l'état de la
// carte : elle se recalcule d'elle-même dès qu'un pion bouge, d'où qu'il
// vienne.
//
// ─── CE QUI EST JOURNALISÉ ───────────────────────────────────────────────────
// Chaque décision donne une entrée de journal `demolition` (cf. HexMap.vue) :
// l'arête, le dé s'il a été lancé, et si le pont est tombé. `applyReplay` la
// rejoue telle quelle — c'est elle qui fait autorité, jamais un nouveau
// tirage, sans quoi un journal rechargé raconterait une autre partie.
//
// Paramètres reçus :
//   - `assisted` : ref/computed booléen — hors mode Assisté, aucune règle.
//   - `terrain` : `module.terrain` — pour retrouver les arêtes des couches
//     démolissables (cf. lib/edges.js).
//   - `demolition` : `rules.bridgeDemolition` résolu, ou `null`.
//   - `counters` : ref des pions posés sur la carte.
//   - `sideOf` : `(counter) => clé de camp | null` (cf. HexMap.vue::
//     sideOfCounter) — pour reconnaître le camp `trigger`.
//   - `isFighter` : cf. lib/units.js — ni marqueur, ni pion de soutien : une
//     zone de largage posée près d'un pont n'ouvre aucune occasion.
import { computed, ref } from 'vue'
import { parseHexId } from './calibration.js'
import { resolveEdges } from './edges.js'

/** Les deux sens d'une arête "AAAA-BBBB" — le JSON ne la liste qu'une fois,
 *  dans un ordre arbitraire, et un appelant peut nommer l'un ou l'autre. */
function bothWays(edgeKey) {
  const [hexA, hexB] = String(edgeKey).split('-')
  return [hexA + '-' + hexB, hexB + '-' + hexA]
}

export function useDemolition({ assisted, terrain, demolition = null, counters, sideOf = () => null, isFighter = () => true }) {
  // Interprète des arêtes, reconstruit ICI plutôt que reçu de
  // lib/useAssisted.js : c'est un objet PUR (il ne dépend que de `terrain`,
  // qui ne change pas en cours de partie), et l'ordre d'appel l'impose —
  // HexMap.vue crée ce composable AVANT useAssisted(), à qui il fournit
  // justement `isDemolished`.
  const edges = resolveEdges(terrain, demolition)

  // Ponts DÉTRUITS et ponts dont le sort est SCELLÉ (cf. l'en-tête) — clés
  // d'arête dans les deux sens, pour être interrogeables quel que soit le
  // sens dans lequel l'appelant nomme l'arête.
  const demolishedKeys = ref(new Set())
  const sealedKeys = ref(new Set())

  /** La règle s'applique-t-elle en ce moment ? */
  const active = computed(() => !!assisted.value && !!demolition)

  /** Ce pont a-t-il sauté ? C'est LA question que pose le moteur à chaque
   *  lecture d'arête (cf. lib/useAssisted.js, paramètre `isDemolished`).
   *  Répond faux hors mode Assisté : en mode Libre, aucune règle d'arête
   *  n'est appliquée de toute façon, et une partie repassée en mode Libre ne
   *  doit pas s'y retrouver avec des ponts coupés. */
  function isDemolished(edgeKey) {
    return active.value && demolishedKeys.value.has(edgeKey)
  }

  /** Le sort de ce pont est-il déjà réglé (détruit ou scellé) ? */
  function isSettled(edgeKey) {
    return demolishedKeys.value.has(edgeKey) || sealedKeys.value.has(edgeKey)
  }

  /** Une unité du camp `trigger` occupe-t-elle l'hex `hexKey` ("CCRR") ?
   *  Sans `trigger` déclaré, n'importe quelle unité qui n'est pas du camp
   *  décideur fait l'affaire. */
  function triggeredAt(hexKey) {
    const { col, row } = parseHexId(hexKey)
    return counters.value.some((counter) => isFighter(counter) && counter.col === col && counter.row === row
      && (demolition.trigger ? sideOf(counter) === demolition.trigger : sideOf(counter) !== demolition.by))
  }

  /** OCCASIONS OUVERTES : les ponts démolissables dont le sort n'est pas
   *  encore réglé et que borde au moins une unité du camp `trigger` (cf.
   *  l'en-tête : déduit de la carte, jamais accroché aux déplacements).
   *  Chaque entrée : `{ key, layer, label, hexes }` — `hexes` : les deux hex
   *  imprimés que le pont relie, pour la modale et le journal. */
  const opportunities = computed(() => {
    if (!active.value) return []
    return edges.demolishableEdges
      .filter((edge) => !isSettled(edge.key) && (triggeredAt(edge.from) || triggeredAt(edge.to)))
      .map((edge) => ({
        key: edge.key,
        layer: edge.layer,
        label: demolition.labels?.[edge.layer] ?? 'pont',
        hexes: [edge.from, edge.to],
      }))
  })

  /** Le pont `edgeKey` tel que l'attend la modale — `{ key, layer, label,
   *  hexes }` — quel que soit le sens dans lequel l'arête est nommée, et
   *  qu'une occasion soit ouverte sur lui ou non. Sert EN LIGNE : le camp
   *  décideur reçoit une clé d'arête de l'autre écran (cf. HexMap.vue,
   *  section "Démolition des ponts") et doit pouvoir en parler sans dépendre
   *  de sa propre lecture des occasions. `null` si l'arête n'est pas un pont
   *  démolissable de ce module. */
  function bridgeAt(edgeKey) {
    const [forward, backward] = bothWays(edgeKey)
    const edge = edges.demolishableEdges.find((candidate) => candidate.key === forward || candidate.key === backward)
    if (!edge) return null
    return {
      key: edge.key,
      layer: edge.layer,
      label: demolition.labels?.[edge.layer] ?? 'pont',
      hexes: [edge.from, edge.to],
    }
  }

  /** L'occasion à trancher MAINTENANT — la première ouverte, `null` s'il n'y
   *  en a aucune. Les autres suivront d'elles-mêmes : chaque décision retire
   *  son pont de la liste (cf. `settle`), et la suivante prend sa place. */
  const current = computed(() => opportunities.value[0] ?? null)

  /** Enregistre le sort d'un pont — le seul chemin par lequel l'état change,
   *  en jeu comme au rejeu du journal. `destroyed` : le pont est tombé. */
  function settle(edgeKey, destroyed) {
    const keys = bothWays(edgeKey)
    const target = destroyed ? demolishedKeys : sealedKeys
    target.value = new Set([...target.value, ...keys])
  }

  /** Le camp décideur TENTE la destruction du pont `edgeKey` : un dé est
   *  lancé, le pont tombe si sa face est dans `destroyOn` (1 ou 2 à Arnhem).
   *  Dans les deux cas le sort du pont est réglé — réussi, il est détruit ;
   *  raté, il tient pour le reste de la partie.
   *  @param die face imposée (rejeu du journal, ou réponse reçue de l'autre
   *    écran) ; tirée ici quand elle n'est pas fournie.
   *  @returns `{ die, destroyed }`, ou `null` si la règle ne s'applique pas. */
  function attempt(edgeKey, die = null) {
    if (!active.value) return null
    const faces = demolition.faces ?? 6
    const rolled = Number.isInteger(die) ? die : Math.floor(Math.random() * faces) + 1
    const destroyed = demolition.destroyOn.includes(rolled)
    settle(edgeKey, destroyed)
    return { die: rolled, destroyed }
  }

  /** Le camp décideur RENONCE : le pont tient pour le reste de la partie
   *  (aucun dé n'est lancé, et il ne sera plus proposé). */
  function decline(edgeKey) {
    if (!active.value) return false
    settle(edgeKey, false)
    return true
  }

  /** Rejeu d'une entrée `demolition` du journal (cf. HexMap.vue) : c'est
   *  ELLE qui fait autorité, jamais un nouveau tirage. */
  function applyReplay({ edge, destroyed } = {}) {
    if (!edge) return
    settle(edge, !!destroyed)
  }

  /** Marques à peindre sur la carte (cf. HexMap.vue) : un rond par pont dont
   *  le sort est réglé — ROUGE s'il est détruit, VERT s'il tient. Les ponts
   *  en sursis n'en portent aucune (cf. l'en-tête). Chaque entrée :
   *  `{ key, destroyed, from, to }`, `from`/`to` étant les deux hex
   *  (`{ col, row }`, col 0-based) dont il faut prendre le milieu. */
  const marks = computed(() => {
    if (!active.value) return []
    return edges.demolishableEdges
      .filter((edge) => isSettled(edge.key))
      .map((edge) => ({
        key: edge.key,
        destroyed: demolishedKeys.value.has(edge.key),
        from: parseHexId(edge.from),
        to: parseHexId(edge.to),
      }))
  })

  /** Rechargement d'un journal : on repart de zéro (cf. HexMap.vue::
   *  resetBoardForReplay). */
  function reset() {
    demolishedKeys.value = new Set()
    sealedKeys.value = new Set()
  }

  return { active, isDemolished, opportunities, current, bridgeAt, attempt, decline, applyReplay, marks, reset }
}
