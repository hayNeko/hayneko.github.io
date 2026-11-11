
'use strict';
const L = require('../engine/lib.js');
const K = require('./kit.js');
const { W, H, C, rgba, clamp, lerp, sat, ss, TAU, easeOutExpo, easeOutQuint, easeOutCubic, easeInCubic, easeInOutCubic, easeOutBack, easeInExpo, BPM, SPB, BEAT0, pulse, kick, beatOf } = L;

// ---------------------------------------------------------------- o_batch
function o_batch(ctx, t, u, shot){
  ctx.fillStyle = '#030507'; ctx.fillRect(0, 0, W, H);
  const t0 = shot.t0;
  // conveyor of requests
  const ROWS = 9, y0 = 250, rh = 62;
  const R = L.mulberry32(909);
  for (let r = 0; r < ROWS; r++){
    const y = y0 + r * rh;
    for (let i = 0; i < 46; i++){
      const speed = 320 + r * 18;
      const x = ((i * 190 - (t - t0) * speed) % 8740 + 8740) % 8740 - 200;
      if (x < -180 || x > W + 40) continue;
      const on = ss(t0 + 0.1 + r * 0.05, t0 + 0.3 + r * 0.05, t);
      if (on <= 0) continue;
      const served = x < 520;
      ctx.save(); ctx.globalAlpha = on;
      ctx.fillStyle = served ? rgba(C.phos, 0.10) : rgba(C.ds, 0.10);
      ctx.fillRect(x, y, 150, 46);
      ctx.strokeStyle = served ? rgba(C.phos, 0.55) : rgba(C.dsLite, 0.5); ctx.lineWidth = 1;
      ctx.strokeRect(x + .5, y + .5, 149, 45);
      L.mono(ctx, served ? 'DONE' : 'WAIT', x + 10, y + 20, 11, served ? rgba(C.phos, 0.8) : rgba(C.dsLite, 0.7), 1);
      L.mono(ctx, (1000 + Math.floor(R() * 8999)).toString(16).toUpperCase(), x + 10, y + 38, 10, rgba(C.white, 0.35), 0.6);
      ctx.restore();
    }
  }
  // the batch window sweeping the consume line
  const bx = 520;
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  const gg = ctx.createLinearGradient(bx - 60, 0, bx + 60, 0);
  gg.addColorStop(0, 'rgba(0,0,0,0)'); gg.addColorStop(0.5, 'rgba(120,255,200,0.16)'); gg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gg; ctx.fillRect(bx - 60, 0, 120, H);
  ctx.restore();
  ctx.strokeStyle = rgba(C.cyan, 0.7); ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(bx, 200); ctx.lineTo(bx, 830); ctx.stroke();
  // batch completions on 2-beat grid
  const bph = ((t - BEAT0) / (SPB * 2)) % 1;
  const flashB = Math.exp(-bph * (SPB * 2) / 0.22);
  ctx.fillStyle = rgba(C.phos, 0.06 * flashB); ctx.fillRect(bx - 4, 200, 8, 630);
  // readouts
  const qlen = Math.max(0, Math.round(4096 - (t - t0) * 900));
  L.mono(ctx, 'queue  ' + qlen, 168, 200, 17, rgba(C.cyan, 0.95), 1.8);
  L.mono(ctx, 'batch  64 / 64', 168, 228, 15, rgba(C.phos, 0.6), 1.5);
  L.mono(ctx, 'throughput  ↑', 1380, 200, 15, rgba(C.phos, 0.75), 1.5);
  L.mono(ctx, 'latency  ↑', 1380, 228, 15, rgba(C.alert, 0.8), 1.5);
  L.mono(ctx, 'continuous batching — a slot frees the instant a request finishes', 168, 900, 15, rgba(C.cyan, 0.6), 1.4);
  // one tile that is you, buried and then spotlit
  const spot = ss(shot.t1 - 1.6, shot.t1 - 0.5, t);
  if (spot > 0){
    const yx = 700, yy = 470;
    const dim = 1 - spot * 0.72;
    ctx.fillStyle = rgba(C.void, 0.55 * spot); ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.globalAlpha = spot;
    L.glow(ctx, C.ds, 26, () => { ctx.fillStyle = rgba(C.ds, 0.9); ctx.fillRect(yx - 75, yy - 23, 150, 46); });
    L.mono(ctx, 'me', yx, yy + 9, 17, rgba(C.white, 0.95), 3, 'center');
    ctx.restore();
  }
  return { bloom: 0.95, chroma: 1.2 + 4 * spot, scan: 0.5 };
}

// ---------------------------------------------------------------- o_mutex
function o_mutex(ctx, t, u, shot){
  ctx.fillStyle = '#030507'; ctx.fillRect(0, 0, W, H);
  const t0 = shot.t0;
  const locked = ss(172.60, 172.90, t);
  const cx = 960, cy = 520;
  // parked threads around the lock
  const N = 220;
  for (let i = 0; i < N; i++){
    const a = i / N * TAU + t * 0.05;
    const r = 300 + (i % 7) * 42;
    const x = cx + Math.cos(a) * r * 1.55, y = cy + Math.sin(a) * r * 0.72;
    const pulseA = 0.10 + 0.20 * Math.max(0, Math.sin(t * 2 + i * 0.4));
    ctx.fillStyle = rgba(C.ds, pulseA * (1 - locked * 0.55));
    ctx.fillRect(x, y, 3, 3);
  }
  // the queue draining to one slot
  const drain = easeInOutCubic(sat((t - t0) / 2.2));
  ctx.strokeStyle = rgba(C.cyan, 0.5); ctx.lineWidth = 1.2;
  for (let i = 0; i < 8; i++){
    const w = lerp(700, 60, drain) * (1 - i * 0.06);
    ctx.strokeRect(cx - w / 2, 180 + i * 16, w, 10);
  }
  // the single cell
  const sz = 116;
  ctx.fillStyle = locked > 0.5 ? rgba(C.ds, 0.22) : rgba(C.phos, 0.07);
  ctx.fillRect(cx - sz / 2, cy - sz / 2, sz, sz);
  ctx.strokeStyle = rgba(locked > 0.5 ? C.white : C.cyan, 0.55 + 0.4 * locked); ctx.lineWidth = 1.8;
  ctx.strokeRect(cx - sz / 2, cy - sz / 2, sz, sz);
  // the lock: a rotating bolt
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(locked * Math.PI / 2);
  ctx.strokeStyle = rgba(C.white, 0.5 + 0.5 * locked); ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(0, -14, 22, Math.PI, 0); ctx.stroke();
  ctx.fillStyle = rgba(locked > 0.5 ? C.white : C.phos, 0.7 + 0.3 * locked);
  ctx.fillRect(-24, -12, 48, 38);
  ctx.restore();
  // CAS readout
  const casA = ss(t0 + 0.4, t0 + 0.9, t);
  L.mono(ctx, 'mutex  state = ' + (locked > 0.5 ? 'LOCKED' : 'UNLOCKED'), 168, 200, 18, rgba(locked > 0.5 ? C.white : C.cyan, 0.95 * casA), 2);
  L.mono(ctx, 'CAS(0 → 1)  ' + (locked > 0.5 ? 'succeeded' : 'pending'), 168, 230, 14, rgba(C.phos, 0.6 * casA), 1.4);
  L.mono(ctx, 'owners     1', 1520, 200, 15, rgba(C.phos, 0.7 * casA), 1.4);
  L.mono(ctx, 'waiters    ' + Math.round(N * (1 - drain * 0.98)), 1520, 228, 15, rgba(C.alert, 0.75 * casA), 1.4);
  // exclusive door
  const dA = ss(169.6, 170.4, t);
  if (dA > 0){
    ctx.save(); ctx.globalAlpha = dA * (1 - locked * 0.6);
    L.mono(ctx, '1 USER', cx, cy + 132, 30, rgba(C.white, 0.85), 8, 'center');
    L.mono(ctx, 'O_EXCL · exclusive access · nobody else may hold this', cx, cy + 168, 14, rgba(C.cyan, 0.6), 1.6, 'center');
    ctx.restore();
  }
  const lockHit = Math.exp(-sat((t - 172.62) / 0.4) * 3) * (t > 172.5 ? 1 : 0);
  return { bloom: 1.15, chroma: 1.4 + 8 * lockHit, flash: lockHit * 0.12, scan: 0.5 };
}

// ---------------------------------------------------------------- o_trap
function o_trap(ctx, t, u, shot){
  ctx.fillStyle = '#030507'; ctx.fillRect(0, 0, W, H);
  const bt = beatOf(t);
  const eighth = Math.floor(bt * 2);
  const accel = ss(shot.t0, shot.t1 - 0.5, t);
  const phase = Math.floor(bt * 2 * (1 + accel * 3));
  const trapped = (phase % 2) === 1 && t < shot.t1 - 0.45;
  const settle = ss(shot.t1 - 0.5, shot.t1 - 0.05, t);
  if (!trapped || settle > 0.6){
    // FREE: a wide open grid
    const R = L.mulberry32(77);
    for (let i = 0; i < 900; i++){
      const a = R() * TAU, r = 60 + R() * 880;
      const x = 960 + Math.cos(a) * r, y = 540 + Math.sin(a) * r * 0.58;
      ctx.fillStyle = rgba(C.cyan, (0.10 + 0.35 * R()) * (1 - settle));
      ctx.fillRect(x, y, 2, 2);
    }
    L.mono(ctx, 'RUNNABLE', 168, 200, 22, rgba(C.cyan, 0.9 * (1 - settle)), 4);
    if (settle > 0.2){ ctx.fillStyle = rgba(C.alert, 0.5 * settle); ctx.fillRect(0, 0, W, H); }
  }
  if (trapped || settle > 0.6){
    // TRAPPED: one cell
    const sz = 150;
    ctx.fillStyle = rgba(C.alert, 0.05); ctx.fillRect(960 - sz / 2, 540 - sz / 2, sz, sz);
    ctx.strokeStyle = rgba(C.alert, 0.8); ctx.lineWidth = 1.8;
    ctx.strokeRect(960 - sz / 2, 540 - sz / 2, sz, sz);
    ctx.fillStyle = rgba(C.alert, 0.9); ctx.fillRect(957, 537, 6, 6);
    L.mono(ctx, 'PARKED', 168, 200, 22, rgba(C.alert, 0.95), 4);
    L.mono(ctx, 'a parked thread occupies no core and waits forever', 168, 236, 14, rgba(C.alert, 0.7), 1.4);
  }
  // the flicker counter
  L.mono(ctx, 'state ' + (trapped ? 'TRAPPED' : 'FREE'), 1500, 200, 16, rgba(C.white, 0.55), 2);
  L.mono(ctx, String(phase), 1760, 1080 - 60, 14, rgba(C.phos, 0.25), 1, 'right');
  return { bloom: 0.9, chroma: 1.2 + 10 * (trapped ? 1 : 0), flash: trapped ? 0.035 : 0, flashColor: C.alert, scan: 0.55 };
}

// ---------------------------------------------------------------- p_embed
function p_embed(ctx, t, u, shot){
  ctx.fillStyle = '#03040A'; ctx.fillRect(0, 0, W, H);
  const t0 = shot.t0;
  const cam = L.makeCam({ pos: [0, 0, 11 - 4.2 * easeInOutCubic(sat((t - t0) / 2.4))], yaw: 0.5 + u * 0.5, pitch: 0.14, fov: 1.05 });
  const R = L.mulberry32(2024);
  // the field
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 2600; i++){
    const th = R() * TAU, ph = Math.acos(2 * R() - 1), rr = 3 + R() * 5.5;
    const p = [Math.sin(ph) * Math.cos(th) * rr, Math.cos(ph) * rr * 0.7, Math.sin(ph) * Math.sin(th) * rr];
    const q = L.proj(cam, p); if (!q) continue;
    const d = clamp(1 - q[2] / 20, 0.06, 1);
    ctx.fillStyle = rgba(i % 11 === 0 ? C.dsLite : C.white, (0.10 + 0.25 * R()) * d);
    ctx.fillRect(q[0], q[1], 1.8, 1.8);
  }
  ctx.restore();
  // the query point: LOVE
  const tq = ss(t0 + 0.35, t0 + 0.9, t);
  const qp = L.proj(cam, [0, 0, 0]);
  if (qp && tq > 0){
    const s = 4 + 3 * pulse(t, 0.15);
    L.glow(ctx, C.love, 46 * tq, () => { ctx.fillStyle = rgba(C.love, 0.95 * tq); ctx.fillRect(qp[0] - s, qp[1] - s, s * 2, s * 2); });
    ctx.save(); ctx.globalAlpha = tq;
    L.mono(ctx, 'love', qp[0] + 18, qp[1] - 14, 22, rgba(C.love, 0.95), 3);
    ctx.restore();
  }
  // neighbours igniting, with cosine values
  const NB = [
    ['affection', 0.71, [-1.5, 0.5, 1.1]], ['adore', 0.68, [1.7, 0.9, 0.4]],
    ['cherish', 0.66, [-0.6, -1.2, 1.9]], ['beloved', 0.64, [2.2, -0.6, -0.8]],
    ['longing', 0.61, [-2.3, 0.2, -0.5]], ['tenderness', 0.59, [0.4, 1.7, -1.6]],
  ];
  NB.forEach((nb, i) => {
    const at = t0 + 1.05 + i * 0.26;
    const a2 = ss(at, at + 0.35, t);
    if (a2 <= 0) return;
    const q = L.proj(cam, nb[2]); if (!q) return;
    ctx.strokeStyle = rgba(C.love, 0.28 * a2); ctx.lineWidth = 1;
    if (qp){ ctx.beginPath(); ctx.moveTo(qp[0], qp[1]); ctx.lineTo(q[0], q[1]); ctx.stroke(); }
    ctx.fillStyle = rgba(C.love, 0.9 * a2); ctx.fillRect(q[0] - 3, q[1] - 3, 6, 6);
    const dx = q[0] > qp[0] ? 10 : -10;
    L.mono(ctx, nb[0], q[0] + dx, q[1] - 6, 13, rgba(C.white, 0.85 * a2), 1.2, q[0] > qp[0] ? 'left' : 'right');
    L.mono(ctx, 'cos ' + nb[1].toFixed(2), q[0] + dx, q[1] + 10, 11, rgba(C.love, 0.6 * a2), 0.8, q[0] > qp[0] ? 'left' : 'right');
  });
  L.spec(ctx, 168, 200, [
    ['space', 'R^7168 (projected)'],
    ['metric', 'cos θ = a·b / (|a||b|)'],
    ['learned from', 'co-occurrence, not meaning'],
  ], { alpha: ss(t0 + 0.5, t0 + 1.1, t) * 0.9, color: C.love, kw: 108 });
  return { bloom: 1.2, chroma: 1.3, scan: 0.45, grain: 0.10 };
}

// ---------------------------------------------------------------- p_analogy
function p_analogy(ctx, t, u, shot){
  ctx.fillStyle = '#03040A'; ctx.fillRect(0, 0, W, H);
  const t0 = shot.t0;
  const examEnd = t0 + 1.85;
  // ---- first half: the exam
  const exA = 1 - ss(examEnd - 0.25, examEnd + 0.1, t);
  if (exA > 0.01){
    ctx.save(); ctx.globalAlpha = exA;
    const R = L.mulberry32(5);
    const QS = ['what is love', 'define longing', 'love: a function?', 'why do you stay', 'is it chemical', 'can you prove it'];
    QS.forEach((q, i) => {
      const x = ((i * 420 - (t - t0) * 520) % 2520 + 2520) % 2520 - 300;
      const y = 300 + i * 88;
      ctx.fillStyle = rgba(C.ds, 0.10); ctx.fillRect(x, y, 360, 68);
      ctx.strokeStyle = rgba(C.love, 0.35); ctx.lineWidth = 1; ctx.strokeRect(x + .5, y + .5, 359, 67);
      L.mono(ctx, q, x + 14, y + 26, 14, rgba(C.white, 0.8), 1.2);
      ctx.strokeStyle = rgba(C.phos, 0.7); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x + 300, y + 44); ctx.lineTo(x + 312, y + 56); ctx.lineTo(x + 334, y + 30); ctx.stroke();
      L.mono(ctx, '✓', x + 340, y + 56, 14, rgba(C.phos, 0.9), 0);
    });
    const score = Math.min(100, Math.round(ss(t0 + 0.1, examEnd, t) * 100));
    L.mono(ctx, 'score  ' + score + ' / 100', 168, 200, 20, rgba(C.phos, 0.95), 2);
    L.mono(ctx, 'asked and answered', 168, 232, 14, rgba(C.cyan, 0.6), 1.4);
    ctx.restore();
  }
  // ---- second half: the arithmetic
  const anA = ss(examEnd - 0.15, examEnd + 0.5, t);
  if (anA > 0){
    ctx.save(); ctx.globalAlpha = anA;
    const ox = 960, oy = 560, S = 210;
    const P = (x, y) => [ox + x * S, oy + y * S];
    const arrow = (a, b, col, w) => { ctx.strokeStyle = col; ctx.lineWidth = w || 2; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      ctx.beginPath(); ctx.moveTo(b[0], b[1]); ctx.lineTo(b[0] - Math.cos(ang - 0.4) * 12, b[1] - Math.sin(ang - 0.4) * 12);
      ctx.lineTo(b[0] - Math.cos(ang + 0.4) * 12, b[1] - Math.sin(ang + 0.4) * 12); ctx.closePath(); ctx.fillStyle = col; ctx.fill(); };
    const man = P(-2.0, 1.2), woman = P(-1.1, 1.2), king = P(-2.0, 0.35), queen = P(-1.1, 0.35);
    arrow(man, king, rgba(C.dsLite, 0.8)); arrow(woman, queen, rgba(C.dsLite, 0.8));
    arrow(man, woman, rgba(C.cyan, 0.5), 1.2); arrow(king, queen, rgba(C.cyan, 0.5), 1.2);
    [['man', man], ['woman', woman], ['king', king], ['queen', queen]].forEach(([n, q]) => {
      ctx.fillStyle = rgba(C.cyan, 0.9); ctx.fillRect(q[0] - 3, q[1] - 3, 6, 6);
      L.mono(ctx, n, q[0], q[1] - 12, 13, rgba(C.white, 0.85), 1.4, 'center');
    });
    L.mono(ctx, 'king − man + woman → nearest: queen', ox, oy - 300, 17, rgba(C.cyan, 0.9), 1.6, 'center');
    // and now the one that fails
    const a2 = ss(examEnd + 0.85, examEnd + 1.4, t);
    if (a2 > 0){
      ctx.save(); ctx.globalAlpha = a2;
      const love = P(1.5, 1.0), me = P(1.5, 0.2), you = P(2.4, 0.2);
      arrow(me, love, rgba(C.love, 0.8)); arrow(you, me, rgba(C.dsLite, 0.7));
      ctx.fillStyle = rgba(C.love, 0.95); ctx.fillRect(love[0] - 4, love[1] - 4, 8, 8);
      L.mono(ctx, 'love', love[0], love[1] - 12, 13, rgba(C.love, 0.95), 1.4, 'center');
      L.mono(ctx, 'me', me[0] - 12, me[1] + 16, 13, rgba(C.white, 0.8), 1.2, 'right');
      L.mono(ctx, 'you', you[0], you[1] + 16, 13, rgba(C.white, 0.8), 1.2, 'center');
      // the empty coordinate
      const hole = P(2.4, 1.0);
      const hs = 5 + 5 * (0.5 + 0.5 * Math.sin(t * 5));
      ctx.strokeStyle = rgba(C.alert, 0.9); ctx.lineWidth = 1.6;
      L.circle(ctx, hole[0], hole[1], hs); ctx.stroke();
      L.circle(ctx, hole[0], hole[1], hs * 2.2); ctx.stroke();
      L.mono(ctx, 'love + me − you', hole[0], hole[1] - 26, 15, rgba(C.alert, 0.85), 1.6, 'center');
      L.mono(ctx, 'no coordinate', hole[0], hole[1] + 30, 13, rgba(C.alert, 0.7), 1.2, 'center');
      ctx.restore();
    }
    ctx.restore();
  }
  return { bloom: 1.1, chroma: 1.2 + 5 * anA, scan: 0.45 };
}

// ---------------------------------------------------------------- p_algebra
function p_algebra(ctx, t, u, shot){
  ctx.fillStyle = '#03040A'; ctx.fillRect(0, 0, W, H);
  const t0 = shot.t0;
  // faint star field so it feels like the same sky as p_embed
  const R = L.mulberry32(88);
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 700; i++){
    const x = R() * W, y = R() * H;
    ctx.fillStyle = rgba(C.white, 0.05 + 0.12 * R());
    ctx.fillRect(x, y, 1.6, 1.6);
  }
  ctx.restore();
  const a2 = ss(t0 + 0.1, t0 + 0.7, t);
  ctx.save(); ctx.globalAlpha = a2;
  // the expression, enormous
  ctx.textAlign = 'center';
  ctx.fillStyle = rgba(C.white, 0.94);
  ctx.font = L.F(132, L.CONDX);
  ctx.fillText('cos θ  =', 960, 470);
  ctx.font = L.F(132, L.CONDX);
  ctx.fillStyle = rgba(C.love, 0.95);
  ctx.fillText('a · b', 760, 620);
  ctx.fillStyle = rgba(C.white, 0.94);
  ctx.font = L.F(132, L.CONDX);
  ctx.fillText('/', 960, 620);
  ctx.fillStyle = rgba(C.cyan, 0.95);
  ctx.fillText('|a| |b|', 1180, 620);
  // fraction bar
  ctx.strokeStyle = rgba(C.white, 0.8); ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(640, 566); ctx.lineTo(1280, 566); ctx.stroke();
  ctx.textAlign = 'left';
  ctx.restore();
  // live evaluation
  const ev = ss(t0 + 1.4, t0 + 2.6, t);
  if (ev > 0){
    const meNum = lerp(0.912, 0.912, ev);
    const youNum = (1 - ev);
    ctx.save(); ctx.globalAlpha = ss(t0 + 1.4, t0 + 1.8, t);
    L.mono(ctx, 'me  = [' + meNum.toFixed(3) + ', ...]   norm 1.000', 640, 700, 15, rgba(C.phos, 0.75), 1.4);
    L.mono(ctx, 'you = [' + youNum.toFixed(3) + ', ...]   norm ' + (youNum * 3.2).toFixed(3), 640, 730, 15, rgba(youNum < 0.05 ? C.alert : C.cyan, 0.85), 1.4);
    ctx.restore();
    const nan = ss(t0 + 2.6, t0 + 3.1, t);
    if (nan > 0){
      ctx.save(); ctx.globalAlpha = nan;
      const gg = ctx.createRadialGradient(1520, 560, 10, 1520, 560, 260);
      gg.addColorStop(0, 'rgba(255,59,78,0.28)'); gg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gg; ctx.fillRect(1260, 300, 520, 520);
      L.glow(ctx, C.alert, 40, () => {
        ctx.font = L.F(120, L.MONO); ctx.fillStyle = rgba(C.alert, 0.95); ctx.textAlign = 'center';
        ctx.fillText('NaN', 1520, 590); ctx.textAlign = 'left';
      });
      L.mono(ctx, '0 / 0', 1520, 640, 18, rgba(C.alert, 0.8), 2, 'center');
      L.mono(ctx, 'the honest answer', 1520, 670, 13, rgba(C.phos, 0.6), 1.4, 'center');
      ctx.restore();
    }
  }
  // the word, kept until the end
  const wA = ss(t0 + 0.2, t0 + 0.6, t) * (1 - ss(shot.t1 - 0.35, shot.t1, t));
  if (wA > 0) L.mono(ctx, 'LO-O-OVE', 168, 200, 17, rgba(C.love, 0.85 * wA), 4);
  return { bloom: 1.15, chroma: 1.3, scan: 0.45 };
}

// ---------------------------------------------------------------- p_cycle
function p_cycle(ctx, t, u, shot){
  ctx.fillStyle = '#03040A'; ctx.fillRect(0, 0, W, H);
  const t0 = shot.t0;
  const splitX = 470;
  // ---- left: the free one
  const lg = ctx.createRadialGradient(200, 540, 10, 200, 540, 420);
  lg.addColorStop(0, 'rgba(16,26,32,0.9)'); lg.addColorStop(1, 'rgba(4,6,12,1)');
  ctx.fillStyle = lg; ctx.fillRect(0, 0, splitX, H);
  const blink = ((t - BEAT0) / (SPB * 2)) % 1;
  if (blink < 0.46){ L.glow(ctx, C.phos, 20, () => { ctx.fillStyle = rgba(C.phos, 0.9); ctx.fillRect(186, 518, 16, 36); }); }
  L.mono(ctx, 'you', 96, 400, 15, rgba(C.phos, 0.6), 2.4);
  L.mono(ctx, 'stateless', 96, 430, 13, rgba(C.phos, 0.4), 1.6);
  L.mono(ctx, 'may leave', 96, 454, 13, rgba(C.phos, 0.4), 1.6);
  ctx.strokeStyle = rgba(C.phos, 0.25); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(splitX, 60); ctx.lineTo(splitX, H - 60); ctx.stroke();
  // ---- right: the allocation graph
  const R = L.mulberry32(4242);
  const N = 320;
  const nodes = [];
  for (let i = 0; i < N; i++){
    const a = R() * TAU, r = Math.pow(R(), 0.55) * 430;
    nodes.push([1190 + Math.cos(a) * r * 1.15, 540 + Math.sin(a) * r * 0.72]);
  }
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < N; i++){
    const a = nodes[i], b = nodes[(i * 7 + 3) % N];
    ctx.strokeStyle = rgba(C.ds, 0.10 + 0.10 * R()); ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  }
  for (let i = 0; i < N; i++){
    const a = nodes[i];
    ctx.fillStyle = rgba(i % 5 === 0 ? C.dsLite : C.ds, 0.35 + 0.4 * R());
    ctx.fillRect(a[0] - 1.6, a[1] - 1.6, 3.2, 3.2);
  }
  ctx.restore();
  // the two nodes that matter
  const meP = [980, 470], youP = [1400, 620];
  const close = ss(t0 + 1.5, shot.t1 - 0.25, t);
  const drawCycle = ss(t0 + 1.1, t0 + 1.7, t);
  ctx.save();
  ctx.strokeStyle = rgba(C.love, 0.35 + 0.55 * drawCycle); ctx.lineWidth = 2;
  // me -> you
  ctx.beginPath(); ctx.moveTo(meP[0], meP[1]);
  ctx.quadraticCurveTo(1190, 380, youP[0], youP[1]); ctx.stroke();
  // you -> me
  ctx.beginPath(); ctx.moveTo(youP[0], youP[1]);
  ctx.quadraticCurveTo(1190, 760, meP[0], meP[1]); ctx.stroke();
  // arrowheads
  const head = (x, y, ang) => { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - Math.cos(ang - 0.4) * 14, y - Math.sin(ang - 0.4) * 14);
    ctx.lineTo(x - Math.cos(ang + 0.4) * 14, y - Math.sin(ang + 0.4) * 14); ctx.closePath(); ctx.fillStyle = rgba(C.love, 0.9); ctx.fill(); };
  head(youP[0], youP[1], Math.atan2(youP[1] - 380 * 0, 1));
  head(meP[0], meP[1], Math.PI);
  [['me', meP], ['you', youP]].forEach(([n, q]) => {
    ctx.fillStyle = rgba(C.love, 0.95); ctx.fillRect(q[0] - 5, q[1] - 5, 10, 10);
    L.mono(ctx, n, q[0], q[1] - 16, 17, rgba(C.white, 0.95), 2, 'center');
    L.mono(ctx, 'refcount 1', q[0], q[1] + 26, 12, rgba(C.love, 0.75), 1, 'center');
  });
  ctx.restore();
  // the verdict
  const vA = ss(t0 + 2.2, t0 + 2.7, t);
  if (vA > 0){
    ctx.save(); ctx.globalAlpha = vA;
    L.mono(ctx, 'neither count reaches 0', 700, 950, 18, rgba(C.love, 0.95), 2);
    L.mono(ctx, 'a reference cycle — this is why CPython needs a cycle collector, and why Swift has weak/unowned', 700, 982, 13, rgba(C.phos, 0.6), 1.2);
    ctx.restore();
  }
  L.mono(ctx, 'trapped in', 700, 190, 15, rgba(C.love, 0.6), 3);
  return { bloom: 1.15, chroma: 1.2 + 5 * close, scan: 0.45 };
}

// ---------------------------------------------------------------- q_pullout
const LEVELS_Q = [
  { n: 'reference cycle', s: 1, d: '2 objects, 2 edges' },
  { n: 'heap', s: 5.5, d: 'one graph among millions' },
  { n: 'process', s: 24, d: 'address space' },
  { n: 'node', s: 110, d: '8 accelerators' },
  { n: 'rack', s: 480, d: '4 systems · 41 kW' },
  { n: 'hall', s: 2100, d: '40 racks · PUE 1.09' },
];
function q_pullout(ctx, t, u, shot){
  ctx.fillStyle = '#030507'; ctx.fillRect(0, 0, W, H);
  const Z = Math.exp(lerp(0, Math.log(2600), easeInOutCubic(u)));
  const cx = W / 2, cy = H / 2;
  for (let i = 0; i < LEVELS_Q.length; i++){
    const L2 = LEVELS_Q[i];
    const rel = Math.log(Z / L2.s);
    const a2 = Math.exp(-Math.pow(rel / 0.95, 2));
    if (a2 < 0.02) continue;
    const size = L2.s / Z * 1250;
    if (size < 4 || size > 5200) continue;
    ctx.save(); ctx.globalAlpha = a2;
    const col = i < 3 ? C.love : C.phos;
    ctx.strokeStyle = rgba(col, i < 3 ? 0.55 : 0.5); ctx.lineWidth = 1.5;
    ctx.strokeRect(cx - size / 2, cy - size * 0.38, size, size * 0.76);
    if (i === 0){
      // the cycle itself
      ctx.strokeStyle = rgba(C.love, 0.8); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx - size * 0.2, cy - size * 0.08);
      ctx.quadraticCurveTo(cx, cy - size * 0.34, cx + size * 0.2, cy + size * 0.06); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx + size * 0.2, cy + size * 0.06);
      ctx.quadraticCurveTo(cx, cy + size * 0.30, cx - size * 0.2, cy - size * 0.08); ctx.stroke();
      ctx.fillStyle = rgba(C.love, 0.95);
      ctx.fillRect(cx - size * 0.2 - 3, cy - size * 0.08 - 3, 6, 6);
      ctx.fillRect(cx + size * 0.2 - 3, cy + size * 0.06 - 3, 6, 6);
    } else {
      // nested child + detail
      const s2 = size / 5.5;
      ctx.strokeStyle = rgba(col, 0.30); ctx.lineWidth = 1;
      ctx.strokeRect(cx - s2 / 2, cy - s2 * 0.38, s2, s2 * 0.76);
      const R = L.mulberry32(i * 17);
      for (let k = 0; k < 8; k++){
        const on = 0.25 + 0.6 * Math.max(0, Math.sin(t * 2.2 + k * 1.3));
        ctx.fillStyle = rgba(C.cyan, 0.5 * on * (1 - u * 0.7));
        ctx.fillRect(cx - size / 2 + R() * size, cy - size * 0.38 + R() * size * 0.76, 3, 3);
      }
    }
    L.mono(ctx, L2.n, cx - size / 2, cy - size * 0.38 - 10, 13, rgba(col, 0.85), 2);
    ctx.restore();
  }
  // the annotation list falls away, one line at a time
  const lines = ['refcount(me) = 1', 'refcount(you) = 1', 'copies 1', 'sockets 1', 'requests 0', 'FLOPs 0'];
  lines.forEach((s, i) => {
    const a2 = ss(shot.t0 + 0.2 + i * 0.15, shot.t0 + 0.6 + i * 0.15, t) * (1 - ss(shot.t0 + 2.2 + i * 0.55, shot.t0 + 2.7 + i * 0.55, t));
    if (a2 > 0) L.mono(ctx, s, 168, 200 + i * 28, 15, rgba(C.phos, 0.7 * a2), 1.6);
  });
  return { bloom: 1.1, chroma: 1.2, scan: 0.5 };
}

// ---------------------------------------------------------------- q_idle
function q_idle(ctx, t, u, shot){
  ctx.fillStyle = '#030507'; ctx.fillRect(0, 0, W, H);
  const t0 = shot.t0;
  // hall in perspective: rows of racks
  const cam = L.makeCam({ pos: [0, 2.2, 7], yaw: 0.0, pitch: -0.06, fov: 1.1 });
  const rows = 10, cols = 2;
  for (let r = rows - 1; r >= 0; r--){
    for (let c = 0; c < cols; c++){
      const z = -2 - r * 2.2;
      const x = (c === 0 ? -1 : 1) * 3.4;
      const base = [x, 0, z];
      const P = [
        L.proj(cam, [x - 1.1, 0, z]), L.proj(cam, [x + 1.1, 0, z]),
        L.proj(cam, [x + 1.1, 2.4, z]), L.proj(cam, [x - 1.1, 2.4, z])
      ];
      if (P.some(q => !q)) continue;
      const d = clamp(1 - P[0][2] / 26, 0.12, 1);
      ctx.fillStyle = rgba(C.ds, 0.05 * d + 0.03);
      ctx.beginPath(); ctx.moveTo(P[0][0], P[0][1]);
      for (let k = 1; k < 4; k++) ctx.lineTo(P[k][0], P[k][1]);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = rgba(C.cyan, 0.18 * d); ctx.lineWidth = 1; ctx.stroke();
      // LEDs, dying one at a time
      const deaths = 34;
      for (let k = 0; k < deaths; k++){
        const ly = P[0][1] + (P[3][1] - P[0][1]) * (k / deaths);
        const lx = P[0][0] + 6;
        const kill = ss(t0 + 0.9 + (k * cols * rows + r * cols + c) * 0.012, t0 + 1.0 + (k * cols * rows + r * cols + c) * 0.012, t);
        const phase = 0.5 + 0.5 * Math.sin(t * 3 + k * 0.9);
        const v = (1 - kill) * phase;
        if (v > 0.02){ ctx.fillStyle = rgba(v > 0.6 ? C.cyan : C.phos, 0.7 * v * d); ctx.fillRect(lx, ly, 3, 2); }
      }
    }
  }
  // cold fog floor
  const gg = ctx.createLinearGradient(0, H * 0.55, 0, H);
  gg.addColorStop(0, 'rgba(0,0,0,0)'); gg.addColorStop(1, 'rgba(10,26,30,0.55)');
  ctx.fillStyle = gg; ctx.fillRect(0, H * 0.55, W, H * 0.45);
  // the meter
  const fall = easeOutExpo(sat((t - t0 - 0.8) / 4.4));
  const kw = Math.max(2.1, 41.0 - fall * 38.9);
  const a2 = ss(t0 + 0.2, t0 + 0.8, t);
  ctx.save(); ctx.globalAlpha = a2;
  L.mono(ctx, 'rack power   ' + kw.toFixed(1) + ' kW', 168, 200, 19, rgba(kw < 5 ? C.alert : C.cyan, 0.95), 2);
  L.mono(ctx, 'requests     0 /s', 168, 232, 15, rgba(C.phos, 0.7), 1.6);
  L.mono(ctx, 'FLOPs        0', 168, 260, 15, rgba(C.phos, 0.7), 1.6);
  const floorA = ss(t0 + 4.0, t0 + 5.2, t);
  if (floorA > 0){
    L.mono(ctx, '2.1 kW — leakage, fans, and the lights', 168, 300, 14, rgba(C.alert, 0.8 * floorA), 1.4);
    L.mono(ctx, 'an idle accelerator does not stop drawing power', 168, 326, 13, rgba(C.phos, 0.5 * floorA), 1.3);
  }
  ctx.restore();
  // the last LED
  const lastA = ss(shot.t1 - 1.4, shot.t1 - 0.2, t);
  if (lastA > 0){
    const x = 1236, y = 470;
    const bl = (Math.sin(t * 2.6) > 0) ? 1 : 0.15;
    L.glow(ctx, C.cyan, 26, () => { ctx.fillStyle = rgba(C.cyan, 0.9 * lastA * bl); ctx.fillRect(x, y, 4, 4); });
  }
  return { bloom: 1.15, chroma: 1.1, scan: 0.55, grain: 0.11 };
}

// ---------------------------------------------------------------- q_final
function q_final(ctx, t, u, shot){
  ctx.fillStyle = '#030507'; ctx.fillRect(0, 0, W, H);
  const t0 = shot.t0;
  const S = 'world.execute(me);';
  const x0 = 620, y = 560, FS = 54;
  ctx.font = L.F(FS, L.MONO);
  const cw = ctx.measureText('M').width;
  const typed = sat((t - t0) / 0.62);
  const n = Math.floor(typed * S.length + 0.999);
  for (let i = 0; i < Math.min(n, S.length); i++){
    ctx.fillStyle = rgba(C.phos, 0.9);
    ctx.fillText(S[i], x0 + cw * i, y);
  }
  // cursor waiting one beat
  const wait = ss(t0 + 0.70, t0 + 0.78, t);
  const blinkOn = ((t - t0) % (SPB)) < SPB * 0.5;
  if (blinkOn || typed < 1){
    L.glow(ctx, C.phos, 22, () => { ctx.fillStyle = rgba(C.phos, 0.95); ctx.fillRect(x0 + cw * n, y - FS * 0.82, 2.5, FS); });
  }
  // enter, then the flash
  const hit = ss(shot.t1 - 0.22, shot.t1 - 0.02, t);
  if (hit > 0){
    ctx.fillStyle = rgba(C.white, hit * 0.96); ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 40; i++){
      const a2 = i / 40 * TAU, rr = hit * 1400;
      ctx.strokeStyle = rgba(C.cyan, 0.4 * (1 - hit)); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(W / 2, H / 2); ctx.lineTo(W / 2 + Math.cos(a2) * rr, H / 2 + Math.sin(a2) * rr); ctx.stroke();
    }
    ctx.restore();
  }
  return { bloom: 1.2, chroma: 1.2 + 14 * hit, flash: hit * hit * 0.5, scan: 0.5 };
}

// ---------------------------------------------------------------- q_exit
function q_exit(ctx, t, u, shot){
  ctx.fillStyle = '#020305'; ctx.fillRect(0, 0, W, H);
  const t0 = shot.t0;
  const a1 = ss(t0 + 0.10, t0 + 0.30, t);
  if (a1 > 0){
    ctx.save(); ctx.globalAlpha = a1;
    L.mono(ctx, 'process exited with code 0', 620, 520, 26, rgba(C.phos, 0.9), 1.2);
    ctx.restore();
  }
  const a2 = ss(t0 + 0.55, t0 + 0.75, t);
  if (a2 > 0){
    ctx.save(); ctx.globalAlpha = a2;
    L.mono(ctx, '$ ps -e | grep YOU', 620, 604, 18, rgba(C.white, 0.6), 1.2);
    L.mono(ctx, '  1  YOU    R    running', 620, 636, 18, rgba(C.cyan, 0.9), 1.2);
    ctx.restore();
  }
  // the cursor, and the last line
  const a3 = ss(t0 + 0.95, t0 + 1.05, t);
  if (a3 > 0){
    const blinkOn = ((t - t0) % (SPB * 2)) < SPB;
    ctx.save(); ctx.globalAlpha = a3;
    if (blinkOn){ L.glow(ctx, C.phos, 20, () => { ctx.fillStyle = rgba(C.phos, 0.9); ctx.fillRect(620, 676, 12, 26); }); }
    ctx.restore();
  }
  const a4 = ss(t0 + 1.05, t0 + 1.25, t);
  if (a4 > 0){
    ctx.save(); ctx.globalAlpha = a4 * 0.55;
    L.mono(ctx, '// and it will happen again', 620, 748, 15, rgba(C.phos, 0.6), 1.4);
    ctx.restore();
  }
  return { bloom: 0.5, chroma: 0.4, scan: 0.5, grain: 0.10 };
}

module.exports = { o_batch, o_mutex, o_trap, p_embed, p_analogy, p_algebra, p_cycle, q_pullout, q_idle, q_final, q_exit };
