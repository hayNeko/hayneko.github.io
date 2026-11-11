
'use strict';
const { createCanvas } = require('@napi-rs/canvas');
const L = require('./engine/lib.js');
const B = require('./engine/bible.js');
const SCENES = require('./scenes/index.js');
const CUES = require('./cues.json');
const SC = +(process.env.SC || 2);
const cv = createCanvas(L.W * SC, L.H * SC), ctx = cv.getContext('2d');
const post = new L.Post();
function drawFrame(t){
  ctx.setTransform(SC, 0, 0, SC, 0, 0);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = L.C.void; ctx.fillRect(0, 0, L.W, L.H);
  const s = B.shotAt(t), fn = SCENES[s.scene];
  const u = L.sat((t - s.t0) / Math.max(1e-6, s.dur));
  let o = null;
  if (fn){ try { o = fn(ctx, t, u, s); } catch(e){} }
  o = o || {};
  post.bloom(ctx, o.bloom === undefined ? 1 : o.bloom, o.chroma === undefined ? 2.5 : o.chroma, t);
  post.finish(ctx, t, { flash: o.flash || 0, grain: o.grain === undefined ? 0.085 : o.grain, scan: o.scan === undefined ? 0.5 : o.scan, vig: o.vig === undefined ? 1 : o.vig });
  return cv.data();
}
// warmup
for (let i = 0; i < 3; i++) drawFrame(100 + i * 0.1);
const A = [30.5, 69.7, 112.5, 150.0, 190.6, 0.5, 16.6, 24.0, 86.5, 132.5, 160.2, 203.0];
let tot = 0, n = 0, t0 = Date.now();
for (const a of A){ for (let i = 0; i < 4; i++){ drawFrame(a + i * 0.01); n++; } }
const dt = Date.now() - t0;
console.log('SC=' + SC + '  ' + (dt / n).toFixed(1) + ' ms/frame  (' + (1000 / (dt / n)).toFixed(2) + ' fps single-process)');
const bytes = cv.data().length;
console.log('raw frame bytes ' + (bytes / 1048576).toFixed(1) + ' MB  (pipe demand at 5 fps = ' + (bytes * 5 / 1048576).toFixed(0) + ' MB/s)');
