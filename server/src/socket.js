import { RoomError, getGame, joinGame, recordMove, advanceTurn, recordPhase, recordGameOver, appendJournal, removeJournal, recordDeployment, setPlayerConnectionBySocket, toPublic } from './rooms.js'

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
        // Journal partagé complet : seulement pour le joueur qui (re)joint
        // (trop volumineux pour les `room:update` diffusés à tous).
        ack?.({ ok: true, playerId: resolvedPlayerId, room: publicRoom, journal: game.journal })
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

    socket.on('game:turn', ({ gameId } = {}) => {
      // Même garde que game:move : seul un joueur ayant rejoint cette room
      // peut faire avancer sa piste de tour.
      if (socket.data.gameId !== gameId) return
      try {
        const game = advanceTurn(gameId)
        io.to(`game:${gameId}`).emit('game:turn', { turnStep: game.turnStep })
      } catch {
        // Partie pas encore lancée ou déjà supprimée : on ignore silencieusement.
      }
    })

    socket.on('game:phase', ({ gameId, phase, step, blitzUsed } = {}) => {
      // Même garde que game:move. Rediffusé aux AUTRES joueurs seulement :
      // l'émetteur a déjà changé de phase localement.
      if (socket.data.gameId !== gameId) return
      try {
        const recorded = recordPhase(gameId, { phase, step, blitzUsed })
        socket.to(`game:${gameId}`).emit('game:phase', { phase, step, blitzUsed: recorded.blitzUsed })
      } catch {
        // Partie pas lancée, phase invalide ou pas déjà dépassé : on ignore.
      }
    })

    socket.on('game:over', ({ gameId, loser, text, t } = {}) => {
      // Blitz : une pendule est tombée à 0. Diffusé à TOUS (émetteur
      // compris) une seule fois, à la première annonce — avec l'entrée de
      // journal correspondante, inscrite par le serveur.
      if (socket.data.gameId !== gameId) return
      try {
        const recorded = recordGameOver(gameId, { loser, text, t })
        if (recorded) {
          io.to(`game:${gameId}`).emit('game:over', { loser })
          io.to(`game:${gameId}`).emit('game:log', { entry: recorded.entry })
        }
      } catch {
        // Partie pas lancée, pas en Blitz ou annonce invalide : on ignore.
      }
    })

    socket.on('game:log', ({ gameId, entry } = {}) => {
      // Journal partagé : conservé puis transmis aux AUTRES joueurs
      // (l'émetteur l'a déjà dans son journal).
      if (socket.data.gameId !== gameId) return
      try {
        const clean = appendJournal(gameId, entry)
        if (clean) socket.to(`game:${gameId}`).emit('game:log', { entry: clean })
      } catch {
        // Partie pas lancée ou terminée, entrée invalide : on ignore.
      }
    })

    socket.on('game:unlog', ({ gameId, uid } = {}) => {
      if (socket.data.gameId !== gameId) return
      try {
        if (removeJournal(gameId, uid)) socket.to(`game:${gameId}`).emit('game:unlog', { uid })
      } catch {
        // Partie pas lancée : on ignore.
      }
    })

    socket.on('game:deploy', ({ gameId, entry } = {}, ack) => {
      // Déploiement initial : le premier proposé fait foi, renvoyé à
      // l'émetteur (ack) et transmis aux autres joueurs s'il est nouveau.
      if (socket.data.gameId !== gameId) return ack?.({ ok: false })
      try {
        const recorded = recordDeployment(gameId, entry)
        if (recorded.created) socket.to(`game:${gameId}`).emit('game:log', { entry: recorded.entry })
        ack?.({ ok: true, entry: recorded.entry })
      } catch {
        ack?.({ ok: false })
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
