const socket = io();
let currentRoomId = null;
let playerId = null;
let isHost = false;
let gameState = null;

// Lobby
function createRoom() {
  const playerName = document.getElementById('playerNameInput').value.trim();
  if (!playerName) {
    alert('Please enter your name');
    return;
  }
  socket.emit('createRoom', playerName);
}

function joinRoom() {
  const roomId = document.getElementById('roomCodeInput').value.trim().toUpperCase();
  const playerName = document.getElementById('playerNameInput2').value.trim();
  if (!roomId || !playerName) {
    alert('Please enter room code and name');
    return;
  }
  socket.emit('joinRoom', { roomId, playerName });
}

socket.on('roomCreated', (data) => {
  currentRoomId = data.roomId;
  isHost = data.isHost;
  playerId = socket.id;
  document.getElementById('lobbySectionId').style.display = 'none';
  document.getElementById('waitingSectionId').style.display = 'block';
  document.getElementById('roomCodeDisplayId').textContent = data.roomId;
  document.getElementById('startGameButtonId').style.display = 'block';
});

socket.on('roomJoined', (data) => {
  currentRoomId = data.roomId;
  isHost = data.isHost;
  playerId = socket.id;
  document.getElementById('lobbySectionId').style.display = 'none';
  document.getElementById('waitingSectionId').style.display = 'block';
  document.getElementById('roomCodeDisplayId').textContent = data.roomId;
  document.getElementById('startGameButtonId').style.display = isHost ? 'block' : 'none';
});

socket.on('playerJoined', (data) => {
  const playerList = document.getElementById('playerListId');
  playerList.innerHTML = '';
  data.players.forEach(p => {
    const li = document.createElement('li');
    li.textContent = p.name;
    playerList.appendChild(li);
  });
});

function startGame() {
  socket.emit('startGame', currentRoomId);
}

socket.on('gameStarted', () => {
  document.getElementById('waitingSectionId').style.display = 'none';
  document.getElementById('gameSectionId').style.display = 'block';
});

// Game
socket.on('gameState', (state) => {
  gameState = state;
  renderGame();
});

function renderGame() {
  if (!gameState) return;

  const selfPlayer = gameState.players.find(p => p.isSelf);
  const otherPlayers = gameState.players.filter(p => !p.isSelf);

  // Render self hand
  const selfHandDiv = document.getElementById('selfHandId');
  selfHandDiv.innerHTML = '';
  if (selfPlayer) {
    selfPlayer.hand.forEach((card, index) => {
      const cardDiv = document.createElement('div');
      cardDiv.className = 'card';
      if (selfPlayer.handVisible[index]) {
        cardDiv.textContent = card.rank + card.suit;
        cardDiv.className += ' visible';
      } else {
        cardDiv.textContent = '?';
      }
      selfHandDiv.appendChild(cardDiv);
    });
  }

  // Render discard pile
  const discardDiv = document.getElementById('discardPileId');
  discardDiv.innerHTML = '';
  if (gameState.discardTop) {
    const cardDiv = document.createElement('div');
    cardDiv.className = 'card visible';
    cardDiv.textContent = gameState.discardTop.rank + gameState.discardTop.suit;
    discardDiv.appendChild(cardDiv);
  }

  // Render opponents
  const opponentsDiv = document.getElementById('opponentsId');
  opponentsDiv.innerHTML = '';
  otherPlayers.forEach((player, idx) => {
    const playerDiv = document.createElement('div');
    playerDiv.className = 'opponent-section';
    playerDiv.innerHTML = `<h4>${player.name}</h4>`;
    const handDiv = document.createElement('div');
    handDiv.className = 'opponent-hand';
    player.hand.forEach((card, cardIdx) => {
      const cardDiv = document.createElement('div');
      cardDiv.className = 'card';
      cardDiv.textContent = '?';
      handDiv.appendChild(cardDiv);
    });
    playerDiv.appendChild(handDiv);
    opponentsDiv.appendChild(playerDiv);
  });

  // Update turn info
  const currentPlayerName = gameState.players[gameState.currentPlayerIndex].name;
  document.getElementById('turnInfoId').textContent = `Current Turn: ${currentPlayerName}`;

  // Enable/disable buttons
  const isMyTurn = gameState.currentPlayerIndex === gameState.players.findIndex(p => p.isSelf);
  document.getElementById('drawCardButtonId').disabled = !isMyTurn;
  document.getElementById('takeDiscardButtonId').disabled = !isMyTurn;
}

function drawCard() {
  socket.emit('drawCard', currentRoomId);
}

function takeDiscard() {
  socket.emit('drawCard', currentRoomId);
}

function swapCardInHand(index) {
  socket.emit('swapCard', { roomId: currentRoomId, handIndex: index });
}

function discardDrawnCard() {
  socket.emit('discardCard', currentRoomId);
}

socket.on('cardDrawn', (data) => {
  const drawnCardDiv = document.getElementById('drawnCardId');
  drawnCardDiv.innerHTML = '';
  const cardDiv = document.createElement('div');
  cardDiv.className = 'card visible';
  cardDiv.textContent = data.card.rank + data.card.suit;
  drawnCardDiv.appendChild(cardDiv);

  document.getElementById('swapOptionsId').style.display = 'block';
});

socket.on('cardPeeked', (data) => {
  alert(`You peeked at card: ${data.card.rank}${data.card.suit}`);
});

socket.on('cardPeekedForSwap', (data) => {
  alert(`You peeked at opponent's card: ${data.card.rank}${data.card.suit}`);
});

socket.on('gameEnded', (data) => {
  alert('Game Over! Final Scores:\n' + Object.entries(data.totalScores).map(([id, score]) => `${score}`).join('\n'));
  location.reload();
});

socket.on('newRound', (data) => {
  document.getElementById('drawnCardId').innerHTML = '';
  document.getElementById('swapOptionsId').style.display = 'none';
});

socket.on('error', (message) => {
  alert('Error: ' + message);
});

socket.on('playerLeft', () => {
  alert('A player has left the game');
  location.reload();
});

