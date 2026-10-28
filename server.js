const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(express.static('public'));

const rooms = {};
const playerSessions = {};

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

function getCardValue(rank) {
  if (rank === 'A') return 1;
  if (rank === 'J') return 11;
  if (rank === 'Q') return 12;
  if (rank === 'K') return 13;
  return parseInt(rank);
}

function initializeGame(room) {
  room.deck = createDeck();
  room.discard = [];
  room.currentPlayerIndex = 0;
  room.round = 1;
  room.maxRounds = 3;
  room.gameState = 'playing';
  room.scores = [0, 0, 0, 0];
  room.caboCalled = false;
  room.caboPlayerIndex = -1;

  for (let i = 0; i < 4; i++) {
    room.players[i].hand = [];
    for (let j = 0; j < 4; j++) {
      room.players[i].hand.push({
        card: room.deck.pop(),
        faceUp: j < 2
      });
    }
    room.players[i].visible = [true, true, false, false];
  }

  room.discard.push(room.deck.pop());
}

io.on('connection', (socket) => {
  socket.on('createRoom', (data) => {
    const roomCode = Math.random().toString(36).substr(2, 6).toUpperCase();
    rooms[roomCode] = {
      players: [
        { id: socket.id, name: data.playerName, hand: [], visible: [] },
        { id: null, name: '', hand: [], visible: [] },
        { id: null, name: '', hand: [], visible: [] },
        { id: null, name: '', hand: [], visible: [] }
      ],
      deck: [],
      discard: [],
      currentPlayerIndex: 0,
      round: 1,
      maxRounds: 3,
      gameState: 'waiting',
      scores: [0, 0, 0, 0],
      caboCalled: false,
      caboPlayerIndex: -1,
      drawnCard: null
    };
    
    playerSessions[socket.id] = { roomCode, playerIndex: 0 };
    socket.join(roomCode);
    socket.emit('roomCreated', { roomCode, playerIndex: 0 });
    io.to(roomCode).emit('playerListUpdated', rooms[roomCode].players.map((p, i) => ({
      index: i,
      name: p.name,
      connected: p.id !== null
    })));
  });

  socket.on('joinRoom', (data) => {
    const { roomCode, playerName } = data;
    const room = rooms[roomCode];
    
    if (!room) {
      socket.emit('error', 'Room not found');
      return;
    }
    
    let playerIndex = -1;
    for (let i = 0; i < 4; i++) {
      if (room.players[i].id === null) {
        playerIndex = i;
        break;
      }
    }
    
    if (playerIndex === -1) {
      socket.emit('error', 'Room is full');
      return;
    }
    
    room.players[playerIndex] = { id: socket.id, name: playerName, hand: [], visible: [] };
    playerSessions[socket.id] = { roomCode, playerIndex };
    socket.join(roomCode);
    
    socket.emit('roomJoined', { roomCode, playerIndex });
    io.to(roomCode).emit('playerListUpdated', room.players.map((p, i) => ({
      index: i,
      name: p.name,
      connected: p.id !== null
    })));
    
    const allConnected = room.players.every(p => p.id !== null);
    if (allConnected && room.gameState === 'waiting') {
      initializeGame(room);
      io.to(roomCode).emit('gameStarted', { initialGameState: getGameState(roomCode) });
    }
  });

  socket.on('drawCard', () => {
    const session = playerSessions[socket.id];
    const room = rooms[session.roomCode];
    
    if (room.deck.length === 0) {
      room.deck = room.discard.slice(0, -1).sort(() => Math.random() - 0.5);
      room.discard = [room.discard[room.discard.length - 1]];
    }
    
    room.drawnCard = room.deck.pop();
    io.to(session.roomCode).emit('drawnCard', { card: room.drawnCard });
  });

  socket.on('swapDrawnCard', (data) => {
    const session = playerSessions[socket.id];
    const room = rooms[session.roomCode];
    const { handIndex } = data;
    
    const oldCard = room.players[session.playerIndex].hand[handIndex].card;
    room.players[session.playerIndex].hand[handIndex].card = room.drawnCard;
    room.players[session.playerIndex].hand[handIndex].faceUp = false;
    room.discard.push(oldCard);
    room.drawnCard = null;
    
    io.to(session.roomCode).emit('gameUpdated', { gameState: getGameState(session.roomCode) });
  });

  socket.on('discardDrawnCard', () => {
    const session = playerSessions[socket.id];
    const room = rooms[session.roomCode];
    
    room.discard.push(room.drawnCard);
    room.drawnCard = null;
    
    io.to(session.roomCode).emit('gameUpdated', { gameState: getGameState(session.roomCode) });
  });

  socket.on('useSpecialAbility', (data) => {
    const session = playerSessions[socket.id];
    const room = rooms[session.roomCode];
    const { abilityType, targetPlayer, targetSlot, shouldSwap } = data;
    
    const topCard = room.discard[room.discard.length - 1];
    
    if (abilityType === '7or8') {
      const card = room.players[session.playerIndex].hand[targetSlot].card;
      socket.emit('viewOwnCard', { card });
    }
    
    if (abilityType === '9or10') {
      const card = room.players[targetPlayer].hand[targetSlot].card;
      socket.emit('viewOpponentCard', { card, playerName: room.players[targetPlayer].name });
    }
    
    if (abilityType === 'Jor Q') {
      const oldCard = room.players[targetPlayer].hand[targetSlot].card;
      room.players[targetPlayer].hand[targetSlot].card = topCard;
      room.players[targetPlayer].hand[targetSlot].faceUp = false;
      room.discard[room.discard.length - 1] = oldCard;
    }
    
    if (abilityType === 'Kor A') {
      if (shouldSwap) {
        const oldCard = room.players[targetPlayer].hand[targetSlot].card;
        room.players[targetPlayer].hand[targetSlot].card = topCard;
        room.players[targetPlayer].hand[targetSlot].faceUp = false;
        room.discard[room.discard.length - 1] = oldCard;
      }
    }
    
    io.to(session.roomCode).emit('gameUpdated', { gameState: getGameState(session.roomCode) });
  });

  socket.on('pairingCheck', (data) => {
    const session = playerSessions[socket.id];
    const room = rooms[session.roomCode];
    const { handIndex } = data;
    
    const playerCard = room.players[session.playerIndex].hand[handIndex].card;
    const topCard = room.discard[room.discard.length - 1];
    
    if (playerCard.rank === topCard.rank) {
      room.players[session.playerIndex].hand[handIndex].card = null;
      io.to(session.roomCode).emit('pairingSuccess', { playerIndex: session.playerIndex, handIndex });
    }
  });

  socket.on('endTurn', () => {
    const session = playerSessions[socket.id];
    const room = rooms[session.roomCode];
    
    room.currentPlayerIndex = (room.currentPlayerIndex + 1) % 4;
    io.to(session.roomCode).emit('gameUpdated', { gameState: getGameState(session.roomCode) });
  });

  socket.on('callCabo', () => {
    const session = playerSessions[socket.id];
    const room = rooms[session.roomCode];
    
    room.caboCalled = true;
    room.caboPlayerIndex = session.playerIndex;
    
    const scores = calculateRound(room);
    room.scores = room.scores.map((s, i) => s + scores[i]);
    
    if (room.round < room.maxRounds) {
      room.round++;
      room.gameState = 'playing';
      room.caboCalled = false;
      initializeGame(room);
      io.to(session.roomCode).emit('gameUpdated', { gameState: getGameState(session.roomCode) });
    } else {
      room.gameState = 'finished';
      io.to(session.roomCode).emit('gameFinished', { finalScores: room.scores, winner: room.scores.indexOf(Math.min(...room.scores)) });
    }
  });

  socket.on('disconnect', () => {
    const session = playerSessions[socket.id];
    if (session) {
      const room = rooms[session.roomCode];
      if (room) {
        room.players[session.playerIndex].id = null;
      }
      delete playerSessions[socket.id];
    }
  });
});

function calculateRound(room) {
  const scores = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    for (let card of room.players[i].hand) {
      if (card.card) {
        let value = getCardValue(card.card.rank);
        if (card.card.rank === 'K' && (card.card.suit === '♥' || card.card.suit === '♦')) {
          value = -1;
        }
        scores[i] += value;
      }
    }
  }
  return scores;
}

function getGameState(roomCode) {
  const room = rooms[roomCode];
  return {
    players: room.players.map((p, i) => ({
      index: i,
      name: p.name,
      hand: p.hand.map(h => ({
        card: h.card,
        faceUp: h.faceUp
      })),
      visible: p.visible
    })),
    discard: room.discard.length > 0 ? room.discard[room.discard.length - 1] : null,
    currentPlayerIndex: room.currentPlayerIndex,
    round: room.round,
    scores: room.scores,
    gameState: room.gameState,
    drawnCard: room.drawnCard
  };
}

server.listen(3000, () => {
  console.log('Server running on port 3000');
});

