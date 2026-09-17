<script setup>
// ═══════════════════════════════════════════════════════════════════════════
// SupportTracker.vue — tablette de soutien allié, autonome : plateau [18.16]
// — un nombre de pions "support" fixé par tour (config.byTurn, indexé par le
// tour courant), tous identiques et librement glissables sur la carte (pas
// d'hex d'entrée, pas de camp propriétaire). Régénérés à neuf à chaque
// changement de tour : un pion non posé avant le tour suivant est simplement
// perdu (ressource par tour, pas cumulative), comme au tableau des règles.
//
// Ne connaît que sa propre tablette (pions PAS ENCORE posés) — une fois un
// pion glissé sur la carte, il devient un pion comme un autre dans
// `counters` (cf. HexMap.vue) ; ce composant l'oublie via `removeToken`.
// Le parent délègue tout le reste (glisser-déposer unifié avec renforts/pions
// déjà posés, empilement, badge de compte sur la carte) car cela concerne
// des pions DÉJÀ sur la carte, hors du périmètre de la tablette.
// ═══════════════════════════════════════════════════════════════════════════

import { ref, computed, watch } from 'vue'

const props = defineProps({
  // module.supportTrack — { label, marker, byTurn: [count par tour] }.
  // Absent (null) : pas de tablette de soutien.
  config: { type: Object, default: null },
  // Tour courant (1-based, cf. TurnTracker.vue) — régénère la tablette.
  turn: { type: Number, default: 1 },
})

const emit = defineEmits(['dragstart'])

const count = computed(() => props.config?.byTurn[props.turn - 1] ?? 0)
const tokens = ref([])

watch(
  () => [props.config, props.turn],
  () => {
    const track = props.config
    if (!track) { tokens.value = []; return }
    const tokenCount = track.byTurn[props.turn - 1] ?? 0
    tokens.value = Array.from({ length: tokenCount }, (_, tokenIndex) => ({
      id: `support-t${props.turn}-${tokenIndex}`, type: 'marker', kind: 'support', faction: null, name: track.label, src: track.marker,
    }))
  },
  { immediate: true },
)

/** Lecture seule — utilisé par HexMap.vue::onCounterDragStart pour résoudre
 *  l'id glissé (avant de savoir si c'est un pion de la tablette ou non). */
function findToken(id) {
  return tokens.value.find((token) => String(token.id) === String(id)) ?? null
}

/** Retire un pion de la tablette une fois posé sur la carte (cf.
 *  HexMap.vue::onMapDrop) — retourne le pion retiré, ou null s'il n'y est pas. */
function removeToken(id) {
  const tokenIndex = tokens.value.findIndex((token) => String(token.id) === String(id))
  if (tokenIndex === -1) return null
  return tokens.value.splice(tokenIndex, 1)[0]
}

defineExpose({ findToken, removeToken })
</script>

<template>
  <div v-if="config" class="support-tracker">
    <span class="st-label">{{ config.label }} ({{ count }})</span>
    <div class="st-tray">
      <img v-for="token in tokens" :key="token.id" :src="token.src" :alt="token.name" class="st-token"
        draggable="true" @dragstart="emit('dragstart', token.id, $event)" />
    </div>
  </div>
</template>

<style scoped>
.support-tracker {
  display: flex;
  align-items: center;
  gap: 10px;
  background: rgba(0, 0, 0, 0.18);
  border-radius: 8px;
  padding: 6px 10px;
}

.st-label {
  color: #cac9ae;
  font-size: 0.78rem;
  font-weight: 600;
  white-space: nowrap;
}

.st-tray {
  display: flex;
  gap: 6px;
}

.st-token {
  width: 28px;
  height: 28px;
  border-radius: 4px;
  cursor: grab;
}
</style>
