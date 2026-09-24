<script setup>
// ═══════════════════════════════════════════════════════════════════════════
// TurnTracker.vue — piste de tour complète et autonome : état (pas courant),
// dérivés (tour, camp actif, dernier pas) et logique de contrôle (quelles
// factions peuvent être sélectionnées/déplacées au pas courant). Le module
// fournit `config` (module.turnTrack — { turns, order: [campKey...], sides:
// { [campKey]: {label, marker} } }) et `sides` (module.sides — regroupement
// des factions par camp jouable) ; sans `config`, le composant ne rend rien
// et `canControl` autorise tout (aucune restriction).
//
// Le parent (HexMap.vue) n'a besoin que de :
//  - écouter `turn` pour répercuter une avance LOCALE au serveur (multijoueur) ;
//  - écouter `change` pour connaître le tour courant ailleurs dans sa propre
//    logique (ex. régénération du soutien allié par tour) ;
//  - appeler `canControl(counter)` (exposé) pour restreindre sélection/glisser ;
//  - appeler `applyRemoteTurn(step)` (exposé) quand le serveur fait autorité.
//
// Phases (mode Assisté uniquement — cf. lib/useAssisted.js) : ce composant
// reste volontairement "bête" sur le sujet des phases (Mouvement/Combat, et
// pour le dernier camp de l'ordre, Fin de tour) — il ne connaît PAS le sens
// de ces phases lui-même (toute cette logique, y compris COMBIEN de
// marqueurs afficher et LESQUELS, vit dans useAssisted.js::phaseLabels, cf.
// ce fichier pour le détail). Il se contente :
//  - d'afficher, si la prop `phase` est fournie (non nulle), une 2e ligne
//    avec un marqueur par entrée de `phaseLabels` sous la piste de tour, et
//    d'y déplacer le bouton "suivant" (au lieu de le laisser en bout de
//    la 1re ligne comme en mode Libre) ;
//  - de laisser le PARENT décider ce que "suivant" signifie dans ce cas :
//    le clic sur ce bouton-là émet `phase-next` au lieu d'avancer lui-même
//    le pas courant (contrairement au bouton de la 1re ligne, utilisé hors
//    mode phases, qui continue d'appeler `nextTurn()` directement comme
//    avant). C'est useAssisted.js qui, en écoutant `phase-next`, décide si
//    ce clic doit seulement faire passer de Mouvement à Combat (aucun
//    changement de pas ici) ou doit AUSSI faire avancer le pas courant (en
//    rappelant `nextTurn()`, exposé plus bas) pour passer au camp/tour
//    suivant.
// ═══════════════════════════════════════════════════════════════════════════

import { ref, computed, watch } from 'vue'
import { mt } from '../i18n/index.js'

const props = defineProps({
  config: { type: Object, default: null },
  sides: { type: Object, default: null },
  // Pas courant déjà en cours (partie multijoueur reprise en route). Absent
  // (0) en solo/démo.
  initialStep: { type: Number, default: 0 },
  // Vrai pendant un rejeu de journal (cf. HexMap.vue::replayLocked), ou, en
  // ligne, quand ce n'est pas au joueur de ce navigateur de jouer (cf.
  // HexMap.vue::isLocalTurn) — bloque le bouton "tour suivant"/"phase
  // suivante", le pas courant n'avance alors que via applyRemoteTurn (piloté
  // par le lecteur de rejeu ou par le serveur).
  disabled: { type: Boolean, default: false },
  // Phase active (index dans `phaseLabels` ci-dessous : 0 = Mouvement,
  // 1 = Combat, 2 = Fin de tour pour le dernier camp de l'ordre), ou `null`
  // hors mode Assisté (cf. useAssisted.js::phase). C'est cette prop, et
  // elle seule, qui détermine si la 2e ligne "phases" est affichée : `null`
  // = comportement historique inchangé (pas de phases, bouton en bout de
  // 1re ligne).
  phase: { type: Number, default: null },
  // Index du marqueur à allumer dans `phaseLabels` (cf.
  // useAssisted.js::phaseIndex). Diffère de `phase` quand un marqueur
  // "Airborne" précède "Mouvement" (phase -1 -> index 0). Absent : on
  // retombe sur `phase`.
  phaseIndex: { type: Number, default: null },
  // Libellés des marqueurs de la ligne "phases", dans l'ordre (cf.
  // useAssisted.js::phaseLabels — 2 entrées pour un camp normal, 3 pour le
  // dernier camp de l'ordre). Ignoré hors mode phases (`phase === null`).
  phaseLabels: { type: Array, default: () => [] },
  // Texte à afficher sur le bouton de la ligne "phases", précisant ce que
  // le prochain clic va déclencher ("Nouvelle phase" / "Autre joueur" /
  // "Fin de tour" / "Nouveau tour" — calculé par useAssisted.js). Ignoré
  // hors mode phases.
  nextLabel: { type: String, default: null },
})

const emit = defineEmits([
  'turn',       // avance LOCALE (flèche cliquée hors mode phases) — le parent la répercute au serveur
  'change',     // pas/tour/camp actif ont changé (local ou distant) — état dérivé complet
  'phase-next', // clic sur le bouton de la ligne "phases" — le parent (useAssisted.js) décide de l'effet
])

const currentStep = ref(props.initialStep)
const totalSteps = computed(() => (props.config ? props.config.turns * props.config.order.length : 0))
const currentTurn = computed(() => Math.floor(currentStep.value / (props.config?.order.length ?? 1)) + 1)
const activeSideKey = computed(() => props.config?.order[currentStep.value % props.config.order.length] ?? null)
const activeSideInfo = computed(() => (activeSideKey.value ? props.config.sides[activeSideKey.value] : null))
const isLastStep = computed(() => currentStep.value >= totalSteps.value - 1)

// Le camp actif est-il le DERNIER de `order` pour le tour en cours ? Sert à
// useAssisted.js pour choisir le libellé du bouton "suivant" en mode
// phases : si oui, le prochain passage en phase Mouvement fera aussi
// passer au TOUR suivant ("Nouveau tour"), sinon il ne fait que changer de
// camp actif au même tour ("Autre joueur").
const isLastSideOfTurn = computed(() => {
  if (!props.config) return true
  return (currentStep.value % props.config.order.length) === props.config.order.length - 1
})

// Factions autorisées à être sélectionnées/déplacées au pas courant — celles
// du camp actif (cf. `sides`), ou aucune restriction si le module ne déclare
// ni piste de tour ni camps.
const activeFactions = computed(() => {
  if (!props.config || !props.sides) return null
  return props.sides[activeSideKey.value] ?? null
})
const canControl = (counter) => !activeFactions.value || activeFactions.value.includes(counter?.faction)

watch(
  [currentStep, activeFactions],
  () => emit('change', {
    step: currentStep.value,
    turn: currentTurn.value,
    activeSideKey: activeSideKey.value,
    activeFactions: activeFactions.value,
  }),
  { immediate: true },
)

function nextTurn() {
  if (!props.config || isLastStep.value || props.disabled) return
  currentStep.value += 1
  emit('turn', currentStep.value)
}

/** Applique un pas reçu d'un autre joueur (WebSocket) — ne réémet pas `turn`
 *  pour éviter une boucle avec le serveur (`change` part quand même, cf.
 *  watch ci-dessus, pour que le parent se resynchronise). */
function applyRemoteTurn(step) {
  currentStep.value = step
}

// `currentStep` et `isLastSideOfTurn` sont exposés en lecture pour que
// useAssisted.js puisse (a) observer les changements de pas afin de
// remettre la phase à "Mouvement" dès que le camp/tour actif change (par
// clic, par synchronisation réseau via applyRemoteTurn, ou par rejeu de
// journal), et (b) choisir le libellé du bouton "suivant" en mode phases.
// `nextTurn` est exposé pour que useAssisted.js puisse la déclencher
// lui-même (cf. plus haut) quand un clic en phase Combat doit AUSSI faire
// avancer le pas courant.
// `currentTurn` (numéro de tour, dérivé du pas courant) est en plus exposé
// pour lib/useAssisted.js (congestion des hex d'entrée de renfort — remise à
// zéro à chaque NOUVEAU TOUR, pas à chaque changement de camp, cf.
// useAssisted.js::entryCounts).
defineExpose({ applyRemoteTurn, canControl, nextTurn, currentStep, isLastSideOfTurn, currentTurn })
</script>

<template>
  <div v-if="config" class="turn-tracker">
    <div class="tt-row">
      <div class="tt-track">
        <span v-for="turnNumber in config.turns" :key="turnNumber" class="tt-cell" :class="{ active: turnNumber === currentTurn }">
          {{ turnNumber }}
        </span>
      </div>
      <img v-if="activeSideInfo" :src="activeSideInfo.marker" :alt="mt(activeSideInfo.label)" class="tt-marker" />
      <span class="tt-side-label">{{ mt(activeSideInfo?.label) }}</span>
      <!-- Hors mode phases (phase === null, cf. props ci-dessus) : comportement
           historique inchangé, ce bouton avance lui-même le pas courant. -->
      <button v-if="phase === null" class="tt-next" :disabled="isLastStep || disabled" :title="$t('turnTracker.nextTurn')" @click="nextTurn">&rarr;</button>
    </div>

    <!-- Ligne "phases" (mode Assisté uniquement, cf. props `phase` ci-dessus) :
         un marqueur par entrée de `phaseLabels` (2 ou 3 selon le camp actif,
         cf. useAssisted.js::phaseLabels) + le bouton "suivant" déplacé ici,
         à leur droite. Le libellé du bouton (nextLabel) précise ce que le
         prochain clic va faire — voir useAssisted.js pour le calcul. -->
    <div v-if="phase !== null" class="tt-row tt-row-phases">
      <div class="tt-phases">
        <span v-for="(label, labelIndex) in phaseLabels" :key="label" class="tt-phase" :class="{ active: (phaseIndex ?? phase) === labelIndex }">{{ label }}</span>
      </div>
      <!-- Pas de `nextTurn()` direct ici : on émet `phase-next` et on laisse
           useAssisted.js (via HexMap.vue) décider de l'effet réel du clic. -->
      <button class="tt-next" :disabled="disabled" :title="nextLabel || $t('turnTracker.nextTurn')" @click="$emit('phase-next')">
        <span aria-hidden="true">&rarr;</span>
        <span v-if="nextLabel" class="tt-next-label">{{ nextLabel }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.turn-tracker {
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: var(--black-a25);
  border-radius: var(--radius-8);
  padding: 6px 10px;
}

/* Chaque ligne (piste de tour, puis ligne "phases" en mode Assisté) garde
   la mise en page en rangée qu'avait `.turn-tracker` avant l'ajout des
   phases — `.turn-tracker` ne fait plus qu'empiler ces rangées. */
.tt-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.tt-track {
  display: flex;
  gap: 3px;
}

.tt-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: var(--radius-4);
  background: var(--white-a12);
  color: var(--panel-text-muted);
  font-size: var(--font-size-072);
  font-weight: 600;
}

.tt-cell.active {
  background: var(--color-gold);
  color: var(--panel-bg);
}

.tt-marker {
  width: 28px;
  height: 28px;
  border-radius: var(--radius-4);
}

.tt-side-label {
  color: var(--panel-text-muted);
  font-size: var(--font-size-085);
  font-weight: 600;
  white-space: nowrap;
}

.tt-next {
  width: 28px;
  height: 28px;
  border-radius: var(--radius-4);
  border: none;
  background: var(--color-gold);
  color: var(--panel-bg);
  font-size: var(--font-size-100);
  font-weight: 700;
  cursor: pointer;
}

.tt-next:disabled {
  background: var(--white-a20);
  color: var(--black-a40);
  cursor: default;
}

/* Ligne "phases" (mode Assisté) : les 2 marqueurs Mouvement/Combat à
   gauche, le bouton "suivant" (élargi pour accueillir son libellé) à
   droite — `justify-content: space-between` les écarte l'un de l'autre
   sans avoir à leur donner une largeur figée. */
.tt-row-phases {
  justify-content: space-between;
}

.tt-phases {
  display: flex;
  gap: 3px;
}

.tt-phase {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 3px 8px;
  border-radius: var(--radius-4);
  background: var(--white-a12);
  color: var(--panel-text-muted);
  font-size: var(--font-size-072);
  font-weight: 600;
  white-space: nowrap;
}

.tt-phase.active {
  background: var(--color-gold);
  color: var(--panel-bg);
}

/* En ligne "phases", le bouton porte un libellé en plus de la flèche :
   on abandonne donc sa largeur fixe (28px, pensée pour la seule flèche du
   mode historique) au profit d'une largeur qui s'adapte au texte. */
.tt-row-phases .tt-next {
  width: auto;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
}

.tt-next-label {
  font-size: var(--font-size-072);
}
</style>
