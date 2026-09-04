<script setup>
// Contenu de l'onglet "Unités éliminées" — pions retirés de la carte via le
// menu contextuel "Éliminé" (cf. HexMap.vue), regroupés par nationalité
// (faction). Pas de drag & drop ici : seul le clic droit propose de
// "Replacer le pion" (retour dans les renforts, cf. onEliminatedContextMenu
// dans HexMap.vue).
import { computed } from 'vue'

const props = defineProps({
  units: { type: Array, required: true }, // pions éliminés (toutes factions)
})

const emit = defineEmits(['contextmenu'])

const FACTION_LABELS = { german: 'Allemands', commonwealth: 'Commonwealth', us: 'US', pol: 'Polonais' }

/** Groupes { faction, items }, triés par nom de faction affiché. */
const groups = computed(() => {
  const byFaction = new Map()
  for (const c of props.units) {
    const f = c.faction ?? '?'
    if (!byFaction.has(f)) byFaction.set(f, [])
    byFaction.get(f).push(c)
  }
  return [...byFaction.entries()]
    .map(([faction, items]) => ({ faction, label: FACTION_LABELS[faction] ?? faction, items }))
    .sort((a, b) => a.label.localeCompare(b.label))
})
</script>

<template>
  <div class="el-list">
    <p v-if="!units.length" class="el-empty">Aucune unité éliminée.</p>
    <section v-for="g in groups" :key="g.faction" class="el-group">
      <h3 class="el-group-title">{{ g.label }}</h3>
      <div class="el-grid">
        <figure v-for="c in g.items" :key="c.id" class="el-piece">
          <img :src="c.src" :alt="c.name" width="48" height="48" draggable="false"
            @contextmenu.prevent="emit('contextmenu', c.id, $event)" />
        </figure>
      </div>
    </section>
    <p class="el-hint">Clic droit sur un pion pour le replacer dans les renforts.</p>
  </div>
</template>

<style scoped>
.el-list {
  display: flex;
  flex-direction: column;
  gap: 18px;
  font-size: 0.85rem;
}
.el-empty {
  opacity: 0.75;
}
.el-group-title {
  margin: 0 0 8px;
  font-size: 0.95rem;
  font-weight: 600;
}
.el-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(48px, 1fr));
  gap: 10px;
}
.el-piece {
  margin: 0;
}
.el-piece img {
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.15);
  filter: grayscale(0.6);
  cursor: context-menu;
}
.el-hint {
  font-size: 0.72rem;
  opacity: 0.75;
  line-height: 1.4;
  margin: 0;
}
</style>
