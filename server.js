const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: '*' } });

app.use(express.static('public'));

const rooms = {};
const CARD_VALUES = {
  '0': 0, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6,
  '7': 7, '8': 8, '9': 9, '10': 10,
  'J': 11, 'Q': 12, 'K': 13, 'A': 14
};

function createDeck() {
  const suits = ['♠', '♥', '♣', '♦'];
  const ranks = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const deck = [];
  for (let suit of suits) {
    for (let rank of ranks) {
      deck.push({ rank, suit });
    }
  }
  return deck.sort(() => Math.random() - 0.5);
}

function initializeGame(roomId) {
  const room = rooms[roomId];
  room.deck = createDeck();
  room.discardPile = [];
  room.currentRound = 1;
  room.roundScores = {};
  room.gameActive = false;
  room.currentPlayerIndex = 0;
  room.gameEnded = false;

  room.players.forEach(player => {
    player.hand = [];
    player.handVisible = [];
    player.scores = player.scores || [];
    room.roundScores[player.id] = 0;
  });

  dealCards(roomId);
}

function dealCards(roomId) {
  const room = rooms[roomId];
  room.players.forEach(player => {
    player.hand = [];
    player.handVisible = [];
    for (let i = 0; i < 4; i++) {
      const card = room.deck.pop();
      player.hand.push(card);
      if (i < 2) {
        player.handVisible.push(true);
      } else {
        player.handVisible.push(false);
      }
    }
  });
  room.discardPile = [room.deck.pop()];
}

function getCardValue(card) {
  return CARD_VALUES[card.rank];
}

function calculateRoundScore(hand) {
  let score = 0;
  let pairs = {};
  for (let card of hand) {
    const value = getCardValue(card);
    score += value;
    pairs[value] = (pairs[value] || 0) + 1;
  }
  for (let value in pairs) {
    if (pairs[value] === 2) {
      score -= 2 * parseInt(value);
    }
  }
  return Math.max(0, score);
}

function endRound(roomId) {
  const room = rooms[roomId];
  let minScore = Infinity;
  let caboPlayer = null;
  let callerId = null;

  room.players.forEach(player => {
    const score = calculateRoundScore(player.hand);
    room.roundScores[player.id] = score;
    if (score < minScore) {
      minScore = score;
      caboPlayer = player.id;
    }
  });

  callerId = room.caboCallerId || null;

  if (callerId && callerId !== caboPlayer) {
    room.roundScores[callerId] += 10;
  }

  room.players.forEach(player => {
    player.scores.push(room.roundScores[player.id]);
  });

  const totalScores = {};
  room.players.forEach(player => {
    totalScores[player.id] = player.scores.reduce((a, b) => a + b, 0);
  });

  if (room.currentRound >= 3) {
    room.gameEnded = true;
    room.gameActive = false;
    io.to(roomId).emit('gameEnded', { totalScores, caboPlayer, callerId });
  } else {
    room.currentRound++;
    room.caboCallerId = null;
    initializeGame(roomId);
    room.gameActive = true;
    io.to(roomId).emit('newRound', { round: room.currentRound });
    broadcastGameState(roomId);
  }
}

function broadcastGameState(roomId) {
  const room = rooms[roomId];
  room.players.forEach((player, index) => {
    const playerState = {
      players: room.players.map((p, idx) => ({
        id: p.id,
        name: p.name,
        hand: p.hand,
        handVisible: p.handVisible,
        isCurrentPlayer: idx === room.currentPlayerIndex,
        isSelf: p.id === player.id
      })),
      discardTop: room.discardPile.length > 0 ? room.discardPile[room.discardPile.length - 1] : null,
      deckSize: room.deck.length,
      currentPlayerIndex: room.currentPlayerIndex,
      gameActive: room.gameActive,
      currentRound: room.currentRound,
      playerId: player.id
    };
    io.to(player.socketId).emit('gameState', playerState);
  });
}

function switchTurn(roomId) {
  const room = rooms[roomId];
  room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.players.length;
  broadcastGameState(roomId);
}

io.on('connection', (socket) => {
  socket.on('createRoom', (playerName) => {
    const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    rooms[roomId] = {
      id: roomId,
      players: [{ id: socket.id, name: playerName, socketId: socket.id, hand: [], handVisible: [], scores: [] }],
      deck: [],
      discardPile: [],
      currentPlayerIndex: 0,
      gameActive: false,
      currentRound: 1,
      roundScores: {},
      gameEnded: false,
      hostId: socket.id,
      caboCallerId: null
    };
    socket.join(roomId);
    socket.emit('roomCreated', { roomId, isHost: true });
  });

  socket.on('joinRoom', (data) => {
    const { roomId, playerName } = data;
    if (!rooms[roomId]) {
      socket.emit('error', 'Room not found');
      return;
    }
    const room = rooms[roomId];
    if (room.players.length >= 4) {
      socket.emit('error', 'Room is full');
      return;
    }
    room.players.push({ id: socket.id, name: playerName, socketId: socket.id, hand: [], handVisible: [], scores: [] });
    socket.join(roomId);
    socket.emit('roomJoined', { roomId, isHost: false });
    io.to(roomId).emit('playerJoined', { players: room.players.map(p => ({ id: p.id, name: p.name })) });
  });

  socket.on('startGame', (roomId) => {
    const room = rooms[roomId];
    if (!room) return;
    if (socket.id !== room.hostId) return;
    if (room.players.length < 2) {
      socket.emit('error', 'Need at least 2 players');
      return;
    }
    room.gameActive = true;
    room.gameEnded = false;
    initializeGame(roomId);
    io.to(roomId).emit('gameStarted');
    setTimeout(() => {
      room.players.forEach(player => {
        player.handVisible = [true, true, false, false];
      });
      broadcastGameState(roomId);
      setTimeout(() => {
        room.players.forEach(player => {
          player.handVisible = [false, false, false, false];
        });
        broadcastGameState(roomId);
      }, 2000);
    }, 500);
  });

  socket.on('drawCard', (roomId) => {
    const room = rooms[roomId];
    if (!room || !room.gameActive) return;
    const currentPlayer = room.players[room.currentPlayerIndex];
    if (currentPlayer.socketId !== socket.id) return;

    const drawnCard = room.deck.pop();
    currentPlayer.drawnCard = drawnCard;
    io.to(room.players[room.currentPlayerIndex].socketId).emit('cardDrawn', { card: drawnCard });
  });

  socket.on('swapCard', (data) => {
    const { roomId, handIndex } = data;
    const room = rooms[roomId];
    if (!room || !room.gameActive) return;
    const currentPlayer = room.players[room.currentPlayerIndex];
    if (currentPlayer.socketId !== socket.id) return;

    if (currentPlayer.drawnCard && handIndex >= 0 && handIndex < 4) {
      const swappedCard = currentPlayer.hand[handIndex];
      currentPlayer.hand[handIndex] = currentPlayer.drawnCard;
      currentPlayer.handVisible[handIndex] = false;
      room.discardPile.push(swappedCard);
      delete currentPlayer.drawnCard;
      switchTurn(roomId);
    }
  });

  socket.on('discardCard', (roomId) => {
    const room = rooms[roomId];
    if (!room || !room.gameActive) return;
    const currentPlayer = room.players[room.currentPlayerIndex];
    if (currentPlayer.socketId !== socket.id) return;

    if (currentPlayer.drawnCard) {
      room.discardPile.push(currentPlayer.drawnCard);
      delete currentPlayer.drawnCard;
      switchTurn(roomId);
    }
  });

  socket.on('useSpecialAbility', (data) => {
    const { roomId, cardIndex, targetPlayerIndex, targetCardIndex } = data;
    const room = rooms[roomId];
    if (!room || !room.gameActive) return;
    const currentPlayer = room.players[room.currentPlayerIndex];
    if (currentPlayer.socketId !== socket.id) return;

    const card = currentPlayer.hand[cardIndex];
    if (!card) return;

    const rank = card.rank;
    const targetPlayer = room.players[targetPlayerIndex];

    if (rank === '7' || rank === '8') {
      const ownCard = currentPlayer.hand[targetCardIndex];
      io.to(socket.id).emit('cardPeeked', { card: ownCard, isOwn: true });
    } else if (rank === '9' || rank === '10') {
      const opponentCard = targetPlayer.hand[targetCardIndex];
      io.to(socket.id).emit('cardPeeked', { card: opponentCard, isOpponent: true });
    } else if (rank === 'K' || rank === 'A') {
      const opponentCard = targetPlayer.hand[targetCardIndex];
      io.to(socket.id).emit('cardPeekedForSwap', { card: opponentCard, targetPlayerIndex, targetCardIndex });
    } else if (rank === 'J' || rank === 'Q') {
      const swappedCard = targetPlayer.hand[targetCardIndex];
      targetPlayer.hand[targetCardIndex] = currentPlayer.hand[cardIndex];
      targetPlayer.handVisible[targetCardIndex] = false;
      currentPlayer.hand[cardIndex] = swappedCard;
      currentPlayer.handVisible[cardIndex] = false;
      switchTurn(roomId);
    }
  });

  socket.on('swapWithOpponent', (data) => {
    const { roomId, targetPlayerIndex, targetCardIndex } = data;
    const room = rooms[roomId];
    if (!room || !room.gameActive) return;
    const currentPlayer = room.players[room.currentPlayerIndex];
    const targetPlayer = room.players[targetPlayerIndex];

    const swappedCard = targetPlayer.hand[targetCardIndex];
    targetPlayer.hand[targetCardIndex] = currentPlayer.hand[0];
    targetPlayer.handVisible[targetCardIndex] = false;
    currentPlayer.hand[0] = swappedCard;
    currentPlayer.handVisible[0] = false;
    switchTurn(roomId);
  });

  socket.on('callCabo', (roomId) => {
    const room = rooms[roomId];
    if (!room || !room.gameActive) return;
    room.caboCallerId = socket.id;
    io.to(roomId).emit('caboCalled', { playerName: room.players.find(p => p.socketId === socket.id).name });
    endRound(roomId);
  });

  socket.on('checkRoundEnd', (roomId) => {
    const room = rooms[roomId];
    if (!room || !room.gameActive) return;
    const allExposed = room.players.every(p => p.handVisible.every(v => v === true || v === false));
    if (allExposed && room.players.some(p => p.handVisible.every(v => v === true))) {
      endRound(roomId);
    }
  });

  socket.on('disconnect', () => {
    for (let roomId in rooms) {
      const room = rooms[roomId];
      room.players = room.players.filter(p => p.socketId !== socket.id);
      if (room.players.length === 0) {
        delete rooms[roomId];
      } else {
        io.to(roomId).emit('playerLeft', { players: room.players.map(p => ({ id: p.id, name: p.name })) });
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));

