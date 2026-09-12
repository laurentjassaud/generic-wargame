<script setup>
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import HexMap from '../components/HexMap.vue'

// Chargement direct d'un module en local, sans passer par le lobby
// multijoueur — pratique pour tester le moteur de jeu (HexMap) seul.
// Le choix du module/scénario/options vient de l'assistant LocalGameSetup.vue
// (query string) ; si absent (accès direct à /demo), on retombe sur Arnhem.

const route = useRoute()
const module = ref(null)
const moduleId = ref('')

const scenarioLabels = { historique: 'Historique', 'placement-libre': 'Placement libre' }
const partyLabels = { libre: 'Libre', assiste: 'Assisté' }
const timingLabels = { libre: 'Libre', limite: 'Limité', blitz: 'Blitz' }

const scenarioLabel = scenarioLabels[route.query.scenario] ?? scenarioLabels.historique
const hasWeather = route.query.weather === '1'
const partyLabel = partyLabels[route.query.party] ?? partyLabels.libre
// "Assisté" est le seul mode qui active les garde-fous (grille, sélection au
// clic, restriction de tour — cf. lib/useAssisted.js) ; toute autre valeur
// (dont l'absence, cf. fallback de partyLabel ci-dessus) reste "Libre", le
// comportement par défaut de HexMap.vue.
const isAssistedParty = route.query.party === 'assiste'
const timingLabel = timingLabels[route.query.timing] ?? timingLabels.libre
const timingValue = route.query.timingValue || ''

onMounted(async () => {
  moduleId.value = route.query.module || 'arnhem'
  const index = await fetch('/modules/index.json', { cache: 'no-store' }).then((r) => r.json())
  const entry = index.find((m) => m.id === moduleId.value) ?? index.find((m) => m.id === 'arnhem')
  const res = await fetch(entry.path, { cache: 'no-store' })
  module.value = await res.json()
  document.title = module.value.name
  if (module.value.favicon) {
    let link = document.querySelector('link[rel="icon"]')
    if (!link) {
      link = document.createElement('link')
      link.rel = 'icon'
      document.head.appendChild(link)
    }
    link.href = module.value.favicon
  }
})
</script>

<template>
  <div class="app">
    <p v-if="module" class="setup-banner">
      Scénario : {{ scenarioLabel }}<span v-if="hasWeather"> · Météo activée</span>
      · Partie {{ partyLabel }} · Timing {{ timingLabel
      }}<span v-if="timingValue"> ({{ timingValue }} min)</span>
    </p>
    <HexMap v-if="module" :module="module" :module-id="moduleId" :assisted="isAssistedParty" />
  </div>
</template>

<style scoped>
.app {
  max-width: none;
  display: block;
}
.setup-banner {
  margin: 0;
  padding: 6px 12px;
  font-size: 0.85em;
  color: #444;
  background: #f3f4f6;
  border-bottom: 1px solid #ddd;
}
</style>
