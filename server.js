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

const rooms = {};

function createDeck() {
  const suits = ['♠', '♣', '♥', '♦'];
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
  const { rank, suit } = card;
  if (rank === 'A') return suit === '♥' || suit === '♦' ? 1 : -1;
  if (rank === 'K') return suit === '♥' || suit === '♦' ? -1 : 13;
  if (rank === 'J' || rank === 'Q') return rank === 'J' ? 11 : 12;
  return parseInt(rank) || 10;
}

function dealCards(deck, numPlayers) {
  const hands = Array(numPlayers).fill(null).map(() => []);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < numPlayers; j++) {
      hands[j].push(deck.pop());
    }
  }
  return hands;
}

function getHandsForPlayer(roomCode, requestingPlayerIndex, showInitial = false) {
  const room = rooms[roomCode];
  return room.players.map((player, playerIndex) => {
    const hand = room.hands[playerIndex];
    return {
      playerIndex,
      playerName: player.name,
      hand: hand.map((card, cardIndex) => {
        let isVisible = false;

        if (showInitial && playerIndex === requestingPlayerIndex && cardIndex < 2) {
          isVisible = true;
        } else if (!showInitial) {
          if (room.revealedCards && room.revealedCards[playerIndex]) {
            if (room.revealedCards[playerIndex].includes(cardIndex)) {
              isVisible = true;
            }
          }
        }

        return { card, isVisible };
      })
    };
  });
}

function calculateHandScore(hand) {
  return hand.reduce((sum, card) => sum + getCardValue(card), 0);
}

function endTurn(roomCode) {
  const room = rooms[roomCode];
  room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.players.length;
  room.hasDrawn = false;
  room.hasSwapped = false;
  room.drawnCard = null;

  io.to(roomCode).emit('turnEnded', {
    nextPlayer: room.players[room.currentPlayerIndex].name,
    currentPlayerIndex: room.currentPlayerIndex
  });
}

function checkGameEnd(roomCode) {
  const room = rooms[roomCode];
  if (room.caboCalled) {
    room.round++;
    if (room.round > 3) {
      const scores = room.players.map((player, idx) => ({
        name: player.name,
        score: room.scores[idx]
      }));
      io.to(roomCode).emit('gameOver', { scores, winner: scores.reduce((a, b) => a.score < b.score ? a : b) });
      room.gameState = 'ended';
      return true;
    } else {
      resetRound(roomCode);
      return false;
    }
  }
  if (room.deck.length === 0) {
    room.caboCalled = true;
    return checkGameEnd(roomCode);
  }
  return false;
}

function resetRound(roomCode) {
  const room = rooms[roomCode];
  room.deck = createDeck();
  room.hands = dealCards(room.deck, room.players.length);
  room.discardPile = [room.deck.pop()];
  room.revealedCards = {};
  room.hasDrawn = false;
  room.hasSwapped = false;
  room.drawnCard = null;
  room.currentPlayerIndex = 0;
  room.gameState = 'playing';

  io.to(roomCode).emit('roundReset', {
    round: room.round,
    players: room.players.map((p, idx) => ({
      name: p.name,
      score: room.scores[idx],
      cardCount: room.hands[idx].length
    }))
  });

  room.players.forEach((player, playerIndex) => {
    const playerSocket = io.sockets.sockets.get(player.id);
    if (playerSocket) {
      playerSocket.emit('updateHands', getHandsForPlayer(roomCode, playerIndex, true));
    }
  });

  room.initialShowTimeout = setTimeout(() => {
    room.showInitialCards = false;
    room.players.forEach((player, playerIndex) => {
      const playerSocket = io.sockets.sockets.get(player.id);
      if (playerSocket) {
        playerSocket.emit('updateHands', getHandsForPlayer(roomCode, playerIndex, false));
      }
    });
  }, 2000);
}

io.on('connection', (socket) => {
  socket.on('createRoom', (playerName) => {
    const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    rooms[roomCode] = {
      code: roomCode,
      players: [{ id: socket.id, name: playerName }],
      gameState: 'waiting',
      currentPlayerIndex: 0,
      hands: [],
      deck: [],
      discardPile: [],
      revealedCards: {},
      hasDrawn: false,
      hasSwapped: false,
      drawnCard: null,
      scores: [0, 0, 0, 0],
      round: 1,
      caboCalled: false,
      showInitialCards: false
    };
    socket.join(roomCode);
    socket.emit('roomCreated', { roomCode });
  });

  socket.on('joinRoom', (data) => {
    const { roomCode, playerName } = data;
    if (!rooms[roomCode]) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }
    if (rooms[roomCode].gameState !== 'waiting') {
      socket.emit('error', { message: 'Game already started' });
      return;
    }
    if (rooms[roomCode].players.length >= 4) {
      socket.emit('error', { message: 'Room full' });
      return;
    }
    rooms[roomCode].players.push({ id: socket.id, name: playerName });
    socket.join(roomCode);
    io.to(roomCode).emit('playerJoined', {
      players: rooms[roomCode].players.map(p => ({ name: p.name }))
    });
  });

  socket.on('startGame', (roomCode) => {
    if (!rooms[roomCode]) return;
    const room = rooms[roomCode];
    room.gameState = 'playing';
    room.deck = createDeck();
    room.hands = dealCards(room.deck, room.players.length);
    room.discardPile = [room.deck.pop()];
    room.revealedCards = {};
    room.showInitialCards = true;

    io.to(roomCode).emit('gameStarted', {
      players: room.players.map((p, idx) => ({
        name: p.name,
        cardCount: room.hands[idx].length
      })),
      currentPlayer: room.players[0].name,
      discardTop: room.discardPile[room.discardPile.length - 1]
    });

    room.players.forEach((player, playerIndex) => {
      const playerSocket = io.sockets.sockets.get(player.id);
      if (playerSocket) {
        playerSocket.emit('updateHands', getHandsForPlayer(roomCode, playerIndex, true));
      }
    });

    room.initialShowTimeout = setTimeout(() => {
      room.showInitialCards = false;
      room.players.forEach((player, playerIndex) => {
        const playerSocket = io.sockets.sockets.get(player.id);
        if (playerSocket) {
          playerSocket.emit('updateHands', getHandsForPlayer(roomCode, playerIndex, false));
        }
      });
    }, 2000);
  });

  socket.on('drawCard', (roomCode) => {
    if (!rooms[roomCode]) return;
    const room = rooms[roomCode];
    const playerIndex = room.players.findIndex(p => p.id === socket.id);
    if (playerIndex !== room.currentPlayerIndex || room.hasDrawn) return;
    if (room.deck.length === 0) return;

    const card = room.deck.pop();
    room.drawnCard = card;
    room.hasDrawn = true;

    io.to(roomCode).emit('cardDrawn', {
      playerName: room.players[playerIndex].name,
      playerIndex
    });

    room.players.forEach((player, idx) => {
      const playerSocket = io.sockets.sockets.get(player.id);
      if (playerSocket) {
        if (idx === playerIndex) {
          playerSocket.emit('drawnCardShow', { card });
        }
      }
    });
  });

  socket.on('discardCard', (data) => {
    const { roomCode } = data;
    if (!rooms[roomCode]) return;
    const room = rooms[roomCode];
    const playerIndex = room.players.findIndex(p => p.id === socket.id);
    if (playerIndex !== room.currentPlayerIndex || !room.hasDrawn) return;

    if (!room.drawnCard) {
      room.drawnCard = room.discardPile[room.discardPile.length - 1];
    }

    room.discardPile.push(room.drawnCard);
    room.hasSwapped = true;

    io.to(roomCode).emit('cardDiscarded', {
      playerName: room.players[playerIndex].name,
      card: room.drawnCard
    });

    room.drawnCard = null;
    room.players.forEach((player, idx) => {
      const playerSocket = io.sockets.sockets.get(player.id);
      if (playerSocket) {
        playerSocket.emit('updateHands', getHandsForPlayer(roomCode, idx, false));
      }
    });
  });

  socket.on('swapCard', (data) => {
    const { roomCode, handIndex } = data;
    if (!rooms[roomCode]) return;
    const room = rooms[roomCode];
    const playerIndex = room.players.findIndex(p => p.id === socket.id);
    if (playerIndex !== room.currentPlayerIndex || !room.hasDrawn) return;

    const hand = room.hands[playerIndex];
    if (handIndex >= hand.length || !room.drawnCard) return;

    const swappedCard = hand[handIndex];
    hand[handIndex] = room.drawnCard;
    room.discardPile.push(swappedCard);

    if (!room.revealedCards[playerIndex]) {
      room.revealedCards[playerIndex] = [];
    }
    room.revealedCards[playerIndex] = room.revealedCards[playerIndex].filter(idx => idx !== handIndex);

    io.to(roomCode).emit('cardSwapped', {
      playerName: room.players[playerIndex].name,
      handIndex,
      swappedCard
    });

    room.drawnCard = null;
    room.hasSwapped = true;

    room.players.forEach((player, idx) => {
      const playerSocket = io.sockets.sockets.get(player.id);
      if (playerSocket) {
        playerSocket.emit('updateHands', getHandsForPlayer(roomCode, idx, false));
      }
    });

    endTurn(roomCode);
  });

  socket.on('endTurn', (roomCode) => {
    if (!rooms[roomCode]) return;
    const room = rooms[roomCode];
    const playerIndex = room.players.findIndex(p => p.id === socket.id);
    if (playerIndex !== room.currentPlayerIndex) return;

    if (!room.hasSwapped && room.hasDrawn) {
      room.discardPile.push(room.drawnCard);
      room.drawnCard = null;
      room.hasSwapped = true;
    }

    if (checkGameEnd(roomCode)) return;
    endTurn(roomCode);
  });

  socket.on('callCabo', (roomCode) => {
    if (!rooms[roomCode]) return;
    const room = rooms[roomCode];
    room.caboCalled = true;
    io.to(roomCode).emit('caboCall', { player: room.players[room.currentPlayerIndex].name });
    checkGameEnd(roomCode);
  });

  socket.on('disconnect', () => {
    for (const roomCode in rooms) {
      const room = rooms[roomCode];
      const playerIndex = room.players.findIndex(p => p.id === socket.id);
      if (playerIndex !== -1) {
        room.players.splice(playerIndex, 1);
        io.to(roomCode).emit('playerLeft', { players: room.players.map(p => ({ name: p.name })) });
        if (room.players.length === 0) {
          delete rooms[roomCode];
        }
      }
    }
  });
});

server.listen(3000, () => {
  console.log('Server running on port 3000');
});

