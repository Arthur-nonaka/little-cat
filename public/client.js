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

const animConfig = {
  maestro: {
    idle:{src:"/sprites/maestro/idle.png",frameW:32,frameH:32,frames:9,speed:200},
    up:{src:"/sprites/maestro/up.png",frameW:96,frameH:96,frames:1,speed:120},
    down:{src:"/sprites/maestro/down.png",frameW:32,frameH:32,frames:4,speed:120},
    left:{src:"/sprites/maestro/left.png",frameW:96,frameH:96,frames:1,speed:120},
    right:{src:"/sprites/maestro/right.png",frameW:96,frameH:96,frames:1,speed:120},
  },
  player: {
    idle:{src:"/sprites/maestro/idle.png",frameW:32,frameH:32,frames:9,speed:200},
    up:{src:"/sprites/maestro/up.png",frameW:96,frameH:96,frames:1,speed:120},
    down:{src:"/sprites/maestro/down.png",frameW:32,frameH:32,frames:4,speed:120},
    left:{src:"/sprites/maestro/left.png",frameW:96,frameH:96,frames:1,speed:120},
    right:{src:"/sprites/maestro/right.png",frameW:96,frameH:96,frames:1,speed:120},
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
    setTimeout(()=>maestroAnim="idle",200);
  }
  
  if(data.type==="playerTurn") {
    statusEl.textContent="🎯 Vez de "+data.name+"! Repita a sequência!";
    statusEl.style.color="#90EE90";
  }
  
  if(data.type==="nextPlayer") {
    statusEl.textContent="🎯 Vez de "+data.name+"!";
    statusEl.style.color="#90EE90";
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
};

// Tamanho fixo para renderização (em pixels na tela)
const RENDER_SIZE = 64; // Todos os sprites serão renderizados com 64x64 pixels

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

let last=0;
let maestroFrameState = {frame:0, time:0};
let playerFrameStates = {};

function loop(t){
  const dt=t-last; last=t;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  
  // Desenhar maestro no centro superior
  const maestroX = (canvas.width / 2) - (RENDER_SIZE / 2);
  const maestroY = 80;
  maestroFrameState = drawAnim("maestro",maestroAnim,maestroX,maestroY,dt,maestroFrameState);

  // Desenhar jogadores em círculo ao redor do maestro
  const now = Date.now();
  players.forEach((p,i)=>{
    const angle = (i / Math.max(players.length,1)) * Math.PI * 2 - Math.PI/2;
    const radius = 200;
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const px = centerX + Math.cos(angle) * radius - (RENDER_SIZE / 2);
    const py = centerY + Math.sin(angle) * radius - (RENDER_SIZE / 2);
    
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
    ctx.font = "bold 12px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(p.name || "?", px + (RENDER_SIZE / 2), py - 5);
  });

  // HUD - players vidas no canto superior esquerdo
  ctx.textAlign = "left";
  ctx.font = "16px sans-serif";
  ctx.fillStyle="#fff";
  players.forEach((p,i)=>{
    const hearts = "❤️".repeat(Math.max(0,p.lives)) + "🖤".repeat(Math.max(0,3-p.lives));
    const ready = p.ready ? "✅" : "⏳";
    const name = p.name || "Player";
    ctx.fillText(`${name}: ${hearts} ${ready}`,20,30+i*25);
  });

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
