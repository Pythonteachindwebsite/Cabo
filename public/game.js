const socket = io();

let currentPlayerId = null;
let currentRoomId = null;
let gameState = null;

// DOM 元素
const joinScreenEl = document.getElementById('joinScreen');
const gameScreenEl = document.getElementById('gameScreen');
const roomCodeEl = document.getElementById('roomCode');
const playerListEl = document.getElementById('playerList');
const playerNameInput = document.getElementById('playerName');
const createRoomBtn = document.getElementById('createRoom');
const joinRoomBtn = document.getElementById('joinRoom');
const roomIdInput = document.getElementById('roomId');
const startGameBtn = document.getElementById('startGame');
const leaveRoomBtn = document.getElementById('leaveRoom');
const gameAreaEl = document.getElementById('gameArea');
const handsDisplayEl = document.getElementById('handsDisplay');
const discardPileEl = document.getElementById('discardPile');
const drawCardBtn = document.getElementById('drawCard');
const currentPlayerEl = document.getElementById('currentPlayer');

// 生成房間代碼
function generateRoomCode() {
  return Math.random().toString(36).substr(2, 6).toUpperCase();
}

// 生成玩家 ID
function generatePlayerId() {
  return 'player_' + Math.random().toString(36).substr(2, 9);
}

// 創建房間
createRoomBtn.addEventListener('click', () => {
  const playerName = playerNameInput.value.trim();
  if (!playerName) {
    alert('請輸入玩家名稱');
    return;
  }

  const roomId = generateRoomCode();
  currentPlayerId = generatePlayerId();
  currentRoomId = roomId;

  socket.emit('joinRoom', {
    roomId: roomId,
    playerId: currentPlayerId,
    playerName: playerName
  });
});

// 加入房間
joinRoomBtn.addEventListener('click', () => {
  const playerName = playerNameInput.value.trim();
  const roomId = roomIdInput.value.trim().toUpperCase();

  if (!playerName || !roomId) {
    alert('請輸入玩家名稱和房間代碼');
    return;
  }

  currentPlayerId = generatePlayerId();
  currentRoomId = roomId;

  socket.emit('joinRoom', {
    roomId: roomId,
    playerId: currentPlayerId,
    playerName: playerName
  });
});

// 加入房間後
socket.on('roomJoined', (data) => {
  roomCodeEl.textContent = `房間代碼: ${data.roomId}`;
  updatePlayerList(data.players);
  showGameScreen();
});

// 玩家列表更新
socket.on('playersUpdated', (players) => {
  updatePlayerList(players);
});

function updatePlayerList(players) {
  playerListEl.innerHTML = '';
  players.forEach(player => {
    const li = document.createElement('li');
    li.textContent = player.playerName;
    playerListEl.appendChild(li);
  });
  startGameBtn.disabled = players.length < 2;
});

// 顯示遊戲畫面
function showGameScreen() {
  joinScreenEl.style.display = 'none';
  gameScreenEl.style.display = 'block';
}

// 開始遊戲
startGameBtn.addEventListener('click', () => {
  socket.emit('startGame', { roomId: currentRoomId });
});

// 遊戲已開始
socket.on('gameStarted', (data) => {
  gameState = data.game;
  displayGame(data.handsForAllPlayers, data.discardPile);
  updateCurrentPlayer();
});

// 抽卡
drawCardBtn.addEventListener('click', () => {
  socket.emit('drawCard', {
    roomId: currentRoomId,
    playerId: currentPlayerId
  });
});

// 卡牌已抽取
socket.on('cardDrawn', (data) => {
  displayGame(data.handsForAllPlayers, gameState.discardPile);
});

// 交換卡牌
function swapCard(handIndex) {
  const hand = gameState.hands[currentPlayerId];
  if (hand && hand[4]) { // 第5張是剛抽的牌
    socket.emit('swapCard', {
      roomId: currentRoomId,
      playerId: currentPlayerId,
      handIndex: handIndex,
      drawnCardId: hand[4].id,
      specialAbilityUsed: null
    });
  }
}

// 卡牌已交換
socket.on('cardSwapped', (data) => {
  gameState.discardPile.push(data.discardedCard);
  displayGame(data.handsForAllPlayers, gameState.discardPile);
  updateCurrentPlayer();
});

// 回合改變
socket.on('turnChanged', (data) => {
  gameState.currentPlayerIndex = data.currentPlayerIndex;
  updateCurrentPlayer();
});

// 呼喚 CABLE
function callCable() {
  socket.emit('callCable', {
    roomId: currentRoomId,
    playerId: currentPlayerId
  });
}

// CABLE 已呼喚
socket.on('cableCalled', (data) => {
  displayScores(data.scores);
  setTimeout(() => {
    socket.emit('nextRound', { roomId: currentRoomId });
  }, 2000);
});

// 遊戲結束
socket.on('gameEnded', (data) => {
  displayFinalScores(data.finalScores);
});

// 離開房間
leaveRoomBtn.addEventListener('click', () => {
  socket.emit('leaveRoom', {
    roomId: currentRoomId,
    playerId: currentPlayerId
  });
  joinScreenEl.style.display = 'block';
  gameScreenEl.style.display = 'none';
});

// 顯示遊戲畫面
function displayGame(handsForAllPlayers, discardPile) {
  handsDisplayEl.innerHTML = '';

  for (let playerId in handsForAllPlayers) {
    const playerHandDiv = document.createElement('div');
    playerHandDiv.className = 'playerHand';
    playerHandDiv.innerHTML = `<strong>${playerId === currentPlayerId ? '你的手牌' : '對手'}</strong>`;

    const hand = handsForAllPlayers[playerId];
    const cardGrid = document.createElement('div');
    cardGrid.className = 'cardGrid';

    hand.forEach((card, index) => {
      const cardEl = document.createElement('div');
      cardEl.className = 'card';
      if (card.isFaceUp) {
        cardEl.textContent = `${card.value}${card.suit}`;
        cardEl.classList.add(card.isRed ? 'red' : 'black');
      } else {
        cardEl.textContent = '?';
        cardEl.classList.add('cardBack');
      }
      if (playerId === currentPlayerId) {
        cardEl.onclick = () => swapCard(index);
      }
      cardGrid.appendChild(cardEl);
    });

    playerHandDiv.appendChild(cardGrid);
    handsDisplayEl.appendChild(playerHandDiv);
  }

  discardPileEl.innerHTML = '';
  if (discardPile.length > 0) {
    const lastCard = discardPile[discardPile.length - 1];
    const cardEl = document.createElement('div');
    cardEl.className = 'card';
    cardEl.textContent = `${lastCard.value}${lastCard.suit}`;
    cardEl.classList.add(lastCard.isRed ? 'red' : 'black');
    discardPileEl.appendChild(cardEl);
  }
}

// 更新當前玩家
function updateCurrentPlayer() {
  const currentPlayerId = gameState.playerIds[gameState.currentPlayerIndex];
  currentPlayerEl.textContent = `當前玩家: ${currentPlayerId === this.currentPlayerId ? '你' : '對手'}`;
  drawCardBtn.disabled = currentPlayerId !== this.currentPlayerId;
}

// 顯示分數
function displayScores(scores) {
  let scoresText = '本輪分數:\\n';
  for (let playerId in scores) {
    scoresText += `${playerId}: ${scores[playerId]}\\n`;
  }
  alert(scoresText);
}

// 顯示最終分數
function displayFinalScores(finalScores) {
  let scoresText = '遊戲結束! 最終分數:\\n';
  for (let playerId in finalScores) {
    scoresText += `${playerId}: ${finalScores[playerId]}\\n`;
  }
  alert(scoresText);
}
