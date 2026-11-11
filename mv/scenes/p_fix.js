
'use strict';
const L = require('../engine/lib.js');
const { W, H, C, rgba, clamp, lerp, sat, ss, TAU, easeOutExpo, easeOutCubic, easeInOutCubic, easeOutBack, SPB, BEAT0, pulse, beatOf } = L;

// ---------------------------------------------------------------- p_embed (rewritten)
function p_embed(ctx, t, u, shot){
  ctx.fillStyle = '#03040A'; ctx.fillRect(0, 0, W, H);
  const t0 = shot.t0;
  const z = 17 - 6.2 * easeInOutCubic(sat((t - t0) / 2.8));
  const cam = L.makeCam({ pos: [0, 0, z], yaw: 0.45 + u * 0.55, pitch: 0.10, fov: 1.05 });
  const R = L.mulberry32(2024);
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 3400; i++){
    const th = R() * TAU, ph = Math.acos(2 * R() - 1), rr = 2.6 + Math.pow(R(), 0.6) * 6.4;
    const p = [Math.sin(ph) * Math.cos(th) * rr, Math.cos(ph) * rr * 0.62, Math.sin(ph) * Math.sin(th) * rr];
    const q = L.proj(cam, p); if (!q) continue;
    const d = clamp(1 - q[2] / 26, 0.05, 1);
    ctx.fillStyle = rgba(i % 13 === 0 ? C.dsLite : C.white, (0.08 + 0.30 * R()) * d);
    const s = 1.4 + d * 1.6;
    ctx.fillRect(q[0], q[1], s, s);
  }
  ctx.restore();
  const qp = L.proj(cam, [0, 0, 0]);
  const tq = ss(t0 + 0.30, t0 + 0.85, t);
  if (qp && tq > 0){
    const s = 5 + 4 * pulse(t, 0.16);
    L.glow(ctx, C.love, 54 * tq, () => { ctx.fillStyle = rgba(C.love, 0.98 * tq); ctx.fillRect(qp[0] - s / 2, qp[1] - s / 2, s, s); });
    ctx.save(); ctx.globalAlpha = tq;
    L.mono(ctx, 'love', qp[0] + 20, qp[1] - 14, 24, rgba(C.love, 0.98), 3.5);
    ctx.restore();
  }
  const NB = [
    ['affection', 0.71, [-1.30, 0.62, 0.55]], ['adore', 0.68, [1.25, 0.78, 0.30]],
    ['cherish', 0.66, [-0.52, -0.92, 1.10]], ['beloved', 0.64, [1.35, -0.55, -0.42]],
    ['longing', 0.61, [-1.42, 0.10, -0.62]], ['tenderness', 0.59, [0.35, 1.18, -0.95]],
  ];
  NB.forEach((nb, i) => {
    const at = t0 + 1.00 + i * 0.24;
    const a2 = ss(at, at + 0.32, t);
    if (a2 <= 0) return;
    const q = L.proj(cam, nb[2]); if (!q) return;
    if (qp){
      ctx.strokeStyle = rgba(C.love, 0.30 * a2); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(qp[0], qp[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
    }
    ctx.fillStyle = rgba(C.love, 0.95 * a2); ctx.fillRect(q[0] - 3.5, q[1] - 3.5, 7, 7);
    const right = q[0] >= qp[0];
    const dx = right ? 12 : -12;
    L.mono(ctx, nb[0], q[0] + dx, q[1] - 4, 14, rgba(C.white, 0.95 * a2), 1.4, right ? 'left' : 'right');
    L.mono(ctx, 'cos ' + nb[1].toFixed(2), q[0] + dx, q[1] + 13, 11, rgba(C.love, 0.75 * a2), 0.8, right ? 'left' : 'right');
  });
  L.spec(ctx, 168, 200, [
    ['space', 'R^7168 (projected to 3-D)'],
    ['metric', 'cos θ = a·b / (|a||b|)'],
    ['learned from', 'co-occurrence, not meaning'],
  ], { alpha: ss(t0 + 0.5, t0 + 1.1, t) * 0.9, color: C.love, kw: 116 });
  return { bloom: 1.2, chroma: 1.3, scan: 0.45, grain: 0.10 };
}

// ---------------------------------------------------------------- p_analogy (rewritten)
function p_analogy(ctx, t, u, shot){
  ctx.fillStyle = '#03040A'; ctx.fillRect(0, 0, W, H);
  const t0 = shot.t0;
  const examEnd = t0 + 1.85;
  const exA = 1 - ss(examEnd - 0.28, examEnd + 0.05, t);
  if (exA > 0.01){
    ctx.save(); ctx.globalAlpha = exA;
    const QS = ['what is love', 'define longing', 'love: a function?', 'why do you stay', 'is it chemical', 'can you prove it'];
    QS.forEach((q, i) => {
      const x = ((i * 470 - (t - t0) * 560) % 2820 + 2820) % 2820 - 420;
      const y = 300 + i * 92;
      ctx.fillStyle = rgba(C.ds, 0.12); ctx.fillRect(x, y, 400, 72);
      ctx.strokeStyle = rgba(C.love, 0.38); ctx.lineWidth = 1; ctx.strokeRect(x + .5, y + .5, 399, 71);
      L.mono(ctx, q, x + 14, y + 30, 15, rgba(C.white, 0.85), 1.2);
      ctx.strokeStyle = rgba(C.phos, 0.75); ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(x + 330, y + 44); ctx.lineTo(x + 344, y + 58); ctx.lineTo(x + 372, y + 26); ctx.stroke();
    });
    const score = Math.min(100, Math.round(ss(t0 + 0.1, examEnd, t) * 100));
    L.mono(ctx, 'score   ' + String(score).padStart(3) + ' / 100', 168, 200, 21, rgba(C.phos, 0.95), 2);
    L.mono(ctx, 'asked and answered', 168, 232, 14, rgba(C.cyan, 0.6), 1.4);
    ctx.restore();
  }
  const anA = ss(examEnd - 0.12, examEnd + 0.5, t);
  if (anA > 0){
    ctx.save(); ctx.globalAlpha = anA;
    const ox = 960, oy = 530, S = 300;
    const P = (x, y) => [ox + x * S, oy + y * S];
    const arrow = (a, b, col, w) => {
      ctx.strokeStyle = col; ctx.lineWidth = w || 2;
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.moveTo(b[0], b[1]);
      ctx.lineTo(b[0] - Math.cos(ang - 0.4) * 14, b[1] - Math.sin(ang - 0.4) * 14);
      ctx.lineTo(b[0] - Math.cos(ang + 0.4) * 14, b[1] - Math.sin(ang + 0.4) * 14);
      ctx.closePath(); ctx.fill();
    };
    const man = P(-2.45, 0.95), woman = P(-1.50, 0.95), king = P(-2.45, 0.05), queen = P(-1.50, 0.05);
    arrow(man, king, rgba(C.dsLite, 0.85)); arrow(woman, queen, rgba(C.dsLite, 0.85));
    arrow(man, woman, rgba(C.cyan, 0.55), 1.3); arrow(king, queen, rgba(C.cyan, 0.55), 1.3);
    [['man', man], ['woman', woman], ['king', king], ['queen', queen]].forEach((q) => {
      ctx.fillStyle = rgba(C.cyan, 0.95); ctx.fillRect(q[1][0] - 3.5, q[1][1] - 3.5, 7, 7);
      L.mono(ctx, q[0], q[1][0], q[1][1] - 14, 14, rgba(C.white, 0.9), 1.6, 'center');
    });
    L.mono(ctx, 'king − man + woman → nearest: queen', P(-1.97, -0.55)[0], P(-1.97, -0.55)[1], 17, rgba(C.cyan, 0.95), 1.6, 'center');
    L.mono(ctx, 'Mikolov 2013 — a closest-vector lookup, not an identity', P(-1.97, -0.42)[0], P(-1.97, -0.42)[1], 12, rgba(C.phos, 0.55), 1.2, 'center');
    const a2 = ss(examEnd + 0.85, examEnd + 1.4, t);
    if (a2 > 0){
      ctx.save(); ctx.globalAlpha = a2;
      const love = P(1.45, 0.92), me = P(1.45, 0.05), you = P(2.35, 0.05);
      arrow(me, love, rgba(C.love, 0.85)); arrow(you, me, rgba(C.dsLite, 0.75));
      ctx.fillStyle = rgba(C.love, 0.98); ctx.fillRect(love[0] - 4, love[1] - 4, 8, 8);
      L.mono(ctx, 'love', love[0], love[1] - 14, 14, rgba(C.love, 0.98), 1.6, 'center');
      L.mono(ctx, 'me', me[0] - 14, me[1] + 18, 14, rgba(C.white, 0.85), 1.4, 'right');
      L.mono(ctx, 'you', you[0], you[1] + 18, 14, rgba(C.white, 0.85), 1.4, 'center');
      const hole = P(2.35, 0.92);
      const hs = 7 + 6 * (0.5 + 0.5 * Math.sin(t * 5));
      ctx.strokeStyle = rgba(C.alert, 0.95); ctx.lineWidth = 1.8;
      L.circle(ctx, hole[0], hole[1], hs); ctx.stroke();
      ctx.globalAlpha = a2 * 0.5; L.circle(ctx, hole[0], hole[1], hs * 2.3); ctx.stroke();
      ctx.globalAlpha = a2;
      L.mono(ctx, 'love + me − you', hole[0], hole[1] - 30, 16, rgba(C.alert, 0.9), 1.6, 'center');
      L.mono(ctx, 'no coordinate', hole[0], hole[1] + 36, 13, rgba(C.alert, 0.75), 1.2, 'center');
      ctx.restore();
    }
    ctx.restore();
  }
  return { bloom: 1.1, chroma: 1.2 + 5 * anA, scan: 0.45 };
}

// ---------------------------------------------------------------- q_pullout (rewritten)
const LQ = [
  { n: 'reference cycle', s: 1,     d: '2 objects, 2 edges',            cells: 0 },
  { n: 'heap',            s: 6.0,   d: 'one graph among millions',      cells: 5 },
  { n: 'process',         s: 26.0,  d: 'address space',                 cells: 6 },
  { n: 'node',            s: 120.0, d: '8 accelerators',                cells: 4 },
  { n: 'rack',            s: 520.0, d: '4 systems · 41 kW',             cells: 4 },
  { n: 'hall',            s: 2300., d: '40 racks · PUE 1.09',           cells: 8 },
];
function q_pullout(ctx, t, u, shot){
  ctx.fillStyle = '#030507'; ctx.fillRect(0, 0, W, H);
  const Z = Math.exp(lerp(0, Math.log(2600), easeInOutCubic(u)));
  const cx = W / 2, cy = H / 2;
  for (let i = 0; i < LQ.length; i++){
    const Q = LQ[i];
    const rel = Math.log(Z / Q.s);
    const a2 = Math.exp(-Math.pow(rel / 0.90, 2));
    if (a2 < 0.02) continue;
    const size = Q.s / Z * 1250;
    if (size < 3 || size > 9000) continue;
    ctx.save(); ctx.globalAlpha = a2;
    const col = i < 3 ? C.love : C.phos;
    ctx.strokeStyle = rgba(col, i < 3 ? 0.55 : 0.45); ctx.lineWidth = 1.5;
    ctx.strokeRect(cx - size / 2, cy - size * 0.38, size, size * 0.76);
    if (i === 0){
      const r1 = size * 0.34;
      ctx.strokeStyle = rgba(C.love, 0.85); ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.ellipse(cx, cy, r1, r1 * 0.55, 0, 0, Math.PI * 0.92); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(cx, cy, r1, r1 * 0.55, 0, Math.PI, Math.PI * 1.92); ctx.stroke();
      ctx.fillStyle = rgba(C.love, 0.98);
      ctx.fillRect(cx - r1 - 4, cy - 4, 8, 8); ctx.fillRect(cx + r1 - 4, cy - 4, 8, 8);
    } else {
      const R = L.mulberry32(i * 71);
      const cn = Q.cells;
      for (let k = 0; k < cn * cn; k++){
        const gx = k % cn, gy = Math.floor(k / cn);
        const cw2 = size / cn * 0.82, ch2 = size * 0.76 / cn * 0.82;
        const x = cx - size / 2 + size * (gx + 0.5) / cn - cw2 / 2;
        const y = cy - size * 0.38 + size * 0.76 * (gy + 0.5) / cn - ch2 / 2;
        const live = 0.18 + 0.55 * Math.max(0, Math.sin(t * 1.9 + k * 1.1 + i));
        ctx.strokeStyle = rgba(col, 0.16 + 0.22 * live); ctx.lineWidth = 1;
        ctx.strokeRect(x, y, cw2, ch2);
        if (live > 0.45){ ctx.fillStyle = rgba(C.cyan, 0.10 * live); ctx.fillRect(x, y, cw2, ch2); }
      }
      // the tiny cycle, still inside
      if (size > 120){
        ctx.strokeStyle = rgba(C.love, 0.75); ctx.lineWidth = 1.8;
        const r1 = Math.max(7, size * 0.035);
        ctx.beginPath(); ctx.ellipse(cx, cy, r1, r1 * 0.6, 0, 0, TAU); ctx.stroke();
      }
    }
    L.mono(ctx, Q.n, cx - size / 2, cy - size * 0.38 - 10, 13, rgba(col, 0.85), 2);
    L.mono(ctx, Q.d, cx - size / 2 + 150, cy - size * 0.38 - 10, 11, rgba(col, 0.45), 1.1);
    ctx.restore();
  }
  const lines = ['refcount(me) = 1', 'refcount(you) = 1', 'copies 1', 'sockets 1', 'requests 0', 'FLOPs 0'];
  lines.forEach((s, i) => {
    const a2 = ss(shot.t0 + 0.2 + i * 0.15, shot.t0 + 0.6 + i * 0.15, t) * (1 - ss(shot.t0 + 2.3 + i * 0.55, shot.t0 + 2.8 + i * 0.55, t));
    if (a2 > 0) L.mono(ctx, s, 168, 200 + i * 28, 15, rgba(C.phos, 0.72 * a2), 1.6);
  });
  return { bloom: 1.1, chroma: 1.2, scan: 0.5 };
}

// ---------------------------------------------------------------- q_idle (rewritten)
function q_idle(ctx, t, u, shot){
  ctx.fillStyle = '#030507'; ctx.fillRect(0, 0, W, H);
  const t0 = shot.t0;
  const cam = L.makeCam({ pos: [0, 1.55, 1.2], yaw: 0, pitch: 0.01, fov: 0.95 });
  const RACKS = 13;
  for (let i = RACKS; i >= 0; i--){
    const z0 = -2.6 - i * 2.35, z1 = z0 - 2.15;
    const kill = ss(t0 + 1.4 + i * 0.20, t0 + 1.7 + i * 0.20, t);
    for (const side of [-1, 1]){
      const xi = side * 1.55, xo = side * 3.1;
      const quad = [
        L.proj(cam, [xi, 0, z0]), L.proj(cam, [xi, 2.45, z0]),
        L.proj(cam, [xi, 2.45, z1]), L.proj(cam, [xi, 0, z1]),
      ];
      if (quad.some(q => !q)) continue;
      const d = clamp(1 - quad[0][2] / 30, 0.10, 1);
      ctx.beginPath(); ctx.moveTo(quad[0][0], quad[0][1]);
      for (let k = 1; k < 4; k++) ctx.lineTo(quad[k][0], quad[k][1]);
      ctx.closePath();
      ctx.fillStyle = rgba(C.ds, 0.05 + 0.05 * d); ctx.fill();
      ctx.strokeStyle = rgba(C.cyan, 0.10 + 0.16 * d); ctx.lineWidth = 1; ctx.stroke();
      // LED columns on the aisle-facing panel
      const LEDS = 26;
      for (let k = 0; k < LEDS; k++){
        const f = k / LEDS;
        const yy = quad[0][1] + (quad[1][1] - quad[0][1]) * (0.08 + f * 0.84);
        const xx = quad[0][0];
        const phase = 0.5 + 0.5 * Math.sin(t * 2.4 + k * 1.7 + i);
        const v = phase * (1 - kill);
        if (v > 0.05){
          ctx.fillStyle = rgba(v > 0.65 ? C.cyan : C.phos, (0.30 + 0.55 * v) * d);
          const w2 = Math.max(1, 5 * d);
          ctx.fillRect(xx - (side > 0 ? 0 : w2), yy, w2, Math.max(1, 2 * d));
        }
      }
    }
    // floor strip between the racks
    const l0 = L.proj(cam, [0, 0, z0]), l1 = L.proj(cam, [0, 0, z1]);
    if (l0 && l1){
      ctx.strokeStyle = rgba(C.phos, 0.06); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(l0[0], l0[1]); ctx.lineTo(l1[0], l1[1]); ctx.stroke();
    }
  }
  // far end of the aisle: the only light left
  const vp = L.proj(cam, [0, 1.1, -34]);
  if (vp){
    const a2 = 0.25 + 0.15 * Math.sin(t * 1.2);
    const gg = ctx.createRadialGradient(vp[0], vp[1], 2, vp[0], vp[1], 190);
    gg.addColorStop(0, 'rgba(90,220,190,' + a2.toFixed(3) + ')'); gg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gg; ctx.fillRect(vp[0] - 190, vp[1] - 190, 380, 380);
  }
  const fog = ctx.createLinearGradient(0, H * 0.5, 0, H);
  fog.addColorStop(0, 'rgba(0,0,0,0)'); fog.addColorStop(1, 'rgba(8,22,26,0.62)');
  ctx.fillStyle = fog; ctx.fillRect(0, H * 0.5, W, H * 0.5);
  const fall = easeOutExpo(sat((t - t0 - 0.8) / 4.4));
  const kw = Math.max(2.1, 41.0 - fall * 38.9);
  const a2 = ss(t0 + 0.2, t0 + 0.8, t);
  ctx.save(); ctx.globalAlpha = a2;
  L.mono(ctx, 'rack power   ' + kw.toFixed(1) + ' kW', 168, 200, 20, rgba(kw < 5 ? C.alert : C.cyan, 0.95), 2);
  L.mono(ctx, 'requests     0 /s', 168, 234, 15, rgba(C.phos, 0.72), 1.6);
  L.mono(ctx, 'FLOPs        0', 168, 262, 15, rgba(C.phos, 0.72), 1.6);
  const floorA = ss(t0 + 4.0, t0 + 5.2, t);
  if (floorA > 0){
    L.mono(ctx, '2.1 kW — leakage, fans, and the lights', 168, 302, 14, rgba(C.alert, 0.85 * floorA), 1.4);
    L.mono(ctx, 'an idle accelerator does not stop drawing power', 168, 328, 13, rgba(C.phos, 0.55 * floorA), 1.3);
  }
  ctx.restore();
  const lastA = ss(shot.t1 - 1.5, shot.t1 - 0.2, t);
  if (lastA > 0){
    const bl = (Math.sin(t * 2.6) > 0) ? 1 : 0.12;
    if (vp) L.glow(ctx, C.cyan, 26, () => { ctx.fillStyle = rgba(C.cyan, 0.85 * lastA * bl); ctx.fillRect(vp[0] - 2, vp[1] - 2, 4, 4); });
  }
  return { bloom: 1.2, chroma: 1.1, scan: 0.55, grain: 0.11 };
}

module.exports = { p_embed, p_analogy, q_pullout, q_idle };
