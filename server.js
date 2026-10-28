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
  socket.on('createRoom', (playerName) => {
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
      pairedCards: {},
      scores: {},
      drawnCard: null,
      waitingForSwap: {}
    };
    
    players[socket.id] = { room: roomCode, name: playerName, index: 0 };
    socket.join(roomCode);
    socket.emit('roomCreated', roomCode);
    io.to(roomCode).emit('playerJoined', rooms[roomCode].players);
  });

  socket.on('joinRoom', (roomCode, playerName) => {
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
    const room = rooms[players[socket.id].room];
    if (!room || room.players.length < 2) {
      socket.emit('error', '至少需要2名玩家');
      return;
    }

    room.gameState = 'playing';
    initializeGame(room);
    
    io.to(room.code).emit('gameStarted', {
      players: room.players,
      playerCards: room.playerCards,
      currentPlayerIndex: 0,
      discardPile: room.discardPile,
      deckCount: room.deck.length
    });
  });

  socket.on('drawCard', () => {
    const roomCode = players[socket.id].room;
    const room = rooms[roomCode];
    const playerIndex = players[socket.id].index;
    const isCurrentPlayer = room.currentPlayerIndex === playerIndex;

    if (!isCurrentPlayer) {
      socket.emit('error', '不是你的回合');
      return;
    }

    if (room.deck.length === 0) {
      refillDeck(room);
    }

    const card = room.deck.pop();
    room.drawnCard = { card, playerIndex };

    socket.emit('drawnCard', card);
    io.to(roomCode).emit('gameUpdate', { 
      deckCount: room.deck.length,
      message: `${room.players[playerIndex].name} 從牌堆抽牌`
    });
  });

  socket.on('discardDrawnCard', () => {
    const roomCode = players[socket.id].room;
    const room = rooms[roomCode];
    
    if (!room.drawnCard) {
      socket.emit('error', '沒有抽到牌');
      return;
    }

    room.discardPile.push(room.drawnCard.card);
    room.drawnCard = null;

    io.to(roomCode).emit('gameUpdate', { 
      discardPile: room.discardPile,
      message: '牌被棄掉'
    });
  });

  socket.on('replaceCard', (cardIndex) => {
    const roomCode = players[socket.id].room;
    const room = rooms[roomCode];
    const playerIndex = players[socket.id].index;

    if (!room.drawnCard) {
      socket.emit('error', '沒有抽到牌');
      return;
    }

    const oldCard = room.playerCards[playerIndex][cardIndex];
    room.playerCards[playerIndex][cardIndex] = room.drawnCard.card;
    room.discardPile.push(oldCard);
    room.drawnCard = null;

    io.to(roomCode).emit('gameUpdate', { 
      playerCards: room.playerCards,
      discardPile: room.discardPile,
      message: `${room.players[playerIndex].name} 替換第 ${cardIndex + 1} 張牌`
    });
  });

  socket.on('viewOwnCard', (cardIndex) => {
    const roomCode = players[socket.id].room;
    const room = rooms[roomCode];
    const playerIndex = players[socket.id].index;
    const card = room.playerCards[playerIndex][cardIndex];

    socket.emit('cardViewed', { index: cardIndex, card });
  });

  socket.on('activateSpecialAbility', (abilityCard, targetPlayerIndex, targetCardIndex) => {
    const roomCode = players[socket.id].room;
    const room = rooms[roomCode];
    const playerIndex = players[socket.id].index;
    const cardRank = abilityCard.rank;

    if (['7', '8'].includes(cardRank)) {
      // 7/8: 查看自己的牌
      const card = room.playerCards[playerIndex][targetCardIndex];
      socket.emit('cardViewed', { index: targetCardIndex, card });
    } 
    else if (['9', '10'].includes(cardRank)) {
      // 9/10: 查看其他玩家的牌
      const card = room.playerCards[targetPlayerIndex][targetCardIndex];
      socket.emit('cardViewed', { 
        player: room.players[targetPlayerIndex].name,
        index: targetCardIndex, 
        card 
      });
    } 
    else if (['J', 'Q'].includes(cardRank)) {
      // J/Q: 盲交換
      const temp = room.playerCards[playerIndex][targetCardIndex];
      room.playerCards[playerIndex][targetCardIndex] = room.playerCards[targetPlayerIndex][targetCardIndex];
      room.playerCards[targetPlayerIndex][targetCardIndex] = temp;

      io.to(roomCode).emit('gameUpdate', { 
        playerCards: room.playerCards,
        message: `${room.players[playerIndex].name} 與 ${room.players[targetPlayerIndex].name} 盲交換牌張`
      });
    }
    else if (['K', 'A'].includes(cardRank)) {
      // K/A: 查看後決定交換
      const otherCard = room.playerCards[targetPlayerIndex][targetCardIndex];
      room.waitingForSwap[socket.id] = {
        playerIndex,
        targetPlayerIndex,
        targetCardIndex,
        ownCardIndex: targetCardIndex,
        otherCard
      };

      socket.emit('swapDecision', { 
        card: otherCard,
        player: room.players[targetPlayerIndex].name
      });
    }
  });

  socket.on('confirmSwap', (doSwap) => {
    const roomCode = players[socket.id].room;
    const room = rooms[roomCode];
    const swapData = room.waitingForSwap[socket.id];

    if (!swapData) {
      socket.emit('error', '交換資料不存在');
      return;
    }

    if (doSwap) {
      const temp = room.playerCards[swapData.playerIndex][swapData.ownCardIndex];
      room.playerCards[swapData.playerIndex][swapData.ownCardIndex] = 
        room.playerCards[swapData.targetPlayerIndex][swapData.targetCardIndex];
      room.playerCards[swapData.targetPlayerIndex][swapData.targetCardIndex] = temp;
    }

    delete room.waitingForSwap[socket.id];

    io.to(roomCode).emit('gameUpdate', { 
      playerCards: room.playerCards,
      message: doSwap ? '交換完成' : '放棄交換'
    });
  });

  socket.on('pairCards', (pairIndices) => {
    const roomCode = players[socket.id].room;
    const room = rooms[roomCode];
    const playerIndex = players[socket.id].index;

    pairIndices.forEach(([idx1, idx2]) => {
      const card1 = room.playerCards[playerIndex][idx1];
      const card2 = room.playerCards[playerIndex][idx2];

      if (card1 && card2 && getCardRank(card1) === getCardRank(card2)) {
        // 配對成功
        const discardCard = room.discardPile[room.discardPile.length - 1];
        if (getCardRank(card1) === getCardRank(discardCard)) {
          // 與棄牌堆配對
          room.playerCards[playerIndex][idx1] = null;
          room.playerCards[playerIndex][idx2] = null;
        }
      }
    });

    io.to(roomCode).emit('gameUpdate', { 
      playerCards: room.playerCards,
      message: `${room.players[playerIndex].name} 完成配對`
    });
  });

  socket.on('endTurn', () => {
    const roomCode = players[socket.id].room;
    const room = rooms[roomCode];

    room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.players.length;

    io.to(roomCode).emit('turnChanged', {
      currentPlayerIndex: room.currentPlayerIndex,
      currentPlayer: room.players[room.currentPlayerIndex].name
    });
  });

  socket.on('leaveRoom', () => {
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
  const topCard = room.deck.pop();
  room.discardPile = [topCard];

  room.playerCards = {};
  room.pairedCards = {};
  room.scores = {};

  room.players.forEach((player, index) => {
    room.playerCards[index] = [];
    room.pairedCards[index] = [];
    room.scores[index] = 0;

    for (let i = 0; i < 4; i++) {
      room.playerCards[index].push(room.deck.pop());
    }
  });
}

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

function refillDeck(room) {
  const lastCard = room.discardPile.pop();
  room.deck = room.discardPile.sort(() => Math.random() - 0.5);
  room.discardPile = [lastCard];
}

function getCardRank(card) {
  if (!card) return null;
  return card.rank;
}

server.listen(3000, () => console.log('Server running on port 3000'));
