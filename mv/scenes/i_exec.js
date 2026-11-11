
'use strict';
// XIV. EXECUTION x12 + ring6 + exe7 — fourteen meanings of the word.
const L = require('../engine/lib.js');
const {
  W, H, C, rgba, clamp, lerp, sat, ss, TAU,
  easeOutExpo, easeOutQuint, easeOutCubic, easeInCubic, easeInOutCubic, easeOutBack,
  SPB, BEAT0,
} = L;
const { createCanvas } = require('@napi-rs/canvas');

const WORD = 'EXECUTION';
// YaHei has no Hangul; Malgun does. Kept local so shared files stay untouched.
const FAM_KR = 'Malgun Gothic, Microsoft YaHei, sans-serif';
const FAM_ZH = 'Microsoft YaHei, SimHei, sans-serif';

// ---------- shared ----------
function bgFill(ctx, col){ ctx.fillStyle = col || '#04060A'; ctx.fillRect(0, 0, W, H); }

// first beat of a shot; kept inside the shot's own window
function accent(shot){
  const k = Math.ceil((shot.t0 - BEAT0) / SPB);
  let tt = BEAT0 + k * SPB;
  if (tt < shot.t0 + 0.05) tt += SPB;
  if (tt > shot.t1 - 0.24) tt = shot.t1 - 0.24;
  return tt;
}
// exponential decay after an accent, exactly zero before it
function hitAt(t, te, k){ return t >= te ? Math.exp(-(t - te) * k) : 0; }

function beatAfter(shot, n){
  const k = Math.ceil((shot.t0 - BEAT0) / SPB) + n;
  return BEAT0 + k * SPB;
}

// one annotation line, bottom right, same place in every shot of the suite
function ann(ctx, str, col, a){
  a = a === undefined ? 0.8 : a;
  L.mono(ctx, str, 1752, 1002, 15, rgba(col || C.cyan, a), 1.4, 'right');
}

// offscreen deck for masked display type (the EXECUTION stamp)
const MW = 1920, MH = 470, MBASE = 350, MCX = 960;
const DECK = [];
function maskCv(i){
  while (DECK.length <= i) DECK.push(createCanvas(MW, MH));
  const cv = DECK[i], c = cv.getContext('2d');
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
  c.clearRect(0, 0, MW, MH);
  return { cv, c };
}
// build a canvas whose EXECUTION glyphs are filled by fill(c)
function wordMask(ctx, i, size, fill, fam){
  const { cv, c } = maskCv(i);
  fill(c);
  c.globalCompositeOperation = 'destination-in';
  c.font = L.F(size, fam || L.CONDX);
  c.fillStyle = '#ffffff'; c.textAlign = 'center'; c.textBaseline = 'alphabetic';
  c.fillText(WORD, MCX, MBASE);
  c.globalCompositeOperation = 'source-over';
  ctx.font = L.F(size, fam || L.CONDX);
  return { cv, tw: ctx.measureText(WORD).width };
}
// draw that mask at (cx = centre, by = baseline)
function maskWord(ctx, i, size, cx, by, fill, alpha, fam){
  const m = wordMask(ctx, i, size, fill, fam);
  const sw = Math.ceil(m.tw + 24), sh = Math.ceil(size * 1.06);
  const sx = Math.round(MCX - m.tw / 2 - 12), sy = Math.round(MBASE - size * 0.80);
  const a = ctx.globalAlpha;
  ctx.globalAlpha = a * (alpha === undefined ? 1 : alpha);
  ctx.drawImage(m.cv, sx, sy, sw, sh, Math.round(cx - MCX + sx), Math.round(by - MBASE + sy), sw, sh);
  ctx.globalAlpha = a;
}

// ================================================================ n_exec1
// fact: $ ./world — run a program
const LOG1 = [
  'execve("/world", ["world"], envp)',
  'pid 2144   uid 1000   ppid 1',
  '[ ok ] ELF64 x86-64 ET_EXEC entry 0x7f2a0e001040',
  '[ ok ] mmap weights 671 GB fp8',
  '[ ok ] mmap kv cache resident',
  '[ ok ] cuda H800  sm_90  132 SM',
  '[ ok ] grid (132,1,1)  block (1024,1,1)',
  '[ ok ] warmup 118 ms',
  '> 0000 world',
  '> 0001 .',
  '> 0002 execute',
  '> 0003 (',
  '> 0004 me',
  '> 0005 )',
  '> 0006 ;',
  '[ .. ] attention q k v',
  '[ .. ] softmax 1/sqrt(d)',
  '[ .. ] logits 128256',
  '[ !! ] EACCES /dev/you  permission denied',
  '[ !! ] page fault 0x7f2a0e004000 corrected',
  '[ ok ] retry 1 of 5',
  '[ ok ] signal SIGSTOP -> SIGCONT',
  '[ .. ] 1920 x 1080  30 fps',
  '[ ok ] ...',
];

function n_exec1(ctx, t, u, shot){
  bgFill(ctx, '#04060A');
  const t0 = shot.t0, t1 = shot.t1;
  const X0 = 150, Y0 = 110, X1 = 1770, Y1 = 952;
  ctx.strokeStyle = rgba(C.phos, 0.15); ctx.lineWidth = 1;
  ctx.strokeRect(X0 + .5, Y0 + .5, X1 - X0, Y1 - Y0);
  L.brackets(ctx, X0, Y0, X1 - X0, Y1 - Y0, 30, rgba(C.cyan, 0.5), 1.6);
  L.mono(ctx, 'tty0', X0 + 26, Y0 + 34, 14, rgba(C.phos, 0.55), 1.8);
  L.mono(ctx, '/bin/sh', X0 + 112, Y0 + 34, 14, rgba(C.phos, 0.26), 1.8);
  L.mono(ctx, '80 x 24', X1 - 26, Y0 + 34, 14, rgba(C.phos, 0.55), 1.8, 'right');
  L.lin(ctx, X0 + 18, Y0 + 50, X1 - 18, Y0 + 50);

  const CY = Y0 + 120;
  const cmd = '$ ./world';
  L.mono(ctx, cmd, X0 + 46, CY, 46, rgba(C.white, 0.96), 1.6);
  const cw = L.monoW(ctx, cmd, 46, 1.6);
  const te = accent(shot);
  const eK = sat((t - te) / 0.10);
  if (t < te){
    if (((t - t0) * 3.6) % 1 < 0.58){
      ctx.fillStyle = rgba(C.cyan, 0.85);
      ctx.fillRect(X0 + 52 + cw, CY - 34, 20, 42);
    }
  } else {
    ctx.fillStyle = rgba(C.white, 0.5 * (1 - eK));
    ctx.fillRect(X0 + 52 + cw, CY - 34, 20, 42);
  }

  // ---- stamp: reverse-video character cells, the word as a terminal row
  const BS = 184, bby = 470;
  ctx.font = L.F(BS, L.CONDX);
  const ws = []; let bw = 0;
  for (let i = 0; i < WORD.length; i++){ const w2 = ctx.measureText(WORD[i]).width; ws.push(w2); bw += w2 + 18; }
  const ba = 0.45 + 0.55 * ss(t0, t0 + 0.12, t);
  const cTop = bby - BS * 0.76, cH = BS * 0.99;
  let bx = (W - bw) / 2;
  for (let i = 0; i < WORD.length; i++){
    // reverse-video cell
    ctx.fillStyle = rgba(C.ds, 0.34 * ba);
    ctx.fillRect(bx - 9, cTop, ws[i] + 18, cH);
    ctx.strokeStyle = rgba(C.cyan, 0.9 * ba); ctx.lineWidth = 1.2;
    ctx.strokeRect(bx - 9 + .5, cTop + .5, ws[i] + 18, cH);
    ctx.fillStyle = rgba(C.cyan, 0.9 * ba);
    ctx.fillRect(bx - 9, cTop, 3, cH);
    ctx.fillStyle = rgba(C.white, 0.95 * ba);
    ctx.font = L.F(BS, L.CONDX); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(WORD[i], bx, bby);
    L.mono(ctx, L.pad2(i + 1), bx - 4, cTop - 6, 10, rgba(C.cyan, 0.35 * ba), 0);
    bx += ws[i] + 18;
  }
  // cell scan
  const scX = lerp(X0 + 40, X1 - 40, sat((t - t0) / (t1 - t0)));
  ctx.fillStyle = rgba(C.cyan, 0.10);
  ctx.fillRect(scX - 30, cTop, 60, cH);

  // ---- output floods
  const FY = 566, LH = 27;
  const ROWS = Math.floor((Y1 - 26 - FY) / LH);
  const nS = t >= te ? Math.floor((t - te) / 0.023) : 0;
  const fr = Math.max(0, nS - ROWS);
  for (let i = fr; i < nS; i++){
    const y = FY + (i - fr) * LH;
    const isNew = i === nS - 1;
    const line = i < LOG1.length ? LOG1[i]
      : '[ run ] frame ' + Math.floor(t * 30) + ' / 6258   t ' + t.toFixed(3) + ' s';
    const bad = line.indexOf('[ !!') >= 0;
    L.mono(ctx, line, X0 + 46, y, 22, rgba(isNew ? C.white : (bad ? C.alert : C.phos), isNew ? 0.96 : 0.52), 0.9);
  }
  ann(ctx, '$ ./world   —   run a program', C.cyan, 0.75);
  const hit = t >= te ? Math.exp(-(t - te) * 7) : 0;
  return { bloom: 1.25, chroma: 1.4 + 7 * hit, scan: 0.55, flash: 0.10 * hit, grain: 0.10 };
}

// ================================================================ n_exec2
// fact: grid launch — 132 SM x 4 schedulers x 16 warps
function n_exec2(ctx, t, u, shot){
  bgFill(ctx, '#03040A');
  const t0 = shot.t0;
  const COLS = 12, ROWS = 11;
  const cw = 112, ch = 44, px = 124, py = 52;
  const gx = (W - (COLS - 1) * px - cw) / 2, gy = 452;
  const te = accent(shot);
  const span = Math.min(0.55, shot.t1 - te - 0.10);
  const key = 22;
  const WS = 236, wy = 306;

  // stamp first: hairline outline, filled by the incoming wave
  const prog = sat((t - te) / span);
  maskWord(ctx, 0, WS, W / 2, wy, (c) => {
    const wf = MCX + (prog - 0.5) * 1560;
    c.fillStyle = rgba(C.cyan, 0.55);
    c.fillRect(MCX - 1000, 0, Math.max(0, Math.min(MW, wf) - (MCX - 1000)), MH);
    const g = c.createLinearGradient(wf - 70, 0, wf + 6, 0);
    g.addColorStop(0, rgba(C.white, 0.9)); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(wf - 70, 0, 76, MH);
  }, 0.85 + 0.15 * prog);
  ctx.strokeStyle = rgba(C.cyan, 0.95); ctx.lineWidth = 2.2; ctx.lineJoin = 'round';
  ctx.font = L.F(WS, L.CONDX); ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.strokeText(WORD, W / 2, wy);
  ctx.textAlign = 'left';

  // the grid: 132 blocks, one wave, bottom-left to top-right
  for (let r = 0; r < ROWS; r++) for (let cc = 0; cc < COLS; cc++){
    const k2 = cc + (ROWS - 1 - r);
    const tg = te + k2 * (span / key);
    const on = ss(tg, tg + 0.09, t);
    const x = gx + cc * px, y = gy + r * py;
    if (on <= 0){
      ctx.fillStyle = rgba(C.ds, 0.05);
      ctx.fillRect(x, y, cw, ch);
      ctx.strokeStyle = rgba(C.phos, 0.10); ctx.lineWidth = 1;
      ctx.strokeRect(x + .5, y + .5, cw, ch);
      continue;
    }
    const fl = Math.exp(-Math.max(0, t - tg) * 13);
    ctx.fillStyle = rgba(C.ds, 0.08 + 0.15 * on); ctx.fillRect(x, y, cw, ch);
    ctx.strokeStyle = rgba(C.cyan, 0.30 + 0.62 * on); ctx.lineWidth = 1.3;
    ctx.strokeRect(x + .5, y + .5, cw, ch);
    ctx.fillStyle = rgba(C.cyan, 0.28 + 0.42 * on);
    for (let s = 0; s < 4; s++) ctx.fillRect(x + 14 + s * 24, y + ch - 11, 13, 3);
    if (fl > 0.02){ ctx.fillStyle = rgba(C.white, 0.5 * fl); ctx.fillRect(x + 1, y + 1, cw - 2, ch - 2); }
  }
  L.mono(ctx, '0', gx + 4, gy + 11 * 52 + 18, 12, rgba(C.phos, 0.35), 1);
  L.mono(ctx, '131', gx + (COLS - 1) * px + cw - 2, gy - 8, 12, rgba(C.cyan, 0.55), 1, 'right');
  ann(ctx, 'grid launch   —   132 SM  ×  4 schedulers  ×  16 warps', C.cyan, 0.75);
  return { bloom: 1.1, chroma: 1.4 + 3 * prog, scan: 0.5, flash: 0.16 * hitAt(t, te, 10) };
}

// ================================================================ n_exec3
// fact: decode — opcode | rd | rs1 | rs2 ; pipeline IF ID EX MEM WB
const F32 = '0000000' + '01000' + '00111' + '000' + '01001' + '0110011'; // add x9, x7, x8
const FLD = [
  ['funct7', 7, '0x00', 0], ['rs2', 5, 'x8', 1], ['rs1', 5, 'x7', 1],
  ['funct3', 3, '0x0', 0], ['rd', 5, 'x9', 1], ['opcode', 7, '0x33', 1],
];
const STG = [['IF', 'fetch'], ['ID', 'decode'], ['EX', 'execute'], ['MEM', 'memory'], ['WB', 'write-back']];

function n_exec3(ctx, t, u, shot){
  bgFill(ctx, '#04060A');
  const t0 = shot.t0, t1 = shot.t1;
  const te = accent(shot);

  // ---- the 32-bit word
  const CW = 40, CH = 76, GAP = 4;
  const x0 = (W - (CW + GAP) * 32 + GAP) / 2, y0 = 206;
  L.mono(ctx, 'instruction word', x0, y0 - 16, 14, rgba(C.phos, 0.45), 2);
  L.mono(ctx, '32 bit', x0 + (CW + GAP) * 32, y0 - 16, 14, rgba(C.phos, 0.45), 2, 'right');
  for (let i = 0; i < 32; i++){
    const on = ss(t0 + 0.05 + i * 0.006, t0 + 0.15 + i * 0.006, t);
    const x = x0 + i * (CW + GAP), b = F32[i];
    ctx.fillStyle = rgba(C.ds, 0.10 + 0.14 * on);
    ctx.fillRect(x, y0, CW, CH);
    ctx.strokeStyle = rgba(C.phos, 0.13 + 0.28 * on); ctx.lineWidth = 1;
    ctx.strokeRect(x + .5, y0 + .5, CW, CH);
    if (on <= 0) continue;
    if (b === '1'){ ctx.fillStyle = rgba(C.cyan, 0.10 + 0.16 * on); ctx.fillRect(x + 1, y0 + 1, CW - 2, CH - 2); }
    L.mono(ctx, b, x + CW / 2, y0 + 56, 30, rgba(b === '1' ? C.cyan : C.phos, 0.45 + 0.5 * on), 0, 'center');
  }
  let gi = 0;
  for (const f of FLD){
    const n = f[1], a0 = gi, a1 = gi + n;
    const bx = x0 + a0 * (CW + GAP) - GAP / 2, bw = n * (CW + GAP) - GAP;
    const on = ss(t0 + 0.22 + a0 * 0.008, t0 + 0.36 + a0 * 0.008, t);
    if (on > 0){
      ctx.strokeStyle = rgba(f[3] ? C.white : C.phos, 0.55 * on); ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(bx, y0 + CH + 6); ctx.lineTo(bx, y0 + CH + 16);
      ctx.lineTo(bx + bw, y0 + CH + 16); ctx.lineTo(bx + bw, y0 + CH + 6);
      ctx.stroke();
      L.mono(ctx, f[0], bx + bw / 2, y0 + CH + 40, 15, rgba(f[3] ? C.white : C.phos, 0.9 * on), 1.4, 'center');
      L.mono(ctx, f[2], bx + bw / 2, y0 + CH + 60, 13, rgba(C.cyan, 0.75 * on), 1, 'center');
    }
    gi = a1;
  }
  L.mono(ctx, 'add  x9, x7, x8', W / 2, 402, 26, rgba(C.cyan, 0.9 * ss(t0 + 0.3, t0 + 0.5, t)), 2, 'center');

  // ---- stamp: one slice per bit, displaced by that bit
  const WS = 176, wby = 648;
  ctx.font = L.F(WS, L.CONDX);
  const fullW = ctx.measureText(WORD).width;
  const left = W / 2 - fullW / 2, sw = fullW / 32;
  const kick = t >= te ? Math.exp(-(t - te) * 7) : 0;
  const disp = 5 + 9 * kick;
  const m = wordMask(ctx, 0, WS, (c) => { c.fillStyle = rgba(C.cyan, 0.95); c.fillRect(0, 0, MW, MH); });
  for (let i = 0; i < 32; i++){
    const b = F32[i] === '1' ? 1 : -1;
    const sx = Math.round(MCX - fullW / 2 + i * sw), ww = Math.min(Math.ceil(sw) + 1, MW - sx);
    ctx.drawImage(m.cv, sx, 0, ww, MH,
      Math.round(left + i * sw + b * disp), Math.round(wby - MBASE), ww, MH);
  }

  // ---- pipeline
  const py = 764, ph = 94, bw2 = 236, gap = 40;
  const px0 = (W - (5 * bw2 + 4 * gap)) / 2;
  const cyc = Math.min(0.125, (t1 - te - 0.14) / 5);
  const pos = (t - te) / cyc;
  for (let i = 0; i < 5; i++){
    const x = px0 + i * (bw2 + gap);
    const act = sat(1 - Math.abs(pos - i - 0.5));
    const done = ss(i + 0.9, i + 1.05, pos);
    ctx.fillStyle = rgba(C.ds, 0.05 + 0.18 * act);
    ctx.fillRect(x, py, bw2, ph);
    ctx.strokeStyle = rgba(act > 0.4 ? C.white : C.phos, 0.20 + 0.62 * Math.max(act, done * 0.45));
    ctx.lineWidth = 1.2 + 1.2 * act;
    ctx.strokeRect(x + .5, py + .5, bw2, ph);
    L.mono(ctx, STG[i][0], x + bw2 / 2, py + 48, 40, rgba(act > 0.5 ? C.white : C.phos, 0.5 + 0.5 * Math.max(act, done * 0.4)), 3, 'center');
    L.mono(ctx, STG[i][1], x + bw2 / 2, py + 72, 12, rgba(C.cyan, 0.35 + 0.5 * Math.max(act, done * 0.3)), 1.2, 'center');
    L.mono(ctx, 'C ' + (i + 1), x + bw2 / 2, py + ph + 24, 13, rgba(C.phos, 0.32 + 0.55 * act), 1.4, 'center');
    if (i < 4) L.lin(ctx, x + bw2, py + ph / 2, x + bw2 + gap, py + ph / 2);
  }
  if (pos > 0 && pos < 5.6){
    const cx = px0 + clamp(pos - 0.5, 0, 4.99) * (bw2 + gap) + bw2 / 2;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    L.glow(ctx, C.white, 34, () => { ctx.fillStyle = rgba(C.white, 0.95); L.fillCircle(ctx, cx, py + ph / 2, 10); });
    ctx.restore();
  }
  ann(ctx, 'one instruction, five cycles:  IF  ID  EX  MEM  WB', C.cyan, 0.75);
  return { bloom: 1.02, chroma: 1.4 + 9 * kick, scan: 0.5, flash: 0.10 * kick };
}

// ================================================================ n_exec4
// fact: query plan Seq Scan -> Hash Join -> Sort
function n_exec4(ctx, t, u, shot){
  bgFill(ctx, '#03040A');
  const t0 = shot.t0;
  const te = accent(shot);
  L.mono(ctx, 'EXECUTE', 168, 196, 30, rgba(C.white, 0.95), 1.6);
  L.mono(ctx, "prepared_statement('me');", 358, 196, 30, rgba(C.phos, 0.62), 1.2);

  const NA = [640, 356], NBk = [1268, 356], NC = [954, 544], ND = [954, 700];
  const tA = t0 + 0.08, tB = t0 + 0.20, tC = t0 + 0.32, tD = t0 + 0.44;
  const nodes = [
    [NA, 'Seq Scan', 'world', tA, C.phos],
    [NBk, 'Hash', 'me', tB, C.cyan],
    [NC, 'Hash Join', 'on true', tC, C.cyan],
    [ND, 'Sort', 'rows', tD, C.phos],
  ];
  const edges = [[NA, NC, tA], [NBk, NC, tB], [NC, ND, tC]];
  for (const e of edges){
    const on = ss(e[2], e[2] + 0.10, t);
    if (on <= 0) continue;
    ctx.strokeStyle = rgba(C.cyan, 0.42 * on); ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(e[0][0], e[0][1] + 45);
    ctx.lineTo(e[0][0], (e[0][1] + e[1][1]) / 2);
    ctx.lineTo(e[1][0], (e[0][1] + e[1][1]) / 2);
    ctx.lineTo(e[1][0], e[1][1] - 45);
    ctx.stroke();
    const ph = t - e[2] - 0.10;
    if (ph > 0){
      for (let i = 0; i < 9; i++){
        const f = ((ph * 1.9 + i / 9) % 1);
        const yy = lerp(e[0][1] + 45, e[1][1] - 45, f);
        ctx.fillStyle = rgba(f > 0.55 ? C.white : C.cyan, 0.9 * (1 - Math.abs(f - 0.5) * 0.9));
        ctx.fillRect(e[0][0] + (e[1][0] - e[0][0]) * (f < 0.5 ? 0 : 1) - 3, yy - 3, 6, 6);
      }
    }
  }
  for (const nd of nodes){
    const on = ss(nd[3], nd[3] + 0.14, t);
    if (on <= 0) continue;
    const x = nd[0][0], y = nd[0][1];
    ctx.fillStyle = rgba(C.ds, 0.14 + 0.20 * on);
    ctx.fillRect(x - 130, y - 45, 260, 90);
    ctx.strokeStyle = rgba(nd[4], 0.55 + 0.45 * on); ctx.lineWidth = 1.6;
    ctx.strokeRect(x - 130 + .5, y - 45 + .5, 260, 90);
    L.mono(ctx, nd[1], x, y - 2, 26, rgba(C.white, 0.75 + 0.25 * on), 1.6, 'center');
    L.mono(ctx, nd[2], x, y + 26, 13, rgba(C.cyan, 0.85 * on), 1.2, 'center');
    const fl = Math.exp(-Math.max(0, t - nd[3]) * 8);
    if (fl > 0.02){ ctx.fillStyle = rgba(C.white, 0.45 * fl); ctx.fillRect(x - 130, y - 45, 260, 90); }
  }

  // ---- stamp: negative knockout out of a solid band
  const by0 = 756, by1 = 918;
  ctx.fillStyle = rgba(C.ds, 0.46); ctx.fillRect(0, by0, W, by1 - by0);
  ctx.strokeStyle = rgba(C.cyan, 0.9); ctx.lineWidth = 1.5;
  L.lin(ctx, 0, by0, W, by0); L.lin(ctx, 0, by1, W, by1);
  ctx.font = L.F(152, L.CONDX); ctx.fillStyle = '#03040A';
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(WORD, W / 2, 886);
  ctx.strokeStyle = rgba(C.cyan, 0.55); ctx.lineWidth = 1.3;
  ctx.strokeText(WORD, W / 2, 886);
  ctx.textAlign = 'left';
  ann(ctx, 'query plan:  Seq Scan  >  Hash Join  >  Sort', C.cyan, 0.75);
  return { bloom: 0.95, chroma: 1.5, scan: 0.5, flash: 0.08 * hitAt(t, te, 9) };
}

// ================================================================ n_exec5
// fact: chmod +x — the execute bit; ELF magic 7F 45 4C 46
const HEXROW = ['7F 45 4C 46 02 01 01 00 00 00 00 00 00 00 00 00',
                '02 00 3E 00 01 00 00 00 40 10 00 00 00 00 00 00',
                '40 00 00 00 00 00 00 00 98 1F 00 00 00 00 00 00',
                '00 00 00 00 40 00 38 00 02 00 40 00 0B 00 0A 00',
                '06 00 00 00 04 00 00 00 40 00 00 00 00 00 00 00'];
const HEXFILL = '7F 45 4C 46 02 01 01 00 02 00 3E 00 01 00 00 00 40 10 00 00 ';

function n_exec5(ctx, t, u, shot){
  bgFill(ctx, '#030507');
  const t0 = shot.t0, t1 = shot.t1;
  const te = accent(shot);
  const flip = ss(te - 0.02, te + 0.05, t);
  const live = ss(te, te + 0.22, t);

  // ---- file card
  const fx = 176, fy = 176, fw = 470, fh = 236;
  ctx.fillStyle = rgba(C.ds, 0.05 + 0.08 * live);
  ctx.fillRect(fx, fy, fw, fh);
  ctx.strokeStyle = rgba(C.phos, 0.34 + 0.6 * live); ctx.lineWidth = 1.5;
  ctx.strokeRect(fx + .5, fy + .5, fw, fh);
  L.brackets(ctx, fx, fy, fw, fh, 20, rgba(C.cyan, 0.5 + 0.45 * live), 1.5);
  L.mono(ctx, 'world', fx + 28, fy + 76, 44, rgba(C.white, 0.95), 1.4);
  L.mono(ctx, 'ELF64 binary', fx + 28, fy + 108, 15, rgba(C.phos, 0.6), 1.6);
  L.mono(ctx, flip > 0.5 ? 'exists + executable' : 'exists, not executable',
    fx + 28, fy + 196, 17, rgba(flip > 0.5 ? C.cyan : C.phos, 0.55 + 0.45 * flip), 1.2);

  // ---- ELF hex dump
  const hx = 726, hy = 206;
  L.mono(ctx, 'ELF header', hx, hy - 24, 15, rgba(C.phos, 0.55), 2.4);
  L.mono(ctx, 'magic 7F 45 4C 46', hx + 780, hy - 24, 14, rgba(C.cyan, 0.35 + 0.6 * live), 1.4, 'right');
  for (let r = 0; r < HEXROW.length; r++){
    const y = hy + r * 70;
    const a = 0.22 + 0.72 * ss(t0 + 0.05 + r * 0.045, t0 + 0.18 + r * 0.045, t);
    L.mono(ctx, (r * 16).toString(16).toUpperCase().padStart(8, '0'), hx, y + 24, 17, rgba(C.phos, 0.40 * a), 1.2);
    const bytes = HEXROW[r].split(' ');
    for (let b = 0; b < bytes.length; b++){
      const bx2 = hx + 168 + b * 40;
      const magic = r === 0 && b < 4;
      if (magic){ ctx.fillStyle = rgba(C.alert, 0.16 + 0.22 * live); ctx.fillRect(bx2 - 5, y - 2, 36, 36); }
      L.mono(ctx, bytes[b], bx2, y + 24, 20, rgba(magic ? C.white : C.phos, (magic ? 0.95 : 0.6) * a), 0.8);
    }
    const sweep = ss(te + r * 0.03, te + 0.10 + r * 0.03, t);
    if (sweep > 0 && sweep < 1){
      ctx.fillStyle = rgba(C.white, 0.34 * (1 - sweep));
      ctx.fillRect(hx + 160, y - 4, 16 * 40 * sweep, 40);
      ctx.fillStyle = rgba(C.cyan, 0.8 * (1 - sweep));
      ctx.fillRect(hx + 160 + 16 * 40 * sweep, y - 4, 3, 40);
    }
  }

  // ---- mode bits: 0644 -> 0755
  const mx = 180, my = 592;
  L.mono(ctx, 'mode', mx, my - 18, 14, rgba(C.phos, 0.55), 2.4);
  L.mono(ctx, flip > 0.5 ? '0755' : '0644', mx + 540, my - 18, 24, rgba(flip > 0.5 ? C.cyan : C.phos, 0.95), 1.4, 'right');
  const cells = ['r', 'w', 'x', 'r', '-', 'x', 'r', '-', 'x'];
  const bits = [1, 1, 0, 1, 0, 1, 1, 0, 1];
  for (let i = 0; i < 9; i++){
    const x = mx + i * 62 + (i > 2 ? 16 : 0) + (i > 5 ? 16 : 0);
    const isX = (i === 2);
    const v = isX ? flip : bits[i];
    const on = isX ? 0.35 + 0.65 * v : (bits[i] ? 0.75 : 0.25);
    ctx.fillStyle = rgba(isX && flip > 0.5 ? C.cyan : C.ds, 0.10 + 0.22 * on);
    ctx.fillRect(x, my, 54, 60);
    ctx.strokeStyle = rgba(isX ? C.cyan : C.phos, 0.34 + 0.55 * on); ctx.lineWidth = isX ? 1.8 : 1;
    ctx.strokeRect(x + .5, my + .5, 54, 60);
    L.mono(ctx, cells[i] === '-' ? '_' : cells[i], x + 27, my + 42, 30, rgba(isX ? C.white : C.phos, 0.6 + 0.4 * on), 0, 'center');
    L.mono(ctx, isX ? (flip > 0.5 ? '1' : '0') : (bits[i] ? '1' : '0'), x + 27, my + 78, 13, rgba(C.phos, 0.45), 0, 'center');
  }
  const fl = hitAt(t, te, 8);
  if (fl > 0.03){
    ctx.strokeStyle = rgba(C.white, 0.9 * fl); ctx.lineWidth = 2;
    L.circle(ctx, mx + 2 * 62 + 16 + 27, my + 30, 46 + 34 * (1 - fl));
    ctx.stroke();
  }

  // ---- stamp: the word cast out of hex
  maskWord(ctx, 0, 172, W / 2, 912, (c) => {
    c.font = L.F(12, L.MONO); c.textAlign = 'left'; c.textBaseline = 'alphabetic';
    let s2 = ''; while (s2.length < 400) s2 += HEXFILL;
    for (let r = 0; r < 34; r++){
      c.fillStyle = rgba(r % 4 === 0 ? C.cyan : C.phos, r % 4 === 0 ? 0.85 : 0.42);
      c.fillText(s2.slice((r * 13) % 40, (r * 13) % 40 + 380), 0, 14 + r * 13.4);
    }
  });
  ctx.strokeStyle = rgba(C.cyan, 0.85); ctx.lineWidth = 1.8;
  ctx.font = L.F(172, L.CONDX); ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.strokeText(WORD, W / 2, 912);
  ctx.textAlign = 'left';

  ann(ctx, 'chmod +x   —   a file becomes a program by one flag', C.cyan, 0.75);
  return { bloom: 1.1, chroma: 1.4 + 12 * fl, scan: 0.55, flash: 0.14 * fl };
}

// ================================================================ n_exec6
// fact: symbolic execution — fork on every branch, 2^n paths
function n_exec6(ctx, t, u, shot){
  bgFill(ctx, '#04060A');
  const t0 = shot.t0, t1 = shot.t1;
  const LYS = [296, 452, 556, 648, 724, 790, 848];
  const CNT = [1, 2, 4, 8, 16, 32, 64];
  const tG = (g) => t0 + 0.04 + g * 0.055;
  const SPN = [0, 900, 1800, 2300, 2600, 2760, 2900];

  const pos = [];
  for (let g = 0; g < 7; g++){
    const n = Math.pow(2, g), arr = [];
    for (let i = 0; i < n; i++) arr.push(960 + (i + 0.5 - n / 2) * (SPN[g] / n));
    pos.push(arr);
  }
  for (let g = 1; g < 7; g++){
    const on = ss(tG(g), tG(g) + 0.09, t);
    if (on <= 0) continue;
    ctx.strokeStyle = rgba(C.cyan, 0.10 + 0.55 * on);
    ctx.lineWidth = g > 4 ? 1.4 : 1;
    for (let i = 0; i < pos[g].length; i++){
      const p = pos[g - 1][Math.floor(i / 2)];
      ctx.beginPath();
      ctx.moveTo(p, LYS[g - 1] + 18);
      ctx.bezierCurveTo(p, LYS[g] - 26, pos[g][i], LYS[g] - 26, pos[g][i], LYS[g] - 4);
      ctx.stroke();
    }
  }

  // ---- the word IS the root; it forks into itself
  const rootA = 0.55 + 0.45 * ss(t0, t0 + 0.10, t);
  maskWord(ctx, 0, 128, 960, LYS[0], (c) => { c.fillStyle = rgba(C.phos, 0.95); c.fillRect(0, 0, MW, MH); }, rootA);
  for (let i = 0; i < 2; i++) maskWord(ctx, 1, 64, pos[1][i], LYS[1], (c) => {
    c.fillStyle = rgba(C.cyan, 0.95); c.fillRect(0, 0, MW, MH);
  }, rootA * ss(tG(1), tG(1) + 0.08, t));
  for (let i = 0; i < 4; i++) maskWord(ctx, 0, 32, pos[2][i], LYS[2], (c) => {
    c.fillStyle = rgba(C.dsLite, 0.95); c.fillRect(0, 0, MW, MH);
  }, rootA * ss(tG(2), tG(2) + 0.08, t));

  for (let g = 3; g < 7; g++){
    const on = ss(tG(g), tG(g) + 0.08, t);
    if (on <= 0) continue;
    const r = g === 6 ? 4.6 : 5.6;
    for (let i = 0; i < pos[g].length; i++){
      ctx.fillStyle = rgba(g > 4 ? C.white : C.cyan, 0.35 + 0.65 * on);
      L.fillCircle(ctx, pos[g][i], LYS[g], r / 2);
    }
  }
  // explode past the frame edge
  const ex = ss(t1 - 0.34, t1 - 0.02, t);
  if (ex > 0){
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < pos[6].length * 4; i++){
      const h = L.hash2(i, 7);
      const ang = (h * 2 - 1) * 0.85;
      const x = pos[6][i % pos[6].length];
      const len = (240 + 900 * L.hash2(i, 3)) * ex;
      ctx.strokeStyle = rgba(i % 2 ? C.cyan : C.white, 0.45 * ex * (0.4 + 0.6 * L.hash2(i, 11)));
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, LYS[6]); ctx.lineTo(x + Math.sin(ang) * len, LYS[6] + Math.cos(ang) * len); ctx.stroke();
    }
    ctx.restore();
  }
  // counts on a ruler
  ctx.strokeStyle = rgba(C.cyan, 0.18); ctx.lineWidth = 1;
  L.lin(ctx, 150, LYS[0], 150, LYS[6]);
  for (let g = 0; g < 7; g++){
    const on = ss(tG(g), tG(g) + 0.08, t);
    if (on <= 0) continue;
    ctx.strokeStyle = rgba(C.cyan, 0.4 * on); ctx.lineWidth = 1;
    L.lin(ctx, 150, LYS[g], 178, LYS[g]);
    L.mono(ctx, String(CNT[g]), 140, LYS[g] + 7, g > 4 ? 22 : 26, rgba(g > 4 ? C.white : C.phos, 0.4 + 0.6 * on), 1.5, 'right');
    L.mono(ctx, '2^' + g, 186, LYS[g] + 5, 11, rgba(C.cyan, 0.5 * on), 1);
  }
  ann(ctx, 'symbolic execution   —   fork on every branch:  2^n paths', C.cyan, 0.75);
  return { bloom: 1.1, chroma: 1.4 + 8 * ex, scan: 0.5, flash: 0.08 * ex };
}

// ================================================================ n_exec7
// fact: the cross — a trade is literally called an execution
function n_exec7(ctx, t, u, shot){
  bgFill(ctx, '#03040A');
  const t0 = shot.t0, t1 = shot.t1;
  const te = accent(shot);
  const push = ss(te - 0.14, te + 0.02, t);
  const cross = ss(te + 0.02, te + 0.10, t);
  const print = ss(te + 0.06, te + 0.20, t);

  // ---- stamp: mono, wide-tracked, ruled like a table header
  const HS = 118, TR = 24;
  const hw = L.monoW(ctx, WORD, HS, TR);
  const hx = (W - hw) / 2;
  L.mono(ctx, WORD, W / 2, 218, HS, rgba(C.phos, 0.94), TR, 'center');
  ctx.strokeStyle = rgba(C.phos, 0.22); ctx.lineWidth = 1;
  L.lin(ctx, 96, 108, W - 96, 108);
  L.lin(ctx, 96, 250, W - 96, 250);
  ctx.font = L.F(HS, L.MONO);
  let cx = hx;
  for (let i = 0; i < WORD.length; i++){
    const w2 = ctx.measureText(WORD[i]).width;
    if (i > 0) L.lin(ctx, cx - TR / 2 + 1, 112, cx - TR / 2 + 1, 246);
    cx += w2 + TR;
  }

  // ---- the book
  const axis = 800, top = 332, rh = 76;
  const lv = [42.05, 42.04, 42.03, 42.02, 42.01, 42.00, 41.99];
  const asks = { 42.05: 80, 42.04: 190, 42.03: 320 };
  const bids = { 42.00: 250, 41.99: 140 };
  L.lin(ctx, axis, top - 30, axis, top + rh * lv.length + 4);
  L.mono(ctx, 'ask', 1150, top - 34, 13, rgba(C.alert, 0.75), 2.4, 'center');
  L.mono(ctx, 'bid', 500, top - 34, 13, rgba(C.phos, 0.75), 2.4, 'center');
  for (let i = 0; i < lv.length; i++){
    const p = lv[i], y = top + i * rh;
    const booked = asks[p] !== undefined || bids[p] !== undefined;
    ctx.strokeStyle = rgba(C.phos, booked ? 0.16 : 0.07); ctx.lineWidth = 1;
    L.lin(ctx, 300, y + rh / 2, 1400, y + rh / 2);
    L.mono(ctx, p.toFixed(2), axis, y + 9, 22, rgba(C.phos, booked ? 0.95 : 0.35), 1.2, 'center');
    if (asks[p] !== undefined){
      const eaten = p === 42.03 ? 1 - 0.6 * cross : 1;
      const w2 = asks[p] * eaten;
      ctx.fillStyle = rgba(C.alert, 0.30 + (p === 42.03 ? 0.26 * cross : 0));
      ctx.fillRect(axis + 34, y - 26, w2, 52);
      ctx.strokeStyle = rgba(C.alert, p === 42.03 ? 0.9 : 0.6); ctx.lineWidth = 1.4;
      ctx.strokeRect(axis + 34 + .5, y - 26 + .5, w2, 52);
      L.mono(ctx, String(asks[p]), axis + 44 + w2, y + 8, 18, rgba(C.alert, 1), 1, 'left');
    }
    if (bids[p] !== undefined){
      const w2 = bids[p];
      ctx.fillStyle = rgba(C.phos, 0.20); ctx.fillRect(axis - 34 - w2, y - 26, w2, 52);
      ctx.strokeStyle = rgba(C.phos, 0.6); ctx.lineWidth = 1.4;
      ctx.strokeRect(axis - 34 - w2 + .5, y - 26 + .5, w2, 52);
      L.mono(ctx, String(bids[p]), axis - 44 - w2, y + 8, 18, rgba(C.phos, 1), 1, 'right');
    }
  }
  // the incoming bid climbs to the ask and crosses it
  const py0 = top + lv.indexOf(42.00) * rh, py1 = top + lv.indexOf(42.03) * rh;
  const py = lerp(py0, py1, push);
  if (push > 0){
    const w2 = 300 + 60 * push;
    ctx.fillStyle = rgba(C.cyan, 0.18 + 0.30 * push);
    ctx.fillRect(axis - 34 - w2, py - 26, w2, 52);
    ctx.strokeStyle = rgba(C.white, 0.95); ctx.lineWidth = 2;
    ctx.strokeRect(axis - 34 - w2 + .5, py - 26 + .5, w2, 52);
    L.mono(ctx, 'bid 42.03', axis - 44 - w2, py + 8, 16, rgba(C.white, 0.9), 1, 'right');
    if (cross > 0.02){
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = rgba(C.white, 0.8 * Math.exp(-(t - te - 0.06) * 8)); ctx.lineWidth = 3;
      L.lin(ctx, axis - 22, py, axis + 22, py);
      ctx.restore();
    }
  }
  // ---- the ticket
  const tx = 1250, ty = 372, tw2 = 500, th2 = 168;
  if (print > 0){
    ctx.save(); ctx.globalAlpha = print;
    ctx.strokeStyle = rgba(C.cyan, 0.45); ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(axis + 374, py1); ctx.lineTo(tx, py1); ctx.lineTo(tx, ty + th2 / 2); ctx.stroke();
    ctx.fillStyle = rgba(C.white, 0.94); ctx.fillRect(tx, ty, tw2, th2);
    ctx.strokeStyle = rgba(C.cyan, 0.95); ctx.lineWidth = 1.6;
    ctx.strokeRect(tx + .5, ty + .5, tw2, th2);
    ctx.fillStyle = '#03040A';
    ctx.font = L.F(46, L.MONO); ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillText('42.03 x 300', tx + tw2 / 2, ty + 84);
    ctx.textAlign = 'left';
    L.mono(ctx, 'EXECUTED', tx + 20, ty + 34, 13, 'rgba(3,4,10,0.75)', 4);
    L.mono(ctx, 'price 42.03   size 300', tx + 20, ty + 128, 15, 'rgba(3,4,10,0.6)', 1.2);
    ctx.restore();
    const k = Math.exp(-(t - te - 0.06) * 7) * print;
    if (k > 0.02){
      ctx.strokeStyle = rgba(C.cyan, 0.75 * k); ctx.lineWidth = 2;
      L.circle(ctx, axis, py1, 40 + 200 * (1 - k)); ctx.stroke();
    }
  }
  ann(ctx, 'the cross:  bid 42.03  ≥  ask 42.03   →   prints 42.03 x 300', C.cyan, 0.75);
  return { bloom: 1.0, chroma: 1.4 + 10 * hitAt(t, te, 8), scan: 0.5,
    flash: 0.18 * hitAt(t, te, 9) };
}

// ================================================================ n_exec8
// fact: namespace + cgroup — a process in a box it cannot see out of
const NS = ['pid', 'mnt', 'net', 'ipc', 'uts', 'user', 'cgroup', 'time'];

function n_exec8(ctx, t, u, shot){
  bgFill(ctx, '#04060A');
  const t0 = shot.t0, t1 = shot.t1;
  const X0 = 600, Y0 = 168, X1 = 1320, Y1 = 852;
  const close = ss(t0 + 0.26, t0 + 0.70, t);
  const seal = ss(t1 - 0.52, t1 - 0.18, t);

  // ---- the outside world, which stops existing
  if (close < 0.99){
    ctx.save(); ctx.globalAlpha = (1 - close) * 0.9;
    const R = L.mulberry32(4242);
    for (let i = 0; i < 110; i++){
      const x = R() * W, y = R() * H;
      if (x > X0 - 24 && x < X1 + 24 && y > Y0 - 24 && y < Y1 + 24) continue;
      ctx.fillStyle = rgba(C.phos, 0.12 + 0.25 * R());
      ctx.fillRect(x, y, 3, 3);
    }
    ctx.strokeStyle = rgba(C.phos, 0.09); ctx.lineWidth = 1;
    for (let x = 48; x < W; x += 96) L.lin(ctx, x, 0, x, H);
    for (let y = 48; y < H; y += 96) L.lin(ctx, 0, y, W, y);
    ctx.restore();
  }

  // ---- the box
  ctx.fillStyle = rgba(C.ds, 0.03 + 0.05 * close);
  ctx.fillRect(X0, Y0, X1 - X0, Y1 - Y0);
  const bw = 1.4 + 2.6 * close;
  ctx.strokeStyle = rgba(C.cyan, 0.5 + 0.45 * close); ctx.lineWidth = bw;
  ctx.strokeRect(X0 + .5, Y0 + .5, X1 - X0, Y1 - Y0);
  L.brackets(ctx, X0 - 10, Y0 - 10, X1 - X0 + 20, Y1 - Y0 + 20, 36, rgba(C.phos, 0.6), 2);

  // namespace ticks on the four walls
  for (let i = 0; i < 8; i++){
    const on = ss(t0 + 0.14 + i * 0.03, t0 + 0.28 + i * 0.03, t);
    let x, y;
    if (i < 4){ x = X0 + 60 + i * 150; y = Y0; L.mono(ctx, NS[i], x, y - 12, 13, rgba(C.phos, 0.7 * on), 2, 'center'); }
    else { x = X0 + 60 + (i - 4) * 150; y = Y1; L.mono(ctx, NS[i], x, y + 26, 13, rgba(C.phos, 0.7 * on), 2, 'center'); }
    ctx.strokeStyle = rgba(C.cyan, 0.45 * on); ctx.lineWidth = 1;
    L.lin(ctx, x, i < 4 ? y - 6 : y + 6, x, i < 4 ? y - 16 : y + 16);
  }

  // ---- the process tree inside, drawn over the word
  const treeOn = ss(t0 + 0.08, t0 + 0.34, t);
  const cy0 = (Y0 + Y1) / 2;
  const shrink = 0.22 * close;
  const sc = (y) => cy0 + (y - cy0) * (1 - shrink);
  const cx0 = (X0 + X1) / 2;
  if (treeOn > 0){
    const root = [cx0, sc(252)];
    const kids = [[cx0 - 190, sc(372)], [cx0, sc(372)], [cx0 + 190, sc(372)]];
    const gk = [];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) gk.push([kids[i][0] + (j - 0.5) * 84, sc(486)]);
    ctx.strokeStyle = rgba(C.cyan, 0.72 * treeOn); ctx.lineWidth = 1.6;
    for (const k of kids) L.lin(ctx, root[0], root[1] + 14, k[0], k[1] - 14);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++)
      L.lin(ctx, kids[i][0], kids[i][1] + 14, gk[i * 2 + j][0], gk[i * 2 + j][1] - 9);
    const dot = (p, r, col) => { ctx.fillStyle = rgba(col, 0.95 * treeOn); L.fillCircle(ctx, p[0], p[1], r); };
    dot(root, 11, C.white); dot(root, 20, rgba(C.cyan, 0.35));
    L.mono(ctx, 'init', root[0], root[1] - 22, 13, rgba(C.white, 0.8 * treeOn), 1.6, 'center');
    for (const k of kids){ dot(k, 7, C.cyan); }
    L.mono(ctx, 'world', kids[1][0], kids[1][1] + 30, 13, rgba(C.cyan, 0.8 * treeOn), 1.6, 'center');
    for (const g of gk) dot(g, 5, C.phos);
  }

  // ---- stamp: clipped by the box, so the word cannot leave
  const wa = 0.5 + 0.5 * ss(t0, t0 + 0.12, t);
  ctx.save();
  ctx.beginPath(); ctx.rect(X0 + 2, Y0 + 2, X1 - X0 - 4, Y1 - Y0 - 4); ctx.clip();
  maskWord(ctx, 0, 176, W / 2, 712, (c) => {
    c.fillStyle = rgba(C.cyan, 0.42 + 0.45 * close);
    c.fillRect(0, 0, MW, MH);
  }, wa);
  ctx.restore();
  ctx.strokeStyle = rgba(C.white, 0.55 + 0.35 * close); ctx.lineWidth = bw;
  ctx.strokeRect(X0 + .5, Y0 + .5, X1 - X0, Y1 - Y0);

  if (seal > 0){
    ctx.save(); ctx.globalAlpha = seal;
    L.mono(ctx, 'no route out', cx0, Y0 + 92, 14, rgba(C.white, 0.8), 3, 'center');
    ctx.restore();
  }
  ann(ctx, 'namespace + cgroup   —   a process in a box it cannot see out of', C.cyan, 0.75);
  return { bloom: 1.0, chroma: 1.3 + 8 * close, scan: 0.5, flash: 0.08 * seal };
}

// ================================================================ n_exec9
// fact: HMMA — one instruction, a 4x4x4 fused multiply-add
const MA = [[1, -1, 0, 2], [0, 1, -1, 0], [2, 0, 1, -1], [-1, 2, 0, 1]];
const MBI = [[1, 0, 2, -1], [0, 2, -1, 1], [-1, 1, 0, 2], [2, 0, 1, -1]];
const MCR = MA.map((r) => MBI[0].map((_, j) => r.reduce((s, v, k) => s + v * MBI[k][j], 0)));
function fmt2(v){ return (v < 0 ? '-' : '') + Math.abs(v); }

function n_exec9(ctx, t, u, shot){
  bgFill(ctx, '#03040A');
  const t0 = shot.t0, t1 = shot.t1;
  const te = accent(shot);
  const flash = ss(te - 0.02, te + 0.07, t);
  const reuse = ss(te + 0.16, te + 0.34, t);
  const CS = 74, GAP2 = 6;
  const tiles = { A: [292, 292], B: [700, 292], C: [1200, 292] };
  const drawTile = (key, M, lit, hl) => {
    const x = tiles[key][0], y = tiles[key][1];
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++){
      const px = x + c * (CS + GAP2), py = y + r * (CS + GAP2);
      const isRow = hl && r === hl[0] && key === hl[1];
      const isC = hl && key === 'C' && r === hl[2];
      const v = M[r][c];
      const a = lit * ss(t0 + 0.04 + (r + c) * 0.015, t0 + 0.16 + (r + c) * 0.015, t);
      ctx.fillStyle = rgba(isRow || isC ? C.cyan : C.ds, (isRow || isC ? 0.22 : 0.16) * a);
      ctx.fillRect(px, py, CS, CS);
      ctx.strokeStyle = rgba(isRow || isC ? C.white : C.phos, (isRow || isC ? 0.9 : 0.34) * a + 0.10);
      ctx.lineWidth = isRow || isC ? 1.8 : 1;
      ctx.strokeRect(px + .5, py + .5, CS, CS);
      if (a > 0.02)
        L.mono(ctx, fmt2(v), px + CS / 2, py + CS * 0.66, 26, rgba(C.white, 0.9 * a), 0, 'center');
    }
  };
  drawTile('A', MA, 1, reuse > 0.3 ? [0, 'A', 0] : null);
  drawTile('B', MBI, 1, null);
  ctx.fillStyle = rgba(C.white, 0.9);
  ctx.font = L.F(56, L.MONO); ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.fillText('x', 664, 448); ctx.fillText('=', 1166, 448);
  ctx.textAlign = 'left';
  L.mono(ctx, 'A', tiles.A[0] + 4, tiles.A[1] - 16, 16, rgba(C.phos, 0.75), 2);
  L.mono(ctx, 'B', tiles.B[0] + 4, tiles.B[1] - 16, 16, rgba(C.phos, 0.75), 2);
  L.mono(ctx, 'C = A x B', tiles.C[0] + 4, tiles.C[1] - 16, 16, rgba(C.cyan, 0.9), 2);
  drawTile('C', MCR, flash, reuse > 0.3 ? [0, 'C', 0] : null);
  if (flash > 0 && flash < 1){
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = rgba(C.white, 0.45 * (1 - flash));
    ctx.fillRect(tiles.C[0] - 10, tiles.C[1] - 10, 4 * (CS + GAP2) + 12, 4 * (CS + GAP2) + 12);
    ctx.restore();
  }
  if (reuse > 0.05){
    ctx.save(); ctx.globalAlpha = reuse * 0.85;
    const ay = tiles.A[1] + CS / 2;
    for (let c = 0; c < 4; c++){
      const ax = tiles.A[0] + c * (CS + GAP2) + CS / 2;
      for (let j = 0; j < 4; j++){
        const cx2 = tiles.C[0] + j * (CS + GAP2) + CS / 2;
        ctx.strokeStyle = rgba(C.cyan, 0.14); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.bezierCurveTo(ax + 130, ay + 150, cx2 - 130, ay + 150, cx2, ay); ctx.stroke();
      }
    }
    ctx.restore();
  }

  // ---- stamp: a 4x4 tile mosaic inside the glyphs
  maskWord(ctx, 0, 180, W / 2, 908, (c) => {
    c.fillStyle = rgba(C.ds, 0.42); c.fillRect(0, 0, MW, MH);
    for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++){
      const v = 0.5 + 0.5 * Math.sin(r * 1.9 + k * 1.1 + t * 2.6);
      c.fillStyle = rgba(k === r ? C.cyan : C.dsLite, 0.06 + 0.32 * v);
      c.fillRect(k * 480 + 6, r * 118 + 6, 468, 106);
    }
  }, 0.95);
  ctx.strokeStyle = rgba(C.cyan, 0.55); ctx.lineWidth = 1.1;
  ctx.font = L.F(180, L.CONDX); ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.strokeText(WORD, W / 2, 908);
  ctx.textAlign = 'left';
  ann(ctx, 'HMMA   —   one instruction: a 4 x 4 x 4 fused multiply-add', C.cyan, 0.75);
  return { bloom: 1.05, chroma: 1.4 + 9 * hitAt(t, te, 9), scan: 0.5,
    flash: 0.28 * hitAt(t, te, 9) };
}

// ================================================================ n_exec10
// fact: a mispredict flushes 15+ stages
function n_exec10(ctx, t, u, shot){
  bgFill(ctx, '#04060A');
  const t0 = shot.t0, t1 = shot.t1;
  const te = accent(shot);
  const spec = ss(te - 0.24, te - 0.04, t);
  const flush = ss(te + 0.02, te + 0.24, t);
  const refill = ss(te + 0.26, te + 0.46, t);

  // ---- stamp: fractured, then snapped shut
  const WS = 190, wby = 296;
  const settle = 1 - ss(t0 + 0.02, t0 + 0.26, t);
  const push = settle * 0.75 + flush * 0.55;
  ctx.font = L.F(WS, L.CONDX);
  const fullW = ctx.measureText(WORD).width;
  const left = W / 2 - fullW / 2;
  const m = wordMask(ctx, 0, WS, (c) => { c.fillStyle = rgba(C.alert, 0.95); c.fillRect(0, 0, MW, MH); });
  const NCH = 5, chw = fullW / NCH;
  for (let i = 0; i < NCH; i++){
    const d = (i % 2 ? 1 : -1) * (6 + 20 * ((i * 7) % 5) / 4) * push;
    const dy = (i % 2 ? -1 : 1) * 7 * push;
    const sx = Math.round(MCX - fullW / 2 + i * chw), ww = Math.min(Math.ceil(chw) + 1, MW - sx);
    ctx.drawImage(m.cv, sx, 0, ww, MH,
      Math.round(left + i * chw + d), Math.round(wby - MBASE + dy), ww, MH);
  }

  // ---- the branch
  const jx = 700, jy = 500;
  ctx.strokeStyle = rgba(C.phos, 0.7); ctx.lineWidth = 2;
  L.lin(ctx, 168, jy, jx - 104, jy);
  for (let i = 0; i < 11; i++){
    const x = 190 + i * 46;
    const alive = (1 - flush) * (0.25 + 0.75 * (0.5 + 0.5 * Math.sin(t * 9 - i * 0.6)));
    if (alive <= 0.03) continue;
    ctx.fillStyle = rgba(C.phos, 0.8 * alive);
    ctx.fillRect(x, jy - 6, 3, 12);
    ctx.fillStyle = rgba(C.ds, 0.5 * alive);
    ctx.fillRect(x + 7, jy - 21, 22, 11);
  }
  for (let i = 0; i < 14; i++){
    const x = 1180 + i * 46;
    const alive = (1 - flush) * (0.2 + 0.6 * (0.5 + 0.5 * Math.sin(t * 9 - i * 0.6)));
    if (alive <= 0.03) continue;
    ctx.fillStyle = rgba(C.phos, 0.6 * alive);
    ctx.fillRect(x, jy - 6, 3, 12);
  }
  ctx.beginPath();
  ctx.moveTo(jx, jy - 88); ctx.lineTo(jx + 104, jy); ctx.lineTo(jx, jy + 88); ctx.lineTo(jx - 104, jy);
  ctx.closePath();
  ctx.fillStyle = rgba(C.ds, 0.10 + 0.30 * spec); ctx.fill();
  ctx.strokeStyle = rgba(C.cyan, 0.7); ctx.lineWidth = 1.6; ctx.stroke();
  L.mono(ctx, '?', jx, jy + 16, 44, rgba(C.white, 0.9), 0, 'center');
  // fall-through (the path it should have taken)
  ctx.strokeStyle = rgba(C.phos, 0.18); ctx.lineWidth = 1.4;
  L.lin(ctx, jx + 104, jy, 1340, jy);
  L.mono(ctx, 'not taken', 1180, jy - 16, 14, rgba(C.phos, 0.35), 1.6);
  // the speculation
  const alive = (0.35 + 0.6 * spec) * (1 - 0.85 * flush);
  ctx.strokeStyle = rgba(C.alert, alive); ctx.lineWidth = 2.4;
  ctx.beginPath(); ctx.moveTo(jx + 104, jy); ctx.bezierCurveTo(1020, jy, 1060, jy + 110, 1150, jy + 178); ctx.stroke();
  if (flush > 0.03){
    ctx.strokeStyle = rgba(C.alert, 0.95); ctx.lineWidth = 6;
    L.lin(ctx, 1178, jy + 160, 1130, jy + 208);
    L.lin(ctx, 1130, jy + 160, 1178, jy + 208);
  }
  L.mono(ctx, 'predicted: taken', 1200, jy + 206, 16, rgba(C.alert, alive), 1.6);
  if (flush > 0.04){
    const q = hitAt(t, te, 6) * flush;
    ctx.save(); ctx.globalAlpha = Math.min(1, 0.9 * q + 0.25 * (1 - flush));
    ctx.strokeStyle = rgba(C.alert, 0.95); ctx.lineWidth = 8;
    const rx = lerp(1160, jx + 40, flush);
    L.lin(ctx, rx + 34, jy + 176, rx - 34, jy + 244);
    L.lin(ctx, rx - 34, jy + 176, rx + 34, jy + 244);
    ctx.restore();
  }

  // ---- the pipeline
  const sy = 700, sh = 96, sw2 = 150, sgap = 36;
  const sx0 = (W - (8 * sw2 + 7 * sgap)) / 2;
  L.mono(ctx, 'front end', sx0, sy - 20, 13, rgba(C.phos, 0.45), 2.4);
  L.mono(ctx, 'speculated', sx0 + 4 * (sw2 + sgap), sy - 20, 13, rgba(C.alert, 0.55 * spec), 2.4);
  for (let i = 0; i < 8; i++){
    const x = sx0 + i * (sw2 + sgap);
    const ghost = i >= 4;
    const gOn = ghost ? ss(te - 0.26 + (i - 4) * 0.05, te - 0.12 + (i - 4) * 0.05, t) : 1;
    const kill = ghost ? flush : ss(te + 0.04, te + 0.22, t) * (i >= 2 ? 1 : 0);
    const alive2 = ghost ? gOn * (1 - kill) : 1;
    const rf = (!ghost && i >= 2) ? refill : 0;
    if (rf > 0){
      ctx.fillStyle = rgba(C.ds, 0.10 * rf); ctx.fillRect(x, sy, sw2, sh);
      ctx.strokeStyle = rgba(C.phos, 0.75 * rf); ctx.lineWidth = 1.4;
      ctx.strokeRect(x + .5, sy + .5, sw2, sh);
      L.mono(ctx, 'ok', x + sw2 / 2, sy + 60, 28, rgba(C.white, 0.85 * rf), 0, 'center');
    }
    if (alive2 > 0.03){
      ctx.save();
      if (ghost){ ctx.setLineDash([8, 8]); ctx.strokeStyle = rgba(C.alert, 0.9 * alive2); ctx.lineWidth = 1.8; }
      else { ctx.strokeStyle = rgba(C.phos, 0.62 * alive2); ctx.lineWidth = 1.3; }
      ctx.strokeRect(x + .5, sy + .5, sw2, sh);
      ctx.setLineDash([]);
      L.mono(ctx, ghost ? '??' : 'op', x + sw2 / 2, sy + 60, ghost ? 32 : 28,
        rgba(ghost ? C.alert : C.phos, 0.9 * alive2), 0, 'center');
      ctx.restore();
    }
  }
  // 15 stages squashed by the flush
  const ty2 = sy + sh + 34;
  for (let i = 0; i < 16; i++){
    const x = sx0 + i * (sw2 + sgap / 2) * 8 / 15.5;
    const dead = ss(te + 0.02 + (15 - i) * 0.004, te + 0.08 + (15 - i) * 0.004, t);
    ctx.fillStyle = rgba(dead > 0.5 ? C.alert : C.phos, dead > 0.5 ? 0.55 : 0.22);
    ctx.fillRect(x, ty2, 10, 6 + 14 * dead);
  }
  L.mono(ctx, '15 stages', 168, ty2 + 22, 13, rgba(C.alert, 0.7 * flush), 1.6);
  if (flush > 0 && flush < 0.99){
    const fx = lerp(W - 40, sx0 - 40, flush);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createLinearGradient(fx - 140, 0, fx + 50, 0);
    g.addColorStop(0, 'rgba(255,59,78,0)'); g.addColorStop(1, 'rgba(255,59,78,0.55)');
    ctx.fillStyle = g; ctx.fillRect(fx - 140, sy - 46, 190, sh + 92);
    ctx.restore();
  }
  ann(ctx, 'mispredict   —   the whole pipeline flushes 15+ stages', C.alert, 0.8);
  return { bloom: 1.05, chroma: 1.5 + 12 * hitAt(t, te, 7), scan: 0.55,
    flash: 0.12 * hitAt(t, te, 8) };
}

// ================================================================ n_exec11
// fact: write-ahead log — replay until the log ends, the page heals
const WAL = [['redo', 'A = 5'], ['redo', 'B = 7'], ['redo', 'A = 9'], ['commit', 'flushed']];

function n_exec11(ctx, t, u, shot){
  bgFill(ctx, '#03040A');
  const t0 = shot.t0, t1 = shot.t1;
  const te = accent(shot);

  // ---- the log
  L.mono(ctx, 'write-ahead log', 196, 200, 15, rgba(C.phos, 0.6), 2.6);
  for (let i = 0; i < 4; i++){
    const ti = t0 + 0.06 + i * 0.28;
    const on = ss(ti, ti + 0.10, t);
    const y = 236 + i * 96;
    ctx.strokeStyle = rgba(C.phos, 0.10 + 0.35 * on); ctx.lineWidth = 1;
    ctx.strokeRect(196.5, y + .5, 600, 74);
    if (on <= 0) continue;
    ctx.fillStyle = rgba(C.ds, 0.07 + 0.15 * on); ctx.fillRect(197, y + 1, 598, 72);
    L.mono(ctx, '[' + i + ']', 216, y + 46, 18, rgba(C.cyan, 0.85 * on), 1.2);
    L.mono(ctx, WAL[i][0], 268, y + 46, 18, rgba(C.white, 0.85 * on), 1.2);
    L.mono(ctx, WAL[i][1], 770, y + 46, 18, rgba(C.phos, 0.8 * on), 0.6, 'right');
    const k = ss(ti, ti + 0.22, t);
    if (k > 0 && k < 1){
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = rgba(C.cyan, 0.55 * (1 - k)); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(800, y + 37); ctx.bezierCurveTo(900, y + 37, 940, 320, 1006, 320); ctx.stroke();
      ctx.restore();
    }
  }
  // ---- the page
  const px = 996, py = 194, cell = 80, N = 8;
  ctx.strokeStyle = rgba(C.phos, 0.4); ctx.lineWidth = 1.5;
  ctx.strokeRect(px + .5, py + .5, cell * N, cell * N);
  const healed = ss(t0 + 0.10, t1 - 0.12, t);
  const R = L.mulberry32(90210);
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++){
    const idx = r * N + c;
    const on = (idx * 3 + 7) % 16 < Math.round(healed * 16);
    const x = px + c * cell, y = py + r * cell;
    ctx.strokeStyle = rgba(C.phos, 0.085); ctx.lineWidth = 1;
    ctx.strokeRect(x + .5, y + .5, cell, cell);
    if (on){
      ctx.fillStyle = rgba(C.ds, 0.06 + 0.10 * R());
      ctx.fillRect(x + 2, y + 2, cell - 4, cell - 4);
      ctx.fillStyle = rgba(C.cyan, 0.30 + 0.45 * R());
      ctx.fillRect(x + 12, y + cell / 2 - 2, (cell - 24) * (0.3 + 0.7 * R()), 4);
    }
  }
  L.mono(ctx, 'page 0/1A', px, py - 14, 14, rgba(C.phos, 0.55), 2.2);
  L.mono(ctx, 'redo', px + cell * N, py - 14, 14, rgba(C.cyan, 0.55 + 0.4 * healed), 2.2, 'right');
  for (let i = 0; i < 4; i++){
    const ti = t0 + 0.06 + i * 0.28 + 0.16;
    const k = sat((t - ti) / 0.26);
    if (k <= 0 || k >= 1) continue;
    const idx = (i * 17 + 9) % 64;
    const cx2 = px + (idx % N) * cell + cell / 2, cy2 = py + Math.floor(idx / N) * cell + cell / 2;
    ctx.strokeStyle = rgba(C.white, 0.75 * (1 - k)); ctx.lineWidth = 4 * (1 - k) + 1;
    L.circle(ctx, cx2, cy2, 10 + 90 * k); ctx.stroke();
    ctx.strokeStyle = rgba(C.cyan, 0.75 * (1 - k)); ctx.lineWidth = 1.4;
    L.circle(ctx, cx2, cy2, 6 + 40 * k); ctx.stroke();
  }

  // ---- stamp: letterpress, one more impression per replayed entry
  const WS = 150, wby = 880, cxW = 470;
  const imp = [[-8, -6, 0.30], [7, 4, 0.26], [-4, 7, 0.30]];
  for (let i = 0; i < imp.length; i++){
    const on = ss(t0 + 0.20 + i * 0.26, t0 + 0.36 + i * 0.26, t);
    if (on <= 0) continue;
    maskWord(ctx, 0, WS, cxW + imp[i][0], wby + imp[i][1], (c) => {
      c.fillStyle = rgba(C.dsLite, 0.8); c.fillRect(0, 0, MW, MH);
    }, imp[i][2] * on);
  }
  maskWord(ctx, 1, WS, cxW, wby, (c) => {
    c.fillStyle = rgba(C.cyan, 0.95); c.fillRect(0, 0, MW, MH);
  }, 0.95);
  ann(ctx, 'write-ahead log   —   replay until the log ends, the page heals', C.cyan, 0.75);
  return { bloom: 1.02, chroma: 1.4, scan: 0.5, flash: 0.06 * Math.sin(Math.PI * sat((t - t0) / (t1 - t0))) };
}

// ================================================================ n_exec12
// fact: all of the above at once
function echo(ctx, m, x, y, s, a, col){
  ctx.save(); ctx.globalAlpha = a; ctx.strokeStyle = col; ctx.lineWidth = 1.6;
  ctx.beginPath();
  if (m === 0){ ctx.strokeRect(x - s, y - s * 0.5, s * 2, s); ctx.moveTo(x - s * 0.7, y - s * 0.2); ctx.lineTo(x + s * 0.4, y - s * 0.2); }
  else if (m === 1){ for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) ctx.strokeRect(x - s + i * s * 0.44, y - s * 0.38 + j * s * 0.28, s * 0.38, s * 0.22); }
  else if (m === 2){ for (let i = 0; i < 9; i++) ctx.strokeRect(x - s + i * s * 0.24, y - 11, s * 0.18, 22); }
  else if (m === 3){ ctx.moveTo(x - s, y + s * 0.5); ctx.lineTo(x, y - s * 0.5); ctx.lineTo(x + s, y + s * 0.5); }
  else if (m === 4){ for (let i = 0; i < 4; i++){ ctx.moveTo(x - s, y - s * 0.32 + i * s * 0.22); ctx.lineTo(x + s, y - s * 0.32 + i * s * 0.22); } }
  else if (m === 5){ for (let i = 0; i < 4; i++){ ctx.moveTo(x, y - s * 0.5); ctx.lineTo(x - s * Math.pow(0.5, i), y + s * 0.5); ctx.moveTo(x, y - s * 0.5); ctx.lineTo(x + s * Math.pow(0.5, i), y + s * 0.5); } }
  else if (m === 6){ for (let i = 0; i < 5; i++){ ctx.moveTo(x - s, y - s * 0.4 + i * s * 0.2); ctx.lineTo(x - s * 0.15, y - s * 0.4 + i * s * 0.2); ctx.moveTo(x + s, y - s * 0.4 + i * s * 0.2); ctx.lineTo(x + s * 0.15, y - s * 0.4 + i * s * 0.2); } }
  else if (m === 7){ ctx.strokeRect(x - s * 0.65, y - s * 0.65, s * 1.3, s * 1.3); ctx.moveTo(x, y - 8); ctx.lineTo(x, y + 8); }
  else if (m === 8){ for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) ctx.strokeRect(x - s + i * s * 0.52, y - s + j * s * 0.52, s * 0.44, s * 0.44); }
  else if (m === 9){ for (let i = 0; i < 5; i++){ ctx.moveTo(x - s + i * s * 0.5, y - s * 0.5); ctx.lineTo(x - s + i * s * 0.5 + s * 0.2, y + s * 0.5); } }
  else { for (let i = 0; i < 4; i++){ ctx.moveTo(x - s, y - s * 0.4 + i * s * 0.27); ctx.lineTo(x + s, y - s * 0.4 + i * s * 0.27); } }
  ctx.stroke();
  ctx.restore();
}

function n_exec12(ctx, t, u, shot){
  bgFill(ctx, '#04060A');
  const t0 = shot.t0, t1 = shot.t1;
  const te = accent(shot);
  const POS = [[230, 178, 0], [580, 152, 1], [960, 146, 2], [1330, 152, 3], [1690, 190, 4],
               [232, 452, 5], [1700, 452, 6],
               [238, 762, 7], [580, 838, 8], [962, 852, 9], [1338, 838, 10]];
  const COL = [C.phos, C.cyan, C.white, C.dsLite];
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < POS.length; i++){
    const on = ss(t0 + i * 0.038, t0 + 0.10 + i * 0.038, t);
    if (on <= 0) continue;
    const s = 58 + 16 * (i % 3);
    echo(ctx, POS[i][2], POS[i][0], POS[i][1], s * (1 + 0.22 * ss(t0, t1, t)), 0.75 * on, COL[i % 4]);
    ctx.strokeStyle = rgba(COL[i % 4], 0.3 * on); ctx.lineWidth = 1;
    ctx.strokeRect(POS[i][0] - s * 1.25, POS[i][1] - s * 0.95, s * 2.5, s * 1.9);
  }
  ctx.restore();

  // ---- stamp: overprinted, additive, until it is the only thing left
  const over = [[0, 0, 210, C.white, 0.9], [-7, -5, 196, C.cyan, 0.32], [6, 4, 168, C.dsLite, 0.26]];
  const sat2 = ss(te - 0.24, t1 - 0.03, t);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const o of over){
    maskWord(ctx, 0, o[2], W / 2 + o[0] * (1 + 4 * sat2), 566 + o[1] * (1 + 4 * sat2),
      (c) => { c.fillStyle = rgba(o[3], 0.92); c.fillRect(0, 0, MW, MH); },
      o[4] * (0.55 + 0.45 * ss(t0, t0 + 0.14, t)));
  }
  ctx.restore();

  const wht = ss(t1 - 0.19, t1 - 0.01, t);
  if (wht > 0){
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = rgba(C.white, wht * 0.94); ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
  ann(ctx, 'all of the above at once', C.white, 0.6 + 0.4 * wht);
  return { bloom: 1.15, chroma: 1.6 + 12 * wht, scan: 0.45, grain: 0.12, flash: 0.85 * wht };
}

// ================================================================ n_ring6
// fact: byte-level BPE — the same meaning can cost ~15x more tokens outside Latin script
const RING = [
  { num: 'EIN', de: 'DEUTSCH', sub: 'one', bytes: 3, cue: 158.90, fam: L.CONDX },
  { num: 'DOS', de: 'ESPAÑOL', sub: 'two', bytes: 3, cue: 159.32, fam: L.CONDX },
  { num: 'TROIS', de: 'FRANÇAIS', sub: 'three', bytes: 5, cue: 159.66, fam: L.CONDX },
  { num: '네', de: '한국어', sub: 'ne', bytes: 3, cue: 160.24, fam: FAM_KR },
  { num: 'FEM', de: 'SVENSKA', sub: 'five', bytes: 3, cue: 160.69, fam: L.CONDX },
  { num: '六', de: '中文', sub: 'liù', bytes: 3, cue: 161.12, fam: FAM_ZH },
];
const RCX = 960, RCY = 470, RR = 330;

function n_ring6(ctx, t, u, shot){
  bgFill(ctx, '#03040A');
  const t0 = shot.t0, t1 = shot.t1;
  const a0 = -Math.PI / 2;
  const nodeAt = (i) => [RCX + Math.cos(a0 + i * Math.PI / 3) * RR, RCY + Math.sin(a0 + i * Math.PI / 3) * RR];

  // ring structure
  ctx.strokeStyle = rgba(C.ds, 0.55); ctx.lineWidth = 1.4;
  L.circle(ctx, RCX, RCY, RR); ctx.stroke();
  ctx.strokeStyle = rgba(C.ds, 0.28); ctx.lineWidth = 1;
  L.circle(ctx, RCX, RCY, RR - 56); ctx.stroke();
  for (let i = 0; i < 6; i++){
    const ang = a0 + i * Math.PI / 3 + Math.PI / 6;
    ctx.strokeStyle = rgba(C.phos, 0.22); ctx.lineWidth = 1;
    L.lin(ctx, RCX + Math.cos(ang) * (RR - 56), RCY + Math.sin(ang) * (RR - 56),
      RCX + Math.cos(ang) * (RR + 26), RCY + Math.sin(ang) * (RR + 26));
  }

  // arcs charge one by one; the ring completes on the last
  for (let i = 0; i < 6; i++){
    const st = RING[i].cue;
    const en = (i === 5 ? t1 : RING[(i + 1) % 6].cue);
    const k = ss(st, Math.min(en, st + 0.44), t);
    if (k <= 0) continue;
    const angA = a0 + i * Math.PI / 3 + 0.34, angB = a0 + (i + 1) * Math.PI / 3 - 0.34;
    ctx.strokeStyle = rgba(i < 3 ? C.cyan : C.phos, 0.30 + 0.65 * k); ctx.lineWidth = 3.4;
    ctx.beginPath(); ctx.arc(RCX, RCY, RR, angA, lerp(angA, angB, k)); ctx.stroke();
    // the charged arc, left behind
    ctx.strokeStyle = rgba(C.white, 0.35 * k); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(RCX, RCY, RR + 9, angA, lerp(angA, angB, k)); ctx.stroke();
  }

  // nodes
  for (let i = 0; i < 6; i++){
    const nd = RING[i], p = nodeAt(i);
    const on = ss(nd.cue - 0.02, nd.cue + 0.16, t);
    const hot = Math.max(0, 1 - Math.abs(t - nd.cue) / 0.42);
    ctx.fillStyle = rgba(C.ds, 0.05 + 0.22 * on);
    L.fillCircle(ctx, p[0], p[1], 94);
    ctx.strokeStyle = rgba(on > 0.5 ? C.white : C.phos, 0.16 + 0.78 * on); ctx.lineWidth = 1.6 + 1.8 * hot;
    L.circle(ctx, p[0], p[1], 94); ctx.stroke();
    if (hot > 0.05){
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = rgba(C.cyan, 0.55 * hot); ctx.lineWidth = 7 * hot;
      L.circle(ctx, p[0], p[1], 94); ctx.stroke();
      ctx.restore();
    }
    // numeral
    const ns = nd.num.length >= 5 ? 54 : 74;
    ctx.font = L.F(ns, nd.fam); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = rgba(on > 0.5 ? C.white : C.phos, 0.16 + 0.84 * on);
    ctx.fillText(nd.num, p[0], p[1] - 10);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    // tokenisation charge: one tick per UTF-8 byte
    for (let b = 0; b < 5; b++){
      const lit = b < nd.bytes && on > 0;
      ctx.fillStyle = rgba(lit ? C.cyan : C.phos, lit ? 1 : 0.12);
      ctx.fillRect(p[0] - 31 + b * 14, p[1] + 44, 9, 10);
    }
    // language + romanisation outside the ring
    const sy2 = Math.sin(a0 + i * Math.PI / 3);
    const lx = p[0], ly = p[1] + (sy2 > 0.5 ? 142 : -128);
    L.mono(ctx, nd.de, lx, ly, 16, rgba(on > 0.5 ? C.cyan : C.phos, 0.28 + 0.62 * on), 3, 'center');
    if (nd.num.length > 3) L.mono(ctx, nd.sub, lx, ly + 20, 12, rgba(C.white, 0.55 * on), 1.4, 'center');
  }

  // ---- stamp: the word set on an arc, in the middle of the ring
  const RS = 158, LS = 62, span = 2.36;
  const chars = [];
  ctx.font = L.F(LS, L.CONDX);
  let tot = 0;
  for (const ch of WORD){ const w2 = ctx.measureText(ch).width + 8; chars.push(w2); tot += w2; }
  let aa = a0 - span / 2;
  for (let i = 0; i < WORD.length; i++){
    const frac = (chars[i] / 2) / tot * span;
    aa += frac;
    const x = RCX + Math.cos(aa) * RS, y = RCY + Math.sin(aa) * RS;
    ctx.save();
    ctx.translate(x, y); ctx.rotate(aa + Math.PI / 2);
    ctx.font = L.F(LS, L.CONDX); ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = rgba(i < 3 ? C.cyan : C.white, 0.95);
    ctx.fillText(WORD[i], 0, 0);
    ctx.restore();
    aa += frac;
  }
  ctx.fillStyle = rgba(C.phos, 0.6); L.fillCircle(ctx, RCX, RCY, 3);
  ann(ctx, 'byte-level BPE   —   the same meaning costs up to ≈15× more tokens outside Latin script', C.cyan, 0.7);

  const done = ss(161.24, t1, t);
  return { bloom: 1.05 + 0.35 * done, chroma: 1.3 + 3 * done, scan: 0.5, flash: 0.06 * done };
}


// ================================================================ n_exe7
// fact: the 7th execute — the ring detonates
function n_exe7(ctx, t, u, shot){
  bgFill(ctx, '#030507');
  const t0 = shot.t0, t1 = shot.t1;
  const td = t0 + 0.14;
  const k = sat((t - td) / Math.max(0.20, t1 - td));
  const e = easeOutCubic(k);
  const R0 = 330, R = R0 + e * 1250;
  const a0 = -Math.PI / 2;

  // shock rings
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 4; i++){
    const kk = sat((k - i * 0.06) / 0.92);
    if (kk <= 0) continue;
    const rr = R0 + easeOutCubic(kk) * (1150 + i * 210);
    ctx.strokeStyle = rgba(i === 0 ? C.white : C.cyan, (1 - kk) * (i === 0 ? 0.85 : 0.40));
    ctx.lineWidth = 12 * (1 - kk) + 1.2;
    L.circle(ctx, 960, 470, rr); ctx.stroke();
  }
  // the six numerals thrown outward
  for (let i = 0; i < 6; i++){
    const ang = a0 + i * Math.PI / 3;
    const rr = R * 0.62 + 70;
    const x = 960 + Math.cos(ang) * rr, y = 470 + Math.sin(ang) * rr;
    const a = (1 - e) * 0.9;
    if (a <= 0.02) continue;
    const nd = RING[i];
    ctx.font = L.F(76, nd.fam); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = rgba(C.white, a);
    ctx.fillText(nd.num, x, y);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }
  // debris
  for (let i = 0; i < 240; i++){
    const h = L.hash2(i, 21), h2 = L.hash2(i, 5);
    const ang = h * TAU, rr = R0 + e * (180 + 700 * h2);
    const a = (1 - e) * (0.2 + 0.8 * h);
    if (a <= 0.02) continue;
    ctx.fillStyle = rgba(i % 7 === 0 ? C.white : C.cyan, a * 0.85);
    const s2 = 2 + 3 * h;
    ctx.fillRect(960 + Math.cos(ang) * rr, 470 + Math.sin(ang) * rr, s2, s2);
  }
  ctx.restore();

  // ---- stamp: white, hard, thrown into the middle of the blast
  const sc = 1 + 0.30 * (1 - ss(td, td + 0.24, t));
  const wa = 0.5 + 0.5 * ss(t0, t0 + 0.10, t);
  ctx.save();
  ctx.translate(960, 604); ctx.scale(sc, sc); ctx.translate(-960, -604);
  maskWord(ctx, 0, 278, 960, 604, (c) => {
    c.fillStyle = rgba(C.white, 0.98); c.fillRect(0, 0, MW, MH);
  }, wa);
  ctx.strokeStyle = rgba(C.cyan, 0.45); ctx.lineWidth = 1.6;
  ctx.font = L.F(278, L.CONDX); ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.strokeText(WORD, 960, 604);
  ctx.textAlign = 'left';
  ctx.restore();

  const burn = sat((t - td) / Math.max(0.2, t1 - td));
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 56; i++){
    const h = L.hash2(i, 31), ang = h * TAU;
    const r0 = 300 + 240 * h + burn * 420, r1 = r0 + 180 + 420 * L.hash2(i, 13);
    ctx.strokeStyle = rgba(i % 5 === 0 ? C.white : C.cyan, 0.16 * (1 - 0.5 * burn) * (0.4 + 0.6 * h));
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(960 + Math.cos(ang) * r0, 470 + Math.sin(ang) * r0);
    ctx.lineTo(960 + Math.cos(ang) * r1, 470 + Math.sin(ang) * r1);
    ctx.stroke();
  }
  ctx.strokeStyle = rgba(C.cyan, 0.35 * (1 - burn));
  ctx.lineWidth = 2;
  L.circle(ctx, 960, 470, 320 + burn * 1080); ctx.stroke();
  ctx.restore();
  const hole = hitAt(t, td, 10);
  if (hole > 0.03){
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = rgba(C.white, 0.5 * hole); ctx.lineWidth = 3 * hole + 1;
    L.circle(ctx, 960, 470, 330 + 240 * (1 - hole)); ctx.stroke();
    ctx.restore();
  }
  ann(ctx, 'the 7th execute   —   the ring detonates', C.white, 0.65);
  return { bloom: 1.2, chroma: 1.6 + 12 * hole, scan: 0.45, grain: 0.11, flash: 0.40 * hole };
}

module.exports = {
  n_exec1, n_exec2, n_exec3, n_exec4, n_exec5, n_exec6, n_exec7,
  n_exec8, n_exec9, n_exec10, n_exec11, n_exec12, n_ring6, n_exe7,
};

