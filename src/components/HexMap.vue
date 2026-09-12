<script setup>
// ═══════════════════════════════════════════════════════════════════════════
// HexMap.vue — carte hexagonale complète : toolbar, image + grille SVG
// cliquable, et panneau de calibration. Composant autonome : reçoit un
// `module` (la boîte de jeu — cf. public/modules/*.json) pour l'image et la
// géométrie de grille (cols/rows) ; la calibration pixel de la grille
// (x0/y0/colStep/a/rowStep) vient elle de DEFAULT_CALIBRATION dans
// lib/calibration.js et reste ajustable en direct via CalibrationPanel.vue.
//
// SYSTÈME DE COORDONNÉES :
//  - "hex" (col, row) : coordonnées logiques de la grille, col 0-based,
//    row 1-based (cohérent avec le format imprimé sur la carte, ex. "0101").
//  - "pixel SVG" (x, y) : coordonnées dans le viewBox de l'image, calculées
//    via `calibration` (x0/y0 = centre du premier hex, colStep/rowStep = pas
//    entre hex, a = rayon horizontal). Colonnes IMPAIRES décalées de
//    +rowStep/2 vers le bas (grille flat-top, offset odd-q).
//  - Le zoom redimensionne le SVG en CSS ; le viewBox reste fixe en pixels
//    "image" — la mise à l'échelle est faite par le navigateur.
// ═══════════════════════════════════════════════════════════════════════════

import { reactive, ref, computed, toRef, onUnmounted, nextTick } from 'vue'
import { hexId, parseHexId, DEFAULT_CALIBRATION } from '../lib/calibration.js'
import { neighborsOf } from '../lib/hex.js'
import { hexExists, removedHexSet } from '../lib/mapShape.js'
import { useAssisted } from '../lib/useAssisted.js'
import { useDebug } from '../lib/useDebug.js'
import CalibrationPanel from './CalibrationPanel.vue'
import Counter from './Counter.vue'
import TurnTracker from './TurnTracker.vue'
import SupportTracker from './SupportTracker.vue'
import JournalPanel from './JournalPanel.vue'
import SidePanel from './SidePanel.vue'
import ReinforcementsPanel from './ReinforcementsPanel.vue'
import EliminatedPanel from './EliminatedPanel.vue'
import ContextMenu from './ContextMenu.vue'
import RollModal from './RollModal.vue'
import MovementChartModal from './MovementChartModal.vue'
import CombatChartModal from './CombatChartModal.vue'

const props = defineProps({
  module: { type: Object, required: true }, // cf. src/modules/*.json — { boardGame, name, map: {...} }
  // Positions déjà déplacées depuis le setup du module (partie multijoueur en
  // cours) — { [counterId]: { col, row } }. Absent en solo/démo.
  initialPositions: { type: Object, default: () => ({}) },
  // Pas courant du suivi de tour déjà en cours (partie multijoueur reprise
  // en route) — cf. `turnTrack` ci-dessous. Absent (0) en solo/démo.
  initialTurnStep: { type: Number, default: 0 },
  // Identifiant court du module (ex. "arnhem", cf. public/modules/index.json)
  // — sert uniquement à nommer les sauvegardes du journal (cf.
  // JournalPanel.vue::saveLabel). À défaut (non fourni par l'appelant), on
  // retombe sur `module.name`.
  moduleId: { type: String, default: '' },
  // Partie "Assistée" (cf. LocalGameSetup.vue, param `party`) : variante
  // opt-in avec garde-fous (grille, sélection au clic, restriction de tour
  // — cf. lib/useAssisted.js). Comportement PAR DÉFAUT (`false`) : "Libre",
  // bac à sable sans garde-fous.
  assisted: { type: Boolean, default: false },
})

const emit = defineEmits(['move', 'turn'])

const map = computed(() => props.module.map)

// --- Journal de partie : historique de tout ce qui se passe (cf.
// JournalPanel.vue, onglet du panneau latéral — toute la logique y vit).
// HexMap.vue se contente d'appeler `log(kind, text)` à chaque évènement de
// jeu (tour, déplacement, entrée en jeu, élimination...).
const journalRef = ref(null)
function log(kind, text, data) { return journalRef.value?.log(kind, text, data) }

// --- Retour arrière : annule le dernier déplacement d'un pion déjà posé sur
// la carte (onHex / onCounterDragEnd ci-dessous) et efface son entrée de
// journal correspondante. Ne couvre volontairement que les déplacements —
// pas les entrées en jeu, éliminations, etc., qui ont leurs propres
// mécanismes de retour (menu contextuel "Replacer le pion").
const moveHistory = ref([])
function pushMoveHistory(counterId, from, to, journalId) {
  if (journalId == null) return
  moveHistory.value.push({ counterId, from, to, journalId })
}

// --- Liseré orange "a bougé ce tour" : un pion déplacé (clic ou glisser,
// cf. onHex / onCounterDragEnd / applyRemoteMove) rejoint `movedThisTurnIds`
// et sa position de départ (avant son PREMIER mouvement du tour) est gardée
// dans `turnStartPositions`, pour que "Annuler le mouvement" (menu
// contextuel, cf. onCounterContextMenu) puisse le ramener d'un coup à cette
// position quel que soit le nombre de déplacements intermédiaires. Les deux
// sont vidés à chaque changement de tour (cf. onTurnChange) : "à la fin du
// tour du joueur, tous les liserés sont enlevés".
const movedThisTurnIds = ref(new Set())
const turnStartPositions = new Map()
function markMoved(counterId, from) {
  const key = String(counterId)
  if (!turnStartPositions.has(key)) turnStartPositions.set(key, from)
  movedThisTurnIds.value.add(key)
  movedThisTurnIds.value = new Set(movedThisTurnIds.value)
}
function clearMoved(counterId) {
  const key = String(counterId)
  turnStartPositions.delete(key)
  if (movedThisTurnIds.value.delete(key)) movedThisTurnIds.value = new Set(movedThisTurnIds.value)
}
function clearAllMoved() {
  turnStartPositions.clear()
  movedThisTurnIds.value = new Set()
}
/** Menu contextuel "Annuler le mouvement" (cf. onCounterContextMenu) : remet
 *  le pion à sa position de début de tour, en une seule fois. */
function cancelMovement(id) {
  const key = String(id)
  const start = turnStartPositions.get(key)
  if (!start) return
  const c = counters.value.find((c) => String(c.id) === String(id))
  if (c) {
    // cf. lib/useAssisted.js::resetMp — annule d'un coup TOUS les
    // déplacements du tour de `c` (pas hex par hex comme `undoLastMove`
    // ci-dessous), donc on lui redonne la TOTALITÉ de ses MP plutôt que de
    // recréditer un seul hex. Ne fait rien hors mode Assisté.
    resetMp(c)
    c.col = start.col; c.row = start.row
    emit('move', { counterId: c.id, col: c.col, row: c.row })
    log('move', `${c.name} : mouvement annulé, retour en ${hexId(c.col + 1, c.row)}`, { counterId: c.id, col: c.col, row: c.row })
  }
  clearMoved(id)
}

// --- Retour arrière (bouton de la barre d'outils) : disponible UNIQUEMENT
// en mode Assisté (cf. `v-if="assisted"` sur le bouton plus bas) — en mode
// Libre, aucun garde-fou de tour/MP n'existe, "annuler" un glisser-déposer
// libre n'aurait pas vraiment de sens dans un bac à sable.
function undoLastMove() {
  if (!props.assisted || replayLocked.value) return
  const last = moveHistory.value.pop()
  if (!last) return
  const c = counters.value.find((c) => String(c.id) === String(last.counterId))
  if (c) {
    // cf. lib/useAssisted.js::refundMp — recrédite le COT de l'hex QUITTÉ
    // par cette annulation (`last.to`, celui que `c` avait payé pour y
    // entrer EN VENANT de `last.from`), avant même de replacer `c` : l'ordre
    // n'a pas d'importance ici (refundMp ne regarde que les hex passés en
    // paramètre, pas la position courante de `c`). `last.to`/`last.from`
    // sont au format `{ col, row }` (comme tout `moveHistory`/position de
    // pion) — `terrainCost` attend `{ c, r }` (comme les hex de clic, cf.
    // onHex/hexes) : conversion nécessaire, sans quoi `terrainCost` ne
    // trouve jamais le bon type de terrain (ni la bonne arête route/piste)
    // et retombe silencieusement sur son coût par défaut (1 MP) au lieu du
    // vrai coût. Passer `last.from` ici (le MÊME "from" qu'au `spendMp`
    // d'origine, cf. onHex) est ce qui garantit un remboursement exact,
    // route/piste comprise, même si `c` a depuis quitté cette position.
    refundMp(c, { c: last.to.col, r: last.to.row }, { c: last.from.col, r: last.from.row })
    c.col = last.from.col; c.row = last.from.row
    emit('move', { counterId: c.id, col: c.col, row: c.row })
    // Si l'annulation ramène le pion à sa position de tout début de tour,
    // il n'a plus "bougé ce tour" au sens du liseré orange.
    const start = turnStartPositions.get(String(c.id))
    if (start && start.col === c.col && start.row === c.row) clearMoved(c.id)
  }
  journalRef.value?.remove(last.journalId)
}

// --- Dé : widget flottant non-bloquant (cf. RollModal.vue), toujours monté
// (v-show, pas v-if, pour conserver sa position glissée et son état pendant
// qu'il est caché) — résultat journalisé à chaque lancer.
const showRollModal = ref(true)
function onDiceRoll(value) { log('dice', `Lancer de dé : ${value}`) }

// --- Table des mouvements : widget flottant du même genre (cf.
// MovementChartModal.vue), affiché uniquement si le module déclare l'image
// (`module.movementChart`) — modules pas encore illustrés : pas de bouton.
const showMovementChart = ref(false)
const movementChartSrc = computed(() => props.module.movementChart)

// --- Table de combat : même widget flottant, affiché uniquement si le
// module déclare l'image (`module.combatChart`).
const showCombatChart = ref(false)
const combatChartSrc = computed(() => props.module.combatChart)

// --- Lecteur de rejeu : rejoue sur la carte les actions d'un journal
// chargé (cf. JournalPanel.vue::onFileChosen, évènement `loaded`) — un
// bouton lecture façon lecteur audio avance d'une ligne à chaque clic,
// un bouton avance rapide saute directement à la fin. `isReplaying` coupe
// le ré-enregistrement le temps d'appliquer un pas (cf. onTurnChange plus
// haut) : les entrées rejouées existent déjà dans le fichier chargé, les
// rejouer ne doit faire bouger que la carte, pas dupliquer le journal. Le
// détail de l'application de chaque type d'entrée (`applyReplayEntry`) vit
// plus bas, une fois `applyRemoteMove`/`applyRemoteTurn` déclarées.
const replayEntries = ref([])   // [{ kind, text, data }] — ordre chronologique
const replayIndex = ref(0)      // nombre d'entrées déjà appliquées à la carte
const isReplaying = ref(false)  // vrai le temps d'appliquer un pas

// --- Suivi de tour : piste de `turns` tours, chacun joué par les camps de
// `order` dans cet ordre (ex. ["allies","german"] -> Tour 1 Alliés, Tour 1
// Allemands, Tour 2 Alliés, ...). Toute la logique (pas courant, camp actif,
// restriction de contrôle) vit dans TurnTracker.vue, autonome — HexMap.vue ne
// garde qu'un miroir léger (`turnInfo`, mis à jour via `change`) pour ses
// propres besoins ailleurs (régénération du soutien allié par tour) et
// délègue `canControl`/`applyRemoteTurn` au composant enfant (cf. ref
// `turnTrackerRef`).
const turnTrackerRef = ref(null)
const turnInfo = ref({ step: props.initialTurnStep, turn: 1, activeSideKey: null, activeFactions: null })
function onTurnChange(info) {
  turnInfo.value = info
  // Fin du tour du joueur précédent : tous les liserés "a bougé ce tour"
  // sont enlevés (cf. `movedThisTurnIds`).
  clearAllMoved()
  // Ne pas ré-écrire dans le journal un changement de tour provoqué par le
  // lecteur de rejeu (cf. plus bas) — l'entrée existe déjà dans le fichier
  // chargé, la rejouer ne doit que faire bouger la carte, pas dupliquer le
  // journal.
  if (isReplaying.value) return
  const label = props.module.turnTrack?.sides?.[info.activeSideKey]?.label ?? info.activeSideKey
  log('turn', `Tour ${info.turn} — ${label}`, { step: info.step })
}
function onTurnAdvance(step) { emit('turn', step) }
function applyRemoteTurn(step) { turnTrackerRef.value?.applyRemoteTurn(step) }
// cf. lib/useAssisted.js — toute la logique propre au mode "Assisté"
// (grille, sélection au clic, restriction de tour, phases Mouvement/Combat)
// y vit.
const { showGrid, selectable, draggable, canControl, phase, nextLabel, advance, canEnterHex, spendMp, refundMp, resetMp, terrainCost, remainingMp } = useAssisted(toRef(props, 'assisted'), turnTrackerRef, props.module.terrain)
// Un renfort ne peut entrer en jeu qu'à partir de son tour d'arrivée déclaré
// (`c.turn`, cf. module JSON) — jamais en avance. Par défaut (pas de `turn`
// déclaré), l'unité arrive dès le tour 1.
const canEnterThisTurn = (c) => (c?.turn ?? 1) <= turnInfo.value.turn

// --- Soutien allié : tablette autonome (cf. SupportTracker.vue, toute la
// logique — régénération par tour, tablette actuelle — y vit). HexMap.vue ne
// garde qu'une ref pour y déléguer la résolution/retrait d'un pion glissé
// depuis la tablette (cf. onCounterDragStart / onMapDrop plus bas).
const supportTrackerRef = ref(null)

const calibration = reactive({ ...DEFAULT_CALIBRATION })
const gridStyle = reactive({ stroke: '#d11a1a', width: 1.5, opacity: 0 })
const mapConfig = reactive({ cols: map.value.cols, rows: map.value.rows })

const zoom = ref(0.5)
// `showGrid` vient de useAssisted() ci-dessus (verrouillé à false hors mode
// assisté).
const showLabels = ref(false)
const showCalib = ref(false)
const showCounters = ref(true)

// Forme réelle de la grille (colonnes décalées amputées d'une ligne, hexs
// ponctuels absents) — cf. lib/mapShape.js — recalculée seulement quand le
// module ou le nombre de cols/rows édité via CalibrationPanel change.
const mapShapeCfg = computed(() => ({
  cols: mapConfig.cols, rows: mapConfig.rows, evenColMinus: map.value.evenColMinus,
}))
const removed = computed(() => removedHexSet(map.value))
const hexOnMap = (c, r) => hexExists(c, r, mapShapeCfg.value, removed.value)

/** Liste des hex de la grille avec leur polygone SVG déjà calculé. */
const hexes = computed(() => {
  const { x0, y0, colStep, a, rowStep } = calibration
  const b = rowStep / 2
  const out = []
  for (let c = 0; c < mapConfig.cols; c++) {
    const cx = x0 + c * colStep
    const yoff = c % 2 === 1 ? rowStep / 2 : 0
    for (let r = 1; r <= mapConfig.rows; r++) {
      if (!hexOnMap(c, r)) continue
      const cy = y0 + (r - 1) * rowStep + yoff
      const pts = [
        [cx - a, cy], [cx - a / 2, cy - b], [cx + a / 2, cy - b],
        [cx + a, cy], [cx + a / 2, cy + b], [cx - a / 2, cy + b],
      ].map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')
      out.push({ id: hexId(c + 1, r), c, r, cx, cy, pts })
    }
  }
  return out
})

// Tous les pions déclarés par le module, toutes factions confondues (cf.
// public/modules/arnhem/arnhem.json -> counters.*) — sert à la fois au
// placement initial ci-dessous et à la liste des renforts pas encore posés
// (cf. `reinforcements`).
const allCounters = computed(() => Object.values(props.module.counters || {}).flat())

/** `setup` d'un pion : soit un hex unique ("0604"), soit une plage bord de
 *  carte "HHHH-HHHH" (ex. allemands, cf. arnhem.json — entrée "sur ou entre"
 *  les deux hex, alignés sur une même ligne ou une même colonne). Renvoie
 *  tous les hex valides de la plage (un seul élément si hex unique) — sert
 *  au surlignage des hex d'entrée choisissables (cf. `entryHexSet`). */
function enumerateSetupHexes(setup) {
  if (!setup.includes('-')) return [parseHexId(setup)]
  const [a, b] = setup.split('-').map(parseHexId)
  const cells = []
  if (a.row === b.row) {
    const [lo, hi] = a.col <= b.col ? [a.col, b.col] : [b.col, a.col]
    for (let c = lo; c <= hi; c++) cells.push({ col: c, row: a.row })
  } else {
    const [lo, hi] = a.row <= b.row ? [a.row, b.row] : [b.row, a.row]
    for (let r = lo; r <= hi; r++) cells.push({ col: a.col, row: r })
  }
  const valid = cells.filter((h) => hexOnMap(h.col, h.row))
  return valid.length ? valid : [a]
}

/** Un hex cible tiré au hasard dans la plage `setup` — utilisé uniquement
 *  pour le placement initial automatique au chargement (cf. `counters`
 *  ci-dessous), pas pour l'arrivée interactive d'un renfort (cf. plus bas :
 *  glisser-déposer libre ou choix explicite d'un hex surligné). */
function resolveEntryTarget(setup) {
  const pool = enumerateSetupHexes(setup)
  return pool[Math.floor(Math.random() * pool.length)]
}

/** Jamais de stacking : un pion qui arrive prend son hex d'entrée s'il est
 *  libre, sinon un des 6 hex adjacents libres tiré au hasard. `occupied` est
 *  le Set (clés "col,row") des hex déjà réservés dans le lot de placement en
 *  cours — mis à jour par l'appelant après chaque choix. Si les 7 emplacements
 *  sont pleins (cas limite), on stack quand même plutôt que de perdre le pion. */
function pickArrivalHex(col, row, occupied) {
  const key = (c, r) => c + ',' + r
  if (hexOnMap(col, row) && !occupied.has(key(col, row))) return { col, row }
  const free = neighborsOf(col, row).filter((n) => hexOnMap(n.col, n.row) && !occupied.has(key(n.col, n.row)))
  if (free.length) return free[Math.floor(Math.random() * free.length)]
  return { col, row }
}

// Les marqueurs (ex. zones de largage "DZ", type "marker") ne sont pas des
// unités : ils n'occupent jamais un hex au sens du jeu, n'importe combien de
// pions peuvent partager leur case librement, et ils prennent directement
// leur hex déclaré sans jamais être redirigés vers un voisin.
const isUnit = (c) => c.type !== 'marker'

// Un pion est posé sur la carte au chargement s'il a un `setup` (hex de
// départ) ET arrive au tour 1 (ou sans `turn` — rétrocompatible avec les
// pions sans ce champ, ex. la garnison allemande fixe). Exceptions :
//  - les renforts ALLEMANDS du tour 1 restent hors carte malgré tout — ils
//    arrivent bien pendant ce tour mais pas déjà déployés au coup d'envoi
//    (contrairement au largage aéroporté allié, qui EST le déploiement
//    initial du scénario) — donc glissables depuis le panneau comme
//    n'importe quel autre tour ;
//  - les UNITÉS alliées (tout ce qui n'est pas un marqueur, cf. isUnit) du
//    tour 1 restent elles aussi hors carte : seuls les marqueurs de zone de
//    largage ("DZ ...") sont posés au coup d'envoi. Les unités attendent
//    dans le panneau "Renfort alliés" — l'utilisateur les pose lui-même sur
//    ou autour de leur DZ (cf. `entryHexSet` plus bas, qui accepte l'hex de
//    référence ET ses 6 voisins).
// Les renforts restants (tous tours/factions confondus) restent hors carte,
// glissables depuis le panneau "Renfort ..." (cf. `reinforcements`).
// Plusieurs pions peuvent partager le même hex d'entrée déclaré (ex. les 3
// bataillons d'un même régiment) : pickArrivalHex les répartit pour éviter
// le stacking (les marqueurs, eux, ignorent complètement cette logique — cf.
// isUnit).
function autoPlacesAtLoad(c) {
  if ((c.turn ?? 1) !== 1) return false
  if (c.faction === 'german' && c.turn === 1) return false
  const alliedFactions = props.module.sides?.allies ?? []
  if (isUnit(c) && alliedFactions.includes(c.faction)) return false
  return true
}
/** Placement initial du module — extrait en fonction pour être rejouable
 *  (cf. `resetBoardForReplay` plus bas), pas seulement au montage. Utilise
 *  `resolveEntryTarget`/`pickArrivalHex`, qui tirent au hasard un hex parmi
 *  la plage `setup` : rejouer ne reproduit donc pas exactement le tirage
 *  aléatoire d'origine pour les pions jamais déplacés depuis (non
 *  journalisé) — sans conséquence pour ceux qui bougent, puisque chaque
 *  `move`/`place` rejoué fixe une position absolue. */
function buildInitialCounters() {
  const occupied = new Set()
  const placed = []
  for (const c of allCounters.value.filter((c) => c.setup && autoPlacesAtLoad(c))) {
    const override = props.initialPositions[c.id]
    const target = resolveEntryTarget(c.setup)
    const pos = override ?? (isUnit(c) ? pickArrivalHex(target.col, target.row, occupied) : target)
    if (isUnit(c)) occupied.add(pos.col + ',' + pos.row)
    placed.push({ ...c, ...pos })
  }
  return placed
}
const counters = ref(buildInitialCounters())
const selectedCounterId = ref(null)

// Pions retirés de la carte via "Éliminé" (menu contextuel, cf.
// onCounterContextMenu plus bas) — id -> true. Un pion éliminé n'est ni sur
// la carte (counters) ni dans les renforts tant qu'il n'est pas explicitement
// "replacé" depuis le panneau "Unités éliminées" (EliminatedPanel.vue).
const eliminatedIds = ref(new Set())
const eliminatedCounters = computed(() =>
  allCounters.value.filter((c) => eliminatedIds.value.has(String(c.id)))
)

// --- Renforts : pions du module avec un hex d'entrée mais pas encore posés
// ni éliminés (typiquement arrivée tour 2+) — cf. ReinforcementsPanel.vue.
// Entrée en jeu SELON LE MODE (cf. lib/useAssisted.js::draggable) : en mode
// Libre, glissés sur la carte comme le déplacement d'un pion existant
// (onCounterDragStart / onMapDrop plus bas) ; en mode Assisté, uniquement
// par clic (onReinforcementSelect puis onHex, cf. plus bas — le glisser est
// désactivé pour laisser le clic comme seul chemin). Toujours possible, dans
// les deux modes, via le menu contextuel "Replacer le pion" (ils y
// retournent alors).
const placedIds = computed(() => new Set(counters.value.map((c) => String(c.id))))
const reinforcements = computed(() =>
  allCounters.value.filter((c) => c.setup && !placedIds.value.has(String(c.id)) && !eliminatedIds.value.has(String(c.id)))
)

// Un onglet de renforts par camp déclaré dans module.sides (ex. {"german":
// ["german"], "allies": ["commonwealth","us","pol"]}) — chacun ne liste que
// les renforts des factions de son camp. Repli sur un onglet unique si le
// module n'a pas encore ce champ. Plus un onglet fixe "Unités éliminées",
// commun à tous les camps (regroupé par nationalité à l'intérieur).
const SIDE_LABELS = { german: 'Renfort allemands', allies: 'Renfort alliés' }
const sidePanelTabs = computed(() => {
  const sides = props.module.sides
  const base = !sides
    ? [{ key: 'reinforcements', label: 'Renforts' }]
    : Object.keys(sides).map((side) => ({ key: side, label: SIDE_LABELS[side] ?? `Renfort ${side}` }))
  return [...base, { key: 'eliminated', label: 'Unités éliminées' }, { key: 'journal', label: 'Journal' }]
})
function reinforcementsForTab(key) {
  const sides = props.module.sides
  if (!sides) return reinforcements.value
  const factions = sides[key] ?? []
  return reinforcements.value.filter((c) => factions.includes(c.faction))
}
const openTab = ref(null)
const draggedCounterId = ref(null)

// --- Menu contextuel (clic droit) : "Replacer le pion" / "Éliminé" sur un
// pion posé sur la carte ; seulement "Replacer le pion" sur un pion déjà
// éliminé (panneau "Unités éliminées") ; aucun menu depuis le panneau de
// renforts (pas encore sur la carte, rien à replacer ou éliminer).
const contextMenu = ref(null) // { x, y, items: [{label, action}] } | null

function openContextMenu(ev, items) {
  ev.preventDefault()
  contextMenu.value = { x: ev.clientX, y: ev.clientY, items }
}
function closeContextMenu() {
  contextMenu.value = null
}
/** Retire un pion de la carte et le renvoie dans les renforts (sans l'éliminer). */
function returnCounterToReinforcements(id) {
  const i = counters.value.findIndex((c) => String(c.id) === String(id))
  if (i !== -1) counters.value.splice(i, 1)
  eliminatedIds.value.delete(String(id))
  eliminatedIds.value = new Set(eliminatedIds.value)
  const c = allCounters.value.find((c) => String(c.id) === String(id))
  log('return', `${c?.name ?? id} replacé dans les renforts`, { counterId: id })
}
function eliminateCounter(id) {
  const i = counters.value.findIndex((c) => String(c.id) === String(id))
  if (i !== -1) counters.value.splice(i, 1)
  eliminatedIds.value.add(String(id))
  eliminatedIds.value = new Set(eliminatedIds.value)
  const c = allCounters.value.find((c) => String(c.id) === String(id))
  log('eliminate', `${c?.name ?? id} éliminé`, { counterId: id })
}
function onCounterContextMenu(id, ev) {
  if (replayLocked.value) return
  const items = [
    { label: 'Replacer le pion', action: () => returnCounterToReinforcements(id) },
    { label: 'Éliminé', action: () => eliminateCounter(id) },
  ]
  if (movedThisTurnIds.value.has(String(id))) {
    items.push({ label: 'Annuler le mouvement', action: () => cancelMovement(id) })
  }
  openContextMenu(ev, items)
}
function onEliminatedContextMenu(id, ev) {
  if (replayLocked.value) return
  openContextMenu(ev, [
    { label: 'Replacer le pion', action: () => returnCounterToReinforcements(id) },
  ])
}
function chooseContextMenuItem(action) {
  action()
  closeContextMenu()
}

/** Le pion actuellement sélectionné (objet complet, pas que son id) — `null`
 *  si aucun. Factorisé ici car réutilisé par `adjacentSet`, `reachableSet`
 *  ci-dessous ET par lib/useDebug.js (portée de déplacement en mode debug). */
const selectedCounter = computed(() => counters.value.find((c) => c.id === selectedCounterId.value) ?? null)

/** Hex voisins (0-based col / 1-based row) du pion actuellement sélectionné,
 *  sous forme de clés "col,row" pour un lookup O(1) depuis isAdjacent(). */
const adjacentSet = computed(() => {
  const c = selectedCounter.value
  if (!c) return new Set()
  return new Set(
    neighborsOf(c.col, c.row).filter((n) => hexOnMap(n.col, n.row)).map((n) => n.col + ',' + n.row)
  )
})
const isAdjacent = (h) => adjacentSet.value.has(h.c + ',' + h.r)

// Sous-ensemble de `adjacentSet` : uniquement les hex adjacents que le pion
// sélectionné peut RÉELLEMENT rejoindre, MP suffisants pour en payer le coût
// de terrain (cf. lib/useAssisted.js::canEnterHex) — sert au surlignage vert
// (mode Assisté), pour ne pas laisser croire qu'un hex adjacent trop coûteux
// est une destination valide. Vide dès qu'aucun pion n'est sélectionné, donc
// aussi hors mode Assisté (où `selectedCounterId` ne prend jamais de valeur,
// cf. lib/useAssisted.js::selectable) — pas besoin d'un garde-fou de mode ici.
// Hors mode debug uniquement (cf. template) : le mode debug affiche à la
// place la portée COMPLÈTE de déplacement (cf. lib/useDebug.js::isInRange),
// pas que le premier pas.
const reachableSet = computed(() => {
  const c = selectedCounter.value
  if (!c) return new Set()
  const set = new Set()
  for (const key of adjacentSet.value) {
    const [col, row] = key.split(',').map(Number)
    if (canEnterHex(c, { c: col, r: row })) set.add(key)
  }
  return set
})
const isReachable = (h) => reachableSet.value.has(h.c + ',' + h.r)

// cf. lib/useDebug.js — case à cocher "debug" (ci-dessous dans le template)
// et tous les affichages qu'elle déclenche : le coût de terrain (COT) des
// hex adjacents au pion sélectionné (`adjacentCotLabels`), et la portée
// COMPLÈTE de déplacement de ce pion, au-delà du simple premier pas adjacent
// (`isInRange`, cf. surlignage vert dans le template, en mode debug
// seulement — le clic, lui, reste toujours limité aux hex adjacents).
const { debug, adjacentCotLabels, isInRange } = useDebug(
  hexes, isAdjacent, terrainCost, selectedCounter, remainingMp, neighborsOf, hexOnMap,
)

// Décalage visuel des pions empilés sur un même hex — même principe
// qu'ambush-tactique (HexMap.vue, `placedPositions`) : chaque pion suivant
// sur une case glisse en diagonale de 10% de sa taille par rapport au
// précédent, cumulatif. Les marqueurs (DZ...) restent toujours au centre,
// sans décalage — les unités qui partagent leur hex commencent leur pile à
// l'indice 1 (comme les "eventMarkers" d'ambush-tactique), le marqueur
// servant de socle visuel sous la pile (cf. z-order dans le template : les
// marqueurs sont rendus avant les unités, donc toujours dessous).
const STACK_STEP = 0.1
const stackOffsets = computed(() => {
  const markerHexes = new Set(counters.value.filter((c) => !isUnit(c)).map((c) => c.col + ',' + c.row))
  const seen = new Map()
  const offsets = new Map()
  for (const c of counters.value) {
    if (!isUnit(c)) { offsets.set(c.id, ZERO_OFFSET); continue }
    const key = c.col + ',' + c.row
    const stackBase = markerHexes.has(key) ? 1 : 0
    const k = seen.get(key) ?? 0
    seen.set(key, k + 1)
    const idx = stackBase + k
    offsets.set(c.id, { dx: -STACK_STEP * idx, dy: -STACK_STEP * idx })
  }
  return offsets
})
const ZERO_OFFSET = { dx: 0, dy: 0 }

/** Centre pixel d'un hex (col 0-based, row 1-based) — même formule que
 *  Counter.vue, dupliquée ici pour placer les badges d'empilement. */
function hexCenterPx(col, row) {
  const { x0, y0, colStep, rowStep } = calibration
  const yoff = col % 2 === 1 ? rowStep / 2 : 0
  return { x: x0 + col * colStep, y: y0 + (row - 1) * rowStep + yoff }
}

// Nombre de pions de soutien empilés sur un même hex, affiché en badge sur
// la carte (les pions de soutien étant tous identiques, un décalage visuel
// seul ne suffit pas à voir combien il y en a) — seulement à partir de 2.
const supportStackBadges = computed(() => {
  const counts = new Map()
  for (const c of counters.value) {
    if (c.kind !== 'support') continue
    const key = c.col + ',' + c.row
    const entry = counts.get(key) ?? { col: c.col, row: c.row, count: 0 }
    entry.count += 1
    counts.set(key, entry)
  }
  return [...counts.values()].filter((b) => b.count >= 2).map((b) => {
    const center = hexCenterPx(b.col, b.row)
    return { key: b.col + ',' + b.row, count: b.count, x: center.x + calibration.a * 0.55, y: center.y + calibration.a * 0.5 }
  })
})

function onCounterSelect(id) {
  if (replayLocked.value) return
  const c = counters.value.find((c) => String(c.id) === String(id))
  if (!canControl(c)) return
  selectedCounterId.value = selectedCounterId.value === id ? null : id
  selectedReinforcementId.value = null
}

// --- Entrée en jeu d'un renfort : deux systèmes cf. demande utilisateur —
// 1) glisser-déposer libre (n'importe quel hex, cf. onMapDrop) ;
// 2) clic sur le pion dans le panneau (bordure orange, cf.
//    ReinforcementsPanel.vue) puis clic sur un des hex d'entrée valides,
//    surlignés en orange sur la carte : pour un `setup` à hex unique (ex.
//    chaque unité alliée posée près de sa DZ), l'hex de référence ET ses 6
//    voisins sont valides ; pour une entrée par plage bord-de-carte (ex.
//    renforts allemands), toute la plage déclarée reste valide telle quelle
//    (cf. enumerateSetupHexes) — pas d'élargissement supplémentaire, la
//    plage couvre déjà large.
const selectedReinforcementId = ref(null)
const selectedReinforcement = computed(() =>
  reinforcements.value.find((c) => String(c.id) === String(selectedReinforcementId.value))
)
const entryHexSet = computed(() => {
  const r = selectedReinforcement.value
  if (!r) return new Set()
  const base = enumerateSetupHexes(r.setup)
  const cells = r.setup.includes('-')
    ? base
    : [...base, ...neighborsOf(base[0].col, base[0].row).filter((n) => hexOnMap(n.col, n.row))]
  return new Set(cells.map((h) => h.col + ',' + h.row))
})
const isEntryHex = (h) => entryHexSet.value.has(h.c + ',' + h.r)

function onReinforcementSelect(id) {
  if (replayLocked.value) return
  const c = reinforcements.value.find((c) => String(c.id) === String(id))
  if (!canControl(c) || !canEnterThisTurn(c)) return
  selectedReinforcementId.value = selectedReinforcementId.value === id ? null : id
  selectedCounterId.value = null
}

/** Clic sur un hex, par ordre de priorité :
 *  1. un renfort est sélectionné (système 2) et l'hex cliqué fait partie de
 *     ses hex d'entrée valides -> il s'y pose, fin de sélection ;
 *  2. un pion déjà sur la carte est sélectionné, l'hex cliqué lui est
 *     adjacent ET il lui reste assez de MP pour en payer le coût de terrain
 *     (cf. lib/useAssisted.js::canEnterHex/spendMp) -> il s'y déplace (et
 *     reste sélectionné, pour enchaîner sur d'autres hex tant qu'il lui
 *     reste des MP) ;
 *  3. sinon, le clic ne fait rien (pas de pion/renfort concerné par cet hex).
 *  Aucune action pendant un rejeu en cours (cf. `replayLocked`) — seul le
 *  lecteur (stepReplay/fastForwardReplay) fait bouger la carte tant que le
 *  journal chargé n'est pas entièrement joué. */
const onHex = (h) => {
  if (replayLocked.value) return
  if (selectedReinforcementId.value != null) {
    if (isEntryHex(h)) {
      const r = selectedReinforcement.value
      if (r && canEnterThisTurn(r)) {
        const placed = { ...r, col: h.c, row: h.r }
        counters.value.push(placed)
        emit('move', { counterId: placed.id, col: h.c, row: h.r })
        log('place', `${r.name} entre en jeu en ${hexId(h.c + 1, h.r)}`, { counterId: placed.id, col: h.c, row: h.r })
      }
      selectedReinforcementId.value = null
    }
    return
  }
  if (selectedCounterId.value != null && isAdjacent(h)) {
    const c = counters.value.find((c) => c.id === selectedCounterId.value)
    // Position de départ capturée AVANT tout déplacement — sert à la fois à
    // l'historique (from ci-dessous) et de paramètre "from" pour
    // canEnterHex/spendMp (cf. useAssisted.js::terrainCost, règle
    // route/piste : le coût dépend de d'où on VIENT, pas seulement de l'hex
    // d'arrivée).
    const from = c ? { col: c.col, row: c.row } : null
    // Pas assez de MP pour entrer dans cet hex (cf. useAssisted.js) : le
    // pion reste sélectionné et sur place, comme si l'hex n'était pas une
    // destination valide — libre à l'utilisateur d'essayer un autre hex
    // adjacent moins coûteux.
    if (c && canEnterHex(c, h, { c: from.col, r: from.row })) {
      c.col = h.c; c.row = h.r
      spendMp(c, h, { c: from.col, r: from.row })
      emit('move', { counterId: c.id, col: c.col, row: c.row })
      const journalId = log('move', `${c.name} se déplace vers ${hexId(h.c + 1, h.r)}`, { counterId: c.id, col: c.col, row: c.row })
      pushMoveHistory(c.id, from, { col: c.col, row: c.row }, journalId)
      markMoved(c.id, from)
    }
    return
  }
}

// --- Drag & drop d'un pion : dépose au centre de l'hex le plus proche du curseur ---
const svgRef = ref(null)

// Position courante (coordonnées SVG) du pion suivi par un glisser "souris"
// (cf. onCounterDragStart plus bas) — permet un retour visuel live pendant
// le déplacement, avant que le relâchement ne fixe la case définitive.
const dragCurrentPx = ref(null)

function svgPointFromEvent(ev) {
  const svg = svgRef.value
  if (!svg) return null
  const pt = svg.createSVGPoint()
  pt.x = ev.clientX; pt.y = ev.clientY
  return pt.matrixTransform(svg.getScreenCTM().inverse())
}

function onCounterDragStart(id, ev) {
  // Pendant un rejeu (cf. `replayLocked`), preventDefault() sur `dragstart`
  // annule aussi le glisser natif HTML5 (tablette de soutien, panneau de
  // renforts) — un seul guard couvre donc les deux mécanismes de glisser.
  if (replayLocked.value) { ev?.preventDefault(); return }
  const onMap = counters.value.find((c) => String(c.id) === String(id))
  const c = onMap
    ?? supportTrackerRef.value?.findToken(id)
    ?? allCounters.value.find((c) => String(c.id) === String(id))
  // Les pions de soutien (kind: 'support', cf. SupportTracker.vue) sont une
  // ressource commune, pas rattachée à un camp — toujours glissables, que ce
  // soit depuis la tablette ou déjà posés sur la carte, sans passer par
  // canControl (ni par le tour actif).
  if (c?.kind !== 'support' && !canControl(c)) { ev?.preventDefault(); return }
  // cf. lib/useAssisted.js::draggable — en mode Assisté, une UNITÉ (pion déjà
  // sur la carte ou renfort pas encore posé) ne se glisse plus du tout : elle
  // ne peut entrer en jeu ou se déplacer que par clic (sélection, puis clic
  // sur l'hex de destination — cf. onHex/onCounterSelect/onReinforcementSelect
  // plus haut). Les pions de soutien restent exemptés, comme pour canControl
  // ci-dessus : ce ne sont pas des "unités" soumises aux règles de tour/camp.
  if (c?.kind !== 'support' && !draggable.value) { ev?.preventDefault(); return }
  // Un renfort pas encore posé sur la carte ne peut être glissé qu'à partir
  // de son tour d'arrivée (cf. `canEnterThisTurn`) — un pion déjà sur la
  // carte (mouvement) ou un pion de soutien (tablette) n'est pas concerné.
  if (!onMap && c?.kind !== 'support' && !canEnterThisTurn(c)) { ev?.preventDefault(); return }
  draggedCounterId.value = id
  if (ev?.dataTransfer) {
    // Glisser natif HTML5 (pion pas encore sur la carte : <img> de la
    // tablette de soutien ou du panneau "Renfort ...", tous deux hors du
    // <svg>) — le natif gère lui-même survol/dépôt, cf. onMapDrop.
    ev.dataTransfer.effectAllowed = 'move'
    ev.dataTransfer.setData('text/plain', String(id))
    return
  }
  // Glisser "souris" (pion Counter.vue déjà posé sur la carte, <image> SVG) :
  // le DnD natif HTML5 ne se déclenche jamais de façon fiable sur une <image>
  // SVG (confirmé en test réel ET automatisé — `dragstart` ne part pas malgré
  // draggable="true"), donc on suit nous-mêmes la souris jusqu'au relâchement.
  const loc = svgPointFromEvent(ev)
  if (loc) dragCurrentPx.value = { x: loc.x, y: loc.y }
  window.addEventListener('mousemove', onCounterDragMove)
  window.addEventListener('mouseup', onCounterDragEnd)
}

function onCounterDragMove(ev) {
  const loc = svgPointFromEvent(ev)
  if (loc) dragCurrentPx.value = loc
}

function onCounterDragEnd(ev) {
  window.removeEventListener('mousemove', onCounterDragMove)
  window.removeEventListener('mouseup', onCounterDragEnd)
  const loc = svgPointFromEvent(ev) ?? dragCurrentPx.value
  dragCurrentPx.value = null
  const id = draggedCounterId.value
  draggedCounterId.value = null
  if (!loc || id == null) return
  const hex = pixelToHex(loc.x, loc.y)
  if (!hex) return
  const c = counters.value.find((c) => String(c.id) === String(id))
  // Un simple clic (mousedown puis mouseup sans déplacement réel, cf.
  // Counter.vue::onClick pour la sélection) retombe ici aussi — on n'émet
  // `move` que si la case a réellement changé, pour ne pas spammer le réseau
  // à chaque clic de sélection en partie multijoueur.
  if (c && (c.col !== hex.col || c.row !== hex.row)) {
    const fromLabel = hexId(c.col + 1, c.row)
    const from = { col: c.col, row: c.row }
    c.col = hex.col; c.row = hex.row
    emit('move', { counterId: c.id, col: c.col, row: c.row })
    const journalId = log(c.kind === 'support' ? 'support' : 'move', `${c.name} déplacé de ${fromLabel} vers ${hexId(c.col + 1, c.row)}`, { counterId: c.id, col: c.col, row: c.row })
    pushMoveHistory(c.id, from, { col: c.col, row: c.row }, journalId)
    if (c.kind !== 'support') markMoved(c.id, from)
  }
}

onUnmounted(() => {
  window.removeEventListener('mousemove', onCounterDragMove)
  window.removeEventListener('mouseup', onCounterDragEnd)
})

/** Convertit un point en coordonnées SVG vers l'hex logique le plus proche —
 *  cherche dans une fenêtre de 3×3 hex autour de l'estimation initiale (la
 *  grille hexagonale n'a pas de correspondance x/y → col/row directe). */
function pixelToHex(x, y) {
  const { x0, y0, colStep, rowStep } = calibration
  const c0 = Math.round((x - x0) / colStep)
  let best = null, dmin = Infinity
  for (let c = c0 - 1; c <= c0 + 1; c++) {
    if (c < 0 || c >= mapConfig.cols) continue
    const yoff = c % 2 === 1 ? rowStep / 2 : 0
    const r0 = Math.round((y - y0 - yoff) / rowStep) + 1
    for (let r = r0 - 1; r <= r0 + 1; r++) {
      if (!hexOnMap(c, r)) continue
      const cx = x0 + c * colStep
      const cy = y0 + (r - 1) * rowStep + yoff
      const d = Math.hypot(cx - x, cy - y)
      if (d < dmin) { dmin = d; best = { col: c, row: r } }
    }
  }
  return best
}

function onMapDrop(ev) {
  if (replayLocked.value) return
  const svg = svgRef.value
  if (!svg || draggedCounterId.value == null) return
  const pt = svg.createSVGPoint()
  pt.x = ev.clientX; pt.y = ev.clientY
  const loc = pt.matrixTransform(svg.getScreenCTM().inverse())
  const hex = pixelToHex(loc.x, loc.y)
  if (hex) {
    // Un pion déjà posé sur la carte emprunte désormais le glisser "souris"
    // (cf. onCounterDragEnd), qui ne passe pas par l'événement natif `drop` —
    // on n'arrive ici que pour un pion pas encore sur la carte : renfort
    // glissé depuis le panneau "Renfort ..." (glisser-déposer libre, système
    // 1, cf. entrée en jeu dans le commentaire de `entryHexSet`) ou pion de
    // soutien tiré de la tablette (cf. SupportTracker.vue::removeToken).
    const reinforcement = allCounters.value.find((c) => String(c.id) === String(draggedCounterId.value))
    if (reinforcement && canEnterThisTurn(reinforcement)) {
      const placed = { ...reinforcement, ...hex }
      counters.value.push(placed)
      emit('move', { counterId: placed.id, col: placed.col, row: placed.row })
      log('place', `${placed.name} entre en jeu en ${hexId(placed.col + 1, placed.row)}`,
        { counterId: placed.id, col: placed.col, row: placed.row })
    } else {
      const token = supportTrackerRef.value?.removeToken(draggedCounterId.value)
      if (token) {
        const placed = { ...token, ...hex }
        counters.value.push(placed)
        emit('move', { counterId: placed.id, col: placed.col, row: placed.row })
        // Les pions de soutien sont créés à la volée (cf. SupportTracker.vue),
        // pas déclarés dans `allCounters` — contrairement à un renfort normal,
        // le rejeu ne peut pas les retrouver par id : on embarque l'objet
        // complet dans `data.counter` pour pouvoir le recréer (cf.
        // applyReplayEntry plus bas).
        log('support', `${placed.name} posé en ${hexId(placed.col + 1, placed.row)}`,
          { counterId: placed.id, col: placed.col, row: placed.row, counter: placed })
      }
    }
  }
  draggedCounterId.value = null
}

/** Applique un déplacement reçu d'un autre joueur (WebSocket) — ne réémet
 *  pas `move` pour éviter une boucle avec le serveur. */
function applyRemoteMove(counterId, col, row) {
  const c = counters.value.find((c) => String(c.id) === String(counterId))
  if (c) {
    const from = { col: c.col, row: c.row }
    c.col = col; c.row = row
    if (c.kind !== 'support' && (from.col !== col || from.row !== row)) markMoved(c.id, from)
    return
  }
  // Un autre joueur a posé un renfort pas encore présent localement (glissé
  // depuis son propre panneau "Renfort alliés") : on l'ajoute.
  const reinforcement = allCounters.value.find((c) => String(c.id) === String(counterId))
  if (reinforcement) counters.value.push({ ...reinforcement, col, row })
}

defineExpose({ applyRemoteMove, applyRemoteTurn })

/** Reçoit le journal chargé (cf. JournalPanel.vue, évènement `loaded`) en
 *  ordre chronologique et remet la carte au déploiement initial pour
 *  rejouer depuis la première ligne. */
function onJournalLoaded(list) {
  replayEntries.value = list
  replayIndex.value = 0
  resetBoardForReplay()
}

function resetBoardForReplay() {
  isReplaying.value = true
  counters.value = buildInitialCounters()
  eliminatedIds.value = new Set()
  selectedCounterId.value = null
  selectedReinforcementId.value = null
  moveHistory.value = []
  clearAllMoved()
  turnTrackerRef.value?.applyRemoteTurn(0)
  nextTick(() => { isReplaying.value = false })
}

/** Applique une entrée de journal à la carte — même logique que la synchro
 *  multijoueur (`applyRemoteMove`/`applyRemoteTurn`), qui ne réémet ni ne
 *  journalise rien : rejouer une ligne ne fait bouger que la carte. */
function applyReplayEntry(entry) {
  const d = entry.data
  if (!d) return
  if (entry.kind === 'move' || entry.kind === 'place') {
    applyRemoteMove(d.counterId, d.col, d.row)
  } else if (entry.kind === 'support') {
    if (counters.value.some((c) => String(c.id) === String(d.counterId))) {
      applyRemoteMove(d.counterId, d.col, d.row)
    } else if (d.counter) {
      counters.value.push({ ...d.counter, col: d.col, row: d.row })
    }
  } else if (entry.kind === 'eliminate') {
    const i = counters.value.findIndex((c) => String(c.id) === String(d.counterId))
    if (i !== -1) counters.value.splice(i, 1)
    eliminatedIds.value.add(String(d.counterId))
    eliminatedIds.value = new Set(eliminatedIds.value)
  } else if (entry.kind === 'return') {
    const i = counters.value.findIndex((c) => String(c.id) === String(d.counterId))
    if (i !== -1) counters.value.splice(i, 1)
    eliminatedIds.value.delete(String(d.counterId))
    eliminatedIds.value = new Set(eliminatedIds.value)
  } else if (entry.kind === 'turn') {
    turnTrackerRef.value?.applyRemoteTurn(d.step)
  }
}

/** Bouton lecture (▶) : avance d'une ligne — l'entrée réapparaît dans le
 *  journal (cf. JournalPanel.vue::revealEntry) en même temps qu'elle bouge
 *  la carte. */
function stepReplay() {
  if (replayIndex.value >= replayEntries.value.length) return
  isReplaying.value = true
  const entry = replayEntries.value[replayIndex.value]
  applyReplayEntry(entry)
  journalRef.value?.revealEntry(entry)
  replayIndex.value += 1
  nextTick(() => { isReplaying.value = false })
}

/** Bouton avance rapide (⏭) : applique toutes les lignes restantes d'un coup. */
function fastForwardReplay() {
  if (replayIndex.value >= replayEntries.value.length) return
  isReplaying.value = true
  while (replayIndex.value < replayEntries.value.length) {
    const entry = replayEntries.value[replayIndex.value]
    applyReplayEntry(entry)
    journalRef.value?.revealEntry(entry)
    replayIndex.value += 1
  }
  nextTick(() => { isReplaying.value = false })
}

// Vrai tant qu'un journal chargé n'a pas été entièrement rejoué (cf.
// stepReplay/fastForwardReplay) — bloque alors toute action de jeu (cf.
// guards dans onHex/onCounterDragStart/onMapDrop/sélections/menu contextuel
// plus haut, et props `disabled` sur TurnTracker/RollModal ci-dessous) :
// la carte ne doit bouger qu'au rythme du lecteur pendant un rejeu.
const replayLocked = computed(() => replayEntries.value.length > 0 && replayIndex.value < replayEntries.value.length)

function zoomIn() {
  zoom.value = Math.min(2, +(zoom.value + 0.05).toFixed(2))
}
function zoomOut() {
  zoom.value = Math.max(0.1, +(zoom.value - 0.05).toFixed(2))
}

/** Zoom à la molette (Ctrl/pas de modificateur — sur toute la zone carte). */
function onMapWheel(e) {
  const step = 0.05
  const delta = e.deltaY < 0 ? step : -step
  zoom.value = Math.min(2, Math.max(0.1, +(zoom.value + delta).toFixed(2)))
}

// --- Drag-to-scroll (pan) au clic droit maintenu ---
const mapWrapRef = ref(null)
const mapDrag = ref(null) // { startX, startY, scrollLeft, scrollTop }

function onMapDragStart(e) {
  const el = mapWrapRef.value
  if (!el) return
  // Un clic droit sur un pion ouvre son menu contextuel (cf. Counter.vue) —
  // ne pas démarrer un pan ici, sinon le preventDefault() ci-dessous
  // supprime l'événement contextmenu natif avant qu'il puisse se déclencher.
  if (e.target.closest('.counter')) return
  e.preventDefault()
  mapDrag.value = { startX: e.clientX, startY: e.clientY, scrollLeft: el.scrollLeft, scrollTop: el.scrollTop }
}
function onMapDragMove(e) {
  if (!mapDrag.value) return
  const el = mapWrapRef.value
  if (!el) return
  el.scrollLeft = mapDrag.value.scrollLeft - (e.clientX - mapDrag.value.startX)
  el.scrollTop = mapDrag.value.scrollTop - (e.clientY - mapDrag.value.startY)
}
function onMapDragEnd() {
  mapDrag.value = null
}
</script>

<template>
  <div class="hexmap">
    <header class="toolbar">
      <h1>{{ module.name }}</h1>

      <div v-if="module.turnTrack" class="turn-tracker-block">
        <TurnTracker ref="turnTrackerRef" :config="module.turnTrack" :sides="module.sides"
          :initial-step="initialTurnStep" :disabled="replayLocked" :phase="phase" :next-label="nextLabel"
          @turn="onTurnAdvance" @change="onTurnChange" @phase-next="advance" />

        <SupportTracker ref="supportTrackerRef" :config="module.supportTrack" :turn="turnInfo.turn"
          @dragstart="onCounterDragStart" />
      </div>

      <div class="controls">
        <label :title="!assisted ? 'Grille désactivée en partie libre' : ''">
          <input type="checkbox" v-model="showGrid" :disabled="!assisted"> grille
        </label>
        <label><input type="checkbox" v-model="showLabels"> coordonnées</label>
        <label><input type="checkbox" v-model="showCalib"> calibration</label>
        <label><input type="checkbox" v-model="debug"> debug</label>
        <button type="button" class="toggle-btn" :class="{ active: !showCounters }"
          @click="showCounters = !showCounters">
          {{ showCounters ? 'Cacher les pions' : 'Afficher les pions' }}
        </button>
        <button v-if="assisted" type="button" class="toggle-btn" :disabled="!moveHistory.length || replayLocked"
          @click="undoLastMove">
          ↩ Retour arrière
        </button>
        <button type="button" class="toggle-btn" :class="{ active: !showRollModal }"
          @click="showRollModal = !showRollModal">
          {{ showRollModal ? 'Cacher le dé' : 'Afficher le dé' }}
        </button>
        <button v-if="movementChartSrc" type="button" class="toggle-btn" :class="{ active: showMovementChart }"
          @click="showMovementChart = !showMovementChart">
          Table des mouvements
        </button>
        <button v-if="combatChartSrc" type="button" class="toggle-btn" :class="{ active: showCombatChart }"
          @click="showCombatChart = !showCombatChart">
          Table de combat
        </button>
        <div v-if="replayEntries.length" class="replay-ctl">
          <span class="replay-pos">{{ replayIndex }} / {{ replayEntries.length }}</span>
          <button type="button" class="toggle-btn replay-btn" title="Lecture : avancer d'une ligne"
            :disabled="replayIndex >= replayEntries.length" @click="stepReplay">▶</button>
          <button type="button" class="toggle-btn replay-btn" title="Avance rapide : aller à la fin"
            :disabled="replayIndex >= replayEntries.length" @click="fastForwardReplay">⏭</button>
        </div>
        <div class="zoom-ctl">
          <button @click="zoomOut">−</button>
          <span>{{ Math.round(zoom * 100) }}%</span>
          <button @click="zoomIn">+</button>
        </div>
      </div>
    </header>

    <main class="map-wrap" ref="mapWrapRef" :class="{ dragging: !!mapDrag }" @mousedown.right.prevent="onMapDragStart"
      @mousemove="onMapDragMove" @mouseup="onMapDragEnd" @mouseleave="onMapDragEnd" @contextmenu.prevent
      @wheel.prevent="onMapWheel">
      <svg ref="svgRef" class="map-svg"
        :style="{ width: map.imageWidth * zoom + 'px', height: map.imageHeight * zoom + 'px' }"
        :viewBox="`0 0 ${map.imageWidth} ${map.imageHeight}`" preserveAspectRatio="none" @dragover.prevent
        @drop.prevent="onMapDrop">

        <image :href="map.url" x="0" y="0" :width="map.imageWidth" :height="map.imageHeight" preserveAspectRatio="none" />

        <g v-if="showGrid">
          <polygon v-for="h in hexes" :key="h.id" class="hex"
            :class="{ adjacent: debug ? isInRange(h) : isReachable(h), entry: isEntryHex(h) }"
            :points="h.pts" :stroke="gridStyle.stroke" :stroke-width="gridStyle.width"
            :stroke-opacity="gridStyle.opacity" vector-effect="non-scaling-stroke" @click="onHex(h)" />
        </g>

        <g v-if="showLabels">
          <text v-for="h in hexes" :key="'t' + h.id" class="coordtxt" :x="h.cx" :y="h.cy + calibration.a * 0.18"
            text-anchor="middle" :font-size="calibration.a * 0.42">{{ h.id }}</text>
        </g>

        <!-- cf. lib/useDebug.js — coût de terrain (COT) des hex adjacents au
             pion sélectionné, uniquement quand la case "debug" est cochée. -->
        <g v-if="debug">
          <text v-for="d in adjacentCotLabels" :key="'cot' + d.id" class="debug-cot" :x="d.cx" :y="d.cy"
            text-anchor="middle" :font-size="calibration.a * 0.55">{{ d.cot }}</text>
        </g>

        <g v-if="showCounters" class="counters">
          <!-- Marqueurs (DZ...) rendus en premier : toujours sous les unités
               dans l'ordre de peinture SVG, quel que soit le hex. -->
          <Counter v-for="c in counters.filter((c) => !isUnit(c))" :key="c.id" :id="c.id" :src="c.src" :col="c.col"
            :row="c.row" :calibration="calibration" :selected="selectedCounterId === c.id" :selectable="false"
            :offset="stackOffsets.get(c.id) ?? ZERO_OFFSET" :drag-px="draggedCounterId === c.id ? dragCurrentPx : null"
            @dragstart="onCounterDragStart" />
          <Counter v-for="c in counters.filter(isUnit)" :key="c.id" :id="c.id" :src="c.src" :col="c.col"
            :row="c.row" :calibration="calibration" :selected="selectedCounterId === c.id" :selectable="selectable"
            :moved="movedThisTurnIds.has(String(c.id))"
            :offset="stackOffsets.get(c.id) ?? ZERO_OFFSET" :drag-px="draggedCounterId === c.id ? dragCurrentPx : null"
            @select="onCounterSelect" @dragstart="onCounterDragStart" @contextmenu="onCounterContextMenu" />
        </g>

        <g v-if="showCounters" class="support-badges">
          <circle v-for="b in supportStackBadges" :key="b.key" :cx="b.x" :cy="b.y" :r="calibration.a * 0.26"
            class="support-badge-bg" />
          <text v-for="b in supportStackBadges" :key="'t' + b.key" :x="b.x" :y="b.y + calibration.a * 0.1"
            class="support-badge-text" text-anchor="middle" :font-size="calibration.a * 0.34">{{ b.count }}</text>
        </g>
      </svg>
    </main>

    <CalibrationPanel v-if="showCalib" :calibration="calibration" :grid-style="gridStyle" :map-config="mapConfig"
      :default-calibration="DEFAULT_CALIBRATION" :image-width="map.imageWidth" :image-height="map.imageHeight" />

    <SidePanel :tabs="sidePanelTabs" v-model:open-tab="openTab">
      <template v-for="tab in sidePanelTabs" :key="tab.key" v-slot:[tab.key]>
        <EliminatedPanel v-if="tab.key === 'eliminated'" :units="eliminatedCounters"
          @contextmenu="onEliminatedContextMenu" />
        <JournalPanel v-else-if="tab.key === 'journal'" ref="journalRef" :module-id="moduleId || module.name"
          :turn="turnInfo.turn" @loaded="onJournalLoaded" />
        <ReinforcementsPanel v-else :reinforcements="reinforcementsForTab(tab.key)"
          :selected-id="selectedReinforcementId" :current-turn="turnInfo.turn" :draggable="draggable"
          @dragstart="onCounterDragStart" @select="onReinforcementSelect" />
      </template>
    </SidePanel>

    <ContextMenu v-if="contextMenu" :x="contextMenu.x" :y="contextMenu.y" :items="contextMenu.items"
      @choose="chooseContextMenuItem" @close="closeContextMenu" />

    <RollModal v-show="showRollModal" :disabled="replayLocked" @roll="onDiceRoll" />
    <MovementChartModal v-if="movementChartSrc" v-show="showMovementChart" :src="movementChartSrc" />
    <CombatChartModal v-if="combatChartSrc" v-show="showCombatChart" :src="combatChartSrc" />
  </div>
</template>

<style scoped>
.hexmap {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  padding: 16px 36px 0;
  background: #8a7c76;
  flex: none;
  position: relative;
  z-index: 1;
}

.toolbar h1 {
  font-size: 3.2rem;
  font-weight: 700;
  margin: 0;
  color: #cac9ae;
}

.turn-tracker-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.controls {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  font-size: 0.85rem;
}

.controls label {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  color: var(--color-text);
}

.toggle-btn {
  padding: 5px 10px;
  font-size: 0.85rem;
  border: 1px solid rgba(0, 0, 0, 0.25);
  border-radius: 4px;
  background: transparent;
  color: var(--color-text);
  cursor: pointer;
}

.toggle-btn.active {
  background: rgba(0, 0, 0, 0.25);
}

.toggle-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.replay-ctl {
  display: flex;
  align-items: center;
  gap: 6px;
}

.replay-pos {
  font-variant-numeric: tabular-nums;
  font-size: 0.8rem;
  opacity: 0.85;
}

.replay-btn {
  font-size: 0.9rem;
  line-height: 1;
  padding: 5px 9px;
}

.zoom-ctl {
  display: flex;
  align-items: center;
  gap: 8px;
}

.zoom-ctl button {
  width: 26px;
  height: 26px;
  cursor: pointer;
}

.map-wrap {
  overflow: hidden;
  flex: 1;
  min-height: 0;
  background: #8a7c76;
}

.map-wrap.dragging {
  cursor: grabbing;
  user-select: none;
}

.map-wrap.dragging * {
  cursor: grabbing !important;
}

.map-svg {
  display: block;
}

polygon.hex {
  fill: rgba(255, 255, 255, 0);
  transition: fill 0.05s;
}

polygon.hex.adjacent {
  fill: rgba(46, 139, 87, 0.35);
}

polygon.hex.adjacent:hover {
  fill: rgba(46, 139, 87, 0.55);
}

polygon.hex.entry {
  fill: rgba(255, 140, 0, 0.4);
}

polygon.hex.entry:hover {
  fill: rgba(255, 140, 0, 0.6);
}

.coordtxt {
  font-family: monospace;
  font-weight: 700;
  fill: #111;
  pointer-events: none;
}

/* cf. lib/useDebug.js — coût de terrain (COT) affiché sur les hex adjacents
   au pion sélectionné quand le mode debug est actif. Contour blanc (double
   trait, cf. paint-order) pour rester lisible sur n'importe quel fond de
   carte, y compris par-dessus la teinte verte de `.hex.adjacent`. */
.debug-cot {
  font-family: monospace;
  font-weight: 700;
  fill: #c0392b;
  stroke: #fff;
  stroke-width: 3px;
  paint-order: stroke fill;
  pointer-events: none;
}

.support-badge-bg {
  fill: #c0392b;
  stroke: #fff;
  stroke-width: 1.5;
  vector-effect: non-scaling-stroke;
  pointer-events: none;
}

.support-badge-text {
  fill: #fff;
  font-weight: 700;
  font-family: sans-serif;
  pointer-events: none;
}
</style>
