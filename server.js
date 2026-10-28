const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static('public'));

const rooms = {};
const cardValues = {
  'A': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
  'J': 11, 'Q': 12, 'K': 0
};

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

function dealCards(deck, numPlayers) {
  const hands = Array(numPlayers).fill(null).map(() => []);
  for (let i = 0; i < numPlayers; i++) {
    hands[i] = [deck.pop(), deck.pop()];
  }
  return hands;
}

function getCardValue(card) {
  return cardValues[card.rank];
}

io.on('connection', (socket) => {
  socket.on('createRoom', (playerName) => {
    const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    rooms[roomCode] = {
      players: [{ id: socket.id, name: playerName, ready: false }],
      gameState: 'waiting',
      deck: [],
      discardPile: [],
      currentPlayerIndex: 0,
      round: 0
    };
    socket.join(roomCode);
    socket.emit('roomCreated', { roomCode });
    io.to(roomCode).emit('updatePlayers', rooms[roomCode].players);
  });

  socket.on('joinRoom', (data) => {
    const { roomCode, playerName } = data;
    if (!rooms[roomCode]) {
      socket.emit('error', '房間不存在');
      return;
    }
    if (rooms[roomCode].players.length >= 4) {
      socket.emit('error', '房間已滿');
      return;
    }
    rooms[roomCode].players.push({ id: socket.id, name: playerName, ready: false });
    socket.join(roomCode);
    socket.emit('joinedRoom', { roomCode });
    io.to(roomCode).emit('updatePlayers', rooms[roomCode].players);
  });

  socket.on('startGame', (roomCode) => {
    if (!rooms[roomCode]) return;
    const room = rooms[roomCode];
    room.gameState = 'playing';
    room.deck = createDeck();
    room.hands = dealCards(room.deck, room.players.length);
    room.discardPile = [room.deck.pop()];

    // 初始化每個玩家的卡牌可見性狀態
    room.players.forEach((player, idx) => {
      player.cardVisibility = [true, true]; // 初始2張卡牌可見
      player.revealTimeout = setTimeout(() => {
        player.cardVisibility = [false, false]; // 2秒後翻面
        io.to(roomCode).emit('updateHands', getHandsForRoom(roomCode));
      }, 2000);
    });

    io.to(roomCode).emit('gameStarted', {
      players: room.players.map((p, idx) => ({
        name: p.name,
        cardCount: room.hands[idx].length
      })),
      currentPlayer: room.players[0].name
    });
    io.to(roomCode).emit('updateHands', getHandsForRoom(roomCode));
  });

  socket.on('drawCard', (roomCode) => {
    if (!rooms[roomCode]) return;
    const room = rooms[roomCode];
    const playerIndex = room.players.findIndex(p => p.id === socket.id);
    if (playerIndex !== room.currentPlayerIndex) return;

    const card = room.deck.pop();
    room.hands[playerIndex].push(card);
    const handLength = room.hands[playerIndex].length;

    // 新抽到的卡牌暫時可見
    if (!room.players[playerIndex].drawnCardVisibility) {
      room.players[playerIndex].drawnCardVisibility = {};
    }
    room.players[playerIndex].drawnCardVisibility[handLength - 1] = true;

    io.to(roomCode).emit('cardDrawn', {
      playerName: room.players[playerIndex].name,
      card,
      playerIndex
    });
    io.to(roomCode).emit('updateHands', getHandsForRoom(roomCode));
  });

  socket.on('swapCard', (data) => {
    const { roomCode, handIndex } = data;
    if (!rooms[roomCode]) return;
    const room = rooms[roomCode];
    const playerIndex = room.players.findIndex(p => p.id === socket.id);
    if (playerIndex !== room.currentPlayerIndex) return;
    if (room.hands[playerIndex].length === 0) return;

    const drawnCard = room.hands[playerIndex][room.hands[playerIndex].length - 1];
    const swappedCard = room.hands[playerIndex][handIndex];

    room.hands[playerIndex][handIndex] = drawnCard;
    room.hands[playerIndex].pop();
    room.discardPile.push(swappedCard);

    // 抽到的卡牌交換後變成手牌中的卡牌，翻面
    if (room.players[playerIndex].drawnCardVisibility) {
      delete room.players[playerIndex].drawnCardVisibility[room.hands[playerIndex].length];
    }
    if (!room.players[playerIndex].cardVisibility) {
      room.players[playerIndex].cardVisibility = Array(2).fill(false);
    }

    io.to(roomCode).emit('cardSwapped', {
      playerName: room.players[playerIndex].name,
      swappedCard,
      handIndex
    });
    endTurn(roomCode);
  });

  socket.on('peekCard', (data) => {
    const { roomCode, handIndex } = data;
    if (!rooms[roomCode]) return;
    const room = rooms[roomCode];
    const playerIndex = room.players.findIndex(p => p.id === socket.id);

    const card = room.hands[playerIndex][handIndex];
    socket.emit('cardPeeked', { card, handIndex });
  });

  socket.on('callCabo', (roomCode) => {
    if (!rooms[roomCode]) return;
    const room = rooms[roomCode];
    const playerIndex = room.players.findIndex(p => p.id === socket.id);
    if (playerIndex !== room.currentPlayerIndex) return;

    const hand = room.hands[playerIndex];
    const total = hand.reduce((sum, card) => sum + getCardValue(card), 0);

    if (total === 0) {
      io.to(roomCode).emit('caboround', {
        playerName: room.players[playerIndex].name,
        message: '成功喊 CABO！'
      });
      endRound(roomCode, playerIndex);
    } else {
      socket.emit('caboround', {
        message: '喊 CABO 失敗。你的手牌總值為：' + total
      });
    }
  });

  socket.on('leaveRoom', (roomCode) => {
    if (!rooms[roomCode]) return;
    const playerIndex = rooms[roomCode].players.findIndex(p => p.id === socket.id);
    if (playerIndex !== -1) {
      rooms[roomCode].players.splice(playerIndex, 1);
      socket.leave(roomCode);
      io.to(roomCode).emit('updatePlayers', rooms[roomCode].players);
      if (rooms[roomCode].players.length === 0) {
        delete rooms[roomCode];
      }
    }
  });

  socket.on('disconnect', () => {
    for (let roomCode in rooms) {
      const playerIndex = rooms[roomCode].players.findIndex(p => p.id === socket.id);
      if (playerIndex !== -1) {
        rooms[roomCode].players.splice(playerIndex, 1);
        io.to(roomCode).emit('updatePlayers', rooms[roomCode].players);
        if (rooms[roomCode].players.length === 0) {
          delete rooms[roomCode];
        }
      }
    }
  });
});

function endTurn(roomCode) {
  const room = rooms[roomCode];
  room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.players.length;
  io.to(roomCode).emit('turnChanged', { currentPlayer: room.players[room.currentPlayerIndex].name });
  io.to(roomCode).emit('updateHands', getHandsForRoom(roomCode));
}

function endRound(roomCode, winnerIndex) {
  const room = rooms[roomCode];
  room.round++;
  io.to(roomCode).emit('roundEnded', {
    winner: room.players[winnerIndex].name,
    round: room.round
  });
  // 重新開始遊戲或結束
  if (room.round < 3) {
    setTimeout(() => {
      room.deck = createDeck();
      room.hands = dealCards(room.deck, room.players.length);
      room.discardPile = [room.deck.pop()];
      room.currentPlayerIndex = 0;
      room.players.forEach((player, idx) => {
        player.cardVisibility = [true, true];
      });
      io.to(roomCode).emit('gameStarted', {
        players: room.players.map((p, idx) => ({ name: p.name, cardCount: room.hands[idx].length })),
        currentPlayer: room.players[0].name
      });
      io.to(roomCode).emit('updateHands', getHandsForRoom(roomCode));
    }, 3000);
  }
}

function getHandsForRoom(roomCode) {
  const room = rooms[roomCode];
  return room.players.map((player, playerIndex) => ({
    playerIndex,
    hand: room.hands[playerIndex].map((card, cardIndex) => {
      let isVisible = false;
      if (player.cardVisibility && player.cardVisibility[cardIndex]) {
        isVisible = true;
      }
      if (player.drawnCardVisibility && player.drawnCardVisibility[cardIndex]) {
        isVisible = true;
      }
      return { card, isVisible };
    })
  }));
}

server.listen(process.env.PORT || 3000, () => {
  console.log('伺服器已啟動');
});

