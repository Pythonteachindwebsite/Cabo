const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

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

function getCardValue(rank) {
  const values = {
    'A': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8,
    '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13
  };
  return values[rank] || 0;
}

function isRedKing(card) {
  return card.rank === 'K' && (card.suit === '♥' || card.suit === '♦');
}

function getKingValue(card) {
  return isRedKing(card) ? -1 : 13;
}

function calculateHandValue(cards) {
  return cards.reduce((sum, card) => {
    if (card.rank === 'K') {
      return sum + getKingValue(card);
    }
    return sum + getCardValue(card.rank);
  }, 0);
}

io.on('connection', (socket) => {
  socket.on('createRoom', (roomCode, playerName) => {
    if (!rooms[roomCode]) {
      rooms[roomCode] = {
        players: [],
        gameStarted: false,
        currentRound: 1,
        deck: [],
        discardPile: [],
        currentTurnIndex: 0,
        gamePhase: 'waiting',
        roundScores: {},
        caboCalled: false,
        caboCallerIndex: -1,
        hostSocketId: socket.id
      };
    }
    
    if (rooms[roomCode].players.length < 4 && !rooms[roomCode].gameStarted) {
      const player = {
        socketId: socket.id,
        name: playerName,
        hand: [],
        faceUpCards: [],
        confirmed: false,
        roundScore: 0
      };
      rooms[roomCode].players.push(player);
      socket.join(roomCode);
      socket.roomCode = roomCode;
      
      io.to(roomCode).emit('playerJoined', {
        players: rooms[roomCode].players.map(p => ({ name: p.name, socketId: p.socketId })),
        count: rooms[roomCode].players.length
      });
    } else {
      socket.emit('error', 'Room full or game already started');
    }
  });

  socket.on('startGame', (roomCode) => {
    const room = rooms[roomCode];
    if (!room || room.hostSocketId !== socket.id) return;
    if (room.players.length < 2) {
      socket.emit('error', 'Need at least 2 players');
      return;
    }

    room.gameStarted = true;
    room.deck = createDeck();
    room.discardPile = [];
    room.currentTurnIndex = 0;
    room.gamePhase = 'dealing';
    room.roundScores = {};

    room.players.forEach(p => {
      p.hand = room.deck.splice(0, 4);
      p.faceUpCards = [true, true, false, false];
      p.confirmed = false;
      p.roundScore = 0;
    });

    room.discardPile.push(room.deck.shift());

    io.to(roomCode).emit('gameStarted', {
      players: room.players.map(p => ({ name: p.name })),
      hand: room.players[0].hand,
      faceUpCards: room.players[0].faceUpCards,
      currentTurnIndex: room.currentTurnIndex
    });
  });

  socket.on('confirmCards', (roomCode) => {
    const room = rooms[roomCode];
    if (!room) return;

    const player = room.players.find(p => p.socketId === socket.id);
    if (player) {
      player.confirmed = true;
      player.faceUpCards = [false, false, false, false];
    }

    const allConfirmed = room.players.every(p => p.confirmed);
    if (allConfirmed) {
      room.gamePhase = 'playing';
      io.to(roomCode).emit('allPlayersConfirmed', {
        currentTurnIndex: room.currentTurnIndex,
        currentPlayerName: room.players[room.currentTurnIndex].name,
        discardTop: room.discardPile[room.discardPile.length - 1]
      });
    }
  });

  socket.on('drawCard', (roomCode) => {
    const room = rooms[roomCode];
    if (!room || room.gamePhase !== 'playing') return;

    const currentPlayer = room.players[room.currentTurnIndex];
    if (currentPlayer.socketId !== socket.id) return;

    if (room.deck.length === 0) {
      room.deck = room.discardPile.splice(0, room.discardPile.length - 1);
      room.deck = room.deck.sort(() => Math.random() - 0.5);
    }

    const drawnCard = room.deck.shift();
    io.to(roomCode).emit('cardDrawn', {
      playerSocketId: socket.id,
      card: drawnCard,
      deckRemaining: room.deck.length
    });
  });

  socket.on('discardCard', (roomCode, cardIndex, swapIndex) => {
    const room = rooms[roomCode];
    if (!room || room.gamePhase !== 'playing') return;

    const currentPlayer = room.players[room.currentTurnIndex];
    if (currentPlayer.socketId !== socket.id) return;

    if (swapIndex === -1) {
      const card = currentPlayer.hand.splice(cardIndex, 1)[0];
      room.discardPile.push(card);
    } else {
      const drawnCard = currentPlayer.hand[cardIndex];
      const handCard = currentPlayer.hand[swapIndex];
      currentPlayer.hand[swapIndex] = drawnCard;
      room.discardPile.push(handCard);
    }

    io.to(roomCode).emit('cardDiscarded', {
      discardTop: room.discardPile[room.discardPile.length - 1],
      hand: currentPlayer.hand,
      handLength: currentPlayer.hand.length
    });
  });

  socket.on('usePower', (roomCode, powerType, targetData) => {
    const room = rooms[roomCode];
    if (!room) return;

    const currentPlayer = room.players[room.currentTurnIndex];
    if (currentPlayer.socketId !== socket.id) return;

    if (powerType === '7/8') {
      io.to(socket.id).emit('viewOwnCard', { cards: currentPlayer.hand });
    } else if (powerType === '9/10') {
      const targetPlayer = room.players[targetData.playerIndex];
      io.to(socket.id).emit('viewOpponentCard', { card: targetPlayer.hand[targetData.cardIndex] });
    } else if (powerType === 'J/Q') {
      const targetPlayer = room.players[targetData.playerIndex];
      const temp = currentPlayer.hand[targetData.myCardIndex];
      currentPlayer.hand[targetData.myCardIndex] = targetPlayer.hand[targetData.opponentCardIndex];
      targetPlayer.hand[targetData.opponentCardIndex] = temp;
      io.to(roomCode).emit('blindSwapDone');
    } else if (powerType === 'K/A') {
      const targetPlayer = room.players[targetData.playerIndex];
      const card = targetPlayer.hand[targetData.cardIndex];
      io.to(socket.id).emit('viewKingCard', {
        card,
        targetPlayerIndex: targetData.playerIndex,
        cardIndex: targetData.cardIndex
      });
    }
  });

  socket.on('swapAfterKing', (roomCode, targetPlayerIndex, cardIndex, myCardIndex) => {
    const room = rooms[roomCode];
    if (!room) return;

    const currentPlayer = room.players[room.currentTurnIndex];
    const targetPlayer = room.players[targetPlayerIndex];
    const temp = currentPlayer.hand[myCardIndex];
    currentPlayer.hand[myCardIndex] = targetPlayer.hand[cardIndex];
    targetPlayer.hand[cardIndex] = temp;
    io.to(roomCode).emit('kingSwapDone');
  });

  socket.on('callCABO', (roomCode) => {
    const room = rooms[roomCode];
    if (!room) return;

    const currentPlayer = room.players[room.currentTurnIndex];
    if (currentPlayer.socketId !== socket.id) return;

    const handValue = calculateHandValue(currentPlayer.hand);
    if (handValue <= 16) {
      room.caboCalled = true;
      room.caboCallerIndex = room.currentTurnIndex;
      io.to(roomCode).emit('CABOCalled', {
        playerName: currentPlayer.name,
        callerIndex: room.currentTurnIndex
      });
    }
  });

  socket.on('endTurn', (roomCode) => {
    const room = rooms[roomCode];
    if (!room || room.gamePhase !== 'playing') return;

    const currentPlayer = room.players[room.currentTurnIndex];
    if (currentPlayer.socketId !== socket.id) return;

    if (room.caboCalled && room.currentTurnIndex === room.caboCallerIndex) {
      endRound(room, roomCode);
    } else {
      room.currentTurnIndex = (room.currentTurnIndex + 1) % room.players.length;
      io.to(roomCode).emit('turnChanged', {
        currentTurnIndex: room.currentTurnIndex,
        currentPlayerName: room.players[room.currentTurnIndex].name
      });
    }
  });

  function endRound(room, roomCode) {
    room.players.forEach((player, index) => {
      player.roundScore = calculateHandValue(player.hand);
      room.roundScores[index] = (room.roundScores[index] || 0) + player.roundScore;
    });

    const scores = room.players.map((p, i) => ({
      name: p.name,
      roundScore: p.roundScore,
      totalScore: room.roundScores[i]
    }));

    if (room.currentRound < 3) {
      room.currentRound++;
      room.caboCalled = false;
      room.caboCallerIndex = -1;
      room.deck = createDeck();
      room.discardPile = [];
      room.currentTurnIndex = 0;

      room.players.forEach(p => {
        p.hand = room.deck.splice(0, 4);
        p.faceUpCards = [true, true, false, false];
        p.confirmed = false;
      });

      room.discardPile.push(room.deck.shift());
      room.gamePhase = 'dealing';

      io.to(roomCode).emit('roundEnded', {
        scores,
        nextRound: room.currentRound
      });
    } else {
      const winner = scores.reduce((a, b) => a.totalScore < b.totalScore ? a : b);
      io.to(roomCode).emit('gameEnded', { scores, winner: winner.name });
      room.gameStarted = false;
    }
  }

  socket.on('disconnect', () => {
    for (let roomCode in rooms) {
      const room = rooms[roomCode];
      const playerIndex = room.players.findIndex(p => p.socketId === socket.id);
      if (playerIndex !== -1) {
        room.players.splice(playerIndex, 1);
        io.to(roomCode).emit('playerLeft', {
          players: room.players.map(p => ({ name: p.name })),
          count: room.players.length
        });
        if (room.players.length === 0) {
          delete rooms[roomCode];
        }
      }
    }
  });
});

server.listen(3000, () => console.log('Server running on port 3000'));

