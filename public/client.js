const ws = new WebSocket(`ws://${location.host}`);
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const nameInput = document.getElementById("name");
const roomInput = document.getElementById("room");
const skinSelect = document.getElementById("skinSelect");
const joinBtn = document.getElementById("join");
const readyBtn = document.getElementById("ready");
const statusEl = document.getElementById("status");
const hud = document.getElementById("hud");
const logContainer = document.getElementById("logContainer");
const logList = document.getElementById("logList");

let playerId;
let players = [];
let maestroAnim = "idle";
let animFrame = 0;
let animTime = 0;
let gameState = "waiting";
let playerName = "";
let playerSkin = "1";
let isReady = false;
let playerAnimations = {}; // {playerId: {anim: "idle", time: 0}}
let currentSequence = [];
let sequenceIndex = 0;
let showingSequence = false;
let timingIndicators = []; // Array of timing circles to show
let tinSound = new Audio("/tin.mp3");

const animConfig = {
  maestro: {
    idle:{src:"/sprites/maestro/idle.png",frameW:64,frameH:64,frames:16,speed:200},
    up:{src:"/sprites/maestro/up.png",frameW:64,frameH:64,frames:1,speed:120},
    down:{src:"/sprites/maestro/down.png",frameW:64,frameH:64,frames:1,speed:120},
    left:{src:"/sprites/maestro/left.png",frameW:64,frameH:64,frames:1,speed:120},
    right:{src:"/sprites/maestro/right.png",frameW:64,frameH:64,frames:1,speed:120},
  },
  player: {
    "1": {
      idle:{src:"/sprites/player/1/idle.png",frameW:32,frameH:32,frames:9,speed:200},
      up:{src:"/sprites/player/1/up.png",frameW:96,frameH:96,frames:1,speed:120},
      down:{src:"/sprites/player/1/down.png",frameW:32,frameH:32,frames:4,speed:120},
      left:{src:"/sprites/player/1/left.png",frameW:96,frameH:96,frames:1,speed:120},
      right:{src:"/sprites/player/1/right.png",frameW:96,frameH:96,frames:1,speed:120},
    },
    "2": {
      idle:{src:"/sprites/player/2/idle.png",frameW:32,frameH:32,frames:5,speed:200},
      up:{src:"/sprites/player/2/up.png",frameW:32,frameH:32,frames:1,speed:120},
      down:{src:"/sprites/player/2/down.png",frameW:32,frameH:32,frames:7,speed:120},
      left:{src:"/sprites/player/2/left.png",frameW:32,frameH:32,frames:1,speed:120},
      right:{src:"/sprites/player/2/right.png",frameW:32,frameH:32,frames:1,speed:120},
    },
    "3": {
      idle:{src:"/sprites/player/3/idle.png",frameW:32,frameH:32,frames:5,speed:200},
      up:{src:"/sprites/player/3/up.png",frameW:32,frameH:32,frames:1,speed:120},
      down:{src:"/sprites/player/3/down.png",frameW:32,frameH:32,frames:7,speed:120},
      left:{src:"/sprites/player/3/left.png",frameW:32,frameH:32,frames:1,speed:120},
      right:{src:"/sprites/player/3/right.png",frameW:32,frameH:32,frames:1,speed:120},
    }
  }
};

const sprites = {maestro:{}, player:{"1":{}, "2":{}, "3":{}}};
// Load maestro sprites
for(const k in animConfig.maestro){ 
  const img=new Image(); 
  img.src=animConfig.maestro[k].src; 
  sprites.maestro[k]=img;
}
// Load player sprites for each skin
for(const skin in animConfig.player){
  for(const k in animConfig.player[skin]){ 
    const img=new Image(); 
    img.src=animConfig.player[skin][k].src; 
    sprites.player[skin][k]=img;
  }
}

function addLog(message, type = "info") {
  const entry = document.createElement("div");
  entry.className = `logEntry ${type}`;
  const time = new Date().toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit', second: '2-digit'});
  entry.innerHTML = `<small>${time}</small><br>${message}`;
  logList.insertBefore(entry, logList.firstChild);
  
  // Limit to 50 entries
  while(logList.children.length > 50) {
    logList.removeChild(logList.lastChild);
  }
}

joinBtn.onclick = ()=>{
  playerName = nameInput.value.trim() || "Player";
  playerSkin = skinSelect.value;
  const room = roomInput.value.trim() || "sala1";
  ws.send(JSON.stringify({type:"join",room,name:playerName,skin:playerSkin}));
  hud.style.display="block";
  logContainer.style.display="block";
  readyBtn.style.display="inline-block";
  joinBtn.style.display="none";
  nameInput.style.display="none";
  roomInput.style.display="none";
  skinSelect.style.display="none";
  skinSelect.previousElementSibling.style.display="none";
  statusEl.textContent="Clique em 'Pronto' quando estiver pronto!";
  addLog(`${playerName} entrou na sala ${room}`, "info");
};

readyBtn.onclick = ()=>{
  if(!isReady) {
    ws.send(JSON.stringify({type:"ready"}));
    isReady = true;
    readyBtn.textContent="⏳ Aguardando outros jogadores...";
    readyBtn.disabled = true;
    readyBtn.style.opacity = "0.5";
    readyBtn.style.cursor = "not-allowed";
  }
};

document.addEventListener("keydown", e=>{
  if(!["w","a","s","d"].includes(e.key)) return;
  const dir={w:"up",s:"down",a:"left",d:"right"}[e.key];
  ws.send(JSON.stringify({type:"input",dir}));
});

ws.onmessage = e=>{
  const data = JSON.parse(e.data);
  
  if(data.type==="updatePlayers") {
    const oldCount = players.length;
    players=data.players;
    
    // Log player join/leave
    if(players.length > oldCount) {
      const newPlayer = players[players.length - 1];
      if(newPlayer.name !== playerName) {
        addLog(`${newPlayer.name} entrou no jogo`, "info");
      }
    } else if(players.length < oldCount) {
      addLog(`Um jogador saiu do jogo`, "warning");
    }
    
    // Update status with ready count
    if(gameState === "waiting") {
      const readyCount = players.filter(p => p.ready).length;
      const totalCount = players.length;
      if(!isReady) {
        statusEl.textContent=`Jogadores prontos: ${readyCount}/${totalCount}`;
      } else {
        statusEl.textContent=`Aguardando... ${readyCount}/${totalCount} prontos`;
      }
    }
  }
  
  if(data.type==="countdown") {
    gameState = "playing";
    readyBtn.style.display="none";
    addLog("🎮 Jogo iniciando!", "info");
    let count = 3;
    statusEl.textContent="🎮 " + count;
    statusEl.style.color="#FFD700";
    statusEl.style.fontSize="3em";
    
    const countInterval = setInterval(() => {
      count--;
      if (count > 0) {
        statusEl.textContent="🎮 " + count;
      } else {
        statusEl.textContent="🎮 GO!";
        setTimeout(() => {
          statusEl.style.fontSize="1.5em";
        }, 500);
        clearInterval(countInterval);
      }
    }, 1000);
  }
  
  if(data.type==="newTurn") {
    statusEl.textContent="🎵 Rodada "+data.turn+" - Observe o Maestro!";
    statusEl.style.color="#87CEEB";
    addLog(`🎵 Rodada ${data.turn} começou`, "info");
  }
  
  if(data.type==="maestroMove"){ 
    maestroAnim=data.dir;
    // Play tin sound
    tinSound.currentTime = 0;
    tinSound.play().catch(e => console.log("Audio play failed:", e));
    
    // Add timing indicator
    timingIndicators.push({
      time: Date.now(),
      dir: data.dir,
      index: data.index
    });
    
    setTimeout(()=>maestroAnim="idle",400);
  }
  
  if(data.type==="playerCountdown") {
    if (data.count > 0) {
      statusEl.textContent="🎯 " + data.count;
      statusEl.style.color="#FFD700";
      statusEl.style.fontSize="3em";
    } else {
      statusEl.textContent="🎯 GO!";
      statusEl.style.color="#90EE90";
      
      // Show first move when GO appears
      if(data.firstMove) {
        maestroAnim = data.firstMove;
        setTimeout(() => maestroAnim = "idle", 400);
      }
      
      setTimeout(() => {
        statusEl.textContent="🎯 Siga o ritmo do Maestro!";
        statusEl.style.fontSize="1.5em";
      }, 400);
    }
  }
  
  if(data.type==="playerTurn") {
    currentSequence = data.sequence;
    sequenceIndex = 0;
    showingSequence = false;
    statusEl.textContent="🎯 Prepare-se...";
    statusEl.style.color="#90EE90";
  }
  
  if(data.type==="playerMove") {
    const emoji = data.correct ? "✅" : "❌";
    const dirEmoji = {up:"⬆️", down:"⬇️", left:"⬅️", right:"➡️"}[data.dir];
    const logType = data.correct ? "success" : "error";
    const action = data.correct ? "acertou" : "errou";
    
    addLog(`${emoji} ${data.name} ${action} ${dirEmoji}`, logType);
    
    // Animar sprite do jogador
    if(!playerAnimations[data.id]) {
      playerAnimations[data.id] = {anim: "idle", time: 0};
    }
    playerAnimations[data.id].anim = data.dir;
    playerAnimations[data.id].time = Date.now();
  }
  
  if(data.type==="playerDied") {
    statusEl.textContent="💀 "+data.name+" perdeu todas as vidas!";
    statusEl.style.color="#FF4444";
    addLog(`💀 ${data.name} foi eliminado`, "error");
  }
  
  if(data.type==="roundComplete") {
    statusEl.textContent="🎉 Rodada "+data.turn+" completa! Próxima rodada...";
    statusEl.style.color="#FFD700";
    addLog(`🎉 Rodada ${data.turn} completa!`, "success");
  }
  
  if(data.type==="gameOver") {
    statusEl.textContent="🏁 GAME OVER! Vocês chegaram até a rodada "+data.finalTurn+"!";
    statusEl.style.color="#FF1493";
    addLog(`🏁 Game Over - Rodada final: ${data.finalTurn}`, "error");
  }
  
  if(data.type==="dead") {
    statusEl.textContent="💀 Você morreu! Continue assistindo...";
    statusEl.style.color="#888";
    addLog("💀 Você foi eliminado", "error");
  }
  
  if(data.type==="rhythmMiss") {
    addLog(`⏰ ${data.name} perdeu o ritmo (-1 vida)`, "warning");
  }
  
  if(data.type==="timingError") {
    const msg = data.error === "early" ? "muito cedo ⚡" : "muito tarde 🐌";
    addLog(`⏰ ${data.name} apertou ${msg} (-1 vida)`, "warning");
  }
  
  if(data.type==="rhythmError") {
    const msg = data.tooEarly ? "muito cedo" : "muito tarde";
    statusEl.textContent="⏰ "+data.name+" apertou "+msg+"! -1 vida";
    statusEl.style.color="#FFA500";
  }
  
  if(data.type==="offRhythm") {
    // Just a visual warning, no life lost yet
    console.log(data.name + " está fora do ritmo");
  }
  
  if(data.type==="winner") {
    statusEl.textContent="🏆 "+data.name+" VENCEU! Rodada "+data.turn;
    statusEl.style.color="#FFD700";
    statusEl.style.fontSize="2em";
    addLog(`🏆 ${data.name} venceu! (Rodada ${data.turn})`, "success");
  }
  
  if(data.type==="gameReset") {
    gameState = "waiting";
    isReady = false;
    readyBtn.style.display="inline-block";
    readyBtn.textContent="✅ Pronto!";
    readyBtn.disabled = false;
    readyBtn.style.opacity = "1";
    readyBtn.style.cursor = "pointer";
    statusEl.textContent="🔄 Novo jogo! Clique em 'Pronto' quando estiver pronto!";
    statusEl.style.color="#FFD700";
    statusEl.style.fontSize="1.5em";
    currentSequence = [];
    sequenceIndex = 0;
    showingSequence = false;
    timingIndicators = [];
    maestroAnim = "idle";
    addLog("🔄 Jogo reiniciado - Prepare-se!", "info");
  }
};

// Tamanho fixo para renderização (em pixels na tela)
const RENDER_SIZE = 110; // Todos os sprites serão renderizados com 110x110 pixels
const MAESTRO_SIZE = 150; // Maestro será maior

function drawAnim(type,name,x,y,dt,frameState,skin){
  let cfg, img;
  if(type === "player" && skin) {
    cfg = animConfig.player[skin][name];
    img = sprites.player[skin][name];
  } else if(type === "maestro") {
    cfg = animConfig.maestro[name];
    img = sprites.maestro[name];
  }
  
  if(!cfg||!img||!img.complete) return;
  
  if(!frameState) frameState = {frame:0, time:0};
  frameState.time+=dt;
  if(frameState.time>cfg.speed){ 
    frameState.time=0; 
    frameState.frame=(frameState.frame+1)%cfg.frames; 
  }
  const sx=frameState.frame*cfg.frameW;
  // Renderiza sempre com tamanho fixo, independente do tamanho original
  ctx.drawImage(img,sx,0,cfg.frameW,cfg.frameH,x,y,RENDER_SIZE,RENDER_SIZE);
  return frameState;
}

function drawAnimCustomSize(type,name,x,y,dt,frameState,size){
  const cfg=animConfig[type][name], img=sprites[type][name];
  if(!cfg||!img||!img.complete) return;
  
  if(!frameState) frameState = {frame:0, time:0};
  frameState.time+=dt;
  if(frameState.time>cfg.speed){ 
    frameState.time=0; 
    frameState.frame=(frameState.frame+1)%cfg.frames; 
  }
  const sx=frameState.frame*cfg.frameW;
  // Renderiza com tamanho customizado
  ctx.drawImage(img,sx,0,cfg.frameW,cfg.frameH,x,y,size,size);
  return frameState;
}

let last=0;
let maestroFrameState = {frame:0, time:0};
let playerFrameStates = {};

function loop(t){
  const dt=t-last; last=t;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  
  // Desenhar maestro no centro superior
  const maestroX = (canvas.width / 2) - (MAESTRO_SIZE / 2);
  const maestroY = 60;
  maestroFrameState = drawAnimCustomSize("maestro",maestroAnim,maestroX,maestroY,dt,maestroFrameState,MAESTRO_SIZE);
  
  // Draw timing indicators around maestro
  const now = Date.now();
  timingIndicators = timingIndicators.filter(indicator => {
    const elapsed = now - indicator.time;
    if (elapsed > 1500) return false; // Remove old indicators
    
    const alpha = Math.max(0, 1 - elapsed / 1500);
    const radius = 70 + (elapsed / 1500) * 40;
    
    ctx.strokeStyle = `rgba(255, 215, 0, ${alpha})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(maestroX + MAESTRO_SIZE/2, maestroY + MAESTRO_SIZE/2, radius, 0, Math.PI * 2);
    ctx.stroke();
    
    return true;
  });

  // Desenhar jogadores em linha na parte inferior
  const playerSpacing = 100;
  const startX = (canvas.width - (players.length - 1) * playerSpacing) / 2;
  const playerY = canvas.height - 180;
  
  players.forEach((p,i)=>{
    const px = startX + i * playerSpacing - (RENDER_SIZE / 2);
    const py = playerY;
    
    // Verificar se deve animar ou ficar idle
    if(!playerAnimations[p.id]) {
      playerAnimations[p.id] = {anim: "idle", time: 0};
    }
    
    const timeSinceMove = now - (playerAnimations[p.id].time || 0);
    const currentAnim = timeSinceMove < 300 ? playerAnimations[p.id].anim : "idle";
    
    if(!playerFrameStates[p.id]) {
      playerFrameStates[p.id] = {frame:0, time:0};
    }
    
    const playerSkin = p.skin || "1";
    playerFrameStates[p.id] = drawAnim("player",currentAnim,px,py,dt,playerFrameStates[p.id],playerSkin);
    
    // Nome do jogador centralizado acima do sprite
    ctx.fillStyle = "#000";
    ctx.font = "bold 14px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(p.name || "?", px + (RENDER_SIZE / 2), py - 8);
    
    // Draw hearts below the player
    const hearts = "❤️".repeat(Math.max(0,p.lives)) + "🖤".repeat(Math.max(0,3-p.lives));
    ctx.font = "12px sans-serif";
    ctx.fillText(hearts, px + (RENDER_SIZE / 2), py + RENDER_SIZE + 15);
  });

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
