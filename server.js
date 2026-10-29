const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const app = express();
const server = http.createServer(app);
const io = socketIO(server, { cors: { origin: "*" } });

app.use(express.static('public'));

const rooms = {};
const CARD_VALUES = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const CARD_SUITS = ['♠', '♥', '♦', '♣'];

function createDeck() {
  const deck = [];
  for (let suit of CARD_SUITS) {
    for (let value of CARD_VALUES) {
      deck.push(value + suit);
    }
  }
  return deck;
}

function shuffleDeck(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function getCardScore(card) {
  const value = card.slice(0, -1);
  if (value === 'A') return 1;
  if (value === 'J') return 11;
  if (value === 'Q') return 12;
  if (value === 'K') {
    const suit = card[card.length - 1];
    return (suit === '♠' || suit === '♣') ? 13 : -1;
  }
  return parseInt(value);
}

function getCardRank(card) {
  return card.slice(0, -1);
}

io.on('connection', (socket) => {
  socket.on('createRoom', (playerName) => {
    const roomId = Math.random().toString(36).substr(2, 9).toUpperCase();
    rooms[roomId] = {
      players: [{ id: socket.id, name: playerName, isHost: true }],
      gameStarted: false,
      currentPlayer: 0,
      deck: [],
      discard: [],
      playerHands: {},
      gameOver: false,
      caboCalled: false,
      caboPlayerId: null
    };
    socket.join(roomId);
    socket.emit('roomCreated', { roomId });
    io.to(roomId).emit('updatePlayers', { players: rooms[roomId].players });
  });

  socket.on('joinRoom', (roomId, playerName) => {
    const actualRoomId = Object.keys(rooms).find(id => id === roomId);
    if (!actualRoomId) {
      socket.emit('error', '房間不存在');
      return;
    }
    const room = rooms[actualRoomId];
    if (room.gameStarted) {
      socket.emit('error', '遊戲已開始');
      return;
    }
    room.players.push({ id: socket.id, name: playerName, isHost: false });
    socket.join(actualRoomId);
    io.to(actualRoomId).emit('updatePlayers', { players: room.players });
  });

  socket.on('leaveRoom', (roomId) => {
    const room = rooms[roomId];
    if (!room) return;
    room.players = room.players.filter(p => p.id !== socket.id);
    socket.leave(roomId);
    if (room.players.length === 0) {
      delete rooms[roomId];
    } else {
      io.to(roomId).emit('updatePlayers', { players: room.players });
      if (room.gameStarted && room.currentPlayer >= room.players.length) {
        room.currentPlayer = 0;
      }
    }
    socket.emit('leftRoom');
  });

  socket.on('startGame', (roomId) => {
    const room = rooms[roomId];
    if (!room || room.players.length < 2) {
      socket.emit('error', '需要至少2名玩家');
      return;
    }

    room.gameStarted = true;
    room.deck = shuffleDeck(createDeck());
    room.playerHands = {};
    room.discard = [];
    room.currentPlayer = 0;
    room.caboCalled = false;
    room.caboPlayerId = null;

    room.players.forEach((player) => {
      room.playerHands[player.id] = [
        { card: room.deck.pop(), faceUp: true },
        { card: room.deck.pop(), faceUp: true },
        { card: room.deck.pop(), faceUp: false },
        { card: room.deck.pop(), faceUp: false }
      ];
    });

    room.discard.push(room.deck.pop());

    room.players.forEach((player) => {
      const playerSocket = io.sockets.sockets.get(player.id);
      if (playerSocket) {
        playerSocket.emit('gameStarted', {
          yourHand: room.playerHands[player.id],
          discardTop: room.discard[room.discard.length - 1],
          currentPlayer: room.currentPlayer,
          currentPlayerName: room.players[room.currentPlayer].name,
          players: room.players
        });
      }
    });
  });

  socket.on('confirmCardFlip', (roomId) => {
    const room = rooms[roomId];
    if (!room) return;

    setTimeout(() => {
      room.players.forEach((player) => {
        const playerSocket = io.sockets.sockets.get(player.id);
        if (playerSocket) {
          playerSocket.emit('cardsFlipped', {
            yourHand: room.playerHands[player.id]
          });
        }
      });
    }, 1500);
  });

  socket.on('drawCard', (roomId) => {
    const room = rooms[roomId];
    if (!room || !room.gameStarted) return;

    const currentPlayerId = room.players[room.currentPlayer].id;
    if (currentPlayerId !== socket.id) return;

    const drawnCard = room.deck.pop();
    if (!drawnCard) {
      room.deck = shuffleDeck(createDeck());
      drawnCard = room.deck.pop();
    }

    io.to(roomId).emit('drawnCard', {
      playerId: currentPlayerId,
      card: drawnCard,
      playerName: room.players[room.currentPlayer].name
    });

    socket.emit('yourDrawnCard', { card: drawnCard });
  });

  socket.on('discardCard', (roomId, card) => {
    const room = rooms[roomId];
    if (!room) return;

    room.discard.push(card);
    const discardRank = getCardRank(card);

    io.to(roomId).emit('cardDiscarded', {
      card: card,
      playerId: socket.id,
      playerName: room.players[room.currentPlayer].name
    });

    handleSpecialAbility(room, roomId, card, socket.id);
  });

  socket.on('swapCard', (roomId, cardIndex, drawnCard) => {
    const room = rooms[roomId];
    if (!room) return;

    const currentPlayerId = room.players[room.currentPlayer].id;
    const playerHand = room.playerHands[currentPlayerId];

    if (cardIndex >= 0 && cardIndex < playerHand.length) {
      const oldCard = playerHand[cardIndex].card;
      playerHand[cardIndex] = { card: drawnCard, faceUp: false };
      room.discard.push(oldCard);

      io.to(roomId).emit('cardSwapped', {
        playerId: currentPlayerId,
        cardIndex: cardIndex,
        newCard: drawnCard,
        discardedCard: oldCard,
        playerName: room.players[room.currentPlayer].name
      });

      const playerSocket = io.sockets.sockets.get(currentPlayerId);
      if (playerSocket) {
        playerSocket.emit('updateYourHand', { hand: playerHand });
      }
    }

    endTurn(room, roomId);
  });

  socket.on('viewOwnCard', (roomId, cardIndex) => {
    const room = rooms[roomId];
    if (!room) return;

    const playerId = socket.id;
    const hand = room.playerHands[playerId];
    if (hand && hand[cardIndex]) {
      socket.emit('abilityViewOwn', {
        card: hand[cardIndex].card,
        cardIndex: cardIndex
      });
    }
  });

  socket.on('viewOpponentCard', (roomId, opponentIndex, cardIndex) => {
    const room = rooms[roomId];
    if (!room) return;

    const opponentId = room.players[opponentIndex].id;
    const hand = room.playerHands[opponentId];
    if (hand && hand[cardIndex]) {
      socket.emit('abilityViewOpponent', {
        card: hand[cardIndex].card,
        opponentName: room.players[opponentIndex].name,
        cardIndex: cardIndex
      });
    }
  });

  socket.on('blindSwapCard', (roomId, opponentIndex, cardIndex) => {
    const room = rooms[roomId];
    if (!room) return;

    const currentPlayerId = room.players[room.currentPlayer].id;
    const opponentId = room.players[opponentIndex].id;

    if (currentPlayerId === socket.id && room.playerHands[currentPlayerId] && room.playerHands[opponentId]) {
      const temp = room.playerHands[currentPlayerId][cardIndex];
      room.playerHands[currentPlayerId][cardIndex] = room.playerHands[opponentId][cardIndex];
      room.playerHands[opponentId][cardIndex] = temp;

      io.to(roomId).emit('blindSwapDone', {
        playerId: currentPlayerId,
        opponentId: opponentId,
        cardIndex: cardIndex,
        playerName: room.players[room.currentPlayer].name,
        opponentName: room.players[opponentIndex].name
      });

      const playerSocket = io.sockets.sockets.get(currentPlayerId);
      if (playerSocket) {
        playerSocket.emit('updateYourHand', { hand: room.playerHands[currentPlayerId] });
      }

      const opponentSocket = io.sockets.sockets.get(opponentId);
      if (opponentSocket) {
        opponentSocket.emit('updateYourHand', { hand: room.playerHands[opponentId] });
      }
    }

    endTurn(room, roomId);
  });

  socket.on('pairCards', (roomId, cardIndex) => {
    const room = rooms[roomId];
    if (!room) return;

    const currentPlayerId = room.players[room.currentPlayer].id;
    const hand = room.playerHands[currentPlayerId];
    const topDiscardRank = getCardRank(room.discard[room.discard.length - 1]);
    const cardRank = getCardRank(hand[cardIndex].card);

    if (topDiscardRank === cardRank) {
      hand.splice(cardIndex, 1);
      io.to(roomId).emit('cardsPaired', {
        playerId: currentPlayerId,
        cardIndex: cardIndex,
        playerName: room.players[room.currentPlayer].name
      });

      if (hand.length === 0) {
        endGame(room, roomId, currentPlayerId);
        return;
      }
    }

    endTurn(room, roomId);
  });

  socket.on('callCabo', (roomId) => {
    const room = rooms[roomId];
    if (!room || room.caboCalled) return;

    room.caboCalled = true;
    room.caboPlayerId = socket.id;

    io.to(roomId).emit('caboCalled', {
      playerName: room.players[room.players.findIndex(p => p.id === socket.id)].name
    });

    setTimeout(() => {
      endGame(room, roomId, socket.id);
    }, 3000);
  });
});

function handleSpecialAbility(room, roomId, card, playerId) {
  const rank = getCardRank(card);
  const currentPlayerIndex = room.players.findIndex(p => p.id === playerId);

  io.to(roomId).emit('abilityAvailable', {
    rank: rank,
    playerName: room.players[currentPlayerIndex].name
  });
}

function endTurn(room, roomId) {
  room.currentPlayer = (room.currentPlayer + 1) % room.players.length;
  io.to(roomId).emit('turnChanged', {
    currentPlayer: room.currentPlayer,
    currentPlayerName: room.players[room.currentPlayer].name
  });
}

function endGame(room, roomId, winnerId) {
  roo
