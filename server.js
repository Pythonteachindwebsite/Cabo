const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "*" }
});

app.use(express.static('public'));

// 房間管理
const rooms = {};

io.on('connection', (socket) => {
  console.log(`玩家連接: ${socket.id}`);

  // 建立房間
  socket.on('createRoom', (playerName, callback) => {
    const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    rooms[roomId] = {
      id: roomId,
      players: [{ id: socket.id, name: playerName }],
      gameStarted: false
    };
    socket.join(roomId);
    socket.roomId = roomId;
    console.log(`房間建立: ${roomId}, 玩家: ${playerName}`);
    callback({ success: true, roomId: roomId });
  });

  // 加入房間
  socket.on('joinRoom', (roomId, playerName, callback) => {
    if (!rooms[roomId]) {
      callback({ success: false, message: '房間不存在' });
      return;
    }
    if (rooms[roomId].players.length >= 4) {
      callback({ success: false, message: '房間已滿' });
      return;
    }
    rooms[roomId].players.push({ id: socket.id, name: playerName });
    socket.join(roomId);
    socket.roomId = roomId;
    io.to(roomId).emit('playerJoined', rooms[roomId].players);
    console.log(`玩家加入房間 ${roomId}: ${playerName}`);
    callback({ success: true, roomId: roomId, players: rooms[roomId].players });
  });

  // 開始遊戲
  socket.on('startGame', (callback) => {
    const roomId = socket.roomId;
    if (rooms[roomId]) {
      rooms[roomId].gameStarted = true;
      io.to(roomId).emit('gameStarted', rooms[roomId].players);
      console.log(`房間 ${roomId} 遊戲開始`);
      callback({ success: true });
    }
  });

  // 斷線
  socket.on('disconnect', () => {
    const roomId = socket.roomId;
    if (roomId && rooms[roomId]) {
      rooms[roomId].players = rooms[roomId].players.filter(p => p.id !== socket.id);
      if (rooms[roomId].players.length === 0) {
        delete rooms[roomId];
        console.log(`房間 ${roomId} 已刪除`);
      } else {
        io.to(roomId).emit('playerLeft', rooms[roomId].players);
        console.log(`玩家離開房間 ${roomId}`);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Cabo 遊戲伺服器運行於 http://localhost:${PORT}`);
});
