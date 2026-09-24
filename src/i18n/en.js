// English interface texts (cf. src/i18n/index.js). Same keys as fr.js.
export default {
  language: {
    label: 'Language',
    fr: 'Français',
    en: 'English',
  },

  common: {
    back: 'Back',
    next: 'Next',
    loading: 'Loading…',
    comingSoon: 'Coming soon',
  },

  errors: {
    'not-found': 'This game does not exist (anymore).',
    'bad-passcode': 'Wrong passcode.',
    'room-full': 'This room is already full.',
    'side-taken': 'This side is already taken by another player.',
    'already-started': 'This game has already started.',
    'not-started': 'The game has not started yet.',
    'bad-name': 'Invalid nickname (1 to 40 characters).',
    'bad-side': 'Invalid side.',
    'too-many-games': 'Too many games running on the server: try again later.',
    'unknown-error': 'Unknown server error.',
  },

  settings: {
    scenarioHistorical: 'Historical',
    party: { libre: 'Free', assiste: 'Assisted' },
    timing: { libre: 'Untimed', limite: 'Limited', blitz: 'Blitz' },
    timingHint: {
      limite: 'Suggested: 4 to 8 minutes per turn',
      blitz: 'Suggested: 40 to 60 minutes',
    },
    timingLocked: 'The clock runs during the Movement phase: only available in Assisted games.',
  },

  summary: {
    scenario: 'Scenario: {name}',
    weatherOn: 'Weather on',
    party: 'Mode: {name}',
    timing: 'Timing: {name}',
  },

  setup: {
    stepOf: 'Step {step} / {total}',
    chooseModule: '1. Choose the module',
    chooseScenario: '2. Choose the scenario',
    options: '3. Options',
    gameMode: '4. Game mode',
    party: 'Mode',
    timing: 'Timing',
    weather: 'Weather',
    weatherNotYet: 'Weather rules are not applied by the engine yet.',
    weatherRequired: 'Required for this scenario.',
    limitedDuration: 'Length of the movement phase (minutes)',
    blitzDuration: 'Total movement time per player (minutes)',
    loadingModule: 'Loading the module…',
    moduleLoadError: 'Unable to load this module.',
  },

  createGame: {
    title: 'Create an online game',
    playerCount: '5. Number of players',
    playerRange: 'Between {min} and {max} players for this module.',
    creating: 'Creating…',
    create: 'Create the game',
  },

  localGame: {
    title: 'Local game',
    start: 'Start the game',
  },

  gamesList: {
    title: 'Open games',
    localGame: 'Local game',
    createGame: 'Create a game',
    created: 'Game created! Passcode for room {room}: {passcode} — share it with the other players.',
    players: '{count} / {max} players',
    status: { lobby: 'waiting', started: 'in progress' },
    variants: 'Variants: {list}',
    empty: 'No game in progress. Create one!',
  },

  lobby: {
    backToGames: 'Back to games',
    loadingGame: 'Loading the game…',
    replayWarning: 'This save was played with different settings from this online game: it cannot be resumed here.',
    genericSide: 'Side {n}',
    nickname: 'Nickname',
    side: 'Side',
    taken: 'taken',
    passcode: 'Passcode',
    joining: 'Connecting…',
    join: 'Join the room',
    waiting: 'Waiting for the other players… ({count} / {max})',
    started: 'The game has started!',
    you: 'you',
    online: 'online',
    offline: 'offline',
  },

  toolbar: {
    gameOverTag: 'Game over — {side} loses on time',
    gridDisabled: 'Grid disabled in free play',
    grid: 'grid',
    coordinates: 'coordinates',
    calibration: 'calibration',
    debug: 'debug',
    hideCounters: 'Hide counters',
    showCounters: 'Show counters',
    undo: '↩ Undo',
    hideDie: 'Hide die',
    showDie: 'Show die',
    movementChart: 'Movement chart',
    combatChart: 'Combat chart',
    bugReportTitle: 'Open a bug report on GitHub, with an export of the game',
    bugReport: 'Report a bug',
    replayStep: 'Replay: step one line forward',
    replayEnd: 'Fast forward: go to the end',
  },
}
