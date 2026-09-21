'use strict';

/* =========================================================
   COSMIC CLICKER
   Idle/incremental clicker: click the core for Stardust,
   buy buildings for passive income, unlock upgrades, and
   prestige into Singularity Cores for a permanent multiplier.
   ========================================================= */

const SAVE_KEY = 'cosmicClickerSave';
const OFFLINE_CAP_SEC = 8 * 3600; // cap offline progress at 8 hours
const CRIT_CHANCE = 0.1;
const CRIT_MULT = 5;
const GOLDEN_MIN_INTERVAL = 40; // seconds
const GOLDEN_MAX_INTERVAL = 85; // seconds
const GOLDEN_LIFETIME_MS = 13000;

const rand = (a, b) => a + Math.random() * (b - a);

// ---------- data ----------
const BUILDING_DEFS = [
  { id: 'drone',     name: 'マイニングドローン',   icon: '🛰️', baseCost: 15,         baseCps: 0.1 },
  { id: 'bot',       name: '採掘ロボット',         icon: '🤖', baseCost: 100,        baseCps: 1 },
  { id: 'refinery',  name: '精製プラント',         icon: '🏭', baseCost: 1100,       baseCps: 8 },
  { id: 'satellite', name: '衛星コレクター',       icon: '🛸', baseCost: 12000,      baseCps: 47 },
  { id: 'reactor',   name: '量子リアクター',       icon: '⚛️', baseCost: 130000,     baseCps: 260 },
  { id: 'wormhole',  name: 'ワームホール抽出機',   icon: '🌀', baseCost: 1400000,    baseCps: 1400 },
  { id: 'forge',     name: '恒星炉',               icon: '☀️', baseCost: 20000000,   baseCps: 7800 },
  { id: 'dyson',     name: 'ダイソン球',           icon: '🪐', baseCost: 330000000,  baseCps: 44000 },
];

const UPGRADE_DEFS = [
  { id: 'click2',   name: 'クリック強化 I',   icon: '👆', desc: 'クリック威力が2倍になる', cost: 100,      requireEarned: 80,       type: 'click', mult: 2 },
  { id: 'drone2',   name: 'ドローン効率化',   icon: '🛰️', desc: 'マイニングドローンの生産が2倍になる', cost: 300,  requireEarned: 200,      type: 'building', target: 'drone', mult: 2 },
  { id: 'click3',   name: 'クリック強化 II',  icon: '👆', desc: 'クリック威力がさらに2倍になる', cost: 2000,   requireEarned: 1500,     type: 'click', mult: 2 },
  { id: 'bot2',     name: 'ロボット効率化',   icon: '🤖', desc: '採掘ロボットの生産が2倍になる', cost: 2500,   requireEarned: 1800,     type: 'building', target: 'bot', mult: 2 },
  { id: 'global2',  name: '共鳴フィールド I', icon: '✨', desc: '全ての生産量が1.5倍になる', cost: 15000,      requireEarned: 10000,    type: 'global', mult: 1.5 },
  { id: 'refinery2',name: 'プラント自動化',   icon: '🏭', desc: '精製プラントの生産が2倍になる', cost: 30000,  requireEarned: 20000,    type: 'building', target: 'refinery', mult: 2 },
  { id: 'click4',   name: 'クリック強化 III', icon: '👆', desc: 'クリック威力がさらに2倍になる', cost: 50000,  requireEarned: 35000,    type: 'click', mult: 2 },
  { id: 'satellite2',name: '衛星ネットワーク化',icon: '🛸', desc: '衛星コレクターの生産が2倍になる', cost: 250000, requireEarned: 180000,  type: 'building', target: 'satellite', mult: 2 },
  { id: 'global3',  name: '共鳴フィールド II',icon: '✨', desc: '全ての生産量が1.5倍になる', cost: 800000,     requireEarned: 600000,   type: 'global', mult: 1.5 },
  { id: 'reactor2', name: 'リアクター最適化', icon: '⚛️', desc: '量子リアクターの生産が2倍になる', cost: 2500000, requireEarned: 1800000, type: 'building', target: 'reactor', mult: 2 },
  { id: 'click5',   name: 'クリック強化 IV',  icon: '👆', desc: 'クリック威力がさらに2倍になる', cost: 5000000, requireEarned: 3500000, type: 'click', mult: 2 },
  { id: 'global4',  name: '共鳴フィールド III',icon: '✨', desc: '全ての生産量が2倍になる', cost: 50000000,    requireEarned: 35000000, type: 'global', mult: 2 },
];

const ACHIEVEMENT_DEFS = [
  { id: 'click_1',      name: '最初のクリック',   icon: '👆', desc: '1回クリックする', bonus: 0.01, check: s => s.totalClicks >= 1 },
  { id: 'click_100',    name: 'クリック職人',     icon: '🖱️', desc: '100回クリックする', bonus: 0.01, check: s => s.totalClicks >= 100 },
  { id: 'click_1000',   name: 'クリックマスター', icon: '🖱️', desc: '1,000回クリックする', bonus: 0.02, check: s => s.totalClicks >= 1000 },
  { id: 'crit_50',      name: '会心の一撃',       icon: '💥', desc: 'クリティカルを50回出す', bonus: 0.02, check: s => s.critCount >= 50 },
  { id: 'earn_1k',      name: '駆け出し採掘者',   icon: '⭐', desc: '累計1,000スターダストを稼ぐ', bonus: 0.01, check: s => s.totalEarned >= 1000 },
  { id: 'earn_100k',    name: '中堅採掘者',       icon: '🌟', desc: '累計100,000スターダストを稼ぐ', bonus: 0.02, check: s => s.totalEarned >= 100000 },
  { id: 'earn_10m',     name: 'ベテラン採掘者',   icon: '💫', desc: '累計10,000,000スターダストを稼ぐ', bonus: 0.03, check: s => s.totalEarned >= 1e7 },
  { id: 'earn_1b',      name: '伝説の採掘者',     icon: '🌌', desc: '累計1,000,000,000スターダストを稼ぐ', bonus: 0.05, check: s => s.totalEarned >= 1e9 },
  { id: 'building_10',  name: '小さな艦隊',       icon: '🛰️', desc: 'いずれかの施設を10個所有する', bonus: 0.01, check: s => Object.values(s.buildings).some(v => v >= 10) },
  { id: 'building_all', name: 'フルライン稼働',   icon: '🏗️', desc: 'すべての施設を1つ以上所有する', bonus: 0.02, check: s => BUILDING_DEFS.every(b => s.buildings[b.id] >= 1) },
  { id: 'golden_1',     name: '幸運の採取',       icon: '✨', desc: '黄金のスターダストを1回クリックする', bonus: 0.01, check: s => s.goldenClicks >= 1 },
  { id: 'golden_10',    name: '黄金の寵児',       icon: '🌠', desc: '黄金のスターダストを10回クリックする', bonus: 0.02, check: s => s.goldenClicks >= 10 },
  { id: 'prestige_1',   name: '新たな特異点',     icon: '🌀', desc: '1回転生する', bonus: 0.02, check: s => s.prestigeCount >= 1 },
  { id: 'prestige_5',   name: '輪廻の彼方',       icon: '♾️', desc: '5回転生する', bonus: 0.03, check: s => s.prestigeCount >= 5 },
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
  return Math.round(def.baseCost * Math.pow(1.15, state.buildings[id]));
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
  checkAchievements();
});

function spawnFloatNumber(e, gain, isCrit) {
  const rect = coreBtn.getBoundingClientRect();
  const layerRect = floatLayer.getBoundingClientRect();
  const clientX = e.clientX ?? (rect.left + rect.width / 2);
  const clientY = e.clientY ?? (rect.top + rect.height / 2);
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

function renderBuildings() {
  for (const def of BUILDING_DEFS) {
    const refs = buildingEls[def.id];
    const owned = state.buildings[def.id];
    const cost = buildingCost(def.id);
    const affordable = state.stardust >= cost;
    const cps = def.baseCps * buildingMult(def.id);

    refs.ownedEl.textContent = `×${owned}`;
    refs.costEl.textContent = `${fmtNum(cost)} ✦`;
    refs.cpsEl.textContent = `${fmtNum(cps)}/秒`;
    refs.card.classList.toggle('disabled', !affordable);
  }
}

function buyBuilding(id) {
  const cost = buildingCost(id);
  if (state.stardust < cost) return;
  state.stardust -= cost;
  state.buildings[id] += 1;
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
  orb.setAttribute('aria-label', '黄金のスターダスト');
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
  const roll = Math.random();
  if (roll < 0.4) {
    const gain = Math.max(totalCps() * 60, clickValue() * 40, 50);
    state.stardust += gain;
    state.totalEarned += gain;
    showToast(`✨ 黄金のスターダスト！ +${fmtNum(gain)}`);
  } else if (roll < 0.7) {
    state.buff = { type: 'frenzy', mult: 7, until: Date.now() + 20000 };
    showToast('⚡ フレンジー発動！ クリック威力7倍（20秒）');
  } else {
    state.buff = { type: 'surge', mult: 3, until: Date.now() + 30000 };
    showToast('🔥 生産サージ発動！ 生産量3倍（30秒）');
  }
  checkAchievements();
  renderAll();
}

function renderBuffBanner() {
  const b = activeBuff();
  if (!b) { buffBannerEl.classList.add('hidden'); return; }
  const remain = Math.max(0, Math.ceil((b.until - Date.now()) / 1000));
  const label = b.type === 'frenzy'
    ? `⚡ フレンジー中: クリック${b.mult}倍`
    : `🔥 生産サージ中: 生産${b.mult}倍`;
  buffBannerEl.textContent = `${label}（残り${remain}秒）`;
  buffBannerEl.classList.remove('hidden');
}

// ---------- prestige ----------
function updatePrestigeUI() {
  const gain = potentialSingularities();
  prestigeBtn.disabled = gain <= 0;
  singularityCountEl.textContent = `特異点: ${state.singularities}（生産 +${Math.round((prestigeMult() - 1) * 100)}%）`;
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
  checkAchievements();
  renderAll();
});

// ---------- main render / loop ----------
function renderAll() {
  stardustTotalEl.textContent = fmtNum(state.stardust);
  cpsLabelEl.textContent = `毎秒 +${fmtNum(totalCps())}`;
  clickPowerLabelEl.textContent = `クリック威力: +${fmtNum(clickValue())}`;
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
    alert(`おかえりなさい！\n離れていた間に ${fmtNum(gain)} スターダストを自動採取しました。`);
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
