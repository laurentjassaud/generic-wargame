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

import { reactive, ref, computed, toRef, onUnmounted, nextTick, watch } from 'vue'
import { hexId, parseHexId, DEFAULT_CALIBRATION } from '../lib/calibration.js'
import { neighborsOf, hexDistance } from '../lib/hex.js'
import { hexExists, removedHexSet } from '../lib/mapShape.js'
import { useAssisted } from '../lib/useAssisted.js'
import { useDebug } from '../lib/useDebug.js'
import { useCombat } from '../lib/useCombat.js'
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
import CombatModal from './CombatModal.vue'
import PhaseBlockedModal from './PhaseBlockedModal.vue'

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
  // Un pion dont le mouvement est entièrement annulé (cf. cancelMovement/
  // undoLastMove, seuls appelants) n'a, de fait, plus bougé ce tour-ci : le
  // verrou de sélection ci-dessous (cf. `lockedFromSelectionIds`, qui ne se
  // justifie QUE par un mouvement réellement effectué) ne tient plus non plus.
  if (lockedFromSelectionIds.value.delete(key)) lockedFromSelectionIds.value = new Set(lockedFromSelectionIds.value)
}
function clearAllMoved() {
  turnStartPositions.clear()
  movedThisTurnIds.value = new Set()
  lockedFromSelectionIds.value = new Set()
}

// --- Verrouillage d'une unité après désélection (mouvement normal) --------
// Une unité qui a bougé ce tour-ci (cf. `movedThisTurnIds`) et qui est
// ENSUITE désélectionnée — qu'on la reclique pour la désélectionner, ou
// qu'on sélectionne autre chose à sa place — ne peut PLUS être resélectionnée
// ce même tour : son mouvement est alors considéré comme définitivement
// terminé (cf. onCounterSelect). Remis à zéro en même temps que
// `movedThisTurnIds` (cf. `clearAllMoved` ci-dessus) : une unité verrouillée
// un tour redevient sélectionnable normalement au tour suivant.
const lockedFromSelectionIds = ref(new Set())

// Avertissement "mouvement non terminé" (cf. setSelectedCounter ci-dessous) :
// `{ key, hex, units }` de l'hex en overstack, ou `null` (modale fermée).
const unitStackBlock = ref(null)

/** SEUL point d'entrée pour changer `selectedCounterId` — verrouille au
 *  passage l'ANCIEN pion sélectionné (cf. `lockedFromSelectionIds` ci-dessus)
 *  s'il avait bougé ce tour-ci, avant de basculer la sélection sur `id` (ou
 *  `null`, pour une simple désélection sans rien sélectionner à la place).
 *
 *  REFUSE le changement (renvoie `false`, sélection inchangée, modale
 *  d'avertissement ouverte) si l'ancien pion est en OVERSTACK — il partage
 *  son hex avec une unité amie (cf. lib/useAssisted.js::isOverstacked) : on
 *  ne peut pas terminer son mouvement là, ni passer à une autre unité avant
 *  de l'avoir déplacé (ou d'avoir annulé son mouvement). Renvoie `true`
 *  sinon. */
function setSelectedCounter(id) {
  const previous = selectedCounterId.value
  if (previous != null && previous !== id) {
    const prev = counters.value.find((c) => String(c.id) === String(previous))
    if (isOverstacked(prev)) {
      const units = counters.value.filter((c) => c.col === prev.col && c.row === prev.row && isUnit(c) && c.kind !== 'support')
      unitStackBlock.value = { key: prev.col + ',' + prev.row, hex: hexId(prev.col + 1, prev.row), units: units.map((u) => u.name) }
      return false
    }
  }
  if (previous != null && previous !== id && movedThisTurnIds.value.has(String(previous))) {
    lockedFromSelectionIds.value = new Set(lockedFromSelectionIds.value).add(String(previous))
  }
  selectedCounterId.value = id
  return true
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
    log('move', `${c.name} : mouvement annulé, retour en ${hexId(c.col + 1, c.row)}${mpText(c)}`,
      { counterId: c.id, col: c.col, row: c.row, mp: spentMpOf(c) })
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
  // sont enlevés (cf. `movedThisTurnIds`). Pas pendant un rejeu : c'est
  // alors applyReplayEntry (entrée `turn`) qui s'en charge, de façon
  // SYNCHRONE — cet évènement-ci arrive en différé (watcher de
  // TurnTracker.vue), et, lors d'une avance rapide, il effacerait après coup
  // les mouvements du tour en cours que le rejeu vient de rétablir.
  if (!isReplaying.value) clearAllMoved()
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
// `showGrid` vient de useAssisted() plus bas (verrouillé à false hors mode
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

// cf. lib/useAssisted.js — toute la logique propre au mode "Assisté"
// (grille, sélection au clic, restriction de tour, phases Mouvement/Combat,
// MP/terrain/ZOC) y vit. Appelé ICI (et pas plus haut dans le fichier,
// comme dans les versions précédentes) parce qu'il a besoin de `counters`
// (cf. `enemyZocSet`, qui doit savoir où sont les pions ennemis) — lequel
// doit donc déjà être déclaré.
const { showGrid, selectable, draggable, canControl, phase, phaseLabels, nextLabel, advance, canEnterHex, canEnterTerrain, spendMp, refundMp, resetMp, terrainCost, remainingMp, enemyZocSet, isEnemyOf, entrySurcharge, spendEntryCost, unspendEntryCost, hasFriendlyOccupant, canLeaveAfterEntering, canLeaveAfterReinforcementEntry, isOverstacked, stackedHexes, combatEdgeKind, setPhase, setSpentMp, resetTurnState } = useAssisted(toRef(props, 'assisted'), turnTrackerRef, props.module.terrain, counters, props.module.sides, hexOnMap)

// Combat du mode Assisté (cf. lib/useCombat.js, qui porte toute la règle :
// désignation défenseur/attaquants, table de combat, jet de dé). Ce composant
// ne fait que lui brancher les clics (cf. onCounterSelect/onHex plus bas),
// les surlignages orange/jaune de la carte et la modale (cf. template).
const {
  combatActive, combatAllowed, targetHexLabels: combatTargetHexLabels, defenders: combatDefenders,
  attackers: combatAttackers, toggleTarget, removeTargetHex, cancelCombat, toggleAttacker, hasFought, markFought, pendingEngagements,
  isCombatTargetHex, isCombatAttackerHex,
  attackStrength, defenseStrength, differential, canResolve: combatCanResolve,
  terrainRow: combatTerrainRow,
  column: combatColumn, resolveCombat, combatResult, crtRows, crtResults,
} = useCombat(toRef(props, 'assisted'), phase, counters, canControl, props.module.terrain, combatEdgeKind)

/** Clic sur "Combattre" dans la modale : la règle (dé + lecture de la table)
 *  vit dans lib/useCombat.js, on ne fait ici qu'en journaliser le résultat
 *  (hex cibles et unités défenseuses, qui peuvent être plusieurs). */
function onCombatFight() {
  const r = resolveCombat()
  if (!r) return
  const diff = r.diff > 0 ? '+' + r.diff : String(r.diff)
  const names = combatDefenders.value.map((d) => d.name).join(', ')
  // `data` : de quoi restaurer le combat au rejeu du journal (cf.
  // applyReplayEntry, entrée `combat`) — les unités participantes y sont
  // remarquées "ayant combattu" (cf. lib/useCombat.js::markFought).
  log('combat', `Combat sur ${combatTargetHexLabels.value.join(', ')} (${names}) : `
    + `différentiel ${diff}, ${r.rowLabel}, dé ${r.die} → ${r.result} (${r.resultLabel})`, {
    hexes: combatTargetHexLabels.value,
    attackerIds: combatAttackers.value.map((a) => a.id),
    defenderIds: combatDefenders.value.map((d) => d.id),
    diff: r.diff, row: r.rowKey, die: r.die, result: r.result,
  })
}

/** Total de MP déjà dépensés par `c` pendant ce tour-ci (cf.
 *  lib/useAssisted.js::remainingMp), ou `null` pour un pion sans potentiel
 *  de mouvement (ou hors mode Assisté). Enregistré dans le journal (champ
 *  `mp` des entrées `move`/`place`) pour qu'une partie sauvegardée en pleine
 *  phase de Mouvement retrouve ses MP au rejeu (cf. applyReplayEntry). */
function spentMpOf(c) {
  const left = remainingMp(c)
  return left == null ? null : c.mov - left
}

/** Suffixe "(MP 3/6)" ajouté au texte d'un déplacement dans le journal —
 *  vide pour un pion sans potentiel de mouvement. */
function mpText(c) {
  const spent = spentMpOf(c)
  return spent == null ? '' : ` (MP ${spent}/${c.mov})`
}

const PHASE_NAMES = ['Mouvement', 'Combat', 'Fin de tour']
// Avertissement "changement de phase refusé" (cf. PhaseBlockedModal.vue) —
// ouvert par onPhaseNext ci-dessous.
const showPhaseBlocked = ref(false)

/** Clic sur le bouton "suivant" de la ligne des phases (cf. TurnTracker.vue,
 *  évènement `phase-next`). Le changement de phase est refusé, et la modale
 *  d'avertissement ouverte, dans deux cas :
 *   - en phase Mouvement, s'il reste 2 unités amies ou plus sur un même hex
 *     (cf. lib/useAssisted.js::stackedHexes) ;
 *   - en phase Combat (vers Fin de tour ou Autre joueur), s'il reste des
 *     combats obligatoires en attente (cf. lib/useCombat.js::pendingEngagements).
 *  Sinon, la décision de ce que fait réellement le clic reste à
 *  lib/useAssisted.js::advance. */
function onPhaseNext() {
  if (phase.value === 0 && stackedHexes.value.length > 0) {
    showPhaseBlocked.value = true
    return
  }
  if (phase.value === 1 && pendingEngagements.value.length > 0) {
    showPhaseBlocked.value = true
    return
  }
  const before = phase.value
  advance()
  // Journal : on enregistre le passage en Combat / Fin de tour (entrée
  // `phase`, rejouée par applyReplayEntry -> useAssisted.js::setPhase). Le
  // retour en Mouvement n'a pas besoin d'entrée propre : il accompagne
  // toujours un changement de tour, déjà journalisé (cf. onTurnChange), et
  // la phase y est remise à 0 d'office (cf. useAssisted.js, watcher de
  // `currentStep`, synchrone — d'où `phase` déjà à jour ici).
  if (phase.value != null && phase.value !== before && phase.value > 0) {
    log('phase', `Phase : ${PHASE_NAMES[phase.value]}`, { phase: phase.value, step: turnInfo.value.step })
  }
}

const selectedCounterId = ref(null)

// Entrée en phase Combat : un pion resté sélectionné depuis la phase
// Mouvement est désélectionné — en phase Combat, une unité amie ne se
// sélectionne jamais (cf. onCounterSelect), elle ne peut qu'être désignée
// attaquante.
watch(phase, (p) => {
  if (p === 1) selectedCounterId.value = null
})

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
  // cf. lib/useAssisted.js::resetMp — un pion replacé aux renforts doit
  // repartir avec un plein potentiel de MP la prochaine fois qu'il entrera
  // en jeu, pas avec ce qu'il lui restait au moment où il a quitté la carte.
  // cf. lib/useAssisted.js::unspendEntryCost — et s'il avait fait grimper la
  // congestion du hex par lequel il était entré ce tour-ci, cette place est
  // maintenant libre : le prochain à entrer par ce même hex ne doit pas
  // payer pour une entrée qui n'a plus lieu.
  if (c) {
    resetMp(c)
    unspendEntryCost(c)
  }
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
  const from = { c: c.col, r: c.row }
  const set = new Set()
  for (const key of adjacentSet.value) {
    const [col, row] = key.split(',').map(Number)
    const h = { c: col, r: row }
    if (!canEnterHex(c, h, from)) continue
    // Règle d'empilement (mouvement normal, cf. lib/useAssisted.js) : un hex
    // déjà occupé par un pion AMI n'est atteignable que si le pion sélectionné
    // pourrait ensuite continuer sa route (MP restants après y être entré) —
    // sinon il resterait "coincé" dessus, ce qui est interdit. On l'exclut
    // donc du surlignage vert pour ne pas laisser croire que ce clic ferait
    // quelque chose.
    if (hasFriendlyOccupant(c, h) && !canLeaveAfterEntering(c, h, from)) continue
    set.add(key)
  }
  return set
})
const isReachable = (h) => reachableSet.value.has(h.c + ',' + h.r)

// --- Entrée en jeu d'un renfort : deux systèmes cf. demande utilisateur —
// 1) glisser-déposer libre (n'importe quel hex, cf. onMapDrop) ;
// 2) clic sur le pion dans le panneau (bordure orange, cf.
//    ReinforcementsPanel.vue) puis clic sur un des hex d'entrée valides,
//    surlignés en orange sur la carte — cf. `entryHexSet` ci-dessous pour le
//    détail des 3 formes de `setup` (cf. arnhem.json) et de leurs hex
//    valides respectifs. Déclaré ICI (avant le `useDebug()` plus bas, pas
//    juste avant `onHex` comme le reste de la logique de renfort) parce que
//    `entryHexSet` lui est transmis, pour l'affichage debug du surcoût
//    d'entrée (cf. lib/useAssisted.js::entrySurcharge).
const selectedReinforcement = computed(() =>
  reinforcements.value.find((c) => String(c.id) === String(selectedReinforcementId.value))
)

// Un hex de BORD DE CARTE : au moins un de ses 6 voisins est hors carte. Les
// `setup` "ref seule" (cf. `entryHexSet` plus bas) sont TOUJOURS des hex de
// bord — cette fonction sert à ne proposer, en repli, QUE d'autres hex de
// bord (cf. `fallbackEntryHexes`), jamais un hex vers l'intérieur de la
// carte : un renfort qui débarque au bord de la zone de jeu reste au bord,
// il ne "saute" pas plus loin à l'intérieur.
function isEdgeHex(h) {
  return hexOnMap(h.col, h.row) && neighborsOf(h.col, h.row).some((n) => !hexOnMap(n.col, n.row))
}

// `hex` (déjà occupé ou non) empêche-t-il `r` (le renfort qu'on cherche à
// poser) d'y entrer ? Vrai si `hex` est occupé par au moins un pion qui est :
//  - ennemi de `r` (cf. lib/useAssisted.js::isEnemyOf) — on ne débarque
//    évidemment pas sur une case tenue par l'adversaire ;
//  - OU ami de `r`, mais lui-même actuellement figé dans une ZOC ennemie
//    (cf. lib/useAssisted.js::enemyZocSet — même test que `canEnterHex` :
//    "cette unité est-elle DANS la ZOC ennemie qu'elle projette autour
//    d'elle-même ?" répond à "est-elle figée sur place ce tour-ci ?").
//  - OU ami de `r`, alors que `r` ne pourrait pas en repartir ensuite (cf.
//    `entryWouldStack` ci-dessous) — il y resterait coincé avec lui.
//    Un ami "normal" (pas figé), avec un renfort qui garde de quoi repartir,
//    ne bloque PAS l'entrée : le renfort peut traverser son hex.
// Les marqueurs et pions de soutien ne comptent jamais comme occupants ici
// (ni ennemis ni amis au sens de cette règle).
function isEntryHexBlocked(r, hex) {
  const occupants = counters.value.filter(
    (c) => c.col === hex.col && c.row === hex.row && isUnit(c) && c.kind !== 'support'
  )
  return occupants.some((c) => isEnemyOf(r, c) || enemyZocSet(c).has(c.col + ',' + c.row))
    || entryWouldStack(r, hex)
}

// Règle d'empilement appliquée à l'ENTRÉE EN JEU (cf.
// lib/useAssisted.js::canLeaveAfterReinforcementEntry) : `hex` est occupé
// par un ami de `r`, et `r`, une fois entré (coût d'entrée payé, sauf
// aéroporté "+adj"), n'aurait plus de quoi en repartir. Toujours faux hors
// mode Assisté.
function entryWouldStack(r, hex) {
  const h = { c: hex.col, r: hex.row }
  return hasFriendlyOccupant(r, h) && !canLeaveAfterReinforcementEntry(r, h, !r.setup.endsWith('+adj'))
}

// Hex de repli pour un `setup` "ref seule" (cf. `entryHexSet`) dont l'hex de
// référence `ref` est bloqué (cf. `isEntryHexBlocked`) : parmi les hex de
// bord voisins de `ref` (cf. `isEdgeHex` — généralement 2, celui "avant" et
// celui "après" le long du bord de la carte), on ne garde que ceux qui ne
// sont PAS eux-mêmes bloqués, puis on ne retient que le(s) plus proche(s)
// (cf. lib/hex.js::hexDistance) d'UNE UNITÉ AMIE de `r`, où qu'elle soit sur
// la carte — les deux hex de repli sont retenus ensemble en cas d'égalité
// (le joueur choisit alors lequel utiliser). Si aucune unité amie n'est sur
// la carte (cas limite, ex. tout premier renfort de la partie), tous les
// hex de repli valides restent proposés faute de repère de distance.
// Liste vide si aucun repli n'est possible : cf. `entryHexSet`, qui laisse
// alors le renfort tout simplement hors de portée ce tour-ci (rien n'est
// surligné, un clic n'importe où ne fait rien — cf. onHex).
function fallbackEntryHexes(r, ref) {
  const candidates = neighborsOf(ref.col, ref.row)
    .filter((n) => isEdgeHex(n) && !isEntryHexBlocked(r, n))
  if (!candidates.length) return []
  const friendlies = counters.value.filter(
    (c) => isUnit(c) && c.kind !== 'support' && !isEnemyOf(r, c)
  )
  if (!friendlies.length) return candidates
  const distanceToFriendlies = (h) => Math.min(...friendlies.map((f) => hexDistance(h, f)))
  const scored = candidates.map((h) => ({ h, d: distanceToFriendlies(h) }))
  const minD = Math.min(...scored.map((s) => s.d))
  return scored.filter((s) => s.d === minD).map((s) => s.h)
}

// Hex d'entrée valides pour le renfort actuellement sélectionné, selon la
// forme de son `setup` (cf. arnhem.json) :
//  1. "CCRR-CCRR" (plage bord-de-carte, ex. renforts allemands) : toute la
//     plage déclarée (cf. enumerateSetupHexes), sauf les hex où le renfort
//     resterait coincé avec un ami (cf. `entryWouldStack`) ;
//  2. "CCRR+adj" (ex. chaque unité alliée près de sa DZ) : l'hex de
//     référence ET ses 6 voisins (pas de blocage ennemi/ZOC à ce niveau —
//     l'éventail est déjà large), même exception d'empilement qu'en 1 ;
//  3. "CCRR" seule (sans "-" ni "+adj") : UNIQUEMENT cet hex précis — SAUF
//     s'il est bloqué (cf. `isEntryHexBlocked`), auquel cas seuls le(s) hex
//     de repli valide(s) (cf. `fallbackEntryHexes`) sont proposés à la
//     place (jamais les deux à la fois : soit la référence, soit son/ses
//     repli(s), jamais plus d'un choix "normal" en même temps).
const entryHexSet = computed(() => {
  const r = selectedReinforcement.value
  if (!r) return new Set()
  if (r.setup.includes('-')) {
    const cells = enumerateSetupHexes(r.setup).filter((h) => !entryWouldStack(r, h))
    return new Set(cells.map((h) => h.col + ',' + h.row))
  }
  const ref = parseHexId(r.setup) // tolère un éventuel suffixe "+adj" (ne lit que les 4 premiers caractères)
  if (r.setup.endsWith('+adj')) {
    const cells = [ref, ...neighborsOf(ref.col, ref.row).filter((n) => hexOnMap(n.col, n.row))]
      .filter((h) => !entryWouldStack(r, h))
    return new Set(cells.map((h) => h.col + ',' + h.row))
  }
  const cells = isEntryHexBlocked(r, ref) ? fallbackEntryHexes(r, ref) : [ref]
  return new Set(cells.map((h) => h.col + ',' + h.row))
})
const isEntryHex = (h) => entryHexSet.value.has(h.c + ',' + h.r)

// cf. lib/useAssisted.js::enemyZocSet — hex sous ZOC ennemie relativement au
// pion sélectionné (vide si aucun pion sélectionné, ou si l'appli n'est pas
// en mode Assisté puisqu'aucun pion n'y est alors jamais "sélectionné" — cf.
// lib/useAssisted.js::selectable). La RÈGLE elle-même (cf.
// lib/useAssisted.js::canEnterHex) s'applique TOUJOURS en mode Assisté,
// avec ou sans debug — seul cet AFFICHAGE (surlignage rouge, classe CSS
// `hex-zoc`, cf. template) est réservé au mode debug (cf. `v-if="debug"`),
// pour ne pas surcharger l'écran par défaut. `zocSet` est aussi transmis à
// useDebug() ci-dessous pour que le calcul de portée en tienne compte.
const zocSet = computed(() => enemyZocSet(selectedCounter.value))
const isZocHex = (h) => zocSet.value.has(h.c + ',' + h.r)

// cf. lib/useDebug.js — case à cocher "debug" (ci-dessous dans le template)
// et tous les affichages qu'elle déclenche : le coût de terrain (COT) des
// hex adjacents au pion sélectionné (`adjacentCotLabels`), la portée
// COMPLÈTE de déplacement de ce pion, au-delà du simple premier pas adjacent
// (`isInRange`, cf. surlignage vert dans le template, en mode debug
// seulement — le clic, lui, reste toujours limité aux hex adjacents), et le
// surcoût de congestion déjà accumulé sur les hex d'entrée de renfort
// actuellement surlignés (`entrySurchargeLabels`, cf.
// lib/useAssisted.js::entrySurcharge). Le calcul de portée reçoit `zocSet`
// ci-dessus pour respecter la ZOC : un pion ne peut pas continuer son
// chemin au-delà d'un hex sous ZOC ennemie.
const { debug, adjacentCotLabels, isInRange, entrySurchargeLabels } = useDebug(
  hexes, isAdjacent, terrainCost, selectedCounter, remainingMp, neighborsOf, hexOnMap, canEnterTerrain, zocSet,
  entryHexSet, entrySurcharge, hasFriendlyOccupant,
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

/** Clic sur un pion déjà sur la carte — deux interprétations possibles,
 *  cf. le nouveau comportement demandé pour le mouvement normal :
 *   1. un AUTRE pion est déjà sélectionné et celui-ci lui est adjacent -> le
 *      clic est traité comme un déplacement vers son hex (cf. onHex), PAS
 *      comme un changement de sélection. Sans ça, cliquer sur un pion qui
 *      occupe la case visée reviendrait TOUJOURS à sélectionner ce pion (son
 *      image recouvre le polygone de l'hex en dessous, cf.
 *      Counter.vue::onClick, `@click.stop`), rendant impossible tout
 *      déplacement au clic vers une case occupée (ex. empilement avec un
 *      ami, cf. la règle qui précède) ;
 *   2. sinon, comportement de sélection normal — SAUF si ce pion est
 *      verrouillé (cf. `lockedFromSelectionIds` : il a bougé ce tour-ci puis
 *      a déjà été désélectionné une fois), auquel cas le clic ne fait rien. */
function onCounterSelect(id) {
  if (replayLocked.value) return
  const c = counters.value.find((c) => String(c.id) === String(id))
  if (!c) return
  // --- Phase Combat (mode Assisté) : le clic sur un pion compose un COMBAT
  // plutôt que de sélectionner/déplacer (cf. lib/useCombat.js) —
  //   1. c'est une unité ENNEMIE -> son hex est ajouté aux cibles (ouvrant
  //      le combat s'il n'y en avait pas), ou en est retiré s'il y était déjà
  //      (même effet qu'un clic sur l'hex, cf. onHex : le pion recouvre le
  //      polygone de son propre hex, les deux doivent donc faire pareil) ;
  //   2. c'est une unité à soi, adjacente à TOUS les hex cibles (règle
  //      stricte) -> la désigne (ou la retire si elle l'était déjà) comme
  //      attaquante.
  // Dans TOUS les autres cas, le clic ne fait rien : en phase Combat, une
  // unité amie ne se sélectionne jamais "normalement" — ni avant d'avoir
  // désigné une cible, ni si elle est hors de portée, ni si elle a déjà
  // combattu (cf. lib/useCombat.js::hasFought, qui la rend inéligible).
  if (combatAllowed.value) {
    if (!toggleTarget(c)) toggleAttacker(c)
    return
  }
  if (selectedCounterId.value != null && selectedCounterId.value !== id && isAdjacent({ c: c.col, r: c.row })) {
    onHex({ c: c.col, r: c.row })
    return
  }
  if (lockedFromSelectionIds.value.has(String(id))) return
  if (!canControl(c)) return
  setSelectedCounter(selectedCounterId.value === id ? null : id)
  selectedReinforcementId.value = null
}

const selectedReinforcementId = ref(null)

function onReinforcementSelect(id) {
  if (replayLocked.value) return
  const c = reinforcements.value.find((c) => String(c.id) === String(id))
  if (!canControl(c) || !canEnterThisTurn(c)) return
  // Désélection du pion en cours AVANT de choisir le renfort : refusée si ce
  // pion est en overstack (cf. setSelectedCounter), et le renfort n'est
  // alors pas sélectionné non plus.
  if (!setSelectedCounter(null)) return
  selectedReinforcementId.value = selectedReinforcementId.value === id ? null : id
}

// --- Empilement (stacking) au mouvement normal -----------------------------
// Une unité ne peut jamais TERMINER sa phase de Mouvement sur un hex occupé
// par une unité AMIE (deux amies ne peuvent pas y rester ensemble à la fin
// du tour) — cf. lib/useAssisted.js::hasFriendlyOccupant/
// canLeaveAfterEntering (déplacées là-bas pour être réutilisées telles
// quelles par lib/useDebug.js, cf. plus bas : le surlignage vert de la
// portée complète en mode debug doit lui aussi exclure ces hex). Ne concerne
// QUE le mouvement normal d'un pion déjà sur la carte (cf. onHex ci-dessous)
// — pas l'entrée en jeu d'un renfort, qui a ses propres règles de blocage
// (cf. `isEntryHexBlocked` plus haut : ennemi, ou ami figé en ZOC).

/** Clic sur un hex, par ordre de priorité :
 *  1. un renfort est sélectionné (système 2) et l'hex cliqué fait partie de
 *     ses hex d'entrée valides -> il s'y pose, fin de sélection. Si son
 *     `setup` n'est pas "+adj" (aéroporté, non concerné), il paie en plus le
 *     coût d'entrée de cet hex, congestion comprise (cf.
 *     lib/useAssisted.js::spendEntryCost) ;
 *  2. un pion déjà sur la carte est sélectionné, l'hex cliqué lui est
 *     adjacent, il lui reste assez de MP pour en payer le coût de terrain
 *     (cf. lib/useAssisted.js::canEnterHex/spendMp) ET l'hex n'est pas
 *     occupé par un ami avec lequel il finirait "coincé" (cf.
 *     `hasFriendlyOccupant`/`canLeaveAfterEntering` ci-dessus) -> il s'y
 *     déplace (et reste sélectionné, pour enchaîner sur d'autres hex tant
 *     qu'il lui reste des MP) ;
 *  3. sinon, le clic ne fait rien (pas de pion/renfort concerné par cet hex).
 *  Aucune action pendant un rejeu en cours (cf. `replayLocked`) — seul le
 *  lecteur (stepReplay/fastForwardReplay) fait bouger la carte tant que le
 *  journal chargé n'est pas entièrement joué. */
const onHex = (h) => {
  if (replayLocked.value) return
  // Clic sur un hex cible pendant un combat : le retire des cibles (et
  // annule le combat si c'était le dernier, cf. lib/useCombat.js) — pendant
  // de la même règle dans onCounterSelect, pour le cas où c'est le POLYGONE
  // de l'hex qui reçoit le clic plutôt que le pion posé dessus.
  if (isCombatTargetHex(h)) { removeTargetHex(h.c, h.r); return }
  if (selectedReinforcementId.value != null) {
    if (isEntryHex(h)) {
      const r = selectedReinforcement.value
      if (r && canEnterThisTurn(r)) {
        const placed = { ...r, col: h.c, row: h.r }
        counters.value.push(placed)
        // "+adj" (aéroporté) n'est jamais un hex de bord de carte au sens de
        // cette règle — cf. lib/useAssisted.js::spendEntryCost, qui ne fait
        // rien hors mode Assisté de toute façon.
        const paysEntry = !r.setup.endsWith('+adj')
        const paid = paysEntry ? spendEntryCost(placed, h) : null
        emit('move', { counterId: placed.id, col: h.c, row: h.r })
        // Hex d'entrée CONGESTIONNÉ (au moins une autre entrée par ce même hex
        // ce tour-ci, cf. lib/useAssisted.js::entryCost) : le journal le
        // signale, avec le coût majoré réellement payé.
        const congestion = paid && paid.rank > 1
          ? ` — hex d'entrée déjà utilisé (${paid.rank}e entrée ce tour) : coût ×${paid.rank} = ${paid.cost} MP au lieu de ${paid.baseCost}`
          : ''
        // `entry` : il a payé un coût d'entrée — au rejeu, on le repaie pour
        // rétablir aussi la CONGESTION de cet hex (cf. applyReplayEntry, qui
        // recalcule le coût lui-même : `entryRank`/`entryCost` ne sont là que
        // pour information).
        log('place', `${r.name} entre en jeu en ${hexId(h.c + 1, h.r)}${mpText(placed)}${congestion}`,
          { counterId: placed.id, col: h.c, row: h.r, mp: spentMpOf(placed), entry: paysEntry,
            entryRank: paid?.rank ?? null, entryCost: paid?.cost ?? null })
        // Sélectionné automatiquement après son entrée en jeu, pour pouvoir
        // enchaîner tout de suite sur son mouvement (cf. onHex, branche
        // mouvement normal) sans avoir à recliquer dessus — comme un pion
        // déjà sur la carte qui vient de se déplacer (cf. `setSelectedCounter`,
        // qui gère aussi le verrouillage d'un éventuel pion PRÉCÉDEMMENT
        // sélectionné ayant déjà bougé, cf. section "Verrouillage" plus haut).
        setSelectedCounter(placed.id)
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
    const fromHex = c ? { c: from.col, r: from.row } : null
    // Empilement : `h` est occupé par un ami ET `c` ne pourrait plus repartir
    // ensuite -> comme si l'hex n'était pas une destination valide (cf.
    // `hasFriendlyOccupant`/`canLeaveAfterEntering` plus haut) — une unité ne
    // peut jamais TERMINER sa phase de Mouvement sur un hex ami.
    const stackingBlocked = c && hasFriendlyOccupant(c, h) && !canLeaveAfterEntering(c, h, fromHex)
    // Pas assez de MP pour entrer dans cet hex (cf. useAssisted.js) : le
    // pion reste sélectionné et sur place, comme si l'hex n'était pas une
    // destination valide — libre à l'utilisateur d'essayer un autre hex
    // adjacent moins coûteux.
    if (c && !stackingBlocked && canEnterHex(c, h, fromHex)) {
      c.col = h.c; c.row = h.r
      spendMp(c, h, fromHex)
      emit('move', { counterId: c.id, col: c.col, row: c.row })
      const journalId = log('move', `${c.name} se déplace vers ${hexId(h.c + 1, h.r)}${mpText(c)}`,
        { counterId: c.id, col: c.col, row: c.row, mp: spentMpOf(c) })
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
  // Phase Mouvement, aucun MP dépensé, aucune congestion d'entrée — et, par
  // le retour en phase 0, plus aucune unité "ayant combattu" ni combat
  // ouvert (cf. lib/useCombat.js, watcher de `phase`). Nécessaire même si
  // le pas 0 était déjà le pas courant (le watcher de tour ne se déclenche
  // alors pas).
  resetTurnState()
  nextTick(() => { isReplaying.value = false })
}

/** Applique une entrée de journal à la carte — même logique que la synchro
 *  multijoueur (`applyRemoteMove`/`applyRemoteTurn`), qui ne réémet ni ne
 *  journalise rien : rejouer une ligne ne fait bouger que la carte. En plus
 *  des positions, le rejeu rétablit l'état de la phase en cours (utile pour
 *  une sauvegarde faite en plein tour) :
 *   - `move`/`place` : MP déjà dépensés par l'unité (`d.mp`, total absolu,
 *     cf. lib/useAssisted.js::setSpentMp) et, pour une entrée en jeu qui a
 *     payé un coût d'entrée (`d.entry`), la congestion de l'hex. Une unité
 *     qui a bougé (`move`) est de plus VERROUILLÉE : elle ne peut plus être
 *     sélectionnée une fois le journal rechargé (cf. `lockedFromSelectionIds`) ;
 *   - `phase` : phase en cours (cf. lib/useAssisted.js::setPhase) ;
 *   - `combat` : unités ayant combattu (cf. lib/useCombat.js::markFought).
 *  Les champs absents (journaux enregistrés avant cet ajout) sont ignorés. */
function applyReplayEntry(entry) {
  const d = entry.data
  if (!d) return
  if (entry.kind === 'move' || entry.kind === 'place') {
    applyRemoteMove(d.counterId, d.col, d.row)
    if (entry.kind === 'move') {
      const key = String(d.counterId)
      const start = turnStartPositions.get(key)
      if (start && start.col === d.col && start.row === d.row) {
        // Revenu à sa position de début de tour ("Annuler le mouvement", cf.
        // cancelMovement) : comme en jeu, il n'a de fait plus bougé.
        clearMoved(key)
      } else if (movedThisTurnIds.value.has(key)) {
        // Unité qui a bougé ce tour-ci : son mouvement est considéré comme
        // TERMINÉ au rechargement, elle ne peut plus être sélectionnée (cf.
        // `lockedFromSelectionIds`) — en jeu, ce verrou n'est posé qu'à sa
        // désélection, que le journal n'enregistre pas.
        lockedFromSelectionIds.value = new Set(lockedFromSelectionIds.value).add(key)
      }
    }
    if (entry.kind === 'place' && d.entry) {
      const placed = counters.value.find((c) => String(c.id) === String(d.counterId))
      if (placed) spendEntryCost(placed, { c: d.col, r: d.row })
    }
    // Après `spendEntryCost` : la valeur du journal fait foi (elle inclut
    // déjà le coût d'entrée payé à l'époque).
    setSpentMp(d.counterId, d.mp)
  } else if (entry.kind === 'phase') {
    setPhase(d.phase)
  } else if (entry.kind === 'combat') {
    markFought([...(d.attackerIds ?? []), ...(d.defenderIds ?? [])])
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
    // Nouveau tour/camp : plus aucune unité "a bougé" ni verrouillée — fait
    // ICI, tout de suite, et non dans onTurnChange (différé, cf. son
    // commentaire), pour que les `move` rejoués juste après restent marqués.
    clearAllMoved()
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
          :initial-step="initialTurnStep" :disabled="replayLocked" :phase="phase" :phase-labels="phaseLabels" :next-label="nextLabel"
          @turn="onTurnAdvance" @change="onTurnChange" @phase-next="onPhaseNext" />

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

        <!-- cf. lib/useAssisted.js::enemyZocSet — hex sous Zone de Contrôle
             (ZOC) ennemie du pion sélectionné : y entrer force l'arrêt du
             mouvement ce tour-ci (cf. canEnterHex, même règle, qui
             s'applique quel que soit cet affichage). Affiché UNIQUEMENT en
             mode debug (cf. HexMap.vue::zocSet) — la règle reste active en
             mode Assisté normal, seul ce surlignage est réservé au debug. -->
        <g v-if="debug">
          <polygon v-for="h in hexes.filter((h) => isZocHex(h))" :key="'zoc' + h.id" class="hex-zoc"
            :points="h.pts" vector-effect="non-scaling-stroke" />
        </g>

        <!-- cf. lib/useCombat.js — combat en cours : hex CIBLES en orange
             (cliquables pour les retirer, cf. onHex — ce groupe est rendu
             indépendamment de `showGrid`, qui ne doit pas conditionner
             l'affichage ni l'annulation d'un combat) et hex des ATTAQUANTS
             désignés en jaune (non cliquables : c'est le pion posé dessus
             qui reçoit le clic, cf. onCounterSelect). -->
        <g v-if="combatActive">
          <polygon v-for="h in hexes.filter((h) => isCombatAttackerHex(h))" :key="'atk' + h.id" class="hex-attacker"
            :points="h.pts" vector-effect="non-scaling-stroke" />
          <polygon v-for="h in hexes.filter((h) => isCombatTargetHex(h))" :key="'def' + h.id" class="hex-defender"
            :points="h.pts" vector-effect="non-scaling-stroke" @click="onHex(h)" />
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

        <!-- cf. lib/useAssisted.js::entrySurcharge — surcoût de congestion
             déjà accumulé sur les hex d'entrée de renfort surlignés, visible
             uniquement en mode debug. -->
        <g v-if="debug">
          <text v-for="d in entrySurchargeLabels" :key="'entrysur' + d.id" class="debug-entry-surcharge"
            :x="d.cx" :y="d.cy - calibration.a * 0.4" text-anchor="middle" :font-size="calibration.a * 0.4">+{{ d.surcharge }}</text>
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
            :moved="movedThisTurnIds.has(String(c.id))" :spent="hasFought(c)"
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

    <!-- cf. lib/useCombat.js — modale de combat, ouverte par un clic sur une
         unité ennemie en phase Combat. Non bloquante : la carte reste
         cliquable pour y désigner les unités attaquantes. -->
    <CombatModal v-if="combatActive" :target-hexes="combatTargetHexLabels" :defenders="combatDefenders"
      :attackers="combatAttackers" :can-resolve="combatCanResolve"
      :attack-strength="attackStrength" :defense-strength="defenseStrength" :differential="differential"
      :terrain-row="combatTerrainRow" :column="combatColumn" :combat-result="combatResult"
      :crt-rows="crtRows" :crt-results="crtResults" @close="cancelCombat" @fight="onCombatFight" />

    <!-- cf. onPhaseNext — changement de phase refusé : unités empilées en fin
         de Mouvement (cf. lib/useAssisted.js::stackedHexes) ou combats
         obligatoires encore en attente (cf. lib/useCombat.js::pendingEngagements).
         Les deux listes sont vides hors de leur phase respective. -->
    <PhaseBlockedModal v-if="showPhaseBlocked" :engagements="pendingEngagements" :stacks="stackedHexes"
      @close="showPhaseBlocked = false" />

    <!-- cf. setSelectedCounter — changement de sélection refusé : l'unité
         en cours de mouvement est en overstack avec une unité amie. -->
    <PhaseBlockedModal v-if="unitStackBlock" title="Mouvement non terminé" :stacks="[unitStackBlock]"
      stack-message="Cette unité partage son hex avec une unité amie. Déplacez-la (ou annulez son mouvement) avant de passer à une autre unité :"
      @close="unitStackBlock = null" />

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

/* cf. lib/useAssisted.js::entrySurcharge — surcoût de congestion accumulé
   sur un hex d'entrée de renfort (ex. "+0.5"). Couleur distincte de
   .debug-cot pour ne pas confondre les deux nombres s'ils apparaissent sur
   le même hex (le COT normal ET le surcoût d'entrée n'ont pas le même sens). */
.debug-entry-surcharge {
  font-family: monospace;
  font-weight: 700;
  fill: #1f6f43;
  stroke: #fff;
  stroke-width: 3px;
  paint-order: stroke fill;
  pointer-events: none;
}

/* cf. lib/useAssisted.js::enemyZocSet — hex sous ZOC ennemie du pion
   sélectionné. Contour rouge en tirets (distinct des teintes pleines
   .hex.adjacent/.entry, avec lesquelles il peut se superposer — un hex peut
   être À LA FOIS accessible ET sous ZOC, cf. règle "doit s'y arrêter") pour
   rester lisible quel que soit ce qu'il y a dessous. */
.hex-zoc {
  fill: rgba(192, 57, 43, 0.22);
  stroke: #c0392b;
  stroke-width: 2.5;
  stroke-dasharray: 5 3;
  pointer-events: none;
}

/* cf. lib/useCombat.js — hex cible d'un combat en cours. Orange plein
   avec un contour marqué, pour rester distinct de `.hex.entry` (même
   famille de couleur, mais sans contour) : les deux ne peuvent de toute
   façon pas apparaître en même temps (hex d'entrée = renfort sélectionné en
   phase Mouvement, défenseur = phase Combat). Cliquable, contrairement aux
   autres surlignages : le cliquer retire l'hex des cibles (et annule le
   combat si c'était le dernier). */
.hex-defender {
  fill: rgba(255, 140, 0, 0.5);
  stroke: #ff8c00;
  stroke-width: 3;
  cursor: pointer;
}

.hex-defender:hover {
  fill: rgba(255, 140, 0, 0.68);
}

/* cf. lib/useCombat.js — hex d'une unité désignée attaquante. Jaune, pour
   se distinguer au premier coup d'œil de l'orange du défenseur. Les clics
   le traversent (`pointer-events: none`) : c'est le pion posé dessus qui
   les reçoit, et c'est lui qui retire l'unité du combat si on le reclique. */
.hex-attacker {
  fill: rgba(232, 196, 104, 0.45);
  stroke: #e8c468;
  stroke-width: 2.5;
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
