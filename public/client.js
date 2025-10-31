const ws = new WebSocket(`ws://${location.host}`);
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const nameInput = document.getElementById("name");
const roomInput = document.getElementById("room");
const joinBtn = document.getElementById("join");
const statusEl = document.getElementById("status");
const hud = document.getElementById("hud");

let playerId;
let players = [];
let maestroAnim = "idle";
let animFrame = 0;
let animTime = 0;
let gameState = "waiting";
let playerName = "";
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
    idle:{src:"/sprites/player/idle.png",frameW:32,frameH:32,frames:9,speed:200},
    up:{src:"/sprites/player/up.png",frameW:96,frameH:96,frames:1,speed:120},
    down:{src:"/sprites/player/down.png",frameW:32,frameH:32,frames:4,speed:120},
    left:{src:"/sprites/player/left.png",frameW:96,frameH:96,frames:1,speed:120},
    right:{src:"/sprites/player/right.png",frameW:96,frameH:96,frames:1,speed:120},
  }
};

const sprites = {maestro:{}, player:{}};
for(const type in animConfig){
  for(const k in animConfig[type]){ 
    const img=new Image(); 
    img.src=animConfig[type][k].src; 
    sprites[type][k]=img;
  }
}

joinBtn.onclick = ()=>{
  playerName = nameInput.value.trim() || "Player";
  const room = roomInput.value.trim() || "sala1";
  ws.send(JSON.stringify({type:"join",room,name:playerName}));
  ws.send(JSON.stringify({type:"ready"}));
  hud.style.display="block";
  joinBtn.style.display="none";
  nameInput.style.display="none";
  roomInput.style.display="none";
};

document.addEventListener("keydown", e=>{
  if(!["w","a","s","d"].includes(e.key)) return;
  const dir={w:"up",s:"down",a:"left",d:"right"}[e.key];
  ws.send(JSON.stringify({type:"input",dir}));
});

ws.onmessage = e=>{
  const data = JSON.parse(e.data);
  
  if(data.type==="updatePlayers") {
    players=data.players;
  }
  
  if(data.type==="countdown") {
    statusEl.textContent="🎮 O jogo começa em 3 segundos...";
    statusEl.style.color="#FFD700";
  }
  
  if(data.type==="newTurn") {
    statusEl.textContent="🎵 Rodada "+data.turn+" - Observe o Maestro!";
    statusEl.style.color="#87CEEB";
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
    
    setTimeout(()=>maestroAnim="idle",500);
  }
  
  if(data.type==="playerTurn") {
    currentSequence = data.sequence;
    sequenceIndex = 0;
    showingSequence = false;
    statusEl.textContent="🎯 Todos jogam juntos! Repita a sequência no ritmo!";
    statusEl.style.color="#90EE90";
    
    // Start showing the sequence again with timing indicators
    let idx = 0;
    const timingWindow = data.timingWindow || 1000;
    const interval = setInterval(() => {
      if (idx < currentSequence.length) {
        // Show timing circle for this move
        timingIndicators.push({
          time: Date.now(),
          dir: currentSequence[idx],
          index: idx,
          isPlayerTurn: true
        });
        idx++;
      } else {
        clearInterval(interval);
      }
    }, timingWindow / currentSequence.length);
  }
  
  if(data.type==="playerMove") {
    const emoji = data.correct ? "✅" : "❌";
    statusEl.textContent=emoji+" "+data.name+" jogou "+data.dir;
    statusEl.style.color = data.correct ? "#32CD32" : "#FF6347";
    
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
  }
  
  if(data.type==="roundComplete") {
    statusEl.textContent="🎉 Rodada "+data.turn+" completa! Próxima rodada...";
    statusEl.style.color="#FFD700";
  }
  
  if(data.type==="gameOver") {
    statusEl.textContent="🏁 GAME OVER! Vocês chegaram até a rodada "+data.finalTurn+"!";
    statusEl.style.color="#FF1493";
  }
  
  if(data.type==="dead") {
    statusEl.textContent="💀 Você morreu! Continue assistindo...";
    statusEl.style.color="#888";
  }
  
  if(data.type==="rhythmMiss") {
    statusEl.textContent="⏰ "+data.name+" perdeu o ritmo! -1 vida";
    statusEl.style.color="#FFA500";
  }
  
  if(data.type==="timingError") {
    const msg = data.error === "early" ? "muito cedo ⚡" : "muito tarde 🐌";
    statusEl.textContent="⏰ "+data.name+" apertou "+msg+"! -1 vida";
    statusEl.style.color="#FFA500";
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
};

// Tamanho fixo para renderização (em pixels na tela)
const RENDER_SIZE = 80; // Todos os sprites serão renderizados com 80x80 pixels
const MAESTRO_SIZE = 128; // Maestro será maior

function drawAnim(type,name,x,y,dt,frameState){
  const cfg=animConfig[type][name], img=sprites[type][name];
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
  const playerY = canvas.height - 120;
  
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
    
    playerFrameStates[p.id] = drawAnim("player",currentAnim,px,py,dt,playerFrameStates[p.id]);
    
    // Nome do jogador centralizado acima do sprite
    ctx.fillStyle = "#fff";
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
