'use strict';

/* =========================================================
   BLOCK CASCADE
   Classic falling-block puzzle (Tetris-like), vanilla JS.
   7-bag randomizer, hold, ghost piece, lock delay, level speed-up.
   ========================================================= */

const COLS = 10, ROWS = 20, CELL = 30;
const BEST_KEY = 'blockCascadeBest';

const PIECES = {
  I: { size: 4, cells: [[0, 1], [1, 1], [2, 1], [3, 1]], color: '#4df3ff' },
  O: { size: 2, cells: [[0, 0], [1, 0], [0, 1], [1, 1]], color: '#ffd24d' },
  T: { size: 3, cells: [[1, 0], [0, 1], [1, 1], [2, 1]], color: '#b678ff' },
  S: { size: 3, cells: [[1, 0], [2, 0], [0, 1], [1, 1]], color: '#7dffb3' },
  Z: { size: 3, cells: [[0, 0], [1, 0], [1, 1], [2, 1]], color: '#ff4d6a' },
  J: { size: 3, cells: [[0, 0], [0, 1], [1, 1], [2, 1]], color: '#4d7bff' },
  L: { size: 3, cells: [[2, 0], [0, 1], [1, 1], [2, 1]], color: '#ff9d4d' },
};

function rotateCW(cells, size) { return cells.map(([x, y]) => [size - 1 - y, x]); }
function rotateCCW(cells, size) { return cells.map(([x, y]) => [y, size - 1 - x]); }

const getBest = () => Number(localStorage.getItem(BEST_KEY) || 0);
const setBest = v => localStorage.setItem(BEST_KEY, String(v));

// ---------- DOM ----------
const boardCanvas = document.getElementById('board-canvas');
const bctx = boardCanvas.getContext('2d');
const holdCanvas = document.getElementById('hold-canvas');
const hctx = holdCanvas.getContext('2d');
const nextCanvases = [0, 1, 2].map(i => document.getElementById('next-canvas-' + i));
const nextCtxs = nextCanvases.map(c => c.getContext('2d'));

const scoreText = document.getElementById('score-text');
const levelText = document.getElementById('level-text');
const linesText = document.getElementById('lines-text');
const bestScoreEl = document.getElementById('best-score');

const startScreen = document.getElementById('start-screen');
const pauseScreen = document.getElementById('pause-screen');
const gameoverScreen = document.getElementById('gameover-screen');

document.getElementById('best-score-start').textContent = getBest();
bestScoreEl.textContent = getBest();

document.getElementById('start-btn').addEventListener('click', startGame);
document.getElementById('retry-btn').addEventListener('click', startGame);
document.getElementById('resume-btn').addEventListener('click', () => setPaused(false));

// ---------- state ----------
// Initialized here (not just in startGame) because the render loop below
// starts immediately on load, before Start is pressed, and renders this
// state every frame — leaving it `undefined` crashed renderBoard() on the
// very first animation frame.
let board = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
let active = null, holdType = null, holdUsed = false, bagQueue = [], nextQueue = [];
let score = 0, level = 1, lines = 0, dropInterval = 1000;
let grounded = false, lockTimer = 0, softDrop = false, running = false, paused = false, over = false;
let dasDir = 0, dasTimer = 0, dasActive = false;
const DAS_DELAY = 170, ARR_RATE = 45, LOCK_DELAY = 500;

function newBag() {
  const bag = Object.keys(PIECES);
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  return bag;
}

function nextFromBag() {
  if (bagQueue.length === 0) bagQueue = newBag();
  return bagQueue.shift();
}

function refillQueue() {
  while (nextQueue.length < 3) nextQueue.push(nextFromBag());
}

function spawnFromType(type) {
  const def = PIECES[type];
  return {
    type,
    size: def.size,
    cells: def.cells.map(c => [...c]),
    color: def.color,
    x: Math.floor((COLS - def.size) / 2),
    y: 0,
  };
}

function spawnNext() {
  refillQueue();
  const type = nextQueue.shift();
  refillQueue();
  active = spawnFromType(type);
  holdUsed = false;
  grounded = false;
  lockTimer = 0;
  if (collides(active, 0, 0)) {
    endGame();
  }
}

function collides(piece, offX, offY, cellsOverride) {
  const cells = cellsOverride || piece.cells;
  for (const [cx, cy] of cells) {
    const bx = piece.x + cx + offX;
    const by = piece.y + cy + offY;
    if (bx < 0 || bx >= COLS || by >= ROWS) return true;
    if (by >= 0 && board[by][bx]) return true;
  }
  return false;
}

function tryMove(dx, dy) {
  if (!active || collides(active, dx, dy)) return false;
  active.x += dx;
  active.y += dy;
  if (grounded) { lockTimer = 0; }
  return true;
}

function tryRotate(dir) {
  if (!active) return;
  const newCells = dir > 0 ? rotateCW(active.cells, active.size) : rotateCCW(active.cells, active.size);
  const kicks = [[0, 0], [-1, 0], [1, 0], [0, -1], [-2, 0], [2, 0]];
  for (const [kx, ky] of kicks) {
    if (!collides(active, kx, ky, newCells)) {
      active.cells = newCells;
      active.x += kx;
      active.y += ky;
      if (grounded) lockTimer = 0;
      return;
    }
  }
}

function ghostY() {
  let gy = 0;
  while (!collides(active, 0, gy + 1)) gy++;
  return active.y + gy;
}

function hardDrop() {
  if (!active) return;
  let dist = 0;
  while (!collides(active, 0, dist + 1)) dist++;
  active.y += dist;
  score += dist * 2;
  lockPiece();
}

let clearing = null; // { rows, timer, totalTimer }

function lockPiece() {
  for (const [cx, cy] of active.cells) {
    const bx = active.x + cx, by = active.y + cy;
    if (by >= 0 && by < ROWS) board[by][bx] = active.color;
  }
  active = null;

  const fullRows = [];
  for (let r = 0; r < ROWS; r++) {
    if (board[r].every(c => c)) fullRows.push(r);
  }

  if (fullRows.length > 0) {
    clearing = { rows: fullRows, timer: 220, total: 220 };
  } else {
    spawnNext();
  }
}

function finishClear() {
  const n = clearing.rows.length;
  const rowsSet = new Set(clearing.rows);
  board = board.filter((_, r) => !rowsSet.has(r));
  while (board.length < ROWS) board.unshift(Array(COLS).fill(null));

  const points = [0, 100, 300, 500, 800][n] * level;
  score += points;
  lines += n;
  const newLevel = Math.floor(lines / 10) + 1;
  if (newLevel !== level) {
    level = newLevel;
    dropInterval = Math.max(90, 1000 * Math.pow(0.85, level - 1));
  }
  clearing = null;
  spawnNext();
  updateHud();
}

// ---------- hold ----------
function doHold() {
  if (!active || holdUsed) return;
  holdUsed = true;
  const curType = active.type;
  if (holdType === null) {
    holdType = curType;
    spawnNext();
    holdUsed = true;
  } else {
    const swapType = holdType;
    holdType = curType;
    active = spawnFromType(swapType);
    grounded = false;
    lockTimer = 0;
    if (collides(active, 0, 0)) endGame();
  }
}

// ---------- input ----------
window.addEventListener('keydown', (e) => {
  if (!running || over) return;
  const k = e.key.toLowerCase();
  if (k === 'p' || k === 'escape') { setPaused(!paused); return; }
  if (paused) return;

  if (k === 'arrowleft') {
    if (dasDir !== -1) { tryMove(-1, 0); dasDir = -1; dasTimer = 0; dasActive = false; }
    e.preventDefault();
  } else if (k === 'arrowright') {
    if (dasDir !== 1) { tryMove(1, 0); dasDir = 1; dasTimer = 0; dasActive = false; }
    e.preventDefault();
  } else if (k === 'arrowdown') {
    softDrop = true;
  } else if (k === 'arrowup' || k === 'x') {
    tryRotate(1);
  } else if (k === 'z') {
    tryRotate(-1);
  } else if (k === ' ') {
    hardDrop();
    e.preventDefault();
  } else if (k === 'c') {
    doHold();
  }
});

window.addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'arrowleft' && dasDir === -1) { dasDir = 0; dasActive = false; }
  if (k === 'arrowright' && dasDir === 1) { dasDir = 0; dasActive = false; }
  if (k === 'arrowdown') softDrop = false;
});

// mobile buttons
document.getElementById('mobile-controls').addEventListener('touchstart', (e) => {
  const btn = e.target.closest('button');
  if (!btn || !running || over || paused) return;
  const act = btn.dataset.act;
  if (act === 'left') tryMove(-1, 0);
  else if (act === 'right') tryMove(1, 0);
  else if (act === 'down') tryMove(0, 1);
  else if (act === 'rotate') tryRotate(1);
  else if (act === 'hold') doHold();
  else if (act === 'drop') hardDrop();
  e.preventDefault();
}, { passive: false });
document.getElementById('mobile-controls').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn || !running || over || paused) return;
  const act = btn.dataset.act;
  if (act === 'left') tryMove(-1, 0);
  else if (act === 'right') tryMove(1, 0);
  else if (act === 'down') tryMove(0, 1);
  else if (act === 'rotate') tryRotate(1);
  else if (act === 'hold') doHold();
  else if (act === 'drop') hardDrop();
});

// ---------- rendering ----------
function drawCell(ctx, px, py, size, color) {
  ctx.fillStyle = color;
  ctx.fillRect(px, py, size, size);
  ctx.fillStyle = '#ffffff33';
  ctx.fillRect(px, py, size, size * 0.28);
  ctx.strokeStyle = '#00000055';
  ctx.lineWidth = 1;
  ctx.strokeRect(px + 0.5, py + 0.5, size - 1, size - 1);
}

function renderBoard() {
  bctx.clearRect(0, 0, boardCanvas.width, boardCanvas.height);

  // grid
  bctx.strokeStyle = '#ffffff0a';
  for (let c = 0; c <= COLS; c++) {
    bctx.beginPath(); bctx.moveTo(c * CELL, 0); bctx.lineTo(c * CELL, ROWS * CELL); bctx.stroke();
  }
  for (let r = 0; r <= ROWS; r++) {
    bctx.beginPath(); bctx.moveTo(0, r * CELL); bctx.lineTo(COLS * CELL, r * CELL); bctx.stroke();
  }

  // locked cells
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (board[r][c]) drawCell(bctx, c * CELL, r * CELL, CELL, board[r][c]);
    }
  }

  // clearing flash
  if (clearing) {
    const alpha = clearing.timer / clearing.total;
    bctx.fillStyle = `rgba(255,255,255,${0.15 + alpha * 0.65})`;
    for (const r of clearing.rows) bctx.fillRect(0, r * CELL, COLS * CELL, CELL);
  }

  if (active && !clearing) {
    // ghost
    const gy = ghostY();
    bctx.globalAlpha = 0.25;
    for (const [cx, cy] of active.cells) {
      const bx = active.x + cx, by = gy + cy;
      if (by >= 0) drawCell(bctx, bx * CELL, by * CELL, CELL, active.color);
    }
    bctx.globalAlpha = 1;

    // active piece
    for (const [cx, cy] of active.cells) {
      const bx = active.x + cx, by = active.y + cy;
      if (by >= 0) drawCell(bctx, bx * CELL, by * CELL, CELL, active.color);
    }
  }
}

function renderMini(ctx, canvas, type) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!type) return;
  const def = PIECES[type];
  const cell = 18;
  const w = def.size * cell, h = def.size * cell;
  const offX = (canvas.width - w) / 2;
  const offY = (canvas.height - h) / 2;
  for (const [cx, cy] of def.cells) {
    drawCell(ctx, offX + cx * cell, offY + cy * cell, cell, def.color);
  }
}

function renderPreviews() {
  renderMini(hctx, holdCanvas, holdType);
  for (let i = 0; i < 3; i++) renderMini(nextCtxs[i], nextCanvases[i], nextQueue[i]);
}

function updateHud() {
  scoreText.textContent = score.toLocaleString('en-US');
  levelText.textContent = level;
  linesText.textContent = lines;
}

// ---------- main loop ----------
let lastT = 0, gravityAccum = 0;
function loop(t) {
  const dtMs = Math.min(50, t - lastT || 0);
  lastT = t;

  if (running && !paused && !over) {
    // DAS
    if (dasDir !== 0) {
      dasTimer += dtMs;
      if (!dasActive && dasTimer >= DAS_DELAY) { dasActive = true; dasTimer = 0; tryMove(dasDir, 0); }
      else if (dasActive && dasTimer >= ARR_RATE) { dasTimer = 0; tryMove(dasDir, 0); }
    }

    if (clearing) {
      clearing.timer -= dtMs;
      if (clearing.timer <= 0) finishClear();
    } else if (active) {
      const interval = softDrop ? Math.min(dropInterval, 35) : dropInterval;
      gravityAccum += dtMs;
      if (gravityAccum >= interval) {
        gravityAccum = 0;
        if (tryMove(0, 1)) {
          grounded = false;
          if (softDrop) score += 1;
        } else {
          grounded = true;
        }
      }
      if (grounded) {
        lockTimer += dtMs;
        if (lockTimer >= LOCK_DELAY) lockPiece();
      }
    }

    updateHud();
  }

  renderBoard();
  renderPreviews();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ---------- flow ----------
function startGame() {
  board = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  bagQueue = [];
  nextQueue = [];
  refillQueue();
  holdType = null;
  holdUsed = false;
  score = 0; level = 1; lines = 0;
  dropInterval = 1000;
  grounded = false; lockTimer = 0; softDrop = false;
  clearing = null;
  dasDir = 0; dasActive = false; dasTimer = 0;
  gravityAccum = 0;
  running = true; paused = false; over = false;

  spawnNext();
  updateHud();

  startScreen.classList.add('hidden');
  pauseScreen.classList.add('hidden');
  gameoverScreen.classList.add('hidden');
  document.getElementById('new-best').classList.add('hidden');
}

function setPaused(v) {
  if (!running || over) return;
  paused = v;
  pauseScreen.classList.toggle('hidden', !v);
}

function endGame() {
  running = false;
  over = true;
  active = null;
  const best = getBest();
  const isNew = score > best;
  if (isNew) setBest(score);

  document.getElementById('final-score').textContent = score.toLocaleString('en-US');
  document.getElementById('final-level').textContent = level;
  document.getElementById('final-lines').textContent = lines;
  document.getElementById('best-score-end').textContent = isNew ? score : best;
  document.getElementById('new-best').classList.toggle('hidden', !isNew);
  bestScoreEl.textContent = isNew ? score : best;

  gameoverScreen.classList.remove('hidden');
}
