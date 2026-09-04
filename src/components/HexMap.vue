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

import { reactive, ref, computed, onMounted } from 'vue'
import { hexId, parseHexId, DEFAULT_CALIBRATION } from '../lib/calibration.js'
import { neighborsOf } from '../lib/hex.js'
import { hexExists, removedHexSet } from '../lib/mapShape.js'
import CalibrationPanel from './CalibrationPanel.vue'
import Counter from './Counter.vue'
import SidePanel from './SidePanel.vue'
import ReinforcementsPanel from './ReinforcementsPanel.vue'
import EliminatedPanel from './EliminatedPanel.vue'
import ContextMenu from './ContextMenu.vue'

const props = defineProps({
  module: { type: Object, required: true }, // cf. src/modules/*.json — { boardGame, name, map: {...} }
  // Positions déjà déplacées depuis le setup du module (partie multijoueur en
  // cours) — { [counterId]: { col, row } }. Absent en solo/démo.
  initialPositions: { type: Object, default: () => ({}) },
})

const emit = defineEmits(['move'])

const map = computed(() => props.module.map)

const calibration = reactive({ ...DEFAULT_CALIBRATION })
const gridStyle = reactive({ stroke: '#d11a1a', width: 1.5, opacity: 0 })
const mapConfig = reactive({ cols: map.value.cols, rows: map.value.rows })

const zoom = ref(0.55)
const showGrid = ref(true)
const showLabels = ref(false)
const showCalib = ref(false)
const selected = ref(null)

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

const isSel = (h) => selected.value && selected.value.col === h.c && selected.value.row === h.r

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
// pions sans ce champ, ex. la garnison allemande fixe). Exception : les
// renforts ALLEMANDS du tour 1 restent hors carte malgré tout — ils
// arrivent bien pendant ce tour mais pas déjà déployés au coup d'envoi
// (contrairement au largage aéroporté allié, qui EST le déploiement initial
// du scénario) — donc glissables depuis le panneau comme n'importe quel
// autre tour. Les renforts restants (tous tours/factions confondus) restent
// hors carte, glissables depuis le panneau "Renfort ..." (cf.
// `reinforcements`). Plusieurs pions peuvent partager le même hex d'entrée
// déclaré (ex. les 3 bataillons d'un même régiment) : pickArrivalHex les
// répartit pour éviter le stacking (les marqueurs, eux, ignorent
// complètement cette logique — cf. isUnit).
const autoPlacesAtLoad = (c) => (c.turn ?? 1) === 1 && !(c.faction === 'german' && c.turn === 1)
const counters = ref((() => {
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
})())
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
// Glissés sur la carte via le même mécanisme que le déplacement d'un pion
// existant (onCounterDragStart / onMapDrop plus bas), ou choisis via le
// menu contextuel "Replacer le pion" (ils y retournent alors).
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
  return [...base, { key: 'eliminated', label: 'Unités éliminées' }]
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
}
function eliminateCounter(id) {
  const i = counters.value.findIndex((c) => String(c.id) === String(id))
  if (i !== -1) counters.value.splice(i, 1)
  eliminatedIds.value.add(String(id))
  eliminatedIds.value = new Set(eliminatedIds.value)
}
function onCounterContextMenu(id, ev) {
  openContextMenu(ev, [
    { label: 'Replacer le pion', action: () => returnCounterToReinforcements(id) },
    { label: 'Éliminé', action: () => eliminateCounter(id) },
  ])
}
function onEliminatedContextMenu(id, ev) {
  openContextMenu(ev, [
    { label: 'Replacer le pion', action: () => returnCounterToReinforcements(id) },
  ])
}
function chooseContextMenuItem(action) {
  action()
  closeContextMenu()
}

/** Hex voisins (0-based col / 1-based row) du pion actuellement sélectionné,
 *  sous forme de clés "col,row" pour un lookup O(1) depuis isAdjacent(). */
const adjacentSet = computed(() => {
  const c = counters.value.find((c) => c.id === selectedCounterId.value)
  if (!c) return new Set()
  return new Set(
    neighborsOf(c.col, c.row).filter((n) => hexOnMap(n.col, n.row)).map((n) => n.col + ',' + n.row)
  )
})
const isAdjacent = (h) => adjacentSet.value.has(h.c + ',' + h.r)

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

function onCounterSelect(id) {
  selectedCounterId.value = selectedCounterId.value === id ? null : id
  selectedReinforcementId.value = null
}

// --- Entrée en jeu d'un renfort : deux systèmes cf. demande utilisateur —
// 1) glisser-déposer libre (n'importe quel hex, cf. onMapDrop) ;
// 2) clic sur le pion dans le panneau (bordure orange, cf.
//    ReinforcementsPanel.vue) puis clic sur un des hex d'entrée valides,
//    surlignés en orange sur la carte (un seul hex, ou tous les hex de la
//    plage bord-de-carte si `setup` en déclare une — cf. enumerateSetupHexes).
const selectedReinforcementId = ref(null)
const selectedReinforcement = computed(() =>
  reinforcements.value.find((c) => String(c.id) === String(selectedReinforcementId.value))
)
const entryHexSet = computed(() => {
  const r = selectedReinforcement.value
  if (!r) return new Set()
  return new Set(enumerateSetupHexes(r.setup).map((h) => h.col + ',' + h.row))
})
const isEntryHex = (h) => entryHexSet.value.has(h.c + ',' + h.r)

function onReinforcementSelect(id) {
  selectedReinforcementId.value = selectedReinforcementId.value === id ? null : id
  selectedCounterId.value = null
}

/** Clic sur un hex, par ordre de priorité :
 *  1. un renfort est sélectionné (système 2) et l'hex cliqué fait partie de
 *     ses hex d'entrée valides -> il s'y pose, fin de sélection ;
 *  2. un pion déjà sur la carte est sélectionné et l'hex cliqué lui est
 *     adjacent -> il s'y déplace (et reste sélectionné, pour enchaîner) ;
 *  3. sinon, comportement existant : simple sélection d'info hex. */
const onHex = (h) => {
  if (selectedReinforcementId.value != null) {
    if (isEntryHex(h)) {
      const r = selectedReinforcement.value
      if (r) {
        const placed = { ...r, col: h.c, row: h.r }
        counters.value.push(placed)
        emit('move', { counterId: placed.id, col: h.c, row: h.r })
      }
      selectedReinforcementId.value = null
    }
    return
  }
  if (selectedCounterId.value != null && isAdjacent(h)) {
    const c = counters.value.find((c) => c.id === selectedCounterId.value)
    if (c) { c.col = h.c; c.row = h.r; emit('move', { counterId: c.id, col: c.col, row: c.row }) }
    return
  }
  selected.value = isSel(h) ? null : { col: h.c, row: h.r, coord: h.id }
}

// --- Drag & drop d'un pion : dépose au centre de l'hex le plus proche du curseur ---
const svgRef = ref(null)

function onCounterDragStart(id, ev) {
  draggedCounterId.value = id
  if (ev?.dataTransfer) { ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', String(id)) }
}

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
  const svg = svgRef.value
  if (!svg || draggedCounterId.value == null) return
  const pt = svg.createSVGPoint()
  pt.x = ev.clientX; pt.y = ev.clientY
  const loc = pt.matrixTransform(svg.getScreenCTM().inverse())
  const hex = pixelToHex(loc.x, loc.y)
  if (hex) {
    const c = counters.value.find((c) => c.id === draggedCounterId.value)
    if (c) {
      c.col = hex.col; c.row = hex.row
      emit('move', { counterId: c.id, col: c.col, row: c.row })
    } else {
      // Pas encore sur la carte : c'est un renfort glissé depuis le panneau
      // "Renfort ...". Glisser-déposer libre (système 1, cf. entrée en jeu
      // dans le commentaire de `entryHexSet`) : il atterrit exactement où on
      // le lâche, n'importe quel hex de la carte, sans lien avec son hex
      // d'entrée déclaré.
      const reinforcement = allCounters.value.find((c) => String(c.id) === String(draggedCounterId.value))
      if (reinforcement) {
        const placed = { ...reinforcement, ...hex }
        counters.value.push(placed)
        emit('move', { counterId: placed.id, col: placed.col, row: placed.row })
      }
    }
  }
  draggedCounterId.value = null
}

/** Applique un déplacement reçu d'un autre joueur (WebSocket) — ne réémet
 *  pas `move` pour éviter une boucle avec le serveur. */
function applyRemoteMove(counterId, col, row) {
  const c = counters.value.find((c) => String(c.id) === String(counterId))
  if (c) { c.col = col; c.row = row; return }
  // Un autre joueur a posé un renfort pas encore présent localement (glissé
  // depuis son propre panneau "Renfort alliés") : on l'ajoute.
  const reinforcement = allCounters.value.find((c) => String(c.id) === String(counterId))
  if (reinforcement) counters.value.push({ ...reinforcement, col, row })
}

defineExpose({ applyRemoteMove })

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

// Zoom initial : la carte doit occuper toute la largeur disponible au
// chargement plutôt qu'un pourcentage arbitraire fixe — recalculé une seule
// fois au montage (un zoom manuel ensuite n'est jamais réécrit).
onMounted(() => {
  const width = mapWrapRef.value?.clientWidth
  if (width) zoom.value = +(width / map.value.imageWidth).toFixed(3)
})

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
      <div class="controls">
        <label><input type="checkbox" v-model="showGrid"> grille</label>
        <label><input type="checkbox" v-model="showLabels"> coordonnées</label>
        <label><input type="checkbox" v-model="showCalib"> calibration</label>
        <div class="zoom-ctl">
          <button @click="zoomOut">−</button>
          <span>{{ Math.round(zoom * 100) }}%</span>
          <button @click="zoomIn">+</button>
        </div>
        <span v-if="selected" class="selected-hex">hex sélectionné : <b>{{ selected.coord }}</b></span>
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
            :class="{ sel: isSel(h), adjacent: isAdjacent(h), entry: isEntryHex(h) }"
            :points="h.pts" :stroke="gridStyle.stroke" :stroke-width="gridStyle.width"
            :stroke-opacity="gridStyle.opacity" vector-effect="non-scaling-stroke" @click="onHex(h)" />
        </g>

        <g v-if="showLabels">
          <text v-for="h in hexes" :key="'t' + h.id" class="coordtxt" :x="h.cx" :y="h.cy + calibration.a * 0.18"
            text-anchor="middle" :font-size="calibration.a * 0.42">{{ h.id }}</text>
        </g>

        <g class="counters">
          <!-- Marqueurs (DZ...) rendus en premier : toujours sous les unités
               dans l'ordre de peinture SVG, quel que soit le hex. -->
          <Counter v-for="c in counters.filter((c) => !isUnit(c))" :key="c.id" :id="c.id" :src="c.src" :col="c.col"
            :row="c.row" :calibration="calibration" :selected="selectedCounterId === c.id" :selectable="false"
            :offset="stackOffsets.get(c.id) ?? ZERO_OFFSET" @dragstart="onCounterDragStart" />
          <Counter v-for="c in counters.filter(isUnit)" :key="c.id" :id="c.id" :src="c.src" :col="c.col"
            :row="c.row" :calibration="calibration" :selected="selectedCounterId === c.id"
            :offset="stackOffsets.get(c.id) ?? ZERO_OFFSET" @select="onCounterSelect"
            @dragstart="onCounterDragStart" @contextmenu="onCounterContextMenu" />
        </g>
      </svg>
    </main>

    <CalibrationPanel v-if="showCalib" :calibration="calibration" :grid-style="gridStyle" :map-config="mapConfig"
      :default-calibration="DEFAULT_CALIBRATION" :image-width="map.imageWidth" :image-height="map.imageHeight" />

    <SidePanel :tabs="sidePanelTabs" v-model:open-tab="openTab">
      <template v-for="tab in sidePanelTabs" :key="tab.key" v-slot:[tab.key]>
        <EliminatedPanel v-if="tab.key === 'eliminated'" :units="eliminatedCounters"
          @contextmenu="onEliminatedContextMenu" />
        <ReinforcementsPanel v-else :reinforcements="reinforcementsForTab(tab.key)"
          :selected-id="selectedReinforcementId" @dragstart="onCounterDragStart" @select="onReinforcementSelect" />
      </template>
    </SidePanel>

    <ContextMenu v-if="contextMenu" :x="contextMenu.x" :y="contextMenu.y" :items="contextMenu.items"
      @choose="chooseContextMenuItem" @close="closeContextMenu" />
  </div>
</template>

<style scoped>
.hexmap {
  display: block;
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  padding: 16px 36px 0;
  background: #8a7c76;
}

.toolbar h1 {
  font-size: 3.2rem;
  font-weight: 700;
  margin: 0;
  color: #cac9ae;
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

.selected-hex {
  font-family: monospace;
}

.map-wrap {
  overflow: hidden;
  height: calc( 100vh - 76px );
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
  cursor: pointer;
  transition: fill 0.05s;
}

polygon.hex:hover {
  fill: rgba(255, 247, 180, 0.28);
}

polygon.hex.sel {
  fill: rgba(244, 227, 161, 0.45);
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
</style>
