<script setup>
// Modale de combat (mode Assisté, phase Combat — cf. lib/useCombat.js, qui
// porte TOUTE la logique : ce composant ne fait qu'AFFICHER ce qu'elle
// calcule et renvoyer deux intentions, "ferme" et "combats").
//
// Volontairement NON bloquante (pas d'overlay, comme RollModal.vue dont elle
// reprend le principe et le glisser-déposer) : pendant qu'elle est ouverte,
// le joueur doit pouvoir continuer à cliquer sur la CARTE pour désigner ses
// unités attaquantes — un overlay modal classique l'en empêcherait. Elle est
// déplaçable pour la même raison : elle ne doit jamais masquer
// définitivement l'hex qu'on veut cliquer.
import { ref, watch, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  // Numéros des hex cibles ("0512"...) — cf. useCombat.js::targetHexLabels.
  targetHexes: { type: Array, default: () => [] },
  // Toutes les unités ennemies des hex cibles, dont les facteurs de défense
  // s'additionnent — cf. useCombat.js::defenders.
  defenders: { type: Array, default: () => [] },
  // Pions attaquants désignés, dans l'ordre de sélection — cf. useCombat.js::attackers.
  attackers: { type: Array, default: () => [] },
  // Le combat est-il résoluble (au moins un attaquant, aucune unité
  // orpheline) ? — cf. useCombat.js::canResolve.
  canResolve: { type: Boolean, default: false },
  // Unités amies qui ne pourraient plus attaquer, et hex ennemis qui ne
  // pourraient plus être attaqués, si ce combat avait lieu (`{ id, side,
  // name, hex }`, `side` = 'friendly' | 'enemy') — cf. useCombat.js::strandedUnits.
  strandedUnits: { type: Array, default: () => [] },
  attackStrength: { type: Number, default: 0 },
  defenseStrength: { type: Number, default: 0 },
  differential: { type: Number, default: 0 },
  // `{ row: { key, label, shift }, reason }` — ligne de la table retenue et
  // pourquoi (terrain de l'hex, ou hexside franchi par tous les attaquants).
  terrainRow: { type: Object, default: null },
  // Colonne de la table retenue (1-12), déjà décalée selon le terrain.
  column: { type: Number, default: null },
  // Résultat du dernier jet, ou `null` — cf. useCombat.js::combatResult.
  combatResult: { type: Object, default: null },
  // Les 4 lignes de terrain de la table, prêtes à afficher (cf. useCombat.js::crtRows).
  crtRows: { type: Array, default: () => [] },
  // Les 6 lignes de résultats (une par face du dé) — cf. useCombat.js::crtResults.
  crtResults: { type: Array, default: () => [] },
  // Retraite EN COURS après le jet (cf. useRetreat.js::info) — `{ name,
  // side, step, total, waiting }`, ou `null` s'il n'y en a pas (ou plus).
  retreat: { type: Object, default: null },
  // Ce qui s'est passé en appliquant le résultat (éliminations, retraites
  // terminées) — cf. useRetreat.js::notes.
  retreatNotes: { type: Array, default: () => [] },
  // Avance après combat EN COURS (cf. useRetreat.js::advanceInfo) — `{ name,
  // count }` (unité choisie ou `null`, nombre d'unités pouvant avancer), ou
  // `null` hors avance.
  advance: { type: Object, default: null },
})

// `end-advance` : bouton "Terminer l'avance" (cf. useRetreat.js::endAdvance).
// `reduce-retreat` : bouton de réduction de retraite (cf. useRetreat.js::reduce).
const emit = defineEmits(['close', 'fight', 'end-advance', 'reduce-retreat'])

const FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅']

// Animation du dé : purement décorative. La VALEUR retenue est celle tirée
// par useCombat.js::resolveCombat (émise via `fight` à la fin du roulement),
// jamais celle affichée pendant l'animation.
const rolling = ref(false)
const spinFace = ref(1)
let interval = null, timer = null, closeTimer = null

// Durée pendant laquelle le résultat reste affiché avant que la modale ne se
// ferme d'elle-même (le résultat reste consultable dans le journal).
const RESULT_DISPLAY_MS = 2500

/** Un combat ne se joue qu'UNE fois : pas de relance possible (cf.
 *  useCombat.js, qui fige alors le combat et marque les unités
 *  participantes). La fermeture automatique est gérée plus bas. */
function fight() {
  if (rolling.value || !props.canResolve || props.combatResult) return
  rolling.value = true
  interval = setInterval(() => { spinFace.value = Math.floor(Math.random() * 6) + 1 }, 55)
  timer = setTimeout(() => {
    clearInterval(interval); interval = null
    rolling.value = false
    emit('fight')
  }, 900)
}

// Fermeture automatique : peu après que le résultat est connu ET que toutes
// les retraites et l'avance qu'il entraîne sont faites (cf. props `retreat`
// et `advance`). Surveillé plutôt que programmé juste après `emit('fight')`,
// parce que les props ne sont mises à jour par le parent qu'au rendu
// suivant.
watch([() => props.combatResult, () => props.retreat, () => props.advance], () => {
  if (!props.combatResult || rolling.value || props.retreat || props.advance || closeTimer) return
  closeTimer = setTimeout(() => emit('close'), RESULT_DISPLAY_MS)
})

// --- Position flottante + glisser-déposer (repris de RollModal.vue) ---------
const pos = ref({ x: 0, y: 90 })
const dragging = ref(false)
let drag = null

function onDragStart(event) {
  if (event.target.closest('button')) return
  dragging.value = true
  drag = { mx: event.clientX, my: event.clientY, x: pos.value.x, y: pos.value.y }
  window.addEventListener('pointermove', onDragMove)
  window.addEventListener('pointerup', onDragEnd)
  event.preventDefault()
}
function onDragMove(event) {
  if (!dragging.value) return
  const nx = drag.x + (event.clientX - drag.mx)
  const ny = drag.y + (event.clientY - drag.my)
  pos.value = {
    x: Math.min(Math.max(-400, nx), (window.innerWidth || 1200) - 120),
    y: Math.min(Math.max(0, ny), (window.innerHeight || 800) - 90),
  }
}
function onDragEnd() {
  dragging.value = false
  drag = null
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', onDragEnd)
}

onMounted(() => {
  pos.value = { x: Math.max(20, (window.innerWidth || 1200) - 660), y: 90 }
})
onUnmounted(() => {
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', onDragEnd)
  clearInterval(interval)
  clearTimeout(timer)
  clearTimeout(closeTimer)
})
</script>

<template>
  <div class="combat-modal" :class="{ dragging }" :style="{ left: pos.x + 'px', top: pos.y + 'px' }"
    @pointerdown="onDragStart">
    <header class="cm-head">
      <span class="cm-title">Combat</span>
      <!-- Pas de fermeture pendant une retraite ou une avance : elles doivent
           aller à leur terme (l'avance se termine par son propre bouton). -->
      <button class="cm-close" title="Annuler le combat" :disabled="!!retreat || !!advance" @click="$emit('close')">&times;</button>
    </header>

    <div class="cm-forces">
      <!-- Défenseurs : TOUTES les unités ennemies des hex cibles (ajoutés /
           retirés en cliquant sur la carte), chacune avec son facteur de
           défense — le total est leur somme. -->
      <section class="cm-side cm-defender">
        <h4>Défenseurs <span class="cm-hexes">{{ targetHexes.join(', ') }}</span></h4>
        <div class="cm-units">
          <figure v-for="defender in defenders" :key="defender.id" class="cm-unit">
            <img :src="defender.src" :alt="defender.name" />
            <span class="cm-factor" title="Facteur de défense">{{ defender.def ?? 0 }}</span>
            <figcaption>{{ defender.name }}</figcaption>
          </figure>
        </div>
        <p class="cm-total">Défense <b>{{ defenseStrength }}</b></p>
      </section>

      <!-- Attaquants : ajoutés/retirés en cliquant sur la carte (leur hex
           passe en jaune), jamais depuis cette modale. -->
      <section class="cm-side cm-attackers">
        <h4>Attaquants</h4>
        <div class="cm-units">
          <figure v-for="attacker in attackers" :key="attacker.id" class="cm-unit">
            <img :src="attacker.src" :alt="attacker.name" />
            <span class="cm-factor" title="Facteur d'attaque">{{ attacker.atk ?? 0 }}</span>
            <figcaption>{{ attacker.name }}</figcaption>
          </figure>
          <p v-if="attackers.length === 0" class="cm-hint">
            Cliquez sur vos unités adjacentes à toutes les cibles.
          </p>
        </div>
        <p class="cm-total">Attaque <b>{{ attackStrength }}</b></p>
      </section>
    </div>

    <p class="cm-hint cm-tip">
      Cliquez sur une autre unité ennemie pour ajouter son hex au combat (chaque attaquant doit
      toucher tous les hex cibles), ou sur un hex cible pour le retirer.
    </p>

    <!-- Règle de participation (cf. useCombat.js::strandedUnits) : ce combat
         laisserait ces unités sans adversaire — "Combattre" reste grisé. -->
    <div v-if="strandedUnits.length" class="cm-stranded">
      <p>Combat impossible, il laisserait sans adversaire :</p>
      <ul>
        <li v-for="unit in strandedUnits" :key="unit.id">
          <b>{{ unit.name }}</b> ({{ unit.hex }}) —
          {{ unit.side === 'friendly' ? 'ne pourrait plus attaquer personne' : 'ne pourrait plus être attaqué par personne' }}
        </li>
      </ul>
      <p>Modifiez les attaquants ou les cibles.</p>
    </div>

    <p class="cm-diff">
      Différentiel <b>{{ differential > 0 ? '+' + differential : differential }}</b>
      <span v-if="terrainRow" class="cm-reason">
        — {{ terrainRow.row.label }} ({{ terrainRow.reason }}), colonne {{ column }}
      </span>
    </p>

    <!-- Table de combat (cf. images/combat-chart.png) : la ligne de terrain
         retenue et la colonne du différentiel sont surlignées en permanence,
         la case du résultat une fois le dé lancé. -->
    <table class="crt">
      <tbody>
        <tr v-for="row in crtRows" :key="row.key" :class="{ 'row-on': terrainRow && row.key === terrainRow.row.key }">
          <th>{{ row.label }}</th>
          <td v-for="columnNumber in 12" :key="columnNumber" :class="{ 'col-on': columnNumber === column }">{{ row.cells[columnNumber - 1] ?? '' }}</td>
        </tr>
        <tr v-for="(line, dieIndex) in crtResults" :key="'d' + dieIndex" class="crt-die">
          <th>Dé {{ dieIndex + 1 }}</th>
          <td v-for="(cell, columnIndex) in line" :key="columnIndex"
            :class="{ 'col-on': columnIndex + 1 === column, hit: combatResult && combatResult.die === dieIndex + 1 && combatResult.column === columnIndex + 1 }">
            {{ cell }}
          </td>
        </tr>
      </tbody>
    </table>

    <footer class="cm-foot">
      <div class="cm-roll">
        <span class="cm-die" :class="{ rolling, final: !rolling && combatResult }">
          {{ FACES[(rolling ? spinFace : combatResult?.die ?? 1) - 1] }}
        </span>
        <span v-if="combatResult && !rolling" class="cm-result">
          <b>{{ combatResult.result }}</b> — {{ combatResult.resultLabel }}
        </span>
      </div>
      <button class="cm-fight" :disabled="rolling || !canResolve || !!combatResult" @click="fight">
        {{ combatResult && !rolling ? 'Combat résolu' : 'Combattre' }}
      </button>
    </footer>

    <!-- Application du résultat (cf. useRetreat.js) : unité qui retraite
         maintenant, et ce qui s'est déjà passé. -->
    <section v-if="combatResult && !rolling && (retreat || advance || retreatNotes.length)" class="cm-retreat">
      <p v-if="retreat" class="cm-retreat-now">
        Retraite de <b>{{ retreat.name }}</b> ({{ retreat.side === 'defender' ? 'défenseur' : 'attaquant' }}) —
        hex {{ retreat.step }}/{{ retreat.total }} : cliquez sur un hex <span class="cm-red">rouge</span>.
        <span v-if="retreat.waiting" class="cm-retreat-wait">
          Ensuite : {{ retreat.waiting }} autre{{ retreat.waiting > 1 ? 's' : '' }} unité{{ retreat.waiting > 1 ? 's' : '' }}.
        </span>
      </p>
      <!-- Réduction facultative offerte par le module dans l'hex actuel
           (ex. hex City à Arnhem, cf. useArnhem.js::cityRetreatReduction). -->
      <button v-if="retreat?.reduction" class="cm-end-advance" @click="$emit('reduce-retreat')">
        {{ retreat.reduction.total < retreat.step ? `S'arrêter ici` : `Réduire la retraite à ${retreat.reduction.total} hex` }}
        ({{ retreat.reduction.reason }})
      </button>
      <ul v-if="retreatNotes.length">
        <li v-for="(note, noteIndex) in retreatNotes" :key="noteIndex">{{ note }}</li>
      </ul>
      <!-- Avance après combat (cf. useRetreat.js) : le chemin de retraite est
           en vert sur la carte. -->
      <div v-if="advance" class="cm-advance">
        <p v-if="advance.name">
          Avance de <b>{{ advance.name }}</b> : cliquez sur un hex <span class="cm-green">vert vif</span>,
          ou sur une autre unité victorieuse pour terminer la sienne.
        </p>
        <p v-else>
          Avance après combat : cliquez sur une unité victorieuse (contour <span class="cm-green">vert</span>),
          puis sur un hex du chemin de retraite.
        </p>
        <button class="cm-end-advance" @click="$emit('end-advance')">Terminer l'avance</button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.combat-modal {
  position: fixed;
  z-index: 950;
  width: 640px;
  background: #2a2620;
  color: #ece4d0;
  border-radius: 12px;
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.5);
  padding: 12px 16px 14px;
  cursor: move;
  touch-action: none;
  user-select: none;
}

.combat-modal.dragging {
  box-shadow: 0 22px 46px rgba(0, 0, 0, 0.6);
}

.cm-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.cm-title {
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  font-size: 0.9rem;
  color: #e8c468;
}

.cm-close {
  border: none;
  background: transparent;
  color: #cac9ae;
  font-size: 1.5rem;
  line-height: 1;
  cursor: pointer;
  padding: 0 4px;
}

.cm-close:hover:not(:disabled) {
  color: #fff;
}

.cm-close:disabled {
  opacity: 0.3;
  cursor: default;
}

.cm-retreat {
  margin-top: 10px;
  padding: 6px 8px;
  border-radius: 6px;
  border-left: 3px solid #e02828;
  background: rgba(224, 40, 40, 0.12);
  font-size: 0.78rem;
}

.cm-retreat p,
.cm-retreat ul {
  margin: 0;
}

.cm-retreat ul {
  margin-top: 4px;
  padding-left: 16px;
  color: #cac9ae;
}

.cm-red {
  color: #ff6b5b;
  font-weight: 700;
}

.cm-advance {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid rgba(46, 160, 67, 0.4);
  display: flex;
  align-items: center;
  gap: 10px;
}

.cm-advance p {
  flex: 1;
}

.cm-green {
  color: #5fd37a;
  font-weight: 700;
}

.cm-end-advance {
  border: none;
  background: #2ea043;
  color: #fff;
  font-weight: 700;
  font-size: 0.75rem;
  padding: 6px 12px;
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;
}

.cm-end-advance:hover {
  filter: brightness(1.1);
}

.cm-retreat-wait {
  color: #8f8b7a;
}

.cm-forces {
  display: flex;
  gap: 10px;
}

.cm-side {
  flex: 1;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 8px;
  padding: 8px;
  min-width: 0;
}

.cm-defender {
  border-left: 3px solid #ff8c00;
}

.cm-attackers {
  border-left: 3px solid #e8c468;
}

.cm-side h4 {
  margin: 0 0 6px;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #cac9ae;
}

.cm-units {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-height: 46px;
}

.cm-unit {
  position: relative;
  margin: 0;
  width: 44px;
  text-align: center;
}

/* Facteur (défense ou attaque) de l'unité, en pastille sur son pion. */
.cm-factor {
  position: absolute;
  top: -4px;
  right: -2px;
  min-width: 16px;
  padding: 0 3px;
  border-radius: 8px;
  background: #e8c468;
  color: #2a2620;
  font-size: 0.65rem;
  font-weight: 700;
  line-height: 16px;
}

.cm-defender .cm-factor {
  background: #ff8c00;
}

.cm-hexes {
  text-transform: none;
  letter-spacing: 0;
  color: #ff8c00;
  font-weight: 600;
  margin-left: 4px;
}

.cm-tip {
  margin: 6px 0 0;
}

.cm-unit img {
  width: 40px;
  height: 40px;
  border-radius: 3px;
  display: block;
  margin: 0 auto;
}

.cm-unit figcaption {
  font-size: 0.6rem;
  color: #cac9ae;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cm-hint {
  margin: 0;
  font-size: 0.72rem;
  color: #8f8b7a;
  font-style: italic;
}

.cm-total {
  margin: 6px 0 0;
  font-size: 0.8rem;
}

.cm-total b {
  color: #e8c468;
  font-size: 1rem;
}

.cm-stranded {
  margin: 8px 0 0;
  padding: 6px 8px;
  border-radius: 6px;
  border-left: 3px solid #e05a47;
  background: rgba(224, 90, 71, 0.14);
  color: #f3c2b8;
  font-size: 0.74rem;
}

.cm-stranded p {
  margin: 0;
}

.cm-stranded ul {
  margin: 2px 0;
  padding-left: 16px;
}

.cm-diff {
  margin: 10px 0 6px;
  font-size: 0.85rem;
}

.cm-diff b {
  color: #e8c468;
  font-size: 1.05rem;
}

.cm-reason {
  color: #8f8b7a;
  font-size: 0.76rem;
}

.crt {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.62rem;
  table-layout: fixed;
}

.crt th {
  text-align: left;
  font-weight: 600;
  color: #cac9ae;
  white-space: nowrap;
  width: 116px;
  padding: 1px 4px 1px 0;
  font-size: 0.6rem;
}

.crt td {
  text-align: center;
  padding: 1px 0;
  color: #b9b5a2;
  border: 1px solid transparent;
}

.crt .row-on th,
.crt .row-on td {
  background: rgba(232, 196, 104, 0.16);
  color: #ece4d0;
}

.crt .col-on {
  background: rgba(232, 196, 104, 0.16);
  color: #ece4d0;
}

.crt .row-on .col-on {
  background: rgba(232, 196, 104, 0.34);
}

.crt-die td {
  color: #9e9a89;
}

.crt td.hit {
  background: #ff8c00;
  color: #2a2620;
  font-weight: 700;
  border-color: #ffd9a0;
}

.cm-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 10px;
}

.cm-roll {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.cm-die {
  font-size: 2.2rem;
  line-height: 1;
}

.cm-die.rolling {
  animation: cm-spin 0.11s linear infinite;
}

.cm-die.final {
  color: #ff8c00;
}

@keyframes cm-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.cm-result {
  font-size: 0.8rem;
}

.cm-result b {
  color: #ff8c00;
}

.cm-fight {
  border: none;
  background: #ff8c00;
  color: #2a2620;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  font-size: 0.82rem;
  padding: 9px 20px;
  border-radius: 8px;
  cursor: pointer;
  white-space: nowrap;
}

.cm-fight:hover:not(:disabled) {
  filter: brightness(1.08);
}

.cm-fight:disabled {
  opacity: 0.45;
  cursor: default;
}
</style>
