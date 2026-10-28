const socket = io();
let currentRoom = null;
let myPlayerIndex = null;

socket.on('roomCreated', (data) => {
  currentRoom = data.roomCode;
  document.getElementById('setupScreen').style.display = 'none';
  document.getElementById('lobbyScreen').style.display = 'block';
  document.getElementById('roomCode').textContent = currentRoom;
  updatePlayerList([]);
});

socket.on('playerJoined', (data) => {
  updatePlayerList(data.players);
});

socket.on('playerLeft', (data) => {
  updatePlayerList(data.players);
});

socket.on('gameStarted', (data) => {
  document.getElementById('lobbyScreen').style.display = 'none';
  document.getElementById('gameScreen').style.display = 'block';
  updateGameState(data);
});

socket.on('updateHands', (data) => {
  renderHands(data);
});

socket.on('drawnCardShow', (data) => {
  document.getElementById('drawnCardDisplay').textContent = 
    `${data.card.rank}${data.card.suit}`;
  document.getElementById('drawnCard').style.display = 'block';
});

socket.on('cardDrawn', (data) => {
  document.getElementById('gameLog').innerHTML += 
    `<p>${data.playerName} drew a card</p>`;
});

socket.on('cardSwapped', (data) => {
  document.getElementById('drawnCard').style.display = 'none';
  document.getElementById('gameLog').innerHTML += 
    `<p>${data.playerName} swapped card at position ${data.handIndex + 1}</p>`;
});

socket.on('cardDiscarded', (data) => {
  document.getElementById('discardTop').textContent = 
    `${data.card.rank}${data.card.suit}`;
  document.getElementById('gameLog').innerHTML += 
    `<p>${data.playerName} discarded ${data.card.rank}${data.card.suit}</p>`;
});

socket.on('turnEnded', (data) => {
  document.getElementById('currentPlayer').textContent = data.nextPlayer;
  document.getElementById('gameLog').innerHTML += 
    `<p>Turn ended. ${data.nextPlayer}'s turn</p>`;
});

socket.on('roundReset', (data) => {
  document.getElementById('gameLog').innerHTML = 
    `<p>Round ${data.round} started</p>`;
  updatePlayerList(data.players);
});

socket.on('gameOver', (data) => {
  let scoreText = '<h3>Final Scores:</h3>';
  data.scores.forEach(s => {
    scoreText += `<p>${s.name}: ${s.score}</p>`;
  });
  scoreText += `<p><strong>Winner: ${data.winner.name}</strong></p>`;
  document.getElementById('gameLog').innerHTML = scoreText;
});

socket.on('error', (data) => {
  alert(data.message);
});

function createRoom() {
  const playerName = document.getElementById('playerNameInput').value.trim();
  if (!playerName) {
    alert('Please enter your name');
    return;
  }
  socket.emit('createRoom', playerName);
}

function joinRoom() {
  const roomCode = document.getElementById('roomCodeInput').value.trim().toUpperCase();
  const playerName = document.getElementById('playerNameInput2').value.trim();
  if (!roomCode || !playerName) {
    alert('Please enter room code and name');
    return;
  }
  socket.emit('joinRoom', { roomCode, playerName });
  currentRoom = roomCode;
  document.getElementById('setupScreen').style.display = 'none';
  document.getElementById('lobbyScreen').style.display = 'block';
  document.getElementById('roomCode').textContent = roomCode;
}

function startGame() {
  socket.emit('startGame', currentRoom);
}

function drawCard() {
  socket.emit('drawCard', currentRoom);
}

function discardDrawn() {
  socket.emit('discardCard', { roomCode: currentRoom });
}

function swapCard(handIndex) {
  socket.emit('swapCard', { roomCode: currentRoom, handIndex });
}

function endTurn() {
  socket.emit('endTurn', currentRoom);
}

function callCabo() {
  socket.emit('callCabo', currentRoom);
}

function updatePlayerList(players) {
  const playerList = document.getElementById('playerList');
  playerList.innerHTML = players.map(p => `<li>${p.name}</li>`).join('');
}

function updateGameState(data) {
  document.getElementById('currentPlayer').textContent = data.currentPlayer;
  if (data.discardTop) {
    document.getElementById('discardTop').textContent = 
      `${data.discardTop.rank}${data.discardTop.suit}`;
  }
}

function renderHands(data) {
  const handsContainer = document.getElementById('handsContainer');
  handsContainer.innerHTML = '';

  data.forEach((playerData) => {
    const playerDiv = document.createElement('div');
    playerDiv.className = 'player-section';
    
    const playerName = document.createElement('h4');
    playerName.textContent = playerData.playerName;
    playerDiv.appendChild(playerName);

    const cardsDiv = document.createElement('div');
    cardsDiv.className = 'cards';

    playerData.hand.forEach((cardObj, cardIndex) => {
      const cardDiv = document.createElement('div');
      cardDiv.className = playerData.playerName === getCurrentPlayerName() ? 'card' : 'card-other';
      
      if (cardObj.isVisible) {
        cardDiv.textContent = `${cardObj.card.rank}${cardObj.card.suit}`;
        cardDiv.style.backgroundColor = '#fff';
        cardDiv.style.color = '#000';
        cardDiv.style.cursor = 'pointer';
        if (playerData.playerName === getCurrentPlayerName()) {
          cardDiv.onclick = () => swapCard(cardIndex);
        }
      } else {
        cardDiv.textContent = '?';
        cardDiv.style.backgroundColor = '#888';
        cardDiv.style.color = '#fff';
      }

      cardsDiv.appendChild(cardDiv);
    });

    playerDiv.appendChild(cardsDiv);
    handsContainer.appendChild(playerDiv);
  });
}

function getCurrentPlayerName() {
  return document.getElementById('currentPlayer').textContent;
}

