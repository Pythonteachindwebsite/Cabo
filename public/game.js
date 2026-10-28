const socket = io();
let currentRoom = null;
let playerName = '';
let playerIndex = null;

function createRoom() {
  playerName = document.getElementById('playerName').value.trim();
  if (!playerName) {
    alert('請輸入名字');
    return;
  }
  socket.emit('createRoom', playerName);
}

function showJoinRoom() {
  document.getElementById('mainScreen').style.display = 'none';
  document.getElementById('joinRoomScreen').style.display = 'block';
}

function backToMain() {
  document.getElementById('joinRoomScreen').style.display = 'none';
  document.getElementById('mainScreen').style.display = 'block';
}

function joinRoom() {
  playerName = document.getElementById('joinPlayerName').value.trim();
  const roomCode = document.getElementById('roomCodeInput').value.trim().toUpperCase();
  if (!playerName || !roomCode) {
    alert('請輸入名字和房間代碼');
    return;
  }
  socket.emit('joinRoom', { roomCode, playerName });
}

function startGame() {
  socket.emit('startGame', currentRoom);
}

function drawCard() {
  socket.emit('drawCard', currentRoom);
}

function swapCard(handIndex) {
  socket.emit('swapCard', { roomCode: currentRoom, handIndex });
}

function callCabo() {
  socket.emit('callCabo', currentRoom);
}

function leaveRoom() {
  socket.emit('leaveRoom', currentRoom);
  currentRoom = null;
  playerIndex = null;
  document.getElementById('mainScreen').style.display = 'block';
  document.getElementById('lobbyScreen').style.display = 'none';
  document.getElementById('gameScreen').style.display = 'none';
}

socket.on('roomCreated', (data) => {
  currentRoom = data.roomCode;
  document.getElementById('mainScreen').style.display = 'none';
  document.getElementById('lobbyScreen').style.display = 'block';
  document.getElementById('roomCode').textContent = data.roomCode;
});

socket.on('joinedRoom', (data) => {
  currentRoom = data.roomCode;
  document.getElementById('mainScreen').style.display = 'none';
  document.getElementById('joinRoomScreen').style.display = 'none';
  document.getElementById('lobbyScreen').style.display = 'block';
  document.getElementById('roomCode').textContent = data.roomCode;
});

socket.on('updatePlayers', (players) => {
  const playerList = document.getElementById('playerList');
  playerList.innerHTML = '';
  players.forEach(p => {
    const playerDiv = document.createElement('div');
    playerDiv.textContent = p.name;
    playerList.appendChild(playerDiv);
  });
  const startBtn = document.getElementById('startBtn');
  if (players[0].id === socket.id && players.length >= 2) {
    startBtn.style.display = 'block';
  }
});

socket.on('gameStarted', (data) => {
  document.getElementById('lobbyScreen').style.display = 'none';
  document.getElementById('gameScreen').style.display = 'block';
  document.getElementById('currentTurn').textContent = `當前玩家：${data.currentPlayer}`;
});

socket.on('updateHands', (hands) => {
  const handDisplay = document.getElementById('handDisplay');
  handDisplay.innerHTML = '';
  hands.forEach(({ playerIndex: idx, hand }) => {
    const handDiv = document.createElement('div');
    handDiv.className = 'player-hand';
    handDiv.innerHTML = `<h4>玩家 ${idx + 1} 的手牌</h4>`;
    hand.forEach((cardObj, cardIndex) => {
      const cardDiv = document.createElement('div');
      cardDiv.className = 'card';
      if (cardObj.isVisible) {
        cardDiv.textContent = cardObj.card.rank + cardObj.card.suit;
        cardDiv.classList.add('visible');
      } else {
        cardDiv.textContent = '?';
        cardDiv.classList.add('facedown');
      }
      if (playerIndex === idx) {
        cardDiv.onclick = () => swapCard(cardIndex);
      }
      handDiv.appendChild(cardDiv);
    });
    handDisplay.appendChild(handDiv);
  });
});

socket.on('cardDrawn', (data) => {
  console.log(`${data.playerName} 抽到了 ${data.card.rank}${data.card.suit}`);
});

socket.on('cardSwapped', (data) => {
  console.log(`${data.playerName} 交換了卡牌`);
});

socket.on('turnChanged', (data) => {
  document.getElementById('currentTurn').textContent = `當前玩家：${data.currentPlayer}`;
});

socket.on('caboround', (data) => {
  alert(data.message || data.playerName + ' ' + (data.message || '喊了 CABO'));
});

socket.on('roundEnded', (data) => {
  alert(`第 ${data.round} 輪結束！贏家是 ${data.winner}`);
});

socket.on('error', (message) => {
  alert('錯誤：' + message);
});

