<script setup>
// ═══════════════════════════════════════════════════════════════════════════
// HexMap.vue — carte hexagonale complète : toolbar, image + grille SVG
// cliquable, et panneau de calibration. Composant autonome : reçoit un
// `module` (la boîte de jeu — cf. public/modules/*.json) pour l'image et la
// géométrie de grille (cols/rows) et la calibration pixel de la grille
// (`map.calibration` — x0/y0/colStep/a/rowStep, complétée par
// DEFAULT_CALIBRATION de lib/calibration.js), ajustable en direct via
// CalibrationPanel.vue.
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

import { reactive, ref, computed, toRef, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { hexId, DEFAULT_CALIBRATION } from '../lib/calibration.js'
import { neighborsOf, hexDistance } from '../lib/hex.js'
import { hexExists, removedHexSet } from '../lib/mapShape.js'
import { useAssisted } from '../lib/useAssisted.js'
import { useDebug } from '../lib/useDebug.js'
import { useCombat } from '../lib/useCombat.js'
import { useRetreat } from '../lib/useRetreat.js'
import { useModuleRules } from '../lib/moduleRules.js'
import { isUnit, isFighter, isSupport } from '../lib/units.js'
import { parseSetup, isAirborneEntry, deploymentCells, rangeCells, landingCells } from '../lib/setup.js'
import { resolveRules, resolveTurnStructure } from '../lib/rules.js'
import { resolveCombatTable } from '../lib/combatTable.js'
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
import MoveTimer from './MoveTimer.vue'

const props = defineProps({
  module: { type: Object, required: true }, // cf. src/modules/*.json — { boardGame, name, map: {...} }
  // Positions déjà déplacées depuis le setup du module (partie multijoueur en
  // cours) — { [counterId]: { col, row } }. Absent en solo/démo.
  initialPositions: { type: Object, default: () => ({}) },
  // Pas courant du suivi de tour déjà en cours (partie multijoueur reprise
  // en route) — cf. `turnTrack` ci-dessous. Absent (0) en solo/démo.
  initialTurnStep: { type: Number, default: 0 },
  // Phase déjà en cours (partie multijoueur reprise en route, cf.
  // server/src/rooms.js::recordPhase), ou `null` : phase de départ du camp
  // actif recalculée localement. Absent en solo/démo.
  initialPhase: { type: Number, default: null },
  // Temps déjà écoulé (ms) dans cette phase/ce pas côté serveur — reprise du
  // compteur du timing "Limité" (cf. MoveTimer.vue). 0 en solo/démo.
  initialPhaseElapsedMs: { type: Number, default: 0 },
  // Timing "Blitz" : temps de Mouvement déjà consommé par camp (ms) —
  // `{ [campKey]: ms }`, cf. server/src/rooms.js::recordPhase. {} en solo/démo.
  initialBlitzUsedMs: { type: Object, default: () => ({}) },
  // Timing "Blitz" : camp ayant déjà perdu au temps (partie en ligne
  // terminée, cf. server/src/rooms.js::recordGameOver), ou `null`.
  initialBlitzLoser: { type: String, default: null },
  // Camp du joueur sur ce navigateur (multijoueur, cf. RoomLobby.vue) :
  // l'alerte "Temps imparti terminé" n'est montrée qu'au joueur actif.
  // Vide en solo/démo (un seul navigateur pour tous les camps).
  localSide: { type: String, default: '' },
  // Partie EN LIGNE (cf. RoomLobby.vue) : le journal est PARTAGÉ entre les
  // joueurs et conservé par le serveur (cf. `log`, applyRemoteEntry). Faux
  // en solo/démo : journal local, sauvegarde auto et reprise inchangés.
  online: { type: Boolean, default: false },
  // En ligne : journal partagé déjà enregistré par le serveur (ordre
  // chronologique), rejoué au montage pour reconstituer la partie.
  initialJournal: { type: Array, default: () => [] },
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
  // Réglages de la partie (mode, scénario, météo, timing — cf.
  // lib/journalStorage.js), enregistrés avec le journal pour qu'une reprise
  // se rejoue dans les mêmes conditions. `null` si inconnus (multijoueur).
  settings: { type: Object, default: null },
})

// `phase` : `{ phase, step, blitzUsed }` — changement de phase LOCAL sans changement de
// pas (cf. onPhaseNext), à répercuter aux autres joueurs (multijoueur).
// `game-over` : `{ loser, text, t }` — Blitz, un camp a perdu au temps (cf.
// declareBlitzLoss), à répercuter aux autres joueurs (multijoueur).
// En ligne uniquement (journal partagé, cf. `log`) :
//  - `log` : `{ uid, t, kind, text, data }` — entrée ajoutée localement ;
//  - `unlog` : uid d'une entrée retirée (retour arrière) ;
//  - `deploy` : `{ setup, turn }` — entrées `setup` et `turn` de départ
//    proposées au lancement (cf. startSharedJournal).
// `restart-with` : `{ settings, entries, message }` — un journal à reprendre
// a été joué avec d'autres réglages : la page doit relancer la partie avec
// eux (cf. DemoPlay.vue, JournalPanel.vue::startReplay).
const emit = defineEmits(['move', 'turn', 'phase', 'game-over', 'log', 'unlog', 'deploy', 'restart-with'])

const map = computed(() => props.module.map)

// --- Journal de partie : historique de tout ce qui se passe (cf.
// JournalPanel.vue, onglet du panneau latéral — toute la logique y vit).
// HexMap.vue se contente d'appeler `log(kind, text)` à chaque évènement de
// jeu (tour, déplacement, entrée en jeu, élimination...).
const journalRef = ref(null)
function log(kind, text, data) {
  logDeploymentOnce()
  const journal = journalRef.value
  if (!journal) return undefined
  if (!props.online) return journal.log(kind, text, data)
  // En ligne : chaque entrée porte un identifiant unique (`uid`, commun à
  // tous les navigateurs) et part au serveur, qui la conserve et la
  // transmet aux autres joueurs (cf. applyRemoteEntry).
  const id = journal.log(kind, text, data, newUid())
  const { uid, t } = journal.getEntry(id)
  emit('log', { uid, t, kind, text, data })
  return id
}
function newUid() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

// --- Déploiement initial dans le journal : le placement de départ tire au
// hasard l'hex des unités à plage d'entrée (cf. `buildInitialCounters`). Sans
// trace de ce tirage, le rejeu en refaisait un autre et les unités jamais
// déplacées depuis changeaient de place. On l'enregistre donc, en PREMIÈRE
// entrée du journal (entrée `setup`, cf. applyReplayEntry) — au moment du
// premier évènement de la partie, et pas dès le chargement : écrire au
// chargement déclencherait l'auto-save et écraserait la sauvegarde qu'on
// propose justement de reprendre.
// En ligne, le déploiement est au contraire partagé DÈS le lancement (cf.
// onMounted, évènement `deploy`) : ce mécanisme-ci est alors désactivé.
let deploymentLogged = props.online
function logDeploymentOnce() {
  if (deploymentLogged || isReplaying.value || !journalRef.value) return
  deploymentLogged = true
  journalRef.value.log('setup', 'Déploiement initial', { positions: initialDeployment })
  // Puis le tour de départ (cf. `initialTurnEntry`) : TurnTracker.vue
  // l'annonce (évènement `change`) pendant son propre montage, AVANT que le
  // journal ne soit monté — onTurnChange ne peut donc pas l'inscrire, on le
  // rattrape ici, juste après le déploiement et avant le premier évènement.
  if (initialTurnEntry) journalRef.value.log(initialTurnEntry.kind, initialTurnEntry.text, initialTurnEntry.data)
}

/** Entrée de journal d'un changement de tour (cf. onTurnChange) — factorisée
 *  pour l'entrée du tour de DÉPART de la partie (cf. `initialTurnEntry`). */
function turnEntryOf(info) {
  const label = props.module.turnTrack?.sides?.[info.activeSideKey]?.label ?? info.activeSideKey
  return { kind: 'turn', text: `Tour ${info.turn} — ${label}`, data: { step: info.step } }
}
// Tour en cours au lancement de la partie, figé au montage (cf. onMounted —
// `turnInfo` est alors déjà renseigné par TurnTracker.vue), pour être inscrit
// au journal avec le déploiement (en local, cf. logDeploymentOnce) ou
// partagé avec lui (en ligne, cf. startSharedJournal). `null` sans piste de
// tour.
let initialTurnEntry = null

// --- Retour arrière : annule le dernier déplacement d'un pion déjà posé sur
// la carte (onHex / onCounterDragEnd ci-dessous) et efface son entrée de
// journal correspondante. Ne couvre volontairement que les déplacements —
// pas les entrées en jeu, éliminations, etc., qui ont leurs propres
// mécanismes de retour (menu contextuel "Replacer le pion").
// L'historique ne vaut que pour la phase de Mouvement EN COURS : il est vidé
// à chaque changement de phase (cf. watcher de `phase`) et de tour (cf.
// `clearAllMoved`). Sinon, en phase Combat, "Retour arrière" renvoyait à sa
// position d'avant mouvement une unité qui avait déjà combattu, voire avancé
// après combat — le journal la disait encore là où elle avait avancé, les
// règles la voyaient ailleurs, et les retraites suivantes passaient par
// l'hex qu'elle était censée tenir. Au tour suivant, l'adversaire pouvait de
// même annuler le dernier mouvement du joueur précédent.
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
  // Nouveau tour/camp : plus rien à annuler du tour écoulé (cf. `moveHistory`).
  moveHistory.value = []
  // Les règles particulières du module qui ne valent que pour le tour écoulé
  // s'effacent au même moment (cf. lib/useArnhem.js::clearTurnState — les
  // aéroportés largués ce tour-ci, dont l'allocation de mouvement est
  // réduite jusqu'au tour suivant). Sans effet sur les autres modules.
  moduleRules.clearTurnState()
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
    const prev = counters.value.find((counter) => String(counter.id) === String(previous))
    if (isOverstacked(prev)) {
      const units = counters.value.filter((counter) => counter.col === prev.col && counter.row === prev.row && isFighter(counter))
      unitStackBlock.value = { key: prev.col + ',' + prev.row, hex: hexId(prev.col + 1, prev.row), units: units.map((unit) => unit.name) }
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
  const counter = counters.value.find((counter) => String(counter.id) === String(id))
  if (counter) {
    // cf. lib/useAssisted.js::resetMp — annule d'un coup TOUS les
    // déplacements du tour de `c` (pas hex par hex comme `undoLastMove`
    // ci-dessous), donc on lui redonne la TOTALITÉ de ses MP plutôt que de
    // recréditer un seul hex. Ne fait rien hors mode Assisté.
    resetMp(counter)
    // ...sauf ce que le module lui compte comme déjà dépensé À SON ARRIVÉE
    // (cf. lib/useArnhem.js::airborneArrivalSpentMp) : un aéroporté largué
    // ce tour-ci qui annule son mouvement retrouve ses 3 MP d'atterrissage,
    // pas les 7 de son allocation imprimée.
    const arrivalMp = moduleRules.airborneArrivalSpentMp(counter)
    if (arrivalMp !== null) setSpentMp(counter.id, arrivalMp)
    counter.col = start.col; counter.row = start.row
    emit('move', { counterId: counter.id, col: counter.col, row: counter.row })
    log('move', `${counter.name} : mouvement annulé, retour en ${hexId(counter.col + 1, counter.row)}${mpText(counter)}`,
      { counterId: counter.id, col: counter.col, row: counter.row, mp: spentMpOf(counter) })
  }
  clearMoved(id)
}

// --- Retour arrière (bouton de la barre d'outils) : disponible UNIQUEMENT
// en mode Assisté (cf. `v-if="assisted"` sur le bouton plus bas) — en mode
// Libre, aucun garde-fou de tour/MP n'existe, "annuler" un glisser-déposer
// libre n'aurait pas vraiment de sens dans un bac à sable — et seulement en
// phase Mouvement (cf. `moveHistory`) : passé cette phase, les déplacements
// sont acquis (combats, retraites et avances en dépendent).
function undoLastMove() {
  if (!props.assisted || inputLocked.value || phase.value !== 0) return
  const last = moveHistory.value.pop()
  if (!last) return
  const counter = counters.value.find((counter) => String(counter.id) === String(last.counterId))
  if (counter) {
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
    refundMp(counter, { c: last.to.col, r: last.to.row }, { c: last.from.col, r: last.from.row })
    counter.col = last.from.col; counter.row = last.from.row
    emit('move', { counterId: counter.id, col: counter.col, row: counter.row })
    // Si l'annulation ramène le pion à sa position de tout début de tour,
    // il n'a plus "bougé ce tour" au sens du liseré orange.
    const start = turnStartPositions.get(String(counter.id))
    if (start && start.col === counter.col && start.row === counter.row) clearMoved(counter.id)
  }
  if (props.online) {
    const uid = journalRef.value?.getEntry(last.journalId)?.uid
    if (uid) emit('unlog', uid)
  }
  journalRef.value?.remove(last.journalId)
}

// --- Dé : widget flottant non-bloquant (cf. RollModal.vue), toujours monté
// (v-show, pas v-if, pour conserver sa position glissée et son état pendant
// qu'il est caché) — résultat journalisé à chaque lancer. Mode Libre
// UNIQUEMENT (widget et bouton "Cacher/Afficher le dé" absents en mode
// Assisté, cf. template) : en mode Assisté, les jets sont faits par l'appli
// elle-même là où la règle en demande un (cf. CombatModal.vue).
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
// Est-ce au joueur de CE navigateur de jouer ? Toujours vrai en solo/démo
// (`localSide` vide : un seul navigateur pour tous les camps). En ligne, les
// autres joueurs ne peuvent ni changer de phase ni passer au tour suivant
// (bouton de TurnTracker.vue désactivé, cf. template), et seul le joueur
// actif reçoit l'alerte "Temps imparti terminé" (cf. onMoveTimeUp).
const isLocalTurn = computed(() => !props.localSide || props.localSide === turnInfo.value.activeSideKey)
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
  // Le tour de DÉPART n'est jamais inscrit ici mais avec le déploiement (cf.
  // `initialTurnEntry`) : au montage, le journal n'existe pas encore, et
  // l'inscrire plus tard déclencherait l'auto-save qui écraserait la
  // sauvegarde proposée en reprise (cf. logDeploymentOnce).
  if (info.step === props.initialTurnStep) return
  // En ligne, seul le navigateur qui a fait avancer le tour l'inscrit au
  // journal partagé ; les autres le reçoivent (cf. applyRemoteEntry).
  if (props.online && info.step !== localTurnStep) return
  const entry = turnEntryOf(info)
  log(entry.kind, entry.text, entry.data)
}
// Dernier pas atteint par une avance LOCALE (cf. onTurnChange, en ligne).
let localTurnStep = null
function onTurnAdvance(step) {
  localTurnStep = step
  emit('turn', step)
}
function applyRemoteTurn(step) { turnTrackerRef.value?.applyRemoteTurn(step) }
// Un renfort ne peut entrer en jeu qu'à partir de son tour d'arrivée déclaré
// (`c.turn`, cf. module JSON) — jamais en avance. Par défaut (pas de `turn`
// déclaré), l'unité arrive dès le tour 1.
const canEnterThisTurn = (counter) => (counter?.turn ?? 1) <= turnInfo.value.turn

// --- Soutien allié : tablette autonome (cf. SupportTracker.vue, toute la
// logique — régénération par tour, tablette actuelle — y vit). HexMap.vue ne
// garde qu'une ref pour y déléguer la résolution/retrait d'un pion glissé
// depuis la tablette (cf. onCounterDragStart / onMapDrop plus bas).
const supportTrackerRef = ref(null)

// Calibration déclarée par le module (`map.calibration`), complétée par le
// repli du moteur — et base du bouton "réinitialiser défauts".
const moduleCalibration = { ...DEFAULT_CALIBRATION, ...(map.value.calibration ?? {}) }
const calibration = reactive({ ...moduleCalibration })
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
const hexOnMap = (col, row) => hexExists(col, row, mapShapeCfg.value, removed.value)

/** Liste des hex de la grille avec leur polygone SVG déjà calculé. */
const hexes = computed(() => {
  const { x0, y0, colStep, a: hexRadius, rowStep } = calibration
  const halfRowStep = rowStep / 2
  const out = []
  for (let col = 0; col < mapConfig.cols; col++) {
    const cx = x0 + col * colStep
    const yoff = col % 2 === 1 ? rowStep / 2 : 0
    for (let row = 1; row <= mapConfig.rows; row++) {
      if (!hexOnMap(col, row)) continue
      const cy = y0 + (row - 1) * rowStep + yoff
      const pts = [
        [cx - hexRadius, cy], [cx - hexRadius / 2, cy - halfRowStep], [cx + hexRadius / 2, cy - halfRowStep],
        [cx + hexRadius, cy], [cx + hexRadius / 2, cy + halfRowStep], [cx - hexRadius / 2, cy + halfRowStep],
      ].map((point) => point[0].toFixed(1) + ',' + point[1].toFixed(1)).join(' ')
      out.push({ id: hexId(col + 1, row), c: col, r: row, cx, cy, pts })
    }
  }
  return out
})

// Tous les pions déclarés par le module, toutes factions confondues (cf.
// public/modules/arnhem/arnhem.json -> counters.*) — sert à la fois au
// placement initial ci-dessous et à la liste des renforts pas encore posés
// (cf. `reinforcements`).
const allCounters = computed(() => Object.values(props.module.counters || {}).flat())

/** Un hex cible tiré au hasard parmi ceux du `setup` du pion (cf.
 *  lib/setup.js::deploymentCells — toute la plage pour un "CCRR-CCRR", l'hex
 *  de référence sinon) — utilisé uniquement pour le placement initial
 *  automatique au chargement (cf. `counters` ci-dessous), pas pour l'arrivée
 *  interactive d'un renfort (cf. plus bas : glisser-déposer libre ou choix
 *  explicite d'un hex surligné). */
function resolveEntryTarget(setup) {
  const pool = deploymentCells(parseSetup(setup), hexOnMap)
  return pool[Math.floor(Math.random() * pool.length)]
}

/** Jamais de stacking : un pion qui arrive prend son hex d'entrée s'il est
 *  libre, sinon un des 6 hex adjacents libres tiré au hasard. `occupied` est
 *  le Set (clés "col,row") des hex déjà réservés dans le lot de placement en
 *  cours — mis à jour par l'appelant après chaque choix. Si les 7 emplacements
 *  sont pleins (cas limite), on stack quand même plutôt que de perdre le pion. */
function pickArrivalHex(col, row, occupied) {
  const key = (keyCol, keyRow) => keyCol + ',' + keyRow
  if (hexOnMap(col, row) && !occupied.has(key(col, row))) return { col, row }
  const free = neighborsOf(col, row).filter((neighbor) => hexOnMap(neighbor.col, neighbor.row) && !occupied.has(key(neighbor.col, neighbor.row)))
  if (free.length) return free[Math.floor(Math.random() * free.length)]
  return { col, row }
}

// Paramètres des règles génériques déclarés par le module (`module.rules`,
// cf. lib/rules.js) : véhicules, terrains interdits, empilement, ZOC...
const rules = resolveRules(props.module.rules)
// Structure du tour d'un camp : phases facultatives déclarées par le module
// (`module.turnStructure`, cf. lib/rules.js et lib/useAssisted.js, "Phases").
const turnStructure = resolveTurnStructure(props.module.turnStructure)

// Règles PARTICULIÈRES au module joué (cf. lib/moduleRules.js, registre par
// module — ex. lib/useArnhem.js) : tout ce qui ne vaut QUE pour une boîte de
// jeu précise et qu'aucun champ du JSON ne sait exprimer. Pour un module qui
// n'en déclare pas, chaque règle renvoie `null` et le moteur générique
// ci-dessous s'applique tel quel.
const moduleRules = useModuleRules(toRef(props, 'moduleId'), {
  sides: props.module.sides,
  isUnit,
  assisted: toRef(props, 'assisted'),
  terrain: props.module.terrain,
  rules,
})

// Marqueurs / pions de soutien / unités combattantes : cf. lib/units.js
// (`isUnit`, `isFighter`, `isSupport`, importés plus haut) — seule
// définition de ce qu'est une "vraie unité" pour tout le moteur.

// Un pion est posé sur la carte au chargement s'il a un `setup` (hex de
// départ) ET arrive au tour 1 (ou sans `turn` — rétrocompatible avec les
// pions sans ce champ, ex. une garnison fixe). C'est la règle GÉNÉRIQUE,
// valable pour tout module.
// Un module peut la restreindre via ses règles particulières (cf.
// lib/useArnhem.js::autoPlacesAtLoad — Arnhem y retient hors carte les
// renforts allemands du tour 1 et toutes les UNITÉS alliées, dont seules les
// zones de largage "DZ" sont posées au coup d'envoi). La règle du module
// renvoie `null` quand elle ne se prononce pas — y compris, toujours, sur
// les autres modules — et on retombe alors sur la règle générique.
// Les renforts restants (tous tours/factions confondus) restent hors carte,
// glissables depuis le panneau "Renfort ..." (cf. `reinforcements`).
// Plusieurs pions peuvent partager le même hex d'entrée déclaré (ex. les 3
// bataillons d'un même régiment) : pickArrivalHex les répartit pour éviter
// le stacking (les marqueurs, eux, ignorent complètement cette logique — cf.
// isUnit).
function autoPlacesAtLoad(counter) {
  const special = moduleRules.autoPlacesAtLoad(counter)
  if (special !== null) return special
  return (counter.turn ?? 1) === 1
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
  for (const counter of allCounters.value.filter((counter) => parseSetup(counter.setup) && autoPlacesAtLoad(counter))) {
    const override = props.initialPositions[counter.id]
    const target = resolveEntryTarget(counter.setup)
    const pos = override ?? (isUnit(counter) ? pickArrivalHex(target.col, target.row, occupied) : target)
    if (isUnit(counter)) occupied.add(pos.col + ',' + pos.row)
    placed.push({ ...counter, ...pos })
  }
  return placed
}
const counters = ref(buildInitialCounters())
// Positions de départ de CETTE partie (cf. `logDeploymentOnce`), capturées
// avant tout mouvement.
const initialDeployment = counters.value.map((counter) => ({ id: counter.id, col: counter.col, row: counter.row }))

// cf. lib/useAssisted.js — toute la logique propre au mode "Assisté"
// (grille, sélection au clic, restriction de tour, phases Mouvement/Combat,
// MP/terrain/ZOC) y vit. Appelé ICI (et pas plus haut dans le fichier,
// comme dans les versions précédentes) parce qu'il a besoin de `counters`
// (cf. `enemyZocSet`, qui doit savoir où sont les pions ennemis) — lequel
// doit donc déjà être déclaré.
// Dernier paramètre : les renforts pas encore posés (phase Airborne, cf.
// lib/useAssisted.js::airbornePending), passés en FONCTION car
// `reinforcements` n'est déclaré que plus bas dans ce fichier.
const { showGrid, selectable, draggable, canControl, phase, phaseLabels, phaseIndex, nextLabel, advance,
  PHASE_AIRBORNE, initPhase, canPlaceReinforcementNow, canEnterHex, canEnterTerrain, spendMp, refundMp, resetMp, terrainCost, remainingMp, enemyZocSet, isEnemyOf, entrySurcharge, spendEntryCost, unspendEntryCost, wouldOverstack, canLeaveAfterEntering, canLeaveAfterReinforcementEntry, isOverstacked, stackedHexes, combatEdgeKind, edgeBlocksAttack, isZocFrozen, setPhase, setSpentMp, resetTurnState } = useAssisted(toRef(props, 'assisted'), turnTrackerRef, props.module.terrain, counters, props.module.sides, hexOnMap, () => reinforcements.value, rules, turnStructure)

// Table de combat déclarée par le module (`module.combat`, cf.
// lib/combatTable.js) — `null` : module sans combat.
const combatTable = resolveCombatTable(props.module.combat)

// Combat du mode Assisté (cf. lib/useCombat.js, qui porte toute la règle :
// désignation défenseur/attaquants, lecture de la table, jet de dé). Ce
// composant ne fait que lui brancher les clics (cf. onCounterSelect/onHex
// plus bas), les surlignages orange/jaune de la carte et la modale (cf.
// template).
const {
  combatActive, combatAllowed, targetHexes: combatTargetHexes, targetHexLabels: combatTargetHexLabels, defenders: combatDefenders,
  attackers: combatAttackers, toggleTarget, removeTargetHex, cancelCombat, toggleAttacker, hasFought, markFought, pendingEngagements,
  isCombatTargetHex, isCombatAttackerHex,
  attackStrength, defenseStrength, differential, canResolve: combatCanResolve, strandedUnits: combatStrandedUnits,
  terrainRow: combatTerrainRow,
  column: combatColumn, resolveCombat, combatResult, crtRows, crtResults,
} = useCombat(toRef(props, 'assisted'), phase, counters, canControl, props.module.terrain, combatEdgeKind, combatTable, edgeBlocksAttack)

// Application du résultat d'un combat (retraites au clic, éliminations — cf.
// lib/useRetreat.js, qui porte toute la règle). HexMap.vue ne lui fournit que
// les deux actions concrètes sur la carte : avancer une unité d'un hex, et
// éliminer une unité.
const {
  start: startRetreat, step: stepRetreat, reduce: reduceRetreat, cancelPush, clear: clearRetreat, active: retreatActive,
  info: retreatInfo, notes: retreatNotes, isRetreatHex, isRetreatingHex, markNoFire,
  advanceInfo, selectAdvancer, stepAdvance, endAdvance, isPorHex, isAdvanceHex, isAdvancerHex,
} = useRetreat({
  phase, counters, hexOnMap, canEnterTerrain, isEnemyOf,
  // Retraite interdite en ZOC ennemie — sauf si la règle du module la lève
  // (`rules.zoc.blocksRetreat`, cf. lib/rules.js).
  enemyZocSet: (unit) => (rules.zoc.blocksRetreat ? enemyZocSet(unit) : new Set()),
  moveUnit: (unit, hex, { done, total }) => {
    unit.col = hex.col; unit.row = hex.row
    emit('move', { counterId: unit.id, col: unit.col, row: unit.row })
    // Entrée `retreat` (et non `move`) : une retraite n'est ni un mouvement
    // de la phase (pas de liseré, pas d'annulation possible), ni une
    // dépense de MP — cf. applyReplayEntry.
    log('retreat', `${unit.name} retraite en ${hexId(unit.col + 1, unit.row)} (${done}/${total})`,
      { counterId: unit.id, col: unit.col, row: unit.row })
  },
  // Ami REFOULÉ d'un hex par une unité qui retraite : même traitement qu'un
  // pas de retraite (entrée `retreat`), avec `noFire` pour une artillerie
  // (qui ne peut plus tirer pendant cette phase de Combat, rétabli au rejeu, cf. applyReplayEntry).
  displaceUnit: (unit, hex, { by, noFire }) => {
    unit.col = hex.col; unit.row = hex.row
    emit('move', { counterId: unit.id, col: unit.col, row: unit.row })
    log('retreat', `${unit.name} refoulé en ${hexId(unit.col + 1, unit.row)} pour laisser passer ${by.name}`
      + (noFire ? ' (ne pourra plus tirer pendant cette phase)' : ''),
      { counterId: unit.id, col: unit.col, row: unit.row, displaced: true, ...(noFire ? { noFire: true } : {}) })
  },
  eliminateUnit: (unit, reason) => eliminateCounter(unit.id, reason),
  // Effet de chaque résultat et avance après combat : déclarés par la table
  // du module (cf. lib/combatTable.js).
  resultEffect: (code) => combatTable?.effects[code] ?? null,
  advanceAfterCombat: combatTable?.advanceAfterCombat ?? true,
  // Réductions de retraite propres au module (cf.
  // lib/useArnhem.js::cityRetreatReduction) — `null` hors Arnhem.
  retreatReduction: (unit, hex, task) => moduleRules.cityRetreatReduction(unit, hex, task),
  // Avance après combat : même traitement qu'un pas de retraite, sous une
  // entrée `advance` (cf. applyReplayEntry).
  advanceUnit: (unit, hex) => {
    unit.col = hex.col; unit.row = hex.row
    emit('move', { counterId: unit.id, col: unit.col, row: unit.row })
    log('advance', `${unit.name} avance en ${hexId(unit.col + 1, unit.row)} (après combat)`,
      { counterId: unit.id, col: unit.col, row: unit.row })
  },
})

/** Clic sur "Combattre" dans la modale : la règle (dé + lecture de la table)
 *  vit dans lib/useCombat.js, on ne fait ici qu'en journaliser le résultat
 *  (hex cibles et unités défenseuses, qui peuvent être plusieurs), puis
 *  lancer son application (cf. lib/useRetreat.js). */
function onCombatFight() {
  const combatOutcome = resolveCombat()
  if (!combatOutcome) return
  const diff = combatOutcome.diff > 0 ? '+' + combatOutcome.diff : String(combatOutcome.diff)
  const names = combatDefenders.value.map((defender) => defender.name).join(', ')
  // `data` : de quoi restaurer le combat au rejeu du journal (cf.
  // applyReplayEntry, entrée `combat`) — les unités participantes y sont
  // remarquées "ayant combattu" (cf. lib/useCombat.js::markFought).
  log('combat', `Combat sur ${combatTargetHexLabels.value.join(', ')} (${names}) : `
    + `différentiel ${diff}, ${combatOutcome.rowLabel}, dé ${combatOutcome.die} → ${combatOutcome.result} (${combatOutcome.resultLabel})`, {
    hexes: combatTargetHexLabels.value,
    attackerIds: combatAttackers.value.map((attacker) => attacker.id),
    defenderIds: combatDefenders.value.map((defender) => defender.id),
    diff: combatOutcome.diff, row: combatOutcome.rowKey, die: combatOutcome.die, result: combatOutcome.result,
  })
  // APRÈS le journal du combat : les éliminations/retraites qui suivent s'y
  // inscrivent donc bien après lui.
  startRetreat(combatOutcome.result, [...combatAttackers.value], [...combatDefenders.value], combatTargetHexes.value)
}

/** Total de MP déjà dépensés par `c` pendant ce tour-ci (cf.
 *  lib/useAssisted.js::remainingMp), ou `null` pour un pion sans potentiel
 *  de mouvement (ou hors mode Assisté). Enregistré dans le journal (champ
 *  `mp` des entrées `move`/`place`) pour qu'une partie sauvegardée en pleine
 *  phase de Mouvement retrouve ses MP au rejeu (cf. applyReplayEntry). */
function spentMpOf(counter) {
  const left = remainingMp(counter)
  return left == null ? null : counter.mov - left
}

/** Suffixe "(MP 3/6)" ajouté au texte d'un déplacement dans le journal —
 *  vide pour un pion sans potentiel de mouvement. */
function mpText(counter) {
  const spent = spentMpOf(counter)
  return spent == null ? '' : ` (MP ${spent}/${counter.mov})`
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
  // Rejeu, partie terminée ou, en ligne, pas le tour de ce joueur (le
  // bouton est déjà désactivé dans ces cas, cf. `inputLocked`).
  if (inputLocked.value) return
  // Retraite en cours (cf. lib/useRetreat.js) : elle doit être terminée
  // avant de pouvoir changer de phase.
  if (retreatActive.value) return
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
  // Journal : on enregistre le passage en Combat / Fin de tour, ET le
  // passage Airborne -> Mouvement (entrée `phase`, rejouée par
  // applyReplayEntry -> useAssisted.js::setPhase). Le retour en Mouvement
  // (ou Airborne) après un changement de camp n'a pas besoin d'entrée
  // propre : il accompagne toujours un changement de tour, déjà journalisé
  // (cf. onTurnChange), et la phase de départ y est recalculée d'office (cf.
  // useAssisted.js::startSidePhase, watcher de `currentStep`, synchrone —
  // d'où `phase` déjà à jour ici).
  const leftAirborne = before === PHASE_AIRBORNE && phase.value === 0
  if (phase.value != null && phase.value !== before && (phase.value > 0 || leftAirborne)) {
    // `blitzUsed` : pendules du timing "Blitz", déjà mises à jour par
    // `advance()` (fin de phase Mouvement, cf. syncMoveTimer, synchrone) —
    // rétablies au rejeu du journal et transmises aux autres joueurs.
    const blitzUsed = isBlitz.value ? { ...blitzUsedMs.value } : undefined
    log('phase', `Phase : ${PHASE_NAMES[phase.value]}`, { phase: phase.value, step: turnInfo.value.step, blitzUsed })
    // Multijoueur : les autres joueurs suivent la phase (cf. applyRemotePhase).
    emit('phase', { phase: phase.value, step: turnInfo.value.step, blitzUsed })
  }
}

/** Multijoueur : un autre joueur a changé de phase (cf. RoomLobby.vue,
 *  évènement `game:phase`). Ignoré s'il vise un autre pas que le pas
 *  courant (message arrivé en retard). Pas de journalisation ici : l'entrée
 *  `phase` arrive par le journal partagé (cf. applyRemoteEntry). */
function applyRemotePhase(newPhase, step, blitzUsed) {
  if (step !== turnTrackerRef.value?.currentStep || newPhase === phase.value) return
  setPhase(newPhase)
  // Pendules "Blitz" : les valeurs du joueur actif font foi (elles
  // remplacent l'estimation que ce navigateur vient de faire lui-même).
  if (blitzUsed) blitzUsedMs.value = { ...blitzUsed }
}

const selectedCounterId = ref(null)

// Entrée en phase Combat : un pion resté sélectionné depuis la phase
// Mouvement est désélectionné — en phase Combat, une unité amie ne se
// sélectionne jamais (cf. onCounterSelect), elle ne peut qu'être désignée
// attaquante.
watch(phase, (newPhase) => {
  if (newPhase === 1) selectedCounterId.value = null
  // Les déplacements de la phase qui s'achève sont acquis : plus rien à
  // annuler (cf. `moveHistory`).
  moveHistory.value = []
  // Tout changement de phase désélectionne un renfort choisi dans le
  // panneau : il n'est peut-être plus plaçable dans la nouvelle phase (cf.
  // lib/useAssisted.js::canPlaceReinforcementNow — un aéroporté choisi en
  // phase Airborne ne se pose plus en Mouvement).
  selectedReinforcementId.value = null
})

// Lancement de la partie : phase de départ du camp actif — Airborne s'il a
// des aéroportés à poser, sinon Mouvement (cf. lib/useAssisted.js::
// startSidePhase). Au montage, et pas plus tôt : TurnTracker.vue (camp
// actif, tour courant) doit déjà être monté.
onMounted(() => {
  initPhase()
  if (props.module.turnTrack) initialTurnEntry = turnEntryOf(turnInfo.value)
  if (props.online) startSharedJournal(props.initialJournal)
  // État de la partie côté serveur — pas, phase, pendules, fin de partie
  // (cf. applyServerState). En solo/démo, les props valent leurs défauts :
  // sans effet, hormis le démarrage des pendules.
  applyServerState({
    turnStep: props.initialTurnStep, phase: props.initialPhase, phaseElapsedMs: props.initialPhaseElapsedMs,
    blitzUsedMs: props.initialBlitzUsedMs, blitzLoser: props.initialBlitzLoser,
  })
  // Partie relancée avec les réglages d'une sauvegarde (cf. DemoPlay.vue) :
  // on rejoue maintenant le journal mis de côté — APRÈS `initPhase`, que le
  // rejeu doit pouvoir corriger. Jamais en ligne (la reprise en attente
  // appartient à une partie locale).
  if (!props.online) journalRef.value?.resumePending()
})

/** En ligne : rejoue d'un coup le journal partagé `list` déjà enregistré par
 *  le serveur (rechargement de la page, reconnexion) pour reconstituer la
 *  partie — positions, éliminations, phase, MP, pendules... Le plateau est
 *  d'abord remis au déploiement (cf. onJournalLoaded), donc tout ce que ce
 *  navigateur aurait de plus que le serveur est abandonné. Partie qui
 *  démarre (journal vide) : propose son déploiement au serveur ; seul le
 *  PREMIER proposé est retenu et appliqué chez tous les joueurs (cf.
 *  RoomLobby.vue::onDeploy), pour que les unités tirées au hasard dans leur
 *  zone de départ soient au même endroit pour tout le monde. */
function startSharedJournal(list) {
  if (list.length) {
    journalRef.value?.loadShared(list)
    fastForwardReplay()
  } else {
    // Déploiement ET tour de départ (cf. `initialTurnEntry`), retenus ou
    // rejetés ensemble par le serveur (premier arrivé).
    const t = new Date().toLocaleTimeString('fr-FR')
    emit('deploy', {
      setup: { uid: newUid(), t, kind: 'setup', text: 'Déploiement initial', data: { positions: initialDeployment } },
      turn: initialTurnEntry ? { uid: newUid(), t, ...initialTurnEntry } : null,
    })
  }
}

// Pions retirés de la carte via "Éliminé" (menu contextuel, cf.
// onCounterContextMenu plus bas) — id -> true. Un pion éliminé n'est ni sur
// la carte (counters) ni dans les renforts tant qu'il n'est pas explicitement
// "replacé" depuis le panneau "Unités éliminées" (EliminatedPanel.vue).
const eliminatedIds = ref(new Set())
const eliminatedCounters = computed(() =>
  allCounters.value.filter((counter) => eliminatedIds.value.has(String(counter.id)))
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
const placedIds = computed(() => new Set(counters.value.map((counter) => String(counter.id))))
const reinforcements = computed(() =>
  allCounters.value.filter((counter) => counter.setup && !placedIds.value.has(String(counter.id)) && !eliminatedIds.value.has(String(counter.id)))
)

// Un onglet de renforts par camp déclaré dans module.sides (ex. {"german":
// ["german"], "allies": ["commonwealth","us","pol"]}) — chacun ne liste que
// les renforts des factions de son camp. Repli sur un onglet unique si le
// module n'a pas encore ce champ. Plus un onglet fixe "Unités éliminées",
// commun à tous les camps (regroupé par nationalité à l'intérieur).
// Libellé de l'onglet d'un camp : "Renfort " + le nom du camp tel que la
// piste de tour l'affiche (`turnTrack.sides[side].label`, ex. "Renfort
// alliés") — la clé brute du camp à défaut.
const sideTabLabel = (side) => {
  const label = props.module.turnTrack?.sides?.[side]?.label
  return `Renfort ${label ? label.toLowerCase() : side}`
}
const sidePanelTabs = computed(() => {
  const sides = props.module.sides
  const base = !sides
    ? [{ key: 'reinforcements', label: 'Renforts' }]
    : Object.keys(sides).map((side) => ({ key: side, label: sideTabLabel(side) }))
  return [...base, { key: 'eliminated', label: 'Unités éliminées' }, { key: 'journal', label: 'Journal' }]
})
function reinforcementsForTab(key) {
  const sides = props.module.sides
  if (!sides) return reinforcements.value
  const factions = sides[key] ?? []
  return reinforcements.value.filter((counter) => factions.includes(counter.faction))
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
  const counterIndex = counters.value.findIndex((counter) => String(counter.id) === String(id))
  if (counterIndex !== -1) counters.value.splice(counterIndex, 1)
  eliminatedIds.value.delete(String(id))
  eliminatedIds.value = new Set(eliminatedIds.value)
  const counter = allCounters.value.find((counter) => String(counter.id) === String(id))
  // cf. lib/useAssisted.js::resetMp — un pion replacé aux renforts doit
  // repartir avec un plein potentiel de MP la prochaine fois qu'il entrera
  // en jeu, pas avec ce qu'il lui restait au moment où il a quitté la carte.
  // cf. lib/useAssisted.js::unspendEntryCost — et s'il avait fait grimper la
  // congestion du hex par lequel il était entré ce tour-ci, cette place est
  // maintenant libre : le prochain à entrer par ce même hex ne doit pas
  // payer pour une entrée qui n'a plus lieu.
  if (counter) {
    resetMp(counter)
    unspendEntryCost(counter)
  }
  log('return', `${counter?.name ?? id} replacé dans les renforts`, { counterId: id })
}
/** Élimine un pion (menu contextuel, ou résultat de combat — cf.
 *  lib/useRetreat.js, qui précise alors pourquoi dans `reason`). */
function eliminateCounter(id, reason) {
  const counterIndex = counters.value.findIndex((counter) => String(counter.id) === String(id))
  if (counterIndex !== -1) counters.value.splice(counterIndex, 1)
  eliminatedIds.value.add(String(id))
  eliminatedIds.value = new Set(eliminatedIds.value)
  const counter = allCounters.value.find((counter) => String(counter.id) === String(id))
  log('eliminate', `${counter?.name ?? id} éliminé${reason ? ` (${reason})` : ''}`, { counterId: id })
}
function onCounterContextMenu(id, ev) {
  // Pendant une retraite (cf. lib/useRetreat.js), retirer ou replacer un
  // pion à la main désynchroniserait la file des retraites : menu désactivé.
  if (inputLocked.value || retreatActive.value) return
  const items = [
    { label: 'Replacer le pion', action: () => returnCounterToReinforcements(id) },
    { label: 'Éliminé', action: () => eliminateCounter(id) },
  ]
  // Phase Mouvement uniquement (ou partie Libre, sans phases : `phase` vaut
  // `null`) — même raison que "Retour arrière" (cf. `moveHistory`) : en phase
  // Combat, l'unité a pu combattre, retraiter ou avancer depuis.
  if (movedThisTurnIds.value.has(String(id)) && (phase.value === null || phase.value === 0)) {
    items.push({ label: 'Annuler le mouvement', action: () => cancelMovement(id) })
  }
  openContextMenu(ev, items)
}
function onEliminatedContextMenu(id, ev) {
  if (inputLocked.value) return
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
const selectedCounter = computed(() => counters.value.find((counter) => counter.id === selectedCounterId.value) ?? null)

/** Hex voisins (0-based col / 1-based row) du pion actuellement sélectionné,
 *  sous forme de clés "col,row" pour un lookup O(1) depuis isAdjacent(). */
const adjacentSet = computed(() => {
  const counter = selectedCounter.value
  if (!counter) return new Set()
  return new Set(
    neighborsOf(counter.col, counter.row).filter((neighbor) => hexOnMap(neighbor.col, neighbor.row)).map((neighbor) => neighbor.col + ',' + neighbor.row)
  )
})
const isAdjacent = (hex) => adjacentSet.value.has(hex.c + ',' + hex.r)

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
  const counter = selectedCounter.value
  if (!counter) return new Set()
  const from = { c: counter.col, r: counter.row }
  const set = new Set()
  for (const key of adjacentSet.value) {
    const [col, row] = key.split(',').map(Number)
    const hexCell = { c: col, r: row }
    if (!canEnterHex(counter, hexCell, from)) continue
    // Règle d'empilement (mouvement normal, cf. lib/useAssisted.js) : un hex
    // déjà occupé par un pion AMI n'est atteignable que si le pion sélectionné
    // pourrait ensuite continuer sa route (MP restants après y être entré) —
    // sinon il resterait "coincé" dessus, ce qui est interdit. On l'exclut
    // donc du surlignage vert pour ne pas laisser croire que ce clic ferait
    // quelque chose.
    if (wouldOverstack(counter, hexCell) && !canLeaveAfterEntering(counter, hexCell, from)) continue
    set.add(key)
  }
  return set
})
const isReachable = (hex) => reachableSet.value.has(hex.c + ',' + hex.r)

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
  reinforcements.value.find((counter) => String(counter.id) === String(selectedReinforcementId.value))
)

// Un hex de BORD DE CARTE : au moins un de ses 6 voisins est hors carte. Les
// `setup` "ref seule" (cf. `entryHexSet` plus bas) sont TOUJOURS des hex de
// bord — cette fonction sert à ne proposer, en repli, QUE d'autres hex de
// bord (cf. `fallbackEntryHexes`), jamais un hex vers l'intérieur de la
// carte : un renfort qui débarque au bord de la zone de jeu reste au bord,
// il ne "saute" pas plus loin à l'intérieur.
function isEdgeHex(hex) {
  return hexOnMap(hex.col, hex.row) && neighborsOf(hex.col, hex.row).some((neighbor) => !hexOnMap(neighbor.col, neighbor.row))
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
function isEntryHexBlocked(reinforcement, hex) {
  const occupants = counters.value.filter(
    (counter) => counter.col === hex.col && counter.row === hex.row && isFighter(counter)
  )
  return occupants.some((counter) => isEnemyOf(reinforcement, counter) || isZocFrozen(counter))
    || entryWouldStack(reinforcement, hex)
}

// Règle d'empilement appliquée à l'ENTRÉE EN JEU (cf.
// lib/useAssisted.js::canLeaveAfterReinforcementEntry) : `hex` est occupé
// par un ami de `r`, et `r`, une fois entré (coût d'entrée payé, sauf
// aéroporté "+adj"), n'aurait plus de quoi en repartir. Toujours faux hors
// mode Assisté.
function entryWouldStack(reinforcement, hex) {
  const entryCell = { c: hex.col, r: hex.row }
  return wouldOverstack(reinforcement, entryCell) && !canLeaveAfterReinforcementEntry(reinforcement, entryCell, !isAirborneEntry(reinforcement))
}

// Atterrissage d'un AÉROPORTÉ (`setup` "+adj", cf. `entryHexSet`) : règle
// "1 unité par hex" — interdit sur tout hex qui contient déjà une unité,
// amie OU ennemie (plus strict que `entryWouldStack`, qui laisse un renfort
// de bord de carte traverser l'hex d'un ami). Marqueurs (DZ...) et pions de
// soutien ne comptent pas. Mode Assisté uniquement : en mode Libre, aucun
// garde-fou.
function airborneLandingBlocked(hex) {
  if (!props.assisted) return false
  return counters.value.some((counter) => counter.col === hex.col && counter.row === hex.row && isFighter(counter))
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
function fallbackEntryHexes(reinforcement, ref) {
  const candidates = neighborsOf(ref.col, ref.row)
    .filter((neighbor) => isEdgeHex(neighbor) && !isEntryHexBlocked(reinforcement, neighbor))
  if (!candidates.length) return []
  const friendlies = counters.value.filter(
    (counter) => isFighter(counter) && !isEnemyOf(reinforcement, counter)
  )
  if (!friendlies.length) return candidates
  const distanceToFriendlies = (hex) => Math.min(...friendlies.map((friendly) => hexDistance(hex, friendly)))
  const scored = candidates.map((candidate) => ({ h: candidate, d: distanceToFriendlies(candidate) }))
  const minD = Math.min(...scored.map((scoredHex) => scoredHex.d))
  return scored.filter((scoredHex) => scoredHex.d === minD).map((scoredHex) => scoredHex.h)
}

// Hex d'entrée valides pour le renfort actuellement sélectionné, selon la
// forme de son `setup` (cf. arnhem.json) :
//  1. "CCRR-CCRR" (plage bord-de-carte, ex. renforts allemands) : toute la
//     plage déclarée (cf. enumerateSetupHexes), sauf les hex où le renfort
//     resterait coincé avec un ami (cf. `entryWouldStack`) ;
//  2. "CCRR+adj" (aéroporté, ex. chaque unité alliée près de sa DZ) : l'hex
//     de référence ET ses 6 voisins, mais en mode Assisté UNIQUEMENT ceux
//     qui ne contiennent AUCUNE unité, amie comme ennemie (règle "1 unité par
//     hex" à l'atterrissage, cf. `airborneLandingBlocked`) — pas de blocage
//     ZOC à ce niveau, l'éventail est déjà large ;
//  3. "CCRR" seule (sans "-" ni "+adj") : UNIQUEMENT cet hex précis — SAUF
//     s'il est bloqué (cf. `isEntryHexBlocked`), auquel cas seuls le(s) hex
//     de repli valide(s) (cf. `fallbackEntryHexes`) sont proposés à la
//     place (jamais les deux à la fois : soit la référence, soit son/ses
//     repli(s), jamais plus d'un choix "normal" en même temps).
const entryHexSet = computed(() => {
  const reinforcement = selectedReinforcement.value
  const parsed = parseSetup(reinforcement?.setup)
  if (!parsed) return new Set()
  const keys = (cells) => new Set(cells.map((hex) => hex.col + ',' + hex.row))
  if (parsed.kind === 'range') return keys(rangeCells(parsed, hexOnMap).filter((hex) => !entryWouldStack(reinforcement, hex)))
  if (parsed.kind === 'adjacent') return keys(landingCells(parsed, hexOnMap).filter((hex) => !airborneLandingBlocked(hex)))
  const { ref } = parsed
  return keys(isEntryHexBlocked(reinforcement, ref) ? fallbackEntryHexes(reinforcement, ref) : [ref])
})
const isEntryHex = (hex) => entryHexSet.value.has(hex.c + ',' + hex.r)

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
const isZocHex = (hex) => zocSet.value.has(hex.c + ',' + hex.r)

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
  entryHexSet, entrySurcharge, wouldOverstack, isZocFrozen, rules.zoc.stopOnEntry,
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
  const markerHexes = new Set(counters.value.filter((counter) => !isUnit(counter)).map((counter) => counter.col + ',' + counter.row))
  const seen = new Map()
  const offsets = new Map()
  for (const counter of counters.value) {
    if (!isUnit(counter)) { offsets.set(counter.id, ZERO_OFFSET); continue }
    const key = counter.col + ',' + counter.row
    const stackBase = markerHexes.has(key) ? 1 : 0
    const stackIndex = seen.get(key) ?? 0
    seen.set(key, stackIndex + 1)
    const idx = stackBase + stackIndex
    offsets.set(counter.id, { dx: -STACK_STEP * idx, dy: -STACK_STEP * idx })
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
  for (const counter of counters.value) {
    if (!isSupport(counter)) continue
    const key = counter.col + ',' + counter.row
    const entry = counts.get(key) ?? { col: counter.col, row: counter.row, count: 0 }
    entry.count += 1
    counts.set(key, entry)
  }
  return [...counts.values()].filter((supportStack) => supportStack.count >= 2).map((supportStack) => {
    const center = hexCenterPx(supportStack.col, supportStack.row)
    return { key: supportStack.col + ',' + supportStack.row, count: supportStack.count, x: center.x + calibration.a * 0.55, y: center.y + calibration.a * 0.5 }
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
  if (inputLocked.value) return
  const counter = counters.value.find((counter) => String(counter.id) === String(id))
  if (!counter) return
  // Résultat de combat en cours d'application (cf. lib/useRetreat.js) :
  //  - retraite : le seul clic utile est sur un hex rouge — le pion posé sur
  //    un tel hex (unité amie de celle qui retraite) recouvre son polygone,
  //    son clic vaut donc clic sur l'hex ;
  //  - avance : un clic sur une unité victorieuse la choisit pour avancer.
  if (retreatActive.value) {
    if (!stepRetreat({ col: counter.col, row: counter.row })) selectAdvancer(counter)
    return
  }
  // Phase Airborne : on ne fait que POSER des aéroportés, aucun pion déjà
  // sur la carte ne se sélectionne ni ne bouge (cf. lib/useAssisted.js,
  // section "Phase Airborne").
  if (phase.value === PHASE_AIRBORNE) return
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
    if (!toggleTarget(counter)) toggleAttacker(counter)
    return
  }
  if (selectedCounterId.value != null && selectedCounterId.value !== id && isAdjacent({ c: counter.col, r: counter.row })) {
    onHex({ c: counter.col, r: counter.row })
    return
  }
  if (lockedFromSelectionIds.value.has(String(id))) return
  if (!canControl(counter)) return
  setSelectedCounter(selectedCounterId.value === id ? null : id)
  selectedReinforcementId.value = null
}

const selectedReinforcementId = ref(null)

function onReinforcementSelect(id) {
  if (inputLocked.value) return
  const counter = reinforcements.value.find((counter) => String(counter.id) === String(id))
  // `canPlaceReinforcementNow` : en phase Airborne, seuls les aéroportés ;
  // dans les autres phases, tout sauf eux (cf. lib/useAssisted.js).
  if (!canControl(counter) || !canEnterThisTurn(counter) || !canPlaceReinforcementNow(counter)) return
  // Désélection du pion en cours AVANT de choisir le renfort : refusée si ce
  // pion est en overstack (cf. setSelectedCounter), et le renfort n'est
  // alors pas sélectionné non plus.
  if (!setSelectedCounter(null)) return
  selectedReinforcementId.value = selectedReinforcementId.value === id ? null : id
}

// --- Empilement (stacking) au mouvement normal -----------------------------
// Une unité ne peut jamais TERMINER sa phase de Mouvement sur un hex occupé
// par une unité AMIE (deux amies ne peuvent pas y rester ensemble à la fin
// du tour) — cf. lib/useAssisted.js::wouldOverstack/
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
 *     `wouldOverstack`/`canLeaveAfterEntering` ci-dessus) -> il s'y
 *     déplace (et reste sélectionné, pour enchaîner sur d'autres hex tant
 *     qu'il lui reste des MP) ;
 *  3. sinon, le clic ne fait rien (pas de pion/renfort concerné par cet hex).
 *  Aucune action pendant un rejeu en cours (cf. `replayLocked`) — seul le
 *  lecteur (stepReplay/fastForwardReplay) fait bouger la carte tant que le
 *  journal chargé n'est pas entièrement joué. */
const onHex = (hex) => {
  if (inputLocked.value) return
  // Résultat de combat en cours d'application (cf. lib/useRetreat.js) :
  // seul un clic sur un hex rouge (retraite) ou vert vif (avance) fait
  // quelque chose ; tout le reste est ignoré jusqu'à la fin.
  if (retreatActive.value) {
    const position = { col: hex.c, row: hex.r }
    if (!stepRetreat(position)) stepAdvance(position)
    return
  }
  // Clic sur un hex cible pendant un combat : le retire des cibles (et
  // annule le combat si c'était le dernier, cf. lib/useCombat.js) — pendant
  // de la même règle dans onCounterSelect, pour le cas où c'est le POLYGONE
  // de l'hex qui reçoit le clic plutôt que le pion posé dessus.
  if (isCombatTargetHex(hex)) { removeTargetHex(hex.c, hex.r); return }
  if (selectedReinforcementId.value != null) {
    if (isEntryHex(hex)) {
      const reinforcement = selectedReinforcement.value
      if (reinforcement && canEnterThisTurn(reinforcement)) {
        const placed = { ...reinforcement, col: hex.c, row: hex.r }
        counters.value.push(placed)
        // "+adj" (aéroporté) n'est jamais un hex de bord de carte au sens de
        // cette règle — cf. lib/useAssisted.js::spendEntryCost, qui ne fait
        // rien hors mode Assisté de toute façon.
        const paysEntry = !isAirborneEntry(reinforcement)
        const paid = paysEntry ? spendEntryCost(placed, hex) : null
        // Règle particulière du module sur l'arrivée (cf.
        // lib/useArnhem.js::airborneArrivalSpentMp — un aéroporté largué
        // compte 4 MP déjà dépensés, soit 3 MP pour ce tour-ci). Inscrit
        // AVANT le `log` ci-dessous, qui journalise les MP du pion (cf.
        // `mpText`/`spentMpOf`) : la ligne du journal doit montrer, et le
        // rejeu rétablir, l'état d'APRÈS application de la règle.
        moduleRules.noteAirborneArrival(placed)
        const arrivalMp = moduleRules.airborneArrivalSpentMp(placed)
        if (arrivalMp !== null) setSpentMp(placed.id, arrivalMp)
        emit('move', { counterId: placed.id, col: hex.c, row: hex.r })
        // Hex d'entrée CONGESTIONNÉ (au moins une autre entrée par ce même hex
        // ce tour-ci, cf. lib/useAssisted.js::entryCost) : le journal le
        // signale, avec le coût majoré réellement payé.
        const congestion = paid && paid.cost > paid.baseCost
          ? ` — hex d'entrée déjà utilisé (${paid.rank}e entrée ce tour) : coût ×${paid.rank} = ${paid.cost} MP au lieu de ${paid.baseCost}`
          : ''
        // `entry` : il a payé un coût d'entrée — au rejeu, on le repaie pour
        // rétablir aussi la CONGESTION de cet hex (cf. applyReplayEntry, qui
        // recalcule le coût lui-même : `entryRank`/`entryCost` ne sont là que
        // pour information).
        log('place', `${reinforcement.name} entre en jeu en ${hexId(hex.c + 1, hex.r)}${mpText(placed)}${congestion}`,
          { counterId: placed.id, col: hex.c, row: hex.r, mp: spentMpOf(placed), entry: paysEntry,
            entryRank: paid?.rank ?? null, entryCost: paid?.cost ?? null })
        // Sélectionné automatiquement après son entrée en jeu, pour pouvoir
        // enchaîner tout de suite sur son mouvement (cf. onHex, branche
        // mouvement normal) sans avoir à recliquer dessus — comme un pion
        // déjà sur la carte qui vient de se déplacer (cf. `setSelectedCounter`,
        // qui gère aussi le verrouillage d'un éventuel pion PRÉCÉDEMMENT
        // sélectionné ayant déjà bougé, cf. section "Verrouillage" plus haut).
        // SAUF en phase Airborne : on n'y déplace aucune unité, l'aéroporté
        // posé reste donc désélectionné (cf. lib/useAssisted.js).
        if (phase.value !== PHASE_AIRBORNE) setSelectedCounter(placed.id)
      }
      selectedReinforcementId.value = null
    }
    return
  }
  if (selectedCounterId.value != null && isAdjacent(hex)) {
    const counter = counters.value.find((counter) => counter.id === selectedCounterId.value)
    // Position de départ capturée AVANT tout déplacement — sert à la fois à
    // l'historique (from ci-dessous) et de paramètre "from" pour
    // canEnterHex/spendMp (cf. useAssisted.js::terrainCost, règle
    // route/piste : le coût dépend de d'où on VIENT, pas seulement de l'hex
    // d'arrivée).
    const from = counter ? { col: counter.col, row: counter.row } : null
    const fromHex = counter ? { c: from.col, r: from.row } : null
    // Empilement : `h` est occupé par un ami ET `c` ne pourrait plus repartir
    // ensuite -> comme si l'hex n'était pas une destination valide (cf.
    // `wouldOverstack`/`canLeaveAfterEntering` plus haut) — une unité ne
    // peut jamais TERMINER sa phase de Mouvement sur un hex ami.
    const stackingBlocked = counter && wouldOverstack(counter, hex) && !canLeaveAfterEntering(counter, hex, fromHex)
    // Pas assez de MP pour entrer dans cet hex (cf. useAssisted.js) : le
    // pion reste sélectionné et sur place, comme si l'hex n'était pas une
    // destination valide — libre à l'utilisateur d'essayer un autre hex
    // adjacent moins coûteux.
    if (counter && !stackingBlocked && canEnterHex(counter, hex, fromHex)) {
      counter.col = hex.c; counter.row = hex.r
      spendMp(counter, hex, fromHex)
      emit('move', { counterId: counter.id, col: counter.col, row: counter.row })
      const journalId = log('move', `${counter.name} se déplace vers ${hexId(hex.c + 1, hex.r)}${mpText(counter)}`,
        { counterId: counter.id, col: counter.col, row: counter.row, mp: spentMpOf(counter) })
      pushMoveHistory(counter.id, from, { col: counter.col, row: counter.row }, journalId)
      markMoved(counter.id, from)
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
  if (inputLocked.value) { ev?.preventDefault(); return }
  const onMap = counters.value.find((counter) => String(counter.id) === String(id))
  const counter = onMap
    ?? supportTrackerRef.value?.findToken(id)
    ?? allCounters.value.find((counter) => String(counter.id) === String(id))
  // Les pions de soutien (kind: 'support', cf. SupportTracker.vue) sont une
  // ressource commune, pas rattachée à un camp — toujours glissables, que ce
  // soit depuis la tablette ou déjà posés sur la carte, sans passer par
  // canControl (ni par le tour actif).
  if (!isSupport(counter) && !canControl(counter)) { ev?.preventDefault(); return }
  // cf. lib/useAssisted.js::draggable — en mode Assisté, une UNITÉ (pion déjà
  // sur la carte ou renfort pas encore posé) ne se glisse plus du tout : elle
  // ne peut entrer en jeu ou se déplacer que par clic (sélection, puis clic
  // sur l'hex de destination — cf. onHex/onCounterSelect/onReinforcementSelect
  // plus haut). Les pions de soutien restent exemptés, comme pour canControl
  // ci-dessus : ce ne sont pas des "unités" soumises aux règles de tour/camp.
  if (!isSupport(counter) && !draggable.value) { ev?.preventDefault(); return }
  // Un renfort pas encore posé sur la carte ne peut être glissé qu'à partir
  // de son tour d'arrivée (cf. `canEnterThisTurn`) — un pion déjà sur la
  // carte (mouvement) ou un pion de soutien (tablette) n'est pas concerné.
  if (!onMap && !isSupport(counter) && !canEnterThisTurn(counter)) { ev?.preventDefault(); return }
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
  const counter = counters.value.find((counter) => String(counter.id) === String(id))
  // Un simple clic (mousedown puis mouseup sans déplacement réel, cf.
  // Counter.vue::onClick pour la sélection) retombe ici aussi — on n'émet
  // `move` que si la case a réellement changé, pour ne pas spammer le réseau
  // à chaque clic de sélection en partie multijoueur.
  if (counter && (counter.col !== hex.col || counter.row !== hex.row)) {
    const fromLabel = hexId(counter.col + 1, counter.row)
    const from = { col: counter.col, row: counter.row }
    counter.col = hex.col; counter.row = hex.row
    emit('move', { counterId: counter.id, col: counter.col, row: counter.row })
    const journalId = log(isSupport(counter) ? 'support' : 'move', `${counter.name} déplacé de ${fromLabel} vers ${hexId(counter.col + 1, counter.row)}`, { counterId: counter.id, col: counter.col, row: counter.row })
    pushMoveHistory(counter.id, from, { col: counter.col, row: counter.row }, journalId)
    if (!isSupport(counter)) markMoved(counter.id, from)
  }
}

onUnmounted(() => {
  window.removeEventListener('mousemove', onCounterDragMove)
  window.removeEventListener('mouseup', onCounterDragEnd)
})

/** Convertit un point en coordonnées SVG vers l'hex logique le plus proche —
 *  cherche dans une fenêtre de 3×3 hex autour de l'estimation initiale (la
 *  grille hexagonale n'a pas de correspondance x/y → col/row directe). */
function pixelToHex(svgX, svgY) {
  const { x0, y0, colStep, rowStep } = calibration
  const c0 = Math.round((svgX - x0) / colStep)
  let best = null, dmin = Infinity
  for (let col = c0 - 1; col <= c0 + 1; col++) {
    if (col < 0 || col >= mapConfig.cols) continue
    const yoff = col % 2 === 1 ? rowStep / 2 : 0
    const r0 = Math.round((svgY - y0 - yoff) / rowStep) + 1
    for (let row = r0 - 1; row <= r0 + 1; row++) {
      if (!hexOnMap(col, row)) continue
      const cx = x0 + col * colStep
      const cy = y0 + (row - 1) * rowStep + yoff
      const distance = Math.hypot(cx - svgX, cy - svgY)
      if (distance < dmin) { dmin = distance; best = { col: col, row: row } }
    }
  }
  return best
}

function onMapDrop(ev) {
  if (inputLocked.value) return
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
    const reinforcement = allCounters.value.find((counter) => String(counter.id) === String(draggedCounterId.value))
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
  const counter = counters.value.find((counter) => String(counter.id) === String(counterId))
  if (counter) {
    const from = { col: counter.col, row: counter.row }
    counter.col = col; counter.row = row
    if (!isSupport(counter) && (from.col !== col || from.row !== row)) markMoved(counter.id, from)
    return
  }
  // Un autre joueur a posé un renfort pas encore présent localement (glissé
  // depuis son propre panneau "Renfort alliés") : on l'ajoute.
  const reinforcement = allCounters.value.find((counter) => String(counter.id) === String(counterId))
  if (reinforcement) counters.value.push({ ...reinforcement, col, row })
}

/** Multijoueur : un camp a perdu au temps (cf. RoomLobby.vue, `game:over`). */
function applyRemoteGameOver(loser) {
  declareBlitzLoss(loser, { remote: true })
}

/** En ligne : entrée du journal partagé reçue d'un autre joueur (ou du
 *  serveur). Ajoutée au journal (sauf doublon, cf. `uid`) PUIS appliquée à
 *  la carte comme au rejeu — c'est ce qui synchronise ce que les seuls
 *  évènements `move`/`turn`/`phase` ne transmettent pas (éliminations,
 *  retours aux renforts, unités ayant combattu, MP dépensés, déploiement). */
function applyRemoteEntry(entry) {
  if (!entry || !journalRef.value?.appendRemote(entry)) return
  applyReplayEntry(entry)
}

/** En ligne : entrée retirée par un autre joueur (retour arrière). */
function removeRemoteEntry(uid) {
  journalRef.value?.removeByUid(uid)
}

/** Aligne pas courant, phase, pendules et fin de partie sur l'état du
 *  serveur (`toPublic`, cf. server/src/rooms.js) — au montage (props) comme
 *  après une reconnexion (cf. resyncFromServer). */
function applyServerState({ turnStep, phase: serverPhase, phaseElapsedMs, blitzUsedMs: serverBlitz, blitzLoser: serverLoser }) {
  if (turnTrackerRef.value && turnStep != null && turnTrackerRef.value.currentStep !== turnStep) applyRemoteTurn(turnStep)
  // Phase déjà atteinte par le joueur actif (cf. server/src/rooms.js::
  // recordPhase) — `null` : phase de départ du camp, déjà recalculée.
  if (serverPhase != null) setPhase(serverPhase)
  // Compteurs des timings "Limité"/"Blitz" repris là où ils en étaient (le
  // temps écoulé depuis le chargement n'est pas décompté deux fois).
  moveTimerStartedAt.value = null
  syncMoveTimer(phaseElapsedMs ?? 0)
  blitzUsedMs.value = { ...(serverBlitz ?? {}) }
  if (serverLoser) declareBlitzLoss(serverLoser, { remote: true })
}

/** En ligne, après une RECONNEXION : le serveur fait foi. Le journal partagé
 *  complet est rejoué depuis le déploiement (cf. startSharedJournal), ce qui
 *  rattrape à la fois les entrées manquées pendant la coupure ET celles que
 *  l'adversaire a retirées entre-temps (retour arrière) — un simple ajout des
 *  entrées manquantes laissait ces dernières dans le journal local. Ce que ce
 *  navigateur a pu jouer HORS LIGNE n'a jamais atteint le serveur : c'est
 *  abandonné, pour rester aligné sur les autres joueurs. `room` : l'état
 *  courant renvoyé par le serveur (pas, phase, pendules, fin de partie). */
function resyncFromServer(list, room) {
  startSharedJournal(list ?? [])
  applyServerState(room ?? {})
}

defineExpose({ applyRemoteMove, applyRemoteTurn, applyRemotePhase, applyRemoteGameOver, applyRemoteEntry, removeRemoteEntry, resyncFromServer })

/** Reçoit le journal chargé (cf. JournalPanel.vue, évènement `loaded`) en
 *  ordre chronologique et remet la carte au déploiement initial pour
 *  rejouer depuis la première ligne. */
function onJournalLoaded(list) {
  // Le journal chargé porte son propre déploiement (ou n'en a pas, s'il est
  // antérieur à cet ajout) : celui de la partie ouverte ne doit plus être
  // ajouté par-dessus.
  deploymentLogged = true
  replayEntries.value = list
  replayIndex.value = 0
  resetBoardForReplay()
}

function resetBoardForReplay() {
  isReplaying.value = true
  // Pendules "Blitz" à zéro et partie en cours : rétablies par les entrées
  // `phase` et `gameover` rejouées.
  blitzUsedMs.value = {}
  blitzLoser.value = null
  counters.value = buildInitialCounters()
  eliminatedIds.value = new Set()
  selectedCounterId.value = null
  selectedReinforcementId.value = null
  moveHistory.value = []
  clearAllMoved()
  clearRetreat()
  // Un combat resté ouvert n'a plus de sens sur un plateau remis à zéro.
  cancelCombat()
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
  const entryData = entry.data
  if (!entryData) return
  if (entry.kind === 'setup') {
    // Déploiement initial (cf. `logDeploymentOnce`) : on remet chaque pion
    // de départ exactement où il était, à la place du nouveau tirage fait
    // par resetBoardForReplay.
    for (const position of entryData.positions ?? []) {
      const counter = counters.value.find((counter) => String(counter.id) === String(position.id))
      if (counter) { counter.col = position.col; counter.row = position.row }
    }
  } else if (entry.kind === 'move' || entry.kind === 'place') {
    applyRemoteMove(entryData.counterId, entryData.col, entryData.row)
    // Journal enregistré AVANT l'ajout de la phase Airborne (pas d'entrée
    // `phase` Airborne -> Mouvement) : un déplacement prouve qu'on était en
    // Mouvement.
    if (entry.kind === 'move' && phase.value === PHASE_AIRBORNE) setPhase(0)
    if (entry.kind === 'move') {
      const key = String(entryData.counterId)
      const start = turnStartPositions.get(key)
      if (start && start.col === entryData.col && start.row === entryData.row) {
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
    if (entry.kind === 'place' && entryData.entry) {
      const placed = counters.value.find((counter) => String(counter.id) === String(entryData.counterId))
      if (placed) spendEntryCost(placed, { c: entryData.col, r: entryData.row })
    }
    if (entry.kind === 'place') {
      // Mémoire "a atterri ce tour-ci" des règles du module (cf.
      // lib/useArnhem.js::noteAirborneArrival) : à rétablir, sinon un
      // "Annuler le mouvement" fait APRÈS le rejeu rendrait à l'aéroporté
      // son allocation pleine. Les MP dépensés, eux, ne sont PAS recalculés
      // ici : c'est la valeur du journal, juste en dessous, qui fait foi.
      const placed = counters.value.find((counter) => String(counter.id) === String(entryData.counterId))
      if (placed) moduleRules.noteAirborneArrival(placed)
    }
    // Après `spendEntryCost` : la valeur du journal fait foi (elle inclut
    // déjà le coût d'entrée payé à l'époque).
    setSpentMp(entryData.counterId, entryData.mp)
  } else if (entry.kind === 'retreat' || entry.kind === 'advance') {
    // Un pas de retraite ou d'avance après combat (cf. lib/useRetreat.js) :
    // simple changement de position — ni liseré "a bougé", ni MP (cf.
    // `moveUnit`/`advanceUnit` dans l'appel à useRetreat plus haut).
    const counter = counters.value.find((counter) => String(counter.id) === String(entryData.counterId))
    if (counter) { counter.col = entryData.col; counter.row = entryData.row }
    // Artillerie refoulée par une retraite amie : plus de tir pendant cette
    // phase de Combat.
    if (entryData.noFire) markNoFire(entryData.counterId)
  } else if (entry.kind === 'phase') {
    setPhase(entryData.phase)
    if (entryData.blitzUsed) blitzUsedMs.value = { ...entryData.blitzUsed }
  } else if (entry.kind === 'gameover') {
    blitzLoser.value = entryData.loser ?? null
  } else if (entry.kind === 'combat') {
    markFought([...(entryData.attackerIds ?? []), ...(entryData.defenderIds ?? [])])
  } else if (entry.kind === 'support') {
    if (counters.value.some((counter) => String(counter.id) === String(entryData.counterId))) {
      applyRemoteMove(entryData.counterId, entryData.col, entryData.row)
    } else if (entryData.counter) {
      counters.value.push({ ...entryData.counter, col: entryData.col, row: entryData.row })
    }
  } else if (entry.kind === 'eliminate') {
    const counterIndex = counters.value.findIndex((counter) => String(counter.id) === String(entryData.counterId))
    if (counterIndex !== -1) counters.value.splice(counterIndex, 1)
    eliminatedIds.value.add(String(entryData.counterId))
    eliminatedIds.value = new Set(eliminatedIds.value)
  } else if (entry.kind === 'return') {
    const counterIndex = counters.value.findIndex((counter) => String(counter.id) === String(entryData.counterId))
    if (counterIndex !== -1) counters.value.splice(counterIndex, 1)
    eliminatedIds.value.delete(String(entryData.counterId))
    eliminatedIds.value = new Set(eliminatedIds.value)
  } else if (entry.kind === 'turn') {
    turnTrackerRef.value?.applyRemoteTurn(entryData.step)
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
// Timing "Blitz" : camp dont la pendule est tombée à 0 — il a PERDU la
// partie (cf. declareBlitzLoss), `null` tant que la partie continue.
const blitzLoser = ref(null)
// La PARTIE est figée pendant un rejeu et une fois terminée : plus aucune
// action de jeu, et les pendules du timing s'arrêtent (cf. moveTimerRunning).
const actionsLocked = computed(() => replayLocked.value || blitzLoser.value != null)
// La SAISIE de ce navigateur est bloquée dans ces mêmes cas, PLUS, en ligne,
// tant que ce n'est pas à son joueur de jouer (cf. `isLocalTurn`) : il ne
// peut alors ni sélectionner, ni déplacer, ni éliminer, ni replacer un pion,
// quel qu'en soit le camp — ni faire avancer tour ou phase. C'est la garde
// de TOUTES les entrées utilisateur (clics, glisser-déposer, menus, boutons,
// dé). Distincte de `actionsLocked` : chez le joueur qui attend, la partie
// continue (pendule de l'adversaire, synchro), seule sa saisie est fermée.
// Le serveur applique la même règle de son côté (cf. server/src/rooms.js::
// isPlayersTurn) : ce verrou-ci n'est que le confort de l'interface.
const inputLocked = computed(() => actionsLocked.value || (props.online && !isLocalTurn.value))

// --- Timings "Limité" et "Blitz" (cf. lib/gameSettings.js, MoveTimer.vue).
// Toutes les phases sont conservées : SEULE la phase Mouvement (phase 0) est
// chronométrée — ni Airborne, ni Combat, ni Fin de tour. Sans phases (mode
// Libre, `phase === null`), il n'y a pas de phase Mouvement : pas de
// compteur. Jamais pendant un rejeu de journal.
//  - Limité : la durée saisie (minutes) vaut pour CHAQUE phase de Mouvement,
//    le compteur repart à plein à chaque fois.
//  - Blitz (pendule d'échecs) : la durée saisie est le temps TOTAL de chaque
//    camp pour toutes ses phases de Mouvement. Le temps passé dans chacune
//    s'additionne dans `blitzUsedMs` ; la pendule d'un camp démarre au début
//    de sa phase de Mouvement et s'arrête dès le changement de phase.
const timingMode = computed(() => props.settings?.timing)
const moveTimerSeconds = computed(() =>
  timingMode.value === 'limite' || timingMode.value === 'blitz' ? (Number(props.settings.timingValue) || 0) * 60 : 0)
const isBlitz = computed(() => timingMode.value === 'blitz' && moveTimerSeconds.value > 0)
const moveTimerRunning = computed(() =>
  moveTimerSeconds.value > 0 && !actionsLocked.value && phase.value === 0)
const turnOrder = props.module.turnTrack?.order ?? []
// Camp actif lu directement sur TurnTracker.vue : `turnInfo` n'est mis à
// jour qu'en différé (évènement `change`), trop tard pour syncMoveTimer.
function currentSideKey() {
  const step = turnTrackerRef.value?.currentStep ?? props.initialTurnStep
  return turnOrder.length ? turnOrder[step % turnOrder.length] : null
}
// Heure de début de la phase de Mouvement en cours (ms) et camp dont la
// pendule tourne ; `null` hors de cette phase.
const moveTimerStartedAt = ref(null)
const moveTimerSide = ref(null)
// Blitz : temps de Mouvement déjà consommé par camp, `{ [campKey]: ms }`.
const blitzUsedMs = ref({})
/** Arrête le compteur en cours (en ajoutant, en Blitz, le temps passé à la
 *  pendule de son camp) puis le relance si une phase de Mouvement est en
 *  cours. `elapsedMs` : temps déjà écoulé dans cette phase (reprise en
 *  ligne, cf. onMounted). */
function syncMoveTimer(elapsedMs = 0) {
  const now = Date.now()
  const side = moveTimerSide.value
  if (moveTimerStartedAt.value != null && side != null) {
    blitzUsedMs.value = { ...blitzUsedMs.value, [side]: (blitzUsedMs.value[side] ?? 0) + (now - moveTimerStartedAt.value) }
  }
  moveTimerStartedAt.value = moveTimerRunning.value ? now - elapsedMs : null
  moveTimerSide.value = moveTimerRunning.value ? currentSideKey() : null
}
// Synchrone : la pendule doit être à jour dès le retour de `advance()` (cf.
// onPhaseNext, qui l'envoie aussitôt aux autres joueurs).
watch([moveTimerRunning, () => turnTrackerRef.value?.currentStep], () => syncMoveTimer(), { flush: 'sync' })
const showTimeUp = ref(false)
const showGameOver = ref(false)
const sideLabel = (side) => props.module.turnTrack?.sides?.[side]?.label ?? side
/** Compteur à zéro (cf. MoveTimer.vue, `expired`). Blitz : le camp `side`
 *  PERD la partie. Limité : simple alerte, au joueur actif uniquement (en
 *  ligne, chaque navigateur a son compteur, mais seul celui dont c'est le
 *  tour est prévenu). */
function onMoveTimeUp(side) {
  if (isBlitz.value) declareBlitzLoss(side)
  else if (isLocalTurn.value) showTimeUp.value = true
}
/** Blitz : fin de partie, `loser` a perdu au temps. La modale de fin
 *  s'affiche chez TOUS les joueurs.
 *  - En local : inscrite au journal.
 *  - En ligne : chaque navigateur détecte la chute de la pendule et
 *    l'annonce au serveur ; seule la PREMIÈRE annonce compte, le serveur
 *    l'inscrit lui-même au journal partagé et la renvoie à tous (`remote` :
 *    annonce du serveur, qui fait foi et peut corriger une détection
 *    locale). */
function declareBlitzLoss(loser, { remote = false } = {}) {
  if (!loser || blitzLoser.value === loser) return
  if (blitzLoser.value != null && !remote) return
  blitzLoser.value = loser
  const text = `Temps écoulé — ${sideLabel(loser)} perd la partie`
  if (!remote) {
    if (props.online) emit('game-over', { loser, text, t: new Date().toLocaleTimeString('fr-FR') })
    else log('gameover', text, { loser })
  }
  showGameOver.value = true
}
// Le joueur suivant ne doit pas hériter de la modale du précédent.
watch(() => turnInfo.value.step, () => { showTimeUp.value = false })

function zoomIn() {
  zoom.value = Math.min(2, +(zoom.value + 0.05).toFixed(2))
}
function zoomOut() {
  zoom.value = Math.max(0.1, +(zoom.value - 0.05).toFixed(2))
}

/** Zoom à la molette (Ctrl/pas de modificateur — sur toute la zone carte). */
function onMapWheel(event) {
  const step = 0.05
  const delta = event.deltaY < 0 ? step : -step
  zoom.value = Math.min(2, Math.max(0.1, +(zoom.value + delta).toFixed(2)))
}

// --- Drag-to-scroll (pan) au clic droit maintenu ---
const mapWrapRef = ref(null)
const mapDrag = ref(null) // { startX, startY, scrollLeft, scrollTop }

function onMapDragStart(event) {
  const el = mapWrapRef.value
  if (!el) return
  // Un clic droit sur un pion ouvre son menu contextuel (cf. Counter.vue) —
  // ne pas démarrer un pan ici, sinon le preventDefault() ci-dessous
  // supprime l'événement contextmenu natif avant qu'il puisse se déclencher.
  if (event.target.closest('.counter')) return
  event.preventDefault()
  mapDrag.value = { startX: event.clientX, startY: event.clientY, scrollLeft: el.scrollLeft, scrollTop: el.scrollTop }
}
function onMapDragMove(event) {
  if (!mapDrag.value) return
  const el = mapWrapRef.value
  if (!el) return
  el.scrollLeft = mapDrag.value.scrollLeft - (event.clientX - mapDrag.value.startX)
  el.scrollTop = mapDrag.value.scrollTop - (event.clientY - mapDrag.value.startY)
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
          :initial-step="initialTurnStep" :disabled="inputLocked" :phase="phase" :phase-index="phaseIndex" :phase-labels="phaseLabels" :next-label="nextLabel"
          @turn="onTurnAdvance" @change="onTurnChange" @phase-next="onPhaseNext" />

        <!-- cf. MoveTimer.vue — Blitz : une pendule par camp, toujours
             visible ; Limité : un seul compteur, en phase Mouvement. -->
        <div v-if="moveTimerSeconds > 0" class="move-timers">
          <template v-if="isBlitz">
            <MoveTimer v-for="side in turnOrder" :key="side" :duration-seconds="moveTimerSeconds"
              :started-at="moveTimerSide === side ? moveTimerStartedAt : null" :used-ms="blitzUsedMs[side] ?? 0"
              :label="sideLabel(side)" always-visible @expired="onMoveTimeUp(side)" />
            <span v-if="blitzLoser" class="game-over-tag">Partie terminée — {{ sideLabel(blitzLoser) }} perd au temps</span>
          </template>
          <MoveTimer v-else :duration-seconds="moveTimerSeconds" :started-at="moveTimerStartedAt"
            @expired="onMoveTimeUp" />
        </div>

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
        <button v-if="assisted" type="button" class="toggle-btn" :disabled="!moveHistory.length || inputLocked || phase !== 0"
          @click="undoLastMove">
          ↩ Retour arrière
        </button>
        <button v-if="!assisted" type="button" class="toggle-btn" :class="{ active: !showRollModal }"
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
          <polygon v-for="hex in hexes" :key="hex.id" class="hex"
            :class="{ adjacent: debug ? isInRange(hex) : isReachable(hex), entry: isEntryHex(hex) }"
            :points="hex.pts" :stroke="gridStyle.stroke" :stroke-width="gridStyle.width"
            :stroke-opacity="gridStyle.opacity" vector-effect="non-scaling-stroke" @click="onHex(hex)" />
        </g>

        <!-- cf. lib/useAssisted.js::enemyZocSet — hex sous Zone de Contrôle
             (ZOC) ennemie du pion sélectionné : y entrer force l'arrêt du
             mouvement ce tour-ci (cf. canEnterHex, même règle, qui
             s'applique quel que soit cet affichage). Affiché UNIQUEMENT en
             mode debug (cf. HexMap.vue::zocSet) — la règle reste active en
             mode Assisté normal, seul ce surlignage est réservé au debug. -->
        <g v-if="debug">
          <polygon v-for="hex in hexes.filter((hex) => isZocHex(hex))" :key="'zoc' + hex.id" class="hex-zoc"
            :points="hex.pts" vector-effect="non-scaling-stroke" />
        </g>

        <!-- cf. lib/useCombat.js — combat en cours : hex CIBLES en orange
             (cliquables pour les retirer, cf. onHex — ce groupe est rendu
             indépendamment de `showGrid`, qui ne doit pas conditionner
             l'affichage ni l'annulation d'un combat) et hex des ATTAQUANTS
             désignés en jaune (non cliquables : c'est le pion posé dessus
             qui reçoit le clic, cf. onCounterSelect). -->
        <g v-if="combatActive">
          <polygon v-for="hex in hexes.filter((hex) => isCombatAttackerHex(hex))" :key="'atk' + hex.id" class="hex-attacker"
            :points="hex.pts" vector-effect="non-scaling-stroke" />
          <polygon v-for="hex in hexes.filter((hex) => isCombatTargetHex(hex))" :key="'def' + hex.id" class="hex-defender"
            :points="hex.pts" vector-effect="non-scaling-stroke" @click="onHex(hex)" />
        </g>

        <!-- cf. lib/useRetreat.js — avance après combat : chemin de retraite
             (POR) en vert, hex des unités qui peuvent avancer (contour vert),
             hex où l'unité choisie peut avancer (vert vif, cliquables). Rendu
             AVANT le groupe de retraite, dont le rouge doit rester dessus. -->
        <g v-if="retreatActive">
          <polygon v-for="hex in hexes.filter((hex) => isPorHex(hex))" :key="'por' + hex.id" class="hex-por"
            :points="hex.pts" vector-effect="non-scaling-stroke" />
          <polygon v-for="hex in hexes.filter((hex) => isAdvancerHex(hex))" :key="'adu' + hex.id" class="hex-advancer"
            :points="hex.pts" vector-effect="non-scaling-stroke" />
          <polygon v-for="hex in hexes.filter((hex) => isAdvanceHex(hex))" :key="'adv' + hex.id" class="hex-advance"
            :points="hex.pts" vector-effect="non-scaling-stroke" @click="onHex(hex)" />
        </g>

        <!-- cf. lib/useRetreat.js — retraite en cours : hex de l'unité qui
             retraite (contour rouge pointillé) et hex où elle peut aller
             (en ROUGE, cliquables). Rendu après le groupe du combat pour
             passer au-dessus de ses surlignages. -->
        <g v-if="retreatActive">
          <polygon v-for="hex in hexes.filter((hex) => isRetreatingHex(hex))" :key="'rtu' + hex.id" class="hex-retreating"
            :points="hex.pts" vector-effect="non-scaling-stroke" />
          <polygon v-for="hex in hexes.filter((hex) => isRetreatHex(hex))" :key="'rt' + hex.id" class="hex-retreat"
            :points="hex.pts" vector-effect="non-scaling-stroke" @click="onHex(hex)" />
        </g>

        <g v-if="showLabels">
          <text v-for="hex in hexes" :key="'t' + hex.id" class="coordtxt" :x="hex.cx" :y="hex.cy + calibration.a * 0.18"
            text-anchor="middle" :font-size="calibration.a * 0.42">{{ hex.id }}</text>
        </g>

        <!-- cf. lib/useDebug.js — coût de terrain (COT) des hex adjacents au
             pion sélectionné, uniquement quand la case "debug" est cochée. -->
        <g v-if="debug">
          <text v-for="label in adjacentCotLabels" :key="'cot' + label.id" class="debug-cot" :x="label.cx" :y="label.cy"
            text-anchor="middle" :font-size="calibration.a * 0.55">{{ label.cot }}</text>
        </g>

        <!-- cf. lib/useAssisted.js::entrySurcharge — surcoût de congestion
             déjà accumulé sur les hex d'entrée de renfort surlignés, visible
             uniquement en mode debug. -->
        <g v-if="debug">
          <text v-for="label in entrySurchargeLabels" :key="'entrysur' + label.id" class="debug-entry-surcharge"
            :x="label.cx" :y="label.cy - calibration.a * 0.4" text-anchor="middle" :font-size="calibration.a * 0.4">+{{ label.surcharge }}</text>
        </g>

        <g v-if="showCounters" class="counters">
          <!-- Marqueurs (DZ...) rendus en premier : toujours sous les unités
               dans l'ordre de peinture SVG, quel que soit le hex. -->
          <Counter v-for="counter in counters.filter((counter) => !isUnit(counter))" :key="counter.id" :id="counter.id" :src="counter.src" :col="counter.col"
            :row="counter.row" :calibration="calibration" :selected="selectedCounterId === counter.id" :selectable="false"
            :offset="stackOffsets.get(counter.id) ?? ZERO_OFFSET" :drag-px="draggedCounterId === counter.id ? dragCurrentPx : null"
            @dragstart="onCounterDragStart" />
          <Counter v-for="counter in counters.filter(isUnit)" :key="counter.id" :id="counter.id" :src="counter.src" :col="counter.col"
            :row="counter.row" :calibration="calibration" :selected="selectedCounterId === counter.id" :selectable="selectable"
            :moved="movedThisTurnIds.has(String(counter.id))" :spent="hasFought(counter)"
            :offset="stackOffsets.get(counter.id) ?? ZERO_OFFSET" :drag-px="draggedCounterId === counter.id ? dragCurrentPx : null"
            @select="onCounterSelect" @dragstart="onCounterDragStart" @contextmenu="onCounterContextMenu" />
        </g>

        <g v-if="showCounters" class="support-badges">
          <circle v-for="badge in supportStackBadges" :key="badge.key" :cx="badge.x" :cy="badge.y" :r="calibration.a * 0.26"
            class="support-badge-bg" />
          <text v-for="badge in supportStackBadges" :key="'t' + badge.key" :x="badge.x" :y="badge.y + calibration.a * 0.1"
            class="support-badge-text" text-anchor="middle" :font-size="calibration.a * 0.34">{{ badge.count }}</text>
        </g>
      </svg>
    </main>

    <CalibrationPanel v-if="showCalib" :calibration="calibration" :grid-style="gridStyle" :map-config="mapConfig"
      :default-calibration="moduleCalibration" :image-width="map.imageWidth" :image-height="map.imageHeight" />

    <SidePanel :tabs="sidePanelTabs" v-model:open-tab="openTab">
      <template v-for="tab in sidePanelTabs" :key="tab.key" v-slot:[tab.key]>
        <EliminatedPanel v-if="tab.key === 'eliminated'" :units="eliminatedCounters"
          @contextmenu="onEliminatedContextMenu" />
        <JournalPanel v-else-if="tab.key === 'journal'" ref="journalRef" :module-id="moduleId || module.name"
          :turn="turnInfo.turn" :settings="settings" :shared="online" @loaded="onJournalLoaded"
          @settings-mismatch="(settings) => emit('restart-with', settings)" />
        <ReinforcementsPanel v-else :reinforcements="reinforcementsForTab(tab.key)"
          :selected-id="selectedReinforcementId" :current-turn="turnInfo.turn" :draggable="draggable"
          :can-place="canPlaceReinforcementNow"
          @dragstart="onCounterDragStart" @select="onReinforcementSelect" />
      </template>
    </SidePanel>

    <ContextMenu v-if="contextMenu" :left-px="contextMenu.x" :top-px="contextMenu.y" :items="contextMenu.items"
      @choose="chooseContextMenuItem" @close="closeContextMenu" />

    <!-- cf. lib/useCombat.js — modale de combat, ouverte par un clic sur une
         unité ennemie en phase Combat. Non bloquante : la carte reste
         cliquable pour y désigner les unités attaquantes. -->
    <CombatModal v-if="combatActive" :target-hexes="combatTargetHexLabels" :defenders="combatDefenders"
      :attackers="combatAttackers" :can-resolve="combatCanResolve" :stranded-units="combatStrandedUnits"
      :attack-strength="attackStrength" :defense-strength="defenseStrength" :differential="differential"
      :terrain-row="combatTerrainRow" :column="combatColumn" :combat-result="combatResult"
      :crt-rows="crtRows" :crt-results="crtResults" :retreat="retreatInfo" :retreat-notes="retreatNotes"
      :advance="advanceInfo" @close="cancelCombat" @fight="onCombatFight" @end-advance="endAdvance"
      @reduce-retreat="reduceRetreat" @cancel-push="cancelPush" />

    <!-- cf. onPhaseNext — changement de phase refusé : unités empilées en fin
         de Mouvement (cf. lib/useAssisted.js::stackedHexes) ou combats
         obligatoires encore en attente (cf. lib/useCombat.js::pendingEngagements).
         Les deux listes sont vides hors de leur phase respective. -->
    <PhaseBlockedModal v-if="showPhaseBlocked" :engagements="pendingEngagements" :stacks="stackedHexes"
      @close="showPhaseBlocked = false" />

    <!-- cf. MoveTimer.vue — timing "Limité" : temps de la phase de Mouvement écoulé. -->
    <PhaseBlockedModal v-if="showTimeUp" title="Temps imparti terminé" @close="showTimeUp = false">
      Le temps accordé pour la phase de Mouvement est écoulé.
    </PhaseBlockedModal>

    <!-- cf. declareBlitzLoss — Blitz : une pendule est tombée à 0, partie perdue. -->
    <PhaseBlockedModal v-if="showGameOver && blitzLoser" title="Temps imparti terminé" @close="showGameOver = false">
      Le temps de mouvement du camp « {{ sideLabel(blitzLoser) }} » est écoulé : ce camp perd la partie.
      <template v-if="localSide"><br><b>{{ localSide === blitzLoser ? 'Vous avez perdu.' : 'Vous avez gagné !' }}</b></template>
    </PhaseBlockedModal>

    <!-- cf. setSelectedCounter — changement de sélection refusé : l'unité
         en cours de mouvement est en overstack avec une unité amie. -->
    <PhaseBlockedModal v-if="unitStackBlock" title="Mouvement non terminé" :stacks="[unitStackBlock]"
      stack-message="Cette unité partage son hex avec une unité amie. Déplacez-la (ou annulez son mouvement) avant de passer à une autre unité :"
      @close="unitStackBlock = null" />

    <!-- Dé libre : mode Libre uniquement (cf. `showRollModal`). -->
    <RollModal v-if="!assisted" v-show="showRollModal" :disabled="inputLocked" @roll="onDiceRoll" />
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

.move-timers {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  align-self: flex-start;
}

.game-over-tag {
  padding: 3px 10px;
  border-radius: 6px;
  background: #ff5a3c;
  color: #2a2620;
  font-size: 0.8rem;
  font-weight: 700;
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

/* cf. lib/useRetreat.js — hex où l'unité en retraite peut aller : rouge,
   cliquable. */
.hex-retreat {
  fill: rgba(224, 40, 40, 0.45);
  stroke: #e02828;
  stroke-width: 3;
  cursor: pointer;
}

.hex-retreat:hover {
  fill: rgba(224, 40, 40, 0.65);
}

/* cf. lib/useRetreat.js — avance après combat. Chemin de retraite (POR) :
   vert léger, les clics le traversent. */
.hex-por {
  fill: rgba(46, 160, 67, 0.28);
  stroke: #2ea043;
  stroke-width: 2;
  pointer-events: none;
}

/* Hex où l'unité choisie peut avancer : vert vif, cliquable. */
.hex-advance {
  fill: rgba(46, 160, 67, 0.6);
  stroke: #1f7a33;
  stroke-width: 3;
  cursor: pointer;
}

.hex-advance:hover {
  fill: rgba(46, 160, 67, 0.8);
}

/* Hex d'une unité qui peut avancer : c'est le pion posé dessus qui reçoit
   le clic (cf. onCounterSelect). */
.hex-advancer {
  fill: none;
  stroke: #2ea043;
  stroke-width: 3;
  stroke-dasharray: 8 5;
  pointer-events: none;
}

/* Hex de l'unité qui est en train de retraiter : simple contour. */
.hex-retreating {
  fill: none;
  stroke: #e02828;
  stroke-width: 3;
  stroke-dasharray: 8 5;
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
