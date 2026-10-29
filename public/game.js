const socket = io();
let currentRoom = null;
let gameState = null;
let myPlayerId = null;

socket.on('connect', () => {
  myPlayerId = socket.id;
});

socket.on('roomCreated', (data) => {
  currentRoom = data.roomId;
  document.getElementById('mainScreen').style.display = 'none';
  document.getElementById('roomScreen').style.display = 'block';
  document.getElementById('roomCode').textContent = currentRoom;
  document.getElementById('startGameBtn').style.display = 'block';
});

socket.on('updatePlayers', (data) => {
  const playersList = document.getElementById('playersList');
  playersList.innerHTML = '';
  data.players.forEach(player => {
    const div = document.createElement('div');
    div.textContent = player.name + (player.isHost ? ' (主持人)' : '');
    playersList.appendChild(div);
  });
});

socket.on('gameStarted', (data) => {
  currentRoom = data.roomId || currentRoom;
  gameState = {
    yourHand: data.yourHand,
    discardTop: data.discardTop,
    currentPlayer: data.currentPlayer,
    currentPlayerName: data.currentPlayerName,
    players: data.players
  };

  document.getElementById('roomScreen').style.display = 'none';
  document.getElementById('gameScreen').style.display = 'block';
  renderHand(data.yourHand);
  document.getElementById('discardTop').textContent = data.discardTop;
  updateTurnInfo(data.currentPlayerName);
});

socket.on('cardsFlipped', (data) => {
  gameState.yourHand = data.yourHand;
  renderHand(data.yourHand);
});

socket.on('drawnCard', (data) => {
  document.getElementById('gameLog').innerHTML += `<p>${data.playerName} 抽卡: ${data.card}</p>`;
  if (data.playerId === myPlayerId) {
    document.getElementById('drawnCard').textContent = data.card;
    document.getElementById('drawnCard').style.display = 'block';
  }
});

socket.on('yourDrawnCard', (data) => {
  document.getElementById('drawnCard').textContent = data.card;
  document.getElementById('drawnCard').style.display = 'block';
});

socket.on('cardDiscarded', (data) => {
  gameState.discardTop = data.card;
  document.getElementById('discardTop').textContent = data.card;
  document.getElementById('gameLog').innerHTML += `<p>${data.playerName} 出卡: ${data.card}</p>`;
});

socket.on('cardSwapped', (data) => {
  document.getElementById('gameLog').innerHTML += `<p>${data.playerName} 交換卡片</p>`;
  document.getElementById('drawnCard').style.display = 'none';
});

socket.on('updateYourHand', (data) => {
  gameState.yourHand = data.hand;
  renderHand(data.hand);
  document.getElementById('drawnCard').style.display = 'none';
});

socket.on('turnChanged', (data) => {
  gameState.currentPlayer = data.currentPlayer;
  gameState.currentPlayerName = data.currentPlayerName;
  updateTurnInfo(data.currentPlayerName);
  document.getElementById('drawnCard').style.display = 'none';
});

socket.on('abilityAvailable', (data) => {
  const abilities = {
    '7': '查看自己卡片',
    '8': '查看自己卡片',
    '9': '查看對手卡片',
    '10': '查看對手卡片',
    'J': '盲目交換',
    'Q': '盲目交換',
    'K': '查看對手卡片並決定交換',
    'A': '查看對手卡片並決定交換'
  };
  document.getElementById('gameLog').innerHTML += `<p>${data.playerName} 觸發能力: ${abilities[data.rank] || '未知'}</p>`;
});

socket.on('caboCalled', (data) => {
  document.getElementById('gameLog').innerHTML += `<p style="color:red;">${data.playerName} 叫 CABO!</p>`;
});

socket.on('gameEnded', (data) => {
  alert(`遊戲結束！ ${data.winnerName} 獲勝！`);
  document.getElementById('gameScreen').style.display = 'none';
  document.getElementById('mainScreen').style.display = 'block';
});

socket.on('error', (msg) => {
  alert('錯誤: ' + msg);
});

socket.on('leftRoom', () => {
  document.getElementById('roomScreen').style.display = 'none';
  document.getElementById('gameScreen').style.display = 'none';
  document.getElementById('mainScreen').style.display = 'block';
  currentRoom = null;
  gameState = null;
});

function createRoom() {
  const name = document.getElementById('playerName').value;
  if (!name) {
    alert('請輸入玩家名稱');
    return;
  }
  socket.emit('createRoom', name);
}

function joinRoom() {
  const roomId = document.getElementById('joinRoomCode').value;
  const name = document.getElementById('joinPlayerName').value;
  if (!roomId || !name) {
    alert('請輸入房間代碼和玩家名稱');
    return;
  }
  socket.emit('joinRoom', roomId, name);
  currentRoom = roomId;
  document.getElementById('mainScreen').style.display = 'none';
  document.getElementById('roomScreen').style.display = 'block';
  document.getElementById('roomCode').textContent = roomId;
  document.getElementById('startGameBtn').style.display = 'none';
}

function startGame() {
  socket.emit('startGame', currentRoom);
  document.getElementById('confirmFlipBtn').style.display = 'block';
}

function confirmCardFlip() {
  socket.emit('confirmCardFlip', currentRoom);
  document.getElementById('confirmFlipBtn').style.display = 'none';
}

function drawCard() {
  socket.emit('drawCard', currentRoom);
}

function discardCard() {
  const card = document.getElementById('drawnCard').textContent;
  socket.emit('discardCard', currentRoom, card);
}

function swapCard(cardIndex) {
  const card = document.getElementById('drawnCard').textContent;
  socket.emit('swapCard', currentRoom, cardIndex, card);
}

function leaveRoom() {
  socket.emit('leaveRoom', currentRoom);
}

function renderHand(hand) {
  const handDiv = document.getElementById('yourHand');
  handDiv.innerHTML = '';
  hand.forEach((cardState, idx) => {
    const btn = document.createElement('button');
    btn.textContent = cardState.faceUp ? cardState.card : '背';
    btn.className = 'cardBtn';
    if (gameState.currentPlayer === gameState.players.findIndex(p => p.id === myPlayerId)) {
      btn.onclick = () => swapCard(idx);
    }
    handDiv.appendChild(btn);
  });
}

function updateTurnInfo(playerName) {
  document.getElementById('turnInfo').textContent = `現在是 ${playerName} 的回合`;
}

function callCabo() {
  socket.emit('callCabo', currentRoom);
}

function exitGame() {
  socket.disconnect();
  location.reload();
}
