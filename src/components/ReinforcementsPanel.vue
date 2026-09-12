<script setup>
// Contenu de l'onglet "Calendrier des renforts" — inspiré de
// ambush-tactique/src/components/PionsPanel.vue (liste de pions
// glissables) : chaque pion pas encore posé sur la carte (cf.
// HexMap.vue -> `reinforcements`) est affiché sous le tour où il arrive.
// Façon(s) de le faire entrer en jeu — dépend du mode de partie (prop
// `draggable`, cf. lib/useAssisted.js::draggable, portée par HexMap.vue) :
//  1. glisser l'image directement sur la carte, n'importe quel hex — mode
//     Libre uniquement (`draggable` vrai) ;
//  2. cliquer l'image (bordure orange ici) puis cliquer un des hex d'entrée
//     surlignés en orange sur la carte — toujours possible, mais SEULE
//     option en mode Assisté (`draggable` faux : le glisser est alors
//     désactivé ci-dessous, à la fois visuellement — attribut HTML
//     `draggable` retiré — et fonctionnellement, cf. le guard côté
//     HexMap.vue::onCounterDragStart qui refuserait de toute façon un
//     glisser qui aurait quand même démarré).
import { computed } from 'vue'

const props = defineProps({
  reinforcements: { type: Array, required: true }, // pions avec `setup` non encore posés
  selectedId: { type: [String, Number], default: null }, // pion choisi via le système 2 (clic)
  currentTurn: { type: Number, default: 1 }, // tour courant — interdit l'entrée en jeu en avance
  // Cf. lib/useAssisted.js::draggable — faux en mode Assisté (clic
  // uniquement), vrai en mode Libre (glisser-déposer uniquement).
  draggable: { type: Boolean, default: true },
})

const emit = defineEmits(['dragstart', 'select'])

/** Un renfort n'est jouable qu'à partir de son tour d'arrivée déclaré. */
function isAvailable(c) {
  return (c.turn ?? 1) <= props.currentTurn
}
function onDragStart(c, ev) {
  if (!isAvailable(c)) { ev.preventDefault(); return }
  emit('dragstart', c.id, ev)
}
function onSelect(c) {
  if (!isAvailable(c)) return
  emit('select', c.id)
}

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
        <figure v-for="c in g.items" :key="c.id" class="rf-piece">
          <img :src="c.src" :alt="c.name" width="48" height="48" :draggable="draggable && isAvailable(c)"
            :class="{ 'rf-selected': String(c.id) === String(selectedId), 'rf-unavailable': !isAvailable(c) }"
            :title="isAvailable(c) ? '' : `Arrive au tour ${c.turn}`"
            @dragstart="onDragStart(c, $event)" @click="onSelect(c)" />
          <!-- Indication d'hex : pure information, pas de drag & drop (seule
               l'image ci-dessus déclenche dragstart/select). -->
          <figcaption class="rf-hex">{{ c.setup }}</figcaption>
        </figure>
      </div>
    </section>
    <p class="rf-hint">
      <template v-if="draggable">
        Glisser un pion sur la carte pour le poser librement, ou cliquer dessus puis cliquer un des
        hex d'entrée surlignés en orange.
      </template>
      <template v-else>
        Cliquer un pion puis cliquer un des hex d'entrée surlignés en orange sur la carte.
      </template>
    </p>
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
  text-align: center;
}
.rf-piece img {
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.15);
  cursor: grab;
  border: 3px solid transparent;
  box-sizing: border-box;
}
.rf-piece img.rf-selected {
  border-color: #ff8c00;
}
.rf-piece img.rf-unavailable {
  opacity: 0.4;
  cursor: not-allowed;
}
.rf-hex {
  font-size: 0.68rem;
  line-height: 1.2;
  word-break: break-word;
  opacity: 0.75;
}
.rf-hint {
  font-size: 0.72rem;
  opacity: 0.75;
  line-height: 1.4;
  margin: 0;
}
</style>
