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

// 遊戲狀態管理
const rooms = {};
const playerSockets = {};

// 卡片初始化
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

// 計算卡片分數
function getCardScore(card) {
  if (card.rank === 'A') return 1;
  if (card.rank === 'J') return 11;
  if (card.rank === 'Q') return 12;
  if (card.rank === 'K') {
    return (card.suit === '♥' || card.suit === '♦') ? -1 : 13;
  }
  return parseInt(card.rank) || 0;
}

// 初始化遊戲
function initializeGame(roomCode, players) {
  const deck = createDeck();
  const gameState = {
    roomCode,
    players: players.map((p, idx) => ({
      id: p.id,
      name: p.name,
      hand: [],
      visible: [true, true, false, false],
      scores: [0, 0, 0, 0],
      caboCalled: false
    })),
    deck,
    discard: deck.pop(),
    currentPlayerIndex: 0,
    round: 1,
    phase: 'draw',
    drawnCard: null,
    gameOver: false
  };

  // 給每位玩家發4張牌
  for (let i = 0; i < 4; i++) {
    for (let p = 0; p < gameState.players.length; p++) {
      gameState.players[p].hand.push({ card: gameState.deck.pop(), faceUp: gameState.players[p].visible[i] });
    }
  }

  return gameState;
}

// 創建房間
io.on('connection', (socket) => {
  socket.on('createRoom', (data) => {
    const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    
    rooms[roomCode] = {
      code: roomCode,
      players: [{ id: socket.id, name: data.playerName, connected: true }],
      gameStarted: false,
      gameState: null
    };

    playerSockets[socket.id] = { roomCode, playerIndex: 0 };
    socket.join(roomCode);

    socket.emit('roomCreated', { roomCode, playerIndex: 0 });
    io.to(roomCode).emit('playerListUpdated', rooms[roomCode].players);
  });

  socket.on('joinRoom', (data) => {
    const room = rooms[data.roomCode];
    
    if (!room) {
      socket.emit('error', '房間不存在');
      return;
    }

    if (room.gameStarted) {
      socket.emit('error', '遊戲已開始');
      return;
    }

    if (room.players.length >= 4) {
      socket.emit('error', '房間已滿');
      return;
    }

    const playerIndex = room.players.length;
    room.players.push({ id: socket.id, name: data.playerName, connected: true });
    playerSockets[socket.id] = { roomCode: data.roomCode, playerIndex };

    socket.join(data.roomCode);
    socket.emit('roomJoined', { roomCode: data.roomCode, playerIndex });
    io.to(data.roomCode).emit('playerListUpdated', room.players);

    // 檢查是否可以開始（2人以上）
    if (room.players.length >= 2) {
      io.to(data.roomCode).emit('readyToStart', { playerCount: room.players.length });
    }
  });

  socket.on('startGame', () => {
    const playerData = playerSockets[socket.id];
    if (!playerData) return;

    const room = rooms[playerData.roomCode];
    if (!room || room.players.length < 2) {
      socket.emit('error', '玩家不足');
      return;
    }

    room.gameStarted = true;
    room.gameState = initializeGame(playerData.roomCode, room.players);
    
    io.to(playerData.roomCode).emit('gameStarted', { initialGameState: room.gameState });
  });

  socket.on('drawCard', () => {
    const playerData = playerSockets[socket.id];
    if (!playerData) return;

    const room = rooms[playerData.roomCode];
    const gameState = room.gameState;

    if (gameState.currentPlayerIndex !== playerData.playerIndex || gameState.phase !== 'draw') return;

    gameState.drawnCard = gameState.deck.pop();
    gameState.phase = 'exchange';

    io.to(playerData.roomCode).emit('drawnCard', { card: gameState.drawnCard });
    io.to(playerData.roomCode).emit('gameUpdated', { gameState });
  });

  socket.on('swapDrawnCard', (data) => {
    const playerData = playerSockets[socket.id];
    if (!playerData) return;

    const room = rooms[playerData.roomCode];
    const gameState = room.gameState;
    const player = gameState.players[playerData.playerIndex];

    const handIndex = data.handIndex;
    const discardedCard = player.hand[handIndex].card;

    player.hand[handIndex] = { card: gameState.drawnCard, faceUp: false };
    gameState.discard = discardedCard;
    gameState.drawnCard = null;
    gameState.phase = 'pairing';

    io.to(playerData.roomCode).emit('gameUpdated', { gameState });
  });

  socket.on('discardDrawnCard', () => {
    const playerData = playerSockets[socket.id];
    if (!playerData) return;

    const room = rooms[playerData.roomCode];
    const gameState = room.gameState;

    gameState.discard = gameState.drawnCard;
    gameState.drawnCard = null;
    gameState.phase = 'specialAbility';

    io.to(playerData.roomCode).emit('gameUpdated', { gameState });
  });

  socket.on('useSpecialAbility', (data) => {
    const playerData = playerSockets[socket.id];
    if (!playerData) return;

    const room = rooms[playerData.roomCode];
    const gameState = room.gameState;
    const player = gameState.players[playerData.playerIndex];
    const abilityRank = gameState.discard.rank;

    if (['7', '8'].includes(abilityRank)) {
      // 看自己的牌
      const cardIndex = data.targetSlot;
      socket.emit('viewCard', { card: player.hand[cardIndex].card });
    } else if (['9', '10'].includes(abilityRank)) {
      // 看對手的牌
      const targetPlayer = gameState.players[data.targetPlayer];
      const cardIndex = data.targetSlot;
      socket.emit('viewCard', { card: targetPlayer.hand[cardIndex].card });
    } else if (['J', 'Q'].includes(abilityRank)) {
      // 盲目交換
      const targetPlayer = gameState.players[data.targetPlayer];
      const myCard = player.hand[data.mySlot].card;
      const theirCard = targetPlayer.hand[data.targetSlot].card;

      player.hand[data.mySlot] = { card: theirCard, faceUp: false };
      targetPlayer.hand[data.targetSlot] = { card: myCard, faceUp: false };
    } else if (['K', 'A'].includes(abilityRank)) {
      // 看對手的牌後決定交換
      const targetPlayer = gameState.players[data.targetPlayer];
      const cardIndex = data.targetSlot;

      socket.emit('viewCard', { card: targetPlayer.hand[cardIndex].card });

      if (data.shouldSwap) {
        const myCard = player.hand[data.mySlot].card;
        const theirCard = targetPlayer.hand[cardIndex].card;

        player.hand[data.mySlot] = { card: theirCard, faceUp: false };
        targetPlayer.hand[cardIndex] = { card: myCard, faceUp: false };
      }
    }

    gameState.phase = 'pairing';
    io.to(playerData.roomCode).emit('gameUpdated', { gameState });
  });

  socket.on('pairingCheck', (data) => {
    const playerData = playerSockets[socket.id];
    if (!playerData) return;

    const room = rooms[playerData.roomCode];
    const gameState = room.gameState;
    const player = gameState.players[playerData.playerIndex];

    const cardRank = player.hand[data.handIndex].card.rank;
    const discardRank = gameState.discard.rank;

    if (cardRank === discardRank) {
      player.hand[data.handIndex] = { card: null, faceUp: false };
      io.to(playerData.roomCode).emit('pairingSuccess', { playerIndex: playerData.playerIndex });
    }

    io.to(playerData.roomCode).emit('gameUpdated', { gameState });
  });

  socket.on('callCabo', () => {
    const playerData = playerSockets[socket.id];
    if (!playerData) return;

    const room = rooms[playerData.roomCode];
    const gameState = room.gameState;

    gameState.players[playerData.playerIndex].caboCalled = true;
    endRound(gameState, playerData.roomCode);
  });

  socket.on('endTurn', () => {
    const playerData = playerSockets[socket.id];
    if (!playerData) return;

    const room = rooms[playerData.roomCode];
    const gameState = room.gameState;

    gameState.currentPlayerIndex = (gameState.currentPlayerIndex + 1) % gameState.players.length;
    gameState.phase = 'draw';

    io.to(playerData.roomCode).emit('gameUpdated', { gameState });
  });

  socket.on('disconnect', () => {
    const playerData = playerSockets[socket.id];
    if (playerData) {
      const room = rooms[playerData.roomCode];
      if (room) {
        const player = room.players.find(p => p.id === socket.id);
        if (player) player.connected = false;
        io.to(playerData.roomCode).emit('playerListUpdated', room.players);
      }
      delete playerSockets[socket.id];
    }
  });
});

function endRound(gameState, roomCode) {
  // 計算分數
  gameState.players.forEach(player => {
    let roundScore = 0;
    player.hand.forEach(h => {
      if (h.card) roundScore += getCardScore(h.card);
    });
    player.scores[gameState.round - 1] = roundScore;
  });

  gameState.round++;

  if (gameState.round > 3) {
    const finalScores = gameState.players.map(p => p.scores.reduce((a, b) => a + b, 0));
    const winner = finalScores.indexOf(Math.min(...finalScores));
    gameState.gameOver = true;
    io.to(roomCode).emit('gameFinished', { finalScores, winner });
  } else {
    gameState.deck = createDeck();
    gameState.discard = gameState.deck.pop();
    gameState.currentPlayerIndex = 0;
    gameState.phase = 'draw';
    gameState.players.forEach(p => {
      p.hand = [];
      p.visible = [true, true, false, false];
      p.caboCalled = false;
    });

    // 重新發牌
    for (let i = 0; i < 4; i++) {
      for (let p = 0; p < gameState.players.length; p++) {
        gameState.players[p].hand.push({ card: gameState.deck.pop(), faceUp: gameState.players[p].visible[i] });
      }
    }

    io.to(roomCode).emit('roundStarted', { gameState });
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`CABO 遊戲服務器運行在 ${PORT}`));

