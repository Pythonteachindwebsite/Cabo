const socket = io(window.location.origin);


const mainMenu = document.getElementById('mainMenu');
const joinMenu = document.getElementById('joinMenu');
const waitingRoom = document.getElementById('waitingRoom');
const gameScreen = document.getElementById('gameScreen');

const playerNameInput = document.getElementById('playerName');
const createBtn = document.getElementById('createBtn');
const joinBtn = document.getElementById('joinBtn');
const confirmJoinBtn = document.getElementById('confirmJoinBtn');
const backBtn = document.getElementById('backBtn');
const startBtn = document.getElementById('startBtn');
const exitBtn = document.getElementById('exitBtn');
const roomIdInput = document.getElementById('roomIdInput');

const roomCode = document.getElementById('roomCode');
const playersList = document.getElementById('playersList');
const playerCount = document.getElementById('playerCount');

let currentRoomId = null;

// 切換畫面
function showScreen(screen) {
  mainMenu.classList.remove('active');
  joinMenu.classList.remove('active');
  waitingRoom.classList.remove('active');
  gameScreen.classList.remove('active');
  screen.classList.add('active');
}

// 建立房間
createBtn.addEventListener('click', () => {
  const name = playerNameInput.value.trim();
  if (!name) {
    alert('請輸入名字');
    return;
  }
  socket.emit('createRoom', name, (response) => {
    if (response.success) {
      currentRoomId = response.roomId;
      roomCode.textContent = response.roomId;
      playersList.innerHTML = `<li>✓ ${name}</li>`;
      playerCount.textContent = '1';
      showScreen(waitingRoom);
    }
  });
});

// 加入房間
joinBtn.addEventListener('click', () => {
  const name = playerNameInput.value.trim();
  if (!name) {
    alert('請輸入名字');
    return;
  }
  showScreen(joinMenu);
});

confirmJoinBtn.addEventListener('click', () => {
  const roomId = roomIdInput.value.trim().toUpperCase();
  const name = playerNameInput.value.trim();
  if (!roomId) {
    alert('請輸入房間代碼');
    return;
  }
  socket.emit('joinRoom', roomId, name, (response) => {
    if (response.success) {
      currentRoomId = response.roomId;
      roomCode.textContent = response.roomId;
      updatePlayersList(response.players);
      showScreen(waitingRoom);
    } else {
      alert(response.message);
    }
  });
});

// 更新玩家列表
function updatePlayersList(players) {
  playersList.innerHTML = '';
  players.forEach(player => {
    const li = document.createElement('li');
    li.textContent = `✓ ${player.name}`;
    playersList.appendChild(li);
  });
  playerCount.textContent = players.length;
}

// 接收玩家加入通知
socket.on('playerJoined', (players) => {
  updatePlayersList(players);
});

// 接收玩家離開通知
socket.on('playerJoined', (data) => {
    players = data.players;
    updatePlayerList();
    
    // 只有 4 個人都加入了，才能按開始
    const startButton = document.getElementById('startGameBtn');
    if (startButton) {
        if (players.length === 4) {
            startButton.disabled = false;
            startButton.style.opacity = '1';
        } else {
            startButton.disabled = true;
            startButton.style.opacity = '0.5';
        }
    }
});


// 開始遊戲
startBtn.addEventListener('click', () => {
  socket.emit('startGame', (response) => {
    if (response.success) {
      showScreen(gameScreen);
    }
  });
});

// 接收遊戲開始
socket.on('gameStarted', (players) => {
  showScreen(gameScreen);
});

// 返回 & 退出
backBtn.addEventListener('click', () => {
  roomIdInput.value = '';
  showScreen(mainMenu);
});

exitBtn.addEventListener('click', () => {
  socket.disconnect();
  playerNameInput.value = '';
  roomIdInput.value = '';
  currentRoomId = null;
  showScreen(mainMenu);
  socket.connect();
});
// 退串按鈕
const leaveBtn = document.getElementById('leaveBtn');
if (leaveBtn) {
  leaveBtn.addEventListener('click', () => {
    socket.emit('leaveRoom');
    showScreen('joinMenu');
    playerNameInput.value = '';
    roomIdInput.value = '';
    currentRoomId = null;
  });
}

