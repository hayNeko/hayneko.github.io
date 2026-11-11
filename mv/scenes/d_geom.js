'use strict';
const L = require('../engine/lib.js');
const K = require('./kit.js');
const { W, H, C, rgba, clamp, lerp, sat, ss, TAU, easeOutExpo, easeOutQuint, easeOutCubic,
  easeInCubic, easeInOutCubic, easeOutBack, spring1, BEAT0, SPB, BAR, beatOf, pulse, kick,
  mulberry32, hash2 } = L;

/* =====================================================================
   IV. ENUMERATION — the object lists its own properties.
   Each property is a real representation in a computer.
   ===================================================================== */

function bg(ctx, col){ ctx.fillStyle = col || '#04060A'; ctx.fillRect(0, 0, W, H); }
// clock in n subdivisions of a beat -> [index, fractional part]
function subClock(t, n){ const b = (t - BEAT0) / SPB * n; const i = Math.floor(b); return [i, b - i]; }
// snap a time up to the next subdivision
function snapUp(t, n){ const b = (t - BEAT0) / SPB * n; return BEAT0 + Math.ceil(b - 1e-9) * SPB / n; }
// eased arrival inside a subdivision: lands, then holds
function arrive(f, k){ return easeOutCubic(clamp(f * (k === undefined ? 1.9 : k), 0, 1)); }
function fnum(v, n){ const s = Math.abs(v).toFixed(n === undefined ? 4 : n); return (v < 0 ? '−' : '+') + s; }

// =====================================================================
// 01 · d_points — a nebula condenses into one token
// =====================================================================
const PTS = (function(){
  const R = mulberry32(0x51F71);
  const a = [];
  for (let i = 0; i < 900; i++){
    const th = R() * TAU, cp = 2 * R() - 1, sp = Math.sqrt(Math.max(0, 1 - cp * cp));
    const lobe = 0.74 + 0.26 * Math.sin(3 * th + cp * 2.2);
    const rr = 1.62 * lobe + 0.34 * R() * R();
    const sth = R() * TAU, scp = 2 * R() - 1, ssp = Math.sqrt(Math.max(0, 1 - scp * scp)), sr2 = 3.4 + 6.0 * R();
    a.push({
      tx: sp * Math.cos(th) * rr, ty: cp * rr * 0.84, tz: sp * Math.sin(th) * rr,
      sx: ssp * Math.cos(sth) * sr2, sy: scp * sr2 * 0.72, sz: ssp * Math.sin(sth) * sr2,
      ph: R(), hue: R(),
    });
  }
  return a;
})();

function d_points(ctx, t, u, shot){
  bg(ctx, '#04060A');
  const t0 = shot.t0;
  const cam = L.makeCam({
    pos: [0.14 * Math.sin(t * 0.31), 0.28 + 0.17 * Math.sin(t * 0.47), 6.7 - 3.2 * easeInOutCubic(u)],
    yaw: -0.34 + 0.66 * u + 0.05 * Math.sin(t * 0.62),
    pitch: -0.04 + 0.15 * u,
    roll: 0.045 * Math.sin(t * 0.36),
    fov: 1.16,
  });
  const ex = easeOutCubic(sat((t - t0) / 0.26));
  const pl = pulse(t, 0.16);
  const frozen = ss(t0 + 1.02, t0 + 1.42, t);

  // the embedding's own frame: three great circles
  ctx.save(); ctx.lineWidth = 1;
  for (let r = 0; r < 3; r++){
    const rot = [t * 0.16 + r * 1.05, t * 0.11 + r * 0.7, r * 0.4];
    ctx.beginPath(); let started = false;
    for (let i = 0; i <= 88; i++){
      const a = i / 88 * TAU;
      const q = L.proj(cam, K.tf([Math.cos(a) * 1.98, 0, Math.sin(a) * 1.98], rot));
      if (!q){ started = false; continue; }
      if (!started){ ctx.moveTo(q[0], q[1]); started = true; } else ctx.lineTo(q[0], q[1]);
    }
    ctx.strokeStyle = rgba(C.dsLite, 0.24 + 0.20 * frozen);
    ctx.stroke();
  }
  ctx.restore();

  // core: the token's mass seen from inside
  const cq = L.proj(cam, [0, 0, 0]);
  if (cq){
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const gg = ctx.createRadialGradient(cq[0], cq[1], 2, cq[0], cq[1], 300 + 60 * pulse(t, 0.2));
    gg.addColorStop(0, 'rgba(78,255,208,' + (0.16 + 0.10 * pl).toFixed(3) + ')');
    gg.addColorStop(0.45, 'rgba(77,107,254,0.08)');
    gg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gg; ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
  // the cloud
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < PTS.length; i++){
    const p = PTS[i];
    const c0 = 0.05 + p.ph * 0.62;
    const c = ss(t0 + c0, t0 + c0 + 0.42, t);
    const sh = 0.05 * (1 - frozen * 0.85) * Math.sin(t * 5.2 + p.ph * 12);
    const x = lerp(p.sx * ex, p.tx, c) + sh * p.tx;
    const y = lerp(p.sy * ex, p.ty, c) + sh * p.ty;
    const z = lerp(p.sz * ex, p.tz, c) + sh * p.tz;
    const q = L.proj(cam, [x, y, z]);
    if (!q) continue;
    const d = q[2];
    const a = clamp(1.5 - d / 8, 0.20, 1) * (0.5 + 0.5 * c) * (0.65 + 0.35 * pl);
    const r = clamp(3.9 - d * 0.17, 1.6, 3.9);
    const col = (p.hue > 0.955) ? C.ds : (i % 7 === 0 ? C.white : C.phos);
    ctx.fillStyle = rgba(col, a);
    ctx.fillRect(q[0] - r * 0.5, q[1] - r * 0.5, r, r);
  }
  ctx.restore();

  // the token itself, marked
  const tq = L.proj(cam, [0.05, 0.02, 0.12]);
  const ga = ss(t0 + 0.30, t0 + 0.72, t);
  if (tq && ga > 0){
    const cx = tq[0], cy = tq[1], rr = 13 + 22 * pl;
    ctx.save();
    ctx.strokeStyle = rgba(C.white, 0.42 * ga); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx - 66, cy); ctx.lineTo(cx + 66, cy); ctx.moveTo(cx, cy - 66); ctx.lineTo(cx, cy + 66); ctx.stroke();
    L.brackets(ctx, cx - rr, cy - rr, rr * 2, rr * 2, 10, rgba(C.white, 0.6 * ga), 1.2);
    L.glow(ctx, C.white, 26, () => { ctx.fillStyle = rgba(C.white, 0.95); ctx.fillRect(cx - 2.5, cy - 2.5, 5, 5); });
    // beat shockwave off the token
    ctx.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 3; k++){
      const rr2 = (1 - pl) * (150 + k * 120) + 8;
      ctx.strokeStyle = rgba(C.cyan, 0.20 * pl * ga * (1 - k * 0.3)); ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(cx, cy, rr2, 0, TAU); ctx.stroke();
    }
    ctx.restore();
    // leader to the readout
    const lx = 1424, ly = 286;
    ctx.strokeStyle = rgba(C.cyan, 0.45 * ga); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx + rr + 6, cy - rr - 4); ctx.lineTo(lx - 24, ly + 8); ctx.stroke();
    ctx.fillStyle = 'rgba(6,10,16,' + (0.78 * ga).toFixed(3) + ')'; ctx.fillRect(lx - 22, ly - 28, 384, 156);
    L.brackets(ctx, lx - 22, ly - 28, 384, 156, 13, rgba(C.cyan, 0.5 * ga), 1);
    L.spec(ctx, lx, ly, [
      ['token', '#4 882 391'],
      ['dim', '7168'],
      ['x[0]', fnum(0.05)],
      ['x[1]', fnum(0.02)],
      ['x[2]', fnum(0.12)],
    ], { alpha: ga, color: C.cyan, kw: 64, size: 15, lh: 25 });
  }

  // frame annotations
  L.mono(ctx, 'IV·ENUM 01/08', 168, 128, 12, rgba(C.phos, 0.42), 2.4);
  L.mono(ctx, 'EMBEDDING', 168, 196, 17, rgba(C.cyan, 0.95), 3.2);
  L.mono(ctx, 'A TOKEN IS A POINT IN R^7168', 168, 226, 14, rgba(C.phos, 0.62), 1.8);
  L.mono(ctx, 'EMBEDDING = COORDINATE', 168, 250, 12, rgba(C.phos, 0.34), 1.6);
  L.display(ctx, 'R^7168', 1752, 946, 116, rgba(C.dsLite, 0.22), 'right');
  L.mono(ctx, '10^6 POINTS · 10^3 DIMS (PROJECTED)', 168, 862, 13, rgba(C.cyan, 0.7 * ss(t0 + 0.5, t0 + 0.9, t)), 1.6);
  L.mono(ctx, 'CONDENSED / FROZEN', 168, 888, 12, rgba(C.phos, 0.34 * frozen), 1.6);
  L.brackets(ctx, 44, 44, W - 88, H - 88, 26, rgba(C.phos, 0.10), 1);
  return { bloom: 1.3, chroma: 1.6, scan: 0.5 };
}

// =====================================================================
// 02 · d_dimension — the axes unfold, the counter climbs
// =====================================================================
const AXES = (function(){
  const o = [];
  for (let i = 0; i < 18; i++){
    const y = 1 - 2 * (i + 0.5) / 18;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = i * 2.39996323;
    o.push({ d: [Math.cos(th) * r, y, Math.sin(th) * r], step: (hash2(i, 7.3) - 0.5) * 1.02 });
  }
  return o;
})();
const AX_LEN = 3.30;

function d_dimension(ctx, t, u, shot){
  bg(ctx, '#04060A');
  const t0 = shot.t0;
  const cam = L.makeCam({
    pos: [0.34 * Math.sin(t * 0.42), 0.55 + 0.30 * Math.sin(t * 0.33), 7.6 - 0.85 * easeInOutCubic(u)],
    yaw: 0.44 - 0.86 * u,
    pitch: 0.30 - 0.17 * u,
    roll: 0.05 * Math.sin(t * 0.5),
    fov: 1.06,
  });
  const stepT = SPB / 6;
  const nx = clamp(Math.floor((t - (t0 + 0.05)) / stepT) + 1, 0, AXES.length);

  // accumulated B — one step per unfolded axis
  let Bx = 0, By = 0, Bz = 0, dsum = 0;
  for (let i = 0; i < nx; i++){
    const v = AXES[i].d[0] * AXES[i].step * 1.55, v2 = AXES[i].d[1] * AXES[i].step * 1.55, v3 = AXES[i].d[2] * AXES[i].step * 1.55;
    Bx += v; By += v2; Bz += v3; dsum += v * v + v2 * v2 + v3 * v3;
  }
  const dAB = Math.sqrt(dsum);

  const qO = L.proj(cam, [0, 0, 0]);
  const qB = L.proj(cam, [Bx, By, Bz]);
  const pl = pulse(t, 0.18);

  // axes
  ctx.save(); ctx.lineWidth = 1.6;
  for (let i = 0; i < AXES.length; i++){
    const open = ss(t0 + 0.05 + i * stepT, t0 + 0.05 + i * stepT + 0.16, t);
    if (open <= 0.001) continue;
    const a = AXES[i];
    const len = AX_LEN * easeOutBack(open, 1.4);
    const e = [a.d[0] * len, a.d[1] * len, a.d[2] * len];
    const q = L.proj(cam, e);
    if (!qO || !q) continue;
    const fresh = clamp(1 - (t - (t0 + 0.05 + i * stepT)) / 0.55, 0, 1);
    const isLast = i === nx - 1;
    ctx.strokeStyle = rgba(isLast ? C.white : C.cyan, 0.30 + 0.62 * fresh);
    ctx.beginPath(); ctx.moveTo(qO[0], qO[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
    // end tick + label
    ctx.fillStyle = rgba(isLast ? C.white : C.phos, 0.3 + 0.6 * fresh);
    ctx.fillRect(q[0] - 1.6, q[1] - 1.6, 3.2, 3.2);
    if (i < 9 || i === AXES.length - 1)
      L.mono(ctx, i === AXES.length - 1 ? 'x7167' : ('x' + i), q[0] + 8, q[1] + 4, 12, rgba(C.phos, 0.34 + 0.55 * fresh), 0.9);
    // the per-axis contribution: how far B differs along this axis
    const ax = [a.d[0] * a.step * 1.55, a.d[1] * a.step * 1.55, a.d[2] * a.step * 1.55];
    const qc = L.proj(cam, [ax[0] * 1.0 + 0, ax[1], ax[2]]);
    if (qc && fresh > 0.05){
      ctx.strokeStyle = rgba(C.dsLite, 0.75 * fresh); ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(qO[0], qO[1]); ctx.lineTo(qc[0], qc[1]); ctx.stroke();
      ctx.lineWidth = 1.2;
    }
  }
  ctx.restore();

  // the two points
  if (qO){
    L.glow(ctx, C.ds, 34, () => { ctx.fillStyle = rgba(C.dsLite, 0.98); ctx.fillRect(qO[0] - 5, qO[1] - 5, 10, 10); });
    L.mono(ctx, 'A', qO[0] - 16, qO[1] - 12, 15, rgba(C.dsLite, 0.95), 2, 'center');
  }
  if (qO && qB){
    ctx.save();
    ctx.setLineDash([5, 6]);
    ctx.strokeStyle = rgba(C.cyan, 0.75); ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(qO[0], qO[1]); ctx.lineTo(qB[0], qB[1]); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    L.glow(ctx, C.cyan, 34, () => { ctx.fillStyle = rgba(C.white, 0.98); ctx.fillRect(qB[0] - 5, qB[1] - 5, 10, 10); });
    L.mono(ctx, 'B', qB[0] + 14, qB[1] - 10, 15, rgba(C.cyan, 0.95), 2, 'center');
    const mx = (qO[0] + qB[0]) * 0.5, my = (qO[1] + qB[1]) * 0.5;
    L.mono(ctx, 'd', mx + 10, my - 8, 15, rgba(C.white, 0.9), 1.4);
    L.mono(ctx, 'd(A,B) = ' + dAB.toFixed(4), qB[0] + 26, qB[1] + 26, 14, rgba(C.white, 0.9), 1.4);
  }

  // closure hint: the last axis wraps into a circle
  const wc = ss(t0 + 1.42, shot.t1 - 0.10, t);
  if (wc > 0){
    ctx.save();
    ctx.beginPath(); let st = false;
    for (let i = 0; i <= 70; i++){
      const a = -Math.PI * 0.5 + (i / 70) * TAU * 0.42 * wc;
      const q = L.proj(cam, [Math.cos(a) * 2.2, Math.sin(a) * 2.2, 0]);
      if (!q){ st = false; continue; }
      if (!st){ ctx.moveTo(q[0], q[1]); st = true; } else ctx.lineTo(q[0], q[1]);
    }
    ctx.strokeStyle = rgba(C.cyan, 0.55 * wc); ctx.lineWidth = 1.4; ctx.stroke();
    ctx.restore();
  }

  // dimension counter
  const dimProg = ss(t0 + 0.04, t0 + 1.46, t);
  const dimNow = Math.max(2, Math.round(2 * Math.pow(3584, dimProg)));
  L.mono(ctx, 'DIMENSION', 1364, 214, 15, rgba(C.cyan, 0.9), 3.4);
  L.display(ctx, String(dimNow), 1360, 344, 116, rgba(dimProg > 0.985 ? C.cyan : C.dsLite, 0.92));
  L.mono(ctx, 'OF 7168', 1364, 376, 13, rgba(C.phos, 0.55), 2.6);
  // ladder
  const lx = 1700, ly0 = 440, ly1 = 930;
  ctx.strokeStyle = rgba(C.phos, 0.45); ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(lx, ly0); ctx.lineTo(lx, ly1); ctx.stroke();
  const lgv = v => ly1 - (Math.log2(v) / Math.log2(7168)) * (ly1 - ly0);
  for (const v of [2, 8, 64, 512, 7168]){
    const y = lgv(v);
    ctx.beginPath(); ctx.moveTo(lx - 6, y); ctx.lineTo(lx + 6, y); ctx.stroke();
    L.mono(ctx, String(v), lx - 12, y + 4, 12, rgba(C.phos, 0.7), 0.8, 'right');
  }
  const my2 = lgv(dimNow);
  ctx.fillStyle = rgba(C.white, 0.95); ctx.fillRect(lx - 9, my2 - 1.5, 18, 3);
  L.mono(ctx, 'log2 dim', lx - 12, ly0 - 12, 10, rgba(C.phos, 0.35), 1, 'right');

  L.mono(ctx, 'IV·ENUM 02/08', 168, 128, 12, rgba(C.phos, 0.42), 2.4);
  L.mono(ctx, 'DIMENSION', 168, 196, 17, rgba(C.cyan, 0.95), 3.2);
  L.mono(ctx, '7168 = DeepSeek-V3 HIDDEN SIZE', 168, 226, 14, rgba(C.phos, 0.62), 1.8);
  L.mono(ctx, 'EACH AXIS ADDS ONE WAY TO DIFFER', 168, 250, 12, rgba(C.phos, 0.34), 1.6);
  L.spec(ctx, 168, 834, [
    ['d(A,B)', dAB.toFixed(4) + '  over ' + nx + ' axes'],
    ['form', 'sqrt( sum (dx_i)^2 )'],
    ['shown', '18 of 7168 axes'],
  ], { alpha: 0.9, color: C.cyan, kw: 66, size: 12, lh: 19 });
  L.brackets(ctx, 44, 44, W - 88, H - 88, 26, rgba(C.phos, 0.10), 1);
  return { bloom: 1.2, chroma: 1.5 + 3 * pl, scan: 0.5 };
}

// =====================================================================
// 03 · d_circle — one point orbits; the circle closes on a beat
// =====================================================================
function d_circle(ctx, t, u, shot){
  bg(ctx, '#04060A');
  const t0 = shot.t0;
  const tClose = BEAT0 + 77 * SPB;
  const tS = t0 + 0.02;
  const p = sat((t - tS) / (tClose - tS));
  const closed = t >= tClose;
  const S = 0.90 + 0.12 * easeOutCubic(u);
  const cy0 = 512 + 12 * Math.sin(t * 0.42);
  const cx0 = W / 2 + 16 * Math.sin(t * 0.31);
  const R = 318;
  const pl = pulse(t, 0.20);

  // graticule
  ctx.save(); ctx.translate(cx0, cy0); ctx.rotate(t * 0.06);
  ctx.lineWidth = 1;
  for (let i = 0; i < 36; i++){
    const a = i / 36 * TAU;
    ctx.strokeStyle = rgba(C.phos, i % 9 === 0 ? 0.11 : 0.045);
    ctx.beginPath(); ctx.moveTo(Math.cos(a) * 130, Math.sin(a) * 130); ctx.lineTo(Math.cos(a) * 900, Math.sin(a) * 900); ctx.stroke();
  }
  for (let r = 160; r <= 880; r += 118){
    ctx.strokeStyle = rgba(C.phos, 0.05);
    ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke();
  }
  ctx.restore();

  ctx.save(); ctx.translate(cx0, cy0); ctx.scale(S, S);
  // guide
  ctx.strokeStyle = rgba(C.phos, 0.24); ctx.lineWidth = 1.2;
  ctx.setLineDash([5, 8]);
  ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.stroke();
  ctx.setLineDash([]);

  // 72 ticks: lit once the sweeping point has passed
  for (let i = 0; i < 72; i++){
    const fr = i / 72;
    const a = -Math.PI / 2 + fr * TAU;
    const lit = fr <= p + 1e-6;
    const inner = lit ? R - 16 : R - 8;
    ctx.strokeStyle = rgba(lit ? (closed ? C.cyan : C.phos) : C.phos, lit ? (closed ? 0.98 : 0.85) : 0.22);
    ctx.lineWidth = lit ? 1.7 : 1;
    ctx.beginPath(); ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner); ctx.lineTo(Math.cos(a) * R, Math.sin(a) * R); ctx.stroke();
  }

  // the arc, drawn from the orbiting point
  if (p > 0){
    const a1 = -Math.PI / 2 + p * TAU;
    const seg = 260;
    const path = () => {
      ctx.beginPath();
      for (let i = 0; i <= seg; i++){
        const a = -Math.PI / 2 + (i / seg) * p * TAU;
        const x = Math.cos(a) * R, y = Math.sin(a) * R;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
    };
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const pass of [[1.6, 0.95, C.white], [4, 0.30, C.cyan], [11, 0.11, C.cyan]]){
      path();
      ctx.strokeStyle = rgba(pass[2], pass[1]); ctx.lineWidth = pass[0]; ctx.stroke();
    }
    // orbiting head + trail
    const hx = Math.cos(a1) * R, hy = Math.sin(a1) * R;
    L.glow(ctx, C.white, 40, () => { ctx.fillStyle = rgba(C.white, 0.98); ctx.fillRect(hx - 3.5, hy - 3.5, 7, 7); });
    ctx.strokeStyle = rgba(C.white, 0.25); ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i <= 26; i++){
      const a = a1 - (i / 26) * 0.55;
      const x = Math.cos(a) * R, y = Math.sin(a) * R;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
    // radius vector
    ctx.strokeStyle = rgba(C.cyan, 0.22); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(hx, hy); ctx.stroke();
  }

  // start marker: the arbitrary origin of the parametrization
  {
    const sa = ss(tS, tS + 0.25, t) * (0.35 + 0.65 * (1 - sat(p * 3)));
    ctx.strokeStyle = rgba(C.white, 0.8 * sa); ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(0, -R - 26); ctx.lineTo(0, -R + 26); ctx.stroke();
    ctx.fillStyle = rgba(C.white, 0.9 * sa);
    ctx.fillRect(-3, -R - 3, 6, 6);
    L.mono(ctx, 'theta = 0', 12, -R - 14, 11, rgba(C.white, 0.6 * sa), 1);
  }
  // caliper
  const ca = ss(t0 + 0.62, t0 + 0.98, t);
  if (ca > 0){
    ctx.save(); ctx.globalAlpha = ca;
    ctx.strokeStyle = rgba(C.cyan, 0.95); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(0, 14); ctx.moveTo(R, -14); ctx.lineTo(R, 14); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(R - 6, 0); ctx.stroke();
    ctx.fillStyle = rgba(C.cyan, 0.9);
    ctx.beginPath(); ctx.moveTo(R - 6, 0); ctx.lineTo(R - 16, -4); ctx.lineTo(R - 16, 4); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(16, -4); ctx.lineTo(16, 4); ctx.closePath(); ctx.fill();
    L.mono(ctx, 'r = 0.500000', R * 0.5, -14, 17, rgba(C.white, 0.98), 1.8, 'center');
    L.mono(ctx, 'R', -20, 6, 14, rgba(C.cyan, 0.9), 1, 'right');
    ctx.restore();
  }
  ctx.restore();

  // unrolled circumference
  const ua = ss(t0 + 0.95, t0 + 1.35, t);
  if (ua > 0){
    const x0 = 470, x1 = 1480, y = 906;
    ctx.save(); ctx.globalAlpha = ua;
    ctx.strokeStyle = rgba(C.phos, 0.35); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
    for (let i = 0; i <= 24; i++){
      const px = x0 + (x1 - x0) * i / 24;
      const big = i % 6 === 0;
      ctx.beginPath(); ctx.moveTo(px, y); ctx.lineTo(px, y - (big ? 13 : 6)); ctx.stroke();
      if (big) L.mono(ctx, i % 12 === 0 ? String(Math.round(i / 24 * 3141593) / 1e6) : '', px, y + 18, 12, rgba(C.phos, 0.7), 0.6, 'center');
    }
    ctx.fillStyle = rgba(C.white, 0.9);
    ctx.fillRect(x0, y - 4, (x1 - x0) * p, 9);
    L.mono(ctx, 'UNROLLED CIRCUMFERENCE', x0, y - 24, 12, rgba(C.cyan, 0.7), 1.8);
    L.mono(ctx, 'C = 2*pi*r = 3.141593', x1 + 26, y + 6, 16, rgba(C.phos, 0.95), 1.4);
    ctx.restore();
  }

  L.mono(ctx, 'IV·ENUM 03/08', 168, 128, 12, rgba(C.phos, 0.42), 2.4);
  L.mono(ctx, 'CIRCLE', 168, 196, 17, rgba(C.cyan, 0.95), 3.2);
  L.mono(ctx, 'r = C / 2*pi', 168, 226, 14, rgba(C.phos, 0.62), 1.8);
  const nd = ss(tClose - 0.02, tClose + 0.30, t);
  L.mono(ctx, 'NO DISTINGUISHED POINT ON IT', 168, 250, 12, rgba(C.cyan, 0.35 + 0.55 * nd), 1.8);
  L.mono(ctx, 'START = END  ·  ARBITRARY', 168, 272, 11, rgba(C.phos, 0.3 * nd), 1.4);
  L.mono(ctx, 'THETA = ' + (p * TAU).toFixed(4) + ' rad', 1752, 128, 13, rgba(C.cyan, 0.75), 1.6, 'right');
  L.mono(ctx, 'CLOSES ON BEAT 77  ·  C = 3.141593', 1752, 150, 12, rgba(C.phos, 0.45), 1.4, 'right');
  const fl = closed ? Math.exp(-(t - tClose) / 0.07) : 0;
  return { bloom: 1.25, chroma: 1.4 + 7 * fl, flash: 0.18 * fl, scan: 0.5 };
}

// =====================================================================
// 04 · d_ring — the circle extrudes into 8 GPUs; ring all-reduce
// =====================================================================
const RING_C = (function(){ const a = []; for (let i = 0; i < 120; i++){ const th = i / 120 * TAU; a.push([Math.cos(th), Math.sin(th)]); } return a; })();

function d_ring(ctx, t, u, shot){
  bg(ctx, '#030507');
  const t0 = shot.t0;
  const N = 8, RR = 2.90;
  const cam = L.makeCam({
    pos: [0.5 * Math.sin(t * 0.5), 4.0 - 0.8 * easeInOutCubic(u), 6.3],
    yaw: -0.32 + 0.68 * u,
    pitch: -0.56 + 0.12 * u,
    roll: 0.0,
    fov: 1.0,
  });
  const tS = BEAT0 + Math.floor((shot.t0 + 0.05 - BEAT0) / (SPB / 4)) * (SPB / 4);
  const d1 = 7 * (SPB / 4), d2 = 7 * (SPB / 8);
  let pass = 0, sIdx = 0, frac = 0;
  const dt = t - tS;
  if (dt >= 0){
    if (dt < d1){ const b = dt / (SPB / 4); sIdx = Math.floor(b); frac = b - sIdx; pass = 0; }
    else { const b = (dt - d1) / (SPB / 8); sIdx = Math.min(6, Math.floor(b)); frac = Math.min(1, b - sIdx); pass = 1; }
  }
  const stepsDone = pass * 7 + sIdx + frac;
  const pl = pulse(t, 0.13);

  // ring path
  ctx.save(); ctx.lineWidth = 1.2;
  ctx.beginPath(); let st = false;
  for (let i = 0; i <= 120; i++){
    const th = i / 120 * TAU;
    const q = L.proj(cam, [Math.cos(th) * RR, 0, Math.sin(th) * RR]);
    if (!q){ st = false; continue; }
    if (!st){ ctx.moveTo(q[0], q[1]); st = true; } else ctx.lineTo(q[0], q[1]);
  }
  ctx.strokeStyle = rgba(C.phos, 0.55); ctx.stroke();
  ctx.strokeStyle = rgba(C.cyan, 0.20); ctx.lineWidth = 9; ctx.stroke();
  ctx.restore();

  // nodes
  const nodeQ = [];
  for (let i = 0; i < N; i++){
    const th = i / N * TAU + Math.PI * 0.5;
    const q = L.proj(cam, [Math.cos(th) * RR, 0, Math.sin(th) * RR]);
    nodeQ.push(q);
    if (!q) continue;
    const sz = clamp(20 * q[3] / 200, 14, 30);
    const hot = clamp(1 - Math.abs(((stepsDone % 8) - i + 8) % 8) / 1.2, 0, 1) * (0.4 + 0.6 * pl);
    ctx.strokeStyle = rgba(C.cyan, 0.85 + 0.15 * hot); ctx.lineWidth = 1.8;
    ctx.strokeRect(q[0] - sz / 2, q[1] - sz / 2, sz, sz);
    ctx.fillStyle = rgba(C.ds, 0.10 + 0.25 * hot);
    ctx.fillRect(q[0] - sz / 2, q[1] - sz / 2, sz, sz);
    if (hot > 0.05){
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = rgba(C.white, 0.55 * hot); ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(q[0], q[1], sz * (0.7 + 1.6 * (1 - hot)), 0, TAU); ctx.stroke();
      ctx.restore();
    }
    if (Math.abs(q[0] - W * 0.5) < W * 0.16)
      L.mono(ctx, 'GPU' + i, q[0], q[1] - sz - 12, 14, rgba(C.phos, 0.88), 1.4, 'center');
    else
      L.mono(ctx, 'GPU' + i, q[0] - sz - 9, q[1] + 5, 14, rgba(C.phos, 0.88), 1.4, 'right');
  }

  // packets
  const pkPos = (f) => {
    const th = Math.PI * 0.5 + f * TAU;
    return [Math.cos(th) * RR, 0, Math.sin(th) * RR];
  };
  if (dt >= 0){
    const base = pass * 7 + sIdx + arrive(frac, 1.7);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let k = 0; k < N; k++){
      const f = (k / N + base / N) % 1;
      const head = k === 0;
      const q = L.proj(cam, pkPos(f));
      if (!q) continue;
      // trail
      ctx.beginPath(); let stt = false;
      for (let j = 0; j <= 22; j++){
        const ff = (f - j / 22 * 0.075 + 1) % 1;
        const qq = L.proj(cam, pkPos(ff));
        if (!qq){ stt = false; continue; }
        if (!stt){ ctx.moveTo(qq[0], qq[1]); stt = true; } else ctx.lineTo(qq[0], qq[1]);
      }
      ctx.strokeStyle = rgba(head ? C.white : C.cyan, head ? 0.75 : 0.42); ctx.lineWidth = head ? 3 : 2; ctx.stroke();
      if (head){
        L.glow(ctx, C.white, 30, () => { ctx.fillStyle = rgba(C.white, 0.98); ctx.fillRect(q[0] - 4.5, q[1] - 4.5, 9, 9); });
      } else {
        ctx.fillStyle = rgba(C.cyan, 0.9); ctx.fillRect(q[0] - 2.4, q[1] - 2.4, 4.8, 4.8);
      }
    }
    ctx.restore();
  }

  // volume gauge
  const gx = 1784, gy0 = 470, gy1 = 900;
  const vol = 1.75 * clamp(stepsDone / 14, 0, 1);
  ctx.save();
  ctx.strokeStyle = rgba(C.phos, 0.3); ctx.lineWidth = 1;
  ctx.strokeRect(gx, gy0, 26, gy1 - gy0);
  const gvy = v => gy1 - (v / 2) * (gy1 - gy0);
  for (const v of [0.5, 1, 1.5, 2]){
    const y = gvy(v);
    ctx.beginPath(); ctx.moveTo(gx - 6, y); ctx.lineTo(gx, y); ctx.stroke();
    L.mono(ctx, v.toFixed(1), gx - 10, y + 4, 10, rgba(C.phos, 0.4), 0.6, 'right');
  }
  ctx.fillStyle = rgba(C.cyan, 0.5);
  ctx.fillRect(gx + 1, gvy(vol), 24, gy1 - gvy(vol));
  ctx.fillStyle = rgba(C.alert, 0.35);
  ctx.fillRect(gx + 1, gvy(2) - 1, 24, 2);
  ctx.fillStyle = rgba(C.white, 0.95); ctx.fillRect(gx - 5, gvy(vol) - 1.5, 36, 3);
  L.mono(ctx, 'PER-GPU', gx + 13, gy0 - 34, 11, rgba(C.cyan, 0.85), 1.6, 'center');
  L.mono(ctx, 'VOLUME', gx + 13, gy0 - 18, 11, rgba(C.cyan, 0.85), 1.6, 'center');
  L.mono(ctx, vol.toFixed(2) + ' GB', gx + 26, gy1 + 28, 16, rgba(C.white, 0.95), 1.4, 'right');
  ctx.restore();

  L.mono(ctx, 'IV·ENUM 04/08', 168, 128, 12, rgba(C.phos, 0.42), 2.4);
  L.mono(ctx, 'CIRCUMFERENCE', 168, 196, 17, rgba(C.cyan, 0.95), 3.2);
  L.mono(ctx, 'RING ALL-REDUCE', 168, 226, 14, rgba(C.phos, 0.62), 2);
  L.mono(ctx, 'N = 8 · N-1 = 7 STEPS · 2 PASSES', 168, 250, 12, rgba(C.phos, 0.36), 1.6);
  L.mono(ctx, '2(N-1)/N * S = 2*7/8 * 1 GB = 1.75 GB', 168, 858, 14, rgba(C.cyan, 0.8), 1.5);
  L.mono(ctx, 'THE CIRCUMFERENCE IS THE TOPOLOGY', 168, 886, 13, rgba(C.phos, 0.45), 1.6);
  L.mono(ctx, 'SHORTEST PATH THAT TOUCHES EVERYONE ONCE', 168, 910, 11, rgba(C.phos, 0.28), 1.4);
  L.mono(ctx, 'STEP ' + (Math.min(7, sIdx + 1)) + '/7  ·  PASS ' + (pass + 1) + '  ·  ' + (stepsDone / 14 * 100).toFixed(0) + '%', 168, 274, 12, rgba(C.cyan, 0.65), 1.6);
  L.brackets(ctx, 44, 44, W - 88, H - 88, 26, rgba(C.phos, 0.10), 1);
  const cut = ss(shot.t1 - 0.14, shot.t1, t);
  return { bloom: 1.25, chroma: 1.4 + 4 * cut, scan: 0.5 };
}

// =====================================================================
// 05 · d_sine — the unrolled ring; RoPE: position becomes phase
// =====================================================================
function d_sine(ctx, t, u, shot){
  bg(ctx, '#04060A');
  const t0 = shot.t0;
  const cam = L.makeCam({
    pos: [0.0, 1.02 + 0.10 * Math.sin(t * 0.5), 7.5 - 0.5 * u],
    yaw: 0.15 - 0.15 * u,
    pitch: -0.10 + 0.06 * u,
    roll: 0.02 * Math.sin(t * 0.4),
    fov: 1.06,
  });
  const pos = (t - t0) * 2.35;
  const th = ((pos % TAU) + TAU) % TAU;
  const A = 1.55, KX = 1.15;
  const pl = pulse(t, 0.16);

  // spectral grid
  ctx.save(); ctx.lineWidth = 1;
  for (let i = -10; i <= 10; i++){
    const x = i * 0.75;
    const a = L.proj(cam, [x, -2.55, 0]), b = L.proj(cam, [x, 2.55, 0]);
    if (!a || !b) continue;
    const strong = i === 0;
    ctx.strokeStyle = rgba(C.phos, strong ? 0.28 : 0.11 + 0.07 * pl);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    if (i % 5 === 0 && i !== 0){
      L.mono(ctx, (i > 0 ? '+' : '') + (i / 2).toFixed(1), b[0] - 8, b[1] + 16, 10, rgba(C.phos, 0.28), 0.5);
    }
  }
  for (let j = -4; j <= 4; j++){
    const y = j * 0.62;
    const a = L.proj(cam, [-7.5, y, 0]), b = L.proj(cam, [7.5, y, 0]);
    if (!a || !b) continue;
    ctx.strokeStyle = rgba(C.phos, j === 0 ? 0.28 : 0.09);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  }
  ctx.restore();

  // the wave
  const wy = x => A * Math.sin(KX * x - pos);
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  ctx.beginPath(); let st = false;
  for (let x = -7.5; x <= 7.5; x += 0.06){
    const q = L.proj(cam, [x, wy(x), 0]);
    if (!q){ st = false; continue; }
    if (!st){ ctx.moveTo(q[0], q[1]); st = true; } else ctx.lineTo(q[0], q[1]);
  }
  ctx.strokeStyle = rgba(C.phos, 0.95); ctx.lineWidth = 1.8; ctx.stroke();
  ctx.strokeStyle = rgba(C.cyan, 0.22); ctx.lineWidth = 7; ctx.stroke();
  // integer positions, marked
  for (let i = -7; i <= 7; i++){
    const q = L.proj(cam, [i, wy(i), 0]);
    if (!q) continue;
    ctx.fillStyle = rgba(i === 0 ? C.white : C.cyan, 0.85);
    ctx.fillRect(q[0] - 1.8, q[1] - 1.8, 3.6, 3.6);
  }
  ctx.restore();

  // the phase read-out: rotor
  const rx = 1590, ry = 322, rr = 112;
  const sn = Math.sin(th), cs = Math.cos(th);
  // phase cursor: the same instant, read off the wave's axis
  {
    const q = L.proj(cam, [0, A * sn, 0]);
    const q2 = L.proj(cam, [0, -2.55, 0]);
    if (q && q2){
      ctx.save(); ctx.setLineDash([3, 6]);
      ctx.strokeStyle = rgba(C.white, 0.22); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(q[0], q[1]); ctx.lineTo(q[0], q2[1]); ctx.stroke();
      ctx.restore();
    }
  }
  ctx.save();
  ctx.fillStyle = 'rgba(4,6,10,0.72)'; ctx.beginPath(); ctx.arc(rx, ry, rr + 34, 0, TAU); ctx.fill();
  ctx.strokeStyle = rgba(C.phos, 0.22); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(rx, ry, rr, 0, TAU); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(rx - rr - 12, ry); ctx.lineTo(rx + rr + 12, ry); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(rx, ry - rr - 12); ctx.lineTo(rx, ry + rr + 12); ctx.stroke();
  for (let i = 0; i < 32; i++){
    const a = i / 32 * TAU;
    ctx.strokeStyle = rgba(C.phos, 0.18);
    ctx.beginPath(); ctx.moveTo(rx + Math.cos(a) * (rr + 4), ry + Math.sin(a) * (rr + 4)); ctx.lineTo(rx + Math.cos(a) * (rr + 10), ry + Math.sin(a) * (rr + 10)); ctx.stroke();
  }
  const hx = rx + cs * rr, hy = ry - sn * rr;
  ctx.strokeStyle = rgba(C.white, 0.9); ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(rx, ry); ctx.lineTo(hx, hy); ctx.stroke();
  ctx.setLineDash([3, 4]);
  ctx.strokeStyle = rgba(C.cyan, 0.8);
  ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx, ry); ctx.stroke();
  ctx.strokeStyle = rgba(C.dsLite, 0.8);
  ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(rx, hy); ctx.stroke();
  ctx.setLineDash([]);
  L.glow(ctx, C.cyan, 22, () => { ctx.fillStyle = rgba(C.white, 0.95); ctx.fillRect(hx - 3, hy - 3, 6, 6); });
  L.mono(ctx, 'sin = ' + fnum(sn, 4), rx - rr - 6, ry + sn * rr + (sn > 0 ? -8 : 20), 12, rgba(C.cyan, 0.95), 1.2, 'right');
  L.mono(ctx, 'cos = ' + fnum(cs, 4), rx + cs * rr + (cs > 0 ? 8 : -8), ry + 22, 12, rgba(C.dsLite, 0.95), 1.2, cs > 0 ? 'left' : 'right');
  ctx.restore();

  // RoPE frequency table
  const d = 128;
  L.mono(ctx, 'ROPE  THETA_i = 10000^(-2i/d)', 168, 826, 14, rgba(C.cyan, 0.85), 1.6);
  L.mono(ctx, 'd = ' + d + ' (HEAD DIM)  ·  POSITION BECOMES PHASE', 168, 850, 12, rgba(C.phos, 0.4), 1.5);
  const rows = [];
  for (let i = 0; i < 3; i++) rows.push(Math.pow(10000, -2 * i / d));
  L.mono(ctx, 'th0 = ' + rows[0].toFixed(6) + '   th1 = ' + rows[1].toFixed(6), 168, 874, 12, rgba(C.phos, 0.55), 1.2);
  L.mono(ctx, 'th2 = ' + rows[2].toFixed(6) + '   th63 = ' + Math.pow(10000, -2 * 63 / d).toFixed(6), 168, 894, 12, rgba(C.phos, 0.55), 1.2);

  L.mono(ctx, 'IV·ENUM 05/08', 168, 128, 12, rgba(C.phos, 0.42), 2.4);
  L.mono(ctx, 'SINE WAVE', 168, 196, 17, rgba(C.cyan, 0.95), 3.2);
  L.mono(ctx, 'THE UNROLLED RING', 168, 226, 14, rgba(C.phos, 0.62), 2);
  L.mono(ctx, 'POS = ' + pos.toFixed(2) + '   THETA = ' + th.toFixed(4) + ' rad', 1752, 128, 13, rgba(C.white, 0.85), 1.5, 'right');
  L.mono(ctx, 'SIN^2 + COS^2 = ' + (sn * sn + cs * cs).toFixed(6), 1752, 150, 11, rgba(C.phos, 0.45), 1.3, 'right');
  L.brackets(ctx, 44, 44, W - 88, H - 88, 26, rgba(C.phos, 0.10), 1);
  return { bloom: 1.25, chroma: 1.4 + 2 * pl, scan: 0.5 };
}

// =====================================================================
// 06 · d_tangent — tangents, the derivative, then descent
// =====================================================================
function d_tangent(ctx, t, u, shot){
  bg(ctx, '#04060A');
  const t0 = shot.t0;
  const cam = L.makeCam({
    pos: [0.30 * Math.sin(t * 0.40), 1.24 + 0.12 * Math.sin(t * 0.5), 7.7 - 1.1 * easeInOutCubic(u)],
    yaw: 0.22 - 0.52 * u,
    pitch: -0.13 + 0.05 * u,
    roll: 0.03 * Math.sin(t * 0.35),
    fov: 1.06,
  });
  const pos = (t - t0) * 1.75;
  const A = 1.42, KX = 1.12;
  const w3 = ss(t0 + 1.30, t0 + 1.72, t);
  const waveA = 1 - ss(t0 + 1.24, t0 + 1.62, t);
  const w1 = ss(t0 + 0.06, t0 + 0.50, t);
  const w2 = ss(t0 + 0.62, t0 + 1.08, t);
  const pl = pulse(t, 0.15);

  // the wave
  if (waveA > 0.01){
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = waveA;
    ctx.beginPath(); let st = false;
    for (let x = -7.0; x <= 7.0; x += 0.06){
      const q = L.proj(cam, [x, A * Math.sin(KX * x - pos), 0]);
      if (!q){ st = false; continue; }
      if (!st){ ctx.moveTo(q[0], q[1]); st = true; } else ctx.lineTo(q[0], q[1]);
    }
    ctx.strokeStyle = rgba(C.phos, 0.9); ctx.lineWidth = 1.8; ctx.stroke();
    ctx.strokeStyle = rgba(C.cyan, 0.18); ctx.lineWidth = 7; ctx.stroke();
    ctx.restore();
  }

  // tangents
  for (let i = 0; i < 13; i++){
    const x0 = -6.6 + i * 1.1;
    const a0 = BEAT0 + (Math.floor((t0 + 0.10 - BEAT0) / (SPB / 4)) + i) * (SPB / 4);
    const w = ss(a0, a0 + 0.28, t) * waveA;
    if (w <= 0.01) continue;
    const th = KX * x0 - pos;
    const y0 = A * Math.sin(th);
    const slope = A * KX * Math.cos(th);
    const n = Math.hypot(1, slope);
    const dx = 0.74 / n, dy = slope * 0.74 / n;
    const arrow = w2 * (0.35 + 0.45 * pl);
    const q1 = L.proj(cam, [x0 - dx * (1 + arrow), y0 - dy * (1 + arrow), 0]);
    const q2 = L.proj(cam, [x0 + dx * (1 + arrow), y0 + dy * (1 + arrow), 0]);
    const qa = L.proj(cam, [x0, y0, 0]);
    if (!q1 || !q2 || !qa) continue;
    const cosv = Math.cos(th);
    const col = Math.abs(cosv) < 0.16 ? C.warm : (cosv > 0 ? C.cyan : C.dsLite);
    ctx.strokeStyle = rgba(col, 0.25 + 0.55 * w); ctx.lineWidth = 1.3 + 1.2 * w2;
    ctx.beginPath(); ctx.moveTo(q1[0], q1[1]); ctx.lineTo(q2[0], q2[1]); ctx.stroke();
    ctx.fillStyle = rgba(col, 0.75 * w);
    ctx.fillRect(qa[0] - 2.2, qa[1] - 2.2, 4.4, 4.4);
    // arrow head toward +x when gradients have taken over
    if (w2 > 0.2){
      const ang = Math.atan2(q2[1] - q1[1], q2[0] - q1[0]);
      const ah = 9 + 5 * pl;
      ctx.strokeStyle = rgba(col, 0.85 * w2); ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(q2[0], q2[1]); ctx.lineTo(q2[0] - Math.cos(ang - 0.42) * ah, q2[1] - Math.sin(ang - 0.42) * ah);
      ctx.moveTo(q2[0], q2[1]); ctx.lineTo(q2[0] - Math.cos(ang + 0.42) * ah, q2[1] - Math.sin(ang + 0.42) * ah);
      ctx.stroke();
    }
  }

  // focused point + derivative readout
  const fx = 0.0, fth = KX * fx - pos;
  const fq = L.proj(cam, [fx, A * Math.sin(fth), 0]);
  if (fq && waveA > 0.05){
    L.glow(ctx, C.white, 34, () => { ctx.fillStyle = rgba(C.white, 0.95); ctx.fillRect(fq[0] - 3.5, fq[1] - 3.5, 7, 7); });
    ctx.strokeStyle = rgba(C.white, 0.22); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(fq[0], fq[1] - 40); ctx.lineTo(fq[0], fq[1] - 22); ctx.stroke();
    L.mono(ctx, 'd/dth sin th = cos th', 1050, 208, 18, rgba(C.cyan, 0.95 * waveA), 1.8);
    L.spec(ctx, 1050, 240, [
      ['theta', fnum(fth, 4)],
      ['sin', fnum(Math.sin(fth), 4)],
      ['cos = slope', fnum(Math.cos(fth), 4)],
    ], { alpha: waveA, color: C.cyan, kw: 118, size: 14, lh: 23 });
  }

  // loss surface + descent
  if (w3 > 0.01){
    const bowl = (x, z) => 0.105 * (x * x + z * z) - 2.05;
    ctx.save();
    ctx.globalAlpha = w3;
    // mesh
    for (let r = 0.2; r <= 5.2; r += 0.62){
      ctx.beginPath(); let st = false;
      for (let i = 0; i <= 64; i++){
        const a = i / 64 * TAU;
        const q = L.proj(cam, [Math.cos(a) * r, bowl(Math.cos(a) * r, Math.sin(a) * r), Math.sin(a) * r]);
        if (!q){ st = false; continue; }
        if (!st){ ctx.moveTo(q[0], q[1]); st = true; } else ctx.lineTo(q[0], q[1]);
      }
      ctx.strokeStyle = rgba(C.phos, 0.15 + 0.16 * (1 - r / 5.2)); ctx.lineWidth = 1; ctx.stroke();
    }
    for (let k = 0; k < 16; k++){
      const a = k / 16 * TAU;
      ctx.beginPath(); let st = false;
      for (let i = 0; i <= 24; i++){
        const r = 5.2 * i / 24;
        const q = L.proj(cam, [Math.cos(a) * r, bowl(Math.cos(a) * r, Math.sin(a) * r), Math.sin(a) * r]);
        if (!q){ st = false; continue; }
        if (!st){ ctx.moveTo(q[0], q[1]); st = true; } else ctx.lineTo(q[0], q[1]);
      }
      ctx.strokeStyle = rgba(C.dsLite, 0.20); ctx.lineWidth = 1; ctx.stroke();
    }
    // gradient arrows pointing downhill
    for (let k = 0; k < 12; k++){
      const a = k / 12 * TAU + 0.22;
      const r0 = 4.2, r1 = 2.9;
      const q0 = L.proj(cam, [Math.cos(a) * r0, bowl(Math.cos(a) * r0, Math.sin(a) * r0) + 0.05, Math.sin(a) * r0]);
      const q1b = L.proj(cam, [Math.cos(a) * r1, bowl(Math.cos(a) * r1, Math.sin(a) * r1) + 0.05, Math.sin(a) * r1]);
      if (!q0 || !q1b) continue;
      ctx.strokeStyle = rgba(C.warm, 0.85); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(q0[0], q0[1]); ctx.lineTo(q1b[0], q1b[1]); ctx.stroke();
      const ang = Math.atan2(q1b[1] - q0[1], q1b[0] - q0[0]);
      ctx.beginPath();
      ctx.moveTo(q1b[0], q1b[1]); ctx.lineTo(q1b[0] - Math.cos(ang - 0.5) * 11, q1b[1] - Math.sin(ang - 0.5) * 11);
      ctx.moveTo(q1b[0], q1b[1]); ctx.lineTo(q1b[0] - Math.cos(ang + 0.5) * 11, q1b[1] - Math.sin(ang + 0.5) * 11);
      ctx.stroke();
    }
    // descent path
    const step = clamp((t - (t0 + 1.32)) / 0.62, 0, 1);
    const NP = 90;
    let pq = null;
    for (let i = 0; i <= NP; i++){
      const f = i / NP;
      if (f > step) break;
      const r = lerp(4.6, 0.16, f);
      const a = 1.4 + f * Math.PI * 2.6;
      const q = L.proj(cam, [Math.cos(a) * r, bowl(Math.cos(a) * r, Math.sin(a) * r) + 0.06, Math.sin(a) * r]);
      if (!q){ pq = null; continue; }
      if (pq){
        ctx.strokeStyle = rgba(C.white, 0.12 + 0.85 * f);
        ctx.lineWidth = 1.1 + 2.2 * f;
        ctx.beginPath(); ctx.moveTo(pq[0], pq[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
      }
      pq = q;
    }
    const rEnd = lerp(4.6, 0.16, step);
    const aEnd = 1.4 + step * Math.PI * 2.6;
    const qE = L.proj(cam, [Math.cos(aEnd) * rEnd, bowl(Math.cos(aEnd) * rEnd, Math.sin(aEnd) * rEnd) + 0.07, Math.sin(aEnd) * rEnd]);
    if (qE){
      L.glow(ctx, C.white, 30, () => { ctx.fillStyle = rgba(C.white, 0.98); ctx.fillRect(qE[0] - 3.4, qE[1] - 3.4, 6.8, 6.8); });
    }
    const qM = L.proj(cam, [0, bowl(0, 0) + 0.05, 0]);
    if (qM){
      ctx.strokeStyle = rgba(C.alert, 0.7); ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(qM[0] - 12, qM[1]); ctx.lineTo(qM[0] + 12, qM[1]); ctx.moveTo(qM[0], qM[1] - 12); ctx.lineTo(qM[0], qM[1] + 12); ctx.stroke();
    }
    ctx.restore();
    L.mono(ctx, 'LOSS SURFACE  ·  THE TANGENT IS THE GRADIENT', 1092, 214, 15, rgba(C.warm, 0.9 * w3), 1.6);
    L.mono(ctx, 'DESCENT  ' + (step * 100).toFixed(1) + '%', 1092, 244, 12, rgba(C.phos, 0.5 * w3), 1.4);
  }

  L.mono(ctx, 'IV·ENUM 06/08', 168, 128, 12, rgba(C.phos, 0.42), 2.4);
  L.mono(ctx, 'TANGENT', 168, 196, 17, rgba(C.cyan, 0.95), 3.2);
  L.mono(ctx, 'THE SLOPE IS cos theta', 168, 226, 14, rgba(C.phos, 0.62), 1.8);
  L.mono(ctx, 'ROTATION PRESERVES LENGTH, CHANGES PHASE', 168, 250, 11, rgba(C.phos, 0.32), 1.4);
  L.mono(ctx, 'EVERY POINT HAS A SLOPE  ·  IT IS READ OFF THE COSINE', 168, 872, 12, rgba(C.phos, 0.45), 1.4);
  L.brackets(ctx, 44, 44, W - 88, H - 88, 26, rgba(C.phos, 0.10), 1);
  return { bloom: 1.2, chroma: 1.4 + 3 * pl, scan: 0.5 };
}

// =====================================================================
// 07 · d_infinity — the horizon that never arrives
// =====================================================================
function d_infinity(ctx, t, u, shot){
  bg(ctx, '#030507');
  const t0 = shot.t0;
  const sink = ss(0.72, 1.0, u);
  const cam = L.makeCam({
    pos: [0.05 * Math.sin(t * 0.4), 1.95 * (1 - sink) + 0.02, 4.2 - 10.5 * easeInOutCubic(u)],
    yaw: 0.03 * Math.sin(t * 0.31),
    pitch: -0.30 + 0.27 * u,
    roll: 0.035 * Math.sin(t * 0.37),
    fov: 1.22,
  });
  const pl = pulse(t, 0.17);
  const flow = (t - t0) * 7.4;

  // floor: transverse lines rushing in
  const SP = 1.45, NL = 44;
  ctx.save(); ctx.lineWidth = 1;
  for (let i = 0; i < NL; i++){
    const z = -((i * SP + flow) % (NL * SP)) + 1.5;
    const a = L.proj(cam, [-26, 0, z]), b = L.proj(cam, [26, 0, z]);
    if (!a || !b) continue;
    const near = clamp(1 - Math.abs(z - 1.5) / 9, 0, 1);
    ctx.lineWidth = 1 + near * 0.8;
    ctx.strokeStyle = rgba(C.phos, 0.17 + 0.42 * near + 0.20 * pl * near);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  }
  // longitudinal lines
  for (let i = -11; i <= 11; i++){
    const x = i * 2.2;
    const a = L.proj(cam, [x, 0, 1.6]), b = L.proj(cam, [x, 0, -62]);
    if (!a || !b) continue;
    ctx.strokeStyle = rgba(C.phos, 0.17 + 0.10 * pl);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  }
  ctx.restore();

  // the horizon: it never arrives
  const hq = L.proj(cam, [0, 0, -4000]);
  if (hq){
    const hy = hq[1];
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createLinearGradient(0, hy - 62, 0, hy + 26);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.70, 'rgba(78,255,208,' + (0.07 + 0.08 * pl).toFixed(3) + ')');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, hy - 62, W, 88);
    ctx.fillStyle = rgba(C.white, 0.55 + 0.35 * pl);
    ctx.fillRect(0, hy - 1.2, W, 2.4);
    ctx.fillStyle = rgba(C.cyan, 0.22);
    ctx.fillRect(0, hy - 4, W, 8);
    ctx.restore();

    const rv = ss(t0 + 0.15, t0 + 0.6, t) * (0.55 + 0.45 * pl);
    L.brackets(ctx, W / 2 - 96, hy - 74, 192, 74, 16, rgba(C.cyan, 0.55 * rv), 1.4);
    ctx.fillStyle = rgba(C.white, 0.85 * rv);
    ctx.fillRect(W / 2 - 3, hy - 3, 6, 6);
    L.mono(ctx, 'DISTANCE = INFINITY  ·  IT NEVER ARRIVES', W / 2, hy - 84, 11, rgba(C.cyan, 0.62 * rv), 1.6, 'center');
  }

  // counter
  const [si] = subClock(t, 4);
  const exp = clamp(si - Math.floor((t0 - BEAT0) / SPB * 4) + 1, 0, 12);
  const xv = Math.pow(10, exp);
  L.mono(ctx, 'IV·ENUM 07/08', 168, 128, 12, rgba(C.phos, 0.42), 2.4);
  L.mono(ctx, 'INFINITY', 168, 196, 17, rgba(C.cyan, 0.95), 3.2);
  L.mono(ctx, 'lim x -> INF', 168, 226, 14, rgba(C.phos, 0.62), 2);
  L.display(ctx, '10^' + exp, 168, 358, 104, rgba(C.white, 0.92));
  L.mono(ctx, 'x = ' + xv.toExponential(0).replace('+', ''), 168, 866, 14, rgba(C.cyan, 0.9), 1.6);
  L.mono(ctx, '1/x = ' + (1 / xv).toExponential(0).replace('+', ''), 168, 894, 13, rgba(C.phos, 0.62), 1.6);
  L.mono(ctx, 'a horizon with no distance', 168, 920, 11, rgba(C.phos, 0.34), 1.4);

  // lemniscate
  const lx = 1620, ly = 268, la = 128;
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  ctx.beginPath();
  for (let i = 0; i <= 160; i++){
    const s = i / 160 * TAU;
    const dnm = 1 + Math.sin(s) * Math.sin(s);
    const X = lx + la * Math.cos(s) / dnm;
    const Y = ly + la * 0.72 * Math.sin(s) * Math.cos(s) / dnm;
    if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
  }
  ctx.strokeStyle = rgba(C.cyan, 0.55 + 0.35 * pl); ctx.lineWidth = 2; ctx.stroke();
  ctx.strokeStyle = rgba(C.cyan, 0.16); ctx.lineWidth = 9; ctx.stroke();
  ctx.restore();
  L.mono(ctx, 'APPROACH', lx, ly + la * 0.72 + 48, 11, rgba(C.phos, 0.6), 2, 'center');

  // distance ruler on the right: it only ever compresses
  const rxr = 1720, ry0 = 470, ry1 = 900;
  ctx.save(); ctx.strokeStyle = rgba(C.phos, 0.25); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(rxr, ry0); ctx.lineTo(rxr, ry1); ctx.stroke();
  for (let i = 0; i <= 6; i++){
    const y = ry0 + (ry1 - ry0) * i / 6;
    const val = 1 + i;
    ctx.beginPath(); ctx.moveTo(rxr - 7, y); ctx.lineTo(rxr, y); ctx.stroke();
    L.mono(ctx, '1e' + val, rxr - 12, y + 4, 10, rgba(C.phos, 0.35), 0.6, 'right');
  }
  const markY = ry0 + (ry1 - ry0) * clamp(exp / 12, 0, 1);
  ctx.fillStyle = rgba(C.white, 0.9); ctx.fillRect(rxr - 10, markY - 1.5, 20, 3);
  ctx.restore();

  L.brackets(ctx, 44, 44, W - 88, H - 88, 26, rgba(C.phos, 0.10), 1);
  return { bloom: 1.2, chroma: 1.6, scan: 0.5 };
}

// =====================================================================
// 08 · d_float — the wall of binary32; exponent saturates
// =====================================================================
const CELLR = (function(){
  const R = mulberry32(0x1EEE);
  const a = [];
  for (let i = 0; i < 32; i++) a.push({ vx: (R() - 0.5) * 2.4, vy: 0.4 + R() * 1.6, vz: (R() - 0.35) * 2.4, sp: 0.4 + R() });
  return a;
})();

function d_float(ctx, t, u, shot){
  bg(ctx, '#030507');
  const t0 = shot.t0;
  const tHit = BEAT0 + 92 * SPB;
  const bitDur = SPB / 8;
  const tInf = BEAT0 + 93 * SPB;
  const tNaN = BEAT0 + 94 * SPB;
  const tShat = BEAT0 + 95 * SPB;
  const tEnd = shot.t1;

  const nExp = t < tHit ? 0 : clamp(Math.floor((t - tHit) / bitDur) + 1, 0, 8);
  const nanOn = t >= tNaN;
  const bitsArr = new Array(32).fill(0);
  for (let i = 0; i < nExp; i++) bitsArr[1 + i] = 1;
  if (nanOn) bitsArr[9] = 1;
  let v = 0;
  for (let i = 0; i < 32; i++) v = (v * 2 + bitsArr[i]) >>> 0;
  const hexStr = '0x' + v.toString(16).toUpperCase().padStart(8, '0');
  let expVal = 0; for (let i = 1; i <= 8; i++) expVal = expVal * 2 + bitsArr[i];
  let manVal = 0; for (let i = 9; i < 32; i++) manVal = manVal * 2 + bitsArr[i];

  const k = sat((t - tShat) / (tEnd - tShat));
  const approach = sat((t - t0 + 0.02) / (tHit - t0 + 0.06));
  const dolly = lerp(19.5, 8.4, easeInCubic(approach)) - 0.55 * sat((t - tHit) / 1.4);
  const shake = (t > tHit) ? Math.exp(-(t - tHit) * 13) : 0;
  const cam = L.makeCam({
    pos: [0, 1.18 + 0.02 * Math.sin(t * 1.7), Math.max(6.6, dolly) + k * 3.1],
    yaw: 0.05 * Math.sin(t * 0.9) + shake * 0.03 * Math.sin(t * 61),
    pitch: -0.015 + 0.012 * Math.sin(t * 0.7) + shake * 0.02 * Math.sin(t * 47),
    roll: 0.012 * Math.sin(t * 0.5) + shake * 0.02 * Math.sin(t * 39),
    fov: 1.05,
  });
  const pl = pulse(t, 0.15);

  const CW = 0.30, PX = 0.356, TOP = 1.86, BOT = -1.72;
  const cellX = i => (i - 15.5) * PX - CW * 0.5;

  // wall backplate
  const q0 = L.proj(cam, [cellX(0) - 0.06, TOP + 0.10, 0]);
  const q1 = L.proj(cam, [cellX(31) + CW + 0.06, TOP + 0.10, 0]);
  const q2 = L.proj(cam, [cellX(31) + CW + 0.06, BOT - 0.10, 0]);
  const q3 = L.proj(cam, [cellX(0) - 0.06, BOT - 0.10, 0]);
  if (q0 && q1 && q2 && q3){
    ctx.save(); ctx.globalAlpha = Math.max(0, 1 - k * 1.7);
    ctx.fillStyle = 'rgba(5,8,13,0.95)';
    ctx.beginPath(); ctx.moveTo(q0[0], q0[1]); ctx.lineTo(q1[0], q1[1]); ctx.lineTo(q2[0], q2[1]); ctx.lineTo(q3[0], q3[1]); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = rgba(nanOn ? C.alert : C.phos, 0.45 + 0.3 * pl); ctx.lineWidth = 1.2; ctx.stroke();
    ctx.strokeStyle = rgba(C.phos, 0.10); ctx.lineWidth = 1;
    for (let j = 1; j < 4; j++){
      const yy = lerp(BOT, TOP, j / 4);
      const ra = L.proj(cam, [cellX(0), yy, 0.001]), rb = L.proj(cam, [cellX(31) + CW, yy, 0.001]);
      if (ra && rb){ ctx.beginPath(); ctx.moveTo(ra[0], ra[1]); ctx.lineTo(rb[0], rb[1]); ctx.stroke(); }
    }
    ctx.restore();
  }

  // the 32 bits
  for (let i = 0; i < 32; i++){
    const bit = bitsArr[i];
    const isSign = i === 0, isExp = i >= 1 && i <= 8;
    const sk = k * k;
    const off = [CELLR[i].vx * sk * 1.7 + k * 0.5, CELLR[i].vy * sk * 0.9 - k * k * 3.4, CELLR[i].vz * sk * 1.7];
    const rot = sk * CELLR[i].sp * 2.0;
    const x0 = cellX(i);
    const cr = Math.cos(rot), sr = Math.sin(rot);
    const shrink = 1 - 0.55 * sk;
    const P = [[x0, BOT], [x0 + CW, BOT], [x0 + CW, TOP], [x0, TOP]].map(([px, py]) => {
      const dx = (px - (x0 + CW * 0.5)) * shrink, dy = (py - (BOT + TOP) * 0.5) * shrink;
      return L.proj(cam, [x0 + CW * 0.5 + dx * cr - dy * sr * 0.6 + off[0], (BOT + TOP) * 0.5 + dx * sr * 0.4 + dy * cr + off[1], off[2]]);
    });
    if (P.some(p => !p)) continue;
    const col = isSign ? C.dsLite : (isExp ? (nExp >= 8 ? C.alert : C.warm) : C.phos);
    const fillA = bit ? (0.42 + 0.34 * pl) : 0.05;
    K.polyFill(ctx, P, rgba(col, fillA * (1 - k)), rgba(col, (bit ? 0.95 : 0.30) * (1 - k)), 1);
    if (bit){
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      K.polyFill(ctx, P, rgba(col, 0.20 * (1 - k)), null, 0);
      ctx.restore();
    }
    // bit digit
    const cq = L.proj(cam, [x0 + CW * 0.5, BOT + 0.30, 0.001]);
    if (cq && k < 0.5){
      L.mono(ctx, bit ? '1' : '0', cq[0], cq[1], 13, rgba(bit ? C.white : C.phos, (bit ? 0.95 : 0.28) * (1 - k * 2)), 0, 'center');
    }
  }

  // field brackets
  const brA = (nExp >= 8 ? 1 : 0.45) * (1 - k);
  const field = (ia, ib, label, col) => {
    const a = L.proj(cam, [cellX(ia) - 0.02, BOT - 0.16, 0]);
    const b = L.proj(cam, [cellX(ib) + CW + 0.02, BOT - 0.16, 0]);
    if (!a || !b) return;
    ctx.strokeStyle = rgba(col, 0.9 * brA); ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(a[0], a[1] - 8); ctx.lineTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(b[0], b[1] - 8); ctx.stroke();
    L.mono(ctx, label, (a[0] + b[0]) * 0.5, a[1] + 24, 13, rgba(col, 0.95 * brA), 1.6, 'center');
  };
  field(0, 0, 'SIGN · 1', C.dsLite);
  field(1, 8, 'EXPONENT · 8', nExp >= 8 ? C.alert : C.warm);
  field(9, 31, 'MANTISSA · 23', C.phos);

  // readouts
  const stateCol = nanOn ? C.alert : (nExp >= 8 ? C.alert : C.cyan);
  L.mono(ctx, 'IV·ENUM 08/08', 168, 128, 12, rgba(C.phos, 0.42), 2.4);
  L.mono(ctx, 'LIMITATIONS', 168, 196, 17, rgba(C.cyan, 0.95), 3.2);
  L.mono(ctx, 'IEEE 754 binary32', 168, 226, 14, rgba(C.phos, 0.62), 2);
  L.mono(ctx, nExp < 8 ? 'EXPONENT ' + expVal + ' / 255' : 'EXPONENT = ALL ONES (255)', 168, 268, 13, rgba(stateCol, 0.92), 1.6);
  L.mono(ctx, 'BIASED EXP ' + expVal + ' − 127 = ' + (expVal - 127), 168, 292, 12, rgba(C.phos, 0.55), 1.4);
  L.mono(ctx, 'SIGNIFICAND ' + (nanOn ? 'NON-ZERO' : 'ZERO') + '  ·  MANTISSA ' + manVal, 168, 314, 12, rgba(C.phos, 0.55), 1.4);
  L.display(ctx, hexStr, 706, 356, 84, rgba(stateCol, 0.95));

  L.display(ctx, nanOn ? 'NaN' : (nExp >= 8 ? 'INF' : ''), 1752, 300, 104, rgba(stateCol, 0.95), 'right');
  L.mono(ctx, nanOn ? 'NOT A NUMBER' : (nExp >= 8 ? 'OVERFLOW · NOT A NUMBER' : 'FILLING EXPONENT'), 1752, 330, 13, rgba(stateCol, 0.85), 1.6, 'right');
  if (nExp >= 8)
    L.mono(ctx, '0x7F800000 = +inf  (EXP ALL ONES, SIGNIFICAND 0)', 1752, 356, 11, rgba(C.phos, 0.55), 1.2, 'right');
  if (nanOn){
    const fl = Math.floor(t * 30) % 2 === 0 ? 1 : 0.45;
    L.mono(ctx, 'EXP ALL ONES + SIGNIFICAND != 0  =>  NaN', 1752, 378, 11, rgba(C.alert, 0.9 * fl), 1.2, 'right');
    L.mono(ctx, '0x7FC00000 = THE CONVENTIONAL QUIET NaN', 1752, 400, 11, rgba(C.phos, 0.55 * fl), 1.2, 'right');
  }
  L.mono(ctx, 'MAX FINITE = 0x7F7FFFFF = 3.4028235e38', 168, 918, 12, rgba(C.phos, 0.45), 1.4);
  L.mono(ctx, 'OVERFLOW IS A LIMITATION, NOT A NUMBER', 168, 946, 13, rgba(nanOn ? C.alert : C.phos, nanOn ? 0.85 : 0.5), 1.5);

  // the wall shatters into current
  if (k > 0){
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const baseY = H + 100 - k * 560;
    for (const pass of [[1.6, 0.75, C.white], [7, 0.16, C.cyan]]){
      ctx.beginPath();
      for (let x = -20; x <= W + 20; x += 6){
        const y = baseY + Math.sin(x / 220 + t * 5.2) * (26 + 150 * k) + Math.sin(x / 61 - t * 3.1) * (10 + 40 * k) * k;
        if (x === -20) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = rgba(pass[2], pass[1] * Math.min(1, k * 2.2)); ctx.lineWidth = pass[0]; ctx.stroke();
    }
    const g2 = ctx.createLinearGradient(0, baseY - 160, 0, H);
    g2.addColorStop(0, 'rgba(78,255,208,0)');
    g2.addColorStop(1, 'rgba(78,255,208,' + (0.16 * k).toFixed(3) + ')');
    ctx.fillStyle = g2; ctx.fillRect(0, baseY - 160, W, H - baseY + 160);
    ctx.restore();
  }
  L.brackets(ctx, 44, 44, W - 88, H - 88, 26, rgba(C.phos, 0.10), 1);
  return { bloom: 1.2, chroma: 1.5 + 6 * k, flash: Math.max(0, shake) * 0.22 + k * 0.12, scan: 0.5 };
}

module.exports = { d_points, d_dimension, d_circle, d_ring, d_sine, d_tangent, d_infinity, d_float };
