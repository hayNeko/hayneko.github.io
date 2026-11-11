
'use strict';
const L = require('../engine/lib.js');
const K = require('./kit.js');
const { W, H, C, rgba, clamp, lerp, sat, ss, TAU, easeOutExpo, easeOutQuint, easeOutCubic, easeInCubic, easeInOutCubic, easeOutBack, BPM, SPB, BEAT0, pulse, kick, beatOf } = L;
const CX = 560, CY = 540;   // the cursor anchor: the film's origin, returned to at the end

// ---------------------------------------------------------------- a_cursor
function a_cursor(ctx, t, u){
  const g = ctx.createRadialGradient(CX, CY, 18, CX, CY, 320);
  g.addColorStop(0, 'rgba(15,28,26,0.80)'); g.addColorStop(0.55, 'rgba(6,10,12,0.98)'); g.addColorStop(1, 'rgba(3,5,8,1)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.fillStyle = C.phos;
  for (let y = 80; y < H - 60; y += 44) for (let x = 80; x < W - 60; x += 44){
    const d = Math.hypot((x - CX) / 1100, (y - CY) / 800);
    if (L.hash2(x, y) > 0.86) { ctx.globalAlpha = 0.16 * (1 - d * 0.8) * ss(0, 0.4, t); ctx.fillRect(x, y, 2, 2); }
  }
  ctx.restore();
  const R = L.mulberry32(11);
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 110; i++){
    const x0 = R() * W, y0 = R() * H, sp = 3 + R() * 14, ph = R() * TAU, br = 0.5 + R();
    const x = (x0 + Math.sin(ph + t * 0.3) * 26 + t * 4) % W, y = (y0 - t * sp) % H;
    ctx.fillStyle = rgba(C.phos, (0.06 + 0.24 * R()) * br);
    ctx.fillRect(x, (y + H) % H, br * 1.6, br * 1.6);
  }
  ctx.restore();
  const blinkPh = ((t - BEAT0) / (SPB * 2)) % 1;
  if (blinkPh < 0.46 || t < 0.06){
    const k = 1 + 0.04 * pulse(t, 0.25);
    L.glow(ctx, C.phos, 22, () => { ctx.fillStyle = rgba(C.phos, 0.95); ctx.fillRect(CX - 10 * k, CY - 23 * k, 20 * k, 46 * k); });
    ctx.fillStyle = rgba(C.white, 0.5); ctx.fillRect(CX - 10, CY - 23, 20, 46);
  }
  L.mono(ctx, 'pid  —', 96, 118, 15, rgba(C.phos, 0.42 * ss(0.30, 0.8, t)), 2.2);
  L.mono(ctx, 'state  not running', 96, 146, 15, rgba(C.phos, 0.26 * ss(0.45, 0.95, t)), 2.2);
  L.mono(ctx, 'task   none', 96, 174, 15, rgba(C.phos, 0.18 * ss(0.6, 1.05, t)), 2.2);
  const a3 = ss(0.35, 0.8, t);
  if (a3 > 0) L.brackets(ctx, 84, 84, 300, 130, 16, rgba(C.cyan, 0.25 * a3));
  return { bloom: 0.22, chroma: 0.4, scan: 0.55 };
}

// ---------------------------------------------------------------- a_line
function a_line(ctx, t, u){
  ctx.fillStyle = '#04060A'; ctx.fillRect(0, 0, W, H);
  const grow = easeOutQuint(ss(1.20, 1.55, t));
  const bow = ss(1.52, 1.74, t);
  const yAt = (x) => CY - Math.pow(Math.abs(x - CX) / 950, 2) * 26 * bow;
  const xL = CX - 760 * grow, xR = CX + 1360 * grow;
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let pass = 0; pass < 4; pass++){
    ctx.beginPath();
    for (let x = xL; x <= xR; x += 5) { const y = yAt(x); if (x === xL) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
    ctx.strokeStyle = rgba(C.phos, [0.95, 0.28, 0.08, 0.03][pass]);
    ctx.lineWidth = [1.2, 2.4, 6, 16][pass]; ctx.stroke();
  }
  ctx.restore();
  const chT = ss(1.26, 1.74, t);
  const chx = lerp(xL, CX, chT);
  if (chT > 0.001 && chT < 0.995){
    L.glow(ctx, C.cyan, 46, () => { ctx.fillStyle = C.white; ctx.fillRect(chx - 3.5, yAt(chx) - 3.5, 7, 7); });
    ctx.strokeStyle = rgba(C.white, 0.22); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(chx - 110, yAt(chx)); ctx.lineTo(chx, yAt(chx)); ctx.stroke();
  }
  const steps = [['120 V AC', 250, 1.28], ['12 V DC', 1090, 1.42], ['0.75 V', 1660, 1.56]];
  for (const st of steps){
    const a2 = ss(st[2], st[2] + 0.10, t);
    if (a2 <= 0) continue;
    const x = st[1];
    ctx.save(); ctx.globalAlpha = a2;
    L.mono(ctx, st[0], x, yAt(x) - 34, 20, rgba(C.white, 0.95), 2.4, 'center');
    ctx.strokeStyle = rgba(C.cyan, 0.75); ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(x, yAt(x) - 26); ctx.lineTo(x, yAt(x) - 8); ctx.stroke();
    ctx.fillStyle = rgba(C.cyan, 0.9); ctx.fillRect(x - 2, yAt(x) - 11, 4, 4);
    ctx.restore();
  }
  const a3 = ss(1.56, 1.74, t);
  if (a3 > 0){
    ctx.save(); ctx.globalAlpha = a3;
    L.mono(ctx, 'PDN  ·  12 phases  ·  0.75 V rail', 96, 132, 16, rgba(C.cyan, 0.8), 1.8);
    L.mono(ctx, 'clock tree skew ≈ 12 ps', 96, 160, 15, rgba(C.phos, 0.5), 1.6);
    ctx.restore();
  }
  return { bloom: 1.15, chroma: 1 + 8 * bow, scan: 0.5 };
}

// ---------------------------------------------------------------- a_dive
function a_dive(ctx, t, u){
  ctx.fillStyle = '#03050A'; ctx.fillRect(0, 0, W, H);
  const cam = L.makeCam({ pos: [0, 0, 0], yaw: 0, pitch: 0, fov: 1.45 });
  const DEPTH = 30, NSEG = 44;
  const sp = (t - 1.74) * 7.4;
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = NSEG; i >= 0; i--){
    const z = -(((i * DEPTH / NSEG + sp) % DEPTH)) - 0.35;
    const d = -z;
    const w = 0.62 + 0.030 * d;
    const P = [[-w,-w,z],[w,-w,z],[w,w,z],[-w,w,z]].map(p => L.proj(cam, p));
    if (P.some(p => !p)) continue;
    const a1 = clamp(1 - d / DEPTH, 0, 1);
    const hot = Math.pow(a1, 3);
    ctx.strokeStyle = rgba(i % 4 === 0 ? C.cyan : C.ds, 0.10 + 0.65 * hot); ctx.lineWidth = 1 + 1.6 * hot;
    ctx.beginPath(); ctx.moveTo(P[0][0],P[0][1]);
    for (let k = 1; k < 4; k++) ctx.lineTo(P[k][0],P[k][1]);
    ctx.closePath(); ctx.stroke();
    if (i % 3 === 0){
      for (const k of [0, 2]){
        const a = P[k], b = P[(k+1)%4];
        ctx.strokeStyle = rgba(C.ds, 0.10 + 0.5 * hot); ctx.lineWidth = 2 + 4 * hot;
        ctx.beginPath(); ctx.moveTo(a[0],a[1]); ctx.lineTo(b[0],b[1]); ctx.stroke();
      }
    }
  }
  const vp = L.proj(cam, [0, 0, -DEPTH - 2]);
  if (vp){
    const gg = ctx.createRadialGradient(vp[0], vp[1], 0, vp[0], vp[1], 200);
    gg.addColorStop(0, 'rgba(220,255,240,0.55)'); gg.addColorStop(0.4, 'rgba(80,255,200,0.14)'); gg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gg; ctx.fillRect(vp[0] - 200, vp[1] - 200, 400, 400);
  }
  ctx.restore();
  const R = L.mulberry32(5);
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 150; i++){
    const ang = R() * TAU, rr = 0.02 + ((R() + t * (0.7 + R() * 0.9)) % 1) * 1.0;
    const x = W/2 + Math.cos(ang) * rr * W * 0.68, y = H/2 + Math.sin(ang) * rr * H * 0.68;
    const l = 8 + rr * 150;
    ctx.strokeStyle = rgba(C.cyan, 0.06 + 0.30 * rr);
    ctx.lineWidth = 0.7 + rr * 2.0;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(ang) * l, y + Math.sin(ang) * l); ctx.stroke();
  }
  ctx.restore();
  const hit = ss(2.70, 2.92, t);
  if (hit > 0){ ctx.fillStyle = rgba(C.white, hit * 0.55); ctx.fillRect(0, 0, W, H); }
  return { bloom: 1.4, chroma: 2 + 12 * hit, flash: hit * 0.3, scan: 0.55 };
}

// ---------------------------------------------------------------- a_ecc
function a_ecc(ctx, t, u){
  ctx.fillStyle = '#04060B'; ctx.fillRect(0, 0, W, H);
  const snap = ss(2.92, 3.05, t);
  const pen = ss(3.42, 3.50, t);
  const heal = ss(3.54, 3.80, t);
  const R0 = L.mulberry32(9);
  ctx.save(); ctx.globalAlpha = 0.5;
  for (let i = 0; i < 26; i++){
    const z = ((i * 0.9 - (t - 2.92) * 3.2) % 22 + 22) % 22 + 1;
    const s = 300 / z, x = 960 + (R0() - 0.5) * 1500 * (1 + 6 / z), y = 540 + (R0() - 0.5) * 700;
    ctx.fillStyle = rgba(C.phos, 0.05 + 0.16 / z * 3);
    ctx.fillRect(x, y, s * 2.4, s * 0.5);
  }
  ctx.restore();
  const NW = 8, cell = 86, gap = 8;
  const totalW = NW * cell + (NW - 1) * gap;
  const x0 = 960 - totalW / 2, y0 = 470;
  for (let b = 0; b < NW; b++){
    const x = x0 + b * (cell + gap);
    const bad = (b === 4) ? pen * (1 - heal) : 0;
    const val = 0.3 + 0.6 * L.hash2(b, 3);
    ctx.fillStyle = rgba(C.phos, 0.06 + 0.13 * val);
    ctx.fillRect(x, y0, cell, cell);
    if (bad > 0.01){ ctx.fillStyle = rgba(C.alert, 0.85 * bad); ctx.fillRect(x, y0, cell, cell); }
    ctx.strokeStyle = rgba(bad > 0.3 ? C.alert : C.cyan, 0.35 + 0.6 * snap); ctx.lineWidth = 1.4;
    ctx.strokeRect(x + .5, y0 + .5, cell - 1, cell - 1);
    L.mono(ctx, L.bits(0x46 + b * 17, 8), x + cell / 2, y0 + cell / 2 + 6, 19, rgba(bad > 0.3 ? C.white : C.phos, 0.55 + 0.4 * snap), 1.6, 'center');
  }
  for (let c = 0; c < 8; c++){
    const on = snap;
    const x = x0 + (c + 0.5) * (cell + gap) - gap / 2;
    const y = y0 - 62;
    ctx.fillStyle = rgba(C.cyan, 0.05 + 0.8 * on);
    ctx.beginPath(); ctx.arc(x, y - 14 * (1 - on), 8, 0, TAU); ctx.fill();
    ctx.strokeStyle = rgba(C.cyan, 0.5 * on); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, y - 6); ctx.lineTo(x, y0 - 4); ctx.stroke();
    if (on > 0.5){
      ctx.strokeStyle = rgba(C.cyan, 0.16 * on);
      ctx.beginPath(); ctx.moveTo(x, y0 - 4); ctx.lineTo(x0 + Math.floor(c / 2 + 0.5) * (cell + gap) + cell / 2, y0 - 4); ctx.stroke();
    }
  }
  L.mono(ctx, '8 check bits · SECDED (72,64) · extended Hamming, d_min = 4', 960, y0 - 96, 15, rgba(C.cyan, 0.85 * snap), 2, 'center');
  if (snap > 0.02){
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const cxx = 960, cyy = y0 + cell / 2;
    for (let ring = 1; ring <= 2; ring++){
      const rr = (totalW / 2 + 40) + ring * 46;
      ctx.strokeStyle = rgba(C.cyan, 0.16 * snap / ring); ctx.lineWidth = 2;
      ctx.beginPath();
      for (let k = 0; k <= 6; k++){ const a2 = k / 6 * TAU - Math.PI / 2; const px = cxx + Math.cos(a2) * rr, py = cyy + Math.sin(a2) * rr * 0.62; if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); }
      ctx.stroke();
    }
    ctx.restore();
  }
  const strikes = [[3.10, 0.8, 1], [3.22, 2.3, 1], [3.44, 3.6, 0]];
  for (const s of strikes){
    const at = s[0], ang = s[1], bounces = s[2];
    const k = sat((t - at) / 0.22);
    if (k <= 0 || k >= 1) continue;
    const rad = lerp(1200, bounces ? 420 : 0, k);
    const px = 960 + Math.cos(ang) * rad, py = y0 + cell / 2 + Math.sin(ang) * rad * 0.6;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = rgba(C.alert, 0.9 * (1 - k * 0.5)); ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(ang) * 120, py + Math.sin(ang) * 120); ctx.stroke();
    ctx.fillStyle = C.white; ctx.fillRect(px - 4, py - 4, 8, 8);
    ctx.restore();
    if (bounces && k > 0.9){
      ctx.strokeStyle = rgba(C.alert, 0.9); ctx.lineWidth = 2;
      L.circle(ctx, px, py, 30 * (k - 0.9) * 10); ctx.stroke();
    }
  }
  if (heal > 0 && heal < 1){
    ctx.strokeStyle = rgba(C.cyan, (1 - heal) * 0.9); ctx.lineWidth = 3;
    const x = x0 + 4 * (cell + gap) + cell / 2;
    L.circle(ctx, x, y0 + cell / 2, 20 + 160 * easeOutCubic(heal)); ctx.stroke();
  }
  L.spec(ctx, 96, 190, [
    ['code', 'SECDED (72,64)'],
    ['d_min', '4'],
    ['correct', '1 bit'],
    ['detect', '2 bits'],
    ['cause', 'cosmic ray / alpha upset'],
  ], { alpha: ss(2.98, 3.3, t) * 0.9, color: C.cyan, kw: 88 });
  const alarm = pen * (1 - heal);
  ctx.fillStyle = rgba(C.alert, 0.10 * alarm); ctx.fillRect(0, 0, W, H);
  return { bloom: 1.3, chroma: 1.5 + 7 * alarm, flash: 0.06 * alarm, scan: 0.5 };
}

// ---------------------------------------------------------------- a_tiling
function a_tiling(ctx, t, u){
  ctx.fillStyle = '#04060A'; ctx.fillRect(0, 0, W, H);
  const cam = L.makeCam({ pos: [0.4, 3.6 - 0.9 * u, 7.6 - 1.6 * u], yaw: -0.20 + 0.10 * u, pitch: -0.44, fov: 1.0 });
  K.floorGrid(ctx, cam, 10, 1.0, { alpha: 0.20 });
  const N = 7, sp = 1.06, t0 = 3.90, stag = 0.0225;
  const order = [];
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++){
    order.push({ gx: (i - (N-1)/2) * sp, gz: (j - (N-1)/2) * sp, r: Math.hypot(i - (N-1)/2, j - (N-1)/2), seed: i * 13 + j * 7 });
  }
  order.sort((a,b) => a.r - b.r || a.seed - b.seed);
  order.forEach((d, idx) => {
    const at = t0 + idx * stag;
    const k = sat((t - at) / 0.15);
    if (k <= 0) return;
    const y = lerp(5.2, 0.03, easeOutQuint(k));
    const sz = 0.52;
    const verts = K.CUBE_V.map(v => [d.gx + v[0]*sz, y + (v[1]+1)*0.055, d.gz + v[2]*sz]);
    const faces = K.sortedFaces(cam, verts, K.CUBE_F);
    const fresh = 1 - sat((t - at - 0.15) / 0.8);
    const hue = L.hash2(d.seed, 1) > 0.55 ? C.phos : C.dsLite;
    for (const f of faces){
      K.polyFill(ctx, f.P, rgba(hue, 0.05 + 0.09 * (1 - f.d / 15) + 0.30 * fresh), rgba(hue, 0.28 + 0.55 * fresh), 1.1);
    }
    if (k >= 1){
      const imp = sat((t - at - 0.15) / 0.40);
      if (imp < 1){
        const c = L.proj(cam, [d.gx, 0.02, d.gz]);
        if (c){ ctx.strokeStyle = rgba(C.cyan, (1 - imp) * 0.85); ctx.lineWidth = 2.2; L.circle(ctx, c[0], c[1], 6 + 52 * easeOutCubic(imp)); ctx.stroke(); }
      }
    }
  });
  const mag = ss(4.72, 5.05, t);
  if (mag > 0){
    const ms = 500 * easeOutBack(mag, 1.4), mx = 1330 - ms / 2, my = 150;
    ctx.save(); ctx.globalAlpha = sat(mag);
    ctx.fillStyle = 'rgba(3,7,9,0.92)'; ctx.fillRect(mx, my, ms, ms);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++){
      const x = mx + i * ms / 4, y = my + j * ms / 4;
      ctx.fillStyle = rgba(C.ds, 0.10); ctx.fillRect(x, y, ms/4 - 1.5, ms/4 - 1.5);
      ctx.strokeStyle = rgba(C.cyan, 0.55); ctx.lineWidth = 1; ctx.strokeRect(x + .5, y + .5, ms/4 - 2, ms/4 - 2);
      for (let a2 = 0; a2 < 4; a2++) for (let b2 = 0; b2 < 4; b2++){
        ctx.strokeStyle = rgba(C.phos, 0.30);
        ctx.strokeRect(x + a2 * ms/16 + 1.5, y + b2 * ms/16 + 1.5, ms/16 - 3, ms/16 - 3);
      }
    }
    ctx.strokeStyle = rgba(C.cyan, 0.8); ctx.lineWidth = 1.4; ctx.strokeRect(mx + .5, my + .5, ms - 1, ms - 1);
    L.mono(ctx, 'TILE 128×128  →  4×4  →  4×4', mx + 2, my - 12, 14, rgba(C.cyan, 0.9), 1.6);
    L.mono(ctx, 'SRAM tile · register tile · thread', mx + 2, my + ms + 22, 13, rgba(C.phos, 0.6), 1.4);
    ctx.restore();
  }
  L.spec(ctx, 96, 172, [['layout','tiled GEMM'],['tile','128 × 128 × 128'],['resident','64 warps / SM']], { alpha: ss(3.98, 4.4, t) * 0.85, color: C.cyan, kw: 82 });
  return { bloom: 1.2, chroma: 1.4, scan: 0.5 };
}

// ---------------------------------------------------------------- a_arena
function a_arena(ctx, t, u){
  ctx.fillStyle = '#04060A'; ctx.fillRect(0, 0, W, H);
  const hy = 660;
  const g = ctx.createLinearGradient(0, hy - 240, 0, hy + 6);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.75, 'rgba(24,86,76,0.30)'); g.addColorStop(1, 'rgba(70,220,180,0.42)');
  ctx.fillStyle = g; ctx.fillRect(0, hy - 240, W, 246);
  const cam = L.makeCam({ pos: [0, 1.5, 6.2], yaw: 0.0, pitch: -0.055, fov: 1.15 });
  K.floorGrid(ctx, cam, 16, 1.35, { alpha: 0.11 });
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = rgba(C.cyan, 0.25); ctx.lineWidth = 8;
  ctx.beginPath(); ctx.moveTo(0, hy); ctx.lineTo(W, hy); ctx.stroke();
  ctx.strokeStyle = rgba(C.phos, 0.9); ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(0, hy); ctx.lineTo(W, hy); ctx.stroke();
  ctx.restore();
  const Ra = L.mulberry32(21);
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 7; i++){
    const x = 120 + i * 280 + (Ra() - 0.5) * 60;
    const gg = ctx.createLinearGradient(x, 0, x, hy);
    gg.addColorStop(0, 'rgba(60,200,170,0.10)'); gg.addColorStop(1, 'rgba(60,200,170,0)');
    ctx.fillStyle = gg;
    ctx.beginPath(); ctx.moveTo(x - 26, 0); ctx.lineTo(x + 26, 0); ctx.lineTo(x + 96, hy); ctx.lineTo(x - 96, hy); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
  const walk = easeOutCubic(sat((t - 5.52) / 0.84));
  const px = 360 + walk * 1220;
  for (let i = 0; i < 46; i++){
    const x = 360 + i * 27;
    if (x > px) break;
    ctx.fillStyle = rgba(C.ds, 0.30 + 0.25 * L.hash2(i, 1));
    ctx.fillRect(x, hy + 12, 22, 8);
  }
  const bob = Math.sin(t * 24) * 2;
  L.glow(ctx, C.cyan, 40, () => { ctx.fillStyle = C.white; ctx.fillRect(px - 2, hy - 26 + bob, 4, 52); });
  ctx.strokeStyle = rgba(C.cyan, 0.45); ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(360, hy + 3 + bob); ctx.lineTo(px, hy + 3 + bob); ctx.stroke();
  const addr = 0x7f2a90e00000 + Math.floor(walk * 1220 / 27) * 64;
  L.mono(ctx, 'arena  0x' + addr.toString(16), 96, hy - 300, 17, rgba(C.cyan, 0.9), 2);
  L.mono(ctx, 'brk  +=  64 B', 96, hy - 272, 15, rgba(C.phos, 0.6), 1.8);
  L.mono(ctx, 'live  0x' + (Math.floor(walk * 1220 / 27) * 64).toString(16).toUpperCase(), 96, hy - 246, 15, rgba(C.phos, 0.45), 1.8);
  L.mono(ctx, 'bump allocator — no free list, no fragmentation, yet', 96, hy + 74, 14, rgba(C.phos, 0.42), 1.6);
  return { bloom: 1.45, chroma: 1.3, scan: 0.52 };
}

// ---------------------------------------------------------------- a_object
function a_object(ctx, t, u){
  ctx.fillStyle = '#04060A'; ctx.fillRect(0, 0, W, H);
  const cam = L.makeCam({ pos: [0, 0.6, 7.4], yaw: 0.55 + 0.35 * Math.sin(t * 0.7), pitch: -0.18, fov: 1.05 });
  const pop = easeOutBack(sat((t - 6.38) / 0.34), 2.0);
  const corners = K.CUBE_V;
  // corners fly in
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  corners.forEach((v, i) => {
    const delay = i * 0.035;
    const k = easeOutQuint(sat((t - 6.38 - delay) / 0.30));
    const far = [v[0] * (1 + 5 * (1 - k)), v[1] * (1 + 5 * (1 - k)), v[2] * (1 + 5 * (1 - k))];
    const q = L.proj(cam, far); if (!q) return;
    const s = 3 + 10 * k;
    ctx.fillStyle = rgba(C.cyan, 0.5 + 0.5 * k); ctx.fillRect(q[0] - s/2, q[1] - s/2, s, s);
  });
  ctx.restore();
  const scale = 1.5 * pop;
  const verts = corners.map(v => K.tf(v, [0.0, 0.0, 0.0], scale, [0, 0.4, 0]));
  // faint faces
  const faces = K.sortedFaces(cam, verts, K.CUBE_F);
  for (const f of faces) K.polyFill(ctx, f.P, rgba(C.ds, 0.05), null);
  K.drawWire(ctx, cam, verts, K.CUBE_E, { color: C.cyan, lw: 1.6, alpha: 0.95, fade: 12 });
  // vtable pins on the corners
  corners.forEach((v, i) => {
    const q = L.proj(cam, verts[i]); if (!q) return;
    ctx.fillStyle = rgba(C.white, 0.9); ctx.fillRect(q[0] - 1.5, q[1] - 1.5, 3, 3);
    if (i % 2 === 0) L.mono(ctx, 'v' + i, q[0] + 6, q[1] - 4, 10, rgba(C.cyan, 0.35), 0);
  });
  // the birth certificate
  const ca = ss(6.75, 7.10, t);
  if (ca > 0){
    const refc = Math.min(1, Math.floor((t - 6.75) / 0.10) + 1);
    L.spec(ctx, 1160, 330, [
      ['refcnt', String(refc)],
      ['type', '0x4D6BFE  (world)'],
      ['vtable', '0x7f2a90e01040'],
      ['size', '6 712 000 000 B'],
      ['state', refc > 0 ? 'alive' : 'free'],
    ], { alpha: ca * 0.9, color: C.cyan, kw: 84 });
    const a2 = ss(6.85, 7.2, t);
    L.mono(ctx, 'OBJECT CREATION', 1160, 300, 13, rgba(C.phos, 0.5 * a2), 3);
  }
  const hum = 0.9 + 0.1 * pulse(t, 0.2);
  return { bloom: 1.25 * hum, chroma: 1.4, scan: 0.5 };
}

// ---------------------------------------------------------------- a_params
function a_params(ctx, t, u){
  ctx.fillStyle = '#04060A'; ctx.fillRect(0, 0, W, H);
  const cam = L.makeCam({ pos: [0, 1.0, 10.8 - 1.5 * u], yaw: 0.35 + 0.42 * u, pitch: -0.12, fov: 1.02 });
  const grow = 1 + 0.38 * easeOutCubic(sat((t - 7.55) / 2.4));
  const S = 1.12 * grow;
  const verts = K.CUBE_V.map(v => K.tf(v, [0,0,0], S, [0, 0.3, 0]));
  // heat-mapped faces
  const faces = K.sortedFaces(cam, verts, K.CUBE_F);
  faces.forEach((f, fi) => {
    const heat = 0.20 + 0.55 * L.fbm(f.P[0][0] * 0.004 + t * 0.7, f.P[0][1] * 0.004, 3);
    K.polyFill(ctx, f.P, rgba(fi % 2 ? C.ds : C.phos, 0.05 + 0.12 * heat), rgba(C.cyan, 0.5), 1.2);
    // texture lines inside the face
    ctx.save(); ctx.beginPath(); ctx.moveTo(f.P[0][0], f.P[0][1]);
    for (let i = 1; i < f.P.length; i++) ctx.lineTo(f.P[i][0], f.P[i][1]);
    ctx.closePath(); ctx.clip();
    for (let i = 0; i < 7; i++){
      const yy = f.P[0][1] + (i + 1) * (f.P[2][1] - f.P[0][1]) / 8;
      ctx.strokeStyle = rgba(C.cyan, 0.10 + 0.12 * L.hash2(i, fi)); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(f.P[0][0], yy); ctx.lineTo(f.P[1][0], yy); ctx.stroke();
    }
    ctx.restore();
  });
  K.drawWire(ctx, cam, verts, K.CUBE_E, { color: C.cyan, lw: 1.4, alpha: 0.85, fade: 14 });
  // pouring numbers
  const top = L.proj(cam, [0, S + 0.3, 0]);
  if (top){
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const R = L.mulberry32(77);
    for (let i = 0; i < 64; i++){
      const x = top[0] + (R() - 0.5) * 700 * (0.4 + R() * 0.7);
      const ph = ((t * (1.6 + R() * 1.6) + R() * 5) % 1);
      const y = top[1] - 460 * (1 - ph);
      const a2 = ph * (1 - ph) * 3.4;
      const digits = String(Math.floor(R() * 9000) + 1000);
      L.mono(ctx, digits, x, y, 11 + 5 * ph, rgba(C.cyan, clamp(a2, 0, 0.9) * 0.8), 1);
    }
    ctx.restore();
  }
  // tensor shapes streaming
  const shapes = ['[7168 × 2048]', '[2048 × 7168]', '[4096 × 7168]', '[7168 × 18432]', 'uint8  e4m3'];
  const sa = ss(7.7, 8.1, t);
  if (sa > 0){
    ctx.save(); ctx.globalAlpha = sa * 0.85;
    shapes.forEach((s, i) => {
      const yy = 250 + i * 30;
      const x = 120;
      L.mono(ctx, s, x, yy, 14, rgba(C.phos, 0.35 + 0.5 * (0.5 + 0.5 * Math.sin(t * 3 - i))), 1.2);
    });
    L.mono(ctx, '671 × 10^9 parameters', 120, 440, 17, rgba(C.cyan, 0.9), 1.6);
    L.mono(ctx, 'FP8 → 671 GB of weights', 120, 468, 14, rgba(C.phos, 0.6), 1.2);
    ctx.restore();
  }
  const fill = sat((t - 7.45) / 2.5);
  return { bloom: 1.1 + 0.25 * fill, chroma: 1.5 + 2 * fill, scan: 0.5 };
}

// ---------------------------------------------------------------- a_init
function a_init(ctx, t, u){
  ctx.fillStyle = '#04060A'; ctx.fillRect(0, 0, W, H);
  const burst = easeOutCubic(sat((t - 10.09) / 0.30));
  const collapse = easeInCubic(sat((t - 10.55) / 0.42));
  const cam = L.makeCam({ pos: [0, 0.2, 9.6], yaw: 0.1, pitch: -0.02, fov: 1.05 });
  const R = L.mulberry32(4242);
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  // samples: cube corners -> gaussian cloud -> seed
  const gauss = [];
  for (let i = 0; i < 2600; i++){
    // Box-Muller
    const a1 = R() * TAU, r1 = Math.sqrt(-2 * Math.log(R() + 1e-6));
    gauss.push([r1 * Math.cos(a1) * 1.9, r1 * Math.sin(a1 * 1.7) * 1.5, (R() - 0.5) * 2]);
  }
  const seedX = [0.2, -0.1, 0];
  gauss.forEach((g, i) => {
    const corner = K.CUBE_V[i % 8];
    const bx = corner[0] * 1.4, by = corner[1] * 1.4 + 0.3, bz = corner[2] * 1.4;
    let x = lerp(bx, g[0], burst), y = lerp(by, g[1], burst), z = lerp(bz, g[2], burst);
    x = lerp(x, seedX[0], collapse); y = lerp(y, seedX[1], collapse); z = lerp(z, seedX[2], collapse);
    const q = L.proj(cam, [x, y, z]); if (!q) return;
    const d = clamp(1 - q[2] / 16, 0.1, 1);
    const s = (1.6 + 2.2 * (1 - collapse)) * d;
    ctx.fillStyle = rgba(i % 7 === 0 ? C.dsLite : C.cyan, 0.30 * d + 0.45 * (1 - burst));
    ctx.fillRect(q[0], q[1], s, s);
  });
  ctx.restore();
  // the 1-D gaussian silhouette overlaid
  const ga = ss(10.30, 10.55, t) * (1 - ss(10.72, 10.90, t));
  if (ga > 0){
    ctx.save(); ctx.globalAlpha = ga;
    const cx = 960, base = 760, amp = 250, sig = 210;
    ctx.beginPath();
    for (let x = -700; x <= 700; x += 4){ const y = base - amp * Math.exp(-(x*x) / (2*sig*sig)); if (x === -700) ctx.moveTo(cx + x, y); else ctx.lineTo(cx + x, y); }
    ctx.strokeStyle = rgba(C.cyan, 0.9); ctx.lineWidth = 2.4; ctx.stroke();
    ctx.lineTo(cx + 700, base); ctx.lineTo(cx - 700, base); ctx.closePath();
    ctx.fillStyle = rgba(C.cyan, 0.07); ctx.fill();
    L.mono(ctx, 'σ = √(2 / (fan_in + fan_out))', 960, 84, 20, rgba(C.white, 0.9), 2, 'center');
    L.mono(ctx, 'seeded RNG — the same draw, every time', 960, 118, 14, rgba(C.phos, 0.6), 1.6, 'center');
    ctx.restore();
  }
  // seed
  if (collapse > 0.6){
    const k = (collapse - 0.6) / 0.4;
    L.glow(ctx, C.white, 60 * k, () => { ctx.fillStyle = rgba(C.white, 0.95); ctx.fillRect(956, 540, 8, 8); });
  }
  return { bloom: 1.15, chroma: 1.2 + 6 * burst * (1 - collapse), flash: 0.18 * burst * (1 - ss(10.38, 10.56, t)), scan: 0.45 };
}

// ---------------------------------------------------------------- a_addrmap
function a_addrmap(ctx, t, u){
  ctx.fillStyle = '#04060A'; ctx.fillRect(0, 0, W, H);
  const bx = 190, by = 372, bw = 1540, bh = 62;
  const growA = easeOutExpo(sat((t - 11.10) / 0.35));
  // the flattened gaussian becomes a bar
  ctx.save(); ctx.globalAlpha = growA;
  const segs = [
    { a: 0.00, b: 0.040, c: C.dsLite, n: '.text' },
    { a: 0.040, b: 0.070, c: C.ds, n: '.data' },
    { a: 0.070, b: 0.090, c: C.dsLite, n: '.bss' },
    { a: 0.090, b: 0.550, c: C.phos, n: 'heap →' },
    { a: 0.550, b: 0.620, c: C.alert, n: '(unmapped)' },
    { a: 0.620, b: 0.960, c: C.phos, n: 'mmap / libc' },
    { a: 0.960, b: 1.000, c: C.cyan, n: '← stack' },
  ];
  K.segBar(ctx, bx, by, bw * growA, bh, segs.filter(s => s));
  segs.forEach(s => {
    if (s.b * bw * growA < s.a * bw) return;
    const cx = bx + bw * (s.a + s.b) / 2;
    L.mono(ctx, s.n, cx, by - 12, 12, rgba(s.c, 0.85), 1, 'center');
  });
  ctx.restore();
  // heap / stack arrows
  const ha = ss(11.35, 11.7, t);
  if (ha > 0){
    ctx.save(); ctx.globalAlpha = ha;
    const hx = bx + bw * (0.09 + 0.10 * sat((t - 11.35) / 1.2));
    ctx.strokeStyle = C.phos; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(hx, by + bh + 8); ctx.lineTo(hx - 14, by + bh + 24); ctx.lineTo(hx + 14, by + bh + 24); ctx.closePath(); ctx.stroke();
    L.mono(ctx, 'brk', hx, by + bh + 44, 12, rgba(C.phos, 0.7), 1, 'center');
    const sx = bx + bw * 0.96;
    ctx.beginPath(); ctx.moveTo(sx, by + bh + 8); ctx.lineTo(sx - 14, by + bh + 24); ctx.lineTo(sx + 14, by + bh + 24); ctx.closePath(); ctx.stroke();
    L.mono(ctx, 'rsp', sx, by + bh + 44, 12, rgba(C.cyan, 0.7), 1, 'center');
    ctx.restore();
  }
  // page table walk
  const wa = ss(11.62, 11.95, t);
  if (wa > 0){
    const ly = 560, levels = ['PGD', 'PUD', 'PMD', 'PTE'], n = 4;
    for (let L2 = 0; L2 < n; L2++){
      const x = 250 + L2 * 350;
      const lit = sat((t - 11.62 - L2 * 0.13) / 0.12);
      const pad = 26;
      // 4x4 node grid per level
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++){
        const cell = 26, cx2 = x + i * cell, cy2 = ly + j * cell;
        const on = lit * (i === 2 && j === 1 ? 1 : 0.28);
        ctx.fillStyle = rgba(C.cyan, 0.05 + 0.55 * on);
        ctx.fillRect(cx2, cy2, cell - 2, cell - 2);
        ctx.strokeStyle = rgba(C.cyan, 0.20 + 0.5 * on); ctx.lineWidth = 1;
        ctx.strokeRect(cx2 + .5, cy2 + .5, cell - 3, cell - 3);
      }
      L.mono(ctx, levels[L2], x, ly - 16, 15, rgba(C.cyan, 0.4 + 0.6 * lit), 2);
      L.mono(ctx, '9 bits', x + 118, ly - 16, 11, rgba(C.phos, 0.4 * lit), 1);
      // arrow
      if (L2 < n - 1){
        ctx.strokeStyle = rgba(C.phos, 0.30 + 0.5 * lit); ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(x + 108, ly + 52); ctx.lineTo(x + 196, ly + 52); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x + 190, ly + 48); ctx.lineTo(x + 196, ly + 52); ctx.lineTo(x + 190, ly + 56); ctx.stroke();
      }
    }
    // final frame
    const fx = 250 + 3 * 350 + 200;
    const fa = ss(12.15, 12.45, t);
    if (fa > 0){
      ctx.fillStyle = rgba(C.phos, 0.10 * fa); ctx.fillRect(fx, ly, 130, 104);
      ctx.strokeStyle = rgba(C.phos, 0.7 * fa); ctx.lineWidth = 1.4; ctx.strokeRect(fx + .5, ly + .5, 130, 104);
      L.mono(ctx, '4 KiB', fx + 65, ly + 46, 15, rgba(C.white, 0.9 * fa), 1, 'center');
      L.mono(ctx, 'page frame', fx + 65, ly + 68, 11, rgba(C.cyan, 0.7 * fa), 1, 'center');
    }
    L.mono(ctx, '4-level walk · 9+9+9+9 index bits + 12 offset = 48-bit address · 4 KiB pages', 250, ly + 160, 14, rgba(C.phos, 0.6 * wa), 1.2);
  }
  return { bloom: 1.15, chroma: 1.3, scan: 0.5 };
}

// ---------------------------------------------------------------- a_hbm
function a_hbm(ctx, t, u){
  ctx.fillStyle = '#04060A'; ctx.fillRect(0, 0, W, H);
  const s = 1 - 0.72 * easeInOutCubic(u);      // continuous zoom out
  const cx = 960, cy = 540;
  ctx.save(); ctx.translate(cx, cy); ctx.scale(s * 2.6, s * 2.6); ctx.translate(-cx / 1, -cy / 1);
  // isometric base
  const iso = (x, y, z) => [cx + (x - z) * 0.866, cy + (x + z) * 0.5 - y];
  // package substrate
  ctx.fillStyle = 'rgba(20,40,50,0.7)';
  const base = [iso(-150, 0, -150), iso(150, 0, -150), iso(150, 0, 150), iso(-150, 0, 150)];
  K.polyFill(ctx, base, 'rgba(16,32,42,0.85)', rgba(C.phos, 0.35), 1.2);
  // 8 HBM stacks around the logic die
  const stacks = [[-108, -108], [0, -108], [108, -108], [-108, 0], [108, 0], [-108, 108], [0, 108], [108, 108]];
  stacks.forEach(([x, z], i) => {
    const layers = 8, lh = 5;
    for (let l = 0; l < layers; l++){
      const y = 8 + l * lh;
      const h2 = 42;
      const topF = [iso(x - h2, y + lh, z - h2), iso(x + h2, y + lh, z - h2), iso(x + h2, y + lh, z + h2), iso(x - h2, y + lh, z + h2)];
      const lit = 0.25 + 0.55 * sat(0.5 + 0.5 * Math.sin(t * 4 - l * 0.5 - i));
      K.polyFill(ctx, topF, rgba(C.ds, 0.10 + 0.30 * lit), rgba(C.cyan, 0.45), 0.8);
    }
    const tq = L.proj ? 0 : 0;
    const lab = iso(x, 8 + 8 * lh + 26, z);
    if (s > 0.5) L.mono(ctx, 'stack ' + (i + 1), lab[0], lab[1], 10 / s, rgba(C.cyan, 0.55), 1, 'center');
  });
  // logic die in the middle
  const lf = [iso(-52, 30, -52), iso(52, 30, -52), iso(52, 30, 52), iso(-52, 30, 52)];
  K.polyFill(ctx, lf, rgba(C.phos, 0.16), rgba(C.phos, 0.8), 1.4);
  const lc = iso(0, 30, 0);
  L.mono(ctx, 'LOGIC', lc[0], lc[1], 12 / s, rgba(C.white, 0.85), 1.4, 'center');
  ctx.restore();
  // datasheet
  const a2 = ss(12.95, 13.3, t) * (1 - ss(13.7, 13.89, t));
  L.spec(ctx, 96, 150, [
    ['stack', '8 DRAM dies'],
    ['bus', '1024-bit / stack'],
    ['cap', '80 GB total'],
    ['bw', '3.35 TB/s'],
    ['pkg', 'H100 SXM: 5 stacks'],
  ], { alpha: a2, color: C.cyan, kw: 70 });
  const a3 = ss(13.4, 13.75, t) * (1 - ss(13.75, 13.89, t));
  if (a3 > 0) L.mono(ctx, '1 page → 1 bank row → 1 DIMM → 1 stack', 960, 990, 16, rgba(C.cyan, 0.8 * a3), 2, 'center');
  return { bloom: 1.2, chroma: 1.2, scan: 0.5 };
}

// ---------------------------------------------------------------- a_firstpass
function a_firstpass(ctx, t, u){
  ctx.fillStyle = '#04060A'; ctx.fillRect(0, 0, W, H);
  const cam = L.makeCam({ pos: [0, 0, 9], yaw: 0, pitch: 0, fov: 1.1 });
  // Droste corridor of frames
  const N = 9;
  for (let i = N; i >= 0; i--){
    const z = -(i * 1.55 - u * 2.2);
    const w = 7.2 - i * 0.06;
    const P = [[-w, -w*0.62, z], [w, -w*0.62, z], [w, w*0.62, z], [-w, w*0.62, z]].map(p => L.proj(cam, p));
    if (P.some(p => !p)) continue;
    const al = clamp(1 - i / (N + 2), 0.05, 1);
    ctx.strokeStyle = rgba(i % 3 === 0 ? C.cyan : C.ds, al * 0.7); ctx.lineWidth = 1 + (i === 0 ? 2 : 0);
    ctx.beginPath(); ctx.moveTo(P[0][0], P[0][1]);
    for (let k = 1; k < 4; k++) ctx.lineTo(P[k][0], P[k][1]);
    ctx.closePath(); ctx.stroke();
  }
  // the lattice + wave
  const cam2 = L.makeCam({ pos: [0, 0.4, 7.6], yaw: 0.28 + 0.1 * u, pitch: -0.16, fov: 1.05 });
  const nodes = [];
  for (let i = -4; i <= 4; i++) for (let j = -2; j <= 2; j++) for (let k = -4; k <= 4; k++) nodes.push([i * 1.0, j * 1.0, k * 1.0 - 3]);
  const wave = (u * 9) - 4.5;
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (const n of nodes){
    const q = L.proj(cam2, n); if (!q) continue;
    const act = Math.exp(-Math.pow(n[2] - wave, 2) * 0.55);
    const d = clamp(1 - q[2] / 16, 0.08, 1);
    const s = 2 + 6 * act;
    ctx.fillStyle = rgba(act > 0.4 ? C.white : C.cyan, (0.18 + 0.75 * act) * d);
    ctx.fillRect(q[0] - s/2, q[1] - s/2, s, s);
  }
  ctx.restore();
  // layer counter
  const layer = Math.min(61, 1 + Math.floor(u * 61));
  L.mono(ctx, 'layer ' + String(layer).padStart(2, '0') + ' / 61', 96, 140, 16, rgba(C.cyan, 0.8), 2);
  L.mono(ctx, '74 GFLOP / token', 96, 168, 13, rgba(C.phos, 0.5), 1.4);
  return { bloom: 1.25, chroma: 1.4 + 6 * u, scan: 0.5 };
}

// ---------------------------------------------------------------- a_breath
function a_breath(ctx, t, u){
  ctx.fillStyle = '#030507'; ctx.fillRect(0, 0, W, H);
  const a2 = ss(14.89, 15.05, t) * (1 - ss(15.6, 16.0, t));
  ctx.strokeStyle = rgba(C.phos, 0.85 * a2); ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(560, 540); ctx.lineTo(560 + 800 * easeOutQuint(sat((t - 14.92) / 0.5)), 540); ctx.stroke();
  const blink = ((t - 14.89) / 0.4615) % 1;
  if (blink < 0.4 && a2 > 0.2){ L.glow(ctx, C.phos, 26, () => { ctx.fillStyle = rgba(C.phos, 0.95); ctx.fillRect(556, 531, 9, 19); }); }
  const aa = ss(15.0, 15.25, t) * (1 - ss(15.75, 16.0, t));
  L.mono(ctx, 'no caller', 96, 140, 18, rgba(C.alert, 0.85 * aa), 2.6);
  L.mono(ctx, '0 req/s', 96, 170, 15, rgba(C.phos, 0.45 * aa), 2);
  L.mono(ctx, 'idle 1.11 s', 1660, 140, 15, rgba(C.phos, 0.40 * aa), 2);
  return { bloom: 0.8, chroma: 0.5, scan: 0.6, grain: 0.12 };
}

module.exports = { a_cursor, a_line, a_dive, a_ecc, a_tiling, a_arena, a_object, a_params, a_init, a_addrmap, a_hbm, a_firstpass, a_breath };
