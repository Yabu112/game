'use strict';

/* =========================================================
   NEON SURVIVOR
   Canvas top-down survival roguelite.
   Survive as long as possible, auto-attack nearest enemy,
   pick random upgrades on level up. Difficulty scales with time.
   ========================================================= */

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

let W = 0, H = 0;
function resize() {
  W = canvas.width = window.innerWidth;
  H = canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

const BEST_KEY = 'neonSurvivorBestScore';
function getBest() { return Number(localStorage.getItem(BEST_KEY) || 0); }
function setBest(v) { localStorage.setItem(BEST_KEY, String(v)); }

// ---------- DOM refs ----------
const hpBar = document.getElementById('hp-bar');
const hpText = document.getElementById('hp-text');
const xpBar = document.getElementById('xp-bar');
const levelText = document.getElementById('level-text');
const timerText = document.getElementById('timer-text');
const killsText = document.getElementById('kills-text');

const startScreen = document.getElementById('start-screen');
const levelupScreen = document.getElementById('levelup-screen');
const gameoverScreen = document.getElementById('gameover-screen');
const pauseScreen = document.getElementById('pause-screen');
const upgradeCards = document.getElementById('upgrade-cards');

document.getElementById('best-score-start').textContent = getBest();

document.getElementById('start-btn').addEventListener('click', startGame);
document.getElementById('retry-btn').addEventListener('click', startGame);
document.getElementById('resume-btn').addEventListener('click', () => setPaused(false));

// ---------- input ----------
const keys = new Set();
window.addEventListener('keydown', (e) => {
  keys.add(e.key.toLowerCase());
  if (e.key === 'Escape' && state.running) setPaused(!state.paused);
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

function moveVector() {
  let x = 0, y = 0;
  if (keys.has('w') || keys.has('arrowup')) y -= 1;
  if (keys.has('s') || keys.has('arrowdown')) y += 1;
  if (keys.has('a') || keys.has('arrowleft')) x -= 1;
  if (keys.has('d') || keys.has('arrowright')) x += 1;
  const len = Math.hypot(x, y);
  if (len > 0) { x /= len; y /= len; }
  return { x, y };
}

// simple touch joystick for mobile
let touchVec = { x: 0, y: 0 };
let touchActive = false;
let touchOrigin = { x: 0, y: 0 };
canvas.addEventListener('touchstart', (e) => {
  const t = e.changedTouches[0];
  touchActive = true;
  touchOrigin = { x: t.clientX, y: t.clientY };
  touchVec = { x: 0, y: 0 };
}, { passive: true });
canvas.addEventListener('touchmove', (e) => {
  if (!touchActive) return;
  const t = e.changedTouches[0];
  let dx = t.clientX - touchOrigin.x;
  let dy = t.clientY - touchOrigin.y;
  const len = Math.hypot(dx, dy) || 1;
  const clamped = Math.min(len, 40) / 40;
  touchVec = { x: (dx / len) * clamped, y: (dy / len) * clamped };
}, { passive: true });
canvas.addEventListener('touchend', () => { touchActive = false; touchVec = { x: 0, y: 0 }; }, { passive: true });

function inputVector() {
  const kv = moveVector();
  if (kv.x !== 0 || kv.y !== 0) return kv;
  return touchVec;
}

// ---------- utility ----------
function rand(a, b) { return a + Math.random() * (b - a); }
function randInt(a, b) { return Math.floor(rand(a, b + 1)); }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function fmtTime(sec) {
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

// ---------- game state ----------
let state = null;

function freshState() {
  return {
    running: false,
    paused: false,
    gameOver: false,
    time: 0,
    lastSpawn: 0,
    spawnInterval: 1.4,
    kills: 0,
    shakeT: 0,
    shakeMag: 0,
    player: {
      x: 0, y: 0, r: 14,
      hp: 100, maxHp: 100,
      speed: 230,
      dmg: 12,
      atkCd: 0.55,
      atkTimer: 0,
      projCount: 1,
      pierce: 0,
      magnet: 90,
      critChance: 0.05,
      regen: 0,
      level: 1,
      xp: 0,
      xpNeed: 12,
      invuln: 0,
    },
    enemies: [],
    projectiles: [],
    enemyProjectiles: [],
    particles: [],
    orbs: [],
  };
}

// ---------- enemy archetypes ----------
const ENEMY_TYPES = {
  grunt:  { r: 13, hp: 22,  speed: 95,  dmg: 8,  color: '#ff4d6a', xp: 3, score: 10 },
  runner: { r: 9,  hp: 10,  speed: 175, dmg: 5,  color: '#ffd24d', xp: 2, score: 8 },
  tank:   { r: 20, hp: 80,  speed: 55,  dmg: 16, color: '#a24dff', xp: 8, score: 25 },
  shooter:{ r: 12, hp: 16,  speed: 70,  dmg: 6,  color: '#4dfff0', xp: 5, score: 18, ranged: true },
};

function spawnEnemy() {
  const t = state.time;
  let typePool = ['grunt'];
  if (t > 8) typePool.push('runner');
  if (t > 20) typePool.push('tank');
  if (t > 35) typePool.push('shooter');
  if (t > 60) typePool.push('runner', 'tank');
  const typeName = pick(typePool);
  const base = ENEMY_TYPES[typeName];

  // scale difficulty with time
  const scale = 1 + t / 55;
  const angle = rand(0, Math.PI * 2);
  const spawnDist = Math.max(W, H) * 0.62 + 40;
  const x = state.player.x + Math.cos(angle) * spawnDist;
  const y = state.player.y + Math.sin(angle) * spawnDist;

  state.enemies.push({
    type: typeName,
    x, y,
    r: base.r,
    hp: Math.round(base.hp * scale),
    maxHp: Math.round(base.hp * scale),
    speed: base.speed * (1 + Math.min(t / 200, 0.35)),
    dmg: Math.round(base.dmg * (1 + Math.min(t / 120, 0.6))),
    color: base.color,
    xpVal: base.xp,
    scoreVal: base.score,
    ranged: !!base.ranged,
    shootCd: rand(1.2, 2.2),
    hitFlash: 0,
  });
}

// ---------- upgrades ----------
const UPGRADES = [
  { id: 'dmg', icon: '⚔️', name: 'ダメージ増加', desc: '攻撃力 +20%', apply: p => p.dmg *= 1.2 },
  { id: 'atkspd', icon: '⚡', name: '攻撃速度上昇', desc: '攻撃間隔 -15%', apply: p => p.atkCd *= 0.85 },
  { id: 'spd', icon: '👟', name: '移動速度上昇', desc: '移動速度 +12%', apply: p => p.speed *= 1.12 },
  { id: 'hp', icon: '❤️', name: '最大HP増加', desc: '最大HP +20%（全回復）', apply: p => { p.maxHp = Math.round(p.maxHp * 1.2); p.hp = p.maxHp; } },
  { id: 'proj', icon: '🔱', name: '弾数増加', desc: '同時発射数 +1', apply: p => p.projCount += 1 },
  { id: 'pierce', icon: '🎯', name: '貫通力上昇', desc: '弾の貫通 +1', apply: p => p.pierce += 1 },
  { id: 'magnet', icon: '🧲', name: '収集範囲拡大', desc: 'XP吸収範囲 +35%', apply: p => p.magnet *= 1.35 },
  { id: 'regen', icon: '💚', name: '自然回復', desc: 'HP自然回復 +0.6/秒', apply: p => p.regen += 0.6 },
  { id: 'crit', icon: '💥', name: '会心率上昇', desc: '会心率 +10%', apply: p => p.critChance = Math.min(0.75, p.critChance + 0.1) },
];

function rollUpgrades(n = 3) {
  const pool = [...UPGRADES];
  const chosen = [];
  for (let i = 0; i < n && pool.length; i++) {
    const idx = randInt(0, pool.length - 1);
    chosen.push(pool.splice(idx, 1)[0]);
  }
  return chosen;
}

function showLevelUp() {
  state.paused = true;
  upgradeCards.innerHTML = '';
  const options = rollUpgrades(3);
  for (const up of options) {
    const card = document.createElement('div');
    card.className = 'upgrade-card';
    card.innerHTML = `<span class="icon">${up.icon}</span><span class="name">${up.name}</span><span class="desc">${up.desc}</span>`;
    card.addEventListener('click', () => {
      up.apply(state.player);
      levelupScreen.classList.add('hidden');
      state.paused = false;
    });
    upgradeCards.appendChild(card);
  }
  levelupScreen.classList.remove('hidden');
}

function gainXp(amount) {
  const p = state.player;
  p.xp += amount;
  while (p.xp >= p.xpNeed) {
    p.xp -= p.xpNeed;
    p.level += 1;
    p.xpNeed = Math.round(p.xpNeed * 1.25 + 4);
    showLevelUp();
  }
}

// ---------- particles ----------
function burst(x, y, color, count = 10) {
  for (let i = 0; i < count; i++) {
    const a = rand(0, Math.PI * 2);
    const spd = rand(60, 220);
    state.particles.push({
      x, y, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd,
      life: rand(0.3, 0.7), maxLife: 0.7, color, r: rand(1.5, 3.5),
    });
  }
}

function shake(mag, t) {
  state.shakeMag = Math.max(state.shakeMag, mag);
  state.shakeT = Math.max(state.shakeT, t);
}

// ---------- combat ----------
function nearestEnemy(from, maxDist = Infinity) {
  let best = null, bestD = maxDist;
  for (const e of state.enemies) {
    const d = dist(from, e);
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
}

function fireProjectile(target) {
  const p = state.player;
  const baseAngle = Math.atan2(target.y - p.y, target.x - p.x);
  const spread = p.projCount > 1 ? 0.18 : 0;
  const start = -((p.projCount - 1) / 2) * spread;
  for (let i = 0; i < p.projCount; i++) {
    const angle = baseAngle + start + i * spread;
    state.projectiles.push({
      x: p.x, y: p.y,
      vx: Math.cos(angle) * 520,
      vy: Math.sin(angle) * 520,
      dmg: p.dmg,
      pierce: p.pierce,
      hitSet: new Set(),
      life: 1.4,
    });
  }
}

function damagePlayer(amount) {
  const p = state.player;
  if (p.invuln > 0) return;
  p.hp -= amount;
  p.invuln = 0.4;
  shake(8, 0.25);
  burst(p.x, p.y, '#ff4d6a', 14);
  if (p.hp <= 0) {
    p.hp = 0;
    endGame();
  }
}

// ---------- update ----------
function update(dt) {
  if (state.paused || state.gameOver) return;
  const p = state.player;
  state.time += dt;

  // spawn logic
  state.lastSpawn += dt;
  const minInterval = 0.28;
  const interval = Math.max(minInterval, 1.4 - state.time / 45);
  const spawnBatch = 1 + Math.floor(state.time / 40);
  if (state.lastSpawn >= interval) {
    state.lastSpawn = 0;
    for (let i = 0; i < spawnBatch; i++) spawnEnemy();
  }

  // player movement
  const iv = inputVector();
  p.x += iv.x * p.speed * dt;
  p.y += iv.y * p.speed * dt;
  if (p.invuln > 0) p.invuln -= dt;
  if (p.regen > 0 && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + p.regen * dt);

  // attack
  p.atkTimer -= dt;
  if (p.atkTimer <= 0) {
    const target = nearestEnemy(p, 900);
    if (target) {
      fireProjectile(target);
      p.atkTimer = p.atkCd;
    }
  }

  // projectiles
  for (const pr of state.projectiles) {
    pr.x += pr.vx * dt;
    pr.y += pr.vy * dt;
    pr.life -= dt;
  }
  state.projectiles = state.projectiles.filter(pr => pr.life > 0);

  // enemy projectiles
  for (const ep of state.enemyProjectiles) {
    ep.x += ep.vx * dt;
    ep.y += ep.vy * dt;
    ep.life -= dt;
  }
  state.enemyProjectiles = state.enemyProjectiles.filter(ep => {
    if (ep.life <= 0) return false;
    if (dist(ep, p) < p.r + 4) {
      damagePlayer(ep.dmg);
      return false;
    }
    return true;
  });

  // enemies
  for (const e of state.enemies) {
    if (e.hitFlash > 0) e.hitFlash -= dt;
    if (e.ranged) {
      const d = dist(e, p);
      if (d > 260) {
        const a = Math.atan2(p.y - e.y, p.x - e.x);
        e.x += Math.cos(a) * e.speed * dt;
        e.y += Math.sin(a) * e.speed * dt;
      } else {
        e.shootCd -= dt;
        if (e.shootCd <= 0) {
          e.shootCd = rand(1.4, 2.4);
          const a = Math.atan2(p.y - e.y, p.x - e.x);
          state.enemyProjectiles.push({
            x: e.x, y: e.y, vx: Math.cos(a) * 260, vy: Math.sin(a) * 260,
            dmg: e.dmg, life: 3,
          });
        }
      }
    } else {
      const a = Math.atan2(p.y - e.y, p.x - e.x);
      e.x += Math.cos(a) * e.speed * dt;
      e.y += Math.sin(a) * e.speed * dt;
    }
    // contact damage
    if (dist(e, p) < e.r + p.r) {
      damagePlayer(e.dmg * dt * 2.2);
    }
  }

  // projectile-enemy collisions
  for (const pr of state.projectiles) {
    for (const e of state.enemies) {
      if (pr.hitSet.has(e)) continue;
      if (dist(pr, e) < e.r + 5) {
        pr.hitSet.add(e);
        let dmg = pr.dmg;
        const isCrit = Math.random() < p.critChance;
        if (isCrit) dmg *= 2;
        e.hp -= dmg;
        e.hitFlash = 0.12;
        burst(pr.x, pr.y, isCrit ? '#ffd24d' : '#4df3ff', isCrit ? 8 : 4);
        if (pr.pierce <= 0) { pr.life = 0; break; }
        pr.pierce -= 1;
      }
    }
  }
  state.projectiles = state.projectiles.filter(pr => pr.life > 0);

  // dead enemies
  const alive = [];
  for (const e of state.enemies) {
    if (e.hp <= 0) {
      state.kills += 1;
      burst(e.x, e.y, e.color, 16);
      shake(3, 0.12);
      state.orbs.push({ x: e.x, y: e.y, xp: e.xpVal, r: 5, vx: 0, vy: 0 });
    } else {
      alive.push(e);
    }
  }
  state.enemies = alive;

  // xp orbs: magnet + pickup
  for (const orb of state.orbs) {
    const d = dist(orb, p);
    if (d < p.magnet) {
      const a = Math.atan2(p.y - orb.y, p.x - orb.x);
      const pull = 420 * (1 - Math.min(d / p.magnet, 1)) + 80;
      orb.vx = Math.cos(a) * pull;
      orb.vy = Math.sin(a) * pull;
      orb.x += orb.vx * dt;
      orb.y += orb.vy * dt;
    }
  }
  state.orbs = state.orbs.filter(orb => {
    if (dist(orb, p) < p.r + orb.r + 4) {
      gainXp(orb.xp);
      return false;
    }
    return true;
  });

  // particles
  for (const pt of state.particles) {
    pt.x += pt.vx * dt;
    pt.y += pt.vy * dt;
    pt.vx *= 0.9;
    pt.vy *= 0.9;
    pt.life -= dt;
  }
  state.particles = state.particles.filter(pt => pt.life > 0);

  if (state.shakeT > 0) state.shakeT -= dt;

  updateHud();
}

function updateHud() {
  const p = state.player;
  hpBar.style.width = `${Math.max(0, p.hp / p.maxHp) * 100}%`;
  hpText.textContent = `${Math.max(0, Math.ceil(p.hp))}/${p.maxHp}`;
  xpBar.style.width = `${(p.xp / p.xpNeed) * 100}%`;
  levelText.textContent = `Lv.${p.level}`;
  timerText.textContent = fmtTime(state.time);
  killsText.textContent = `Kills: ${state.kills}`;
}

// ---------- render ----------
function render() {
  ctx.clearRect(0, 0, W, H);

  let ox = 0, oy = 0;
  if (state.shakeT > 0) {
    ox = rand(-1, 1) * state.shakeMag;
    oy = rand(-1, 1) * state.shakeMag;
  } else {
    state.shakeMag = 0;
  }

  ctx.save();
  ctx.translate(ox, oy);

  const p = state.player;
  const camX = W / 2 - p.x;
  const camY = H / 2 - p.y;

  // background grid
  ctx.strokeStyle = '#ffffff0a';
  ctx.lineWidth = 1;
  const grid = 60;
  const offX = ((camX % grid) + grid) % grid;
  const offY = ((camY % grid) + grid) % grid;
  for (let x = offX; x < W; x += grid) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let y = offY; y < H; y += grid) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  // xp orbs
  for (const orb of state.orbs) {
    const x = orb.x + camX, y = orb.y + camY;
    ctx.beginPath();
    ctx.fillStyle = '#7dffb3';
    ctx.shadowColor = '#7dffb3';
    ctx.shadowBlur = 8;
    ctx.arc(x, y, orb.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;

  // enemy projectiles
  for (const ep of state.enemyProjectiles) {
    const x = ep.x + camX, y = ep.y + camY;
    ctx.beginPath();
    ctx.fillStyle = '#4dfff0';
    ctx.shadowColor = '#4dfff0';
    ctx.shadowBlur = 10;
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;

  // player projectiles
  for (const pr of state.projectiles) {
    const x = pr.x + camX, y = pr.y + camY;
    ctx.beginPath();
    ctx.fillStyle = '#4df3ff';
    ctx.shadowColor = '#4df3ff';
    ctx.shadowBlur = 12;
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;

  // enemies
  for (const e of state.enemies) {
    const x = e.x + camX, y = e.y + camY;
    if (x < -60 || x > W + 60 || y < -60 || y > H + 60) continue;
    ctx.beginPath();
    ctx.fillStyle = e.hitFlash > 0 ? '#ffffff' : e.color;
    ctx.shadowColor = e.color;
    ctx.shadowBlur = 14;
    ctx.arc(x, y, e.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    // hp bar for tougher enemies
    if (e.maxHp > 20) {
      const w = e.r * 2;
      ctx.fillStyle = '#00000088';
      ctx.fillRect(x - w / 2, y - e.r - 10, w, 4);
      ctx.fillStyle = '#ff4d6a';
      ctx.fillRect(x - w / 2, y - e.r - 10, w * Math.max(0, e.hp / e.maxHp), 4);
    }
  }

  // particles
  for (const pt of state.particles) {
    const x = pt.x + camX, y = pt.y + camY;
    ctx.globalAlpha = Math.max(0, pt.life / pt.maxLife);
    ctx.beginPath();
    ctx.fillStyle = pt.color;
    ctx.arc(x, y, pt.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // player
  {
    const x = W / 2, y = H / 2;
    ctx.beginPath();
    ctx.fillStyle = p.invuln > 0 ? '#ffffff' : '#4df3ff';
    ctx.shadowColor = '#4df3ff';
    ctx.shadowBlur = 20;
    ctx.arc(x, y, p.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    // direction hint: facing nearest enemy
    const target = nearestEnemy(p, 900);
    if (target) {
      const a = Math.atan2(target.y - p.y, target.x - p.x);
      ctx.strokeStyle = '#4df3ffaa';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * p.r, y + Math.sin(a) * p.r);
      ctx.lineTo(x + Math.cos(a) * (p.r + 10), y + Math.sin(a) * (p.r + 10));
      ctx.stroke();
    }
  }

  ctx.restore();
}

// ---------- game loop ----------
let lastT = 0;
function loop(t) {
  const dt = Math.min(0.05, (t - lastT) / 1000 || 0);
  lastT = t;
  if (state && state.running) {
    update(dt);
    render();
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ---------- flow control ----------
function startGame() {
  state = freshState();
  state.running = true;
  startScreen.classList.add('hidden');
  gameoverScreen.classList.add('hidden');
  levelupScreen.classList.add('hidden');
  pauseScreen.classList.add('hidden');
  document.getElementById('new-best').classList.add('hidden');
  updateHud();
}

function setPaused(v) {
  if (!state || state.gameOver) return;
  state.paused = v;
  pauseScreen.classList.toggle('hidden', !v);
}

function endGame() {
  state.gameOver = true;
  state.running = false;
  const score = Math.round(state.time * 10 + state.kills * 5 + state.player.level * 20);
  const best = getBest();
  const isNew = score > best;
  if (isNew) setBest(score);

  document.getElementById('final-time').textContent = fmtTime(state.time);
  document.getElementById('final-kills').textContent = state.kills;
  document.getElementById('final-level').textContent = state.player.level;
  document.getElementById('final-score').textContent = score;
  document.getElementById('best-score-end').textContent = isNew ? score : best;
  document.getElementById('new-best').classList.toggle('hidden', !isNew);

  gameoverScreen.classList.remove('hidden');
}
