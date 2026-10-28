const socket = io();

let currentRoom = null;
let currentPlayerName = null;
let playerIndex = null;
let gameState = null;
let drawnCard = null;

function createRoom() {
  const name = document.getElementById('playerName').value.trim();
  if (!name) {
    alert('請輸入名字');
    return;
  }

  currentPlayerName = name;
  socket.emit('createRoom', name);
}

function showJoinRoom() {
  document.getElementById('mainMenu').classList.add('hidden');
  document.getElementById('joinRoomMenu').classList.remove('hidden');
}

function joinRoom() {
  const roomCode = document.getElementById('roomCode').value.trim().toUpperCase();
  const name = document.getElementById('playerNameJoin').value.trim();

  if (!roomCode || !name) {
    alert('請輸入房間代碼和名字');
    return;
  }

  currentPlayerName = name;
  socket.emit('joinRoom', roomCode, name);
}

function backToMenu() {
  document.getElementById('joinRoomMenu').classList.add('hidden');
  document.getElementById('mainMenu').classList.remove('hidden');
}

function startGame() {
  socket.emit('startGame');
}

function leaveRoom() {
  socket.emit('leaveRoom');
  setTimeout(() => location.reload(), 500);
}

function drawFromDeck() {
  socket.emit('drawCard');
}

function discardCard() {
  socket.emit('discardDrawnCard');
}

function selectCardToReplace(index) {
  if (drawnCard) {
    socket.emit('replaceCard', index);
  }
}

function viewOwnCard(index) {
  socket.emit('viewOwnCard', index);
}

function endTurn() {
  socket.emit('endTurn');
}

// Socket 事件監聽
socket.on('roomCreated', (roomCode) => {
  currentRoom = roomCode;
  document.getElementById('mainMenu').classList.add('hidden');
  document.getElementById('joinRoomMenu').classList.add('hidden');
  document.getElementById('waitingRoom').classList.remove('hidden');
  document.getElementById('roomCodeDisplay').textContent = roomCode;
});

socket.on('playerJoined', (players) => {
  const list = document.getElementById('playerList');
  list.innerHTML = '<h3>玩家列表:</h3>';
  players.forEach(p => {
    list.innerHTML += `<div>• ${p.name}</div>`;
  });

  const startBtn = document.getElementById('startButton');
  startBtn.disabled = players.length < 2;
});

socket.on('gameStarted', (data) => {
  gameState = data;
  
  // 確定玩家索引
  for (let i = 0; i < data.players.length; i++) {
    if (data.players[i].name === currentPlayerName) {
      playerIndex = i;
      break;
    }
  }

  document.getElementById('waitingRoom').classList.add('hidden');
  document.getElementById('gameScreen').classList.remove('hidden');
  renderGame();
});

socket.on('drawnCard', (card) => {
  drawnCard = card;
  alert(`你抽到: ${card.rank}${card.suit}\n選擇要替換的牌或丟掉這張牌`);
  renderGame();
});

socket.on('gameUpdate', (data) => {
  if (data.playerCards) gameState.playerCards = data.playerCards;
  if (data.discardPile) gameState.discardPile = data.discardPile;
  if (data.deckCount !== undefined) gameState.deckCount = data.deckCount;
  if (data.message) console.log(data.message);
  renderGame();
});

socket.on('turnChanged', (data) => {
  gameState.currentPlayerIndex = data.currentPlayerIndex;
  renderGame();
});

socket.on('cardViewed', (data) => {
  alert(`牌張: ${data.card.rank}${data.card.suit}`);
});

socket.on('swapDecision', (data) => {
  const yes = confirm(`${data.player} 的牌是: ${data.card.rank}${data.card.suit}\n要交換嗎?`);
  socket.emit('confirmSwap', yes);
});

socket.on('playerLeft', (players) => {
  alert('有玩家離開了房間');
});

socket.on('error', (msg) => {
  alert('錯誤: ' + msg);
});

function renderGame() {
  if (!gameState) return;

  document.getElementById('roundNumber').textContent = gameState.currentRound;
  document.getElementById('currentPlayer').textContent = gameState.players[gameState.currentPlayerIndex].name;

  if (gameState.discardPile.length > 0) {
    const top = gameState.discardPile[gameState.discardPile.length - 1];
    document.getElementById('discardTop').textContent = `${top.rank}${top.suit}`;
  }

  document.getElementById('deckCount').textContent = gameState.deckCount || 0;

  const isMyTurn = gameState.currentPlayerIndex === playerIndex;
  document.getElementById('drawButton').disabled = !isMyTurn || !!drawnCard;
  document.getElementById('discardButton').disabled = !drawnCard;

  const cardGrid = document.getElementById('cardGrid');
  cardGrid.innerHTML = '';

  if (gameState.playerCards[playerIndex]) {
    gameState.playerCards[playerIndex].forEach((card, index) => {
      const div = document.createElement('div');
      div.className = 'card';
      
      if (card) {
        div.textContent = `${card.rank}${card.suit}`;
        div.onclick = () => {
          if (drawnCard) {
            selectCardToReplace(index);
          }
        };
      } else {
        div.textContent = '∅';
      }
      
      cardGrid.appendChild(div);
    });
  }

  const endBtn = document.getElementById('endTurnButton');
  endBtn.disabled = isMyTurn;
}

