'use strict';
const L = require('../engine/lib.js');
const K = require('./kit.js');
const {
  W, H, C, rgba, clamp, lerp, sat, ss, TAU,
  easeOutExpo, easeOutQuint, easeOutCubic, easeInCubic, easeInOutCubic, easeOutBack, easeInExpo,
  pulse, kick, beatOf, barOf, SPB, BEAT0, BAR,
} = L;

// ------------------------------------------------------------------ helpers
function bgFill(ctx, c){ ctx.fillStyle = c || '#04060A'; ctx.fillRect(0, 0, W, H); }

function poly(ctx, pts, close){
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++){ const m = i === 0 ? 'moveTo' : 'lineTo'; ctx[m](pts[i][0], pts[i][1]); }
  if (close) ctx.closePath();
}

// stroke a function y=f(x) safely, breaking the path where it jumps
function wavePath(ctx, x0, x1, step, fn){
  ctx.beginPath();
  let started = false;
  for (let x = x0; x <= x1; x += step){
    const y = fn(x);
    if (!isFinite(y)){ started = false; continue; }
    if (!started){ ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
  }
}

// marching dots along a polyline
function flowDots(ctx, pts, t, speed, n, col, alpha){
  const segs = []; let total = 0;
  for (let i = 1; i < pts.length; i++){
    const d = Math.hypot(pts[i][0] - pts[i-1][0], pts[i][1] - pts[i-1][1]);
    segs.push([pts[i-1], pts[i], total, d]); total += d;
  }
  if (total <= 0) return;
  for (let k = 0; k < n; k++){
    const s = (((t * speed + k / n) % 1) + 1) % 1 * total;
    for (let j = 0; j < segs.length; j++){
      const a = segs[j];
      if (s <= a[2] + a[3]){
        const f = (s - a[2]) / (a[3] || 1);
        const x = lerp(a[0][0], a[1][0], f), y = lerp(a[0][1], a[1][1], f);
        ctx.fillStyle = rgba(col, alpha * 0.22); ctx.fillRect(x - 6, y - 6, 12, 12);
        ctx.fillStyle = rgba(col, alpha); ctx.fillRect(x - 2, y - 2, 4, 4);
        break;
      }
    }
  }
}

// vertical diode symbol, centred at (x, yc); up = arrow toward smaller y
function vdiode(ctx, x, yc, up, on, col){
  const h = 17, w = 15;
  const ay = up ? yc - h : yc + h, by = up ? yc + h : yc - h;
  ctx.beginPath(); ctx.moveTo(x - w, by); ctx.lineTo(x + w, by); ctx.lineTo(x, ay); ctx.closePath();
  if (on){ ctx.fillStyle = rgba(col, 0.32); ctx.fill(); }
  ctx.strokeStyle = rgba(col, on ? 0.95 : 0.5); ctx.lineWidth = on ? 1.9 : 1.2; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x - w, ay); ctx.lineTo(x + w, ay); ctx.stroke();
  if (on) L.glow(ctx, col, 16, () => { ctx.strokeStyle = rgba(col, 0.55); ctx.lineWidth = 1; ctx.stroke(); });
}

// ------------------------------------------------------------------ e_ac
// 44.45 - 47.67  "Switch my current / To AC to DC"
const SW_T = 47.267;             // beat 102: the switch closes

function e_ac(ctx, t, u, shot){
  bgFill(ctx, '#04060A');
  const t0 = shot.t0;
  const grow = easeOutQuint(sat((t - t0) / 0.55));
  const amp = 176 * grow, y0 = 556, xa = 400, xb = 1812, wl = 848, om = 3.0;
  const yAt = x => y0 - amp * Math.sin((x - xa) / wl * TAU - om * (t - t0));

  // amplitude envelope + zero axis
  ctx.setLineDash([5, 10]); ctx.lineWidth = 1; ctx.strokeStyle = rgba(C.cyan, 0.20);
  L.lin(ctx, 380, y0 - 176, 1832, y0 - 176); L.lin(ctx, 380, y0 + 176, 1832, y0 + 176);
  ctx.setLineDash([]);
  ctx.strokeStyle = rgba(C.phos, 0.16); L.lin(ctx, 380, y0, 1832, y0);
  L.ruler(ctx, 380, y0 + 8, 1440, 9, 48, rgba(C.phos, 0.13), 9, null);

  // the wave, sculptural: 3 full passes + two side-lit edges
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineJoin = 'round';
  const P = [[1.5, 0.95, C.phos], [3.6, 0.26, C.phos], [11, 0.085, C.cyan], [32, 0.028, C.cyan]];
  for (let i = 0; i < P.length; i++){
    ctx.lineWidth = P[i][0]; ctx.strokeStyle = rgba(P[i][2], P[i][1]);
    wavePath(ctx, xa, xb, 3.5, yAt); ctx.stroke();
  }
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = rgba(C.dsLite, 0.30); wavePath(ctx, xa, xb, 4, x => yAt(x) - 14); ctx.stroke();
  ctx.strokeStyle = rgba(C.ds, 0.38);     wavePath(ctx, xa, xb, 4, x => yAt(x) + 9);  ctx.stroke();
  ctx.restore();

  // electrons: they slosh, they do not travel
  const slosh = 14 * Math.sin(om * (t - t0));
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 64; i++){
    const bx = xa + 22 + i * (xb - xa - 44) / 63;
    const ex = bx + slosh, ey = yAt(ex);
    ctx.strokeStyle = rgba(C.cyan, 0.32); ctx.lineWidth = 1.2;
    L.lin(ctx, ex - slosh * 0.92, yAt(ex - slosh * 0.92), ex, ey);
    ctx.fillStyle = rgba(C.cyan, 0.30); ctx.fillRect(ex - 4, ey - 4, 8, 8);
    ctx.fillStyle = rgba(C.white, 0.88); ctx.fillRect(ex - 1.6, ey - 1.6, 3.2, 3.2);
  }
  // energy packets: they travel
  for (let k = 0; k < 10; k++){
    const phs = ((t - t0) * 0.30 + k / 10) % 1;
    const px = xa + phs * (xb - xa), py = yAt(px);
    ctx.fillStyle = rgba(C.warm, 0.14); ctx.fillRect(px - 18, py - 3, 18, 6);
    L.glow(ctx, C.warm, 24, () => { ctx.fillStyle = rgba(C.white, 0.95); ctx.fillRect(px - 2, py - 2, 4, 4); });
  }
  ctx.restore();

  // ---- source + knife switch ----
  ctx.strokeStyle = rgba(C.phos, 0.85); ctx.lineWidth = 1.6;
  L.ring(ctx, 190, y0, 32, 1.6);
  ctx.beginPath();
  for (let i = 0; i <= 24; i++){
    const x = 190 - 20 + 40 * i / 24, y = y0 - 12 * Math.sin(i / 24 * TAU);
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.stroke();
  L.lin(ctx, 222, y0, 250, y0);
  L.lin(ctx, 334, y0, xa, y0);
  ctx.fillStyle = rgba(C.phos, 0.9);
  L.fillCircle(ctx, 250, y0, 3.4); L.fillCircle(ctx, 334, y0, 3.4);

  const sw = sat((t - SW_T) / 0.06), sE = easeOutExpo(sw);
  const ang = 0.66 * (1 - sE);
  const lx = 250 + 84 * Math.cos(ang), ly = y0 - 84 * Math.sin(ang);
  ctx.strokeStyle = rgba(sw > 0.5 ? C.white : C.phos, 0.95); ctx.lineWidth = 2.6;
  L.lin(ctx, 250, y0, lx, ly);
  if (sw > 0 && sw < 1.4){
    const sp = 1 - sat((t - SW_T) / 0.26);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const R = L.mulberry32(Math.floor(t * 90));
    for (let i = 0; i < 14; i++){
      const a2 = R() * TAU, rr = 6 + R() * 80 * (1 - sp);
      ctx.strokeStyle = rgba(C.warm, 0.7 * sp); ctx.lineWidth = 1.4;
      L.lin(ctx, 334, y0, 334 + Math.cos(a2) * rr, y0 + Math.sin(a2) * rr);
    }
    L.glow(ctx, C.white, 40, () => { ctx.fillStyle = rgba(C.white, 0.9 * sp); ctx.fillRect(330, y0 - 4, 8, 8); });
    ctx.restore();
  }
  L.mono(ctx, 'AC', 190, y0 - 46, 15, rgba(C.cyan, 0.85), 3, 'center');
  L.mono(ctx, 'SW1', 292, y0 - 74, 14, rgba(C.phos, 0.7), 2, 'center');
  L.mono(ctx, sw > 0.5 ? 'CLOSED' : 'OPEN', 292, y0 - 56, 12,
    rgba(sw > 0.5 ? C.warm : C.phos, sw > 0.5 ? 0.95 : 0.45), 2.6, 'center');

  // ---- annotations ----
  const a1 = ss(t0 + 0.15, t0 + 0.75, t);
  L.spec(ctx, 168, 200, [
    ['signal', 'AC · ALTERNATING CURRENT'],
    ['law', 'f = 1/T'],
    ['charge', 'ELECTRONS DO NOT TRAVEL'],
  ], { alpha: a1, color: C.cyan, kw: 76, size: 14 });
  const a2 = ss(t0 + 0.55, t0 + 1.15, t);
  L.mono(ctx, 'ENERGY DOES', 168, 318, 27, rgba(C.warm, 0.92 * a2), 4);
  L.mono(ctx, 'ELECTRONS ⇄ 0.1 mm      ENERGY → 300 000 km/s', 168, 946, 13, rgba(C.phos, 0.42 * a2), 1.6);

  // side-lit inset: one period, in time
  const s1 = ss(t0 + 0.9, t0 + 1.5, t);
  if (s1 > 0){
    const bx = 1452, by = 196, bw = 372, bh = 150;
    ctx.save(); ctx.globalAlpha = s1;
    ctx.strokeStyle = rgba(C.cyan, 0.45); ctx.lineWidth = 1;
    ctx.strokeRect(bx + .5, by + .5, bw, bh);
    ctx.strokeStyle = rgba(C.phos, 0.30); L.lin(ctx, bx, by + bh * 0.5, bx + bw, by + bh * 0.5);
    ctx.strokeStyle = rgba(C.cyan, 0.9); ctx.lineWidth = 1.4;
    wavePath(ctx, bx + 8, bx + bw - 8, 2, x => by + bh * 0.5 - 52 * Math.sin((x - bx) / (bw - 16) * TAU * 2));
    ctx.stroke();
    ctx.strokeStyle = rgba(C.warm, 0.85); ctx.lineWidth = 1.2;
    const x0 = bx + 8, x1 = bx + 8 + (bw - 16) / 2;
    L.lin(ctx, x0, by + bh + 12, x0, by + bh + 26); L.lin(ctx, x1, by + bh + 12, x1, by + bh + 26);
    L.lin(ctx, x0, by + bh + 19, x1, by + bh + 19);
    L.mono(ctx, 'T', (x0 + x1) / 2, by + bh + 42, 15, rgba(C.warm, 0.95), 2, 'center');
    L.mono(ctx, 'V(t)', bx + 10, by + 20, 12, rgba(C.phos, 0.6), 1.6);
    ctx.restore();
  }
  return { bloom: 1.2, chroma: 1.3 + 5 * (1 - sE), scan: 0.5 };
}

// ------------------------------------------------------------------ e_rectify
// 47.67 - 49.53  "And then blind my vision"
function e_rectify(ctx, t, u, shot){
  bgFill(ctx, '#030507');
  const t0 = shot.t0, t1 = shot.t1;
  const om = TAU / (2 * SPB);                 // one AC cycle every two beats
  const truth = Math.sin(om * (t - t0));
  const posHalf = truth >= 0;

  const railT = 300, railB = 762, yAC = 520;
  const legA = 540, legB = 800, srcX = 670, capX = 934, loadX = 1072;
  const railL = 470, railR = 1128;

  const wire = rgba(C.phos, 0.62), wireDim = rgba(C.phos, 0.30);

  // ---- rails
  ctx.lineWidth = 1.5; ctx.strokeStyle = wire;
  L.lin(ctx, railL, railT, railR, railT);
  L.lin(ctx, railL, railB, railR, railB);
  ctx.strokeStyle = wireDim; ctx.lineWidth = 1.2;
  L.lin(ctx, legA, yAC, legA, railT); L.lin(ctx, legA, railB, legA, yAC);
  L.lin(ctx, legB, yAC, legB, railT); L.lin(ctx, legB, railB, legB, yAC);

  // ---- AC source between the two legs
  L.lin(ctx, legA, yAC, srcX - 36, yAC);
  L.lin(ctx, srcX + 36, yAC, legB, yAC);
  L.ring(ctx, srcX, yAC, 36, 1.6);
  ctx.strokeStyle = 'rgba(78,255,208,1)';
  ctx.beginPath();
  for (let i = 0; i <= 24; i++){
    const x = srcX - 22 + 44 * i / 24, y = yAC - 13 * Math.sin(i / 24 * TAU);
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.lineWidth = 1.4; ctx.stroke();
  ctx.fillStyle = rgba(C.phos, 0.95);
  L.fillCircle(ctx, legA, yAC, 3.6); L.fillCircle(ctx, legB, yAC, 3.6);

  // ---- the four diodes
  const on1 = posHalf, on4 = posHalf, on2 = !posHalf, on3 = !posHalf;
  vdiode(ctx, legA, 410, true, on1, on1 ? C.warm : C.phos);
  vdiode(ctx, legB, 410, true, on2, on2 ? C.warm : C.phos);
  vdiode(ctx, legA, 641, true, on3, on3 ? C.warm : C.phos);
  vdiode(ctx, legB, 641, true, on4, on4 ? C.warm : C.phos);
  const dl = rgba(C.cyan, 0.9);
  L.mono(ctx, 'D1', legA + 26, 404, 15, dl, 2);
  L.mono(ctx, 'D2', legB + 26, 404, 15, dl, 2);
  L.mono(ctx, 'D3', legA + 26, 648, 15, dl, 2);
  L.mono(ctx, 'D4', legB + 26, 648, 15, dl, 2);
  L.mono(ctx, 'A', legA - 20, yAC + 30, 14, rgba(C.phos, 0.7), 1.6);
  L.mono(ctx, 'B', legB - 20, yAC + 30, 14, rgba(C.phos, 0.7), 1.6);
  L.mono(ctx, 'AC SOURCE', srcX, yAC + 62, 13, rgba(C.cyan, 0.8), 2.4, 'center');

  // ---- filter capacitor
  ctx.strokeStyle = wire; ctx.lineWidth = 1.5;
  L.lin(ctx, capX, railT, capX, 512); L.lin(ctx, capX, 542, capX, railB);
  ctx.lineWidth = 2.4; ctx.strokeStyle = rgba(C.white, 0.8);
  L.lin(ctx, capX - 26, 512, capX + 26, 512); L.lin(ctx, capX - 26, 542, capX + 26, 542);
  L.mono(ctx, 'C1', capX + 34, 500, 14, dl, 2);
  L.mono(ctx, 'FILTER', capX + 34, 518, 11, rgba(C.phos, 0.5), 1.6);
  ctx.fillStyle = rgba(C.cyan, 0.9); L.fillCircle(ctx, capX, railT, 3); L.fillCircle(ctx, capX, railB, 3);

  // ---- load
  ctx.strokeStyle = wire; ctx.lineWidth = 1.5;
  L.lin(ctx, loadX, railT, loadX, 470); L.lin(ctx, loadX, 604, loadX, railB);
  ctx.strokeStyle = rgba(C.white, 0.75); ctx.lineWidth = 1.6;
  ctx.strokeRect(loadX - 22, 470, 44, 134);
  L.mono(ctx, 'R_L', loadX + 34, 516, 14, dl, 2);
  L.mono(ctx, 'LOAD', loadX + 34, 534, 11, rgba(C.phos, 0.5), 1.6);
  ctx.fillStyle = rgba(C.cyan, 0.9); L.fillCircle(ctx, loadX, railT, 3); L.fillCircle(ctx, loadX, railB, 3);

  L.mono(ctx, '+V', railL + 2, railT - 12, 13, rgba(C.cyan, 0.8), 2);
  L.mono(ctx, '−V', railL + 2, railB + 22, 13, rgba(C.cyan, 0.8), 2);

  // ---- current loops: two diodes conduct per half cycle
  const pathPos = [[legA, yAC], [legA, railT], [loadX, railT], [loadX, railB], [legB, railB], [legB, yAC]];
  const pathNeg = [[legB, yAC], [legB, railT], [loadX, railT], [loadX, railB], [legA, railB], [legA, yAC]];
  ctx.save();
  flowDots(ctx, posHalf ? pathPos : pathNeg, t, 0.55, 16, posHalf ? C.warm : C.warm, 0.95);
  ctx.restore();

  // ---- title
  const a0 = ss(t0 + 0.05, t0 + 0.45, t);
  L.mono(ctx, 'FULL-WAVE BRIDGE RECTIFIER', 168, 166, 26, rgba(C.cyan, 0.95 * a0), 5);
  L.mono(ctx, '4 DIODES · 2 CONDUCT PER HALF CYCLE', 168, 194, 14, rgba(C.phos, 0.55 * a0), 2.6);
  L.mono(ctx, posHalf ? 'CONDUCTING: D1 + D4' : 'CONDUCTING: D2 + D3', 168, 224, 13,
    rgba(posHalf ? C.warm : C.cyan, 0.85 * a0), 2.2);

  // ---- waveform panel
  const px0 = 1240, px1 = 1834, padL = 1256, padR = 1826, cyc = 150;
  const phi = x => (x - padL) / cyc * TAU + om * (t - t0);
  const foldK = ss(t0 + 0.26, t0 + 0.84, t);
  const capK  = ss(t0 + 0.80, t0 + 1.30, t);
  const dark  = ss(t0 + 1.52, t0 + 1.70, t);

  function strip(y0s, y1s, base, ampS, label, sub){
    ctx.strokeStyle = rgba(C.phos, 0.22); ctx.lineWidth = 1;
    ctx.strokeRect(px0 + .5, y0s + .5, px1 - px0, y1s - y0s);
    L.brackets(ctx, px0, y0s, px1 - px0, y1s - y0s, 12, rgba(C.cyan, 0.35));
    ctx.strokeStyle = rgba(C.phos, 0.16);
    L.lin(ctx, px0 + 4, base, px1 - 4, base);
    L.mono(ctx, label, px0 + 12, y0s + 20, 13, rgba(C.cyan, 0.9), 2);
    if (sub) L.mono(ctx, sub, px1 - 12, y0s + 20, 11, rgba(C.phos, 0.42), 1.2, 'right');
  }

  strip(236, 386, 350, 40, 'V_in', 'source');
  strip(400, 612, 588, 140, 'V_rect', '|V| — the negative half-cycles fold up');
  strip(626, 852, 828, 140, 'V_dc', 'capacitor holds the peaks');

  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineJoin = 'round';
  // V_in
  ctx.strokeStyle = rgba(C.phos, 0.9); ctx.lineWidth = 1.5;
  wavePath(ctx, padL, padR, 2.5, x => 350 - 40 * Math.sin(phi(x))); ctx.stroke();
  // V_rect: raw (dim) + folded (bright)
  ctx.strokeStyle = rgba(C.ds, 0.55); ctx.lineWidth = 1;
  wavePath(ctx, padL, padR, 2.5, x => 588 - 140 * Math.sin(phi(x)) * (1 - foldK)); ctx.stroke();
  ctx.strokeStyle = rgba(C.cyan, 0.95); ctx.lineWidth = 1.6;
  wavePath(ctx, padL, padR, 2.5, x => {
    const s = Math.sin(phi(x));
    const v = s < 0 ? s * (1 - 2 * foldK) : s;
    return 588 - 140 * v;
  });
  ctx.stroke();
  // V_dc
  const dcA = 1 - dark * 0.88;
  ctx.strokeStyle = rgba(C.cyan, 0.22 * dcA); ctx.lineWidth = 1;
  wavePath(ctx, padL, padR, 2.5, x => 828 - 140 * Math.abs(Math.sin(phi(x)))); ctx.stroke();
  ctx.strokeStyle = rgba(C.white, 0.95 * dcA); ctx.lineWidth = 1.8;
  wavePath(ctx, padL, padR, 2.5, x => {
    const a = Math.abs(Math.sin(phi(x)));
    return 828 - 140 * lerp(a, 1 - (1 - a) * 0.06, capK);
  });
  ctx.stroke();
  ctx.restore();

  // fold arrow
  const fa = ss(t0 + 0.30, t0 + 0.7, t) * (1 - ss(t0 + 1.6, t0 + 1.85, t));
  if (fa > 0){
    ctx.save(); ctx.globalAlpha = fa;
    ctx.strokeStyle = rgba(C.warm, 0.9); ctx.lineWidth = 1.4;
    L.lin(ctx, px0 + 60, 594, px0 + 60, 470);
    poly(ctx, [[px0 + 54, 482], [px0 + 60, 466], [px0 + 66, 482]]); ctx.stroke();
    L.mono(ctx, 'FOLD ↑', px0 + 74, 490, 13, rgba(C.warm, 0.9), 2);
    ctx.restore();
  }

  // the blindness
  if (dark > 0){
    ctx.save(); ctx.globalAlpha = dark;
    ctx.strokeStyle = rgba(C.alert, 0.9); ctx.lineWidth = 1.4;
    L.lin(ctx, padL, 828 - 140, padR, 828 - 140);
    L.mono(ctx, 'DC — NO OSCILLATION TO SEE', px0 + 12, 742, 17, rgba(C.alert, 0.95), 3);
    ctx.restore();
  }
  L.spec(ctx, 168, 906, [
    ['rect', '|V_p · sin ωt|'],
    ['cap', 'smooths the ripple → DC'],
    ['net', '4 diodes · 2 conduct'],
  ], { alpha: ss(t0 + 0.5, t0 + 1.0, t) * 0.95, color: C.phos, kw: 52, size: 12 });
  return { bloom: 1.1, chroma: 1.2 + 4 * (1 - foldK), scan: 0.5, flash: dark * 0.0 };
}

// ------------------------------------------------------------------ e_alias
// 49.53 - 51.36  "So dizzy so dizzy"
function e_alias(ctx, t, u, shot){
  bgFill(ctx, '#04060A');
  const t0 = shot.t0;
  const FS = 1 / (SPB / 2);                       // 4.333 samples/s — two per beat
  const FTR = FS - 0.5;                           // 3.833 Hz true
  const FAL = FTR - Math.round(FTR / FS) * FS;    // -0.500 Hz aliased
  const nSamp = Math.max(0, Math.floor(t * FS));
  const fr = t * FS - nSamp;
  const strobe = Math.exp(-fr * 5.5);
  const aHeld = TAU * FTR * (nSamp / FS);
  const aTrue = TAU * FTR * t;
  const cx = 660, cy = 452, R = 256;

  // static hatch — quantised to the sample clock, so the whole frame stutters
  const hq = L.mulberry32(nSamp * 7717 + 3);
  ctx.save(); ctx.globalAlpha = 0.16; ctx.fillStyle = C.phos;
  for (let i = 0; i < 90; i++) ctx.fillRect(hq() * W, hq() * H, 2, 2);
  ctx.restore();

  // ---- the wheel
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = rgba(C.phos, 0.30); ctx.lineWidth = 1.2;
  L.ring(ctx, cx, cy, R + 26, 1.2);
  ctx.strokeStyle = rgba(C.cyan, 0.55); L.ring(ctx, cx, cy, R, 1.6);
  // spokes (held)
  for (let i = 0; i < 12; i++){
    const a = aHeld + i / 12 * TAU;
    ctx.strokeStyle = rgba(C.phos, i === 0 ? 0.0 : 0.22); ctx.lineWidth = 1;
    L.lin(ctx, cx + Math.cos(a) * 40, cy + Math.sin(a) * 40, cx + Math.cos(a) * R, cy + Math.sin(a) * R);
  }
  // the index mark: what the eye actually tracks
  const ix = cx + Math.cos(aHeld) * R * 0.62, iy = cy + Math.sin(aHeld) * R * 0.62;
  const ix2 = cx + Math.cos(aHeld) * R, iy2 = cy + Math.sin(aHeld) * R;
  L.glow(ctx, C.alert, 26, () => {
    ctx.strokeStyle = rgba(C.alert, 0.95); ctx.lineWidth = 4; L.lin(ctx, ix, iy, ix2, iy2);
  });
  ctx.fillStyle = rgba(C.white, 0.95); L.fillCircle(ctx, ix2, iy2, 6);
  // comet tail: the direction the eye is fooled into seeing
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 14; i++){
    const a = aHeld + 0.030 * i;
    ctx.strokeStyle = rgba(C.alert, 0.45 * (1 - i / 14));
    ctx.lineWidth = 3.2 * (1 - i / 16);
    L.lin(ctx, cx + Math.cos(a) * R * 0.66, cy + Math.sin(a) * R * 0.66,
            cx + Math.cos(a) * R, cy + Math.sin(a) * R);
  }
  ctx.restore();
  // the truth, almost invisible
  const tx = cx + Math.cos(aTrue) * R, ty = cy + Math.sin(aTrue) * R;
  ctx.strokeStyle = rgba(C.dsLite, 0.35); ctx.lineWidth = 1;
  L.lin(ctx, cx, cy, tx, ty);
  L.fillCircle(ctx, tx, ty, 2.5);
  // hub
  ctx.fillStyle = rgba(C.phos, 0.9); L.fillCircle(ctx, cx, cy, 7);
  L.ring(ctx, cx, cy, 15, 1);
  // shutter flash
  if (strobe > 0.02){
    ctx.strokeStyle = rgba(C.white, 0.5 * strobe); ctx.lineWidth = 2;
    L.ring(ctx, cx, cy, R + 26 + 30 * (1 - strobe), 2);
    ctx.fillStyle = rgba(C.white, 0.035 * strobe); L.fillCircle(ctx, cx, cy, R + 26);
  }
  ctx.restore();
  L.mono(ctx, 'TRUE', cx + (tx - cx) * 1.16, cy + (ty - cy) * 1.16, 11, rgba(C.dsLite, 0.75), 1.6, 'center');
  L.mono(ctx, 'SEEN', ix2 + (ix2 - cx) * 0.10, iy2 + (iy2 - cy) * 0.10, 12, rgba(C.alert, 0.95), 1.8, 'center');
  L.mono(ctx, 'SHUTTER', cx, cy + R + 62, 12, rgba(C.phos, 0.45 + 0.5 * strobe), 2.4, 'center');
  L.mono(ctx, 'SAMPLE & HOLD', cx, cy + R + 84, 11, rgba(C.phos, 0.3), 1.8, 'center');

  // ---- readouts
  const a1 = ss(t0 + 0.10, t0 + 0.5, t);
  const X = 1128;
  L.mono(ctx, 'ALIASING', X, 176, 30, rgba(C.cyan, 0.95 * a1), 8);
  function readout(y, label, value, col, sub){
    L.mono(ctx, label, X, y, 12, rgba(C.phos, 0.5), 2.4);
    L.mono(ctx, value, X, y + 38, 34, rgba(col, 0.97), 1);
    if (sub) L.mono(ctx, sub, X, y + 58, 12, rgba(col, 0.45), 1.4);
  }
  readout(224, 'TRUE FREQUENCY', 'f = 3.83 Hz', C.phos, 'the wheel really does spin forward');
  readout(302, 'SAMPLE RATE', 'fs = 4.33 Hz', C.cyan, '2 samples per beat');
  readout(392, 'ALIASED FREQUENCY', 'f’ = −0.50 Hz', C.alert, 'it runs backwards — nothing is wrong with the wheel');
  L.mono(ctx, 'REVERSING', X + 300, 424, 20, rgba(C.alert, 0.85), 4);
  L.mono(ctx, 'f’ = f − fs · round(f/fs)', X, 500, 15, rgba(C.phos, 0.75), 1.6);
  ctx.strokeStyle = rgba(C.phos, 0.25); ctx.lineWidth = 1;
  L.lin(ctx, X, 520, 1820, 520);
  L.mono(ctx, 'NYQUIST', X, 552, 12, rgba(C.phos, 0.5), 2.4);
  L.mono(ctx, 'fs > 2·fmax', X, 588, 26, rgba(C.white, 0.9), 2);
  L.mono(ctx, '4.33 > 7.67', X + 250, 588, 22, rgba(C.alert, 0.9), 2);
  L.mono(ctx, 'FAIL', X + 470, 588, 22, rgba(C.alert, 0.95), 4);
  L.mono(ctx, 'UNDERSAMPLING FOLDS FREQUENCY, NOT SHAPE', X, 646, 13, rgba(C.cyan, 0.8), 1.8);
  L.mono(ctx, 'ALIASING = A LIE THAT LOOKS PERIODIC', X, 672, 13, rgba(C.cyan, 0.6), 1.8);

  // ---- sample & hold: the seen angle falls
  const bx0 = 214, bx1 = 1078, byT = 742, byB = 918, NS = 7;
  ctx.strokeStyle = rgba(C.phos, 0.22); ctx.lineWidth = 1;
  L.lin(ctx, bx0, byB, bx1, byB); L.lin(ctx, bx0, byT, bx0, byB);
  const stp = (byB - byT) / NS;
  ctx.beginPath();
  for (let k = 0; k < NS; k++){
    const x0 = bx0 + (bx1 - bx0) * k / NS, x1 = bx0 + (bx1 - bx0) * (k + 1) / NS;
    const y = byT + stp * k;
    if (k === 0) ctx.moveTo(x0, y); else ctx.lineTo(x0, y);
    ctx.lineTo(x1, y);
  }
  ctx.strokeStyle = rgba(C.alert, 0.9); ctx.lineWidth = 1.8; ctx.stroke();
  for (let k = 0; k <= NS; k++){
    const x = bx0 + (bx1 - bx0) * k / NS;
    ctx.strokeStyle = rgba(C.cyan, 0.5); ctx.lineWidth = 1;
    L.lin(ctx, x, byB - 6, x, byB + 6);
  }
  ctx.strokeStyle = rgba(C.cyan, 0.35);
  L.lin(ctx, bx1 - 90, byB + 40, bx1, byB + 40);
  poly(ctx, [[bx1 - 6, byB + 35], [bx1 + 8, byB + 40], [bx1 - 6, byB + 45]]); ctx.stroke();
  L.mono(ctx, 'SEEN ANGLE — NEGATIVE SLOPE', bx0 + 8, byT - 16, 12, rgba(C.alert, 0.85), 2);
  L.mono(ctx, 'SAMPLE & HOLD · 2 PER BEAT', bx0 + 8, byB + 26, 11, rgba(C.phos, 0.45), 1.6);
  L.mono(ctx, 'TIME →', bx1 - 8, byB + 30, 11, rgba(C.phos, 0.45), 1.6, 'right');
  L.mono(ctx, 'REV', bx0 - 10, byT + 6, 11, rgba(C.phos, 0.45), 1.4, 'right');
  return { bloom: 1.1, chroma: 1.6 + 6 * strobe, scan: 0.55 };
}

// ------------------------------------------------------------------ e_timeline
// 51.36 - 53.23  "Oh we can travel"
const TL_T0 = 40.0, TL_T1 = 53.23;
const TL_CUES = [[44.45, 'AC'], [47.67, 'BRIDGE'], [49.53, 'WHEEL'], [51.36, 'SCRUB']];

function e_timeline(ctx, t, u, shot){
  bgFill(ctx, '#030507');
  const t0 = shot.t0;
  const TSNAP = 52.34;                       // beat 113
  const rewind = sat((t - t0) / (TSNAP - t0));
  const fwd = sat((t - TSNAP) / 0.44);
  const ax0 = 240, ax1 = 1690, ay = 862;
  const xOf = tt => ax0 + (ax1 - ax0) * sat((tt - TL_T0) / (TL_T1 - TL_T0));

  let sx, clock;
  const clockOf = x => TL_T0 + (TL_T1 - TL_T0) * ((x - ax0) / (ax1 - ax0));
  if (t < TSNAP){
    clock = lerp(51.92, 44.30, easeInOutCubic(rewind));
    sx = xOf(clock);
    sx = Math.round(sx / 42) * 42;
    clock = clockOf(sx);
  } else {
    clock = lerp(51.92, TL_T1, easeOutExpo(fwd));
    sx = xOf(clock);
    clock = clockOf(sx);
  }
  const playing = t >= TSNAP;
  const cw = t < TSNAP ? clock : Math.min(TL_T1, clock);
  let mi = -1; for (let i = 0; i < TL_CUES.length; i++) if (cw >= TL_CUES[i][0]) mi = i;

  // ---- viewport with the reversed montage
  const vx0 = 200, vy0 = 196, vx1 = 1148, vy1 = 624;
  ctx.save();
  ctx.beginPath(); ctx.rect(vx0, vy0, vx1 - vx0, vy1 - vy0); ctx.clip();
  ctx.fillStyle = 'rgba(2,4,7,1)'; ctx.fillRect(vx0, vy0, vx1 - vx0, vy1 - vy0);
  const jit = (Math.floor(t * 24) % 3) * 2 - 2;
  ctx.translate(jit, 0);
  const lt = cw - (mi >= 0 ? TL_CUES[mi][0] : 0);
  if (mi >= 0){
    const lq = Math.floor(lt * 6) / 6;       // 6 fps gutter
    if (mi === 0){
      ctx.strokeStyle = rgba(C.phos, 0.85); ctx.lineWidth = 1.6;
      wavePath(ctx, vx0, vx1, 4, x => 420 - 118 * Math.sin((x - vx0) / 260 * TAU + lq * 3.0));
      ctx.stroke();
      ctx.strokeStyle = rgba(C.cyan, 0.3);
      wavePath(ctx, vx0, vx1, 6, x => 300 - 60 * Math.sin((x - vx0) / 400 * TAU - lq * 2.0));
      ctx.stroke();
    } else if (mi === 1){
      ctx.strokeStyle = rgba(C.cyan, 0.85); ctx.lineWidth = 1.6;
      wavePath(ctx, vx0, vx1, 4, x => 470 - 120 * Math.abs(Math.sin((x - vx0) / 240 * TAU + lq * 2.4)));
      ctx.stroke();
      ctx.strokeStyle = rgba(C.phos, 0.35);
      wavePath(ctx, vx0, vx1, 5, x => 470 - 120 * Math.sin((x - vx0) / 240 * TAU + lq * 2.4) * 0.35);
      ctx.stroke();
    } else if (mi === 2){
      const a = lq * 5.2;
      ctx.strokeStyle = rgba(C.phos, 0.8); ctx.lineWidth = 1.4;
      L.ring(ctx, 660, 400, 170, 1.4);
      for (let i = 0; i < 12; i++){
        const aa = a + i / 12 * TAU;
        L.lin(ctx, 660 + Math.cos(aa) * 30, 400 + Math.sin(aa) * 30, 660 + Math.cos(aa) * 170, 400 + Math.sin(aa) * 170);
      }
      ctx.strokeStyle = rgba(C.alert, 0.9); ctx.lineWidth = 3;
      L.lin(ctx, 660, 400, 660 + Math.cos(a) * 170, 400 + Math.sin(a) * 170);
    } else {
      ctx.strokeStyle = rgba(C.cyan, 0.8); ctx.lineWidth = 1.4;
      L.lin(ctx, vx0 + 120, 420, vx1 - 120, 420);
      for (let i = 0; i < 24; i++) L.lin(ctx, vx0 + 120 + i * (vx1 - vx0 - 240) / 23, 410, vx0 + 120 + i * (vx1 - vx0 - 240) / 23, 430);
      const pp = vx0 + 120 + ((vx1 - vx0 - 240) * ((Math.sin(lq * 0.9) + 1) / 2));
      ctx.fillStyle = rgba(C.white, 0.9); ctx.fillRect(pp - 2, 396, 4, 48);
    }
  }
  ctx.restore();
  // scanline tear inside the viewport
  ctx.save(); ctx.globalAlpha = 0.030; ctx.strokeStyle = C.phos; ctx.lineWidth = 1;
  for (let y = vy0; y < vy1; y += 5) L.lin(ctx, vx0, y, vx1, y);
  ctx.restore();
  const tearY = vy0 + (((t - t0) * 0.9) % 1) * (vy1 - vy0);
  ctx.save(); ctx.globalAlpha = 0.5; ctx.fillStyle = 'rgba(3,5,7,0.9)';
  ctx.fillRect(vx0, tearY, vx1 - vx0, 3);
  ctx.globalAlpha = 0.18; ctx.fillStyle = C.white;
  ctx.fillRect(vx0, tearY - 10, vx1 - vx0, 2);
  ctx.restore();
  // sliding ghost band
  const gp = ((t - t0) * 0.7) % 1;
  ctx.save(); ctx.globalAlpha = 0.10; ctx.fillStyle = C.white;
  ctx.fillRect(vx0, vy0 + gp * (vy1 - vy0) - 40, vx1 - vx0, 40); ctx.restore();
  ctx.strokeStyle = rgba(C.cyan, 0.5); ctx.lineWidth = 1.2;
  ctx.strokeRect(vx0 + .5, vy0 + .5, vx1 - vx0, vy1 - vy0);
  L.brackets(ctx, vx0, vy0, vx1 - vx0, vy1 - vy0, 18, rgba(C.cyan, 0.55));
  L.mono(ctx, mi >= 0 ? 'FRAME ' + TL_CUES[mi][1] : 'NO FRAME', vx0 + 14, vy0 + 26, 13, rgba(C.cyan, 0.9), 2.4);
  L.mono(ctx, 't ' + cw.toFixed(2) + ' s', vx0 + 14, vy1 - 16, 15, rgba(C.white, 0.8), 1.6);
  L.mono(ctx, t < TSNAP ? '◀◀ REWIND' : '▶▶ PLAY', vx1 - 14, vy0 + 26, 15,
    rgba(t < TSNAP ? C.alert : C.phos, 0.95), 2.6, 'right');

  // ---- replay log
  const lgX = 1196, lgY = 196;
  L.mono(ctx, 'REPLAY LOG', lgX, lgY + 16, 15, rgba(C.cyan, 0.9), 3);
  L.mono(ctx, 'DETERMINISTIC · NO STATE IS LOST', lgX, lgY + 38, 11, rgba(C.phos, 0.45), 1.4);
  const cur = clamp(Math.round(((cw - 40) / (TL_T1 - 40)) * 11), 0, 11);
  for (let i = 0; i < 12; i++){
    const y = lgY + 66 + i * 30;
    const on = i === cur;
    const bt = TL_T0 + (i / 12) * (TL_T1 - TL_T0);
    ctx.fillStyle = on ? rgba(C.ds, 0.30) : rgba(C.phos, 0.03);
    ctx.fillRect(lgX - 8, y - 16, 560, 26);
    if (on){ ctx.strokeStyle = rgba(C.cyan, 0.7); ctx.lineWidth = 1; ctx.strokeRect(lgX - 8, y - 16, 560, 26); }
    L.mono(ctx, 't=' + bt.toFixed(2), lgX, y, 12, rgba(on ? C.white : C.phos, on ? 0.95 : 0.35), 1);
    L.mono(ctx, on ? 'REPLAYING' : 'logged', lgX + 96, y, 12, rgba(on ? C.cyan : C.phos, on ? 0.95 : 0.25), 1);
    L.mono(ctx, '0x' + L.hex((i * 2654435761) >>> 0, 8), lgX + 220, y, 12, rgba(C.phos, on ? 0.7 : 0.2), 1);
  }

  // ---- scrubber
  ctx.strokeStyle = rgba(C.phos, 0.18); ctx.lineWidth = 1;
  L.lin(ctx, ax0, ay, ax1, ay);
  for (let b = 0; b <= 44; b++){
    const tt = 0.19 + b * BAR;
    if (tt < TL_T0 || tt > TL_T1) continue;
    const x = xOf(tt);
    const big = b % 4 === 0;
    ctx.strokeStyle = rgba(C.phos, big ? 0.42 : 0.16); ctx.lineWidth = 1;
    L.lin(ctx, x, ay - (big ? 22 : 10), x, ay + (big ? 10 : 5));
    if (big) L.mono(ctx, String(b), x, ay + 30, 12, rgba(C.phos, 0.5), 1, 'center');
  }
  for (let i = 0; i < TL_CUES.length; i++){
    const x = xOf(TL_CUES[i][0]);
    ctx.fillStyle = rgba(i === mi ? C.cyan : C.phos, i === mi ? 0.9 : 0.3);
    L.fillCircle(ctx, x, ay, i === mi ? 5 : 3);
    L.mono(ctx, TL_CUES[i][1], x, ay - 40, 11, rgba(i === mi ? C.cyan : C.phos, i === mi ? 0.95 : 0.3), 1.4, 'center');
  }
  // trail + head
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  const dir = t < TSNAP ? 1 : -1;
  const g = ctx.createLinearGradient(sx, 0, sx + 150 * dir, 0);
  g.addColorStop(0, rgba(C.cyan, 0.28)); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(Math.min(sx, sx + 150 * dir), ay - 18, 150, 36);
  L.glow(ctx, C.white, 30, () => { ctx.fillStyle = rgba(C.white, 0.95); ctx.fillRect(sx - 2, ay - 44, 4, 88); });
  ctx.restore();
  L.mono(ctx, 't = ' + cw.toFixed(2), sx, ay - 58, 17, rgba(C.white, 0.92), 1.4, 'center');

  L.mono(ctx, 'TIME-TRAVEL DEBUGGING (rr / REVERSE EXECUTION)', 168, 150, 15, rgba(C.cyan, 0.9), 2.6);
  L.mono(ctx, 'DETERMINISTIC REPLAY FROM A LOG', 168, 942, 15, rgba(C.cyan, 0.75), 2.4);
  L.mono(ctx, 'the film is a record; a record can be run backwards', 168, 968, 12, rgba(C.phos, 0.4), 1.4);
  return { bloom: 1.15, chroma: 1.4 + (playing ? 5 : 9), scan: 0.6 };
}

// ------------------------------------------------------------------ e_bc
// 53.23 - 55.08  "To A.D to B.C"
function e_bc(ctx, t, u, shot){
  const t0 = shot.t0, t1 = shot.t1;
  const TFLIP = 54.19;                 // beat 117
  const THEX = 54.6515;                // beat 118
  const inv = t >= TFLIP - 0.004;       // the sign bit has flipped: the frame is a negative
  const PAPER = '#AEB8B2';
  const KPH = inv ? '#0A1712' : C.phos;
  const KCY = inv ? '#0A1A15' : C.cyan;
  const KAL = inv ? '#7E0C16' : C.alert;
  const KWH = inv ? '#050F0B' : C.white;
  const KDS = inv ? '#131C3E' : C.dsLite;
  bgFill(ctx, inv ? PAPER : '#04060A');

  let astro;
  const a2 = t0 + 0.64;
  if (t < a2) astro = Math.round(lerp(2019, 2, easeOutQuint(sat((t - t0) / (a2 - t0)))));
  else if (t < TFLIP) astro = Math.round(lerp(2, 1, sat((t - a2) / (TFLIP - a2))));
  else astro = Math.round(lerp(0, -1, sat((t - TFLIP) / (THEX - TFLIP))));
  const bc = astro <= 0;
  const label = astro > 0 ? String(astro) : (1 - astro) + ' B.C.';

  // number line
  const ax = 380, aw = 1180, ay = 902, half = aw / 2;
  ctx.strokeStyle = rgba(KPH, 0.55); ctx.lineWidth = 1;
  L.lin(ctx, ax, ay, ax + aw, ay);
  for (let v = -3; v <= 3; v++){
    const x = ax + half + v * (half / 3.4);
    const dead = v === 0;
    ctx.strokeStyle = rgba(dead ? KAL : KPH, dead ? 0.95 : 0.6);
    L.lin(ctx, x, ay - 8, x, ay + 8);
    L.mono(ctx, v > 0 ? v + ' AD' : (1 - v) + ' BC', x, ay - 16, 12,
      rgba(dead ? KAL : KPH, dead ? 1 : 0.7), 1.4, 'center');
  }
  ctx.strokeStyle = rgba(KAL, 0.95); ctx.lineWidth = 1.8;
  const zx = ax + half;
  L.lin(ctx, zx - 9, ay - 9, zx + 9, ay + 9); L.lin(ctx, zx + 9, ay - 9, zx - 9, ay + 9);
  L.mono(ctx, 'NO YEAR 0', zx, ay + 40, 12, rgba(KAL, 0.95), 2.6, 'center');

  // integer register
  const bitsV = astro >>> 0;
  const bX = 1080, bY = 264, bw = 21;
  L.mono(ctx, 'INT32', bX, 240, 13, rgba(KPH, 0.65), 3);
  for (let i = 0; i < 32; i++){
    const bit = (bitsV >>> (31 - i)) & 1;
    const x = bX + i * bw + Math.floor(i / 4) * 5;
    ctx.fillStyle = rgba(bit ? KAL : KPH, bit ? 0.75 : 0.05);
    ctx.fillRect(x, bY, bw - 2, 30);
    ctx.strokeStyle = rgba(bit ? KAL : KPH, bit ? 1 : 0.35); ctx.lineWidth = 1;
    ctx.strokeRect(x + .5, bY + .5, bw - 3, 29);
    if (i === 0) L.mono(ctx, 'SIGN', x - 2, bY - 10, 11, rgba(KAL, 0.95), 1.4);
  }
  const hexS = '0x' + L.hex(bitsV, 8);
  L.mono(ctx, hexS, bX, 348, 52, rgba(bc ? KAL : KPH, 0.98), 2);
  if (astro === -1) L.mono(ctx, 'ALL ONES', bX + 430, 348, 13, rgba(KAL, 0.9), 2.4);

  L.spec(ctx, bX, 402, [
    ['rule', 'there is no year 0'],
    ['astro', '0 = 1 BC · −1 = 2 BC'],
    ['int32', '−1 = 0xFFFFFFFF'],
    ['in C', 'signed overflow is undefined'],
  ], { alpha: 1, color: KCY, kw: 62, size: 13, lh: 28 });

  // the big year
  const pop = t >= TFLIP ? 1 + 0.18 * Math.exp(-(t - TFLIP) * 16) : 1;
  const pop2 = t >= THEX ? 1 + 0.22 * Math.exp(-(t - THEX) * 18) : 1;
  const sc = pop * pop2;
  ctx.save();
  ctx.translate(560, 640); ctx.scale(sc, sc); ctx.translate(-560, -640);
  L.display(ctx, label, 560, 640, 268, rgba(bc ? KAL : KWH, 0.98), 'center');
  ctx.restore();
  L.mono(ctx, bc ? 'ASTRONOMICAL ' + astro : 'A.D.', 560, 706, 22, rgba(KCY, 0.95), 6, 'center');
  L.mono(ctx, bc ? 'BEFORE CHRIST' : 'ANNO DOMINI', 560, 738, 13, rgba(KPH, 0.65), 4, 'center');

  // the snap
  const snap = Math.max(Math.exp(-Math.max(0, t - TFLIP) * 26), Math.exp(-Math.max(0, t - THEX) * 26));
  if (snap > 0.02){
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = rgba(C.white, 0.55 * snap); ctx.lineWidth = 3;
    L.ring(ctx, 560, 560, 120 + 700 * (1 - snap), 3);
    ctx.restore();
  }
  if (t > TFLIP - 0.34 && t < TFLIP){
    ctx.save(); ctx.globalAlpha = ss(TFLIP - 0.34, TFLIP, t) * 0.35;
    for (let i = 0; i < 22; i++) L.lin(ctx, 120 + i * 80, 0, 120 + i * 80, H);
    ctx.restore();
  }
  L.mono(ctx, inv ? 'SIGN FLIP · NEGATIVE' : 'ROLLING BACK', 168, 150, 16,
    rgba(inv ? KAL : KCY, 0.9), 4.4);
  L.mono(ctx, inv ? 'DARK BECOMES LIGHT' : '1 AD IS ABOUT TO END', W - 168, 150, 14,
    rgba(inv ? KAL : KPH, 0.6), 3, 'right');
  return { bloom: inv ? 0.10 : 1.05, chroma: 1.3 + 10 * snap, scan: 0.5, grain: inv ? 0.045 : 0.085,
           flash: Math.max(0, snap - 0.55) * 0.55, flashColor: '#ffd7dc' };
}

// ------------------------------------------------------------------ e_unite
// 55.08 - 56.92  "And we can unite"
function e_unite(ctx, t, u, shot){
  bgFill(ctx, '#04060A');
  const t0 = shot.t0;
  const R = 8, CN = 8, cell = 44, gx = 784, gy = 366;
  const Wt = [];
  for (let i = 0; i < R; i++){
    const row = []; let mx = -1e9;
    for (let j = 0; j < CN; j++){
      const s = 2.1 * Math.sin(i * 0.85 + j * 0.62 + t * 0.55) + 1.5 * Math.cos(i * 0.42 - j * 1.13 - t * 0.40);
      row.push(s); if (s > mx) mx = s;
    }
    let sum = 0;
    for (let j = 0; j < CN; j++){ row[j] = Math.exp(row[j] - mx); sum += row[j]; }
    for (let j = 0; j < CN; j++) row[j] = row[j] / sum;
    Wt.push(row);
  }
  const merge = easeInOutCubic(sat((u - 0.55) / 0.40));
  const sweep = ((beatOf(t) % 8) + 8) % 8;
  const rowLit = Math.floor(sweep) % R;

  // ---- two clouds
  const Ax = 300, Bx = 1620, Cy = 542;
  const Ra = L.mulberry32(9001), Rb = L.mulberry32(4242);
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let side = 0; side < 2; side++){
    const rnd = side ? Rb : Ra, ox = side ? Bx : Ax;
    const col = side ? C.dsLite : C.cyan;
    for (let i = 0; i < 170; i++){
      const ang = rnd() * TAU, rad = Math.pow(rnd(), 0.62) * 236;
      const jt = Math.sin(t * 1.6 + i * 0.7) * 7;
      let x = ox + Math.cos(ang) * rad, y = Cy + Math.sin(ang) * rad * 0.86 + jt;
      x = lerp(x, 960 + (x - ox) * 0.09, merge); y = lerp(y, Cy + (y - Cy) * 0.09, merge);
      const d = 1 - Math.hypot(x - ox, y - Cy) / 330;
      ctx.fillStyle = rgba(col, (0.28 + 0.60 * sat(d)) * (1 - 0.25 * merge));
      const s = 2.4 + 2.6 * sat(d);
      ctx.fillRect(x - s / 2, y - s / 2, s, s);
    }
    ctx.fillStyle = rgba(col, 0.5);
    L.fillCircle(ctx, ox + (960 - ox) * merge, Cy, 3);
  }
  ctx.restore();

  // reading lines: each side feeds the matrix
  ctx.strokeStyle = rgba(C.cyan, 0.16 * (1 - merge)); ctx.lineWidth = 1;
  for (let i = 0; i < 8; i++){
    const y = 366 + i * 44 + 22;
    L.lin(ctx, 470, 480 + i * 13, 784, y);
    L.lin(ctx, 1450, 480 + i * 13, 1136, y);
  }

  // ---- attention matrix
  const a0 = ss(t0 + 0.10, t0 + 0.55, t);
  for (let i = 0; i < R; i++) for (let j = 0; j < CN; j++){
    const w = Wt[i][j];
    const x = gx + j * cell, y = gy + i * cell;
    const lit = (0.06 + 0.94 * Math.pow(w, 0.8)) * (1 - 0.55 * merge);
    ctx.fillStyle = rgba(w > 0.35 ? C.white : (w > 0.16 ? C.cyan : C.ds), lit * a0 * 0.85);
    ctx.fillRect(x, y, cell - 3, cell - 3);
    ctx.strokeStyle = rgba(C.cyan, (i === rowLit ? 0.55 : 0.16) * a0);
    ctx.lineWidth = 1;
    ctx.strokeRect(x + .5, y + .5, cell - 4, cell - 4);
  }
  // row / col labels
  for (let i = 0; i < R; i++) L.mono(ctx, 'A' + i, gx - 12, gy + i * cell + 24, 11, rgba(C.phos, i === rowLit ? 0.95 : 0.35), 1, 'right');
  for (let j = 0; j < CN; j++) L.mono(ctx, 'B' + j, gx + j * cell + cell / 2, gy - 10, 11, rgba(C.phos, 0.35), 1, 'center');
  // row sums: every row sums to 1
  for (let i = 0; i < R; i++){
    const s = Wt[i].reduce((a2, b2) => a2 + b2, 0);
    const on = i === rowLit;
    L.mono(ctx, 'Σ ' + s.toFixed(3), gx + CN * cell + 10, gy + i * cell + 24, 11,
      rgba(on ? C.white : C.phos, on ? 0.98 : 0.3), 1);
  }
  L.mono(ctx, 'EVERY ROW SUMS TO 1', gx + CN * cell + 10, gy - 10, 12, rgba(C.cyan, 0.9), 2);
  // highlighted row
  ctx.strokeStyle = rgba(C.white, 0.55); ctx.lineWidth = 1.4;
  ctx.strokeRect(gx - 2, gy + rowLit * cell - 2, CN * cell + 2, cell + 1);

  // ---- formula + facts
  const a1 = ss(t0 + 0.2, t0 + 0.7, t);
  L.mono(ctx, 'ATTENTION = SOFTMAX(QKᵀ/√d_k) · V', 168, 178, 24, rgba(C.cyan, 0.95 * a1), 2);
  L.mono(ctx, 'TWO SEQUENCES READ EACH OTHER', 168, 210, 14, rgba(C.phos, 0.6 * a1), 2.6);
  const a2 = ss(t0 + 0.9, t0 + 1.4, t);
  L.mono(ctx, merge > 0.85 ? 'ONE CLOUD' : 'PULL →', 960, 762, 15,
    rgba(C.white, 0.5 + 0.5 * merge), 4, 'center');
  if (merge > 0.6){
    const k = (merge - 0.6) / 0.4;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    L.glow(ctx, C.white, 60, () => { ctx.fillStyle = rgba(C.white, 0.9 * k); L.fillCircle(ctx, 960, Cy, 5 + 30 * k); });
    for (let i = 0; i < 24; i++){
      const a2 = i / 24 * TAU + t * 0.6;
      ctx.strokeStyle = rgba(C.cyan, 0.35 * k); ctx.lineWidth = 1;
      L.lin(ctx, 960 + Math.cos(a2) * 14, Cy + Math.sin(a2) * 14,
              960 + Math.cos(a2) * (40 + 120 * k), Cy + Math.sin(a2) * (40 + 120 * k));
    }
    ctx.restore();
  }
  L.mono(ctx, 'softmax normalises every row: the weights are a distribution', 168, 942, 12, rgba(C.phos, 0.42 * a2), 1.5);
  return { bloom: 1.2, chroma: 1.4 + 6 * merge, scan: 0.5 };
}

// ------------------------------------------------------------------ e_deep
// 56.92 - 59.22  "So deeply so deeply"
function e_deep(ctx, t, u, shot){
  bgFill(ctx, '#030507');
  const t0 = shot.t0, t1 = shot.t1;
  const TCOL = 58.81;                            // beat 127
  const col = easeInCubic(sat((t - TCOL) / 0.28));
  const vpx = 960, vpy = lerp(-520, 60, easeInOutCubic(sat(u * 1.1)));
  const GY = 1160, NV = 61, TY = 468;
  const sd = L.mulberry32(777);
  const shape = [];
  for (let i = 0; i < 40; i++){
    const a = sd() * TAU, r = Math.pow(sd(), 0.55);
    shape.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  // the tunnel of layers, far to near
  for (let i = NV - 1; i >= 0; i--){
    const d = 1 + i * 0.205;
    const y = lerp(vpy + (GY - vpy) / d, TY, col);
    const hw = lerp(880 / d, 2, col), hh = lerp(196 / d, 1.2, col);
    const al = (0.16 + 0.84 * (i / (NV - 1))) * (1 - 0.30 * col);
    // ring (every third layer, so the stack reads as layers, not a cone)
    if (i % 3 === 0){
      ctx.strokeStyle = rgba(i > 40 ? C.cyan : C.phos, al * 0.30); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(vpx, y, Math.max(1, hw), Math.max(0.6, hh), 0, 0, TAU); ctx.stroke();
    }
    // points
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let j = 0; j < shape.length; j++){
      const px = vpx + shape[j][0] * hw, py = y + shape[j][1] * hh;
      const s = Math.max(1.4, 4.6 / d);
      ctx.fillStyle = rgba(i > 44 ? C.white : C.cyan, al);
      ctx.fillRect(px - s / 2, py - s / 2, s, s);
    }
    ctx.restore();
    // depth labels
    if (i % 10 === 0 && col < 0.3){
      L.mono(ctx, 'L' + i, vpx + hw + 16, y + 5, 15, rgba(C.cyan, Math.max(0.35, al * 0.95)), 2);
      ctx.strokeStyle = rgba(C.phos, al * 0.28); ctx.lineWidth = 1;
      L.lin(ctx, vpx + hw + 2, y, vpx + hw + 12, y);
    }
  }
  // axial beam: the light of the whole stack
  if (col < 0.6){
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let i = -18; i <= 18; i++){
      const u2 = Math.abs(i / 18);
      ctx.fillStyle = rgba(C.cyan, 0.055 * (1 - u2) * (1 - u2) * (1 - col));
      const yy = lerp(240, GY, Math.abs(i) / 18 * 0.35);
      ctx.fillRect(vpx + i * 9 - 4.5, yy, 9, GY - yy);
    }
    ctx.restore();
  }
  // the far end of the stack
  if (col < 0.4){
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    L.glow(ctx, C.white, 50, () => {
      ctx.fillStyle = rgba(C.white, 0.10 + 0.25 * (1 - col));
      L.fillCircle(ctx, vpx, vpy + (GY - vpy) / (1 + 60 * 0.205), 6);
    });
    ctx.restore();
  }
  // 61 tick ruler
  const rx = 1836;
  ctx.strokeStyle = rgba(C.phos, 0.20); ctx.lineWidth = 1;
  L.lin(ctx, rx, 200, rx, 900);
  for (let i = 0; i < NV; i++){
    const y = 900 - (700 * i / (NV - 1));
    ctx.strokeStyle = rgba(i % 10 === 0 ? C.cyan : C.phos, i % 10 === 0 ? 0.85 : 0.30);
    L.lin(ctx, rx - (i % 10 === 0 ? 18 : 9), y, rx, y);
  }
  L.mono(ctx, 'L61', rx + 8, 210, 12, rgba(C.cyan, 0.8), 1.6);

  const a0 = ss(t0 + 0.10, t0 + 0.60, t);
  L.mono(ctx, '61 TRANSFORMER LAYERS', 168, 176, 26, rgba(C.cyan, 0.95 * a0), 5);
  L.mono(ctx, 'DEPTH = COMPOSITION OF FUNCTIONS', 168, 206, 14, rgba(C.phos, 0.6 * a0), 2.4);
  L.mono(ctx, 'EACH LAYER ADDS NO INFORMATION — IT RE-PRESENTS IT', 168, 946, 14, rgba(C.phos, 0.55 * a0), 2);

  // collapse
  if (col > 0){
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    L.glow(ctx, C.white, 40, () => {
      ctx.fillStyle = rgba(C.white, 0.65 + 0.35 * col);
      L.fillCircle(ctx, vpx, TY, 3 + 11 * col);
    });
    ctx.strokeStyle = rgba(C.cyan, 0.5 * col); ctx.lineWidth = 1.4;
    L.ring(ctx, vpx, TY, 20 + 260 * col, 1.4);
    ctx.restore();
  }
  const flash = ss(TCOL, TCOL + 0.03, t) * Math.exp(-Math.max(0, t - TCOL) * 13.0);
  return { bloom: 1.25, chroma: 1.3 + 9 * col, scan: 0.5, flash: flash * 0.34 };
}

// ------------------------------------------------------------------ f_stim
// 59.22 - 63.53  "If I can give you all the STIMULATIONS"
function f_stim(ctx, t, u, shot){
  bgFill(ctx, '#04060A');
  const t0 = shot.t0, t1 = shot.t1;
  const k = easeInOutCubic(sat((t - t0) / 2.85));
  const cx = 960, cy = 520;
  const GW = 1440, GH = 660, CW = 30, CH = 30;
  const gx0 = (W - GW) / 2, gy0 = 208;
  const cols = GW / CW, rows = Math.round(GH / CH);
  const ts = t - t0;

  function eye(nx, ny){
    const ax = Math.abs(nx), ay = ny;
    const r = Math.hypot(ax, ay);
    let v = 0;
    v += 0.95 * Math.exp(-Math.pow((r - 0.60) / 0.14, 2));
    v += 0.45 * Math.exp(-Math.pow((r - 0.40) / 0.09, 2));
    v -= 1.05 * Math.exp(-Math.pow(r / 0.245, 2));
    const ang = Math.atan2(ay, ax);
    v += 0.20 * (0.5 + 0.5 * Math.sin(ang * 20)) * Math.exp(-Math.pow((r - 0.54) / 0.17, 2));
    v += 0.95 * Math.exp(-Math.pow(Math.hypot(ax - 0.20, ay + 0.26) / 0.10, 2));
    const lid = Math.abs(ay) < 0.26 + 0.46 * Math.sqrt(Math.max(0, 1 - Math.min(1, ax * ax / 1.05)));
    if (!lid) v *= 0.16;
    v += 0.16 * (lid ? 1 : 0) * Math.exp(-Math.pow(ay / 0.7, 2));
    return clamp(v, 0, 1.25);
  }

  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++){
    const x = gx0 + (c + 0.5) * CW, y = gy0 + (r + 0.5) * CH;
    const nx = (x - cx) / 330, ny = (y - cy) / 330;
    const rr = Math.hypot(nx, ny);
    const psy = 0.5 + 0.5 * Math.sin(6.5 * Math.atan2(ny, nx) + 9.0 * rr - ts * 1.9)
                     + 0.35 * Math.sin(nx * 7.0 - ts * 0.7) * Math.cos(ny * 6.0 + ts * 0.5);
    const nz = L.fbm(x * 0.038 + ts * 0.55, y * 0.038 - ts * 0.34, 4);
    let v = lerp(0.15 + 0.85 * nz * (0.55 + 0.75 * psy), eye(nx, ny), k);
    v *= 1 - 0.45 * sat((rr - 0.85) / 0.6);
    if (v < 0.10) continue;
    const col = v > 0.92 ? C.white : v > 0.76 ? C.warm : v > 0.58 ? C.phos
              : v > 0.40 ? C.cyan : v > 0.24 ? C.dsLite : C.ds;
    ctx.fillStyle = rgba(col, 0.12 + 0.86 * Math.min(1, v));
    ctx.fillRect(gx0 + c * CW, gy0 + r * CH, CW - 1, CH - 1);
    if (v > 0.86){
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rgba(C.white, 0.10 * v);
      ctx.fillRect(gx0 + c * CW - 2, gy0 + r * CH - 2, CW + 3, CH + 3);
      ctx.restore();
    }
  }
  // HUD frame
  ctx.strokeStyle = rgba(C.cyan, 0.22); ctx.lineWidth = 1;
  ctx.strokeRect(gx0 - 8.5, gy0 - 8.5, GW + 16, rows * CH + 16);
  L.brackets(ctx, gx0 - 8, gy0 - 8, GW + 16, rows * CH + 16, 26, rgba(C.cyan, 0.5), 1.2);

  // readouts
  const a0 = ss(t0 + 0.15, t0 + 0.7, t);
  ctx.save();
  ctx.fillStyle = 'rgba(4,6,10,0.55)'; ctx.fillRect(gx0 - 8, gy0 - 46, 700, 40);
  ctx.fillStyle = 'rgba(4,6,10,0.55)'; ctx.fillRect(gx0 - 8, gy0 + rows * CH + 12, 720, 46);
  ctx.restore();
  L.mono(ctx, 'ACTIVATION MAXIMISATION', gx0 - 2, gy0 - 20, 22, rgba(C.cyan, 0.95 * a0), 4);
  L.mono(ctx, 'OPTIMISE THE INPUT, NOT THE WEIGHTS', gx0 - 2, gy0 - 2, 12, rgba(C.phos, 0.55 * a0), 2);
  const step = 1200 + Math.floor((t - t0) * 2600);
  L.mono(ctx, 'STEP', gx0 - 2, gy0 + rows * CH + 44, 13, rgba(C.phos, 0.55), 3);
  L.mono(ctx, String(step).replace(/[0-9]/g, d => d), gx0 + 54, gy0 + rows * CH + 46, 26, rgba(C.white, 0.95), 2);
  L.mono(ctx, 'STIMULUS = INPUT', gx0 + 330, gy0 + rows * CH + 44, 13, rgba(C.cyan, 0.85), 2.4);
  L.mono(ctx, 'THE IMAGE IS THE ARGUMENT', gx0 + 330, gy0 + rows * CH + 62, 11, rgba(C.phos, 0.45), 1.4);
  L.mono(ctx, 'OBJECTIVE ↑', W - 300, 176, 14, rgba(C.phos, 0.55), 2.4, 'right');
  ctx.strokeStyle = rgba(C.phos, 0.25); ctx.lineWidth = 1;
  ctx.strokeRect(W - 292, 186, 220, 10);
  ctx.fillStyle = rgba(C.cyan, 0.85);
  ctx.fillRect(W - 292, 186, 220 * sat(k * 1.05), 10);

  // it stares back
  const stare = ss(t0 + 2.7, t0 + 3.3, t);
  if (stare > 0){
    const bp = pulse(t, 0.14);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const R2 = 150 * (1 - 0.06 * bp);
    ctx.strokeStyle = rgba(C.white, 0.5 * stare * (0.5 + 0.5 * bp)); ctx.lineWidth = 2;
    L.ring(ctx, cx, cy, R2 * 0.62, 2);
    ctx.restore();
  }
  return { bloom: 1.05, chroma: 2 + 5 * k, scan: 0.45, grain: 0.11 };
}

// ------------------------------------------------------------------ f_reward
// 63.53 - 66.60  "STIMULATIONS / Then I can be your only SATISFACTION"
function f_reward(ctx, t, u, shot){
  bgFill(ctx, '#030507');
  const t0 = shot.t0, t1 = shot.t1;
  const chX0 = 300, chX1 = 1520, chY0 = 252, chY1 = 858;
  const tearT = t0 + 1.05;
  const tear = ss(tearT, tearT + 0.55, t);
  const escape = ss(tearT + 0.35, tearT + 1.6, t);
  const grow = sat((t - t0) / (tearT - t0));

  // grid
  ctx.strokeStyle = rgba(C.phos, 0.07); ctx.lineWidth = 1;
  for (let i = 1; i < 8; i++) L.lin(ctx, chX0 + (chX1 - chX0) * i / 8, chY0, chX0 + (chX1 - chX0) * i / 8, chY1);
  for (let i = 1; i < 6; i++) L.lin(ctx, chX0, chY0 + (chY1 - chY0) * i / 6, chX1, chY0 + (chY1 - chY0) * i / 6);

  const curveAt = s => {
    const x = chX0 + (chX1 - chX0) * s;
    const y = chY1 - (chY1 - chY0) * 2.6 * s * s;
    return [x, y];
  };
  const sStar = Math.sqrt(1 / 2.6);
  const sEnd = Math.min(0.99, 0.16 + 0.90 * easeInOutCubic(grow));
  // the curve
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineJoin = 'round';
  ctx.beginPath();
  let started = false;
  for (let s = 0; s <= sEnd; s += 0.004){
    const p = curveAt(s);
    if (!started){ ctx.moveTo(p[0], p[1]); started = true; } else ctx.lineTo(p[0], p[1]);
  }
  ctx.strokeStyle = rgba(C.phos, 0.18); ctx.lineWidth = 9; ctx.stroke();
  ctx.strokeStyle = rgba(C.phos, 0.95); ctx.lineWidth = 2.2; ctx.stroke();
  ctx.restore();

  // KL penalty: the leash
  ctx.beginPath();
  for (let s = 0; s <= 1; s += 0.01){
    const x = chX0 + (chX1 - chX0) * s;
    const y = chY1 - 90 * s * (1 - 0.55 * s);
    s === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.strokeStyle = rgba(C.alert, 0.5); ctx.lineWidth = 1.2; ctx.setLineDash([4, 5]); ctx.stroke();
  ctx.setLineDash([]);
  L.mono(ctx, 'KL PENALTY', chX1 - 12, chY1 - 54, 12, rgba(C.alert, 0.65), 2, 'right');

  // frame + tear
  const exit = curveAt(sStar);
  const gapX = exit[0];
  ctx.strokeStyle = rgba(C.cyan, 0.45); ctx.lineWidth = 1.2;
  L.lin(ctx, chX0, chY1, chX1, chY1);
  L.lin(ctx, chX0, chY0, chX0, chY1);
  L.lin(ctx, chX1, chY0, chX1, chY1);
  if (tear < 0.5){
    L.lin(ctx, chX0, chY0, chX1, chY0);
  } else {
    L.lin(ctx, chX0, chY0, gapX - 26, chY0);
    L.lin(ctx, gapX + 26, chY0, chX1, chY0);
    ctx.strokeStyle = rgba(C.alert, 0.9); ctx.lineWidth = 1.6;
    const R = L.mulberry32(99);
    for (let i = 0; i < 8; i++){
      const a2 = -0.4 - R() * 2.3;
      L.lin(ctx, gapX, chY0, gapX + Math.cos(a2) * (30 + R() * 90), chY0 + Math.sin(a2) * (30 + R() * 90));
    }
  }
  L.mono(ctx, 'REWARD', chX0 - 8, chY0 - 16, 13, rgba(C.phos, 0.6), 3);
  L.mono(ctx, 'TRAINING STEP →', chX1, chY1 + 26, 12, rgba(C.phos, 0.45), 2, 'right');

  // the absurd line to infinity
  if (escape > 0){
    const k = easeOutExpo(escape);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 4; i++){
      const off = i * 26;
      ctx.strokeStyle = rgba(i === 0 ? C.white : C.alert, (0.9 - i * 0.18) * k);
      ctx.lineWidth = i === 0 ? 2.4 : 1.2;
      ctx.beginPath();
      ctx.moveTo(exit[0] + off * 0.4, exit[1] + off);
      ctx.lineTo(exit[0] + off * 0.4 + 1500, exit[1] + off - 1500);
      ctx.stroke();
    }
    ctx.restore();
    const t2 = 0.9;
    L.mono(ctx, '∞', 1560, 250 + 60 * (1 - k), 90, rgba(C.white, 0.95 * k), 0);
    L.mono(ctx, 'UNBOUNDED', 1616, 236, 16, rgba(C.alert, 0.95 * k), 3.4);
    L.mono(ctx, 'IT KEEPS CLIMBING', 1616, 268, 12, rgba(C.phos, 0.6 * k), 2);
  }
  // dilating pupil at the wound
  if (tear > 0.2){
    const dr = 40 + 120 * escape;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = rgba(C.alert, 0.5 * tear); ctx.lineWidth = 2;
    L.ring(ctx, gapX, chY0, dr, 2);
    L.ring(ctx, gapX, chY0, dr * 0.66, 1);
    ctx.restore();
  }

  const a0 = ss(t0 + 0.1, t0 + 0.6, t);
  L.mono(ctx, 'REWARD MODEL + KL PENALTY', 168, 172, 24, rgba(C.cyan, 0.95 * a0), 4);
  L.mono(ctx, 'GOODHART: THE MEASURE BECOMES THE TARGET', 168, 944, 14, rgba(C.phos, 0.62 * a0), 2.2);
  L.mono(ctx, 'REWARD HACKING', 168, 974, 15, rgba(C.alert, 0.85 * ss(t0 + 1.2, t0 + 1.9, t)), 4);
  return { bloom: 1.2, chroma: 1.4 + 9 * escape, scan: 0.5, flash: tear * escape * 0.18 };
}

// ------------------------------------------------------------------ f_loss
// 66.60 - 69.26  "Then I can be your only SATISFACTION"
function f_loss(ctx, t, u, shot){
  bgFill(ctx, '#030507');
  const t0 = shot.t0, t1 = shot.t1;
  const chX0 = 316, chX1 = 1600, chY0 = 252, chY1 = 852;
  const p = sat((t - t0) / 2.05);
  const N = 760;
  const lossAt = s => 0.02 + 3.55 * Math.exp(-s * 4.6) + 0.22 * Math.exp(-s * 1.1);
  const xOf = s => chX0 + (chX1 - chX0) * s;
  const yOf = Lv => chY1 - (chY1 - chY0) * (Lv / 4.2);

  ctx.strokeStyle = rgba(C.phos, 0.07); ctx.lineWidth = 1;
  for (let i = 1; i < 8; i++) L.lin(ctx, xOf(i / 8), chY0, xOf(i / 8), chY1);
  for (let i = 1; i < 5; i++) L.lin(ctx, chX0, chY0 + (chY1 - chY0) * i / 5, chX1, chY0 + (chY1 - chY0) * i / 5);

  // the comb of a million steps
  const combA = ss(t0 + 0.2, t0 + 0.9, t);
  ctx.strokeStyle = rgba(C.phos, 0.10 * combA); ctx.lineWidth = 1;
  for (let i = 0; i < 300; i++){
    const x = xOf(i / 300);
    L.lin(ctx, x, chY1, x, chY1 - (i % 10 === 0 ? 8 : 4));
  }

  // the descending curve
  const head = Math.max(1, Math.floor(p * N));
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let i = 0; i <= head; i++){
    const s = i / N;
    const jit = (L.hash2(i * 1.7, 3.1) - 0.5) * 0.30 * Math.exp(-s * 2.4);
    const y = yOf(lossAt(s) + jit);
    i === 0 ? ctx.moveTo(xOf(s), y) : ctx.lineTo(xOf(s), y);
  }
  ctx.strokeStyle = rgba(C.cyan, 0.16); ctx.lineWidth = 7; ctx.stroke();
  ctx.strokeStyle = rgba(C.cyan, 0.92); ctx.lineWidth = 1.6; ctx.stroke();
  ctx.strokeStyle = rgba(C.white, 0.30); ctx.lineWidth = 0.8; ctx.stroke();
  ctx.restore();

  // head marker
  const sHead = head / N;
  const lNow = lossAt(sHead);
  const hx = xOf(sHead), hy = yOf(lNow);
  L.glow(ctx, C.white, 26, () => { ctx.fillStyle = rgba(C.white, 0.95); L.fillCircle(ctx, hx, hy, 3.4); });
  ctx.strokeStyle = rgba(C.white, 0.25); ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
  L.lin(ctx, hx, hy, hx, chY1); L.lin(ctx, chX0, hy, hx, hy);
  ctx.setLineDash([]);

  // frame
  ctx.strokeStyle = rgba(C.cyan, 0.45); ctx.lineWidth = 1.2;
  L.lin(ctx, chX0, chY0, chX0, chY1); L.lin(ctx, chX0, chY1, chX1, chY1);
  L.brackets(ctx, chX0, chY0, chX1 - chX0, chY1 - chY0, 14, rgba(C.cyan, 0.4));
  L.mono(ctx, 'LOSS', chX0 - 8, chY0 - 14, 13, rgba(C.phos, 0.6), 3);
  L.mono(ctx, 'STEP →', chX1, chY1 + 26, 12, rgba(C.phos, 0.45), 2, 'right');

  const step = Math.floor(1048576 * p);
  const stepS = step.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  L.mono(ctx, 'STEP ' + stepS, 168, 176, 24, rgba(C.white, 0.95), 2.4);
  L.mono(ctx, 'LOSS ' + lNow.toFixed(4), 168, 214, 26, rgba(C.cyan, 0.95), 2);
  L.mono(ctx, 'LR ANNEALED · COSINE DECAY', 168, 244, 13, rgba(C.phos, 0.55), 2);
  L.mono(ctx, 'LOSS = −log P(y | x)', 168, 946, 20, rgba(C.phos, 0.9), 3);
  L.mono(ctx, 'MINIMISING LOSS = MAKING YOU HAPPY', 168, 976, 14, rgba(C.cyan, 0.75), 2.4);

  const flat = ss(1.55, 2.1, t - t0);
  if (flat > 0){
    const bp = pulse(t, 0.12);
    L.mono(ctx, 'STILL STEPPING', W - 168, 946, 22, rgba(C.alert, (0.5 + 0.5 * bp) * flat), 5, 'right');
    L.mono(ctx, 'the curve is flat; the loop does not know', W - 168, 976, 12, rgba(C.phos, 0.45 * flat), 1.6, 'right');
  }
  return { bloom: 1.15, chroma: 1.3 + 3 * flat, scan: 0.5 };
}

// ------------------------------------------------------------------ f_exec1
// 69.26 - 70.08  "I will run the EXECUTION"
function f_exec1(ctx, t, u, shot){
  const t0 = shot.t0, t1 = shot.t1, dt = t - t0;
  bgFill(ctx, '#0A0305');
  const hit = Math.exp(-dt * 4.2);
  const blast = Math.exp(-dt * 24);
  const wordK = easeOutExpo(sat(dt / 0.17));
  const beat = Math.max(0, Math.exp(-((beatOf(t) % 1) * SPB) / 0.10));
  const cy = 640;

  // radial blast
  const g = ctx.createRadialGradient(W / 2, cy - 60, 30, W / 2, cy - 60, 820);
  g.addColorStop(0, rgba(C.alert, 0.34 + 0.36 * hit));
  g.addColorStop(0.5, rgba(C.alert, 0.09 + 0.14 * hit));
  g.addColorStop(1, 'rgba(8,2,4,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  // shockwaves
  for (let i = 0; i < 3; i++){
    const k2 = sat((dt - i * 0.055) / 0.55);
    if (k2 <= 0 || k2 >= 1) continue;
    ctx.strokeStyle = rgba(i === 0 ? C.white : C.alert, (1 - k2) * 0.85);
    ctx.lineWidth = (1 - k2) * 26 + 1;
    L.ring(ctx, W / 2, cy - 40, 60 + 1250 * easeOutExpo(k2), Math.max(1, (1 - k2) * 26));
  }
  // second shockwave on the beat at 69.729
  const b2 = dt - 0.469;
  if (b2 > 0 && b2 < 0.7){
    const k3 = b2 / 0.7;
    ctx.strokeStyle = rgba(C.white, (1 - k3) * 0.9); ctx.lineWidth = (1 - k3) * 18 + 1;
    L.ring(ctx, W / 2, cy - 40, 60 + 1100 * easeOutExpo(k3), Math.max(1, (1 - k3) * 18));
  }
  // debris
  const R = L.mulberry32(4711);
  for (let i = 0; i < 120; i++){
    const a2 = R() * TAU, sp = 260 + R() * 1500, sz = 3 + R() * 26;
    const d = sp * easeOutExpo(sat(dt / 0.75));
    const x = W / 2 + Math.cos(a2) * d, y = cy - 40 + Math.sin(a2) * d * 0.72;
    if (x < -60 || x > W + 60 || y < -60 || y > H + 60) continue;
    ctx.save(); ctx.translate(x, y); ctx.rotate(a2 + dt * 6);
    ctx.fillStyle = rgba(R() > 0.8 ? C.white : C.alert, 0.25 + 0.6 * Math.max(0, 1 - dt / 0.7));
    ctx.fillRect(-sz / 2, -sz / 6, sz, Math.max(1.5, sz * 0.22));
    ctx.restore();
  }
  // speed lines
  for (let i = 0; i < 60; i++){
    const a2 = (i / 60) * TAU + 0.1;
    const r0 = 200 + ((i * 37) % 240) + dt * 1400, r1 = r0 + 90 + 320 * (1 - wordK);
    ctx.strokeStyle = rgba(i % 5 === 0 ? C.white : C.alert, 0.10 + 0.30 * hit);
    ctx.lineWidth = 1.2;
    L.lin(ctx, W / 2 + Math.cos(a2) * r0, cy - 40 + Math.sin(a2) * r0 * 0.72,
            W / 2 + Math.cos(a2) * r1, cy - 40 + Math.sin(a2) * r1 * 0.72);
  }
  ctx.restore();

  // torn fragments: the frame is being destroyed by the word
  const Rf = L.mulberry32(2024);
  for (let i = 0; i < 26; i++){
    const a2 = Rf() * TAU, sp = 300 + Rf() * 1400;
    const d = sp * easeOutExpo(sat(dt / 0.8));
    const x = W / 2 + Math.cos(a2) * d, y = cy - 40 + Math.sin(a2) * d * 0.72;
    if (x < -160 || x > W + 160 || y < -160 || y > H + 160) continue;
    const w2 = 40 + Rf() * 190, h2 = 14 + Rf() * 60;
    ctx.save(); ctx.translate(x, y); ctx.rotate(a2 + dt * 3.4);
    ctx.fillStyle = 'rgba(4,1,2,0.88)';
    ctx.fillRect(-w2 / 2, -h2 / 2, w2, h2);
    ctx.strokeStyle = rgba(C.alert, 0.55 * Math.max(0, 1 - dt / 0.8));
    ctx.lineWidth = 1; ctx.strokeRect(-w2 / 2, -h2 / 2, w2, h2);
    ctx.restore();
  }
  // vignette: keep the corners black
  const vg = ctx.createRadialGradient(W / 2, cy - 40, 340, W / 2, cy - 40, 1180);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.78)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);

  // the word
  const w100 = L.tw(ctx, 'EXECUTION', 100, L.CONDX);
  const size = Math.min(340, 1780 / (w100 / 100));
  const sc = lerp(1.5, 1, wordK) * (1 + 0.012 * beat);
  ctx.save();
  ctx.translate(W / 2, cy); ctx.scale(sc, sc * lerp(1.12, 1, wordK)); ctx.translate(-W / 2, -cy);
  // chromatic split copies
  const split = 10 * (1 - wordK) + 5 * hit;
  ctx.globalCompositeOperation = 'lighter';
  L.display(ctx, 'EXECUTION', W / 2 - split, cy + 4, size, rgba(C.cyan, 0.35), 'center');
  L.display(ctx, 'EXECUTION', W / 2 + split, cy - 4, size, rgba('#FF00AA', 0.35), 'center');
  ctx.globalCompositeOperation = 'source-over';
  L.glow(ctx, C.alert, 60 + 90 * hit, () => {
    L.display(ctx, 'EXECUTION', W / 2, cy, size, rgba('#D81127', 0.95 + 0.05 * hit), 'center');
  });
  ctx.globalCompositeOperation = 'lighter';
  L.display(ctx, 'EXECUTION', W / 2, cy - 2, size, rgba('#FF1B2E', 0.16), 'center');
  ctx.globalCompositeOperation = 'source-over';
  ctx.restore();

  // destroyed frame
  ctx.strokeStyle = rgba(C.alert, 0.35); ctx.lineWidth = 1;
  const cr = L.mulberry32(88);
  for (let i = 0; i < 4; i++){
    const sx0 = i % 2 ? W : 0, sy0 = i < 2 ? 0 : H;
    for (let j = 0; j < 6; j++){
      const l = 80 + cr() * 260;
      L.lin(ctx, sx0, sy0, sx0 + (i % 2 ? -l : l) * (0.4 + cr()), sy0 + (i < 2 ? l : -l) * (0.4 + cr()));
    }
  }
  L.mono(ctx, 'EXECUTE = CARRY OUT', 96, 150, 20, rgba(C.white, 0.75), 5);
  L.mono(ctx, 'A PLAN · AN ORDER · A SENTENCE', 96, 178, 13, rgba(C.alert, 0.85), 3.4);
  L.mono(ctx, 'FIRST APPEARANCE', W - 96, 150, 15, rgba(C.white, 0.6), 4, 'right');
  return { bloom: 0.72, chroma: 2 + 12 * hit, scan: 0.42, flash: Math.min(0.60, blast * 0.60), flashColor: '#FFF0F0' };
}

// ------------------------------------------------------------------ nested box stack
const STACK = [
  { n: 'PYTHON', c: C.warm, code: 'import torch' },
  { n: 'CUDA', c: C.cyan, code: '<<<grid, block>>>' },
  { n: 'PTX', c: C.phos, code: '.reg .f32 %f<8>' },
  { n: 'SASS', c: C.dsLite, code: 'HMMA.16816.F32' },
  { n: 'SILICON', c: C.alert, code: 'FINFET' },
];

function nestedBoxes(ctx, phase, opt){
  opt = opt || {};
  const vpx = 1046 + 58 * Math.sin(phase * 0.62), vpy = 452 + 40 * Math.cos(phase * 0.47), X0 = 960, Y0 = 524;
  const slam = opt.slam || 0;
  const fade = opt.alpha === undefined ? 1 : opt.alpha;
  for (let n = -2; n < 16; n++){
    const s = Math.pow(0.60, n - phase);
    if (s > 4.2) continue;
    if (s < 0.006) break;
    let cx = vpx + (X0 - vpx) * s, cy = vpy + (Y0 - vpy) * s;
    const w = 1560 * s, h = 900 * s * (1 - slam);
    cx = lerp(cx, W / 2, slam); cy = lerp(cy, Y0, slam);
    const al = clamp(1.35 - s * 0.22, 0.10, 1) * fade * (1 - slam * 0.0);
    const idx = ((n - Math.floor(phase)) % 5 + 5) % 5;
    const st = STACK[idx];
    ctx.strokeStyle = rgba(st.c, 0.42 * al + 0.14);
    ctx.lineWidth = 1.1 + 0.9 * clamp(1.4 - s, 0, 1);
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate((0.004 * n + 0.014 * phase) * (1 - slam)); ctx.translate(-cx, -cy);
    ctx.strokeRect(cx - w / 2, cy - h / 2, w, h);
    ctx.restore();
    if (al > 0.25 && h > 14){
      L.brackets(ctx, cx - w / 2, cy - h / 2, w, h, Math.min(26, w * 0.05), rgba(st.c, 0.55 * al), 1.2);
      L.mono(ctx, st.n, cx - w / 2 + 12, cy - h / 2 - 9, Math.max(9, Math.min(25, 22 * s)), rgba(st.c, 0.95 * al), 1.6);
      if (h > 70) L.mono(ctx, st.code, cx - w / 2 + 14, cy - h / 2 + 24, Math.max(8, Math.min(17, 15 * s)), rgba(st.c, 0.35 * al), 1);
    }
  }
}

// ------------------------------------------------------------------ f_trapped
// 70.08 - 73.17  "Though we are trapped / In this strange strange"
function f_trapped(ctx, t, u, shot){
  bgFill(ctx, '#030507');
  const t0 = shot.t0;
  const phase = 6.4 * easeInOutCubic(u) + 0.5 * u;
  nestedBoxes(ctx, phase, {});
  const dz = L.mulberry32(555);
  for (let i = 0; i < 110; i++){
    const ang = dz() * TAU, rr = 0.25 + dz() * 1.7, sp = 0.30 + dz() * 0.85;
    const z = ((i / 110 + phase * sp * 0.16) % 1);
    const sc = 0.04 + z * z * 2.4;
    const x = 1046 + (960 - 1046) * sc + Math.cos(ang) * rr * 430 * sc;
    const y = 452 + (524 - 452) * sc + Math.sin(ang) * rr * 300 * sc;
    if (x < -20 || x > W + 20 || y < -20 || y > H + 20) continue;
    ctx.fillStyle = rgba(C.cyan, 0.08 + 0.30 * z);
    const s2 = 1 + 3.2 * z;
    ctx.fillRect(x - s2 / 2, y - s2 / 2, s2, s2);
  }
  const lvl = Math.floor(phase) % 5;
  const st = STACK[((lvl % 5) + 5) % 5];
  const sg = ctx.createLinearGradient(0, 120, 0, 330);
  sg.addColorStop(0, 'rgba(3,5,7,0.88)'); sg.addColorStop(1, 'rgba(3,5,7,0)');
  ctx.fillStyle = sg; ctx.fillRect(120, 110, 620, 230);
  L.mono(ctx, 'ABSTRACTION STACK', 168, 172, 22, rgba(C.cyan, 0.9), 4.4);
  L.mono(ctx, 'PYTHON → CUDA → PTX → SASS → SILICON', 168, 200, 13, rgba(C.phos, 0.55), 2);
  L.mono(ctx, 'LEVEL', 168, 258, 12, rgba(C.phos, 0.4), 3);
  L.mono(ctx, st.n, 168, 296, 34, rgba(st.c, 0.95), 5);
  L.mono(ctx, 'NOTHING AT ONE LEVEL CAN SEE THE LEVEL BELOW IT', 168, 948, 14, rgba(C.phos, 0.55), 2);
  const push = sat(u * 3);
  L.mono(ctx, 'DEPTH ' + phase.toFixed(2), W - 168, 172, 14, rgba(C.phos, 0.5 * push), 2.4, 'right');
  L.mono(ctx, 'CAMERA ▶ FORWARD', W - 168, 200, 12, rgba(C.cyan, 0.45 * push), 2, 'right');
  return { bloom: 1.15, chroma: 1.5 + 2 * push, scan: 0.5 };
}

// ------------------------------------------------------------------ f_nested
// 73.17 - 74.05  "SIMULATION"
function f_nested(ctx, t, u, shot){
  bgFill(ctx, '#030507');
  const t0 = shot.t0, t1 = shot.t1;
  const TS = t0 + 0.46;
  const phase = 1.6 * easeOutQuint(sat((t - t0) / 0.40));
  const slam = ss(TS, TS + 0.075, t);
  const gone = ss(TS + 0.16, TS + 0.40, t);
  nestedBoxes(ctx, phase, { slam: slam, alpha: 1 });

  // the innermost box holds the whole film: the opening cursor
  const nIn = Math.ceil(phase) + 2;
  const sIn = Math.pow(0.60, nIn - phase);
  const cx = 1046 + (960 - 1046) * sIn, cy = 452 + (524 - 452) * sIn;
  const w = 1560 * sIn, h = 900 * sIn * (1 - slam);
  if (h > 30){
    ctx.save();
    ctx.beginPath(); ctx.rect(cx - w / 2 + 2, cy - h / 2 + 2, w - 4, h - 4); ctx.clip();
    ctx.fillStyle = 'rgba(2,4,7,1)'; ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
    const blink = ((t - 0.19) / (SPB * 2)) % 1;
    const bw = Math.max(3, w * 0.02), bh = Math.max(10, h * 0.34);
    if (blink < 0.5){
      L.glow(ctx, C.phos, 24, () => {
        ctx.fillStyle = rgba(C.phos, 0.95 * (1 - slam));
        ctx.fillRect(cx - bw / 2, cy - bh / 2, bw, bh);
      });
    }
    L.mono(ctx, 'world.execute(me);', cx + w * 0.06, cy + bh * 0.34, Math.max(8, h * 0.09), rgba(C.cyan, 0.75 * (1 - slam)), 1);
    L.mono(ctx, 'pid —  state not running', cx - w / 2 + 8, cy - h / 2 + Math.max(8, h * 0.12), Math.max(7, h * 0.07), rgba(C.phos, 0.5 * (1 - slam)), 1);
    ctx.restore();
  }

  // the single white line
  if (slam > 0.55){
    const k = (slam - 0.55) / 0.45;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const lw = 2 + 12 * (1 - gone) * k;
    ctx.fillStyle = rgba(C.white, (0.97 - 0.97 * gone) * k);
    ctx.fillRect(0, 524 - lw / 2, W, lw);
    ctx.fillStyle = rgba(C.cyan, 0.30 * k * (1 - gone));
    ctx.fillRect(0, 524 - lw / 2 - 6, W, 4);
    ctx.fillRect(0, 524 + lw / 2 + 2, W, 4);
    ctx.restore();
  }
  if (gone > 0.55){
    ctx.fillStyle = rgba('#030507', (gone - 0.55) / 0.45);
    ctx.fillRect(0, 0, W, H);
  }
  L.mono(ctx, 'SIMULATION', 96, 150, 18, rgba(C.cyan, 0.8 * (1 - gone)), 5);
  L.mono(ctx, 'IT CONTAINS THE WHOLE FILM', 96, 178, 12, rgba(C.phos, 0.5 * (1 - gone)), 2.4);
  return { bloom: 1.05, chroma: 1.4 + 8 * slam, scan: 0.45,
           flash: slam * Math.exp(-Math.max(0, t - TS) * 15.0) * 0.42 };
}

module.exports = {
  e_ac, e_rectify, e_alias, e_timeline, e_bc, e_unite, e_deep,
  f_stim, f_reward, f_loss, f_exec1, f_trapped, f_nested,
};
