const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function createDeck() {
  const suits = ['♠', '♥', '♦', '♣'];
  const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const deck = [];
  for (let suit of suits) {
    for (let rank of ranks) {
      deck.push({ rank, suit });
    }
  }
  return deck.sort(() => Math.random() - 0.5);
}

function getCardValue(card) {
  if (card.rank === 'A') return 1;
  if (card.rank === 'J') return 11;
  if (card.rank === 'Q') return 12;
  if (card.rank === 'K') {
    return (card.suit === '♥' || card.suit === '♦') ? -1 : 13;
  }
  return parseInt(card.rank);
}

function initializeGame(room) {
  room.deck = createDeck();
  room.discardPile = [];
  room.currentPlayerIndex = 0;
  room.gamePhase = 'initial'; // 'initial', 'playing', 'ended'
  room.playersReady = {};

  room.players.forEach((player) => {
    player.hand = [];
    player.confirmed = false;
    player.caboCalled = false;
    room.playersReady[player.id] = false;

    for (let i = 0; i < 4; i++) {
      player.hand.push({
        card: room.deck.pop(),
        faceUp: i < 2,
        position: i
      });
    }
  });

  room.discardPile.push(room.deck.pop());
}

io.on('connection', (socket) => {
  socket.on('createRoom', (username) => {
    const roomCode = generateRoomCode();
    rooms[roomCode] = {
      code: roomCode,
      host: socket.id,
      players: [{ id: socket.id, username, hand: [], confirmed: false, caboCalled: false }],
      gamePhase: 'waiting'
    };
    socket.join(roomCode);
    socket.emit('roomCreated', { roomCode });
    io.to(roomCode).emit('playerListUpdated', {
      players: rooms[roomCode].players.map(p => ({ id: p.id, username: p.username }))
    });
  });

  socket.on('joinRoom', (data) => {
    const { roomCode, username } = data;
    if (!rooms[roomCode]) {
      socket.emit('joinError', 'Room not found');
      return;
    }
    const room = rooms[roomCode];
    if (room.gamePhase !== 'waiting') {
      socket.emit('joinError', 'Game already started');
      return;
    }
    room.players.push({ id: socket.id, username, hand: [], confirmed: false, caboCalled: false });
    socket.join(roomCode);
    socket.emit('joinSuccess', { roomCode });
    io.to(roomCode).emit('playerListUpdated', {
      players: room.players.map(p => ({ id: p.id, username: p.username }))
    });
  });

  socket.on('startGame', (roomCode) => {
    const room = rooms[roomCode];
    if (!room || room.host !== socket.id) return;
    if (room.players.length < 2) {
      socket.emit('error', 'Need at least 2 players');
      return;
    }
    room.gamePhase = 'initial';
    initializeGame(room);
    io.to(roomCode).emit('gameStarted', {
      players: room.players.map(p => ({ id: p.id, username: p.username })),
      yourHand: room.players.find(p => p.id === socket.id).hand
    });
  });

  socket.on('confirmCards', (roomCode) => {
    const room = rooms[roomCode];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;
    player.confirmed = true;
    room.playersReady[socket.id] = true;

    const allConfirmed = room.players.every(p => room.playersReady[p.id]);
    if (allConfirmed) {
      room.gamePhase = 'playing';
      room.players.forEach(p => {
        p.hand.forEach(h => h.faceUp = false);
      });
      io.to(roomCode).emit('gameReady', {
        discardTop: room.discardPile[room.discardPile.length - 1],
        currentPlayer: room.players[room.currentPlayerIndex].username
      });
    } else {
      const confirmedCount = room.players.filter(p => p.confirmed).length;
      io.to(roomCode).emit('confirmStatus', {
        confirmed: confirmedCount,
        total: room.players.length
      });
    }
  });

  socket.on('drawCard', (roomCode) => {
    const room = rooms[roomCode];
    if (!room || room.gamePhase !== 'playing') return;
    if (room.deck.length === 0) {
      io.to(roomCode).emit('noDeckCards');
      return;
    }
    const drawnCard = room.deck.pop();
    socket.emit('cardDrawn', { card: drawnCard });
  });

  socket.on('swapOrDiscard', (data) => {
    const { roomCode, action, cardPosition, drawnCard } = data;
    const room = rooms[roomCode];
    if (!room || room.gamePhase !== 'playing') return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    let swappedCard = null;
    if (action === 'swap' && cardPosition !== null && cardPosition >= 0 && cardPosition < 4) {
      swappedCard = player.hand[cardPosition].card;
      player.hand[cardPosition].card = drawnCard;
      player.hand[cardPosition].faceUp = false;
    }
    room.discardPile.push(drawnCard);

    socket.emit('actionComplete');
    io.to(roomCode).emit('gameUpdated', {
      discardTop: room.discardPile[room.discardPile.length - 1],
      discardedCard: drawnCard
    });

    // Check for special ability trigger only on discard
    if (action === 'discard' || (action === 'swap' && swappedCard)) {
      const ability = getAbility(drawnCard);
      if (ability) {
        socket.emit('specialAbilityTriggered', {
          ability,
          card: drawnCard,
          otherPlayers: room.players.filter(p => p.id !== socket.id).map(p => ({ id: p.id, username: p.username }))
        });
      }
    }
  });

  socket.on('useAbility', (data) => {
    const { roomCode, ability, targetPlayerId, targetPosition } = data;
    const room = rooms[roomCode];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    const targetPlayer = targetPlayerId ? room.players.find(p => p.id === targetPlayerId) : player;
    if (!player || !targetPlayer) return;

    if (ability === '7or8') {
      socket.emit('abilityResult', {
        type: 'viewOwn',
        cards: player.hand
      });
    } else if (ability === '9or10') {
      if (targetPlayer && targetPosition >= 0 && targetPosition < 4) {
        socket.emit('abilityResult', {
          type: 'viewOpponent',
          card: targetPlayer.hand[targetPosition].card,
          position: targetPosition,
          player: targetPlayer.username
        });
      }
    } else if (ability === 'Jor Q') {
      if (targetPlayer && targetPosition >= 0 && targetPosition < 4) {
        const oldCard = targetPlayer.hand[targetPosition].card;
        targetPlayer.hand[targetPosition].card = player.lastDiscardedCard;
        player.lastDiscardedCard = oldCard;
        io.to(roomCode).emit('blindSwapCompleted', {
          initiator: player.username,
          target: targetPlayer.username
        });
      }
    } else if (ability === 'KorA') {
      if (targetPlayer && targetPosition >= 0 && targetPosition < 4) {
        socket.emit('abilityResult', {
          type: 'viewAndDecide',
          card: targetPlayer.hand[targetPosition].card,
          position: targetPosition,
          player: targetPlayer.username,
          targetPlayerId: targetPlayer.id
        });
      }
    }
  });

  socket.on('confirmSwapKA', (data) => {
    const { roomCode, targetPlayerId, targetPosition, confirmSwap } = data;
    const room = rooms[roomCode];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    const targetPlayer = room.players.find(p => p.id === targetPlayerId);
    if (!player || !targetPlayer) return;

    if (confirmSwap) {
      const temp = player.hand[0].card;
      player.hand[0].card = targetPlayer.hand[targetPosition].card;
      targetPlayer.hand[targetPosition].card = temp;
    }
    socket.emit('actionComplete');
  });

  socket.on('callCabo', (roomCode) => {
    const room = rooms[roomCode];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    player.caboCalled = true;
    room.gamePhase = 'ended';

    const scores = room.players.map(p => ({
      id: p.id,
      username: p.username,
      hand: p.hand.map(h => ({ rank: h.card.rank, suit: h.card.suit })),
      score: p.hand.reduce((sum, h) => sum + getCardValue(h.card), 0)
    }));

    io.to(roomCode).emit('gameEnded', {
      scores,
      caboCaller: player.username
    });
  });

  socket.on('leaveRoom', (roomCode) => {
    const room = rooms[roomCode];
    if (!room) return;
    room.players = room.players.filter(p => p.id !== socket.id);
    if (room.players.length === 0) {
      delete rooms[roomCode];
    } else {
      if (room.host === socket.id) {
        room.host = room.players[0].id;
      }
      io.to(roomCode).emit('playerListUpdated', {
        players: room.players.map(p => ({ id: p.id, username: p.username }))
      });
    }
    socket.leave(roomCode);
  });

  socket.on('disconnect', () => {
    for (let roomCode in rooms) {
      const room = rooms[roomCode];
      room.players = room.players.filter(p => p.id !== socket.id);
      if (room.players.length === 0) {
        delete rooms[roomCode];
      } else {
        if (room.host === socket.id) {
          room.host = room.players[0].id;
        }
        io.to(roomCode).emit('playerListUpdated', {
          players: room.players.map(p => ({ id: p.id, username: p.username }))
        });
      }
    }
  });
});

function getAbility(card) {
  if (card.rank === '7' || card.rank === '8') return '7or8';
  if (card.rank === '9' || card.rank === '10') return '9or10';
  if (card.rank === 'J' || card.rank === 'Q') return 'Jor Q';
  if (card.rank === 'K' || card.rank === 'A') return 'KorA';
  return null;
}

server.listen(3000, () => {
  console.log('Server running on port 3000');
});

