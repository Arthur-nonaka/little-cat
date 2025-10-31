import express from "express";
import http from "http";
import { WebSocketServer } from "ws";

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static("public"));

const rooms = {};
const DIRECTIONS = ["up", "down", "left", "right"];

function broadcast(roomId, data) {
  const room = rooms[roomId];
  if (!room) return;
  for (const p of room.players.values()) {
    p.ws.send(JSON.stringify(data));
  }
}

wss.on("connection", (ws) => {
  let playerId = Math.random().toString(36).substring(2, 9);
  let roomId;

  ws.on("message", (msg) => {
    const data = JSON.parse(msg);

    // Join
    if (data.type === "join") {
      roomId = data.room;
      if (!rooms[roomId]) rooms[roomId] = { players: new Map(), sequence: [], state: "waiting", turn: 0, currentPlayerIndex: 0 };
      rooms[roomId].players.set(playerId, { id: playerId, ws, lives: 3, ready: false, name: data.name || "Player" });

      broadcast(roomId, {
        type: "updatePlayers",
        players: Array.from(rooms[roomId].players.values()).map(p => ({ id: p.id, lives: p.lives, ready: p.ready, name: p.name }))
      });
    }

    // Ready
    if (data.type === "ready") {
      const room = rooms[roomId];
      if (!room) return;
      room.players.get(playerId).ready = true;

      broadcast(roomId, {
        type: "updatePlayers",
        players: Array.from(room.players.values()).map(p => ({ id: p.id, lives: p.lives, ready: p.ready }))
      });

      // Todos prontos
      if ([...room.players.values()].every(p => p.ready) && room.state === "waiting") {
        startGame(roomId);
      }
    }

    // Player input
    if (data.type === "input") {
      const room = rooms[roomId];
      if (!room || room.state !== "playerTurn") return;
      
      const playerArray = Array.from(room.players.values()).filter(p => p.lives > 0);
      const currentPlayer = playerArray[room.currentPlayerIndex];
      
      // Só aceita input do jogador da vez
      if (currentPlayer.id !== playerId) return;
      
      const player = room.players.get(playerId);
      const expected = room.sequence[room.currentInputIndex];
      const correct = data.dir === expected;

      // Feedback de acerto/erro
      broadcast(roomId, { 
        type: "playerMove", 
        id: playerId, 
        dir: data.dir, 
        correct,
        name: player.name 
      });

      if (!correct) {
        player.lives--;
        if (player.lives <= 0) {
          player.ws.send(JSON.stringify({ type: "dead" }));
          broadcast(roomId, { type: "playerDied", name: player.name });
        }
      }

      room.currentInputIndex++;
      
      // Se completou a sequência
      if (room.currentInputIndex >= room.sequence.length) {
        room.currentPlayerIndex++;
        
        // Se todos jogaram
        const alivePlayers = Array.from(room.players.values()).filter(p => p.lives > 0);
        if (room.currentPlayerIndex >= alivePlayers.length) {
          if (alivePlayers.length === 0) {
            gameOver(roomId);
          } else {
            nextRound(roomId);
          }
        } else {
          // Próximo jogador
          room.currentInputIndex = 0;
          const nextPlayer = alivePlayers[room.currentPlayerIndex];
          broadcast(roomId, { type: "nextPlayer", name: nextPlayer.name });
        }
      }

      broadcast(roomId, {
        type: "updatePlayers",
        players: Array.from(room.players.values()).map(p => ({ id: p.id, lives: p.lives, name: p.name }))
      });
    }
  });

  ws.on("close", () => {
    if (roomId && rooms[roomId]) {
      rooms[roomId].players.delete(playerId);
      broadcast(roomId, {
        type: "updatePlayers",
        players: Array.from(rooms[roomId].players.values()).map(p => ({ id: p.id, lives: p.lives, ready: p.ready }))
      });
    }
  });
});

function startGame(roomId) {
  const room = rooms[roomId];
  room.sequence = [];
  room.turn = 0;
  room.state = "showing";

  broadcast(roomId, { type: "countdown" });
  setTimeout(() => maestroShow(roomId), 3000);
}

function maestroShow(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  room.sequence.push(DIRECTIONS[Math.floor(Math.random() * 4)]);
  broadcast(roomId, { type: "newTurn", turn: room.turn + 1 });

  let i = 0;
  const interval = setInterval(() => {
    const dir = room.sequence[i];
    broadcast(roomId, { type: "maestroMove", dir });
    i++;
    if (i >= room.sequence.length) {
      clearInterval(interval);
      setTimeout(() => startPlayerTurn(roomId), 1000);
    }
  }, Math.max(400 - room.sequence.length * 20, 150));
}

function startPlayerTurn(roomId) {
  const room = rooms[roomId];
  room.state = "playerTurn";
  room.currentInputIndex = 0;
  room.currentPlayerIndex = 0;
  
  const alivePlayers = Array.from(room.players.values()).filter(p => p.lives > 0);
  if (alivePlayers.length === 0) {
    gameOver(roomId);
    return;
  }
  
  const firstPlayer = alivePlayers[0];
  broadcast(roomId, { type: "playerTurn", name: firstPlayer.name });
}

function nextRound(roomId) {
  const room = rooms[roomId];
  room.turn++;
  room.state = "showing";
  broadcast(roomId, { type: "roundComplete", turn: room.turn });
  setTimeout(() => maestroShow(roomId), 2000);
}

function gameOver(roomId) {
  const room = rooms[roomId];
  room.state = "gameOver";
  broadcast(roomId, { type: "gameOver", finalTurn: room.turn });
  
  // Limpar sala após 10 segundos
  setTimeout(() => {
    if (rooms[roomId]) {
      delete rooms[roomId];
    }
  }, 10000);
}

server.listen(3000, () => console.log("Servidor rodando em http://localhost:3000"));
