<script setup>
// Panneau à onglets coulissants sur le bord droit de l'écran — repris tel
// quel de ambush-tactique/src/components/SidePanel.vue (même structure
// DOM/CSS/logique : l'onglet .dc-tab est imbriqué DANS .dc-content et
// translate avec lui, seul un sliver reste visible/cliquable au bord de
// l'écran quand le panneau est fermé). Piloté par la prop `tabs`.
import { ref } from 'vue'

const props = defineProps({
  tabs: { type: Array, required: true }   // [{ key, label, wide? }]
})

const openTab = defineModel('openTab', { default: null })

const HOVER_PEEK = 10

/** Onglet actuellement survolé (aperçu "peek" quand il n'est pas déjà ouvert). */
const hoverKey = ref(null)

/** Onglets en cours de fondu lors d'un changement direct (ouvert → un autre
 *  ouvert), le temps de la transition. */
const fadingKeys = ref(new Set())
let fadeTimer = null

// Palette par onglet (ton clair → sombre). Cycle si plus de 4 onglets.
const TONES = [
  { bg: '#c6c8af', ink: '#24271f', soft: '#6f7360', rule: '#9a9d84', hover: '#b0b298', label: '#55584a' },
  { bg: '#a9ac93', ink: '#1f2219', soft: '#585c49', rule: '#878b71', hover: '#989b81', label: '#3f4235' },
  { bg: '#7c8069', ink: '#f0f1e8', soft: '#cbcdba', rule: '#9ea28a', hover: '#8b8f77', label: '#e2e3d6' },
  { bg: '#383b31', ink: '#eceedf', soft: '#b9bba6', rule: '#5c604f', hover: '#474b3e', label: '#b9bba6' },
]

const TAB_TOPS = [220, 346, 444, 560]
function tabTop(i) {
  if (i < TAB_TOPS.length) return TAB_TOPS[i] + 'px'
  return (TAB_TOPS[TAB_TOPS.length - 1] + 110 * (i - TAB_TOPS.length + 1)) + 'px'
}

function select(key) {
  const prevKey = openTab.value
  const nextKey = prevKey === key ? null : key
  const isSwitch = prevKey !== null && nextKey !== null && prevKey !== nextKey

  if (isSwitch) {
    fadingKeys.value = new Set([prevKey, nextKey])
    clearTimeout(fadeTimer)
    fadeTimer = setTimeout(() => { fadingKeys.value = new Set() }, 320)
  }
  openTab.value = nextKey
}

function close() {
  openTab.value = null
}

function rowVars(tab, i) {
  const tone = TONES[i % TONES.length]
  const isOpen = openTab.value === tab.key
  const isPeeking = !isOpen && hoverKey.value === tab.key
  const isFading = fadingKeys.value.has(tab.key)

  return {
    '--tone': tone.bg,
    '--tone-ink': tone.ink,
    '--tone-soft': tone.soft,
    '--tone-rule': tone.rule,
    '--tone-hover': tone.hover,
    '--tone-label': tone.label,
    '--tab-top': tabTop(i),
    '--content-w': tab.wide ? '30vw' : '22vw',
    '--content-x': isOpen ? '0%' : isPeeking ? `calc(100% - ${HOVER_PEEK}px)` : '100%',
    '--content-slide': isOpen ? '0px' : '16px',
    '--content-opacity': isFading ? (isOpen ? '1' : '0') : '1',
    '--fade-duration': isFading ? '320ms' : '0ms',
    '--tab-shadow': isOpen ? 'none' : '-6px 0 14px rgba(0, 0, 0, 0.35)',
    '--content-z': isOpen ? '1' : isPeeking ? '4' : '3',
  }
}
</script>

<template>
  <div class="dc-root">
    <div v-for="(tab, i) in tabs" :key="tab.key" class="dc-row" :style="rowVars(tab, i)">
      <div class="dc-tab-shadow" aria-hidden="true">
        <span class="dc-tab-label">{{ tab.label }}</span>
      </div>

      <div class="dc-content" @mouseenter="hoverKey = tab.key" @mouseleave="hoverKey = null">
        <button class="dc-tab" @click.stop="select(tab.key)">
          <span class="dc-tab-cap dc-tab-cap-top" aria-hidden="true">
            <svg viewBox="0 0 36 36" preserveAspectRatio="none" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M36 36V0C36 24 -2.95641e-05 12 0 36H36Z" fill="currentColor" />
            </svg>
          </span>
          <span class="dc-tab-label">{{ tab.label }}</span>
          <span class="dc-tab-cap dc-tab-cap-bottom" aria-hidden="true">
            <svg viewBox="0 0 36 36" preserveAspectRatio="none" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M36 0V36C36 12 -2.95641e-05 24 0 0H36Z" fill="currentColor" />
            </svg>
          </span>
        </button>

        <div class="dc-content-inner">
          <div class="dc-content-head">
            <h2 class="dc-title">{{ tab.label }}</h2>
          </div>
          <div class="dc-rule"></div>
          <div class="dc-content-slot">
            <slot :name="tab.key" />
          </div>
          <button class="dc-close-btn" @click.stop="close">Fermer</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dc-root {
  font-family: system-ui, sans-serif;
}

.dc-row {
  position: relative;
}

.dc-tab-shadow {
  position: fixed;
  top: 0;
  left: calc(100vw - var(--content-w, 22vw) - 35px);
  width: 36px;
  padding: 8px 0;
  box-sizing: border-box;
  transform: translateY(calc(var(--tab-top, 200px) - 50%)) translateX(var(--content-x, 100%));
  transition: transform 620ms cubic-bezier(0.22, 0.61, 0.36, 1);
  box-shadow: var(--tab-shadow, -6px 0 14px rgba(0, 0, 0, 0.35));
  pointer-events: none;
  z-index: 31;
  display: none;
}

.dc-tab-shadow .dc-tab-label {
  visibility: hidden;
}

.dc-content {
  position: fixed;
  top: 0;
  right: 0;
  width: var(--content-w, 22vw);
  height: 100vh;
  overflow: visible;
  background: var(--tone);
  transform: translateX(var(--content-x, 100%));
  transition: transform 620ms cubic-bezier(0.22, 0.61, 0.36, 1);
  display: flex;
  z-index: calc(32 + var(--content-z, 0));
}

.dc-tab {
  position: absolute;
  left: -35px;
  top: var(--tab-top, 200px);
  width: 36px;
  height: auto;
  padding: 8px 0;
  box-sizing: border-box;
  border: none;
  background: var(--tone);
  color: var(--tone);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transform: translateY(-50%);
  z-index: 1;
}

.dc-tab-cap {
  position: absolute;
  left: 0;
  width: 100%;
  height: 28px;
  pointer-events: none;
}

.dc-tab-cap-top { top: -27px; }
.dc-tab-cap-bottom { bottom: -27px; }

.dc-tab-cap svg {
  display: block;
  width: 100%;
  height: 100%;
}

.dc-tab-label {
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  font-size: 13px;
  letter-spacing: 0.9px;
  white-space: nowrap;
  color: var(--tone-label);
}

.dc-content-inner {
  flex: 1;
  padding: 32px 28px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 0;
  opacity: var(--content-opacity, 1);
  transform: translateX(var(--content-slide, 16px));
  transition: opacity var(--fade-duration, 0ms) ease, transform 620ms cubic-bezier(0.22, 0.61, 0.36, 1);
}

.dc-content-head {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.dc-title {
  margin: 0;
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.2px;
  color: var(--tone-ink);
}

.dc-rule {
  height: 1px;
  background: var(--tone-rule);
  flex: none;
}

.dc-content-slot {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  color: var(--tone-ink);
}

.dc-close-btn {
  align-self: flex-start;
  flex: none;
  padding: 8px 16px;
  background: transparent;
  border: 1px solid var(--tone-rule);
  border-radius: 4px;
  font-size: 12px;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  color: var(--tone-ink);
  cursor: pointer;
  transition: background 200ms ease;
}

.dc-close-btn:hover {
  background: var(--tone-hover);
}
</style>
