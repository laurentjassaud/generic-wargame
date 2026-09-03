<script setup>
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { listGames } from '../lib/api.js'

const route = useRoute()
const games = ref([])
const loading = ref(true)
const error = ref('')

// Juste après la création d'une partie, on affiche son passcode une seule
// fois (il n'est jamais renvoyé par l'API ensuite) pour que le créateur
// puisse le transmettre aux autres joueurs.
const justCreated = ref(
  route.query.created ? { id: route.query.created, passcode: route.query.passcode } : null
)

async function refresh() {
  loading.value = true
  error.value = ''
  try {
    games.value = await listGames()
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

onMounted(refresh)
</script>

<template>
  <div class="games-list">
    <header>
      <h1>Parties en cours</h1>
      <div class="header-links">
        <router-link to="/demo" class="button-link secondary">Partie en local</router-link>
        <router-link to="/create" class="button-link">Créer une partie</router-link>
      </div>
    </header>

    <p v-if="justCreated" class="passcode-banner">
      Partie créée ! Code d'accès pour la room <strong>{{ justCreated.id }}</strong> :
      <strong>{{ justCreated.passcode }}</strong> — transmets-le aux autres joueurs.
    </p>

    <p v-if="loading">Chargement…</p>
    <p v-if="error" class="error">{{ error }}</p>

    <ul v-if="!loading && games.length" class="cards">
      <li v-for="game in games" :key="game.id">
        <router-link :to="{ name: 'room-lobby', params: { id: game.id } }" class="card">
          <div class="card-title">{{ game.moduleId }} — {{ game.scenarioId }}</div>
          <div class="card-meta">
            {{ game.playerCount }} / {{ game.maxPlayers }} joueurs · {{ game.status }}
          </div>
          <div v-if="game.variants.length" class="card-variants">
            Variantes : {{ game.variants.join(', ') }}
          </div>
        </router-link>
      </li>
    </ul>
    <p v-else-if="!loading">Aucune partie en cours. Crée-en une !</p>
  </div>
</template>

<style scoped>
.games-list {
  max-width: 640px;
  margin: 0 auto;
  padding: 24px 16px;
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.header-links {
  display: flex;
  gap: 10px;
}
.button-link {
  padding: 8px 14px;
  border-radius: 6px;
  background: #2563eb;
  color: white;
  text-decoration: none;
}
.button-link.secondary {
  background: transparent;
  color: #2563eb;
  border: 1px solid #2563eb;
}
.passcode-banner {
  background: #ecfdf5;
  border: 1px solid #10b981;
  padding: 10px 14px;
  border-radius: 6px;
}
.error {
  color: #b91c1c;
}
.cards {
  list-style: none;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.card {
  display: block;
  border: 1px solid #ccc;
  border-radius: 6px;
  padding: 12px 14px;
  color: inherit;
  text-decoration: none;
}
.card:hover {
  border-color: #2563eb;
}
.card-title {
  font-weight: 600;
}
.card-meta {
  color: #666;
  font-size: 0.9em;
}
.card-variants {
  color: #666;
  font-size: 0.85em;
  margin-top: 4px;
}
</style>
