const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

// room code -> { players: { X: socketId, O: socketId }, board: [...], turn: 'X'|'O' }
const rooms = {};

// socket ids currently waiting for a random opponent
const waitingQueue = [];

function makeRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no confusing chars
  let code;
  do {
    code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  } while (rooms[code]);
  return code;
}

function checkWinner(board) {
  const lines = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6],
  ];
  for (const [a, b, c] of lines) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { winner: board[a], line: [a, b, c] };
    }
  }
  if (board.every((cell) => cell)) return { winner: "draw", line: null };
  return null;
}

function removeFromQueue(socketId) {
  const idx = waitingQueue.indexOf(socketId);
  if (idx !== -1) waitingQueue.splice(idx, 1);
}

function startGame(code, xSocketId, oSocketId) {
  rooms[code] = {
    players: { X: xSocketId, O: oSocketId },
    board: Array(9).fill(null),
    turn: "X",
  };
  const xSocket = io.sockets.sockets.get(xSocketId);
  const oSocket = io.sockets.sockets.get(oSocketId);
  if (xSocket) { xSocket.join(code); xSocket.data.room = code; xSocket.data.symbol = "X"; }
  if (oSocket) { oSocket.join(code); oSocket.data.room = code; oSocket.data.symbol = "O"; }

  const payload = { board: rooms[code].board, turn: rooms[code].turn };
  if (xSocket) xSocket.emit("game-start", { ...payload, symbol: "X" });
  if (oSocket) oSocket.emit("game-start", { ...payload, symbol: "O" });
}

io.on("connection", (socket) => {
  // ---------- Play with a friend via room code ----------
  socket.on("create-room", () => {
    const code = makeRoomCode();
    rooms[code] = {
      players: { X: socket.id, O: null },
      board: Array(9).fill(null),
      turn: "X",
    };
    socket.join(code);
    socket.data.room = code;
    socket.data.symbol = "X";
    socket.emit("room-created", { code });
  });

  socket.on("join-room", (code) => {
    code = (code || "").toUpperCase().trim();
    const room = rooms[code];
    if (!room) {
      socket.emit("join-error", "Комната не найдена. Проверь код.");
      return;
    }
    if (room.players.O) {
      socket.emit("join-error", "В этой комнате уже два игрока.");
      return;
    }
    room.players.O = socket.id;
    socket.join(code);
    socket.data.room = code;
    socket.data.symbol = "O";
    const xSocket = io.sockets.sockets.get(room.players.X);
    const payload = { board: room.board, turn: room.turn };
    if (xSocket) xSocket.emit("game-start", { ...payload, symbol: "X" });
    socket.emit("game-start", { ...payload, symbol: "O" });
  });

  // ---------- Play with a random opponent ----------
  socket.on("find-random", () => {
    // clear any stale ids left over from disconnected sockets
    while (waitingQueue.length && !io.sockets.sockets.get(waitingQueue[0])) {
      waitingQueue.shift();
    }
    if (waitingQueue.length) {
      const opponentId = waitingQueue.shift();
      if (opponentId === socket.id) {
        // safety: don't pair a player with themselves
        waitingQueue.push(socket.id);
        socket.emit("waiting-random");
        return;
      }
      const code = makeRoomCode();
      startGame(code, opponentId, socket.id);
    } else {
      waitingQueue.push(socket.id);
      socket.emit("waiting-random");
    }
  });

  socket.on("cancel-random", () => {
    removeFromQueue(socket.id);
  });

  // ---------- Gameplay ----------
  socket.on("make-move", (index) => {
    const code = socket.data.room;
    const room = rooms[code];
    if (!room) return;
    const symbol = socket.data.symbol;
    if (room.turn !== symbol) return; // не твой ход
    if (room.board[index]) return; // клетка занята
    if (!room.players.X || !room.players.O) return; // ждём второго игрока

    room.board[index] = symbol;
    const result = checkWinner(room.board);
    room.turn = symbol === "X" ? "O" : "X";

    io.to(code).emit("move-made", {
      board: room.board,
      turn: room.turn,
      result,
    });
  });

  socket.on("rematch", () => {
    const code = socket.data.room;
    const room = rooms[code];
    if (!room) return;
    room.board = Array(9).fill(null);
    room.turn = "X";
    io.to(code).emit("game-start", { board: room.board, turn: room.turn, symbol: null, keepSymbol: true });
  });

  socket.on("disconnect", () => {
    removeFromQueue(socket.id);
    const code = socket.data.room;
    if (code && rooms[code]) {
      socket.to(code).emit("opponent-left");
      delete rooms[code];
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Сервер запущен на порту ${PORT}`));
