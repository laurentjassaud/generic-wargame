<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()

const step = ref(1)
const totalSteps = 4

const modules = ref([])
const selectedModuleId = ref('')

const scenarioId = ref('historique')
const weather = ref(false)

// La météo est optionnelle en historique, mais obligatoire en placement
// libre (pas de conditions historiques connues à appliquer par défaut).
watch(scenarioId, (val) => {
  if (val === 'placement-libre') weather.value = true
})

const partyModeId = ref('libre')
const timingModeId = ref('libre')
const timingValue = ref(null)

const timingHints = {
  limite: 'Conseillé : 4 à 8 minutes / tour',
  blitz: 'Conseillé : 40 à 60 minutes',
}

// Une seule valeur saisie à la fois : on la réinitialise si l'utilisateur
// change de timing pour éviter de renvoyer une ancienne valeur incohérente.
watch(timingModeId, () => {
  timingValue.value = null
})

const error = ref('')

onMounted(async () => {
  const res = await fetch('/modules/index.json', { cache: 'no-store' })
  modules.value = await res.json()
})

function chooseModule(mod) {
  if (mod.active === false) return
  selectedModuleId.value = mod.id
}

const canNext = computed(() => {
  if (step.value === 1) return !!selectedModuleId.value
  if (step.value === 2) return !!scenarioId.value
  if (step.value === 4 && (timingModeId.value === 'limite' || timingModeId.value === 'blitz')) {
    return timingValue.value > 0
  }
  return true
})

function next() {
  if (step.value < totalSteps) step.value += 1
}
function back() {
  if (step.value > 1) step.value -= 1
}

function start() {
  error.value = ''
  router.push({
    name: 'demo-play',
    query: {
      module: selectedModuleId.value,
      scenario: scenarioId.value,
      weather: weather.value ? '1' : '0',
      party: partyModeId.value,
      timing: timingModeId.value,
      timingValue: timingValue.value ?? '',
    },
  })
}
</script>

<template>
  <div class="wizard">
    <h1>Partie en local</h1>
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
    </section>

    <section v-else-if="step === 2">
      <h2>2. Choisir le scénario</h2>
      <ul class="choice-list">
        <li>
          <button
            type="button"
            :class="{ selected: scenarioId === 'historique' }"
            @click="scenarioId = 'historique'"
          >
            Historique
          </button>
        </li>
        <li>
          <button
            type="button"
            :class="{ selected: scenarioId === 'placement-libre' }"
            @click="scenarioId = 'placement-libre'"
          >
            Placement libre
          </button>
        </li>
      </ul>
    </section>

    <section v-else-if="step === 3">
      <h2>3. Options</h2>
      <label class="checkbox-choice" :class="{ disabled: scenarioId === 'placement-libre' }">
        <input
          type="checkbox"
          v-model="weather"
          :disabled="scenarioId === 'placement-libre'"
        />
        Météo
      </label>
      <p v-if="scenarioId === 'placement-libre'" class="hint">
        Obligatoire pour le placement libre.
      </p>
    </section>

    <section v-else-if="step === 4">
      <h2>4. Mode de jeu</h2>

      <h3>Partie</h3>
      <ul class="choice-list">
        <li v-for="opt in [{ id: 'libre', label: 'Libre' }, { id: 'assiste', label: 'Assisté' }]" :key="opt.id">
          <label class="checkbox-choice">
            <input type="radio" name="party" :value="opt.id" v-model="partyModeId" />
            {{ opt.label }}
          </label>
        </li>
      </ul>

      <h3>Timing</h3>
      <ul class="choice-list">
        <li v-for="opt in [{ id: 'libre', label: 'Libre' }, { id: 'limite', label: 'Limité' }, { id: 'blitz', label: 'Blitz' }]" :key="opt.id">
          <label class="checkbox-choice">
            <input type="radio" name="timing" :value="opt.id" v-model="timingModeId" />
            {{ opt.label }}
          </label>
        </li>
      </ul>
      <div v-if="timingModeId === 'limite' || timingModeId === 'blitz'" class="timing-value">
        <label>
          Durée par tour (minutes)
          <input type="number" min="1" v-model.number="timingValue" />
        </label>
        <p class="hint">{{ timingHints[timingModeId] }}</p>
      </div>
    </section>

    <p v-if="error" class="error">{{ error }}</p>

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
.checkbox-choice.disabled {
  color: #999;
}
.hint {
  color: #666;
  font-size: 0.9em;
}
h3 {
  margin: 16px 0 8px;
  font-size: 1em;
}
.timing-value {
  margin-top: 12px;
}
.timing-value input {
  margin-left: 8px;
  width: 80px;
  padding: 4px 6px;
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
