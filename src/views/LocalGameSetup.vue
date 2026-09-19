<script setup>
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import GameSetupSteps from '../components/GameSetupSteps.vue'
import { defaultSettings, timingNeedsValue } from '../lib/gameSettings.js'

const router = useRouter()

const step = ref(1)
const totalSteps = 4

const selectedModuleId = ref('')
const settings = ref(defaultSettings())

const canNext = computed(() => {
  if (step.value === 1) return !!selectedModuleId.value
  if (step.value === 4 && timingNeedsValue(settings.value.timing)) return !!settings.value.timingValue
  return true
})

function next() {
  if (step.value < totalSteps) step.value += 1
}
function back() {
  if (step.value > 1) step.value -= 1
}

function start() {
  router.push({
    name: 'demo-play',
    query: { module: selectedModuleId.value, ...settings.value },
  })
}
</script>

<template>
  <div class="wizard">
    <h1>Partie en local</h1>
    <p class="step-indicator">Étape {{ step }} / {{ totalSteps }}</p>

    <GameSetupSteps v-model:module-id="selectedModuleId" v-model:settings="settings" :step="step" />

    <div class="actions">
      <button type="button" :disabled="step === 1" @click="back">Retour</button>
      <button v-if="step < totalSteps" type="button" :disabled="!canNext" @click="next">Suivant</button>
      <button v-else type="button" :disabled="!canNext" @click="start">Lancer la partie</button>
    </div>
  </div>
</template>

<style scoped>
.wizard {
  max-width: 480px;
  margin: 0 auto;
  padding: 24px 16px;
}
.step-indicator {
  color: var(--light-text-muted);
  margin-top: -8px;
}
.actions {
  display: flex;
  justify-content: space-between;
  margin-top: 24px;
}
</style>
