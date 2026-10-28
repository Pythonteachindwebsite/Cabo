const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};
const gameState = {};

// 洗牌
function shuffleDeck() {
  const suits = ['♠', '♥', '♦', '♣'];
  const values = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const deck = [];
  for (let suit of suits) {
    for (let value of values) {
      deck.push({ suit, value });
    }
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// 計算牌面分數
function getCardValue(card) {
  if (card.value === 'K' && card.suit === '♥') return -1;
  if (card.value === 'K' && card.suit === '♦') return -1;
  if (card.value === 'K') return 13;
  if (card.value === 'A') return 1;
  if (card.value === 'Q') return 12;
  if (card.value === 'J') return 11;
  if (card.value === '10') return 10;
  return parseInt(card.value);
}

// 玩家連接
io.on('connection', (socket) => {
  
  // 創建房間
  socket.on('createRoom', (playerName) => {
    const roomId = Math.random().toString(36).substr(2, 9);
    rooms[roomId] = {
      players: { [socket.id]: { name: playerName, ready: false } },
      gameStarted: false
    };
    socket.join(roomId);
    socket.room = roomId;
    socket.emit('roomCreated', roomId);
    io.to(roomId).emit('updatePlayers', Object.values(rooms[roomId].players).map(p => p.name));
  });

  // 加入房間
  socket.on('joinRoom', (data) => {
    const { roomId, playerName } = data;
    if (rooms[roomId]) {
      if (Object.keys(rooms[roomId].players).length < 4) {
        rooms[roomId].players[socket.id] = { name: playerName, ready: false };
        socket.join(roomId);
        socket.room = roomId;
        io.to(roomId).emit('updatePlayers', Object.values(rooms[roomId].players).map(p => p.name));
      } else {
        socket.emit('error', '房間已滿');
      }
    } else {
      socket.emit('error', '房間不存在');
    }
  });

  // 開始遊戲
  socket.on('startGame', () => {
    const roomId = socket.room;
    if (!rooms[roomId] || Object.keys(rooms[roomId].players).length !== 4) return;

    rooms[roomId].gameStarted = true;
    const deck = shuffleDeck();
    const playerIds = Object.keys(rooms[roomId].players);

    gameState[roomId] = {
      deck: deck,
      deckIndex: 0,
      discard: [],
      players: playerIds.map((id, idx) => ({
        id,
        name: rooms[roomId].players[id].name,
        hand: [null, null, null, null], // 4張牌的位置
        knownCards: {}, // 玩家知道的牌面 {位置: {suit, value}}
        score: 0,
        caboCalled: false
      })),
      currentPlayerIdx: 0,
      gameEnded: false,
      caboRoundsLeft: 0, // CABO後還能玩幾回合
      roundCount: 0
    };

    // 發初始4張牌給每個玩家
    for (let i = 0; i < 4; i++) {
      for (let p = 0; p < 4; p++) {
        gameState[roomId].players[p].hand[i] = gameState[roomId].deck[gameState[roomId].deckIndex++];
      }
    }

    // 發送遊戲開始信息
    io.to(roomId).emit('gameStarted', { gameState: getPublicGameState(roomId) });

    // 發送私人牌面給每個玩家（只有近身列的2張）
    gameState[roomId].players.forEach((player, idx) => {
      const clientSocket = Array.from(io.sockets.sockets.values()).find(s => s.id === player.id);
      if (clientSocket) {
        // 玩家只能看到自己近身列（位置2、3）的牌
        player.knownCards[2] = player.hand[2];
        player.knownCards[3] = player.hand[3];
        clientSocket.emit('yourHand', {
          hand: player.hand.map((card, pos) => pos >= 2 ? card : null),
          knownCards: player.knownCards
        });
      }
    });
  });

  // 玩家抽牌
  socket.on('drawCard', () => {
    const roomId = socket.room;
    const game = gameState[roomId];
    if (!game || game.gameEnded) return;

    const playerIdx = game.players.findIndex(p => p.id === socket.id);
    if (playerIdx !== game.currentPlayerIdx) return;

    // 檢查牌堆是否抽完
    if (game.deckIndex >= 52) {
      endGame(roomId);
      return;
    }

    const card = game.deck[game.deckIndex++];
    io.to(roomId).emit('cardDrawn', {
      playerName: game.players[playerIdx].name,
      gameState: getPublicGameState(roomId)
    });

    // 發送給當前玩家要決定是交換還是棄牌
    const clientSocket = Array.from(io.sockets.sockets.values()).find(s => s.id === socket.id);
    clientSocket.emit('chooseAction', { drawnCard: card });
  });

  // 玩家選擇交換手牌或棄牌
  socket.on('chooseAction', (data) => {
    const roomId = socket.room;
    const game = gameState[roomId];
    if (!game || game.gameEnded) return;

    const playerIdx = game.players.findIndex(p => p.id === socket.id);
    if (playerIdx !== game.currentPlayerIdx) return;

    const { action, drawnCard, handPosition } = data;

    if (action === 'exchange') {
      // 交換手牌
      const oldCard = game.players[playerIdx].hand[handPosition];
      game.players[playerIdx].hand[handPosition] = drawnCard;
      game.discard.push(oldCard);
      game.players[playerIdx].knownCards[handPosition] = drawnCard;

      io.to(roomId).emit('handExchanged', {
        playerName: game.players[playerIdx].name,
        gameState: getPublicGameState(roomId)
      });

      nextTurn(roomId);
    } else if (action === 'discard') {
      // 直接棄牌
      game.discard.push(drawnCard);
      io.to(roomId).emit('cardDiscarded', {
        playerName: game.players[playerIdx].name,
        discardCard: drawnCard,
        gameState: getPublicGameState(roomId)
      });

      // 觸發特殊能力
      handleSpecialAbility(roomId, drawnCard, playerIdx);
    }
  });

  // 特殊牌能力處理
  function handleSpecialAbility(roomId, card, playerIdx) {
    const game = gameState[roomId];
    const value = card.value;

    if (value === '7' || value === '8') {
      // 查看自己的牌
      const clientSocket = Array.from(io.sockets.sockets.values()).find(s => s.id === game.players[playerIdx].id);
      clientSocket.emit('viewOwnCard', { availablePositions: [0, 1, 2, 3] });
    } else if (value === '9' || value === '10') {
      // 查看其他玩家的牌
      const otherPlayers = game.players.filter((_, idx) => idx !== playerIdx);
      const clientSocket = Array.from(io.sockets.sockets.values()).find(s => s.id === game.players[playerIdx].id);
      clientSocket.emit('viewOtherCard', { 
        otherPlayers: otherPlayers.map(p => ({ id: p.id, name: p.name }))
      });
    } else if (value === 'J' || value === 'Q') {
      // 盲換手牌
      const otherPlayers = game.players.filter((_, idx) => idx !== playerIdx);
      const clientSocket = Array.from(io.sockets.sockets.values()).find(s => s.id === game.players[playerIdx].id);
      clientSocket.emit('blindExchange', { 
        otherPlayers: otherPlayers.map(p => ({ id: p.id, name: p.name }))
      });
    } else if (value === 'K' || value === 'A') {
      // 查看後決定交換
      const otherPlayers = game.players.filter((_, idx) => idx !== playerIdx);
      const clientSocket = Array.from(io.sockets.sockets.values()).find(s => s.id === game.players[playerIdx].id);
      clientSocket.emit('viewThenExchange', { 
        otherPlayers: otherPlayers.map(p => ({ id: p.id, name: p.name }))
      });
    } else {
      // 沒有特殊能力，直接開放配對
      openPairingPhase(roomId);
    }
  }

  // 開放配對時段
  function openPairingPhase(roomId) {
    const game = gameState[roomId];
    if (game.discard.length === 0) {
      nextTurn(roomId);
      return;
    }

    const topCard = game.discard[game.discard.length - 1];
    io.to(roomId).emit('pairingOpen', {
      topCard: topCard,
      gameState: getPublicGameState(roomId)
    });
  }

  // 配對
  socket.on('attemptPairing', (data) => {
    const roomId = socket.room;
    const game = gameState[roomId];
    if (!game || game.gameEnded || game.discard.length === 0) return;

    const pairingPlayerIdx = game.players.findIndex(p => p.id === socket.id);
    const { targetPlayerIdx, handPosition } = data;

    const topCard = game.discard[game.discard.length - 1];
    const targetCard = game.players[targetPlayerIdx].hand[handPosition];

    if (targetCard && targetCard.value === topCard.value) {
      // 配對成功
      game.discard.pop();
      game.players[targetPlayerIdx].hand[handPosition] = null;

      if (pairingPlayerIdx !== targetPlayerIdx) {
        // 配對其他玩家的牌，要交給對方一張
        // 這裡簡化處理，實際應讓配對者選一張牌
        const pairer = game.players[pairingPlayerIdx];
        let givenCard = null;
        for (let i = 0; i < 4; i++) {
          if (pairer.hand[i] !== null) {
            givenCard = pairer.hand[i];
            pairer.hand[i] = null;
            break;
          }
        }
        if (givenCard) {
          for (let i = 0; i < 4; i++) {
            if (game.players[targetPlayerIdx].hand[i] === null) {
              game.players[targetPlayerIdx].hand[i] = givenCard;
              break;
            }
          }
        }
      }

      io.to(roomId).emit('pairingSuccess', {
        pairerName: game.players[pairingPlayerIdx].name,
        targetName: game.players[targetPlayerIdx].name,
        gameState: getPublicGameState(roomId)
      });

      nextTurn(roomId);
    } else {
      // 配對失敗
      handlePairingFailure(roomId, pairingPlayerIdx, targetPlayerIdx, handPosition, topCard);
    }
  });

  // 配對失敗處理
  function handlePairingFailure(roomId, pairingPlayerIdx, targetPlayerIdx, handPosition, topCard) {
    const game = gameState[roomId];

    // 收回兩張牌
    game.players[targetPlayerIdx].hand[handPosition] = null; // 暫時移除以檢查

    // 自動放置棄牌堆頂牌
    if (game.players[pairingPlayerIdx].hand.filter(c => c !== null).length < 4) {
      // 有空位，放到遠離玩家的那一列
      for (let i = 0; i < 2; i++) {
        if (game.players[pairingPlayerIdx].hand[i] === null) {
          game.players[pairingPlayerIdx].hand[i] = topCard;
          break;
        }
      }
    } else {
      // 滿了，放到遠列最右側（位置1）
      game.players[pairingPlayerIdx].hand[1] = topCard;
    }

    game.discard.pop();

    io.to(roomId).emit('pairingFailed', {
      pairerName: game.players[pairingPlayerIdx].name,
      gameState: getPublicGameState(roomId)
    });

    // 配對失敗後仍可繼續嘗試，不關閉配對時段
  }

  // 下一回合
  function nextTurn(roomId) {
    const game = gameState[roomId];

    // 檢查是否抽完牌
    if (game.deckIndex >= 52) {
      endGame(roomId);
      return;
    }

    // 檢查是否有人宣告CABO
    if (game.caboRoundsLeft > 0) {
      game.caboRoundsLeft--;
      if (game.caboRoundsLeft === 0) {
        endGame(roomId);
        return;
      }
    }

    game.currentPlayerIdx = (game.currentPlayerIdx + 1) % 4;
    game.roundCount++;

    io.to(roomId).emit('nextPlayerTurn', {
      playerName: game.players[game.currentPlayerIdx].name,
      gameState: getPublicGameState(roomId)
    });
  }

  // 宣告CABO
  socket.on('callCabo', () => {
    const roomId = socket.room;
    const game = gameState[roomId];
    if (!game) return;

    const playerIdx = game.players.findIndex(p => p.id === socket.id);
    game.players[playerIdx].caboCalled = true;
    game.caboRoundsLeft = 3;

    io.to(roomId).emit('caboCalled', {
      playerName: game.players[playerIdx].name,
      gameState: getPublicGameState(roomId)
    });
  });

  // 遊戲結束
  function endGame(roomId) {
    const game = gameState[roomId];
    game.gameEnded = true;

    // 計算分數
    game.players.forEach(player => {
      player.score = 0;
      player.hand.forEach(card => {
        if (card) player.score += getCardValue(card);
      });
    });

    const sorted = [...game.players].sort((a, b) => a.score - b.score);

    io.to(roomId).emit('gameEnded', {
      results: sorted.map(p => ({ name: p.name, score: p.score }))
    });
  }

  // 退串
  socket.on('leaveRoom', () => {
    const roomId = socket.room;
    if (rooms[roomId]) {
      delete rooms[roomId].players[socket.id];
      if (Object.keys(rooms[roomId].players).length === 0) {
        delete rooms[roomId];
        delete gameState[roomId];
      } else {
        io.to(roomId).emit('updatePlayers', Object.values(rooms[roomId].players).map(p => p.name));
      }
    }
    socket.leave(roomId);
    socket.room = null;
  });

  socket.on('disconnect', () => {
    const roomId = socket.room;
    if (roomId && rooms[roomId]) {
      delete rooms[roomId].players[socket.id];
      if (Object.keys(rooms[roomId].players).length === 0) {
        delete rooms[roomId];
        delete gameState[roomId];
      }
    }
  });
});

// 獲取公開遊戲狀態
function getPublicGameState(roomId) {
  const game = gameState[roomId];
  return {
    currentPlayerIdx: game.currentPlayerIdx,
    deckRemaining: 52 - game.deckIndex,
    discardTop: game.discard.length > 0 ? game.discard[game.discard.length - 1] : null,
    players: game.players.map(p => ({
      name: p.name,
      handCount: p.hand.filter(c => c !== null).length,
      score: p.score,
      caboCalled: p.caboCalled
    }))
  };
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));

