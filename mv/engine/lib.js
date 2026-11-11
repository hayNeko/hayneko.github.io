
'use strict';
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');

const W = 1920, H = 1080;
const TAU = Math.PI * 2;
// ---------- palette (strict) ----------
const C = {
  void:   '#05070B',
  void2:  '#090D14',
  phos:   '#7CFFB2',      // the world / instrument
  cyan:   '#4EFFD0',
  ds:     '#4D6BFE',      // DeepSeek blue: the "I"
  dsLite: '#8DA2FF',
  alert:  '#FF3B4E',
  love:   '#FF6B9D',
  warm:   '#FFD166',
  white:  '#FFFFFF',
  dim:    'rgba(124,255,178,0.35)',
  dim2:   'rgba(124,255,178,0.14)',
};
function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
}
const MONO = 'Consolas, Cascadia Mono, monospace';
const MONO2 = 'Cascadia Mono, Consolas, monospace';
const COND = 'Franklin Gothic Medium, Bahnschrift, Arial Narrow, Arial';
const CONDX = 'Impact, Franklin Gothic Heavy, Arial Black';
const CJK = 'Microsoft YaHei, Noto Sans SC, SimHei';
const F = (px, fam, wt) => (wt ? wt + ' ' : '') + px + 'px ' + (fam || MONO);

// ---------- math ----------
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, k) => a + (b - a) * k;
const inv = (a, b, v) => (v - a) / (b - a || 1e-9);
const sat = v => v < 0 ? 0 : v > 1 ? 1 : v;
const smooth = k => k * k * (3 - 2 * k);
const ss = (a, b, v) => smooth(sat(inv(a, b, v)));
function easeOutExpo(k){ return k >= 1 ? 1 : 1 - Math.pow(2, -10 * k); }
function easeOutQuint(k){ return 1 - Math.pow(1 - k, 5); }
function easeOutCubic(k){ return 1 - Math.pow(1 - k, 3); }
function easeInCubic(k){ return k * k * k; }
function easeInOutCubic(k){ return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; }
function easeInOutQuint(k){ return k < 0.5 ? 16 * k * k * k * k * k : 1 - Math.pow(-2 * k + 2, 5) / 2; }
function easeInExpo(k){ return k <= 0 ? 0 : Math.pow(2, 10 * k - 10); }
function easeOutBack(k, s) { s = s === undefined ? 1.70158 : s; const c = s + 1; return 1 + c * Math.pow(k - 1, 3) + s * Math.pow(k - 1, 2); }
function easeOutElastic(k){ if (k === 0 || k === 1) return k; return Math.pow(2, -10 * k) * Math.sin((k * 10 - 0.75) * (TAU / 3)) + 1; }
// damped spring 0->1
function spring1(k, freq, damp){ if (k >= 1) return 1; if (k <= 0) return 0; const e = Math.exp(-damp * k); return 1 - e * Math.cos(freq * k); }

// ---------- rng / noise ----------
function hash1(n){ n = (n << 13) ^ n; return (1.0 - ((n * (n * n * 15731 + 789221) + 1376312589) & 0x7fffffff) / 1073741824.0); }
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function hash2(x, y){ let h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return h - Math.floor(h); }
function noise2(x, y){
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = smooth(xf), v = smooth(yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}
function fbm(x, y, oct){ oct = oct || 4; let s = 0, a = 0.5, f = 1; for (let i = 0; i < oct; i++){ s += a * noise2(x * f, y * f); f *= 2; a *= 0.5; } return s; }

// ---------- timeline ----------
const BPM = 130, SPB = 60 / BPM, BEAT0 = 0.190, BAR = SPB * 4;
const beatOf = t => (t - BEAT0) / SPB;
const timeOfBeat = b => BEAT0 + b * SPB;
const barOf = t => beatOf(t) / 4;
// 1 if exactly on a beat else 0 (within eps)
function onBeat(t, eps){ const b = beatOf(t); return Math.abs(b - Math.round(b)) < (eps || 0.08) ? 1 : 0; }
// exponential decay pulse since last beat
function pulse(t, decayBeats){
  const b = beatOf(t); const ph = b - Math.floor(b);
  return Math.exp(-ph * SPB / (decayBeats === undefined ? 0.13 : decayBeats));
}
function barPulse(t, decayBeats){ const b = barOf(t); const ph = b - Math.floor(b); return Math.exp(-ph * BAR / (decayBeats === undefined ? 0.35 : decayBeats)); }
// kick-ish envelope: sharp attack, exp decay, grid at 1 beat
function kick(t, per, decay){ per = per || 1; decay = decay || 0.11; const b = beatOf(t) / per; const ph = b - Math.floor(b); return Math.exp(-ph * (SPB * per) / decay); }

// ---------- 3d ----------
function makeCam(o){
  o = o || {};
  return { pos: o.pos || [0, 0, 6], yaw: o.yaw || 0, pitch: o.pitch || 0, fov: o.fov || 1.1, roll: o.roll || 0, W: W, H: H };
}
function camF(cam){ return (cam.H / 2) / Math.tan(cam.fov / 2); }
// returns [X,Y,depth,scale] or null
function proj(cam, p, out){
  let x = p[0] - cam.pos[0], y = p[1] - cam.pos[1], z = p[2] - cam.pos[2];
  const cy = Math.cos(-cam.yaw), sy = Math.sin(-cam.yaw);
  let x1 = x * cy + z * sy, z1 = -x * sy + z * cy;
  const cp = Math.cos(-cam.pitch), sp = Math.sin(-cam.pitch);
  let y1 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
  const d = -z2;
  if (d < 0.02) return null;
  const f = camF(cam), s = f / d;
  let X = cam.W / 2 + x1 * s, Y = cam.H / 2 - y1 * s;
  if (cam.roll){ const co = Math.cos(cam.roll), si = Math.sin(cam.roll); const dx = X - cam.W / 2, dy = Y - cam.H / 2; X = cam.W / 2 + dx * co - dy * si; Y = cam.H / 2 + dx * si + dy * co; }
  out = out || [0, 0, 0, 0]; out[0] = X; out[1] = Y; out[2] = d; out[3] = s; return out;
}

// ---------- draw helpers ----------
function lin(ctx, x1, y1, x2, y2){ ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
function circle(ctx, x, y, r){ ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); }
function fillCircle(ctx, x, y, r){ ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); }
function ring(ctx, x, y, r, w){ ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.lineWidth = w; ctx.stroke(); }
function rrect(ctx, x, y, w, h, r){ ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function glow(ctx, color, blur, fn){ ctx.save(); ctx.shadowColor = color; ctx.shadowBlur = blur; fn(); ctx.restore(); }
function withA(ctx, a, fn){ const p = ctx.globalAlpha; ctx.globalAlpha = p * a; fn(); ctx.globalAlpha = p; }
// mono text with manual tracking
function mono(ctx, str, x, y, size, color, tracking, align){
  ctx.font = F(size, MONO); ctx.fillStyle = color; ctx.textAlign = 'left';
  if (!tracking || tracking === 0){ ctx.textAlign = align || 'left'; ctx.fillText(str, x, y); ctx.textAlign = 'left'; return; }
  let w = 0; for (const ch of str) w += ctx.measureText(ch).width + tracking; w -= tracking;
  let cx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  for (const ch of str){ ctx.fillText(ch, cx, y); cx += ctx.measureText(ch).width + tracking; }
  return w;
}
function monoW(ctx, str, size, tracking){
  ctx.font = F(size, MONO); let w = 0; for (const ch of str) w += ctx.measureText(ch).width + (tracking || 0);
  return w - (tracking || 0);
}
// huge condensed display type
function display(ctx, str, x, y, size, color, align, fam){
  ctx.font = F(size, fam || CONDX); ctx.fillStyle = color; ctx.textAlign = align || 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(str, x, y); ctx.textAlign = 'left';
}
function tw(ctx, str, size, fam){ ctx.font = F(size, fam || CONDX); return ctx.measureText(str).width; }
// HUD corner brackets
function brackets(ctx, x, y, w, h, len, color, lw){
  ctx.strokeStyle = color || C.dim; ctx.lineWidth = lw || 1;
  const L = len || 14;
  const pts = [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]];
  for (const [px, py, sx, sy] of pts){ ctx.beginPath(); ctx.moveTo(px + sx * L, py); ctx.lineTo(px, py); ctx.lineTo(px, py + sy * L); ctx.stroke(); }
}
// tick ruler
function ruler(ctx, x, y, w, h, n, color, labelEvery, labelFn, size){
  ctx.strokeStyle = color || C.dim; ctx.lineWidth = 1;
  for (let i = 0; i <= n; i++){ const px = x + w * i / n; const big = i % (labelEvery || 5) === 0;
    ctx.beginPath(); ctx.moveTo(px, y); ctx.lineTo(px, y + (big ? h : h * 0.45)); ctx.stroke();
    if (big && labelFn) mono(ctx, labelFn(i), px + 3, y + h + (size || 11) + 2, size || 11, color || C.dim); }
}
// the datasheet annotation block: label / value rows, printed with a wipe
function spec(ctx, x, y, rows, opt){
  opt = opt || {}; const size = opt.size || 13, lh = opt.lh || size * 1.5, color = opt.color || C.phos;
  const a = opt.alpha === undefined ? 1 : opt.alpha;
  if (a <= 0) return;
  withA(ctx, a, () => {
    ctx.textAlign = 'left';
    for (let i = 0; i < rows.length; i++){
      const r = rows[i]; const yy = y + i * lh;
      mono(ctx, r[0], x, yy, size, rgba(color, 0.45), 1);
      mono(ctx, r[1], x + (opt.kw || 92), yy, size, r[2] || color, 0);
    }
  });
}
// horizontal wipe-in text (mask via clip)
function wipeText(ctx, str, x, y, size, color, k, fam, align, vertical){
  if (k <= 0) return;
  ctx.save();
  if (vertical) { ctx.beginPath(); ctx.rect(0, 0, W, y * k); ctx.clip(); }
  else { ctx.beginPath(); ctx.rect(x - 20, 0, (align === 'center' ? W : (W - x + 20)) * k, H); ctx.clip(); }
  display(ctx, str, x, y, size, color, align, fam);
  ctx.restore();
}
// glyph rain / code column
function columns(ctx, t, cols, opt){
  opt = opt || {};
  const size = opt.size || 14, color = opt.color || C.phos, a = opt.alpha === undefined ? 1 : opt.alpha;
  ctx.font = F(size, MONO); ctx.fillStyle = color; ctx.globalAlpha = a;
  for (let c = 0; c < cols.length; c++){
    const col = cols[c]; const y = ((col.y + t * col.v) % (H + 400)) - 200;
    for (let i = 0; i < col.n; i++){ const ch = col.s[(i + Math.floor(t * 8)) % col.s.length]; ctx.globalAlpha = a * (1 - i / col.n) * 0.85; ctx.fillText(ch, col.x, y - i * size * 1.15); }
  }
  ctx.globalAlpha = 1;
}

// ---------- post ----------
class Post {
  constructor(){
    this.q = createCanvas(W >> 2, H >> 2); this.qc = this.q.getContext('2d');
    this.e = createCanvas(W >> 3, H >> 3); this.ec = this.e.getContext('2d');
    this.vig = null; this.grainTiles = [];
    // vignette
    const v = createCanvas(W, H); const vc = v.getContext('2d');
    const g = vc.createRadialGradient(W / 2, H / 2, H * 0.34, W / 2, H / 2, H * 0.95);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.7, 'rgba(0,0,0,0.20)'); g.addColorStop(1, 'rgba(0,0,0,0.58)');
    vc.fillStyle = g; vc.fillRect(0, 0, W, H); this.vig = v;
    // grain tiles
    for (let k = 0; k < 4; k++){
      const s = 256, cv = createCanvas(s, s), cx = cv.getContext('2d'); const id = cx.createImageData(s, s);
      const r = mulberry32(1234 + k * 77);
      for (let i = 0; i < s * s; i++){ const v2 = 128 + (r() - 0.5) * 190; id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v2; id.data[i * 4 + 3] = 255; }
      cx.putImageData(id, 0, 0); this.grainTiles.push(cv);
    }
    this.scan = null;
    const sc = createCanvas(W, H), scc = sc.getContext('2d');
    for (let y = 0; y < H; y += 3){ scc.fillStyle = 'rgba(0,0,0,0.20)'; scc.fillRect(0, y, W, 1); }
    this.scan = sc;
  }
  bloom(ctx, amt, chroma, t){
    const cv = ctx.canvas;
    this.qc.clearRect(0, 0, this.q.width, this.q.height);
    this.qc.drawImage(cv, 0, 0, this.q.width, this.q.height);
    this.ec.clearRect(0, 0, this.e.width, this.e.height);
    this.ec.drawImage(cv, 0, 0, this.e.width, this.e.height);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.30 * amt; ctx.drawImage(this.q, 0, 0, W, H);
    ctx.globalAlpha = 0.22 * amt; ctx.drawImage(this.e, 0, 0, W, H);
    if (chroma && chroma > 0){
      const d = chroma;
      ctx.globalAlpha = 0.26 * amt; ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(this.e, -d, 0, W, H); ctx.drawImage(this.e, d, 0, W, H);
    }
    ctx.restore();
  }
  finish(ctx, t, opt){
    opt = opt || {};
    const cv = ctx.canvas;
    // vignette
    if (opt.vig !== 0){ ctx.save(); ctx.globalAlpha = opt.vig === undefined ? 1 : opt.vig; ctx.drawImage(this.vig, 0, 0); ctx.restore(); }
    // scanlines
    if (opt.scan !== 0){ ctx.save(); ctx.globalAlpha = opt.scan === undefined ? 0.35 : opt.scan; ctx.drawImage(this.scan, 0, 0); ctx.restore(); }
    // grain
    if (opt.grain !== 0){
      ctx.save(); ctx.globalCompositeOperation = 'overlay';
      ctx.globalAlpha = opt.grain === undefined ? 0.10 : opt.grain;
      const g = this.grainTiles[(Math.floor(t * 30) % this.grainTiles.length + this.grainTiles.length) % this.grainTiles.length];
      const ox = -Math.floor((Math.floor(t * 30) * 97) % 256), oy = -Math.floor((Math.floor(t * 30) * 61) % 256);
      for (let x = ox; x < W; x += 256) for (let y = oy; y < H; y += 256) ctx.drawImage(g, x, y);
      ctx.restore();
    }
    if (opt.flash > 0){ ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = clamp(opt.flash, 0, 1); ctx.fillStyle = opt.flashColor || '#ffffff'; ctx.fillRect(0, 0, W, H); ctx.restore(); }
  }
}

// ---------- text utils ----------
function wrapText(ctx, str, maxW, size, fam){
  ctx.font = F(size, fam || MONO);
  const words = str.split(' '); const lines = []; let cur = '';
  for (const w of words){ const test = cur ? cur + ' ' + w : w; if (ctx.measureText(test).width > maxW && cur){ lines.push(cur); cur = w; } else cur = test; }
  if (cur) lines.push(cur); return lines;
}
function hex(n, pad){ return (n >>> 0).toString(16).toUpperCase().padStart(pad || 2, '0'); }
function bits(n, pad){ return (n >>> 0).toString(2).padStart(pad || 8, '0'); }
function pad2(n){ return String(n).padStart(2, '0'); }

module.exports = {
  W, H, TAU, C, rgba, F, MONO, MONO2, COND, CONDX, CJK,
  clamp, lerp, inv, sat, smooth, ss,
  easeOutExpo, easeOutQuint, easeOutCubic, easeInCubic, easeInOutCubic, easeInOutQuint, easeInExpo, easeOutBack, easeOutElastic, spring1,
  hash1, mulberry32, hash2, noise2, fbm,
  BPM, SPB, BEAT0, BAR, beatOf, timeOfBeat, barOf, onBeat, pulse, barPulse, kick,
  makeCam, camF, proj,
  lin, circle, fillCircle, ring, rrect, glow, withA, mono, monoW, display, tw, brackets, ruler, spec, wipeText, columns,
  Post, wrapText, hex, bits, pad2,
};
