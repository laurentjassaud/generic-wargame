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

import { reactive, ref, computed } from 'vue'
import { hexId, parseHexId, DEFAULT_CALIBRATION } from '../lib/calibration.js'
import { neighborsOf } from '../lib/hex.js'
import CalibrationPanel from './CalibrationPanel.vue'
import Counter from './Counter.vue'

const props = defineProps({
  module: { type: Object, required: true }, // cf. src/modules/*.json — { boardGame, name, map: {...} }
})

const map = computed(() => props.module.map)

const calibration = reactive({ ...DEFAULT_CALIBRATION })
const gridStyle = reactive({ stroke: '#d11a1a', width: 1.5, opacity: 0 })
const mapConfig = reactive({ cols: map.value.cols, rows: map.value.rows })

const zoom = ref(0.55)
const showGrid = ref(true)
const showLabels = ref(false)
const showCalib = ref(false)
const selected = ref(null)

/** Liste des hex de la grille avec leur polygone SVG déjà calculé. */
const hexes = computed(() => {
  const { x0, y0, colStep, a, rowStep } = calibration
  const b = rowStep / 2
  const out = []
  for (let c = 0; c < mapConfig.cols; c++) {
    const cx = x0 + c * colStep
    const yoff = c % 2 === 1 ? rowStep / 2 : 0
    for (let r = 1; r <= mapConfig.rows; r++) {
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

// --- Pions (counters) : placement libre en drag & drop, déplacement d'un pas
// une fois sélectionné (clic sur un hex adjacent, en vert). ---
let nextCounterId = 1
const PLACEHOLDER_COUNTER = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
  + '<rect x="2" y="2" width="60" height="60" rx="8" fill="#3a5a8a" stroke="#111" stroke-width="3"/>'
  + '<circle cx="32" cy="24" r="11" fill="#e8c468"/>'
  + '<rect x="14" y="38" width="36" height="18" rx="4" fill="#e8c468"/>'
  + '</svg>'
)

// Pions fournis par le module (cf. public/modules/arnhem/arnhem.json -> counters.german) :
// seuls ceux qui ont un `setup` (hex de départ, ex. "0604") sont placés sur la carte au
// chargement — les autres restent hors carte (pas de placement au hasard).
const counters = ref(
  Object.values(props.module.counters || {}).flat()
    .filter((c) => c.setup)
    .map((c) => ({ ...c, ...parseHexId(c.setup) }))
)
const selectedCounterId = ref(null)
const draggedCounterId = ref(null)

function addCounter() {
  counters.value.push({ id: nextCounterId++, src: PLACEHOLDER_COUNTER, col: 0, row: 1 })
}

/** Hex voisins (0-based col / 1-based row) du pion actuellement sélectionné,
 *  sous forme de clés "col,row" pour un lookup O(1) depuis isAdjacent(). */
const adjacentSet = computed(() => {
  const c = counters.value.find((c) => c.id === selectedCounterId.value)
  if (!c) return new Set()
  return new Set(neighborsOf(c.col, c.row).map((n) => n.col + ',' + n.row))
})
const isAdjacent = (h) => adjacentSet.value.has(h.c + ',' + h.r)

function onCounterSelect(id) {
  selectedCounterId.value = selectedCounterId.value === id ? null : id
}

/** Clic sur un hex : si un pion est sélectionné et que l'hex cliqué lui est
 *  adjacent, le pion s'y déplace (et reste sélectionné, pour enchaîner les
 *  pas). Sinon, comportement existant : simple sélection d'info hex. */
const onHex = (h) => {
  if (selectedCounterId.value != null && isAdjacent(h)) {
    const c = counters.value.find((c) => c.id === selectedCounterId.value)
    if (c) { c.col = h.c; c.row = h.r }
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
      if (r < 1 || r > mapConfig.rows) continue
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
    if (c) { c.col = hex.col; c.row = hex.row }
  }
  draggedCounterId.value = null
}

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
        <button @click="addCounter">+ pion</button>
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
          <polygon v-for="h in hexes" :key="h.id" class="hex" :class="{ sel: isSel(h), adjacent: isAdjacent(h) }"
            :points="h.pts" :stroke="gridStyle.stroke" :stroke-width="gridStyle.width"
            :stroke-opacity="gridStyle.opacity" vector-effect="non-scaling-stroke" @click="onHex(h)" />
        </g>

        <g v-if="showLabels">
          <text v-for="h in hexes" :key="'t' + h.id" class="coordtxt" :x="h.cx" :y="h.cy + calibration.a * 0.18"
            text-anchor="middle" :font-size="calibration.a * 0.42">{{ h.id }}</text>
        </g>

        <g class="counters">
          <Counter v-for="c in counters" :key="c.id" :id="c.id" :src="c.src" :col="c.col" :row="c.row"
            :calibration="calibration" :selected="selectedCounterId === c.id" @select="onCounterSelect"
            @dragstart="onCounterDragStart" />
        </g>
      </svg>
    </main>

    <CalibrationPanel v-if="showCalib" :calibration="calibration" :grid-style="gridStyle" :map-config="mapConfig"
      :default-calibration="DEFAULT_CALIBRATION" :image-width="map.imageWidth" :image-height="map.imageHeight" />
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
  margin-bottom: 12px;
}

.toolbar h1 {
  font-size: 1.1rem;
  margin: 0;
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
  overflow: auto;
  border: 1px solid #ccc;
  max-height: 80vh;
  background: #222;
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

.coordtxt {
  font-family: monospace;
  font-weight: 700;
  fill: #111;
  pointer-events: none;
}
</style>
