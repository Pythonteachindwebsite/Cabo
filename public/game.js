const socket = io();

let currentPage = 'roomSelect';
let currentRoomId = null;
let playerName = null;
let isRoomCreator = false;

// ===== 頁面切換函數 =====
function showPage(pageName) {
    document.querySelectorAll('.page').forEach(page => {
        page.classList.add('hidden');
    });
    document.getElementById(pageName + 'Page').classList.remove('hidden');
    currentPage = pageName;
}

// ===== 房間選擇按鈕 =====
document.getElementById('createRoomBtn').addEventListener('click', () => {
    playerName = prompt('請輸入你的名字:');
    if (playerName && playerName.trim()) {
        socket.emit('createRoom', { playerName: playerName.trim() });
    }
});

document.getElementById('joinRoomBtn').addEventListener('click', () => {
    showPage('joinRoom');
});

// ===== 加入房間 =====
document.getElementById('joinConfirmBtn').addEventListener('click', () => {
    const roomId = document.getElementById('roomIdInput').value.trim();
    const name = document.getElementById('playerNameInput').value.trim();

    if (!roomId) {
        alert('請輸入房間ID');
        return;
    }
    if (!name) {
        alert('請輸入你的名字');
        return;
    }

    playerName = name;
    socket.emit('joinRoom', { roomId, playerName });
});

// ===== 返回按鈕 =====
document.getElementById('backBtn1').addEventListener('click', () => {
    showPage('roomSelect');
    document.getElementById('roomIdInput').value = '';
    document.getElementById('playerNameInput').value = '';
});

document.getElementById('backBtn2').addEventListener('click', () => {
    socket.emit('leaveRoom');
    showPage('roomSelect');
});

// ===== 複製房間ID =====
document.getElementById('copyRoomIdBtn').addEventListener('click', () => {
    const roomId = document.getElementById('displayRoomId').textContent;
    navigator.clipboard.writeText(roomId).then(() => {
        alert('房間ID已複製！');
    });
});

// ===== 開始遊戲按鈕 =====
document.getElementById('startGameBtn').addEventListener('click', () => {
    if (isRoomCreator) {
        socket.emit('startGame', { roomId: currentRoomId });
    }
});

// ===== Socket.IO 事件監聽 =====

// 房間建立成功
socket.on('roomCreated', (data) => {
    currentRoomId = data.roomId;
    isRoomCreator = true;
    showPage('waiting');
    document.getElementById('displayRoomId').textContent = data.roomId;
    updatePlayersList(data.players);
});

// 加入房間成功
socket.on('joinedRoom', (data) => {
    currentRoomId = data.roomId;
    isRoomCreator = false;
    showPage('waiting');
    document.getElementById('displayRoomId').textContent = data.roomId;
    updatePlayersList(data.players);
});

// 玩家列表更新
socket.on('playersUpdated', (data) => {
    updatePlayersList(data.players);
    updatePlayerCount(data.players.length);

    // 如果是房間創建者，根據人數啟用/禁用開始按鈕
    if (isRoomCreator) {
        document.getElementById('startGameBtn').disabled = data.players.length < 2;
    }
});

// 遊戲開始
socket.on('gameStarted', (data) => {
    showPage('game');
    displayGameBoard(data);
});

// 錯誤處理
socket.on('error', (data) => {
    alert('錯誤：' + data.message);
    showPage('roomSelect');
});

// ===== 輔助函數 =====
function updatePlayersList(players) {
    const playersList = document.getElementById('playersList');
    playersList.innerHTML = '';
    
    players.forEach((player, index) => {
        const playerDiv = document.createElement('div');
        playerDiv.className = 'player-item';
        playerDiv.textContent = `${index + 1}. ${player.name} ${player.id === socket.id ? '(你)' : ''}`;
        playersList.appendChild(playerDiv);
    });
}

function updatePlayerCount(count) {
    document.getElementById('playerCountText').textContent = `玩家數量：${count}/4`;
}

function displayGameBoard(gameData) {
    const gameContent = document.getElementById('gameContent');
    gameContent.innerHTML = `
        <p>遊戲已開始！</p>
        <p>房間ID：${currentRoomId}</p>
        <p>玩家：${gameData.players.map(p => p.name).join(', ')}</p>
        <p style="color: #999; font-size: 0.9em; margin-top: 20px;">完整遊戲邏輯開發中...</p>
    `;
}
