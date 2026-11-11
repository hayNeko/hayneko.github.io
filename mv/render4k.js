
'use strict';
const fs = require('fs'), path = require('path');
const { spawn } = require('child_process');
const { createCanvas } = require('@napi-rs/canvas');
const L = require('./engine/lib.js');
const B = require('./engine/bible.js');
const SCENES = require('./scenes/index.js');
const CUES = require('./cues.json');

const A = process.argv.slice(2);
const arg = (k, d) => { const i = A.indexOf('--' + k); return i >= 0 ? A[i + 1] : d; };
const FPS = +arg('fps', 30);
const SC = +arg('sc', 2);
const F0 = +arg('f0', 0);
const F1 = +arg('f1', Math.round(B.TOTAL * FPS));
const OUT = arg('out', 'out/seg.mp4');
const AUDIO = arg('audio', '');
const ENC = arg('enc', 'hevc');

const ENCARGS = ENC === 'hevc'
  ? ['-c:v','hevc_nvenc','-preset','p5','-tune','hq','-rc','vbr','-cq','22','-b:v','0']
  : ENC === 'h264nv'
  ? ['-c:v','h264_nvenc','-preset','p5','-tune','hq','-rc','vbr','-cq','21','-b:v','0']
  : ['-c:v','libx264','-preset','medium','-crf','18'];

const cw = L.W * SC, ch = L.H * SC;
const cv = createCanvas(cw, ch), ctx = cv.getContext('2d');
const post = new L.Post();

function activeCue(t){ for (const c of CUES) if (t >= c.s - 0.02 && t < c.e) return c; return null; }
function caption(ctx, t){
  const c = activeCue(t); if (!c) return;
  const u = L.sat((t - c.s) / 0.10), outA = 1 - L.sat((t - (c.e - 0.08)) / 0.14);
  const a = Math.min(u, outA); if (a <= 0) return;
  const x = 96, y = L.H - 74;
  ctx.save(); ctx.globalAlpha = a * 0.72;
  L.mono(ctx, '»', x - 26, y, 17, L.C.cyan, 0);
  L.mono(ctx, c.t, x, y, 17, 'rgba(200,255,225,0.92)', 1.6);
  ctx.globalAlpha = a * 0.5;
  ctx.strokeStyle = L.rgba(L.C.cyan, 0.5); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x - 30, y + 11); ctx.lineTo(x - 30 + 220 * L.easeOutQuint(u), y + 11); ctx.stroke();
  ctx.restore();
}
function beatRuler(ctx, t){
  if (t < 1.0) return;
  ctx.save(); ctx.globalAlpha = 0.20;
  const y = L.H - 18, x0 = 96, x1 = L.W - 96;
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
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const fargs = ['-y','-hide_banner','-loglevel','error',
  '-f','rawvideo','-pix_fmt','rgba','-s', cw + 'x' + ch, '-r', String(FPS), '-i','pipe:0'];
if (AUDIO && fs.existsSync(AUDIO)) fargs.push('-i', AUDIO, '-map','0:v:0','-map','1:a:0','-c:a','aac','-b:a','320k','-shortest');
fargs.push(...ENCARGS, '-pix_fmt','yuv420p','-movflags','+faststart','-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709', OUT);
const ff = spawn('ffmpeg', fargs, { stdio: ['pipe','inherit','inherit'] });
const t0 = Date.now();
(async () => {
  for (let f = F0; f < F1; f++){
    drawFrame(f / FPS);
    const buf = Buffer.from(cv.data());
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
  }
  ff.stdin.end();
  ff.on('close', c => {
    const s = (Date.now() - t0) / 1000;
    console.log('seg ' + F0 + '-' + F1 + ' (' + (F1 - F0) + 'f) ' + s.toFixed(1) + 's = ' + ((F1 - F0) / s).toFixed(2) + ' fps  exit=' + c);
  });
})();
