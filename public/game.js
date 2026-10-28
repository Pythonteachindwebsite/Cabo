const socket = io();

let gameState = null;
let playerIndex = null;
let roomCode = null;

socket.on('roomCreated', (data) => {
  playerIndex = data.playerIndex;
  roomCode = data.roomCode;
  document.getElementById('mainMenu').style.display = 'none';
  document.getElementById('waitingScreen').style.display = 'block';
  document.getElementById('roomCodeDisplay').textContent = roomCode;
  updatePlayerList();
});

socket.on('roomJoined', (data) => {
  playerIndex = data.playerIndex;
  roomCode = data.roomCode;
  document.getElementById('mainMenu').style.display = 'none';
  document.getElementById('waitingScreen').style.display = 'block';
});

socket.on('playerListUpdated', (players) => {
  const playerListDiv = document.getElementById('playerList');
  playerListDiv.innerHTML = '';
  players.forEach((p, i) => {
    const status = p.connected ? '✓' : '✗';
    playerListDiv.innerHTML += `<div>${i + 1}. ${p.name || '空'} ${status}</div>`;
  });
});

socket.on('gameStarted', (data) => {
  gameState = data.initialGameState;
  document.getElementById('waitingScreen').style.display = 'none';
  document.getElementById('gameBoard').style.display = 'block';
  renderGame();
  setTimeout(() => hideInitialCards(), 2000);
});

socket.on('gameUpdated', (data) => {
  gameState = data.gameState;
  renderGame();
});

socket.on('drawnCard', (data) => {
  document.getElementById('drawnCardDisplay').innerHTML = `
    <div class="card">${data.card.rank}${data.card.suit}</div>
    <button onclick="swapWithHand()">替换手牌</button>
    <button onclick="discardDrawn()">弃牌</button>
  `;
});

socket.on('viewOwnCard', (data) => {
  alert(`你的卡: ${data.card.rank}${data.card.suit}`);
});

socket.on('viewOpponentCard', (data) => {
  alert(`${data.playerName}的卡: ${data.card.rank}${data.card.suit}`);
});

socket.on('pairingSuccess', (data) => {
  if (data.playerIndex === playerIndex) {
    alert('配对成功！卡片已移除');
  }
});

socket.on('gameFinished', (data) => {
  alert(`游戏结束！最终得分: ${data.finalScores.join(', ')} 赢家是玩家${data.winner + 1}`);
  location.reload();
});

function createRoom() {
  const name = document.getElementById('playerNameInput').value;
  if (!name) {
    alert('请输入玩家名称');
    return;
  }
  socket.emit('createRoom', { playerName: name });
}

function joinRoom() {
  const code = document.getElementById('roomCodeInput').value;
  const name = document.getElementById('playerNameInput2').value;
  if (!code || !name) {
    alert('请输入房间代码和玩家名称');
    return;
  }
  socket.emit('joinRoom', { roomCode: code, playerName: name });
}

function renderGame() {
  const board = document.getElementById('gameBoard');
  board.innerHTML = '<div class="game-info">';
  board.innerHTML += `<div>轮次: ${gameState.round}/3</div>`;
  board.innerHTML += `<div>当前玩家: ${gameState.players[gameState.currentPlayerIndex].name}</div>`;
  board.innerHTML += '</div>';

  gameState.players.forEach((player, i) => {
    board.innerHTML += `<div class="player-section">
      <div class="player-name">${player.name}</div>
      <div class="player-hand">`;
    
    player.hand.forEach((h, j) => {
      const isVisible = player.visible[j] || (i === playerIndex);
      const cardDisplay = isVisible && h.faceUp ? `${h.card.rank}${h.card.suit}` : (h.card ? '🂠' : '');
      board.innerHTML += `<div class="card ${isVisible ? 'visible' : 'hidden'}" onclick="selectCard(${i}, ${j})">${cardDisplay}</div>`;
    });
    
    board.innerHTML += `</div></div>`;
  });

  board.innerHTML += `<div class="discard-section"><div class="discard-title">弃牌堆顶</div><div class="card">${gameState.discard.rank}${gameState.discard.suit}</div></div>`;
  board.innerHTML += `<div id="drawnCardDisplay"></div>`;
  board.innerHTML += `<div><button onclick="drawCard()">抽牌</button><button onclick="callCabo()">CABO</button></div>`;
}

function hideInitialCards() {
  gameState.players.forEach(p => {
    p.hand.forEach((h, i) => {
      if (i < 2) h.faceUp = false;
    });
  });
  renderGame();
}

function drawCard() {
  if (gameState.currentPlayerIndex === playerIndex) {
    socket.emit('drawCard');
  }
}

function swapWithHand() {
  const handIndex = prompt('输入手牌位置 (0-3):');
  if (handIndex !== null) {
    socket.emit('swapDrawnCard', { handIndex: parseInt(handIndex) });
  }
}

function discardDrawn() {
  socket.emit('discardDrawnCard');
}

function selectCard(playerIdx, cardIdx) {
  if (playerIdx === playerIndex && gameState.currentPlayerIndex === playerIndex) {
    const ability = gameState.players[playerIndex].hand[cardIdx].card.rank;
    if (['7', '8'].includes(ability)) {
      socket.emit('useSpecialAbility', { abilityType: '7or8', targetSlot: cardIdx });
    } else if (['9', '10'].includes(ability)) {
      const target = prompt('输入目标玩家 (0-3):');
      const slot = prompt('输入卡片位置 (0-3):');
      socket.emit('useSpecialAbility', { abilityType: '9or10', targetPlayer: parseInt(target), targetSlot: parseInt(slot) });
    } else if (['J', 'Q'].includes(ability)) {
      const target = prompt('输入目标玩家 (0-3):');
      const slot = prompt('输入卡片位置 (0-3):');
      socket.emit('useSpecialAbility', { abilityType: 'Jor Q', targetPlayer: parseInt(target), targetSlot: parseInt(slot) });
    } else if (['K', 'A'].includes(ability)) {
      const target = prompt('输入目标玩家 (0-3):');
      const slot = prompt('输入卡片位置 (0-3):');
      const swap = confirm('要交换吗?');
      socket.emit('useSpecialAbility', { abilityType: 'Kor A', targetPlayer: parseInt(target), targetSlot: parseInt(slot), shouldSwap: swap });
    } else {
      socket.emit('pairingCheck', { handIndex: cardIdx });
    }
  }
}

function callCabo() {
  socket.emit('callCabo');
}

