<script setup>
// Menu contextuel générique (clic droit) — inspiré de ambush-tactique
// (ActionRoundTrack.vue) : positionné en fixed aux coordonnées du clic,
// téléporté dans <body> pour échapper aux ancêtres transformés (le panneau
// latéral coulissant SidePanel.vue anime via `transform`, ce qui casserait
// un `position: fixed` resté à l'intérieur), fermé au clic extérieur ou sur
// Échap, ou après le choix d'une action.
import { onMounted, onUnmounted } from 'vue'

const props = defineProps({
  leftPx: { type: Number, required: true },
  topPx: { type: Number, required: true },
  items: { type: Array, required: true }, // [{ label, action }]
})

const emit = defineEmits(['choose', 'close'])

function onWindowClick() { emit('close') }
function onKeydown(event) { if (event.key === 'Escape') emit('close') }

onMounted(() => {
  window.addEventListener('click', onWindowClick)
  window.addEventListener('keydown', onKeydown)
})
onUnmounted(() => {
  window.removeEventListener('click', onWindowClick)
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Teleport to="body">
    <div class="ctx-menu" :style="{ left: leftPx + 'px', top: topPx + 'px' }" @click.stop @contextmenu.prevent>
      <button v-for="item in items" :key="item.label" class="ctx-item" @click="emit('choose', item.action)">
        {{ item.label }}
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.ctx-menu {
  position: fixed;
  z-index: 1000;
  background: #2a2620;
  color: #ece4d0;
  border-radius: 6px;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45);
  padding: 6px;
  min-width: 180px;
  font-size: 0.85rem;
}
.ctx-item {
  display: block;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  color: inherit;
  padding: 9px 12px;
  border-radius: 4px;
  cursor: pointer;
  font: inherit;
}
.ctx-item:hover {
  background: #ff8c00;
  color: #2a2620;
}
</style>
