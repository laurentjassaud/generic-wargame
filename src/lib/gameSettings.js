// Réglages d'une partie (scénario, météo, mode Libre/Assisté, timing),
// communs à la partie en local (LocalGameSetup.vue -> DemoPlay.vue) et à la
// partie en ligne (CreateGame.vue -> serveur -> RoomLobby.vue). Mêmes clés que
// lib/journalStorage.js::SETTING_KEYS, toutes en chaînes (format de l'URL).

export const SCENARIO_OPTIONS = [
  { id: 'historique', label: 'Historique' },
  { id: 'placement-libre', label: 'Placement libre' },
]
export const PARTY_OPTIONS = [
  { id: 'libre', label: 'Libre' },
  { id: 'assiste', label: 'Assisté' },
]
export const TIMING_OPTIONS = [
  { id: 'libre', label: 'Libre' },
  { id: 'limite', label: 'Limité' },
  { id: 'blitz', label: 'Blitz' },
]
export const TIMING_HINTS = {
  limite: 'Conseillé : 4 à 8 minutes / tour',
  blitz: 'Conseillé : 40 à 60 minutes',
}

const labelOf = (options, id) => (options.find((option) => option.id === id) ?? options[0]).label

export function defaultSettings() {
  return { scenario: 'historique', weather: '0', party: 'libre', timing: 'libre', timingValue: '' }
}

/** Complète/assainit des réglages partiels (URL, réponse serveur) avec les
 *  valeurs par défaut — une valeur inconnue retombe sur le défaut. */
export function resolveSettings(raw) {
  const defaults = defaultSettings()
  const pick = (options, value, fallback) => (options.some((option) => option.id === value) ? value : fallback)
  return {
    scenario: pick(SCENARIO_OPTIONS, raw?.scenario, defaults.scenario),
    weather: raw?.weather === '1' ? '1' : '0',
    party: pick(PARTY_OPTIONS, raw?.party, defaults.party),
    timing: pick(TIMING_OPTIONS, raw?.timing, defaults.timing),
    timingValue: raw?.timingValue ? String(raw.timingValue) : '',
  }
}

export function timingNeedsValue(timing) {
  return timing === 'limite' || timing === 'blitz'
}

/** Libellés affichés dans le bandeau de la partie et la liste des parties. */
export function describeSettings(settings) {
  return {
    scenario: labelOf(SCENARIO_OPTIONS, settings.scenario),
    weather: settings.weather === '1',
    party: labelOf(PARTY_OPTIONS, settings.party),
    timing: labelOf(TIMING_OPTIONS, settings.timing),
    timingValue: settings.timingValue,
  }
}
