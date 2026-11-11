
'use strict';
const L = require('../engine/lib.js');
const { W, H, C, rgba, clamp, lerp, sat, ss, TAU, easeOutExpo, easeOutCubic, easeInOutCubic, easeOutBack, SPB, BEAT0, pulse, beatOf } = L;

// ---------------------------------------------------------------- m_warps
// one SM, four warp schedulers, 64 resident warps, one perfect issue cycle
function m_warps(ctx, t, u, shot){
  ctx.fillStyle = '#030507'; ctx.fillRect(0, 0, W, H);
  const t0 = shot.t0, dur = shot.dur;
  const CYC_PER_SEC = 9.4;
  const cyc = Math.floor((t - t0) * CYC_PER_SEC);
  const ROWS = 4, COLS = 16;
  const gx0 = 300, gy0 = 300, cw = 84, ch = 96;
  // the perfect cycle: everything issues at once, on a beat
  const perfectAt = t0 + 2.55;
  const perfect = Math.exp(-Math.pow((t - perfectAt) / 0.16, 2));
  const collapse = ss(shot.t1 - 0.30, shot.t1 - 0.02, t);
  const R = L.mulberry32(20250301);
  const stalls = [];
  for (let i = 0; i < ROWS * COLS; i++) stalls.push(R());
  ctx.save();
  for (let r = 0; r < ROWS; r++){
    // scheduler rail
    const y = gy0 + r * ch;
    ctx.strokeStyle = rgba(C.dsLite, 0.35); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(232, y + 34); ctx.lineTo(gx0 - 16, y + 34); ctx.stroke();
    L.mono(ctx, 'S' + r, 208, y + 40, 15, rgba(C.dsLite, 0.85), 1.5);
    for (let c = 0; c < COLS; c++){
      const i = r * COLS + c;
      const x = gx0 + c * cw;
      const st = stalls[i];
      const cycleState = (cyc * 7 + i * 13) % 11;
      const stalled = st < 0.22 && perfect < 0.5;
      const issuing = perfect > 0.5 ? true : (cycleState === 0 && !stalled);
      // slot
      ctx.fillStyle = stalled ? rgba(C.phantom || '#2A3140', 0.30) : rgba(C.ds, issuing ? 0.30 : 0.10);
      ctx.fillRect(x, y, cw - 10, ch - 18);
      ctx.strokeStyle = stalled ? 'rgba(120,140,170,0.22)' : rgba(C.cyan, issuing ? 0.95 : 0.25);
      ctx.lineWidth = issuing ? 1.8 : 1;
      ctx.strokeRect(x + .5, y + .5, cw - 11, ch - 19);
      // the pulse from the scheduler
      if (issuing){
        ctx.strokeStyle = rgba(C.white, 0.75); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(gx0 - 16, y + 34); ctx.lineTo(x, y + 34); ctx.stroke();
        ctx.fillStyle = rgba(C.white, 0.95);
        ctx.fillRect(x + 4, y + 30, cw - 18, 8);
      }
      // lane occupancy glyphs (32 threads = 32 ticks)
      for (let k = 0; k < 32; k++){
        const on = stalled ? 0.0 : (issuing ? 1 : (st < 0.5 ? 0.5 : 0.15));
        if (on <= 0) continue;
        ctx.fillStyle = rgba(C.phos, on * 0.65);
        ctx.fillRect(x + 6 + (k % 8) * 8, y + 52 + Math.floor(k / 8) * 7, 5, 3);
      }
      if (c === 0) L.mono(ctx, 'w' + (r * COLS), x + 2, y - 6, 10, rgba(C.phos, 0.4), 0);
    }
  }
  ctx.restore();
  // collapse to a point at the very end
  if (collapse > 0){
    ctx.fillStyle = rgba(C.void, collapse * 0.92); ctx.fillRect(0, 0, W, H);
    const s = 6 + 10 * Math.sin(collapse * Math.PI * 2);
    L.glow(ctx, C.white, 60, () => { ctx.fillStyle = rgba(C.white, collapse); ctx.fillRect(W / 2 - s / 2, H / 2 - s / 2, s, s); });
  }
  // readouts
  L.mono(ctx, 'cycle ' + String(cyc).padStart(6, '0'), 168, 200, 17, rgba(C.cyan, 0.95), 2);
  L.mono(ctx, 'warp = 32 threads', 168, 232, 14, rgba(C.phos, 0.65), 1.5);
  L.mono(ctx, '64 warps / SM   2048 threads / SM', 168, 256, 14, rgba(C.phos, 0.65), 1.5);
  L.mono(ctx, '228 KB shared  ·  65 536 registers', 168, 280, 13, rgba(C.phos, 0.45), 1.3);
  L.mono(ctx, 'stalled warps yield the slot — that is the whole trick', 1200, 200, 14, rgba(C.phos, 0.55), 1.4);
  if (perfect > 0.25) L.mono(ctx, 'ALL 64 ISSUE · ONE CYCLE', 1200, 232, 15, rgba(C.white, 0.9 * perfect), 2.4);
  return { bloom: 1.0, chroma: 1.2 + 4 * perfect, scan: 0.55, flash: 0.05 * perfect };
}

// ---------------------------------------------------------------- m_launch
// 132 SMs ignite one after another, then everything converges into one point
function m_launch(ctx, t, u, shot){
  ctx.fillStyle = '#030507'; ctx.fillRect(0, 0, W, H);
  const t0 = shot.t0, dur = shot.dur;
  const COLS = 12, ROWS = 11;
  const cw = 96, ch = 60;
  const gx0 = (W - COLS * cw) / 2, gy0 = 250;
  const igniteStart = t0 + 0.05, igniteSpan = 2.10;
  const converge = ss(t0 + 2.20, shot.t1 - 0.02, t);
  const cx = W / 2, cy = gy0 + ROWS * ch / 2;
  ctx.save();
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++){
    const i = r * COLS + c;
    if (i >= 132) continue;
    // diagonal ignite order: bottom-left to top-right
    const order = (c + (ROWS - 1 - r)) / (COLS + ROWS - 2);
    const at = igniteStart + order * igniteSpan;
    const on = ss(at, at + 0.10, t);
    if (on <= 0) continue;
    const x = gx0 + c * cw, y = gy0 + r * ch;
    const px = lerp(x + cw / 2, cx, converge * converge * converge);
    const py = lerp(y + ch / 2, cy, converge * converge * converge);
    const sz = lerp(1, 0.25, converge);
    const glowK = on * (1 - converge * 0.5);
    ctx.fillStyle = rgba(C.ds, 0.10 + 0.35 * glowK);
    ctx.fillRect(px - cw * 0.40 * sz, py - ch * 0.34 * sz, cw * 0.80 * sz, ch * 0.68 * sz);
    ctx.strokeStyle = rgba(C.cyan, 0.30 + 0.65 * glowK); ctx.lineWidth = 1.2;
    ctx.strokeRect(px - cw * 0.40 * sz + .5, py - ch * 0.34 * sz + .5, cw * 0.80 * sz - 1, ch * 0.68 * sz - 1);
    // a beam on ignition
    const beam = Math.exp(-Math.pow((t - at) / 0.20, 2));
    if (beam > 0.05){
      ctx.strokeStyle = rgba(C.white, 0.55 * beam); ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, py - 90 * beam); ctx.stroke();
    }
  }
  ctx.restore();
  // the point
  if (converge > 0.90){
    const k = (converge - 0.90) / 0.10;
    L.glow(ctx, C.white, 90, () => { ctx.fillStyle = rgba(C.white, 0.96 * k); ctx.fillRect(cx - 5 - 10 * k, cy - 5 - 10 * k, 10 + 20 * k, 10 + 20 * k); });
  }
  L.mono(ctx, 'grid(132, 1, 1)   block(1024, 1, 1)', 168, 172, 16, rgba(C.cyan, 0.95), 1.8);
  L.mono(ctx, '132 SMs · one wave · no tail', 168, 200, 14, rgba(C.phos, 0.6), 1.4);
  const lit = Math.min(132, Math.round(ss(igniteStart, igniteStart + igniteSpan, t) * 132));
  L.mono(ctx, 'SM ' + String(lit).padStart(3) + ' / 132', 1560, 172, 16, rgba(C.white, 0.8), 2, 'right');
  return { bloom: 1.25, chroma: 1.3 + 12 * converge, scan: 0.5, flash: Math.max(0, converge - 0.88) * 1.6 };
}

module.exports = { m_warps, m_launch };
