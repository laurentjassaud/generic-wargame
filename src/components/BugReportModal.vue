<script setup>
// Modale "Signaler un bug" (cf. HexMap.vue, bouton de la barre d'outils) :
// le joueur saisit un titre et une description ; "Soumettre" ouvre, dans un
// nouvel onglet, la page de création de ticket GitHub PRÉ-REMPLIE avec ce
// texte, le contexte de la partie et un export compressé de l'état du jeu
// (cf. lib/bugReport.js, qui construit tout le rapport). Il ne reste qu'à la
// valider avec son compte GitHub, puis à revenir à la partie.
//
// "Soumettre" est un vrai LIEN (`<a target="_blank">`) plutôt qu'un
// `window.open` : l'export est compressé de façon asynchrone à l'ouverture de
// la modale, et une fenêtre ouverte après un `await` serait bloquée par
// certains navigateurs ; le lien, lui, est prêt avant le clic.
//
// Bloquante (overlay) : rien à cliquer sur la carte pendant la saisie. Un
// clic à côté ne la ferme PAS (le texte saisi serait perdu) : seuls
// "Annuler", le bouton de fermeture et Échap le font.
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { buildIssueUrl, prepareExport, REPORT_ENTRIES } from '../lib/bugReport.js'

const props = defineProps({
  // État du jeu à exporter (cf. HexMap.vue::bugReportSnapshot), avec ses
  // `entries` : les derniers coups du journal.
  snapshot: { type: Object, required: true },
  // Contexte lisible, `[[libellé, valeur], ...]` (module, réglages...).
  context: { type: Array, default: () => [] },
})

const emit = defineEmits(['close'])

const title = ref('')
const description = ref('')

// Export compressé (cf. lib/bugReport.js::prepareExport) — `null` pendant
// la compression, qui ne prend qu'un instant.
const exported = ref(null)
const failed = ref(false)

onMounted(async () => {
  window.addEventListener('keydown', onKey)
  try {
    exported.value = await prepareExport(props.snapshot)
  } catch {
    failed.value = true
  }
})
onUnmounted(() => window.removeEventListener('keydown', onKey))

function onKey(event) {
  if (event.key === 'Escape') emit('close')
}

/** Derniers coups en clair, du plus ancien au plus récent. */
const lines = computed(() => (props.snapshot.entries ?? []).map((entry) => `${entry.t ?? ''} · ${entry.text ?? entry.kind}`))

/** Ticket pré-rempli (cf. lib/bugReport.js::buildIssueUrl), ou `null` tant
 *  qu'il manque le titre ou l'export. */
const issue = computed(() => {
  if (!title.value.trim() || !exported.value) return null
  return buildIssueUrl({
    title: title.value, description: description.value, context: props.context, lines: lines.value, exported: exported.value,
  })
})

/** Clic sur "Soumettre" : le lien ouvre GitHub dans un nouvel onglet, puis
 *  la modale se ferme. Fermée au tour suivant seulement : retirer le lien du
 *  DOM pendant son propre clic pourrait annuler l'ouverture de l'onglet. */
function onSubmit(event) {
  if (!issue.value) {
    event.preventDefault()
    return
  }
  setTimeout(() => emit('close'), 0)
}
</script>

<template>
  <div class="br-overlay">
    <div class="br-modal" role="dialog" aria-labelledby="br-title">
      <header class="br-head">
        <h3 id="br-title">Signaler un bug</h3>
        <button type="button" class="br-close" title="Fermer" @click="emit('close')">&minus;</button>
      </header>
      <p class="br-text">
        Un export du jeu sera réalisé, et placé dans un rapport de bug GitHub. Il vous faut un compte GitHub pour
        poursuivre.
      </p>
      <p class="br-note br-orange">
        Cela ne vous prendra qu'un instant de signaler le bug et vous pourrez reprendre votre partie ensuite.
      </p>
      <p class="br-note br-red">
        L'export ne contiendra que les {{ REPORT_ENTRIES }} derniers coups, donc assurez-vous que votre problème s'y
        trouve, ou bien détaillez la marche à suivre pour le reproduire.
      </p>
      <input v-model="title" class="br-field" type="text" maxlength="120" placeholder="Un titre concis" />
      <textarea v-model="description" class="br-field" rows="3" placeholder="Ce qu'il s'est passé" />
      <!-- Ce que l'export a dû laisser de côté pour tenir dans l'URL GitHub. -->
      <p v-if="failed" class="br-warn">L'export du jeu n'a pas pu être préparé : décrivez le problème en détail.</p>
      <p v-else-if="exported && exported.count < (snapshot.entries?.length ?? 0)" class="br-warn">
        Pour tenir dans le rapport, l'export ne contient que les {{ exported.count }} derniers coups.
      </p>
      <p v-if="issue?.descriptionCut" class="br-warn">Description trop longue : elle sera tronquée dans le rapport.</p>
      <footer class="br-foot">
        <a class="br-btn" :class="{ disabled: !issue }" :href="issue?.url" target="_blank" rel="noopener noreferrer"
          :aria-disabled="!issue" @click="onSubmit">Soumettre</a>
        <button type="button" class="br-btn" @click="emit('close')">Annuler</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.br-overlay {
  position: fixed;
  inset: 0;
  z-index: 1100;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.br-modal {
  width: min(960px, 100%);
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: #3a3f4d;
  color: #eceae4;
  border: 1px solid #8a8f9c;
  border-radius: 14px;
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.5);
  padding: 0 12px 12px;
  overflow: hidden;
}

.br-head {
  position: relative;
  margin: 0 -12px;
  padding: 8px 48px;
  background: linear-gradient(#2c3a36, #2e3440);
  border-bottom: 1px solid #5a606c;
  text-align: center;
}

.br-head h3 {
  margin: 0;
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 1.7rem;
  font-weight: 700;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: #ffffff;
}

.br-close {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 50%;
  background: #5b6475;
  color: #ffffff;
  font-size: 1.1rem;
  line-height: 24px;
  padding: 0;
  cursor: pointer;
}

.br-close:hover {
  background: #717b8f;
}

.br-text,
.br-note,
.br-warn {
  margin: 0;
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 0.95rem;
  line-height: 1.45;
}

.br-note {
  padding: 8px 10px;
}

.br-orange {
  background: #a95f00;
}

.br-red {
  background: #a2252f;
}

.br-warn {
  color: #f0b35a;
  font-size: 0.85rem;
}

.br-field {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid #8a8f9c;
  border-radius: 2px;
  background: #3b3b3b;
  color: #eceae4;
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 1.1rem;
  resize: vertical;
}

.br-field::placeholder {
  color: #8d8d8d;
}

.br-field:focus {
  outline: 2px solid #6f95c9;
  outline-offset: -1px;
}

.br-foot {
  display: flex;
  gap: 10px;
}

.br-btn {
  padding: 6px 12px;
  border: none;
  border-radius: 2px;
  background: #6b6b6b;
  color: #ffffff;
  font-size: 1.25rem;
  text-decoration: none;
  cursor: pointer;
}

.br-btn:hover:not(.disabled) {
  background: #7d7d7d;
}

.br-btn.disabled {
  opacity: 0.55;
  cursor: default;
}
</style>
