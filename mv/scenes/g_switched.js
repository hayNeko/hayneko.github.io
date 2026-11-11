'use strict';
// SECTION IX-XII of world.execute(me); — VIBRATION / COMPLETION / LEFT / ISOLATION /
// FRAGMENTS / COMPACTION / THE GOD WALL / ILLEGAL ARGUMENTS.
// The film turns here: the green of the world drains out, blue and red take over.

const L = require('../engine/lib.js');
const K = require('./kit.js');
const { W, H, C, rgba, clamp, lerp, sat, ss, TAU,
        easeOutExpo, easeOutQuint, easeOutCubic, easeInCubic, easeInOutCubic, easeInOutQuint,
        easeOutBack, easeInExpo, beatOf, timeOfBeat, pulse, kick } = L;

// ---------------------------------------------------------------- shared

function frame(ctx){
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.lineWidth = 1; ctx.setLineDash([]);
}
function bg(ctx, col){ ctx.fillStyle = col || '#030507'; ctx.fillRect(0, 0, W, H); }
function decay(t, tk, tau){ const d = t - tk; return d < 0 ? 0 : Math.exp(-d / tau); }
function whichHit(t, arr){ let k = -1; for (let i = 0; i < arr.length; i++){ if (arr[i] <= t + 1e-6) k = i; } return k; }
function ghost(ctx, str, y, size, col, a){
  if (a <= 0.004) return;
  L.withA(ctx, a, () => L.display(ctx, str, W / 2, y, size, col, 'center'));
}
function hatch(ctx, x, y, w, h, step, color){
  if (w <= 0.5 || h <= 0.5) return;
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.strokeStyle = color; ctx.lineWidth = 1;
  for (let px = x - h; px < x + w; px += step){
    ctx.beginPath(); ctx.moveTo(px, y + h); ctx.lineTo(px + h, y); ctx.stroke();
  }
  ctx.restore();
}
function sector(ctx, cx, cy, r0, r1, a0, a1){
  ctx.beginPath(); ctx.arc(cx, cy, r1, a0, a1);
  ctx.arc(cx, cy, r0, a1, a0, true); ctx.closePath();
}
function plate(ctx, x, y, w, h, a){
  ctx.fillStyle = 'rgba(3,5,7,' + (a === undefined ? 0.78 : a) + ')';
  ctx.fillRect(x, y, w, h);
}
// the chair: the film's object for "a place someone was". wireframe, no cushion.
const CH_P = {
  s00: [-0.28, 0.45, -0.27], s10: [0.28, 0.45, -0.27], s11: [0.28, 0.45, 0.29], s01: [-0.28, 0.45, 0.29],
  b00: [-0.21, 1.02, -0.25], b10: [0.21, 1.02, -0.25],
  m00: [-0.24, 0.78, -0.25], m10: [0.24, 0.78, -0.25],
  l00: [-0.24, 0.00, -0.24], l10: [0.24, 0.00, -0.24], l11: [0.24, 0.00, 0.24], l01: [-0.24, 0.00, 0.24]
};
const CH_E = [
  ['s00', 's10'], ['s10', 's11'], ['s11', 's01'], ['s01', 's00'],
  ['s00', 'b00'], ['s10', 'b10'], ['b00', 'b10'], ['m00', 'm10'], ['b00', 'm00'], ['b10', 'm10'],
  ['s00', 'l00'], ['s10', 'l10'], ['s11', 'l11'], ['s01', 'l01'],
  ['l00', 'l10'], ['l11', 'l01']
];
function chair3(ctx, cam, pos, rot, sc, color, alpha, lw){
  const cy = Math.cos(rot), sy = Math.sin(rot);
  const P = {};
  for (const key in CH_P){
    const p = CH_P[key];
    const x = p[0] * sc, y = p[1] * sc, z = p[2] * sc;
    P[key] = L.proj(cam, [pos[0] + x * cy + z * sy, pos[1] + y, pos[2] - x * sy + z * cy]);
  }
  const c0 = P.s00;
  if (!c0) return;
  const a2 = alpha * clamp(1.55 - c0[2] / 22, 0.22, 1);
  const LW = lw || 1.5;
  const poly = (keys, fill) => {
    const pts = [];
    for (let i = 0; i < keys.length; i++){ const q = P[keys[i]]; if (!q) return; pts.push(q); }
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    if (fill){ ctx.fillStyle = fill; ctx.fill(); }
    ctx.strokeStyle = rgba(color, 0.62 * a2); ctx.lineWidth = LW; ctx.stroke();
  };
  // shadow on the floor, so the chair sits in the room
  const fp = P.l11, fp2 = P.l00;
  if (fp && fp2){
    ctx.strokeStyle = rgba(color, 0.13 * a2); ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse((fp[0] + fp2[0]) / 2, (fp[1] + fp2[1]) / 2 + 2, Math.abs(fp[0] - fp2[0]) * 0.62, Math.abs(fp[0] - fp2[0]) * 0.16, 0, 0, TAU);
    ctx.stroke();
  }
  poly(['s00', 's10', 'b10', 'b00'], rgba(color, 0.055 * a2));   // back panel
  poly(['s00', 's10', 's11', 's01'], rgba(color, 0.13 * a2));    // seat
  ctx.lineWidth = LW;
  for (let i = 0; i < CH_E.length; i++){
    const a = P[CH_E[i][0]], b = P[CH_E[i][1]];
    if (!a || !b) continue;
    if (i < 7) continue;                                         // panels already outline these
    ctx.strokeStyle = rgba(color, 0.62 * a2);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  }
}

// ---------------------------------------------------------------- IX. VIBRATION
// k: phonons are quantised lattice vibration · thermal noise V = sqrt(4kTR df) · clock jitter
function i_vibration(ctx, t, u, shot){
  frame(ctx); bg(ctx, '#04060A');
  const t0 = shot.t0, t1 = shot.t1;
  const syncT = timeOfBeat(230);                        // the word VIBRATIONS lands here
  const syn = ss(syncT - 0.80, syncT + 0.10, t);
  const ringK = easeInOutCubic(ss(t1 - 0.52, t1 - 0.04, t));
  const dr = t - t0;

  const yawV = 0.62 + dr * 0.085, radV = 7.6 - 0.5 * ss(t0, t1, t);
  const cam = L.makeCam({
    pos: [Math.sin(yawV) * radV, 0.26, Math.cos(yawV) * radV],
    yaw: yawV,
    pitch: -0.028 + Math.sin(dr * 0.32) * 0.040,
    fov: 1.00
  });

  ghost(ctx, 'VIBRATIONS', 236, 148, C.dsLite, 0.13 * syn);

  const NX = 5, NY = 4, NZ = 5, SP = 1.05;
  const N = NX * NY * NZ;
  const idxOf = (i, j, k) => (i * NY + j) * NZ + k;
  const P = new Array(N), S = new Array(N);
  const bph = beatOf(t);
  const pump = 0.42 + 0.58 * kick(t, 1, 0.17);
  let n = 0;
  for (let i = 0; i < NX; i++) for (let j = 0; j < NY; j++) for (let k = 0; k < NZ; k++){
    const bx = (i - (NX - 1) / 2) * SP, by = (j - (NY - 1) / 2) * SP, bz = (k - (NZ - 1) / 2) * SP;
    const nx = L.noise2(i * 3.3 + t * 6.1, j * 5.1 + k * 2.7) - 0.5;
    const ny = L.noise2(j * 4.7 - t * 5.3 + 11.3, k * 3.9 + i * 6.1) - 0.5;
    const nz = L.noise2(k * 5.9 + t * 7.7 + 23.1, i * 4.3 + j * 2.9) - 0.5;
    const th = 0.62;
    const ph = (i / (NX - 1)) * TAU - bph * TAU;
    const cw = 0.17 * pump;
    let px = bx + lerp(nx * th, 0.045 * Math.sin(ph), syn);
    let py = by + lerp(ny * th, cw * Math.sin(ph), syn);
    let pz = bz + lerp(nz * th, cw * 0.55 * Math.sin(ph + 1.2), syn);
    const a = (n / N) * TAU + dr * 0.22, rr = 2.75;
    px = lerp(px, Math.cos(a) * rr, ringK);
    py = lerp(py, Math.sin(a) * rr, ringK);
    pz = lerp(pz, Math.sin(a * 3) * 0.18, ringK);
    S[n] = [bx, by, bz]; P[n] = [px, py, pz];
    n++;
  }

  const Q = new Array(N), QS = new Array(N), D = new Array(N), ord = [];
  for (let i = 0; i < N; i++){
    QS[i] = L.proj(cam, S[i]);
    const q = L.proj(cam, P[i]);
    Q[i] = q;
    if (q){ D[i] = q[2]; ord.push(i); }
  }
  ord.sort((a, b) => D[b] - D[a]);

  // the ideal site: a small cross the atom has left behind
  ctx.lineWidth = 1;
  for (let i = 0; i < N; i++){
    const q = QS[i]; if (!q) continue;
    const a2 = clamp(1.3 - q[2] / 13, 0.04, 0.30) * (1 - ringK) * 0.55;
    ctx.strokeStyle = rgba(C.ds, a2);
    ctx.beginPath();
    ctx.moveTo(q[0] - 4, q[1]); ctx.lineTo(q[0] + 4, q[1]);
    ctx.moveTo(q[0], q[1] - 4); ctx.lineTo(q[0], q[1] + 4);
    ctx.stroke();
  }

  ctx.globalCompositeOperation = 'lighter';
  // bond lattice
  const bondA = 1 - ringK;
  if (bondA > 0.01){
    ctx.lineWidth = 1.1;
    for (let i = 0; i < NX; i++) for (let j = 0; j < NY; j++) for (let k = 0; k < NZ; k++){
      const a = idxOf(i, j, k), qa = Q[a]; if (!qa) continue;
      const nb = [];
      if (i + 1 < NX) nb.push(idxOf(i + 1, j, k));
      if (j + 1 < NY) nb.push(idxOf(i, j + 1, k));
      if (k + 1 < NZ) nb.push(idxOf(i, j, k + 1));
      for (let m = 0; m < nb.length; m++){
        const qb = Q[nb[m]]; if (!qb) continue;
        const d = (qa[2] + qb[2]) * 0.5;
        const al = clamp(1.55 - d / 11, 0.04, 1) * bondA * 0.64;
        ctx.strokeStyle = rgba(syn > 0.5 ? C.cyan : C.dsLite, al);
        ctx.beginPath(); ctx.moveTo(qa[0], qa[1]); ctx.lineTo(qb[0], qb[1]); ctx.stroke();
      }
    }
  }
  // ring of queues: the exit of this thought
  if (ringK > 0.01){
    ctx.lineWidth = 1.2;
    for (let i = 0; i < N; i++){
      const a = Q[i], b = Q[(i + 1) % N];
      if (!a || !b) continue;
      ctx.strokeStyle = rgba(C.cyan, 0.42 * ringK);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
  }
  // displacement vectors: chaos -> a coherent field
  ctx.lineWidth = 1.1;
  for (let i = 0; i < N; i++){
    const s = QS[i], q = Q[i];
    if (!s || !q) continue;
    const dx = q[0] - s[0], dy = q[1] - s[1];
    if (Math.abs(dx) + Math.abs(dy) < 1.5) continue;
    const a2 = clamp(1.4 - q[2] / 12, 0.05, 1) * (0.20 + 0.26 * syn) * (1 - ringK);
    ctx.strokeStyle = rgba(syn > 0.5 ? C.cyan : C.warm, a2);
    ctx.beginPath(); ctx.moveTo(s[0], s[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
  }
  // atoms
  for (let m = 0; m < ord.length; m++){
    const i = ord[m], q = Q[i];
    const f = clamp(1.35 - q[2] / 12, 0.15, 1);
    const r = clamp(q[3] * 0.038, 1.8, 7.6);
    ctx.fillStyle = rgba(C.dsLite, 0.17 * f * (0.5 + 0.5 * syn));
    L.fillCircle(ctx, q[0], q[1], r * 2.9);
    ctx.fillStyle = rgba(syn > 0.55 ? C.white : C.dsLite, 0.90 * f);
    L.fillCircle(ctx, q[0], q[1], r * 0.72);
  }
  ctx.globalCompositeOperation = 'source-over';

  // beat-locked shock rings once the lattice is coherent
  if (syn > 0.55){
    const bp = beatOf(t); const ph = bp - Math.floor(bp);
    const a2 = Math.exp(-ph * 5.5) * (syn - 0.55) / 0.45;
    const rr = 130 + ph * 560;
    ctx.strokeStyle = rgba(C.cyan, 0.26 * a2); ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(960, 540, rr, 0, TAU); ctx.stroke();
    ctx.strokeStyle = rgba(C.white, 0.13 * a2); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(960, 540, rr * 0.66, 0, TAU); ctx.stroke();
  }

  // ---- left: the thermal noise, which becomes a mode
  const sx0 = 146, sx1 = 640, sy = 872, sh = 60;
  ctx.strokeStyle = rgba(C.phos, 0.14); ctx.lineWidth = 1;
  ctx.strokeRect(sx0 + .5, sy - sh / 2 + .5, sx1 - sx0, sh);
  ctx.beginPath();
  for (let i = 0; i <= 140; i++){
    const xx = sx0 + (sx1 - sx0) * i / 140, f = i / 140;
    const chaos = (L.noise2(i * 1.9, t * 9.3) - 0.5) * 2;
    const coh = Math.sin(f * TAU * 1.5 - beatOf(t) * TAU);
    const v = lerp(chaos, coh, syn) * 0.5;
    const yy = sy - v * sh * 0.80;
    if (i === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
  }
  ctx.strokeStyle = rgba(syn > 0.5 ? C.cyan : C.warm, 0.85); ctx.lineWidth = 1.4; ctx.stroke();
  ctx.strokeStyle = rgba(C.phos, 0.10);
  ctx.beginPath(); ctx.moveTo(sx0, sy); ctx.lineTo(sx1, sy); ctx.stroke();
  L.mono(ctx, 'THERMAL NOISE  V = √(4kTRΔf)', sx0, sy - sh / 2 - 12, 12, rgba(C.phos, 0.55), 1.2);
  L.mono(ctx, syn > 0.5 ? 'COHERENT MODE' : 'INCOHERENT', sx1, sy - sh / 2 - 12, 12,
    rgba(syn > 0.5 ? C.cyan : C.warm, 0.75), 2, 'right');

  // ---- top left: the datasheet
  L.spec(ctx, 150, 168, [
    ['PHONON', 'QUANTISED LATTICE VIBRATION'],
    ['NOISE', 'THERMAL · V = √(4kTRΔf)'],
    ['JITTER', 'CLOCK EDGE PERIOD σt'],
    ['STATE', syn > 0.5 ? 'PHASE-LOCKED TO THE BEAT' : 'INDEPENDENT THERMAL']
  ], { size: 13, lh: 25, color: C.cyan, kw: 78, alpha: ss(t0 + 0.15, t0 + 0.55, t) });

  // ---- right: coherence meter
  const mw = 250, mx = 1530, my = 316;
  L.mono(ctx, 'PHASE COHERENCE', mx, my - 24, 12, rgba(C.phos, 0.45), 2.2);
  ctx.strokeStyle = rgba(C.phos, 0.22); ctx.lineWidth = 1;
  ctx.strokeRect(mx + .5, my + .5, mw, 16);
  ctx.fillStyle = rgba(C.cyan, 0.7);
  ctx.fillRect(mx + 1, my + 1, (mw - 2) * syn, 14);
  for (let i = 0; i <= 8; i++){
    const px = mx + mw * i / 8;
    ctx.strokeStyle = rgba(C.phos, 0.28);
    ctx.beginPath(); ctx.moveTo(px, my + 16); ctx.lineTo(px, my + (i % 4 === 0 ? 28 : 22)); ctx.stroke();
  }
  L.mono(ctx, 'INDEPENDENT', mx, my + 44, 11, rgba(C.phos, 0.32), 1);
  L.mono(ctx, 'LOCKED', mx + mw, my + 44, 11, rgba(C.cyan, 0.65), 1, 'right');
  if (syn > 0.6){
    const a2 = ss(0.6, 0.95, syn) * (0.55 + 0.45 * pulse(t, 0.22));
    L.mono(ctx, 'PHASE LOCK', mx + mw, my + 92, 26, rgba(C.white, 0.85 * a2), 5, 'right');
  }
  return { bloom: 1.05 + 0.35 * syn, chroma: 1.3 + 2.5 * syn + 6 * ringK, scan: 0.45 };
}

// ---------------------------------------------------------------- IX. COMPLETION
// k: SQ ring -> kernel -> CQ ring · a completion is an entry that says done · no interrupt, just a flag
function i_completion(ctx, t, u, shot){
  frame(ctx); bg(ctx, '#030508');
  const t0 = shot.t0, t1 = shot.t1;
  const NS = 24;
  const tA = t0 + 0.20, tB = 110.46;
  const cx = 800, cy = 528, r0 = 230, r1 = 318;
  const flipAt = i => tA + (tB - tA) * Math.pow((i + 1) / NS, 1.35);
  const scrollK = ss(t1 - 0.26, t1 - 0.02, t);
  let nDone = 0;
  while (nDone < NS && flipAt(nDone) <= t) nDone++;
  const done = nDone >= NS;
  const doneK = ss(tB, tB + 0.10, t);
  const fl = done ? decay(t, tB, 0.20) : 0;

  // faint ring scaffold
  ctx.strokeStyle = rgba(C.ds, 0.18); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(cx, cy, r1 + 26, 0, TAU); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, r0 - 26, 0, TAU); ctx.stroke();
  for (let a = 0; a < 360; a += 6){
    const rad = a * Math.PI / 180;
    const big = a % 30 === 0;
    ctx.strokeStyle = rgba(C.dsLite, big ? 0.35 : 0.14); ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(rad) * (r1 + 26), cy + Math.sin(rad) * (r1 + 26));
    ctx.lineTo(cx + Math.cos(rad) * (r1 + (big ? 40 : 33)), cy + Math.sin(rad) * (r1 + (big ? 40 : 33)));
    ctx.stroke();
  }

  // the 24 slots
  const A0 = -Math.PI / 2;
  const step = TAU / NS;
  for (let i = 0; i < NS; i++){
    const a0 = A0 + i * step + 0.014, a1 = A0 + (i + 1) * step - 0.014;
    const fi = flipAt(i);
    const on = t >= fi;
    const f2 = on ? Math.exp(-(t - fi) / 0.11) : 0;
    const push = scrollK * (i / NS) * 26;
    sector(ctx, cx - push, cy, r0, r1, a0, a1);
    ctx.fillStyle = on ? rgba(C.cyan, 0.10 + 0.55 * f2) : rgba(C.ds, 0.055);
    ctx.fill();
    ctx.strokeStyle = on ? rgba(C.cyan, 0.55 + 0.45 * f2) : rgba(C.dsLite, 0.30);
    ctx.lineWidth = on ? 1.6 : 1;
    ctx.stroke();
    if (on){
      const am = (a0 + a1) / 2;
      ctx.fillStyle = rgba(C.white, 0.30 + 0.60 * f2);
      const rr = (r0 + r1) / 2;
      ctx.fillRect(cx - push + Math.cos(am) * rr - 2.5, cy + Math.sin(am) * rr - 2.5, 5, 5);
    }
  }

  // head / tail pointer
  const curIdx = Math.min(nDone, NS - 1);
  const pa = A0 + (curIdx + 0.5) * step;
  if (!done){
    ctx.strokeStyle = rgba(C.white, 0.75); ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(pa) * (r0 - 34), cy + Math.sin(pa) * (r0 - 34));
    ctx.lineTo(cx + Math.cos(pa) * (r1 + 54), cy + Math.sin(pa) * (r1 + 54));
    ctx.stroke();
    const hx = cx + Math.cos(pa) * (r1 + 64), hy = cy + Math.sin(pa) * (r1 + 64);
    ctx.fillStyle = rgba(C.white, 0.85);
    ctx.beginPath();
    ctx.moveTo(hx + Math.cos(pa) * 12, hy + Math.sin(pa) * 12);
    ctx.lineTo(hx + Math.cos(pa + 2.4) * 9, hy + Math.sin(pa + 2.4) * 9);
    ctx.lineTo(hx + Math.cos(pa - 2.4) * 9, hy + Math.sin(pa - 2.4) * 9);
    ctx.closePath(); ctx.fill();
    L.mono(ctx, 'CQ TAIL', hx + Math.cos(pa) * 26, hy + Math.sin(pa) * 26, 11, rgba(C.phos, 0.6), 1.6, 'center');
  }

  // centre readout
  L.mono(ctx, 'CQE', cx, cy - 96, 12, rgba(C.phos, 0.42), 5, 'center');
  L.display(ctx, String(nDone), cx - 16, cy + 30, 122, done ? C.white : C.dsLite, 'right');
  L.mono(ctx, '/' + NS, cx + 4, cy + 24, 38, rgba(C.phos, 0.42), 2);
  L.mono(ctx, done ? 'ALL COMPLETED' : 'COMPLETING', cx, cy + 66, 12,
    rgba(done ? C.cyan : C.phos, done ? 0.95 : 0.55), 3, 'center');
  if (done){
    ctx.strokeStyle = rgba(C.cyan, 0.55 * (0.4 + 0.6 * fl)); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, r0 - 40, 0, TAU); ctx.stroke();
    L.display(ctx, 'COMPLETE', cx, cy + 476, 92, rgba(C.white, 0.92 * doneK), 'center');
  }

  // ---- right panel: what a CQE actually is
  const px = 1290;
  L.mono(ctx, 'io_uring', px, 252, 30, rgba(C.dsLite, 0.95), 5);
  L.mono(ctx, 'SHARED MEMORY RINGS', px, 280, 11, rgba(C.phos, 0.45), 2.4);
  L.spec(ctx, px, 330, [
    ['SQ RING', 'SUBMISSION · USER → KERNEL'],
    ['CQ RING', 'COMPLETION · KERNEL → USER'],
    ['CQE', '16 BYTE DATA RECORD'],
    ['WAKEUP', 'USER SPACE POLLS THE TAIL'],
    ['INTERRUPT', 'NONE']
  ], { size: 13, lh: 26, color: C.cyan, kw: 96, alpha: ss(t0 + 0.25, t0 + 0.6, t) });

  // the 16-byte record, drawn to scale
  const ry = 520, rh = 46, rw = 480, sc = rw / 16;
  const segs = [['user_data', 8], ['res', 4], ['flags', 4]];
  L.mono(ctx, 'struct io_uring_cqe', px, ry - 12, 12, rgba(C.phos, 0.5), 1.2);
  let sx = px;
  for (let i = 0; i < segs.length; i++){
    const w = segs[i][1] * sc;
    ctx.fillStyle = i === 0 ? rgba(C.ds, 0.22) : rgba(C.ds, 0.12);
    ctx.fillRect(sx, ry, w, rh);
    ctx.strokeStyle = rgba(i === 0 ? C.cyan : C.dsLite, 0.7); ctx.lineWidth = 1;
    ctx.strokeRect(sx + .5, ry + .5, w - 1, rh - 1);
    L.mono(ctx, segs[i][0], sx + 8, ry + 21, 11, rgba(C.white, 0.8), 0.6);
    L.mono(ctx, segs[i][1] + ' B', sx + 8, ry + 37, 10, rgba(C.phos, 0.5), 0.6);
    sx += w;
  }
  L.mono(ctx, '0', px, ry + rh + 16, 10, rgba(C.phos, 0.4), 0);
  L.mono(ctx, '16 B', px + rw, ry + rh + 16, 10, rgba(C.phos, 0.55), 0, 'right');

  const nk = ss(t0 + 1.0, t0 + 1.35, t);
  if (nk > 0){
    L.mono(ctx, 'NOT AN INTERRUPT', px, ry + 130, 24, rgba(C.alert, 0.9 * nk), 3.4);
    const wtxt = L.monoW(ctx, 'NOT AN INTERRUPT', 24, 3.4);
    ctx.strokeStyle = rgba(C.alert, 0.85 * nk); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(px - 6, ry + 122); ctx.lineTo(px + wtxt + 8, ry + 122); ctx.stroke();
    L.mono(ctx, 'A CQE IS DATA. IT SITS IN MEMORY UNTIL READ.', px, ry + 162, 11, rgba(C.phos, 0.5), 1.2);
  }

  L.mono(ctx, 'POLL: USER SPACE READS THE CQ TAIL — NO WAKEUP, NO HANDLER', 146, 896, 13, rgba(C.phos, 0.45 * ss(t0 + 0.6, t0 + 1.2, t)), 1.4);
  L.brackets(ctx, cx - r1 - 70, cy - r1 - 70, (r1 + 70) * 2, (r1 + 70) * 2, 26, rgba(C.ds, 0.30), 1);

  return { bloom: 1.0 + 0.5 * fl, chroma: 1.6 + 7 * fl, scan: 0.5, flash: doneK * 0.10 * (1 - ss(tB, tB + 0.4, t)) };
}

// ---------------------------------------------------------------- X. LEFT
// k: retry with exponential backoff 1,2,4,8,16 s · ESTABLISHED -> FIN_WAIT -> CLOSE_WAIT -> CLOSED
//    ok: an orphaned process is reparented to init
const HITS_L = [110.90, 112.22, 113.10, 114.18, 114.92, 115.78];
const BACK = ['1 s', '2 s', '4 s', '8 s', '16 s', 'CLOSED'];

function j_left(ctx, t, u, shot){
  frame(ctx); bg(ctx, '#030508');
  const t0 = shot.t0, t1 = shot.t1;
  const hi = whichHit(t, HITS_L);
  const nHits = hi + 1;
  const lastHit = hi >= 0 ? HITS_L[hi] : t0 - 1;
  const fl = decay(t, lastHit, 0.11);
  const sweep = sat((t - lastHit) / 0.24);

  const cam = L.makeCam({ pos: [0.10, 1.44, 0.9], yaw: 0.0, pitch: -0.125, fov: 1.10 });
  K.floorGrid(ctx, cam, 13, 1.15, { color: C.ds, alpha: 0.19, lw: 1 });
  ctx.strokeStyle = rgba(C.ds, 0.16); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, 430); ctx.lineTo(1120, 430); ctx.stroke();

  // the same empty chair, six times, each one further and dimmer
  for (let k = 0; k < 6; k++){
    const ap = ss(HITS_L[k] - 0.02, HITS_L[k] + 0.16, t);
    if (ap <= 0.004) continue;
    const z = -(2.1 + k * 1.0), x = -1.6 + k * 0.62;
    const dim = Math.pow(0.87, k);
    chair3(ctx, cam, [x, 0, z], 0.42 - k * 0.07, 1, k < 2 ? C.cyan : C.dsLite, 0.95 * dim * ap, 1.6);
    const q = L.proj(cam, [x, 0.80, z]);
    if (q) L.mono(ctx, '0' + (k + 1), q[0], q[1], clamp(q[3] * 0.045, 7, 15), rgba(C.phos, 0.42 * dim * ap), 1, 'center');
  }

  // the strike: a scan line crossing the room on every hit
  if (hi >= 0 && sweep < 1){
    const px = 140 + 1700 * sweep;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const gg = ctx.createLinearGradient(px - 64, 0, px, 0);
    gg.addColorStop(0, 'rgba(150,205,255,0)');
    gg.addColorStop(1, 'rgba(180,225,255,' + (0.055 * (1 - sweep)) + ')');
    ctx.fillStyle = gg; ctx.fillRect(px - 64, 210, 64, 760);
    ctx.strokeStyle = 'rgba(210,240,255,' + (0.34 * (1 - sweep)) + ')';
    ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.moveTo(px, 190); ctx.lineTo(px, 980); ctx.stroke();
    ctx.restore();
  }

  // ---- the numeral the frame prints
  const label = hi >= 0 ? BACK[hi] : '—';
  const numCol = hi <= 3 ? C.phos : hi === 4 ? C.warm : C.alert;
  L.mono(ctx, 'RETRY · EXPONENTIAL BACKOFF', 250, 214, 12, rgba(C.phos, 0.42), 4);
  L.withA(ctx, 0.94, () => L.display(ctx, label, 250, 360, 152, numCol, 'left'));
  L.mono(ctx, hi >= 5 ? 'THE INTERVAL DOES NOT STOP' : 'INTERVAL × 2 AT EACH RETRY', 250, 402, 12, rgba(C.phos, 0.38), 2.2);
  if (hi >= 0){
    L.mono(ctx, 'EVENT ' + (hi + 1) + ' / 6', 700, 402, 12, rgba(C.alert, 0.60), 3);
  }

  // retry schedule ruler: the intervals are visibly growing
  const rx0 = 250, rx1 = 810, ry = 452;
  ctx.strokeStyle = rgba(C.phos, 0.18); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(rx0, ry); ctx.lineTo(rx1, ry); ctx.stroke();
  for (let i = 0; i < 6; i++){
    const px = lerp(rx0, rx1, (HITS_L[i] - t0) / (t1 - t0));
    const on = i <= hi;
    ctx.strokeStyle = rgba(on ? C.cyan : C.phos, on ? 0.9 : 0.25); ctx.lineWidth = on ? 2 : 1;
    ctx.beginPath(); ctx.moveTo(px, ry - (on ? 12 : 6)); ctx.lineTo(px, ry + (on ? 12 : 6)); ctx.stroke();
    if (on) L.mono(ctx, BACK[i], px, ry + 26, 10, rgba(i === 5 ? C.alert : C.phos, 0.75), 0.6, 'center');
  }
  const nx = lerp(rx0, rx1, sat((t - t0) / (t1 - t0)));
  ctx.fillStyle = rgba(C.white, 0.55); ctx.fillRect(nx - 1, ry - 16, 2, 32);

  // ---- session table
  const tx = 1150;
  L.mono(ctx, 'SESSION TABLE', tx, 218, 12, rgba(C.phos, 0.45), 3);
  L.mono(ctx, 'SID', tx, 250, 10, rgba(C.phos, 0.30), 1.4);
  L.mono(ctx, 'PEER', tx + 150, 250, 10, rgba(C.phos, 0.30), 1.4);
  L.mono(ctx, 'STATE', tx + 250, 250, 10, rgba(C.phos, 0.30), 1.4);
  ctx.strokeStyle = rgba(C.phos, 0.16); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(tx, 258); ctx.lineTo(tx + 630, 258); ctx.stroke();
  for (let i = 0; i < 6; i++){
    const dead = i < nHits;
    const y = 282 + i * 31;
    const a2 = dead ? 0.30 : 0.85;
    const col = dead ? C.alert : C.phos;
    L.mono(ctx, 'sock 0' + (i + 1), tx, y, 15, rgba(col, a2), 1);
    L.mono(ctx, 'me', tx + 150, y, 15, rgba(col, a2 * 0.75), 1);
    L.mono(ctx, dead ? 'CLOSED' : 'ESTABLISHED', tx + 250, y, 15, rgba(col, dead ? 0.55 : 0.85), 1);
    if (dead){
      ctx.strokeStyle = rgba(C.alert, 0.45); ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(tx - 4, y - 5); ctx.lineTo(tx + 470, y - 5); ctx.stroke();
    }
  }
  if (nHits >= 6){
    L.mono(ctx, 'NO SESSIONS', tx, 282 + 6 * 31, 15, rgba(C.alert, 0.38), 2);
    const ap2 = ss(HITS_L[5] + 0.5, HITS_L[5] + 0.85, t);
    if (ap2 > 0.004){
      const y = 282 + 6 * 31 + 40;
      L.mono(ctx, 'sock 07', tx, y, 15, rgba(C.phos, 0.8 * ap2), 1);
      L.mono(ctx, 'init', tx + 150, y, 15, rgba(C.phos, 0.62 * ap2), 1);
      L.mono(ctx, 'ESTABLISHED', tx + 250, y, 15, rgba(C.phos, 0.8 * ap2), 1);
      L.mono(ctx, 'REPARENTED TO INIT — AN ORPHAN IS ALWAYS ADOPTED', tx, y + 20, 10.5, rgba(C.cyan, 0.6 * ap2), 1.1);
    }
  }

  // ---- socket state machine
  const ST = ['ESTABLISHED', 'FIN_WAIT', 'CLOSE_WAIT', 'CLOSED'];
  const cur = [0, 0, 1, 1, 2, 2, 3][Math.min(6, Math.max(0, nHits))];
  L.mono(ctx, 'SOCKET STATE', tx, 600, 11, rgba(C.phos, 0.40), 2.6);
  for (let i = 0; i < 4; i++){
    const bx = tx + i * 162, by = 618, bw = 142, bh = 40;
    const on = i === cur, past = i < cur;
    const a2 = on ? 0.95 : past ? 0.32 : 0.13;
    const col = on ? (i === 3 ? C.alert : C.cyan) : C.phos;
    ctx.fillStyle = rgba(C.ds, on ? 0.20 : 0.05);
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = rgba(col, a2); ctx.lineWidth = on ? 1.8 : 1;
    ctx.strokeRect(bx + .5, by + .5, bw - 1, bh - 1);
    L.mono(ctx, ST[i], bx + bw / 2, by + 25, 10.5, rgba(col, a2), 0.5, 'center');
    if (i < 3){
      ctx.strokeStyle = rgba(C.phos, past ? 0.4 : 0.16); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(bx + bw + 4, by + bh / 2); ctx.lineTo(bx + bw + 15, by + bh / 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(bx + bw + 15, by + bh / 2); ctx.lineTo(bx + bw + 10, by + bh / 2 - 3.5);
      ctx.moveTo(bx + bw + 15, by + bh / 2); ctx.lineTo(bx + bw + 10, by + bh / 2 + 3.5); ctx.stroke();
    }
  }

  // ---- peer heartbeat, flattening
  const hx0 = tx, hx1 = 1780, hy = 812;
  L.mono(ctx, 'PEER HEARTBEAT', hx0, 714, 11, rgba(C.phos, 0.40), 2.6);
  ctx.strokeStyle = rgba(C.phos, 0.13); ctx.lineWidth = 1;
  ctx.strokeRect(hx0 + .5, 730.5, hx1 - hx0, 120);
  const AMPS = [1, 0.78, 0.58, 0.40, 0.24, 0.10];
  const xEnd = hx0 + (hx1 - hx0) * sat((t - t0) / (t1 - t0));
  ctx.beginPath();
  for (let x = hx0; x <= xEnd; x += 2){
    const tt = lerp(t0, t1, (x - hx0) / (hx1 - hx0));
    let v = 0;
    for (let i = 0; i < 6; i++){
      const d = tt - HITS_L[i];
      if (d < -0.05 || d > 0.5) continue;
      v += AMPS[i] * Math.exp(-Math.pow((d - 0.015) / 0.020, 2));
      v -= AMPS[i] * 0.30 * Math.exp(-Math.pow((d + 0.005) / 0.014, 2));
    }
    const wig = (L.noise2(x * 0.21, 5.1) - 0.5) * 1.8 * (1 - Math.min(1, Math.abs(v) * 2));
    const yy = hy - v * 44 + wig;
    if (x === hx0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
  }
  ctx.strokeStyle = rgba(C.cyan, 0.85); ctx.lineWidth = 1.3; ctx.stroke();
  ctx.strokeStyle = rgba(C.phos, 0.10);
  ctx.beginPath(); ctx.moveTo(hx0, hy); ctx.lineTo(hx1, hy); ctx.stroke();
  if (nHits >= 6){
    const a2 = ss(HITS_L[5] + 0.15, HITS_L[5] + 0.5, t);
    L.mono(ctx, 'FLATLINE', hx1 - 6, 754, 12, rgba(C.alert, 0.8 * a2), 3, 'right');
  }

  L.brackets(ctx, 236, 190, 640, 320, 20, rgba(C.ds, 0.22), 1);
  return { bloom: 0.95, chroma: 1.3 + 4 * fl, scan: 0.5, flash: 0.055 * fl };
}

// ---------------------------------------------------------------- X. ISOLATION
// k: ADIC isolation ladder RU / RC / RR / SERIALIZABLE · isolation is a promise about what you cannot see
function j_isolation(ctx, t, u, shot){
  frame(ctx); bg(ctx, '#020306');
  const t0 = shot.t0, t1 = shot.t1;
  const BW = W / 4;
  const SW = easeInOutCubic(ss(t0 - 0.22, t0 + 0.46, t));
  const LV = [
    { l1: 'READ', l2: 'UNCOMMITTED', ab: 'RU', note: 'DIRTY READ ALLOWED', col: C.phos, bars: 0, cov: 0, dark: 0.00 },
    { l1: 'READ', l2: 'COMMITTED', ab: 'RC', note: 'NO DIRTY READ', col: C.cyan, bars: 2, cov: 0.42, dark: 0.10 },
    { l1: 'REPEATABLE', l2: 'READ', ab: 'RR', note: 'NO NON-REPEATABLE READ', col: C.dsLite, bars: 3, cov: 0.68, dark: 0.20 },
    { l1: 'SERIALIZABLE', l2: '', ab: 'SER', note: 'NO PHANTOM READ', col: C.alert, bars: 5, cov: 0.77, dark: 0.16 }
  ];
  const leftIn = ss(t0 + 0.55, t0 + 0.95, t);

  for (let b = 0; b < 4; b++){
    const bx = b * BW, L2 = LV[b];
    const rev = ss(b * 0.14, b * 0.14 + 0.40, SW);
    ctx.save();
    ctx.beginPath(); ctx.rect(bx, 0, BW, H); ctx.clip();

    ctx.fillStyle = 'rgba(4,8,16,' + (0.35 + 0.5 * b * 0.3) + ')';
    ctx.fillRect(bx, 0, BW, H);

    const aRoom = (1 - 0.16 * b) * (0.35 + 0.65 * rev) * (b === 3 ? 1 - 0.25 * leftIn : 1);
    isoRoom(ctx, bx, aRoom, L2.dark, b === 3 ? C.love : C.white);

    // what the level hides
    if (L2.bars > 0){
      const bh = (640 / L2.bars) * L2.cov;
      for (let i = 0; i < L2.bars; i++){
        const yy = 300 + i * (640 / L2.bars);
        ctx.fillStyle = '#020306';
        ctx.fillRect(bx, yy, BW, bh * rev);
        ctx.strokeStyle = rgba(C.alert, 0.16 * rev);
        ctx.lineWidth = 1;
        ctx.strokeRect(bx + .5, yy + .5, BW - 1, Math.max(0, bh * rev - 1));
      }
    }
    ctx.fillStyle = 'rgba(0,0,0,' + (L2.dark * 0.9 + 0.05 * b) + ')';
    ctx.fillRect(bx, 0, BW, H);

    // labels
    L.mono(ctx, 'ANSI SQL-92 · ACID', bx + 20, 128, 10, rgba(L2.col, 0.42), 1.6);
    L.mono(ctx, L2.l1, bx + 20, 170, 20, rgba(L2.col, 0.95), 2.4);
    if (L2.l2) L.mono(ctx, L2.l2, bx + 20, 196, 20, rgba(L2.col, 0.95), 2.4);
    L.mono(ctx, L2.ab, bx + 20, 262, 40, rgba(L2.col, 0.55), 2);
    L.mono(ctx, L2.note, bx + 20, 956, 11.5, rgba(L2.col, 0.80), 0.9);
    ctx.strokeStyle = rgba(L2.col, 0.30); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(bx + 20, 934); ctx.lineTo(bx + BW - 20, 934); ctx.stroke();

    ctx.restore();
    // band frame
    ctx.strokeStyle = rgba(b === 3 ? C.alert : C.ds, b === 3 ? 0.25 + 0.55 * leftIn : 0.20);
    ctx.lineWidth = b === 3 ? 2 : 1;
    ctx.beginPath(); ctx.moveTo(bx + .5, 0); ctx.lineTo(bx + .5, H); ctx.stroke();
    if (b === 3){
      ctx.strokeStyle = rgba(C.alert, 0.18 + 0.5 * leftIn); ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(W - 1.5, 0); ctx.lineTo(W - 1.5, H); ctx.stroke();
      const a2 = ss(t0 + 0.72, t0 + 0.96, t);
      L.mono(ctx, 'YOU ARE LEFT HERE', bx + 20, 1012, 12, rgba(C.alert, 0.95 * a2), 2.4);
      ctx.fillStyle = rgba(C.alert, 0.9 * a2); ctx.fillRect(bx + 6, 1002, 4, 12);
    }
  }
  L.mono(ctx, 'ISOLATION IS A PROMISE ABOUT WHAT YOU CANNOT SEE', 520, 1035, 14,
    rgba(C.phos, 0.55 * ss(t0 + 0.15, t0 + 0.5, t)), 2.6);
  return { bloom: 1.05, chroma: 1.8, scan: 0.55 };
}

function isoRoom(ctx, bx, alpha, dark, chairCol){
  if (alpha <= 0.01) return;
  const cx = bx + 240;
  const wl = cx - 152, wr = cx + 152, wt = 392, wb = 700;
  ctx.lineWidth = 1.25;
  ctx.strokeStyle = rgba(C.dsLite, 0.50 * alpha);
  ctx.strokeRect(wl + .5, wt + .5, wr - wl, wb - wt);
  ctx.beginPath();
  ctx.moveTo(wl, wb); ctx.lineTo(bx + 12, 1012);
  ctx.moveTo(wr, wb); ctx.lineTo(bx + 468, 1012);
  ctx.moveTo(bx + 12, 1012); ctx.lineTo(bx + 468, 1012);
  ctx.moveTo(wl, wt); ctx.lineTo(bx + 12, 214);
  ctx.moveTo(wr, wt); ctx.lineTo(bx + 468, 214);
  ctx.stroke();
  ctx.strokeStyle = rgba(C.ds, 0.30 * alpha); ctx.lineWidth = 1;
  for (let i = 1; i < 5; i++){
    const f = i / 5, yy = lerp(wb, 1012, f);
    ctx.beginPath();
    ctx.moveTo(lerp(wl, bx + 12, f), yy); ctx.lineTo(lerp(wr, bx + 468, f), yy); ctx.stroke();
  }
  for (let i = 1; i < 5; i++){
    const f = i / 5;
    ctx.beginPath();
    ctx.moveTo(lerp(wl, wr, f), wb); ctx.lineTo(lerp(bx + 12, bx + 468, f), 1012); ctx.stroke();
  }
  // doorway
  ctx.fillStyle = 'rgba(0,0,0,0.72)'; ctx.fillRect(wl + 42, wb - 178, 76, 178);
  ctx.strokeStyle = rgba(C.cyan, 0.42 * alpha); ctx.lineWidth = 1;
  ctx.strokeRect(wl + 42.5, wb - 177.5, 76, 178);
  // the chair, seen from the front
  const cxh = cx + 56, foot = 872;
  ctx.strokeStyle = rgba(chairCol || C.white, (chairCol ? 1.15 : 0.72) * alpha); ctx.lineWidth = 1.7;
  ctx.strokeRect(cxh - 30, foot - 118, 60, 58);
  ctx.strokeRect(cxh - 24, foot - 108, 48, 38);
  ctx.strokeRect(cxh - 36, foot - 58, 72, 11);
  ctx.beginPath();
  ctx.moveTo(cxh - 32, foot - 47); ctx.lineTo(cxh - 36, foot);
  ctx.moveTo(cxh + 32, foot - 47); ctx.lineTo(cxh + 36, foot);
  ctx.moveTo(cxh - 22, foot - 47); ctx.lineTo(cxh - 24, foot - 4);
  ctx.moveTo(cxh + 22, foot - 47); ctx.lineTo(cxh + 24, foot - 4);
  ctx.stroke();
  // shadow under the chair
  ctx.strokeStyle = rgba(C.ds, 0.34 * alpha); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.ellipse(cxh, foot + 2, 46, 8, 0, 0, TAU); ctx.stroke();
}

// ---------------------------------------------------------------- XI. FRAGMENTS
// k: external frag — free bytes are enough, no contiguous run is · internal frag — the block handed
//    out is bigger than asked · no standard metric: largest satisfiable free block / total free
const STRIP_X0 = 140, STRIP_X1 = 1780, STRIP_Y = 444, STRIP_H = 100, STRIP_W = STRIP_X1 - STRIP_X0;
const FREE_BEATS = [257, 258, 259, 260, 260.5, 261];

let HEAP = null;
function getHeap(){
  if (HEAP) return HEAP;
  const R = L.mulberry32(20250623);
  const blocks = []; let x = 0, guard = 0;
  while (x < 0.9995 && guard++ < 400){
    const hole = R() < 0.055 && x > 0.012;
    let w = hole ? 0.009 + R() * 0.040 : 0.011 + R() * 0.037;
    if (x + w > 1) w = 1 - x;
    blocks.push({ a: x, b: x + w, live: !hole });
    x += w;
  }
  const pool = [];
  for (let i = 0; i < blocks.length; i++) if (blocks[i].live) pool.push(i);
  pool.sort((p, q) => (blocks[q].b - blocks[q].a) - (blocks[p].b - blocks[p].a));
  const fin = L.mulberry32(777);
  const freeOrder = [];
  for (let i = 0; i < 7 && pool.length; i++){
    const j = Math.floor(fin() * Math.min(14, pool.length));
    freeOrder.push(pool.splice(j, 1)[0]);
  }
  HEAP = { blocks: blocks, freeOrder: freeOrder };
  return HEAP;
}

// live flags for every block at a given number of free events
function heapLive(nFree){
  const hp = getHeap();
  const dead = {};
  for (let i = 0; i < nFree && i < hp.freeOrder.length; i++) dead[hp.freeOrder[i]] = 1;
  const out = [];
  for (let i = 0; i < hp.blocks.length; i++) out.push(hp.blocks[i].live && !dead[i]);
  return out;
}
function heapRuns(live){
  const hp = getHeap();
  const runs = [];
  let cur = null;
  for (let i = 0; i < hp.blocks.length; i++){
    if (!live[i]){
      if (!cur) cur = { a: hp.blocks[i].a, b: hp.blocks[i].b };
      else cur.b = hp.blocks[i].b;
    } else if (cur){ runs.push(cur); cur = null; }
  }
  if (cur) runs.push(cur);
  return runs;
}

function k_fragments(ctx, t, u, shot){
  frame(ctx); bg(ctx, '#030508');
  const t0 = shot.t0, t1 = shot.t1;
  const hp = getHeap();
  const ft = FREE_BEATS.map(timeOfBeat);
  let nFree = 0;
  while (nFree < ft.length && t >= ft[nFree]) nFree++;
  const live = heapLive(nFree);
  const runs = heapRuns(live);
  const tc = 120.86;                                   // the word FRAGMENTS
  const burst = ss(tc, tc + 0.10, t);
  const bfl = decay(t, tc, 0.26);
  const pulseK = 0.62 + 0.38 * pulse(t, 0.20);

  let freeTot = 0, big = 0;
  for (let i = 0; i < runs.length; i++){
    const w = runs[i].b - runs[i].a;
    freeTot += w; if (w > big) big = w;
  }
  const frag = clamp(1 - (freeTot > 0.001 ? big / freeTot : 1), 0, 1);

  ghost(ctx, 'FRAGMENTS', 232, 150, C.alert, (0.06 + 0.10 * burst) * (0.7 + 0.3 * bfl));

  // ---- the strip
  L.mono(ctx, 'HEAP MAP · ADDRESS SPACE', STRIP_X0, 396, 12, rgba(C.phos, 0.45), 2.6);
  L.mono(ctx, '0x…0000', STRIP_X0, STRIP_Y - 12, 10, rgba(C.phos, 0.32), 0.4);
  L.mono(ctx, '0x…4000', STRIP_X1, STRIP_Y - 12, 10, rgba(C.phos, 0.32), 0.4, 'right');
  ctx.strokeStyle = rgba(C.phos, 0.14); ctx.lineWidth = 1;
  ctx.strokeRect(STRIP_X0 + .5, STRIP_Y + .5, STRIP_W, STRIP_H);
  for (let i = 0; i <= 32; i++){
    const px = STRIP_X0 + STRIP_W * i / 32;
    ctx.strokeStyle = rgba(C.phos, i % 8 === 0 ? 0.26 : 0.10);
    ctx.beginPath(); ctx.moveTo(px, STRIP_Y - 6); ctx.lineTo(px, STRIP_Y); ctx.stroke();
  }

  const beamA = burst * pulseK;
  for (let i = 0; i < hp.blocks.length; i++){
    const b = hp.blocks[i];
    const x0 = STRIP_X0 + b.a * STRIP_W, w = (b.b - b.a) * STRIP_W;
    const on = live[i];
    if (on){
      ctx.fillStyle = rgba(C.ds, 0.20 + 0.07 * (i % 3));
      ctx.fillRect(x0, STRIP_Y, w, STRIP_H);
      ctx.strokeStyle = rgba(C.dsLite, 0.72); ctx.lineWidth = 1;
      ctx.strokeRect(x0 + .5, STRIP_Y + .5, Math.max(0.5, w - 1), STRIP_H - 1);
      if (w > 9){
        ctx.strokeStyle = rgba(C.dsLite, 0.22);
        ctx.beginPath();
        ctx.moveTo(x0 + w * 0.5, STRIP_Y + 6); ctx.lineTo(x0 + w * 0.5, STRIP_Y + STRIP_H - 6); ctx.stroke();
      }
    } else {
      const hot = burst * pulseK;
      ctx.fillStyle = rgba(C.alert, 0.12 + 0.34 * hot);
      ctx.fillRect(x0, STRIP_Y, w, STRIP_H);
      hatch(ctx, x0, STRIP_Y, w, STRIP_H, 9, rgba(C.alert, 0.22 + 0.35 * hot));
      ctx.strokeStyle = rgba(C.alert, 0.55 + 0.45 * hot); ctx.lineWidth = 1;
      ctx.strokeRect(x0 + .5, STRIP_Y + .5, Math.max(0.5, w - 1), STRIP_H - 1);
    }
  }
  // every hole lights up at once
  if (burst > 0.01){
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const gb = ctx.createLinearGradient(0, STRIP_Y, 0, 190);
    gb.addColorStop(0, rgba(C.alert, 0.16 * beamA));
    gb.addColorStop(1, rgba(C.alert, 0));
    ctx.fillStyle = gb;
    for (let i = 0; i < runs.length; i++){
      const x0 = STRIP_X0 + runs[i].a * STRIP_W, w = (runs[i].b - runs[i].a) * STRIP_W;
      ctx.fillRect(x0, 190, Math.max(2, w), STRIP_Y - 190);
    }
    const gd = ctx.createLinearGradient(0, STRIP_Y + STRIP_H, 0, STRIP_Y + STRIP_H + 90);
    gd.addColorStop(0, rgba(C.alert, 0.12 * beamA));
    gd.addColorStop(1, rgba(C.alert, 0));
    ctx.fillStyle = gd;
    for (let i = 0; i < runs.length; i++){
      const x0 = STRIP_X0 + runs[i].a * STRIP_W, w = (runs[i].b - runs[i].a) * STRIP_W;
      ctx.fillRect(x0, STRIP_Y + STRIP_H, Math.max(2, w), 90);
    }
    ctx.restore();
  }

  // ---- the fact, drawn: the bytes are there, the run is not
  const bx0 = 1120, by0 = 640;
  L.mono(ctx, 'DOES IT FIT?', bx0, by0 - 18, 11, rgba(C.phos, 0.45), 2.6);
  const reqW = 300, lfbW = Math.max(10, reqW * (big / Math.max(0.001, big * 1.55)));
  L.mono(ctx, 'LARGEST FREE RUN', bx0, by0 + 34, 11, rgba(C.phos, 0.55), 1.6);
  ctx.fillStyle = rgba(C.alert, 0.34 + 0.4 * burst);
  ctx.fillRect(bx0 + 210, by0 + 22, lfbW, 16);
  ctx.strokeStyle = rgba(C.alert, 0.9); ctx.lineWidth = 1;
  ctx.strokeRect(bx0 + 210.5, by0 + 22.5, lfbW, 15);
  L.mono(ctx, 'THE REQUEST', bx0, by0 + 76, 11, rgba(C.white, 0.55), 1.6);
  ctx.strokeStyle = rgba(C.white, 0.55); ctx.lineWidth = 1;
  ctx.strokeRect(bx0 + 210.5, by0 + 64.5, reqW, 15);
  hatch(ctx, bx0 + 210, by0 + 64, reqW, 16, 7, rgba(C.white, 0.07));
  // the shortfall
  ctx.strokeStyle = rgba(C.alert, 0.85); ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(bx0 + 210 + lfbW, by0 + 46); ctx.lineTo(bx0 + 210 + lfbW, by0 + 56);
  ctx.lineTo(bx0 + 210 + reqW, by0 + 56); ctx.lineTo(bx0 + 210 + reqW, by0 + 64);
  ctx.stroke();
  L.mono(ctx, 'SHORT BY THIS MUCH', bx0 + 210 + lfbW + 8, by0 + 104, 10, rgba(C.alert, 0.7), 1.2);
  L.mono(ctx, 'THE BYTES ARE THERE. NO CONTIGUOUS RUN IS.', bx0, by0 + 132, 11, rgba(C.alert, 0.55), 1.3);

  // ---- fragmentation meter
  const mx = 1420, my = 330, mw = 360;
  L.mono(ctx, 'FRAGMENTATION', mx, my - 26, 11, rgba(C.phos, 0.45), 2.6);
  L.mono(ctx, 'LFB ÷ FREE TOTAL', mx, my - 10, 10, rgba(C.phos, 0.32), 1.4);
  ctx.strokeStyle = rgba(C.phos, 0.24); ctx.lineWidth = 1;
  ctx.strokeRect(mx + .5, my + .5, mw, 16);
  ctx.fillStyle = rgba(C.alert, 0.16 + 0.66 * frag);
  ctx.fillRect(mx + 1, my + 1, (mw - 2) * frag, 14);
  for (let i = 0; i <= 8; i++){
    const px = mx + mw * i / 8;
    ctx.strokeStyle = rgba(C.phos, 0.26);
    ctx.beginPath(); ctx.moveTo(px, my + 16); ctx.lineTo(px, my + (i % 4 === 0 ? 28 : 22)); ctx.stroke();
  }
  L.mono(ctx, 'ONE RUN', mx, my + 44, 10, rgba(C.phos, 0.32), 1);
  L.mono(ctx, 'MANY RUNS', mx + mw, my + 44, 10, rgba(C.phos, 0.32), 1, 'right');

  // ---- the datasheet
  L.spec(ctx, 150, 176, [
    ['EXTERNAL', 'FREE BYTES ENOUGH — NO CONTIGUOUS RUN'],
    ['INTERNAL', 'BLOCK HANDED OUT IS BIGGER THAN ASKED'],
    ['METRIC', 'NO STANDARD — LFB ÷ TOTAL FREE'],
    ['ALLOCATOR', 'BUDDY · SLAB · TCMALLOC']
  ], { size: 13, lh: 25, color: C.cyan, kw: 88, alpha: ss(t0 + 0.1, t0 + 0.5, t) });

  // ---- internal fragmentation, drawn once, small
  const iy = 806, ex = 150;
  L.mono(ctx, 'INTERNAL FRAGMENTATION · EXAMPLE', ex, iy - 28, 11, rgba(C.phos, 0.45), 2.2);
  ctx.fillStyle = rgba(C.ds, 0.30); ctx.fillRect(ex, iy, 200, 44);
  ctx.strokeStyle = rgba(C.dsLite, 0.85); ctx.lineWidth = 1;
  ctx.strokeRect(ex + .5, iy + .5, 200, 44);
  ctx.fillStyle = rgba(C.alert, 0.26); ctx.fillRect(ex + 200, iy, 120, 44);
  hatch(ctx, ex + 200, iy, 120, 44, 8, rgba(C.alert, 0.55));
  ctx.strokeStyle = rgba(C.alert, 0.9); ctx.lineWidth = 1;
  ctx.strokeRect(ex + 200.5, iy + .5, 120, 44);
  L.mono(ctx, 'ASKED 40 B', ex + 100, iy + 62, 12, rgba(C.white, 0.85), 1, 'center');
  L.mono(ctx, 'GOT 64 B', ex + 260, iy + 62, 12, rgba(C.alert, 0.95), 1, 'center');
  L.mono(ctx, 'THE BLOCK HANDED OUT IS BIGGER THAN ASKED', ex, iy + 96, 11, rgba(C.alert, 0.55), 1.3);
  L.mono(ctx, '24 B OF PADDING YOU CANNOT RECLAIM', ex, iy + 118, 11, rgba(C.alert, 0.42), 1.3);

  return { bloom: 1.0 + 0.3 * bfl, chroma: 1.4 + 5 * bfl, scan: 0.5, flash: 0.05 * bfl };
}

// ---------------------------------------------------------------- XI. COMPACTION
// k: compaction moves live objects and rewrites pointers · internal frag is padding you cannot reclaim
//    ok: alignment is one 64 B cache line
function k_compact(ctx, t, u, shot){
  frame(ctx); bg(ctx, '#030508');
  const t0 = shot.t0, t1 = shot.t1;
  const hp = getHeap();
  const live = heapLive(hp.freeOrder.length);
  const wid = [];
  let packed = 0;
  for (let i = 0; i < hp.blocks.length; i++){
    wid.push((hp.blocks[i].b - hp.blocks[i].a) * STRIP_W);
  }
  const HOLE_W = 104;                                  // one 64 B cache line
  let liveN = 0;
  for (let i = 0; i < hp.blocks.length; i++) if (live[i]) liveN++;
  const gapIdx = Math.max(1, Math.round(liveN * 0.60));
  let gapX = STRIP_X0, li = 0;
  const packX = new Array(hp.blocks.length);
  for (let i = 0; i < hp.blocks.length; i++){
    if (!live[i]) continue;
    packX[i] = STRIP_X0 + packed;
    packed += wid[i];
    li++;
    if (li === gapIdx){ gapX = STRIP_X0 + packed; packed += HOLE_W; }
  }
  const wallK = ss(t1 - 0.62, t1 - 0.03, t);
  const doneK = ss(t0 + 1.75, t0 + 2.25, t);
  const dis = 124.89;                                  // DISHEARTENED
  const disK = ss(dis - 0.10, dis + 0.12, t);
  const dfl = decay(t, dis, 0.30);

  // movement: a wave of compaction from left to right
  const moveAt = i => t0 + 0.20 + (i / hp.blocks.length) * 0.80;
  const posX = i => {
    const k = ss(moveAt(i), moveAt(i) + 0.40, t);
    const orig = STRIP_X0 + hp.blocks[i].a * STRIP_W;
    return lerp(orig, packX[i], easeInOutCubic(k));
  };
  const Y0 = lerp(STRIP_Y, -40, wallK), HH = lerp(STRIP_H, 1160, wallK);

  // address ruler: the address space does not shrink, the data does
  ctx.strokeStyle = rgba(C.phos, 0.16); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(STRIP_X0, 424); ctx.lineTo(STRIP_X1, 424); ctx.stroke();
  for (let i = 0; i <= 40; i++){
    const px = STRIP_X0 + STRIP_W * i / 40;
    ctx.strokeStyle = rgba(C.phos, i % 10 === 0 ? 0.26 : 0.10);
    ctx.beginPath(); ctx.moveTo(px, 424); ctx.lineTo(px, 424 - (i % 10 === 0 ? 10 : 5)); ctx.stroke();
  }
  // returned to the system
  const retX = STRIP_X0 + packed;
  hatch(ctx, retX, Y0, STRIP_X1 - retX, HH, 14, rgba(C.phos, 0.10));

  for (let i = 0; i < hp.blocks.length; i++){
    if (!live[i]) continue;
    const x = posX(i), w = wid[i];
    ctx.fillStyle = rgba(C.ds, 0.18);
    ctx.fillRect(x, Y0, w, HH);
    ctx.strokeStyle = rgba(C.dsLite, 0.55); ctx.lineWidth = 1;
    ctx.strokeRect(x + .5, Y0 + .5, Math.max(0.5, w - 1), HH - 1);
    if (HH < 200 && w > 9){
      ctx.strokeStyle = rgba(C.dsLite, 0.20);
      ctx.beginPath(); ctx.moveTo(x + w * 0.5, Y0 + 6); ctx.lineTo(x + w * 0.5, Y0 + HH - 6); ctx.stroke();
    }
  }
  // the one hole that will not close
  const hx = gapX, hw = HOLE_W;
  ctx.fillStyle = 'rgba(0,0,0,0.85)';
  ctx.fillRect(hx, Y0, hw, HH);
  ctx.strokeStyle = rgba(C.alert, 0.55 + 0.45 * disK); ctx.lineWidth = 1.4;
  ctx.strokeRect(hx + .5, Y0 + .5, hw - 1, HH - 1);
  if (wallK < 0.92){
    // one 64 B cache line — and inside it, a person. the hole is taller than the strip.
    const cxp = hx + hw / 2;
    const top = STRIP_Y - 92, bot = STRIP_Y + STRIP_H + 4;
    const hh = bot - top;
    ctx.save();
    ctx.strokeStyle = rgba(C.love, 0.62 + 0.38 * disK);
    ctx.fillStyle = 'rgba(0,0,0,0.92)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(cxp, top + hh * 0.115, hw * 0.155, 0, TAU);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = rgba(C.love, 0.055 + 0.13 * disK);
    ctx.beginPath();
    ctx.arc(cxp, top + hh * 0.115, hw * 0.155, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cxp - hw * 0.30, bot);
    ctx.lineTo(cxp - hw * 0.42, top + hh * 0.335);
    ctx.quadraticCurveTo(cxp, top + hh * 0.245, cxp + hw * 0.42, top + hh * 0.335);
    ctx.lineTo(cxp + hw * 0.30, bot);
    ctx.closePath();
    ctx.fillStyle = 'rgba(0,0,0,0.92)'; ctx.fill();
    ctx.strokeStyle = rgba(C.love, 0.55 + 0.45 * disK); ctx.stroke();
    ctx.restore();
  }

  // pointers rewritten: old → new for three objects
  L.mono(ctx, 'POINTERS REWRITTEN AS THE OBJECTS MOVE', STRIP_X0, 372, 11, rgba(C.cyan, 0.55 * (1 - wallK)), 2.2);
  const marks = [4, 12, 20];
  for (let m = 0; m < marks.length; m++){
    const i = marks[m];
    if (!live[i]) continue;
    const ox = STRIP_X0 + hp.blocks[i].a * STRIP_W + wid[i] / 2;
    const nx2 = posX(i) + wid[i] / 2;
    const ly = 340 - m * 26;
    ctx.strokeStyle = rgba(C.cyan, 0.48 * (1 - wallK)); ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(ox, ly + 4); ctx.lineTo(nx2, ly + 4); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(ox, ly + 4); ctx.lineTo(ox, 418); ctx.stroke();
    L.mono(ctx, 'p' + (m + 1), Math.min(ox, nx2), ly, 11, rgba(C.phos, 0.8 * (1 - wallK)), 1);
    L.mono(ctx, '→', nx2 + 4, ly + 5, 13, rgba(C.cyan, 0.95 * (1 - wallK)), 0);
  }

  // the label that stays
  const la = ss(t0 + 1.6, t0 + 2.0, t) * (1 - wallK);
  const hb = STRIP_Y + STRIP_H;
  ctx.strokeStyle = rgba(C.alert, 0.55 * la); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(hx + hw / 2, hb + 2); ctx.lineTo(hx + hw / 2, hb + 20); ctx.stroke();
  L.mono(ctx, 'ONE CACHE LINE · 64 B', hx + hw / 2, hb + 36, 11, rgba(C.alert, 0.9 * la), 1.6, 'center');
  if (disK > 0.01){
    L.mono(ctx, 'NOTHING FITS HERE', hx + hw / 2, hb + 56, 11, rgba(C.love, 0.95 * disK * (1 - wallK)), 2.4, 'center');
  }

  // right column: what compaction costs
  L.spec(ctx, 1180, 176, [
    ['COMPACTION', 'LIVE OBJECTS SLIDE TOGETHER'],
    ['POINTERS', 'EVERY REFERENCE IS REWRITTEN'],
    ['PADDING', 'INTERNAL — YOU CANNOT RECLAIM IT'],
    ['ALIGNMENT', '64 B = ONE CACHE LINE']
  ], { size: 13, lh: 25, color: C.cyan, kw: 100, alpha: ss(t0 + 0.15, t0 + 0.5, t) * (1 - wallK) });

  ghost(ctx, 'DISHEARTENED', 990, 112, C.alert, 0.10 * disK * (1 - wallK));

  const full = STRIP_X0 + packed;
  L.mono(ctx, 'COMPACTION', 150, 878, 11, rgba(C.phos, 0.40 * doneK), 3);
  L.mono(ctx, 'LIVE BYTES ARE UNCHANGED. EVERY ADDRESS MOVED.', 150, 906, 13, rgba(C.phos, 0.48 * doneK), 1.3);
  L.mono(ctx, 'THE HOLE IS THE ONLY THING THAT DID NOT MOVE.', 150, 932, 13, rgba(C.love, 0.62 * disK), 1.3);
  L.mono(ctx, 'PACKED', STRIP_X0, 588, 11, rgba(C.phos, 0.40 * doneK * (1 - wallK)), 3);
  L.mono(ctx, 'RETURNED TO THE SYSTEM', full + 16, 588, 11, rgba(C.phos, 0.38 * doneK * (1 - wallK)), 1.6);

  return { bloom: 1.0 + 0.4 * dfl, chroma: 1.5 + 4 * disK, scan: 0.5, flash: 0.05 * dfl * (1 - wallK) };
}

// ---------------------------------------------------------------- XII. THE GOD WALL
// k: ring 0 kernel vs ring 3 user · a privileged instruction from user mode raises #GP
//    the syscall gate is the only legal crossing
const GW_HIT_BEATS = [273, 276, 278, 280, 281, 282, 283];

function l_godwall(ctx, t, u, shot){
  frame(ctx); bg(ctx, '#020306');
  const cx = 960, cy = 512;
  const HITS = GW_HIT_BEATS.map(timeOfBeat);
  const hi = whichHit(t, HITS);
  const push = 1 + 0.075 * ss(shot.t0, shot.t1, t);
  let fl = 0;
  for (let i = 0; i <= hi && i < HITS.length; i++) fl = Math.max(fl, decay(t, HITS[i], 0.075));

  const prevT = hi >= 0 ? HITS[hi] : shot.t0;
  const nextT = hi + 1 < HITS.length ? HITS[hi + 1] : shot.t1 + 0.4;
  const chargeDur = Math.min(0.54, (nextT - prevT) * 0.84);
  const cStart = nextT - chargeDur;
  const shapeR = (tt) => {
    if (tt >= cStart && tt < nextT){
      const p = sat((tt - cStart) / chargeDur);
      return lerp(806, 236, easeInCubic(p));
    }
    return 806;
  };

  ctx.save();
  ctx.translate(cx, cy); ctx.scale(push, push); ctx.translate(-cx, -cy);

  // bands
  const ringFill = (r0, r1, col, a) => {
    ctx.beginPath(); ctx.arc(cx, cy, r1, 0, TAU); ctx.arc(cx, cy, r0, 0, TAU, true);
    ctx.fillStyle = rgba(col, a); ctx.fill();
  };
  ringFill(0, 220, C.ds, 0.10);
  const cg = ctx.createRadialGradient(cx, cy, 10, cx, cy, 220);
  cg.addColorStop(0, 'rgba(38,54,140,0.55)'); cg.addColorStop(1, 'rgba(10,16,44,0.75)');
  ctx.beginPath(); ctx.arc(cx, cy, 220, 0, TAU); ctx.fillStyle = cg; ctx.fill();
  ringFill(220, 440, C.ds, 0.10);
  ringFill(440, 660, C.ds, 0.07);
  ringFill(660, 880, C.dsLite, 0.045);

  // concentric tooling + radial spokes: the wall as manufactured object
  ctx.strokeStyle = rgba(C.dsLite, 0.085); ctx.lineWidth = 1;
  for (let r = 242; r < 880; r += 22){ ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke(); }
  for (let a = 0; a < 360; a += 3){
    const rad = a * Math.PI / 180;
    ctx.strokeStyle = rgba(C.dsLite, a % 15 === 0 ? 0.20 : 0.075);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(rad) * 220, cy + Math.sin(rad) * 220);
    ctx.lineTo(cx + Math.cos(rad) * 880, cy + Math.sin(rad) * 880);
    ctx.stroke();
  }
  // boundary rings
  const ringLine = (r, col, a, lw) => { ctx.strokeStyle = rgba(col, a); ctx.lineWidth = lw; ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke(); };
  ringLine(880, C.dsLite, 0.55, 1.4);
  ringLine(660, C.dsLite, 0.45, 1.4);
  ringLine(440, C.cyan, 0.60, 1.6);
  ringLine(220, C.phos, 0.95, 2.8);
  ringLine(212, C.phos, 0.35, 1);
  ringLine(230, C.phos, 0.35, 1);
  // hazard ticks outside the kernel wall
  for (let a = 0; a < 360; a += 6){
    const rad = a * Math.PI / 180;
    ctx.strokeStyle = rgba(C.phos, a % 30 === 0 ? 0.34 : 0.18); ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(rad) * 234, cy + Math.sin(rad) * 234);
    ctx.lineTo(cx + Math.cos(rad) * 250, cy + Math.sin(rad) * 250);
    ctx.stroke();
  }
  // ticks on the kernel wall
  for (let a = 0; a < 360; a += 2){
    const rad = a * Math.PI / 180;
    const l = a % 30 === 0 ? 16 : a % 10 === 0 ? 9 : 4;
    ctx.strokeStyle = rgba(C.phos, a % 30 === 0 ? 0.45 : 0.16); ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(rad) * (220 - l), cy + Math.sin(rad) * (220 - l));
    ctx.lineTo(cx + Math.cos(rad) * 220, cy + Math.sin(rad) * 220);
    ctx.stroke();
  }

  // the legal crossing
  const ga = -0.58, gw = 0.019;
  ctx.beginPath();
  ctx.arc(cx, cy, 884, ga - gw, ga + gw);
  ctx.arc(cx, cy, 206, ga + gw, ga - gw, true);
  ctx.closePath();
  ctx.fillStyle = 'rgba(2,3,6,0.94)'; ctx.fill();
  ctx.strokeStyle = rgba(C.cyan, 0.75); ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(cx + Math.cos(ga - gw) * 206, cy + Math.sin(ga - gw) * 206);
  ctx.lineTo(cx + Math.cos(ga - gw) * 884, cy + Math.sin(ga - gw) * 884);
  ctx.moveTo(cx + Math.cos(ga + gw) * 206, cy + Math.sin(ga + gw) * 206);
  ctx.lineTo(cx + Math.cos(ga + gw) * 884, cy + Math.sin(ga + gw) * 884);
  ctx.stroke();
  ctx.setLineDash([5, 8]);
  ctx.strokeStyle = rgba(C.cyan, 0.38); ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx + Math.cos(ga) * 860, cy + Math.sin(ga) * 860);
  ctx.lineTo(cx + Math.cos(ga) * 240, cy + Math.sin(ga) * 240);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.save();
  ctx.translate(cx + Math.cos(ga) * 470, cy + Math.sin(ga) * 470);
  ctx.rotate(ga);
  L.mono(ctx, 'syscall', 6, -9, 14, rgba(C.cyan, 0.95), 2.6);
  ctx.restore();

  // cross-section labels on the left
  const lab = [
    [880, 'CPL 3 · RING 3 · USER'],
    [660, 'CPL 2'],
    [440, 'CPL 1'],
  ];
  for (let i = 0; i < lab.length; i++){
    const x = cx - lab[i][0] + 16, y = cy - 6;
    const txt = lab[i][1];
    const w = L.monoW(ctx, txt, 12, 1.2);
    plate(ctx, x - 8, y - 18, w + 16, 26, 0.72);
    L.mono(ctx, txt, x, y, 12, rgba(i === 0 ? C.dsLite : C.phos, 0.85), 1.2);
  }
  plate(ctx, cx - 92, cy - 30, 184, 64, 0.62);
  L.mono(ctx, 'RING 0', cx, cy - 2, 22, rgba(C.white, 0.92), 5, 'center');
  L.mono(ctx, 'CPL 0 · KERNEL', cx, cy + 20, 11, rgba(C.phos, 0.7), 1.6, 'center');

  // the shape
  const r = shapeR(t);
  const ang = 0.0;
  const px2 = cx + Math.cos(ang) * r, py2 = cy + Math.sin(ang) * r;
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  // the charge streak: how fast it is coming
  const sg = ctx.createLinearGradient(cx + Math.cos(ang) * 884, 0, px2, 0);
  sg.addColorStop(0, rgba(C.ds, 0));
  sg.addColorStop(1, rgba(C.dsLite, 0.30 + 0.40 * fl));
  ctx.strokeStyle = sg; ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(cx + Math.cos(ang) * 884, cy + Math.sin(ang) * 884);
  ctx.lineTo(px2, py2); ctx.stroke();
  for (let k = 1; k <= 12; k++){
    const tr = shapeR(t - k * 0.012);
    const tx = cx + Math.cos(ang) * tr, ty = cy + Math.sin(ang) * tr;
    ctx.fillStyle = rgba(C.dsLite, 0.34 * (1 - k / 13));
    const s2 = 9 * (1 - k / 14);
    ctx.fillRect(tx - s2, ty - s2, s2 * 2, s2 * 2);
  }
  ctx.restore();
  // the line it keeps taking
  ctx.setLineDash([3, 9]);
  ctx.strokeStyle = rgba(C.alert, 0.20); ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx + Math.cos(ang) * 884, cy + Math.sin(ang) * 884);
  ctx.lineTo(cx + Math.cos(ang) * 236, cy + Math.sin(ang) * 236);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  const shg = ctx.createRadialGradient(px2, py2, 0, px2, py2, 70);
  shg.addColorStop(0, rgba(C.dsLite, 0.45)); shg.addColorStop(1, rgba(C.ds, 0));
  ctx.fillStyle = shg; ctx.fillRect(px2 - 70, py2 - 70, 140, 140);
  ctx.restore();
  ctx.save();
  ctx.translate(px2, py2); ctx.rotate(ang + t * 5.0);
  ctx.fillStyle = rgba(C.white, 0.95);
  ctx.fillRect(-11, -11, 22, 22);
  ctx.fillStyle = rgba(C.ds, 0.45);
  ctx.fillRect(-20, -20, 40, 40);
  ctx.strokeStyle = rgba(C.cyan, 0.95); ctx.lineWidth = 1.8;
  ctx.strokeRect(-20, -20, 40, 40);
  ctx.restore();

  // impacts
  for (let i = 0; i <= hi && i < HITS.length; i++){
    const d = t - HITS[i];
    if (d < 0 || d > 0.5) continue;
    const a2 = Math.exp(-d / 0.15);
    const spread = 0.09 + d * 1.5;
    ctx.strokeStyle = rgba(C.alert, 0.9 * a2); ctx.lineWidth = 2 + 8 * a2;
    ctx.beginPath(); ctx.arc(cx, cy, 220, -spread, spread); ctx.stroke();
    ctx.strokeStyle = rgba(C.white, 0.55 * a2); ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(cx, cy, 238 + d * 420, -spread * 0.7, spread * 0.7); ctx.stroke();
    // splinters off the point of contact
    for (let s = 0; s < 9; s++){
      const aa = -0.30 + s * 0.075;
      const r0 = 224 + d * 260, r1 = r0 + 40 + 90 * a2;
      ctx.strokeStyle = rgba(s % 2 ? C.alert : C.white, 0.7 * a2); ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(aa) * r0, cy + Math.sin(aa) * r0);
      ctx.lineTo(cx + Math.cos(aa) * r1, cy + Math.sin(aa) * r1);
      ctx.stroke();
    }
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const ig = ctx.createRadialGradient(cx + 220, cy, 0, cx + 220, cy, 120);
    ig.addColorStop(0, rgba(C.white, 0.65 * a2));
    ig.addColorStop(0.35, rgba(C.alert, 0.35 * a2));
    ig.addColorStop(1, rgba(C.alert, 0));
    ctx.fillStyle = ig; ctx.fillRect(cx + 90, cy - 130, 260, 260);
    ctx.restore();
    if (d < 0.22){
      L.mono(ctx, '#GP', cx + 236, cy - 34 - d * 90, 15 + 10 * (1 - d / 0.22),
        rgba(C.alert, 0.95 * (1 - d / 0.22)), 1.6);
    }
  }
  ctx.restore();

  // ---- HUD
  L.spec(ctx, 150, 172, [
    ['CPL', '3 — USER MODE'],
    ['RINGS', '4 PRIVILEGE LEVELS · CPL 0–3'],
    ['GATE', 'syscall — THE ONLY LEGAL CROSSING'],
    ['ON FAULT', 'PRIVILEGED INSTRUCTION → #GP']
  ], { size: 13, lh: 25, color: C.cyan, kw: 88, alpha: ss(shot.t0 + 0.1, shot.t0 + 0.5, t) });

  L.mono(ctx, 'ATTEMPTS', 1680, 172, 11, rgba(C.phos, 0.40), 2.6);
  for (let i = 0; i < 7; i++){
    const on = i <= hi;
    const x = 1734 + i * 9;
    ctx.fillStyle = rgba(on ? C.alert : C.phos, on ? 0.95 : 0.22);
    ctx.fillRect(x, 208, 4, on ? 30 : 18);
  }
  const wm = ss(shot.t0 + 0.9, shot.t0 + 1.4, t);
  L.mono(ctx, 'THE WALL DOES NOT MOVE', 150, 980, 15, rgba(C.phos, 0.55 * wm), 3.4);

  return { bloom: 1.15 + 0.5 * fl, chroma: 1.4 + 8 * fl, scan: 0.5, flash: 0.10 * fl };
}

// ---------------------------------------------------------------- XII. ILLEGAL ARGUMENTS
// k: EINVAL = 22 · SIGSEGV = 11 · SIGILL = 4 · #GP(0) — general protection fault
function l_einval(ctx, t, u, shot){
  frame(ctx);
  const t0 = shot.t0, t1 = shot.t1;
  const tStop = timeOfBeat(288);
  if (t >= tStop){
    bg(ctx, '#010204');
    const a2 = 1 - 0.55 * ss(tStop, tStop + 0.16, t);
    L.withA(ctx, 0.68 * a2, () => {
      ctx.fillStyle = rgba(C.alert, 0.9);
      ctx.fillRect(958, 528, 4, 26);
    });
    L.mono(ctx, 'EXECUTION HALTED', W - 96, H - 92, 11, rgba(C.alert, 0.30 * a2), 3, 'right');
    return { bloom: 0.18, chroma: 0.5, scan: 0.26, grain: 0.03, vig: 1, flash: 0 };
  }

  bg(ctx, '#030507');
  const d = t - t0;
  const fl = decay(t, t0 + 0.02, 0.13);
  const cx = 1180, cy = 512;

  // the wall, and the place where it did not give
  const brk = 0.26 + d * 0.05;
  ctx.strokeStyle = rgba(C.phos, 0.16); ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.arc(960, 512, 220, -Math.PI + brk, Math.PI - brk); ctx.stroke();
  ctx.strokeStyle = rgba(C.dsLite, 0.07); ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.arc(960, 512, 440, 0, TAU); ctx.stroke();
  ctx.beginPath(); ctx.arc(960, 512, 660, 0, TAU); ctx.stroke();
  // the breach glows, and the cracks run out of it
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = rgba(C.alert, 0.55); ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(960, 512, 220, -brk, brk); ctx.stroke();
  ctx.restore();
  const Rc = L.mulberry32(99);
  for (let i = 0; i < 9; i++){
    const aa = -brk + (i / 8) * brk * 2;
    let rr = 220, xx = 960 + Math.cos(aa) * rr, yy = 512 + Math.sin(aa) * rr;
    ctx.strokeStyle = rgba(i % 3 ? C.alert : C.white, 0.16); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(xx, yy);
    for (let s = 0; s < 4; s++){
      rr += 90 + Rc() * 130;
      const a2 = aa + (Rc() - 0.5) * 0.35;
      xx = 960 + Math.cos(a2) * rr; yy = 512 + Math.sin(a2) * rr;
      ctx.lineTo(xx, yy);
    }
    ctx.stroke();
  }
  ghost(ctx, 'ILLEGAL ARGUMENTS', 892, 104, C.alert, 0.05 * (1 - ss(t0 + 1.432, t0 + 1.55, t)));

  // shards thrown back from the boundary
  const R = L.mulberry32(4242);
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 26; i++){
    const a = R() * TAU, sp = 300 + R() * 1100, sz = 20 + R() * 90;
    const dd = d * sp;
    const ox = cx + Math.cos(a) * (220 + dd), oy = cy + Math.sin(a) * (220 + dd) * 0.72;
    const aa = clamp(1 - d * 1.5, 0, 1);
    if (aa <= 0) continue;
    ctx.strokeStyle = rgba(R() > 0.6 ? C.alert : C.white, 0.55 * aa);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(ox + Math.cos(a) * sz * 0.6, oy + Math.sin(a) * sz * 0.6);
    ctx.lineTo(ox + Math.cos(a + 0.6) * sz * 0.4, oy + Math.sin(a + 0.6) * sz * 0.4);
    ctx.closePath(); ctx.stroke();
  }
  ctx.restore();

  // the crash log
  const LOG = [
    ['traps: general protection fault   ip:0x…   sp:0x…   error:0x…', 0.00],
    ['#GP(0)   VECTOR 13   CPL 3 → CPL 0   PRIVILEGE CHECK FAILED', 0.10],
    ['CPU: 0   Comm: i   Tainted: G     O', 0.20],
    ['RIP: 0000:0x…   CS: 0x0033   EFLAGS: 0x…', 0.30],
    ['RAX: 0x…  RBX: 0x…  RCX: 0x…  RDX: 0x…', 0.40],
    ['RSI: 0x…  RDI: 0x…  RBP: 0x…  R08: 0x…', 0.50],
    ['CR2: 0x…   err: 0x…   (an entry the machine cannot map)', 0.60],
    ['EINVAL = 22      SIGSEGV = 11      SIGILL = 4', 0.70]
  ];
  const lx = 230, ly = 262, lh = 44;
  for (let i = 0; i < LOG.length; i++){
    const ti = t0 + 0.22 + LOG[i][1];
    const p = sat((t - ti) / 0.16);
    if (p <= 0) continue;
    const s = LOG[i][0];
    const shown = s.slice(0, Math.max(1, Math.ceil(s.length * p)));
    const hot = i === 1;
    L.mono(ctx, shown, lx, ly + i * lh, 19, rgba(C.alert, hot ? 0.98 : 0.66), 0.6);
    if (p < 1){
      ctx.fillStyle = rgba(C.alert, 0.9);
      ctx.fillRect(lx + L.monoW(ctx, shown, 19, 0.6) + 3, ly + i * lh - 15, 9, 20);
    }
  }
  // a rule against the log, so it reads as machine output
  const ra = ss(t0 + 0.20, t0 + 0.36, t);
  ctx.strokeStyle = rgba(C.alert, 0.35 * ra); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(lx - 24, ly - 22); ctx.lineTo(lx - 24, ly + 7 * lh + 16); ctx.stroke();
  L.mono(ctx, 'dmesg', lx - 18, ly - 30, 11, rgba(C.alert, 0.45 * ra), 2);
  // the faulting frame marked
  const mark = ss(t0 + 0.60, t0 + 0.75, t);
  if (mark > 0){
    L.mono(ctx, '» ARGUMENT 1 OF 1: INVALID', lx + 34, ly + 8 * lh + 6, 15, rgba(C.white, 0.85 * mark), 1.6);
  }

  // the verdict
  const slam = ss(t0 + 1.432, t0 + 1.52, t);   // beat 287
  if (slam > 0){
    const sk = easeOutExpo(sat((t - (t0 + 1.432)) / 0.16));
    const sc = lerp(1.22, 1, sk);
    ctx.save();
    ctx.translate(960, 892);
    ctx.scale(sc, sc);
    L.withA(ctx, 0.55 + 0.45 * slam, () => L.display(ctx, 'ILLEGAL ARGUMENTS', 0, 0, 104, C.alert, 'center'));
    ctx.restore();
    ctx.strokeStyle = rgba(C.alert, 0.5 * slam); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(400, 918); ctx.lineTo(1520, 918); ctx.stroke();
  }

  // red wash and the approaching stop
  ctx.fillStyle = rgba(C.alert, 0.02 + 0.05 * sat(d / 2));
  ctx.fillRect(0, 0, W, H);

  return { bloom: 1.2 + 0.4 * fl, chroma: 2.0 + 9 * fl, scan: 0.5, flash: 0.18 * fl * fl * fl };
}

module.exports = { i_vibration, i_completion, j_left, j_isolation, k_fragments, k_compact, l_godwall, l_einval };
