// Réglages d'une partie (scénario, météo, mode Libre/Assisté, timing),
// communs à la partie en local (LocalGameSetup.vue -> DemoPlay.vue) et à la
// partie en ligne (CreateGame.vue -> serveur -> RoomLobby.vue). Mêmes clés que
// lib/journalStorage.js::SETTING_KEYS, toutes en chaînes (format de l'URL).

// `available: false` : proposé grisé ("Bientôt disponible") et jamais retenu
// (cf. resolveSettings) — le moteur ne l'applique pas encore. Le placement
// libre demande un déploiement au choix des joueurs, que HexMap.vue ne fait
// pas encore (le déploiement est toujours celui du module).
export const SCENARIO_OPTIONS = [
  { id: 'historique', label: 'Historique' },
  { id: 'placement-libre', label: 'Placement libre', available: false },
]
// Météo : même situation, aucune règle du moteur ne la lit encore.
export const WEATHER_AVAILABLE = false
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
// Le chronomètre (Limité, Blitz) porte sur la phase de MOUVEMENT (cf.
// MoveTimer.vue), qui n'existe qu'en partie Assistée : en partie Libre, il
// n'y a pas de phases, donc pas de chronomètre possible.
export const TIMING_LOCKED_HINT = 'Le chronomètre porte sur la phase de Mouvement : disponible en partie Assistée uniquement.'
export function timingAllowed(party) {
  return party === 'assiste'
}

// Réglages qui changent les RÈGLES de la partie : seuls ceux-là comptent pour
// savoir si une sauvegarde peut être reprise telle quelle (cf.
// lib/journalStorage.js::sameSettings). `scenario` et `weather` n'ont pas
// d'effet tant qu'ils ne sont pas disponibles (cf. ci-dessus).
export const RULE_SETTING_KEYS = ['party', 'timing', 'timingValue']

const labelOf = (options, id) => (options.find((option) => option.id === id) ?? options[0]).label

export function defaultSettings() {
  return { scenario: 'historique', weather: '0', party: 'libre', timing: 'libre', timingValue: '' }
}

/** Complète/assainit des réglages partiels (URL, réponse serveur, fichier de
 *  sauvegarde) avec les valeurs par défaut — une valeur inconnue OU pas
 *  encore disponible retombe sur le défaut, et un chronomètre demandé en
 *  partie Libre est ignoré (cf. `timingAllowed`). Le résultat est ce que le
 *  moteur applique réellement : deux réglages qui se résolvent pareil
 *  donnent la même partie. */
export function resolveSettings(raw) {
  const defaults = defaultSettings()
  const pick = (options, value, fallback) =>
    (options.some((option) => option.id === value && option.available !== false) ? value : fallback)
  const party = pick(PARTY_OPTIONS, raw?.party, defaults.party)
  const timing = timingAllowed(party) ? pick(TIMING_OPTIONS, raw?.timing, defaults.timing) : 'libre'
  return {
    scenario: pick(SCENARIO_OPTIONS, raw?.scenario, defaults.scenario),
    weather: WEATHER_AVAILABLE && raw?.weather === '1' ? '1' : '0',
    party,
    timing,
    timingValue: timingNeedsValue(timing) && raw?.timingValue ? String(raw.timingValue) : '',
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
