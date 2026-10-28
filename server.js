const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {}; // { roomCode: { players: [...], gameState, deck, discard, ... } }

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function createDeck() {
  const values = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const deck = [];
  for (let i = 0; i < 4; i++) {
    for (let val of values) {
      deck.push(val);
    }
  }
  return deck.sort(() => Math.random() - 0.5);
}

function getCardValue(card) {
  if (card === '0') return 0;
  if (card >= '1' && card <= '9') return parseInt(card);
  if (card === '10') return 10;
  if (card === 'J') return 11;
  if (card === 'Q') return 12;
  if (card === 'K') return 13;
  if (card === 'A') return 1;
  return 0;
}

function initializeGame(roomCode) {
  const room = rooms[roomCode];
  const deck = createDeck();
  
  const playerCount = room.players.length;
  const hand = [];
  
  for (let i = 0; i < playerCount; i++) {
    const playerCards = [];
    for (let j = 0; j < 4; j++) {
      playerCards.push({ value: deck.pop(), faceUp: true });
    }
    hand.push(playerCards);
  }
  
  room.gameState = {
    phase: 'viewing', // viewing -> playing
    currentPlayerIndex: 0,
    hand: hand,
    deck: deck,
    discard: [],
    scores: Array(playerCount).fill(0),
    roundScores: Array(playerCount).fill(0),
    caboCalled: null,
    gameOver: false
  };
  
  // Send initial view to each player (show own cards for 3 seconds, then face down)
  room.players.forEach((player, idx) => {
    io.to(player.socketId).emit('gameInitialized', {
      playerIndex: idx,
      hand: room.gameState.hand[idx],
      gameState: room.gameState,
      allHands: room.gameState.hand.map((h, i) => i === idx ? h : h.map(() => ({ value: null, faceUp: false })))
    });
  });
  
  setTimeout(() => {
    room.gameState.hand.forEach((playerHand) => {
      playerHand.forEach((card) => {
        card.faceUp = false;
      });
    });
    
    room.gameState.phase = 'playing';
    broadcastGameState(roomCode);
  }, 3000);
}

function broadcastGameState(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  
  room.players.forEach((player, idx) => {
    const publicHand = room.gameState.hand.map((h, i) => {
      if (i === idx) {
        return h; // Own hand visible to self
      } else {
        return h.map(() => ({ value: null, faceUp: false })); // Other players' hands hidden
      }
    });
    
    io.to(player.socketId).emit('gameState', {
      gameState: room.gameState,
      allHands: publicHand,
      playerIndex: idx
    });
  });
}

function handlePairing(roomCode, playerIndex) {
  const room = rooms[roomCode];
  const hand = room.gameState.hand[playerIndex];
  
  // Try to pair all possible combinations
  let foundPair = false;
  
  // Check near row (indices 0, 1)
  if (hand[0].value === hand[1].value) {
    hand[0] = { value: null, faceUp: false };
    hand[1] = { value: null, faceUp: false };
    foundPair = true;
  }
  
  // Check far row (indices 2, 3)
  if (hand[2].value === hand[3].value) {
    hand[2] = { value: null, faceUp: false };
    hand[3] = { value: null, faceUp: false };
    foundPair = true;
  }
  
  // If found pair, check again
  if (foundPair) {
    setTimeout(() => handlePairing(roomCode, playerIndex), 500);
  }
}

io.on('connection', (socket) => {
  socket.on('createRoom', (playerName, callback) => {
    const roomCode = generateRoomCode();
    rooms[roomCode] = {
      players: [{ socketId: socket.id, name: playerName }],
      gameState: null
    };
    socket.join(roomCode);
    callback(roomCode);
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
    
    rooms[roomCode].players.push({ socketId: socket.id, name: playerName });
    socket.join(roomCode);
    
    io.to(roomCode).emit('playersUpdated', rooms[roomCode].players);
    
    if (rooms[roomCode].players.length === 4) {
      initializeGame(roomCode);
    }
    
    callback({ success: true });
  });
  
  socket.on('startGame', (roomCode) => {
    if (rooms[roomCode] && !rooms[roomCode].gameState) {
      initializeGame(roomCode);
    }
  });
  
  socket.on('drawCard', (roomCode, playerIndex) => {
    const room = rooms[roomCode];
    if (!room || room.gameState.phase !== 'playing') return;
    
    if (room.gameState.deck.length === 0) {
      room.gameState.deck = room.gameState.discard.sort(() => Math.random() - 0.5);
      room.gameState.discard = [];
    }
    
    const drawnCard = room.gameState.deck.pop();
    const drawnCardObj = { value: drawnCard, faceUp: true };
    
    // Broadcast drawn card to all players
    io.to(roomCode).emit('cardDrawn', {
      playerIndex: playerIndex,
      drawnCard: drawnCardObj
    });
    
    // Wait for player to choose
    socket.on('exchangeCard', (chosenSlot) => {
      const oldCard = room.gameState.hand[playerIndex][chosenSlot];
      room.gameState.hand[playerIndex][chosenSlot] = { value: drawnCard, faceUp: false };
      room.gameState.discard.push(oldCard.value);
      
      handlePairing(roomCode, playerIndex);
      
      room.gameState.currentPlayerIndex = (room.gameState.currentPlayerIndex + 1) % room.gameState.hand.length;
      broadcastGameState(roomCode);
    });
  });
  
  socket.on('useAbility7Or8', (roomCode, playerIndex) => {
    const room = rooms[roomCode];
    if (!room) return;
    
    const hand = room.gameState.hand[playerIndex];
    io.to(socket.id).emit('abilityView', {
      cards: hand,
      message: 'You can view your own cards'
    });
  });
  
  socket.on('useAbility9Or10', (roomCode, playerIndex, targetPlayerIndex) => {
    const room = rooms[roomCode];
    if (!room) return;
    
    const targetHand = room.gameState.hand[targetPlayerIndex];
    io.to(socket.id).emit('abilityView', {
      cards: targetHand,
      message: `View ${room.players[targetPlayerIndex].name}'s cards`
    });
  });
  
  socket.on('useAbilityJOrQ', (roomCode, playerIndex, targetPlayerIndex, targetSlot) => {
    const room = rooms[roomCode];
    if (!room) return;
    
    const playerCard = room.gameState.hand[playerIndex][targetSlot];
    const targetCard = room.gameState.hand[targetPlayerIndex][targetSlot];
    
    room.gameState.hand[playerIndex][targetSlot] = targetCard;
    room.gameState.hand[targetPlayerIndex][targetSlot] = playerCard;
    
    handlePairing(roomCode, playerIndex);
    handlePairing(roomCode, targetPlayerIndex);
    
    room.gameState.currentPlayerIndex = (room.gameState.currentPlayerIndex + 1) % room.gameState.hand.length;
    broadcastGameState(roomCode);
  });
  
  socket.on('useAbilityKOrA', (roomCode, playerIndex, targetPlayerIndex, targetSlot) => {
    const room = rooms[roomCode];
    if (!room) return;
    
    const targetCard = room.gameState.hand[targetPlayerIndex][targetSlot];
    
    io.to(socket.id).emit('abilityView', {
      cards: [targetCard],
      message: 'View this card. Choose to swap?',
      allowSwap: true,
      swapData: { targetPlayerIndex, targetSlot }
    });
    
    socket.on('confirmKASwap', (swapData) => {
      const playerCard = room.gameState.hand[playerIndex][targetSlot];
      room.gameState.hand[playerIndex][targetSlot] = targetCard;
      room.gameState.hand[targetPlayerIndex][targetSlot] = playerCard;
      
      handlePairing(roomCode, playerIndex);
      handlePairing(roomCode, targetPlayerIndex);
      
      room.gameState.currentPlayerIndex = (room.gameState.currentPlayerIndex + 1) % room.gameState.hand.length;
      broadcastGameState(roomCode);
    });
  });
  
  socket.on('callCabo', (roomCode, playerIndex) => {
    const room = rooms[roomCode];
    if (!room) return;
    
    room.gameState.caboCalled = playerIndex;
    
    // Check if all cards paired
    let allPaired = true;
    room.gameState.hand[playerIndex].forEach((card) => {
      if (card.value !== null) allPaired = false;
    });
    
    if (allPaired) {
      endRound(roomCode, playerIndex);
    } else {
      room.gameState.currentPlayerIndex = (room.gameState.currentPlayerIndex + 1) % room.gameState.hand.length;
      broadcastGameState(roomCode);
    }
  });
  
  socket.on('disconnect', () => {
    Object.keys(rooms).forEach((roomCode) => {
      rooms[roomCode].players = rooms[roomCode].players.filter((p) => p.socketId !== socket.id);
      if (rooms[roomCode].players.length === 0) {
        delete rooms[roomCode];
      }
    });
  });
});

function endRound(roomCode, winnerIndex) {
  const room = rooms[roomCode];
  const hand = room.gameState.hand;
  
  hand.forEach((playerHand, idx) => {
    let score = 0;
    playerHand.forEach((card) => {
      if (card.value !== null) {
        score += getCardValue(card.value);
      }
    });
    room.gameState.roundScores[idx] = score;
    room.gameState.scores[idx] += score;
  });
  
  io.to(roomCode).emit('roundEnded', {
    scores: room.gameState.scores,
    roundScores: room.gameState.roundScores
  });
  
  const gameOver = room.gameState.scores.some((s) => s >= 100);
  if (gameOver) {
    room.gameState.gameOver = true;
    io.to(roomCode).emit('gameOver', { scores: room.gameState.scores });
  } else {
    setTimeout(() => initializeGame(roomCode), 3000);
  }
}

server.listen(3000, () => console.log('Server running on port 3000'));

