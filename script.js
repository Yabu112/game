'use strict';

/* =========================================================
   GARDEN CLICKER
   Idle/incremental clicker: click the flower for Petals, buy
   garden buildings for passive income, unlock upgrades, and
   cycle the season for a permanent multiplier (Golden Seeds).
   ========================================================= */

// Save key intentionally left as-is (predates this reskin) so existing
// browser saves keep loading correctly — it's an internal storage id,
// never shown to the player.
const SAVE_KEY = 'cosmicClickerSave';
const OFFLINE_CAP_SEC = 8 * 3600; // cap offline progress at 8 hours
const CRIT_CHANCE = 0.1;
const CRIT_MULT = 5;
const GOLDEN_MIN_INTERVAL = 40; // seconds
const GOLDEN_MAX_INTERVAL = 85; // seconds
const GOLDEN_LIFETIME_MS = 13000;

const rand = (a, b) => a + Math.random() * (b - a);
const BUILD_COST_RATIO = 1.15;

// ---------- audio (synthesized, no external assets) ----------
const MUTE_KEY = 'gardenClickerMuted';
let muted = localStorage.getItem(MUTE_KEY) === '1';
let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    try { audioCtx = new Ctor(); } catch (e) { return null; }
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function playTone(freq, duration, type, peak, delay) {
  if (muted) return;
  const ctx = getAudioCtx();
  if (!ctx) return;
  const t0 = ctx.currentTime + (delay || 0);
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type || 'sine';
  osc.frequency.setValueAtTime(freq, t0);
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(peak != null ? peak : 0.12, t0 + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.03);
}

function sfxClick(isCrit) {
  if (isCrit) {
    playTone(880, 0.18, 'triangle', 0.16);
    playTone(1320, 0.22, 'triangle', 0.1, 0.03);
  } else {
    playTone(rand(520, 640), 0.09, 'sine', 0.08);
  }
}

function sfxBuy() {
  playTone(440, 0.09, 'square', 0.06);
  playTone(660, 0.12, 'square', 0.05, 0.05);
}

function sfxAchievement() {
  playTone(660, 0.12, 'triangle', 0.13);
  playTone(880, 0.12, 'triangle', 0.13, 0.09);
  playTone(1100, 0.2, 'triangle', 0.13, 0.18);
}

function sfxGolden() {
  playTone(784, 0.1, 'sine', 0.1);
  playTone(988, 0.1, 'sine', 0.1, 0.06);
  playTone(1175, 0.18, 'sine', 0.1, 0.12);
}

function sfxPrestige() {
  playTone(392, 0.15, 'sawtooth', 0.07);
  playTone(494, 0.15, 'sawtooth', 0.07, 0.08);
  playTone(587, 0.22, 'sawtooth', 0.07, 0.16);
}

// ---------- data ----------
// `id` / `target` values are the save-file keys and must never change —
// only the displayed name/icon/desc were restyled for the garden theme.
const BUILDING_DEFS = [
  { id: 'drone',     name: 'ミツバチ',         icon: '🐝', baseCost: 15,         baseCps: 0.1 },
  { id: 'bot',       name: '苗木ロボット',     icon: '🌱', baseCost: 100,        baseCps: 1 },
  { id: 'refinery',  name: '自動散水機',       icon: '💧', baseCost: 1100,       baseCps: 8 },
  { id: 'satellite', name: 'チョウの楽園',     icon: '🦋', baseCost: 12000,      baseCps: 47 },
  { id: 'reactor',   name: '温室',             icon: '🏡', baseCost: 130000,     baseCps: 260 },
  { id: 'wormhole',  name: '虹のシャワー',     icon: '🌈', baseCost: 1400000,    baseCps: 1400 },
  { id: 'forge',     name: '大樹',             icon: '🌳', baseCost: 20000000,   baseCps: 7800 },
  { id: 'dyson',     name: 'エデンの園',       icon: '🌺', baseCost: 330000000,  baseCps: 44000 },
];

const UPGRADE_DEFS = [
  { id: 'click2',   name: 'そよ風の後押し I',   icon: '🍃', desc: '収穫力が2倍になる', cost: 100,      requireEarned: 80,       type: 'click', mult: 2 },
  { id: 'drone2',   name: '巣箱の増設',         icon: '🐝', desc: 'ミツバチの生産が2倍になる', cost: 300,  requireEarned: 200,      type: 'building', target: 'drone', mult: 2 },
  { id: 'click3',   name: 'そよ風の後押し II',  icon: '🍃', desc: '収穫力がさらに2倍になる', cost: 2000,   requireEarned: 1500,     type: 'click', mult: 2 },
  { id: 'bot2',     name: '肥料強化',           icon: '🌱', desc: '苗木ロボットの生産が2倍になる', cost: 2500,   requireEarned: 1800,     type: 'building', target: 'bot', mult: 2 },
  { id: 'global2',  name: '陽だまりの恵み I',   icon: '☀️', desc: '全ての生産量が1.5倍になる', cost: 15000,      requireEarned: 10000,    type: 'global', mult: 1.5 },
  { id: 'refinery2',name: '灌漑効率化',         icon: '💧', desc: '自動散水機の生産が2倍になる', cost: 30000,  requireEarned: 20000,    type: 'building', target: 'refinery', mult: 2 },
  { id: 'click4',   name: 'そよ風の後押し III', icon: '🍃', desc: '収穫力がさらに2倍になる', cost: 50000,  requireEarned: 35000,    type: 'click', mult: 2 },
  { id: 'satellite2',name: '楽園の拡張',        icon: '🦋', desc: 'チョウの楽園の生産が2倍になる', cost: 250000, requireEarned: 180000,  type: 'building', target: 'satellite', mult: 2 },
  { id: 'global3',  name: '陽だまりの恵み II',  icon: '☀️', desc: '全ての生産量が1.5倍になる', cost: 800000,     requireEarned: 600000,   type: 'global', mult: 1.5 },
  { id: 'reactor2', name: '温室の拡張',         icon: '🏡', desc: '温室の生産が2倍になる', cost: 2500000, requireEarned: 1800000, type: 'building', target: 'reactor', mult: 2 },
  { id: 'click5',   name: 'そよ風の後押し IV',  icon: '🍃', desc: '収穫力がさらに2倍になる', cost: 5000000, requireEarned: 3500000, type: 'click', mult: 2 },
  { id: 'global4',  name: '陽だまりの恵み III', icon: '☀️', desc: '全ての生産量が2倍になる', cost: 50000000,    requireEarned: 35000000, type: 'global', mult: 2 },
];

const ACHIEVEMENT_DEFS = [
  { id: 'click_1',      name: '最初の一輪',       icon: '🌼', desc: '1回クリックする', bonus: 0.01, check: s => s.totalClicks >= 1 },
  { id: 'click_100',    name: 'ガーデナーの手',   icon: '🧤', desc: '100回クリックする', bonus: 0.01, check: s => s.totalClicks >= 100 },
  { id: 'click_1000',   name: '庭師の魂',         icon: '🌻', desc: '1,000回クリックする', bonus: 0.02, check: s => s.totalClicks >= 1000 },
  { id: 'crit_50',      name: '会心の芽吹き',     icon: '💥', desc: 'クリティカルを50回出す', bonus: 0.02, check: s => s.critCount >= 50 },
  { id: 'earn_1k',      name: '駆け出しの庭師',   icon: '🌱', desc: '累計1,000花びらを集める', bonus: 0.01, check: s => s.totalEarned >= 1000 },
  { id: 'earn_100k',    name: '中堅の庭師',       icon: '🌿', desc: '累計100,000花びらを集める', bonus: 0.02, check: s => s.totalEarned >= 100000 },
  { id: 'earn_10m',     name: 'ベテランの庭師',   icon: '🌳', desc: '累計10,000,000花びらを集める', bonus: 0.03, check: s => s.totalEarned >= 1e7 },
  { id: 'earn_1b',      name: '伝説の庭師',       icon: '🏵️', desc: '累計1,000,000,000花びらを集める', bonus: 0.05, check: s => s.totalEarned >= 1e9 },
  { id: 'building_10',  name: '小さな楽園',       icon: '🦋', desc: 'いずれかの庭園設備を10個所有する', bonus: 0.01, check: s => Object.values(s.buildings).some(v => v >= 10) },
  { id: 'building_all', name: 'フルブルーム',     icon: '🌈', desc: 'すべての庭園設備を1つ以上所有する', bonus: 0.02, check: s => BUILDING_DEFS.every(b => s.buildings[b.id] >= 1) },
  { id: 'golden_1',     name: '幸運の花摘み',     icon: '✨', desc: '黄金の花びらを1回クリックする', bonus: 0.01, check: s => s.goldenClicks >= 1 },
  { id: 'golden_10',    name: '黄金の寵児',       icon: '🌟', desc: '黄金の花びらを10回クリックする', bonus: 0.02, check: s => s.goldenClicks >= 10 },
  { id: 'prestige_1',   name: '新たな季節',       icon: '🍂', desc: '1回季節を巡らせる', bonus: 0.02, check: s => s.prestigeCount >= 1 },
  { id: 'prestige_5',   name: '巡る四季の彼方',   icon: '🌍', desc: '5回季節を巡らせる', bonus: 0.03, check: s => s.prestigeCount >= 5 },
];

// ---------- state ----------
function freshState() {
  const buildings = {};
  BUILDING_DEFS.forEach(b => buildings[b.id] = 0);
  return {
    stardust: 0,
    totalEarned: 0,
    clickBase: 1,
    buildings,
    upgradesOwned: [],
    singularities: 0,
    prestigeCount: 0,
    totalClicks: 0,
    critCount: 0,
    goldenClicks: 0,
    achievementsUnlocked: [],
    buff: null,
    lastSave: Date.now(),
  };
}

let state = load() || freshState();

function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const fresh = freshState();
    return Object.assign(fresh, parsed, { buildings: Object.assign(fresh.buildings, parsed.buildings || {}) });
  } catch (e) {
    return null;
  }
}

function save() {
  state.lastSave = Date.now();
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (e) { /* storage unavailable */ }
}

// ---------- derived values ----------
function prestigeMult() {
  return 1 + state.singularities * 0.02;
}

function upgradeGlobalMult() {
  let m = 1;
  for (const id of state.upgradesOwned) {
    const def = UPGRADE_DEFS.find(u => u.id === id);
    if (def && def.type === 'global') m *= def.mult;
  }
  return m;
}

function buildingMult(id) {
  let m = 1;
  for (const uid of state.upgradesOwned) {
    const def = UPGRADE_DEFS.find(u => u.id === uid);
    if (def && def.type === 'building' && def.target === id) m *= def.mult;
  }
  return m;
}

function clickUpgradeMult() {
  let m = 1;
  for (const id of state.upgradesOwned) {
    const def = UPGRADE_DEFS.find(u => u.id === id);
    if (def && def.type === 'click') m *= def.mult;
  }
  return m;
}

function cpsFor(id) {
  const def = BUILDING_DEFS.find(b => b.id === id);
  return def.baseCps * state.buildings[id] * buildingMult(id);
}

function achievementMult() {
  let bonus = 0;
  for (const id of state.achievementsUnlocked) {
    const def = ACHIEVEMENT_DEFS.find(a => a.id === id);
    if (def) bonus += def.bonus;
  }
  return 1 + bonus;
}

// A buff from a golden-stardust pickup is a temporary window (state.buff =
// { type, mult, until }); it self-clears here the first time it's checked
// after expiring, so callers never need to know about expiry themselves.
function activeBuff() {
  if (state.buff && state.buff.until > Date.now()) return state.buff;
  if (state.buff) state.buff = null;
  return null;
}

function buffClickMult() {
  const b = activeBuff();
  return (b && b.type === 'frenzy') ? b.mult : 1;
}

function buffCpsMult() {
  const b = activeBuff();
  return (b && b.type === 'surge') ? b.mult : 1;
}

function totalCps() {
  let sum = 0;
  for (const b of BUILDING_DEFS) sum += cpsFor(b.id);
  return sum * upgradeGlobalMult() * prestigeMult() * achievementMult() * buffCpsMult();
}

function clickValue() {
  return state.clickBase * clickUpgradeMult() * upgradeGlobalMult() * prestigeMult() * achievementMult() * buffClickMult();
}

function buildingCost(id) {
  const def = BUILDING_DEFS.find(b => b.id === id);
  return Math.round(def.baseCost * Math.pow(BUILD_COST_RATIO, state.buildings[id]));
}

// Cost of buying `n` more of a building starting from its current owned
// count: a geometric series, baseCost * r^owned * (r^n - 1)/(r - 1).
function bulkBuildingCost(id, n) {
  if (n <= 0) return 0;
  const def = BUILDING_DEFS.find(b => b.id === id);
  const r = BUILD_COST_RATIO;
  return Math.round(def.baseCost * Math.pow(r, state.buildings[id]) * (Math.pow(r, n) - 1) / (r - 1));
}

// Closed-form max affordable count (no purchase loop needed even at huge n).
function maxAffordable(id) {
  const def = BUILDING_DEFS.find(b => b.id === id);
  const r = BUILD_COST_RATIO;
  const nextCost = def.baseCost * Math.pow(r, state.buildings[id]);
  if (state.stardust < nextCost) return 0;
  const n = Math.floor(Math.log((state.stardust * (r - 1)) / nextCost + 1) / Math.log(r));
  return Math.max(0, n);
}

function potentialSingularities() {
  return Math.floor(Math.sqrt(state.totalEarned / 1e6));
}

// ---------- number formatting ----------
const TIERS = ['K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];
function fmtNum(n) {
  if (n < 1000) {
    return n % 1 === 0 ? String(n) : n.toFixed(1);
  }
  let val = n, idx = -1;
  while (val >= 1000 && idx < TIERS.length - 1) { val /= 1000; idx++; }
  return val.toFixed(2) + TIERS[idx];
}

// ---------- DOM refs ----------
const stardustTotalEl = document.getElementById('stardust-total');
const cpsLabelEl = document.getElementById('cps-label');
const clickPowerLabelEl = document.getElementById('click-power-label');
const coreBtn = document.getElementById('core-btn');
const floatLayer = document.getElementById('float-layer');
const buildingsListEl = document.getElementById('buildings-list');
const upgradesListEl = document.getElementById('upgrades-list');
const noUpgradesEl = document.getElementById('no-upgrades');
const singularityCountEl = document.getElementById('singularity-count');
const prestigeBtn = document.getElementById('prestige-btn');
const prestigeModal = document.getElementById('prestige-modal');
const prestigeGainEl = document.getElementById('prestige-gain');
const prestigeCancel = document.getElementById('prestige-cancel');
const prestigeConfirm = document.getElementById('prestige-confirm');
const achievementsListEl = document.getElementById('achievements-list');
const achvCountEl = document.getElementById('achv-count');
const buffBannerEl = document.getElementById('buff-banner');
const goldenLayerEl = document.getElementById('golden-layer');
const toastLayerEl = document.getElementById('toast-layer');
const muteBtn = document.getElementById('mute-btn');

muteBtn.textContent = muted ? '🔇' : '🔊';
muteBtn.addEventListener('click', () => {
  muted = !muted;
  localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  muteBtn.textContent = muted ? '🔇' : '🔊';
  if (!muted) { getAudioCtx(); playTone(660, 0.08, 'sine', 0.08); }
});

// Space bar clicks the flower from anywhere on the page, not just when the
// button itself is focused. preventDefault on keydown (rather than reacting
// on keyup) stops both page scroll and the button's own native space
// activation, so a focused core-btn doesn't fire the click twice.
window.addEventListener('keydown', (e) => {
  if ((e.code === 'Space' || e.key === ' ') && !e.repeat) {
    e.preventDefault();
    coreBtn.click();
  }
});

// ---------- tabs ----------
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
  });
});

// ---------- click handling ----------
coreBtn.addEventListener('click', (e) => {
  state.totalClicks += 1;
  const isCrit = Math.random() < CRIT_CHANCE;
  let gain = clickValue();
  if (isCrit) { gain *= CRIT_MULT; state.critCount += 1; }
  state.stardust += gain;
  state.totalEarned += gain;
  spawnFloatNumber(e, gain, isCrit);
  pulseCore();
  shedRandomPetal();
  sfxClick(isCrit);
  checkAchievements();
});

// ---------- petal shed/regrow ----------
// Purely a visual flourish (not part of saved state): each click knocks one
// currently-attached petal off the flower; it drifts away via the .missing
// CSS transition, then regrows on its own after a short random delay.
const PETAL_COUNT = 8;
const petalMissing = new Array(PETAL_COUNT).fill(false);

function shedRandomPetal() {
  const available = [];
  for (let i = 0; i < PETAL_COUNT; i++) {
    if (!petalMissing[i]) available.push(i);
  }
  if (available.length === 0) return; // whole flower is mid-regrow, let it be
  const idx = available[Math.floor(Math.random() * available.length)];
  const el = document.getElementById('petal-' + idx);
  if (!el) return;

  petalMissing[idx] = true;
  el.classList.add('missing');

  setTimeout(() => {
    petalMissing[idx] = false;
    el.classList.remove('missing');
  }, rand(900, 2200));
}

function spawnFloatNumber(e, gain, isCrit) {
  const rect = coreBtn.getBoundingClientRect();
  const layerRect = floatLayer.getBoundingClientRect();
  // A synthetic click (coreBtn.click(), used by the spacebar handler) reports
  // clientX/clientY as 0, not null/undefined — `??` doesn't catch that, so
  // the number rendered off in the top-left corner instead of falling back
  // to center. e.isTrusted is false for any programmatic click, real ones
  // (mouse/touch) are always true, so it reliably tells the two apart.
  const clientX = e.isTrusted ? e.clientX : rect.left + rect.width / 2;
  const clientY = e.isTrusted ? e.clientY : rect.top + rect.height / 2;
  const x = clientX - layerRect.left + (Math.random() * 30 - 15);
  const y = clientY - layerRect.top;
  const el = document.createElement('div');
  el.className = 'float-num' + (isCrit ? ' crit' : '');
  el.textContent = (isCrit ? 'CRIT! +' : '+') + fmtNum(gain);
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  floatLayer.appendChild(el);
  setTimeout(() => el.remove(), 950);
}

function pulseCore() {
  coreBtn.style.transform = 'scale(0.97)';
  requestAnimationFrame(() => { coreBtn.style.transform = ''; });
}

// ---------- buildings render ----------
// Cards are created once and only have their text/classes patched on each
// tick. Recreating the DOM every frame (the previous approach) could delete
// the element a pointer was pressing mid-click, silently dropping clicks.
const buildingEls = {};

function initBuildings() {
  buildingsListEl.innerHTML = '';
  for (const def of BUILDING_DEFS) {
    const card = document.createElement('div');
    card.className = 'building-card';
    card.innerHTML = `
      <div class="icon">${def.icon}</div>
      <div class="info">
        <div class="name-row">
          <span class="name">${def.name}</span>
          <span class="owned">×0</span>
        </div>
        <div class="meta">
          <span class="cost">0 ✦</span>
          <span class="cps-val">0/秒</span>
        </div>
      </div>
    `;
    card.addEventListener('click', () => buyBuilding(def.id));
    buildingsListEl.appendChild(card);
    buildingEls[def.id] = {
      card,
      ownedEl: card.querySelector('.owned'),
      costEl: card.querySelector('.cost'),
      cpsEl: card.querySelector('.cps-val'),
    };
  }
}

// ×1 / ×10 / ×100 / MAX — how many units a building-card click buys.
let buyQty = 1;

document.querySelectorAll('.qty-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.qty-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    buyQty = btn.dataset.qty === 'max' ? 'max' : parseInt(btn.dataset.qty, 10);
    renderBuildings();
  });
});

function buildingBuyQty(id) {
  if (buyQty === 'max') return maxAffordable(id);
  return buyQty;
}

function renderBuildings() {
  for (const def of BUILDING_DEFS) {
    const refs = buildingEls[def.id];
    const owned = state.buildings[def.id];
    const cps = def.baseCps * buildingMult(def.id);

    // MAX at 0 affordable still shows the price of the next single unit
    // (a real, meaningful number) rather than "0 ✦"; a fixed ×10/×100
    // always shows that exact batch's price even if unaffordable, so the
    // player can see what they're saving up for.
    const affordableQty = buildingBuyQty(def.id);
    const displayQty = affordableQty > 0 ? affordableQty : (buyQty === 'max' ? 1 : buyQty);
    const cost = bulkBuildingCost(def.id, displayQty);
    const affordable = state.stardust >= cost;

    refs.ownedEl.textContent = `×${owned}`;
    refs.costEl.textContent = `${fmtNum(cost)} ✦${displayQty > 1 ? ` (×${displayQty})` : ''}`;
    refs.cpsEl.textContent = `${fmtNum(cps)}/秒`;
    refs.card.classList.toggle('disabled', !affordable);
  }
}

function buyBuilding(id) {
  const qty = buildingBuyQty(id);
  if (qty <= 0) return;
  const cost = bulkBuildingCost(id, qty);
  if (state.stardust < cost) return;
  state.stardust -= cost;
  state.buildings[id] += qty;
  sfxBuy();
  renderAll();
}

// ---------- upgrades render ----------
// Same reuse-don't-recreate approach as buildings: only add/remove cards
// when an upgrade actually becomes available or gets purchased, and just
// toggle the affordability class on the rest each tick.
function availableUpgrades() {
  return UPGRADE_DEFS.filter(u => !state.upgradesOwned.includes(u.id) && state.totalEarned >= u.requireEarned);
}

const upgradeEls = {};

function renderUpgrades() {
  const list = availableUpgrades();
  const listIds = new Set(list.map(u => u.id));

  for (const id of Object.keys(upgradeEls)) {
    if (!listIds.has(id)) {
      upgradeEls[id].remove();
      delete upgradeEls[id];
    }
  }

  for (const def of list) {
    let card = upgradeEls[def.id];
    if (!card) {
      card = document.createElement('div');
      card.className = 'upgrade-card';
      card.innerHTML = `
        <div class="icon">${def.icon}</div>
        <div class="info">
          <div class="name">${def.name}</div>
          <div class="desc">${def.desc}</div>
          <div class="cost">${fmtNum(def.cost)} ✦</div>
        </div>
      `;
      card.addEventListener('click', () => buyUpgrade(def.id));
      upgradesListEl.appendChild(card);
      upgradeEls[def.id] = card;
    }
    card.classList.toggle('disabled', state.stardust < def.cost);
  }

  noUpgradesEl.classList.toggle('hidden', list.length > 0);
}

function buyUpgrade(id) {
  const def = UPGRADE_DEFS.find(u => u.id === id);
  if (!def || state.stardust < def.cost || state.upgradesOwned.includes(id)) return;
  state.stardust -= def.cost;
  state.upgradesOwned.push(id);
  sfxBuy();
  renderAll();
}

// ---------- achievements ----------
// Same build-once-then-patch approach as buildings/upgrades.
const achievementEls = {};

function initAchievements() {
  achievementsListEl.innerHTML = '';
  for (const def of ACHIEVEMENT_DEFS) {
    const card = document.createElement('div');
    card.className = 'achievement-card';
    card.innerHTML = `
      <div class="icon">${def.icon}</div>
      <div class="info">
        <div class="name">${def.name}</div>
        <div class="desc">${def.desc}</div>
        <div class="bonus">生産 +${Math.round(def.bonus * 100)}%</div>
      </div>
    `;
    achievementsListEl.appendChild(card);
    achievementEls[def.id] = card;
  }
}

function renderAchievements() {
  let unlockedCount = 0;
  for (const def of ACHIEVEMENT_DEFS) {
    const unlocked = state.achievementsUnlocked.includes(def.id);
    if (unlocked) unlockedCount++;
    achievementEls[def.id].classList.toggle('unlocked', unlocked);
  }
  achvCountEl.textContent = `${unlockedCount}/${ACHIEVEMENT_DEFS.length}`;
}

function checkAchievements() {
  let unlockedNew = false;
  for (const def of ACHIEVEMENT_DEFS) {
    if (!state.achievementsUnlocked.includes(def.id) && def.check(state)) {
      state.achievementsUnlocked.push(def.id);
      showToast(`🏆 実績解除: ${def.name}`);
      sfxAchievement();
      unlockedNew = true;
    }
  }
  if (unlockedNew) renderAchievements();
}

// ---------- toast notifications ----------
function showToast(text) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  toastLayerEl.appendChild(el);
  setTimeout(() => el.remove(), 3100);
}

// ---------- golden stardust bonus event ----------
let goldenActive = false;
let goldenNextAt = Date.now() + rand(GOLDEN_MIN_INTERVAL, GOLDEN_MAX_INTERVAL) * 1000;

function scheduleNextGolden() {
  goldenActive = false;
  goldenNextAt = Date.now() + rand(GOLDEN_MIN_INTERVAL, GOLDEN_MAX_INTERVAL) * 1000;
}

function maybeSpawnGolden() {
  if (goldenActive || Date.now() < goldenNextAt) return;
  spawnGoldenOrb();
}

function spawnGoldenOrb() {
  goldenActive = true;
  const rect = goldenLayerEl.getBoundingClientRect();
  const margin = 34;
  const w = Math.max(margin * 2 + 1, rect.width);
  const h = Math.max(margin * 2 + 1, rect.height);
  const x = rand(margin, w - margin);
  const y = rand(margin, h - margin);

  const orb = document.createElement('button');
  orb.className = 'golden-orb';
  orb.style.left = x + 'px';
  orb.style.top = y + 'px';
  orb.setAttribute('aria-label', '黄金の花びら');
  goldenLayerEl.appendChild(orb);

  const timeoutId = setTimeout(() => {
    orb.remove();
    scheduleNextGolden();
  }, GOLDEN_LIFETIME_MS);

  orb.addEventListener('click', () => {
    clearTimeout(timeoutId);
    orb.classList.add('popping');
    applyGoldenEffect();
    setTimeout(() => orb.remove(), 400);
    scheduleNextGolden();
  }, { once: true });
}

function applyGoldenEffect() {
  state.goldenClicks += 1;
  sfxGolden();
  const roll = Math.random();
  if (roll < 0.4) {
    const gain = Math.max(totalCps() * 60, clickValue() * 40, 50);
    state.stardust += gain;
    state.totalEarned += gain;
    showToast(`✨ 黄金の花びら！ +${fmtNum(gain)}`);
  } else if (roll < 0.7) {
    state.buff = { type: 'frenzy', mult: 7, until: Date.now() + 20000 };
    showToast('🌼 満開フィーバー発動！ 収穫力7倍（20秒）');
  } else {
    state.buff = { type: 'surge', mult: 3, until: Date.now() + 30000 };
    showToast('🌦️ めぐみの雨発動！ 生産量3倍（30秒）');
  }
  checkAchievements();
  renderAll();
}

function renderBuffBanner() {
  const b = activeBuff();
  if (!b) { buffBannerEl.classList.add('hidden'); return; }
  const remain = Math.max(0, Math.ceil((b.until - Date.now()) / 1000));
  const label = b.type === 'frenzy'
    ? `🌼 満開フィーバー中: 収穫${b.mult}倍`
    : `🌦️ めぐみの雨中: 生産${b.mult}倍`;
  buffBannerEl.textContent = `${label}（残り${remain}秒）`;
  buffBannerEl.classList.remove('hidden');
}

// ---------- prestige ----------
function updatePrestigeUI() {
  const gain = potentialSingularities();
  prestigeBtn.disabled = gain <= 0;
  singularityCountEl.textContent = `黄金の種: ${state.singularities}（生産 +${Math.round((prestigeMult() - 1) * 100)}%）`;
}

prestigeBtn.addEventListener('click', () => {
  prestigeGainEl.textContent = potentialSingularities();
  prestigeModal.classList.remove('hidden');
});

prestigeCancel.addEventListener('click', () => prestigeModal.classList.add('hidden'));

prestigeConfirm.addEventListener('click', () => {
  const gain = potentialSingularities();
  if (gain <= 0) { prestigeModal.classList.add('hidden'); return; }
  state.singularities += gain;
  state.prestigeCount += 1;
  state.stardust = 0;
  state.totalEarned = 0;
  state.clickBase = 1;
  BUILDING_DEFS.forEach(b => state.buildings[b.id] = 0);
  state.upgradesOwned = [];
  prestigeModal.classList.add('hidden');
  sfxPrestige();
  checkAchievements();
  renderAll();
});

// ---------- cheat tool ----------
// Dev/debug shortcuts for a single-player, no-leaderboard idle game — not a
// concern for fairness, just a fast way to poke at late-game state.
const cheatBtn = document.getElementById('cheat-btn');
const cheatModal = document.getElementById('cheat-modal');
const cheatClose = document.getElementById('cheat-close');

cheatBtn.addEventListener('click', () => cheatModal.classList.remove('hidden'));
cheatClose.addEventListener('click', () => cheatModal.classList.add('hidden'));

function grantStardust(n) {
  state.stardust += n;
  state.totalEarned += n;
}

document.querySelectorAll('.cheat-action').forEach(btn => {
  btn.addEventListener('click', () => runCheat(btn.dataset.action));
});

function runCheat(action) {
  switch (action) {
    case 'add1k': grantStardust(1000); break;
    case 'add100k': grantStardust(100000); break;
    case 'add10m': grantStardust(1e7); break;
    case 'add1b': grantStardust(1e9); break;
    case 'addseeds': state.singularities += 10; break;
    case 'maxbuildings': BUILDING_DEFS.forEach(b => { state.buildings[b.id] += 50; }); break;
    case 'allupgrades':
      UPGRADE_DEFS.forEach(u => {
        if (!state.upgradesOwned.includes(u.id)) state.upgradesOwned.push(u.id);
      });
      break;
    case 'allachievements':
      ACHIEVEMENT_DEFS.forEach(a => {
        if (!state.achievementsUnlocked.includes(a.id)) state.achievementsUnlocked.push(a.id);
      });
      break;
    case 'frenzy': state.buff = { type: 'frenzy', mult: 7, until: Date.now() + 20000 }; break;
    case 'surge': state.buff = { type: 'surge', mult: 3, until: Date.now() + 30000 }; break;
    case 'golden': goldenNextAt = Date.now() - 1; maybeSpawnGolden(); break;
    case 'reset':
      if (!confirm('本当にすべてのセーブデータをリセットしますか？この操作は取り消せません。')) return;
      localStorage.removeItem(SAVE_KEY);
      state = freshState();
      for (let i = 0; i < PETAL_COUNT; i++) {
        petalMissing[i] = false;
        const el = document.getElementById('petal-' + i);
        if (el) el.classList.remove('missing');
      }
      cheatModal.classList.add('hidden');
      break;
  }
  checkAchievements();
  renderAll();
  showToast('🛠️ チートを適用しました');
}

// ---------- main render / loop ----------
function renderAll() {
  stardustTotalEl.textContent = fmtNum(state.stardust);
  cpsLabelEl.textContent = `毎秒 +${fmtNum(totalCps())}`;
  clickPowerLabelEl.textContent = `収穫力: +${fmtNum(clickValue())}`;
  renderBuildings();
  renderUpgrades();
  renderAchievements();
  renderBuffBanner();
  updatePrestigeUI();
}

// requestAnimationFrame is fully suspended by browsers on a backgrounded
// (non-visible) tab, which would silently stop production the moment the
// player switches away. setInterval keeps firing even in the background
// (just throttled to ~once/sec after a while) and, because the gain is
// computed from the real Date.now() delta rather than an assumed frame
// time, production stays accurate no matter how sparsely the tick runs.
let lastTick = Date.now();

function tick() {
  const now = Date.now();
  const dtSec = Math.max(0, (now - lastTick) / 1000);
  lastTick = now;

  const gain = totalCps() * dtSec;
  if (gain > 0) {
    state.stardust += gain;
    state.totalEarned += gain;
  }

  maybeSpawnGolden();
  checkAchievements();
  renderAll();
}

// Catch up immediately when the tab regains focus, instead of waiting up
// to a full tick interval to reflect what accrued while it was hidden.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') tick();
});

// ---------- offline progress ----------
function applyOfflineProgress() {
  const now = Date.now();
  const elapsedSec = Math.max(0, (now - (state.lastSave || now)) / 1000);
  if (elapsedSec < 5) return;
  const capped = Math.min(elapsedSec, OFFLINE_CAP_SEC);
  const gain = totalCps() * capped;
  if (gain > 0) {
    state.stardust += gain;
    state.totalEarned += gain;
    alert(`おかえりなさい！\n離れていた間に ${fmtNum(gain)} 花びらが集まりました。`);
  }
}

// ---------- init ----------
initBuildings();
initAchievements();
applyOfflineProgress();
checkAchievements();
renderAll();
lastTick = Date.now();
setInterval(tick, 200);
setInterval(save, 8000);
window.addEventListener('beforeunload', save);
