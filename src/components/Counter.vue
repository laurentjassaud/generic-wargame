<script setup>
// ═══════════════════════════════════════════════════════════════════════════
// Counter.vue — un pion posé sur la carte hexagonale. Composant SVG (à
// utiliser DANS le <svg> de HexMap.vue, en tant que <g>) : image de fond +
// anneau vert de sélection. Ne connaît rien des règles de jeu — uniquement
// sa propre géométrie (position pixel déduite de col/row + calibration) et
// deux événements bruts (`select`, `dragstart`) que le parent interprète.
// ═══════════════════════════════════════════════════════════════════════════

import { computed } from 'vue'

const props = defineProps({
  id: { type: [String, Number], required: true },
  src: { type: String, required: true },       // image du pion
  col: { type: Number, required: true },        // hex courant — 0-based
  row: { type: Number, required: true },        // hex courant — 1-based
  calibration: { type: Object, required: true }, // { x0,y0,colStep,a,rowStep } — cf. lib/calibration.js
  selected: { type: Boolean, default: false },
  size: { type: Number, default: 0.8 },         // taille du pion, fraction du pas de ligne (rowStep)
})

const emit = defineEmits(['select', 'dragstart'])

/** Centre pixel du pion — même formule que HexMap.vue (grille flat-top, offset odd-q). */
const center = computed(() => {
  const { x0, y0, colStep, rowStep } = props.calibration
  const yoff = props.col % 2 === 1 ? rowStep / 2 : 0
  return { x: x0 + props.col * colStep, y: y0 + (props.row - 1) * rowStep + yoff }
})
const w = computed(() => props.calibration.rowStep * props.size)
</script>

<template>
  <g class="counter" :class="{ selected }">
    <image :href="src" :x="center.x - w / 2" :y="center.y - w / 2" :width="w" :height="w" class="counter-img"
      draggable="true" @click.stop="emit('select', id)" @dragstart="emit('dragstart', id, $event)" />
    <rect v-if="selected" class="counter-ring" :x="center.x - w / 2 - 3" :y="center.y - w / 2 - 3" :width="w + 6"
      :height="w + 6" rx="5" ry="5" />
  </g>
</template>

<style scoped>
.counter-img {
  cursor: pointer;
}

.counter-ring {
  fill: none;
  stroke: #2ecc71;
  stroke-width: 4;
  vector-effect: non-scaling-stroke;
  pointer-events: none;
}
</style>
