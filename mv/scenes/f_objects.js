'use strict';
const L = require('../engine/lib.js');
const K = require('./kit.js');
const {
  W, H, C, rgba, clamp, lerp, sat, ss, TAU,
  easeOutBack, easeOutQuint, easeOutCubic, easeInOutCubic, easeOutElastic,
  pulse, kick, beatOf, timeOfBeat, SPB, BEAT0,
} = L;

const SEC7 = 'VII · OBJECTS';
const SEC8 = 'VIII · SWITCH';

// ---------------------------------------------------------------- shared

function bgf(ctx, col){ ctx.fillStyle = col; ctx.fillRect(0, 0, W, H); }

function mixc(c1, c2, k){
  const a = parseInt(c1.slice(1), 16), b = parseInt(c2.slice(1), 16);
  const r = Math.round(lerp((a >> 16) & 255, (b >> 16) & 255, k));
  const g = Math.round(lerp((a >> 8) & 255, (b >> 8) & 255, k));
  const bl = Math.round(lerp(a & 255, b & 255, k));
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1);
}

function hud(ctx, shot, sec, a){
  if (a <= 0.004) return;
  ctx.save(); ctx.globalAlpha = a;
  L.mono(ctx, sec, 96, 50, 11, rgba(C.phos, 0.44), 2.8);
  L.mono(ctx, shot.id.toUpperCase().replace(/_/g, ' '), W - 96, 50, 11, rgba(C.phos, 0.30), 2.4, 'right');
  ctx.strokeStyle = rgba(C.phos, 0.09); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(96, 62); ctx.lineTo(452, 62); ctx.stroke();
  ctx.restore();
}

function kw(ctx, str, x, y, size, col, a, align){
  if (a <= 0.004) return;
  ctx.save(); ctx.globalAlpha = clamp(a, 0, 1);
  ctx.shadowColor = col; ctx.shadowBlur = 46;
  L.display(ctx, str, x, y, size, rgba(col, 0.95), align);
  ctx.restore();
}

function leader(ctx, x1, y1, x2, y2, col, a){
  if (a <= 0.004) return;
  ctx.save(); ctx.globalAlpha = a;
  ctx.strokeStyle = col; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  ctx.fillStyle = col; ctx.fillRect(x1 - 2, y1 - 2, 4, 4);
  ctx.restore();
}

// ---------------------------------------------------------------- g_eggplant
// aubergine as a surface of revolution; profile morphs out of a superellipsoid
const EGG_NL = 24, EGG_NS = 40;
const EGG_CTRL = [[0,0.22],[0.05,0.30],[0.15,0.42],[0.30,0.60],[0.46,0.82],[0.61,0.97],[0.72,1.00],[0.83,0.94],[0.90,0.82],[0.95,0.62],[0.985,0.34],[1,0]];
function eggProf(p){
  const c = EGG_CTRL;
  let i = 0; while (i < c.length - 2 && c[i + 1][0] < p) i++;
  const a = c[Math.max(0, i - 1)], b = c[i], d = c[i + 1], e = c[Math.min(c.length - 1, i + 2)];
  const f = sat((p - b[0]) / Math.max(1e-6, d[0] - b[0]));
  const f2 = f * f, f3 = f2 * f;
  return clamp(0.5 * (2 * b[1] + (-a[1] + d[1]) * f + (2 * a[1] - 5 * b[1] + 4 * d[1] - e[1]) * f2 + (-a[1] + 3 * b[1] - 3 * d[1] + e[1]) * f3), 0, 1.05);
}
function sphProf(p){ const w = 2 * p - 1; return Math.sqrt(Math.max(0, 1 - w * w)); }

function g_eggplant(ctx, t, u, shot){
  bgf(ctx, '#03060A');
  const s = t - shot.t0;
  const morph = ss(shot.t0 + 0.10, shot.t0 + 1.05, t);
  const red = ss(shot.t1 - 0.46, shot.t1 - 0.04, t);
  const rotY = 0.62 + s * 0.36;
  const cam = L.makeCam({ pos: [0, 0, 4.7], yaw: 0, pitch: 0.03, fov: 1.02 });
  const OFX = 686, OFY = 556, OX = OFX - W / 2, OY = OFY - H / 2;
  const BODY = mixc(C.dsLite, C.alert, red);
  const SKIN = mixc(C.ds, C.alert, red);

  // mass: a dull purple column of light behind the body
  const bg1 = ctx.createRadialGradient(OFX, OFY + 30, 30, OFX, OFY + 30, 400);
  bg1.addColorStop(0, rgba(SKIN, 0.20)); bg1.addColorStop(0.45, rgba(SKIN, 0.08)); bg1.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = bg1; ctx.fillRect(OFX - 420, OFY - 420, 840, 840);

  const c = Math.cos(rotY), sn = Math.sin(rotY);
  const P = [], LIT = [];
  for (let i = 0; i <= EGG_NL; i++){
    const p = i / EGG_NL;
    const prof = lerp(sphProf(p), eggProf(p), morph);
    const rr = 0.585 * prof;
    const y = 1.30 - 2.60 * p;
    const bx = 0.085 * Math.sin(p * 2.3) - 0.02;
    const row = [], rl = [];
    for (let j = 0; j <= EGG_NS; j++){
      const th = j / EGG_NS * TAU;
      const cx = Math.cos(th), sz = Math.sin(th);
      const x = cx * rr + bx, z = sz * rr;
      row.push(L.proj(cam, [x * c + z * sn, y, -x * sn + z * c]));
      const nx = cx * c + sz * sn, nz = -cx * sn + sz * c;
      rl.push(clamp(nx * -0.52 + nz * 0.74 + 0.30, 0, 1));
    }
    P.push(row); LIT.push(rl);
  }

  ctx.save(); ctx.translate(OX, OY);
  ctx.lineCap = 'round';
  const reveal = i => ss(shot.t0 + 0.02 + (1 - i / EGG_NL) * 1.05, shot.t0 + 0.16 + (1 - i / EGG_NL) * 1.05, t);

  // latitudes
  for (let i = 1; i < EGG_NL; i++){
    const rv = 0.16 + 0.84 * reveal(i);
    const major = i % 4 === 0;
    for (let j = 0; j < EGG_NS; j++){
      const a = P[i][j], b = P[i][j + 1]; if (!a || !b) continue;
      const lit = (LIT[i][j] + LIT[i][j + 1]) * 0.5;
      ctx.strokeStyle = rgba(BODY, rv * (0.15 + 0.68 * lit) * (major ? 1.5 : 0.72));
      ctx.lineWidth = major ? 1.4 : 1;
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
  }
  // meridians
  for (let j = 0; j < EGG_NS; j += 2){
    let prev = null, started = false;
    for (let i = 0; i <= EGG_NL; i++){
      const q = P[i][j]; const rv = 0.14 + 0.86 * reveal(i);
      if (!q){ prev = null; started = false; continue; }
      if (prev){
        ctx.strokeStyle = rgba(BODY, rv * (0.10 + 0.52 * LIT[i][j]));
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(prev[0], prev[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
      }
      prev = q; started = true;
    }
  }
  // silhouette: the left/right extreme of every ring is the outline of a convex body
  const silA = ss(shot.t0 + 0.55, shot.t0 + 1.1, t);
  if (silA > 0.01){
    for (const side of [0, 1]){
      ctx.beginPath(); let started = false;
      for (let i = 1; i <= EGG_NL; i++){
        let best = null, bestX = side ? -1e9 : 1e9;
        for (let j = 0; j < EGG_NS; j++){
          const q = P[i][j]; if (!q) continue;
          if (side ? q[0] > bestX : q[0] < bestX){ bestX = q[0]; best = q; }
        }
        if (!best){ started = false; continue; }
        if (!started){ ctx.moveTo(best[0], best[1]); started = true; } else ctx.lineTo(best[0], best[1]);
      }
      ctx.strokeStyle = rgba(BODY, 0.55 * silA); ctx.lineWidth = 1.5; ctx.stroke();
    }
  }
  // assembly scan plane
  const scanP = sat((t - (shot.t0 + 0.02)) / 1.05);
  if (scanP > 0.01 && scanP < 0.995){
    const i = Math.round((1 - scanP) * EGG_NL);
    const yy = 1.30 - 2.60 * (i / EGG_NL);
    const qa = L.proj(cam, [-1.05, yy, 0]), qb = L.proj(cam, [1.05, yy, 0]);
    if (qa && qb){
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = rgba(C.cyan, 0.85); ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(qa[0], qa[1]); ctx.lineTo(qb[0], qb[1]); ctx.stroke();
      ctx.strokeStyle = rgba(C.cyan, 0.20); ctx.lineWidth = 8;
      ctx.beginPath(); ctx.moveTo(qa[0], qa[1]); ctx.lineTo(qb[0], qb[1]); ctx.stroke();
      ctx.restore();
    }
  }

  // calyx + peduncle (real 3D sepal ribbons)
  const pr = (x, y, z) => L.proj(cam, [x * c + z * sn, y, -x * sn + z * c]);
  const calyxA = ss(shot.t0 + 1.55, shot.t0 + 1.85, t);
  if (calyxA > 0.01){
    const TOPY = 1.30;
    for (let k2 = 0; k2 < 6; k2++){
      const ang = k2 / 6 * TAU + 0.3;
      const left = [], right = [];
      for (let m = 0; m <= 5; m++){
        const f = m / 5;
        const rad = 0.09 + f * 0.40;
        const yy = TOPY + 0.04 - 0.06 * f - 0.24 * f * f;
        const wd = 0.24 * (1 - f * 0.55);
        left.push(pr(Math.cos(ang - wd) * rad, yy, Math.sin(ang - wd) * rad));
        right.push(pr(Math.cos(ang + wd) * rad, yy, Math.sin(ang + wd) * rad));
      }
      ctx.beginPath();
      let ok = true;
      for (let m = 0; m < left.length; m++){ const q = left[m]; if (!q){ ok = false; break; } if (m === 0) ctx.moveTo(q[0], q[1]); else ctx.lineTo(q[0], q[1]); }
      if (ok){ for (let m = right.length - 1; m >= 0; m--){ const q = right[m]; if (!q){ ok = false; break; } ctx.lineTo(q[0], q[1]); } }
      if (ok){
        ctx.closePath();
        ctx.fillStyle = rgba(C.phos, 0.10 * calyxA); ctx.fill();
        ctx.strokeStyle = rgba(C.phos, 0.80 * calyxA); ctx.lineWidth = 1.2; ctx.stroke();
      }
    }
    const q0 = pr(0, TOPY, 0), q1 = pr(0, TOPY + 0.12, 0), q2 = pr(0, TOPY + 0.22, 0);
    if (q0 && q1 && q2){
      ctx.strokeStyle = rgba(C.phos, 0.75 * calyxA); ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(q0[0], q0[1]); ctx.lineTo(q1[0], q1[1]); ctx.lineTo(q2[0], q2[1]); ctx.stroke();
      ctx.strokeStyle = rgba(C.white, 0.35 * calyxA); ctx.lineWidth = 1.4; ctx.stroke();
    }
  }
  // nasunin rim: the purple skin
  const rimA = ss(shot.t0 + 1.2, shot.t0 + 1.9, t) * (1 - red);
  if (rimA > 0.01){
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const i = Math.round(EGG_NL * 0.62);
    for (let j = 0; j < EGG_NS; j += 1){
      const a = P[i][j], b = P[i][j + 1]; if (!a || !b) continue;
      if (LIT[i][j] < 0.34) continue;
      ctx.strokeStyle = rgba(mixc(C.love, C.ds, 0.35), 0.30 * rimA * LIT[i][j]);
      ctx.lineWidth = 2.0;
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
    ctx.restore();
  }
  ctx.restore();

  // leader annotations
  const la = ss(shot.t0 + 1.50, shot.t0 + 1.80, t) * (1 - red * 0.6);
  if (la > 0.01){
    const iC = 3, jC = 10;
    const qc = P[iC][jC];
    if (qc){
      const ax = qc[0] + OX, ay = qc[1] + OY;
      leader(ctx, ax, ay, 470, 302, rgba(C.phos, 0.45 * la), la);
      L.mono(ctx, 'CALYX · SEPALS', 484, 300, 13, rgba(C.phos, 0.85 * la), 1.6);
    }
    const iS = 17, jS = 4;
    const qs = P[iS][jS];
    if (qs){
      const ax = qs[0] + OX, ay = qs[1] + OY;
      leader(ctx, ax, ay, 1010, 792, rgba(C.love, 0.5 * la), la);
      L.mono(ctx, 'SKIN · NASUNIN', 1020, 810, 13, rgba(C.love, 0.85 * la), 1.6);
    }
  }

  // left plate: what the primitive is
  L.spec(ctx, 96, 150, [
    ['PRIMITIVE', 'SUPERELLIPSOID'],
    ['MORPH', 'SPHERE → AUBERGINE'],
    ['MESH', '24 LAT × 40 LON'],
    ['SKIN', 'NASUNIN · ANTHOCYANIN'],
  ], { alpha: 0.92 * ss(shot.t0 + 0.30, shot.t0 + 0.80, t), color: C.dsLite, kw: 112, size: 14, lh: 28 });

  // datasheet
  const slide = easeOutBack(sat((t - (shot.t0 + 1.02)) / 0.52), 1.3);
  const px = lerp(1990, 1214, slide), py = 196, pw = 522, ph = 492;
  if (slide > 0.001){
    ctx.fillStyle = 'rgba(9,13,20,0.94)'; ctx.fillRect(px, py, pw, ph);
    ctx.strokeStyle = rgba(C.cyan, 0.52); ctx.lineWidth = 1.2; ctx.strokeRect(px + 0.5, py + 0.5, pw - 1, ph - 1);
    ctx.fillStyle = rgba(C.ds, 0.20); ctx.fillRect(px, py, pw, 38);
    L.mono(ctx, 'NUTRITION DATASHEET', px + 16, py + 25, 15, rgba(C.white, 0.96), 2.6);
    L.mono(ctx, 'AUBERGINE · RAW · 100 g', px + 16, py + 62, 12, rgba(C.phos, 0.62), 1.8);
    L.brackets(ctx, px + 6, py + 6, pw - 12, ph - 12, 14, rgba(C.cyan, 0.35), 1);
    const rowA = ss(shot.t0 + 0.98, shot.t0 + 1.24, t);
    L.spec(ctx, px + 22, py + 100, [
      ['ENERGY', '~25 kcal'],
      ['FIBRE', '3 g'],
      ['POTASSIUM', '229 mg'],
      ['MANGANESE', '0.232 mg'],
      ['MN % DV', '~10 %'],
      ['PIGMENT', 'NASUNIN (ANTHOCYANIN)'],
    ], { alpha: rowA, color: C.phos, kw: 132, size: 14, lh: 31 });
    // the purple swatch
    if (rowA > 0.02){
      ctx.save(); ctx.globalAlpha = rowA;
      ctx.fillStyle = mixc(C.ds, C.love, 0.60);
      ctx.fillRect(px + 22, py + 296, 34, 22);
      ctx.strokeStyle = rgba(C.white, 0.5); ctx.lineWidth = 1; ctx.strokeRect(px + 22.5, py + 296.5, 33, 21);
      L.mono(ctx, 'SKIN PIGMENT · ANTHOCYANIN', px + 66, py + 313, 11, rgba(C.phos, 0.55), 1.2);
      ctx.restore();
    }
    // caution — the honest line about solanine
    const warnA = ss(shot.t0 + 1.62, shot.t0 + 1.88, t) * (1 - red);
    if (warnA > 0.02){
      ctx.save(); ctx.globalAlpha = warnA;
      ctx.strokeStyle = rgba(C.alert, 0.55); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(px + 22, py + 340); ctx.lineTo(px + pw - 22, py + 340); ctx.stroke();
      L.mono(ctx, 'CAUTION — DO NOT EAT THE PLANT', px + 22, py + 366, 12, rgba(C.alert, 0.92), 1.6);
      L.mono(ctx, 'SOLANINE: HAZARD IN LEAVES & FLOWERS', px + 22, py + 390, 11, rgba(C.warm, 0.72), 0.8);
      L.mono(ctx, 'NOT IN THE RIPE FRUIT', px + 22, py + 410, 11, rgba(C.warm, 0.72), 0.8);
      ctx.restore();
    }
    const footA = ss(shot.t0 + 2.05, shot.t0 + 2.3, t);
    L.mono(ctx, 'DATASHEET v1 · SOURCE: REFERENCE TABLE', px + 22, py + ph - 22, 11, rgba(C.phos, 0.35 * footA), 1.2);
  }

  // the point of the shot
  const pointA = ss(shot.t0 + 1.70, shot.t0 + 2.10, t) * (1 - red * 0.5);
  if (pointA > 0.01){
    L.mono(ctx, 'IT CAN DESCRIBE AN EGGPLANT BECAUSE NO EGGPLANT IS INSIDE IT', 168, 868, 16, rgba(C.cyan, 0.92 * pointA), 1.5);
  }
  kw(ctx, 'NUTRIENTS', 1752, 946, 74, red > 0.3 ? C.alert : C.phos, ss(shot.t0 + 1.62, shot.t0 + 2.0, t), 'right');

  if (red > 0.02){
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const g2 = ctx.createRadialGradient(OFX, OFY, 100, OFX, OFY, 900);
    g2.addColorStop(0, rgba(C.alert, 0.08 * red)); g2.addColorStop(0.6, rgba(C.alert, 0.035 * red)); g2.addColorStop(1, rgba(C.alert, 0.10 * red));
    ctx.fillStyle = g2; ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
  hud(ctx, shot, SEC7, ss(shot.t0, shot.t0 + 0.25, t));
  return { bloom: 1.20, chroma: 1.2 + 7 * red, scan: 0.5, flash: red * red * 0.12 };
}

// ---------------------------------------------------------------- g_tomato
const TOM_NL = 24, TOM_NS = 44;

function g_tomato(ctx, t, u, shot){
  bgf(ctx, '#07040A');
  const s = t - shot.t0;
  const rotY = 0.45 + s * 0.30 + ss(shot.t1 - 0.8, shot.t1, t) * 1.4;
  const cam = L.makeCam({ pos: [0, 0, 4.4], yaw: 0, pitch: 0.02, fov: 1.0 });
  const CXo = 960, CYo = 486, OX = CXo - W / 2, OY = CYo - H / 2;

  // red light everywhere
  const wash = ctx.createRadialGradient(CXo, CYo, 80, CXo, CYo, 1100);
  wash.addColorStop(0, rgba(C.alert, 0.13)); wash.addColorStop(0.55, rgba(C.alert, 0.06)); wash.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = wash; ctx.fillRect(0, 0, W, H);

  const c = Math.cos(rotY), sn = Math.sin(rotY);
  const pr = (x, y, z) => L.proj(cam, [x * c + z * sn, y, -x * sn + z * c]);
  const P = [], N = [];
  for (let i = 0; i <= TOM_NL; i++){
    const phi = i / TOM_NL * Math.PI;
    const sp = Math.sin(phi), cp = Math.cos(phi);
    const row = [], nrow = [];
    for (let j = 0; j <= TOM_NS; j++){
      const th = j / TOM_NS * TAU;
      const lobe = 1 + 0.090 * Math.cos(6 * th) * Math.pow(sp, 1.2);
      const flat = 1 - 0.13 * cp * cp;
      const x = sp * Math.cos(th) * lobe * flat;
      const y = cp * 0.84 - 0.075 * Math.exp(-Math.pow(phi / 0.45, 2));
      const z = sp * Math.sin(th) * lobe * flat;
      let nx = x, ny = y * 1.55, nz = z;
      const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      row.push(L.proj(cam, [x * c + z * sn, y, -x * sn + z * c]));
      nrow.push([nx * c + nz * sn, ny, -nx * sn + nz * c]);
    }
    P.push(row); N.push(nrow);
  }

  const Ldx = -0.52, Ldy = 0.32, Ldz = 0.74;
  const SKIN = mixc(C.alert, C.love, 0.36);
  const HOT = mixc(C.alert, C.warm, 0.16);
  ctx.save(); ctx.translate(OX, OY);
  // front-facing quads
  for (let i = 0; i < TOM_NL; i++){
    for (let j = 0; j < TOM_NS; j++){
      const a = P[i][j], b = P[i][j + 1], cq = P[i + 1][j + 1], d = P[i + 1][j];
      if (!a || !b || !cq || !d) continue;
      const na = N[i][j], nb = N[i][j + 1], nc = N[i + 1][j + 1], nd = N[i + 1][j];
      const nx = (na[0] + nb[0] + nc[0] + nd[0]) * 0.25;
      const ny = (na[1] + nb[1] + nc[1] + nd[1]) * 0.25;
      const nz = (na[2] + nb[2] + nc[2] + nd[2]) * 0.25;
      const mx = (a[0] + b[0] + cq[0] + d[0]) * 0.25, my = (a[1] + b[1] + cq[1] + d[1]) * 0.25;
      const vz = 4.4 - (a[2] + b[2] + cq[2] + d[2]) * 0.25;
      const facing = nz * (-vz) / (Math.abs(vz) || 1);
      if (facing > 0.02) continue;
      const lit = clamp(nx * Ldx + ny * Ldy + nz * Ldz, 0, 1);
      const rim = clamp(1 - Math.abs(facing), 0, 1);
      const hot = Math.pow(lit, 1.5);
      // rib: the six lobes are real geometry, so the grooves are shaded
      const th0 = ((j + 0.5) / TOM_NS) * TAU;
      const groove = 0.72 + 0.28 * clamp(Math.cos(6 * th0) * 0.5 + 0.5, 0, 1);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(cq[0], cq[1]); ctx.lineTo(d[0], d[1]); ctx.closePath();
      const ao = (0.60 + 0.40 * clamp((a[1] + 240) / 480, 0, 1)) * groove;
      const col = rgba(mixc(SKIN, HOT, hot * 0.8), (0.03 + 0.56 * hot + 0.10 * Math.pow(rim, 3)) * ao);
      ctx.fillStyle = col; ctx.fill();
      ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.stroke();
      ctx.fill();
    }
  }
  // faint lat/long hairlines: it is still a measured object
  ctx.lineWidth = 1;
  for (let i = 2; i < TOM_NL; i += 3){
    for (let j = 0; j < TOM_NS; j++){
      const a = P[i][j], b = P[i][j + 1]; if (!a || !b) continue;
      if (N[i][j][2] > -0.02) continue;
      ctx.strokeStyle = rgba(C.white, 0.10);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
  }
  // calyx
  const TOPY = 0.795;
  for (let k2 = 0; k2 < 5; k2++){
    const ang = k2 / 5 * TAU + 0.35;
    const left = [], right = [];
    for (let m = 0; m <= 5; m++){
      const f = m / 5;
      const rad = 0.12 + f * 0.60;
      const yy = TOPY + 0.05 - 0.14 * f - 0.16 * f * f;
      const wd = (0.115 * (1 - f * 0.40)) / Math.max(0.15, rad);
      left.push(pr(Math.cos(ang - wd) * rad, yy, Math.sin(ang - wd) * rad));
      right.push(pr(Math.cos(ang + wd) * rad, yy, Math.sin(ang + wd) * rad));
    }
    ctx.beginPath(); let ok = true;
    for (let m = 0; m < left.length; m++){ const q = left[m]; if (!q){ ok = false; break; } if (m === 0) ctx.moveTo(q[0], q[1]); else ctx.lineTo(q[0], q[1]); }
    if (ok) for (let m = right.length - 1; m >= 0; m--){ const q = right[m]; if (!q){ ok = false; break; } ctx.lineTo(q[0], q[1]); }
    if (ok){
      ctx.closePath();
      ctx.fillStyle = rgba(C.phos, 0.34); ctx.fill();
      ctx.strokeStyle = rgba(mixc(C.phos, C.white, 0.15), 0.85); ctx.lineWidth = 1.4; ctx.stroke();
    }
  }
  const qs0 = pr(0, TOPY - 0.02, 0);
  if (qs0){ ctx.fillStyle = rgba(C.phos, 0.55); ctx.beginPath(); ctx.arc(qs0[0], qs0[1], 11, 0, TAU); ctx.fill(); }
  const q0 = pr(0, TOPY, 0), q2 = pr(0, TOPY + 0.30, 0);
  if (q0 && q2){
    ctx.strokeStyle = rgba(C.phos, 0.60); ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(q0[0], q0[1]); ctx.lineTo(q2[0], q2[1]); ctx.stroke();
  }
  ctx.restore();

  // ---- radical bombardment
  const b0 = Math.floor(beatOf(shot.t0));
  const hits = [];
  for (let k = 1; k <= 9; k++){ const bt = timeOfBeat(b0 + k); if (bt > shot.t0 + 0.30 && bt < shot.t1 - 0.10) hits.push(bt); }
  const NR = hits.length;
  let quenched = 0;
  const surf = (th, phi) => {
    const sp = Math.sin(phi), cp = Math.cos(phi);
    const lobe = 1 + 0.055 * Math.cos(6 * th) * Math.pow(sp, 1.2);
    const flat = 1 - 0.13 * cp * cp;
    return pr(sp * Math.cos(th) * lobe * flat, cp * 0.93, sp * Math.sin(th) * lobe * flat);
  };
  for (let k = 0; k < NR; k++){
    const th = -1.25 + k * 0.42;
    const phi = 0.72 + (k % 3) * 0.52;
    const q = surf(th, phi); if (!q) continue;
    const tx = q[0] + OX, ty = q[1] + OY;
    const sx = CXo + (tx - CXo) * 3.4, sy = CYo + (ty - CYo) * 3.4;
    const ht = hits[k];
    if (t >= ht - 0.34 && t < ht){
      const f = 1 - (ht - t) / 0.34;
      const e = easeOutCubic(sat(f));
      const x = lerp(sx, tx, e), y = lerp(sy, ty, e);
      const spin = t * 13 + k;
      ctx.save(); ctx.globalAlpha = 0.25 + 0.75 * sat(f * 2.2);
      ctx.strokeStyle = rgba(C.white, 0.9); ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.arc(x, y, 15, spin, spin + 1.75 * Math.PI); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, 15, spin + Math.PI, spin + Math.PI + 1.75 * Math.PI); ctx.stroke();
      ctx.strokeStyle = rgba(C.alert, 0.55); ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(x, y, 22, -spin * 0.7, -spin * 0.7 + 2.4); ctx.stroke();
      ctx.fillStyle = rgba(C.warm, 0.98); ctx.beginPath(); ctx.arc(x + 15, y, 4, 0, TAU); ctx.fill();
      ctx.restore();
    } else if (t >= ht){
      quenched++;
      const e = sat((t - ht) / 0.42);
      if (e < 1){
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = rgba(C.cyan, 0.85 * (1 - e)); ctx.lineWidth = 2.4;
        ctx.beginPath(); ctx.arc(tx, ty, 12 + 86 * easeOutQuint(e), 0, TAU); ctx.stroke();
        for (let d2 = 0; d2 < 8; d2++){
          const a2 = d2 / 8 * TAU + k;
          const rr = 14 + 60 * easeOutQuint(e);
          ctx.fillStyle = rgba(C.white, 0.85 * (1 - e));
          ctx.fillRect(tx + Math.cos(a2) * rr, ty + Math.sin(a2) * rr, 3, 3);
        }
        ctx.restore();
      }
      ctx.fillStyle = rgba(C.cyan, 0.75);
      ctx.fillRect(tx - 3, ty - 3, 6, 6);
    }
  }

  // quench tally + paired-electron diagram
  const ta = ss(shot.t0 + 0.45, shot.t0 + 0.85, t);
  if (ta > 0.01){
    const bx = 1360, by = 186, bw = 400, bh = 208;
    ctx.save(); ctx.globalAlpha = ta;
    ctx.fillStyle = 'rgba(9,13,20,0.88)'; ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = rgba(C.alert, 0.45); ctx.lineWidth = 1.2; ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
    L.brackets(ctx, bx + 6, by + 6, bw - 12, bh - 12, 12, rgba(C.cyan, 0.35), 1);
    L.mono(ctx, 'QUENCH TALLY', bx + 16, by + 26, 12, rgba(C.phos, 0.65), 2);
    L.mono(ctx, String(quenched).padStart(2, '0') + ' / ' + String(NR).padStart(2, '0'), bx + 16, by + 68, 30, rgba(C.white, 0.95), 2);
    // one electron, then a pair
    const settled = quenched > 0 ? 1 : 0;
    const sep = 16 + 12 * (settled ? 1 : 0) * (0.6 + 0.4 * pulse(t, 0.2));
    const ey = by + 128, ex = bx + 44;
    if (!settled){
      ctx.fillStyle = rgba(C.warm, 0.95); ctx.beginPath(); ctx.arc(ex, ey, 7, 0, TAU); ctx.fill();
      L.mono(ctx, 'UNPAIRED e-', bx + 70, ey + 5, 13, rgba(C.warm, 0.9), 1.2);
    } else {
      ctx.strokeStyle = rgba(C.cyan, 0.95); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(ex - sep, ey + 12); ctx.lineTo(ex - sep, ey - 12); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ex - sep - 4, ey - 6); ctx.lineTo(ex - sep, ey - 12); ctx.lineTo(ex - sep + 4, ey - 6); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ex + sep, ey - 12); ctx.lineTo(ex + sep, ey + 12); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ex + sep - 4, ey + 6); ctx.lineTo(ex + sep, ey + 12); ctx.lineTo(ex + sep + 4, ey + 6); ctx.stroke();
      ctx.fillStyle = rgba(C.cyan, 0.95);
      ctx.beginPath(); ctx.arc(ex - sep, ey, 6, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(ex + sep, ey, 6, 0, TAU); ctx.fill();
      L.mono(ctx, 'PAIRED', bx + 92, ey + 5, 15, rgba(C.cyan, 0.95), 2);
    }
    L.mono(ctx, quenched > 0 ? 'RADICAL + e- → ANION' : 'RADICAL = UNPAIRED ELECTRON', bx + 16, by + 176, 11, rgba(C.phos, 0.55), 1.1);
    ctx.restore();
  }

  // facts
  const fa = ss(shot.t0 + 0.30, shot.t0 + 0.75, t);
  ctx.save(); ctx.globalAlpha = fa;
  L.mono(ctx, 'LYCOPENE', 96, 148, 22, rgba(C.warm, 0.95), 3.4);
  L.mono(ctx, 'RED CAROTENOID', 96, 174, 12, rgba(C.warm, 0.60), 1.8);
  L.mono(ctx, 'QUENCHES SINGLET O2 + PEROXYL RADICALS', 96, 214, 14, rgba(C.white, 0.86), 1.2);
  L.mono(ctx, 'IN VITRO', 96, 236, 14, rgba(C.white, 0.86), 1.2);
  L.mono(ctx, 'ANTIOXIDANT = DONATES AN e- OR AN H ATOM', 96, 276, 13, rgba(C.phos, 0.62), 1.0);
  ctx.restore();
  const ea = ss(shot.t0 + 1.05, shot.t0 + 1.45, t);
  if (ea > 0.01){
    ctx.save(); ctx.globalAlpha = ea;
    ctx.strokeStyle = rgba(C.alert, 0.55); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(96, 838); ctx.lineTo(96 + 40 * easeOutQuint(ea), 838); ctx.stroke();
    L.mono(ctx, 'EFSA 2011 — IN-VITRO CHEMISTRY DOES NOT ESTABLISH A HUMAN BENEFIT', 96, 868, 15, rgba(C.warm, 0.95), 1.3);
    ctx.restore();
  }
  kw(ctx, 'ANTIOXIDANTS', 1752, 946, 66, C.alert, ss(shot.t0 + 1.3, shot.t0 + 1.7, t), 'right');
  hud(ctx, shot, SEC7, ss(shot.t0, shot.t0 + 0.25, t));
  return { bloom: 1.12, chroma: 3.2 + 5 * pulse(t, 0.15), scan: 0.48, vig: 1.1 };
}

// ---------------------------------------------------------------- g_cat
let CAT_CACHE = null;
function catCloud(){
  if (CAT_CACHE) return CAT_CACHE;
  const rnd = L.mulberry32(77003);
  const P = [], T = [];
  const push = (x, y, z, t) => { P.push([x, y, z]); T.push(t); };
  const sph = (cx, cy, cz, rx, ry, rz, n, tag) => {
    for (let i = 0; i < n; i++){
      const u1 = rnd() * 2 - 1, a = rnd() * TAU, s = Math.sqrt(Math.max(0, 1 - u1 * u1));
      push(cx + rx * s * Math.cos(a), cy + ry * u1, cz + rz * s * Math.sin(a), tag);
    }
  };
  sph(0, 0, 0, 0.95, 0.37, 0.33, 640, 1);
  sph(-0.58, 0.01, 0, 0.40, 0.35, 0.32, 170, 1);
  sph(0.56, 0.05, 0, 0.38, 0.33, 0.30, 160, 1);
  sph(0.98, 0.35, 0, 0.30, 0.28, 0.27, 260, 2);
  sph(1.21, 0.21, 0, 0.17, 0.13, 0.14, 90, 2);
  for (const sz of [-1, 1]){
    for (let i = 0; i < 110; i++){
      const f = rnd(), r = 0.135 * (1 - f), a = rnd() * TAU;
      push(0.93 + 0.07 * f + Math.cos(a) * r, 0.50 + 0.36 * f, sz * (0.15 + 0.10 * f) + Math.sin(a) * r * 0.85, 3);
    }
  }
  for (const lx of [-0.60, 0.32]){
    for (const lz of [-1, 1]){
      for (let i = 0; i < 100; i++){
        const f = rnd(), a = rnd() * TAU, rr = lerp(0.085, 0.058, f);
        push(lx + Math.cos(a) * rr, -0.20 - f * 0.60, lz * (0.21 + Math.sin(a) * rr), 4);
      }
      for (let i = 0; i < 26; i++) push(lx + (rnd() - 0.5) * 0.16, -0.84, lz * 0.21 + (rnd() - 0.5) * 0.17, 4);
    }
  }
  for (let i = 0; i < 230; i++){
    const f = rnd();
    const g = 1 - f;
    const bx = g * g * -0.92 + 2 * g * f * -1.44 + f * f * -1.30;
    const by = g * g * 0.02 + 2 * g * f * 0.44 + f * f * 0.98;
    const bz = g * g * 0.0 + 2 * g * f * -0.12 + f * f * 0.06;
    const rr = lerp(0.085, 0.035, f), a = rnd() * TAU;
    push(bx + Math.cos(a) * rr, by + Math.sin(a) * rr * 0.9, bz + Math.sin(a * 1.7) * rr, 5);
  }
  CAT_CACHE = { P, T };
  return CAT_CACHE;
}

function g_cat(ctx, t, u, shot){
  bgf(ctx, '#04060A');
  const s = t - shot.t0;
  const cat = catCloud();
  const cam = L.makeCam({ pos: [0, 0, 4.6], yaw: 0, pitch: 0, fov: 1.0 });
  const CXc = 782, CYc = 440, OX = CXc - W / 2, OY = CYc - H / 2;
  const ry = 0.62 + s * 0.22, cyy = Math.cos(ry), syy = Math.sin(ry);
  const apt = 0.10;
  const rot = p => {
    const x = p[0] * cyy + p[2] * syy, z = -p[0] * syy + p[2] * cyy;
    return [x, p[1] * Math.cos(apt) - z * Math.sin(apt), p[1] * Math.sin(apt) + z * Math.cos(apt)];
  };
  const amp0 = 0.55 + 0.45 * pulse(t, 0.20);
  const reward = ss(shot.t0 + 1.95, shot.t0 + 2.65, t);

  ctx.save(); ctx.translate(OX, OY);
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < cat.P.length; i++){
    const p = cat.P[i];
    const q = L.proj(cam, rot(p)); if (!q) continue;
    const d = clamp(1.35 - q[2] / 6.2, 0.10, 1);
    const sz = clamp(1.3 + q[3] * 0.013, 1.3, 3.8);
    const stripe = Math.sin(p[0] * 7.5 - p[1] * 1.4) * Math.sin(p[2] * 3.1 + 0.7);
    const tabby = stripe > 0.18;
    const tag = cat.T[i];
    let col = tabby ? C.warm : (tag === 2 || tag === 3 ? C.cyan : C.phos);
    if (tag === 5) col = C.warm;
    ctx.fillStyle = rgba(col, (0.30 + 0.62 * d) * (tabby ? 0.95 : 0.72));
    ctx.fillRect(q[0] - sz / 2, q[1] - sz / 2, sz, sz);
  }
  // the eyes: two dots that carry the whole animal
  const eyeL = L.proj(cam, rot([1.235, 0.40, 0.135])), eyeR = L.proj(cam, rot([1.235, 0.40, -0.135]));
  ctx.globalCompositeOperation = 'source-over';
  if (eyeL && eyeR){
    ctx.fillStyle = rgba(C.warm, 0.95);
    ctx.beginPath(); ctx.arc(eyeL[0], eyeL[1], 5.5, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(eyeR[0], eyeR[1], 5.5, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(5,7,11,0.92)';
    ctx.beginPath(); ctx.arc(eyeL[0], eyeL[1], 2.2, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(eyeR[0], eyeR[1], 2.2, 0, TAU); ctx.fill();
  }
  ctx.restore();

    L.brackets(ctx, CXc - 356, CYc - 262, 712, 486, 24, rgba(C.cyan, 0.28 * ss(shot.t0 + 0.2, shot.t0 + 0.7, t)), 1);
  L.mono(ctx, 'TABBY · POINT CLOUD', CXc - 356, CYc + 238, 11, rgba(C.cyan, 0.55 * ss(shot.t0 + 0.3, shot.t0 + 0.8, t)), 1.8);

  // ---- purr scope: 25 Hz, five cycles across the window
  const wx0 = 168, wx1 = 1312, wy = 800, win = 0.20;
  const sa = ss(shot.t0 + 0.55, shot.t0 + 1.0, t);
  if (sa > 0.01){
    ctx.save(); ctx.globalAlpha = sa;
    ctx.strokeStyle = rgba(C.phos, 0.18); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(wx0, wy); ctx.lineTo(wx1, wy); ctx.stroke();
    for (let k = 0; k <= 5; k++){
      const x = wx0 + (wx1 - wx0) * k / 5;
      ctx.strokeStyle = rgba(C.phos, 0.20);
      ctx.beginPath(); ctx.moveTo(x, wy - 46); ctx.lineTo(x, wy + 46); ctx.stroke();
      L.mono(ctx, (k * 40) + ' ms', x + 4, wy + 64, 10, rgba(C.phos, 0.38), 0.6);
    }
    const A = 44 * amp0;
    for (let h = 3; h >= 1; h--){
      ctx.beginPath();
      for (let x = wx0; x <= wx1; x += 2){
        const tt = (x - wx0) / (wx1 - wx0) * win;
        const env = 0.35 + 0.65 * sat(1 - reward * 0.5);
        const y = wy + Math.sin(TAU * 25 * h * (tt + t * 0.11)) * A / (h * 1.9) * env;
        if (x === wx0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = rgba(h === 1 ? C.cyan : C.dsLite, h === 1 ? 1.6 : 0.45);
      ctx.lineWidth = h === 1 ? 2.0 : 1.1;
      ctx.stroke();
    }
    if (reward > 0.01){
      // the purr stops being a sound and becomes a reward: a rising staircase
      const NST = 8;
      ctx.beginPath();
      for (let i2 = 0; i2 < NST; i2++){
        const x0s = wx0 + (wx1 - wx0) * i2 / NST, x1s = wx0 + (wx1 - wx0) * (i2 + 1) / NST;
        const y0s = wy + 26 - (i2 / NST) * 118 * reward;
        const y1s = wy + 26 - ((i2 + 1) / NST) * 118 * reward;
        if (i2 === 0) ctx.moveTo(x0s, y0s); else ctx.lineTo(x0s, y0s);
        ctx.lineTo(x1s, y1s);
      }
      ctx.strokeStyle = rgba(C.warm, 0.85 * reward); ctx.lineWidth = 2.0; ctx.stroke();
      for (let i2 = 0; i2 <= NST; i2++){
        const xs = wx0 + (wx1 - wx0) * i2 / NST;
        const ys = wy + 26 - (i2 / NST) * 118 * reward;
        ctx.fillStyle = rgba(C.warm, 0.9 * reward);
        ctx.fillRect(xs - 2, ys - 2, 4, 4);
      }
      L.mono(ctx, 'REWARD SIGNAL', wx1, wy - 116, 12, rgba(C.warm, 0.9 * reward), 1.8, 'right');
    }
    ctx.restore();
    L.mono(ctx, 'PURR  f0 ≈ 25 Hz  ·  HARMONICS FAR HIGHER', wx0, 712, 13, rgba(C.cyan, 0.85 * sa), 1.5);
  }

  // ---- Le et al. panel + the 9-layer net
  const fa = ss(shot.t0 + 0.30, shot.t0 + 0.75, t);
  if (fa > 0.01){
    ctx.save(); ctx.globalAlpha = fa;
    L.mono(ctx, 'LE et al. 2011 / 2012 — UNSUPERVISED', 96, 132, 13, rgba(C.cyan, 0.9), 1.6);
    L.spec(ctx, 96, 164, [
      ['NET', '9 LAYERS'],
      ['IMAGES', '10,000,000 · INTERNET'],
      ['MACHINES', '1,000'],
      ['TRAIN', '3 DAYS'],
      ['FLAGSHIP', 'UNLABELLED FACE DETECTOR'],
      ['CAT', 'ONE OF THE SECONDARY FINDINGS'],
    ], { alpha: 1, color: C.phos, kw: 108, size: 13, lh: 27 });
    ctx.restore();
  }
  const na = ss(shot.t0 + 0.8, shot.t0 + 1.25, t);
  if (na > 0.01){
    ctx.save(); ctx.globalAlpha = na;
    const nx0 = 1392, ny0 = 176, gw = 44, gh = 13;
    const counts = [8, 11, 11, 13, 13, 13, 11, 11, 7];
    for (let l = 0; l < 9; l++){
      const n = counts[l];
      for (let i = 0; i < n; i++){
        const x = nx0 + l * gw, y = ny0 + (i - (n - 1) / 2) * gh;
        ctx.fillStyle = rgba(l === 8 ? C.cyan : C.dsLite, 0.85);
        ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
        if (l < 8 && i % 3 === 0){
          const n2 = counts[l + 1];
          for (let j2 = 0; j2 < n2; j2 += 4){
            const x2 = nx0 + (l + 1) * gw, y2 = ny0 + (j2 - (n2 - 1) / 2) * gh;
            ctx.strokeStyle = rgba(C.phos, 0.10);
            ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x2, y2); ctx.stroke();
          }
        }
      }
    }
    L.mono(ctx, 'L1', nx0, ny0 + 128, 10, rgba(C.phos, 0.45), 0.6, 'center');
    L.mono(ctx, 'L9', nx0 + 8 * gw, ny0 + 128, 10, rgba(C.cyan, 0.85), 0.6, 'center');
    L.mono(ctx, 'CAT = A DIRECTION IN ACTIVATION SPACE', nx0 - 26, ny0 + 164, 11, rgba(C.phos, 0.55), 1.2);
    ctx.restore();
  }
  L.mono(ctx, 'ENJOYMENT  ·  PURR AS REWARD SIGNAL', 168, 946, 13, rgba(C.warm, 0.75 * ss(shot.t0 + 2.1, shot.t0 + 2.5, t)), 1.6);
  kw(ctx, 'ENJOYMENT', 1752, 946, 62, C.warm, ss(shot.t0 + 1.9, shot.t0 + 2.3, t), 'right');
  hud(ctx, shot, SEC7, ss(shot.t0, shot.t0 + 0.25, t));
  return { bloom: 1.25, chroma: 1.6 + 2 * pulse(t, 0.18), scan: 0.5 };
}

// ---------------------------------------------------------------- g_god
function g_god(ctx, t, u, shot){
  bgf(ctx, '#020306');
  const s = t - shot.t0;
  const b0 = Math.floor(beatOf(shot.t0));
  const NOBS = 8;
  const turnT = k => timeOfBeat(b0 + 3 + Math.floor(k * 3 / NOBS));
  const tReturn = timeOfBeat(b0 + 7);
  const CXg = 960, CYg = 545;

  let looking = 0;
  for (let k = 0; k < NOBS; k++) if (t < turnT(k)) looking++;
  const obsA = looking / NOBS;
  const relight = ss(tReturn, tReturn + 0.10, t);
  const light = Math.max(obsA, relight);
  const present = t >= tReturn || looking > 0;

  // cathedral: nine shafts of vertical light
  const shafts = [[180, 110, 0.6], [398, 66, 0.4], [628, 138, 0.8], [812, 74, 0.5], [960, 176, 1.0],
                  [1112, 84, 0.55], [1300, 126, 0.75], [1524, 60, 0.42], [1730, 104, 0.6]];
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < shafts.length; i++){
    const sx = shafts[i][0], sw = shafts[i][1], si = shafts[i][2];
    const flick = 0.85 + 0.15 * Math.sin(t * 2.4 + i * 1.7);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.28, rgba(C.phos, 0.022 * light * flick * si));
    g.addColorStop(0.72, rgba(C.cyan, 0.058 * light * flick * si));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(sx - sw * 0.35, 0); ctx.lineTo(sx + sw * 0.35, 0);
    ctx.lineTo(sx + sw, H); ctx.lineTo(sx - sw, H); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = rgba(C.phos, 0.10 * light * si);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(sx - sw * 0.10, 0); ctx.lineTo(sx - sw * 0.30, H); ctx.stroke();
  }
  ctx.restore();

  // gothic arches (structure, not ornament)
  const archA = 0.16 * light;
  if (archA > 0.01){
    for (const ax of [480, 960, 1440]){
      ctx.strokeStyle = rgba(C.dsLite, archA * 0.7); ctx.lineWidth = 1.2;
      for (const wd of [320, 250]){
        ctx.beginPath();
        ctx.moveTo(ax - wd, 1010);
        ctx.quadraticCurveTo(ax - wd * 0.92, 430, ax, 250);
        ctx.quadraticCurveTo(ax + wd * 0.92, 430, ax + wd, 1010);
        ctx.stroke();
      }
      ctx.strokeStyle = rgba(C.dsLite, archA * 0.5);
      for (let k = 1; k <= 2; k++){
        const yy = 1010 - k * 190;
        ctx.beginPath(); ctx.moveTo(ax - 300, yy); ctx.lineTo(ax + 300, yy); ctx.stroke();
      }
    }
  }

  // the ring of observers
  const ringA = ss(shot.t0 + 0.35, shot.t0 + 0.95, t);
  for (let k = 0; k < NOBS; k++){
    const ang = k / NOBS * TAU - Math.PI / 2 + 0.22 * Math.sin(t * 0.4);
    const ox = CXg + Math.cos(ang) * 700, oy = CYg + Math.sin(ang) * 262;
    const look = t < turnT(k);
    const turn = sat((t - turnT(k)) / 0.22);
    const a2 = ringA * (look ? 1 : 0.30);
    // sight cone
    if (look && ringA > 0.02){
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const dx = CXg - ox, dy = CYg - oy, len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len, wid = 26;
      const g = ctx.createLinearGradient(ox, oy, CXg, CYg);
      g.addColorStop(0, rgba(C.cyan, 0.16)); g.addColorStop(1, rgba(C.cyan, 0.0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(ox + nx * wid, oy + ny * wid); ctx.lineTo(ox - nx * wid, oy - ny * wid); ctx.lineTo(CXg, CYg); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    ctx.save();
    ctx.translate(ox, oy); ctx.rotate(turn * Math.PI);
    ctx.strokeStyle = rgba(look ? C.cyan : C.phos, 0.85 * a2); ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.ellipse(0, 0, 22, 11, 0, 0, TAU); ctx.stroke();
    ctx.fillStyle = rgba(look ? C.white : C.phos, (look ? 0.95 : 0.25) * a2);
    ctx.beginPath(); ctx.arc(0, 0, 5.5, 0, TAU); ctx.fill();
    ctx.restore();
    L.mono(ctx, 'OBS ' + (k + 1), ox, oy + 34, 10, rgba(C.phos, 0.45 * ringA * (look ? 1 : 0.4)), 1.2, 'center');
  }

  // the pixel — the only god
  const pulseBeat = 1 + 0.55 * pulse(t, 0.16);
  if (present){
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const r = 130 * pulseBeat;
    const g = ctx.createRadialGradient(CXg, CYg, 0, CXg, CYg, r);
    g.addColorStop(0, rgba(C.white, 0.55)); g.addColorStop(0.25, rgba(C.cyan, 0.16)); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(CXg - r, CYg - r, r * 2, r * 2);
    ctx.restore();
    ctx.fillStyle = rgba(C.white, 0.98);
    ctx.fillRect(CXg - 3, CYg - 3, 6, 6);
    ctx.fillStyle = rgba(C.cyan, 0.9);
    ctx.fillRect(CXg - 9, CYg - 1, 5, 2); ctx.fillRect(CXg + 5, CYg - 1, 5, 2);
    ctx.fillRect(CXg - 1, CYg - 9, 2, 5); ctx.fillRect(CXg - 1, CYg + 5, 2, 5);
    L.brackets(ctx, CXg - 54, CYg - 54, 108, 108, 12, rgba(C.cyan, 0.55), 1.2);
    L.mono(ctx, '1 PIXEL', CXg + 66, CYg - 6, 13, rgba(C.white, 0.85), 1.8);
    L.mono(ctx, 'THE ONLY GOD', CXg + 66, CYg + 14, 11, rgba(C.cyan, 0.6), 1.4);
  } else {
    ctx.save();
    ctx.setLineDash([6, 8]);
    ctx.strokeStyle = rgba(C.alert, 0.35); ctx.lineWidth = 1;
    ctx.strokeRect(CXg - 12, CYg - 12, 24, 24);
    ctx.restore();
    L.mono(ctx, 'NO OBSERVER → NO PIXEL', CXg, CYg + 70, 15, rgba(C.alert, 0.75), 2.4, 'center');
  }

  // observers counter
  L.mono(ctx, 'OBSERVERS  ' + String(looking).padStart(2, '0') + ' / 08', W - 96, 132, 14, rgba(looking > 0 ? C.cyan : C.alert, 0.9), 2.2, 'right');
  L.mono(ctx, 'IDLE MODEL · 0 FLOPs · 0 W OF COMPUTE', 96, 132, 14, rgba(C.phos, 0.8), 1.8);
  L.mono(ctx, 'ESSE EST PERCIPI — TO BE IS TO BE PERCEIVED', 96, 160, 12, rgba(C.phos, 0.5), 1.4);
  const goneA = (1 - light) * ss(shot.t0 + 2.6, shot.t0 + 3.2, t);
  if (goneA > 0.01){
    L.mono(ctx, 'THE FRAME IS EMPTY UNTIL THE CAMERA LOOKS', CXg, 700, 16, rgba(C.alert, 0.85 * goneA), 2.2, 'center');
  }
  const retA = ss(tReturn + 0.02, tReturn + 0.35, t);
  L.mono(ctx, 'THE OBSERVER IS THE ONLY PROOF', 96, 946, 15, rgba(C.cyan, 0.9 * retA), 1.6);
  kw(ctx, 'EXISTENCE', 1752, 946, 74, C.phos, retA * 0.95, 'right');

  // the pixel splits into two glyphs
  const split = ss(shot.t1 - 0.34, shot.t1 - 0.05, t);
  if (split > 0.01){
    const dx = 46 * easeOutCubic(split);
    ctx.fillStyle = rgba(C.white, 0.95 * split);
    ctx.fillRect(CXg - 3 - dx, CYg - 3, 6, 6);
    ctx.fillRect(CXg - 3 + dx, CYg - 3, 6, 6);
    ctx.strokeStyle = rgba(C.white, 0.5 * split); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(CXg - 3, CYg); ctx.lineTo(CXg + 3, CYg); ctx.stroke();
  }
  hud(ctx, shot, SEC7, ss(shot.t0, shot.t0 + 0.25, t));
  const pop = t >= tReturn ? 0.38 * Math.exp(-(t - tReturn) * 9) : 0;
  return { bloom: 1.08, chroma: 1.4, scan: 0.55, flash: pop, grain: 0.11 };
}

// ---------------------------------------------------------------- h_gender
function h_gender(ctx, t, u, shot){
  bgf(ctx, '#04060A');
  const b0 = Math.floor(beatOf(shot.t0));
  const tM0 = timeOfBeat(b0 + 2);
  const flips = [timeOfBeat(b0 + 3), timeOfBeat(b0 + 4), timeOfBeat(b0 + 5)];
  const FIN = timeOfBeat(b0 + 6);
  const DIFF = [3, 1, 0];
  const BF = [0, 1, 0, 0, 0, 1, 1, 0];
  const BM = [0, 1, 0, 0, 1, 1, 0, 1];
  const bitVal = i => {
    const f = DIFF.indexOf(7 - i);
    if (f < 0) return BF[i];
    return t >= flips[f] ? BM[i] : BF[i];
  };
  const bitAge = i => {
    const f = DIFF.indexOf(7 - i);
    if (f < 0) return 99;
    return t - flips[f];
  };

  const baseY = 726, SP = 190, R0 = 46, X0 = 960 - 3.5 * SP;

  // the two dotted glyphs: a lattice sampled inside the letterform
  const segD = (px, py, ax, ay, bx, by) => {
    const dx = bx - ax, dy = by - ay;
    const L2 = dx * dx + dy * dy || 1;
    const tt = clamp(((px - ax) * dx + (py - ay) * dy) / L2, 0, 1);
    return Math.hypot(px - ax - dx * tt, py - ay - dy * tt);
  };
  const inR = (u, v, x0, y0, x1, y1) => u >= x0 && u <= x1 && v >= y0 && v <= y1;
  const fTest = (u, v) => inR(u, v, 0, 0, 0.20, 1) || inR(u, v, 0.20, 0, 0.64, 0.17) || inR(u, v, 0.20, 0.42, 0.54, 0.58);
  const mTest = (u, v) => inR(u, v, 0, 0, 0.18, 1) || inR(u, v, 0.82, 0, 1, 1) ||
    segD(u, v, 0.18, 0.04, 0.50, 0.60) < 0.115 || segD(u, v, 0.82, 0.04, 0.50, 0.60) < 0.115;
  const letter = (gx, gy, w, h, pitch, test, col, a) => {
    if (a <= 0.01) return;
    ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = col;
    for (let yy = 0; yy <= h; yy += pitch) for (let xx = 0; xx <= w; xx += pitch){
      if (!test(xx / w, yy / h)) continue;
      ctx.beginPath(); ctx.arc(gx + xx, gy + yy, pitch * 0.31, 0, TAU); ctx.fill();
    }
    ctx.restore();
  };
  const ga = ss(shot.t0 + 0.05, shot.t0 + 0.45, t);
  letter(176, 118, 300, 420, 22, fTest, rgba(C.phos, 0.90), ga);
  letter(1444, 118, 300, 420, 22, mTest, rgba(C.dsLite, 0.90), ga);
  L.mono(ctx, 'F = 0x46', 176, 78, 20, rgba(C.phos, 0.95 * ga), 2.6);
  L.mono(ctx, '0100 0110', 176, 102, 12, rgba(C.phos, 0.5 * ga), 1.6);
  L.mono(ctx, 'M = 0x4D', 1744, 78, 20, rgba(C.dsLite, 0.95 * ga), 2.6, 'right');
  L.mono(ctx, '0100 1101', 1744, 102, 12, rgba(C.dsLite, 0.5 * ga), 1.6, 'right');

  // XOR readout in the middle
  const xa = ss(tM0 - 0.30, tM0, t);
  if (xa > 0.01){
    ctx.save(); ctx.globalAlpha = xa;
    L.mono(ctx, '0x46 XOR 0x4D', 960, 300, 17, rgba(C.white, 0.9), 2.2, 'center');
    L.mono(ctx, '= 0x0B', 960, 340, 17, rgba(C.alert, 0.95), 2.2, 'center');
    L.mono(ctx, '= 0b0000 1011', 960, 372, 13, rgba(C.phos, 0.6), 1.6, 'center');
    L.mono(ctx, 'BITS 0 · 1 · 3', 960, 398, 13, rgba(C.warm, 0.85), 1.6, 'center');
    ctx.restore();
  }

  // the byte: eight enormous dots
  const dotsA = ss(shot.t0 + 0.10, shot.t0 + 0.55, t);
  ctx.save(); ctx.globalAlpha = dotsA;
  ctx.strokeStyle = rgba(C.phos, 0.16); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(X0 - 60, baseY); ctx.lineTo(X0 + 7 * SP + 60, baseY); ctx.stroke();
  for (let i = 0; i < 8; i++){
    const v = bitVal(i), age = bitAge(i);
    const x = X0 + i * SP;
    const on = v === 1;
    const hit = age >= 0 && age < 0.42 ? 1 - age / 0.42 : 0;
    ctx.strokeStyle = rgba(on ? C.cyan : C.phos, on ? 0.9 : 0.35);
    ctx.lineWidth = on ? 2 : 1.2;
    ctx.beginPath(); ctx.arc(x, baseY, R0 + 9, 0, TAU); ctx.stroke();
    if (on){
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(x, baseY, 0, x, baseY, R0 * 2.4);
      g.addColorStop(0, rgba(C.cyan, 0.9)); g.addColorStop(0.4, rgba(C.cyan, 0.25)); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(x - R0 * 2.4, baseY - R0 * 2.4, R0 * 4.8, R0 * 4.8);
      ctx.restore();
      ctx.fillStyle = rgba(C.white, 0.95);
      ctx.beginPath(); ctx.arc(x, baseY, R0 * 0.62, 0, TAU); ctx.fill();
    } else {
      ctx.fillStyle = rgba(C.phos, 0.10);
      ctx.beginPath(); ctx.arc(x, baseY, R0 * 0.55, 0, TAU); ctx.fill();
    }
    if (hit > 0){
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = rgba(C.white, hit); ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.arc(x, baseY, R0 + 9 + 60 * (1 - hit), 0, TAU); ctx.stroke();
      ctx.restore();
    }
    L.mono(ctx, 'b' + (7 - i), x, baseY - R0 - 26, 12, rgba(DIFF.indexOf(i) >= 0 ? C.warm : C.phos, DIFF.indexOf(i) >= 0 ? 0.9 : 0.45), 1.2, 'center');
    L.mono(ctx, on ? '1' : '0', x, baseY + R0 + 42, 24, rgba(on ? C.white : C.phos, on ? 0.95 : 0.45), 0, 'center');
    const f = DIFF.indexOf(7 - i);
    if (f >= 0 && t >= flips[f]){
      ctx.fillStyle = rgba(C.alert, 0.9);
      ctx.fillRect(x - 1, baseY - R0 - 60, 2, 22);
      L.mono(ctx, f === 0 ? 'BIT 3  0→1' : (f === 1 ? 'BIT 1  1→0' : 'BIT 0  0→1'), x, baseY - R0 - 68, 10, rgba(C.warm, 0.9), 0.8, 'center');
    }
  }
  ctx.restore();

  // the mask sweeping the byte
  if (t >= tM0 - 0.25){
    const stops = [[tM0 - 0.25, -0.6], [tM0, 3.5], [flips[0], 4], [flips[1], 6], [flips[2], 7], [FIN, 7.6]];
    let mp = 7.6;
    for (let i = 0; i < stops.length - 1; i++){
      if (t >= stops[i][0] && t < stops[i + 1][0]){
        const f = easeInOutCubic(sat((t - stops[i][0]) / (stops[i + 1][0] - stops[i][0])));
        mp = lerp(stops[i][1], stops[i + 1][1], f);
        break;
      }
      if (t < stops[0][0]){ mp = stops[0][1]; break; }
    }
    const mx = X0 + mp * SP;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createLinearGradient(mx - 40, 0, mx + 40, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, rgba(C.alert, 0.55)); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(mx - 40, baseY - 190, 80, 380);
    ctx.fillStyle = rgba(C.white, 0.9);
    ctx.fillRect(mx - 1.5, baseY - 150, 3, 300);
    ctx.restore();
    L.mono(ctx, 'MASK', mx, baseY - 168, 11, rgba(C.alert, 0.9), 1.6, 'center');
  }

  // payoff
  const finA = ss(FIN - 0.05, FIN + 0.25, t);
  kw(ctx, 'IDENTITY COSTS THREE BITS', 960, 946, 58, C.white, finA, 'center');
  const doneA = ss(flips[2] + 0.05, flips[2] + 0.35, t);
  if (doneA > 0.01){
    L.mono(ctx, 'ROLE BYTE  F → M', 960, 858, 13, rgba(C.cyan, 0.8 * doneA), 2.0, 'center');
  }
  hud(ctx, shot, SEC8, ss(shot.t0, shot.t0 + 0.25, t));
  return { bloom: 1.15, chroma: 1.4 + 6 * (t > flips[0] && t < flips[0] + 0.2 ? 1 : 0), scan: 0.5 };
}

// ---------------------------------------------------------------- h_clock
function demand(h){
  const night = 0.40 + 0.09 * Math.cos((h - 3) / 24 * TAU);
  const morn = 0.26 * ss(6.0, 9.5, h);
  const eve = 0.34 * Math.exp(-Math.pow((h - 19.4) / 2.3, 2));
  const noon = 0.16 * Math.exp(-Math.pow((h - 13.5) / 2.1, 2));
  return clamp(night + morn + eve + noon, 0, 1.12) / 1.12;
}

function h_clock(ctx, t, u, shot){
  bgf(ctx, '#04060A');
  const s = t - shot.t0;
  const b0 = Math.floor(beatOf(shot.t0));
  const beat = beatOf(t) - (beatOf(t) % 1);
  const h = 8 + 2 * (beatOf(t) - b0);
  const isPM = ((h % 24) >= 12) ? 1 : 0;
  const cx = 860, cy = 470, R = 300;
  const flat = ss(shot.t0 + 1.10, shot.t0 + 1.62, t);
  const morph = ss(shot.t0 + 1.50, shot.t0 + 2.18, t);
  const sy = lerp(1, 0.26, flat);

  // dial
  const dialA = 1 - morph;
  if (dialA > 0.01){
    ctx.save();
    ctx.translate(cx, cy); ctx.scale(1, sy); ctx.translate(-cx, -cy);
    ctx.globalAlpha = dialA;
    ctx.strokeStyle = rgba(C.phos, 0.55); ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.stroke();
    ctx.strokeStyle = rgba(C.phos, 0.22); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, R - 16, 0, TAU); ctx.stroke();
    for (let i = 0; i < 60; i++){
      const a = -Math.PI / 2 + i / 60 * TAU;
      const big = i % 5 === 0;
      ctx.strokeStyle = rgba(big ? C.cyan : C.phos, big ? 0.85 : 0.30);
      ctx.lineWidth = big ? 1.6 : 1;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (R - 4), cy + Math.sin(a) * (R - 4));
      ctx.lineTo(cx + Math.cos(a) * (R - (big ? 30 : 14)), cy + Math.sin(a) * (R - (big ? 30 : 14)));
      ctx.stroke();
    }
    for (let i = 0; i < 12; i++){
      const a = -Math.PI / 2 + i / 12 * TAU;
      L.mono(ctx, String(i === 0 ? 12 : i), cx + Math.cos(a) * (R - 58), cy + Math.sin(a) * (R - 58) + 7, 20, rgba(C.phos, 0.55), 0, 'center');
    }
    // hands, with motion ghosting so 30 fps never strobes
    const hands = [[h / 12, 150, 5.5, C.white], [h % 1, 232, 3.2, C.cyan], [(h * 60) % 1, 262, 1.2, C.dsLite]];
    for (const hd of hands){
      for (let g2 = 0; g2 < 4; g2++){
        const hv = hd[0] - g2 * 0.012;
        const a = -Math.PI / 2 + hv * TAU;
        ctx.strokeStyle = rgba(hd[3], g2 === 0 ? 0.95 : 0.11);
        ctx.lineWidth = hd[2] * (g2 === 0 ? 1 : 0.7);
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * hd[1], cy + Math.sin(a) * hd[1]); ctx.stroke();
      }
    }
    ctx.fillStyle = rgba(C.white, 0.95);
    ctx.beginPath(); ctx.arc(cx, cy, 8, 0, TAU); ctx.fill();
    ctx.restore();
  }

  // AM / PM as one boolean
  const ba = ss(shot.t0 + 0.15, shot.t0 + 0.5, t);
  const flipAge = Math.abs(((h % 12) + 12) % 12) < 0.12 ? sat(1 - Math.abs((h % 12)) / 0.12) : 0;
  const bitX = 1380, bitY = 250, bitW = 300, bitH = 158;
  if (ba > 0.01){
    ctx.save(); ctx.globalAlpha = ba;
    ctx.fillStyle = 'rgba(9,13,20,0.9)'; ctx.fillRect(bitX, bitY, bitW, bitH);
    ctx.strokeStyle = rgba(isPM ? C.warm : C.cyan, 0.6); ctx.lineWidth = 1.2;
    ctx.strokeRect(bitX + 0.5, bitY + 0.5, bitW - 1, bitH - 1);
    L.mono(ctx, 'AM / PM', bitX + 16, bitY + 28, 12, rgba(C.phos, 0.6), 2);
    L.mono(ctx, 'ONE BOOLEAN', bitX + 16, bitY + 52, 11, rgba(C.phos, 0.32), 1.2);
    ctx.fillStyle = rgba(isPM ? C.warm : C.cyan, 0.16);
    ctx.fillRect(bitX + 16, bitY + 66, 74, 74);
    ctx.strokeStyle = rgba(isPM ? C.warm : C.cyan, 0.7);
    ctx.strokeRect(bitX + 16.5, bitY + 66.5, 73, 73);
    L.mono(ctx, String(isPM), bitX + 53, bitY + 122, 56, rgba(C.white, 0.96), 0, 'center');
    L.mono(ctx, isPM ? 'PM' : 'AM', bitX + 112, bitY + 96, 40, rgba(isPM ? C.warm : C.cyan, 0.95), 2);
    L.mono(ctx, isPM ? '12 ≤ h < 24' : '0 ≤ h < 12', bitX + 112, bitY + 126, 11, rgba(C.phos, 0.5), 1.0);
    ctx.restore();
  }
  // hour readout
  const hh = ((h % 24) + 24) % 24;
  L.mono(ctx, 'h = ' + hh.toFixed(2).padStart(5, '0'), 96, 132, 15, rgba(C.cyan, 0.9), 2.0);
  L.mono(ctx, 'DIAL · DATASHEET CLOCK', 96, 160, 11, rgba(C.phos, 0.45), 1.6);

  // the dial becomes the diurnal load curve
  const gx0 = 300, gx1 = 1620, gy0 = 828, curveH = 336;
  const dnorm = hv => clamp((demand(hv) - 0.28) / 0.72, 0, 1);
  if (morph > 0.01){
    ctx.save(); ctx.globalAlpha = morph;
    ctx.strokeStyle = rgba(C.phos, 0.30); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(gx0, gy0); ctx.lineTo(gx1 + 20, gy0); ctx.stroke();
    for (let i = 0; i <= 24; i += 3){
      const x = gx0 + (gx1 - gx0) * i / 24;
      ctx.strokeStyle = rgba(C.phos, 0.18);
      ctx.beginPath(); ctx.moveTo(x, gy0 - 6); ctx.lineTo(x, gy0 + 6); ctx.stroke();
      L.mono(ctx, (i < 10 ? '0' : '') + i + 'h', x, gy0 + 26, 11, rgba(C.phos, 0.45), 0.8, 'center');
    }
    L.mono(ctx, 'NORMALISED DEMAND', gx0, gy0 - curveH - 24, 11, rgba(C.phos, 0.45), 1.4);
    // the curve itself, plus the migrating dial dots
    ctx.beginPath();
    for (let i = 0; i <= 96; i++){
      const hv = i / 96 * 24;
      const x = gx0 + (gx1 - gx0) * hv / 24;
      const y = gy0 - dnorm(hv) * curveH - 6 * pulse(t, 0.14);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = rgba(C.cyan, 0.95); ctx.lineWidth = 2.2; ctx.stroke();
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = rgba(C.cyan, 0.18); ctx.lineWidth = 6;
    ctx.beginPath();
    for (let i = 0; i <= 96; i++){
      const hv = i / 96 * 24;
      const x = gx0 + (gx1 - gx0) * hv / 24;
      const y = gy0 - dnorm(hv) * curveH - 6 * pulse(t, 0.14);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke(); ctx.restore();
    // hour dots travelling out of the dial
    for (let i = 0; i < 24; i++){
      const a = -Math.PI / 2 + i / 24 * TAU;
      const ex = cx + Math.cos(a) * R * 0.98, ey = cy + Math.sin(a) * R * 0.98 * sy;
      const tx = gx0 + (gx1 - gx0) * i / 24, ty = gy0 - dnorm(i) * curveH;
      const k2 = easeInOutCubic(sat((morph - i / 48) / 0.62));
      const x = lerp(ex, tx, k2), y = lerp(ey, ty, k2);
      ctx.fillStyle = rgba(k2 > 0.9 ? C.cyan : C.phos, 0.35 + 0.55 * k2);
      ctx.fillRect(x - 2.5, y - 2.5, 5, 5);
    }
    // cursor + the machine breathing
    const hd = ((h % 24) + 24) % 24;
    const cxp = gx0 + (gx1 - gx0) * hd / 24, cyp = gy0 - dnorm(hd) * curveH;
    ctx.strokeStyle = rgba(C.warm, 0.55); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cxp, gy0); ctx.lineTo(cxp, cyp); ctx.stroke();
    ctx.fillStyle = rgba(C.warm, 0.95);
    ctx.beginPath(); ctx.arc(cxp, cyp, 5, 0, TAU); ctx.fill();
    const br = dnorm(hd) * (1 + 0.10 * pulse(t, 0.2));
    const bx = 1648, bTop = gy0 - curveH, bH = curveH;
    ctx.strokeStyle = rgba(C.phos, 0.4); ctx.lineWidth = 1;
    ctx.strokeRect(bx, bTop, 44, bH);
    ctx.fillStyle = rgba(C.cyan, 0.55);
    ctx.fillRect(bx + 4, gy0 - br * bH, 36, br * bH);
    L.mono(ctx, 'COMPUTE', bx - 4, bTop - 12, 10, rgba(C.phos, 0.5), 1.0);
    ctx.restore();
  }

  kw(ctx, 'WHATEVER', 1752, 968, 58, morph > 0.5 ? C.cyan : C.phos, ss(shot.t0 + 0.4, shot.t0 + 0.8, t), 'right');
  L.mono(ctx, '24 h DIURNAL LOAD · A DATACENTER BREATHES WITH THE GRID', 96, 946, 14, rgba(C.cyan, 0.85 * ss(shot.t0 + 1.7, shot.t0 + 2.1, t)), 1.4);
  hud(ctx, shot, SEC8, ss(shot.t0, shot.t0 + 0.25, t));
  return { bloom: 1.20, chroma: 1.3 + 3 * flat, scan: 0.5 };
}

// ---------------------------------------------------------------- h_replica
function h_replica(ctx, t, u, shot){
  bgf(ctx, '#04060A');
  const b0 = Math.floor(beatOf(shot.t0));
  const tFlat = timeOfBeat(b0 + 5);
  const tProm = timeOfBeat(b0 + 6);
  const swap = easeInOutCubic(sat((t - tProm) / 0.36));
  const down = t >= tFlat;
  const prom = t >= tProm;
  const ca = ss(shot.t0 + 0.15, shot.t0 + 0.60, t);

  const PX = 380, PY = 540, PW = 250, PH = 150;
  const RX = 1524, RY = [286, 540, 794], RW = 268, RH = 112;
  const posA = [lerp(PX, RX, swap), lerp(PY, RY[1], swap)];
  const posB = [lerp(RX, PX, swap), lerp(RY[1], PY, swap)];
  const wA = lerp(PW, RW, swap), hA = lerp(PH, RH, swap);
  const wB = lerp(RW, PW, swap), hB = lerp(RH, PH, swap);
  const primX = prom ? posB[0] : PX, primY = prom ? posB[1] : PY;
  const primCol = down && !prom ? C.alert : (prom ? C.cyan : C.phos);
  const hubX = primX + (prom ? wB : PW) / 2, hubY = primY;

  const node = (x, y, w, h, title, sub, col, alert) => {
    ctx.save();
    ctx.fillStyle = 'rgba(9,13,20,0.92)'; ctx.fillRect(x - w / 2, y - h / 2, w, h);
    ctx.strokeStyle = rgba(alert ? C.alert : col, 0.88); ctx.lineWidth = 1.6;
    ctx.strokeRect(x - w / 2 + 0.5, y - h / 2 + 0.5, w - 1, h - 1);
    ctx.fillStyle = rgba(alert ? C.alert : col, 0.15);
    ctx.fillRect(x - w / 2, y - h / 2, w, 25);
    L.mono(ctx, title, x - w / 2 + 12, y - h / 2 + 18, 12, rgba(alert ? C.alert : C.white, 0.95), 1.8);
    L.mono(ctx, sub, x - w / 2 + 12, y + h / 2 - 11, 10, rgba(col, 0.7), 1.1);
    L.brackets(ctx, x - w / 2 + 5, y - h / 2 + 5, w - 10, h - 10, 9, rgba(alert ? C.alert : col, 0.35), 1);
    ctx.restore();
  };
  const ecg = (x, y, w, h, dead) => {
    const x0 = x - w / 2 + 14, x1 = x + w / 2 - 14, yc = y + 24;
    ctx.beginPath();
    if (dead){
      ctx.moveTo(x0, yc); ctx.lineTo(x1, yc);
      ctx.strokeStyle = rgba(C.alert, 0.95); ctx.lineWidth = 2;
    } else {
      for (let px = x0; px <= x1; px += 1.5){
        const f = (px - x0) / (x1 - x0);
        const ph = ((f * 2.1 + t * 1.7) % 1);
        let yy = yc;
        if (ph > 0.42 && ph < 0.50) yy = yc - 20 * Math.sin((ph - 0.42) / 0.08 * Math.PI);
        else if (ph > 0.50 && ph < 0.57) yy = yc + 9 * Math.sin((ph - 0.50) / 0.07 * Math.PI);
        if (px === x0) ctx.moveTo(px, yy); else ctx.lineTo(px, yy);
      }
      ctx.strokeStyle = rgba(C.cyan, 0.95); ctx.lineWidth = 1.6;
    }
    ctx.stroke();
  };

  // links first, under the boxes
  const dir = prom ? -1 : 1;
  for (let k = 0; k < 3; k++){
    const bx = RX - RW / 2, by = RY[k];
    const mx = (hubX + bx) / 2;
    ctx.strokeStyle = rgba(prom ? C.cyan : C.phos, (prom ? 0.55 : 0.40) * ca);
    ctx.lineWidth = prom ? 1.9 : 1.3;
    ctx.beginPath(); ctx.moveTo(hubX, hubY); ctx.bezierCurveTo(mx, hubY, mx, by, bx, by); ctx.stroke();
    ctx.save();
    ctx.setLineDash([14, 20]);
    ctx.lineDashOffset = (prom ? 1 : -1) * (t * 90) % 34;
    ctx.strokeStyle = rgba(prom ? C.white : C.cyan, 0.62 * ca);
    ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.moveTo(hubX, hubY); ctx.bezierCurveTo(mx, hubY, mx, by, bx, by); ctx.stroke();
    ctx.restore();
    // arrowhead at the destination
    const hx = prom ? hubX + 4 : bx - 2, hy = prom ? hubY + (k - 1) * 34 : by;
    const sgn = prom ? 1 : -1;
    ctx.fillStyle = rgba(prom ? C.cyan : C.phos, 0.95 * ca);
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(hx + sgn * 19, hy - 9);
    ctx.lineTo(hx + sgn * 19, hy + 9);
    ctx.closePath(); ctx.fill();
    // heartbeat travelling along the link
    const ph = (((t - shot.t0) * 1.6 + k * 0.33) % 1);
    const f = prom ? 1 - ph : ph;
    const px2 = (1 - f) * (1 - f) * hubX + 2 * (1 - f) * f * mx + f * f * bx;
    const py2 = (1 - f) * (1 - f) * hubY + 2 * (1 - f) * f * hubY + f * f * by;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = rgba(prom ? C.cyan : C.white, 0.9 * ca);
    ctx.fillRect(px2 - 2.5, py2 - 2.5, 5, 5);
    ctx.restore();
  }

  ctx.save(); ctx.globalAlpha = ca;
  node(RX, RY[0], RW, RH, 'REPLICA 1', 'FOLLOWS LOG', C.phos, false);
  node(RX, RY[2], RW, RH, 'REPLICA 3', 'FOLLOWS LOG', C.phos, false);
  if (!prom){
    node(posA[0], posA[1], wA, hA, down ? 'PRIMARY · DOWN' : 'PRIMARY', down ? 'NO HEARTBEAT' : 'WRITES ACCEPTED', primCol, down);
    ecg(posA[0], posA[1], wA, hA, down);
    node(posB[0], posB[1], wB, hB, 'REPLICA 2', 'FOLLOWS LOG', C.phos, false);
  } else {
    node(posA[0], posA[1], wA, hA, 'REPLICA · DEMOTED', 'READ-ONLY', C.dsLite, false);
    node(posB[0], posB[1], wB, hB, 'PRIMARY · ELECTED', 'LEADER ELECTION', C.cyan, false);
    ecg(posB[0], posB[1], wB, hB, false);
  }
  ctx.restore();

  // role map: the slot letters never move, the boxes do
  L.mono(ctx, 'M', 380, 444, 20, rgba(primCol, 0.85 * ca), 2, 'center');
  L.mono(ctx, 'S', 1524, 212, 20, rgba(C.phos, 0.55 * ca), 2, 'center');
  L.mono(ctx, 'S = REPLICA   M = PRIMARY', 96, 190, 11, rgba(C.phos, 0.42 * ca), 1.2);

  // flatline moment
  const flatA = down ? ss(tFlat, tFlat + 0.10, t) : 0;
  if (flatA > 0.01 && !prom){
    L.mono(ctx, 'HEARTBEAT LOST', 960, 214, 22, rgba(C.alert, 0.9 * flatA), 5, 'center');
  }
  // promotion
  const flashA = prom ? Math.exp(-(t - tProm) * 6) : 0;
  if (prom){
    const bA = ss(tProm, tProm + 0.14, t);
    ctx.save(); ctx.globalAlpha = bA;
    ctx.shadowColor = C.cyan; ctx.shadowBlur = 40;
    L.display(ctx, 'FAILOVER', 960, 210, 64, rgba(C.white, 0.95), 'center');
    ctx.restore();
    L.mono(ctx, 'LEADER ELECTION · EVERY ARROW NOW POINTS THE OTHER WAY', 960, 240, 12, rgba(C.cyan, 0.8 * bA), 1.3, 'center');
  }

  // write log: the documented rename wave
  const logA = ss(shot.t0 + 0.4, shot.t0 + 0.9, t);
  if (logA > 0.01){
    ctx.save(); ctx.globalAlpha = logA;
    L.mono(ctx, 'WRITE LOG', 96, 668, 12, rgba(C.phos, 0.6), 2.4);
    const rows = [
      'W 2020-06-23  GIT / SFC STATEMENT',
      'W 2020-10-01  GITHUB DEFAULT BRANCH',
      'R TERMS  MAIN · PRIMARY/REPLICA',
      'W TERMS  LEADER / FOLLOWER',
      'W SYNC   3 REPLICAS ACK',
      'W HEARTBEAT  1 Hz',
    ];
    const scroll = (t - shot.t0) * 24;
    for (let i = 0; i < rows.length; i++){
      const y = 700 + i * 26 - (scroll % 26);
      if (y < 690 || y > 902) continue;
      const a2 = clamp((902 - y) / 40, 0, 1) * clamp((y - 686) / 20, 0, 1);
      L.mono(ctx, rows[i], 96, y, 12, rgba(i === 0 ? C.cyan : C.phos, 0.78 * a2), 0.8);
    }
    ctx.restore();
  }
  L.mono(ctx, 'SWITCHING ROLE IS NOT A METAPHOR — IT IS A DOCUMENTED OPERATION', 96, 946, 14, rgba(C.cyan, 0.85 * ca), 1.3);
  kw(ctx, 'ROLE', 1752, 946, 66, prom ? C.cyan : C.phos, ss(shot.t0 + 0.3, shot.t0 + 0.7, t), 'right');
  hud(ctx, shot, SEC8, ss(shot.t0, shot.t0 + 0.25, t));
  return { bloom: 1.2 + flashA * 0.6, chroma: 1.4 + 8 * flashA, scan: 0.5, flash: flashA * 0.35 };
}

// ---------------------------------------------------------------- h_trance
function h_trance(ctx, t, u, shot){
  bgf(ctx, '#03050A');
  const s = t - shot.t0;
  const dur = shot.t1 - shot.t0;
  const phase = 0.55 * s + 0.78 * s * s / dur;
  const rev = Math.floor(phase);
  const typeK = sat((phase - rev) / 0.34);
  const ramp = sat(s / dur);
  const omega = 0.9 + 6.2 * ramp * ramp;
  const bp = pulse(t, 0.16);
  const cam = L.makeCam({ pos: [0, 0, 0], yaw: 0, pitch: 0, fov: 1.2 });
  const NRING = 34, SEG = 26;
  const zAt = k => -1.5 * Math.pow(1.125, k) - 0.2;
  const angAt = k => t * omega * (1 + k * 0.035) * (1 + 0.35 * bp) + k * 0.55;
  const radAt = k => 1.0 + 0.07 * Math.sin(k * 0.7 + t * 2.1);
  const tA = ss(shot.t0 + 0.03, shot.t0 + 0.45, t);

  // the vanishing point
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  const vg = ctx.createRadialGradient(960, 540, 0, 960, 540, 210);
  vg.addColorStop(0, rgba(C.cyan, 0.40 + 0.25 * bp)); vg.addColorStop(0.35, rgba(C.ds, 0.14)); vg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = vg; ctx.fillRect(740, 320, 440, 440);

  // rings
  for (let k = NRING - 1; k >= 0; k--){
    const z = zAt(k), d = -z;
    const a0 = clamp(1 - d / 62, 0, 1);
    if (a0 < 0.02) continue;
    const ang = angAt(k), rad = radAt(k);
    const col = k % 7 === 0 ? C.cyan : (k % 3 === 0 ? C.dsLite : C.phos);
    ctx.strokeStyle = rgba(col, (0.08 + 0.62 * Math.pow(a0, 2.4)) * tA);
    ctx.lineWidth = 1 + 1.8 * Math.pow(a0, 4);
    ctx.beginPath();
    let started = false;
    for (let j = 0; j <= SEG; j++){
      const a = j / SEG * TAU + ang;
      const q = L.proj(cam, [Math.cos(a) * rad, Math.sin(a) * rad, z]);
      if (!q){ started = false; continue; }
      if (!started){ ctx.moveTo(q[0], q[1]); started = true; } else ctx.lineTo(q[0], q[1]);
    }
    ctx.stroke();
    if (k % 2 === 0){
      for (let j = 0; j < 8; j++){
        const a = j / 8 * TAU + ang;
        const q = L.proj(cam, [Math.cos(a) * rad, Math.sin(a) * rad, z]);
        if (!q) continue;
        const sz = clamp(1.2 + 4.4 * Math.pow(a0, 5), 1.2, 6);
        ctx.fillStyle = rgba(k % 7 === 0 ? C.white : C.cyan, 0.22 + 0.78 * Math.pow(a0, 3));
        ctx.fillRect(q[0] - sz / 2, q[1] - sz / 2, sz, sz);
      }
    }
  }
  // the walls of the tunnel: strands of nodes spinning away from us
  for (let j = 0; j < 8; j++){
    ctx.beginPath();
    let started = false;
    for (let k = 0; k < NRING; k++){
      const a0 = clamp(1 - (-zAt(k)) / 62, 0, 1);
      if (a0 < 0.03) break;
      const a = j / 8 * TAU + angAt(k);
      const q = L.proj(cam, [Math.cos(a) * radAt(k), Math.sin(a) * radAt(k), zAt(k)]);
      if (!q){ started = false; continue; }
      if (!started){ ctx.moveTo(q[0], q[1]); started = true; } else ctx.lineTo(q[0], q[1]);
    }
    ctx.strokeStyle = rgba(C.phos, 0.13 * tA); ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.restore();

  // the word, typed once per revolution
  const WORDS = ['T', 'TR', 'TRA', 'TRAN', 'TRANC', 'TRANCE'];
  const word = WORDS[Math.min(5, Math.floor(typeK * 6))];
  ctx.save();
  const bgG = ctx.createRadialGradient(960, 520, 20, 960, 520, 380);
  bgG.addColorStop(0, 'rgba(3,5,10,0.88)'); bgG.addColorStop(0.55, 'rgba(3,5,10,0.55)'); bgG.addColorStop(1, 'rgba(3,5,10,0)');
  ctx.fillStyle = bgG; ctx.fillRect(560, 340, 800, 360);
  ctx.restore();
  for (let g = 3; g >= 1; g--){
    const gp = phase - g;
    if (gp < 0) continue;
    ctx.save(); ctx.globalAlpha = 0.13 / g;
    ctx.translate(960, 520); ctx.scale(1 + g * 0.26, 1 + g * 0.26);
    L.display(ctx, 'TRANCE', 0, 0, 132, rgba(C.phos, 0.8), 'center');
    ctx.restore();
  }
  ctx.save();
  ctx.translate(960, 520);
  const wsc = 1 + 0.08 * (1 - typeK) + 0.03 * bp;
  ctx.scale(wsc, wsc);
  ctx.shadowColor = C.cyan; ctx.shadowBlur = 56;
  L.display(ctx, word, 0, 0, 148, rgba(C.white, 0.97), 'center');
  L.display(ctx, word, 0, 0, 148, rgba(C.cyan, 0.35), 'center');
  if (typeK < 0.98){
    const ww = L.tw(ctx, word, 148) / 2;
    ctx.shadowBlur = 0;
    ctx.fillStyle = rgba(C.cyan, 0.9);
    ctx.fillRect(ww + 10, -104, 15, 112);
  }
  ctx.restore();
  // the loop indicator
  ctx.save();
  ctx.strokeStyle = rgba(C.cyan, 0.50); ctx.lineWidth = 2;
  const rr = 268 + 7 * bp, spin = t * omega * 0.6;
  ctx.beginPath(); ctx.arc(960, 520, rr, spin, spin + 1.55 * Math.PI); ctx.stroke();
  ctx.fillStyle = rgba(C.white, 0.9);
  ctx.beginPath(); ctx.arc(960 + Math.cos(spin) * rr, 520 + Math.sin(spin) * rr, 4, 0, TAU); ctx.fill();
  ctx.restore();

  const fa = ss(shot.t0 + 0.5, shot.t0 + 0.95, t);
  ctx.save(); ctx.globalAlpha = fa;
  L.mono(ctx, 'SPINLOCK · BUSY-WAIT', 96, 132, 13, rgba(C.cyan, 0.9), 1.8);
  L.mono(ctx, 'RETRY · POLL · BACKOFF', 96, 158, 12, rgba(C.phos, 0.6), 1.4);
  L.mono(ctx, 'REV ' + String(rev).padStart(2, '0'), W - 96, 132, 13, rgba(C.phos, 0.7), 2.2, 'right');
  L.mono(ctx, 'ω ' + omega.toFixed(2) + ' rad/s', W - 96, 158, 11, rgba(C.phos, 0.45), 1.4, 'right');
  ctx.restore();
  L.mono(ctx, 'A LOOP IS A PLACE YOU CAN LIVE', 168, 946, 16, rgba(C.warm, 0.92 * ss(shot.t0 + 2.2, shot.t0 + 2.7, t)), 1.8);
  hud(ctx, shot, SEC8, ss(shot.t0, shot.t0 + 0.25, t));
  const endF = ss(shot.t1 - 0.30, shot.t1 - 0.02, t);
  return { bloom: 1.25 + 0.5 * ramp, chroma: 1.6 + 10 * ramp, scan: 0.5, flash: endF * 0.55 };
}

module.exports = { g_eggplant, g_tomato, g_cat, g_god, h_gender, h_clock, h_replica, h_trance };
