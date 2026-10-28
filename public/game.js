// public/game.js
const socket = io();
let roomCode = '';
let playerName = '';
let myPlayerIndex = -1;
let gameState = null;

socket.on('roomUpdate', (data) => {
  document.getElementById('playerList').innerHTML = data.players
    .map(p => `<div>${p.name}</div>`)
    .join('');
  document.getElementById('roomCode').textContent = data.roomCode;

  if (data.playerCount === 4) {
    document.getElementById('startGameBtn').disabled = false;
  }
});

socket.on('gameStarted', (state) => {
  document.getElementById('roomPanel').style.display = 'none';
  document.getElementById('gamePanel').style.display = 'block';
  renderGame(state);
});

socket.on('gameState', (state) => {
  gameState = state;
  renderGame(state);
});

socket.on('gameEnded', (scores) => {
  const winner = scores.reduce((min, p) => p.score < min.score ? p : min);
  alert(`Game Over! Winner: ${winner.name} with ${winner.score} points`);
});

function createRoom() {
  playerName = document.getElementById('playerNameInput').value;
  if (!playerName) {
    alert('Please enter your name');
    return;
  }

  socket.emit('createRoom', playerName, (code) => {
    roomCode = code;
    document.getElementById('joinSection').style.display = 'none';
    document.getElementById('roomPanel').style.display = 'block';
  });
}

function joinRoom() {
  playerName = document.getElementById('playerNameInput').value;
  roomCode = document.getElementById('roomCodeInput').value;
  if (!playerName || !roomCode) {
    alert('Please enter your name and room code');
    return;
  }

  socket.emit('joinRoom', roomCode, playerName, (result) => {
    if (result.success) {
      document.getElementById('joinSection').style.display = 'none';
      document.getElementById('roomPanel').style.display = 'block';
    } else {
      alert(result.message);
    }
  });
}

function startGame() {
  socket.emit('startGame');
}

function renderGame(state) {
  gameState = state;
  const handContainer = document.getElementById('handContainer');
  const currentPlayer = gameState.players[gameState.currentPlayerIndex];

  handContainer.innerHTML = gameState.players
    .map((p, idx) => {
      const isCurrentPlayer = idx === gameState.currentPlayerIndex;
      const isSelf = p.id === socket.id;
      return `
        <div class="player-section ${isCurrentPlayer ? 'current' : ''} ${isSelf ? 'self' : ''}">
          <h3>${p.name}${isCurrentPlayer ? ' (Current)' : ''}</h3>
          <div class="hand">
            ${[0, 1, 2, 3].map(i => `
              <div class="card ${p.handVisible[i] ? 'visible' : 'hidden'}" 
                   onclick="${isSelf && isCurrentPlayer ? `handleCardAction(${idx}, ${i})` : ''}">
                ${p.handVisible[i] ? '[Visible]' : '?'}
              </div>
            `).join('')}
          </div>
        </div>
      `;
    })
    .join('');

  document.getElementById('discardPile').innerHTML = gameState.discardPileTop 
    ? `${gameState.discardPileTop.rank}${gameState.discardPileTop.suit}`
    : 'Empty';
  document.getElementById('deckRemaining').textContent = gameState.deckRemaining;
}

function handleCardAction(playerIdx, cardIdx) {
  // 抽牌、交換或棄牌邏輯
  const drawnCard = { rank: 'A', suit: '♠' }; // 示例
  socket.emit('playerAction', {
    type: 'discard',
    drawnCard,
    pairingHandIndex: cardIdx,
    abilityTarget: {}
  });
}

