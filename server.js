const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: { origin: "*" }
});

app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

// 遊戲狀態
const games = {};

// 牌組初始化
function initializeDeck() {
  const suits = ['♠', '♥', '♦', '♣'];
  const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const deck = [];
  
  for (let suit of suits) {
    for (let rank of ranks) {
      deck.push({ suit, rank });
    }
  }
  
  // 洗牌
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  
  return deck;
}

// 計算牌的分數
function getCardValue(card) {
  if (card.rank === 'K' && card.suit === '♥') return -1; // 紅K是-1
  if (card.rank === 'K') return 10;
  if (card.rank === 'Q') return 10;
  if (card.rank === 'J') return 10;
  if (card.rank === 'A') return 1;
  return parseInt(card.rank) || 10;
}

// 建立新遊戲
function createGame(gameId) {
  return {
    id: gameId,
    players: [],
    deck: [],
    discardPile: [],
    currentPlayerIndex: 0,
    gameStarted: false,
    round: 0,
    scores: {}
  };
}

io.on('connection', (socket) => {
  console.log('新玩家連接:', socket.id);

  // 建立或加入遊戲房間
  socket.on('joinGame', (data) => {
    const { gameId, playerName } = data;
    
    if (!games[gameId]) {
      games[gameId] = createGame(gameId);
    }
    
    const game = games[gameId];
    
    if (game.players.length < 4) {
      const player = {
        id: socket.id,
        name: playerName,
        hand: [],
        revealed: [],
        peeked: {},
        cabo: false
      };
      
      game.players.push(player);
      game.scores[socket.id] = 0;
      
      socket.join(gameId);
      socket.gameId = gameId;
      socket.playerId = socket.id;
      
      // 通知所有玩家
      io.to(gameId).emit('playerJoined', {
        players: game.players.map(p => ({ id: p.id, name: p.name })),
        message: `${playerName} 加入了遊戲`
      });
      
      // 如果有4個玩家，開始遊戲
      if (game.players.length === 4) {
        startGame(gameId);
      }
    } else {
      socket.emit('error', '房間已滿');
    }
  });

  // 開始遊戲
  function startGame(gameId) {
    const game = games[gameId];
    game.gameStarted = true;
    game.round++;
    game.deck = initializeDeck();
    game.discardPile = [];
    
    // 每個玩家發4張牌
    for (let player of game.players) {
      player.hand = [];
      player.revealed = [null, null, null, null];
      player.peeked = {};
      player.cabo = false;
      
      for (let i = 0; i < 4; i++) {
        player.hand.push(game.deck.pop());
      }
    }
    
    // 棄牌堆放一張牌
    game.discardPile.push(game.deck.pop());
    
    io.to(gameId).emit('gameStarted', {
      players: game.players.map((p, idx) => ({
        id: p.id,
        name: p.name,
        handCount: p.hand.length
      })),
      currentPlayer: game.players[game.currentPlayerIndex].name
    });
    
    // 通知每個玩家他們的牌
    for (let player of game.players) {
      io.to(player.id).emit('updateHand', {
        hand: player.hand,
        revealed: player.revealed
      });
    }
  }

  // 玩家出牌
  socket.on('playCard', (data) => {
    const game = games[socket.gameId];
    if (!game || game.players[game.currentPlayerIndex].id !== socket.id) {
      return;
    }
    
    const player = game.players[game.currentPlayerIndex];
    const { cardIndex, position } = data;
    
    if (position !== null) {
      // 放到特定位置
      player.revealed[position] = player.hand[cardIndex];
    }
    
    const playedCard = player.hand.splice(cardIndex, 1)[0];
    game.discardPile.push(playedCard);
    
    // 抽牌
    if (game.deck.length > 0) {
      player.hand.push(game.deck.pop());
    }
    
    // 下一個玩家
    game.currentPlayerIndex = (game.currentPlayerIndex + 1) % 4;
    
    io.to(socket.gameId).emit('gameUpdate', {
      currentPlayer: game.players[game.currentPlayerIndex].name,
      discardPile: game.discardPile[game.discardPile.length - 1],
      players: game.players.map((p, idx) => ({
        id: p.id,
        name: p.name,
        handCount: p.hand.length,
        revealed: p.revealed
      }))
    });
  });

  // 玩家宣佈 CABO
  socket.on('declareCabo', () => {
    const game = games[socket.gameId];
    if (!game) return;
    
    const player = game.players.find(p => p.id === socket.id);
    if (player) {
      player.cabo = true;
      io.to(socket.gameId).emit('caboDeclared', {
        playerName: player.name
      });
    }
  });

  // 斷開連接
  socket.on('disconnect', () => {
    console.log('玩家斷開連接:', socket.id);
    const game = games[socket.gameId];
    if (game) {
      game.players = game.players.filter(p => p.id !== socket.id);
      if (game.players.length === 0) {
        delete games[socket.gameId];
      } else {
        io.to(socket.gameId).emit('playerLeft', {
          players: game.players.map(p => ({ id: p.id, name: p.name }))
        });
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Cabo 遊戲伺服器運行在 http://localhost:${PORT}`);
});
