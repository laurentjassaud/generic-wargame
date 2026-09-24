// Textes de l'interface en français (cf. src/i18n/index.js). Mêmes clés que
// en.js. Dans les messages, `{nom}` est un paramètre ; `@`, `|`, `{` et `}`
// littéraux s'écrivent `{'@'}`, `{'|'}`, `{'{'}` et `{'}'}`.
export default {
  language: {
    label: 'Langue',
    fr: 'Français',
    en: 'English',
  },

  toolbar: {
    gameOverTag: 'Partie terminée — {side} perd au temps',
    gridDisabled: 'Grille désactivée en partie libre',
    grid: 'grille',
    coordinates: 'coordonnées',
    calibration: 'calibration',
    debug: 'debug',
    hideCounters: 'Cacher les pions',
    showCounters: 'Afficher les pions',
    undo: '↩ Retour arrière',
    hideDie: 'Cacher le dé',
    showDie: 'Afficher le dé',
    movementChart: 'Table des mouvements',
    combatChart: 'Table de combat',
    bugReportTitle: 'Ouvrir un rapport de bug sur GitHub, avec un export de la partie',
    bugReport: 'Signaler un bug',
    replayStep: 'Lecture : avancer d\'une ligne',
    replayEnd: 'Avance rapide : aller à la fin',
  },
}
