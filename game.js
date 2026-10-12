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
  const SAP_DRAIN = 14;           // per second
  const GRAFT_SAP = 60;
  const GRAFT_RADIUS = 11;
  const GRAFT_MIN_HEIGHT = 120;   // no grafting on the shared trunk near the root
  const BRITTLE_AGE = 4;          // runs before wood turns brittle
  const NODE_STEP = 6;            // units between stored branch points
  const CANOPY_STEP = 1200;       // height of each canopy line
  const STORAGE_KEY = 'overgrowth.tree.v1';

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

  // ---------- persistent tree ----------
  let wood = [];   // { pts: [[x,y],...], age, cracked, seed }
  let bestHeight = 0;
  let runCount = 0;

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      wood = d.wood || [];
      bestHeight = d.bestHeight || 0;
      runCount = d.runCount || 0;
    } catch (e) { /* fresh tree */ }
  }
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ wood, bestHeight, runCount }));
    } catch (e) { /* storage full or blocked; tree lives for this session */ }
  }
  load();

  // ---------- input ----------
  let holding = false;
  function press(e) {
    if (e) e.preventDefault();
    audio.unlock();
    holding = true;
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

  document.getElementById('reset').addEventListener('click', (e) => {
    e.stopPropagation();
    if (confirm('Cut down your whole tree and start from a seed?')) clearTree();
  });

  function clearTree() {
    wood = []; bestHeight = 0; runCount = 0; save(); resetRun();
  }

  // ---------- audio (tiny synth, no assets) ----------
  const audio = (() => {
    let ac = null;
    return {
      unlock() {
        if (!ac) {
          try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ac = null; }
        }
        if (ac && ac.state === 'suspended') ac.resume();
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
  let cam = 0, shake = 0;
  const particles = [];

  function resetRun() {
    tip = { x: ROOT_X, y: 0 };
    angle = 0; angVel = 0; sap = SAP_MAX;
    branch = [[tip.x, tip.y]];
    grafted = new Set();
    endReason = ''; endTimer = 0; runHeight = 0;
    state = 'ready';
  }
  resetRun();

  function startGrowing() {
    state = 'growing';
    audio.blip(330, 0.12, 'triangle', 0.12, 120);
  }

  function endRun(reason) {
    state = 'ended';
    endReason = reason;
    endTimer = 0.6;
    if (branch.length > 3) {
      for (const w of wood) w.age += 1;
      wood.push({ pts: branch.map(p => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]), age: 0, cracked: false, seed: (Math.random() * 1e9) | 0 });
    }
    runCount += 1;
    const newBest = runHeight > bestHeight;
    bestHeight = Math.max(bestHeight, runHeight);
    save();
    if (reason === 'thorn') {
      shake = 10;
      burst(tip.x, tip.y, 22, ['#c98a4b', '#7a5230', '#e8c08a'], 180);
      audio.blip(140, 0.25, 'sawtooth', 0.14, -80);
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
    if (state === 'growing') {
      // steering: smooth angular velocity toward the target bend
      const target = holding ? TURN_RATE : -TURN_RATE;
      angVel += (target - angVel) * Math.min(1, dt * 10);
      angle = Math.max(-MAX_LEAN, Math.min(MAX_LEAN, angle + angVel * dt));

      tip.x += Math.sin(angle) * GROW_SPEED * dt;
      tip.y += Math.cos(angle) * GROW_SPEED * dt;
      runHeight = Math.max(runHeight, tip.y);
      sap -= SAP_DRAIN * dt;

      const last = branch[branch.length - 1];
      if (Math.hypot(tip.x - last[0], tip.y - last[1]) >= NODE_STEP) branch.push([tip.x, tip.y]);

      // grafting onto old wood
      if (tip.y > GRAFT_MIN_HEIGHT) {
        for (let wi = 0; wi < wood.length; wi++) {
          const w = wood[wi];
          if (w.cracked || grafted.has(wi)) continue;
          const pts = w.pts;
          for (let i = 10; i < pts.length; i += 1) {
            const dx = pts[i][0] - tip.x, dy = pts[i][1] - tip.y;
            if (dx * dx + dy * dy < GRAFT_RADIUS * GRAFT_RADIUS) {
              graft(wi, w);
              break;
            }
          }
        }
      }

      // collisions
      if (tip.x < 6 || tip.x > WORLD_W - 6) endRun('wall');
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
    shake = Math.max(0, shake - dt * 30);
  }

  function graft(wi, w) {
    grafted.add(wi);
    sap = Math.min(SAP_MAX, sap + GRAFT_SAP);
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

  function drawBranch(pts, color, baseWidth, dashed) {
    if (pts.length < 2) return;
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (dashed) ctx.setLineDash([6 * scale, 5 * scale]);
    const n = pts.length;
    for (let i = 1; i < n; i++) {
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
      ctx.fillText(`Canopy ${i}`, sx(8), y - 6);
    }

    // ground
    const gy = sy(0);
    if (gy < H + 10) {
      ctx.fillStyle = '#5a4030';
      ctx.fillRect(0, gy, W, H - gy + 10);
      ctx.fillStyle = '#6f8f3a';
      ctx.fillRect(0, gy - 4 * scale, W, 6 * scale);
    }

    for (const t of thorns) drawThorn(t);

    // old wood, oldest first so fresh wood sits on top
    const order = wood.map((w, i) => i).sort((a, b) => wood[b].age - wood[a].age);
    for (const i of order) {
      const w = wood[i];
      drawBranch(w.pts, woodColor(w), 11, w.cracked);
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
    ctx.globalAlpha = 1;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

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
    ctx.fillStyle = sap < 25 ? '#e0a03a' : '#7cc94a';
    ctx.fillRect(bx, by, bw * (sap / SAP_MAX), 12);
    ctx.fillStyle = 'rgba(20,30,20,0.8)';
    ctx.textAlign = 'right';
    ctx.fillText('sap', bx - 6, by + 11);
    ctx.textAlign = 'center';

    if (state === 'ready') {
      banner(runCount === 0 ? 'Overgrowth' : 'Grow again',
        runCount === 0
          ? 'Hold to bend right · let go to bend left\nTouch old wood to graft and refill sap'
          : 'Your last branch is wood now. Graft onto it to climb higher.',
        'Tap or press Space to grow');
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
