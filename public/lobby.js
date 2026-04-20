const socket = io();

async function loadServerAddresses() {
  try {
    const res = await fetch('/api/server-info');
    const { ips, port } = await res.json();
    renderAddresses(ips, port, 'serverAddressList');
    renderAddresses(ips, port, 'waitingAddressBox', true);
  } catch (e) {}
}

function renderAddresses(ips, port, containerId, withLabel = false) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (ips.length === 0) {
    el.innerHTML = '<div class="sa-loading">주소를 가져올 수 없습니다.</div>';
    return;
  }
  let html = withLabel ? '<div class="sa-label">📡 접속 주소 (같은 WiFi에서)</div>' : '';
  for (const ip of ips) {
    const url = `http://${ip}:${port}`;
    html += `
      <div class="sa-entry">
        <span>${url}</span>
        <button class="sa-copy" onclick="copyAddr('${url}', this)">복사</button>
      </div>`;
  }
  el.innerHTML = html;
}

window.copyAddr = function(url, btn) {
  navigator.clipboard.writeText(url).then(() => {
    btn.textContent = '복사됨!';
    setTimeout(() => btn.textContent = '복사', 2000);
  }).catch(() => {
    btn.textContent = url;
    setTimeout(() => btn.textContent = '복사', 3000);
  });
};

loadServerAddresses();

const playerNameInput = document.getElementById('playerName');
const roomCodeInput = document.getElementById('roomCode');
const aiGameBtn = document.getElementById('aiGameBtn');
const createBtn = document.getElementById('createBtn');
const joinBtn = document.getElementById('joinBtn');
const errorMsg = document.getElementById('errorMsg');
const lobbyContainer = document.querySelector('.lobby-container');
const waitingRoom = document.getElementById('waitingRoom');
const displayRoomCode = document.getElementById('displayRoomCode');
const playerList = document.getElementById('playerList');
const hostControls = document.getElementById('hostControls');
const guestWait = document.getElementById('guestWait');
const startGameBtn = document.getElementById('startGameBtn');
const copyCodeBtn = document.getElementById('copyCodeBtn');

// 솔로 AI 수 컨트롤
const soloAiMinus = document.getElementById('soloAiMinus');
const soloAiPlus = document.getElementById('soloAiPlus');
const soloAiCountEl = document.getElementById('soloAiCount');
let soloAiCount = 1;

soloAiMinus.addEventListener('click', () => {
  if (soloAiCount > 1) { soloAiCount--; soloAiCountEl.textContent = soloAiCount; }
});
soloAiPlus.addEventListener('click', () => {
  if (soloAiCount < 9) { soloAiCount++; soloAiCountEl.textContent = soloAiCount; }
});

// 대기실 AI 수 컨트롤
const aiBotMinus = document.getElementById('aiBotMinus');
const aiBotPlus = document.getElementById('aiBotPlus');
const aiBotCountEl = document.getElementById('aiBotCount');

aiBotMinus.addEventListener('click', () => socket.emit('removeBot'));
aiBotPlus.addEventListener('click', () => socket.emit('addBot'));

let mySocketId = null;
let isHost = false;

socket.on('connect', () => { mySocketId = socket.id; });

function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.classList.remove('hidden');
  setTimeout(() => errorMsg.classList.add('hidden'), 4000);
}

function getName() {
  return playerNameInput.value.trim() || '익명';
}

aiGameBtn.addEventListener('click', () => {
  const name = getName();
  if (!name) { showError('닉네임을 입력해주세요.'); playerNameInput.focus(); return; }
  sessionStorage.setItem('playerName', name);
  socket.emit('startWithAI', { name, botCount: soloAiCount });
});

createBtn.addEventListener('click', () => {
  const name = getName();
  if (!name) { showError('닉네임을 입력해주세요.'); playerNameInput.focus(); return; }
  socket.emit('createRoom', { name });
});

joinBtn.addEventListener('click', () => {
  const name = getName();
  const code = roomCodeInput.value.trim();
  if (!name) { showError('닉네임을 입력해주세요.'); playerNameInput.focus(); return; }
  if (code.length < 5) { showError('방 코드 5자리를 입력해주세요.'); roomCodeInput.focus(); return; }
  socket.emit('joinRoom', { roomId: code, name });
});

playerNameInput.addEventListener('keydown', e => { if (e.key === 'Enter') createBtn.click(); });
roomCodeInput.addEventListener('keydown', e => { if (e.key === 'Enter') joinBtn.click(); });

copyCodeBtn.addEventListener('click', () => {
  const code = displayRoomCode.textContent;
  navigator.clipboard.writeText(code).then(() => {
    copyCodeBtn.textContent = '복사됨!';
    setTimeout(() => copyCodeBtn.textContent = '복사', 2000);
  }).catch(() => {
    copyCodeBtn.textContent = code;
    setTimeout(() => copyCodeBtn.textContent = '복사', 2000);
  });
});

startGameBtn.addEventListener('click', () => {
  socket.emit('startGame');
  startGameBtn.disabled = true;
  startGameBtn.textContent = '시작 중...';
});

function enterWaiting(roomId, state) {
  displayRoomCode.textContent = roomId;
  sessionStorage.setItem('roomId', roomId);
  sessionStorage.setItem('playerName', getName());
  lobbyContainer.classList.add('hidden');
  waitingRoom.classList.remove('hidden');
  updatePlayerList(state);
}

function updatePlayerList(state) {
  playerList.innerHTML = '';
  isHost = state.hostId === mySocketId;

  const botCount = state.players.filter(p => p.isBot).length;
  const humanCount = state.players.filter(p => !p.isBot).length;
  const maxBots = 10 - humanCount;

  if (isHost) {
    hostControls.classList.remove('hidden');
    guestWait.classList.add('hidden');
    aiBotCountEl.textContent = botCount;
    aiBotMinus.disabled = botCount === 0;
    aiBotPlus.disabled = state.players.length >= 10;
    startGameBtn.disabled = state.players.length < 2;
    startGameBtn.textContent = state.players.length < 2
      ? `게임 시작 (최소 2명 필요, 현재 ${state.players.length}명)`
      : `게임 시작! (${state.players.length}명)`;
  } else {
    hostControls.classList.add('hidden');
    guestWait.classList.remove('hidden');
  }

  for (const p of state.players) {
    const div = document.createElement('div');
    div.className = 'player-item';
    const avatarText = p.isBot ? '🤖' : p.name[0].toUpperCase();
    const nameLabel = p.isBot
      ? p.name
      : `${p.name}${p.id === mySocketId ? ' (나)' : ''}`;
    div.innerHTML = `
      <div class="player-avatar">${avatarText}</div>
      <div class="player-item-name">${nameLabel}</div>
      ${p.isHost ? '<span class="host-badge">호스트</span>' : ''}
      ${p.isBot ? '<span class="host-badge" style="background:#6366f1">AI</span>' : ''}
    `;
    playerList.appendChild(div);
  }
}

socket.on('roomCreated', ({ roomId, state }) => enterWaiting(roomId, state));
socket.on('roomJoined', ({ roomId, state }) => enterWaiting(roomId, state));
socket.on('playerJoined', ({ name, state }) => updatePlayerList(state));
socket.on('playerLeft', ({ name, state }) => updatePlayerList(state));

socket.on('joinError', ({ message }) => showError(message));

socket.on('gameStarted', ({ state }) => {
  if (state.roomId) sessionStorage.setItem('roomId', state.roomId);
  sessionStorage.setItem('gameState', JSON.stringify(state));
  window.location.href = '/game.html';
});
