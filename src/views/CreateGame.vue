<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { createGame } from '../lib/api.js'

const router = useRouter()

const step = ref(1)
const totalSteps = 4

const modules = ref([])
const selectedModule = ref(null) // full module JSON, fetched once chosen
const selectedModuleId = ref('')

const selectedScenarioId = ref('')
const selectedVariantIds = ref([])
const maxPlayers = ref(2)

const loadingModule = ref(false)
const submitting = ref(false)
const error = ref('')

onMounted(async () => {
  const res = await fetch('/modules/index.json', { cache: 'no-store' })
  modules.value = await res.json()
})

// Le module peut déclarer ses propres scénarios/variantes ; sinon on retombe
// sur un scénario par défaut et aucune variante, pour rester compatible avec
// les modules qui n'ont pas encore ce schéma (ex: arnhem.json actuel).
const scenarios = computed(() => {
  if (selectedModule.value?.scenarios?.length) return selectedModule.value.scenarios
  return [{ id: 'default', name: 'Scénario standard' }]
})
const variants = computed(() => selectedModule.value?.variants ?? [])
const playerRange = computed(() => ({
  min: selectedModule.value?.minPlayers ?? 2,
  max: selectedModule.value?.maxPlayers ?? 2,
}))

async function chooseModule(mod) {
  selectedModuleId.value = mod.id
  loadingModule.value = true
  error.value = ''
  try {
    const res = await fetch(mod.path, { cache: 'no-store' })
    selectedModule.value = await res.json()
    selectedScenarioId.value = scenarios.value[0].id
    maxPlayers.value = playerRange.value.min
  } catch {
    error.value = "Impossible de charger ce module."
  } finally {
    loadingModule.value = false
  }
}

function toggleVariant(id) {
  const variantIndex = selectedVariantIds.value.indexOf(id)
  if (variantIndex === -1) selectedVariantIds.value.push(id)
  else selectedVariantIds.value.splice(variantIndex, 1)
}

const canNext = computed(() => {
  if (step.value === 1) return !!selectedModuleId.value && !loadingModule.value
  if (step.value === 2) return !!selectedScenarioId.value
  if (step.value === 4) return maxPlayers.value >= playerRange.value.min && maxPlayers.value <= playerRange.value.max
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
      scenarioId: selectedScenarioId.value,
      variants: selectedVariantIds.value,
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
    <h1>Créer une partie</h1>
    <p class="step-indicator">Étape {{ step }} / {{ totalSteps }}</p>

    <section v-if="step === 1">
      <h2>1. Choisir le module</h2>
      <ul class="choice-list">
        <li v-for="mod in modules" :key="mod.id">
          <button
            type="button"
            :class="{ selected: selectedModuleId === mod.id }"
            :disabled="mod.active === false"
            @click="chooseModule(mod)"
          >
            {{ mod.name }}
            <span v-if="mod.active === false" class="badge">Bientôt disponible</span>
          </button>
        </li>
      </ul>
      <p v-if="loadingModule">Chargement du module…</p>
    </section>

    <section v-else-if="step === 2">
      <h2>2. Choisir le scénario</h2>
      <ul class="choice-list">
        <li v-for="sc in scenarios" :key="sc.id">
          <button
            type="button"
            :class="{ selected: selectedScenarioId === sc.id }"
            @click="selectedScenarioId = sc.id"
          >
            {{ sc.name }}
          </button>
        </li>
      </ul>
    </section>

    <section v-else-if="step === 3">
      <h2>3. Variantes et règles spéciales</h2>
      <ul v-if="variants.length" class="choice-list">
        <li v-for="variant in variants" :key="variant.id">
          <label class="checkbox-choice">
            <input
              type="checkbox"
              :checked="selectedVariantIds.includes(variant.id)"
              @change="toggleVariant(variant.id)"
            />
            {{ variant.name }}
          </label>
        </li>
      </ul>
      <p v-else>Ce module ne propose pas de variante — passe à l'étape suivante.</p>
    </section>

    <section v-else-if="step === 4">
      <h2>4. Nombre de joueurs</h2>
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
.choice-list {
  list-style: none;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.choice-list button {
  width: 100%;
  text-align: left;
  padding: 10px 12px;
  border: 1px solid #ccc;
  border-radius: 6px;
  background: white;
  cursor: pointer;
}
.choice-list button.selected {
  border-color: #2563eb;
  background: #eff6ff;
}
.choice-list button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
.badge {
  margin-left: 8px;
  font-size: 0.75em;
  color: #666;
}
.checkbox-choice {
  display: flex;
  align-items: center;
  gap: 8px;
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
