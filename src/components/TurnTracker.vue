<script setup>
// ═══════════════════════════════════════════════════════════════════════════
// TurnTracker.vue — piste de tour complète et autonome : état (pas courant),
// dérivés (tour, camp actif, dernier pas) et logique de contrôle (quelles
// factions peuvent être sélectionnées/déplacées au pas courant). Le module
// fournit `config` (module.turnTrack — { turns, order: [campKey...], sides:
// { [campKey]: {label, marker} } }) et `sides` (module.sides — regroupement
// des factions par camp jouable) ; sans `config`, le composant ne rend rien
// et `canControl` autorise tout (aucune restriction).
//
// Le parent (HexMap.vue) n'a besoin que de :
//  - écouter `turn` pour répercuter une avance LOCALE au serveur (multijoueur) ;
//  - écouter `change` pour connaître le tour courant ailleurs dans sa propre
//    logique (ex. régénération du soutien allié par tour) ;
//  - appeler `canControl(counter)` (exposé) pour restreindre sélection/glisser ;
//  - appeler `applyRemoteTurn(step)` (exposé) quand le serveur fait autorité.
// ═══════════════════════════════════════════════════════════════════════════

import { ref, computed, watch } from 'vue'

const props = defineProps({
  config: { type: Object, default: null },
  sides: { type: Object, default: null },
  // Pas courant déjà en cours (partie multijoueur reprise en route). Absent
  // (0) en solo/démo.
  initialStep: { type: Number, default: 0 },
  // Vrai pendant un rejeu de journal (cf. HexMap.vue::replayLocked) — bloque
  // le bouton "tour suivant", le pas courant n'avance alors que via
  // applyRemoteTurn (piloté par le lecteur de rejeu).
  disabled: { type: Boolean, default: false },
})

const emit = defineEmits([
  'turn',   // avance LOCALE (flèche cliquée) — le parent la répercute au serveur
  'change', // pas/tour/camp actif ont changé (local ou distant) — état dérivé complet
])

const currentStep = ref(props.initialStep)
const totalSteps = computed(() => (props.config ? props.config.turns * props.config.order.length : 0))
const currentTurn = computed(() => Math.floor(currentStep.value / (props.config?.order.length ?? 1)) + 1)
const activeSideKey = computed(() => props.config?.order[currentStep.value % props.config.order.length] ?? null)
const activeSideInfo = computed(() => (activeSideKey.value ? props.config.sides[activeSideKey.value] : null))
const isLastStep = computed(() => currentStep.value >= totalSteps.value - 1)

// Factions autorisées à être sélectionnées/déplacées au pas courant — celles
// du camp actif (cf. `sides`), ou aucune restriction si le module ne déclare
// ni piste de tour ni camps.
const activeFactions = computed(() => {
  if (!props.config || !props.sides) return null
  return props.sides[activeSideKey.value] ?? null
})
const canControl = (c) => !activeFactions.value || activeFactions.value.includes(c?.faction)

watch(
  [currentStep, activeFactions],
  () => emit('change', {
    step: currentStep.value,
    turn: currentTurn.value,
    activeSideKey: activeSideKey.value,
    activeFactions: activeFactions.value,
  }),
  { immediate: true },
)

function nextTurn() {
  if (!props.config || isLastStep.value || props.disabled) return
  currentStep.value += 1
  emit('turn', currentStep.value)
}

/** Applique un pas reçu d'un autre joueur (WebSocket) — ne réémet pas `turn`
 *  pour éviter une boucle avec le serveur (`change` part quand même, cf.
 *  watch ci-dessus, pour que le parent se resynchronise). */
function applyRemoteTurn(step) {
  currentStep.value = step
}

defineExpose({ applyRemoteTurn, canControl })
</script>

<template>
  <div v-if="config" class="turn-tracker">
    <div class="tt-track">
      <span v-for="t in config.turns" :key="t" class="tt-cell" :class="{ active: t === currentTurn }">
        {{ t }}
      </span>
    </div>
    <img v-if="activeSideInfo" :src="activeSideInfo.marker" :alt="activeSideInfo.label" class="tt-marker" />
    <span class="tt-side-label">{{ activeSideInfo?.label }}</span>
    <button class="tt-next" :disabled="isLastStep || disabled" title="Tour suivant" @click="nextTurn">&rarr;</button>
  </div>
</template>

<style scoped>
.turn-tracker {
  display: flex;
  align-items: center;
  gap: 10px;
  background: rgba(0, 0, 0, 0.18);
  border-radius: 8px;
  padding: 6px 10px;
}

.tt-track {
  display: flex;
  gap: 3px;
}

.tt-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.12);
  color: #cac9ae;
  font-size: 0.72rem;
  font-weight: 600;
}

.tt-cell.active {
  background: #e8c468;
  color: #2a2620;
}

.tt-marker {
  width: 28px;
  height: 28px;
  border-radius: 4px;
}

.tt-side-label {
  color: #cac9ae;
  font-size: 0.85rem;
  font-weight: 600;
  white-space: nowrap;
}

.tt-next {
  width: 28px;
  height: 28px;
  border-radius: 4px;
  border: none;
  background: #e8c468;
  color: #2a2620;
  font-size: 1rem;
  font-weight: 700;
  cursor: pointer;
}

.tt-next:disabled {
  background: rgba(255, 255, 255, 0.2);
  color: rgba(0, 0, 0, 0.4);
  cursor: default;
}
</style>
