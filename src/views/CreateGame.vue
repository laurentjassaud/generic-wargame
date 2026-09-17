<script setup>
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { createGame } from '../lib/api.js'
import GameSetupSteps from '../components/GameSetupSteps.vue'
import { defaultSettings, timingNeedsValue } from '../lib/gameSettings.js'

const router = useRouter()

// Mêmes étapes que la partie en local (cf. GameSetupSteps.vue), plus le
// nombre de joueurs de la room.
const step = ref(1)
const totalSteps = 5

const selectedModuleId = ref('')
const selectedModule = ref(null) // full module JSON, fetched once chosen
const settings = ref(defaultSettings())
const maxPlayers = ref(2)

const loadingModule = ref(false)
const submitting = ref(false)
const error = ref('')

const playerRange = computed(() => ({
  min: selectedModule.value?.minPlayers ?? 2,
  max: selectedModule.value?.maxPlayers ?? 2,
}))

// Le module complet n'est chargé que pour connaître sa plage de joueurs.
watch(selectedModuleId, async (id) => {
  loadingModule.value = true
  error.value = ''
  try {
    const index = await fetch('/modules/index.json', { cache: 'no-store' }).then((res) => res.json())
    const entry = index.find((moduleEntry) => moduleEntry.id === id)
    selectedModule.value = await fetch(entry.path, { cache: 'no-store' }).then((res) => res.json())
    maxPlayers.value = playerRange.value.min
  } catch {
    error.value = "Impossible de charger ce module."
  } finally {
    loadingModule.value = false
  }
})

const canNext = computed(() => {
  if (step.value === 1) return !!selectedModule.value && !loadingModule.value
  if (step.value === 4 && timingNeedsValue(settings.value.timing)) return !!settings.value.timingValue
  if (step.value === 5) return maxPlayers.value >= playerRange.value.min && maxPlayers.value <= playerRange.value.max
  return true
})

function next() {
  if (step.value < totalSteps) step.value += 1
}
function back() {
  if (step.value > 1) step.value -= 1
}

async function submit() {
  submitting.value = true
  error.value = ''
  try {
    const game = await createGame({
      moduleId: selectedModuleId.value,
      scenarioId: settings.value.scenario,
      settings: settings.value,
      maxPlayers: maxPlayers.value,
    })
    router.push({ name: 'games-list', query: { created: game.id, passcode: game.passcode } })
  } catch (requestError) {
    error.value = requestError.message
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="wizard">
    <h1>Créer une partie en ligne</h1>
    <p class="step-indicator">Étape {{ step }} / {{ totalSteps }}</p>

    <GameSetupSteps v-model:module-id="selectedModuleId" v-model:settings="settings" :step="step">
      <template #module-status>
        <p v-if="loadingModule">Chargement du module…</p>
      </template>
    </GameSetupSteps>

    <section v-if="step === 5">
      <h2>5. Nombre de joueurs</h2>
      <input
        type="number"
        v-model.number="maxPlayers"
        :min="playerRange.min"
        :max="playerRange.max"
      />
      <p class="hint">Entre {{ playerRange.min }} et {{ playerRange.max }} joueurs pour ce module.</p>
    </section>

    <p v-if="error" class="error">{{ error }}</p>

    <div class="actions">
      <button type="button" :disabled="step === 1" @click="back">Retour</button>
      <button v-if="step < totalSteps" type="button" :disabled="!canNext" @click="next">Suivant</button>
      <button v-else type="button" :disabled="!canNext || submitting" @click="submit">
        {{ submitting ? 'Création…' : 'Créer la partie' }}
      </button>
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
  color: #666;
  margin-top: -8px;
}
.hint {
  color: #666;
  font-size: 0.9em;
}
.error {
  color: #b91c1c;
}
.actions {
  display: flex;
  justify-content: space-between;
  margin-top: 24px;
}
</style>
