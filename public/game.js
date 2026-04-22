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
let prevTopCardKey = null;

socket.on('connect', () => {
  mySocketId = socket.id;
  myNameEl.textContent = myName;
  topRoomCode.textContent = roomId;
  sessionStorage.removeItem('gameState');
  if (roomId && myName) socket.emit('rejoinRoom', { roomId, name: myName });
});

function isRed(suit) { return suit === '♥' || suit === '♦'; }

function cardColorClass(card) {
  if (card.rank === 'Joker') return 'joker-card';
  return isRed(card.suit) ? 'red-card' : 'black-card';
}

function canPlayCard(card) {
  if (!currentState) return false;
  const { topCard, currentSuit, drawStack, drawStackType } = currentState;
  if (!topCard) return false;
  if (drawStack > 0) {
    if (drawStackType === '2') return card.rank === '2';
    if (drawStackType === 'Joker') return card.rank === 'Joker';
    if (drawStackType === 'A') return card.rank === 'A';
  }
  if (card.rank === 'Joker') return true;
  const effectiveSuit = currentSuit || topCard.suit;
  return card.suit === effectiveSuit || card.rank === topCard.rank;
}

// ── 카드 날아가는 애니메이션 ──────────────────────────────────────────
function animateCardFly(fromEl, card) {
  if (!fromEl) return;
  const fromRect = fromEl.getBoundingClientRect();
  const toRect   = topCardDisplay.getBoundingClientRect();

  const clone = document.createElement('div');
  const colorClass = card ? cardColorClass(card) : 'card-back';
  clone.className = `card ${colorClass} card-fly`;

  if (card) {
    const rank = card.rank === 'Joker' ? 'J○' : card.rank;
    clone.innerHTML = `
      <div class="card-rank">${rank}</div>
      <div class="card-suit">${card.suit}</div>
      <div class="card-rank-bottom">${rank}</div>`;
  } else {
    clone.innerHTML = '<div class="card-back-design">🃏</div>';
  }

  Object.assign(clone.style, {
    position: 'fixed',
    top:    fromRect.top  + 'px',
    left:   fromRect.left + 'px',
    width:  fromRect.width  + 'px',
    height: fromRect.height + 'px',
    zIndex: '600',
    pointerEvents: 'none',
    willChange: 'transform, opacity',
    margin: '0',
  });
  document.body.appendChild(clone);

  const dx = (toRect.left + toRect.width  / 2) - (fromRect.left + fromRect.width  / 2);
  const dy = (toRect.top  + toRect.height / 2) - (fromRect.top  + fromRect.height / 2);
  const scale = Math.min(toRect.width / fromRect.width, toRect.height / fromRect.height) * 0.85;

  requestAnimationFrame(() => requestAnimationFrame(() => {
    clone.style.transition = 'transform 0.19s cubic-bezier(0.4,0,0.2,1), opacity 0.08s ease 0.13s';
    clone.style.transform  = `translate(${dx}px,${dy}px) scale(${scale})`;
    clone.style.opacity    = '0';
    setTimeout(() => clone.remove(), 320);
  }));
}

function triggerDiscardLand() {
  topCardDisplay.classList.remove('card-land');
  void topCardDisplay.offsetWidth;
  topCardDisplay.classList.add('card-land');
}

function triggerDeckPulse() {
  drawPile.classList.remove('deck-deal');
  void drawPile.offsetWidth;
  drawPile.classList.add('deck-deal');
  setTimeout(() => drawPile.classList.remove('deck-deal'), 300);
}
// ──────────────────────────────────────────────────────────────────────

function renderState(state) {
  currentState = state;
  if (!state) return;

  const isMyTurn = state.currentPlayerId === mySocketId;
  const me = state.players.find(p => p.id === mySocketId);

  turnInfo.textContent = isMyTurn
    ? '🎴 내 차례!'
    : `${state.players.find(p => p.id === state.currentPlayerId)?.name || '?'} 차례`;
  turnInfo.classList.toggle('my-turn', isMyTurn);
  directionInfo.textContent = state.direction === 1 ? '▶ 시계 방향' : '◀ 반시계 방향';

  if (state.drawStack > 0) {
    drawStackBadge.classList.remove('hidden');
    drawStackNum.textContent = state.drawStack;
  } else {
    drawStackBadge.classList.add('hidden');
  }

  // 버린 패 – 바뀐 카드면 land 애니메이션
  if (state.topCard) {
    const tc = state.topCard;
    const newKey = `${tc.suit}-${tc.rank}`;
    const colorClass = cardColorClass(tc);
    topCardDisplay.className = `card ${colorClass}`;
    topCardRank.textContent = tc.rank === 'Joker' ? 'J○' : tc.rank;
    topCardSuit.textContent  = tc.suit;
    let bottomEl = topCardDisplay.querySelector('.card-rank-bottom');
    if (!bottomEl) {
      bottomEl = document.createElement('div');
      bottomEl.className = 'card-rank-bottom';
      topCardDisplay.appendChild(bottomEl);
    }
    bottomEl.textContent = tc.rank === 'Joker' ? 'J○' : tc.rank;

    if (prevTopCardKey && prevTopCardKey !== newKey) {
      topCardDisplay.classList.add('card-land');
    }
    prevTopCardKey = newKey;
  }

  if (state.currentSuit) {
    currentSuitDisplay.classList.remove('hidden');
    currentSuitDisplay.classList.add('visible');
    currentSuitIcon.textContent   = state.currentSuit;
    currentSuitIcon.style.color   = isRed(state.currentSuit) ? '#e02020' : '#fff';
  } else {
    currentSuitDisplay.classList.add('hidden');
  }

  deckCount.textContent = state.deckCount;

  // 상대 플레이어
  opponentsArea.innerHTML = '';
  for (const p of state.players) {
    if (p.id === mySocketId) continue;
    const div = document.createElement('div');
    div.className = 'opponent-card';
    if (p.id === state.currentPlayerId) div.classList.add('active-turn');

    const miniCards = Math.min(p.cardCount, 8);
    const miniHTML  = Array.from({ length: miniCards }, () => '<div class="mini-card"></div>').join('');
    div.innerHTML = `
      <div class="opponent-name">${p.isBot ? '🤖 ' : ''}${p.name}</div>
      <div class="opponent-count">${p.cardCount}장</div>
      <div class="opponent-mini-cards">${miniHTML}</div>`;
    div.dataset.playerName = p.name;
    opponentsArea.appendChild(div);
  }

  // 내 손패
  if (me?.hand) {
    myHand.innerHTML = '';
    myCardCount.textContent = me.hand.length;
    me.hand.forEach((card, idx) => {
      const wrapper = document.createElement('div');
      const playable = isMyTurn && canPlayCard(card);
      wrapper.className = `card ${cardColorClass(card)} ${playable ? 'playable' : 'not-playable'}`;
      const rank = card.rank === 'Joker' ? 'J○' : card.rank;
      wrapper.innerHTML = `
        <div class="card-rank">${rank}</div>
        <div class="card-suit">${card.suit}</div>
        <div class="card-rank-bottom">${rank}</div>`;
      if (playable) wrapper.addEventListener('click', () => playCard(idx, card, wrapper));
      myHand.appendChild(wrapper);
    });
  }

  drawPile.style.opacity = isMyTurn ? '1' : '0.6';
  drawPile.style.cursor  = isMyTurn ? 'pointer' : 'not-allowed';
}

function playCard(idx, card, cardEl) {
  if (card.rank === '7') {
    pendingCardIndex = idx;
    suitModal.classList.remove('hidden');
    return;
  }
  animateCardFly(cardEl, card);
  socket.emit('playCard', { cardIndex: idx });
}

drawPile.addEventListener('click', () => {
  if (!currentState || currentState.currentPlayerId !== mySocketId) return;
  socket.emit('drawCard');
});

// 스페이스바: 원카드 선언 (내 턴 + 2장) 또는 미선언 신고
document.addEventListener('keydown', e => {
  if (e.code !== 'Space') return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  e.preventDefault();
  if (!currentState) return;
  const me       = currentState.players.find(p => p.id === mySocketId);
  const isMyTurn = currentState.currentPlayerId === mySocketId;
  if (isMyTurn && me?.hand?.length === 2 && !me?.oneCardSafe) {
    socket.emit('declareOneCard');
    return;
  }
  if (currentState.pendingOneCardReport && currentState.pendingOneCardReport.playerId !== mySocketId) {
    socket.emit('reportUndeclared');
  }
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

restartBtn.addEventListener('click', () => {
  gameOverModal.classList.add('hidden');
  socket.emit('startGame');
});
lobbyBtn.addEventListener('click', () => window.location.href = '/');

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
  if (isSystem) { div.textContent = message; }
  else { div.innerHTML = `<span class="msg-name">${name}</span>${message}`; }
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  if (chatPanel.classList.contains('hidden')) chatToggle.classList.add('has-new');
}

function showEvent(msg) {
  const el = document.createElement('div');
  el.className = 'event-item';
  el.textContent = msg;
  eventLog.appendChild(el);
  setTimeout(() => el.remove(), 3100);
}

function showOneCardBanner(name) {
  const banner = document.getElementById('oneCardBanner');
  const nameEl = document.getElementById('oneCardBannerName');
  nameEl.textContent = name;
  banner.classList.remove('hidden');
  setTimeout(() => banner.classList.add('hidden'), 2000);
}

// ── 소켓 이벤트 ──────────────────────────────────────────────────────
socket.on('gameUpdate', ({ state }) => renderState(state));

socket.on('cardPlayed', ({ playerName, card, effect, drawStack }) => {
  // 상대 카드 애니메이션: 해당 opponent-card 요소 → 버린 패
  if (playerName !== myName) {
    const opEl = [...opponentsArea.querySelectorAll('.opponent-card')]
      .find(el => el.dataset.playerName === playerName);
    if (opEl) animateCardFly(opEl, null);
  }

  const cardStr = card.rank === 'Joker' ? '조커' : `${card.suit}${card.rank}`;
  const effects = {
    draw2:   `🃏 ${playerName}이(가) ${cardStr} → 다음 사람 ${drawStack}장 뽑기!`,
    drawA:   `🃏 ${playerName}이(가) ${cardStr} → 다음 사람 ${drawStack}장 뽑기!`,
    joker:   `★ ${playerName}이(가) 조커! → 다음 사람 ${drawStack}장 뽑기!`,
    reverse: `🔄 ${playerName}이(가) ${cardStr} → 방향 전환!`,
    skip:    `⏭ ${playerName}이(가) ${cardStr} → 다음 사람 스킵!`,
    skip2:   `⏭⏭ ${playerName}이(가) ${cardStr} → 2명 스킵!`,
    wild:    `🌈 ${playerName}이(가) 7 → 무늬 변경!`,
    normal:  `${playerName}이(가) ${cardStr} 냄`,
  };
  const msg = effects[effect] || `${playerName}이(가) ${cardStr} 냄`;
  showEvent(msg);
  addChatMsg('', msg, true);
});

socket.on('cardDrawn', ({ playerName, count }) => {
  triggerDeckPulse();
  const msg = count > 1 ? `😱 ${playerName}이(가) ${count}장 뽑음!` : `${playerName}이(가) 카드 뽑음`;
  showEvent(msg);
  addChatMsg('', msg, true);
});

socket.on('oneCardDeclared', ({ playerName }) => {
  showOneCardBanner(playerName);
  const msg = `🎴 ${playerName}: 원카드!!`;
  showEvent(msg);
  addChatMsg('', msg, true);
});

socket.on('oneCardReported', ({ reporterName, targetName }) => {
  const msg = `⚠️ ${reporterName}이(가) 신고! → ${targetName} 원카드 취소 + 1장 추가!`;
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

socket.on('chatMessage', ({ playerName, message }) => addChatMsg(playerName, message));

socket.on('chooseSuit', () => suitModal.classList.remove('hidden'));

socket.on('gameOver', ({ winner, state }) => {
  winnerName.textContent = winner;
  gameOverModal.classList.remove('hidden');
  if (state) renderState(state);
});

socket.on('gameStarted', ({ state }) => {
  gameOverModal.classList.add('hidden');
  prevTopCardKey = null;
  renderState(state);
  showEvent('🃏 새 게임 시작!');
});

socket.on('actionError',  ({ message }) => showEvent(`❌ ${message}`));
socket.on('joinError',    ({ message }) => {
  showEvent(`❌ ${message}`);
  setTimeout(() => window.location.href = '/', 2000);
});
