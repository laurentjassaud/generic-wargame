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

import { ref, computed, watch, onMounted } from 'vue'

const props = defineProps({
  // Identifiant/nom du module en cours (cf. HexMap.vue) et tour courant —
  // utilisés uniquement pour composer l'index des sauvegardes (cf.
  // `saveLabel`) : "nomDuModule_date_turn" pour un export manuel,
  // "nomDuModule_save_date_turn" pour l'auto-save.
  moduleId: { type: String, default: 'module' },
  turn: { type: Number, default: 1 },
})

const emit = defineEmits(['loaded'])

const entries = ref([]) // { id, t: "14:32:05", kind, text, data } — plus récent en tête
let nextId = 1

/** "Arnhem: Op. Market-Garden" -> "arnhem-op-market-garden" — pour un index
 *  de sauvegarde utilisable comme nom de fichier ou clé de stockage. */
const DIACRITICS_RE = new RegExp('[\\u0300-\\u036f]', 'g') // marques diacritiques combinantes (accents) après normalize('NFD')
function slugify(s) {
  return (s || 'module')
    .normalize('NFD').replace(DIACRITICS_RE, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'module'
}
/** Index "nomDuModule_[save_]date_turn" (cf. demande utilisateur) — `save`
 *  seulement pour l'auto-save, pour la distinguer d'un export manuel qui
 *  porte le même schéma sans ce mot. */
function saveLabel(isAutosave) {
  const date = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
  const parts = [slugify(props.moduleId), ...(isAutosave ? ['save'] : []), date, `turn${props.turn}`]
  return parts.join('_')
}

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

/** Ordre chronologique (du plus ancien au plus récent) — plus lisible/
 *  portable qu'un export "à l'envers" propre au stockage interne. Partagé
 *  par l'export manuel et l'auto-save. */
function toChronological() {
  return [...entries.value].reverse().map(({ t, kind, text, data }) => ({ t, kind, text, data }))
}

/** Enregistre le journal au format JSON — nommé "nomDuModule_date_turn.json"
 *  (cf. `saveLabel`), un fichier téléchargé à chaque appel (contrairement à
 *  l'auto-save, qui n'en garde toujours qu'un seul — cf. plus bas). */
function exportJournal() {
  const blob = new Blob([JSON.stringify(toChronological(), null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${saveLabel(false)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

// --- Auto-save : un seul emplacement (clé localStorage fixe), écrasé à
// chaque mutation du journal — jamais plusieurs fichiers qui s'accumulent.
// L'index "nomDuModule_save_date_turn" demandé par l'utilisateur est gardé
// comme `label` DANS le contenu sauvegardé (affiché dans la toolbar,
// cf. template), pas comme clé de stockage — une clé qui changerait à
// chaque tour créerait justement les entrées multiples qu'on veut éviter.
const AUTOSAVE_KEY = 'generic-wargame:journal-autosave'
const lastAutosaveLabel = ref('')
let autosaveTimer = null
function autosaveNow() {
  const label = saveLabel(true)
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({
      label, savedAt: new Date().toISOString(), entries: toChronological(),
    }))
    lastAutosaveLabel.value = label
  } catch {
    // Stockage indisponible/plein (navigation privée, quota dépassé...) —
    // l'auto-save est un confort best-effort, pas une garantie ; on n'ennuie
    // pas l'utilisateur avec une erreur pour ça (contrairement au chargement
    // manuel, cf. `loadResult`).
  }
}
// Débounce léger : un tour qui change peut journaliser plusieurs lignes
// coup sur coup (ex. régénération du soutien) — un seul write suffit.
watch(entries, () => {
  clearTimeout(autosaveTimer)
  autosaveTimer = setTimeout(autosaveNow, 300)
}, { deep: true })

// --- Reprise de l'auto-save : l'auto-save ci-dessus écrit bien dans
// localStorage, mais rien ne le relisait jamais — la partie semblait donc
// "ne pas s'enregistrer" alors qu'elle s'écrasait juste en silence à chaque
// mutation. Au montage, on propose de reprendre la dernière auto-save SI
// elle correspond au module courant (préfixe du label, cf. `saveLabel`) —
// jamais automatique, pour ne pas écraser une partie qu'on voulait
// justement recommencer à zéro. Le rejeu lui-même passe par le même circuit
// qu'un import manuel (`emit('loaded', ...)`, cf. `onFileChosen`).
const pendingAutosave = ref(null) // { label, savedAt, entries } | null
onMounted(() => {
  try {
    const raw = JSON.parse(localStorage.getItem(AUTOSAVE_KEY) ?? 'null')
    if (raw?.entries?.length && raw.label?.startsWith(slugify(props.moduleId) + '_')) {
      pendingAutosave.value = raw
    }
  } catch {
    // Stockage indisponible/corrompu — pas d'auto-save à proposer.
  }
})
function resumeAutosave() {
  const save = pendingAutosave.value
  if (!save) return
  entries.value = []
  emit('loaded', save.entries)
  const count = save.entries.length
  loadResult.value = { type: 'success', message: `Sauvegarde auto reprise : ${count} évènement${count > 1 ? 's' : ''}.` }
  pendingAutosave.value = null
}
function dismissAutosave() {
  pendingAutosave.value = null
}

const fileInput = ref(null)
function triggerImport() {
  fileInput.value?.click()
}

// --- Modale bloquante de résultat de chargement (succès ou erreur) — cf.
// template plus bas. Remplace l'ancien `alert()` en cas d'erreur, et
// confirme désormais aussi le succès (silencieux auparavant). Un seul état
// à la fois ({ type, message } | null) : la modale se ferme uniquement via
// son bouton OK, jamais en cliquant le fond (volontairement bloquante).
const loadResult = ref(null)
function dismissLoadResult() {
  loadResult.value = null
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
    const count = chronological.length
    loadResult.value = { type: 'success', message: `Journal chargé : ${count} évènement${count > 1 ? 's' : ''}.` }
  } catch (err) {
    loadResult.value = { type: 'error', message: 'Impossible de charger ce journal : ' + err.message }
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
      <p v-if="lastAutosaveLabel" class="jn-autosave">Sauvegarde auto : {{ lastAutosaveLabel }}</p>
    </div>

    <div v-if="pendingAutosave" class="jn-resume">
      <p class="jn-resume-msg">Une partie en cours a été trouvée ({{ pendingAutosave.label }}).</p>
      <div class="jn-resume-btns">
        <button class="jn-btn" @click="resumeAutosave">Reprendre</button>
        <button class="jn-btn" @click="dismissAutosave">Ignorer</button>
      </div>
    </div>

    <p v-if="!entries.length" class="jn-empty">Aucun évènement pour l'instant.</p>
    <div v-for="e in displayEntries" :key="e.id" class="jn-row" :class="'jn-' + e.kind">
      <span class="jn-t">{{ e.t }}</span><span class="jn-txt">{{ e.text }}</span>
    </div>
    <button v-if="entries.length" class="jn-clear" @click="clear">Vider le journal</button>

    <div v-if="loadResult" class="jn-modal-backdrop">
      <div class="jn-modal" :class="'jn-modal-' + loadResult.type" role="alertdialog" aria-modal="true">
        <p class="jn-modal-title">{{ loadResult.type === 'success' ? 'Journal chargé' : 'Erreur de chargement' }}</p>
        <p class="jn-modal-msg">{{ loadResult.message }}</p>
        <button class="jn-btn jn-modal-ok" @click="dismissLoadResult">OK</button>
      </div>
    </div>
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

.jn-autosave {
  margin: 0;
  font-size: 0.7rem;
  opacity: 0.65;
  font-variant-numeric: tabular-nums;
}

.jn-resume {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  border-radius: 4px;
  background: rgba(232, 196, 104, 0.22);
  border: 1px solid rgba(232, 196, 104, 0.5);
}

.jn-resume-msg {
  margin: 0;
  line-height: 1.35;
}

.jn-resume-btns {
  display: flex;
  gap: 6px;
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

.jn-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2000;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
}

.jn-modal {
  width: min(90vw, 360px);
  background: #2a2620;
  color: #ece4d0;
  border-radius: 10px;
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.5);
  padding: 20px 22px;
  border-top: 4px solid #2ecc71;
}

.jn-modal-error {
  border-top-color: #d11a1a;
}

.jn-modal-title {
  margin: 0 0 8px;
  font-weight: 700;
  font-size: 1rem;
}

.jn-modal-msg {
  margin: 0 0 16px;
  font-size: 0.85rem;
  line-height: 1.4;
}

.jn-modal-ok {
  display: block;
  margin-left: auto;
  padding: 8px 20px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
</style>
