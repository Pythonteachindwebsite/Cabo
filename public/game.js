const socket = io();

let currentRoom = null;
let currentHand = [];
let knownCards = {};
let gameActive = false;

// DOM 元素
const joinMenu = document.getElementById('joinMenu');
const gameMenu = document.getElementById('gameMenu');
const gameBoard = document.getElementById('gameBoard');
const playerNameInput = document.getElementById('playerName');
const roomIdInput = document.getElementById('roomId');
const playersList = document.getElementById('playersList');
const gameLog = document.getElementById('gameLog');
const handDisplay = document.getElementById('handDisplay');
const gameInfo = document.getElementById('gameInfo');

function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(screenId).classList.add('active');
}

// 創建房間
document.getElementById('createRoomBtn').addEventListener('click', () => {
  const name = playerNameInput.value.trim();
  if (name) {
    socket.emit('createRoom', name);
  }
});

// 加入房間
document.getElementById('joinRoomBtn').addEventListener('click', () => {
  const name = playerNameInput.value.trim();
  const roomId = roomIdInput.value.trim();
  if (name && roomId) {
    socket.emit('joinRoom', { roomId, playerName: name });
  }
});

// 開始遊戲
document.getElementById('startGameBtn').addEventListener('click', () => {
  socket.emit('startGame');
});

// 退串
document.getElementById('leaveBtn').addEventListener('click', () => {
  socket.emit('leaveRoom');
  showScreen('joinMenu');
  playerNameInput.value = '';
  roomIdInput.value = '';
  currentRoom = null;
});

// 房間建立
socket.on('roomCreated', (roomId) => {
  currentRoom = roomId;
  roomIdInput.value = roomId;
  showScreen('gameMenu');
});

// 更新玩家列表
socket.on('updatePlayers', (players) => {
  playersList.innerHTML = '<h3>玩家列表</h3>';
  players.forEach(name => {
    playersList.innerHTML += `<p>${name}</p>`;
  });
  document.getElementById('startGameBtn').style.display = players.length === 4 ? 'block' : 'none';
});

// 遊戲開始
socket.on('gameStarted', (data) => {
  gameActive = true;
  showScreen('gameBoard');
  gameLog.innerHTML = '遊戲開始！<br>';
});

// 接收玩家自己的手牌
socket.on('yourHand', (data) => {
  currentHand = data.hand;
  knownCards = data.knownCards;
  renderHand();
});

// 渲染手牌
function renderHand() {
  handDisplay.innerHTML = '<h3>你的牌</h3><div class="hand-grid">';
  currentHand.forEach((card, idx) => {
    if (card) {
      handDisplay.innerHTML += `<div class="card-slot" onclick="selectCard(${idx})">
        ${knownCards[idx] ? `${knownCards[idx].value}${knownCards[idx].suit}` : '🂠'}
      </div>`;
    } else {
      handDisplay.innerHTML += `<div class="card-slot empty"></div>`;
    }
  });
  handDisplay.innerHTML += '</div>';
}

// 選擇牌進行操作
function selectCard(idx) {
  // 實裝配對邏輯
  socket.emit('attemptPairing', { targetPlayerIdx: 0, handPosition: idx });
}

// 卡牌被抽取
socket.on('cardDrawn', (data) => {
  gameLog.innerHTML += `<p>${data.playerName} 抽了一張牌</p>`;
});

// 選擇行動
socket.on('chooseAction', (data) => {
  // 玩家需要決定是交換還是棄牌
  const action = confirm(`抽到 ${data.drawnCard.value}${data.drawnCard.suit}，要交換嗎？`);
  socket.emit('chooseAction', {
    action: action ? 'exchange' : 'discard',
    drawnCard: data.drawnCard,
    handPosition: 0 // 簡化版，實際應讓玩家選擇
  });
});

// 配對成功
socket.on('pairingSuccess', (data) => {
  gameLog.innerHTML += `<p style="color: green;">${data.pairerName} 配對成功！</p>`;
  renderHand();
});

// 配對失敗
socket.on('pairingFailed', (data) => {
  gameLog.innerHTML += `<p style="color: red;">${data.pairerName} 配對失敗！</p>`;
  renderHand();
});

// 下一回合
socket.on('nextPlayerTurn', (data) => {
  gameLog.innerHTML += `<p style="font-weight: bold;">輪到 ${data.playerName}</p>`;
});

// CABO 宣言
socket.on('caboCalled', (data) => {
  gameLog.innerHTML += `<p style="color: red; font-weight: bold; font-size: 20px;">${data.playerName} 宣布 CABO!</p>`;
});

// 遊戲結束
socket.on('gameEnded', (data) => {
  gameActive = false;
  gameLog.innerHTML += '<h2 style="color: gold;">遊戲結束！</h2>';
  data.results.forEach(r => {
    gameLog.innerHTML += `<p>${r.name}: ${r.score} 分</p>`;
  });
  document.getElementById('leaveBtn').style.display = 'block';
});

// 錯誤處理
socket.on('error', (msg) => {
  alert(msg);
});

