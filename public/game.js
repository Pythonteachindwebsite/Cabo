const socket = io();

let currentRoom = null;
let currentUsername = null;
let gameState = 'menu';
let myHand = [];
let drawnCard = null;
let discardTopCard = null;

// Screen Management
function showScreen(screenName) {
  document.querySelectorAll('.screen').forEach(s => s.style.display = 'none');
  document.getElementById(screenName).style.display = 'flex';
  gameState = screenName;
}

// Main Menu
document.getElementById('createRoomBtn').addEventListener('click', () => {
  const username = document.getElementById('usernameInput').value.trim();
  if (!username) {
    alert('Please enter a username');
    return;
  }
  currentUsername = username;
  socket.emit('createRoom', username);
});

document.getElementById('joinRoomBtn').addEventListener('click', () => {
  const username = document.getElementById('usernameInput').value.trim();
  if (!username) {
    alert('Please enter a username');
    return;
  }
  const roomCode = prompt('Enter room code:');
  if (roomCode) {
    currentUsername = username;
    socket.emit('joinRoom', { roomCode, username });
  }
});

// Room Screen
document.getElementById('startGameBtn').addEventListener('click', () => {
  socket.emit('startGame', currentRoom);
});

document.getElementById('leaveRoomBtn').addEventListener('click', () => {
  socket.emit('leaveRoom', currentRoom);
  showScreen('menu');
  currentRoom = null;
});

// Game Screen
document.getElementById('confirmCardsBtn').addEventListener('click', () => {
  socket.emit('confirmCards', currentRoom);
});

document.getElementById('drawCardBtn').addEventListener('click', () => {
  socket.emit('drawCard', currentRoom);
});

document.getElementById('caboBton').addEventListener('click', () => {
  socket.emit('callCabo', currentRoom);
});

// Card Swapping
function setupCardClickListeners() {
  document.querySelectorAll('.card-slot').forEach(slot => {
    slot.addEventListener('click', () => {
      const position = parseInt(slot.dataset.position);
      if (drawnCard) {
        socket.emit('swapOrDiscard', {
          roomCode: currentRoom,
          action: 'swap',
          cardPosition: position,
          drawnCard: drawnCard
        });
        drawnCard = null;
        document.getElementById('drawnCardDisplay').innerHTML = '';
      }
    });
  });
}

document.getElementById('discardBtn').addEventListener('click', () => {
  if (drawnCard) {
    socket.emit('swapOrDiscard', {
      roomCode: currentRoom,
      action: 'discard',
      cardPosition: null,
      drawnCard: drawnCard
    });
    drawnCard = null;
    document.getElementById('drawnCardDisplay').innerHTML = '';
  }
});

// Socket Events
socket.on('roomCreated', (data) => {
  currentRoom = data.roomCode;
  document.getElementById('roomCodeDisplay').textContent = data.roomCode;
  showScreen('room');
});

socket.on('joinSuccess', (data) => {
  currentRoom = data.roomCode;
  document.getElementById('roomCodeDisplay').textContent = data.roomCode;
  showScreen('room');
});

socket.on('joinError', (msg) => {
  alert(msg);
});

socket.on('playerListUpdated', (data) => {
  const list = document.getElementById('playerList');
  list.innerHTML = '';
  data.players.forEach(p => {
    const item = document.createElement('div');
    item.textContent = p.username;
    list.appendChild(item);
  });
  const startBtn = document.getElementById('startGameBtn');
  startBtn.disabled = data.players.length < 2;
});

socket.on('gameStarted', (data) => {
  myHand = data.yourHand;
  renderInitialHand();
  showScreen('game');
});

function renderInitialHand() {
  const handContainer = document.getElementById('handContainer');
  handContainer.innerHTML = '';
  myHand.forEach((slot, i) => {
    const div = document.createElement('div');
    div.className = 'card-slot';
    div.dataset.position = i;
    const faceUpClass = slot.faceUp ? 'face-up' : 'face-down';
    if (slot.faceUp) {
      div.innerHTML = `<div class="card ${faceUpClass}"><span>${slot.card.rank}${slot.card.suit}</span></div>`;
    } else {
      div.innerHTML = `<div class="card face-down">?</div>`;
    }
    handContainer.appendChild(div);
  });
  setupCardClickListeners();
}

document.getElementById('confirmCardsBtn').addEventListener('click', () => {
  // Flip initial cards face down after 2 seconds
  setTimeout(() => {
    myHand.forEach(h => h.faceUp = false);
    renderInitialHand();
  }, 2000);
  socket.emit('confirmCards', currentRoom);
});

socket.on('gameReady', (data) => {
  discardTopCard = data.discardTop;
  document.getElementById('discardPile').innerHTML = `<div class="card"><span>${data.discardTop.rank}${data.discardTop.suit}</span></div>`;
  document.getElementById('currentPlayerDisplay').textContent = `Current: ${data.currentPlayer}`;
});

socket.on('cardDrawn', (data) => {
  drawnCard = data.card;
  document.getElementById('drawnCardDisplay').innerHTML = `<div class="card"><span>${drawnCard.rank}${drawnCard.suit}</span></div>`;
  document.getElementById('drawCardBtn').disabled = true;
});

socket.on('gameUpdated', (data) => {
  discardTopCard = data.discardTop;
  document.getElementById('discardPile').innerHTML = `<div class="card"><span>${data.discardTop.rank}${data.discardTop.suit}</span></div>`;
  document.getElementById('drawnCardDisplay').innerHTML = '';
  document.getElementById('drawCardBtn').disabled = false;
  drawnCard = null;
});

socket.on('gameEnded', (data) => {
  let scoreText = `CABO called by: ${data.caboCaller}\n\nScores:\n`;
  data.scores.forEach(s => {
    scoreText += `${s.username}: ${s.score}\n`;
  });
  alert(scoreText);
  showScreen('menu');
  currentRoom = null;
});

socket.on('error', (msg) => alert(msg));

