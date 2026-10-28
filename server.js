const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();
const SUITS = ['♠', '♥', '♦', '♣'];
const VALUES = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

function createDeck() {
  const deck = [];
  for (let suit of SUITS) {
    for (let value of VALUES) {
      deck.push({ suit, value });
    }
  }
  return deck.sort(() => Math.random() - 0.5);
}

function getCardValue(card) {
  if (card.value === 'A') return 1;
  if (card.value === 'K') {
    return card.suit === '♥' || card.suit === '♦' ? -1 : 13;
  }
  if (card.value === 'J') return 11;
  if (card.value === 'Q') return 12;
  return parseInt(card.value);
}

function initializeGame(room) {
  room.deck = createDeck();
  room.discardPile = [];
  room.currentPlayerIndex = 0;
  room.gameStarted = false;
  room.round = 1;
  room.scores = room.players.map(() => 0);
  room.roundScores = room.players.map(() => 0);
  room.caboPlayer = null;
  room.gameEnded = false;
  
  room.players.forEach(player => {
    player.hand = [];
    player.visibleCards = [true, true, false, false];
    player.hand = [];
    for (let i = 0; i < 4; i++) {
      player.hand.push(room.deck.pop());
    }
  });

  room.discardPile.push(room.deck.pop());
  room.gameStarted = true;
  room.visibilityTimer = setTimeout(() => {
    room.players.forEach(player => {
      player.visibleCards = [false, false, false, false];
    });
    broadcastGameState(room);
  }, 2000);
}

function broadcastGameState(room) {
  room.players.forEach((player, index) => {
    const gameState = {
      players: room.players.map((p, i) => ({
        name: p.name,
        hand: p.hand.map((card, cardIndex) => 
          i === index ? card : (p.visibleCards[cardIndex] ? card : { visible: false })
        ),
        visibleCards: p.visibleCards,
        score: room.scores[i],
        roundScore: room.roundScores[i]
      })),
      discardPile: room.discardPile,
      currentPlayerIndex: room.currentPlayerIndex,
      round: room.round,
      gameStarted: room.gameStarted,
      gameEnded: room.gameEnded,
      caboPlayer: room.caboPlayer,
      deck: room.deck
    };

    const playerSocket = Array.from(io.sockets.sockets.values()).find(
      socket => socket.userId === player.userId
    );
    if (playerSocket) {
      playerSocket.emit('gameStateUpdate', gameState);
    }
  });
}

function endRound(room) {
  room.players.forEach((player, i) => {
    let score = 0;
    player.hand.forEach(card => {
      score += getCardValue(card);
    });
    room.roundScores[i] = score;
    room.scores[i] += score;
  });

  if (room.round < 3) {
    room.round++;
    room.caboPlayer = null;
    room.gameEnded = false;
    initializeGame(room);
    broadcastGameState(room);
  } else {
    room.gameEnded = true;
    broadcastGameState(room);
  }
}

io.on('connection', (socket) => {
  socket.on('createRoom', (playerName, callback) => {
    const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    rooms.set(roomCode, {
      players: [{ name: playerName, userId: socket.id, hand: [], visibleCards: [] }],
      owner: socket.id,
      deck: [],
      discardPile: [],
      currentPlayerIndex: 0,
      gameStarted: false,
      round: 1,
      scores: [0],
      roundScores: [0],
      caboPlayer: null,
      gameEnded: false,
      visibilityTimer: null
    });
    socket.join(roomCode);
    socket.userId = socket.id;
    socket.roomCode = roomCode;
    callback({ roomCode, success: true });
  });

  socket.on('joinRoom', (roomCode, playerName, callback) => {
    const room = rooms.get(roomCode);
    if (!room) {
      callback({ success: false, message: '房間不存在' });
      return;
    }
    if (room.players.length >= 4) {
      callback({ success: false, message: '房間已滿' });
      return;
    }
    if (room.gameStarted) {
      callback({ success: false, message: '遊戲已開始' });
      return;
    }
    
    room.players.push({ name: playerName, userId: socket.id, hand: [], visibleCards: [] });
    room.scores.push(0);
    room.roundScores.push(0);
    socket.join(roomCode);
    socket.userId = socket.id;
    socket.roomCode = roomCode;
    
    io.to(roomCode).emit('playerJoined', {
      players: room.players.map(p => ({ name: p.name }))
    });
    callback({ success: true });
  });

  socket.on('startGame', () => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.owner !== socket.id) return;
    
    if (room.players.length < 2) {
      socket.emit('error', '至少需要 2 名玩家');
      return;
    }
    
    initializeGame(room);
    broadcastGameState(room);
  });

  socket.on('drawCard', () => {
    const room = rooms.get(socket.roomCode);
    if (!room || !room.gameStarted) return;
    
    const playerIndex = room.players.findIndex(p => p.userId === socket.id);
    if (playerIndex !== room.currentPlayerIndex) return;
    
    if (room.deck.length === 0) {
      endRound(room);
      return;
    }
    
    const drawnCard = room.deck.pop();
    socket.emit('drawnCardDisplay', drawnCard);
  });

  socket.on('discardDrawnCard', (card) => {
    const room = rooms.get(socket.roomCode);
    if (!room || !room.gameStarted) return;
    
    const playerIndex = room.players.findIndex(p => p.userId === socket.id);
    if (playerIndex !== room.currentPlayerIndex) return;
    
    room.discardPile.push(card);
    room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.players.length;
    broadcastGameState(room);
  });

  socket.on('swapDrawnCard', (handIndex, card) => {
    const room = rooms.get(socket.roomCode);
    if (!room || !room.gameStarted) return;
    
    const playerIndex = room.players.findIndex(p => p.userId === socket.id);
    if (playerIndex !== room.currentPlayerIndex) return;
    
    const oldCard = room.players[playerIndex].hand[handIndex];
    room.players[playerIndex].hand[handIndex] = card;
    room.players[playerIndex].visibleCards[handIndex] = false;
    
    room.discardPile.push(oldCard);
    room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.players.length;
    broadcastGameState(room);
  });

  socket.on('playCard', (cardIndex) => {
    const room = rooms.get(socket.roomCode);
    if (!room || !room.gameStarted) return;
    
    const playerIndex = room.players.findIndex(p => p.userId === socket.id);
    if (playerIndex !== room.currentPlayerIndex) return;
    
    const card = room.players[playerIndex].hand[cardIndex];
    const topCard = room.discardPile[room.discardPile.length - 1];
    
    if (card.value === topCard.value && card.suit === topCard.suit) {
      room.players[playerIndex].hand.splice(cardIndex, 1);
      room.players[playerIndex].visibleCards.splice(cardIndex, 1);
      room.discardPile.push(card);
      
      if (room.deck.length > 0) {
        const newCard = room.deck.pop();
        room.players[playerIndex].hand.push(newCard);
        room.players[playerIndex].visibleCards.push(false);
      }
    } else {
      const specialValue = card.value;
      room.discardPile.push(card);
      room.players[playerIndex].hand.splice(cardIndex, 1);
      room.players[playerIndex].visibleCards.splice(cardIndex, 1);
      
      if (['7', '8'].includes(specialValue)) {
        socket.emit('selectOwnCard');
      } else if (['9', '10'].includes(specialValue)) {
        socket.emit('selectOpponentCard', { players: room.players.map(p => p.name) });
      } else if (['J', 'Q'].includes(specialValue)) {
        socket.emit('selectOpponentSwap', { players: room.players.map(p => p.name) });
      } else if (['K', 'A'].includes(specialValue)) {
        socket.emit('selectOpponentPeekSwap', { players: room.players.map(p => p.name) });
      }
    }
    
    broadcastGameState(room);
  });

  socket.on('viewOwnCard', (cardIndex) => {
    const room = rooms.get(socket.roomCode);
    if (!room) return;
    
    const playerIndex = room.players.findIndex(p => p.userId === socket.id);
    const card = room.players[playerIndex].hand[cardIndex];
    socket.emit('cardViewed', card);
    
    room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.players.length;
    broadcastGameState(room);
  });

  socket.on('viewOpponentCard', (opponentName, cardIndex) => {
    const room = rooms.get(socket.roomCode);
    if (!room) return;
    
    const opponent = room.players.find(p => p.name === opponentName);
    const card = opponent.hand[cardIndex];
    socket.emit('cardViewed', card);
    
    room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.players.length;
    broadcastGameState(room);
  });

  socket.on('swapOpponentCard', (opponentName, cardIndex) => {
    const room = rooms.get(socket.roomCode);
    if (!room) return;
    
    const playerIndex = room.players.findIndex(p => p.userId === socket.id);
    const opponentIndex = room.players.findIndex(p => p.name === opponentName);
    
    const playerCard = room.players[playerIndex].hand[cardIndex];
    const opponentCard = room.players[opponentIndex].hand[cardIndex];
    
    room.players[playerIndex].hand[cardIndex] = opponentCard;
    room.players[opponentIndex].hand[cardIndex] = playerCard;
    
    room.players[playerIndex].visibleCards[cardIndex] = false;
    room.players[opponentIndex].visibleCards[cardIndex] = false;
    
    room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.players.length;
    broadcastGameState(room);
  });

  socket.on('peekAndDecideSwap', (opponentName, cardIndex, shouldSwap) => {
    const room = rooms.get(socket.roomCode);
    if (!room) return;
    
    const playerIndex = room.players.findIndex(p => p.userId === socket.id);
    const opponentIndex = room.players.findIndex(p => p.name === opponentName);
    
    if (shouldSwap) {
      const playerCard = room.players[playerIndex].hand[cardIndex];
      const opponentCard = room.players[opponentIndex].hand[cardIndex];
      
      room.players[playerIndex].hand[cardIndex] = opponentCard;
      room.players[opponentIndex].hand[cardIndex] = playerCard;
      
      room.players[playerIndex].visibleCards[cardIndex] = false;
      room.players[opponentIndex].visibleCards[cardIndex] = false;
    }
    
    room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.players.length;
    broadcastGameState(room);
  });

  socket.on('callCabo', () => {
    const room = rooms.get(socket.roomCode);
    if (!room) return;
    
    const playerIndex = room.players.findIndex(p => p.userId === socket.id);
    room.caboPlayer = playerIndex;
    
    setTimeout(() => {
      endRound(room);
    }, 1000);
  });

  socket.on('leaveRoom', () => {
    const roomCode = socket.roomCode;
    const room = rooms.get(roomCode);
    
    if (room) {
      room.players = room.players.filter(p => p.userId !== socket.id);
      
      if (room.players.length === 0) {
        rooms.delete(roomCode);
      } else {
        if (room.owner === socket.id && room.players.length > 0) {
          room.owner = room.players[0].userId;
        }
        io.to(roomCode).emit('playerLeft', {
          players: room.players.map(p => ({ name: p.name }))
        });
      }
    }
    
    socket.leave(roomCode);
  });

  socket.on('disconnect', () => {
    const roomCode = socket.roomCode;
    const room = rooms.get(roomCode);
    
    if (room) {
      room.players = room.players.filter(p => p.userId !== socket.id);
      
      if (room.players.length === 0) {
        rooms.delete(roomCode);
      } else {
        if (room.owner === socket.id && room.players.length > 0) {
          room.owner = room.players[0].userId;
        }
        io.to(roomCode).emit('playerLeft', {
          players: room.players.map(p => ({ name: p.name }))
        });
      }
    }
  });
});

server.listen(process.env.PORT || 3000, () => {
  console.log(`伺服器執行在 http://localhost:${process.env.PORT || 3000}`);
});

