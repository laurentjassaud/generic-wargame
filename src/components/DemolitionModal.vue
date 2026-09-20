<script setup>
// Modale de DÉMOLITION D'UN PONT (mode Assisté — cf. lib/useDemolition.js,
// qui porte toute la règle : quels ponts, qui décide, ce que fait le dé).
// Ce composant ne fait qu'AFFICHER l'occasion ouverte et renvoyer les deux
// intentions du camp décideur : "attempt" (tenter la destruction) et
// "decline" (renoncer — le pont tient alors pour le reste de la partie).
//
// BLOQUANTE (overlay), comme PhaseBlockedModal.vue et contrairement à
// CombatModal.vue : la règle veut que la décision soit prise IMMÉDIATEMENT,
// et il n'y a rien à cliquer sur la carte en attendant. Pas de fermeture à
// l'échappement ni au clic extérieur pour la même raison : les deux réponses
// possibles sont des décisions de jeu, aucune n'est un "annuler".
//
// Le dé est purement décoratif pendant son roulement : la face retenue est
// celle que lib/useDemolition.js::attempt a tirée, reçue ensuite par la prop
// `result` (même principe que CombatModal.vue).
import { computed, ref, watch } from 'vue'

const props = defineProps({
  // L'occasion à trancher — `{ key, label, hexes: ["0209", "0310"] }`, cf.
  // lib/useDemolition.js::current.
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

function attempt() {
  if (rolling.value || props.result || props.waiting) return
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
    <div class="dm-modal" role="alertdialog" aria-labelledby="dm-title">
      <h3 id="dm-title">Démolition</h3>

      <p>
        Une unité ennemie borde le <b>{{ bridge.label }}</b>
        <span class="dm-hex">{{ hexesLabel }}</span>.
      </p>

      <!-- En ligne, l'écran de celui qui n'a pas la décision : il attend. -->
      <p v-if="waiting && !result" class="dm-hint">
        En attente de la décision du joueur qui tient ce pont…
      </p>

      <template v-else-if="!result">
        <p class="dm-hint">
          C'est la seule occasion de le faire sauter : si le jet échoue, ou si vous y renoncez,
          le pont tiendra jusqu'à la fin de la partie.
        </p>
        <p class="dm-odds">Le pont est détruit sur un jet de <b>{{ destroyOnLabel }}</b>.</p>
      </template>

      <!-- Le dé : en train de rouler, puis la face retenue et son effet. -->
      <div v-if="rolling || result" class="dm-die" :class="{ spin: rolling }">
        {{ FACES[(result && !rolling ? result.die : spinFace) - 1] }}
      </div>
      <p v-if="result && !rolling" class="dm-result" :class="result.destroyed ? 'gone' : 'held'">
        <template v-if="result.destroyed">Le pont saute — l'obstacle est de nouveau à franchir.</template>
        <template v-else>Le pont tient. Il ne pourra plus être détruit.</template>
      </p>

      <footer v-if="!waiting && !result" class="dm-foot">
        <button type="button" class="dm-decline" :disabled="rolling" @click="emit('decline')">
          Laisser intact
        </button>
        <button type="button" class="dm-attempt" :disabled="rolling" @click="attempt">
          Faire sauter le pont
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
