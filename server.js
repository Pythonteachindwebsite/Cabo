// server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: '*' } });

app.use(express.static('public'));

const rooms = {};

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
  const rank = card.rank;
  if (rank === 'A') return 1;
  if (rank === 'K') return card.suit === '♥' || card.suit === '♦' ? -1 : 13;
  if (rank === 'Q') return 12;
  if (rank === 'J') return 11;
  if (rank === '10') return 10;
  return parseInt(rank);
}

function initializeGame(roomCode) {
  const deck = createDeck();
  const players = rooms[roomCode].players;
  
  const game = {
    deck,
    discard: [],
    players: players.map((p, i) => ({
      id: p.id,
      name: p.name,
      hand: [],
      visible: [null, null, null, null],
      score: 0,
      confirmed: false
    })),
    currentPlayerIndex: 0,
    round: 1,
    gameStarted: false,
    allConfirmed: false,
    turnPhase: 'draw'
  };

  // 发初始卡牌
  for (let player of game.players) {
    for (let i = 0; i < 4; i++) {
      player.hand.push(deck.pop());
    }
    player.visible = [0, 1, null, null]; // 位置0和1可见，2和3隐藏
  }

  game.discard.push(deck.pop());
  rooms[roomCode].game = game;
}

io.on('connection', (socket) => {
  socket.on('createRoom', (playerName, callback) => {
    const roomCode = Math.random().toString(36).substr(2, 6).toUpperCase();
    rooms[roomCode] = {
      code: roomCode,
      players: [{ id: socket.id, name: playerName }],
      game: null,
      maxPlayers: 4
    };
    socket.join(roomCode);
    socket.roomCode = roomCode;
    callback({ success: true, roomCode });
  });

  socket.on('joinRoom', (roomCode, playerName, callback) => {
    if (!rooms[roomCode]) {
      callback({ success: false, message: 'Room not found' });
      return;
    }
    if (rooms[roomCode].players.length >= 4) {
      callback({ success: false, message: 'Room is full' });
      return;
    }
    rooms[roomCode].players.push({ id: socket.id, name: playerName });
    socket.join(roomCode);
    socket.roomCode = roomCode;
    io.to(roomCode).emit('playerJoined', {
      players: rooms[roomCode].players,
      totalPlayers: rooms[roomCode].players.length
    });
    callback({ success: true, roomCode });
  });

  socket.on('startGame', (callback) => {
    const roomCode = socket.roomCode;
    if (!rooms[roomCode]) return;
    
    const playerCount = rooms[roomCode].players.length;
    if (playerCount < 2) {
      callback({ success: false, message: 'Need 2+ players' });
      return;
    }

    initializeGame(roomCode);
    rooms[roomCode].game.gameStarted = true;
    
    // 发送初始状态（卡牌可见）
    const gameState = rooms[roomCode].game.players.map(p => ({
      name: p.name,
      visible: p.visible.map((idx, pos) => idx !== null ? { ...p.hand[idx], position: pos } : null),
      hand: p.hand
    }));

    io.to(roomCode).emit('gameInitialized', {
      gameState,
      players: rooms[roomCode].players.map(p => p.name),
      message: 'Game started! View your 2 cards (top row). After 2 seconds they will flip.'
    });

    callback({ success: true });
  });

  socket.on('confirmFlip', () => {
    const roomCode = socket.roomCode;
    if (!rooms[roomCode] || !rooms[roomCode].game) return;

    const game = rooms[roomCode].game;
    const player = game.players.find(p => p.id === socket.id);
    if (player) {
      player.confirmed = true;
    }

    const allConfirmed = game.players.every(p => p.confirmed);
    if (allConfirmed) {
      game.allConfirmed = true;
      game.turnPhase = 'draw';
      io.to(roomCode).emit('allConfirmed', { message: 'All players confirmed! Game is starting...' });
    }
  });

  socket.on('drawCard', () => {
    const roomCode = socket.roomCode;
    if (!rooms[roomCode] || !rooms[roomCode].game) return;

    const game = rooms[roomCode].game;
    if (game.deck.length === 0) {
      io.to(roomCode).emit('gameMessage', 'Deck empty!');
      return;
    }

    const drawnCard = game.deck.pop();
    io.to(roomCode).emit('cardDrawn', { card: drawnCard, playerId: socket.id });
  });

  socket.on('swapWithHand', (position) => {
    const roomCode = socket.roomCode;
    if (!rooms[roomCode] || !rooms[roomCode].game) return;

    const game = rooms[roomCode].game;
    const player = game.players.find(p => p.id === socket.id);
    if (!player) return;

    // 交换逻辑（简化版本）
    io.to(roomCode).emit('cardSwapped', { playerId: socket.id, position });
  });

  socket.on('discardCard', (card) => {
    const roomCode = socket.roomCode;
    if (!rooms[roomCode] || !rooms[roomCode].game) return;

    const game = rooms[roomCode].game;
    game.discard.push(card);
    
    // 进到下一个玩家
    game.currentPlayerIndex = (game.currentPlayerIndex + 1) % game.players.length;
    io.to(roomCode).emit('turnChanged', { 
      currentPlayer: game.players[game.currentPlayerIndex].name,
      discard: game.discard[game.discard.length - 1]
    });
  });

  socket.on('leaveRoom', () => {
    const roomCode = socket.roomCode;
    if (rooms[roomCode]) {
      rooms[roomCode].players = rooms[roomCode].players.filter(p => p.id !== socket.id);
      if (rooms[roomCode].players.length === 0) {
        delete rooms[roomCode];
      } else {
        io.to(roomCode).emit('playerLeft', {
          players: rooms[roomCode].players,
          totalPlayers: rooms[roomCode].players.length
        });
      }
    }
    socket.leave(roomCode);
  });

  socket.on('disconnect', () => {
    const roomCode = socket.roomCode;
    if (rooms[roomCode]) {
      rooms[roomCode].players = rooms[roomCode].players.filter(p => p.id !== socket.id);
      if (rooms[roomCode].players.length === 0) {
        delete rooms[roomCode];
      }
    }
  });
});

server.listen(3000, () => {
  console.log('Server running on port 3000');
});

