import { RoomError, getGame, joinGame, recordMove, setPlayerConnectionBySocket, toPublic } from './rooms.js'

export function registerSocketHandlers(io) {
  io.on('connection', (socket) => {
    socket.on('game:join', ({ gameId, passcode, playerId, name, side } = {}, ack) => {
      try {
        const { game, playerId: resolvedPlayerId } = joinGame(gameId, {
          passcode,
          playerId,
          name,
          side,
          socketId: socket.id,
        })

        socket.join(`game:${gameId}`)
        socket.data.gameId = gameId
        socket.data.playerId = resolvedPlayerId

        const publicRoom = toPublic(game)
        ack?.({ ok: true, playerId: resolvedPlayerId, room: publicRoom })
        io.to(`game:${gameId}`).emit('room:update', publicRoom)
        if (game.status === 'started') {
          io.to(`game:${gameId}`).emit('room:started', publicRoom)
        }
      } catch (err) {
        const code = err instanceof RoomError ? err.code : 'unknown-error'
        ack?.({ ok: false, error: code })
      }
    })

    socket.on('game:move', ({ gameId, counterId, col, row } = {}) => {
      // Le joueur doit avoir rejoint cette room pour pouvoir bouger un pion
      // dessus — évite qu'un client injecte des coups dans une room qu'il
      // n'a jamais rejointe.
      if (socket.data.gameId !== gameId) return
      try {
        recordMove(gameId, { counterId, col, row })
        io.to(`game:${gameId}`).emit('game:move', { counterId, col, row })
      } catch {
        // Partie pas encore lancée ou déjà supprimée : on ignore silencieusement.
      }
    })

    socket.on('disconnect', () => {
      const game = setPlayerConnectionBySocket(socket.id, false)
      if (game) {
        io.to(`game:${game.id}`).emit('room:update', toPublic(game))
      }
    })
  })
}
