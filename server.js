const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();: const fs = require("fs");
app.get("/debug", (req, res) => {
  res.json({
    __dirname,
    rootFiles: fs.readdirSync(__dirname),
    publicExists: fs.existsSync(path.join(__dirname, "public")),
    publicFiles: fs.existsSync(path.join(__dirname, "public"))
      ? fs.readdirSync(path.join(__dirname, "public"))
      : null,
  });
});
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

// room code -> { players: [socketId, socketId], board: [...], turn: 'X'|'O' }
const rooms = {};

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

io.on("connection", (socket) => {
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
    io.to(code).emit("game-start", { board: room.board, turn: room.turn });
  });

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
    io.to(code).emit("game-start", { board: room.board, turn: room.turn });
  });

  socket.on("disconnect", () => {
    const code = socket.data.room;
    if (code && rooms[code]) {
      socket.to(code).emit("opponent-left");
      delete rooms[code];
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Сервер запущен на порту ${PORT}`));
