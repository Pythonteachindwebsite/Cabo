const socket = io();
let currentRoomCode = '';
let mySocketId = '';
let gameState = 'menu';
let myPlayerIndex = -1;

socket.on('connect', () => {
  mySocketId = socket.id;
});

socket.on('playerJoined', (data) => {
  updatePlayerList(data.players, data.count);
});

socket.on('gameStarted', (data) => {
  gameState = 'confirming';
  document.getElementById('menu').style.display = 'none';
  document.getElementById('game').style.display = 'block';
  myPlayerIndex = data.players.findIndex(p => p.name === document.getElementById('playerName').value);
  
  displayMyHand(data.hand, data.faceUpCards);
  setTimeout(() => {
    revealInitialCards(data.hand, data.faceUpCards);
  }, 100);
});

socket.on('allPlayersConfirmed', (data) => {
  gameState = 'playing';
  document.getElementById('confirmBtn').style.display = 'none';
  document.getElementById('gameControls').style.display = 'block';
  updateGameDisplay(data);
});

socket.on('cardDrawn', (data) => {
  if (data.playerSocketId === mySocketId) {
    displayDrawnCard(data.card);
  }
});

socket.on('cardDiscarded', (data) => {
  updateMyHand(data.hand);
  updateDiscardPile(data.discardTop);
});

socket.on('turnChanged', (data) => {
  document.getElementById('currentPlayer').textContent = data.currentPlayerName;
  if (myPlayerIndex !== data.currentTurnIndex) {
    document.getElementById('gameControls').style.display = 'none';
  } else {
    document.getElementById('gameControls').style.display = 'block';
  }
});

socket.on('CABOCalled', (data) => {
  alert(data.playerName + ' called CABO!');
});

socket.on('roundEnded', (data) => {
  displayScores(data.scores);
  if (data.nextRound) {
    gameState = 'confirming';
    socket.emit('startGame', currentRoomCode);
  }
});

socket.on('gameEnded', (data) => {
  alert('Game Over! ' + data.winner + ' wins!\nFinal Scores:\n' + 
    data.scores.map(s => s.name + ': ' + s.totalScore).join('\n'));
  gameState = 'menu';
  document.getElementById('game').style.display = 'none';
  document.getElementById('menu').style.display = 'block';
});

function displayMyHand(hand, faceUpCards) {
  const handDisplay = document.getElementById('myHand');
  handDisplay.innerHTML = '';
  hand.forEach((card, index) => {
    const cardEl = document.createElement('div');
    cardEl.className = 'card';
    if (faceUpCards[index]) {
      cardEl.textContent = card.rank + card.suit;
    } else {
      cardEl.textContent = '?';
    }
    cardEl.id = 'card-' + index;
    handDisplay.appendChild(cardEl);
  });
}

function revealInitialCards(hand, faceUpCards) {
  faceUpCards.forEach((isFaceUp, index) => {
    if (isFaceUp) {
      document.getElementById('card-' + index).textContent = hand[index].rank + hand[index].suit;
    }
  });
  
  setTimeout(() => {
    faceUpCards.forEach((isFaceUp, index) => {
      if (isFaceUp) {
        document.getElementById('card-' + index).textContent = '?';
      }
    });
  }, 2000);
}

function displayDrawnCard(card) {
  document.getElementById('drawnCard').textContent = card.rank + card.suit;
  document.getElementById('drawnCard').style.display = 'block';
}

function updateMyHand(hand) {
  const handDisplay = document.getElementById('myHand');
  handDisplay.innerHTML = '';
  hand.forEach((card, index) => {
    const cardEl = document.createElement('div');
    cardEl.className = 'card';
    cardEl.textContent = '?';
    cardEl.id = 'card-' + index;
    handDisplay.appendChild(cardEl);
  });
}

function updateDiscardPile(card) {
  document.getElementById('discardTop').textContent = card.rank + card.suit;
}

function updateGameDisplay(data) {
  document.getElementById('currentPlayer').textContent = data.currentPlayerName;
  updateDiscardPile(data.discardTop);
}

function updatePlayerList(players, count) {
  const list = document.getElementById('playerList');
  list.innerHTML = players.map(p => '<div>' + p.name + '</div>').join('');
  document.getElementById('playerCount').textContent = count + '/4';
}

function displayScores(scores) {
  alert('Round Scores:\n' + scores.map(s => s.name + ': ' + s.roundScore + ' (Total: ' + s.totalScore + ')').join('\n'));
}

document.getElementById('createRoomBtn').addEventListener('click', () => {
  const playerName = document.getElementById('playerName').value;
  const roomCode = document.getElementById('roomCode').value || Math.random().toString(36).substr(2, 6);
  currentRoomCode = roomCode;
  socket.emit('createRoom', roomCode, playerName);
  document.getElementById('menu').style.display = 'none';
  document.getElementById('waitingRoom').style.display = 'block';
});

document.getElementById('startGameBtn').addEventListener('click', () => {
  socket.emit('startGame', currentRoomCode);
});

document.getElementById('confirmBtn').addEventListener('click', () => {
  socket.emit('confirmCards', currentRoomCode);
});

document.getElementById('drawBtn').addEventListener('click', () => {
  socket.emit('drawCard', currentRoomCode);
});

document.getElementById('discardBtn').addEventListener('click', () => {
  const cardIndex = prompt('Card index to discard (0-3):');
  socket.emit('discardCard', currentRoomCode, parseInt(cardIndex), -1);
});

document.getElementById('callCABOBtn').addEventListener('click', () => {
  socket.emit('callCABO', currentRoomCode);
});

document.getElementById('endTurnBtn').addEventListener('click', () => {
  socket.emit('endTurn', currentRoomCode);
});

