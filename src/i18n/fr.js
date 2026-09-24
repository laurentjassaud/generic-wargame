// Textes de l'interface en français (cf. src/i18n/index.js). Mêmes clés que
// en.js. Dans les messages, `{nom}` est un paramètre ; `@`, `|`, `{` et `}`
// littéraux s'écrivent `{'@'}`, `{'|'}`, `{'{'}` et `{'}'}`.
export default {
  language: {
    label: 'Langue',
    fr: 'Français',
    en: 'English',
  },

  common: {
    back: 'Retour',
    next: 'Suivant',
    loading: 'Chargement…',
    comingSoon: 'Bientôt disponible',
  },

  errors: {
    'not-found': "Cette partie n'existe pas (ou plus).",
    'bad-passcode': "Code d'accès incorrect.",
    'room-full': 'Cette room est déjà complète.',
    'side-taken': 'Ce camp est déjà pris par un autre joueur.',
    'already-started': 'Cette partie a déjà commencé.',
    'not-started': "La partie n'a pas encore commencé.",
    'bad-name': 'Pseudo invalide (1 à 40 caractères).',
    'bad-side': 'Camp invalide.',
    'too-many-games': 'Trop de parties en cours sur le serveur : réessaie plus tard.',
    'unknown-error': 'Erreur inconnue du serveur.',
  },

  settings: {
    scenarioHistorical: 'Historique',
    party: { libre: 'Libre', assiste: 'Assisté' },
    timing: { libre: 'Libre', limite: 'Limité', blitz: 'Blitz' },
    timingHint: {
      limite: 'Conseillé : 4 à 8 minutes / tour',
      blitz: 'Conseillé : 40 à 60 minutes',
    },
    timingLocked: 'Le chronomètre porte sur la phase de Mouvement : disponible en partie Assistée uniquement.',
  },

  summary: {
    scenario: 'Scénario : {name}',
    weatherOn: 'Météo activée',
    party: 'Partie {name}',
    timing: 'Timing {name}',
  },

  setup: {
    stepOf: 'Étape {step} / {total}',
    chooseModule: '1. Choisir le module',
    chooseScenario: '2. Choisir le scénario',
    options: '3. Options',
    gameMode: '4. Mode de jeu',
    party: 'Partie',
    timing: 'Timing',
    weather: 'Météo',
    weatherNotYet: 'Les règles de météo ne sont pas encore appliquées par le moteur.',
    weatherRequired: 'Obligatoire pour ce scénario.',
    limitedDuration: 'Durée de la phase de mouvement (minutes)',
    blitzDuration: 'Temps total de mouvement par joueur (minutes)',
    loadingModule: 'Chargement du module…',
    moduleLoadError: 'Impossible de charger ce module.',
  },

  createGame: {
    title: 'Créer une partie en ligne',
    playerCount: '5. Nombre de joueurs',
    playerRange: 'Entre {min} et {max} joueurs pour ce module.',
    creating: 'Création…',
    create: 'Créer la partie',
  },

  localGame: {
    title: 'Partie en local',
    start: 'Lancer la partie',
  },

  gamesList: {
    title: 'Parties en cours',
    localGame: 'Partie en local',
    createGame: 'Créer une partie',
    created: "Partie créée ! Code d'accès pour la room {room} : {passcode} — transmets-le aux autres joueurs.",
    players: '{count} / {max} joueurs',
    status: { lobby: 'en attente', started: 'en cours' },
    variants: 'Variantes : {list}',
    empty: 'Aucune partie en cours. Crée-en une !',
  },

  lobby: {
    backToGames: 'Retour aux parties',
    loadingGame: 'Chargement de la partie…',
    replayWarning: "Cette sauvegarde a été jouée avec d'autres réglages que cette partie en ligne : impossible de la reprendre ici.",
    genericSide: 'Camp {n}',
    nickname: 'Pseudo',
    side: 'Camp',
    taken: 'pris',
    passcode: "Code d'accès",
    joining: 'Connexion…',
    join: 'Rejoindre la room',
    waiting: 'En attente des autres joueurs… ({count} / {max})',
    started: 'La partie est lancée !',
    you: 'vous',
    online: 'en ligne',
    offline: 'hors ligne',
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
