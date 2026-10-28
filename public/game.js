const socket = io();
let playerName = '';
let roomCode = '';
let gameData = null;
let isCurrentPlayer = false;
let myHand = [];
let myVisible = [];
let myPaired = [];

// Main Menu
document.getElementById('createBtn').addEventListener('click', createRoom);
document.getElementById('joinBtn').addEventListener('click', showJoinMenu);
document.getElementById('joinRoomBtn').addEventListener('click', joinRoom);
document.getElementById('backBtn').addEventListener('click', backToMenu);
document.getElementById('startBtn').addEventListener('click', startGame);
document.getElementById('leaveLobbyBtn').addEventListener('click', leaveLobby);
document.getElementById('callCaboBtn').addEventListener('click', callCabo);

function createRoom() {
  playerName = document.getElementById('playerName').value.trim();
  if (!playerName) {
    alert('請輸入名字');
    return;
  }
  socket.emit('createRoom', playerName, (data) => {
    roomCode = data.roomCode;
    showLobby();
  });
}

function showJoinMenu() {
  playerName = document.getElementById('playerName').value.trim();
  if (!playerName) {
    alert('請輸入名字');
    return;
  }
  document.getElementById('mainMenu').classList.add('hidden');
  document.getElementById('joinMenu').classList.remove('hidden');
}

function joinRoom() {
  roomCode = document.getElementById('roomCode').value.trim().toUpperCase();
  if (!roomCode) {
    alert('請輸入房間代碼');
    return;
  }
  socket.emit('joinRoom', roomCode, playerName, (data) => {
    if (data.error) {
      alert(data.error);
      return;
    }
    roomCode = data.roomCode;
    showLobby();
  });
}

function backToMenu() {
  document.getElementById('joinMenu').classList.add('hidden');
  document.getElementById('mainMenu').classList.remove('hidden');
}

function showLobby() {
  document.getElementById('mainMenu').classList.add('hidden');
  document.getElementById('joinMenu').classList.add('hidden');
  document.getElementById('lobby').classList.remove('hidden');
  document.getElementById('roomDisplay').textContent = roomCode;
}

function leaveLobby() {
  socket.disconnect();
  location.reload();
}

function startGame() {
  socket.emit('startGame');
}

function callCabo() {
  socket.emit('callCabo');
}

// Socket Events

socket.on('playerUpdate', (players) => {
  const list = document.getElementById('playerList');
  list.innerHTML = players.map(p => 
    `<div class="player-item">👤 ${p.name}</div>`
  ).join('');

  document.getElementById('startBtn').disabled = players.length < 2;
});

socket.on('gameStart', (data) => {
  gameData = data.find(p => p.id === socket.id);
  
  if (myPlayer) {
    myHand = myPlayer.hand;
    myVisible = myPlayer.visible;
    myPaired = myPlayer.paired;
  }

  document.getElementById('lobby').classList.add('hidden');
  document.getElementById('gameScreen').classList.remove('hidden');
  document.getElementById('gameRoomCode').textContent = roomCode;

  renderGame();
});

socket.on('flipAllDown', () => {
  if (gameData) {
    gameData.players.forEach(p => p.visible = [false, false, false, false]);
    renderGame();
  }
});

socket.on('cardDrawn', (data) => {
  gameData.drawn = data.drawn;
  renderGame();
});

socket.on('cardSwapped', (data) => {
  const p = gameData.players.find(x => x.id === data.playerId);
  if (p) {
    p.visible[data.pos] = false;
    p.paired = checkLocalPairing(p);
  }
  gameData.drawn = null;
  renderGame();
});

socket.on('cardDiscarded', (data) => {
  gameData.discard.push(data.card);
  gameData.drawn = null;
  renderGame();
});

socket.on('nextTurn', (data) => {
  gameData.currentIdx = gameData.players.findIndex(p => p.id === data.playerId);
  isCurrentPlayer = data.playerId === socket.id;
  renderGame();
});

socket.on('caboCalled', (data) => {
  alert(`${data.playerName} 呼叫了CABO！`);
});

function checkLocalPairing(player) {
  const discardTop = gameData.discard[gameData.discard.length - 1];
  const paired = [...player.paired];
  
  for (let i = 0; i < player.hand.length; i++) {
    if (!paired[i] && player.hand[i]) {
      const handCard = player.hand[i];
      if (handCard.rank === discardTop.rank && handCard.suit === discardTop.suit) {
        paired[i] = true;
      }
    }
  }
  return paired;
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

function renderGame() {
  if (!gameData) return;

  const myPlayer = gameData.players.find(p => p.id === socket.id);
  if (!myPlayer) return;

  // Update current player
  const current = gameData.players[gameData.currentIdx];
  document.getElementById('currentPlayerName').textContent = current.name;
  document.getElementById('roundNum').textContent = gameData.round;

  // Render my hand
  const handDiv = document.getElementById('myHand');
  handDiv.innerHTML = myPlayer.hand.map((card, i) => {
    const cardClass = myPlayer.paired[i] ? 'paired' : (myPlayer.visible[i] ? '' : 'faceDown');
    const cardText = myPlayer.visible[i] ? `${card.rank}${card.suit}` : '?';
    return `<div class="card ${cardClass}" onclick="selectCard(${i})">${cardText}</div>`;
  }).join('');

  // Render discard area
  const discardTop = gameData.discard[gameData.discard.length - 1];
  document.getElementById('discardCard').textContent = `${discardTop.rank}${discardTop.suit}`;

  // Render drawn card
  if (gameData.drawn) {
    document.getElementById('drawnCardArea').classList.remove('hidden');
    document.getElementById('drawnCard').textContent = `${gameData.drawn.rank}${gameData.drawn.suit}`;
  } else {
    document.getElementById('drawnCardArea').classList.add('hidden');
  }

  // Render actions
  const actions = document.getElementById('gameActions');
  isCurrentPlayer = current.id === socket.id;

  if (isCurrentPlayer) {
    if (gameData.drawn) {
      actions.innerHTML = `
        <button onclick="swapCard()">交換卡牌</button>
        <button onclick="discardCard()">棄掉卡牌</button>
      `;
    } else {
      actions.innerHTML = '<button onclick="drawCard()">抽卡</button>';
    }
    
    // Show CABO button if eligible
    const handValue = getHandValue(myPlayer.hand);
    if (handValue <= 16 && !myPlayer.caboCalled) {
      document.getElementById('callCaboBtn').classList.remove('hidden');
    } else {
      document.getElementById('callCaboBtn').classList.add('hidden');
    }
  } else {
    actions.innerHTML = `<p style="color: #999;">等待 ${current.name} 出牌中...</p>`;
    document.getElementById('callCaboBtn').classList.add('hidden');
  }
}

let selectedPos = null;

function selectCard(pos) {
  selectedPos = pos;
}

function drawCard() {
  socket.emit('draw');
}

function swapCard() {
  if (selectedPos === null) {
    alert('請先選擇要交換的位置');
    return;
  }
  socket.emit('swap', selectedPos);
  selectedPos = null;
}

function discardCard() {
  socket.emit('discard');
}

