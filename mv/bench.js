
const { createCanvas } = require('@napi-rs/canvas');
const L = require('./engine/lib.js');
const cv = createCanvas(L.W, L.H); const ctx = cv.getContext('2d');
const post = new L.Post();
function sceneA(t){
  ctx.fillStyle = '#05070B'; ctx.fillRect(0, 0, L.W, L.H);
  const cam = L.makeCam({ pos: [0, 1.4, 7], yaw: Math.sin(t) * 0.5, pitch: -0.12, fov: 1.05 });
  const pts = []; for (let i = 0; i < 4000; i++){ const a = i * 2.399963, r = Math.cbrt((i % 500) / 500) * 3; pts.push([Math.cos(a) * r, Math.sin(a * 1.7) * 1.2, Math.sin(a) * r]); }
  ctx.globalCompositeOperation = 'lighter';
  for (const p of pts){ const q = L.proj(cam, p); if (!q) continue; const s = Math.min(9, 120 / q[2]); ctx.fillStyle = L.rgba(L.C.cyan, 0.5); ctx.fillRect(q[0], q[1], s, s); }
  ctx.globalCompositeOperation = 'source-over';
  L.mono(ctx, 'world.execute(me);', 120, 140, 34, L.C.phos, 2);
  for (let i = 0; i < 40; i++){ ctx.strokeStyle = L.rgba(L.C.ds, 0.35); ctx.lineWidth = 2; L.lin(ctx, 100 + i * 40, 900, 60 + i * 40 + Math.sin(t + i) * 40, 1000); }
  post.bloom(ctx, 1, 6, t);
  post.finish(ctx, t, { flash: 0.02 });
}
// warm
for (let i = 0; i < 6; i++) sceneA(i * 0.1);
const N = 24; const t0 = Date.now();
for (let i = 0; i < N; i++) sceneA(i * 0.05);
const dt = (Date.now() - t0) / N;
console.log('per-frame ms (1080p, scene+post):', dt.toFixed(1), '  est total @30fps/6258f:', (dt * 6258 / 60000).toFixed(1) + ' min');
console.log('raw data available:', typeof cv.data, '| patched:', typeof ctx.canvas.data);
const buf = cv.data(); console.log('data len', buf.length, 'expected', L.W * L.H * 4, 'first px', buf[0], buf[1], buf[2], buf[3]);
const fs = require('fs'); fs.writeFileSync('out/bench.png', cv.toBuffer('image/png'));
