const socket = io();

let currentRoom = null;
let currentPlayerName = null;
let playerIndex = null;
let myCards = [];
let drawnCard = null;
let gameState = null;

function createRoom() {
  const name = document.getElementById('playerName').value.trim();
  if (!name) {
    alert('請輸入名字');
    return;
  }
  
  currentPlayerName = name;
  socket.emit('createRoom', name, (roomCode) => {
    currentRoom = roomCode;
    showWaitingRoom();
  });
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

function showWaitingRoom() {
  document.getElementById('mainMenu').classList.add('hidden');
  document.getElementById('joinRoomMenu').classList.add('hidden');
  document.getElementById('waitingRoom').classList.remove('hidden');
  document.getElementById('roomCodeDisplay').textContent = currentRoom;
}

function startGame() {
  socket.emit('startGame');
}

function leaveRoom() {
  socket.emit('leaveRoom');
  location.reload();
}

function drawFromDeck() {
  socket.emit('drawCard', (card) => {
    drawnCard = card;
    showCardReplacement();
  });
}

function drawFromDiscard() {
  // 需要從棄牌堆顯示卡牌
  alert('從棄牌堆抽牌');
}

function showCardReplacement() {
  if (drawnCard) {
    alert(`你抽到: ${drawnCard.rank}${drawnCard.suit}\n選擇要替換的牌或棄掉這張牌`);
  }
}

function endTurn() {
  socket.emit('endTurn');
}

socket.on('roomCreated', (roomCode) => {
  currentRoom = roomCode;
  showWaitingRoom();
});

socket.on('playerJoined', (players) => {
  const list = document.getElementById('playerList');
  list.innerHTML = '<h3>玩家列表:</h3>';
  players.forEach(p => {
    list.innerHTML += `<div>${p.name} ${p.ready ? '(已準備)' : ''}</div>`;
  });
  
  const startBtn = document.getElementById('startButton');
  startBtn.disabled = players.length < 2;
});

socket.on('gameStarted', (gameData) => {
  document.getElementById('waitingRoom').classList.add('hidden');
  document.getElementById('gameScreen').classList.remove('hidden');
  
  gameState = gameData;
  myCards = gameState.playerCards[playerIndex] || [];
  renderGame();
});

socket.on('gameUpdate', (data) => {
  if (data.playerCards) gameState.playerCards = data.playerCards;
  if (data.discardPile) gameState.discardPile = data.discardPile;
  if (data.pairedCards) gameState.pairedCards = data.pairedCards;
  renderGame();
});

socket.on('turnChanged', (newPlayerIndex) => {
  gameState.currentPlayerIndex = newPlayerIndex;
  renderGame();
});

socket.on('playerLeft', (players) => {
  alert('有玩家離開了房間');
  if (players.length === 0) {
    location.reload();
  }
});

socket.on('error', (message) => {
  alert('錯誤: ' + message);
});

socket.on('viewCard', (data) => {
  alert(`牌張: ${data.card.rank}${data.card.suit}`);
});

function renderGame() {
  if (!gameState) return;
  
  document.getElementById('roundNumber').textContent = gameState.currentRound;
  document.getElementById('currentPlayer').textContent = gameState.players[gameState.currentPlayerIndex].name;
  
  if (gameState.discardPile.length > 0) {
    const topCard = gameState.discardPile[gameState.discardPile.length - 1];
    document.getElementById('discardTop').textContent = `${topCard.rank}${topCard.suit}`;
  }
  
  const cardGrid = document.getElementById('cardGrid');
  cardGrid.innerHTML = '';
  if (myCards) {
    myCards.forEach((card, index) => {
      const cardDiv = document.createElement('div');
      cardDiv.className = 'card';
      cardDiv.textContent = card ? `${card.rank}${card.suit}` : '?';
      cardDiv.onclick = () => selectCard(index);
      cardGrid.appendChild(cardDiv);
    });
  }
}

function selectCard(index) {
  console.log('選擇了第' + (index + 1) + '張牌');
}

