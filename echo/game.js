// Echo Arena — every round, your past selves come back to hunt you.
// Vanilla JS + Canvas. No build step.
(() => {
'use strict';

const cv = document.getElementById('game');
const ctx = cv.getContext('2d');
const floor = document.createElement('canvas');
const fctx = floor.getContext('2d');

let W = 0, H = 0, DPR = 1, CX = 0, CY = 0, R = 100;

const COLORS = ['#45f3ff', '#4d86ff', '#a35cff', '#ff4fd6', '#ff4d64', '#7dff6b', '#2fe0b0', '#e8f0ff'];
const ROMAN = ['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII','XIII','XIV','XV','XVI','XVII','XVIII','XIX','XX','XXI','XXII','XXIII','XXIV','XXV'];
const GOLD = '#ffb43a';
const ROUND_T = 20;     // seconds per round
const DT = 1 / 60;      // fixed sim step
const MAXG = 8;         // most echoes at once
const SKEY = 'echoarena.v1';

const roman = k => ROMAN[k - 1] || String(k);
const colorOf = k => COLORS[(k - 1) % COLORS.length];
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const rnd = (a, b) => a + Math.random() * (b - a);

// ---------- save ----------
let save = { best: 0, bestRound: 0, muted: false };
try { Object.assign(save, JSON.parse(localStorage.getItem(SKEY) || '{}')); } catch (e) {}
function persist() { try { localStorage.setItem(SKEY, JSON.stringify(save)); } catch (e) {} }

// ---------- audio ----------
let AC = null, master = null;
function audioInit() {
  if (AC) { if (AC.state === 'suspended') AC.resume(); return; }
  const A = window.AudioContext || window.webkitAudioContext;
  if (!A) return;
  try {
    AC = new A();
    master = AC.createGain();
    master.gain.value = save.muted ? 0 : 0.5;
    master.connect(AC.destination);
  } catch (e) { AC = null; }
}
function tone(f0, f1, dur, type, vol, delay) {
  if (!AC || save.muted) return;
  const t0 = AC.currentTime + (delay || 0);
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t0);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + dur + 0.02);
}
let shotCool = 0;
const sfx = {
  shot() { if (shotCool > 0) return; shotCool = 0.07; tone(900, 600, 0.05, 'triangle', 0.035); },
  hit() { tone(300, 180, 0.06, 'square', 0.05); },
  moth() { tone(520, 200, 0.09, 'triangle', 0.08); },
  ghost() { tone(220, 880, 0.25, 'sawtooth', 0.09); tone(660, 1320, 0.3, 'triangle', 0.07, 0.05); },
  hurt() { tone(160, 50, 0.35, 'sawtooth', 0.18); },
  shield() { tone(1200, 400, 0.25, 'sine', 0.12); },
  round() { [523, 659, 784, 1046].forEach((f, i) => tone(f, f, 0.18, 'triangle', 0.09, i * 0.08)); },
  pick() { tone(660, 990, 0.12, 'triangle', 0.1); },
  start() { tone(330, 660, 0.3, 'triangle', 0.1); },
  over() { [392, 330, 262, 196].forEach((f, i) => tone(f, f * 0.98, 0.3, 'sawtooth', 0.08, i * 0.14)); }
};
function setMuted(m) {
  save.muted = m; persist();
  if (master) master.gain.value = m ? 0 : 0.5;
  const b = document.getElementById('mute');
  if (b) b.textContent = m ? '🔇' : '🔊';
}

// ---------- glow sprites ----------
const glowCache = {};
function glow(col) {
  if (glowCache[col]) return glowCache[col];
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.2, col); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return (glowCache[col] = c);
}
function drawGlow(x, y, r, col, a) {
  ctx.globalAlpha = a == null ? 1 : a;
  ctx.drawImage(glow(col), x - r, y - r, r * 2, r * 2);
  ctx.globalAlpha = 1;
}

// ---------- runes on the floor ----------
let runes = [];
function makeRunes() {
  runes = [];
  const rings = [[0.86, 30], [0.58, 20]];
  for (const [rr, n] of rings) {
    for (let i = 0; i < n; i++) {
      const segs = [[0, -1, 0, 1]];
      const k = 1 + (Math.random() * 2 | 0);
      for (let j = 0; j < k; j++) {
        const y = rnd(-0.9, 0.6), side = Math.random() < 0.5 ? -1 : 1;
        segs.push([0, y, side * rnd(0.4, 0.7), y + rnd(-0.6, 0.6)]);
      }
      runes.push({ a: (i / n) * Math.PI * 2, rr, segs, lit: 0, col: GOLD });
    }
  }
}
makeRunes();

// ---------- layout ----------
let history = [];   // finished rounds: {k, path:{x:[],y:[]}, stats}
function resize() {
  W = window.innerWidth; H = window.innerHeight;
  DPR = Math.min(2, window.devicePixelRatio || 1);
  cv.width = W * DPR | 0; cv.height = H * DPR | 0;
  cv.style.width = W + 'px'; cv.style.height = H + 'px';
  floor.width = cv.width; floor.height = cv.height;
  CX = W / 2; CY = H * 0.54;
  R = Math.min(W * 0.46, H * 0.39);
  redrawFloor();
}
function redrawFloor() {
  const f = fctx;
  f.setTransform(DPR, 0, 0, DPR, 0, 0);
  f.clearRect(0, 0, W, H);
  const gr = f.createRadialGradient(CX, CY, R * 0.1, CX, CY, R);
  gr.addColorStop(0, '#272a34'); gr.addColorStop(1, '#16181f');
  f.fillStyle = gr; f.beginPath(); f.arc(CX, CY, R, 0, Math.PI * 2); f.fill();
  f.strokeStyle = '#323745'; f.lineWidth = 2;
  for (const k of [0.995, 0.72, 0.44]) { f.beginPath(); f.arc(CX, CY, R * k, 0, Math.PI * 2); f.stroke(); }
  // stone joints
  f.strokeStyle = '#1d2028'; f.lineWidth = 2;
  for (let i = 0; i < 16; i++) {
    const a = i / 16 * Math.PI * 2 + 0.1;
    f.beginPath(); f.moveTo(CX + Math.cos(a) * R * 0.72, CY + Math.sin(a) * R * 0.72);
    f.lineTo(CX + Math.cos(a) * R * 0.995, CY + Math.sin(a) * R * 0.995); f.stroke();
  }
  for (let i = 0; i < 10; i++) {
    const a = i / 10 * Math.PI * 2 + 0.3;
    f.beginPath(); f.moveTo(CX + Math.cos(a) * R * 0.44, CY + Math.sin(a) * R * 0.44);
    f.lineTo(CX + Math.cos(a) * R * 0.72, CY + Math.sin(a) * R * 0.72); f.stroke();
  }
  // the paths of every past round stay burned into the floor
  f.lineCap = 'round'; f.lineJoin = 'round';
  for (const h of history) {
    f.strokeStyle = colorOf(h.k); f.globalAlpha = 0.09; f.lineWidth = 6;
    f.beginPath();
    for (let i = 0; i < h.path.x.length; i += 3) {
      const x = CX + h.path.x[i] * R, y = CY + h.path.y[i] * R;
      i ? f.lineTo(x, y) : f.moveTo(x, y);
    }
    f.stroke();
  }
  f.globalAlpha = 1;
}

// ---------- game state ----------
let state = 'title';     // title | play | upgrade | over
let time = 0;            // global clock for animation
let round = 0, rt = 0, fr = 0;
let score = 0, combo = 0, comboT = 0;
let P, roundStats, rec, ghosts = [], moths = [], pb = [], eb = [], parts = [], texts = [];
let spawnAcc = 0, hitstop = 0, shake = 0, flash = 0, banner = 0, overT = 0, cards = [], newBest = false;

function newPlayer() {
  return {
    x: CX, y: CY + R * 0.55, vx: 0, vy: 0, hp: 3, maxHp: 3, inv: 0, fireT: 0, hurtT: 0,
    lookX: 0, lookY: -1, shieldUp: false,
    stats: { spread: 1, rate: 1, power: 1, pierce: 0, speed: 1, shield: 0 }
  };
}

function startRun() {
  audioInit(); sfx.start();
  history = []; round = 0; score = 0; combo = 0; newBest = false;
  P = newPlayer();
  makeRunes(); redrawFloor();
  startRound();
}

function startRound() {
  round++; rt = 0; fr = 0; spawnAcc = 0;
  moths = []; pb = []; eb = [];
  rec = { x: [], y: [] };
  P.x = CX; P.y = CY + R * 0.55; P.vx = P.vy = 0; P.inv = 1.0;
  P.shieldUp = P.stats.shield > 0;
  roundStats = Object.assign({}, P.stats);
  const hs = history.slice(-MAXG);
  ghosts = hs.map((h, i) => {
    const ang = Math.PI * 2 * (i + 1) / (hs.length + 1);
    const maxHp = 4 + h.k * 1.5 + h.stats.power;
    return { k: h.k, path: h.path, stats: h.stats, ca: Math.cos(ang), sa: Math.sin(ang),
      x: CX, y: CY, hp: maxHp, maxHp, alive: true, fireT: rnd(1.2, 2.2), flashT: 0, lx: 0, ly: 1 };
  });
  banner = 1.8;
  state = 'play';
  sfx.round();
}

function endRound() {
  history.push({ k: round, path: rec, stats: roundStats });
  score += 250 * round;
  addText(CX, CY - R * 0.2, '+' + (250 * round) + ' survived', GOLD, 22);
  for (const m of moths) burst(m.x, m.y, '#ffcf6a', 8, 120);
  for (const g of ghosts) if (g.alive) burst(g.x, g.y, colorOf(g.k), 14, 160);
  moths = []; eb = []; pb = [];
  redrawFloor();
  cards = pickCards();
  state = 'upgrade'; overT = 0;
  sfx.round();
}

const UPGRADES = [
  { id: 'spread', name: 'Split Flame', desc: '+1 shot per volley', ok: s => s.spread < 5, apply: p => p.stats.spread++ },
  { id: 'rate', name: 'Quick Wick', desc: 'Fire 25% faster', ok: s => s.rate < 3, apply: p => p.stats.rate *= 1.25 },
  { id: 'power', name: 'Hot Core', desc: '+1 damage', ok: s => s.power < 5, apply: p => p.stats.power++ },
  { id: 'pierce', name: 'Lancing Light', desc: 'Shots pierce +1 enemy', ok: s => s.pierce < 3, apply: p => p.stats.pierce++ },
  { id: 'speed', name: 'Light Feet', desc: 'Move 12% faster', ok: s => s.speed < 1.6, apply: p => p.stats.speed *= 1.12 },
  { id: 'shield', name: 'Glass Ward', desc: 'Block the first hit each round', ok: s => !s.shield, apply: p => p.stats.shield = 1 },
  { id: 'heal', name: 'Rekindle', desc: 'Heal 1 heart', ok: (s, p) => p.hp < p.maxHp, apply: p => p.hp = Math.min(p.maxHp, p.hp + 1) },
  { id: 'max', name: 'Brighter', desc: '+1 max heart and heal it', ok: (s, p) => p.maxHp < 5, apply: p => { p.maxHp++; p.hp++; } }
];
function pickCards() {
  const pool = UPGRADES.filter(u => u.ok(P.stats, P));
  const out = [];
  while (out.length < 3 && pool.length) out.push(pool.splice(Math.random() * pool.length | 0, 1)[0]);
  return out;
}
function cardRects() {
  const w = Math.min(W * 0.84, 360), h = 70, gap = 12;
  const total = cards.length * h + (cards.length - 1) * gap;
  const y0 = CY - total / 2 + 30;
  return cards.map((c, i) => ({ x: CX - w / 2, y: y0 + i * (h + gap), w, h }));
}
function choose(i) {
  if (state !== 'upgrade' || !cards[i] || overT < 0.35) return;
  cards[i].apply(P); sfx.pick();
  startRound();
}

function gameOver() {
  state = 'over'; overT = 0;
  newBest = score > save.best;
  if (newBest) save.best = score;
  save.bestRound = Math.max(save.bestRound, round);
  persist();
  sfx.over();
  burst(P.x, P.y, GOLD, 40, 260);
}

// ---------- fx ----------
function burst(x, y, col, n, sp) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, v = rnd(0.2, 1) * sp;
    parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rnd(0.3, 0.8), max: 0.8, col, s: rnd(2, 5) });
  }
  if (parts.length > 500) parts.splice(0, parts.length - 500);
}
function addText(x, y, s, col, size) { texts.push({ x, y, s, col, size: size || 16, life: 1.1 }); }

// ---------- input ----------
const keys = {};
let touch = null; // {id, x0, y0, x, y}
window.addEventListener('keydown', e => {
  keys[e.key.toLowerCase()] = true;
  if (e.key === 'm' || e.key === 'M') setMuted(!save.muted);
  if ((e.key === ' ' || e.key === 'Enter') && (state === 'title' || (state === 'over' && overT > 0.8))) startRun();
  if (state === 'upgrade' && '123'.includes(e.key)) choose(+e.key - 1);
});
window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });

function pointerPos(e) { return { x: e.clientX, y: e.clientY }; }
cv.addEventListener('pointerdown', e => {
  e.preventDefault && e.preventDefault();
  audioInit();
  const p = pointerPos(e);
  if (state === 'title') { startRun(); return; }
  if (state === 'over') { if (overT > 0.8) startRun(); return; }
  if (state === 'upgrade') {
    cardRects().forEach((r, i) => { if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) choose(i); });
    return;
  }
  touch = { id: e.pointerId, x0: p.x, y0: p.y, x: p.x, y: p.y };
});
window.addEventListener('pointermove', e => {
  if (!touch || (e.pointerId != null && touch.id != null && e.pointerId !== touch.id)) return;
  const p = pointerPos(e); touch.x = p.x; touch.y = p.y;
  // the stick follows your thumb so you never run out of room
  const dx = touch.x - touch.x0, dy = touch.y - touch.y0, d = Math.hypot(dx, dy), m = 60;
  if (d > m) { touch.x0 = touch.x - dx / d * m; touch.y0 = touch.y - dy / d * m; }
});
const endTouch = e => { if (touch && (e.pointerId == null || touch.id == null || e.pointerId === touch.id)) touch = null; };
window.addEventListener('pointerup', endTouch);
window.addEventListener('pointercancel', endTouch);

function inputVec() {
  let x = 0, y = 0;
  if (keys['a'] || keys['arrowleft']) x -= 1;
  if (keys['d'] || keys['arrowright']) x += 1;
  if (keys['w'] || keys['arrowup']) y -= 1;
  if (keys['s'] || keys['arrowdown']) y += 1;
  if (touch) { x += (touch.x - touch.x0) / 42; y += (touch.y - touch.y0) / 42; }
  const d = Math.hypot(x, y);
  if (d > 1) { x /= d; y /= d; }
  return { x, y };
}

// ---------- simulation ----------
function nearestTarget(x, y, range) {
  let best = null, bd = range * range;
  for (const m of moths) { const d = (m.x - x) ** 2 + (m.y - y) ** 2; if (d < bd) { bd = d; best = m; } }
  for (const g of ghosts) {
    if (!g.alive || rt < 1) continue;
    const d = (g.x - x) ** 2 + (g.y - y) ** 2 * 1;
    if (d * 0.8 < bd) { bd = d * 0.8; best = g; }   // slight priority on echoes
  }
  return best;
}
function volley(list, x, y, ang, n, speed, col, extra) {
  const spacing = 0.2;
  for (let i = 0; i < n; i++) {
    const a = ang + (i - (n - 1) / 2) * spacing;
    list.push(Object.assign({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, life: 2.2, col }, extra));
  }
}

function hurtPlayer() {
  if (P.inv > 0 || state !== 'play') return;
  if (P.shieldUp) {
    P.shieldUp = false; P.inv = 0.8; sfx.shield();
    burst(P.x, P.y, '#bfe9ff', 24, 220); shake = Math.max(shake, 6); hitstop = 0.05;
    return;
  }
  P.hp--; P.inv = 1.3; P.hurtT = 0.5;
  sfx.hurt(); burst(P.x, P.y, '#ff5a3a', 26, 240);
  shake = 14; hitstop = 0.11; flash = 0.35;
  combo = 0;
  if (navigator.vibrate) try { navigator.vibrate(60); } catch (e) {}
  if (P.hp <= 0) gameOver();
}

function killScore(base, x, y, col) {
  combo++; comboT = 1.8;
  const mult = Math.min(4, 1 + Math.floor(combo / 5) * 0.5);
  const s = Math.round(base * mult);
  score += s;
  addText(x, y - 14, '+' + s, col, base >= 100 ? 22 : 14);
}

function step(dt) {
  time += dt;
  shotCool -= dt;
  // particles & texts always move
  for (const p of parts) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.94; p.vy *= 0.94; p.life -= dt; }
  parts = parts.filter(p => p.life > 0);
  for (const t of texts) { t.y -= 30 * dt; t.life -= dt; }
  texts = texts.filter(t => t.life > 0);
  for (const r of runes) r.lit = Math.max(0, r.lit - dt * 0.35);
  shake = Math.max(0, shake - dt * 40);
  flash = Math.max(0, flash - dt);
  overT += dt;
  if (state !== 'play') return;
  if (hitstop > 0) { hitstop -= dt; return; }

  rt += dt; fr++;
  banner = Math.max(0, banner - dt);
  comboT -= dt; if (comboT <= 0) combo = 0;
  P.inv -= dt; P.hurtT -= dt;

  // move
  const iv = inputVec();
  const sp = 205 * P.stats.speed;
  const k = Math.min(1, dt * 14);
  P.vx += (iv.x * sp - P.vx) * k; P.vy += (iv.y * sp - P.vy) * k;
  P.x += P.vx * dt; P.y += P.vy * dt;
  const dx = P.x - CX, dy = P.y - CY, d = Math.hypot(dx, dy), lim = R - 16;
  if (d > lim) { P.x = CX + dx / d * lim; P.y = CY + dy / d * lim; }
  rec.x.push((P.x - CX) / R); rec.y.push((P.y - CY) / R);

  // auto fire
  P.fireT -= dt;
  const tgt = nearestTarget(P.x, P.y, R * 1.15);
  if (tgt) { const a = Math.atan2(tgt.y - P.y, tgt.x - P.x); P.lookX = Math.cos(a); P.lookY = Math.sin(a); }
  else if (Math.hypot(P.vx, P.vy) > 20) { const v = Math.hypot(P.vx, P.vy); P.lookX = P.vx / v; P.lookY = P.vy / v; }
  if (tgt && P.fireT <= 0) {
    P.fireT = 0.34 / P.stats.rate;
    volley(pb, P.x + P.lookX * 14, P.y + P.lookY * 14, Math.atan2(P.lookY, P.lookX), P.stats.spread, 540, GOLD,
      { dmg: P.stats.power, pierce: P.stats.pierce, hitSet: null });
    sfx.shot();
  }

  // echoes replay your old rounds, rotated to their own starting point
  for (const g of ghosts) {
    if (!g.alive) continue;
    const n = g.path.x.length, i = Math.min(fr, n - 1);
    const nx = g.path.x[i], ny = g.path.y[i];
    const ox = g.x, oy = g.y;
    g.x = CX + R * (nx * g.ca - ny * g.sa);
    g.y = CY + R * (nx * g.sa + ny * g.ca);
    const mv = Math.hypot(g.x - ox, g.y - oy);
    if (mv > 0.3) { g.lx = (g.x - ox) / mv; g.ly = (g.y - oy) / mv; }
    g.flashT -= dt;
    if (rt > 1) {
      g.fireT -= dt;
      if (g.fireT <= 0) {
        g.fireT = 0.34 / g.stats.rate * 2.4;
        const a = Math.atan2(P.y - g.y, P.x - g.x) + rnd(-0.08, 0.08);
        volley(eb, g.x, g.y, a, g.stats.spread, 200 + g.k * 4, colorOf(g.k), {});
      }
    }
    // light the runes they walk over
    if (fr % 4 === 0) lightRunes(g.x, g.y, colorOf(g.k));
  }
  if (fr % 4 === 0) lightRunes(P.x, P.y, GOLD);

  // moths
  spawnAcc += dt * (0.75 + 0.22 * round) * (rt > 0.6 ? 1 : 0);
  while (spawnAcc >= 1 && moths.length < 45) {
    spawnAcc -= 1;
    const a = Math.random() * Math.PI * 2;
    const big = round >= 5 && Math.random() < Math.min(0.35, 0.1 + round * 0.02);
    moths.push(makeMoth(CX + Math.cos(a) * (R + 24), CY + Math.sin(a) * (R + 24), big));
  }
  if (spawnAcc >= 1) spawnAcc = 0;
  for (const m of moths) {
    const a = Math.atan2(P.y - m.y, P.x - m.x) + Math.sin(time * 3 + m.seed) * 0.7;
    m.x += Math.cos(a) * m.sp * dt; m.y += Math.sin(a) * m.sp * dt; m.ang = a; m.flashT -= dt;
    if ((m.x - P.x) ** 2 + (m.y - P.y) ** 2 < (m.r + 11) ** 2) { hurtPlayer(); m.hp = 0; m.dead = true; burst(m.x, m.y, '#9aa0ad', 10, 140); }
  }

  // player bullets
  for (const b of pb) {
    b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
    if ((b.x - CX) ** 2 + (b.y - CY) ** 2 > (R + 40) ** 2) b.life = 0;
    if (b.life <= 0) continue;
    for (const m of moths) {
      if (m.dead || (b.hitSet && b.hitSet.includes(m))) continue;
      if ((m.x - b.x) ** 2 + (m.y - b.y) ** 2 < (m.r + 4) ** 2) {
        m.hp -= b.dmg; m.flashT = 0.08; sfx.hit();
        if (m.hp <= 0) killMoth(m);
        if (b.pierce > 0) { b.pierce--; (b.hitSet = b.hitSet || []).push(m); } else { b.life = 0; break; }
      }
    }
    if (b.life <= 0) continue;
    for (const g of ghosts) {
      if (!g.alive || rt < 1 || (b.hitSet && b.hitSet.includes(g))) continue;
      if ((g.x - b.x) ** 2 + (g.y - b.y) ** 2 < 17 * 17) {
        g.hp -= b.dmg; g.flashT = 0.08; sfx.hit();
        burst(b.x, b.y, colorOf(g.k), 3, 90);
        if (g.hp <= 0) killGhost(g);
        if (b.pierce > 0) { b.pierce--; (b.hitSet = b.hitSet || []).push(g); } else { b.life = 0; break; }
      }
    }
  }
  pb = pb.filter(b => b.life > 0);

  // echo bullets
  for (const b of eb) {
    b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
    if ((b.x - CX) ** 2 + (b.y - CY) ** 2 > (R + 30) ** 2) b.life = 0;
    if (b.life > 0 && (b.x - P.x) ** 2 + (b.y - P.y) ** 2 < 12 * 12) { b.life = 0; hurtPlayer(); }
  }
  eb = eb.filter(b => b.life > 0);
  moths = moths.filter(m => !m.dead);

  if (state === 'play' && rt >= ROUND_T) endRound();
}

function makeMoth(x, y, big) {
  return { x, y, big, r: big ? 15 : 9, hp: big ? 4 + round * 0.3 : 1 + Math.floor(round / 4),
    sp: (big ? 52 : 72) + round * 5 + rnd(-8, 8), seed: Math.random() * 10, ang: 0, flashT: 0, dead: false };
}
function killMoth(m) {
  if (m.dead) return;
  m.dead = true; sfx.moth();
  burst(m.x, m.y, '#ffcf6a', m.big ? 18 : 9, m.big ? 200 : 140);
  killScore(m.big ? 30 : 10, m.x, m.y, '#ffdca0');
  if (m.big) for (let i = 0; i < 2; i++) {
    const c = makeMoth(m.x + rnd(-10, 10), m.y + rnd(-10, 10), false);
    moths.push(c);
  }
  shake = Math.max(shake, m.big ? 5 : 2);
}
function killGhost(g) {
  g.alive = false; sfx.ghost();
  burst(g.x, g.y, colorOf(g.k), 34, 280);
  // its sparks fly into Wick
  for (let i = 0; i < 14; i++) {
    const a = Math.random() * Math.PI * 2;
    parts.push({ x: g.x + Math.cos(a) * 10, y: g.y + Math.sin(a) * 10, vx: (P.x - g.x) * 2.2, vy: (P.y - g.y) * 2.2, life: 0.45, max: 0.45, col: colorOf(g.k), s: 4 });
  }
  killScore(100 * g.k, g.x, g.y, colorOf(g.k));
  hitstop = 0.07; shake = Math.max(shake, 9);
}
function lightRunes(x, y, col) {
  for (const r of runes) {
    const rx = CX + Math.cos(r.a) * R * r.rr, ry = CY + Math.sin(r.a) * R * r.rr;
    if ((rx - x) ** 2 + (ry - y) ** 2 < 34 * 34) { r.lit = 1; r.col = col; }
  }
}

// ---------- drawing ----------
function drawWick(x, y, s, o) {
  o = o || {};
  const ghost = !!o.ghost, col = o.color || GOLD;
  ctx.save(); ctx.translate(x, y);
  if (o.alpha != null) ctx.globalAlpha = o.alpha;
  // flame tongues
  const n = o.flames || 1, big = o.big || 1;
  for (let i = 0; i < n; i++) {
    const off = (i - (n - 1) / 2) * s * 0.36;
    const h = s * (0.95 + 0.18 * Math.sin(time * 15 + i * 2.1)) * big * (n > 1 ? 0.9 : 1);
    const tip = off + Math.sin(time * 9 + i) * s * 0.12;
    ctx.beginPath();
    ctx.moveTo(off - s * 0.24, -s * 0.78);
    ctx.quadraticCurveTo(off - s * 0.3, -s * 0.78 - h * 0.6, tip, -s * 0.78 - h);
    ctx.quadraticCurveTo(off + s * 0.3, -s * 0.78 - h * 0.6, off + s * 0.24, -s * 0.78);
    ctx.closePath();
    if (ghost) { ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.stroke(); }
    else {
      const g = ctx.createLinearGradient(0, -s * 0.78 - h, 0, -s * 0.78);
      g.addColorStop(0, '#fff3a8'); g.addColorStop(0.5, '#ffb43a'); g.addColorStop(1, '#ff6a1a');
      ctx.fillStyle = g; ctx.fill();
    }
  }
  // cap
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(-s * 0.42, -s * 0.98, s * 0.84, s * 0.24, s * 0.08); else ctx.rect(-s * 0.42, -s * 0.98, s * 0.84, s * 0.24);
  if (ghost) { ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.stroke(); } else { ctx.fillStyle = '#5a3414'; ctx.fill(); }
  // body
  ctx.beginPath(); ctx.arc(0, 0, s * 0.82, 0, Math.PI * 2);
  if (ghost) {
    ctx.fillStyle = col; ctx.globalAlpha *= 0.16; ctx.fill(); ctx.globalAlpha = o.alpha != null ? o.alpha : 1;
    ctx.strokeStyle = o.flashT > 0 ? '#ffffff' : col; ctx.lineWidth = 2.4; ctx.stroke();
  } else {
    const g = ctx.createRadialGradient(-s * 0.25, -s * 0.3, s * 0.1, 0, 0, s * 0.85);
    g.addColorStop(0, '#ffe08a'); g.addColorStop(0.6, '#ffa531'); g.addColorStop(1, '#d9661a');
    ctx.fillStyle = o.hurt ? '#ff6a5a' : g; ctx.fill();
  }
  // eye
  const ex = (o.lx || 0) * s * 0.12, ey = s * 0.04 + (o.ly || 0) * s * 0.1;
  ctx.beginPath(); ctx.arc(ex * 0.5, ey, s * 0.44, 0, Math.PI * 2);
  if (ghost) { ctx.strokeStyle = col; ctx.lineWidth = 1.8; ctx.stroke(); ctx.beginPath(); ctx.arc(ex, ey, s * 0.16, 0, Math.PI * 2); ctx.stroke(); }
  else {
    ctx.fillStyle = '#fffaf0'; ctx.fill();
    ctx.beginPath(); ctx.arc(ex, ey + (o.lx ? 0 : 0), s * 0.22, 0, Math.PI * 2); ctx.fillStyle = '#3a1a0a'; ctx.fill();
    ctx.beginPath(); ctx.arc(ex - s * 0.07, ey - s * 0.08, s * 0.07, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
    if (o.hurt || o.blink) { // squint: lid closes half the eye
      ctx.beginPath(); ctx.arc(ex * 0.5, ey, s * 0.46, Math.PI, Math.PI * 2); ctx.fillStyle = '#e07a2a'; ctx.fill();
    }
  }
  ctx.restore();
}

function drawMoth(m) {
  ctx.save(); ctx.translate(m.x, m.y); ctx.rotate(m.ang + Math.PI / 2);
  const s = m.r, f = 0.35 + Math.abs(Math.sin(time * 22 + m.seed)) * 0.65;
  ctx.fillStyle = m.flashT > 0 ? '#ffffff' : (m.big ? '#6d7280' : '#8a8f9c');
  for (const side of [-1, 1]) {
    ctx.beginPath(); ctx.ellipse(side * s * 0.6 * f, -s * 0.1, s * 0.75 * f, s * 0.5, side * 0.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(side * s * 0.45 * f, s * 0.45, s * 0.45 * f, s * 0.32, -side * 0.4, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = '#3b3f49'; ctx.beginPath(); ctx.ellipse(0, 0, s * 0.22, s * 0.62, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawRunes() {
  const gs = Math.max(5, R * 0.035);
  ctx.lineCap = 'round';
  for (const r of runes) {
    const x = CX + Math.cos(r.a) * R * r.rr, y = CY + Math.sin(r.a) * R * r.rr;
    ctx.save(); ctx.translate(x, y); ctx.rotate(r.a + Math.PI / 2);
    ctx.strokeStyle = '#353a47'; ctx.lineWidth = 2; ctx.globalAlpha = 1;
    ctx.beginPath(); for (const s of r.segs) { ctx.moveTo(s[0] * gs, s[1] * gs); ctx.lineTo(s[2] * gs, s[3] * gs); } ctx.stroke();
    if (r.lit > 0.02) {
      ctx.strokeStyle = r.col; ctx.globalAlpha = r.lit; ctx.lineWidth = 2.2;
      ctx.beginPath(); for (const s of r.segs) { ctx.moveTo(s[0] * gs, s[1] * gs); ctx.lineTo(s[2] * gs, s[3] * gs); } ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    if (r.lit > 0.02) { ctx.globalCompositeOperation = 'lighter'; drawGlow(x, y, gs * 3, r.col, r.lit * 0.5); ctx.globalCompositeOperation = 'source-over'; }
  }
}

function heart(x, y, s, full) {
  ctx.save(); ctx.translate(x, y);
  ctx.beginPath();
  ctx.moveTo(0, s * 0.35);
  ctx.bezierCurveTo(-s, -s * 0.3, -s * 0.45, -s, 0, -s * 0.45);
  ctx.bezierCurveTo(s * 0.45, -s, s, -s * 0.3, 0, s * 0.35);
  if (full) { ctx.fillStyle = GOLD; ctx.fill(); } else { ctx.strokeStyle = '#6a5a40'; ctx.lineWidth = 1.5; ctx.stroke(); }
  ctx.restore();
}

function text(s, x, y, size, col, align, weight) {
  ctx.font = (weight || '700') + ' ' + size + 'px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  ctx.textAlign = align || 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = col; ctx.fillText(s, x, y);
}

function render() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = '#0b0c10'; ctx.fillRect(0, 0, W, H);
  ctx.save();
  if (shake > 0) ctx.translate(rnd(-shake, shake) * 0.5, rnd(-shake, shake) * 0.5);
  ctx.drawImage(floor, 0, 0, W, H);
  drawRunes();

  const playing = state === 'play' || state === 'upgrade' || state === 'over';
  if (playing) {
    // echo bullets
    ctx.globalCompositeOperation = 'lighter';
    for (const b of eb) { drawGlow(b.x, b.y, 11, b.col, 0.9); }
    for (const b of pb) { drawGlow(b.x, b.y, 8, GOLD, 0.9); drawGlow(b.x - b.vx * 0.012, b.y - b.vy * 0.012, 5, GOLD, 0.5); }
    ctx.globalCompositeOperation = 'source-over';
    for (const b of eb) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(b.x, b.y, 2.6, 0, Math.PI * 2); ctx.fill(); }

    for (const m of moths) drawMoth(m);

    for (const g of ghosts) {
      if (!g.alive) continue;
      const fade = Math.min(1, rt / 1.0);
      const col = colorOf(g.k);
      ctx.globalCompositeOperation = 'lighter';
      drawGlow(g.x, g.y, 34, col, 0.35 * fade);
      ctx.globalCompositeOperation = 'source-over';
      drawWick(g.x, g.y, 15, { ghost: true, color: col, alpha: 0.9 * fade, flames: g.stats.spread, lx: g.lx, ly: g.ly, flashT: g.flashT });
      text(roman(g.k), g.x, g.y - 38, 13, col, 'center', '800');
      if (g.hp < g.maxHp) {
        ctx.fillStyle = 'rgba(255,255,255,.15)'; ctx.fillRect(g.x - 14, g.y + 18, 28, 3);
        ctx.fillStyle = col; ctx.fillRect(g.x - 14, g.y + 18, 28 * Math.max(0, g.hp / g.maxHp), 3);
      }
    }

    if (state !== 'over') {
      const blink = P.inv > 0 && state === 'play' && Math.floor(time * 16) % 2 === 0;
      ctx.globalCompositeOperation = 'lighter';
      drawGlow(P.x, P.y, 46, GOLD, 0.45);
      ctx.globalCompositeOperation = 'source-over';
      if (!blink) {
        const up = P.stats.spread - 1 + (P.stats.power - 1) + P.stats.pierce;
        drawWick(P.x, P.y, 16, { flames: P.stats.spread, big: 1 + up * 0.06, lx: P.lookX, ly: P.lookY, hurt: P.hurtT > 0 });
      }
      if (P.shieldUp) {
        ctx.strokeStyle = 'rgba(190,233,255,' + (0.55 + 0.25 * Math.sin(time * 6)) + ')'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(P.x, P.y, 24, 0, Math.PI * 2); ctx.stroke();
      }
    }
  } else {
    // title: Wick and a ring of echoes orbiting
    const n = 5;
    for (let i = 0; i < n; i++) {
      const a = time * 0.5 + i / n * Math.PI * 2, col = colorOf(i + 1);
      const x = CX + Math.cos(a) * R * 0.62, y = CY + Math.sin(a) * R * 0.62;
      ctx.globalCompositeOperation = 'lighter'; drawGlow(x, y, 34, col, 0.35); ctx.globalCompositeOperation = 'source-over';
      drawWick(x, y, 15, { ghost: true, color: col, alpha: 0.9, flames: 1 + (i % 3), lx: -Math.cos(a), ly: -Math.sin(a) });
      text(roman(i + 1), x, y - 38, 13, col);
      if (Math.random() < 0.1) lightRunes(x, y, col);
    }
    ctx.globalCompositeOperation = 'lighter'; drawGlow(CX, CY, 70, GOLD, 0.5); ctx.globalCompositeOperation = 'source-over';
    drawWick(CX, CY, 26, { flames: 3, lx: Math.sin(time), ly: 0.3 });
  }

  // particles
  ctx.globalCompositeOperation = 'lighter';
  for (const p of parts) drawGlow(p.x, p.y, p.s * 2.2, p.col, Math.min(1, p.life / p.max * 1.5));
  ctx.globalCompositeOperation = 'source-over';
  for (const t of texts) { ctx.globalAlpha = Math.min(1, t.life * 1.5); text(t.s, t.x, t.y, t.size, t.col, 'center', '800'); }
  ctx.globalAlpha = 1;
  ctx.restore();

  // vignette
  const vg = ctx.createRadialGradient(CX, CY, R * 0.7, CX, CY, Math.max(W, H) * 0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.75)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
  if (flash > 0) { ctx.fillStyle = 'rgba(255,60,40,' + flash * 0.5 + ')'; ctx.fillRect(0, 0, W, H); }

  // joystick hint
  if (touch && state === 'play') {
    ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(touch.x0, touch.y0, 42, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(255,200,120,.35)'; ctx.beginPath(); ctx.arc(touch.x, touch.y, 16, 0, Math.PI * 2); ctx.fill();
  }

  drawHUD();
}

function drawHUD() {
  const top = 26;
  if (state === 'title') {
    text('ECHO ARENA', CX, H * 0.12, Math.min(44, W * 0.11), '#fff3da', 'center', '900');
    text('Every round, your past selves come back to hunt you.', CX, H * 0.12 + 36, Math.min(15, W * 0.038), '#c9b48c', 'center', '500');
    const a = 0.6 + 0.4 * Math.sin(time * 4);
    ctx.globalAlpha = a; text('Tap to start', CX, H * 0.9, 20, GOLD, 'center', '800'); ctx.globalAlpha = 1;
    text('Drag anywhere to move · Wick shoots on its own · WASD on desktop', CX, H * 0.9 + 28, Math.min(12, W * 0.03), '#8a8f9c', 'center', '500');
    if (save.best) text('Best ' + save.best + ' · Round ' + save.bestRound, CX, H * 0.12 + 62, 13, '#8a8f9c', 'center', '600');
    return;
  }
  // hearts
  for (let i = 0; i < P.maxHp; i++) heart(22 + i * 24, top, 10, i < P.hp);
  // score
  text(String(score), W - 16, top, 22, '#fff3da', 'right', '900');
  if (combo >= 5) text('x' + Math.min(4, 1 + Math.floor(combo / 5) * 0.5).toFixed(1) + ' combo', W - 16, top + 22, 12, GOLD, 'right', '800');
  // round + timer
  text('ROUND ' + round, CX, top - 4, 14, '#c9b48c', 'center', '800');
  const bw = Math.min(140, W * 0.32), frac = state === 'play' ? 1 - rt / ROUND_T : 0;
  ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.fillRect(CX - bw / 2, top + 10, bw, 4);
  ctx.fillStyle = GOLD; ctx.fillRect(CX - bw / 2, top + 10, bw * frac, 4);

  if (state === 'play' && banner > 0) {
    const a = Math.min(1, banner / 0.5);
    ctx.globalAlpha = a;
    text('ROUND ' + round, CX, CY - R - 34 > 70 ? CY - R - 30 : H * 0.2, 30, '#fff3da', 'center', '900');
    const g = ghosts.length;
    text(g ? (g === 1 ? '1 echo returns' : g + ' echoes return') : 'Survive 20 seconds. Remember how you move.', CX, (CY - R - 34 > 70 ? CY - R - 30 : H * 0.2) + 28, 14, g ? colorOf(round - 1) : '#c9b48c', 'center', '700');
    ctx.globalAlpha = 1;
  }

  if (state === 'upgrade') {
    ctx.fillStyle = 'rgba(6,7,10,.72)'; ctx.fillRect(0, 0, W, H);
    const rects = cardRects();
    text('Round ' + round + ' survived', CX, rects[0].y - 66, 26, '#fff3da', 'center', '900');
    text('Echo ' + roman(round) + ' will hunt you next round, with these powers', CX, rects[0].y - 38, 13, colorOf(round), 'center', '700');
    rects.forEach((r, i) => {
      const c = cards[i];
      ctx.fillStyle = '#161922'; ctx.strokeStyle = GOLD; ctx.lineWidth = 1.5;
      ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(r.x, r.y, r.w, r.h, 12); else ctx.rect(r.x, r.y, r.w, r.h);
      ctx.fill(); ctx.stroke();
      drawWick(r.x + 34, r.y + r.h / 2 + 6, 12, { flames: c.id === 'spread' ? Math.min(5, P.stats.spread + 1) : P.stats.spread, big: c.id === 'power' ? 1.3 : 1 });
      text(c.name, r.x + 66, r.y + r.h / 2 - 11, 17, '#fff3da', 'left', '800');
      text(c.desc, r.x + 66, r.y + r.h / 2 + 13, 13, '#c9b48c', 'left', '500');
    });
    text('Pick one. Your echo keeps what you had when it was made.', CX, rects[rects.length - 1].y + rects[0].h + 30, 12, '#8a8f9c', 'center', '500');
  }

  if (state === 'over') {
    ctx.fillStyle = 'rgba(6,7,10,.7)'; ctx.fillRect(0, 0, W, H);
    text('Your echoes got you', CX, H * 0.34, 28, '#fff3da', 'center', '900');
    text('Round ' + round + ' · ' + score + ' points', CX, H * 0.34 + 40, 18, GOLD, 'center', '800');
    text(newBest ? 'New best!' : 'Best ' + save.best, CX, H * 0.34 + 70, 15, newBest ? GOLD : '#8a8f9c', 'center', '700');
    const killed = ghosts.filter(g => !g.alive).length;
    if (ghosts.length) text('You beat ' + killed + ' of ' + ghosts.length + ' echoes this round', CX, H * 0.34 + 98, 13, '#c9b48c', 'center', '500');
    if (overT > 0.8) { ctx.globalAlpha = 0.6 + 0.4 * Math.sin(time * 4); text('Tap to try again', CX, H * 0.72, 20, GOLD, 'center', '800'); ctx.globalAlpha = 1; }
  }
}

// ---------- loop ----------
let last = 0, acc = 0, running = true;
function frame(now) {
  if (!last) last = now;
  let dt = (now - last) / 1000; last = now;
  if (dt > 0.1) dt = 0.1;
  if (running) {
    acc += dt;
    while (acc >= DT) { step(DT); acc -= DT; }
  }
  render();
  requestAnimationFrame(frame);
}
document.addEventListener('visibilitychange', () => { running = !document.hidden; last = 0; acc = 0; touch = null; });
window.addEventListener('resize', resize);

const muteBtn = document.getElementById('mute');
if (muteBtn) muteBtn.addEventListener('click', e => { e.stopPropagation && e.stopPropagation(); audioInit(); setMuted(!save.muted); });
setMuted(save.muted);

resize();
requestAnimationFrame(frame);

// test hook (used by the headless sim)
window.__echo = { get state() { return state; }, get round() { return round; }, get score() { return score; },
  get hp() { return P && P.hp; }, get ghosts() { return ghosts.length; }, choose, startRun };
})();
