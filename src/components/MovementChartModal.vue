<script setup>
// Fenêtre flottante affichant l'image de la table des coûts de mouvement par
// terrain (cf. HexMap.vue, bouton "Table des mouvements" dans la toolbar).
// Même principe que RollModal.vue (widget non-bloquant, déplaçable par
// glisser-déposer, logique de drag réduite inline, pas de dépendance à
// lib/useDrag.js) : toujours monté tant que le parent le garde, visibilité
// pilotée en v-show par le bouton toolbar.
import { ref, onMounted, onUnmounted } from 'vue'

defineProps({
  src: { type: String, required: true },
})

const pos = ref({ x: 16, y: 90 })
const dragging = ref(false)
let drag = null

function onDragStart(e) {
  dragging.value = true
  drag = { mx: e.clientX, my: e.clientY, x: pos.value.x, y: pos.value.y }
  window.addEventListener('pointermove', onDragMove)
  window.addEventListener('pointerup', onDragEnd)
  e.preventDefault()
}
function onDragMove(e) {
  if (!dragging.value) return
  const nx = drag.x + (e.clientX - drag.mx)
  const ny = drag.y + (e.clientY - drag.my)
  const maxX = (window.innerWidth || 1200) - 60
  const maxY = (window.innerHeight || 800) - 40
  pos.value = { x: Math.min(Math.max(-260, nx), maxX), y: Math.min(Math.max(0, ny), maxY) }
}
function onDragEnd() {
  dragging.value = false
  drag = null
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', onDragEnd)
}

onMounted(() => {
  pos.value = { x: Math.max(16, (window.innerWidth || 1200) - 500), y: 90 }
})
onUnmounted(() => {
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', onDragEnd)
})
</script>

<template>
  <div class="chart-modal" :class="{ dragging }" :style="{ left: pos.x + 'px', top: pos.y + 'px' }"
    @pointerdown="onDragStart">
    <div class="chart-header">Table des mouvements</div>
    <img class="chart-image" :src="src" alt="Table des coûts de mouvement par terrain" draggable="false" />
  </div>
</template>

<style scoped>
.chart-modal {
  position: fixed;
  z-index: 900;
  background: #fff;
  border-radius: 10px;
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.45);
  padding: 10px;
  cursor: move;
  touch-action: none;
  user-select: none;
  max-width: min(92vw, 720px);
}
.chart-modal.dragging {
  box-shadow: 0 22px 46px rgba(0, 0, 0, 0.55);
}
.chart-header {
  font-weight: 700;
  font-size: 0.85rem;
  margin-bottom: 8px;
  color: #333;
  pointer-events: none;
}
.chart-image {
  display: block;
  max-width: 100%;
  height: auto;
  pointer-events: none;
  border-radius: 4px;
}
</style>
