const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

app.use(express.static('public'));

const rooms = {};
const players = {};

io.on('connection', (socket) => {
  socket.on('createRoom', (playerName, callback) => {
    const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    rooms[roomCode] = {
      code: roomCode,
      players: [{ id: socket.id, name: playerName, ready: false }],
      gameState: 'waiting',
      currentRound: 1,
      currentPlayerIndex: 0,
      deck: [],
      discardPile: [],
      playerCards: {},
      playerCardsFaceDown: {},
      pairedCards: {},
      scores: {},
      gameLog: []
    };
    
    players[socket.id] = { room: roomCode, name: playerName, index: 0 };
    socket.join(roomCode);
    socket.emit('roomCreated', roomCode);
    io.to(roomCode).emit('playerJoined', rooms[roomCode].players);
  });

  socket.on('joinRoom', (roomCode, playerName, callback) => {
    if (!rooms[roomCode]) {
      socket.emit('error', '房間不存在');
      return;
    }
    if (rooms[roomCode].players.length >= 4) {
      socket.emit('error', '房間已滿');
      return;
    }

    const playerIndex = rooms[roomCode].players.length;
    rooms[roomCode].players.push({ id: socket.id, name: playerName, ready: false });
    players[socket.id] = { room: roomCode, name: playerName, index: playerIndex };
    
    socket.join(roomCode);
    io.to(roomCode).emit('playerJoined', rooms[roomCode].players);
  });

  socket.on('startGame', () => {
    const roomCode = players[socket.id].room;
    const room = rooms[roomCode];
    
    if (!room || room.players.length < 2) {
      socket.emit('error', '至少需要2名玩家');
      return;
    }

    room.gameState = 'playing';
    initializeGame(room);
    io.to(roomCode).emit('gameStarted', {
      players: room.players,
      playerCards: room.playerCards,
      playerCardsFaceDown: room.playerCardsFaceDown,
      currentPlayerIndex: room.currentPlayerIndex,
      discardPile: room.discardPile
    });
  });

  socket.on('viewOwnCard', (cardIndex, callback) => {
    const roomCode = players[socket.id].room;
    const room = rooms[roomCode];
    const playerIndex = players[socket.id].index;
    
    if (room.playerCardsFaceDown[playerIndex][cardIndex]) {
      const card = room.playerCards[playerIndex][cardIndex];
      socket.emit('viewCard', { index: cardIndex, card: card });
      room.playerCardsFaceDown[playerIndex][cardIndex] = false;
    }
  });

  socket.on('viewOtherCard', (targetPlayerIndex, cardIndex, callback) => {
    const roomCode = players[socket.id].room;
    const room = rooms[roomCode];
    
    const card = room.playerCards[targetPlayerIndex][cardIndex];
    socket.emit('viewCard', { targetPlayer: targetPlayerIndex, index: cardIndex, card: card });
  });

  socket.on('drawCard', (callback) => {
    const roomCode = players[socket.id].room;
    const room = rooms[roomCode];
    const playerIndex = players[socket.id].index;
    
    if (room.deck.length === 0) refillDeck(room);
    const card = room.deck.pop();
    
    socket.emit('drawnCard', card);
    room.gameLog.push(`${room.players[playerIndex].name} 抽牌`);
  });

  socket.on('discardCard', (card) => {
    const roomCode = players[socket.id].room;
    const room = rooms[roomCode];
    const playerIndex = players[socket.id].index;
    
    room.discardPile.push(card);
    room.gameLog.push(`${room.players[playerIndex].name} 棄牌`);
    io.to(roomCode).emit('gameUpdate', { discardPile: room.discardPile });
  });

  socket.on('swapCard', (handIndex, deckIndex, swapType) => {
    const roomCode = players[socket.id].room;
    const room = rooms[roomCode];
    const playerIndex = players[socket.id].index;
    const player = room.players[playerIndex];
    
    // J/Q: 盲交換，不知道對方的牌
    if (swapType === 'blind') {
      const targetIndex = deckIndex;
      [room.playerCards[playerIndex][handIndex], room.playerCards[targetIndex][handIndex]] = 
      [room.playerCards[targetIndex][handIndex], room.playerCards[playerIndex][handIndex]];
      room.gameLog.push(`${player.name} 與玩家 ${room.players[targetIndex].name} 盲交換牌張`);
    }
    // K/A: 查看後選擇
    else if (swapType === 'view') {
      const targetIndex = deckIndex;
      const targetCard = room.playerCards[targetIndex][handIndex];
      socket.emit('viewBeforeSwap', { targetCard, targetIndex, handIndex });
    }
  });

  socket.on('confirmSwap', (targetIndex, handIndex, ownCardIndex, confirm) => {
    const roomCode = players[socket.id].room;
    const room = rooms[roomCode];
    const playerIndex = players[socket.id].index;
    
    if (confirm) {
      [room.playerCards[playerIndex][ownCardIndex], room.playerCards[targetIndex][handIndex]] = 
      [room.playerCards[targetIndex][handIndex], room.playerCards[playerIndex][ownCardIndex]];
      room.gameLog.push(`${room.players[playerIndex].name} 與玩家 ${room.players[targetIndex].name} 交換牌張`);
    }
    io.to(roomCode).emit('gameUpdate', { playerCards: room.playerCards });
  });

  socket.on('pairCards', (pairs) => {
    const roomCode = players[socket.id].room;
    const room = rooms[roomCode];
    const playerIndex = players[socket.id].index;
    
    pairs.forEach(pair => {
      const [index1, index2] = pair;
      const card1 = room.playerCards[playerIndex][index1];
      const card2 = room.playerCards[playerIndex][index2];
      
      if (getCardValue(card1) === getCardValue(card2)) {
        room.pairedCards[playerIndex].push(pair);
        room.playerCards[playerIndex][index1] = null;
        room.playerCards[playerIndex][index2] = null;
      }
    });
    
    io.to(roomCode).emit('gameUpdate', { playerCards: room.playerCards, pairedCards: room.pairedCards });
  });

  socket.on('endTurn', () => {
    const roomCode = players[socket.id].room;
    const room = rooms[roomCode];
    
    room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.players.length;
    io.to(roomCode).emit('turnChanged', room.currentPlayerIndex);
  });

  socket.on('leaveRoom', () => {
    const roomCode = players[socket.id].room;
    delete players[socket.id];
    
    if (rooms[roomCode]) {
      rooms[roomCode].players = rooms[roomCode].players.filter(p => p.id !== socket.id);
      if (rooms[roomCode].players.length === 0) {
        delete rooms[roomCode];
      } else {
        io.to(roomCode).emit('playerLeft', rooms[roomCode].players);
      }
    }
    socket.leave(roomCode);
  });

  socket.on('disconnect', () => {
    const roomCode = players[socket.id]?.room;
    if (roomCode && rooms[roomCode]) {
      rooms[roomCode].players = rooms[roomCode].players.filter(p => p.id !== socket.id);
      if (rooms[roomCode].players.length === 0) {
        delete rooms[roomCode];
      } else {
        io.to(roomCode).emit('playerLeft', rooms[roomCode].players);
      }
    }
    delete players[socket.id];
  });
});

function initializeGame(room) {
  room.deck = createDeck();
  room.discardPile = [room.deck.pop()];
  room.pairedCards = {};
  room.scores = {};
  room.playerCardsFaceDown = {};

  room.players.forEach((player, index) => {
    room.playerCards[index] = [];
    room.pairedCards[index] = [];
    room.scores[index] = 0;
    room.playerCardsFaceDown[index] = [true, true, true, true];
    
    for (let i = 0; i < 4; i++) {
      room.playerCards[index].push(room.deck.pop());
    }
  });
}

function createDeck() {
  const suits = ['♠', '♥', '♦', '♣'];
  const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const deck = [];
  
  for (let i = 0; i < 2; i++) {
    for (let suit of suits) {
      for (let rank of ranks) {
        deck.push({ rank, suit });
      }
    }
  }
  
  return deck.sort(() => Math.random() - 0.5);
}

function refillDeck(room) {
  const lastCard = room.discardPile.pop();
  room.deck = room.discardPile.sort(() => Math.random() - 0.5);
  room.discardPile = [lastCard];
}

function getCardValue(card) {
  if (!card) return 0;
  if (card.rank === 'A') return 1;
  if (card.rank === 'J') return 11;
  if (card.rank === 'Q') return 12;
  if (card.rank === 'K') return 13;
  return parseInt(card.rank) || 10;
}

server.listen(3000, () => console.log('Server running on port 3000'));

