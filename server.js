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

// 洗牌函數
function shuffleDeck() {
  const suits = ['♠', '♥', '♦', '♣'];
  const values = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'K'];
  const deck = [];
  for (let suit of suits) {
    for (let i = 0; i < values.length; i++) {
      const value = values[i];
      const isRed = suit === '♥' || suit === '♦';
      deck.push({
        id: `${suit}-${value}-${i}`,
        value: value,
        suit: suit,
        isRed: isRed
      });
    }
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// 計算卡牌分數
function getCardScore(card) {
  if (card.value === 'A') return card.isRed ? -1 : 1;
  if (card.value === 'J') return 11;
  if (card.value === 'Q') return 12;
  if (card.value === 'K') return card.isRed ? -1 : 13;
  return parseInt(card.value) || 0;
}

// 初始化遊戲
function initializeGame(roomId, playerIds) {
  const deck = shuffleDeck();
  const game = {
    roomId: roomId,
    playerIds: playerIds,
    deck: deck,
    discardPile: [],
    currentPlayerIndex: 0,
    round: 1,
    hands: {},
    playerState: {},
    gameState: 'playing', // 'playing', 'ended'
    cableCalledBy: null,
    cardVisibility: {}, // 追蹤卡牌何時對玩家可見
    deckIndex: 0
  };

  // 為每位玩家初始化手牌
  for (let i = 0; i < playerIds.length; i++) {
    const playerId = playerIds[i];
    const hand = [];
    
    // 發4張牌
    for (let j = 0; j < 4; j++) {
      const card = deck[game.deckIndex];
      game.deckIndex++;
      hand.push({
        ...card,
        isVisible: j < 2, // 前2張初始可見，後2張初始不可見
        isFlippedAfterInitial: false
      });
    }
    
    game.hands[playerId] = hand;
    game.playerState[playerId] = {
      score: 0,
      roundScores: [0, 0, 0],
      hasCalledCable: false,
      socketId: null
    };
  }

  // 第一輪開始時，所有玩家的前2張牌短暫可見2秒後翻回反面
  setTimeout(() => {
    for (let playerId in game.hands) {
      game.hands[playerId].forEach((card, index) => {
        if (index < 2) {
          card.isFlippedAfterInitial = true; // 2秒後翻反面
        }
      });
    }
    io.to(roomId).emit('updateHands', getHandsForAllPlayers(game));
  }, 2000);

  return game;
}

// 為特定玩家生成手牌視圖
function getHandsForPlayer(game, viewerId) {
  const hands = {};
  for (let playerId in game.hands) {
    hands[playerId] = game.hands[playerId].map(card => ({
      id: card.id,
      value: card.value,
      suit: card.suit,
      isRed: card.isRed,
      isFaceUp: playerId === viewerId, // 只有自己能看到正面
      isVisible: playerId === viewerId ? true : false
    }));
  }
  return hands;
}

// 為所有玩家生成手牌視圖
function getHandsForAllPlayers(game) {
  const result = {};
  for (let playerId of game.playerIds) {
    result[playerId] = getHandsForPlayer(game, playerId);
  }
  return result;
}

// 連接玩家到房間
io.on('connection', (socket) => {
  socket.on('joinRoom', (data) => {
    const { roomId, playerId, playerName } = data;

    if (!rooms[roomId]) {
      rooms[roomId] = {
        roomId: roomId,
        players: {},
        game: null
      };
    }

    rooms[roomId].players[playerId] = {
      playerId: playerId,
      playerName: playerName,
      socketId: socket.id
    };

    socket.join(roomId);
    socket.emit('roomJoined', {
      roomId: roomId,
      players: Object.values(rooms[roomId].players)
    });
    io.to(roomId).emit('playersUpdated', Object.values(rooms[roomId].players));
  });

  socket.on('startGame', (data) => {
    const { roomId } = data;
    const room = rooms[roomId];

    if (room && Object.keys(room.players).length >= 2) {
      const playerIds = Object.keys(room.players);
      room.game = initializeGame(roomId, playerIds);

      // 為每位玩家設定 socketId
      for (let playerId in room.players) {
        room.game.playerState[playerId].socketId = room.players[playerId].socketId;
      }

      io.to(roomId).emit('gameStarted', {
        game: {
          round: room.game.round,
          currentPlayerIndex: room.game.currentPlayerIndex,
          currentPlayerId: room.game.playerIds[room.game.currentPlayerIndex]
        },
        handsForAllPlayers: getHandsForAllPlayers(room.game),
        discardPile: room.game.discardPile
      });
    }
  });

  socket.on('drawCard', (data) => {
    const { roomId, playerId } = data;
    const room = rooms[roomId];
    const game = room.game;

    if (game && game.playerIds[game.currentPlayerIndex] === playerId) {
      let card;
      
      // 如果牌堆為空，將棄牌堆洗回牌堆
      if (game.deckIndex >= game.deck.length) {
        if (game.discardPile.length === 0) {
          return; // 遊戲結束
        }
        game.deck = game.discardPile;
        game.discardPile = [];
        game.deckIndex = 0;
      }

      card = game.deck[game.deckIndex];
      game.deckIndex++;
      card.isVisible = true;
      card.isFlippedAfterInitial = false;

      io.to(roomId).emit('cardDrawn', {
        playerId: playerId,
        handsForAllPlayers: getHandsForAllPlayers(game)
      });
    }
  });

  socket.on('swapCard', (data) => {
    const { roomId, playerId, handIndex, drawnCardId, specialAbilityUsed } = data;
    const room = rooms[roomId];
    const game = room.game;

    if (game && game.playerIds[game.currentPlayerIndex] === playerId) {
      const hand = game.hands[playerId];
      const drawnCard = hand.find(card => card.id === drawnCardId);

      if (drawnCard && handIndex >= 0 && handIndex < 4) {
        const discardedCard = hand[handIndex];
        hand[handIndex] = drawnCard;
        drawnCard.isVisible = false;
        drawnCard.isFlippedAfterInitial = true;
        game.discardPile.push(discardedCard);

        // 檢查配對
        const updatedHand = game.hands[playerId];
        const pairs = [];
        for (let i = 0; i < 2; i++) {
          if (updatedHand[i].value === updatedHand[i + 2].value) {
            pairs.push([i, i + 2]);
          }
        }

        io.to(roomId).emit('cardSwapped', {
          playerId: playerId,
          discardedCard: discardedCard,
          handsForAllPlayers: getHandsForAllPlayers(game),
          pairs: pairs
        });

        // 處理特殊能力
        if (specialAbilityUsed) {
          handleSpecialAbility(game, roomId, playerId, specialAbilityUsed);
        }

        // 回合結束
        game.currentPlayerIndex = (game.currentPlayerIndex + 1) % game.playerIds.length;
        io.to(roomId).emit('turnChanged', {
          currentPlayerIndex: game.currentPlayerIndex,
          currentPlayerId: game.playerIds[game.currentPlayerIndex]
        });
      }
    }
  });

  socket.on('callCable', (data) => {
    const { roomId, playerId } = data;
    const room = rooms[roomId];
    const game = room.game;

    if (game) {
      game.cableCalledBy = playerId;
      game.gameState = 'ended';

      // 計算最終分數
      const scores = {};
      for (let pid of game.playerIds) {
        let totalScore = 0;
        for (let cardIndex = 0; cardIndex < 4; cardIndex++) {
          const card = game.hands[pid][cardIndex];
          totalScore += getCardScore(card);
        }
        scores[pid] = totalScore;
        game.playerState[pid].roundScores[game.round - 1] = totalScore;
      }

      if (game.round < 3) {
        io.to(roomId).emit('cableCalled', {
          cableCalledBy: playerId,
          scores: scores,
          round: game.round,
          nextRound: game.round + 1
        });
      } else {
        // 計算總分
        const finalScores = {};
        for (let pid of game.playerIds) {
          finalScores[pid] = game.playerState[pid].roundScores.reduce((a, b) => a + b, 0);
        }
        io.to(roomId).emit('gameEnded', {
          cableCalledBy: playerId,
          scores: scores,
          finalScores: finalScores
        });
      }
    }
  });

  socket.on('nextRound', (data) => {
    const { roomId } = data;
    const room = rooms[roomId];
    const game = room.game;

    if (game && game.round < 3) {
      game.round++;
      game.gameState = 'playing';
      game.cableCalledBy = null;
      game.currentPlayerIndex = 0;

      const playerIds = game.playerIds;
      const newGame = initializeGame(roomId, playerIds);

      for (let playerId in game.playerState) {
        newGame.playerState[playerId].roundScores = game.playerState[playerId].roundScores;
      }

      room.game = newGame;

      io.to(roomId).emit('gameStarted', {
        game: {
          round: newGame.round,
          currentPlayerIndex: newGame.currentPlayerIndex,
          currentPlayerId: newGame.playerIds[newGame.currentPlayerIndex]
        },
        handsForAllPlayers: getHandsForAllPlayers(newGame),
        discardPile: newGame.discardPile
      });
    }
  });

  socket.on('leaveRoom', (data) => {
    const { roomId, playerId } = data;
    if (rooms[roomId]) {
      delete rooms[roomId].players[playerId];
      if (Object.keys(rooms[roomId].players).length === 0) {
        delete rooms[roomId];
      } else {
        io.to(roomId).emit('playersUpdated', Object.values(rooms[roomId].players));
      }
    }
  });

  socket.on('disconnect', () => {
    // 處理玩家斷線
  });
});

function handleSpecialAbility(game, roomId, playerId, ability) {
  // 特殊能力邏輯
  io.to(roomId).emit('specialAbilityUsed', {
    playerId: playerId,
    ability: ability.type
  });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`CABO Game Server running on port ${PORT}`);
});
