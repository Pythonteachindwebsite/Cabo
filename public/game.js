// public/game.js
const socket = io();
let currentPlayer = null;
let gameState = null;
let roomCode = null;
let myPlayerId = null;
let drawnCard = null;

socket.on('connect', () => {
  myPlayerId = socket.id;
  showMainScreen();
});

function showMainScreen() {
  document.getElementById('app').innerHTML = `
    <div class="screen">
      <h1>CABO</h1>
      <button id="createBtn">创建房间</button>
      <button id="joinBtn">加入房间</button>
    </div>
  `;
  document.getElementById('createBtn').addEventListener('click', showCreateRoom);
  document.getElementById('joinBtn').addEventListener('click', showJoinRoom);
}

function showCreateRoom() {
  const playerName = prompt('输入你的名字：');
  if (!playerName) return;
  
  socket.emit('createRoom', playerName, (response) => {
    if (response.success) {
      roomCode = response.roomCode;
      showLobby();
    }
  });
}

function showJoinRoom() {
  const roomCode = prompt('输入房间代码：');
  if (!roomCode) return;
  
  const playerName = prompt('输入你的名字：');
  if (!playerName) return;
  
  socket.emit('joinRoom', roomCode, playerName, (response) => {
    if (response.success) {
      window.roomCode = roomCode;
      showLobby();
    } else {
      alert(response.message);
    }
  });
}

function showLobby() {
  document.getElementById('app').innerHTML = `
    <div class="screen">
      <h2>房间: ${roomCode}</h2>
      <div id="playerList"></div>
      <button id="startBtn">开始游戏 (2+玩家)</button>
      <button id="leaveBtn">离开房间</button>
    </div>
  `;
  
  socket.emit('startGame', (response) => {
    if (!response.success) {
      document.getElementById('startBtn').disabled = true;
    }
  });
  
  document.getElementById('startBtn').addEventListener('click', () => {
    socket.emit('startGame', (response) => {
      if (response.success) {
        console.log('Game starting...');
      } else {
        alert(response.message);
      }
    });
  });
  
  document.getElementById('leaveBtn').addEventListener('click', () => {
    socket.emit('leaveRoom');
    showMainScreen();
  });
}

socket.on('playerJoined', (data) => {
  if (document.getElementById('playerList')) {
    document.getElementById('playerList').innerHTML = `
      <p>玩家数: ${data.totalPlayers}/4</p>
      <ul>${data.players.map(p => `<li>${p.name}</li>`).join('')}</ul>
    `;
  }
});

socket.on('gameInitialized', (data) => {
  gameState = data.gameState;
  showGameScreen();
});

function showGameScreen() {
  document.getElementById('app').innerHTML = `
    <div class="game-screen">
      <div class="top-players"></div>
      <div class="middle-section">
        <div class="my-cards"></div>
        <div class="discard-pile"></div>
        <div class="draw-pile"></div>
      </div>
      <div class="confirm-section">
        <p>查看你的卡牌（上排显示2秒）</p>
        <button id="confirmBtn">确认翻回</button>
      </div>
    </div>
  `;

  renderGameState();
  
  document.getElementById('confirmBtn').addEventListener('click', () => {
    socket.emit('confirmFlip');
    document.getElementById('confirmBtn').disabled = true;
    document.getElementById('confirmBtn').textContent = '已确认，等待其他玩家...';
  });
}

function renderGameState() {
  // 渲染玩家卡牌（简化显示）
  const myCardHtml = gameState[0].visible
    .map((card, i) => card ? `<div class="card">${card.rank}${card.suit}</div>` : `<div class="card-back"></div>`)
    .join('');
  
  document.querySelector('.my-cards').innerHTML = myCardHtml;
}

socket.on('allConfirmed', () => {
  document.getElementById('confirmBtn').style.display = 'none';
  document.querySelector('.confirm-section p').textContent = '游戏开始！';
  showGameplayScreen();
});

function showGameplayScreen() {
  document.querySelector('.confirm-section').innerHTML = `
    <button id="drawBtn">抽卡</button>
  `;
  document.getElementById('drawBtn').addEventListener('click', () => {
    socket.emit('drawCard');
  });
}

socket.on('cardDrawn', (data) => {
  if (data.playerId === myPlayerId) {
    drawnCard = data.card;
    document.querySelector('.game-screen').innerHTML += `
      <div class="drawn-card-prompt">
        <p>抽到: ${data.card.rank}${data.card.suit}</p>
        <button id="swapBtn">交换到手牌</button>
        <button id="discardBtn">丢弃</button>
      </div>
    `;
    document.getElementById('swapBtn').addEventListener('click', () => {
      socket.emit('swapWithHand', 2); // 简化为交换位置2
    });
    document.getElementById('discardBtn').addEventListener('click', () => {
      socket.emit('discardCard', drawnCard);
    });
  }
});

socket.on('turnChanged', (data) => {
  console.log(`轮到: ${data.currentPlayer}`);
});

