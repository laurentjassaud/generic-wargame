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
import { hexId, DEFAULT_CALIBRATION } from '../lib/calibration.js'
import CalibrationPanel from './CalibrationPanel.vue'

const props = defineProps({
  module: { type: Object, required: true }, // cf. src/modules/*.json — { boardGame, name, map: {...} }
})

const map = computed(() => props.module.map)

const calibration = reactive({ ...DEFAULT_CALIBRATION })
const gridStyle = reactive({ stroke: '#d11a1a', width: 1.5, opacity: 0.6 })
const mapConfig = reactive({ cols: map.value.cols, rows: map.value.rows })

const zoom = ref(0.55)
const showGrid = ref(true)
const showLabels = ref(true)
const showCalib = ref(true)
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
const onHex = (h) => (selected.value = { col: h.c, row: h.r, coord: h.id })

function zoomIn() {
  zoom.value = Math.min(2, +(zoom.value + 0.05).toFixed(2))
}
function zoomOut() {
  zoom.value = Math.max(0.1, +(zoom.value - 0.05).toFixed(2))
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

    <main class="map-wrap">
      <svg class="map-svg"
        :style="{ width: map.imageWidth * zoom + 'px', height: map.imageHeight * zoom + 'px' }"
        :viewBox="`0 0 ${map.imageWidth} ${map.imageHeight}`" preserveAspectRatio="none">

        <image :href="map.url" x="0" y="0" :width="map.imageWidth" :height="map.imageHeight" preserveAspectRatio="none" />

        <g v-if="showGrid">
          <polygon v-for="h in hexes" :key="h.id" class="hex" :class="{ sel: isSel(h) }" :points="h.pts"
            :stroke="gridStyle.stroke" :stroke-width="gridStyle.width" :stroke-opacity="gridStyle.opacity"
            vector-effect="non-scaling-stroke" @click="onHex(h)" />
        </g>

        <g v-if="showLabels">
          <text v-for="h in hexes" :key="'t' + h.id" class="coordtxt" :x="h.cx" :y="h.cy + calibration.a * 0.18"
            text-anchor="middle" :font-size="calibration.a * 0.42">{{ h.id }}</text>
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

.coordtxt {
  font-family: monospace;
  font-weight: 700;
  fill: #111;
  pointer-events: none;
}
</style>
