<script setup>
// Modale du SORT D'UN PONT (mode Assisté — cf. lib/useBridges.js, qui porte
// toute la règle : quels ponts, qui décide, ce que fait le dé). Elle sert les
// deux décisions, selon sa prop `mode` :
//   - 'demolition' : faire sauter un pont que l'ennemi borde. Le camp qui le
//     tient tente le coup (un dé) ou renonce ; dans les deux cas c'est sa
//     seule occasion, le pont ne se redemande plus jamais ;
//   - 'repair' : relever un pont démoli, par un génie qui a passé le tour
//     adverse tranquille. Pas de dé — il suffit de confirmer ; et refuser
//     n'engage que ce tour-ci, le pont restant réparable plus tard.
// Ce composant ne fait qu'AFFICHER l'occasion ouverte et renvoyer les deux
// intentions du camp décideur : "attempt" (tenter/réparer) et "decline".
//
// BLOQUANTE (overlay), comme PhaseBlockedModal.vue et contrairement à
// CombatModal.vue : la règle veut que la décision soit prise IMMÉDIATEMENT,
// et il n'y a rien à cliquer sur la carte en attendant. Pas de fermeture à
// l'échappement ni au clic extérieur pour la même raison : les deux réponses
// possibles sont des décisions de jeu, aucune n'est un "annuler".
//
// Le dé est purement décoratif pendant son roulement : la face retenue est
// celle que lib/useBridges.js::attempt a tirée, reçue ensuite par la prop
// `result` (même principe que CombatModal.vue).
import { computed, ref, watch } from 'vue'

const props = defineProps({
  // Laquelle des deux décisions cette modale présente (cf. l'en-tête).
  mode: { type: String, default: 'demolition' },
  // L'occasion à trancher — `{ key, label, hexes: ["0209", "0310"] }`, et
  // pour une réparation `unit` (le génie qui relèverait le pont). Cf.
  // lib/useBridges.js::current et ::currentRepair.
  bridge: { type: Object, default: null },
  // Résultat du jet, une fois lancé — `{ die, destroyed }`, ou `null` tant
  // que le camp décideur n'a pas tranché.
  result: { type: Object, default: null },
  // Faces du dé qui font sauter le pont (`rules.bridgeDemolition.destroyOn`),
  // pour l'annoncer avant le jet plutôt que de laisser deviner.
  destroyOn: { type: Array, default: () => [] },
  // En ligne, sur l'écran de CELUI QUI ATTEND : le camp décideur joue sur un
  // autre navigateur, il n'y a rien à cliquer ici.
  waiting: { type: Boolean, default: false },
})

const emit = defineEmits(['attempt', 'decline'])

const FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅']

// Animation du dé (cf. l'en-tête) : la valeur affichée pendant le roulement
// n'est jamais celle qui compte.
const rolling = ref(false)
const spinFace = ref(1)
let interval = null

// Une fois le résultat connu, on arrête le roulement.
watch(() => props.result, (result) => {
  if (!result) return
  rolling.value = false
  clearInterval(interval)
})

const repairing = computed(() => props.mode === 'repair')

function attempt() {
  if (rolling.value || props.result || props.waiting) return
  // Une réparation ne se joue pas aux dés : il n'y a qu'à confirmer.
  if (repairing.value) { emit('attempt'); return }
  rolling.value = true
  interval = setInterval(() => { spinFace.value = Math.floor(Math.random() * 6) + 1 }, 70)
  // Le tirage lui-même appartient à la règle : on le lui demande, et la prop
  // `result` revient avec la face retenue (cf. le watcher ci-dessus).
  emit('attempt')
}

/** "1 ou 2", "1", "1, 2 ou 3"… — les faces qui détruisent, en toutes lettres. */
const destroyOnLabel = computed(() => {
  const faces = props.destroyOn
  if (faces.length <= 1) return faces.join('')
  return faces.slice(0, -1).join(', ') + ' ou ' + faces[faces.length - 1]
})

/** Les deux hex que le pont relie, tels qu'imprimés sur la carte. */
const hexesLabel = computed(() => (props.bridge?.hexes ?? []).join(' – '))
</script>

<template>
  <div v-if="bridge" class="dm-overlay">
    <div class="dm-modal" :class="{ repair: repairing }" role="alertdialog" aria-labelledby="dm-title">
      <h3 id="dm-title">{{ repairing ? 'Réparation' : 'Démolition' }}</h3>

      <p v-if="repairing">
        <b>{{ bridge.unit?.name }}</b> a passé le tour adverse au calme et peut relever le
        <b>{{ bridge.label }}</b><span class="dm-hex">{{ hexesLabel }}</span>.
      </p>
      <p v-else>
        Une unité ennemie borde le <b>{{ bridge.label }}</b>
        <span class="dm-hex">{{ hexesLabel }}</span>.
      </p>

      <!-- En ligne, l'écran de celui qui n'a pas la décision : il attend. -->
      <p v-if="waiting && !result" class="dm-hint">
        {{ repairing ? 'En attente de la décision du joueur dont le génie tient ce pont…'
                     : 'En attente de la décision du joueur qui tient ce pont…' }}
      </p>

      <template v-else-if="!result">
        <p v-if="repairing" class="dm-hint">
          Le pont redeviendra franchissable et ne pourra plus être détruit. Refuser n'engage que ce
          tour-ci : il restera réparable.
        </p>
        <template v-else>
          <p class="dm-hint">
            C'est la seule occasion de le faire sauter : si le jet échoue, ou si vous y renoncez,
            le pont tiendra jusqu'à la fin de la partie.
          </p>
          <p class="dm-odds">Le pont est détruit sur un jet de <b>{{ destroyOnLabel }}</b>.</p>
        </template>
      </template>

      <!-- Le dé : en train de rouler, puis la face retenue et son effet.
           Une réparation ne s'y joue pas (cf. `attempt`). -->
      <div v-if="!repairing && (rolling || result)" class="dm-die" :class="{ spin: rolling }">
        {{ FACES[(result && !rolling ? result.die : spinFace) - 1] }}
      </div>
      <p v-if="result && !rolling" class="dm-result" :class="result.destroyed ? 'gone' : 'held'">
        <template v-if="repairing">Le pont est relevé. Il ne pourra plus être détruit.</template>
        <template v-else-if="result.destroyed">Le pont saute — l'obstacle est de nouveau à franchir.</template>
        <template v-else>Le pont tient. Il ne pourra plus être détruit.</template>
      </p>

      <footer v-if="!waiting && !result" class="dm-foot">
        <button type="button" class="dm-decline" :disabled="rolling" @click="emit('decline')">
          {{ repairing ? 'Laisser détruit' : 'Laisser intact' }}
        </button>
        <button type="button" class="dm-attempt" :disabled="rolling" @click="attempt">
          {{ repairing ? 'Réparer le pont' : 'Faire sauter le pont' }}
        </button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.dm-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-overlay);
  background: var(--black-a50);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.dm-modal {
  width: min(420px, 100%);
  background: var(--panel-bg);
  color: var(--panel-text);
  border-radius: var(--radius-12);
  border-top: 4px solid var(--color-red);
  box-shadow: var(--shadow-modal);
  padding: 14px 18px 16px;
  text-align: center;
}

/* Une réparation est une bonne nouvelle pour celui qui la décide : le liseré
   et le titre passent au vert, là où une démolition est rouge. */
.dm-modal.repair {
  border-top-color: var(--color-green);
}

.dm-modal.repair h3 {
  color: var(--color-green);
}

.dm-modal.repair .dm-attempt {
  background: var(--color-green);
}

.dm-modal h3 {
  margin: 0 0 8px;
  font-size: var(--font-size-095);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-red);
}

.dm-modal p {
  margin: 0 0 10px;
  font-size: var(--font-size-085);
  line-height: 1.4;
}

.dm-hex {
  color: var(--color-gold);
  font-variant-numeric: tabular-nums;
  margin-left: 6px;
}

.dm-hint {
  color: var(--panel-text-muted);
  font-size: var(--font-size-080);
}

.dm-odds {
  font-size: var(--font-size-080);
}

/* Le dé, comme dans CombatModal.vue : grand, centré, immobile une fois la
   face retenue affichée. */
.dm-die {
  font-size: var(--font-size-220);
  line-height: 1;
  margin: 4px 0 8px;
}

.dm-die.spin {
  opacity: 0.75;
}

.dm-result {
  font-weight: 700;
  font-size: var(--font-size-090);
}

.dm-result.gone {
  color: var(--color-red-light);
}

.dm-result.held {
  color: var(--color-green-light);
}

.dm-foot {
  display: flex;
  justify-content: center;
  gap: 10px;
  margin-top: 12px;
}

.dm-foot button {
  border: none;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  font-size: var(--font-size-082);
  padding: 8px 16px;
  border-radius: var(--radius-8);
  cursor: pointer;
}

.dm-foot button:disabled {
  opacity: 0.5;
  cursor: default;
}

.dm-decline {
  background: var(--white-a10);
  color: var(--panel-text);
}

.dm-attempt {
  background: var(--color-red);
  color: var(--color-white);
}

.dm-foot button:not(:disabled):hover {
  filter: brightness(1.12);
}
</style>
