
'use strict';
const L = require('../engine/lib.js');
const K = require('./kit.js');
const { W, H, C, rgba, clamp, lerp, sat, ss, TAU, easeOutExpo, easeOutQuint, easeOutCubic, easeInCubic, easeInOutCubic, easeOutBack, easeInExpo, BPM, SPB, BEAT0, pulse, kick } = L;

const SRC = 'world.execute(me);';
const TOK = [[0,5,'IDENT','world'], [5,6,'DOT','.'], [6,13,'IDENT','execute'], [13,18,'CALL','(me)']];

// ---------------------------------------------------------------- b_type
function b_type(ctx, t, u, shot){
  ctx.fillStyle = '#04060A'; ctx.fillRect(0, 0, W, H);
  const FS = 96, yb = 566;
  ctx.font = L.F(FS, L.MONO);
  const cw = ctx.measureText('M').width;
  const x0 = Math.round((W - cw * 18) / 2);
  const tStart = shot.t0 + 0.10, typeDur = 0.92;
  const prog = sat((t - tStart) / typeDur);
  const nch = prog <= 0 ? 0 : Math.min(SRC.length, Math.floor(prog * SRC.length + 0.999));
  ctx.strokeStyle = rgba(C.phos, 0.16); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x0, yb + 26); ctx.lineTo(x0 + cw * 18, yb + 26); ctx.stroke();
  for (let i = 0; i <= 18; i++){ const x = x0 + cw * i; ctx.beginPath(); ctx.moveTo(x, yb + 22); ctx.lineTo(x, yb + 30); ctx.stroke(); }
  const lift = ss(17.04, 17.62, t);
  const split = ss(17.35, 17.95, t);
  for (let i = 0; i < nch; i++){
    let tok = 0; for (let k = 0; k < TOK.length; k++) if (i >= TOK[k][0] && i < TOK[k][1]) tok = k;
    const fresh = clamp((nch - i) / 3, 0, 1);
    const dx = (TOK[tok][0] + TOK[tok][1]) / 2 - 9;
    const ox = dx * 26 * split;
    const dy = -lift * 26 - split * 10 * (tok % 2);
    const sc = 1 - lift * 0.04;
    ctx.save();
    ctx.translate(x0 + cw * i + cw * 0.5 + ox, yb + dy);
    ctx.scale(sc, sc);
    const col = i === 5 ? C.cyan : (fresh < 1 ? C.white : C.phos);
    ctx.fillStyle = rgba(col, 0.55 + 0.45 * fresh);
    if (fresh > 0.9) L.glow(ctx, C.cyan, 26, () => ctx.fillText(SRC[i], -cw * 0.5, 0));
    else ctx.fillText(SRC[i], -cw * 0.5, 0);
    ctx.restore();
  }
  if (prog < 1){
    const cx = x0 + cw * nch;
    L.glow(ctx, C.white, 30, () => { ctx.fillStyle = rgba(C.white, 0.95); ctx.fillRect(cx, yb - FS * 0.82, 3, FS); });
    const R = L.mulberry32(Math.floor(t * 60));
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const ph = ((t - tStart) % 0.06) / 0.06;
    for (let i = 0; i < 10; i++){
      const a2 = R() * TAU, rr = 10 + R() * 30;
      ctx.strokeStyle = rgba(C.cyan, 0.5 * (1 - ph)); ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(cx, yb - FS * 0.4); ctx.lineTo(cx + Math.cos(a2) * rr, yb - FS * 0.4 + Math.sin(a2) * rr); ctx.stroke();
    }
    ctx.restore();
  }
  if (split > 0){
    const a2 = sat(split * 1.4);
    TOK.forEach((tk) => {
      const cxm = x0 + cw * ((tk[0] + tk[1]) / 2) + ((tk[0] + tk[1]) / 2 - 9) * 26 * split;
      const y = yb + 66;
      ctx.save(); ctx.globalAlpha = a2 * 0.9;
      L.mono(ctx, tk[2], cxm, y, 14, rgba(C.cyan, 0.95), 2, 'center');
      L.mono(ctx, tk[3], cxm, y + 20, 12, rgba(C.phos, 0.55), 1, 'center');
      ctx.strokeStyle = rgba(C.cyan, 0.35); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cxm, yb + 16); ctx.lineTo(cxm, y - 18); ctx.stroke();
      ctx.restore();
    });
  }
  L.spec(ctx, 168, 196, [['stage','source → lexer'],['tokens','IDENT · DOT · IDENT · CALL'],['chars',String(SRC.length)]],
    { alpha: ss(shot.t0 + 0.2, shot.t0 + 0.7, t) * (1 - lift) * 0.9, color: C.cyan, kw: 74 });
  return { bloom: 1.15, chroma: 1 + 6 * split, scan: 0.5 };
}

// ---------------------------------------------------------------- b_call
function b_call(ctx, t, u, shot){
  ctx.fillStyle = '#04060A'; ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.translate(960, 556); ctx.scale(1.24, 1.24); ctx.translate(-960, -480);
  const cam = L.makeCam({ pos: [0, 0.5, 10.5], yaw: 0.16, pitch: -0.10, fov: 1.05 });
  const nA = ss(shot.t0, shot.t0 + 0.25, t);
  const nb = L.proj(cam, [-3.1, 1.2, 0]);
  if (nb){
    const w = 300, hh = 400;
    ctx.strokeStyle = rgba(C.ds, 0.6 * nA); ctx.lineWidth = 1.6;
    ctx.strokeRect(nb[0] - w / 2, nb[1] - hh / 2, w, hh);
    L.mono(ctx, 'namespace world', nb[0] - w / 2 + 12, nb[1] - hh / 2 - 12, 15, rgba(C.dsLite, 0.95 * nA), 1.8);
    const ma = ss(shot.t0 + 0.12, shot.t0 + 0.4, t);
    ctx.strokeStyle = rgba(C.cyan, 0.85 * ma); ctx.lineWidth = 1.6;
    ctx.fillStyle = rgba(C.ds, 0.12 * ma);
    ctx.fillRect(nb[0] - 110, nb[1] - 44, 220, 88); ctx.strokeRect(nb[0] - 110, nb[1] - 44, 220, 88);
    L.mono(ctx, 'execute', nb[0], nb[1] + 8, 22, rgba(C.white, 0.95 * ma), 2, 'center');
    L.mono(ctx, 'code @0x7f2a…1040', nb[0], nb[1] + 34, 11, rgba(C.phos, 0.55 * ma), 1, 'center');
  }
  const railA = ss(shot.t0 + 0.35, shot.t0 + 0.8, t);
  if (railA > 0){
    const y = 540, x1 = 980;
    ctx.strokeStyle = rgba(C.cyan, 0.65 * railA); ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(1700, y); ctx.stroke();
    for (let i = 0; i < 3; i++){
      const x = x1 + 40 + i * 190;
      ctx.strokeStyle = rgba(C.cyan, 0.4 * railA); ctx.lineWidth = 1;
      ctx.strokeRect(x, y - 54, 140, 108);
    }
    L.mono(ctx, 'RDI', x1 + 110, y - 66, 13, rgba(C.cyan, 0.95 * railA), 1.6, 'center');
    L.mono(ctx, 'RSI', x1 + 300, y - 66, 13, rgba(C.phos, 0.35 * railA), 1.6, 'center');
    L.mono(ctx, 'RDX', x1 + 490, y - 66, 13, rgba(C.phos, 0.35 * railA), 1.6, 'center');
  }
  const slide = easeOutBack(sat((t - (shot.t0 + 0.62)) / 0.55), 1.5);
  const ax = lerp(1900, 1080, slide), ay = 540;
  const pop = ss(shot.t0 + 0.55, shot.t0 + 0.75, t);
  if (pop > 0){
    const s = 26 + 5 * pulse(t, 0.2);
    ctx.save(); ctx.translate(ax, ay); ctx.rotate(t * 0.9);
    ctx.strokeStyle = rgba(C.cyan, 0.95); ctx.lineWidth = 1.6;
    L.glow(ctx, C.cyan, 18, () => { ctx.strokeRect(-s, -s, s * 2, s * 2); });
    ctx.strokeStyle = rgba(C.dsLite, 0.7);
    ctx.beginPath(); ctx.moveTo(-s, -s); ctx.lineTo(s, s); ctx.moveTo(s, -s); ctx.lineTo(-s, s); ctx.stroke();
    ctx.restore();
    L.mono(ctx, 'me', ax, ay - s - 16, 15, rgba(C.white, 0.92), 2, 'center');
  }
  const frames = [['main', 0.00], ['world.execute', 0.14], ['(callee)', 0.28]];
  frames.forEach((f, i) => {
    const a2 = ss(shot.t0 + 0.9 + f[1], shot.t0 + 1.15 + f[1], t);
    if (a2 <= 0) return;
    const x = 1246, y = 250 + i * 74;
    ctx.fillStyle = rgba(C.ds, 0.12 * a2);
    ctx.fillRect(x, y, 436, 62);
    ctx.strokeStyle = rgba(C.cyan, 0.75 * a2); ctx.lineWidth = 1.4;
    ctx.strokeRect(x, y, 436, 62);
    L.mono(ctx, 'frame  ' + f[0], x + 16, y + 28, 16, rgba(C.white, 0.92 * a2), 1.4);
    L.mono(ctx, 'rsp  −0x' + (40 + i * 48).toString(16).toUpperCase(), x + 16, y + 50, 11, rgba(C.phos, 0.6 * a2), 1);
    if (i === 2) L.mono(ctx, '◀ current', x + 330, y + 40, 12, rgba(C.cyan, 0.85 * a2), 1.2);
  });
  L.mono(ctx, 'push rbp · sub rsp, 0x30 · mov rdi, [me]', 1246, 214, 14, rgba(C.phos, 0.6 * ss(shot.t0 + 1.0, shot.t0 + 1.4, t)), 1.4);
  ctx.restore();
  L.mono(ctx, 'argument is passed by reference — the callee sees the object itself, not a copy', 168, 906, 15, rgba(C.cyan, 0.65 * ss(shot.t0 + 0.9, shot.t0 + 1.5, t)), 1.4);
  return { bloom: 1.05, chroma: 1.4, scan: 0.5 };
}

// ---------------------------------------------------------------- b_grid
function b_grid(ctx, t, u, shot){
  ctx.fillStyle = '#04060A'; ctx.fillRect(0, 0, W, H);
  const COLS = 24, ROWS = 13, cw = 78, ch = 54;
  const gx0 = (W - COLS * cw) / 2 + 6, gy0 = 258;
  const t0 = shot.t0;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++){
    const x = gx0 + c * cw, y = gy0 + r * ch;
    const dx = c - (COLS - 1) / 2, dy = r - (ROWS - 1) / 2;
    const d = Math.hypot(dx / COLS, dy / ROWS);
    const on = ss(t0 + 0.15 + d * 0.9, t0 + 0.35 + d * 0.9, t);
    if (on <= 0) continue;
    ctx.fillStyle = rgba(C.ds, 0.05 + 0.10 * on);
    ctx.fillRect(x, y, cw - 6, ch - 6);
    ctx.strokeStyle = rgba(C.cyan, 0.10 + 0.35 * on); ctx.lineWidth = 1;
    ctx.strokeRect(x + .5, y + .5, cw - 7, ch - 7);
    const lit = 0.35 + 0.65 * Math.max(0, Math.sin(t * 5 - d * 9));
    ctx.fillStyle = rgba(on > 0.9 ? C.cyan : C.phos, 0.25 + 0.6 * lit * on);
    ctx.fillRect(x + cw / 2 - 10, y + ch / 2 - 8, 5, 5);
  }
  const bp = ((t - BEAT0) / SPB) % 1;
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  const wy = gy0 + bp * ROWS * ch;
  const gg = ctx.createLinearGradient(0, wy - 60, 0, wy + 60);
  gg.addColorStop(0, 'rgba(0,0,0,0)'); gg.addColorStop(0.5, 'rgba(120,255,200,0.10)'); gg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gg; ctx.fillRect(gx0, wy - 60, COLS * cw, 120);
  ctx.restore();
  L.mono(ctx, 'grid(256, 1, 1)   block(1024, 1, 1)   262144 threads', 168, 200, 16, rgba(C.cyan, 0.9), 1.8);
  L.mono(ctx, 'one instruction, issued to every thread at once', 168, 244, 13, rgba(C.phos, 0.55), 1.4);
  L.mono(ctx, 'SIMT', W - 200, 220, 26, rgba(C.dsLite, 0.9), 6, 'right');
  const rec = ss(shot.t1 - 0.55, shot.t1 - 0.12, t);
  if (rec > 0){
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 240; i++){
      const a2 = i / 240 * TAU, rr = (1 - rec) * 900 * (0.4 + 0.6 * L.hash2(i, 3));
      ctx.fillStyle = rgba(C.white, rec * 0.9);
      ctx.fillRect(W / 2 + Math.cos(a2) * rr, 600 + Math.sin(a2) * rr * 0.55, 3, 3);
    }
    ctx.restore();
    ctx.fillStyle = rgba(C.white, rec * rec * 0.85); ctx.fillRect(0, 0, W, H);
  }
  return { bloom: 0.85, chroma: 1.4 + 8 * rec, flash: rec * rec * 0.4, scan: 0.45 };
}

// ---------------------------------------------------------------- c_pullback
function c_pullback(ctx, t, u, shot){
  ctx.fillStyle = '#030507'; ctx.fillRect(0, 0, W, H);
  const LEVELS = [
    { s: 0.020, n: 'die',     d: '132 SM · 671 mm^2' },
    { s: 0.070, n: 'package', d: '8 × HBM3e stacks' },
    { s: 0.320, n: 'board',   d: '8 sites · 900 GB/s NVLink' },
    { s: 1.400, n: 'node',    d: '8 × H800 · 80 GB each' },
    { s: 6.000, n: 'rack',    d: '≈ 41 kW · 4 systems' },
    { s: 26.00, n: 'aisle',   d: '40 racks' },
    { s: 120.0, n: 'hall',    d: 'PUE 1.09' },
    { s: 620.0, n: 'campus',  d: 'substation 120 MW' },
  ];
  const Z = Math.exp(lerp(Math.log(0.012), Math.log(760), easeInOutCubic(u)));
  const cx = W / 2, cy = H / 2 + 30;
  for (let i = 0; i < LEVELS.length; i++){
    const L2 = LEVELS[i];
    const rel = Math.log(Z / L2.s);
    const a2 = Math.exp(-Math.pow(rel / 1.05, 2));
    if (a2 < 0.02) continue;
    const size = L2.s / Z * 1500;
    if (size < 3 || size > 6200) continue;
    ctx.save(); ctx.globalAlpha = a2;
    const col = i < 3 ? C.ds : C.phos;
    ctx.strokeStyle = rgba(col, 0.6); ctx.lineWidth = 1.6;
    ctx.strokeRect(cx - size / 2, cy - size * 0.36, size, size * 0.72);
    const n = i < 4 ? 4 : 6;
    for (let a3 = 1; a3 < n; a3++){
      ctx.strokeStyle = rgba(col, 0.22);
      ctx.beginPath(); ctx.moveTo(cx - size / 2 + size * a3 / n, cy - size * 0.36); ctx.lineTo(cx - size / 2 + size * a3 / n, cy + size * 0.36); ctx.stroke();
    }
    for (let a3 = 1; a3 < 3; a3++){
      ctx.strokeStyle = rgba(col, 0.22);
      ctx.beginPath(); ctx.moveTo(cx - size / 2, cy - size * 0.36 + size * 0.72 * a3 / 3); ctx.lineTo(cx + size / 2, cy - size * 0.36 + size * 0.72 * a3 / 3); ctx.stroke();
    }
    if (i >= 3){
      const R = L.mulberry32(i * 31);
      for (let k = 0; k < 10; k++){
        const on = 0.3 + 0.7 * Math.max(0, Math.sin(t * 3 + k));
        ctx.fillStyle = rgba(C.cyan, 0.5 * on);
        ctx.fillRect(cx - size / 2 + R() * size, cy - size * 0.36 + R() * size * 0.72, 3, 3);
      }
    }
    // the level immediately inside this one, for depth
    if (i > 0){
      const s2 = size / 3.5;
      ctx.strokeStyle = rgba(col, 0.32); ctx.lineWidth = 1;
      ctx.strokeRect(cx - s2 / 2, cy - s2 * 0.36, s2, s2 * 0.72);
      ctx.fillStyle = rgba(C.cyan, 0.10); ctx.fillRect(cx - s2 / 2, cy - s2 * 0.36, s2, s2 * 0.72);
    }
    L.mono(ctx, L2.n, cx - size / 2, cy - size * 0.36 - 10, 14, rgba(col, 0.95), 2);
    L.mono(ctx, L2.d, cx - size / 2 + 100, cy - size * 0.36 - 10, 12, rgba(col, 0.5), 1.2);
    ctx.restore();
  }
  // log scale ruler
  ctx.strokeStyle = rgba(C.phos, 0.30); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(168, 990); ctx.lineTo(1752, 990); ctx.stroke();
  for (const LV of LEVELS){
    const px = 168 + (Math.log10(LV.s) - Math.log10(0.012)) / (Math.log10(760) - Math.log10(0.012)) * 1584;
    const near = 1 - Math.min(1, Math.abs(Math.log(Z / LV.s)) / 0.8);
    ctx.strokeStyle = rgba(C.cyan, 0.3 + 0.6 * near); ctx.lineWidth = 1 + near;
    ctx.beginPath(); ctx.moveTo(px, 982); ctx.lineTo(px, 1000); ctx.stroke();
    L.mono(ctx, LV.n, px, 1022, 11, rgba(C.cyan, 0.35 + 0.6 * near), 0.6, 'center');
  }
  const cur = 168 + (Math.log10(Z) - Math.log10(0.012)) / (Math.log10(760) - Math.log10(0.012)) * 1584;
  ctx.fillStyle = rgba(C.white, 0.9); ctx.fillRect(cur - 1.5, 972, 3, 30);
  const lg = Math.log10(Z);
  L.mono(ctx, 'scale  10^' + lg.toFixed(1) + ' m', 168, 150, 18, rgba(C.cyan, 0.95), 2);
  L.mono(ctx, Z > 1 ? (Z.toFixed(2) + ' m across') : ((Z * 1000).toFixed(1) + ' mm across'), 168, 178, 14, rgba(C.phos, 0.55), 1.6);
  return { bloom: 1.15, chroma: 1.2, scan: 0.5 };
}

// ---------------------------------------------------------------- c_globe
function c_globe(ctx, t, u, shot){
  ctx.fillStyle = '#030507'; ctx.fillRect(0, 0, W, H);
  const collapse = ss(shot.t1 - 0.55, shot.t1 - 0.05, t);
  const R = 340 * (1 - easeInCubic(collapse));
  const cx0 = W / 2, cy0 = H / 2;
  // the planet itself, so it reads as a world and not a graph
  const gg0 = ctx.createRadialGradient(cx0 - R * 0.3, cy0 - R * 0.35, R * 0.1, cx0, cy0, R);
  gg0.addColorStop(0, 'rgba(12,42,90,0.55)'); gg0.addColorStop(0.7, 'rgba(6,20,44,0.55)'); gg0.addColorStop(1, 'rgba(4,10,22,0.0)');
  ctx.fillStyle = gg0; ctx.beginPath(); ctx.arc(cx0, cy0, R, 0, TAU); ctx.fill();
  ctx.strokeStyle = rgba(C.cyan, 0.35); ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.arc(cx0, cy0, R, 0, TAU); ctx.stroke();
  const cam = L.makeCam({ pos: [0, 0, 0], yaw: t * 0.28, pitch: 0.32, fov: 1.1 });
  ctx.save();
  for (let lat = -3; lat <= 3; lat++){
    const ph = lat / 4 * Math.PI / 2;
    ctx.beginPath();
    let started = false;
    for (let k = 0; k <= 60; k++){
      const th = k / 60 * TAU;
      const q = L.proj(cam, [Math.cos(ph) * Math.cos(th) * R, Math.sin(ph) * R, Math.cos(ph) * Math.sin(th) * R]);
      if (!q){ started = false; continue; }
      if (!started){ ctx.moveTo(q[0], q[1]); started = true; } else ctx.lineTo(q[0], q[1]);
    }
    ctx.strokeStyle = rgba(C.dsLite, 0.45); ctx.lineWidth = 1; ctx.stroke();
  }
  for (let lon = 0; lon < 8; lon++){
    ctx.beginPath();
    let started = false;
    for (let k = 0; k <= 60; k++){
      const th = lon / 8 * Math.PI;
      const q = L.proj(cam, [Math.sin(k / 60 * Math.PI) * Math.cos(th) * R, Math.cos(k / 60 * Math.PI) * R, Math.sin(k / 60 * Math.PI) * Math.sin(th) * R]);
      if (!q){ started = false; continue; }
      if (!started){ ctx.moveTo(q[0], q[1]); started = true; } else ctx.lineTo(q[0], q[1]);
    }
    ctx.strokeStyle = rgba(C.dsLite, 0.34); ctx.lineWidth = 1; ctx.stroke();
  }
  ctx.restore();
  const R2 = L.mulberry32(31337);
  const nodes = [];
  for (let i = 0; i < 26; i++){
    const th = R2() * TAU, ph = Math.acos(2 * R2() - 1);
    nodes.push([Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th)]);
  }
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < nodes.length; i++){
    const a2 = nodes[i], b2 = nodes[(i + 5 + (i % 4)) % nodes.length];
    const n = 26;
    let prev = null;
    for (let k = 0; k <= n; k++){
      const f = k / n;
      const x = lerp(a2[0], b2[0], f), y = lerp(a2[1], b2[1], f), z = lerp(a2[2], b2[2], f);
      const len = Math.hypot(x, y, z) || 1;
      const lift = 1 + 0.30 * Math.sin(f * Math.PI);
      const q = L.proj(cam, [x / len * lift * R, y / len * lift * R, z / len * lift * R]);
      if (!q){ prev = null; continue; }
      if (prev){
        ctx.strokeStyle = rgba(C.phos, 0.16 + 0.10 * (1 - Math.abs(0.5 - f) * 2));
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(prev[0], prev[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
      }
      prev = q;
    }
    const f = ((t * 0.55 + i * 0.13) % 1);
    const x = lerp(a2[0], b2[0], f), y = lerp(a2[1], b2[1], f), z = lerp(a2[2], b2[2], f);
    const len = Math.hypot(x, y, z) || 1;
    const lift = 1 + 0.30 * Math.sin(f * Math.PI);
    const q = L.proj(cam, [x / len * lift * R, y / len * lift * R, z / len * lift * R]);
    if (q){ ctx.fillStyle = rgba(C.white, 0.95); ctx.fillRect(q[0] - 2, q[1] - 2, 4, 4); }
  }
  for (const nd of nodes){
    const q = L.proj(cam, [nd[0] * R, nd[1] * R, nd[2] * R]);
    if (!q) continue;
    ctx.fillStyle = rgba(C.cyan, 0.95); ctx.fillRect(q[0] - 2.5, q[1] - 2.5, 5, 5);
  }
  ctx.restore();
  if (collapse > 0.9){
    const k = (collapse - 0.9) / 0.1;
    L.glow(ctx, C.white, 70, () => { ctx.fillStyle = rgba(C.white, 0.95); ctx.fillRect(W / 2 - 4 - 10 * k, H / 2 - 4 - 10 * k, 8 + 20 * k, 8 + 20 * k); });
  }
  L.spec(ctx, 168, 180, [
    ['link', 'InfiniBand NDR 400 Gb/s'],
    ['rtt', '≈ 150 ms across the planet'],
    ['route', 'store-and-forward, 3 hops'],
  ], { alpha: ss(shot.t0 + 0.2, shot.t0 + 0.7, t) * (1 - collapse), color: C.cyan, kw: 70 });
  return { bloom: 1.35, chroma: 1.3 + 10 * collapse, flash: Math.max(0, collapse - 0.9) * 3, scan: 0.5 };
}

module.exports = { b_type, b_call, b_grid, c_pullback, c_globe };
