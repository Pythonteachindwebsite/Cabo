const socket = io();
let roomCode = '';
let playerIndex = -1;
let gameState = null;
let allHands = [];
let waitingForExchange = false;

// DOM Elements
const roomCodeDisplay = document.getElementById('roomCodeDisplay');
const playersListDisplay = document.getElementById('playersList');
const gameContainer = document.getElementById('gameContainer');
const startGameBtn = document.getElementById('startGameBtn');
const handDisplay = document.getElementById('handDisplay');
const messageDisplay = document.getElementById('messageDisplay');
const opponentDisplay = document.getElementById('opponentDisplay');

// Create Room
document.getElementById('createRoomBtn').addEventListener('click', () => {
  const playerName = document.getElementById('playerNameInput').value.trim();
  if (!playerName) {
    alert('Please enter your name');
    return;
  }
  
  socket.emit('createRoom', playerName, (code) => {
    roomCode = code;
    roomCodeDisplay.textContent = `Room Code: ${roomCode}`;
    document.getElementById('joinSection').style.display = 'none';
    document.getElementById('roomSection').style.display = 'block';
  });
});

// Join Room
document.getElementById('joinRoomBtn').addEventListener('click', () => {
  const playerName = document.getElementById('playerNameInput').value.trim();
  const inputRoomCode = document.getElementById('roomCodeInput').value.trim().toUpperCase();
  
  if (!playerName || !inputRoomCode) {
    alert('Please enter your name and room code');
    return;
  }
  
  socket.emit('joinRoom', inputRoomCode, playerName, (result) => {
    if (result.success) {
      roomCode = inputRoomCode;
      roomCodeDisplay.textContent = `Room Code: ${roomCode}`;
      document.getElementById('joinSection').style.display = 'none';
      document.getElementById('roomSection').style.display = 'block';
    } else {
      alert(result.message);
    }
  });
});

// Start Game
startGameBtn.addEventListener('click', () => {
  socket.emit('startGame', roomCode);
});

// Socket Events
socket.on('playersUpdated', (players) => {
  playersListDisplay.innerHTML = players.map((p) => `<div>${p.name}</div>`).join('');
  startGameBtn.disabled = players.length < 4;
});

socket.on('gameInitialized', (data) => {
  playerIndex = data.playerIndex;
  gameState = data.gameState;
  allHands = data.allHands;
  
  document.getElementById('roomSection').style.display = 'none';
  gameContainer.style.display = 'block';
  
  renderHand();
  renderOpponents();
});

socket.on('gameState', (data) => {
  gameState = data.gameState;
  allHands = data.allHands;
  playerIndex = data.playerIndex;
  
  renderHand();
  renderOpponents();
  updateMessage();
});

socket.on('cardDrawn', (data) => {
  messageDisplay.textContent = `${socket.id === data.playerIndex ? 'You drew' : 'Player drew'}: ${data.drawnCard.value}`;
  
  if (data.playerIndex === playerIndex) {
    showCardSelectionPrompt(data.drawnCard);
  }
});

socket.on('abilityView', (data) => {
  const cardsText = data.cards.map((c) => c.value || 'Empty').join(', ');
  alert(`${data.message}\nCards: ${cardsText}`);
});

socket.on('roundEnded', (data) => {
  alert(`Round Ended!\nScores: ${data.scores.join(', ')}`);
});

socket.on('gameOver', (data) => {
  const winner = data.scores.indexOf(Math.min(...data.scores));
  alert(`Game Over! Winner: Player ${winner + 1}`);
});

// Render hand
function renderHand() {
  if (playerIndex < 0 || !allHands[playerIndex]) return;
  
  const hand = allHands[playerIndex];
  handDisplay.innerHTML = hand.map((card, idx) => {
    const display = card.faceUp ? card.value : '?';
    return `<div class="card" onclick="selectCard(${idx})">${display}</div>`;
  }).join('');
}

// Render opponents
function renderOpponents() {
  opponentDisplay.innerHTML = '';
  
  allHands.forEach((hand, idx) => {
    if (idx === playerIndex) return;
    
    const opponentDiv = document.createElement('div');
    opponentDiv.className = 'opponent';
    opponentDiv.innerHTML = hand.map((card) => {
      const display = card.faceUp ? card.value : '?';
      return `<div class="card">${display}</div>`;
    }).join('');
    
    opponentDisplay.appendChild(opponentDiv);
  });
}

// Select card for exchange
function selectCard(slot) {
  if (waitingForExchange) {
    socket.emit('exchangeCard', slot);
    waitingForExchange = false;
  }
}

// Show card selection prompt
function showCardSelectionPrompt(drawnCard) {
  messageDisplay.textContent = `You drew ${drawnCard.value}. Select a card to exchange.`;
  waitingForExchange = true;
}

// Update message
function updateMessage() {
  if (gameState.phase === 'viewing') {
    messageDisplay.textContent = 'Viewing your cards...';
  } else if (gameState.phase === 'playing') {
    const currentPlayer = gameState.currentPlayerIndex;
    messageDisplay.textContent = currentPlayer === playerIndex ? 'Your turn!' : `Waiting for Player ${currentPlayer + 1}...`;
  }
}

