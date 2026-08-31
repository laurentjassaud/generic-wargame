<script setup>
import { ref, onMounted } from 'vue'
import HexMap from './components/HexMap.vue'

// Le module = la boîte de jeu (nom, carte...), servi en JSON statique depuis
// public/modules/ (pas importé en JS) : on peut le remplacer sans rebuild.
// Pour jouer une autre partie, changer cette URL — le moteur (HexMap.vue)
// reste générique.


const MODULE_URL = '/modules/arnhem.json'
const module = ref(null)

onMounted(async () => {
  const res = await fetch(MODULE_URL)
  module.value = await res.json()
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
  padding: 16px;
  display: block;
}
</style>
