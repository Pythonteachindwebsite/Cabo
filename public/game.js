const socket = io();

let gameState = null;
let playerIndex = null;
let roomCode = null;

document.addEventListener('DOMContentLoaded', function() {
  document.getElementById('createBtn').addEventListener('click', createRoom);
  document.getElementById('joinBtn').addEventListener('click', joinRoom);
  document.getElementById('startBtn').addEventListener('click', startGame);
  document.getElementById('drawCardBtn').addEventListener('click', drawCard);
  document.getElementById('caboBtn').addEventListener('click', callCabo);
  document.getElementById('endTurnBtn').addEventListener('click', endTurn);
});

socket.on('roomCreated', (data) => {
  playerIndex = data.playerIndex;
  roomCode = data.roomCode;
  showScreen('waitingScreen');
  document.getElementById('roomCodeDisplay').textContent = `房間代碼：${roomCode}`;
});

socket.on('roomJoined', (data) => {
  playerIndex = data.playerIndex;
  roomCode = data.roomCode;
  showScreen('waitingScreen');
  document.getElementById('roomCodeDisplay').textContent = `房間代碼：${roomCode}`;
});

socket.on('playerListUpdated', (players) => {
  const playerListDiv = document.getElementById('playerList');
  playerListDiv.innerHTML = '<div><strong>玩家：</strong></div>';
  players.forEach((p, i) => {
    const status = p.connected ? '✓' : '✗';
    playerListDiv.innerHTML += `<div class="player-item">${p.name} ${status}</div>`;
  });
});

socket.on('readyToStart', (data) => {
  if (playerIndex === 0) {
    document.getElementById('startBtn').style.display = 'block';
  }
});

socket.on('gameStarted', (data) => {
  gameState = data.initialGameState;
  showScreen('gameBoard');
  renderGame();
  setTimeout(() => hideInitialCards(), 2000);
});

socket.on('gameUpdated', (data) => {
  gameState = data.gameState;
  renderGame();
});

socket.on('drawnCard', (data) => {
  const section = document.getElementById('drawnCardSection');
  section.innerHTML = `
    <div class="drawn-card-box">
      <div class="drawn-label">抽到的牌：${data.card.rank}${data.card.suit}</div>
      <div class="action-buttons">
        <button onclick="swapDrawnCard()">替換手牌</button>
        <button onclick="discardDrawn()">棄牌</button>
      </div>
    </div>
  `;
});

socket.on('viewCard', (data) => {
  alert(`看到的牌：${data.card.rank}${data.card.suit}`);
});

socket.on('pairingSuccess', (data) => {
  if (data.playerIndex === playerIndex) {
    alert('配對成功！');
  }
});

socket.on('roundStarted', (data) => {
  gameState = data.gameState;
  renderGame();
  setTimeout(() => hideInitialCards(), 2000);
});

socket.on('gameFinished', (data) => {
  const names = gameState.players.map(p => p.name);
  alert(`遊戲結束！\n最終得分：${data.finalScores.join(', ')}\n贏家：${names[data.winner]}`);
  location.reload();
});

function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(screenId).classList.add('active');
}

function createRoom() {
  const name = document.getElementById('playerNameInput').value.trim();
  if (!name) {
    alert('請輸入玩家名稱');
    return;
  }
  socket.emit('createRoom', { playerName: name });
}

function joinRoom() {
  const code = document.getElementById('roomCodeInput').value.trim();
  const name = document.getElementById('playerNameInput2').value.trim();
  if (!code || !name) {
    alert('請輸入房間代碼和玩家名稱');
    return;
  }
  socket.emit('joinRoom', { roomCode: code, playerName: name });
}

function startGame() {
  socket.emit('startGame');
}

function drawCard() {
  if (gameState.currentPlayerIndex === playerIndex && gameState.phase === 'draw') {
    socket.emit('drawCard');
  }
}

function swapDrawnCard() {
  const handIndex = prompt('輸入要替換的手牌位置 (0-3)：');
  if (handIndex !== null && handIndex >= 0 && handIndex <= 3) {
    socket.emit('swapDrawnCard', { handIndex: parseInt(handIndex) });
    document.getElementById('drawnCardSection').innerHTML = '';
  }
}

function discardDrawn() {
  socket.emit('discardDrawnCard');
  document.getElementById('drawnCardSection').innerHTML = '';
}

function callCabo() {
  if (confirm('確定要喊 CABO 嗎？')) {
    socket.emit('callCabo');
  }
}

function endTurn() {
  socket.emit('endTurn');
  document.getElementById('drawnCardSection').innerHTML = '';
}

function renderGame() {
  // 遊戲信息
  const gameInfo = document.getElementById('gameInfo');
  gameInfo.innerHTML = `輪次：${gameState.round}/3 | 當前玩家：${gameState.players[gameState.currentPlayerIndex].name}`;

  // 對手
  const opponentDiv = document.getElementById('opponentPlayers');
  opponentDiv.innerHTML = '';
  gameState.players.forEach((player, idx) => {
    if (idx !== playerIndex) {
      opponentDiv.innerHTML += `
        <div class="opponent-box">
          <div class="opponent-name">${player.name}</div>
          <div class="opponent-hand">
            ${player.hand.map((h, i) => {
              const isVisible = player.visible[i];
              return `<div class="card ${isVisible ? 'face-up' : 'face-down'}">${isVisible && h.card ? h.card.rank + h.card.suit : '🂠'}</div>`;
            }).join('')}
          </div>
        </div>
      `;
    }
  });

  // 棄牌堆
  const discardCard = document.getElementById('discardCard');
  discardCard.innerHTML = gameState.discard ? `${gameState.discard.rank}${gameState.discard.suit}` : '';

  // 玩家手牌
  const playerHand = document.getElementById('playerHand');
  const player = gameState.players[playerIndex];
  playerHand.innerHTML = player.hand.map((h, i) => {
    if (!h.card) return '<div class="card empty"></div>';
    return `<div class="card hand-card" onclick="selectCard(${i})">${h.card.rank}${h.card.suit}</div>`;
  }).join('');

  // 按鈕狀態
  const isCurrentPlayer = gameState.currentPlayerIndex === playerIndex;
  document.getElementById('drawCardBtn').disabled = !isCurrentPlayer || gameState.phase !== 'draw';
  document.getElementById('endTurnBtn').style.display = isCurrentPlayer && gameState.phase === 'pairing' ? 'block' : 'none';
}

function hideInitialCards() {
  gameState.players[playerIndex].visible[0] = false;
  gameState.players[playerIndex].visible[1] = false;
  renderGame();
}

function selectCard(cardIndex) {
  if (gameState.currentPlayerIndex !== playerIndex) return;
  
  const player = gameState.players[playerIndex];
  const card = player.hand[cardIndex];
  
  if (!card || !card.card) return;

  const rank = card.card.rank;
  
  if (['7', '8'].includes(rank)) {
    socket.emit('useSpecialAbility', { abilityType: '7or8', targetSlot: cardIndex });
  } else if (['9', '10'].includes(rank)) {
    const target = prompt('選擇對手 (0-' + (gameState.players.length - 1) + ')：');
    const slot = prompt('選擇卡片位置 (0-3)：');
    if (target !== null && slot !== null) {
      socket.emit('useSpecialAbility', { abilityType: '9or10', targetPlayer: parseInt(target), targetSlot: parseInt(slot) });
    }
  } else if (['J', 'Q'].includes(rank)) {
    const target = prompt('選擇對手 (0-' + (gameState.players.length - 1) + ')：');
    const theirSlot = prompt('選擇對手卡片位置 (0-3)：');
    if (target !== null && theirSlot !== null) {
      socket.emit('useSpecialAbility', { abilityType: 'JorQ', targetPlayer: parseInt(target), targetSlot: parseInt(theirSlot), mySlot: cardIndex });
    }
  } else if (['K', 'A'].includes(rank)) {
    const target = prompt('選擇對手 (0-' + (gameState.players.length - 1) + ')：');
    const theirSlot = prompt('選擇對手卡片位置 (0-3)：');
    socket.emit('useSpecialAbility', { abilityType: 'KorA', targetPlayer: parseInt(target), targetSlot: parseInt(theirSlot), mySlot: cardIndex, shouldSwap: false });
  } else {
    socket.emit('pairingCheck', { handIndex: cardIndex });
  }
}

