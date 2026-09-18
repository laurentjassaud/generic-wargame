import { customAlphabet } from 'nanoid'

const gameId = customAlphabet('23456789ABCDEFGHJKLMNPQRSTUVWXYZ', 6)
const passcode = customAlphabet('23456789ABCDEFGHJKLMNPQRSTUVWXYZ', 6)
const playerId = customAlphabet('23456789abcdefghjkmnpqrstuvwxyz', 12)

// In-memory store. One process only for now — swap for Redis if we need
// to scale across multiple server instances (see roadmap phase 0 notes).
const games = new Map()

export class RoomError extends Error {
  constructor(code) {
    super(code)
    this.code = code
  }
}

// Réglages de la partie (mêmes clés que la partie en local, cf.
// src/lib/gameSettings.js) : on ne garde que les clés connues, en chaînes,
// le client complétant les valeurs manquantes par les défauts.
const SETTING_KEYS = ['scenario', 'weather', 'party', 'timing', 'timingValue']

function sanitizeSettings(settings) {
  const source = settings && typeof settings === 'object' ? settings : {}
  return Object.fromEntries(
    SETTING_KEYS.map((key) => [key, source[key] == null ? '' : String(source[key]).slice(0, 32)])
  )
}

/** Ordre des camps reçu du client (cf. src/views/CreateGame.vue,
 *  `module.turnTrack.order`) : quelques clés courtes au plus. Vide si
 *  absent — le contrôle de tour (cf. `isPlayersTurn`) est alors inactif. */
function sanitizeTurnOrder(turnOrder) {
  if (!Array.isArray(turnOrder)) return []
  return turnOrder.filter((side) => typeof side === 'string' && side && side.length <= 32).slice(0, 16)
}

export function createGame({ moduleId, scenarioId, variants, settings, maxPlayers, turnOrder }) {
  const id = gameId()
  const game = {
    id,
    moduleId,
    scenarioId,
    variants: Array.isArray(variants) ? variants : [],
    settings: sanitizeSettings({ scenario: scenarioId, ...settings }),
    // Camps dans l'ordre où ils jouent chaque tour (cf. sanitizeTurnOrder) :
    // `turnOrder[turnStep % turnOrder.length]` est le camp qui a la main.
    turnOrder: sanitizeTurnOrder(turnOrder),
    maxPlayers,
    passcode: passcode(),
    status: 'lobby', // 'lobby' | 'started'
    createdAt: Date.now(),
    players: new Map(), // playerId -> { id, name, side, connected, socketId }
    boardState: new Map(), // counterId -> { col, row } — positions déplacées depuis le setup du module
    turnStep: 0, // index dans la séquence tours × camps du module (cf. HexMap.vue -> turnTrack)
    // Phase en cours du camp actif (mode Assisté, cf. src/lib/useAssisted.js),
    // ou `null` quand chaque client doit la recalculer lui-même (début de
    // camp/tour : Airborne ou Mouvement selon ses renforts).
    phase: null,
    // Début (horloge serveur) de la phase/du pas en cours — sert au timing
    // "Limité" pour qu'un joueur qui (re)charge la page retrouve le temps
    // restant de la phase de Mouvement, et non un compteur remis à plein.
    phaseSince: Date.now(),
    // Timing "Blitz" : temps de Mouvement consommé par camp (ms), tel que
    // transmis par le joueur actif à la fin de chacune de ses phases de
    // Mouvement — `{ [campKey]: ms }`.
    blitzUsedMs: {},
    // Timing "Blitz" : camp dont la pendule est tombée à 0 — partie
    // terminée, plus aucun coup accepté. `null` tant qu'elle continue.
    blitzLoser: null,
    // Journal PARTAGÉ de la partie (ordre chronologique) : entrées
    // `{ uid, t, kind, text, data }` envoyées par les joueurs (cf.
    // src/components/HexMap.vue::log). Transmis en entier à chaque joueur
    // qui (re)joint la partie, pour qu'il la reconstitue.
    journal: [],
  }
  games.set(id, game)
  return game
}

export function listGames() {
  return [...games.values()].map(toSummary)
}

export function getGame(id) {
  return games.get(id)
}

export function toSummary(game) {
  return {
    id: game.id,
    moduleId: game.moduleId,
    scenarioId: game.scenarioId,
    variants: game.variants,
    settings: game.settings,
    maxPlayers: game.maxPlayers,
    status: game.status,
    playerCount: game.players.size,
    createdAt: game.createdAt,
  }
}

export function toPublic(game) {
  return {
    ...toSummary(game),
    players: [...game.players.values()].map((player) => ({
      id: player.id,
      name: player.name,
      side: player.side,
      connected: player.connected,
    })),
    boardState: Object.fromEntries(game.boardState),
    turnStep: game.turnStep,
    phase: game.phase,
    phaseElapsedMs: Date.now() - game.phaseSince,
    blitzUsedMs: game.blitzUsedMs,
    blitzLoser: game.blitzLoser,
  }
}

export function joinGame(id, { passcode: code, playerId: existingPlayerId, name, side, socketId }) {
  const game = games.get(id)
  if (!game) throw new RoomError('not-found')
  if (game.passcode !== code) throw new RoomError('bad-passcode')

  const reconnecting = existingPlayerId && game.players.has(existingPlayerId)

  if (!reconnecting) {
    if (game.status !== 'lobby') throw new RoomError('already-started')
    if (game.players.size >= game.maxPlayers) throw new RoomError('room-full')
    const sideTaken = [...game.players.values()].some((otherPlayer) => otherPlayer.side === side)
    if (sideTaken) throw new RoomError('side-taken')
  }

  const id_ = reconnecting ? existingPlayerId : playerId()
  const player = reconnecting
    ? game.players.get(id_)
    : { id: id_, name, side, connected: false, socketId: null }

  // Reconnexion : le siège est repris TEL QUEL — ni le pseudo ni surtout le
  // camp ne changent. Sinon un client pourrait se reconnecter sur le camp
  // adverse (même déjà pris) et contourner le contrôle de tour ci-dessous.
  player.connected = true
  player.socketId = socketId
  game.players.set(id_, player)

  if (!reconnecting && game.players.size === game.maxPlayers) {
    game.status = 'started'
  }

  return { game, playerId: id_ }
}

// --- Contrôle de tour ---------------------------------------------------------
// Le serveur ne connaît ni les règles ni les pions : il sait seulement, grâce
// à `turnOrder` (cf. createGame) et au pas courant, QUEL CAMP a la main. Tout
// ce qui fait avancer ou modifie la partie (coup, tour, phase, journal) n'est
// accepté que du joueur de ce camp — le même verrou que l'interface (cf.
// src/components/HexMap.vue::inputLocked), mais qu'un client modifié ne peut
// pas contourner. Sans `turnOrder` (ancien client, module sans piste de
// tour), aucune restriction : comportement d'avant.

/** Camp qui a la main, ou `null` si l'ordre des camps est inconnu. */
export function activeSide(game) {
  const count = game.turnOrder.length
  return count ? game.turnOrder[game.turnStep % count] : null
}

/** Camp qui vient de rendre la main (celui du pas précédent), ou `null`. */
function previousSide(game) {
  const count = game.turnOrder.length
  if (!count || game.turnStep === 0) return null
  return game.turnOrder[(game.turnStep - 1) % count]
}

/** Le joueur `playerId` a-t-il la main ? Toujours vrai sans `turnOrder`. */
export function isPlayersTurn(game, playerId) {
  const side = activeSide(game)
  if (side == null) return true
  return game.players.get(playerId)?.side === side
}

/** Le joueur `playerId` peut-il inscrire `entry` au journal partagé ? Oui
 *  s'il a la main. Une exception : l'entrée `turn` du joueur qui VIENT de
 *  rendre la main — elle est écrite après coup (cf. HexMap.vue::onTurnChange,
 *  différé), donc arrive quand le camp actif est déjà l'adversaire. */
export function mayLog(game, playerId, entry) {
  if (isPlayersTurn(game, playerId)) return true
  if (entry?.kind === 'turn' && entry.data?.step === game.turnStep) {
    return game.players.get(playerId)?.side === previousSide(game)
  }
  return false
}

export function recordMove(id, { counterId, col, row }) {
  const game = games.get(id)
  if (!game) throw new RoomError('not-found')
  if (game.status !== 'started') throw new RoomError('not-started')
  if (game.blitzLoser) throw new RoomError('game-over')
  game.boardState.set(String(counterId), { col, row })
  return game
}

export function advanceTurn(id) {
  const game = games.get(id)
  if (!game) throw new RoomError('not-found')
  if (game.status !== 'started') throw new RoomError('not-started')
  if (game.blitzLoser) throw new RoomError('game-over')
  // Le serveur ne connaît pas la longueur de la piste (données du module,
  // chargées seulement côté client) : il incrémente sans borne, chaque
  // client s'arrête déjà lui-même en fin de piste avant d'émettre.
  game.turnStep += 1
  game.phase = null
  game.phaseSince = Date.now()
  return game
}

/** Changement de phase SANS changement de pas (Airborne -> Mouvement,
 *  Mouvement -> Combat, Combat -> Fin de tour). Refusé s'il concerne un pas
 *  déjà dépassé (message en retard sur un `game:turn`). */
export function recordPhase(id, { phase, step, blitzUsed }) {
  const game = games.get(id)
  if (!game) throw new RoomError('not-found')
  if (game.status !== 'started') throw new RoomError('not-started')
  if (game.blitzLoser) throw new RoomError('game-over')
  if (!Number.isInteger(phase) || phase < -1 || phase > 2) throw new RoomError('bad-phase')
  if (step !== game.turnStep) throw new RoomError('stale-step')
  game.phase = phase
  game.phaseSince = Date.now()
  const cleanBlitz = sanitizeBlitz(blitzUsed)
  if (cleanBlitz) game.blitzUsedMs = cleanBlitz
  return { game, blitzUsed: cleanBlitz }
}

const MAX_JOURNAL_ENTRIES = 20000
const MAX_ENTRY_DATA_LENGTH = 50000

/** Entrée de journal reçue d'un client, assainie — `null` si invalide. */
function sanitizeEntry(entry) {
  if (!entry || typeof entry !== 'object') return null
  const { uid, t, kind, text, data } = entry
  if (typeof uid !== 'string' || !uid || uid.length > 64) return null
  if (typeof kind !== 'string' || !kind || kind.length > 32) return null
  const clean = { uid, t: String(t ?? '').slice(0, 32), kind, text: String(text ?? '').slice(0, 500), data: data ?? null }
  if (JSON.stringify(clean.data).length > MAX_ENTRY_DATA_LENGTH) return null
  return clean
}

function startedGame(id) {
  const game = games.get(id)
  if (!game) throw new RoomError('not-found')
  if (game.status !== 'started') throw new RoomError('not-started')
  return game
}

/** Ajoute une entrée au journal partagé. Renvoie l'entrée assainie, ou
 *  `null` si elle y est déjà (même `uid`). */
export function appendJournal(id, entry) {
  const game = startedGame(id)
  if (game.blitzLoser) throw new RoomError('game-over')
  const clean = sanitizeEntry(entry)
  if (!clean) throw new RoomError('bad-entry')
  if (game.journal.length >= MAX_JOURNAL_ENTRIES) throw new RoomError('journal-full')
  if (game.journal.some((existing) => existing.uid === clean.uid)) return null
  game.journal.push(clean)
  return clean
}

/** Retire une entrée du journal partagé (retour arrière). `true` si retirée. */
export function removeJournal(id, uid) {
  const game = startedGame(id)
  const index = game.journal.findIndex((entry) => entry.uid === uid)
  if (index === -1) return false
  game.journal.splice(index, 1)
  return true
}

/** Déploiement initial proposé par un joueur au lancement : retenu
 *  seulement si le journal est encore vide (le premier arrivé fait foi).
 *  Renvoie `{ entry, created }` — `entry` : le déploiement qui fait foi
 *  (`null` si le journal a déjà commencé sans en avoir). */
export function recordDeployment(id, entry) {
  const game = startedGame(id)
  const existing = game.journal.find((journalEntry) => journalEntry.kind === 'setup')
  if (existing) return { entry: existing, created: false }
  if (game.journal.length) return { entry: null, created: false }
  const clean = sanitizeEntry(entry)
  if (!clean || clean.kind !== 'setup') throw new RoomError('bad-entry')
  game.journal.push(clean)
  return { entry: clean, created: true }
}

/** Blitz : la pendule de `loser` est tombée à 0, il perd la partie. Seule
 *  la PREMIÈRE annonce compte (chaque client la détecte de son côté) : le
 *  serveur l'inscrit alors lui-même au journal partagé et renvoie
 *  `{ game, entry }` ; `null` si la partie était déjà terminée. */
export function recordGameOver(id, { loser, text, t }) {
  const game = games.get(id)
  if (!game) throw new RoomError('not-found')
  if (game.status !== 'started') throw new RoomError('not-started')
  if (game.settings.timing !== 'blitz') throw new RoomError('not-blitz')
  if (typeof loser !== 'string' || !loser || loser.length > 32) throw new RoomError('bad-loser')
  if (game.blitzLoser) return null
  game.blitzLoser = loser
  const entry = sanitizeEntry({ uid: `srv-${playerId()}`, t, kind: 'gameover', text: text || `Temps écoulé — ${loser}`, data: { loser } })
  game.journal.push(entry)
  return { game, entry }
}

/** Pendules "Blitz" reçues d'un client : quelques camps au plus, temps en
 *  ms positifs. `null` si absentes ou invalides. */
function sanitizeBlitz(blitzUsed) {
  if (!blitzUsed || typeof blitzUsed !== 'object') return null
  const entries = Object.entries(blitzUsed)
    .filter(([key, ms]) => key.length <= 32 && Number.isFinite(ms) && ms >= 0)
    .slice(0, 16)
  return entries.length ? Object.fromEntries(entries) : null
}

export function setPlayerConnectionBySocket(socketId, connected) {
  for (const game of games.values()) {
    for (const player of game.players.values()) {
      if (player.socketId === socketId) {
        player.connected = connected
        return game
      }
    }
  }
  return null
}
