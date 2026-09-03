<script setup>
// Contenu de l'onglet "Calendrier des renforts" — inspiré de
// ambush-tactique/src/components/PionsPanel.vue (liste de pions
// glissables) : chaque pion pas encore posé sur la carte (cf.
// HexMap.vue -> `reinforcements`) est affiché sous le tour où il arrive,
// glissable vers la carte pour le poser à son hex d'entrée.
import { computed } from 'vue'

const props = defineProps({
  reinforcements: { type: Array, required: true }, // pions avec `setup` non encore posés
})

const emit = defineEmits(['dragstart'])

/** Groupes { turn, items } triés par tour croissant. */
const groups = computed(() => {
  const byTurn = new Map()
  for (const c of props.reinforcements) {
    const turn = c.turn ?? 1
    if (!byTurn.has(turn)) byTurn.set(turn, [])
    byTurn.get(turn).push(c)
  }
  return [...byTurn.entries()].sort((a, b) => a[0] - b[0]).map(([turn, items]) => ({ turn, items }))
})
</script>

<template>
  <div class="rf-list">
    <p v-if="!reinforcements.length" class="rf-empty">Tous les renforts sont sur la carte.</p>
    <section v-for="g in groups" :key="g.turn" class="rf-turn">
      <h3 class="rf-turn-title">Tour {{ g.turn }}</h3>
      <div class="rf-grid">
        <figure v-for="c in g.items" :key="c.id" class="rf-piece" draggable="true"
          @dragstart="emit('dragstart', c.id, $event)">
          <img :src="c.src" :alt="c.name" width="48" height="48" draggable="false" />
          <figcaption>{{ c.name }} <span class="rf-hex">&rarr; {{ c.setup }}</span></figcaption>
        </figure>
      </div>
    </section>
    <p class="rf-hint">Glisser un pion sur la carte pour le poser à son hex d'entrée.</p>
  </div>
</template>

<style scoped>
.rf-list {
  display: flex;
  flex-direction: column;
  gap: 18px;
  font-size: 0.85rem;
}
.rf-empty {
  opacity: 0.75;
}
.rf-turn-title {
  margin: 0 0 8px;
  font-size: 0.95rem;
  font-weight: 600;
}
.rf-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(64px, 1fr));
  gap: 10px;
}
.rf-piece {
  margin: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  cursor: grab;
  text-align: center;
}
.rf-piece img {
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.15);
}
.rf-piece figcaption {
  font-size: 0.68rem;
  line-height: 1.2;
  word-break: break-word;
}
.rf-hex {
  opacity: 0.75;
}
.rf-hint {
  font-size: 0.72rem;
  opacity: 0.75;
  line-height: 1.4;
  margin: 0;
}
</style>
