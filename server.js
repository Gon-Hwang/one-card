const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

app.get('/api/server-info', (req, res) => {
  res.json({ ips: getLocalIPs(), port: PORT });
});

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 10;
const HAND_SIZE = 7;

const rooms = new Map();
const aiMoveTimers = new Map();

function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family !== 'IPv4' || iface.internal) continue;
      // WSL, 가상 어댑터, VPN 등 제외
      if (iface.address.startsWith('172.')) continue;
      if (/vethernet|wsl|loopback|vmware|virtualbox|hyper-v/i.test(name)) continue;
      ips.push(iface.address);
    }
  }
  return ips;
}

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank });
    }
  }
  deck.push({ suit: '★', rank: 'Joker' });
  deck.push({ suit: '☆', rank: 'Joker' });
  return deck;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function isRed(suit) {
  return suit === '♥' || suit === '♦';
}

function canPlay(card, topCard, currentSuit, drawStack, drawStackType) {
  if (drawStack > 0) {
    if (drawStackType === '2') return card.rank === '2';
    if (drawStackType === 'Joker') return card.rank === 'Joker';
  }
  if (card.rank === 'Joker') return true;
  const effectiveSuit = currentSuit || topCard.suit;
  return card.suit === effectiveSuit || card.rank === topCard.rank;
}

class GameRoom {
  constructor(roomId) {
    this.id = roomId;
    this.players = [];
    this.deck = [];
    this.discardPile = [];
    this.currentPlayerIndex = 0;
    this.direction = 1;
    this.currentSuit = null;
    this.drawStack = 0;
    this.drawStackType = null;
    this.gameStarted = false;
    this.gameOver = false;
    this.winner = null;
    this.hostId = null;
    this.pendingSuit = false;
  }

  addPlayer(socketId, name) {
    if (this.players.length >= MAX_PLAYERS || this.gameStarted) return false;
    const trimmed = name.trim().slice(0, 12) || '플레이어';
    this.players.push({ id: socketId, name: trimmed, hand: [], oneCardSafe: false });
    if (!this.hostId) this.hostId = socketId;
    return true;
  }

  addBot() {
    if (this.players.length >= MAX_PLAYERS || this.gameStarted) return null;
    const botNum = this.players.filter(p => p.isBot).length + 1;
    const botId = `bot_${this.id}_${botNum}`;
    const name = `AI ${botNum}`;
    this.players.push({ id: botId, name, hand: [], oneCardSafe: false, isBot: true });
    return botId;
  }

  removePlayer(socketId) {
    const idx = this.players.findIndex(p => p.id === socketId);
    if (idx === -1) return;
    this.players.splice(idx, 1);
    if (this.hostId === socketId && this.players.length > 0) {
      this.hostId = this.players[0].id;
    }
    if (this.gameStarted && !this.gameOver && this.players.length > 0) {
      if (this.currentPlayerIndex >= this.players.length) {
        this.currentPlayerIndex = 0;
      }
    }
  }

  startGame() {
    if (this.players.length < 2) return false;
    this.deck = shuffle(createDeck());
    this.discardPile = [];
    this.currentPlayerIndex = 0;
    this.direction = 1;
    this.currentSuit = null;
    this.drawStack = 0;
    this.drawStackType = null;
    this.gameOver = false;
    this.winner = null;
    this.pendingSuit = false;

    for (const player of this.players) {
      player.hand = [];
      player.oneCardSafe = false;
      for (let i = 0; i < HAND_SIZE; i++) {
        player.hand.push(this.drawFromDeck());
      }
    }

    let firstCard;
    do {
      firstCard = this.drawFromDeck();
    } while (['2', 'A', '7', 'Q', 'J', 'K', 'Joker'].includes(firstCard.rank));

    this.discardPile.push(firstCard);
    this.currentSuit = firstCard.suit;
    this.gameStarted = true;
    return true;
  }

  drawFromDeck() {
    if (this.deck.length === 0) {
      const top = this.discardPile.pop();
      this.deck = shuffle(this.discardPile);
      this.discardPile = top ? [top] : [];
    }
    return this.deck.length > 0 ? this.deck.pop() : { suit: '♠', rank: 'A' };
  }

  get currentPlayer() {
    return this.players[this.currentPlayerIndex];
  }

  get topCard() {
    return this.discardPile[this.discardPile.length - 1];
  }

  advanceTurn(skip = false) {
    const steps = skip ? 2 : 1;
    this.currentPlayerIndex = (this.currentPlayerIndex + this.direction * steps + this.players.length * 10) % this.players.length;
  }

  playCard(socketId, cardIndex, chosenSuit) {
    const player = this.players.find(p => p.id === socketId);
    if (!player) return { success: false, error: '플레이어 없음' };
    if (this.currentPlayer.id !== socketId) return { success: false, error: '당신 차례가 아닙니다' };
    if (this.pendingSuit) return { success: false, error: '무늬를 먼저 선택하세요' };

    const card = player.hand[cardIndex];
    if (!card) return { success: false, error: '잘못된 카드' };

    if (!canPlay(card, this.topCard, this.currentSuit, this.drawStack, this.drawStackType)) {
      return { success: false, error: '낼 수 없는 카드입니다' };
    }

    if (card.rank === '7' && !chosenSuit) {
      return { success: false, needSuit: true };
    }

    player.hand.splice(cardIndex, 1);
    this.discardPile.push(card);
    player.oneCardSafe = false;

    if (player.hand.length === 0) {
      this.gameOver = true;
      this.winner = player.name;
      return { success: true, gameOver: true, winner: player.name };
    }

    let effect = null;

    if (card.rank === '2') {
      this.drawStack += 2;
      this.drawStackType = '2';
      this.currentSuit = card.suit;
      this.advanceTurn();
      effect = 'draw2';
    } else if (card.rank === 'A') {
      const nextIdx = (this.currentPlayerIndex + this.direction + this.players.length * 10) % this.players.length;
      for (let i = 0; i < 3; i++) this.players[nextIdx].hand.push(this.drawFromDeck());
      this.currentSuit = card.suit;
      this.advanceTurn();
      effect = 'draw3';
    } else if (card.rank === 'Q') {
      this.direction *= -1;
      this.currentSuit = card.suit;
      this.advanceTurn();
      effect = 'reverse';
    } else if (card.rank === 'J') {
      this.currentSuit = card.suit;
      this.advanceTurn(true);
      effect = 'skip';
    } else if (card.rank === 'K') {
      this.currentSuit = card.suit;
      this.currentPlayerIndex = (this.currentPlayerIndex + this.direction * 3 + this.players.length * 10) % this.players.length;
      effect = 'skip2';
    } else if (card.rank === '7') {
      if (!SUITS.includes(chosenSuit)) {
        player.hand.splice(cardIndex, 0, card);
        this.discardPile.pop();
        return { success: false, needSuit: true };
      }
      this.currentSuit = chosenSuit;
      this.advanceTurn();
      effect = 'wild';
    } else if (card.rank === 'Joker') {
      this.drawStack += 4;
      this.drawStackType = 'Joker';
      this.advanceTurn();
      effect = 'joker';
    } else {
      this.currentSuit = card.suit;
      this.advanceTurn();
      effect = 'normal';
    }

    return { success: true, effect, drawStack: this.drawStack, card };
  }

  drawCards(socketId) {
    const player = this.players.find(p => p.id === socketId);
    if (!player) return { success: false, error: '플레이어 없음' };
    if (this.currentPlayer.id !== socketId) return { success: false, error: '당신 차례가 아닙니다' };

    const count = this.drawStack > 0 ? this.drawStack : 1;
    const drawn = [];
    for (let i = 0; i < count; i++) {
      const card = this.drawFromDeck();
      player.hand.push(card);
      drawn.push(card);
    }

    this.drawStack = 0;
    this.drawStackType = null;
    this.advanceTurn();

    return { success: true, drawn, count };
  }

  declareOneCard(socketId) {
    const player = this.players.find(p => p.id === socketId);
    if (!player || player.hand.length !== 1) return false;
    player.oneCardSafe = true;
    return true;
  }

  reportPlayer(reporterSocketId, targetSocketId) {
    const reporter = this.players.find(p => p.id === reporterSocketId);
    const target = this.players.find(p => p.id === targetSocketId);
    if (!reporter || !target) return { success: false };
    if (target.hand.length !== 1 || target.oneCardSafe) return { success: false };

    target.hand.push(this.drawFromDeck());
    return { success: true, targetName: target.name };
  }

  getState(forSocketId) {
    return {
      roomId: this.id,
      gameStarted: this.gameStarted,
      gameOver: this.gameOver,
      winner: this.winner,
      topCard: this.topCard,
      currentSuit: this.currentSuit,
      currentPlayerId: this.currentPlayer?.id,
      direction: this.direction,
      drawStack: this.drawStack,
      drawStackType: this.drawStackType,
      deckCount: this.deck.length,
      hostId: this.hostId,
      players: this.players.map(p => ({
        id: p.id,
        name: p.name,
        cardCount: p.hand.length,
        oneCardSafe: p.oneCardSafe,
        isHost: p.id === this.hostId,
        isBot: !!p.isBot,
        hand: p.id === forSocketId ? p.hand : undefined
      }))
    };
  }
}

function broadcastState(room) {
  for (const p of room.players) {
    if (!p.isBot) {
      io.to(p.id).emit('gameUpdate', { state: room.getState(p.id) });
    }
  }
}

function scheduleAIMove(room) {
  if (room.gameOver || !room.gameStarted) return;
  const current = room.currentPlayer;
  if (!current || !current.isBot) return;

  if (aiMoveTimers.has(room.id)) {
    clearTimeout(aiMoveTimers.get(room.id));
  }

  const delay = 800 + Math.random() * 700;
  const timer = setTimeout(() => {
    aiMoveTimers.delete(room.id);
    const r = rooms.get(room.id);
    if (!r || r.gameOver || !r.gameStarted) return;
    const bot = r.currentPlayer;
    if (!bot || !bot.isBot) return;
    performAITurn(r, bot);
  }, delay);

  aiMoveTimers.set(room.id, timer);
}

function performAITurn(room, bot) {
  const topCard = room.topCard;
  const { currentSuit, drawStack, drawStackType } = room;

  const playable = bot.hand
    .map((card, i) => ({ card, i }))
    .filter(({ card }) => canPlay(card, topCard, currentSuit, drawStack, drawStackType));

  if (playable.length === 0) {
    const result = room.drawCards(bot.id);
    if (result.success) {
      broadcastState(room);
      io.to(room.id).emit('cardDrawn', { playerName: bot.name, count: result.count });
      scheduleAIMove(room);
    }
    return;
  }

  // 특수 카드 우선순위: Joker > 2 > A > 3 > 7 > 일반
  const priority = { Joker: 7, '2': 6, A: 5, Q: 4, K: 3, J: 3, '7': 2 };
  playable.sort((a, b) => (priority[b.card.rank] || 1) - (priority[a.card.rank] || 1));

  const { card, i } = playable[0];

  let chosenSuit = null;
  if (card.rank === '7') {
    const counts = {};
    for (const c of bot.hand) {
      if (c !== card && c.rank !== 'Joker') counts[c.suit] = (counts[c.suit] || 0) + 1;
    }
    chosenSuit = SUITS.reduce((a, b) => (counts[a] || 0) >= (counts[b] || 0) ? a : b);
  }

  const result = room.playCard(bot.id, i, chosenSuit);

  if (!result.success) {
    const drawResult = room.drawCards(bot.id);
    if (drawResult.success) {
      broadcastState(room);
      io.to(room.id).emit('cardDrawn', { playerName: bot.name, count: drawResult.count });
      scheduleAIMove(room);
    }
    return;
  }

  if (result.gameOver) {
    io.to(room.id).emit('gameOver', { winner: result.winner, state: room.getState() });
    return;
  }

  // 원카드 자동 선언
  if (bot.hand.length === 1 && !bot.oneCardSafe) {
    bot.oneCardSafe = true;
  }

  broadcastState(room);
  io.to(room.id).emit('cardPlayed', {
    playerName: bot.name,
    card: result.card,
    effect: result.effect,
    drawStack: result.drawStack
  });

  if (bot.oneCardSafe && bot.hand.length === 1) {
    io.to(room.id).emit('oneCardDeclared', { playerName: bot.name });
  }

  scheduleAIMove(room);
}

io.on('connection', (socket) => {
  let currentRoomId = null;
  let playerName = null;

  socket.on('rejoinRoom', ({ roomId, name }) => {
    const rid = roomId;
    const room = rooms.get(rid);
    if (!room) { socket.emit('joinError', { message: '방을 찾을 수 없습니다.' }); return; }

    const player = room.players.find(p => p.name === name && !p.isBot);
    if (!player) { socket.emit('joinError', { message: '플레이어를 찾을 수 없습니다.' }); return; }

    const oldId = player.id;
    player.id = socket.id;
    if (room.hostId === oldId) room.hostId = socket.id;
    if (room.currentPlayer?.id === oldId) {
      room.players[room.currentPlayerIndex].id = socket.id;
    }

    currentRoomId = rid;
    playerName = name;
    socket.join(rid);
    socket.emit('gameStarted', { state: room.getState(socket.id) });
  });

  socket.on('createRoom', ({ name }) => {
    const roomId = String(Math.floor(10000 + Math.random() * 90000));
    const room = new GameRoom(roomId);
    rooms.set(roomId, room);
    room.addPlayer(socket.id, name);
    currentRoomId = roomId;
    playerName = name;
    socket.join(roomId);
    socket.emit('roomCreated', { roomId, state: room.getState(socket.id) });
  });

  socket.on('joinRoom', ({ roomId, name }) => {
    const rid = roomId;
    const room = rooms.get(rid);
    if (!room) { socket.emit('joinError', { message: '방을 찾을 수 없습니다.' }); return; }
    if (room.gameStarted) { socket.emit('joinError', { message: '이미 게임이 진행 중입니다.' }); return; }
    if (room.players.length >= MAX_PLAYERS) { socket.emit('joinError', { message: `방이 가득 찼습니다. (최대 ${MAX_PLAYERS}명)` }); return; }

    room.addPlayer(socket.id, name);
    currentRoomId = rid;
    playerName = name;
    socket.join(rid);
    socket.emit('roomJoined', { roomId: rid, state: room.getState(socket.id) });
    socket.to(rid).emit('playerJoined', { name: room.players.find(p => p.id === socket.id)?.name, state: room.getState() });
  });

  socket.on('startWithAI', ({ name, botCount }) => {
    const roomId = String(Math.floor(10000 + Math.random() * 90000));
    const room = new GameRoom(roomId);
    rooms.set(roomId, room);
    room.addPlayer(socket.id, name);
    const count = Math.max(1, Math.min(botCount || 1, MAX_PLAYERS - 1));
    for (let i = 0; i < count; i++) room.addBot();
    currentRoomId = roomId;
    playerName = name;
    socket.join(roomId);
    room.startGame();
    socket.emit('gameStarted', { state: room.getState(socket.id) });
    scheduleAIMove(room);
  });

  socket.on('addBot', () => {
    const room = rooms.get(currentRoomId);
    if (!room || room.hostId !== socket.id || room.gameStarted) return;
    if (room.players.length >= MAX_PLAYERS) return;
    const botId = room.addBot();
    if (botId) {
      const bot = room.players.find(p => p.id === botId);
      io.to(currentRoomId).emit('playerJoined', { name: bot.name, state: room.getState() });
    }
  });

  socket.on('removeBot', () => {
    const room = rooms.get(currentRoomId);
    if (!room || room.hostId !== socket.id || room.gameStarted) return;
    const bot = room.players.slice().reverse().find(p => p.isBot);
    if (!bot) return;
    room.removePlayer(bot.id);
    io.to(currentRoomId).emit('playerLeft', { name: bot.name, state: room.getState() });
  });

  socket.on('startGame', () => {
    const room = rooms.get(currentRoomId);
    if (!room || room.hostId !== socket.id) return;
    if (!room.startGame()) { socket.emit('joinError', { message: '최소 2명이 필요합니다.' }); return; }
    for (const p of room.players) {
      if (!p.isBot) {
        io.to(p.id).emit('gameStarted', { state: room.getState(p.id) });
      }
    }
    scheduleAIMove(room);
  });

  socket.on('playCard', ({ cardIndex, chosenSuit }) => {
    const room = rooms.get(currentRoomId);
    if (!room || !room.gameStarted || room.gameOver) return;

    const result = room.playCard(socket.id, cardIndex, chosenSuit);
    if (!result.success) {
      if (result.needSuit) { socket.emit('chooseSuit', {}); }
      else { socket.emit('actionError', { message: result.error }); }
      return;
    }

    if (result.gameOver) {
      io.to(currentRoomId).emit('gameOver', { winner: result.winner, state: room.getState() });
      return;
    }
    broadcastState(room);
    io.to(currentRoomId).emit('cardPlayed', {
      playerName: room.players.find(p => p.id === socket.id)?.name || playerName,
      card: result.card,
      effect: result.effect,
      drawStack: result.drawStack
    });
    scheduleAIMove(room);
  });

  socket.on('drawCard', () => {
    const room = rooms.get(currentRoomId);
    if (!room || !room.gameStarted || room.gameOver) return;

    const result = room.drawCards(socket.id);
    if (!result.success) { socket.emit('actionError', { message: result.error }); return; }

    broadcastState(room);
    io.to(currentRoomId).emit('cardDrawn', { playerName, count: result.count });
    scheduleAIMove(room);
  });

  socket.on('declareOneCard', () => {
    const room = rooms.get(currentRoomId);
    if (!room) return;
    if (room.declareOneCard(socket.id)) {
      broadcastState(room);
      io.to(currentRoomId).emit('oneCardDeclared', { playerName });
    }
  });

  socket.on('reportPlayer', ({ targetId }) => {
    const room = rooms.get(currentRoomId);
    if (!room || !room.gameStarted) return;
    const result = room.reportPlayer(socket.id, targetId);
    if (result.success) {
      broadcastState(room);
      io.to(currentRoomId).emit('playerReported', {
        reporterName: playerName,
        targetName: result.targetName
      });
    }
  });

  socket.on('sendChat', ({ message }) => {
    if (!currentRoomId || !message) return;
    io.to(currentRoomId).emit('chatMessage', {
      playerName,
      message: message.trim().slice(0, 100)
    });
  });

  socket.on('disconnect', () => {
    const room = rooms.get(currentRoomId);
    if (!room) return;

    if (room.gameStarted && !room.gameOver) {
      // 게임 중 접속 끊김: 바로 삭제하지 않고 60초 유예 (페이지 이동 재접속 허용)
      const player = room.players.find(p => p.id === socket.id);
      if (player) player.connected = false;
      setTimeout(() => {
        const r = rooms.get(currentRoomId);
        if (!r) return;
        const p = r.players.find(p => p.id === socket.id && !p.connected);
        if (p) {
          r.removePlayer(p.id);
          if (r.players.length === 0) rooms.delete(currentRoomId);
        }
      }, 60000);
    } else {
      room.removePlayer(socket.id);
      if (room.players.length === 0) {
        rooms.delete(currentRoomId);
      } else {
        io.to(currentRoomId).emit('playerLeft', { name: playerName, state: room.getState() });
      }
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const ips = getLocalIPs();
  console.log('\n🃏  원카드 서버 시작!\n');
  console.log('📡  접속 주소:');
  console.log(`    로컬:     http://localhost:${PORT}`);
  ips.forEach(ip => console.log(`    네트워크: http://${ip}:${PORT}  ← 같은 WiFi 기기에서 이 주소로 접속`));
  console.log('\n게임 방법: 방 만들기 → 코드 공유 → 참가자들 입장 → 시작!\n');
});
