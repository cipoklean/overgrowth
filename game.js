// Overgrowth — your failed runs become the tree you climb.
// One button: hold to bend right, release to bend left.
// Sap runs out or you hit a thorn: the branch hardens into wood.
// Touch old wood to graft onto it and refill sap. Old wood ages and goes brittle.

(() => {
  'use strict';

  // ---------- constants ----------
  const WORLD_W = 600;            // world width in units
  const ROOT_X = WORLD_W / 2;
  const GROW_SPEED = 95;          // units per second
  const TURN_RATE = 2.8;          // rad/s at full bend
  const MAX_LEAN = 1.2;           // rad from vertical
  const SAP_MAX = 100;
  const SAP_DRAIN = 9.5;          // per second
  const GRAFT_SAP = 60;
  const GRAFT_RADIUS = 11;
  const GRAFT_MIN_HEIGHT = 120;   // no grafting on the shared trunk near the root
  const BRITTLE_AGE = 4;          // runs before wood turns brittle
  const NODE_STEP = 6;            // units between stored branch points
  const CANOPY_STEP = 1200;       // height of each canopy line
  const STORAGE_KEY = 'overgrowth.tree.v1';
  const WIND_START = 650;         // first wind band height
  const BEETLE_FROM_RUN = 3;      // beetles show up once there's wood worth eating
  const BEETLE_SPEED = 4;         // branch points per second
  const BEETLE_SAP = 15;          // sap for squashing one
  const CANOPY_SAP = 30;          // sap bonus for crossing a canopy line
  const SUN_CANOPY = 4;           // reaching this canopy line wins

  // ---------- canvas ----------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, DPR = 1, scale = 1, offX = 0;

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    scale = Math.min(W / WORLD_W, H / 700);
    offX = (W - WORLD_W * scale) / 2;
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- seeded level (fixed: every player gets the same tree to grow) ----------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const thorns = [];
  (function buildLevel() {
    const rnd = mulberry32(20261016);
    let y = 380;
    while (y < CANOPY_STEP * 4) {
      const band = Math.floor(y / CANOPY_STEP);
      const count = 1 + (rnd() < 0.35 + band * 0.15 ? 1 : 0);
      for (let i = 0; i < count; i++) {
        let x = 40 + rnd() * (WORLD_W - 80);
        // keep the first stretch above the root open so run one always takes shape
        if (y < 700 && Math.abs(x - ROOT_X) < 70) x += x < ROOT_X ? -90 : 90;
        thorns.push({ x, y: y + rnd() * 60, r: 14 + rnd() * 12 + band * 3, spin: rnd() * 6 });
      }
      y += 150 + rnd() * 110 - band * 12;
    }
  })();

  // ---------- wind bands (also seeded) ----------
  // Each band blows one way. Gusts swell and fade on a loop; leaves streaming
  // across the band show how hard it's blowing right now.
  const winds = [];
  (function buildWind() {
    const rnd = mulberry32(777016);
    let y = WIND_START;
    while (y < CANOPY_STEP * 4) {
      const band = Math.floor(y / CANOPY_STEP);
      const h = 140 + rnd() * 120;
      winds.push({
        y0: y, y1: y + h,
        dir: rnd() < 0.5 ? -1 : 1,
        str: 30 + rnd() * 12 + band * 6,    // sideways drift in units/s at full gust
        torque: Math.min(2.3, 1.5 + band * 0.25), // bend at full gust; always below TURN_RATE so you can fight it
        period: 3.2 + rnd() * 1.8,
        phase: rnd() * 10,
      });
      y += h + 320 + rnd() * 260 - band * 30;
    }
  })();

  // ---------- dewdrops: small sap pickups scattered up the tree ----------
  const DEW_SAP = 25, DEW_RADIUS = 14;
  const dews = [];
  // reshuffled at the start of every run
  function buildDew() {
    dews.length = 0;
    const rnd = mulberry32((Math.random() * 1e9) | 0);
    let y = 260;
    while (y < CANOPY_STEP * 4) {
      let x = 50 + rnd() * (WORLD_W - 100);
      for (let tries = 0; tries < 8; tries++) {
        const hit = thorns.some(t => Math.hypot(t.x - x, t.y - y) < t.r + 25);
        if (!hit) break;
        x = 50 + rnd() * (WORLD_W - 100);
      }
      dews.push({ x, y, bob: rnd() * 6 });
      y += 150 + rnd() * 90;
    }
  }
  buildDew();
  let dewTaken = new Set();

  // ---------- frost patches (seeded, above the first canopy) ----------
  // Inside frost you grow slower and burn sap faster.
  const FROST_SLOW = 0.55, FROST_DRAIN = 2.6;
  const frosts = [];
  (function buildFrost() {
    const rnd = mulberry32(161026);
    let y = CANOPY_STEP + 200;
    while (y < CANOPY_STEP * 4) {
      const band = Math.floor(y / CANOPY_STEP);
      frosts.push({ x: 60 + rnd() * (WORLD_W - 120), y, r: 55 + rnd() * 35 + band * 8, seed: (rnd() * 1e9) | 0 });
      y += 260 + rnd() * 240 - band * 25;
    }
  })();
  function inFrost(x, y) {
    for (const f of frosts) {
      if (Math.abs(f.y - y) > f.r) continue;
      if (Math.hypot(f.x - x, f.y - y) < f.r) return true;
    }
    return false;
  }
  let frosted = false;

  let clock = 0;
  function gustOf(w) {
    // 0..1: calm most of the cycle, a strong swell in the middle
    const c = 0.5 - 0.5 * Math.cos(((clock + w.phase) / w.period) * Math.PI * 2);
    return 0.3 + 0.7 * c;
  }
  function windAt(y) {
    for (const w of winds) if (y >= w.y0 && y <= w.y1) return w;
    return null;
  }
  const windLeaves = [];

  // ---------- persistent tree ----------
  let wood = [];   // { pts: [[x,y],...], age, cracked, seed }
  let bestHeight = 0;
  let runCount = 0;
  let sunRun = 0;      // the run that first reached the sun (0 = not yet)
  let seen = {};       // first-time hints already shown

  // ---------- saving ----------
  // Inside Snapchat the tree lives in Snap's account-bound storage (localStorage is wiped when
  // the Lens closes). Everywhere else it lives in localStorage. Wood is packed as integer deltas
  // so a long climb fits Snap's 32 KiB-per-key, 100 KiB-total limits.
  const SNAP_BUDGET = 90 * 1024;   // leave headroom under Snap's 100 KiB store
  let loaded = false;

  function packPts(pts) {
    let px = 0, py = 0;
    const out = [];
    for (const p of pts) {
      const x = Math.round(p[0]), y = Math.round(p[1]);
      out.push((x - px).toString(36), (y - py).toString(36));
      px = x; py = y;
    }
    return out.join(',');
  }
  function unpackPts(str) {
    const a = str ? str.split(',') : [];
    const pts = [];
    let x = 0, y = 0;
    for (let i = 0; i + 1 < a.length; i += 2) {
      x += parseInt(a[i], 36); y += parseInt(a[i + 1], 36);
      pts.push([x, y]);
    }
    return pts;
  }
  function packWood(w) {
    const o = { p: packPts(w.pts), a: w.age, s: w.seed };
    if (w.cracked) o.c = 1;
    if (w.gone && w.gone.length) o.g = w.gone;
    return o;
  }
  function unpackWood(o) {
    if (o.pts) return o;  // old unpacked save
    return { pts: unpackPts(o.p), age: o.a || 0, cracked: !!o.c, seed: o.s || 0, gone: o.g };
  }
  function packState() {
    return { v: 2, wood: wood.map(packWood), bestHeight: Math.round(bestHeight), runCount, sunRun, seen };
  }
  function applyState(d) {
    if (!d) return;
    wood = (d.wood || []).map(unpackWood);
    bestHeight = d.bestHeight || 0;
    runCount = d.runCount || 0;
    sunRun = d.sunRun || 0;
    seen = d.seen || {};
  }

  const snap = window.snapchat;
  let useSnap = false;
  let snapWoodKeys = 0;     // how many wood_N keys are stored now
  let saving = Promise.resolve();

  // trim the oldest wood (cracked first) until the packed tree fits the budget
  function fitBudget(packed) {
    const size = () => JSON.stringify(packed).length;
    while (packed.wood.length > 1 && size() > SNAP_BUDGET) {
      let i = wood.findIndex(w => w.cracked);
      if (i < 0) i = 0;
      wood.splice(i, 1);
      packed.wood.splice(i, 1);
    }
    return packed;
  }

  // split wood across keys of at most ~28 KiB each
  function chunkWood(list) {
    const chunks = [];
    let cur = [], len = 0;
    for (const w of list) {
      const n = JSON.stringify(w).length + 1;
      if (cur.length && len + n > 28 * 1024) { chunks.push(cur); cur = []; len = 0; }
      cur.push(w); len += n;
    }
    if (cur.length) chunks.push(cur);
    return chunks;
  }

  async function snapSave() {
    const packed = fitBudget(packState());
    const chunks = chunkWood(packed.wood);
    const meta = { v: 2, bestHeight: packed.bestHeight, runCount, sunRun, seen, chunks: chunks.length };
    for (let i = 0; i < chunks.length; i++) await snap.storage.set('wood_' + i, chunks[i]);
    for (let i = chunks.length; i < snapWoodKeys; i++) await snap.storage.remove('wood_' + i);
    snapWoodKeys = chunks.length;
    await snap.storage.set('meta', meta);
  }

  function save() {
    if (!loaded) return;  // never overwrite a save that hasn't been read yet
    if (useSnap) {
      saving = saving.then(snapSave).catch(e => console.warn('Overgrowth save failed:', e && e.message));
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(packState()));
    } catch (e) { /* storage full or blocked; tree lives for this session */ }
  }

  async function load() {
    try {
      if (snap && !snap.isStub) {
        await snap.init();
        useSnap = snap.isSupported('storage');
      }
    } catch (e) { useSnap = false; }
    try {
      if (useSnap) {
        const m = await snap.storage.get('meta');
        if (m.found && m.value) {
          const d = m.value;
          d.wood = [];
          for (let i = 0; i < (d.chunks || 0); i++) {
            const c = await snap.storage.get('wood_' + i);
            if (c.found && Array.isArray(c.value)) d.wood.push(...c.value);
          }
          snapWoodKeys = d.chunks || 0;
          applyState(d);
        }
      } else {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) applyState(JSON.parse(raw));
      }
    } catch (e) { /* fresh tree */ }
    loaded = true;
  }
  load();
  // a Lens closes with a swipe and no teardown, so save when the page hides
  document.addEventListener('visibilitychange', () => { if (document.hidden && state !== 'growing') save(); });

  // ---------- input ----------
  let holding = false;
  function press(e) {
    if (e) e.preventDefault();
    audio.unlock();
    holding = true;
    if (!loaded) return;
    if (state === 'ready') startGrowing();
    else if (state === 'ended' && endTimer <= 0) { resetRun(); startGrowing(); }
  }
  function release(e) { if (e) e.preventDefault(); holding = false; }

  canvas.addEventListener('pointerdown', press);
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'Enter') press(e);
    if (e.code === 'KeyR' && e.shiftKey) clearTree();
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'Enter') release(e);
  });

  // two taps to cut the tree down (no confirm(): Snapchat's webview has no dialogs)
  const resetBtn = document.getElementById('reset');
  let resetArmed = 0;
  resetBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
  resetBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (resetArmed) {
      clearTimeout(resetArmed); resetArmed = 0;
      resetBtn.textContent = 'New tree';
      clearTree();
    } else {
      resetBtn.textContent = 'Tap again to cut it down';
      resetArmed = setTimeout(() => { resetArmed = 0; resetBtn.textContent = 'New tree'; }, 3000);
    }
  });

  function clearTree() {
    wood = []; bestHeight = 0; runCount = 0; sunRun = 0; save(); resetRun();
  }

  // ---------- audio (tiny synth, no assets) ----------
  const audio = (() => {
    let ac = null, windGain = null;
    function makeWind() {
      const len = ac.sampleRate * 2;
      const buf = ac.createBuffer(1, len, ac.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const src = ac.createBufferSource();
      src.buffer = buf; src.loop = true;
      const f = ac.createBiquadFilter();
      f.type = 'bandpass'; f.frequency.value = 500; f.Q.value = 0.7;
      windGain = ac.createGain(); windGain.gain.value = 0;
      src.connect(f); f.connect(windGain); windGain.connect(ac.destination);
      src.start();
    }
    return {
      unlock() {
        if (!ac) {
          try { ac = new (window.AudioContext || window.webkitAudioContext)(); makeWind(); } catch (e) { ac = null; }
        }
        if (ac && ac.state === 'suspended') ac.resume();
      },
      wind(level) {
        if (!windGain) return;
        windGain.gain.setTargetAtTime(level * 0.09, ac.currentTime, 0.15);
      },
      blip(freq, dur, type = 'sine', vol = 0.15, slide = 0) {
        if (!ac) return;
        const t = ac.currentTime;
        const o = ac.createOscillator();
        const g = ac.createGain();
        o.type = type;
        o.frequency.setValueAtTime(freq, t);
        if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g); g.connect(ac.destination);
        o.start(t); o.stop(t + dur);
      },
    };
  })();

  // ---------- run state ----------
  let state = 'ready';     // ready | growing | ended
  let tip, angle, angVel, sap, branch, grafted, endReason, endTimer, runHeight;
  let cam = 0, shake = 0, hitstop = 0, flash = 0, glow = 0;
  let canopyHit = 0;       // highest canopy line crossed this run
  let toast = null;        // { title, body, t } short message over the play area
  function showToast(title, body, t = 2.6) { toast = { title, body, t, max: t }; }
  function hintOnce(key, title, body) {
    if (seen[key]) return;
    seen[key] = 1; save();
    showToast(title, body, 3.2);
  }
  const particles = [];
  const popups = [];       // floating "+25 sap" text in the world
  function popup(x, y, text, c) { popups.push({ x, y, text, c, life: 1.1, max: 1.1 }); }
  let beetles = [];        // { wi, i, dir, start, wig }

  // a wood point is gone if a beetle chewed it, this run or an earlier one
  function isGone(w, wi, i) {
    if (w.gone) for (const g of w.gone) if (i >= g[0] && i <= g[1]) return true;
    for (const b of beetles) {
      if (b.wi !== wi) continue;
      const lo = Math.min(b.start, b.i), hi = Math.max(b.start, b.i);
      if (i >= lo && i <= hi) return true;
    }
    return false;
  }

  function spawnBeetles() {
    beetles = [];
    if (runCount < BEETLE_FROM_RUN) return;
    const want = Math.min(4, 1 + Math.floor((runCount - BEETLE_FROM_RUN) / 4));
    const pool = [];
    wood.forEach((w, wi) => { if (!w.cracked && w.age >= 1 && w.pts.length > 40) pool.push(wi); });
    for (let k = 0; k < want && pool.length; k++) {
      const wi = pool.splice((Math.random() * pool.length) | 0, 1)[0];
      const n = wood[wi].pts.length;
      // start somewhere above the shared trunk
      let i = 20 + ((Math.random() * (n - 30)) | 0);
      let tries = 0;
      while (isGone(wood[wi], wi, i) && tries++ < 10) i = 20 + ((Math.random() * (n - 30)) | 0);
      if (isGone(wood[wi], wi, i)) continue;
      beetles.push({ wi, i, start: i, dir: Math.random() < 0.5 ? -1 : 1, wig: Math.random() * 6 });
    }
  }

  function bankChew(b) {
    const w = wood[b.wi];
    if (!w) return;
    const lo = Math.round(Math.min(b.start, b.i)), hi = Math.round(Math.max(b.start, b.i));
    if (hi - lo >= 1) (w.gone = w.gone || []).push([lo, hi]);
  }

  function resetRun() {
    frosted = false;
    dewTaken = new Set();
    buildDew();
    tip = { x: ROOT_X, y: 0 };
    angle = 0; angVel = 0; sap = SAP_MAX;
    branch = [[tip.x, tip.y]];
    grafted = new Set();
    popups.length = 0;
    endReason = ''; endTimer = 0; runHeight = 0; canopyHit = 0; toast = null;
    state = 'ready';
  }
  resetRun();

  function startGrowing() {
    state = 'growing';
    spawnBeetles();
    audio.blip(330, 0.12, 'triangle', 0.12, 120);
  }

  function endRun(reason) {
    state = 'ended';
    for (const b of beetles) bankChew(b);
    beetles = [];
    endReason = reason;
    endTimer = 0.6;
    if (branch.length > 3) {
      for (const w of wood) w.age += 1;
      wood.push({ pts: branch.map(p => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]), age: 0, cracked: false, seed: (Math.random() * 1e9) | 0 });
    }
    runCount += 1;
    if (reason === 'sun' && !sunRun) sunRun = runCount;
    const newBest = runHeight > bestHeight;
    bestHeight = Math.max(bestHeight, runHeight);
    save();
    if (reason === 'sun') {
      glow = 1.6;
      shake = 8;
      burst(tip.x, tip.y, 60, ['#fff3a8', '#ffd25a', '#ffffff', '#b9f28a'], 260);
      [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => audio.blip(f, 0.25, 'triangle', 0.1, 0), i * 120));
      try { if (navigator.vibrate) navigator.vibrate([30, 40, 30, 40, 80]); } catch (e) { /* no haptics */ }
      endTimer = 1.4;
    } else if (reason === 'thorn') {
      shake = 18;
      hitstop = 0.09;
      flash = 1;
      burst(tip.x, tip.y, 34, ['#c98a4b', '#7a5230', '#e8c08a', '#7d3b6b'], 220);
      audio.blip(140, 0.3, 'sawtooth', 0.16, -90);
      audio.blip(70, 0.35, 'square', 0.1, -30);
      setTimeout(() => audio.blip(900, 0.08, 'square', 0.05, -500), 30);
      try { if (navigator.vibrate) navigator.vibrate([40, 30, 60]); } catch (e) { /* no haptics */ }
    } else {
      burst(tip.x, tip.y, 12, ['#9bd46a', '#6aa84f'], 60);
      audio.blip(220, 0.4, 'sine', 0.1, -120);
    }
    if (newBest && runHeight > 50) setTimeout(() => audio.blip(660, 0.18, 'triangle', 0.1, 220), 180);
  }

  function burst(x, y, n, colors, speed) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.3 + Math.random() * 0.7);
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.6 + Math.random() * 0.5, max: 1.1, c: colors[(Math.random() * colors.length) | 0], r: 1.5 + Math.random() * 2.5 });
    }
  }

  // ---------- update ----------
  function update(dt) {
    if (hitstop > 0) { hitstop -= dt; dt *= 0.08; }
    clock += dt;
    let windHere = 0;
    if (state === 'growing') {
      // steering: smooth angular velocity toward the target bend
      // wind bends the branch too: strong, but steering can always win slowly
      const wzBend = windAt(tip.y);
      const windBend = wzBend ? wzBend.dir * wzBend.torque * gustOf(wzBend) : 0;
      const target = (holding ? TURN_RATE : -TURN_RATE) + windBend;
      // frost is icy: steering responds sluggishly, so you skid along your current curve
      angVel += (target - angVel) * Math.min(1, dt * (frosted ? 1.6 : 10));
      angle = Math.max(-MAX_LEAN, Math.min(MAX_LEAN, angle + angVel * dt));

      const nowFrost = inFrost(tip.x, tip.y);
      if (nowFrost && !frosted) {
        hintOnce('frost', 'Frost', 'Slow, slippery, and it drinks sap. Get out fast.');
        audio.blip(1400, 0.12, 'sine', 0.06, 400);
        setTimeout(() => audio.blip(1900, 0.1, 'sine', 0.04, 300), 60);
      }
      frosted = nowFrost;
      const spd = GROW_SPEED * (frosted ? FROST_SLOW : 1);
      tip.x += Math.sin(angle) * spd * dt;
      tip.y += Math.cos(angle) * spd * dt;
      const wz = windAt(tip.y);
      if (wz) {
        const gst = gustOf(wz);
        tip.x += wz.dir * wz.str * gst * dt;
        windHere = gst;
        hintOnce('wind', 'Wind!', 'It pushes and bends you. Hold or let go against it.');
      }
      runHeight = Math.max(runHeight, tip.y);
      sap -= SAP_DRAIN * (frosted ? FROST_DRAIN : 1) * dt;
      if (frosted && Math.random() < dt * 20) particles.push({ x: tip.x + (Math.random() - 0.5) * 14, y: tip.y + (Math.random() - 0.5) * 14, vx: (Math.random() - 0.5) * 15, vy: 30, life: 0.6, max: 0.6, c: '#e8f6ff', r: 1.6 });

      const last = branch[branch.length - 1];
      if (Math.hypot(tip.x - last[0], tip.y - last[1]) >= NODE_STEP) branch.push([tip.x, tip.y]);

      // grafting onto old wood
      if (tip.y > GRAFT_MIN_HEIGHT) {
        for (let wi = 0; wi < wood.length; wi++) {
          const w = wood[wi];
          if (w.cracked || grafted.has(wi)) continue;
          const pts = w.pts;
          for (let i = 10; i < pts.length; i += 1) {
            if (isGone(w, wi, i)) continue;
            const dx = pts[i][0] - tip.x, dy = pts[i][1] - tip.y;
            if (dx * dx + dy * dy < GRAFT_RADIUS * GRAFT_RADIUS) {
              graft(wi, w);
              break;
            }
          }
        }
      }

      // beetles chew along their branch; touch one to squash it
      for (let bi = beetles.length - 1; bi >= 0; bi--) {
        const b = beetles[bi];
        const w = wood[b.wi];
        const n = w.pts.length;
        b.wig += dt * 14;
        let ni = b.i + b.dir * BEETLE_SPEED * dt;
        if (ni < 12 || ni > n - 2) {
          // hit an end: bank what was chewed and turn around from here
          bankChew(b);
          b.dir *= -1;
          ni = Math.max(12, Math.min(n - 2, ni));
          b.start = ni;
        } else if (w.gone && w.gone.some(g => ni >= g[0] && ni <= g[1] && !(b.i >= g[0] && b.i <= g[1]))) {
          bankChew(b); b.dir *= -1; ni = b.i; b.start = ni;
        }
        b.i = ni;
        const p = w.pts[Math.round(b.i)];
        if (Math.random() < dt * 6) particles.push({ x: p[0], y: p[1], vx: (Math.random() - 0.5) * 30, vy: 10, life: 0.4, max: 0.4, c: '#c9a26b', r: 1.2 });
        if (Math.hypot(p[0] - tip.x, p[1] - tip.y) < 12) {
          bankChew(b);
          beetles.splice(bi, 1);
          sap = Math.min(SAP_MAX, sap + BEETLE_SAP);
          popup(p[0], p[1], `+${BEETLE_SAP} sap`, '#6b5a12');
          burst(p[0], p[1], 14, ['#2a2f1c', '#4b6b2a', '#d9e86a'], 110);
          audio.blip(260, 0.08, 'square', 0.1, 400);
          setTimeout(() => audio.blip(520, 0.1, 'triangle', 0.08, 300), 70);
          shake = Math.max(shake, 3);
        }
      }

      // dewdrops
      for (let di = 0; di < dews.length; di++) {
        const d = dews[di];
        if (dewTaken.has(di) || Math.abs(d.y - tip.y) > DEW_RADIUS) continue;
        if (Math.hypot(d.x - tip.x, d.y - tip.y) < DEW_RADIUS) {
          dewTaken.add(di);
          sap = Math.min(SAP_MAX, sap + DEW_SAP);
          popup(d.x, d.y, `+${DEW_SAP} sap`, '#2f86c4');
          burst(d.x, d.y, 10, ['#cfeeff', '#8fd0f5', '#ffffff'], 80);
          audio.blip(880, 0.1, 'sine', 0.08, 300);
          hintOnce('dew', 'Dewdrop +25 sap', 'They move every run. Grab them on the way up.');
        }
      }

      // canopy lines: a bonus and a moment; the last one is the sun
      const reached = Math.floor(tip.y / CANOPY_STEP);
      if (reached > canopyHit && reached >= 1) {
        canopyHit = reached;
        if (canopyHit >= SUN_CANOPY) { endRun('sun'); }
        else {
          sap = Math.min(SAP_MAX, sap + CANOPY_SAP);
          popup(tip.x, tip.y, `+${CANOPY_SAP} sap`, '#3f8a1f');
          glow = 1;
          shake = Math.max(shake, 5);
          burst(tip.x, tip.y, 26, ['#d9f59a', '#9bd46a', '#fff6c2'], 160);
          [523, 659, 784].forEach((f, i) => setTimeout(() => audio.blip(f, 0.16, 'triangle', 0.09, 0), i * 90));
          showToast(`Canopy ${canopyHit}!`, `+${CANOPY_SAP} sap · ${SUN_CANOPY - canopyHit} more to the sun`);
        }
      }

      // collisions
      if (state !== 'growing') { /* reached the sun this frame */ }
      else if (tip.x < 6 || tip.x > WORLD_W - 6) endRun('wall');
      else {
        for (const t of thorns) {
          if (Math.abs(t.y - tip.y) > 60) continue;
          if (Math.hypot(t.x - tip.x, t.y - tip.y) < t.r) { endRun('thorn'); break; }
        }
      }
      if (state === 'growing' && sap <= 0) { sap = 0; endRun('sap'); }

      // bud sparkle trail
      if (Math.random() < dt * 10) particles.push({ x: tip.x, y: tip.y, vx: (Math.random() - 0.5) * 20, vy: -10, life: 0.5, max: 0.5, c: '#b9f28a', r: 1.5 });
    } else if (state === 'ended') {
      endTimer -= dt;
    }

    // camera follows the tip, never below the ground
    const viewH = H / scale;
    const focus = state === 'ready' ? 0 : tip.y;
    const targetCam = Math.max(0, focus - viewH * 0.45);
    cam += (targetCam - cam) * Math.min(1, dt * 4);

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy -= 120 * dt;
      p.vx *= 0.98;
    }
    for (let i = popups.length - 1; i >= 0; i--) {
      const q = popups[i];
      q.life -= dt; q.y += 40 * dt;
      if (q.life <= 0) popups.splice(i, 1);
    }
    shake = Math.max(0, shake - dt * 30);
    flash = Math.max(0, flash - dt * 4);
    glow = Math.max(0, glow - dt * 1.5);
    if (toast && (toast.t -= dt) <= 0) toast = null;
    audio.wind(windHere);

    // ambient leaves streaming through visible wind bands
    const viewTop = cam + viewH + 40, viewBot = cam - 40;
    for (const w of winds) {
      if (w.y1 < viewBot || w.y0 > viewTop) continue;
      const gst = gustOf(w);
      if (Math.random() < dt * (3 + gst * 22)) {
        windLeaves.push({
          x: w.dir > 0 ? -10 : WORLD_W + 10,
          y: w.y0 + Math.random() * (w.y1 - w.y0),
          w, wob: Math.random() * 6, rot: Math.random() * 6,
        });
      }
    }
    for (let i = windLeaves.length - 1; i >= 0; i--) {
      const L = windLeaves[i];
      const gst = gustOf(L.w);
      L.x += L.w.dir * (40 + gst * 260) * dt;
      L.wob += dt * 5;
      L.rot += dt * (2 + gst * 6) * L.w.dir;
      if (L.x < -20 || L.x > WORLD_W + 20 || windLeaves.length > 220) windLeaves.splice(i, 1);
    }
  }

  function graft(wi, w) {
    grafted.add(wi);
    sap = Math.min(SAP_MAX, sap + GRAFT_SAP);
    popup(tip.x, tip.y, `+${GRAFT_SAP} sap`, '#3f8a1f');
    burst(tip.x, tip.y, 16, ['#b9f28a', '#e9ffb0', '#6fcf5a'], 120);
    audio.blip(520, 0.15, 'triangle', 0.12, 260);
    if (w.age >= BRITTLE_AGE) {
      w.cracked = true;
      shake = 4;
      burst(tip.x, tip.y, 10, ['#3d2a1c', '#5b3f28'], 90);
      setTimeout(() => audio.blip(180, 0.12, 'square', 0.06, -60), 60);
    }
  }

  // ---------- draw ----------
  const sx = (x) => offX + x * scale;
  const sy = (y) => H * 0.86 - (y - cam) * scale;

  function woodColor(w) {
    if (w.cracked) return '#2b1e15';
    const t = Math.min(1, w.age / BRITTLE_AGE);
    const r = Math.round(128 - t * 66), g = Math.round(86 - t * 44), b = Math.round(52 - t * 24);
    return `rgb(${r},${g},${b})`;
  }

  function drawBranch(pts, color, baseWidth, dashed, gone) {
    if (pts.length < 2) return;
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (dashed) ctx.setLineDash([6 * scale, 5 * scale]);
    const n = pts.length;
    for (let i = 1; i < n; i++) {
      if (gone && (gone(i) || gone(i - 1))) continue;
      const k = 1 - i / (n + 20);
      ctx.lineWidth = Math.max(1.5, baseWidth * k) * scale;
      ctx.beginPath();
      ctx.moveTo(sx(pts[i - 1][0]), sy(pts[i - 1][1]));
      ctx.lineTo(sx(pts[i][0]), sy(pts[i][1]));
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  function drawLeaves(w) {
    const end = w.pts[w.pts.length - 1];
    const rnd = mulberry32(w.seed);
    const fade = w.cracked ? 0 : Math.max(0.25, 1 - w.age * 0.18);
    if (fade <= 0) return;
    for (let i = 0; i < 7; i++) {
      const a = rnd() * Math.PI * 2, d = rnd() * 14;
      ctx.fillStyle = `rgba(${90 + rnd() * 50 | 0},${160 + rnd() * 60 | 0},${70 + rnd() * 30 | 0},${fade})`;
      ctx.beginPath();
      ctx.ellipse(sx(end[0] + Math.cos(a) * d), sy(end[1] + Math.sin(a) * d), 6 * scale, 3.5 * scale, a, 0, Math.PI * 2);
      ctx.fill();
    }
    // a few leaves along the length too, so even one run reads as a branch
    for (let i = 20; i < w.pts.length - 5; i += 18) {
      const p = w.pts[i];
      const side = rnd() < 0.5 ? -1 : 1;
      ctx.fillStyle = `rgba(110,180,80,${fade * 0.8})`;
      ctx.beginPath();
      ctx.ellipse(sx(p[0] + side * 7), sy(p[1] + 3), 5 * scale, 2.6 * scale, side * 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawFrost(f) {
    const x = sx(f.x), y = sy(f.y), r = f.r * scale;
    if (y < -r * 1.5 || y > H + r * 1.5) return;
    const g = ctx.createRadialGradient(x, y, r * 0.2, x, y, r);
    g.addColorStop(0, 'rgba(225,245,255,0.55)');
    g.addColorStop(0.75, 'rgba(190,225,250,0.35)');
    g.addColorStop(1, 'rgba(190,225,250,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    // little snowflake crystals that twinkle
    const rnd = mulberry32(f.seed);
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 9; i++) {
      const a = rnd() * Math.PI * 2, d = rnd() * r * 0.8, s = (2.5 + rnd() * 3) * scale;
      const tw = 0.5 + 0.5 * Math.sin(clock * 3 + i * 1.7);
      ctx.globalAlpha = 0.3 + tw * 0.7;
      const cx = x + Math.cos(a) * d, cy = y + Math.sin(a) * d;
      for (let k = 0; k < 3; k++) {
        const b = k * Math.PI / 3;
        ctx.beginPath();
        ctx.moveTo(cx - Math.cos(b) * s, cy - Math.sin(b) * s);
        ctx.lineTo(cx + Math.cos(b) * s, cy + Math.sin(b) * s);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawThorn(t) {
    const x = sx(t.x), y = sy(t.y), r = t.r * scale;
    if (y < -r * 2 || y > H + r * 2) return;
    ctx.fillStyle = '#3a2340';
    ctx.beginPath();
    const spikes = 9;
    for (let i = 0; i <= spikes * 2; i++) {
      const a = t.spin + (i / (spikes * 2)) * Math.PI * 2;
      const rr = i % 2 === 0 ? r * 1.25 : r * 0.7;
      const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.fill();
    ctx.fillStyle = '#7d3b6b';
    ctx.beginPath(); ctx.arc(x, y, r * 0.45, 0, Math.PI * 2); ctx.fill();
  }

  function draw() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    // sky shifts from dawn to deep canopy green as you climb
    const h = Math.min(1, cam / (CANOPY_STEP * 3));
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, `hsl(${200 - h * 60}, ${45 + h * 10}%, ${78 - h * 35}%)`);
    g.addColorStop(1, `hsl(${40 - h * 10}, 55%, ${86 - h * 40}%)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    if (shake > 0) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);

    // play column edges
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(0, 0, offX, H);
    ctx.fillRect(offX + WORLD_W * scale, 0, W - offX - WORLD_W * scale, H);

    // the sun waits just above the last canopy line
    {
      const x = sx(WORLD_W / 2), y = sy(CANOPY_STEP * SUN_CANOPY + 260), r = 90 * scale;
      if (y > -r * 3 && y < H + r * 3) {
        const sg = ctx.createRadialGradient(x, y, r * 0.2, x, y, r * 3);
        sg.addColorStop(0, 'rgba(255,246,190,0.95)');
        sg.addColorStop(0.35, 'rgba(255,220,120,0.45)');
        sg.addColorStop(1, 'rgba(255,220,120,0)');
        ctx.fillStyle = sg;
        ctx.beginPath(); ctx.arc(x, y, r * 3, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff3b0';
        ctx.beginPath(); ctx.arc(x, y, r * 0.55, 0, Math.PI * 2); ctx.fill();
      }
    }

    // canopy lines
    ctx.font = `${Math.max(11, 13 * scale)}px system-ui, sans-serif`;
    for (let i = 1; i <= 4; i++) {
      const y = sy(CANOPY_STEP * i);
      if (y < -20 || y > H + 20) continue;
      ctx.strokeStyle = 'rgba(40,90,40,0.55)';
      ctx.setLineDash([10, 8]);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(sx(0), y); ctx.lineTo(sx(WORLD_W), y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(30,70,30,0.85)';
      ctx.fillText(i === SUN_CANOPY ? 'Sunlight' : `Canopy ${i}`, sx(8), y - 6);
    }

    // wind bands: faint tint plus chevrons that brighten with the gust
    for (const w of winds) {
      const top = sy(w.y1), bot = sy(w.y0);
      if (bot < -10 || top > H + 10) continue;
      const gst = gustOf(w);
      ctx.fillStyle = `rgba(220,240,255,${0.08 + gst * 0.14})`;
      ctx.fillRect(sx(0), top, WORLD_W * scale, bot - top);
      ctx.strokeStyle = `rgba(255,255,255,${0.25 + gst * 0.55})`;
      ctx.lineWidth = 2;
      const mid = (top + bot) / 2, cs = 7 * scale;
      const drift = ((clock * (30 + gst * 120)) % 60) * w.dir;
      for (let k = -1; k < 11; k++) {
        const cx = sx(k * 60 + drift);
        if (cx < sx(0) - 10 || cx > sx(WORLD_W) + 10) continue;
        ctx.beginPath();
        ctx.moveTo(cx - cs * w.dir, mid - cs);
        ctx.lineTo(cx, mid);
        ctx.lineTo(cx - cs * w.dir, mid + cs);
        ctx.stroke();
      }
    }
    for (const L of windLeaves) {
      const y = L.y + Math.sin(L.wob) * 6;
      ctx.fillStyle = 'rgba(120,175,70,0.85)';
      ctx.beginPath();
      ctx.ellipse(sx(L.x), sy(y), 4.5 * scale, 2.2 * scale, L.rot, 0, Math.PI * 2);
      ctx.fill();
    }

    // ground
    const gy = sy(0);
    if (gy < H + 10) {
      ctx.fillStyle = '#5a4030';
      ctx.fillRect(0, gy, W, H - gy + 10);
      ctx.fillStyle = '#6f8f3a';
      ctx.fillRect(0, gy - 4 * scale, W, 6 * scale);
    }

    for (const f of frosts) drawFrost(f);
    for (const t of thorns) drawThorn(t);

    // old wood, oldest first so fresh wood sits on top
    const order = wood.map((w, i) => i).sort((a, b) => wood[b].age - wood[a].age);
    for (const i of order) {
      const w = wood[i];
      drawBranch(w.pts, woodColor(w), 11, w.cracked, (k) => isGone(w, i, k));
      drawLeaves(w);
      if (!w.cracked && w.age >= BRITTLE_AGE) {
        // hairline cracks mark brittle wood
        ctx.strokeStyle = 'rgba(230,210,180,0.35)';
        ctx.lineWidth = 1;
        for (let k = 14; k < w.pts.length; k += 22) {
          const p = w.pts[k];
          ctx.beginPath(); ctx.moveTo(sx(p[0] - 3), sy(p[1] + 3)); ctx.lineTo(sx(p[0] + 3), sy(p[1] - 3)); ctx.stroke();
        }
      }
    }

    // beetles
    for (const b of beetles) {
      const w = wood[b.wi];
      const p = w.pts[Math.round(b.i)];
      const q = w.pts[Math.max(0, Math.min(w.pts.length - 1, Math.round(b.i) + b.dir * 2))];
      const x = sx(p[0]), y = sy(p[1]);
      if (y < -20 || y > H + 20) continue;
      const a = Math.atan2(sy(q[1]) - y, sx(q[0]) - x);
      ctx.save();
      ctx.translate(x, y); ctx.rotate(a);
      ctx.strokeStyle = '#1b1d12'; ctx.lineWidth = 1.2 * scale;
      for (let l = -1; l <= 1; l++) {
        const sw = Math.sin(b.wig + l * 2) * 2 * scale;
        ctx.beginPath();
        ctx.moveTo(l * 3 * scale, 0); ctx.lineTo(l * 3 * scale + sw, -6 * scale);
        ctx.moveTo(l * 3 * scale, 0); ctx.lineTo(l * 3 * scale - sw, 6 * scale);
        ctx.stroke();
      }
      ctx.fillStyle = '#2f3a1a';
      ctx.beginPath(); ctx.ellipse(0, 0, 6.5 * scale, 4.2 * scale, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#1b1d12';
      ctx.beginPath(); ctx.arc(6 * scale, 0, 2.6 * scale, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(220,240,140,0.6)';
      ctx.beginPath(); ctx.ellipse(-1 * scale, -1.5 * scale, 2.5 * scale, 1 * scale, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    // dewdrops sit on top of the wood so the tree never hides them
    for (let di = 0; di < dews.length; di++) {
      if (dewTaken.has(di)) continue;
      const d = dews[di];
      const x = sx(d.x), y = sy(d.y + Math.sin(clock * 2.5 + d.bob) * 3), r = 6 * scale;
      if (y < -20 || y > H + 20) continue;
      ctx.fillStyle = 'rgba(200,235,255,0.35)';
      ctx.beginPath(); ctx.arc(x, y - r * 0.3, r * 2.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(140,205,245,0.95)';
      ctx.beginPath();
      ctx.moveTo(x, y - r * 1.8);
      ctx.quadraticCurveTo(x + r * 1.1, y - r * 0.2, x, y + r);
      ctx.quadraticCurveTo(x - r * 1.1, y - r * 0.2, x, y - r * 1.8);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath(); ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.28, 0, Math.PI * 2); ctx.fill();
    }

    // the living branch
    if (state !== 'ready' || branch.length > 1) {
      drawBranch(branch.concat([[tip.x, tip.y]]), '#a8743f', 11, false);
    }
    if (state !== 'ended') {
      const pulse = 1 + Math.sin(performance.now() / 160) * 0.15;
      ctx.fillStyle = '#8fe05a';
      ctx.beginPath(); ctx.arc(sx(tip.x), sy(tip.y), 5.5 * scale * pulse, 0, Math.PI * 2); ctx.fill();
    }

    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.c;
      ctx.beginPath(); ctx.arc(sx(p.x), sy(p.y), p.r * scale, 0, Math.PI * 2); ctx.fill();
    }
    ctx.textAlign = 'center';
    ctx.font = `700 ${Math.max(13, 16 * scale)}px system-ui, sans-serif`;
    for (const q of popups) {
      ctx.globalAlpha = Math.min(1, q.life / 0.4);
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255,252,240,0.9)';
      ctx.strokeText(q.text, sx(q.x), sy(q.y) - 14);
      ctx.fillStyle = q.c;
      ctx.fillText(q.text, sx(q.x), sy(q.y) - 14);
    }
    ctx.textAlign = 'left';
    ctx.globalAlpha = 1;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (glow > 0) {
      ctx.fillStyle = `rgba(255,244,190,${Math.min(1, glow) * 0.35})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (flash > 0) {
      ctx.fillStyle = `rgba(150,30,60,${flash * 0.28})`;
      ctx.fillRect(0, 0, W, H);
    }

    drawHud();
  }

  function drawHud() {
    const pad = 14;
    ctx.fillStyle = 'rgba(20,30,20,0.8)';
    ctx.font = '600 15px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`Height ${Math.floor(state === 'ready' ? 0 : runHeight)}`, pad, 26);
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillText(`Best ${Math.floor(bestHeight)} · Run ${runCount + (state === 'ended' ? 0 : 1)} · Wood ${wood.length}`, pad, 46);

    // sap bar
    const bw = Math.min(220, W - pad * 2 - 60), bx = W - bw - pad, by = 16;
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(bx, by, bw, 12);
    ctx.fillStyle = state === 'growing' && frosted ? '#9fd6f5' : sap < 25 ? '#e0a03a' : '#7cc94a';
    ctx.fillRect(bx, by, bw * (sap / SAP_MAX), 12);
    ctx.fillStyle = 'rgba(20,30,20,0.8)';
    ctx.textAlign = 'right';
    ctx.fillText('sap', bx - 6, by + 11);
    ctx.textAlign = 'center';

    if (toast && state === 'growing') {
      const a = Math.min(1, toast.t / 0.4, (toast.max - toast.t) / 0.2 + 0.2);
      ctx.globalAlpha = a;
      const tw = Math.min(W - 40, 360), ty = H * 0.17;
      ctx.fillStyle = 'rgba(255,252,240,0.85)';
      roundRect((W - tw) / 2, ty - 24, tw, 54, 12);
      ctx.fill();
      ctx.fillStyle = '#2e3b22';
      ctx.font = '700 17px system-ui, sans-serif';
      ctx.fillText(toast.title, W / 2, ty - 2);
      ctx.font = '13px system-ui, sans-serif';
      ctx.fillText(toast.body, W / 2, ty + 18, tw - 20);
      ctx.globalAlpha = 1;
    }

    if (state === 'ready') {
      banner(runCount === 0 ? 'Overgrowth' : 'Grow again',
        runCount === 0
          ? 'Hold to bend right · let go to bend left\nGraft onto old wood or grab dewdrops for sap'
          : runCount === BEETLE_FROM_RUN
            ? 'Beetles are eating your wood. Touch one to squash it.'
            : 'Your last branch is wood now. Graft onto it to climb higher.',
        loaded ? 'Tap or press Space to grow' : 'Loading your tree…');
    } else if (state === 'ended' && endReason === 'sun') {
      const first = sunRun === runCount;
      banner('You reached the sun!',
        first
          ? `It took ${runCount} run${runCount === 1 ? '' : 's'} and ${wood.length} branches of wood.\nTap "New tree" to try it in fewer.`
          : `Your tree reached the sun again (first on run ${sunRun}).\nTap "New tree" to beat it in fewer runs.`,
        endTimer <= 0 ? 'Tap to keep growing' : '');
    } else if (state === 'ended') {
      const why = endReason === 'thorn' ? 'Thorns got you.' : endReason === 'wall' ? 'You grew out of the light.' : 'Out of sap.';
      banner(why, `This branch reached ${Math.floor(runHeight)}. It stays as wood for your next run.`, endTimer <= 0 ? 'Tap to grow again' : '');
    }
    ctx.textAlign = 'left';
  }

  function banner(title, body, cta) {
    const cy = H * 0.36;
    ctx.fillStyle = 'rgba(255,252,240,0.82)';
    const bw = Math.min(W - 40, 420), bh = 130;
    roundRect((W - bw) / 2, cy - 48, bw, bh, 14);
    ctx.fill();
    ctx.fillStyle = '#2e3b22';
    ctx.font = '700 24px system-ui, sans-serif';
    ctx.fillText(title, W / 2, cy - 14);
    ctx.font = '14px system-ui, sans-serif';
    body.split('\n').forEach((line, i) => ctx.fillText(line, W / 2, cy + 12 + i * 19, bw - 24));
    if (cta) {
      ctx.font = '600 14px system-ui, sans-serif';
      ctx.fillStyle = '#5a8a2e';
      ctx.fillText(cta, W / 2, cy + 68);
    }
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ---------- loop ----------
  let lastT = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - lastT) / 1000);
    lastT = now;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
