// server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

app.use(express.static('public'));

const rooms = {};

function initializeGame(roomCode) {
  return {
    players: [],
    deck: createDeck(),
    discardPile: [],
    currentPlayerIndex: 0,
    gameStarted: false,
    deckIndex: 0,
    cabloDeclared: false,
    cabloPlayer: null,
    roundsAfterCablo: 0,
    gameEnded: false
  };
}

function createDeck() {
  const suits = ['♠', '♥', '♦', '♣'];
  const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const deck = [];
  for (let suit of suits) {
    for (let rank of ranks) {
      deck.push({ suit, rank });
    }
  }
  return deck.sort(() => Math.random() - 0.5);
}

function getCardValue(card) {
  const rank = card.rank;
  if (rank === 'A') return 1;
  if (rank === 'J') return 11;
  if (rank === 'Q') return 12;
  if (rank === 'K') {
    return card.suit === '♥' || card.suit === '♦' ? -1 : 13;
  }
  return parseInt(rank);
}

function startGame(roomCode) {
  const game = rooms[roomCode].game;
  game.players.forEach(player => {
    player.hand = [];
    player.handVisible = [false, false, false, false];
    player.viewedCards = {};
  });

  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      game.players[i].hand.push(game.deck[game.deckIndex++]);
    }
  }

  game.gameStarted = true;
  game.discardPile.push(game.deck[game.deckIndex++]);
}

function drawCard(game) {
  if (game.deckIndex >= game.deck.length) {
    game.gameEnded = true;
    return null;
  }
  return game.deck[game.deckIndex++];
}

function attemptPairing(game, playerIndex, handIndex) {
  const player = game.players[playerIndex];
  const topCard = game.discardPile[game.discardPile.length - 1];
  const handCard = player.hand[handIndex];

  if (getCardValue(topCard) === getCardValue(handCard)) {
    game.discardPile.pop();
    player.handVisible[handIndex] = true;
    return { success: true, handIndex };
  } else {
    player.handVisible[handIndex] = true;
    return { success: false, handIndex };
  }
}

function handleSpecialAbility(game, playerIndex, drawnCard, abilityTarget) {
  const player = game.players[playerIndex];
  const rank = drawnCard.rank;

  if (rank === '7' || rank === '8') {
    if (abilityTarget.type === 'view' && abilityTarget.cardIndex !== undefined) {
      player.viewedCards[abilityTarget.cardIndex] = player.hand[abilityTarget.cardIndex];
    }
  } else if (rank === '9' || rank === '10') {
    if (abilityTarget.type === 'view' && abilityTarget.playerIndex !== undefined && abilityTarget.cardIndex !== undefined) {
      const targetPlayer = game.players[abilityTarget.playerIndex];
      player.viewedCards[`${abilityTarget.playerIndex}_${abilityTarget.cardIndex}`] = targetPlayer.hand[abilityTarget.cardIndex];
    }
  } else if (rank === 'J' || rank === 'Q') {
    if (abilityTarget.type === 'swap' && abilityTarget.playerIndex !== undefined && abilityTarget.cardIndex !== undefined) {
      const targetPlayer = game.players[abilityTarget.playerIndex];
      const temp = player.hand[playerIndex];
      player.hand[playerIndex] = targetPlayer.hand[abilityTarget.cardIndex];
      targetPlayer.hand[abilityTarget.cardIndex] = temp;
    }
  } else if (rank === 'K' || rank === 'A') {
    if (abilityTarget.type === 'swapAfterView' && abilityTarget.playerIndex !== undefined && abilityTarget.cardIndex !== undefined) {
      const targetPlayer = game.players[abilityTarget.playerIndex];
      if (abilityTarget.doSwap) {
        const temp = player.hand[abilityTarget.ownCardIndex];
        player.hand[abilityTarget.ownCardIndex] = targetPlayer.hand[abilityTarget.cardIndex];
        targetPlayer.hand[abilityTarget.cardIndex] = temp;
      }
    }
  }
}

io.on('connection', (socket) => {
  socket.on('createRoom', (playerName, callback) => {
    let roomCode;
    do {
      roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    } while (rooms[roomCode]);

    rooms[roomCode] = {
      players: [{ id: socket.id, name: playerName }],
      game: initializeGame(roomCode),
      sockets: { [socket.id]: socket }
    };

    socket.join(roomCode);
    socket.roomCode = roomCode;
    callback(roomCode);
    io.to(roomCode).emit('roomUpdate', getRoomData(roomCode));
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
    rooms[roomCode].sockets[socket.id] = socket;
    socket.join(roomCode);
    socket.roomCode = roomCode;

    callback({ success: true });
    io.to(roomCode).emit('roomUpdate', getRoomData(roomCode));
  });

  socket.on('startGame', () => {
    const roomCode = socket.roomCode;
    if (!rooms[roomCode] || rooms[roomCode].players.length !== 4) return;

    const game = rooms[roomCode].game;
    game.players = rooms[roomCode].players.map(p => ({
      id: p.id,
      name: p.name,
      hand: [],
      handVisible: [false, false, false, false],
      viewedCards: {},
      score: 0
    }));

    startGame(roomCode);
    io.to(roomCode).emit('gameStarted', getGameState(roomCode));
  });

  socket.on('viewCard', (cardIndex) => {
    const roomCode = socket.roomCode;
    const game = rooms[roomCode].game;
    const playerIndex = game.players.findIndex(p => p.id === socket.id);
    if (playerIndex === -1) return;

    const player = game.players[playerIndex];
    player.viewedCards[cardIndex] = player.hand[cardIndex];
    io.to(roomCode).emit('cardViewed', { playerIndex, cardIndex, card: player.hand[cardIndex] });
  });

  socket.on('playerAction', (action) => {
    const roomCode = socket.roomCode;
    const game = rooms[roomCode].game;
    const playerIndex = game.players.findIndex(p => p.id === socket.id);
    if (playerIndex === -1 || playerIndex !== game.currentPlayerIndex) return;

    const player = game.players[playerIndex];
    const drawnCard = action.drawnCard;

    if (action.type === 'swap') {
      [player.hand[action.handIndex], player.hand[action.swapWithIndex]] = [player.hand[action.swapWithIndex], player.hand[action.handIndex]];
      game.discardPile.push(drawnCard);
      game.currentPlayerIndex = (game.currentPlayerIndex + 1) % 4;
    } else if (action.type === 'discard') {
      game.discardPile.push(drawnCard);
      handleSpecialAbility(game, playerIndex, drawnCard, action.abilityTarget || {});
      attemptPairing(game, playerIndex, action.pairingHandIndex);
      game.currentPlayerIndex = (game.currentPlayerIndex + 1) % 4;
    }

    if (game.gameEnded) {
      const scores = game.players.map((p, i) => ({
        playerIndex: i,
        name: p.name,
        score: p.hand.reduce((sum, card) => sum + getCardValue(card), 0)
      }));
      io.to(roomCode).emit('gameEnded', scores);
      return;
    }

    io.to(roomCode).emit('gameState', getGameState(roomCode));
  });

  socket.on('declareCablo', () => {
    const roomCode = socket.roomCode;
    const game = rooms[roomCode].game;
    const playerIndex = game.players.findIndex(p => p.id === socket.id);
    if (playerIndex === -1) return;

    game.cabloDeclared = true;
    game.cabloPlayer = playerIndex;
    game.roundsAfterCablo = 0;
    io.to(roomCode).emit('cabloDeclared', playerIndex);
  });

  socket.on('disconnect', () => {
    for (let roomCode in rooms) {
      const room = rooms[roomCode];
      const playerIndex = room.players.findIndex(p => p.id === socket.id);
      if (playerIndex !== -1) {
        room.players.splice(playerIndex, 1);
        delete room.sockets[socket.id];

        if (room.players.length === 0) {
          delete rooms[roomCode];
        } else {
          io.to(roomCode).emit('roomUpdate', getRoomData(roomCode));
        }
        break;
      }
    }
  });
});

function getRoomData(roomCode) {
  const room = rooms[roomCode];
  return {
    roomCode,
    players: room.players,
    playerCount: room.players.length
  };
}

function getGameState(roomCode) {
  const game = rooms[roomCode].game;
  return {
    players: game.players.map(p => ({
      id: p.id,
      name: p.name,
      handCount: p.hand.length,
      handVisible: p.handVisible
    })),
    currentPlayerIndex: game.currentPlayerIndex,
    discardPileTop: game.discardPile[game.discardPile.length - 1],
    deckRemaining: game.deck.length - game.deckIndex,
    cabloDeclared: game.cabloDeclared,
    cabloPlayer: game.cabloPlayer
  };
}

server.listen(3000, () => console.log('Server running on port 3000'));

