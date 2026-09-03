<script setup>
import { ref, onMounted } from 'vue'
import HexMap from '../components/HexMap.vue'

// Chargement direct d'un module en local, sans passer par le lobby
// multijoueur — pratique pour tester le moteur de jeu (HexMap) seul.

const MODULE_URL = '/modules/arnhem/arnhem.json'
const module = ref(null)

onMounted(async () => {
  const res = await fetch(MODULE_URL, { cache: 'no-store' })
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
    <HexMap v-if="module" :module="module" />
  </div>
</template>

<style scoped>
.app {
  max-width: none;
  display: block;
}
</style>
