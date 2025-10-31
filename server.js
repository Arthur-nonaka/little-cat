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
      rooms[roomId].players.set(playerId, { id: playerId, ws, lives: 3, ready: false, name: data.name || "Player", skin: data.skin || "1" });

      broadcast(roomId, {
        type: "updatePlayers",
        players: Array.from(rooms[roomId].players.values()).map(p => ({ id: p.id, lives: p.lives, ready: p.ready, name: p.name, skin: p.skin }))
      });
    }

    // Ready
    if (data.type === "ready") {
      const room = rooms[roomId];
      if (!room) return;
      room.players.get(playerId).ready = true;

      broadcast(roomId, {
        type: "updatePlayers",
        players: Array.from(room.players.values()).map(p => ({ id: p.id, lives: p.lives, ready: p.ready, name: p.name, skin: p.skin }))
      });

      // Todos prontos
      if ([...room.players.values()].every(p => p.ready) && room.state === "waiting") {
        startGame(roomId);
      }
    }
    
    // Reset room
    if (data.type === "reset") {
      const room = rooms[roomId];
      if (!room) return;
      
      // Reset all players
      for (const [pid, player] of room.players.entries()) {
        player.lives = 3;
        player.ready = false;
      }
      
      room.sequence = [];
      room.turn = 0;
      room.state = "waiting";
      room.playerInputs = new Map();
      room.playerErrors = new Map();
      
      broadcast(roomId, {
        type: "gameReset"
      });
      
      broadcast(roomId, {
        type: "updatePlayers",
        players: Array.from(room.players.values()).map(p => ({ id: p.id, lives: p.lives, ready: p.ready, name: p.name }))
      });
    }

    // Player input
    if (data.type === "input") {
      const room = rooms[roomId];
      if (!room || room.state !== "playerTurn") return;
      
      const player = room.players.get(playerId);
      if (!player || player.lives <= 0) return;
      
      // Initialize player inputs if not exists
      if (!room.playerInputs.has(playerId)) {
        room.playerInputs.set(playerId, []);
      }
      
      // Check if player already made an error this turn
      if (!room.playerErrors) {
        room.playerErrors = new Map();
      }
      
      const playerSequence = room.playerInputs.get(playerId);
      const inputIndex = playerSequence.length;
      const expected = room.sequence[inputIndex];
      const correct = data.dir === expected;
      
      const alreadyErrored = room.playerErrors.get(playerId) || false;

      // Check timing
      let timingCorrect = true;
      if (room.rhythmTimer && !alreadyErrored) {
        const currentTime = Date.now();
        const timeSinceStart = currentTime - room.rhythmTimer.startTime;
        const expectedMoveTime = inputIndex * room.rhythmTimer.moveInterval;
        const timeDifference = timeSinceStart - expectedMoveTime;
        
        // Timing window: allows pressing slightly before or after the maestro move
        const earlyTolerance = 100; // Can press 100ms before maestro move
        const lateTolerance = 600;  // Can press 600ms after
        
        if (timeDifference < -earlyTolerance) {
          // Too early
          timingCorrect = false;
          broadcast(roomId, {
            type: "timingError",
            name: player.name,
            error: "early"
          });
        } else if (timeDifference > lateTolerance) {
          // Too late
          timingCorrect = false;
          broadcast(roomId, {
            type: "timingError",
            name: player.name,
            error: "late"
          });
        }
      }

      playerSequence.push(data.dir);

      // Feedback de acerto/erro
      broadcast(roomId, { 
        type: "playerMove", 
        id: playerId, 
        dir: data.dir, 
        correct: correct && timingCorrect,
        name: player.name 
      });

      // Only lose life once per turn
      if ((!correct || !timingCorrect) && !alreadyErrored) {
        player.lives--;
        room.playerErrors.set(playerId, true); // Mark that player made an error this turn
        
        if (player.lives <= 0) {
          player.ws.send(JSON.stringify({ type: "dead" }));
          broadcast(roomId, { type: "playerDied", name: player.name });
        }
      }

      // Check if this player completed the sequence
      if (playerSequence.length >= room.sequence.length) {
        // Check if all alive players have completed their sequences
        const alivePlayers = Array.from(room.players.values()).filter(p => p.lives > 0);
        const allCompleted = alivePlayers.every(p => {
          const inputs = room.playerInputs.get(p.id);
          return inputs && inputs.length >= room.sequence.length;
        });

        if (allCompleted) {
          if (alivePlayers.length === 0) {
            gameOver(roomId);
          } else {
            nextRound(roomId);
          }
        }
      }

      broadcast(roomId, {
        type: "updatePlayers",
        players: Array.from(room.players.values()).map(p => ({ id: p.id, lives: p.lives, ready: p.ready, name: p.name, skin: p.skin }))
      });
    }
  });

  ws.on("close", () => {
    if (roomId && rooms[roomId]) {
      rooms[roomId].players.delete(playerId);
      broadcast(roomId, {
        type: "updatePlayers",
        players: Array.from(rooms[roomId].players.values()).map(p => ({ id: p.id, lives: p.lives, ready: p.ready, name: p.name, skin: p.skin }))
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

  // Generate new sequence (not adding to old one)
  const sequenceLength = Math.min(3 + Math.floor(room.turn / 2), 10); // Increases slower: 3, 3, 4, 4, 5, 5, ...
  room.sequence = [];
  for (let i = 0; i < sequenceLength; i++) {
    room.sequence.push(DIRECTIONS[Math.floor(Math.random() * 4)]);
  }
  
  broadcast(roomId, { type: "newTurn", turn: room.turn + 1 });

  let i = 0;
  // Slower timing between moves (600ms base, decreases slower)
  const baseInterval = Math.max(600 - room.turn * 20, 400);
  
  const interval = setInterval(() => {
    const dir = room.sequence[i];
    broadcast(roomId, { type: "maestroMove", dir, index: i });
    i++;
    if (i >= room.sequence.length) {
      clearInterval(interval);
      setTimeout(() => startPlayerTurn(roomId), 1500); // More time before player turn
    }
  }, baseInterval);
}

function startPlayerTurn(roomId) {
  const room = rooms[roomId];
  room.state = "playerTurn";
  room.currentInputIndex = 0;
  room.playerInputs = new Map(); // Track each player's inputs
  room.playerErrors = new Map(); // Track errors per player this turn
  
  const alivePlayers = Array.from(room.players.values()).filter(p => p.lives > 0);
  if (alivePlayers.length === 0) {
    gameOver(roomId);
    return;
  }
  
  // Calculate timing window (increases with sequence length)
  const baseInterval = Math.max(600 - room.turn * 20, 400);
  const timingWindow = baseInterval * room.sequence.length;
  const moveInterval = baseInterval;
  
  broadcast(roomId, { 
    type: "playerTurn", 
    sequence: room.sequence,
    timingWindow: timingWindow
  });
  
  // Countdown before starting (faster countdown - 700ms each)
  broadcast(roomId, { type: "playerCountdown", count: 3 });
  
  setTimeout(() => {
    broadcast(roomId, { type: "playerCountdown", count: 2 });
  }, 700);
  
  setTimeout(() => {
    broadcast(roomId, { type: "playerCountdown", count: 1 });
  }, 1400);
  
  setTimeout(() => {
    // Send GO with first move preview
    broadcast(roomId, { 
      type: "playerCountdown", 
      count: 0,
      firstMove: room.sequence[0] // Send first move to show on GO
    });
    
    // Start rhythm checking timer AFTER countdown AND first move starts
    setTimeout(() => {
      room.rhythmTimer = {
        startTime: Date.now(),
        moveInterval: moveInterval,
        lastCheckIndex: 0
      };
    }, 100); // Small delay to sync with first maestro move
    
    // Maestro shows the sequence again while players play (starting from index 1 to skip first move already shown)
    let i = 1; // Start from 1 instead of 0
    const maestroInterval = setInterval(() => {
      if (i < room.sequence.length) {
        const dir = room.sequence[i];
        broadcast(roomId, { type: "maestroMove", dir, index: i });
        i++;
      } else {
        clearInterval(maestroInterval);
      }
    }, baseInterval);
    
    // Check for missed inputs after the timing window
    setTimeout(() => {
      checkMissedInputs(roomId);
    }, timingWindow + 1000);
  }, 2100);
}

function checkMissedInputs(roomId) {
  const room = rooms[roomId];
  if (!room || room.state !== "playerTurn") return;
  
  const alivePlayers = Array.from(room.players.values()).filter(p => p.lives > 0);
  
  alivePlayers.forEach(player => {
    const playerInputs = room.playerInputs.get(player.id) || [];
    const missedMoves = room.sequence.length - playerInputs.length;
    const alreadyErrored = room.playerErrors.get(player.id) || false;
    
    if (missedMoves > 0 && !alreadyErrored) {
      // Player missed some moves - lose life for not keeping rhythm (only if didn't already lose life this turn)
      player.lives--;
      broadcast(roomId, {
        type: "rhythmMiss",
        name: player.name,
        missedMoves: missedMoves
      });
      
      if (player.lives <= 0) {
        player.ws.send(JSON.stringify({ type: "dead" }));
        broadcast(roomId, { type: "playerDied", name: player.name });
      }
    }
  });
  
  // Check if game should continue
  const stillAlive = Array.from(room.players.values()).filter(p => p.lives > 0);
  
  // If only 1 player alive, reset the game
  if (stillAlive.length === 1) {
    const winner = stillAlive[0];
    broadcast(roomId, {
      type: "winner",
      name: winner.name,
      turn: room.turn
    });
    
    // Reset game after showing winner
    setTimeout(() => {
      resetGame(roomId);
    }, 3000);
  } else if (stillAlive.length === 0) {
    gameOver(roomId);
  } else {
    nextRound(roomId);
  }
  
  broadcast(roomId, {
    type: "updatePlayers",
    players: Array.from(room.players.values()).map(p => ({ id: p.id, lives: p.lives, name: p.name, skin: p.skin }))
  });
}

function resetGame(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  
  // Reset all players
  for (const [pid, player] of room.players.entries()) {
    player.lives = 3;
    player.ready = false; // Players need to click ready again
  }
  
  room.sequence = [];
  room.turn = 0;
  room.state = "waiting";
  room.playerInputs = new Map();
  room.playerErrors = new Map();
  
  broadcast(roomId, {
    type: "gameReset"
  });
  
  broadcast(roomId, {
    type: "updatePlayers",
    players: Array.from(room.players.values()).map(p => ({ id: p.id, lives: p.lives, ready: p.ready, name: p.name, skin: p.skin }))
  });
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
