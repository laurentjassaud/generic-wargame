<script setup>
// ═══════════════════════════════════════════════════════════════════════════
// GameEndModal.vue — FIN DE PARTIE : bravo au vainqueur et récapitulatif des
// points de victoire tour par tour (cf. lib/useVictoryPoints.js, `byTurn`).
//
// Ouverte par HexMap.vue dans trois cas :
//   - un camp CONCÈDE la partie (bouton de la barre d'outils) ;
//   - Blitz : la pendule d'un camp est tombée à 0 ;
//   - la Fin de tour du DERNIER tour de la piste est atteinte : le vainqueur
//     est le camp qui a le plus de points (égalité : match nul).
// Le composant ne décide de rien : HexMap.vue lui passe le vainqueur, la
// raison et les lignes du tableau, il ne fait que les AFFICHER.
//
// Mode `confirm` : même fenêtre, mais pour DEMANDER la concession avant de
// l'appliquer (boutons Annuler / Concéder, évènement `confirm`).
//
// BLOQUANTE (overlay), comme VictoryModal.vue.
import { computed, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  // 'concede' | 'blitz' | 'end' — ce qui a mis fin à la partie.
  reason: { type: String, default: 'end' },
  // Libellés des camps (cf. HexMap.vue::sideLabel) : vainqueur (`null` pour
  // un match nul) et perdant (concession, Blitz).
  winner: { type: String, default: null },
  loser: { type: String, default: null },
  // Camps du tableau, dans l'ordre du module : `[{ key, label }]`.
  sides: { type: Array, default: () => [] },
  // Points par tour : `[{ turn, points: { [camp]: n } }]` (cf. `byTurn`).
  rows: { type: Array, default: () => [] },
  // Totaux par camp : `{ [camp]: n }`.
  totals: { type: Object, default: () => ({}) },
  // Demande de confirmation d'une concession (cf. l'en-tête) : libellé du
  // camp qui concéderait.
  confirmSide: { type: String, default: null },
})

const emit = defineEmits(['close', 'confirm'])

function onKey(event) {
  if (event.key === 'Escape') emit('close')
  else if (event.key === 'Enter' && !props.confirmSide) emit('close')
}
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))

/** Phrase sous le titre : comment la partie s'est terminée. */
const reasonKey = computed(() => ({ concede: 'gameEnd.byConcession', blitz: 'gameEnd.byTime' }[props.reason] ?? 'gameEnd.byTurns'))
</script>

<template>
  <div class="ge-overlay" @click.self="emit('close')">
    <div class="ge-modal" role="alertdialog" aria-labelledby="ge-title">
      <template v-if="confirmSide">
        <h3 id="ge-title">{{ $t('gameEnd.confirmTitle') }}</h3>
        <p>{{ $t('gameEnd.confirmMessage', { side: confirmSide }) }}</p>
        <footer class="ge-foot">
          <button type="button" class="ge-cancel" @click="emit('close')">{{ $t('common.cancel') }}</button>
          <button type="button" class="ge-ok" @click="emit('confirm')">{{ $t('gameEnd.concede') }}</button>
        </footer>
      </template>
      <template v-else>
        <h3 id="ge-title">{{ $t('gameEnd.title') }}</h3>
        <p class="ge-bravo">{{ winner ? $t('gameEnd.bravo', { side: winner }) : $t('gameEnd.draw') }}</p>
        <p class="ge-reason">{{ $t(reasonKey, { side: loser ?? '' }) }}</p>
        <table v-if="sides.length" class="ge-table">
          <thead>
            <tr>
              <th>{{ $t('gameEnd.turn') }}</th>
              <th v-for="side in sides" :key="side.key">{{ side.label }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.turn">
              <td>{{ row.turn }}</td>
              <td v-for="side in sides" :key="side.key" class="ge-num">{{ row.points[side.key] || '—' }}</td>
            </tr>
            <tr v-if="!rows.length">
              <td :colspan="sides.length + 1" class="ge-empty">{{ $t('gameEnd.noPoints') }}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <th>{{ $t('gameEnd.total') }}</th>
              <th v-for="side in sides" :key="side.key" class="ge-num">{{ totals[side.key] ?? 0 }}</th>
            </tr>
          </tfoot>
        </table>
        <footer class="ge-foot">
          <button type="button" class="ge-ok" @click="emit('close')">{{ $t('common.gotIt') }}</button>
        </footer>
      </template>
    </div>
  </div>
</template>

<style scoped>
.ge-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-overlay);
  background: var(--black-a50);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.ge-modal {
  width: min(460px, 100%);
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  background: var(--panel-bg);
  color: var(--panel-text);
  border-radius: var(--radius-12);
  border-top: 4px solid var(--color-gold);
  box-shadow: var(--shadow-modal);
  padding: 14px 18px 16px;
}

.ge-modal h3 {
  margin: 0 0 8px;
  font-size: var(--font-size-095);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-gold);
}

.ge-modal p {
  margin: 0 0 8px;
  font-size: var(--font-size-085);
}

.ge-bravo {
  font-size: var(--font-size-095) !important;
  font-weight: 700;
}

.ge-reason {
  color: var(--panel-text-muted);
}

.ge-table {
  display: block;
  overflow-y: auto;
  border-collapse: collapse;
  background: var(--white-a06);
  border-radius: var(--radius-8);
  font-size: var(--font-size-080);
}

.ge-table thead,
.ge-table tbody,
.ge-table tfoot {
  display: table;
  width: 100%;
  table-layout: fixed;
}

.ge-table th,
.ge-table td {
  padding: 4px 10px;
  text-align: left;
}

.ge-table tfoot th {
  border-top: 1px solid var(--white-a06);
  color: var(--color-gold);
}

.ge-num {
  text-align: right !important;
  font-variant-numeric: tabular-nums;
}

.ge-empty {
  color: var(--panel-text-muted);
  font-style: italic;
}

.ge-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}

.ge-ok,
.ge-cancel {
  border: none;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  font-size: var(--font-size-082);
  padding: 8px 20px;
  border-radius: var(--radius-8);
  cursor: pointer;
}

.ge-ok {
  background: var(--color-gold);
  color: var(--panel-bg);
}

.ge-cancel {
  background: var(--white-a06);
  color: var(--panel-text);
}

.ge-ok:hover,
.ge-cancel:hover {
  filter: brightness(1.08);
}
</style>
