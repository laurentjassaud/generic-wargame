<script setup>
// Modale d'avertissement : changement de phase refusé (mode Assisté).
//
// Ouverte par HexMap.vue::onPhaseNext quand le joueur veut quitter :
//  - la phase Mouvement alors que 2 unités amies ou plus occupent encore un
//    même hex (cf. lib/useAssisted.js::stackedHexes) ;
//  - la phase Combat alors qu'il reste des combats obligatoires en attente —
//    des unités amies et ennemies adjacentes qui n'ont, ni l'une ni l'autre,
//    combattu (cf. lib/useCombat.js::pendingEngagements).
// Ce composant ne fait qu'AFFICHER ces listes (seule celle qui n'est pas vide
// apparaît) et renvoyer l'intention "ferme".
//
// Réutilisée aussi par HexMap.vue::setSelectedCounter (props `title` et
// `stackMessage`) quand on veut quitter une unité en overstack pour en
// sélectionner une autre.
//
// Et par HexMap.vue pour le timing "Limité" (cf. MoveTimer.vue) : `title` et
// un message libre passé dans le slot par défaut, sans liste.
//
// Contrairement à CombatModal.vue, elle est BLOQUANTE (overlay) : c'est un
// simple message à acquitter, il n'y a rien à cliquer sur la carte pendant
// qu'elle est ouverte.
import { onMounted, onUnmounted } from 'vue'

defineProps({
  // `[{ key, friendly, friendlyHex, enemy, enemyHex }]` — cf.
  // useCombat.js::pendingEngagements.
  engagements: { type: Array, default: () => [] },
  // `[{ key, hex, units }]` — cf. useAssisted.js::stackedHexes.
  stacks: { type: Array, default: () => [] },
  title: { type: String, default: 'Impossible de changer de phase' },
  // Phrase affichée au-dessus de la liste `stacks`.
  stackMessage: {
    type: String,
    default: 'Plusieurs unités amies occupent le même hex. Déplacez-en une avant de terminer la phase Mouvement :',
  },
})

const emit = defineEmits(['close'])

function onKey(event) {
  if (event.key === 'Escape' || event.key === 'Enter') emit('close')
}
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="pb-overlay" @click.self="emit('close')">
    <div class="pb-modal" role="alertdialog" aria-labelledby="pb-title">
      <h3 id="pb-title">{{ title }}</h3>
      <p v-if="$slots.default"><slot /></p>
      <template v-if="stacks.length">
        <p>{{ stackMessage }}</p>
        <ul class="pb-list">
          <li v-for="stack in stacks" :key="stack.key">
            <span class="pb-hex">{{ stack.hex }}</span>
            <span class="pb-vs">—</span>
            <b>{{ stack.units.join(', ') }}</b>
          </li>
        </ul>
      </template>
      <p v-if="engagements.length">
        Des unités adjacentes de camps opposés n'ont pas encore combattu. Résolvez ces combats
        avant de terminer la phase Combat :
      </p>
      <ul v-if="engagements.length" class="pb-list">
        <li v-for="engagement in engagements" :key="engagement.key">
          <b>{{ engagement.friendly }}</b> <span class="pb-hex">{{ engagement.friendlyHex }}</span>
          <span class="pb-vs">↔</span>
          <b>{{ engagement.enemy }}</b> <span class="pb-hex">{{ engagement.enemyHex }}</span>
        </li>
      </ul>
      <footer class="pb-foot">
        <button type="button" class="pb-ok" @click="emit('close')">Compris</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.pb-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.pb-modal {
  width: min(460px, 100%);
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  background: #2a2620;
  color: #ece4d0;
  border-radius: 12px;
  border-top: 4px solid #ff8c00;
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.5);
  padding: 14px 18px 16px;
}

.pb-modal h3 {
  margin: 0 0 8px;
  font-size: 0.95rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #ff8c00;
}

.pb-modal p {
  margin: 0 0 10px;
  font-size: 0.85rem;
  line-height: 1.4;
}

.pb-list {
  margin: 0;
  padding: 8px 10px 8px 26px;
  overflow-y: auto;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 8px;
  font-size: 0.8rem;
}

/* Les deux listes (empilements, combats) ne coexistent jamais en pratique
   (phases différentes), mais on les sépare proprement si ça arrivait. */
.pb-list + p {
  margin-top: 12px;
}

.pb-list li + li {
  margin-top: 4px;
}

.pb-hex {
  color: #e8c468;
  font-variant-numeric: tabular-nums;
}

.pb-vs {
  color: #8f8b7a;
  margin: 0 6px;
}

.pb-foot {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}

.pb-ok {
  border: none;
  background: #ff8c00;
  color: #2a2620;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  font-size: 0.82rem;
  padding: 8px 20px;
  border-radius: 8px;
  cursor: pointer;
}

.pb-ok:hover {
  filter: brightness(1.08);
}
</style>
