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
  // Vrai si ce pion a bougé pendant le tour en cours (cf. HexMap.vue,
  // `movedThisTurnIds`) — liseré orange 1px, effacé en fin de tour ou par
  // "Annuler le mouvement" (menu contextuel).
  moved: { type: Boolean, default: false },
  // Vrai si ce pion a déjà combattu pendant la phase en cours (cf.
  // lib/useCombat.js::hasFought) — désaturé et à 0.75 d'opacité.
  spent: { type: Boolean, default: false },
  size: { type: Number, default: 0.8 },         // taille du pion, fraction du pas de ligne (rowStep)
  // Faux (marqueurs type DZ, cf. HexMap.vue) : pas de sélection ni de
  // déplacement par clic sur hex adjacent — reste librement déplaçable en
  // drag & drop, qui ne passe pas par `select`.
  selectable: { type: Boolean, default: true },
  // Décalage visuel en cas d'empilement de plusieurs pions sur le même hex
  // (cf. `stackOffsets` dans HexMap.vue) — fraction de la taille du pion.
  offset: { type: Object, default: () => ({ dx: 0, dy: 0 }) },
  // Position pixel SVG live pendant un glisser "souris" en cours (cf.
  // dragCurrentPx dans HexMap.vue) — remplace le centre calculé depuis
  // col/row tant que ce pion est celui suivi par le glisser.
  dragPx: { type: Object, default: null },
})

const emit = defineEmits(['select', 'dragstart', 'contextmenu'])

/** Centre pixel du pion — même formule que HexMap.vue (grille flat-top, offset odd-q) — plus le décalage d'empilement. */
const center = computed(() => {
  if (props.dragPx) return props.dragPx
  const { x0, y0, colStep, rowStep } = props.calibration
  const yoff = props.col % 2 === 1 ? rowStep / 2 : 0
  const w = rowStep * props.size
  return {
    x: x0 + props.col * colStep + props.offset.dx * w,
    y: y0 + (props.row - 1) * rowStep + yoff + props.offset.dy * w,
  }
})
const w = computed(() => props.calibration.rowStep * props.size)

function onClick() {
  if (props.selectable) emit('select', props.id)
}

/** Démarre le glisser au clic gauche — cf. HexMap.vue::onCounterDragStart :
 *  le DnD natif HTML5 (`draggable`/`dragstart`) ne se déclenche pas de façon
 *  fiable sur une <image> SVG, donc on suit la souris nous-mêmes plutôt que
 *  de compter sur l'événement natif. */
function onMouseDown(ev) {
  if (ev.button !== 0) return
  ev.preventDefault()
  emit('dragstart', props.id, ev)
}
</script>

<template>
  <g class="counter" :class="{ selected, spent }">
    <image :href="src" :x="center.x - w / 2" :y="center.y - w / 2" :width="w" :height="w" class="counter-img"
      @mousedown="onMouseDown" @click.stop="onClick"
      @contextmenu.prevent.stop="emit('contextmenu', id, $event)" />
    <rect v-if="selected" class="counter-ring" :x="center.x - w / 2 - 3" :y="center.y - w / 2 - 3" :width="w + 6"
      :height="w + 6" rx="5" ry="5" />
    <rect v-if="moved" class="counter-moved-ring" :x="center.x - w / 2" :y="center.y - w / 2" :width="w" :height="w"
      rx="3" ry="3" />
  </g>
</template>

<style scoped>
.counter-img {
  cursor: pointer;
  user-select: none;
  -webkit-user-drag: none;
}

.counter.spent .counter-img {
  filter: grayscale(1);
  opacity: 0.75;
  cursor: default;
}

.counter-ring {
  fill: none;
  stroke: #2ecc71;
  stroke-width: 4;
  vector-effect: non-scaling-stroke;
  pointer-events: none;
}

.counter-moved-ring {
  fill: none;
  stroke: #ff8c00;
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
  pointer-events: none;
}
</style>
