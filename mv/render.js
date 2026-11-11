
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { createCanvas } = require('@napi-rs/canvas');
const L = require('./engine/lib.js');
const B = require('./engine/bible.js');
const SCENES = require('./scenes/index.js');
const CUES = require('./cues.json');

const args = process.argv.slice(2);
function arg(k, d){ const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; }

const FPS = +(arg('fps', 30));
const T0 = +(arg('from', 0));
const T1 = +(arg('to', B.TOTAL));
const OUT = arg('out', 'out/film.mp4');
const AUDIO = arg('audio', 'audio_master.m4a');

const SC = +(process.env.SC || 1); const cv = createCanvas(L.W * SC, L.H * SC);
const ctx = cv.getContext('2d');
const post = new L.Post();

function activeCue(t){
  for (let i = 0; i < CUES.length; i++) if (t >= CUES[i].s - 0.02 && t < CUES[i].e) return CUES[i];
  return null;
}

// ---------------- caption / instrument layer ----------------
function caption(ctx, t){
  const c = activeCue(t);
  if (!c) return;
  const u = L.sat((t - c.s) / 0.10), outA = 1 - L.sat((t - (c.e - 0.08)) / 0.14);
  const a = Math.min(u, outA);
  if (a <= 0) return;
  const x = 96, y = L.H - 74;
  ctx.save();
  ctx.globalAlpha = a * 0.72;
  L.mono(ctx, '»', x - 26, y, 17, L.C.cyan, 0);
  L.mono(ctx, c.t, x, y, 17, 'rgba(200,255,225,0.92)', 1.6);
  ctx.globalAlpha = a * 0.5;
  ctx.strokeStyle = L.rgba(L.C.cyan, 0.5); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x - 30, y + 11); ctx.lineTo(x - 30 + 220 * L.easeOutQuint(u), y + 11); ctx.stroke();
  ctx.restore();
}
function beatRuler(ctx, t){
  if (t < 1.0) return;
  ctx.save();
  ctx.globalAlpha = 0.20;
  const y = L.H - 18, x0 = 96, x1 = L.W - 96;
  const b0 = Math.floor(L.beatOf(t)) - ((L.beatOf(t)) % 1);
  ctx.strokeStyle = L.C.phos; ctx.lineWidth = 1;
  for (let k = -2; k < 2; k++){
    const b = Math.floor(L.beatOf(t)) + k;
    const px = x0 + (x1 - x0) * (b / 448);
    if (px < x0 || px > x1) continue;
    ctx.beginPath(); ctx.moveTo(px, y); ctx.lineTo(px, y + (k === 0 ? 9 : 4)); ctx.stroke();
  }
  const px = x0 + (x1 - x0) * L.sat(L.beatOf(t) / 448);
  ctx.globalAlpha = 0.55; ctx.fillStyle = L.C.cyan; ctx.fillRect(px - 1, y - 2, 2, 13);
  ctx.restore();
}

function drawFrame(t){
  ctx.setTransform(SC, 0, 0, SC, 0, 0);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = L.C.void; ctx.fillRect(0, 0, L.W, L.H);
  const shot = B.shotAt(t);
  const fn = SCENES[shot.scene];
  const u = L.sat((t - shot.t0) / Math.max(1e-6, shot.dur));
  let o = null;
  if (fn) { try { o = fn(ctx, t, u, shot); } catch (e) { console.error('SCENE ERROR', shot.id, e.message); } }
  o = o || {};
  if (o.noCaption !== true) caption(ctx, t);
  if (o.ruler !== false) beatRuler(ctx, t);
  post.bloom(ctx, o.bloom === undefined ? 1 : o.bloom, o.chroma === undefined ? 2.5 : o.chroma, t);
  post.finish(ctx, t, { flash: o.flash || 0, grain: o.grain === undefined ? 0.085 : o.grain, scan: o.scan === undefined ? 0.5 : o.scan, vig: o.vig === undefined ? 1 : o.vig, flashColor: o.flashColor });
  return shot;
}

// ---------------- modes ----------------
const mode = arg('mode', 'video');
if (mode === 'still'){
  const times = arg('times', '0').split(',').map(Number);
  times.forEach((t, i) => { drawFrame(t); const p = OUT.replace('%d', String(i)); fs.writeFileSync(p, cv.toBuffer('image/png')); console.log('wrote', p, 't=' + t); });
} else if (mode === 'sheet'){
  // 3x2 contact sheet of times
  const times = arg('times', '0').split(',').map(Number);
  const tw = 632, th = 356, cols = 3, rows = Math.ceil(times.length / cols);
  const sheet = createCanvas(tw * cols, (th + 26) * rows); const sc = sheet.getContext('2d');
  sc.fillStyle = '#000'; sc.fillRect(0, 0, sheet.width, sheet.height);
  const tmp = createCanvas(L.W, L.H); const tctx = tmp.getContext('2d');
  const savedCtx = ctx;
  times.forEach((t, i) => {
    // re-draw with a temp canvas by swapping the module-level ctx
    const shot = (function(){ const s = B.shotAt(t); const fn = SCENES[s.scene]; const u = L.sat((t - s.t0) / Math.max(1e-6, s.dur));
      tctx.setTransform(1,0,0,1,0,0); tctx.globalAlpha = 1; tctx.globalCompositeOperation='source-over';
      tctx.fillStyle = L.C.void; tctx.fillRect(0,0,L.W,L.H);
      let o = null; if (fn) { try { o = fn(tctx, t, u, s); } catch(e){ console.error('ERR', s.id, e.message); } }
      o = o || {}; caption(tctx, t); beatRuler(tctx, t);
      post.bloom(tctx, o.bloom === undefined ? 1 : o.bloom, o.chroma === undefined ? 2.5 : o.chroma, t);
      post.finish(tctx, t, { flash:o.flash||0, grain:o.grain===undefined?0.085:o.grain, scan:o.scan===undefined?0.5:o.scan, vig:o.vig===undefined?1:o.vig });
      return s; })();
    const cx = (i % cols) * tw, cy = Math.floor(i / cols) * (th + 26);
    sc.drawImage(tmp, cx, cy, tw, th);
    sc.font = '14px Consolas'; sc.fillStyle = '#7CFFB2';
    sc.fillText(t.toFixed(2) + 's  ' + shot.id, cx + 6, cy + th + 18);
  });
  fs.writeFileSync(OUT, sheet.toBuffer('image/png')); console.log('sheet ->', OUT, times.length);
} else {
  // video: pipe raw RGBA to ffmpeg
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const fargs = ['-y','-hide_banner','-loglevel','error',
    '-f','rawvideo','-pix_fmt','rgba','-s', (L.W * SC) + 'x' + (L.H * SC), '-r', String(FPS), '-i','pipe:0',
    '-ss', '0', '-t', String(T1 - T0)];
  if (fs.existsSync(AUDIO)) fargs.push('-i', AUDIO, '-map','0:v:0','-map','1:a:0','-c:a','aac','-b:a','320k','-shortest');
  fargs.push('-c:v','libx264','-preset','fast','-crf','20','-pix_fmt','yuv420p','-movflags','+faststart','-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709', OUT);
  const ff = spawn('ffmpeg', fargs, { stdio: ['pipe', 'inherit', 'inherit'] });
  const start = Math.floor(T0 * FPS), end = Math.ceil(T1 * FPS);
  let n = 0;
  (async () => {
    const t0 = Date.now();
    for (let f = start; f < end; f++){
      drawFrame(f / FPS);
      const buf = cv.data();
      if (!ff.stdin.write(Buffer.from(buf))) await new Promise(r => ff.stdin.once('drain', r));
      n++;
      if (n % 150 === 0){ const el = (Date.now() - t0) / 1000; const eta = el / n * (end - start - n); console.log(n + '/' + (end - start) + '  ' + (n / el).toFixed(1) + ' fps  eta ' + (eta / 60).toFixed(1) + ' min'); }
    }
    ff.stdin.end();
    ff.on('close', c => console.log('ffmpeg exit', c, 'frames', n));
  })();
}
