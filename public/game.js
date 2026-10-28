const socket = io();
let currentScreen = 'mainMenu';
let gameState = null;
let playerName = '';
let roomCode = '';
let drawnCard = null;
let selectedHandIndex = null;

const screens = {
  mainMenu: document.getElementById('mainMenu'),
  createRoom: document.getElementById('createRoomScreen'),
  joinRoom: document.getElementById('joinRoomScreen'),
  waiting: document.getElementById('waitingScreen'),
  game: document.getElementById('gameScreen'),
  gameEnd: document.getElementById('gameEndScreen')
};

function switchScreen(screenName) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[screenName].classList.add('active');
  currentScreen = screenName;
}

// 主菜單
document.getElementById('createRoomBtn').addEventListener('click', () => {
  switchScreen('createRoom');
});

document.getElementById('joinRoomBtn').addEventListener('click', () => {
  switchScreen('joinRoom');
});

// 創建房間
document.getElementById('confirmCreateBtn').addEventListener('click', () => {
  const name = document.getElementById('createPlayerName').value;
  if (!name) {
    alert('請輸入玩家名稱');
    return;
  }
  playerName = name;
  socket.emit('createRoom', name, (result) => {
    if (result.success) {
      roomCode = result.roomCode;
      document.getElementById('displayRoomCode').textContent = roomCode;
      switchScreen('waiting');
    }
  });
});

document.getElementById('backFromCreateBtn').addEventListener('click', () => {
  switchScreen('mainMenu');
});

// 加入房間
document.getElementById('confirmJoinBtn').addEventListener('click', () => {
  const code = document.getElementById('roomCodeInput').value;
  const name = document.getElementById('joinPlayerName').value;
  if (!code || !name) {
    alert('請輸入房間代碼和玩家名稱');
    return;
  }
  playerName = name;
  roomCode = code;
  socket.emit('joinRoom', code, name, (result) => {
    if (result.success) {
      document.getElementById('displayRoomCode').textContent = code;
      switchScreen('waiting');
    } else {
      alert(result.message);
    }
  });
});

document.getElementById('backFromJoinBtn').addEventListener('click', () => {
  switchScreen('mainMenu');
});

// 等待屏幕
document.getElementById('startGameBtn').addEventListener('click', () => {
  socket.emit('startGame');
});

document.getElementById('leaveRoomBtn').addEventListener('click', () => {
  socket.emit('leaveRoom');
  switchScreen('mainMenu');
});

// 遊戲屏幕
document.getElementById('drawBtn').addEventListener('click', () => {
  socket.emit('drawCard');
});

document.getElementById('discardDrawnBtn').addEventListener('click', () => {
  socket.emit('discardDrawnCard', drawnCard);
  drawnCard = null;
  document.getElementById('drawnCardDisplay').style.display = 'none';
});

document.getElementById('swapDrawnBtn').addEventListener('click', () => {
  if (selectedHandIndex === null) {
    alert('請選擇要交換的手牌');
    return;
  }
  socket.emit('swapDrawnCard', selectedHandIndex, drawnCard);
  drawnCard = null;
  selectedHandIndex = null;
  document.getElementById('drawnCardDisplay').style.display = 'none';
});

document.getElementById('caboBtn').addEventListener('click', () => {
  socket.emit('callCabo');
});

document.getElementById('exitGameBtn').addEventListener('click', () => {
  socket.emit('leaveRoom');
  switchScreen('mainMenu');
});

document.getElementById('returnToMenuBtn').addEventListener('click', () => {
  switchScreen('mainMenu');
});

// Socket 事件
socket.on('gameStateUpdate', (state) => {
  gameState = state;
  updateGameDisplay();
});

socket.on('drawnCardDisplay', (card) => {
  drawnCard = card;
  selectedHandIndex = null;
  document.getElementById('drawnCardPreview').textContent = `${card.value}${card.suit}`;
  document.getElementById('drawnCardDisplay').style.display = 'flex';
});

socket.on('playerJoined', (data) => {
  updatePlayersList(data.players);
});

socket.on('playerLeft', (data) => {
  updatePlayersList(data.players);
});

socket.on('cardViewed', (card) => {
  alert(`卡牌：${card.value}${card.suit}`);
});

socket.on('selectOwnCard', () => {
  alert('選擇一張你的卡牌來查看');
});

socket.on('selectOpponentCard', (data) => {
  const opponentName = prompt(`選擇一名玩家：${data.players.join(', ')}`);
  if (opponentName) {
    const cardIndex = prompt('選擇卡牌位置 (0-3)：');
    socket.emit('viewOpponentCard', opponentName, parseInt(cardIndex));
  }
});

socket.on('selectOpponentSwap', (data) => {
  const opponentName = prompt(`選擇一名對手：${data.players.join(', ')}`);
  if (opponentName) {
    const cardIndex = prompt('選擇對手卡牌位置 (0-3)：');
    socket.emit('swapOpponentCard', opponentName, parseInt(cardIndex));
  }
});

socket.on('selectOpponentPeekSwap', (data) => {
  const opponentName = prompt(`選擇一名對手：${data.players.join(', ')}`);
  if (opponentName) {
    const cardIndex = prompt('選擇對手卡牌位置 (0-3)：');
    const shouldSwap = confirm('是否交換？');
    socket.emit('peekAndDecideSwap', opponentName, parseInt(cardIndex), shouldSwap);
  }
});

function updatePlayersList(players) {
  const list = document.getElementById('playersList');
  list.innerHTML = players.map(p => `<div class="player-item">${p.name}</div>`).join('');
}

function updateGameDisplay() {
  if (!gameState) return;

  // 更新回合
  document.getElementById('roundDisplay').textContent = gameState.round;

  // 更新本玩家信息
  const myIndex = gameState.players.findIndex(p => p.name === playerName);
  if (myIndex !== undefined) {
    document.getElementById('playerName').textContent = playerName;
    document.getElementById('playerScore').textContent = `分數: ${gameState.players[myIndex].score}`;
  }

  // 更新棄牌堆
  if (gameState.discardPile.length > 0) {
    const topCard = gameState.discardPile[gameState.discardPile.length - 1];
    document.getElementById('topDiscardCard').textContent = `${topCard.value}${topCard.suit}`;
  }

  // 更新牌堆計數
  document.getElementById('deckCount').textContent = gameState.deck.length;

  // 更新玩家手牌
  if (myIndex !== undefined) {
    const playerCards = gameState.players[myIndex].hand;
    const visibleCards = gameState.players[myIndex].visibleCards;
    const handContainer = document.getElementById('playerHand');
    handContainer.innerHTML = playerCards.map((card, index) => {
      const cardElement = document.createElement('div');
      cardElement.className = 'card-hand';
      
      if (visibleCards[index] || drawnCard) {
        cardElement.textContent = `${card.value}${card.suit}`;
        cardElement.classList.add('visible');
      } else {
        cardElement.textContent = '?';
        cardElement.classList.add('hidden');
      }

      // 如果抽了牌，允許交換
      if (drawnCard) {
        cardElement.addEventListener('click', () => {
          selectedHandIndex = index;
          document.querySelectorAll('.card-hand').forEach(c => c.classList.remove('selected'));
          cardElement.classList.add('selected');
        });
      }

      return cardElement;
    }).forEach(el => handContainer.appendChild(el));
  }

  // 更新對手區域
  const opponentsArea = document.getElementById('opponentsArea');
  opponentsArea.innerHTML = gameState.players
    .filter((_, i) => i !== myIndex)
    .map((player, index) => {
      return `
        <div class="opponent-panel">
          <div class="opponent-name">${player.name}</div>
          <div class="opponent-score">分數: ${player.score}</div>
          <div class="opponent-hand">
            ${player.hand.map((card, cardIndex) => {
              const visible = player.visibleCards[cardIndex];
              return `<div class="card-opponent ${visible ? 'visible' : 'hidden'}">
                ${visible ? `${card.value}${card.suit}` : '?'}
              </div>`;
            }).join('')}
          </div>
        </div>
      `;
    })
    .join('');

  // 更新抽牌按鈕
  const isMyTurn = gameState.currentPlayerIndex === myIndex;
  document.getElementById('drawBtn').disabled = !isMyTurn;

  // 檢查遊戲是否結束
  if (gameState.gameEnded) {
    switchScreen('gameEnd');
    displayFinalScores();
  }
}

function displayFinalScores() {
  const finalScoresDiv = document.getElementById('finalScores');
  finalScoresDiv.innerHTML = gameState.players
    .map(p => `<div class="score-row">${p.name}: ${p.score} 分</div>`)
    .join('');
}

