const socket = io();

// DOM refs
const topRoomCode = document.getElementById('topRoomCode');
const turnInfo = document.getElementById('turnInfo');
const directionInfo = document.getElementById('directionInfo');
const opponentsArea = document.getElementById('opponentsArea');
const drawPile = document.getElementById('drawPile');
const deckCount = document.getElementById('deckCount');
const topCardDisplay = document.getElementById('topCardDisplay');
const topCardRank = document.getElementById('topCardRank');
const topCardSuit = document.getElementById('topCardSuit');
const drawStackBadge = document.getElementById('drawStackBadge');
const drawStackNum = document.getElementById('drawStackNum');
const currentSuitDisplay = document.getElementById('currentSuitDisplay');
const currentSuitIcon = document.getElementById('currentSuitIcon');
const myHand = document.getElementById('myHand');
const myNameEl = document.getElementById('myName');
const myCardCount = document.getElementById('myCardCount');
const oneCardBtn = document.getElementById('oneCardBtn');
const eventLog = document.getElementById('eventLog');
const suitModal = document.getElementById('suitModal');
const gameOverModal = document.getElementById('gameOverModal');
const winnerName = document.getElementById('winnerName');
const restartBtn = document.getElementById('restartBtn');
const lobbyBtn = document.getElementById('lobbyBtn');
const chatToggle = document.getElementById('chatToggle');
const chatPanel = document.getElementById('chatPanel');
const chatClose = document.getElementById('chatClose');
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const chatSend = document.getElementById('chatSend');

let mySocketId = null;
let currentState = null;
let pendingCardIndex = null;
let myName = sessionStorage.getItem('playerName') || '나';
let roomId = sessionStorage.getItem('roomId') || '---';

socket.on('connect', () => {
  mySocketId = socket.id;
  myNameEl.textContent = myName;
  topRoomCode.textContent = roomId;
  sessionStorage.removeItem('gameState');

  if (roomId && myName) {
    socket.emit('rejoinRoom', { roomId, name: myName });
  }
});

function isRed(suit) {
  return suit === '♥' || suit === '♦';
}

function cardColorClass(card) {
  if (card.rank === 'Joker') return 'joker-card';
  return isRed(card.suit) ? 'red-card' : 'black-card';
}

function buildCardHTML(card) {
  const colorClass = cardColorClass(card);
  const rank = card.rank === 'Joker' ? 'J○' : card.rank;
  return `
    <div class="card ${colorClass}">
      <div class="card-rank">${rank}</div>
      <div class="card-suit">${card.suit}</div>
      <div class="card-rank-bottom">${rank}</div>
    </div>
  `;
}

function canPlayCard(card) {
  if (!currentState) return false;
  const { topCard, currentSuit, drawStack, drawStackType } = currentState;
  if (!topCard) return false;

  if (drawStack > 0) {
    if (drawStackType === '2') return card.rank === '2';
    if (drawStackType === 'Joker') return card.rank === 'Joker';
  }
  if (card.rank === 'Joker') return true;
  const effectiveSuit = currentSuit || topCard.suit;
  return card.suit === effectiveSuit || card.rank === topCard.rank;
}

function renderState(state) {
  currentState = state;
  if (!state) return;

  const isMyTurn = state.currentPlayerId === mySocketId;
  const me = state.players.find(p => p.id === mySocketId);

  // Top bar
  turnInfo.textContent = isMyTurn
    ? '🎴 내 차례!'
    : `${state.players.find(p => p.id === state.currentPlayerId)?.name || '?'} 차례`;
  turnInfo.classList.toggle('my-turn', isMyTurn);
  directionInfo.textContent = state.direction === 1 ? '▶ 시계 방향' : '◀ 반시계 방향';

  // Draw stack badge
  if (state.drawStack > 0) {
    drawStackBadge.classList.remove('hidden');
    drawStackNum.textContent = state.drawStack;
  } else {
    drawStackBadge.classList.add('hidden');
  }

  // Top card
  if (state.topCard) {
    const tc = state.topCard;
    const colorClass = cardColorClass(tc);
    topCardDisplay.className = `card ${colorClass}`;
    topCardRank.textContent = tc.rank === 'Joker' ? 'J○' : tc.rank;
    topCardSuit.textContent = tc.suit;
    // add bottom rank
    let bottomEl = topCardDisplay.querySelector('.card-rank-bottom');
    if (!bottomEl) {
      bottomEl = document.createElement('div');
      bottomEl.className = 'card-rank-bottom';
      topCardDisplay.appendChild(bottomEl);
    }
    bottomEl.textContent = tc.rank === 'Joker' ? 'J○' : tc.rank;
  }

  // Current suit indicator (when 7 was played)
  const topCard = state.topCard;
  const suitChanged = topCard && state.currentSuit !== topCard.suit;
  if (state.currentSuit) {
    currentSuitDisplay.classList.remove('hidden');
    currentSuitDisplay.classList.add('visible');
    currentSuitIcon.textContent = state.currentSuit;
    currentSuitIcon.style.color = isRed(state.currentSuit) ? '#e02020' : '#fff';
  } else {
    currentSuitDisplay.classList.add('hidden');
  }

  // Deck count
  deckCount.textContent = state.deckCount;

  // Opponents
  opponentsArea.innerHTML = '';
  for (const p of state.players) {
    if (p.id === mySocketId) continue;
    const div = document.createElement('div');
    div.className = 'opponent-card';
    if (p.id === state.currentPlayerId) div.classList.add('active-turn');
    if (p.cardCount === 1 && !p.oneCardSafe) div.classList.add('one-card-alert');

    const miniCards = Math.min(p.cardCount, 8);
    const miniHTML = Array.from({ length: miniCards }, () => '<div class="mini-card"></div>').join('');

    const showOneCardCall = p.cardCount === 1 && !p.oneCardSafe;
    div.innerHTML = `
      <div class="opponent-name">${p.isBot ? '🤖 ' : ''}${p.name}</div>
      <div class="opponent-count">${p.cardCount}장</div>
      <div class="opponent-mini-cards">${miniHTML}</div>
      ${showOneCardCall
        ? `<button class="report-btn onecard-call-btn" data-id="${p.id}">원카드!</button>`
        : `<button class="report-btn" data-id="${p.id}" style="opacity:0;pointer-events:none">원카드!</button>`
      }
    `;
    opponentsArea.appendChild(div);
  }

  // Report button handlers
  opponentsArea.querySelectorAll('.report-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      socket.emit('reportPlayer', { targetId: btn.dataset.id });
    });
  });

  // My hand
  if (me?.hand) {
    myHand.innerHTML = '';
    myCardCount.textContent = me.hand.length;

    me.hand.forEach((card, idx) => {
      const wrapper = document.createElement('div');
      const playable = isMyTurn && canPlayCard(card);
      const colorClass = cardColorClass(card);
      wrapper.className = `card ${colorClass} ${playable ? 'playable' : 'not-playable'}`;

      const rank = card.rank === 'Joker' ? 'J○' : card.rank;
      wrapper.innerHTML = `
        <div class="card-rank">${rank}</div>
        <div class="card-suit">${card.suit}</div>
        <div class="card-rank-bottom">${rank}</div>
      `;

      if (playable) {
        wrapper.addEventListener('click', () => playCard(idx, card));
      }
      myHand.appendChild(wrapper);
    });

    // One card button
    const showOneCard = me.hand.length === 1 && !me.oneCardSafe;
    oneCardBtn.classList.toggle('hidden', !showOneCard);
  }

  // Draw pile clickable only on my turn
  drawPile.style.opacity = isMyTurn ? '1' : '0.6';
  drawPile.style.cursor = isMyTurn ? 'pointer' : 'not-allowed';
}

function playCard(idx, card) {
  if (card.rank === '7') {
    pendingCardIndex = idx;
    suitModal.classList.remove('hidden');
    return;
  }
  socket.emit('playCard', { cardIndex: idx });
}

// Draw pile click
drawPile.addEventListener('click', () => {
  if (!currentState || currentState.currentPlayerId !== mySocketId) return;
  socket.emit('drawCard');
});

// One card button
oneCardBtn.addEventListener('click', () => {
  socket.emit('declareOneCard');
});

// Suit modal
suitModal.querySelectorAll('.suit-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const suit = btn.dataset.suit;
    suitModal.classList.add('hidden');
    socket.emit('playCard', { cardIndex: pendingCardIndex, chosenSuit: suit });
    pendingCardIndex = null;
  });
});

// Game over
restartBtn.addEventListener('click', () => {
  gameOverModal.classList.add('hidden');
  socket.emit('startGame');
});
lobbyBtn.addEventListener('click', () => window.location.href = '/');

// Chat
chatToggle.addEventListener('click', () => {
  chatPanel.classList.toggle('hidden');
  chatToggle.classList.remove('has-new');
  if (!chatPanel.classList.contains('hidden')) chatInput.focus();
});
chatClose.addEventListener('click', () => chatPanel.classList.add('hidden'));

function sendChat() {
  const msg = chatInput.value.trim();
  if (!msg) return;
  socket.emit('sendChat', { message: msg });
  chatInput.value = '';
}
chatSend.addEventListener('click', sendChat);
chatInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });

function addChatMsg(name, message, isSystem = false) {
  const div = document.createElement('div');
  div.className = `chat-msg${isSystem ? ' system' : ''}`;
  if (isSystem) {
    div.textContent = message;
  } else {
    div.innerHTML = `<span class="msg-name">${name}</span>${message}`;
  }
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  if (chatPanel.classList.contains('hidden')) {
    chatToggle.classList.add('has-new');
  }
}

function showEvent(msg) {
  const el = document.createElement('div');
  el.className = 'event-item';
  el.textContent = msg;
  eventLog.appendChild(el);
  setTimeout(() => el.remove(), 3100);
}

// Socket events
socket.on('gameUpdate', ({ state }) => renderState(state));

socket.on('cardPlayed', ({ playerName, card, effect, drawStack }) => {
  const cardStr = card.rank === 'Joker' ? '조커' : `${card.suit}${card.rank}`;
  const effects = {
    draw2: `🃏 ${playerName}이(가) ${cardStr} → 다음 사람 ${drawStack}장 뽑기!`,
    draw3: `🃏 ${playerName}이(가) ${cardStr} → 다음 사람 3장 뽑기!`,
    joker: `★ ${playerName}이(가) 조커! → 다음 사람 ${drawStack}장 뽑기!`,
    reverse: `🔄 ${playerName}이(가) ${cardStr} → 방향 전환!`,
    skip: `⏭ ${playerName}이(가) ${cardStr} → 다음 사람 스킵!`,
    skip2: `⏭⏭ ${playerName}이(가) ${cardStr} → 2명 스킵!`,
    wild: `🌈 ${playerName}이(가) 7 → 무늬 변경!`,
    normal: `${playerName}이(가) ${cardStr} 냄`
  };
  showEvent(effects[effect] || `${playerName}이(가) ${cardStr} 냄`);
  addChatMsg('', effects[effect] || `${playerName}이(가) ${cardStr} 냄`, true);
});

socket.on('cardDrawn', ({ playerName, count }) => {
  const msg = count > 1
    ? `😱 ${playerName}이(가) ${count}장 뽑음!`
    : `${playerName}이(가) 카드 뽑음`;
  showEvent(msg);
  addChatMsg('', msg, true);
});

socket.on('oneCardDeclared', ({ playerName }) => {
  const msg = `🎴 ${playerName}: 원카드!!`;
  showEvent(msg);
  addChatMsg('', msg, true);
});

socket.on('playerReported', ({ reporterName, targetName }) => {
  const msg = `⚠️ ${reporterName}이(가) 먼저 원카드! → ${targetName} 1장 추가!`;
  showEvent(msg);
  addChatMsg('', msg, true);
});

socket.on('playerJoined', ({ name, state }) => {
  addChatMsg('', `${name}이(가) 입장했습니다.`, true);
  if (state) renderState(state);
});

socket.on('playerLeft', ({ name, state }) => {
  addChatMsg('', `${name}이(가) 퇴장했습니다.`, true);
  if (state) renderState(state);
});

socket.on('chatMessage', ({ playerName, message }) => {
  addChatMsg(playerName, message);
});

socket.on('chooseSuit', () => {
  suitModal.classList.remove('hidden');
});

socket.on('gameOver', ({ winner, state }) => {
  winnerName.textContent = winner;
  gameOverModal.classList.remove('hidden');
  if (state) renderState(state);
});

socket.on('gameStarted', ({ state }) => {
  gameOverModal.classList.add('hidden');
  renderState(state);
  showEvent('🃏 새 게임 시작!');
});

socket.on('actionError', ({ message }) => {
  showEvent(`❌ ${message}`);
});

socket.on('joinError', ({ message }) => {
  showEvent(`❌ ${message}`);
  setTimeout(() => window.location.href = '/', 2000);
});
