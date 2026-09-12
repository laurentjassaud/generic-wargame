<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { getGame } from '../lib/api.js'
import { getSocket } from '../lib/socket.js'
import HexMap from '../components/HexMap.vue'

const props = defineProps({ id: { type: String, required: true } })

const storageKey = `wargame:room:${props.id}`

const loadingGame = ref(true)
const gameSummary = ref(null) // GET /api/games/:id result (moduleId, maxPlayers, players...)
const moduleData = ref(null) // module JSON complet (map/counters/terrain), pour le plateau une fois lancée
const sides = ref([])
const loadError = ref('')
const hexMapRef = ref(null)

const joined = ref(false)
const room = ref(null) // live room state pushed by the server (room:update / room:started)
const joinError = ref('')
const joining = ref(false)

const form = ref({ name: '', side: '', passcode: '' })

const takenSides = computed(() => new Set((room.value?.players ?? gameSummary.value?.players ?? []).map((p) => p.side)))
const availableSides = computed(() => sides.value.filter((s) => !takenSides.value.has(s)))

const ERROR_MESSAGES = {
  'not-found': "Cette partie n'existe pas (ou plus).",
  'bad-passcode': "Code d'accès incorrect.",
  'room-full': 'Cette room est déjà complète.',
  'side-taken': 'Ce camp est déjà pris par un autre joueur.',
  'already-started': 'Cette partie a déjà commencé.',
}

async function loadGame() {
  loadingGame.value = true
  loadError.value = ''
  try {
    gameSummary.value = await getGame(props.id)
    const modulesRes = await fetch('/modules/index.json', { cache: 'no-store' })
    const modules = await modulesRes.json()
    const modEntry = modules.find((m) => m.id === gameSummary.value.moduleId)
    if (modEntry) {
      const modRes = await fetch(modEntry.path, { cache: 'no-store' })
      const mod = await modRes.json()
      moduleData.value = mod
      // Un module regroupe ses factions (ex: commonwealth/us/pol) sous des
      // camps jouables via `sides` (ex: {"german":["german"],"allies":[...]})
      // — plusieurs factions peuvent partager un même camp en multijoueur.
      // À défaut (module sans ce champ), chaque faction devient son propre
      // camp, complété par des camps génériques pour avoir assez de choix.
      const factions = Object.keys(mod.counters ?? {})
      const campNames = mod.sides ? Object.keys(mod.sides) : factions
      const missing = Math.max(0, gameSummary.value.maxPlayers - campNames.length)
      sides.value = [...campNames, ...Array.from({ length: missing }, (_, i) => `Camp ${campNames.length + i + 1}`)]
    }
    form.value.side = availableSides.value[0] ?? ''
  } catch (e) {
    loadError.value = e.message
  } finally {
    loadingGame.value = false
  }
}

function attachSocketListeners() {
  const socket = getSocket()
  socket.on('room:update', (r) => {
    if (r.id === props.id) room.value = r
  })
  socket.on('room:started', (r) => {
    if (r.id === props.id) room.value = r
  })
  socket.on('game:move', ({ counterId, col, row }) => {
    hexMapRef.value?.applyRemoteMove(counterId, col, row)
  })
  socket.on('game:turn', ({ turnStep }) => {
    hexMapRef.value?.applyRemoteTurn(turnStep)
  })
  socket.on('connect', () => {
    // Reconnexion (auto par socket.io après coupure réseau) : on rejoint à
    // nouveau avec les mêmes identifiants pour que le serveur nous remarque
    // comme reconnecté au lieu de créer un nouveau siège.
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null')
    if (saved) doJoin(saved, true)
  })
}

function doJoin({ passcode, name, side, playerId }, silent = false) {
  return new Promise((resolve) => {
    joining.value = !silent
    joinError.value = ''
    getSocket().emit('game:join', { gameId: props.id, passcode, playerId, name, side }, (ack) => {
      joining.value = false
      if (ack.ok) {
        room.value = ack.room
        joined.value = true
        localStorage.setItem(storageKey, JSON.stringify({ passcode, name, side, playerId: ack.playerId }))
      } else if (!silent) {
        joinError.value = ERROR_MESSAGES[ack.error] ?? ack.error
      }
      resolve(ack)
    })
  })
}

async function submitJoin() {
  await doJoin({ ...form.value })
}

function onLocalMove({ counterId, col, row }) {
  getSocket().emit('game:move', { gameId: props.id, counterId, col, row })
}

function onLocalTurn() {
  // Le nouveau pas est déjà appliqué localement (optimiste, cf. HexMap.vue
  // -> nextTurn) ; le serveur incrémente sa propre copie et rediffuse la
  // valeur faisant autorité à tous les joueurs (soi-même inclus).
  getSocket().emit('game:turn', { gameId: props.id })
}

onMounted(async () => {
  attachSocketListeners()
  await loadGame()

  const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null')
  if (saved) {
    const ack = await doJoin(saved)
    if (ack.ok) return
    // Les identifiants sauvegardés ne fonctionnent plus (partie recréée,
    // code changé...) : on efface et on retombe sur le formulaire.
    localStorage.removeItem(storageKey)
  }
})

onUnmounted(() => {
  const socket = getSocket()
  socket.off('room:update')
  socket.off('room:started')
  socket.off('game:move')
  socket.off('game:turn')
  socket.off('connect')
})
</script>

<template>
  <div class="room-lobby">
    <div class="panel">
      <router-link to="/" class="back-link">&larr; Retour aux parties</router-link>

      <p v-if="loadingGame">Chargement de la partie…</p>
      <p v-else-if="loadError" class="error">{{ loadError }}</p>

      <template v-else>
        <h1>{{ gameSummary.moduleId }} — {{ gameSummary.scenarioId }}</h1>

        <form v-if="!joined" class="join-form" @submit.prevent="submitJoin">
          <label>
            Pseudo
            <input v-model.trim="form.name" required />
          </label>
          <label>
            Camp
            <select v-model="form.side" required>
              <option v-for="s in sides" :key="s" :value="s" :disabled="takenSides.has(s)">
                {{ s }}{{ takenSides.has(s) ? ' (pris)' : '' }}
              </option>
            </select>
          </label>
          <label>
            Code d'accès
            <input v-model.trim="form.passcode" required maxlength="6" style="text-transform: uppercase" />
          </label>
          <p v-if="joinError" class="error">{{ joinError }}</p>
          <button type="submit" :disabled="joining">{{ joining ? 'Connexion…' : 'Rejoindre la room' }}</button>
        </form>

        <div v-else class="lobby">
          <p v-if="room.status === 'lobby'" class="status waiting">
            En attente des autres joueurs… ({{ room.players.length }} / {{ gameSummary.maxPlayers }})
          </p>
          <p v-else class="status started">La partie est lancée !</p>

          <ul class="players">
            <li v-for="p in room.players" :key="p.id">
              <strong>{{ p.name }}</strong> — {{ p.side }}
              <span :class="['dot', p.connected ? 'online' : 'offline']" />
            </li>
          </ul>
        </div>
      </template>
    </div>

    <HexMap
      v-if="joined && room.status === 'started' && moduleData"
      ref="hexMapRef"
      class="board"
      :module="moduleData"
      :module-id="gameSummary.moduleId"
      :initial-positions="room.boardState"
      :initial-turn-step="room.turnStep ?? 0"
      @move="onLocalMove"
      @turn="onLocalTurn"
    />
  </div>
</template>

<style scoped>
.room-lobby {
  padding: 24px 16px;
}
.panel {
  max-width: 480px;
  margin: 0 auto;
}
.board {
  margin-top: 24px;
}
.back-link {
  color: #2563eb;
  text-decoration: none;
}
.join-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 16px;
}
.join-form label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.9em;
}
.join-form input,
.join-form select {
  padding: 8px 10px;
  border: 1px solid #ccc;
  border-radius: 6px;
}
.join-form button {
  padding: 10px 14px;
  border: none;
  border-radius: 6px;
  background: #2563eb;
  color: white;
  cursor: pointer;
}
.join-form button:disabled {
  opacity: 0.6;
  cursor: default;
}
.error {
  color: #b91c1c;
}
.status {
  padding: 10px 14px;
  border-radius: 6px;
  margin-top: 16px;
}
.status.waiting {
  background: #fffbeb;
  border: 1px solid #f59e0b;
}
.status.started {
  background: #ecfdf5;
  border: 1px solid #10b981;
}
.players {
  list-style: none;
  padding: 0;
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.players li {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid #ccc;
  border-radius: 6px;
  padding: 8px 12px;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-left: auto;
}
.dot.online {
  background: #10b981;
}
.dot.offline {
  background: #d1d5db;
}
</style>
