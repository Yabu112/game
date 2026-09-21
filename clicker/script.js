'use strict';

/* =========================================================
   COSMIC CLICKER
   Idle/incremental clicker: click the core for Stardust,
   buy buildings for passive income, unlock upgrades, and
   prestige into Singularity Cores for a permanent multiplier.
   ========================================================= */

const SAVE_KEY = 'cosmicClickerSave';
const OFFLINE_CAP_SEC = 8 * 3600; // cap offline progress at 8 hours

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

function totalCps() {
  let sum = 0;
  for (const b of BUILDING_DEFS) sum += cpsFor(b.id);
  return sum * upgradeGlobalMult() * prestigeMult();
}

function clickValue() {
  return state.clickBase * clickUpgradeMult() * upgradeGlobalMult() * prestigeMult();
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
  const gain = clickValue();
  state.stardust += gain;
  state.totalEarned += gain;
  spawnFloatNumber(e, gain);
  pulseCore();
});

function spawnFloatNumber(e, gain) {
  const rect = coreBtn.getBoundingClientRect();
  const layerRect = floatLayer.getBoundingClientRect();
  const clientX = e.clientX ?? (rect.left + rect.width / 2);
  const clientY = e.clientY ?? (rect.top + rect.height / 2);
  const x = clientX - layerRect.left + (Math.random() * 30 - 15);
  const y = clientY - layerRect.top;
  const el = document.createElement('div');
  el.className = 'float-num';
  el.textContent = '+' + fmtNum(gain);
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
  state.stardust = 0;
  state.totalEarned = 0;
  state.clickBase = 1;
  BUILDING_DEFS.forEach(b => state.buildings[b.id] = 0);
  state.upgradesOwned = [];
  prestigeModal.classList.add('hidden');
  renderAll();
});

// ---------- main render / loop ----------
function renderAll() {
  stardustTotalEl.textContent = fmtNum(state.stardust);
  cpsLabelEl.textContent = `毎秒 +${fmtNum(totalCps())}`;
  clickPowerLabelEl.textContent = `クリック威力: +${fmtNum(clickValue())}`;
  renderBuildings();
  renderUpgrades();
  updatePrestigeUI();
}

let lastT = performance.now();
let renderAccum = 0;
function loop(t) {
  const dt = Math.min(0.5, (t - lastT) / 1000 || 0);
  lastT = t;

  const gain = totalCps() * dt;
  if (gain > 0) {
    state.stardust += gain;
    state.totalEarned += gain;
  }

  renderAccum += dt;
  if (renderAccum >= 0.1) {
    renderAccum = 0;
    renderAll();
  }

  requestAnimationFrame(loop);
}

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
applyOfflineProgress();
renderAll();
requestAnimationFrame(loop);
setInterval(save, 8000);
window.addEventListener('beforeunload', save);
