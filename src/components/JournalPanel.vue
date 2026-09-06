<script setup>
// ═══════════════════════════════════════════════════════════════════════════
// JournalPanel.vue — onglet "Journal" du panneau latéral (cf. SidePanel.vue) :
// historique de tout ce qui se passe en partie (tours, déplacements, entrées
// en jeu, éliminations...). Inspiré de ambush-tactique (LogPanel.vue +
// useGameLog.js), mais consolidé ici en un seul composant autonome — pas de
// composable séparé : HexMap.vue (le seul appelant) n'a qu'à récupérer une
// référence de template et appeler `log(kind, text)` à chaque évènement de
// jeu (cf. defineExpose plus bas), exactement comme pour TurnTracker.vue /
// SupportTracker.vue.
// ═══════════════════════════════════════════════════════════════════════════

import { ref, computed } from 'vue'

const emit = defineEmits(['loaded'])

const entries = ref([]) // { id, t: "14:32:05", kind, text, data } — plus récent en tête
let nextId = 1

// Ordre d'affichage seulement (le stockage interne reste toujours "plus
// récent en tête", cf. `entries` — inchangé pour ne pas perturber
// HexMap.vue::undo qui vise une entrée par id). 'desc' = position courante
// (comme avant) ; 'asc' = lecture depuis le début (plus ancien en tête).
const order = ref('desc')
const displayEntries = computed(() => (order.value === 'asc' ? [...entries.value].reverse() : entries.value))

/** Retourne l'id de l'entrée ajoutée — permet à l'appelant (cf.
 *  HexMap.vue::undo) de retirer précisément cette entrée plus tard sans
 *  toucher aux entrées ajoutées entre-temps (ex. un changement de tour).
 *  `data` (optionnel) porte tout ce qu'il faut pour rejouer l'action sur la
 *  carte (cf. HexMap.vue::applyReplayEntry) — pas juste le texte affiché. */
function log(kind, text, data) {
  const id = nextId++
  entries.value.unshift({ id, t: new Date().toLocaleTimeString('fr-FR'), kind, text, data })
  if (entries.value.length > 300) entries.value.pop()
  return id
}
function clear() {
  entries.value = []
}
/** Retire une entrée précise par id (cf. `log`), sans effet si déjà purgée. */
function remove(id) {
  const i = entries.value.findIndex((e) => e.id === id)
  if (i !== -1) entries.value.splice(i, 1)
}

/** Enregistre le journal au format JSON — ordre chronologique (du plus
 *  ancien au plus récent) dans le fichier, plus lisible/portable qu'un
 *  export "à l'envers" propre au stockage interne. */
function exportJournal() {
  const chronological = [...entries.value].reverse().map(({ t, kind, text, data }) => ({ t, kind, text, data }))
  const blob = new Blob([JSON.stringify(chronological, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `journal-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`
  a.click()
  URL.revokeObjectURL(url)
}

const fileInput = ref(null)
function triggerImport() {
  fileInput.value?.click()
}
/** Charge un journal JSON précédemment exporté (ordre chronologique dans le
 *  fichier). Le journal repart VIDE — les entrées ne réapparaissent qu'au
 *  fur et à mesure que HexMap.vue rejoue chaque ligne (lecteur ▶/⏭, cf.
 *  `revealEntry` ci-dessous) et bouge la carte en conséquence ; une fois le
 *  rejeu terminé, les nouveaux évènements de partie continuent de s'empiler
 *  dessus normalement via `log()`. Le bouton "Depuis le début"/"Position
 *  courante" ne fait que choisir l'ordre d'affichage (`order`). */
async function onFileChosen(ev) {
  const file = ev.target.files?.[0]
  ev.target.value = '' // permet de recharger le même fichier une seconde fois
  if (!file) return
  try {
    const text = await file.text()
    const parsed = JSON.parse(text)
    if (!Array.isArray(parsed)) throw new Error('le fichier ne contient pas une liste d\'évènements')
    const chronological = parsed.map((e) => ({
      t: e.t ?? '', kind: e.kind ?? 'info', text: e.text ?? '', data: e.data ?? null,
    }))
    entries.value = []
    emit('loaded', chronological)
  } catch (err) {
    alert('Impossible de charger ce journal : ' + err.message)
  }
}

/** Ajoute une entrée déjà rejouée sur la carte (cf. HexMap.vue::stepReplay /
 *  fastForwardReplay) — conserve son horodatage d'origine plutôt que
 *  l'heure courante, contrairement à `log()`. */
function revealEntry(entry) {
  entries.value.unshift({ id: nextId++, t: entry.t, kind: entry.kind, text: entry.text, data: entry.data })
}

defineExpose({ log, clear, remove, revealEntry })
</script>

<template>
  <div class="jn-list">
    <div class="jn-toolbar">
      <div class="jn-order">
        <button class="jn-btn" :class="{ on: order === 'asc' }" @click="order = 'asc'">Depuis le début</button>
        <button class="jn-btn" :class="{ on: order === 'desc' }" @click="order = 'desc'">Position courante</button>
      </div>
      <div class="jn-io">
        <button class="jn-btn" @click="exportJournal" :disabled="!entries.length">Enregistrer (JSON)</button>
        <button class="jn-btn" @click="triggerImport">Charger un journal</button>
        <input ref="fileInput" type="file" accept="application/json,.json" class="jn-file-input"
          @change="onFileChosen">
      </div>
    </div>

    <p v-if="!entries.length" class="jn-empty">Aucun évènement pour l'instant.</p>
    <div v-for="e in displayEntries" :key="e.id" class="jn-row" :class="'jn-' + e.kind">
      <span class="jn-t">{{ e.t }}</span><span class="jn-txt">{{ e.text }}</span>
    </div>
    <button v-if="entries.length" class="jn-clear" @click="clear">Vider le journal</button>
  </div>
</template>

<style scoped>
.jn-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 0.8rem;
}

.jn-empty {
  opacity: 0.75;
}

.jn-toolbar {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 4px;
}

.jn-order,
.jn-io {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.jn-btn {
  padding: 6px 10px;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.35);
  border-radius: 4px;
  font-size: 0.72rem;
  letter-spacing: 0.3px;
  color: inherit;
  cursor: pointer;
}

.jn-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.12);
}

.jn-btn.on {
  background: rgba(255, 255, 255, 0.25);
  border-color: rgba(255, 255, 255, 0.7);
}

.jn-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.jn-file-input {
  display: none;
}

.jn-row {
  display: flex;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.1);
  line-height: 1.35;
}

.jn-row.jn-turn {
  background: rgba(232, 196, 104, 0.22);
  font-weight: 600;
}

.jn-row.jn-eliminate {
  background: rgba(209, 26, 26, 0.2);
}

.jn-row.jn-place,
.jn-row.jn-return {
  background: rgba(46, 204, 113, 0.14);
}

.jn-t {
  opacity: 0.6;
  font-variant-numeric: tabular-nums;
  flex: none;
}

.jn-txt {
  flex: 1;
}

.jn-clear {
  align-self: flex-start;
  margin-top: 4px;
  padding: 6px 12px;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.35);
  border-radius: 4px;
  font-size: 0.72rem;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  color: inherit;
  cursor: pointer;
}

.jn-clear:hover {
  background: rgba(255, 255, 255, 0.12);
}
</style>
