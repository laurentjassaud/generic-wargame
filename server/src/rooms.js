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

export function createGame({ moduleId, scenarioId, variants, maxPlayers }) {
  const id = gameId()
  const game = {
    id,
    moduleId,
    scenarioId,
    variants: Array.isArray(variants) ? variants : [],
    maxPlayers,
    passcode: passcode(),
    status: 'lobby', // 'lobby' | 'started'
    createdAt: Date.now(),
    players: new Map(), // playerId -> { id, name, side, connected, socketId }
    boardState: new Map(), // counterId -> { col, row } — positions déplacées depuis le setup du module
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
    maxPlayers: game.maxPlayers,
    status: game.status,
    playerCount: game.players.size,
    createdAt: game.createdAt,
  }
}

export function toPublic(game) {
  return {
    ...toSummary(game),
    players: [...game.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      side: p.side,
      connected: p.connected,
    })),
    boardState: Object.fromEntries(game.boardState),
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
    const sideTaken = [...game.players.values()].some((p) => p.side === side)
    if (sideTaken) throw new RoomError('side-taken')
  }

  const id_ = reconnecting ? existingPlayerId : playerId()
  const player = reconnecting
    ? game.players.get(id_)
    : { id: id_, name, side, connected: false, socketId: null }

  player.name = name ?? player.name
  player.side = side ?? player.side
  player.connected = true
  player.socketId = socketId
  game.players.set(id_, player)

  if (!reconnecting && game.players.size === game.maxPlayers) {
    game.status = 'started'
  }

  return { game, playerId: id_ }
}

export function recordMove(id, { counterId, col, row }) {
  const game = games.get(id)
  if (!game) throw new RoomError('not-found')
  if (game.status !== 'started') throw new RoomError('not-started')
  game.boardState.set(String(counterId), { col, row })
  return game
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
