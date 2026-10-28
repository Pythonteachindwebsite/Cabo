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
  let deck = [];
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
    return (card.suit === '♠' || card.suit === '♣') ? 13 : -1;
  }
  return parseInt(card.rank);
}

function getHandValue(hand) {
  return hand.reduce((sum, card) => sum + getCardValue(card), 0);
}

io.on('connection', (socket) => {
  socket.on('createRoom', (playerName, callback) => {
    const roomCode = Math.random().toString(36).substr(2, 6).toUpperCase();
    rooms[roomCode] = {
      hostId: socket.id,
      players: [{ id: socket.id, name: playerName, ready: false }],
      game: null,
      gameState: 'lobby'
    };
    socket.join(roomCode);
    socket.roomCode = roomCode;
    callback({ roomCode });
    io.to(roomCode).emit('playerUpdate', rooms[roomCode].players);
  });

  socket.on('joinRoom', (roomCode, playerName, callback) => {
    if (!rooms[roomCode]) {
      callback({ error: 'Room not found' });
      return;
    }
    if (rooms[roomCode].gameState !== 'lobby') {
      callback({ error: 'Game already started' });
      return;
    }
    if (rooms[roomCode].players.length >= 4) {
      callback({ error: 'Room full' });
      return;
    }
    rooms[roomCode].players.push({ id: socket.id, name: playerName, ready: false });
    socket.join(roomCode);
    socket.roomCode = roomCode;
    io.to(roomCode).emit('playerUpdate', rooms[roomCode].players);
    callback({ success: true, roomCode });
  });

  socket.on('startGame', () => {
    const roomCode = socket.roomCode;
    if (!rooms[roomCode] || socket.id !== rooms[roomCode].hostId) return;
    if (rooms[roomCode].players.length < 2) return;

    const deck = createDeck();
    const game = {
      deck,
      discard: [deck.pop()],
      players: rooms[roomCode].players.map(p => ({
        id: p.id,
        name: p.name,
        hand: [],
        visible: [true, true, false, false],
        paired: [false, false, false, false],
        caboCalled: false
      })),
      currentIdx: 0,
      drawn: null,
      drawnBy: null,
      round: 1,
      scores: rooms[roomCode].players.map(p => ({ name: p.name, score: 0 }))
    };

    // Deal 4 cards to each player
    for (let i = 0; i < 4; i++) {
      for (let p of game.players) {
        p.hand.push(deck.pop());
      }
    }

    rooms[roomCode].game = game;
    rooms[roomCode].gameState = 'playing';

    io.to(roomCode).emit('gameStart', {
      game,
      currentPlayerName: game.players[0].name
    });

    // After 2 seconds, flip initial face-up cards to face-down
    setTimeout(() => {
      game.players.forEach(p => {
        p.visible = [false, false, false, false];
      });
      io.to(roomCode).emit('flipAllDown', null);
    }, 2000);
  });

  socket.on('draw', () => {
    const roomCode = socket.roomCode;
    const game = rooms[roomCode]?.game;
    if (!game || game.drawn) return;

    const currentPlayer = game.players[game.currentIdx];
    if (currentPlayer.id !== socket.id) return;

    if (game.deck.length === 0) {
      game.deck = game.discard.slice(0, -1).sort(() => Math.random() - 0.5);
      game.discard = [game.discard[game.discard.length - 1]];
    }

    game.drawn = game.deck.pop();
    game.drawnBy = socket.id;

    io.to(roomCode).emit('cardDrawn', {
      drawn: game.drawn,
      playerName: currentPlayer.name
    });
  });

  socket.on('swap', (pos) => {
    const roomCode = socket.roomCode;
    const game = rooms[roomCode]?.game;
    if (!game || !game.drawn) return;

    const currentPlayer = game.players[game.currentIdx];
    if (currentPlayer.id !== socket.id) return;

    const oldCard = currentPlayer.hand[pos];
    const swappedCard = game.drawn;

    currentPlayer.hand[pos] = swappedCard;
    currentPlayer.visible[pos] = false;
    game.discard.push(oldCard);
    game.drawn = null;

    // Trigger special ability
    triggerAbility(roomCode, swappedCard.rank, currentPlayer, pos);

    // Check for pairing
    checkPairing(roomCode, currentPlayer);

    io.to(roomCode).emit('cardSwapped', {
      playerId: currentPlayer.id,
      pos,
      newCard: swappedCard
    });

    nextTurn(roomCode);
  });

  socket.on('discard', () => {
    const roomCode = socket.roomCode;
    const game = rooms[roomCode]?.game;
    if (!game || !game.drawn) return;

    const currentPlayer = game.players[game.currentIdx];
    if (currentPlayer.id !== socket.id) return;

    game.discard.push(game.drawn);

    // Trigger special ability
    triggerAbility(roomCode, game.drawn.rank, currentPlayer, -1);

    game.drawn = null;

    io.to(roomCode).emit('cardDiscarded', {
      card: game.discard[game.discard.length - 1]
    });

    nextTurn(roomCode);
  });

  socket.on('callCabo', () => {
    const roomCode = socket.roomCode;
    const game = rooms[roomCode]?.game;
    if (!game) return;

    const currentPlayer = game.players[game.currentIdx];
    if (currentPlayer.id !== socket.id) return;

    const handValue = getHandValue(currentPlayer.hand);
    if (handValue <= 16) {
      currentPlayer.caboCalled = true;
      io.to(roomCode).emit('caboCalled', {
        playerName: currentPlayer.name
      });
    }
  });

  socket.on('viewOwnCard', (pos) => {
    const roomCode = socket.roomCode;
    const game = rooms[roomCode]?.game;
    if (!game) return;

    const currentPlayer = game.players[game.currentIdx];
    if (currentPlayer.id !== socket.id) return;

    socket.emit('ownCardViewed', {
      pos,
      card: currentPlayer.hand[pos]
    });
  });

  socket.on('viewOpponentCard', (opponentId, pos) => {
    const roomCode = socket.roomCode;
    const game = rooms[roomCode]?.game;
    if (!game) return;

    const currentPlayer = game.players[game.currentIdx];
    if (currentPlayer.id !== socket.id) return;

    const opponent = game.players.find(p => p.id === opponentId);
    if (!opponent) return;

    socket.emit('opponentCardViewed', {
      opponentId,
      pos,
      card: opponent.hand[pos]
    });
  });

  socket.on('swapOpponentCard', (opponentId, pos, newPos) => {
    const roomCode = socket.roomCode;
    const game = rooms[roomCode]?.game;
    if (!game) return;

    const currentPlayer = game.players[game.currentIdx];
    if (currentPlayer.id !== socket.id) return;

    const opponent = game.players.find(p => p.id === opponentId);
    if (!opponent) return;

    const temp = currentPlayer.hand[pos];
    currentPlayer.hand[pos] = opponent.hand[newPos];
    opponent.hand[newPos] = temp;

    io.to(roomCode).emit('opponentCardSwapped', {
      playerId: currentPlayer.id,
      opponentId,
      pos,
      newPos
    });
  });
});

function triggerAbility(roomCode, rank, player, pos) {
  // Abilities only trigger when card is discarded
  if (pos !== -1) return;

  const io = require('socket.io')();
  // Abilities will be handled on client side
}

function checkPairing(roomCode, player) {
  const game = rooms[roomCode]?.game;
  if (!game) return;

  const discardTop = game.discard[game.discard.length - 1];

  for (let i = 0; i < player.hand.length; i++) {
    if (!player.paired[i] && player.hand[i]) {
      const handCard = player.hand[i];
      if (handCard.rank === discardTop.rank && handCard.suit === discardTop.suit) {
        player.paired[i] = true;
      }
    }
  }
}

function nextTurn(roomCode) {
  const game = rooms[roomCode]?.game;
  if (!game) return;

  game.currentIdx = (game.currentIdx + 1) % game.players.length;

  const io = require('socket.io')();
  io.to(roomCode).emit('nextTurn', {
    playerName: game.players[game.currentIdx].name,
    playerId: game.players[game.currentIdx].id
  });
}

server.listen(process.env.PORT || 3000, () => console.log('Server running'));
