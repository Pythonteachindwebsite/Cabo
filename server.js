const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};
const userSockets = {};

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
    return card.suit === '♥' || card.suit === '♦' ? -1 : 13;
  }
  return parseInt(card.rank);
}

function initializeGame(room) {
  room.deck = createDeck();
  room.discardPile = [];
  room.currentPlayerIndex = 0;
  room.gameState = 'initial'; // 'initial', 'playing', 'ended'
  room.playersConfirmed = {};

  room.players.forEach((player, index) => {
    player.hand = [];
    player.confirmed = false;
    player.caboCalled = false;
    room.playersConfirmed[player.id] = false;

    for (let i = 0; i < 4; i++) {
      player.hand.push({
        card: room.deck.pop(),
        faceUp: i < 2, // First 2 cards face up
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
      players: [{ id: socket.id, username, hand: [] }],
      deck: [],
      discardPile: [],
      gameState: 'waiting'
    };
    userSockets[socket.id] = socket;
    socket.join(roomCode);
    socket.emit('roomCreated', { roomCode, players: rooms[roomCode].players });
    io.to(roomCode).emit('playerListUpdated', rooms[roomCode].players);
  });

  socket.on('joinRoom', (data) => {
    const { roomCode, username } = data;
    if (!rooms[roomCode]) {
      socket.emit('error', 'Room not found');
      return;
    }
    const room = rooms[roomCode];
    if (room.gameState !== 'waiting') {
      socket.emit('error', 'Game already started');
      return;
    }
    room.players.push({ id: socket.id, username, hand: [] });
    userSockets[socket.id] = socket;
    socket.join(roomCode);
    socket.emit('roomJoined', { roomCode, players: room.players });
    io.to(roomCode).emit('playerListUpdated', room.players);
  });

  socket.on('startGame', (roomCode) => {
    const room = rooms[roomCode];
    if (!room || room.players.length < 2) {
      socket.emit('error', 'Need at least 2 players');
      return;
    }
    if (room.host !== socket.id) {
      socket.emit('error', 'Only host can start game');
      return;
    }
    room.gameState = 'initial';
    initializeGame(room);
    io.to(roomCode).emit('gameStarted', { players: room.players });
  });

  socket.on('confirmCards', (roomCode) => {
    const room = rooms[roomCode];
    if (!room) return;
    room.playersConfirmed[socket.id] = true;
    const allConfirmed = room.players.every(p => room.playersConfirmed[p.id]);
    if (allConfirmed) {
      room.gameState = 'playing';
      room.players.forEach(p => {
        p.hand.forEach(h => h.faceUp = false);
      });
      io.to(roomCode).emit('gameReadyToPlay', { discardTop: room.discardPile[0] });
    } else {
      io.to(roomCode).emit('playerConfirmed', { confirmed: Object.keys(room.playersConfirmed).filter(id => room.playersConfirmed[id]).length, total: room.players.length });
    }
  });

  socket.on('drawCard', (roomCode) => {
    const room = rooms[roomCode];
    if (!room || room.gameState !== 'playing') return;
    const drawnCard = room.deck.pop();
    socket.emit('cardDrawn', { card: drawnCard });
  });

  socket.on('swapOrDiscard', (data) => {
    const { roomCode, action, cardPosition, drawnCard } = data;
    const room = rooms[roomCode];
    if (!room || room.gameState !== 'playing') return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    if (action === 'swap' && cardPosition !== null) {
      const oldCard = player.hand[cardPosition].card;
      player.hand[cardPosition].card = drawnCard;
      player.hand[cardPosition].faceUp = false;
      room.discardPile.push(oldCard);
    } else {
      room.discardPile.push(drawnCard);
    }

    socket.emit('actionComplete');
    io.to(roomCode).emit('gameUpdated', {
      discardTop: room.discardPile[room.discardPile.length - 1],
      currentPlayer: room.players[room.currentPlayerIndex].username
    });
  });

  socket.on('callCabo', (roomCode) => {
    const room = rooms[roomCode];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;
    player.caboCalled = true;
    room.gameState = 'ended';
    const scores = room.players.map(p => ({
      username: p.username,
      cards: p.hand.map(h => h.card),
      total: p.hand.reduce((sum, h) => sum + getCardValue(h.card), 0)
    }));
    io.to(roomCode).emit('gameEnded', { scores, caboPlayer: player.username });
  });

  socket.on('leaveRoom', (roomCode) => {
    if (rooms[roomCode]) {
      const room = rooms[roomCode];
      room.players = room.players.filter(p => p.id !== socket.id);
      if (room.players.length === 0) {
        delete rooms[roomCode];
      } else {
        if (room.host === socket.id) {
          room.host = room.players[0].id;
        }
        io.to(roomCode).emit('playerLeftRoom', room.players);
      }
    }
    delete userSockets[socket.id];
    socket.leave(roomCode);
  });

  socket.on('disconnect', () => {
    delete userSockets[socket.id];
    for (let roomCode in rooms) {
      const room = rooms[roomCode];
      room.players = room.players.filter(p => p.id !== socket.id);
      if (room.players.length

